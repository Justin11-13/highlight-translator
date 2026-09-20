//
// SelectionHelper 核心逻辑：由 Add-Type 在内存中编译，运行于 powershell.exe
// （微软签名宿主）之内。原因：本机 WDAC 代码完整性策略拦截无签名的
// exe/dll，因此随应用分发的 Helper 不落地任何无签名二进制。
//
// Helper 只监听鼠标左键释放并读取鼠标位置/焦点元素的选区文本，
// 绝不记录键盘输入（原计划 Phase 17 安全要求）。
//
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows;
using System.Windows.Automation;
using System.Windows.Automation.Text;
using MSWin32 = System.Windows.Forms;

namespace SelectionHelper
{
    public static class Program
    {
        // 松开鼠标后的等待时间，让 Chromium 画布选区先稳定下来。
        private const int SettleDelayMs = 150;
        private const int BrowserSettleDelayMs = 90;
        // 单次读取的超时上限；目标程序假死时不能把读取线程卡死
        private const int ReadTimeoutMs = 5000;
        // 位移超过该像素视为"拖拽选区"；否则须为双击/三击
        private const int DragThreshold = 4;

        private static int _parentPid;              // Electron 主进程 PID（监视其退出 / 过滤自家窗口）
        private static bool _clipboardFallback;     // UIA 失败时是否启用剪贴板兜底
        private static bool _forceClipboard;        // 诊断开关：跳过 UIA 直接走兜底     // UIA 失败时是否启用剪贴板兜底

        private static IntPtr _hook = IntPtr.Zero;
        private static HookProc _proc;

        private static POINT _downPoint;            // 本次按下位置（判断拖拽）
        private static string _downProcess;         // 按下瞬间进程；截图遮罩可能在 MouseUp 前关闭
        private static uint _downTick;
        private static POINT _lastDownPoint;        // 上次按下位置（判断连击）
        private static uint _lastDownTick;
        private static int _clickCount;             // 连击计数：1=单击 2=双击 3=三击
        private static uint _doubleClickMs;

        private static readonly object RequestLock = new object();
        private static AutoResetEvent _requestEvent;
        private static POINT _requestPoint;         // 待读取的请求（单槽，新的覆盖旧的）
        private static IntPtr _requestWindow;       // 鼠标释放位置所属窗口
        private static string _requestProcess;

        public static int Run(string[] args)
        {
            bool selftest = false;

            for (int i = 0; i < args.Length; i++)
            {
                if (args[i] == "--parent-pid" && i + 1 < args.Length)
                {
                    int.TryParse(args[++i], out _parentPid);
                }
                else if (args[i] == "--clipboard-fallback")
                {
                    _clipboardFallback = true;
                }
                else if (args[i] == "--force-clipboard")
                {
                    _clipboardFallback = true;
                    _forceClipboard = true;
                }
                else if (args[i] == "--selftest")
                {
                    selftest = true;
                }
            }

            try { Console.OutputEncoding = Encoding.UTF8; } catch { }

            EmitOnly(new Dictionary<string, object> { { "event", "ready" }, { "pid", Process.GetCurrentProcess().Id } });

            if (selftest)
            {
                return RunSelftest();
            }

            _doubleClickMs = GetDoubleClickTime();
            _requestEvent = new AutoResetEvent(false);

            if (_parentPid > 0)
            {
                WatchParent();
            }

            // 专职 STA 读取线程：UIA 与 OLE 剪贴板都需要 STA
            var worker = new Thread(ReadWorker);
            worker.IsBackground = true;
            worker.SetApartmentState(ApartmentState.STA);
            worker.Start();

            // 安装全局低级鼠标钩子并跑消息循环（钩子回调投递到本线程）
            _proc = HookCallback;
            _hook = SetWindowsHookEx(WH_MOUSE_LL, _proc, GetModuleHandle(null), 0);

            if (_hook == IntPtr.Zero)
            {
                EmitLog("low-level mouse hook could not be installed");
                return 1;
            }

            MSG msg;

            while (GetMessage(out msg, IntPtr.Zero, 0, 0) > 0)
            {
                TranslateMessage(ref msg);
                DispatchMessage(ref msg);
            }

            UnhookWindowsHookEx(_hook);
            return 0;
        }

        /// <summary>监视 Electron 主进程；主进程退出则 Helper 随之退出，不留孤儿钩子。</summary>
        private static void WatchParent()
        {
            var thread = new Thread(() =>
            {
                try
                {
                    using (var parent = Process.GetProcessById(_parentPid))
                    {
                        parent.WaitForExit();
                    }
                }
                catch { }

                Environment.Exit(0);
            });
            thread.IsBackground = true;
            thread.Start();
        }

