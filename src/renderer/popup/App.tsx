import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { LiquidGlass } from '../shared/LiquidGlass'
import {
  chineseFontStack,
  EN_FONT_STACKS,
  englishFontStack,
  POPUP_FROSTED_BLUR,
  POPUP_FROSTED_BLUR_MAX,
  POPUP_FROSTED_BLUR_MIN,
  POPUP_FROSTED_MIN_OPACITY,
  POPUP_THEME_PRESETS,
  POPUP_SIZE,
  ZH_FONT_STACKS
} from '../../shared/types'
import type { PopupAppearance, PopupData } from '../../shared/types'
import { uiText } from '../../shared/i18n'
import type { UiTextKey } from '../../shared/i18n'

/* 截图/演示模式：URL 带 ?demo=loading|result|error 时使用固定数据，不依赖 IPC */
const DEMO_PARAMS = new URLSearchParams(window.location.search)
const DEMO_MODE = DEMO_PARAMS.get('demo')
const DEMO_BG = DEMO_PARAMS.get('bg') === '1'

const demoData: Record<string, PopupData> = {
  loading: {
    id: -2,
    status: 'loading',
    originalText: 'Artificial intelligence is transforming how students research and study.',
    processName: 'chrome'
  },
  result: {
    id: -3,
    status: 'result',
    originalText: 'Operating systems manage computer resources.',
    translatedText: '操作系统管理计算机资源。',
    detectedLanguage: 'en',
    targetLanguage: 'zh',
    processName: 'chrome'
  },
  error: {
    id: -4,
    status: 'error',
    originalText: 'shareholders equity',
    errorCode: 'service_unavailable',
    processName: 'acrobat'
  }
}

/** 错误码 -> 用户可读信息（HCI：具体、可行动，不用术语吓人） */
const errorMessageKeys: Record<string, UiTextKey> = {
  too_long: 'translationTooLong',
  model_missing: 'modelMissing',
  engine_unavailable: 'translateUnavailable',
  service_unavailable: 'translateUnavailable',
  engine_timeout: 'translationTimedOut'
}

const DEFAULT_APPEARANCE: PopupAppearance = {
  uiLanguage: 'en',
  glassOpacity: 0,
  glassBlur: POPUP_FROSTED_BLUR,
  showOriginal: true,
  popupWidth: POPUP_SIZE.defaultW,
  popupHeight: POPUP_SIZE.defaultH,
  englishFontFamily: 'segoe',
  chineseFontFamily: 'yahei',
  englishFontSize: 13,
  chineseFontSize: 15,
  originalTextColor: '#ffffff',
  translationTextColor: '#ffffff',
  glassColor: '#ffffff',
  popupBackground: null
}

function normalizeAppearance(value: PopupAppearance): PopupAppearance {
  return {
    ...value,
    glassOpacity: Math.max(POPUP_FROSTED_MIN_OPACITY, value.glassOpacity),
    glassBlur: Math.min(POPUP_FROSTED_BLUR_MAX, Math.max(POPUP_FROSTED_BLUR_MIN, value.glassBlur))
  }
}

function useHt() {
  return useMemo(() => (window as unknown as { ht?: NonNullable<Window['ht']> }).ht, [])
}

