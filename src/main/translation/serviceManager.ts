import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { app } from 'electron'
import { log } from '../logger'

/**
 * 本地 LibreTranslate 服务的生命周期管理（原计划 Phase 18）。
 * 服务只绑定 127.0.0.1 —— 绝不暴露到网络。按需启动，应用退出时结束。
 */

export const SERVICE_URL = 'http://127.0.0.1:5000'
const HEALTH_TIMEOUT_MS = 1500
const START_TIMEOUT_MS = 120_000
const HEALTH_POLL_INTERVAL_MS = 250

let child: ChildProcess | null = null
let stopped = true
let ensurePromise: Promise<boolean> | null = null
let serviceReady = false
let setupChild: ChildProcess | null = null
let setupPromise: Promise<void> | null = null
let serviceStartFailed = false

/** 服务 venv 安装位置（dev 与打包版共用，便于离线复用）。 */
export function serviceRoot(): string {
  const localAppData = process.env['LOCALAPPDATA'] ?? path.join(os.homedir(), 'AppData', 'Local')
  return path.join(localAppData, 'HighlightTranslator', 'lt-service')
}

export function venvPython(): string {
  return path.join(serviceRoot(), 'venv', 'Scripts', 'python.exe')
}

export function libreTranslateExe(): string {
  return path.join(serviceRoot(), 'venv', 'Scripts', 'libretranslate.exe')
}

/** 打包版随应用分发的首次安装脚本；开发版从源码目录读取。 */
export function setupScript(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath!, 'translation', 'setup.mjs')
    : path.join(app.getAppPath(), 'services', 'translation', 'setup.mjs')
}

/** 服务是否已通过 setup.mjs 安装。 */
export function isServiceInstalled(): boolean {
  return fs.existsSync(libreTranslateExe())
}

/** 健康检查：GET /languages 是否可达。 */
export async function isHealthy(): Promise<boolean> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS)

  try {
    const response = await fetch(`${SERVICE_URL}/languages`, { signal: controller.signal })
    return response.ok
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

/** 确保服务可用：健康则直接返回；否则拉起进程并轮询等待就绪。 */
export async function ensureService(): Promise<boolean> {
  if (ensurePromise) {
    return ensurePromise
  }

  ensurePromise = ensureServiceInternal().finally(() => {
    ensurePromise = null
  })

  return ensurePromise
}

async function ensureServiceInternal(): Promise<boolean> {
  const startedAt = Date.now()

  if (serviceReady) {
    return true
  }

  if (await isHealthy()) {
    serviceReady = true
    log(`libretranslate service ready in ${Date.now() - startedAt}ms`)
    return true
  }

  if (child) {
    // 正在启动中，直接进入下方等待
  } else if (!isServiceInstalled()) {
    log('libretranslate service is not installed (services/translation/setup.mjs)')
    return false
  } else {
    stopped = false
    serviceStartFailed = false

    if (!startService()) {
      return false
    }
  }

  const deadline = Date.now() + START_TIMEOUT_MS

  while (Date.now() < deadline) {
    if ((stopped || serviceStartFailed) && !child) {
      return false
    }

    if (await isHealthy()) {
      serviceReady = true
      log(`libretranslate service healthy in ${Date.now() - startedAt}ms`)
      return true
    }

    if (serviceStartFailed && !child) {
      return false
    }

    await new Promise((resolve) => setTimeout(resolve, HEALTH_POLL_INTERVAL_MS))
  }

  log('libretranslate service did not become healthy in time')
  return false
}

function startService(): boolean {
  const exe = libreTranslateExe()
  log('starting libretranslate:', exe)

  try {
    child = spawn(
      exe,
      ['--host', '127.0.0.1', '--port', '5000', '--load-only', 'en,zh'],
      { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }
    )
  } catch (error) {
    const details = error as NodeJS.ErrnoException
    log(
      `failed to spawn libretranslate (code=${details.code ?? 'unknown'}, errno=${details.errno ?? 'unknown'}, syscall=${details.syscall ?? 'unknown'})`,
      error as Error
    )
    child = null
    serviceStartFailed = true
    return false
  }

  const serviceProcess = child

  serviceProcess.stdout!.on('data', (chunk: Buffer) => {
    const line = chunk.toString().trim()
    if (line) {
      log('libretranslate:', line)
    }
  })

  serviceProcess.stderr!.on('data', (chunk: Buffer) => {
    const line = chunk.toString().trim()
    if (line) {
      log('libretranslate stderr:', line)
    }
  })

  serviceProcess.on('error', (error) => {
    const details = error as NodeJS.ErrnoException
    log(
      `libretranslate process failed (code=${details.code ?? 'unknown'}, errno=${details.errno ?? 'unknown'}, syscall=${details.syscall ?? 'unknown'})`,
      error
    )

    if (child === serviceProcess) {
      serviceStartFailed = true
      serviceReady = false
      child = null
    }
  })

  serviceProcess.on('exit', (code) => {
    log(`libretranslate exited (code ${code})`)

    if (child === serviceProcess) {
      if (!serviceReady || code !== 0) {
        serviceStartFailed = true
      }
      serviceReady = false
      child = null
    }
  })

  return true
}

/**
 * 由用户在设置页明确触发首次本地引擎安装。
 * 使用 Electron 自带的 Node runtime 执行 setup.mjs，避免依赖开发机的 node.exe。
 */
export function setupTranslationService(): Promise<void> {
  if (setupPromise) {
    return setupPromise
  }

  const script = setupScript()

  if (!fs.existsSync(script)) {
    return Promise.reject(new Error(`translation setup script not found: ${script}`))
  }

  setupPromise = new Promise<void>((resolve, reject) => {
    let settled = false

    const finish = (error?: Error): void => {
      if (settled) {
        return
      }

      settled = true
      setupChild = null
      error ? reject(error) : resolve()
    }

    try {
      setupChild = spawn(process.execPath, [script], {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true
      })
    } catch (error) {
      finish(error as Error)
      return
    }

    setupChild.stdout?.on('data', (chunk: Buffer) => {
      const line = chunk.toString().trim()
      if (line) {
        log('translation setup:', line)
      }
    })

    setupChild.stderr?.on('data', (chunk: Buffer) => {
      const line = chunk.toString().trim()
      if (line) {
        log('translation setup stderr:', line)
      }
    })

    setupChild.once('error', (error) => finish(error))
    setupChild.once('exit', (code) => {
      if (code === 0) {
        finish()
      } else {
        finish(new Error(`translation setup exited with code ${code}`))
      }
    })
  }).finally(() => {
    setupPromise = null
  })

  return setupPromise
}

/** 应用退出时结束服务进程树。 */
export function stopService(): void {
  stopped = true
  serviceReady = false

  if (setupChild) {
    try {
      setupChild.kill()
    } catch {
      // 已退出
    }
    setupChild = null
  }

  if (child) {
    // 树杀：libretranslate 可能有 worker 线程/子进程
    spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true })
    child = null
  }
}