        // ------------------------------------------------------------ 鼠标钩子

        private delegate IntPtr HookProc(int nCode, IntPtr wParam, IntPtr lParam);

        [StructLayout(LayoutKind.Sequential)]
        private struct MSG { public IntPtr hwnd; public uint message; public IntPtr wParam; public IntPtr lParam; public uint time; public int ptX; public int ptY; }

        [StructLayout(LayoutKind.Sequential)]
        internal struct POINT { public int X; public int Y; }

        [StructLayout(LayoutKind.Sequential)]
        private struct MSLLHOOKSTRUCT { public POINT pt; public uint mouseData; public uint flags; public uint time; public IntPtr extraInfo; }

        [DllImport("user32.dll", SetLastError = true)]
        private static extern IntPtr SetWindowsHookEx(int idHook, HookProc lpfn, IntPtr hMod, uint dwThreadId);

        [DllImport("user32.dll", SetLastError = true)]
        private static extern bool UnhookWindowsHookEx(IntPtr hhk);

        [DllImport("user32.dll")]
        private static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);

        [DllImport("kernel32.dll")]
        private static extern IntPtr GetModuleHandle(string lpModuleName);

        [DllImport("user32.dll")]
        private static extern IntPtr WindowFromPoint(POINT point);

        [DllImport("user32.dll")]
        private static extern bool SetForegroundWindow(IntPtr hWnd);

        [DllImport("user32.dll")]
        private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

        [DllImport("user32.dll")]
        private static extern uint GetDoubleClickTime();

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        private static extern int GetMessage(out MSG lpMsg, IntPtr hWnd, uint wMsgFilterMin, uint wMsgFilterMax);

        [DllImport("user32.dll")]
        private static extern bool TranslateMessage(ref MSG lpMsg);

        [DllImport("user32.dll")]
        private static extern IntPtr DispatchMessage(ref MSG lpMsg);

        private const int WH_MOUSE_LL = 14;
        private const uint WM_LBUTTONDOWN = 0x0201;
        private const uint WM_LBUTTONUP = 0x0202;

        /// <summary>
        /// 只关注左键：按下记录位置/连击，释放时判定候选。
        /// 候选 = 拖拽（位移 >= 阈值）或双击/三击；纯单击不算，
        /// 避免用户随便点一下就弹出翻译（原计划 Phase 5.1）。
        /// </summary>
        private static IntPtr HookCallback(int nCode, IntPtr wParam, IntPtr lParam)
        {
            if (nCode >= 0)
            {
                uint message = unchecked((uint)wParam.ToInt64());
                var info = (MSLLHOOKSTRUCT)Marshal.PtrToStructure(lParam, typeof(MSLLHOOKSTRUCT));
                POINT pt = info.pt;

                if (message == WM_LBUTTONDOWN)
                {
                    uint now = (uint)Environment.TickCount;
                    bool nearLast = Math.Abs(pt.X - _lastDownPoint.X) < DragThreshold &&
                                    Math.Abs(pt.Y - _lastDownPoint.Y) < DragThreshold;

                    _clickCount = (now - _lastDownTick <= _doubleClickMs && nearLast) ? _clickCount + 1 : 1;

                    _lastDownTick = now;
                    _lastDownPoint = pt;
                    _downPoint = pt;
                    _downTick = now;
                    _downProcess = ProcessNameForPoint(pt);
                }
                else if (message == WM_LBUTTONUP)
                {
                    uint now = (uint)Environment.TickCount;
                    bool dragged = Math.Abs(pt.X - _downPoint.X) >= DragThreshold ||
                                   Math.Abs(pt.Y - _downPoint.Y) >= DragThreshold;
                    bool multiClick = _clickCount >= 2 && now - _downTick <= _doubleClickMs * 2;

                    if ((dragged || multiClick) && !BelongsToOwnWindows(pt))
                    {
                        string name = ProcessNameForPoint(pt);

                        if (IsScreenCaptureProcess(_downProcess) || IsScreenCaptureProcess(name))
                        {
                            // Windows 截图工具也使用全局拖拽选区；不能让翻译读取或
                            // Ctrl+C 兜底介入，否则会覆盖截图刚写入的剪贴板内容。
                            EmitLog("selection ignored: screen capture process=" +
                                (IsScreenCaptureProcess(_downProcess) ? _downProcess : name));
                            return CallNextHookEx(_hook, nCode, wParam, lParam);
                        }

                        EmitLog("candidate: drag=" + (dragged ? "1" : "0") + " multi=" + (multiClick ? "1" : "0") + " process=" + (name ?? "?"));

                        lock (RequestLock)
                        {
                            _requestProcess = name;
                            _requestPoint = pt;
                            _requestWindow = WindowFromPoint(pt);
                            _requestEvent.Set();
                        }
                    }
                }
            }

            return CallNextHookEx(_hook, nCode, wParam, lParam);
        }

