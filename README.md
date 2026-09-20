# Highlight Translator

在 Windows 任何应用中划词 → 松开鼠标 → 液态玻璃弹窗即时显示本地离线翻译。
免费、本地、无需 API Key；优先使用 UI Automation，UIA 不可用时才使用可配置的剪贴板兜底。

```
Highlight Text → Mouse Up → Read Selection (UIA / Clipboard)
              → Detect Language → LibreTranslate (127.0.0.1)
              → Liquid Glass Popup
```

## 功能（MVP 全清单）

| 状态 | 功能 |
| --- | --- |
| 已实现 | Electron 桌面应用（React + TypeScript，electron-vite 构建） |
| 已实现 | 液态玻璃弹窗（中性毛玻璃 + backdrop-filter，逐尺寸生成；不使用顶部高光贴图） |
| 已验证 | 全局鼠标释放检测 + UI Automation 选区读取 + 剪贴板兜底（可关） |
| 已验证 | 中英互译（自动方向：中→英 / 英→中）+ LibreTranslate 本地离线 smoke |
| 已实现 | SQLite 翻译缓存（命中近零延迟）+ 历史（默认关闭，隐私优先） |
| 已实现 | 复制 / Windows TTS 朗读 / 图钉 / 关闭 / Esc |
| 已实现 | 弹窗原文可直接编辑，停止输入约 450ms 后自动翻译；Ctrl + Enter 可立即触发，且不经过系统剪贴板 |
| 已实现 | 智能定位（下→上→右→左 + workArea 夹紧 + 多显示器 DPI）+ 自动隐藏淡出 |
| 已实现 | 设置窗口（General/Translation/Appearance/Behaviour/Models/History） |
| 已实现 | Settings 主窗口支持最小化、最大化/全屏、还原、关闭和原生 resize；非最大化状态按当前显示器 workArea 夹紧 |
| 已实现 | 界面语言可切换：English / 华文，弹窗、设置页、托盘同步切换 |
| 已实现 | Appearance 分为 Main window 与 Popup window；主窗口外观独立保存，popup 固定使用无底色 Liquid Glass 原色并提供 Blur/字体/尺寸设置 |
| 已实现 | 设置窗口与弹窗内 Appearance 面板按当前显示器工作区夹紧，面板关闭恢复原翻译窗口尺寸 |
| 已实现 | 独立 Settings 窗口复用翻译弹窗的 Liquid Glass 外壳、玻璃颜色、模糊和双语文案 |
| 已实现 | 弹窗内 Appearance 使用与主窗口一致的深色液态玻璃，字体下拉框采用圆角暗色控件 |
| 已实现 | 标题栏只修改 position；popup 永久关闭 Windows 原生边缘 resize，只有右下角专用把手能调整尺寸，避免 Header 被系统命中为 resize |
| 已实现 | Header 移动期间主进程冻结起始宽高，每帧以固定完整 bounds 移动，并按当前显示器 workArea 夹紧位置；拖动结束再次校正，避免窗口被拖出屏幕或发生意外 resize |
| 已实现 | popup 内 Appearance 由用户关闭、再次点击 Settings、点击面板外部、popup 失焦或新划词时收起；独立 Settings 不受新划词影响 |
| 已实现 | Popup 与 Main page 一样使用应用内部窗口表面作为 `backdrop-filter` 取样源；8–48px Blur 实时调节，文字与控件保持清晰，不截取桌面 |
| 已实现 | 外层 popup 的固定尺寸规则只作用于最外层卡片，内层 Appearance 使用自己的内容高度，不再被窗口尺寸拉伸 |
| 已实现 | Appearance 的 Blur 同步作用于弹窗背景图层；标题栏拖动改用屏幕绝对坐标和固定拖动起点，避免抖动与向右上漂移 |
| 已实现 | popup BrowserWindow 不使用 Acrylic/Mica；移除圆角 card 后面的第二层方形系统背景，Window Shape 与 renderer card 保持同一边界 |
| 已实现 | popup BrowserWindow、root 与 card 使用同一尺寸；root 以 Chromium CSS `15px + overflow:hidden` 同步裁切内部背景和 card，不再使用整数矩形拼接的 Windows Shape |
| 已实现 | Popup Appearance 的主题预设只套用英文/中文字体与字号；背景固定使用 Liquid Glass 原色，不再被主题改色 |
| 已实现 | 原文与译文采用一致的标题 + 玻璃内容卡；两边都会自动换行，不使用内部滚动，内容会推动 popup 自动增高 |
| 已实现 | 原文或译文内容变多时 popup 优先自动增高，并按当前显示器 workArea 安全夹紧；手动缩小时会自动恢复到能完整显示内容的高度 |
| 已实现 | 打开或关闭 popup 内 Appearance 时同步临时 card 高度；Settings 只使用新增空间，不压缩上方原文/译文 |
| 已实现 | Popup 内嵌 Appearance 打开后保持开启；仅由用户关闭、再次点击 Settings、点击面板外部或窗口失焦时收起，新 highlight 不强制关闭 |
| 已实现 | 真实 highlight 到达时重新提升 popup 的 Windows z-order（floating + moveTop），但不激活窗口、不抢当前输入焦点 |
| 已实现 | Appearance 展开期间外观刷新使用真实 BrowserWindow 卡片尺寸；玻璃模糊最低为 8px，避免背景照片裸露与尺寸回写错位 |
| 已实现 | 自动忽略 Windows Snipping Tool 等截图工具的区域拖拽；同时检查 MouseDown/MouseUp 进程，截图遮罩先关闭也不会触发 Ctrl+C 兜底 |
| 已实现 | 个性化外观：设置窗口可换背景照片；popup 提供字体、文字颜色、模糊、尺寸和字号设置，背景保持默认 Liquid Glass 原色 |
| 已实现 | 系统托盘 + 开机自启 + NSIS 安装器 + 安装/部署后快捷方式校验 |
| 已实现 | 错误处理（过长选区“Translate Anyway”、模型缺失、服务不可用重试、静默忽略空选区） |
| 已实现 | 响应优化：本地翻译服务健康后复用就绪状态；外观滑杆通过 `input` 事件逐帧预览、100ms 后合并持久化，兼顾实时反馈与 IPC/SQLite 写入 |
| 已实现 | 选区读取稳定等待从 150ms 优化为 80ms，UIA 重试间隔缩短为 80ms/140ms，保持三次重试覆盖 |
| 已实现 | Settings 主体默认采用与顶部 Header 一致的深色中性玻璃；默认白色 tint 不再把内容区域渲染成高亮白色 |
| 已实现 | 旧版 Settings 的 90%/30px 白色玻璃参数会一次性迁移为 Header 默认值；Appearance 主窗口透明度下限可调至 2%，Popup 固定无底色 |
| 已实现 | Liquid Glass 顶部 specular、内侧白色高光线和 Popup 蓝/青色光晕已移除，Popup 外层改为无底色毛玻璃 |
| 已实现 | Settings 主体与 Header 共用相同 LiquidGlass 参数通路；主窗口 Appearance 的 opacity、blur、color 和背景设置可即时调节主体；Popup 的 Blur、字体和尺寸参数也即时推送到已显示的翻译窗口 |
| 已实现 | Popup 内嵌 Appearance 使用弹窗扩展后的剩余高度；内容超出时在面板内部滚动，并显示可拖动的窄型半透明 scrollbar |
| 已实现 | 打开 Popup 内嵌 Appearance 时锁定原文与译文区域的原始高度，新增窗口高度只分配给设置面板 |
| 已实现 | Popup 与 Settings 的所有可操作控件统一提供 hover、按压、键盘 focus 动画反馈；窗口和 Appearance 使用可中断感更强的材质进出过渡，并遵循 reduced-motion、reduced-transparency 与高对比度偏好 |
| 已实现 | Popup 内嵌 Appearance 增加面板内边距与控件分组间距，避免设置项紧贴边缘或彼此拥挤；滚动区域保持可用 |
| 已实现 | Appearance 主题按钮、开关和字体选择增加文字与控件间距，提升小尺寸弹窗中的可读性 |
| 已实现 | Popup Appearance 的 FONT THEMES 标题说明与主题按钮之间增加独立留白，避免视觉贴合 |

