import { Menu, Tray, app, nativeImage } from 'electron'
import path from 'node:path'
import { openSettings } from './windows/settingsWindow'
import { showPreviewPopup } from './windows/popupWindow'
import { getSettings, setSettings } from './storage/settingsStore'
import { uiText } from '@shared/i18n'

let tray: Tray | null = null

/** 创建系统托盘图标与菜单（原计划 Phase 14/18）。 */
export function createTray(quitApp: () => void): void {
  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath!, 'icons', 'tray.png')
    : path.join(app.getAppPath(), 'resources', 'icons', 'tray.png')

  const icon = nativeImage.createFromPath(iconPath)

  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon)
  tray.setToolTip(uiText(getSettings().uiLanguage, 'appName'))
  tray.on('click', () => openSettings())
  rebuildTrayMenu(quitApp)
}

/** 重建托盘菜单（设置变化后调用以同步勾选状态）。 */
export function rebuildTrayMenu(quitApp: () => void): void {
  if (!tray) {
    return
  }

  const settings = getSettings()
  tray.setToolTip(uiText(settings.uiLanguage, 'appName'))

  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: uiText(settings.uiLanguage, 'traySettings'), click: () => openSettings() },
      {
        // 让用户不用划词也能看到弹窗长什么样（可发现性）；1.5 秒后自动关闭
        label: uiText(settings.uiLanguage, 'trayPreview'),
        click: () => showPreviewPopup()
      },
      { type: 'separator' },
      {
        label: uiText(settings.uiLanguage, 'trayAutoTranslate'),
        type: 'checkbox',
        checked: settings.autoTranslate,
        click: (item) => setSettings({ autoTranslate: item.checked })
      },
      {
        label: uiText(settings.uiLanguage, 'trayStartup'),
        type: 'checkbox',
        checked: settings.launchAtStartup,
        click: (item) => setSettings({ launchAtStartup: item.checked })
      },
      { type: 'separator' },
      { label: uiText(settings.uiLanguage, 'trayQuit'), click: () => quitApp() }
    ])
  )
}