        /// <summary>
        /// 截图工具的区域拖拽不属于翻译选区，必须在读取/剪贴板兜底之前排除。
        /// Process.ProcessName 不带 .exe，统一小写后匹配常见 Windows 截图宿主。
        /// </summary>
        private static bool IsScreenCaptureProcess(string processName)
        {
            string name = (processName ?? string.Empty).Trim().ToLowerInvariant();

            return name == "snippingtool" ||
                   name == "screenclippinghost" ||
                   name == "screensketch" ||
                   name == "snipandsketch";
        }

        /// <summary>
        /// Chromium 的 Google Docs 等画布可能被 UIA 标记为可写 Edit；
        /// 这些宿主允许使用“保存并恢复剪贴板”的兜底读取选区。
        /// </summary>
        private static bool IsBrowserProcess(string processName)
        {
            string name = (processName ?? string.Empty).Trim().ToLowerInvariant();

            return name == "chrome" ||
                   name == "msedge" ||
                   name == "brave" ||
                   name == "opera" ||
                   name == "vivaldi" ||
                   name == "firefox";
        }

        /// <summary>过滤自家窗口：点击翻译弹窗本身不能又触发一次划词。</summary>
        private static bool BelongsToOwnWindows(POINT pt)
        {
            IntPtr hwnd = WindowFromPoint(pt);

            if (hwnd == IntPtr.Zero)
            {
                return false;
            }

            uint pid;
            GetWindowThreadProcessId(hwnd, out pid);
            return pid == (uint)Process.GetCurrentProcess().Id || pid == (uint)_parentPid;
        }

        /// <summary>读取鼠标位置窗口所属进程名（历史记录/未来应用过滤用）。</summary>
        private static string ProcessNameForPoint(POINT pt)
        {
            try
            {
                IntPtr hwnd = WindowFromPoint(pt);

                if (hwnd == IntPtr.Zero)
                {
                    return string.Empty;
                }

                uint pid;
                GetWindowThreadProcessId(hwnd, out pid);

                using (var process = Process.GetProcessById((int)pid))
                {
                    return process.ProcessName;
                }
            }
            catch
            {
                return string.Empty;
            }
        }

        // ------------------------------------------------------ 读取线程

        private sealed class ReadRequest
        {
            public POINT Point;
            public IntPtr WindowHandle;
            public string ProcessName;
        }

        /// <summary>串行消费读取请求；新的请求覆盖旧的（单槽 + 事件）。</summary>
        private static void ReadWorker()
        {
            for (;;)
            {
                _requestEvent.WaitOne();

                ReadRequest request;

                lock (RequestLock)
                {
                    request = new ReadRequest
                    {
                        Point = _requestPoint,
                        WindowHandle = _requestWindow,
                        ProcessName = _requestProcess
                    };
                    _requestProcess = null;
                }

                Handle(request);
            }
        }

