import { app, ipcMain } from 'electron'
import path from 'node:path'
import { initLogger, log } from './logger'
import { openDb } from './storage/db'
import { getSettings, loadSettings, setSettings, isFirstRun } from './storage/settingsStore'
import { listHistory, deleteHistory, clearHistory } from './storage/historyStore'
import { startHelper, stopHelper } from './native/helperManager'
import { handleSelection, translateAnyway, translateInput } from './selection/selectionManager'
import { modelStatus, downloadModel } from './translation/translationManager'
import { ensureService, isServiceInstalled, setupTranslationService, stopService } from './translation/serviceManager'
import { showPopup, popupCurrentData, popupSetPinned, popupHideNow, showPreviewPopup, popupPreviewAppearance, popupRefreshAppearance } from './windows/popupWindow'
import { openSettings, broadcastToSettings, refreshSettingsAppearance } from './windows/settingsWindow'
import { createTray, rebuildTrayMenu } from './tray'
import { screen } from 'electron'
import { uiText } from '@shared/i18n'
import {
  registerImageProtocolScheme,
  registerImageProtocolHandler,
  registerAppearanceIpc
} from './appearance'

const TEST_MODE = process.env.HT_TEST_MODE === '1'

if (!app.requestSingleInstanceLock()) {
  // 已有实例在运行：第二个实例直接退出，由已有实例响应 second-instance
  app.quit()
} else {
  app.on('second-instance', () => openSettings())

  // 统一 dev 与打包版的 userData 路径，SQLite/日志/设置在打包后依然有效
  app.setPath('userData', path.join(app.getPath('appData'), 'highlight-translator'))

  // 自定义图片协议必须在 ready 之前登记
  registerImageProtocolScheme()

  app.whenReady().then(onReady)

  app.on('window-all-closed', () => {
    // 托盘常驻应用：窗口全部关闭也不退出，只有托盘 Quit 才结束
  })

  app.on('before-quit', () => {
    stopHelper()
    stopService()
  })
}

async function onReady(): Promise<void> {
  initLogger()
  openDb()
  loadSettings()

  registerImageProtocolHandler()
  log(`app ready (packaged=${app.isPackaged}, testMode=${TEST_MODE})`)

  registerIpc()

  if (!TEST_MODE) {
    createTray(quitApp)
    // 全局划词检测（Phase 4/7）
    startHelper(handleSelection)
    // 后台预热本地翻译服务；失败不阻塞，首次翻译时会重试
    void ensureService().then((ok) => {
      if (!ok) {
        log('translation service unavailable at startup; will retry on first translation')
      }
    })

    // 默认语言对模型预热（首次运行联网下载，之后完全离线）。
    // 两个方向都准备好，避免中文选区在英文模型完成后仍然报模型缺失。
    if (isServiceInstalled()) {
      void (async () => {
        for (const key of ['en-zh', 'zh-en'] as const) {
          if (getSettings().modelsInstalled[key]) {
            continue
          }

          try {
            // 共享 venv 内的 Argos 包安装必须串行，避免两个 pip 进程同时写入。
            await downloadModel(key)
          } catch (error) {
            log(`model warmup ${key} failed:`, error as Error)
          }
        }
      })()
    }

  }

  // 首次运行或未设置静默启动时，打开设置窗口引导用户
  if (!getSettings().startMinimized || isFirstRun() || TEST_MODE) {
    openSettings()
  }
}

function quitApp(): void {
  stopHelper()
  stopService()
  app.quit()
}

/** "一直钉住常开"模式的等待弹窗：显示在主屏顶部中间（DIP 坐标）。 */
function showWaitingPopup(): void {
  const workArea = screen.getPrimaryDisplay().workArea
  const language = getSettings().uiLanguage

  showPopup(
    {
      id: 0,
      status: 'result',
      originalText: uiText(language, 'waiting'),
      translatedText: uiText(language, 'runningHint'),
      detectedLanguage: 'en',
      targetLanguage: 'zh',
      processName: 'translator',
      pinned: true
    },
    { x: workArea.x + Math.round(workArea.width / 2), y: workArea.y + 60 },
    true
  )
}

