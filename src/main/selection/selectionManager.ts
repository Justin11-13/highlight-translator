import { getSettings } from '../storage/settingsStore'
import { normalizeTranslationInput, translateText, TranslationError } from '../translation/translationManager'
import { showPopup } from '../windows/popupWindow'
import { log } from '../logger'
import type { SelectionEventData } from '../native/helperManager'
import type { PopupData } from '@shared/types'

let lastText = ''
let lastTimestamp = 0
let idCounter = 0
let manualIdCounter = -10
let busy = false

interface TranslationRequest {
  id: number
  text: string
  processName: string
  mousePoint: { x: number; y: number }
}

let pending: TranslationRequest | null = null

const DUPLICATE_WINDOW_MS = 1000

/**
 * 划词主管线：过滤 -> 去重 -> 显示加载态 -> 翻译 -> 显示结果/错误。
 * 每次新选区都会原地更新同一个弹窗（原计划 Phase 5/6/12/13）。
 */
export function handleSelection(event: SelectionEventData): void {
  const settings = getSettings()

  // 设置里关闭了自动翻译则完全忽略划词
  if (!settings.autoTranslate) {
    return
  }

  const text = normalizeTranslationInput(event.text)

  // 过短直接忽略（原计划 Phase 5）
  if (!text || text.length < settings.minChars) {
    return
  }

  // 同文本 1 秒内去重：MouseUp 可能连发多个事件（原计划 Phase 6）
  const now = Date.now()

  if (text === lastText && now - lastTimestamp < DUPLICATE_WINDOW_MS) {
    return
  }

  lastText = text
  lastTimestamp = now

  const id = ++idCounter
  const mousePoint = { x: event.mouseX, y: event.mouseY }
  const request: TranslationRequest = {
    id,
    text,
    processName: event.process,
    mousePoint
  }

  // 过长：显示错误并提供"仍然翻译"（原计划 Phase 5/26）
  if (text.length > settings.maxChars) {
    showPopup(
      {
        id,
        status: 'error',
        originalText: text.slice(0, 400),
        retryText: text,
        errorCode: 'too_long',
        canRetryAnyway: true,
        processName: event.process
      },
      mousePoint
    )
    return
  }

  showPopup(
    {
      id,
      status: 'loading',
      originalText: text,
      processName: event.process
    },
    mousePoint
  )

  void runTranslation(request)
}

/** 串行执行翻译；期间来了新选区则记住最新的，当前完成后立刻处理。 */
async function runTranslation(request: TranslationRequest): Promise<void> {
  if (busy) {
    pending = request
    return
  }

  busy = true
  let currentRequest: TranslationRequest | null = request

  try {
    while (currentRequest) {
      const current = currentRequest
      pending = null

      try {
        const outcome = await translateText(current.text, current.processName)
        const next = pending

        // 如果用户在翻译期间又选中了新文本，不把旧结果覆盖到新选区上。
        if (!next) {
          showPopup({
            id: current.id,
            status: 'result',
            originalText: current.text,
            translatedText: outcome.translatedText,
            detectedLanguage: outcome.detectedLanguage,
            targetLanguage: outcome.targetLanguage,
            cached: outcome.cached,
            processName: current.processName
          })
        }

        currentRequest = next
      } catch (error) {
        const next = pending

        if (next) {
          currentRequest = next
          continue
        }

        if (error instanceof TranslationError) {
          showPopup({
            id: current.id,
            status: 'error',
            originalText: current.text,
            errorCode: error.code,
            canRetryAnyway: error.code === 'service_unavailable' || error.code === 'engine_unavailable',
            processName: current.processName
          })
        } else {
          log('unexpected translation error:', error as Error)
          showPopup({
            id: current.id,
            status: 'error',
            originalText: current.text,
            errorCode: 'engine_unavailable',
            canRetryAnyway: true,
            processName: current.processName
          })
        }

        currentRequest = null
      }
    }
  } finally {
    busy = false
  }
}

/** "仍然翻译/重试"按钮入口（超长选区或失败重试）。 */
export function translateAnyway(id: number, text: string, processName = ''): void {
  const normalizedText = normalizeTranslationInput(text)
  const request: TranslationRequest = {
    id,
    text: normalizedText,
    processName,
    mousePoint: { x: 0, y: 0 }
  }

  showPopup({ id, status: 'loading', originalText: normalizedText, processName })
  void runTranslation(request)
}

/**
 * Popup 原文输入：直接复用划词的翻译串行队列，不读取或写入系统剪贴板。
 * 使用负数 id，避免把手动输入误当成新的真实划词而关闭设置面板。
 */
export function translateInput(text: string): void {
  const settings = getSettings()
  const normalizedText = normalizeTranslationInput(text)

  if (!normalizedText) {
    return
  }

  const id = manualIdCounter--
  const processName = 'manual-input'
  const request: TranslationRequest = {
    id,
    text: normalizedText,
    processName,
    mousePoint: { x: 0, y: 0 }
  }

  if (normalizedText.length > settings.maxChars) {
    showPopup({
      id,
      status: 'error',
      originalText: normalizedText,
      retryText: normalizedText,
      errorCode: 'too_long',
      canRetryAnyway: true,
      processName
    })
    return
  }

  showPopup({
    id,
    status: 'loading',
    originalText: normalizedText,
    processName
  })

  void runTranslation(request)
}
