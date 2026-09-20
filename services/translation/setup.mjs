/**
 * 一次性服务安装脚本：创建 LibreTranslate 虚拟环境并安装 en<->zh 的
 * Argos 翻译模型。可重复执行；失败时以非零退出码结束（保持错误可见）。
 *
 * 用法：node services/translation/setup.mjs
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const localAppData = process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local')
const serviceRoot = path.join(localAppData, 'HighlightTranslator', 'lt-service')
const venvDir = path.join(serviceRoot, 'venv')
const markerFile = path.join(serviceRoot, 'installed.json')

function step(message) {
  console.log(`[setup] ${message}`)
}

function run(cmd, args) {
  step(`${cmd} ${args.join(' ')}`)
  const result = spawnSync(cmd, args, { stdio: 'inherit', shell: false })
  if (result.status !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} exited with ${result.status}`)
  }
}

/** 查找 Python 3.12（LibreTranslate 全依赖链兼容性最好的版本）。 */
function findPython() {
  const candidates = [
    path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Python', 'Python312', 'python.exe'),
    path.join(os.homedir(), 'AppData', 'Local', 'Microsoft', 'WindowsApps', 'python.exe')
  ]

  for (const exe of candidates) {
    if (fs.existsSync(exe)) {
      const probe = spawnSync(exe, ['-c', 'import sys; print("%d.%d" % sys.version_info[:2])'], { encoding: 'utf8' })
      if (probe.status === 0 && probe.stdout.trim().startsWith('3.12')) {
        return exe
      }
    }
  }

  const probe = spawnSync('py', ['-3.12', '-c', 'import sys; print(sys.executable)'], { encoding: 'utf8' })
  if (probe.status === 0 && probe.stdout.trim().endsWith('.exe')) {
    return probe.stdout.trim()
  }

  throw new Error('Python 3.12 not found. Install it with: winget install -e --id Python.Python.3.12')
}

const python = findPython()
step(`using python: ${python}`)

fs.mkdirSync(serviceRoot, { recursive: true })

// 1. 创建 venv（已存在则跳过）
if (!fs.existsSync(path.join(venvDir, 'Scripts', 'python.exe'))) {
  run(python, ['-m', 'venv', venvDir])
}

const venvPython = path.join(venvDir, 'Scripts', 'python.exe')

// 2. 安装 LibreTranslate（幂等）
run(venvPython, ['-m', 'pip', 'install', '--upgrade', 'pip', 'wheel'])
run(venvPython, ['-m', 'pip', 'install', 'libretranslate'])

// 3. 安装 Argos en<->zh 模型（约 200MB，需联网；之后完全离线）
step('installing Argos en<->zh translation models (this downloads ~200 MB)')
run(venvPython, [
  path.join(projectRoot, 'resources', 'pytools', 'install_models.py'),
  'en-zh',
  'zh-en'
])

fs.writeFileSync(
  markerFile,
  JSON.stringify({ installedAt: new Date().toISOString(), venvDir }, null, 2)
)

step('done')
