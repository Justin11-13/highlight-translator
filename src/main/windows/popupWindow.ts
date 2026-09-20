import { BrowserWindow, clipboard, ipcMain, screen, type Rectangle } from 'electron'
import path from 'node:path'
import { getSettings, setSettings } from '../storage/settingsStore'
import { onTtsState, speakText, stopSpeaking } from '../tts'
import { log } from '../logger'
import {
  clampPopupSize,
  POPUP_FROSTED_BLUR_MAX,
  POPUP_FROSTED_BLUR_MIN,
  POPUP_FROSTED_MIN_OPACITY,
  POPUP_SIZE
} from '@shared/types'
import type { PopupAppearance, PopupData, PopupVisibilityState } from '@shared/types'

/** 应用图标路径（窗口/任务栏用）。签名宿主 exe 的图标是 Electron 默认，需显式指定。 */
function appIconPath(): string {
  return path.join(process.resourcesPath!, 'icons', 'app.ico')
}

/** 弹窗卡片尺寸：由 Appearance 或专用缩放把手调整，限制与默认值见 shared POPUP_SIZE。 */
const MARGIN = 0
/** 弹窗与屏幕边缘的最小间距。 */
const SCREEN_GAP = 12
/** 内嵌 Appearance 面板需要的临时高度；关闭时会精确恢复原始边界。 */
const SETTINGS_PANEL_EXTRA_HEIGHT = 470

function cardSize(): { width: number; height: number } {
  const settings = getSettings()
  return clampPopupSize(settings.popupWidth ?? POPUP_SIZE.defaultW, settings.popupHeight ?? POPUP_SIZE.defaultH)
}

/** Appearance 展开期间，payload 必须反映真实 BrowserWindow 卡片尺寸。 */
function payloadCardSize(): { width: number; height: number } {
  if (settingsPanelBaseBounds && win && !win.isDestroyed()) {
    const bounds = win.getBounds()
    return clampPopupSize(bounds.width - MARGIN * 2, bounds.height - MARGIN * 2)
  }

  return cardSize()
}

/** 将临时展开后的窗口完整夹紧到当前显示器工作区。 */
function fitWindowToWorkArea(bounds: Rectangle): Rectangle {
  const display = screen.getDisplayMatching(bounds)
  const area = display.workArea
  const width = Math.min(bounds.width, Math.max(260, area.width - SCREEN_GAP * 2))
  const height = Math.min(bounds.height, Math.max(200, area.height - SCREEN_GAP * 2))
  const minX = area.x + SCREEN_GAP
  const minY = area.y + SCREEN_GAP
  const maxX = Math.max(minX, area.x + area.width - width - SCREEN_GAP)
  const maxY = Math.max(minY, area.y + area.height - height - SCREEN_GAP)

  return {
    x: Math.max(minX, Math.min(Math.round(bounds.x), maxX)),
    y: Math.max(minY, Math.min(Math.round(bounds.y), maxY)),
    width,
    height
  }
}

let win: BrowserWindow | null = null
let unsubscribeTts: (() => void) | null = null

// ---- 弹窗运行时状态 ----
let anchor = { x: 0, y: 0 } // 松开鼠标的位置（DIP 坐标，定位锚点）
let userPinned = false // 用户手动图钉；叠加设置里的 popupMode 后才是最终钉住状态
let mouseInside = false // 鼠标是否悬停在弹窗上
let hideTimer: NodeJS.Timeout | null = null
let current: PopupData | null = null

// ---- 用户拖拽位置记忆 ----
let userDragged = false // 本次显示期间用户是否手动拖动过弹窗
let userPos = { x: 0, y: 0 } // 用户拖动后的窗口位置（DIP）
let autoPositioning = false // 程序自身 setBounds（含移动动画期间）时忽略 move 事件
let settingsPanelBaseBounds: Rectangle | null = null
let resizePersistTimer: NodeJS.Timeout | null = null
let dragSession: {
  pointerX: number
  pointerY: number
  bounds: Rectangle
} | null = null
let resizeSession: {
  pointerX: number
  pointerY: number
  bounds: Rectangle
} | null = null