## 目录结构

```
highlight-translator/
├── src/main/            Electron 主进程
│   ├── index.ts         入口：生命周期 + IPC + 托盘 + 首次运行
│   ├── windows/         popupWindow（定位/Pin/自动隐藏）、settingsWindow
│   ├── selection/       选区管线：过滤→去重→翻译→弹窗
│   ├── translation/     LibreTranslate Provider + 服务生命周期 + 翻译管理
│   ├── tts.ts           Windows System.Speech 朗读生命周期
│   ├── native/          helperManager（启动/重启/解析 Helper 的 NDJSON）
│   └── storage/         node:sqlite（设置/缓存/历史）
├── src/preload/         contextBridge 白名单 IPC（sandbox 渲染层唯一入口）
├── src/renderer/        popup + settings 两页 React 应用
│   └── shared/          液态玻璃引擎（glassEngine + LiquidGlass 组件）+ 设计令牌
├── native/SelectionHelper/  Helper.cs（C# 核心）+ SelectionHelper.ps1（签名宿主）
├── services/translation/    setup.mjs（装 venv+模型）、smoke.mjs（端到端测试）
├── resources/           pytools（Argos 模型安装脚本）、icons、helper 打包资源
├── scripts/             图标生成 / 截图 / 安装部署 / 快捷方式 / 策略诊断
└── dist/                NSIS 安装器输出
```

