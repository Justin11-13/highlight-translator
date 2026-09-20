/** 主进程与渲染进程之间的共享契约（单一事实来源）。 */

export type PopupStatus = 'loading' | 'result' | 'error';

export type TtsLanguage = 'en' | 'zh';

export type UiLanguage = 'en' | 'zh';

export interface TtsState {
  speaking: boolean;
  language?: TtsLanguage;
}

export type PopupVisibilityState = 'visible' | 'closing';

export interface PopupData {
  /** 递增 id，用于把"翻译无论如何"等回传请求与一次选区对应起来 */
  id: number;
  status: PopupStatus;
  originalText: string;
  /** 超长选区错误态的完整原文，仅供主进程重试，不直接要求界面展示。 */
  retryText?: string;
  translatedText?: string;
  detectedLanguage?: string;
  targetLanguage?: string;
  /** 划词发生的来源应用（如 chrome、notepad） */
  processName?: string;
  /** 本次结果是否直接命中 SQLite 翻译缓存 */
  cached?: boolean;
  /** 错误码：too_long | model_missing | service_unavailable | engine_unavailable */
  errorCode?: string;
  /** 是否展示"仍然翻译/重试"按钮 */
  canRetryAnyway?: boolean;
  /** 当前是否处于钉住状态（用户图钉 或 popupMode=pinned），弹窗按钮据此同步 */
  pinned?: boolean;
  /** 外观参数（由主进程按当前设置填充，渲染层应用） */
  appearance?: PopupAppearance;
}

/** 弹窗（置顶窗口）的外观参数。 */
export interface PopupAppearance {
  /** 应用界面语言（弹窗按钮/设置面板文案） */
  uiLanguage: UiLanguage;
  glassOpacity: number;
  /** Popup 毛玻璃强度（像素）；0 = 透明不模糊，数值越高越接近液态玻璃。 */
  glassBlur: number;
  /** 是否显示原文区块 */
  showOriginal: boolean;
  /** 卡片尺寸（由 Appearance 设置或专用缩放把手调整并持久化） */
  popupWidth: number;
  popupHeight: number;
  /** 英文字体（EN_FONT_STACKS 的 key） */
  englishFontFamily: string;
  /** 中文字体（ZH_FONT_STACKS 的 key） */
  chineseFontFamily: string;
  /** 英文字号（像素） */
  englishFontSize: number;
  /** 中文字号（像素） */
  chineseFontSize: number;
  /** 原文文字颜色（hex） */
  originalTextColor: string;
  /** 译文文字颜色（hex） */
  translationTextColor: string;
  /** 玻璃着色基色（hex），仅在用户把可选 tint opacity 调高时使用 */
  glassColor: string;
  /** 弹窗背景照片（htimg:// URL 或 null = 默认极光） */
  popupBackground: string | null;
}

export type PopupThemePresetKey = 'aurora' | 'midnight' | 'rose' | 'mint';

export type PopupThemePresetValues = Pick<
  PopupAppearance,
  | 'englishFontFamily'
  | 'chineseFontFamily'
  | 'englishFontSize'
  | 'chineseFontSize'
>;

export interface PopupThemePreset {
  key: PopupThemePresetKey;
  values: PopupThemePresetValues;
}

/** 主题只负责字体组合；玻璃背景始终保持默认 Liquid Glass 原色。 */
export const POPUP_THEME_PRESETS: readonly PopupThemePreset[] = [
  {
    key: 'aurora',
    values: {
      englishFontFamily: 'segoe',
      chineseFontFamily: 'yahei',
      englishFontSize: 13,
      chineseFontSize: 15
    }
  },
  {
    key: 'midnight',
    values: {
      englishFontFamily: 'inter',
      chineseFontFamily: 'yahei',
      englishFontSize: 13,
      chineseFontSize: 15
    }
  },
  {
    key: 'rose',
    values: {
      englishFontFamily: 'segoe',
      chineseFontFamily: 'jhenghei',
      englishFontSize: 13,
      chineseFontSize: 15
    }
  },
  {
    key: 'mint',
    values: {
      englishFontFamily: 'calibri',
      chineseFontFamily: 'jhenghei',
      englishFontSize: 13,
      chineseFontSize: 15
    }
  }
] as const;

