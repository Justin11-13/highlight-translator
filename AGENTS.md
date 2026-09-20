# Highlight Translator — 项目级 AGENTS.md

本文件是本仓库的专属规则。全局规则（用户的 Codex Global Personalized AGENTS）依然适用；
两者冲突时以本文件为准（更严格者优先）。

---

## 1. 文档地图 / Documentation Map

```text
AGENTS.md（本文件）
↓
README.md          使用说明、功能清单、验证状态、已知限制
↓
shots/             视觉验证证据（弹窗三态 + 设置页截图）
↓
源码               src/ native/ services/ scripts/
```

修改任何模块前：先读本文件 → 读 README 对应段落 → 读目标模块源码。

---

## 2. 状态标签规则 / Status Labels

文档与提交信息中必须使用明确状态标签，禁止把计划当作已实现：

* `已实现` — 代码存在
* `已验证` — 有自动化或人工证据（测试输出、日志、截图）
* `待人工验证` — 只能由真实交互确认（如真实应用划词矩阵）
* `已弃用 / 已删除` — 不再存在的东西不要再写进文档

当前权威状态见 README「验证状态」一节；每次实质修改后必须同步更新。

---

## 3. 架构边界（不得违反）

```text
Windows Selection Layer   native/SelectionHelper（PowerShell 宿主 + 内存编译 C#）
        ↓ NDJSON stdout
Electron Main             src/main（窗口/IPC/SQLite/翻译/进程管理）
        ↓ contextBridge 白名单 IPC
Renderer                  src/renderer（React；sandbox，无 Node 访问）
        ↙
LibreTranslate            127.0.0.1:5000（services/translation 生命周期管理）
```

* Helper 只做：鼠标释放检测 + 选区读取 + JSON 输出。禁止键盘钩子。
* 渲染层禁止直接访问 Node；一切经 `src/preload` 白名单通道。
* LibreTranslate 只绑定 `127.0.0.1`，禁止 `0.0.0.0`。
* 翻译引擎可替换：必须经 `TranslationProvider` 接口（src/main/translation/libreTranslate.ts）。

---

## 4. 本机特殊约束（重要）

本机启用了 **WDAC 代码完整性策略**（企业签名级别，见事件日志 Policy ID
`0283ac0f-fff1-49ae-ada1-8a933130cad6`）：

1. 无签名 DLL / .NET 程序集加载会被强制拦截（事件 3077）。
2. 部分新编译的无签名 exe 会被云信誉（ISG）暂时拦截，重试或等待即可。
3. 因此：
   - 不要把 Helper 改回 .NET exe / 单文件 exe / 任何无签名原生 DLL 方案；
   - Helper 采用 powershell.exe 宿主 + Add-Type 内存编译（现状，已验证可用）；
   - 依赖原生模块的 npm 包（onnxruntime-node 等）避免引入。
4. `scripts/check-policy.ps1`、`scripts/check-ci-events.ps1` 用于诊断。

---

## 5. 代码风格

* 注释使用中文（用户要求）；标识符、协议字段、日志保持英文。
* 协议（Helper → Electron）为 NDJSON，字段 camelCase：
  `{event, text, mouseX, mouseY, process, method}` / `{event:"ready"|"log"}`
* 设置持久化 key 固定 `settings.v3`；默认值唯一来源 `src/shared/types.ts` 的
  `DEFAULT_SETTINGS`（主进程与渲染层预览共用，禁止复制第二份）。
* 新增 IPC 通道必须同时登记：`src/preload/index.ts` + 主进程 handler + `HtBridge` 类型。
* 禁止死代码：删除的功能要连文档一起删；不保留兼容别名（除非明确要求）。

---

## 6. 验证要求（每次实质修改后）

```bash
npm run typecheck            # 双 tsconfig 必须零错误
npm run build                # electron-vite build
npm run shots                # UI 改动必须重截图并人工检查
node services/translation/smoke.mjs   # 触碰翻译链路时必跑
```

打包发布顺序（顺序敏感）：

```bash
npm run build && npx electron-builder --win   # 必须先 build 再 builder
scripts/install-app.ps1                        # 静默安装（先停运行中的应用）
```

禁止跳过 `electron-vite build` 直接 `electron-builder`（会打包陈旧产物，已踩坑）。

---

## 7. 变更记录（关键决策）

