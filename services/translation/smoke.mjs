/**
 * 本地翻译链路端到端冒烟测试：
 *   1. 若 LibreTranslate 未运行则先启动
 *   2. 轮询 /languages 等待就绪
 *   3. 翻译 en->zh 与 zh->en 样例并输出耗时
 *   4. 结束由本脚本启动的服务
 *
 * 用法: node services/translation/smoke.mjs
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const SERVICE_URL = 'http://127.0.0.1:5000'
const venvDir = path.join(os.homedir(), 'AppData', 'Local', 'HighlightTranslator', 'lt-service', 'venv')
const libreTranslateExe = path.join(venvDir, 'Scripts', 'libretranslate.exe')

function die(message) {
  console.error(`[smoke] FAIL: ${message}`)
  process.exit(1)
}

async function isHealthy(timeoutMs = 1500) {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    const response = await fetch(`${SERVICE_URL}/languages`, { signal: controller.signal })
    clearTimeout(timer)
    return response.ok
  } catch {
    return false
  }
}

async function translate(q, source, target) {
  const started = Date.now()
  const response = await fetch(`${SERVICE_URL}/translate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ q, source, target, format: 'text' })
  })

  if (!response.ok) {
    die(`/translate responded ${response.status}`)
  }

  const data = await response.json()
  return { text: data.translatedText, detected: data.detectedLanguage?.language, ms: Date.now() - started }
}

if (!fs.existsSync(libreTranslateExe)) {
  die('LibreTranslate is not installed. Run: node services/translation/setup.mjs')
}

let service = null

if (!(await isHealthy())) {
  console.log('[smoke] starting libretranslate...')
  service = spawn(
    libreTranslateExe,
    ['--host', '127.0.0.1', '--port', '5000', '--load-only', 'en,zh'],
    { stdio: 'ignore', windowsHide: true }
  )
}

// 首次启动要加载模型，最长等 2 分钟
const deadline = Date.now() + 120_000
let healthy = false

while (Date.now() < deadline) {
  if (await isHealthy()) {
    healthy = true
    break
  }
  await new Promise(resolve => setTimeout(resolve, 700))
}

if (!healthy) {
  die('service did not become healthy')
}

console.log('[smoke] service healthy')

const samples = [
  { q: 'Operating systems manage computer resources.', source: 'en', target: 'zh' },
  { q: 'Assets are resources controlled by an entity.', source: 'en', target: 'zh' },
  { q: '操作系统管理计算机资源。', source: 'zh', target: 'en' }
]

let failed = false

for (const sample of samples) {
  const result = await translate(sample.q, sample.source, sample.target)
  console.log(
    `[smoke] ${sample.source}->${sample.target} (${result.ms} ms, detected=${result.detected}): ` +
      `${sample.q} => ${result.text}`
  )

  if (!result.text) {
    failed = true
  }
}

if (service) {
  console.log('[smoke] stopping service')
  spawn('taskkill', ['/PID', String(service.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
}

if (failed) {
  die('empty translation output')
}

console.log('[smoke] PASS')