/** 背景图用途：弹窗 / 设置窗口。 */
export type BackgroundPurpose = 'popup' | 'settings';

export interface Settings {
  /** Windows 开机自启 */
  launchAtStartup: boolean;
  /** 启动时只进托盘，不弹设置窗口 */
  startMinimized: boolean;
  /** 松开鼠标后是否自动翻译 */
  autoTranslate: boolean;
  /** 应用界面语言：英文或华文 */
  uiLanguage: UiLanguage;
  /** 目标语言；划到目标语言本身时自动反向翻译 */
  targetLanguage: 'zh' | 'en';
  /** 超过该长度的选区不自动翻译（防误选全文） */
  maxChars: number;
  /** 低于该长度的选区直接忽略 */
  minChars: number;
  /**
   * UI Automation 读取失败时的剪贴板兜底（模拟 Ctrl+C 后恢复剪贴板）。
   * 默认开启：实测多数应用（含 Chrome）需要它才能稳定读到选区；
   * UIA 读到时不会触碰剪贴板。
   */
  clipboardFallback: boolean;
  /** 鼠标离开弹窗后多久自动隐藏（毫秒） */
  autoHideDelay: number;
  /** 翻译 popup 玻璃卡片基础不透明度 0..1 */
  glassOpacity: number;
  /** 翻译 popup 外观参数迁移版本（内部字段，不在设置页展示） */
  popupGlassSchemaVersion: number;
  /** 翻译 popup 玻璃背景模糊（像素） */
  glassBlur: number;
  /** 主设置窗口玻璃基础不透明度 0..1 */
  mainGlassOpacity: number;
  /** 主设置窗口玻璃背景模糊（像素） */
  mainGlassBlur: number;
  /** 主设置窗口玻璃着色基色（hex） */
  mainGlassColor: string;
  /** 主设置窗口外观参数迁移版本（内部字段，不在设置页展示） */
  mainGlassSchemaVersion: number;
  /** 弹窗卡片宽度（DIP），由 Appearance 或专用缩放把手调整（380..900） */
  popupWidth: number;
  /** 弹窗卡片高度（DIP），由 Appearance 或专用缩放把手调整（240..640） */
  popupHeight: number;
  /** 弹窗是否显示原文区块（译文在上、原文可关） */
  showOriginal: boolean;
  /** 英文字体（EN_FONT_STACKS 的 key） */
  englishFontFamily: string;
  /** 中文字体（ZH_FONT_STACKS 的 key） */
  chineseFontFamily: string;
  /** 英文字号（像素，11..22） */
  englishFontSize: number;
  /** 中文字号（像素，12..24） */
  chineseFontSize: number;
  /** 原文文字颜色（hex） */
  originalTextColor: string;
  /** 译文文字颜色（hex） */
  translationTextColor: string;
  /** 玻璃着色基色（hex） */
  glassColor: string;
  /** 弹窗背景照片：'default' 或 userData/backgrounds 下的文件名 */
  popupBackground: string;
  /** 设置窗口背景照片：'default' 或文件名 */
  settingsBackground: string;
  /**
   * 弹窗显示模式（用户可选）：
   *  - pinned：真实划词后保持常驻；用户 ✕ 关闭后，下一次划词依旧出现并继续常驻
   *  - on-selection：划词才显示，鼠标离开自动隐藏（可用图钉手动常驻）
   */
  popupMode: 'on-selection' | 'pinned';
  /** 是否把翻译记录写入本地 SQLite 历史（默认关闭，保护隐私） */
  saveHistory: boolean;
  /** 各语言对的 Argos 模型是否已安装 */
  modelsInstalled: { 'en-zh': boolean; 'zh-en': boolean };
}