function registerIpc(): void {
  ipcMain.handle('settings:get', () => getSettings())

  ipcMain.on('settings:preview-appearance', (_event, patch: unknown) => {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
      return
    }

    const source = patch as Record<string, unknown>
    const preview: Record<string, unknown> = {}
    const appearanceKeys = [
      'glassOpacity', 'glassBlur', 'showOriginal', 'popupWidth', 'popupHeight',
      'englishFontFamily', 'chineseFontFamily', 'englishFontSize', 'chineseFontSize',
      'originalTextColor', 'translationTextColor', 'uiLanguage'
    ]

    for (const key of appearanceKeys) {
      if (key in source) {
        preview[key] = source[key]
      }
    }

    popupPreviewAppearance(preview)
  })

  ipcMain.handle('settings:set', (_event, patch: unknown) => {
    const safePatch = patch && typeof patch === 'object' && !Array.isArray(patch)
      ? patch as Record<string, unknown>
      : {}
    const next = setSettings(safePatch)
    rebuildTrayMenu(quitApp) // 菜单里的复选项与设置保持同步

    // 弹窗显示模式切换即时生效：
    // pinned -> 立即显示等待中的常驻弹窗；on-selection -> 立即收起
    if (safePatch['popupMode'] === 'pinned') {
      showWaitingPopup()
    } else if (safePatch['popupMode'] === 'on-selection') {
      popupSetPinned(false)
      popupHideNow()
    }

    // 外观/尺寸变化：弹窗可见时即时刷新（无需等下一次划词）
    const appearanceKeys = [
      'popupWidth', 'popupHeight', 'showOriginal', 'glassOpacity', 'glassBlur',
      'englishFontFamily', 'chineseFontFamily', 'englishFontSize', 'chineseFontSize',
      'originalTextColor', 'translationTextColor', 'glassColor', 'popupBackground', 'uiLanguage'
    ]
    if (appearanceKeys.some(key => key in safePatch)) {
      popupRefreshAppearance()
    }

    if (['mainGlassBlur'].some(key => key in safePatch)) {
      refreshSettingsAppearance()
    }

    return next
  })

  ipcMain.handle('history:list', () => listHistory())
  ipcMain.handle('history:delete', (_event, id: number) => {
    deleteHistory(Number(id))
  })
  ipcMain.handle('history:clear', () => clearHistory())

  // 个性化外观：背景图选择/重置
  registerAppearanceIpc()

  ipcMain.handle('models:status', () => modelStatus())
  ipcMain.handle('models:setup', async () => {
    await setupTranslationService()
    setSettings({ modelsInstalled: { 'en-zh': true, 'zh-en': true } })
    broadcastToSettings('models:changed', modelStatus())
    return modelStatus()
  })
  ipcMain.handle('models:download', async (_event, key: string) => {
    if (key !== 'en-zh' && key !== 'zh-en') {
      throw new Error(`unknown model key: ${key}`)
    }
    try {
      await downloadModel(key)
      broadcastToSettings('models:changed', modelStatus())
      return modelStatus()
    } catch (error) {
      log(`model download ${key} failed:`, error as Error)
      throw error
    }
  })

  ipcMain.handle('service:status', async () => {
    return {
      installed: isServiceInstalled(),
      running: await ensureService().catch(() => false)
    }
  })

  ipcMain.on('popup:translate-anyway', (_event, id: number) => {
    const data = popupCurrentData()
    if (data && data.id === id && data.originalText) {
      translateAnyway(data.id, data.retryText ?? data.originalText, data.processName ?? '')
    }
  })

  ipcMain.on('popup:translate-input', (_event, text: unknown) => {
    if (typeof text === 'string') {
      translateInput(text)
    }
  })

  // 设置页/托盘的预览：显示 1.5 秒后自动关闭
  ipcMain.on('app:open-popup-test', () => {
    showPreviewPopup()
  })

  ipcMain.on('app:quit', () => quitApp())

  ipcMain.on('app:open-settings', () => openSettings())
}
