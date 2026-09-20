import { app } from 'electron'
import path from 'node:path'
import fs from 'node:fs'

const LOG_MAX_BYTES = 512 * 1024

let logFile = ''

/** 初始化日志目录（userData/logs/main.log），超限时清空重写。 */
export function initLogger(): void {
  const dir = path.join(app.getPath('userData'), 'logs')
  fs.mkdirSync(dir, { recursive: true })
  logFile = path.join(dir, 'main.log')

  try {
    if (fs.existsSync(logFile) && fs.statSync(logFile).size > LOG_MAX_BYTES) {
      fs.writeFileSync(logFile, '')
    }
  } catch {
    // 日志永远不能影响应用本身
  }
}

/** 同时输出到 stderr 与日志文件。 */
export function log(...parts: unknown[]): void {
  const line = `[${new Date().toISOString()}] ${parts
    .map((p) => (p instanceof Error ? `${p.message}\n${p.stack ?? ''}` : typeof p === 'string' ? p : JSON.stringify(p)))
    .join(' ')}\n`

  console.error(line.trimEnd())

  if (!logFile) {
    return
  }

  try {
    fs.appendFileSync(logFile, line)
  } catch {
    // 忽略写日志失败
  }
}
