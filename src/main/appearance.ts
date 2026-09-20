import { app, dialog, ipcMain, net, protocol } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { log } from './logger'
import type { BackgroundPurpose } from '@shared/types'

/**
 * 个性化外观支持：
 *  - 用户可通过文件对话框更换弹窗 / 设置窗口的背景照片
 *  - 图片复制进 userData/backgrounds，经自定义 htimg:// 协议提供给渲染层
 *    （sandbox 渲染层无法直接读取任意磁盘文件）
 */

const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif']

/** 背景图存储目录（userData/backgrounds）。 */
function backgroundsDir(): string {
  const dir = path.join(app.getPath('userData'), 'backgrounds')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

/** 某用途当前的自定义背景文件名（无自定义则 null）。 */
export function backgroundFile(purpose: BackgroundPurpose): string | null {
  const dir = backgroundsDir()

  for (const ext of IMAGE_EXTENSIONS) {
    const name = `${purpose}.${ext}`
    if (fs.existsSync(path.join(dir, name))) {
      return name
    }
  }

  return null
}

function contentTypeFor(name: string): string {
  const ext = path.extname(name).toLowerCase()
  const map: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp',
    '.gif': 'image/gif'
  }
  return map[ext] ?? 'application/octet-stream'
}

/** 注册 htimg:// 协议（必须在 app ready 之前调用）。 */
export function registerImageProtocolScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'htimg',
      privileges: { standard: true, secure: true, supportFetchAPI: true }
    }
  ])
}

/** app ready 后注册协议处理器：htimg://bg/<文件名> -> userData/backgrounds/<文件名>。 */
export function registerImageProtocolHandler(): void {
  protocol.handle('htimg', (request) => {
    const url = new URL(request.url)

    // 仅接受 htimg://bg/<单个文件名>，防路径穿越
    if (url.host !== 'bg') {
      return new Response('not found', { status: 404 })
    }

    const name = path.basename(decodeURIComponent(url.pathname))
    const file = path.join(backgroundsDir(), name)

    if (!fs.existsSync(file)) {
      return new Response('not found', { status: 404 })
    }

    return net.fetch(path.posix.join('file:///', encodeURI(file.replace(/\\/g, '/'))))
  })
}

/** 选择并安装背景图：复制为 <purpose>.<ext>，返回文件名（取消则 null）。 */
async function pickBackgroundImage(purpose: BackgroundPurpose): Promise<string | null> {
  const result = await dialog.showOpenDialog({
    title: purpose === 'popup' ? 'Choose popup background image' : 'Choose settings background image',
    filters: [{ name: 'Images', extensions: IMAGE_EXTENSIONS }],
    properties: ['openFile']
  })

  if (result.canceled || result.filePaths.length === 0) {
    return null
  }

  const source = result.filePaths[0]
  const ext = path.extname(source).toLowerCase()
  const targetName = `${purpose}${ext}`
  const target = path.join(backgroundsDir(), targetName)

  // 清掉旧的不同扩展名的同名背景，保证 backgroundFile() 只看到一个
  for (const other of IMAGE_EXTENSIONS) {
    const stale = path.join(backgroundsDir(), `${purpose}.${other}`)
    if (stale !== target && fs.existsSync(stale)) {
      fs.rmSync(stale)
    }
  }

  fs.copyFileSync(source, target)
  log(`background image installed: ${purpose} -> ${targetName}`)
  return targetName
}

/** 移除自定义背景。 */
function resetBackgroundImage(purpose: BackgroundPurpose): void {
  for (const ext of IMAGE_EXTENSIONS) {
    const file = path.join(backgroundsDir(), `${purpose}.${ext}`)
    if (fs.existsSync(file)) {
      fs.rmSync(file)
    }
  }
}

export function registerAppearanceIpc(): void {
  ipcMain.handle('appearance:pick-image', async (_event, purpose: string) => {
    if (purpose !== 'popup' && purpose !== 'settings') {
      throw new Error(`unknown purpose: ${purpose}`)
    }

    return pickBackgroundImage(purpose)
  })

  ipcMain.handle('appearance:reset-image', (_event, purpose: string) => {
    if (purpose !== 'popup' && purpose !== 'settings') {
      throw new Error(`unknown purpose: ${purpose}`)
    }

    resetBackgroundImage(purpose)
  })
}

/** 生成 htimg URL；无自定义背景时返回 null（渲染层用默认极光/背景）。 */
export function backgroundImageUrl(settingsValue: string): string | null {
  if (!settingsValue || settingsValue === 'default') {
    return null
  }

  return `htimg://bg/${settingsValue}`
}
