import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import { log } from '../logger'
import { ensureService, SERVICE_URL, venvPython } from './serviceManager'
import type { ModelKey } from '@shared/types'

/**
 * TranslationProvider 的 LibreTranslate 实现（127.0.0.1:5000）。
 * 免费、离线、无需 API Key。
 */

export interface TranslationProviderResult {
  translatedText: string
  detectedLanguage: string
}

export interface TranslationProvider {
  translate(text: string, source: string, target: string): Promise<TranslationProviderResult>
  ensureModel(key: ModelKey): Promise<void>
  isDownloading(key: ModelKey): boolean
}

const downloading = new Set<ModelKey>()
const installPromises = new Map<ModelKey, Promise<void>>()

/** 带超时的本地 POST。 */
async function post(pathname: string, body: unknown, timeoutMs = 30_000): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    return await fetch(`${SERVICE_URL}${pathname}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal
    })
  } finally {
    clearTimeout(timer)
  }
}

export const libreTranslateProvider: TranslationProvider = {
  isDownloading(key: ModelKey): boolean {
    return downloading.has(key)
  },

  /**
   * LibreTranslate 的"模型"即磁盘上的 Argos 语言包。en<->zh 由
   * services/translation/setup.mjs 安装；此处只确保服务已就绪。
   */
  async ensureModel(key: ModelKey): Promise<void> {
    if (downloading.has(key)) {
      return
    }

    downloading.add(key)

    try {
      const healthy = await ensureService()

      if (!healthy) {
        throw new Error('translation service unavailable')
      }
    } finally {
      downloading.delete(key)
    }
  },

  async translate(text: string, source: string, target: string): Promise<TranslationProviderResult> {
    const healthy = await ensureService()

    if (!healthy) {
      throw new Error('translation service unavailable')
    }

    const response = await post('/translate', {
      q: text,
      source,
      target,
      format: 'text'
    })

    if (!response.ok) {
      throw new Error(`libretranslate responded ${response.status}`)
    }

    const data = (await response.json()) as {
      translatedText?: string
      detectedLanguage?: { language?: string }
    }

    if (!data.translatedText) {
      throw new Error('empty translation output')
    }

    return {
      translatedText: data.translatedText,
      detectedLanguage: data.detectedLanguage?.language ?? 'auto'
    }
  }
}

/** 在服务 venv 里安装一个 Argos 语言对（设置页的"安装"按钮调用）。 */
export function installArgosPair(key: ModelKey): Promise<void> {
  const existing = installPromises.get(key)
  if (existing) {
    return existing
  }

  const script = app.isPackaged
    ? path.join(process.resourcesPath!, 'pytools', 'install_models.py')
    : path.join(app.getAppPath(), 'resources', 'pytools', 'install_models.py')

  const python = venvPython()

  if (!fs.existsSync(python)) {
    return Promise.reject(new Error(`local Python runtime not found: ${python}`))
  }

  if (!fs.existsSync(script)) {
    return Promise.reject(new Error(`Argos model installer not found: ${script}`))
  }

  const installPromise = new Promise<void>((resolve, reject) => {
    log(`installing argos model ${key}`)
    downloading.add(key)

    const child = spawn(python, [script, key], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })

    let output = ''
    let settled = false

    const finish = (error?: Error): void => {
      if (settled) {
        return
      }

      settled = true
      downloading.delete(key)
      error ? reject(error) : resolve()
    }

    child.stdout!.on('data', (chunk: Buffer) => {
      output += chunk.toString()
    })
    child.stderr!.on('data', (chunk: Buffer) => {
      log('argos install stderr:', chunk.toString().trim())
    })
    child.on('error', (error) => {
      finish(error)
    })
    child.on('exit', (code) => {
      log(`argos install ${key} exited ${code}: ${output.trim()}`)
      code === 0 ? finish() : finish(new Error(`argos install exited ${code}`))
    })
  })

  installPromises.set(key, installPromise)
  return installPromise.finally(() => installPromises.delete(key))
}
