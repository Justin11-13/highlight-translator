/**
 * 图标与背景资源生成：从用户的原图产出
 *   build/icon-source.png   ->  build/icon.ico（256..16 多尺寸）
 *                               resources/icons/tray.png（32x32 托盘图标）
 *                               src/renderer/assets/background.jpg（q80 压缩）
 */
import { Jimp } from 'jimp'
import pngToIco from 'png-to-ico'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const sizes = [256, 128, 64, 48, 32, 16]

async function main() {
  const source = await Jimp.read(path.join(root, 'build', 'icon-source.png'))

  // 各尺寸 PNG，供 png-to-ico 打包成多分辨率 ico
  const pngBuffers = []

  for (const size of sizes) {
    const clone = source.clone().resize({ w: size, h: size })
    pngBuffers.push(await clone.getBuffer('image/png'))
  }

  const ico = await pngToIco(pngBuffers)
  fs.writeFileSync(path.join(root, 'build', 'icon.ico'), ico)

  // 托盘小图标
  const tray = source.clone().resize({ w: 32, h: 32 })
  fs.mkdirSync(path.join(root, 'resources', 'icons'), { recursive: true })
  fs.writeFileSync(path.join(root, 'resources', 'icons', 'tray.png'), await tray.getBuffer('image/png'))

  // 设置窗口背景：压到 1600px 宽的 JPEG，控制安装包体积
  const background = await Jimp.read(path.join(root, 'src', 'renderer', 'assets', 'background.png'))

  if (background.bitmap.width > 1600) {
    background.resize({ w: 1600 })
  }

  fs.writeFileSync(
    path.join(root, 'src', 'renderer', 'assets', 'background.jpg'),
    await background.getBuffer('image/jpeg', 80)
  )

  console.log('icons + background generated')
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