export default function App() {
  const ht = useHt()
  const [data, setData] = useState<PopupData | null>(
    DEMO_MODE ? demoData[DEMO_MODE] ?? demoData['result'] : null
  )
  const [pinned, setPinned] = useState(false)
  const [speaking, setSpeaking] = useState<'en' | 'zh' | null>(null)
  const [closing, setClosing] = useState(false)
  const [copied, setCopied] = useState(false)
  const [panelOpen, setPanelOpen] = useState(DEMO_PARAMS.get('panel') === '1')
  const [appearance, setAppearance] = useState<PopupAppearance>(DEFAULT_APPEARANCE)
  const [originalInput, setOriginalInput] = useState('')
  const inputTranslateTimer = useRef<number | null>(null)
  const dragPointerId = useRef<number | null>(null)
  const resizePointerId = useRef<number | null>(null)
  const appearancePersistTimer = useRef<number | null>(null)
  const pendingAppearancePatch = useRef<Partial<PopupAppearance>>({})

  // 接收主进程下发的外观参数
  useEffect(() => {
    if (data?.appearance) {
      setAppearance(normalizeAppearance(data.appearance))
    }
  }, [data?.appearance])

  // 新的高亮/手动翻译结果到达时同步输入框；用户正在编辑时不会被外观刷新打断。
  useEffect(() => {
    if (inputTranslateTimer.current !== null) {
      window.clearTimeout(inputTranslateTimer.current)
      inputTranslateTimer.current = null
    }

    if (data) {
      setOriginalInput(data.originalText)
    }
  }, [data?.id, data?.originalText])

  useEffect(() => {
    return () => {
      if (inputTranslateTimer.current !== null) {
        window.clearTimeout(inputTranslateTimer.current)
      }
    }
  }, [])

  /**
   * 关键防偏移措施：页面布局尺寸永远跟随真实窗口尺寸。
   * 窗口被拖拽缩放/外部调整时，卡片 CSS 尺寸 = BrowserWindow innerWidth/Height；
   * BrowserWindow 与卡片同尺寸，保证按钮命中位置与图标视觉位置永远一致。
   */
  useEffect(() => {
    const sync = () => {
      setAppearance(prev => ({
        ...prev,
        popupWidth: Math.max(200, window.innerWidth),
        popupHeight: Math.max(160, window.innerHeight)
      }))
    }

    window.addEventListener('resize', sync)
    sync()
    return () => window.removeEventListener('resize', sync)
  }, [])

  // 初始化：先取当前数据，再订阅后续更新
  useEffect(() => {
    if (DEMO_MODE || !ht?.popup) {
      return
    }

    let disposed = false

    void ht.popup.getData().then(initial => {
      if (!disposed && initial) {
        setData(initial)
      }
    })

    const off = ht.popup.onData(next => {
      setData(next)

      // 与主进程的最终钉住状态保持同步（用户图钉 或 "常开"模式）
      if (typeof next.pinned === 'boolean') {
        setPinned(next.pinned)
      }
    })

    return () => {
      disposed = true
      off()
    }
  }, [ht])

  // 主进程通过 Windows System.Speech 广播朗读状态，避免依赖 Chromium 的语音实现。
  useEffect(() => {
    if (DEMO_MODE || !ht?.popup) {
      return
    }

    return ht.popup.onTtsState(state => {
      setSpeaking(state.speaking ? state.language ?? null : null)
    })
  }, [ht])

  useEffect(() => {
    if (DEMO_MODE || !ht?.popup) {
      return
    }

    return ht.popup.onVisibility(state => setClosing(state === 'closing'))
  }, [ht])

  // 主进程在隐藏弹窗时也会收起面板，避免下一次打开时把临时布局状态带回来。
  useEffect(() => {
    if (DEMO_MODE || !ht?.popup) {
      return
    }

    return ht.popup.onSettingsOpen(open => setPanelOpen(open))
  }, [ht])

  // Esc 关闭面板/弹窗（键盘可达性）
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (panelOpen) {
          setPanelOpen(false)
          ht?.popup?.setSettingsOpen(false)
          return
        }

        ht?.popup?.close()
      }
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [ht, panelOpen])

  /** 就地修改外观：立即生效 + 持久化（弹窗内调，不需要打开设置） */
  const patchAppearance = useCallback(
    (patch: Partial<PopupAppearance>) => {
      const normalizedPatch = {
        ...patch,
        ...(patch.glassOpacity === undefined
          ? {}
          : { glassOpacity: Math.max(POPUP_FROSTED_MIN_OPACITY, patch.glassOpacity) }),
        ...(patch.glassBlur === undefined
          ? {}
          : { glassBlur: Math.min(POPUP_FROSTED_BLUR_MAX, Math.max(POPUP_FROSTED_BLUR_MIN, patch.glassBlur)) })
      }

      setAppearance(prev => ({ ...prev, ...normalizedPatch }))
      pendingAppearancePatch.current = { ...pendingAppearancePatch.current, ...normalizedPatch }

      if (appearancePersistTimer.current !== null) {
        window.clearTimeout(appearancePersistTimer.current)
      }

      appearancePersistTimer.current = window.setTimeout(() => {
        appearancePersistTimer.current = null
        const nextPatch = pendingAppearancePatch.current
        pendingAppearancePatch.current = {}
        void ht?.settings?.set(nextPatch as unknown as Record<string, unknown>)
      }, 100)
    },
    [ht]
  )

  useEffect(() => () => {
    if (appearancePersistTimer.current !== null) {
      window.clearTimeout(appearancePersistTimer.current)
      appearancePersistTimer.current = null
    }

    const nextPatch = pendingAppearancePatch.current
    pendingAppearancePatch.current = {}
    if (Object.keys(nextPatch).length > 0) {
      void ht?.settings?.set(nextPatch as unknown as Record<string, unknown>)
    }
  }, [ht])

  /** 开关内嵌设置面板；主进程记录原始窗口边界并按工作区展开/恢复。 */
  const togglePanel = () => {
    const next = !panelOpen
    setPanelOpen(next)
    ht?.popup?.setSettingsOpen(next)
  }

  /** 面板保持开启；只有关闭按钮/Settings 按钮或点击面板以外区域才收起。 */
  const closePanelFromOutside = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!panelOpen) return

    const target = event.target as HTMLElement
    if (target.closest('.settings-panel') || target.closest('[data-popup-settings-trigger]')) return

    setPanelOpen(false)
    ht?.popup?.setSettingsOpen(false)
  }

  const closePopup = () => {
    if (panelOpen) {
      setPanelOpen(false)
      ht?.popup?.setSettingsOpen(false)
    }
    ht?.popup?.close()
  }

  /** 只负责移动窗口；resize 由 Windows 原生窗口边缘处理。 */
  const onDragStart = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest('button')) {
      return
    }

    event.preventDefault()
    dragPointerId.current = event.pointerId
    event.currentTarget.setPointerCapture(event.pointerId)
    ht?.popup?.dragStart(event.screenX, event.screenY)
  }

  const onDragMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragPointerId.current !== event.pointerId || !(event.buttons & 1)) {
      return
    }

    ht?.popup?.dragMove(event.screenX, event.screenY)
  }

  const onDragEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragPointerId.current !== event.pointerId) {
      return
    }

    dragPointerId.current = null
    ht?.popup?.dragEnd()
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  /** 只有右下角专用把手可以调整尺寸，与 Header 移动路径完全隔离。 */
  const onResizeStart = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return

    event.preventDefault()
    event.stopPropagation()
    resizePointerId.current = event.pointerId
    event.currentTarget.setPointerCapture(event.pointerId)
    ht?.popup?.resizeStart(event.screenX, event.screenY)
  }

  const onResizeMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (resizePointerId.current !== event.pointerId || !(event.buttons & 1)) return

    event.preventDefault()
    event.stopPropagation()
    ht?.popup?.resizeMove(event.screenX, event.screenY)
  }

  const onResizeEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (resizePointerId.current !== event.pointerId) return

    event.preventDefault()
    event.stopPropagation()
    resizePointerId.current = null
    ht?.popup?.resizeEnd()
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  /* ------------------------------------------------ 动作 */

  const togglePin = () => {
    const next = !pinned
    setPinned(next)
    ht?.popup?.setPinned(next)
  }

  /** 复制译文；按钮短暂变成对勾作为成功反馈（HCI：系统状态可见）。 */
  const copyTranslation = () => {
    if (!data) return
    const text = data.status === 'result' ? data.translatedText ?? '' : data.originalText
    if (text) {
      ht?.popup?.copy(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1200)
    }
  }

  /** Windows TTS 朗读：en = 原文，zh = 译文；再次点击同一按钮 = 停止。 */
  const speak = (lang: 'en' | 'zh') => {
    if (!data || !ht?.popup) {
      return
    }

    if (speaking === lang) {
      ht.popup.stopSpeaking()
      setSpeaking(null)
      return
    }

    const text = lang === 'en' ? originalInput : data.translatedText ?? ''

    if (data.status !== 'result' && lang === 'zh') {
      return
    }

    if (!text) {
      return
    }

    ht.popup.speak(text, lang)
    setSpeaking(lang)
  }

  const translateAnyway = () => {
    if (data) {
      ht?.popup?.translateAnyway(data.id)
    }
  }

  const submitOriginal = () => {
    const text = originalInput.trim()

    if (text) {
      ht?.popup?.translateInput(text)
    }
  }

  /** 输入停止片刻后自动翻译最新原文，避免每个按键都触发请求。 */
  const scheduleOriginalTranslation = (value: string) => {
    if (inputTranslateTimer.current !== null) {
      window.clearTimeout(inputTranslateTimer.current)
      inputTranslateTimer.current = null
    }

    const text = value.trim()

    if (!text || DEMO_MODE || !ht?.popup) {
      return
    }

    inputTranslateTimer.current = window.setTimeout(() => {
      inputTranslateTimer.current = null
      ht.popup?.translateInput(text)
    }, 450)
  }

  const showOriginal = appearance.showOriginal
  const language = appearance.uiLanguage
  const isLoading = data?.status === 'loading'
  const isError = data?.status === 'error'

  return (
    <div
      className={`popup-root${closing ? ' popup-closing' : ''}`}
      style={{
        // 字体与颜色全部走 CSS 变量，整个卡片即时生效
        ['--ht-en-font' as string]: englishFontStack(appearance.englishFontFamily),
        ['--ht-zh-font' as string]: chineseFontStack(appearance.chineseFontFamily),
        ['--ht-en-size' as string]: `${appearance.englishFontSize}px`,
        ['--ht-zh-size' as string]: `${appearance.chineseFontSize}px`,
        ['--ht-original-color' as string]: appearance.originalTextColor,
        ['--ht-translation-color' as string]: appearance.translationTextColor,
        ['--ht-accent' as string]: '#96d2ff'
      }}
      onMouseEnter={() => !DEMO_MODE && ht?.popup?.mouseEnter()}
      onMouseLeave={() => !DEMO_MODE && ht?.popup?.mouseLeave()}
      onPointerDownCapture={closePanelFromOutside}
    >
      {/* 与 Main page 相同：窗口自己的背景表面，供 backdrop-filter 取样。 */}
      <div className="popup-window-surface" aria-hidden="true" />
      {DEMO_BG && <div className="demo-backdrop" />}

      {/* 1. 窗口 = 弹窗卡片本身 */}
      <LiquidGlass
        radius={15}
        tintAlpha={Math.max(POPUP_FROSTED_MIN_OPACITY, appearance.glassOpacity)}
        tintColor="#47494f"
        blur={appearance.glassBlur}
        className="popup-card"
      >
        {/* 2. header：玻璃拖动头（标题/副标题/把手 + 图钉 + 关闭） */}
        <div
          className="pop-header"
          onPointerDown={onDragStart}
          onPointerMove={onDragMove}
          onPointerUp={onDragEnd}
          onPointerCancel={onDragEnd}
        >
          <div className="pop-titles">
            <span className="pop-title">{uiText(language, 'popupTitle')}</span>
            <span className="pop-sub">{uiText(language, 'popupSub')}</span>
          </div>
          <span className="pop-grip">⋮⋮</span>
          <span className="spacer" />
          <button className={`mini-btn ${pinned ? 'active' : ''}`} title={uiText(language, 'pin')} onClick={togglePin}>
            <svg viewBox="0 0 24 24">
              <path d="M12 17v5" />
              <path d="M9 4h6l-1 7 3 3H7l3-3z" />
            </svg>
          </button>
          <button className="mini-btn" title={`${uiText(language, 'close')} (Esc)`} onClick={closePopup}>
            <svg viewBox="0 0 24 24">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        {/* 3+4. 中部容器：原文区与译文区是两个独立 div，平分剩余空间 */}
        <div className="pop-body">
          {/* 3. 原文区：既显示高亮原文，也允许直接编辑后重新翻译 */}
          <div className={`text-row ${showOriginal ? '' : 'row-hidden'}`}>
            <div className="original-input-wrap">
              <label className="input-label" htmlFor="original-input">
                {uiText(language, 'inputOriginal')}
              </label>
              <textarea
                id="original-input"
                className="original-input"
                value={originalInput}
                placeholder={uiText(language, 'inputOriginalPlaceholder')}
                spellCheck={false}
                onPointerDown={event => {
                  event.stopPropagation()
                  window.focus()
                  event.currentTarget.focus()
                }}
                onChange={event => {
                  const value = event.target.value
                  setOriginalInput(value)
                  scheduleOriginalTranslation(value)
                }}
                onKeyDown={event => {
                  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                    event.preventDefault()
                    if (inputTranslateTimer.current !== null) {
                      window.clearTimeout(inputTranslateTimer.current)
                      inputTranslateTimer.current = null
                    }
                    submitOriginal()
                  }
                }}
              />
            </div>
            <button
              className={`speech-btn ${speaking === 'en' ? 'active' : ''}`}
              title={uiText(language, 'readEnglish')}
              onClick={() => speak('en')}
            >
              <svg viewBox="0 0 24 24">
                <path d="M11 5 6.8 8.5H4.5A1.5 1.5 0 0 0 3 10v4a1.5 1.5 0 0 0 1.5 1.5h2.3L11 19V5Z" />
                <path d="M14.5 9a4 4 0 0 1 0 6" />
                <path d="M17 6.5a7.5 7.5 0 0 1 0 11" />
              </svg>
            </button>
          </div>

        {/* 4. 译文行（译文 + 中文朗读按钮） */}
        <div className="text-row">
          <div className="translated-text">
            {isLoading && <span className="loading-inline">{uiText(language, 'loading')}</span>}
            {isError && data && (
              <>
                <span className="error-inline">
                  {uiText(language, errorMessageKeys[data.errorCode ?? ''] ?? 'translateUnavailable')}
                </span>
                {data.canRetryAnyway && (
                  <button className="retry-btn" onClick={() => ht?.popup?.translateAnyway(data.id)}>
                    {data.errorCode === 'too_long'
                      ? uiText(language, 'translateAnyway')
                      : uiText(language, 'retry')}
                  </button>
                )}
              </>
            )}
            {data?.status === 'result' && data.translatedText}
            {!data && <span className="loading-inline">{uiText(language, 'waiting')}</span>}
          </div>
          <button
            className={`speech-btn ${speaking === 'zh' ? 'active' : ''}`}
            title={uiText(language, 'readChinese')}
            onClick={() => speak('zh')}
          >
            <svg viewBox="0 0 24 24">
              <path d="M11 5 6.8 8.5H4.5A1.5 1.5 0 0 0 3 10v4a1.5 1.5 0 0 0 1.5 1.5h2.3L11 19V5Z" />
              <path d="M14.5 9a4 4 0 0 1 0 6" />
              <path d="M17 6.5a7.5 7.5 0 0 1 0 11" />
            </svg>
          </button>
        </div>

        </div>

        {/* 5. 动作行：固定窗口底部 */}
        <div className="action-row">
          <button className={`action-btn ${copied ? 'copied' : ''}`} onClick={copyTranslation}>
            {copied ? (
              <svg viewBox="0 0 24 24">
                <path d="m5 12 4 4L19 6" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24">
                <rect x="8" y="8" width="11" height="11" rx="2" />
                <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
              </svg>
            )}
            <span>{copied ? uiText(language, 'copied') : uiText(language, 'copy')}</span>
          </button>
          <button
            className={`action-btn ${panelOpen ? 'active' : ''}`}
            data-popup-settings-trigger
            onClick={togglePanel}
          >
            <svg viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="3" />
              <path d="M19 12a7 7 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 0 0-2-1.2L14 3h-4l-.5 2.6a7 7 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 2 1.2L10 21h4l.5-2.6a7 7 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z" />
            </svg>
             <span>{uiText(language, 'settings')}</span>
          </button>
        </div>

        {/* 内嵌设置面板：保持无底色毛玻璃，只保留边框和内容层 */}
        {panelOpen && (
          <LiquidGlass
            radius={16}
            tintAlpha={0}
            tintColor="#47494f"
            blur={appearance.glassBlur}
            className="settings-panel"
          >
            <div className="panel-head">
              <div>
                 <div className="panel-title">{uiText(language, 'appearance')}</div>
                 <div className="panel-sub">{uiText(language, 'customizePopup')}</div>
              </div>
               <button className="panel-close" title={uiText(language, 'close')} onClick={togglePanel}>
                ✕
              </button>
            </div>

            <label className="toggle-row">
              <span className="toggle-copy">
                 <span className="toggle-title">{uiText(language, 'showEnglishOriginal')}</span>
                 <span className="toggle-sub">{uiText(language, 'showEnglishOriginalSub')}</span>
              </span>
              <input
                type="checkbox"
                checked={appearance.showOriginal}
                onChange={e => patchAppearance({ showOriginal: e.target.checked })}
              />
              <span className="toggle-track">
                <span className="toggle-thumb" />
              </span>
            </label>

            <div className="panel-item">
              <div className="panel-label">{uiText(language, 'themePresets')}</div>
              <div className="panel-sub">{uiText(language, 'themePresetsSub')}</div>
              <div className="panel-presets">
                {POPUP_THEME_PRESETS.map(preset => (
                  <button
                    className="preset-btn"
                    key={preset.key}
                    type="button"
                    onClick={() => patchAppearance(preset.values)}
                  >
                    <span
                      className="preset-font-preview"
                      style={{ fontFamily: englishFontStack(preset.values.englishFontFamily) }}
                    >
                      Aa
                    </span>
                    <span>{uiText(language, `theme${preset.key[0].toUpperCase()}${preset.key.slice(1)}` as UiTextKey)}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="panel-grid">
              <div className="panel-item">
                <div className="range-head">
                  <label>{uiText(language, 'glassOpacity')}</label>
                  <span className="range-value">{Math.round(appearance.glassOpacity * 100)}%</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={0.9}
                  step={0.02}
                  value={appearance.glassOpacity}
                  onChange={e => patchAppearance({ glassOpacity: Number(e.target.value) })}
                />
              </div>
              <div className="panel-item">
                <div className="range-head">
                  <label>{uiText(language, 'glassBlur')}</label>
                  <span className="range-value">{appearance.glassBlur}px</span>
                </div>
                <input
                  type="range"
                  min={POPUP_FROSTED_BLUR_MIN}
                  max={POPUP_FROSTED_BLUR_MAX}
                  step={1}
                  value={appearance.glassBlur}
                  onChange={e => patchAppearance({ glassBlur: Number(e.target.value) })}
                />
              </div>
            </div>

            <div className="panel-grid">
              <div className="panel-item">
                   <label>{uiText(language, 'englishFont')}</label>
                <select
                  className="panel-select"
                  value={appearance.englishFontFamily}
                  onChange={e => patchAppearance({ englishFontFamily: e.target.value })}
                >
                  {Object.entries(EN_FONT_STACKS).map(([value, f]) => (
                    <option key={value} value={value}>
                      {f.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="panel-item">
                <label>{uiText(language, 'chineseFont')}</label>
                <select
                  className="panel-select zh-select"
                  value={appearance.chineseFontFamily}
                  onChange={e => patchAppearance({ chineseFontFamily: e.target.value })}
                >
                  {Object.entries(ZH_FONT_STACKS).map(([value, f]) => (
                    <option key={value} value={value}>
                      {f.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="panel-grid">
              <div className="panel-item">
                 <div className="range-head">
                   <label>{uiText(language, 'englishSize')}</label>
                  <span className="range-value">{appearance.englishFontSize}px</span>
                </div>
                <input
                  type="range"
                  min={11}
                  max={22}
                  step={1}
                  value={appearance.englishFontSize}
                  onChange={e => patchAppearance({ englishFontSize: Number(e.target.value) })}
                />
              </div>
              <div className="panel-item">
                <div className="range-head">
                   <label>{uiText(language, 'chineseSize')}</label>
                  <span className="range-value">{appearance.chineseFontSize}px</span>
                </div>
                <input
                  type="range"
                  min={12}
                  max={24}
                  step={1}
                  value={appearance.chineseFontSize}
                  onChange={e => patchAppearance({ chineseFontSize: Number(e.target.value) })}
                />
              </div>
            </div>

            <div className="panel-colors">
              <ColorPick
                 label={uiText(language, 'english')}
                value={appearance.originalTextColor}
                onChange={v => patchAppearance({ originalTextColor: v })}
              />
              <ColorPick
                 label={uiText(language, 'chinese')}
                value={appearance.translationTextColor}
                onChange={v => patchAppearance({ translationTextColor: v })}
              />
            </div>

            <button
              className="reset-btn"
              onClick={() =>
                patchAppearance({
                  showOriginal: true,
                  glassOpacity: 0,
                  glassBlur: POPUP_FROSTED_BLUR,
                  englishFontFamily: 'segoe',
                  chineseFontFamily: 'yahei',
                  englishFontSize: 13,
                  chineseFontSize: 15,
                  originalTextColor: '#ffffff',
                  translationTextColor: '#ffffff',
                  glassColor: '#ffffff'
                })
              }
            >
              {uiText(language, 'reset')}
            </button>
          </LiquidGlass>
        )}
      </LiquidGlass>
      {!panelOpen && (
        <div
          className="resize-grip"
          title={uiText(language, 'resizePopup')}
          onPointerDown={onResizeStart}
          onPointerMove={onResizeMove}
          onPointerUp={onResizeEnd}
          onPointerCancel={onResizeEnd}
        >
          <svg viewBox="0 0 24 24">
            <path d="M7 17 17 7" />
            <path d="M12 19 19 12" />
            <path d="M17 19 19 17" />
          </svg>
        </div>
      )}
    </div>
  )
}

/** 调色盘：色块内嵌原生取色器。 */
function ColorPick(props: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="panel-color">
      <span className="swatch-dot" style={{ background: props.value }}>
        <input type="color" value={props.value} onChange={e => props.onChange(e.target.value)} />
      </span>
      <span className="swatch-label">{props.label}</span>
    </label>
  )
}
