import { BrowserWindow, ipcMain, screen, type Rectangle } from 'electron'
import path from 'node:path'
import { getSettings } from '../storage/settingsStore'
import { log } from '../logger'

/** 应用图标路径（与 popupWindow 一致：签名宿主的默认图标需要覆盖）。 */
function appIconPath(): string {
  return path.join(process.resourcesPath!, 'icons', 'app.ico')
}

let win: BrowserWindow | null = null
const SETTINGS_GAP = 18
let settingsIpcRegistered = false
let clampingBounds = false

function syncNativeSettingsMaterial(): void {
  if (process.platform !== 'win32' || !win || win.isDestroyed()) {
    return
  }

  try {
    win.setBackgroundMaterial('none')
    win.setBackgroundColor('#00000000')
  } catch (error) {
    log('native settings background material unavailable:', error as Error)
  }
}

function windowState(): { maximized: boolean; minimized: boolean } {
  return {
    maximized: Boolean(win && !win.isDestroyed() && win.isMaximized()),
    minimized: Boolean(win && !win.isDestroyed() && win.isMinimized())
  }
}

function broadcastWindowState(): void {
  if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) {
    win.webContents.send('settings:window-state', windowState())
  }
}

function isSettingsSender(event: { sender: Electron.WebContents }): boolean {
  return Boolean(win && !win.isDestroyed() && event.sender === win.webContents)
}

function clampWindowBounds(): void {
  if (!win || win.isDestroyed() || win.isMaximized() || win.isMinimized() || clampingBounds) {
    return
  }

  const current = win.getBounds()
  const next = fitSettingsBounds(current)
  const changed = current.x !== next.x || current.y !== next.y || current.width !== next.width || current.height !== next.height

  if (!changed) {
    return
  }

  clampingBounds = true
  win.setBounds(next)
  clampingBounds = false
}

function registerSettingsIpc(): void {
  if (settingsIpcRegistered) {
    return
  }

  settingsIpcRegistered = true

  ipcMain.on('settings:minimize', event => {
    if (isSettingsSender(event) && win && !win.isDestroyed()) {
      win.minimize()
    }
  })

  ipcMain.on('settings:toggle-maximize', event => {
    if (!isSettingsSender(event) || !win || win.isDestroyed()) {
      return
    }

    if (win.isMaximized()) {
      win.unmaximize()
    } else {
      win.maximize()
    }
  })

  ipcMain.handle('settings:window-state', event =>
    isSettingsSender(event) ? windowState() : { maximized: false, minimized: false }
  )
}

function fitSettingsBounds(bounds: Rectangle): Rectangle {
  const area = screen.getDisplayMatching(bounds).workArea
  const maxWidth = Math.max(1, area.width - SETTINGS_GAP * 2)
  const maxHeight = Math.max(1, area.height - SETTINGS_GAP * 2)
  const minWidth = Math.min(760, maxWidth)
  const minHeight = Math.min(540, maxHeight)
  const width = Math.min(Math.max(bounds.width, minWidth), maxWidth)
  const height = Math.min(Math.max(bounds.height, minHeight), maxHeight)
  const minX = area.x + SETTINGS_GAP
  const minY = area.y + SETTINGS_GAP
  const maxX = Math.max(minX, area.x + area.width - width - SETTINGS_GAP)
  const maxY = Math.max(minY, area.y + area.height - height - SETTINGS_GAP)

  return {
    x: Math.max(minX, Math.min(Math.round(bounds.x), maxX)),
    y: Math.max(minY, Math.min(Math.round(bounds.y), maxY)),
    width,
    height
  }
}

function initialSettingsBounds(): Rectangle {
  const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea
  return fitSettingsBounds({
    x: area.x + Math.round((area.width - 920) / 2),
    y: area.y + Math.round((area.height - 640) / 2),
    width: 920,
    height: 640
  })
}

/** 打开（或聚焦已有的）设置窗口。 */
export function openSettings(): void {
  if (win && !win.isDestroyed()) {
    if (win.isMinimized()) {
      win.restore()
    } else if (!win.isMaximized()) {
      clampWindowBounds()
    }
    win.show()
    win.focus()
    return
  }

  registerSettingsIpc()
  const bounds = initialSettingsBounds()

  win = new BrowserWindow({
    ...bounds,
    minWidth: Math.min(760, bounds.width),
    minHeight: Math.min(540, bounds.height),
    show: false,
    frame: false,
    transparent: true,
    resizable: true,
    minimizable: true,
    maximizable: true,
    backgroundColor: '#00000000',
    backgroundMaterial: 'none',
    title: 'Highlight Translator Settings',
    icon: appIconPath(),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  win.setMenu(null)
  win.once('ready-to-show', () => {
    if (!win || win.isDestroyed()) {
      return
    }

    clampWindowBounds()
    syncNativeSettingsMaterial()
    win.show()
    broadcastWindowState()
  })

  win.on('resize', () => {
    clampWindowBounds()
    broadcastWindowState()
  })
  win.on('move', () => {
    clampWindowBounds()
  })
  win.on('maximize', broadcastWindowState)
  win.on('unmaximize', broadcastWindowState)
  win.on('minimize', broadcastWindowState)
  win.on('restore', broadcastWindowState)

  if (process.env['VITE_DEV_SERVER_URL']) {
    void win.loadURL(`${process.env['VITE_DEV_SERVER_URL']}settings.html`)
  } else {
    void win.loadFile(path.join(__dirname, '../renderer/settings.html'))
  }

  win.on('closed', () => {
    win = null
  })
}

/** 主窗口外观设置变化时同步 Windows 原生背景材质。 */
export function refreshSettingsAppearance(): void {
  syncNativeSettingsMaterial()
}

/** 真实新选区到来时关闭独立设置窗口，避免它与翻译弹窗重叠。 */
export function closeSettings(): void {
  if (win && !win.isDestroyed()) {
    win.close()
  }
}

/** 向设置窗口广播消息（模型状态变化等）。 */
export function broadcastToSettings(channel: string, payload: unknown): void {
  if (win && !win.isDestroyed()) {
    win.webContents.send(channel, payload)
  }
}
