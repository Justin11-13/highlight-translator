/**
 * 截图工具：在 Electron 中加载构建产物的弹窗（各演示状态）与设置页，
 * 截取 PNG 供视觉检查。
 * 用法: npx electron scripts/capture.mjs
 * （可选）HT_OPAQUE=1 用不透明窗口截图，排查透明合成问题。
 */
import { app, BrowserWindow } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const outDir = path.resolve(process.cwd(), 'shots')
const rendererDir = path.resolve(process.cwd(), 'out', 'renderer')

const shots = [
  { name: 'popup-result', file: 'popup.html', query: 'demo=result&bg=1', width: 568, height: 348 },
  { name: 'popup-settings', file: 'popup.html', query: 'demo=result&bg=1&panel=1', width: 568, height: 740 },
  { name: 'popup-loading', file: 'popup.html', query: 'demo=loading&bg=1', width: 568, height: 348 },
  { name: 'popup-error', file: 'popup.html', query: 'demo=error&bg=1', width: 568, height: 348 },
  { name: 'settings', file: 'settings.html', query: '', width: 920, height: 640 },
  { name: 'settings-appearance', file: 'settings.html', query: 'tab=appearance', width: 920, height: 640 },
  { name: 'settings-appearance-popup', file: 'settings.html', query: 'tab=appearance&scope=popup', width: 920, height: 640 }
]

async function capture() {
  fs.mkdirSync(outDir, { recursive: true })

  // 复用同一个窗口逐张截图（多次创建透明窗口在部分环境不稳定）
  const win = new BrowserWindow({
    width: 448,
    height: 320,
    show: false,
    frame: false,
    transparent: process.env.HT_OPAQUE !== '1',
    backgroundMaterial: 'none',
    resizable: false,
    webPreferences: { backgroundThrottling: false }
  })

  for (const [shotIndex, shot] of shots.entries()) {
    win.setBounds({ width: shot.width, height: shot.height })
    // 与正式 popup 一致：只绘制 renderer Liquid Glass，不叠加方形原生材质层。
    win.setBackgroundMaterial('none')

    const url = pathToFileURL(path.join(rendererDir, shot.file))
    url.search = shot.query

    win.webContents.on('console-message', (_e, level, message) => {
      console.log(`[console:${level}] ${message}`)
    })

    await win.loadURL(url.href)

    // 隐藏窗口中 CSS 动画不会推进：截图前禁用动画，保证拍到最终状态
    await win.webContents.insertCSS(
      '*, *::before, *::after { animation: none !important; transition: none !important; }'
    )

    // 首次加载给 feImage data URL 留出解码时间，确保玻璃滤镜完整合成
    await new Promise(resolve => setTimeout(resolve, shotIndex === 0 ? 2200 : 900))

    const probe = await win.webContents.executeJavaScript(
      `(() => {
        const card = document.querySelector('.liquid-glass-card') || document.querySelector('.settings-panel')
        const panel = document.querySelector('.settings-panel')
        const backdrop = document.querySelector('.glass-backdrop-img')
        const rect = card ? card.getBoundingClientRect() : null
        const panelRect = panel ? panel.getBoundingClientRect() : null
        return JSON.stringify({
          card: !!card,
          rect: rect ? { x: rect.x, y: rect.y, w: rect.width, h: rect.height } : null,
          panelRect: panelRect ? { x: panelRect.x, y: panelRect.y, w: panelRect.width, h: panelRect.height } : null,
          panelClientHeight: panel?.clientHeight ?? null,
          panelScrollHeight: panel?.scrollHeight ?? null,
          screen: window.screenX + ',' + window.screenY,
          dpr: window.devicePixelRatio,
          inner: window.innerWidth + 'x' + window.innerHeight,
          varW: getComputedStyle(document.documentElement).getPropertyValue('--ht-card-w'),
          backdropFilter: card ? getComputedStyle(card).backdropFilter : null,
          imageFilter: backdrop ? getComputedStyle(backdrop).filter : null,
          children: document.body.children.length,
          selector: card?.className ?? null
        })
      })()`
    )
    console.log('[probe]', shot.name, probe)

    const image = await win.webContents.capturePage()
    fs.writeFileSync(path.join(outDir, `${shot.name}.png`), image.toPNG())
    console.log('captured', shot.name)
  }

  win.destroy()
}

app.whenReady().then(async () => {
  try {
    await capture()
  } catch (error) {
    console.error(error)
    app.exitCode = 1
  } finally {
    app.exit(app.exitCode ?? 0)
  }
})