function setPopupBounds(bounds: Rectangle): void {
  if (!win || win.isDestroyed()) {
    return
  }

  win.setBounds(bounds)
}

function applyWindowBounds(bounds: Rectangle): void {
  if (!win || win.isDestroyed()) {
    return
  }

  autoPositioning = true
  setPopupBounds(bounds)
  autoPositioning = false
}

/**
 * 系统材质保持关闭，避免在圆角 card 后面留下第二层方形 Acrylic/Mica 背景。
 */
function syncNativePopupMaterial(_blur = getSettings().glassBlur): void {
  if (process.platform !== 'win32' || !win || win.isDestroyed()) {
    return
  }

  try {
    win.setBackgroundMaterial('none')
    win.setBackgroundColor('#00000000')
  } catch (error) {
    log('native popup background material unavailable:', error as Error)
  }
}

/** 打开/关闭弹窗内设置面板；关闭时恢复用户原来的翻译窗口边界。 */
function setSettingsPanelOpen(open: boolean): void {
  if (!win || win.isDestroyed()) {
    return
  }

  if (open) {
    if (!settingsPanelBaseBounds) {
      settingsPanelBaseBounds = win.getBounds()
    }

    const base = settingsPanelBaseBounds
    applyWindowBounds(fitWindowToWorkArea({
      ...base,
      height: base.height + SETTINGS_PANEL_EXTRA_HEIGHT
    }))

    // BrowserWindow 先展开后，renderer 必须收到新的 card 高度；否则
    // Appearance 插入同一张 card 时，Flex 会先压缩上面的原文/译文区域。
    if (current) {
      win.webContents.send('popup:data', buildPayload(current))
    }
    return
  }

  if (settingsPanelBaseBounds) {
    const base = settingsPanelBaseBounds
    settingsPanelBaseBounds = null
    applyWindowBounds(base)

    // 关闭面板后恢复持久化的 card 尺寸，避免翻译内容继续保留临时展开高度。
    if (current) {
      win.webContents.send('popup:data', buildPayload(current))
    }
  }
}

// ---- 程序定位的滑动动画 ----
const MOVE_ANIM_MS = 180 // 缓动时长：足够顺滑，又不拖泥带水
let moveAnimSeq = 0 // 递增序号：新动画使旧动画帧失效
const HIDE_ANIM_MS = 140
let hideAnimationTimer: NodeJS.Timeout | null = null
let closing = false
let ipcRegistered = false

/** 取消正在进行的移动动画（新定位到来时调用）。 */
function cancelMoveAnim(): void {
  moveAnimSeq++
  autoPositioning = false
}

/**
 * 用 ease-out cubic 把窗口从当前位置滑到目标位置（主进程无 rAF，用 16ms 定时帧）。
 * 动画期间保持 autoPositioning，避免 win 'moved' 事件误记为用户拖拽。
 */
function animateWindowTo(x: number, y: number, width: number, height: number): void {
  if (!win || win.isDestroyed()) {
    return
  }

  const seq = ++moveAnimSeq
  const from = win.getBounds()
  const dx = x - from.x
  const dy = y - from.y
  const dw = width - from.width
  const dh = height - from.height

  // 位移过小直接到位，避免无意义的抖动
  if (Math.abs(dx) < 2 && Math.abs(dy) < 2 && Math.abs(dw) < 2 && Math.abs(dh) < 2) {
    setPopupBounds({ x, y, width, height })
    autoPositioning = false
    return
  }

  const start = Date.now()

  const step = (): void => {
    if (!win || win.isDestroyed() || seq !== moveAnimSeq) {
      return // 窗口没了或被新动画取代：静默退出，不碰 autoPositioning
    }

    const t = Math.min(1, (Date.now() - start) / MOVE_ANIM_MS)
    const eased = 1 - Math.pow(1 - t, 3)

    setPopupBounds({
      x: Math.round(from.x + dx * eased),
      y: Math.round(from.y + dy * eased),
      width: Math.round(from.width + dw * eased),
      height: Math.round(from.height + dh * eased)
    })

    if (t < 1) {
      setTimeout(step, 16)
    } else {
      autoPositioning = false
    }
  }

  setTimeout(step, 16)
}