## 使用

1. 双击桌面 `Highlight Translator` 快捷方式（或托盘图标打开设置）。首次运行先在 **Models & Service** 安装本地引擎与中英模型。
2. General 页的大按钮 **▶ Start Translator / ■ Stop Translator** 一键启停划词翻译。
3. 在任意应用中选中英文（或中文）文本，松开鼠标 → 弹窗显示译文。
4. 在弹窗的 **Original text / 原文输入** 区直接编辑文字，停止输入约 450ms 后自动翻译；也可按 **Ctrl + Enter** 立即翻译。这条路径不会改写系统剪贴板。
5. 图钉固定弹窗；Esc / ✕ 关闭；🔊 用 Windows TTS 朗读。
6. 想立刻看弹窗效果：托盘右键 → **Preview popup**，或设置 General 页 → **Show popup**（预览显示 1.5 秒后自动关闭）。
7. 在 General 页的 **Interface language** 选择 **English** 或 **华文**；选择后弹窗和托盘菜单即时同步。

> 默认弹窗不是常驻窗口 —— 平时只藏在托盘里，真实划词松开鼠标后才出现在鼠标附近。

### 弹窗显示模式（General → Popup visibility）

| 模式 | 行为 |
| --- | --- |
| Show on highlight（默认） | 只有真实划词后显示，鼠标离开后淡出隐藏；点弹窗图钉可手动钉住 |
| Keep pinned open | 真实划词后弹窗保持常驻，新划词原地更新内容；✕ 关闭后，下一次划词依旧出现并继续钉住 |

两种模式下图钉都可以随时开关；图钉状态跨划词保持。

### 个性化（Appearance 标签）

- Appearance 先选择 **Main window** 或 **Popup window**；两套玻璃参数互不影响。
- **Theme presets**：在 Popup window 内只切换英文/中文字体组合与字号，不改变 Liquid Glass 背景或 Blur。
- **背景照片**：主设置窗口可以选择自己的背景图片；翻译 popup 固定使用默认 Liquid Glass 原色。
- **颜色**：popup 可调整原文与译文文字颜色；主题 preset 不会改动背景或 Blur。
- **字体**：预设列表（系统、微软雅黑、楷体、宋体、Arial、Georgia、Verdana、
  Consolas 等宽）+ 字号 / 缩放 / 模糊滑杆；popup 保持无底色 Liquid Glass，模糊值最低为 8px。
- **窗口边界**：设置窗口打开时会按当前显示器工作区自动夹紧；弹窗内 Appearance 面板关闭后，翻译窗口恢复到打开前的大小。
- **新选区行为**：真实 highlight 到达时自动收起正在打开的 Settings，避免新翻译弹窗与设置窗口重叠。

### 首次运行

- 在 **Models & Service → Install local engine** 触发一次性安装；它会创建 Python 3.12 venv、安装 LibreTranslate 和 Argos en↔zh 模型（约 200MB，需联网一次）。
- 安装完成后应用自动管理本地服务（`127.0.0.1:5000`，只绑定本机）；翻译请求不发送到云端。
- 也可以在开发目录执行 `node services/translation/setup.mjs`，失败会以非零退出码显示。

## 开发

```powershell
npm install                              # 依赖
npm run helper                           # Helper 自测（UIA/clipboard + NDJSON）
npm run test:helper                      # 真实鼠标双击 Hook 端到端测试
node services/translation/setup.mjs      # 本地翻译服务 + 模型（一次性）
npm run dev                              # 开发模式
npm run typecheck                        # TS 类型检查
npm run build                            # 构建
npm run shots                            # 弹窗/设置页截图（shots/）
npm run test:translate                   # 翻译链路端到端测试
npm run dist                             # NSIS 安装器（dist/）
powershell -ExecutionPolicy Bypass -File scripts/install-app.ps1
```

## 验证状态