/** Popup 液态玻璃默认参数；默认不叠加底色，但保留可调 Blur。 */
export const POPUP_FROSTED_BLUR = 24
export const POPUP_FROSTED_MIN_OPACITY = 0
export const POPUP_FROSTED_BLUR_MIN = 0
export const POPUP_FROSTED_BLUR_MAX = 48

/** 弹窗卡片尺寸限制与默认值（主进程与渲染层共用，保证 clamp 一致）。 */
export const POPUP_SIZE = {
  defaultW: 520,
  defaultH: 300,
  minW: 380,
  minH: 240,
  maxW: 900,
  maxH: 760
} as const

/** 液态玻璃的最低背景模糊，避免低透明度下背景照片直接露出。 */
export const MIN_GLASS_BLUR = 8

/** 把卡片尺寸夹紧到允许范围。 */
export function clampPopupSize(width: number, height: number): { width: number; height: number } {
  return {
    width: Math.min(Math.max(Math.round(width), POPUP_SIZE.minW), POPUP_SIZE.maxW),
    height: Math.min(Math.max(Math.round(height), POPUP_SIZE.minH), POPUP_SIZE.maxH)
  }
}

export interface HistoryRow {
  id: number;
  original_text: string;
  translated_text: string;
  source_language: string;
  target_language: string;
  application_name: string;
  created_at: string;
}

export type ModelKey = 'en-zh' | 'zh-en';

export interface HtBridge {
  /** 弹窗页面可用（contextBridge 暴露，渲染层唯一入口） */
  popup?: {
    getData(): Promise<PopupData | null>;
    onData(cb: (data: PopupData) => void): () => void;
    setPinned(pinned: boolean): void;
    setSettingsOpen(open: boolean): void;
    onSettingsOpen(cb: (open: boolean) => void): () => void;
    dragStart(screenX: number, screenY: number): void;
    dragMove(screenX: number, screenY: number): void;
    dragEnd(): void;
    resizeStart(screenX: number, screenY: number): void;
    resizeMove(screenX: number, screenY: number): void;
    resizeEnd(): void;
    speak(text: string, language: TtsLanguage): void;
    stopSpeaking(): void;
    onTtsState(cb: (state: TtsState) => void): () => void;
    onVisibility(cb: (state: PopupVisibilityState) => void): () => void;
    mouseEnter(): void;
    mouseLeave(): void;
    translateAnyway(id: number): void;
    translateInput(text: string): void;
    copy(text: string): void;
    close(): void;
  };
  settings?: {
    get(): Promise<Settings>;
    set(patch: Record<string, unknown>): Promise<Settings>;
    previewAppearance(patch: Record<string, unknown>): void;
    minimize(): void;
    toggleMaximize(): void;
    getWindowState(): Promise<{ maximized: boolean; minimized: boolean }>;
    onWindowState(cb: (state: { maximized: boolean; minimized: boolean }) => void): () => void;
    quitApp(): void;
    openPopupTest(): void;
    openSettings(): void;
  };
  history?: {
    list(): Promise<HistoryRow[]>;
    remove(id: number): Promise<void>;
    clear(): Promise<void>;
  };
  appearance?: {
    /** 打开文件选择对话框并把图片复制到 userData，返回保存的文件名 */
    pickImage(purpose: BackgroundPurpose): Promise<string | null>;
    /** 删除自定义背景，恢复默认 */
    resetImage(purpose: BackgroundPurpose): Promise<void>;
  };
  models?: {
    status(): Promise<{ installed: Record<ModelKey, boolean>; downloading: Record<ModelKey, boolean> }>;
    download(key: ModelKey): Promise<unknown>;
    setup(): Promise<unknown>;
    serviceStatus(): Promise<{ installed: boolean; running: boolean }>;
    onChanged(cb: (payload: unknown) => void): () => void;
  };
}