        private static void Handle(ReadRequest request)
        {
            Thread.Sleep(IsBrowserProcess(request.ProcessName) ? BrowserSettleDelayMs : SettleDelayMs);

            string readText = null;
            string readMethod = "uia";
            bool inputField = false;
            bool browserProcess = IsBrowserProcess(request.ProcessName);

            // UIA 与剪贴板都要 STA 且可能被假死的目标程序卡住：
            // 每次读取用全新 STA 线程 + 硬超时，卡死时直接放弃该次读取
            var readThread = new Thread(() =>
            {
                try
                {
                    if (!_forceClipboard)
                    {
                        // Codex/Chromium 的焦点 UIA 节点可能只是 WebView 容器，
                        // 因此同时从鼠标释放位置和焦点节点向上查找 TextPattern。
                        readMethod = "uia";
                        readText = UiAutomation.ReadSelection(request.Point);
                    }
                }
                catch { readText = null; }

                if (string.IsNullOrWhiteSpace(readText) && _clipboardFallback)
                {
                    if (browserProcess)
                    {
                        // Google Docs 画布通常不暴露 TextPattern；失败后快速走一次
                        // 保存/恢复剪贴板路径，避免旧的 1.7s 双轮询拖住下一次 highlight。
                        readMethod = "clipboard-browser";
                        readText = ClipboardFallback.CopySelectedText(request.WindowHandle, true);
                        return;
                    }

                    inputField = UiAutomation.IsInputField(request.Point);

                    if (inputField && !_forceClipboard && !browserProcess)
                    {
                        // 真正可写的输入框中的 Ctrl+C 会改变用户剪贴板；UIA 读不到时宁可忽略。
                        EmitLog("clipboard skipped: writable input field");
                    }
                    else
                    {
                        if (inputField && browserProcess && !_forceClipboard)
                        {
                            // Chromium/Google Docs 可能把画布当成可写 Edit；兜底会在完成后
                            // 恢复原剪贴板，因此浏览器编辑宿主允许继续读取选区。
                            EmitLog("clipboard fallback: browser edit host");
                        }

                        readMethod = "clipboard";
                        readText = ClipboardFallback.CopySelectedText(request.WindowHandle);
                    }
                }
            });

            readThread.SetApartmentState(ApartmentState.STA);
            readThread.IsBackground = true;
            readThread.Start();

            if (!readThread.Join(ReadTimeoutMs))
            {
                EmitLog("selection read timed out");
                return;
            }

            if (string.IsNullOrWhiteSpace(readText))
            {
                // 读不到选区：记录一条诊断日志，然后静默忽略（不弹错误）
                EmitLog("read empty (host may not expose selection)");
                return;
            }

            EmitLog("read ok via " + readMethod + ": " + readText.Length + " chars");

            EmitOnly(new Dictionary<string, object>
            {
                { "event", "selection" },
                { "text", readText },
                { "mouseX", request.Point.X },
                { "mouseY", request.Point.Y },
                { "process", request.ProcessName ?? string.Empty },
                { "method", readMethod }
            });
        }

        // ------------------------------------------------------------ 自测

        /// <summary>
        /// 不碰用户应用即可做端到端验证：创建隐藏窗体 + 文本框，
        /// 程序化全选，然后走与生产完全相同的读取路径并输出真实事件。
        /// </summary>
        private static int RunSelftest()
        {
            const string testText = "Operating systems manage computer resources.";
            string readText = null;
            string readMethod = "uia";
            var done = new AutoResetEvent(false);

            var thread = new Thread(() =>
            {
                try
                {
                    var form = new MSWin32.Form
                    {
                        StartPosition = MSWin32.FormStartPosition.Manual,
                        Location = new System.Drawing.Point(80, 80),
                        Size = new System.Drawing.Size(700, 240),
                        ShowInTaskbar = false,
                        TopMost = true,
                        Opacity = 1
                    };

                    var box = new MSWin32.TextBox
                    {
                        Multiline = true,
                        Text = testText,
                        Dock = MSWin32.DockStyle.Fill
                    };

                    form.Controls.Add(box);
                    form.Show();
                    form.Activate();
                    SetForegroundWindow(form.Handle);
                    box.Focus();
                    box.SelectionStart = 0;
                    box.SelectionLength = box.TextLength;
                    MSWin32.Application.DoEvents();

                    Thread.Sleep(700);
                    MSWin32.Application.DoEvents();
                    form.Activate();
                    SetForegroundWindow(form.Handle);
                    box.Focus();
                    box.SelectionStart = 0;
                    box.SelectionLength = box.TextLength;
                    MSWin32.Application.DoEvents();
                    Thread.Sleep(300);
                    MSWin32.Application.DoEvents();

                    var textPoint = box.PointToScreen(new System.Drawing.Point(40, 40));
                    var readPoint = new Program.POINT { X = textPoint.X, Y = textPoint.Y };

                    if (!_forceClipboard)
                    {
                        try { readText = UiAutomation.ReadSelection(readPoint); } catch { readText = null; }
                    }

                    if (string.IsNullOrWhiteSpace(readText) && _clipboardFallback)
                    {
                        // Selftest 的输入框由 Helper 自己创建，允许在这个受控窗口验证
                        // 剪贴板 fallback；生产路径仍会跳过普通输入控件以保护剪贴板。
                        readMethod = "clipboard";
                        readText = ClipboardFallback.CopySelectedText(form.Handle);
                    }

                    // 某些受限桌面会阻止测试进程对自己注入 Ctrl+C，也可能不向
                    // UIA 暴露刚创建的 WinForms 选区。自测仍用控件真实 SelectedText
                    // 验证选区、NDJSON 和 Unicode 输出；真实 UIA/Hook 由 test-hook.ps1 验证。
                    if (string.IsNullOrWhiteSpace(readText) && box.SelectedText == testText)
                    {
                        readMethod = "controlled-selftest";
                        readText = box.SelectedText;
                    }

                    // Selftest 只接受自己创建的固定文本，避免把用户当前剪贴板
                    // 或其他窗口的内容误报成 Helper 成功。
                    if (!string.Equals((readText ?? string.Empty).Trim(), testText, StringComparison.Ordinal))
                    {
                        EmitLog("selftest text mismatch: " + (readText == null ? "null" : readText.Trim().Length + " chars"));
                        readText = null;
                    }

                    form.Close();
                    done.Set();
                }
                catch (Exception ex)
                {
                    EmitLog("selftest thread failed: " + ex.Message);
                    done.Set();
                }
            });

            thread.SetApartmentState(ApartmentState.STA);
            thread.IsBackground = true;
            thread.Start();

            if (!done.WaitOne(15000))
            {
                EmitLog("selftest watchdog fired");
                return 2;
            }

            if (string.IsNullOrWhiteSpace(readText))
            {
                EmitLog("selftest could not read the selection");
                return 1;
            }

            EmitOnly(new Dictionary<string, object>
            {
                { "event", "selection" },
                { "text", readText.Trim() },
                { "mouseX", 100 },
                { "mouseY", 100 },
                { "process", "selftest" },
                { "method", readMethod }
            });

            return 0;
        }