- [x] 已验证：Helper 受控自测（`npm run helper`）——固定选区、协议输出、数值坐标和 Unicode 文本校验；真实 UIA/Hook 由 `npm run test:helper` 覆盖
- [x] 已验证：**真实鼠标双击模拟测试**（`npm run test:helper`）——LL 钩子捕获 → 选区读取 → selection 事件全链路 PASS
- [x] 已验证：LibreTranslate 端到端（`npm run test:translate`）——服务健康、en→zh、zh→en PASS
- [x] 已验证：TypeScript 类型检查、Electron 构建和 1.0.2 NSIS 打包（`npm run typecheck`、`npm run build`、`npm run dist`）
- [x] 已验证：弹窗/设置窗口 UI 截图（`npm run shots`）——主窗口 Appearance 与 popup Appearance 分组均渲染，Settings 面板未出现越界
- [x] 已验证：popup 卡片尺寸始终等于 BrowserWindow client size；内嵌 Settings 无 scrollbar，`clientHeight === scrollHeight`
- [x] 已验证：严格 Hook/UIA 测试只接受测试窗体自身的 `process=powershell` 与固定测试文本，不再把其他窗口的 selection 当成 PASS
- [x] 已验证：LibreTranslate 本地服务健康，en→zh 176ms/35ms、zh→en 383ms，均低于 Implementation Plan 的 1 秒目标
- [x] 已实现：popup/settings renderer 增加 CSP；继续保持 `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`
- [ ] 待人工验证：受当前自动化宿主限制，注入式 `Ctrl+C` 被拦截；Clipboard Fallback 需在正常桌面应用中实测，不能用失败的沙箱注入冒充通过
- [x] 已验证：Helper 自测和真实鼠标 Hook 回归（`npm run helper`、`npm run test:helper`）——正常选区仍经 UIA 读取
- [x] 已实现：UIA 判断为 `Edit` 输入控件时，不进入 Ctrl+C 剪贴板兜底路径
- [x] 已实现：`SnippingTool`、`ScreenClippingHost`、`ScreenSketch` 等截图进程在 MouseDown/MouseUp 任一阶段命中都会被 Helper 忽略
- [x] 已验证：最终安装版启动日志——`packaged=true`、Helper `ready`、LibreTranslate `service healthy`、真实选区产生翻译请求
- [x] 已验证：最终 NSIS 安装与桌面快捷方式——TargetPath 指向已安装 exe，Helper/模型安装资源存在
- [x] 已验证：1.0.2 通过 `scripts/deploy-app.ps1` 同步到安装目录，重建桌面快捷方式并从 shortcut 启动；本机直接运行新 NSIS stub 会被 WDAC/应用程序控制拦截，未将其误报为安装成功
- [x] 已实现：Helper 会从鼠标释放坐标查找 UIA ControlView/RawView 父级选区；剪贴板兜底会对准目标窗口并避免读取旧剪贴板
- [x] 已验证：Codex/ChatGPT Windows App 实际划词——Helper 捕获 `process=ChatGPT`，UIA 读取成功，并进入 LibreTranslate 翻译流程
- [ ] 待人工验证：Windows TTS 实际语音输出（取决于系统安装的中/英文语音包）
- [ ] 待人工验证：在真实桌面上点击 Settings 标题栏的最小化/最大化/还原并拖动边缘 resize
- [ ] 待人工验证：真实 Windows 桌面上拖动主窗口与 popup Blur，确认透明卡片连续更新且 12px 不再出现黑色系统材质
- [ ] 待人工验证：真实 Windows 桌面上把 popup 拖向四个边缘及多显示器边界，确认每帧位置夹紧且不会离开当前显示器 workArea
- [ ] 待人工验证：真实 Windows 桌面确认 Blur 8/24/48px 差异明显，且 card 后方不再出现第二层方形背景
- [ ] 待人工验证：使用 Windows 截图区域拖拽后直接粘贴图片，确认 Highlight Translator 未触发翻译或覆盖截图剪贴板
- [ ] 待人工验证：首次安装本地引擎/模型按钮（需要真实联网下载约 200MB）
- [ ] 待人工验证：其余真实应用划词矩阵（Chrome/Edge/Word/PDF/VS Code × 单词/句/段/中英/反向拖拽/双击/三击/多行）

## 已知限制

1. **本机 WDAC 代码完整性策略**（企业签名级别要求）拦截无签名 exe/dll：
   - 因此 Helper 采用 PowerShell 宿主 + 内存编译 C#（`native/SelectionHelper/`）。
   - 打包/安装阶段新生成的 NSIS stub 可能被 WDAC/云信誉拦截；本机迭代优先使用 `scripts/deploy-app.ps1`，正式分发仍保留 NSIS 安装器。
2. UIA 读不到的宿主（部分 PDF 插件）需在设置里开启“剪贴板兜底”；
   兜底会短暂模拟 Ctrl+C 并恢复剪贴板；检测为输入框时会跳过兜底（密码管理器场景仍请保持关闭）。
3. 提权进程（以管理员运行的目标应用）无法被非提权的 Helper 读取。
4. 翻译质量取决于 Argos opus-mt 模型，长句可拆分后翻译。
5. Windows TTS 需要系统安装对应语言的语音包；没有匹配语音时会记录错误，不会切换到云端或其他翻译实现。
6. 输入框保护已完成代码实现；仍需在具体的第三方输入控件上人工确认其 UIA 控件类型确实被系统暴露为 `Edit`。
7. 截图工具过滤按 Windows 进程名匹配；如果使用第三方截图软件且进程名不同，需要再加入其进程名。