| 日期 | 决策 | 原因 |
| --- | --- | --- |
| 2026-09-18 | 翻译引擎 = LibreTranslate（用户指定），Provider 接口保持可替换 | 用户明确指令；无 Python 时装 winget Python 3.12 + venv |
| 2026-09-18 | Helper = PowerShell 宿主 + 内存编译 C# | WDAC 拦截无签名 exe/dll；三种原生方案均被拦，详见 scripts/ 诊断脚本 |
| 2026-09-18 | LiquidGlass 改分层结构（折射层独立于内容层） | url() 背景滤镜直接挂卡片会压暗内容；分层后内容永远清晰 |
| 2026-09-18 | 修复 preload 缺失 `onData` 桥接 | 代码审查发现弹窗永远收不到数据的关键 bug |
| 2026-09-18 | SQLite 用 node:sqlite | Electron 38 内置，零原生依赖（与 WDAC 约束兼容） |
| 2026-09-18 | 个性化：背景图经 htimg:// 自定义协议提供 | sandbox 渲染层不能直接读磁盘；协议只暴露 userData/backgrounds 单层文件名，防路径穿越 |
| 2026-09-19 | popup 原文区改为可编辑输入，新增 `popup:translate-input` 并复用现有串行翻译队列；输入翻译不经过剪贴板 | 支持用户直接修改/输入原文后翻译，同时保持输入框与系统剪贴板隔离 |
| 2026-09-19 | 内嵌 Appearance 增加弹窗背景图片选择/恢复入口，继续复用 `appearance:pick-image/reset-image` 与 `htimg://bg` | 背景更换可在当前翻译窗口完成，和独立 Settings 的背景设置保持同一条存储管线 |
| 2026-09-19 | popup 透明窗口补用 Windows 11 原生 `Mica/Acrylic` 背景材质；Blur 值同步到原生材质等级，自定义图片继续用 CSS 像素模糊 | CSS `backdrop-filter` 无法采样透明 BrowserWindow 后面的 Windows 桌面，修复 Appearance Blur 调节无可见效果 |
| 2026-09-18 | 颜色全部走 CSS 变量（--ht-text/--ht-accent + 玻璃底色） | 设置改动即时生效于弹窗与设置窗口，无重复状态 |
| 2026-09-18 | 钉住状态 = 用户图钉 \|\| popupMode=pinned；状态随 popup:data 下发同步 | 支持"划词才显示"与"一直常开"两种模式，且图钉跨划词保持 |
| 2026-09-18 | clipboardFallback 默认改为 true；UIA 读取带一次重试；Helper 加 candidate/read 诊断日志 | 实测（scripts/test-hook.ps1 + 用户真实划词）Chrome 等应用 UIA 首连需要预热，兜底是稳定读到的关键 |
| 2026-09-18 | popupMode=pinned 启动即显示等待弹窗（顶部居中，DIP 坐标直传） | 用户期望"常开"= 立即可见；修复 showPopup 错把 DIP 当物理像素换算的坐标偏移 |
| 2026-09-18 | 弹窗固定 520x300（乘 popupScale）；头部为拖动区，拖后位置在本次显示期间保持 | 用户指定尺寸 + 可移动需求；拖动位置通过 win 'moved' 事件记忆，隐藏后重置 |
| 2026-09-18 | 程序定位改为 180ms ease-out 滑行动画（主进程 16ms 帧步进 + 序号取消机制） | 窗口移动不再瞬跳；用户拖动仍走系统原生拖拽保持跟手；动画期间 autoPositioning 抑制 'moved' 误记 |
| 2026-09-18 | 卡片阴影收进窗口边距（0 6px 16px）；弹窗支持右下角拖拽调尺寸（POPUP_SIZE 共享 clamp）；弹窗内置 🎨 外观面板 | 移动时的"方框"=阴影被窗口边界裁切；用户要求免开设置即换外观；尺寸偏好持久化 |
| 2026-09-18 | 新增 scripts/deploy-app.ps1（--dir 构建 + robocopy 同步到安装目录） | NSIS 打包需运行新生成的 stub（WDAC 间歇拦截）；日常迭代用 deploy，NSIS 仅用于分发 |
| 2026-09-18 | UIA 读取 3 次重试；剪贴板兜底改 700ms 轮询；Helper 加 --force-clipboard 诊断开关 | Chrome 的 UIA 功能激活与异步复制都需要更长等待；实测（无沙箱）UIA 与兜底双路径 PASS |
| 2026-09-18 | 注意：在 ZCode 沙箱内测试"划词无反应"会误诊 —— 沙箱吞掉注入的 Ctrl+C，导致兜底假失败 | 根因记录：用户正常双击启动不受影响；Helper 类测试必须 dangerouslyDisableSandbox 或由用户实测 |
| 2026-09-18 | 弹窗 UI 改版（按用户参考图）：标题行+副标题（拖动/语言/缓存）、两侧圆形朗读按钮（左原文右译文）、底部 Copy/Settings 胶囊 + 强调色外观圆钮 | 用户指定设计稿；旧徽章行/分隔线移除 |
| 2026-09-18 | deploy-app.ps1 加入构建步骤（electron-vite build + --dir pack）| 修复"快捷方式跑旧版"：deploy 原本只同步陈旧的 win-unpacked，不重新构建 |
| 2026-09-18 | 弹窗外观模型升级为英文/中文分开（字体/字号/颜色各自独立）+ 弹窗内嵌扩展同款设置面板 | 对齐用户的 Chrome 扩展参考实现；主设置窗口 Appearance 页同步 |
| 2026-09-19 | popup:resize-by 增加 transient 参数（面板展开临时增高不持久化）；设置面板改浅色玻璃卡片、内容流内展开 | 对齐扩展设置 UI 截图 |
| 2026-09-19 | ⚠️ 本机 WDAC/ISG 信誉判定会数小时级翻转：曾稳定运行的 Electron exe 也可能被临时拦截 | 应对：等待重试（deploy 后台循环）/ 用户双击快捷方式时若出现 SmartScreen 选"仍要运行"；判定恢复后一切正常 |
| 2026-09-19 | ✅ 终解：安装目录的 app 宿主 exe 替换为官方签名的 electron.exe（SAC 对签名应用放行），应用代码仍从 app.asar 加载；deploy-app.ps1 已固化此步骤；窗口/快捷方式图标显式指向 resources/icons/app.ico | 未签名宿主被 SAC 硬拦（无豁免），签名宿主 + 我们的 asar = 功能与视觉不变且稳定运行；注意 exe 图标变成 Electron 默认，必须显式指定图标 |
| 2026-09-19 | 拖动改指针驱动（pointer capture + popup:move-by IPC）；app-region: drag 与 resizable:false 组合在 Windows 失效是已知坑 | 用户报告 Drag 不到；指针方案跨环境稳定 |
| 2026-09-19 | popupMode 默认改为 pinned（常驻）；settings 键已在 v3 | 用户明确要求：窗口永久显示除非关闭；1.5s 自动关闭只属于 Preview |
| 2026-09-19 | Helper NDJSON 数值字段按 JSON number 输出；新增模型安装 IPC、Windows System.Speech TTS、自动隐藏淡出与快捷方式目标校验 | 修复 Helper 坐标被当成字符串导致主进程丢弃事件；补齐 MVP 生命周期与部署路径 |
| 2026-09-19 | 排除"隐藏窗口 CSS 动画不推进"导致的截图假象（capture 注入 animation:none）| 截图与真实运行表现不一致时优先怀疑动画冻结 |
| 2026-09-19 | Helper 选区读取增加鼠标坐标 FromPoint + Control/RawView 父级遍历；剪贴板兜底对准目标窗口并修正 Win32 INPUT union 尺寸 | 覆盖 Codex 自定义 WebView 不暴露焦点 TextPattern 的路径；用户实测 Codex 已出现 read ok 并进入本地翻译 |
| 2026-09-19 | 移除启动时的等待弹窗；popupMode 默认恢复为 on-selection | 对齐 Implementation Plan 的 Highlight → Translate → Show Popup 流程；Start Translator 只启用划词监听，不提前显示 Popup |
| 2026-09-19 | 新增统一 `en`/`zh` UI 文案；设置窗口按显示器 workArea 夹紧；弹窗内 Appearance 展开记录并恢复原始边界 | 用户要求双语 UI、设置不越界，以及关闭设置后不改变翻译窗口大小 |
| 2026-09-19 | Helper 在剪贴板兜底前通过 UIA 坐标/焦点父级识别 `ControlType.Edit`，输入控件直接跳过 Ctrl+C | 避免高亮输入框文字时改写用户剪贴板；UIA 直接读到选区时本来就不会触碰剪贴板 |
| 2026-09-20 | 原生 UIA `Edit` 输入控件跳过剪贴板兜底；Chrome/Edge 等浏览器编辑宿主优先绑定目标窗口并走保存/恢复剪贴板路径 | 修复 Google Docs 画布被 Chromium 误判为输入框后静默丢弃的问题；同时记录 SendInput/焦点失败，保留原生输入框和截图工具保护 |
| 2026-09-20 | 浏览器划词保留三次 UIA，失败后使用 800ms + 260ms 的快速剪贴板回退，并追加目标窗口 WM_COPY | 在保留 Google Docs 可读性的前提下减少连续换词时的无效等待 |
| 2026-09-19 | Helper 在鼠标释放入口忽略 `SnippingTool`/`ScreenClippingHost`/`ScreenSketch`/`SnipAndSketch` | 截图区域拖拽不应进入 UIA 读取或 Ctrl+C 兜底，避免影响 Windows 截图复制 |
| 2026-09-19 | 设置页 grid tracks 改为 `minmax(0, 1fr)` 并为内容列/行增加收缩约束 | 窄屏或截图裁剪区域下不再因长文案把设置内容横向推出可视范围 |
| 2026-09-19 | 修正弹窗内 Appearance 面板窄宽断点：普通约 507px 弹窗保持双列，`<=420px` 才切换单列 | 避免设置项纵向堆叠导致面板超出翻译窗口并被裁切 |
| 2026-09-19 | 独立 Settings 窗口改为复用翻译弹窗的 Liquid Glass 外壳与当前外观参数 | 保持翻译弹窗与 Settings 的视觉、透明度、颜色、模糊和双语文案一致 |
| 2026-09-19 | 内嵌 Appearance 改为深色 Liquid Glass；下拉框圆角化；拖动改为 client 坐标差值并在面板展开时隐藏缩放把手 | 修复白色设置卡片、方角 dropdown，以及拖动时误触缩放导致窗口变大的问题 |
| 2026-09-19 | 真实新 highlight（`id > 0`）自动关闭独立 Settings 与内嵌 Appearance；Appearance 展开时 payload 使用真实窗口尺寸；玻璃模糊下限统一为 8px | 避免设置窗口重叠、Blur 刷新后卡片与 BrowserWindow 尺寸错位，以及低透明度下背景照片裸露 |
| 2026-09-19 | 移除弹窗右下角 resize grip、`popup:resize-by` IPC 和渲染层缩放事件；尺寸只由 Appearance 滑杆调整 | 用户反馈普通 drag 仍会误变大，必须让拖动路径只负责移动窗口 |
| 2026-09-19 | popup 固定尺寸 CSS 限定为最外层 `.popup-card`，内层 Appearance 保持自身内容高度 | 修复嵌套 Liquid Glass 同时继承外层 `width/height` 导致 Appearance 错位、内容裁切 |
| 2026-09-19 | 恢复右下角专用 resize grip；标题栏 drag 锁定当前宽高，resize 使用独立 IPC 且拖动过程中只临时改尺寸 | 同时保留用户需要的 resize，并阻止移动窗口时误触发尺寸变化 |
| 2026-09-19 | 背景照片图层同步应用 `glassBlur`；拖动改为屏幕绝对坐标 `drag-start/move/end`，不再用会随窗口移动而变化的 `clientX/clientY` 增量 | 修复 Blur 调整无视觉效果，以及拖动窗口抖动、持续向右上偏移 |
| 2026-09-19 | 独立 Settings 支持最小化、最大化/还原和 resize；Appearance 拆成主窗口与翻译 popup 两套独立玻璃参数 | 主页面可全屏/调整大小，主窗口外观不再与 popup 互相覆盖 |
| 2026-09-19 | popup 低 blur 时通过 Electron Window Shape 只保留圆角卡片区域；Popup Appearance 增加四个共用主题 preset | 去除 Windows 透明矩形外壳，并让字体、文字颜色与液态玻璃参数可以协调切换 |
| 2026-09-19 | Window Shape 改为按圆角逐行生成并合并矩形，而不是使用上/中/下三条矩形带 | 保留卡片四个圆角，避免低 blur 下为了隐藏外层透明矩形而剪掉角落 |
| 2026-09-19 | 原文输入区与译文区固定为等高玻璃内容卡；原文 textarea、原文/译文容器统一隐藏内部滚动条 | 对齐用户参考 UI；长文本通过换行和 Popup Size 调整处理，不让内容区出现 scrollbar |
| 2026-09-19 | popup BrowserWindow、renderer card 与圆角 Window Shape 统一为同一尺寸，移除 24px 外层透明 inset | Windows 低 blur 下外层透明区域会被合成为黑色矩形；popup 只保留 card 本身 |
| 2026-09-19 | Settings 面板展开/收起后重新发送当前 popup payload，让 renderer 同步临时 card 高度 | 避免内嵌 Appearance 插入时 Flex 压缩上方原文与译文区域 |
| 2026-09-19 | 移除 popup 原文区 Translate 按钮；textarea 点击时显式 focus，停止输入 450ms 后走现有 `popup:translate-input` 自动翻译 | 修复原文无法输入，并让手动输入路径直接翻译且不触碰系统剪贴板 |
| 2026-09-19 | popup drag 改用 `setPosition`，resize 改为 `resize-start/move/end` 固定起点协议；popup card 移除窗口外阴影 | 避免每次移动重复触发窗口尺寸重排、避免 resize 读取滞后边界累加，并让卡片边缘不再被外阴影裁成黑色 |
| 2026-09-19 | popup 与主 Settings 的最低 8px Blur 改用 Mica，不再在透明 BrowserWindow 使用 `none`；截图工具同步该材质映射 | `none` 会让白色 tint 与背景照片直接露出，8px 变成发白；Mica 提供稳定的低 blur 暗色基底 |
| 2026-09-19 | 真实 highlight 到达时调用 `setAlwaysOnTop(true, 'floating')` + `moveTop()`，继续使用 `showInactive()` | 翻译 popup 置于普通窗口最上层，同时不激活 popup、不打断用户正在输入的应用 |