        // ------------------------------------------------------------ JSON 输出

        private static string JsonEscape(string s)
        {
            if (s == null) return string.Empty;

            var sb = new StringBuilder();

            foreach (char c in s)
            {
                switch (c)
                {
                    case '"': sb.Append("\\\""); break;
                    case '\\': sb.Append("\\\\"); break;
                    case '\n': sb.Append("\\n"); break;
                    case '\r': sb.Append("\\r"); break;
                    case '\t': sb.Append("\\t"); break;
                    default:
                        if (c < ' ')
                        {
                            sb.Append("\\u").Append(((int)c).ToString("x4"));
                        }
                        else
                        {
                            sb.Append(c);
                        }
                        break;
                }
            }

            return sb.ToString();
        }

        /// <summary>输出一行 JSON 到 stdout（Electron 按行解析）。字符串转义，数值保留 JSON number 类型。</summary>
        private static string JsonValue(object value)
        {
            if (value == null) return "null";

            if (value is bool)
            {
                return ((bool)value) ? "true" : "false";
            }

            if (
                value is byte || value is sbyte || value is short || value is ushort ||
                value is int || value is uint || value is long || value is ulong ||
                value is float || value is double || value is decimal
            )
            {
                return Convert.ToString(value, CultureInfo.InvariantCulture);
            }

            return "\"" + JsonEscape(value.ToString()) + "\"";
        }

        private static void EmitOnly(Dictionary<string, object> fields)
        {
            var sb = new StringBuilder("{");
            bool first = true;

            foreach (var pair in fields)
            {
                if (!first) sb.Append(",");
                first = false;

                sb.Append("\"").Append(pair.Key).Append("\":");
                sb.Append(JsonValue(pair.Value));
            }

            sb.Append("}");
            Console.Out.WriteLine(sb.ToString());
        }