/**
 * 最终钉住状态：用户图钉 或 设置选择了"一直钉住常开"。
 * 两种情况下弹窗都不会自动隐藏，且新划词会原地更新内容、保持钉住。
 */
function isEffectivelyPinned(): boolean {
  return userPinned || getSettings().popupMode === 'pinned'
}

/** 真实 highlight 到达时重新提升 z-order，但不激活窗口、不抢走当前输入焦点。 */
function raisePopupWindow(): void {
  if (!win || win.isDestroyed()) {
    return
  }

  win.setAlwaysOnTop(true, 'floating')
  win.moveTop()
}

/** 懒创建单例弹窗窗口（透明、无边框、置顶、不抢焦点）。 */
export function popupWindow(): BrowserWindow {
  if (win && !win.isDestroyed()) {
    return win
  }

  win = new BrowserWindow({
    width: POPUP_SIZE.defaultW,
    height: POPUP_SIZE.defaultH,
    show: false,
    frame: false,
    transparent: true,
    focusable: true,
    backgroundColor: '#00000000',
    backgroundMaterial: 'none',
    // 禁用 Windows 无边框窗口的原生边缘命中；否则靠近顶部的 Header
    // 会在 renderer 收到 pointerdown 前被系统误判为 resize。
    resizable: false,
    minWidth: POPUP_SIZE.minW,
    minHeight: POPUP_SIZE.minH,
    maxWidth: POPUP_SIZE.maxW,
    maxHeight: POPUP_SIZE.maxH,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    icon: appIconPath(),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  syncNativePopupMaterial(getSettings().glassBlur)

  win.once('ready-to-show', () => {
    if (!win || win.isDestroyed()) {
      return
    }

    syncNativePopupMaterial(getSettings().glassBlur)
  })

  win.setMenu(null)

  // 用户拖动弹窗（渲染层头部为拖动区）：记住位置，
  // 本次显示期间的新划词都保持在用户放置的位置
  win.on('moved', () => {
    if (autoPositioning || dragSession || !win || win.isDestroyed()) {
      return
    }

    const bounds = win.getBounds()
    userDragged = true
    userPos = { x: bounds.x, y: bounds.y }
  })

  // 仅专用右下角把手会从主进程调用 setBounds。尺寸稳定后再持久化，避免高频写设置。
  win.on('resize', () => {
    if (!win || win.isDestroyed()) {
      return
    }

    // Header drag 的整个生命周期内宽高被冻结。即使 Windows/DPI 合成层
    // 意外发出 resize，也在 renderer 绘制下一帧前恢复，不让内容参与重排。
    if (dragSession) {
      const current = win.getBounds()
      if (current.width !== dragSession.bounds.width || current.height !== dragSession.bounds.height) {
        autoPositioning = true
        win.setBounds({
          x: current.x,
          y: current.y,
          width: dragSession.bounds.width,
          height: dragSession.bounds.height
        })
        autoPositioning = false
      }
      return
    }

    if (settingsPanelBaseBounds || autoPositioning) {
      return
    }

    if (resizePersistTimer) {
      clearTimeout(resizePersistTimer)
    }

    resizePersistTimer = setTimeout(() => {
      resizePersistTimer = null
      if (!win || win.isDestroyed() || settingsPanelBaseBounds) {
        return
      }

      const bounds = win.getBounds()
      const size = clampPopupSize(bounds.width - MARGIN * 2, bounds.height - MARGIN * 2)
      setSettings({ popupWidth: size.width, popupHeight: size.height })
    }, 180)
  })

  // 弹窗隐藏后清除拖拽记忆：下次显示重新跟随划词锚点
  win.on('hide', () => {
    setSettingsPanelOpen(false)
    dragSession = null
    resizeSession = null
    win?.webContents.send('popup:settings-panel', false)
    userDragged = false
    stopSpeaking()
    hideAnimationTimer = null
    closing = false
  })

  win.on('closed', () => {
    settingsPanelBaseBounds = null
    dragSession = null
    resizeSession = null
    if (resizePersistTimer) {
      clearTimeout(resizePersistTimer)
      resizePersistTimer = null
    }
    unsubscribeTts?.()
    unsubscribeTts = null
    win = null
  })

  if (process.env['VITE_DEV_SERVER_URL']) {
    void win.loadURL(`${process.env['VITE_DEV_SERVER_URL']}popup.html`)
  } else {
    void win.loadFile(path.join(__dirname, '../renderer/popup.html'))
  }

  // 点击 popup 外部时只收起内嵌 Appearance；独立 Settings 与新划词都不再强制关闭它。
  win.on('blur', () => {
    if (settingsPanelBaseBounds) {
      setSettingsPanelOpen(false)
      win?.webContents.send('popup:settings-panel', false)
    }
    scheduleHide(800)
  })

  registerIpc()
  unsubscribeTts = onTtsState((state) => {
    if (win && !win.isDestroyed()) {
      win.webContents.send('popup:tts-state', state)
    }
  })
  return win
}

export function popupIsVisible(): boolean {
  return !!win && !win.isDestroyed() && win.isVisible()
}

/**
 * 用户图钉开关（弹窗工具栏按钮）。
 * userPinned 会跨多次划词保持：钉住 -> 新划词继续更新且保持钉住；
 * 取消图钉后下一次划词回到"普通显示"（可再钉）。
 * 设置 popupMode = 'pinned' 时即使取消图钉，模式本身仍会钉住弹窗。
 */
export function popupSetPinned(value: boolean): void {
  userPinned = value

  if (current && win && !win.isDestroyed()) {
    // 反馈最终状态：popupMode=pinned 时即使用户关闭图钉，实际仍然是 pinned。
    win.webContents.send('popup:data', buildPayload(current))
  }

  if (!isEffectivelyPinned()) {
    // 彻底没有钉住条件了：短暂延时后隐藏
    scheduleHide(300)
  } else {
    cancelHide()
  }
}

export function popupHideNow(): void {
  cancelHide()

  if (win && !win.isDestroyed()) {
    win.hide()
  }
}

/** 组装下发给渲染层的数据（含全部外观设置）。 */
function buildPayload(data: PopupData): PopupData {
  const settings = getSettings()

  return {
    ...data,
    pinned: isEffectivelyPinned(),
    appearance: {
      uiLanguage: settings.uiLanguage,
      glassOpacity: Math.max(POPUP_FROSTED_MIN_OPACITY, settings.glassOpacity),
      glassBlur: getSettings().glassBlur,
      showOriginal: settings.showOriginal,
      popupWidth: payloadCardSize().width,
      popupHeight: payloadCardSize().height,
      englishFontFamily: settings.englishFontFamily,
      chineseFontFamily: settings.chineseFontFamily,
      englishFontSize: settings.englishFontSize,
      chineseFontSize: settings.chineseFontSize,
      originalTextColor: settings.originalTextColor,
      translationTextColor: settings.translationTextColor,
      // popup 背景固定为 Liquid Glass 原色；Theme 只负责字体。
      glassColor: '#ffffff',
      popupBackground: null
    }
  }
}

/** 展示一次选区流程（loading / result / error 均走这里）。 */
export function showPopup(
  data: PopupData,
  mousePoint?: { x: number; y: number },
  mousePointIsDip = false
): void {
  const w = popupWindow()

  current = data

  // 真实数据到达时取消未决的预览关闭
  if (data.id !== -1 && previewTimer) {
    clearTimeout(previewTimer)
    previewTimer = null
  }

  if (mousePoint) {
    // Helper 上报的是物理屏幕像素；Electron 窗口坐标是 DIP，需要换算。
    // 主进程自己构造的锚点（如等待弹窗）已是 DIP，直接使用。
    anchor = mousePointIsDip ? mousePoint : screen.screenToDipPoint({ x: mousePoint.x, y: mousePoint.y })
  }

  w.webContents.send('popup:data', buildPayload(data))
  positionAndShow()

  // 结果/错误到达时鼠标已不在弹窗上 -> 重新计时自动隐藏；
  // loading 期间绝不隐藏（否则翻译还没回来弹窗就消失了）；
  // 钉住状态（用户图钉或"常开"模式）下不隐藏
  if (data.status !== 'loading' && !mouseInside && !isEffectivelyPinned()) {
    scheduleHide(getSettings().autoHideDelay || 500)
  }
}

/** 弹窗可见时用最新设置刷新外观/尺寸（设置窗口改参数即时生效）。 */
export function popupRefreshAppearance(): void {
  if (!win || win.isDestroyed()) {
    return
  }

  syncNativePopupMaterial()

  if (!win.isVisible() || !current) {
    return
  }

  win.webContents.send('popup:data', buildPayload(current))
  positionAndShow()
}

/** 设置窗口拖动滑杆时只预览，不提前写入 SQLite。 */
export function popupPreviewAppearance(patch: Partial<PopupAppearance>): void {
  if (!win || win.isDestroyed() || !win.isVisible() || !current) {
    return
  }

  const payload = buildPayload(current)
  payload.appearance = { ...payload.appearance!, ...patch }
  win.webContents.send('popup:data', payload)
}

/**
 * 定位并显示（原计划 Phase 14）。
 * 优先级：下方 -> 上方 -> 右侧 -> 左侧，始终夹紧在所在显示器工作区内。
 * 通过 screen.screenToDipPoint / getDisplayNearestPoint 支持多显示器与
 * 100%/125%/150% DPI 缩放。
 */
function positionAndShow(): void {
  if (!win || win.isDestroyed()) {
    return
  }

  // 内嵌设置面板打开时，翻译卡片的原始边界是 SSOT；新的翻译结果或外观刷新
  // 不能把临时展开高度折回去。关闭面板时再由 setSettingsPanelOpen(false) 精确恢复。
  if (settingsPanelBaseBounds) {
    return
  }

  const { width: cardW, height: cardH } = cardSize()
  const winW = cardW + MARGIN * 2
  const winH = cardH + MARGIN * 2

  // 用户拖动过后保持其放置的位置；否则按锚点智能定位
  if (userDragged) {
    autoPositioning = true
    setPopupBounds({ x: userPos.x, y: userPos.y, width: winW, height: winH })
    autoPositioning = false
    showPopupWindow()
    cancelHide()
    return
  }

  const workArea = screen.getDisplayNearestPoint(anchor).workArea
  const candidates = [
    // 计划优先级：下方 -> 上方 -> 右侧 -> 左侧。
    { x: anchor.x - winW / 2, y: anchor.y + 18 },
    { x: anchor.x - winW / 2, y: anchor.y - 18 - winH },
    { x: anchor.x + 18, y: anchor.y - winH / 2 },
    { x: anchor.x - 18 - winW, y: anchor.y - winH / 2 }
  ]

  const fits = (candidate: { x: number; y: number }): boolean =>
    candidate.x >= workArea.x + SCREEN_GAP &&
    candidate.y >= workArea.y + SCREEN_GAP &&
    candidate.x + winW <= workArea.x + workArea.width - SCREEN_GAP &&
    candidate.y + winH <= workArea.y + workArea.height - SCREEN_GAP

  const selected = candidates.find(fits) ?? candidates[0]
  const maxX = workArea.x + workArea.width - winW - SCREEN_GAP
  const maxY = workArea.y + workArea.height - winH - SCREEN_GAP
  const x = Math.max(workArea.x + SCREEN_GAP, Math.min(Math.round(selected.x), maxX))
  const y = Math.max(workArea.y + SCREEN_GAP, Math.min(Math.round(selected.y), maxY))

  autoPositioning = true

  if (win.isVisible()) {
    // 弹窗已显示：滑行到新锚点（liquid glass 的流动感）
    animateWindowTo(x, y, winW, winH)
  } else {
    // 首次显示：直接就位（入场由 CSS popup-in 负责）
    cancelMoveAnim()
    setPopupBounds({ x: x, y: y, width: winW, height: winH })
    autoPositioning = false
  }

  showPopupWindow()
}

function showPopupWindow(): void {
  if (!win || win.isDestroyed()) {
    return
  }

  if (win.isVisible()) {
    win.showInactive()
    if (current?.id && current.id > 0) {
      raisePopupWindow()
    }
    cancelHide()
    return
  }

  win.showInactive()
  if (current?.id && current.id > 0) {
    raisePopupWindow()
  }
  cancelHide()
}

/** 延时自动隐藏；钉住、鼠标悬停、加载中可阻止。 */
function scheduleHide(delayMs: number): void {
  cancelHide()

  hideTimer = setTimeout(() => {
    hideTimer = null

    if (
      !isEffectivelyPinned() &&
      !mouseInside &&
      current?.status !== 'loading' &&
      win &&
      !win.isDestroyed() &&
      win.isVisible()
    ) {
      closing = true
      win.webContents.send('popup:visibility', 'closing' satisfies PopupVisibilityState)
      hideAnimationTimer = setTimeout(() => {
        hideAnimationTimer = null

        if (
          closing &&
          !isEffectivelyPinned() &&
          !mouseInside &&
          current?.status !== 'loading' &&
          win &&
          !win.isDestroyed()
        ) {
          win.hide()
        }
      }, HIDE_ANIM_MS)
    }
  }, delayMs)
}

function cancelHide(): void {
  if (hideTimer) {
    clearTimeout(hideTimer)
    hideTimer = null
  }

  if (hideAnimationTimer) {
    clearTimeout(hideAnimationTimer)
    hideAnimationTimer = null
  }

  if (closing) {
    closing = false
    if (win && !win.isDestroyed()) {
      win.webContents.send('popup:visibility', 'visible' satisfies PopupVisibilityState)
    }
  }
}

export function popupMouseEnter(): void {
  mouseInside = true
  cancelHide()
}

export function popupMouseLeave(): void {
  mouseInside = false
  scheduleHide(getSettings().autoHideDelay || 500)
}

export function popupCurrentData(): PopupData | null {
  return current
}

/** 预览用的演示数据（与真实划词数据结构一致）。 */
const previewData: PopupData = {
  id: -1,
  status: 'result',
  originalText: 'Operating systems manage computer resources.',
  translatedText: '操作系统管理计算机资源。',
  detectedLanguage: 'en',
  targetLanguage: 'zh',
  processName: 'preview'
}

let previewTimer: NodeJS.Timeout | null = null

/**
 * 预览弹窗：显示 1.5 秒后自动关闭。
 * 不受钉住/常开模式影响；期间来了真实划词会立即覆盖并取消关闭。
 */
export function showPreviewPopup(): void {
  const workArea = screen.getPrimaryDisplay().workArea

  showPopup(previewData, { x: workArea.x + Math.round(workArea.width / 2), y: workArea.y + 60 }, true)

  if (previewTimer) {
    clearTimeout(previewTimer)
  }

  previewTimer = setTimeout(() => {
    previewTimer = null

    // 预览期间没有被真实划词覆盖时才关闭
    if (current?.id === -1 && win && !win.isDestroyed()) {
      win.hide()
    }
  }, 1500)
}

/** 弹窗自身的 IPC 通道（鼠标驻留、按钮动作）。 */
function registerIpc(): void {
  if (ipcRegistered) {
    return
  }

  ipcRegistered = true

  ipcMain.on('popup:mouse-enter', () => popupMouseEnter())
  ipcMain.on('popup:mouse-leave', () => popupMouseLeave())

  // 自定义路径只移动圆角窗口，用来避开 Windows 原生方形 drag outline。
  // 每帧都携带起点固定 width/height，移动路径没有尺寸自由度。
  ipcMain.on('popup:drag-start', (_event, pointerX: number, pointerY: number) => {
    cancelMoveAnim()

    if (
      win &&
      !win.isDestroyed() &&
      !resizeSession &&
      Number.isFinite(pointerX) &&
      Number.isFinite(pointerY)
    ) {
      dragSession = { pointerX, pointerY, bounds: win.getBounds() }
    }
  })

  ipcMain.on('popup:drag-move', (_event, pointerX: number, pointerY: number) => {
    if (
      !win ||
      win.isDestroyed() ||
      !dragSession ||
      !Number.isFinite(pointerX) ||
      !Number.isFinite(pointerY)
    ) {
      return
    }

    const start = dragSession
    const x = start.bounds.x + Math.round(pointerX - start.pointerX)
    const y = start.bounds.y + Math.round(pointerY - start.pointerY)
    // 不走 setPosition：透明 shaped window 在部分 Windows DPI 组合下会重算
    // 非客户区。每帧原子写入固定宽高，移动期间没有尺寸自由度。
    win.setBounds({
      x,
      y,
      width: start.bounds.width,
      height: start.bounds.height
    })
  })

  ipcMain.on('popup:drag-end', () => {
    const session = dragSession
    dragSession = null

    if (!session || !win || win.isDestroyed()) {
      return
    }

    const bounds = win.getBounds()

    // 防御性校正：移动结束后的尺寸必须与开始时完全一致。
    if (bounds.width !== session.bounds.width || bounds.height !== session.bounds.height) {
      win.setBounds({
        x: bounds.x,
        y: bounds.y,
        width: session.bounds.width,
        height: session.bounds.height
      })
    }

    userDragged = true
    userPos = { x: bounds.x, y: bounds.y }
  })

  // Windows 原生 resize 永久关闭；只有右下角专用把手能进入此路径。
  // 宽高始终基于按下时的固定边界计算，避免增量累加造成窗口越来越大。
  ipcMain.on('popup:resize-start', (_event, pointerX: number, pointerY: number) => {
    if (
      win &&
      !win.isDestroyed() &&
      !dragSession &&
      !settingsPanelBaseBounds &&
      Number.isFinite(pointerX) &&
      Number.isFinite(pointerY)
    ) {
      resizeSession = { pointerX, pointerY, bounds: win.getBounds() }
    }
  })

  ipcMain.on('popup:resize-move', (_event, pointerX: number, pointerY: number) => {
    if (
      !win ||
      win.isDestroyed() ||
      !resizeSession ||
      !Number.isFinite(pointerX) ||
      !Number.isFinite(pointerY)
    ) {
      return
    }

    const start = resizeSession
    const size = clampPopupSize(
      start.bounds.width + Math.round(pointerX - start.pointerX),
      start.bounds.height + Math.round(pointerY - start.pointerY)
    )
    win.setBounds({
      x: start.bounds.x,
      y: start.bounds.y,
      width: size.width,
      height: size.height
    })
  })

  ipcMain.on('popup:resize-end', () => {
    resizeSession = null
  })

  ipcMain.on('popup:set-settings-open', (_event, open: boolean) => {
    if (typeof open === 'boolean') {
      setSettingsPanelOpen(open)
    }
  })

  ipcMain.on('popup:set-pinned', (_event, value: boolean) => {
    if (typeof value === 'boolean') {
      popupSetPinned(value)
    }
  })

  ipcMain.on('popup:speak', (_event, payload: unknown) => {
    if (!payload || typeof payload !== 'object') {
      return
    }

    const data = payload as { text?: unknown; language?: unknown }

    if (
      typeof data.text !== 'string' ||
      data.text.trim().length === 0 ||
      data.text.length > 20_000 ||
      (data.language !== 'en' && data.language !== 'zh')
    ) {
      return
    }

    speakText(data.text, data.language)
  })

  ipcMain.on('popup:stop-speaking', () => stopSpeaking())

  ipcMain.on('popup:close', () => {
    stopSpeaking()
    popupHideNow()
  })

  ipcMain.handle('popup:get-data', () => current ? buildPayload(current) : null)

  ipcMain.on('popup:copy', (_event, text: string) => {
    if (typeof text === 'string' && text) {
      clipboard.writeText(text)
    }
  })
}
