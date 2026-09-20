import { spawn, type ChildProcess } from 'node:child_process'
import path from 'node:path'
import readline from 'node:readline'
import { app } from 'electron'
import { getSettings } from '../storage/settingsStore'
import { log } from '../logger'

export interface SelectionEventData {
  text: string
  mouseX: number
  mouseY: number
  process: string
  method: string
}

type OnSelection = (event: SelectionEventData) => void

let child: ChildProcess | null = null
let restarting = false
let stopped = true
let onSelection: OnSelection = () => {}
let consecutiveFailures = 0

/**
 * 划词 Helper 以 PowerShell 脚本形式随应用分发（宿主 powershell.exe 为
 * 微软签名二进制，C# 核心由 Add-Type 在内存中编译）。原因：本机的 WDAC
 * 代码完整性策略会拦截无签名的 exe/dll，因此不落地任何无签名二进制。
 * 实现见 native/SelectionHelper/。
 */
function resolveHelperScript(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath!, 'helper', 'SelectionHelper.ps1')
    : path.join(app.getAppPath(), 'native', 'SelectionHelper', 'SelectionHelper.ps1')
}

function resolvePowerShell(): string {
  return path.join(process.env['WINDIR'] ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
}

export function startHelper(handler: OnSelection): void {
  onSelection = handler
  stopped = false
  spawnHelper()
}

function spawnHelper(): void {
  if (stopped) {
    return
  }

  const script = resolveHelperScript()
  const args = [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy', 'Bypass',
    '-STA',
    '-File', script,
    '--parent-pid', String(process.pid)
  ]

  if (getSettings().clipboardFallback) {
    args.push('--clipboard-fallback')
  }

  log('starting helper:', args.join(' '))

  try {
    child = spawn(resolvePowerShell(), args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    })
  } catch (error) {
    log('helper spawn failed:', error as Error)
    scheduleRestart()
    return
  }

  const processChild = child
  if (!processChild) {
    scheduleRestart()
    return
  }

  // 逐行解析 Helper 输出的 NDJSON 协议（原计划 Phase 7）
  const rl = readline.createInterface({ input: processChild.stdout! })

  rl.on('line', (line) => {
    let parsed: Record<string, unknown>

    try {
      const value: unknown = JSON.parse(line)
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return
      }
      parsed = value as Record<string, unknown>
    } catch {
      return
    }

    if (parsed.event === 'ready') {
      consecutiveFailures = 0
      log('helper ready')
      return
    }

    if (parsed.event === 'selection') {
      const text = typeof parsed.text === 'string' ? parsed.text : ''
      const mouseX = typeof parsed.mouseX === 'number' ? parsed.mouseX : NaN
      const mouseY = typeof parsed.mouseY === 'number' ? parsed.mouseY : NaN
      const procName = typeof parsed.process === 'string' ? parsed.process : ''
      const method = typeof parsed.method === 'string' ? parsed.method : ''

      if (
        text.trim() &&
        text.length <= 100_000 &&
        Number.isFinite(mouseX) &&
        Number.isFinite(mouseY) &&
        procName.length <= 256 &&
        method.length > 0 &&
        method.length <= 32
      ) {
        onSelection({ text, mouseX, mouseY, process: procName, method })
      } else {
        log('helper invalid selection event discarded')
      }
      return
    }

    if (parsed.event === 'log') {
      log('helper:', String(parsed.reason ?? ''))
    }
  })

  processChild.stderr!.on('data', (chunk: Buffer) => {
    log('helper stderr:', chunk.toString().trim())
  })

  processChild.on('error', (error) => {
    log('helper process failed:', error)
    if (child === processChild) {
      child = null
    }
    if (!stopped && !restarting) {
      scheduleRestart()
    }
  })

  processChild.on('exit', (code) => {
    log(`helper exited (code ${code})`)
    if (child === processChild) {
      child = null
    }

    if (!stopped && !restarting) {
      scheduleRestart()
    }
  })
}

/**
 * Helper 意外退出后延时重启；连续失败超过 5 次则放弃并记录日志，
 * 避免无限重启风暴。
 */
function scheduleRestart(): void {
  if (stopped || restarting) {
    return
  }

  consecutiveFailures += 1

  if (consecutiveFailures > 5) {
    log('helper failed repeatedly; giving up until app restart')
    return
  }

  restarting = true
  setTimeout(() => {
    restarting = false
    spawnHelper()
  }, 2000)
}

/** 应用退出时结束 Helper（其自身也会监视父进程退出）。 */
export function stopHelper(): void {
  stopped = true

  if (child) {
    try {
      child.kill()
    } catch {
      // 已退出
    }
    child = null
  }
}