/** 设置默认值（主进程与渲染进程预览共用，避免两份默认值漂移）。 */
export const DEFAULT_SETTINGS: Settings = {
  launchAtStartup: false,
  startMinimized: true,
  autoTranslate: true,
  uiLanguage: 'en',
  targetLanguage: 'zh',
  maxChars: 3000,
  minChars: 2,
  // 剪贴板兜底默认开启（实测必需）；风险与说明见字段注释
  clipboardFallback: true,
  autoHideDelay: 500,
  // Popup 外层默认完全不叠加底色；Appearance 仍可按需调节 tint。
  glassOpacity: 0,
  popupGlassSchemaVersion: 1,
  glassBlur: POPUP_FROSTED_BLUR,
  // Settings 主体默认与顶部 Header 接近：浅白 tint + 8px backdrop blur。
  mainGlassOpacity: 0.07,
  mainGlassBlur: 8,
  mainGlassColor: '#ffffff',
  mainGlassSchemaVersion: 1,
  showOriginal: true,
  popupWidth: 520,
  popupHeight: POPUP_SIZE.defaultH,
  englishFontFamily: 'segoe',
  chineseFontFamily: 'yahei',
  englishFontSize: 13,
  chineseFontSize: 15,
  originalTextColor: '#ffffff',
  translationTextColor: '#ffffff',
  glassColor: '#ffffff',
  saveHistory: false,
  modelsInstalled: { 'en-zh': false, 'zh-en': false },
  popupBackground: 'default',
  settingsBackground: 'default',
  popupMode: 'on-selection'
}

/** 英文字体预设（key 即 Settings.englishFontFamily 的值）。 */
export const EN_FONT_STACKS: Record<string, { label: string; stack: string }> = {
  segoe: { label: 'System (Segoe UI)', stack: "'Segoe UI', Arial, sans-serif" },
  arial: { label: 'Arial', stack: 'Arial, sans-serif' },
  times: { label: 'Times New Roman', stack: "'Times New Roman', serif" },
  georgia: { label: 'Georgia', stack: 'Georgia, serif' },
  verdana: { label: 'Verdana', stack: 'Verdana, sans-serif' },
  tahoma: { label: 'Tahoma', stack: 'Tahoma, sans-serif' },
  calibri: { label: 'Calibri', stack: 'Calibri, sans-serif' },
  inter: { label: 'Inter', stack: 'Inter, "Segoe UI", sans-serif' },
  consolas: { label: 'Consolas (mono)', stack: "'Consolas', 'Courier New', monospace" }
}

/** 中文字体预设（key 即 Settings.chineseFontFamily 的值）。 */
export const ZH_FONT_STACKS: Record<string, { label: string; stack: string }> = {
  yahei: { label: '微软雅黑', stack: "'Microsoft YaHei', 'Microsoft JhengHei', sans-serif" },
  jhenghei: { label: '微软正黑体', stack: "'Microsoft JhengHei', 'Microsoft YaHei', sans-serif" },
  song: { label: '宋体', stack: "'SimSun', serif" },
  hei: { label: '黑体', stack: "'SimHei', sans-serif" },
  kai: { label: '楷体', stack: "'KaiTi', '楷体', serif" },
  fangsong: { label: '仿宋', stack: "'FangSong', '仿宋', serif" },
  noto: { label: 'Noto Sans CJK', stack: "'Noto Sans CJK SC', 'Microsoft YaHei', sans-serif" }
}

/** 取英文字体栈；未知 key 回退系统默认。 */
export function englishFontStack(key: string): string {
  return (EN_FONT_STACKS[key] ?? EN_FONT_STACKS['segoe']).stack
}

/** 取中文字体栈；未知 key 回退默认。 */
export function chineseFontStack(key: string): string {
  return (ZH_FONT_STACKS[key] ?? ZH_FONT_STACKS['yahei']).stack
}