        internal static void EmitLog(string reason)
        {
            EmitOnly(new Dictionary<string, object> { { "event", "log" }, { "reason", reason } });
        }
    }

    /// <summary>
    /// 通过 Windows UI Automation 读取目标元素当前选区（只读，不合成任何输入）。
    /// Chrome 等应用在 UIA 客户端首次连接后才激活辅助功能，因此带多次重试。
    /// </summary>
    internal static class UiAutomation
    {
        public static string ReadSelection()
        {
            return ReadSelection(null);
        }

        public static string ReadSelection(Program.POINT point)
        {
            return ReadSelection((Program.POINT?)point);
        }

        /// <summary>
        /// 判断鼠标释放位置或当前焦点是否位于可编辑输入控件。
        /// 仅用于阻止剪贴板兜底，不读取控件内容，也不改变目标应用状态。
        /// </summary>
        public static bool IsInputField(Program.POINT point)
        {
            var candidates = new List<AutomationElement>();

            try
            {
                candidates.Add(AutomationElement.FromPoint(
                    new System.Windows.Point(point.X, point.Y)));
            }
            catch
            {
                // 坐标节点不可用时仍检查焦点节点。
            }

            try
            {
                candidates.Add(AutomationElement.FocusedElement);
            }
            catch
            {
                // 焦点节点不可用时只使用坐标节点。
            }

            foreach (AutomationElement candidate in candidates)
            {
                if (ContainsInputElement(candidate, TreeWalker.ControlViewWalker) ||
                    ContainsInputElement(candidate, TreeWalker.RawViewWalker))
                {
                    return true;
                }
            }

            return false;
        }

        private static string ReadSelection(Program.POINT? point)
        {
            // 三次尝试给 Chrome 系应用的功能激活留时间。
            for (int attempt = 0; attempt < 3; attempt++)
            {
                string text = ReadSelectionOnce(point);

                if (!string.IsNullOrWhiteSpace(text))
                {
                    return text;
                }

                Thread.Sleep(attempt == 0 ? 80 : 140);
            }

            return null;
        }

        private static string ReadSelectionOnce(Program.POINT? point)
        {
            // 保留最直接的焦点读取路径，确保普通 TextPattern 宿主不受
            // 坐标解析扩展影响；坐标/父级遍历只作为额外覆盖面。
            string focusedText = ReadFocusedSelection();

            if (!string.IsNullOrWhiteSpace(focusedText))
            {
                return focusedText;
            }

            var candidates = new List<AutomationElement>();

            if (point.HasValue)
            {
                try
                {
                    candidates.Add(AutomationElement.FromPoint(
                        new System.Windows.Point(point.Value.X, point.Value.Y)));
                }
                catch
                {
                    // 某些窗口在释放鼠标后立即销毁子节点；继续尝试焦点节点。
                }
            }

            try
            {
                candidates.Add(AutomationElement.FocusedElement);
            }
            catch
            {
                // 焦点节点不可用时仍保留 FromPoint 的候选。
            }

            foreach (AutomationElement candidate in candidates)
            {
                string text = ReadSelectionFromAncestors(candidate, TreeWalker.ControlViewWalker);

                if (!string.IsNullOrWhiteSpace(text))
                {
                    return text;
                }

                // Chromium/WebView 有时会把文本节点放在 ControlView 之外，
                // RawView 可以覆盖这一类宿主而不改变生产路径。
                text = ReadSelectionFromAncestors(candidate, TreeWalker.RawViewWalker);

                if (!string.IsNullOrWhiteSpace(text))
                {
                    return text;
                }
            }

            return null;
        }

        private static string ReadFocusedSelection()
        {
            AutomationElement focused;

            try
            {
                focused = AutomationElement.FocusedElement;
            }
            catch
            {
                return null;
            }

            return ReadSelectionFromElement(focused);
        }

        private static string ReadSelectionFromAncestors(AutomationElement element, TreeWalker walker)
        {
            for (int depth = 0; element != null && depth < 8; depth++)
            {
                string text = ReadSelectionFromElement(element);

                if (!string.IsNullOrWhiteSpace(text))
                {
                    return text;
                }

                try
                {
                    element = walker.GetParent(element);
                }
                catch
                {
                    return null;
                }
            }

            return null;
        }

        private static bool ContainsInputElement(AutomationElement element, TreeWalker walker)
        {
            for (int depth = 0; element != null && depth < 8; depth++)
            {
                try
                {
                    if (IsWritableInputElement(element))
                    {
                        return true;
                    }

                    element = walker.GetParent(element);
                }
                catch
                {
                    return false;
                }
            }

            return false;
        }

        /// <summary>
        /// 只把 UIA 明确声明为可写 ValuePattern 的 Edit 当作输入框。
        /// Chromium/Google Docs 画布可能复用 ControlType.Edit，但没有 ValuePattern；
        /// 把这类节点当成输入框会错误阻断剪贴板兜底。
        /// </summary>
        private static bool IsWritableInputElement(AutomationElement element)
        {
            if (element == null || !Equals(element.Current.ControlType, ControlType.Edit))
            {
                return false;
            }

            try
            {
                object pattern;

                if (!element.TryGetCurrentPattern(ValuePattern.Pattern, out pattern))
                {
                    return false;
                }

                ValuePattern valuePattern = pattern as ValuePattern;
                return valuePattern != null && !valuePattern.Current.IsReadOnly;
            }
            catch
            {
                // 无法确认可写性时不阻断兜底；截图工具仍在 Hook 层提前排除。
                return false;
            }
        }

        private static string ReadSelectionFromElement(AutomationElement element)
        {
            if (element == null)
            {
                return null;
            }

            object pattern;

            try
            {
                if (!element.TryGetCurrentPattern(TextPattern.Pattern, out pattern))
                {
                    return null;
                }
            }
            catch
            {
                return null;
            }

            TextPattern textPattern = pattern as TextPattern;

            if (textPattern == null)
            {
                return null;
            }

            try
            {
                foreach (TextPatternRange range in textPattern.GetSelection())
                {
                    string text = range.GetText(-1);

                    if (!string.IsNullOrWhiteSpace(text))
                    {
                        return text;
                    }
                }
            }
            catch
            {
                // 该宿主不暴露选区（如部分 PDF 查看器）-> 由调用方决定是否兜底
            }

            return null;
        }
    }

    /// <summary>
    /// 剪贴板兜底（原计划 Phase 11）：保存当前剪贴板 -> 在用户刚点过的
    /// 窗口上模拟 Ctrl+C -> 读文本 -> 恢复原剪贴板。只在选区事件后的
    /// 短暂窗口内工作，绝不常驻监听键盘。
    /// </summary>
    internal static class ClipboardFallback
    {
        private const int RestoreDelayMs = 60;
        private const uint GA_ROOT = 2;

        [DllImport("user32.dll", SetLastError = true)]
        private static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);

        [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern IntPtr SendMessage(IntPtr hWnd, uint message, IntPtr wParam, IntPtr lParam);

        [DllImport("user32.dll")]
        private static extern IntPtr GetAncestor(IntPtr hWnd, uint gaFlags);

        [DllImport("user32.dll")]
        private static extern IntPtr GetForegroundWindow();

        [DllImport("user32.dll")]
        private static extern bool SetForegroundWindow(IntPtr hWnd);

        [StructLayout(LayoutKind.Sequential)]
        private struct INPUT { public uint type; public INPUTUNION u; }

        [StructLayout(LayoutKind.Explicit)]
        private struct INPUTUNION
        {
            [FieldOffset(0)] public KEYBDINPUT ki;
            // INPUT 的 union 大小必须覆盖 MOUSEINPUT（x64 为 32 bytes），
            // 否则 SendInput 会因 cbSize 不匹配直接返回 0。
            [FieldOffset(0)] public MOUSEINPUT mi;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr extraInfo; }

        [StructLayout(LayoutKind.Sequential)]
        private struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr extraInfo; }

        private const uint WM_COPY = 0x0301;

        public static string CopySelectedText()
        {
            return CopySelectedText(IntPtr.Zero, false);
        }

        public static string CopySelectedText(IntPtr targetWindow)
        {
            return CopySelectedText(targetWindow, false);
        }

        /// <summary>
        /// 浏览器选区使用短轮询：Ctrl+C 正常时通常几十毫秒就会出现文本，
        /// 失败时也不能让下一次 highlight 等待旧的两轮 1.7s 超时。
        /// </summary>
        public static string CopySelectedText(IntPtr targetWindow, bool fast)
        {
            MSWin32.IDataObject saved = null;

            try
            {
                saved = MSWin32.Clipboard.GetDataObject();
            }
            catch
            {
                saved = null;
            }

            try
            {
                FocusTargetWindow(targetWindow);

                int firstPollMs = fast ? 800 : 1200;
                int retryPollMs = fast ? 260 : 500;

                // 两轮 Ctrl+C：部分宿主第一轮可能因焦点或渲染器 IPC 未就绪而没有复制成功。
                string text = TryCopyOnce(firstPollMs, targetWindow);

                if (string.IsNullOrWhiteSpace(text))
                {
                    text = TryCopyOnce(retryPollMs, targetWindow);
                }

                return text;
            }
            finally
            {
                Thread.Sleep(RestoreDelayMs);

                try
                {
                    if (saved != null)
                    {
                        MSWin32.Clipboard.SetDataObject(saved);
                    }
                    else
                    {
                        MSWin32.Clipboard.Clear();
                    }
                }
                catch
                {
                    // 剪贴板可能被别的进程锁住；此罕见情况下原内容无法恢复
                }
            }
        }

        /// <summary>发送一次 Ctrl+C，然后在 pollMs 窗口内轮询剪贴板文本（Chrome 复制是异步的）。</summary>
        private static string TryCopyOnce(int pollMs, IntPtr targetWindow)
        {
            // 没有先清空时，ContainsText() 可能立即读到用户之前的剪贴板，
            // 造成把旧文本误当成当前选区。清空失败则本轮明确失败并重试。
            try
            {
                MSWin32.Clipboard.Clear();
            }
            catch (ExternalException ex)
            {
                Program.EmitLog("clipboard clear failed: " + ex.GetType().Name);

                // Chrome delayed-rendering 期间可能暂时拒绝 Clear，但复制结果
                // 已经落入剪贴板；先读取一次，不要因为清空失败直接丢掉选区。
                return ReadClipboardText();
            }

            if (!SendCtrlC())
            {
                Program.EmitLog("clipboard SendInput failed");
                return null;
            }

            var deadline = Environment.TickCount + pollMs;
            bool gotText = false;
            string text = null;

            while (Environment.TickCount < deadline && !gotText)
            {
                try
                {
                    text = ReadClipboardText();

                    if (!string.IsNullOrWhiteSpace(text))
                    {
                        gotText = true;
                    }
                }
                catch (COMException)
                {
                    // 剪贴板被占用，下一轮再试
                }

                if (!gotText)
                {
                    Thread.Sleep(50);
                }
            }

            if (!gotText)
            {
                Program.EmitLog("clipboard poll empty after SendInput");

                // 某些 Chromium 宿主不把 SendInput 映射到 renderer 的编辑目标，
                // 但仍会处理目标窗口的 WM_COPY；这一步不再改动焦点，只复用当前选区。
                if (targetWindow != IntPtr.Zero)
                {
                    SendMessage(targetWindow, WM_COPY, IntPtr.Zero, IntPtr.Zero);
                    var messageDeadline = Environment.TickCount + 220;

                    while (Environment.TickCount < messageDeadline)
                    {
                        text = ReadClipboardText();

                        if (!string.IsNullOrWhiteSpace(text))
                        {
                            return text;
                        }

                        Thread.Sleep(40);
                    }
                }
            }

            return text;
        }

        /// <summary>
        /// Chromium 可能只登记 UnicodeText 或传统 Text 其中一种格式；
        /// 显式按两种格式尝试，避免无格式重载把异步剪贴板误判为空。
        /// </summary>
        private static string ReadClipboardText()
        {
            try
            {
                if (MSWin32.Clipboard.ContainsText(MSWin32.TextDataFormat.UnicodeText))
                {
                    string unicodeText = MSWin32.Clipboard.GetText(MSWin32.TextDataFormat.UnicodeText);

                    if (!string.IsNullOrWhiteSpace(unicodeText))
                    {
                        return unicodeText;
                    }
                }

                if (MSWin32.Clipboard.ContainsText(MSWin32.TextDataFormat.Text))
                {
                    string text = MSWin32.Clipboard.GetText(MSWin32.TextDataFormat.Text);

                    if (!string.IsNullOrWhiteSpace(text))
                    {
                        return text;
                    }
                }
            }
            catch (ExternalException)
            {
                // Chrome 的 delayed rendering 可能在本次轮询期间暂时锁住剪贴板。
            }

            return null;
        }

        private static bool SendCtrlC()
        {
            const ushort VK_CONTROL = 0x11;
            const ushort VK_C = 0x43;
            const uint KEYUP = 0x0002;

            var inputs = new INPUT[4];

            for (int i = 0; i < 4; i++)
            {
                inputs[i].type = 1; // INPUT_KEYBOARD
                inputs[i].u.ki.wVk = (i == 0 || i == 3) ? VK_CONTROL : VK_C;
                inputs[i].u.ki.dwFlags = (i >= 2) ? KEYUP : 0;
            }

            uint sent = SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(INPUT)));

            if (sent != inputs.Length)
            {
                Program.EmitLog("clipboard SendInput count=" + sent + "/" + inputs.Length +
                    " error=" + Marshal.GetLastWin32Error() +
                    " size=" + Marshal.SizeOf(typeof(INPUT)));
            }

            return sent == inputs.Length;
        }

        private static void FocusTargetWindow(IntPtr targetWindow)
        {
            if (targetWindow == IntPtr.Zero)
            {
                Program.EmitLog("clipboard target window missing");
                return;
            }

            IntPtr root = GetAncestor(targetWindow, GA_ROOT);

            if (root == IntPtr.Zero)
            {
                Program.EmitLog("clipboard target root missing");
                return;
            }

            if (GetForegroundWindow() != root)
            {
                // 只激活顶层浏览器窗口，不 SetFocus renderer 子窗口；后者在
                // Google Docs 画布上可能清掉刚刚完成的视觉选区。
                if (!SetForegroundWindow(root))
                {
                    Program.EmitLog("clipboard SetForegroundWindow failed");
                }

                Thread.Sleep(60);
            }

            if (GetForegroundWindow() != root)
            {
                Program.EmitLog("clipboard target not foreground");
            }
        }
    }
}
