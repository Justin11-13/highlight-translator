import { createHash } from 'node:crypto'
import { db } from '../storage/db'
import { getSettings, setSettings } from '../storage/settingsStore'
import { addHistory } from '../storage/historyStore'
import { libreTranslateProvider, installArgosPair } from './libreTranslate'
import { isServiceInstalled } from './serviceManager'
import { log } from '../logger'
import type { ModelKey } from '@shared/types'

export type SourceLanguage = 'zh' | 'en'

export interface TranslateOutcome {
  originalText: string
  translatedText: string
  detectedLanguage: string
  targetLanguage: string
  cached: boolean
}

export class TranslationError extends Error {
  constructor(
    /** too_long=选区过长 model_missing=模型缺失 service_unavailable=服务不可用 engine_unavailable=未知引擎错误 */
    public code: 'too_long' | 'model_missing' | 'service_unavailable' | 'engine_unavailable'
  ) {
    super(code)
  }
}

/** 简单语言探测：中日韩字符占比 >= 0.2 视为中文，否则英文（Phase 8 自动方向）。 */
export function detectLanguage(text: string): SourceLanguage {
  const cjk = text.match(/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g)?.length ?? 0
  return cjk / text.length >= 0.2 ? 'zh' : 'en'
}

/** 只去掉边缘空白并统一换行，不改变选区内部的有意义格式。 */
export function normalizeTranslationInput(text: string): string {
  return text.replace(/\r\n?/g, '\n').trim()
}

/** 缓存键 = 文本 + 源语言 + 目标语言的哈希（避免长文本做主键）。 */
function cacheKey(text: string, source: string, target: string): string {
  return createHash('sha256').update(`${text}\u0000${source}\u0000${target}`).digest('hex').slice(0, 32)
}

/**
 * 翻译主流程：缓存查找 -> LibreTranslate -> 写缓存/历史。
 * 缓存命中时几乎零延迟（原计划 Phase 9）。
 */
export async function translateText(text: string, processName = '', signal?: AbortSignal): Promise<TranslateOutcome> {
  const settings = getSettings()
  const normalizedText = normalizeTranslationInput(text)

  if (!normalizedText) {
    throw new TranslationError('engine_unavailable')
  }

  // 方向决策：探测语言与目标语言相同时自动反向（中->英）
  const source = detectLanguage(normalizedText)
  const target = source === settings.targetLanguage ? (settings.targetLanguage === 'zh' ? 'en' : 'zh') : settings.targetLanguage
  const modelKey = `${source}-${target}` as ModelKey

  if (!settings.modelsInstalled[modelKey]) {
    throw new TranslationError('model_missing')
  }

  const key = cacheKey(normalizedText, source, target)

  // ---- 缓存查找 ----
  const cachedRow = db()
    .prepare('SELECT translated_text FROM translation_cache WHERE source_text = ? AND source_language = ? AND target_language = ?')
    .get(key, source, target) as { translated_text: string } | undefined

  if (cachedRow) {
    db().prepare('UPDATE translation_cache SET last_used_at = ? WHERE source_text = ? AND source_language = ? AND target_language = ?').run(
      new Date().toISOString(),
      key,
      source,
      target
    )
    return {
      originalText: normalizedText,
      translatedText: cachedRow.translated_text,
      detectedLanguage: source,
      targetLanguage: target,
      cached: true
    }
  }

  // ---- 调用本地翻译引擎 ----
  let result: { translatedText: string; detectedLanguage: string }

  try {
    // 本地已经识别出方向，直接告诉 LibreTranslate，跳过重复的 auto 语言检测。
    result = await libreTranslateProvider.translate(normalizedText, source, target, signal)
  } catch (error) {
    if (signal?.aborted) {
      throw error
    }

    log('translation failed:', error as Error)
    throw new TranslationError('service_unavailable')
  }

  // ---- 写缓存（幂等）----
  db()
    .prepare(
      `INSERT INTO translation_cache (source_text, source_language, target_language, translated_text, created_at, last_used_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(source_text, source_language, target_language) DO NOTHING`
    )
    .run(key, source, target, result.translatedText, new Date().toISOString(), new Date().toISOString())

  // ---- 历史（默认关闭，尊重隐私）----
  if (settings.saveHistory) {
    addHistory({
      original_text: normalizedText,
      translated_text: result.translatedText,
      source_language: result.detectedLanguage || source,
      target_language: target,
      application_name: processName
    })
  }

  return {
    originalText: normalizedText,
    translatedText: result.translatedText,
    detectedLanguage: result.detectedLanguage || source,
    targetLanguage: target,
    cached: false
  }
}

/** 模型/服务状态（设置页使用）。 */
export function modelStatus(): { installed: Record<ModelKey, boolean>; downloading: Record<ModelKey, boolean> } {
  const installed = getSettings().modelsInstalled
  return {
    installed: { 'en-zh': !!installed['en-zh'], 'zh-en': !!installed['zh-en'] },
    downloading: {
      'en-zh': libreTranslateProvider.isDownloading('en-zh'),
      'zh-en': libreTranslateProvider.isDownloading('zh-en')
    }
  }
}

/** 安装指定语言对的 Argos 模型并落盘状态。 */
export async function downloadModel(key: ModelKey): Promise<void> {
  if (!isServiceInstalled()) {
    throw new Error('local translation engine is not installed; install the local engine first')
  }

  await installArgosPair(key)

  const settings = getSettings()
  setSettings({ modelsInstalled: { ...settings.modelsInstalled, [key]: true } })
}
