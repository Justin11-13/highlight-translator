import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { DEFAULT_SETTINGS, EN_FONT_STACKS, englishFontStack, MIN_GLASS_BLUR, POPUP_FROSTED_BLUR_MAX, POPUP_FROSTED_BLUR_MIN, POPUP_SIZE, POPUP_THEME_PRESETS, ZH_FONT_STACKS } from '../../shared/types'
import type { BackgroundPurpose, HistoryRow, ModelKey, Settings, UiLanguage } from '../../shared/types'
import { uiText } from '../../shared/i18n'
import type { UiTextKey } from '../../shared/i18n'
import { LiquidGlass } from '../shared/LiquidGlass'

type TabKey = 'general' | 'translation' | 'appearance' | 'behaviour' | 'models' | 'history'

const TABS: Array<{ key: TabKey; text: UiTextKey }> = [
  { key: 'general', text: 'general' },
  { key: 'translation', text: 'translation' },
  { key: 'appearance', text: 'appearance' },
  { key: 'behaviour', text: 'behaviour' },
  { key: 'models', text: 'modelsService' },
  { key: 'history', text: 'history' }
]

// 支持 ?tab=appearance 直达（截图/演示用）
const initialTab = (() => {
  const tab = new URLSearchParams(window.location.search).get('tab') as TabKey | null
  return TABS.some(t => t.key === tab) ? tab! : 'general'
})()

const initialAppearanceScope: 'main' | 'popup' =
  new URLSearchParams(window.location.search).get('scope') === 'popup' ? 'popup' : 'main'

function ht(): NonNullable<Window['ht']> | undefined {
  return (window as unknown as { ht?: NonNullable<Window['ht']> }).ht
}

/** 自定义背景图 URL：'default' -> null，文件名 -> htimg:// 地址。 */
function backgroundUrl(value: string | undefined): string | null {
  if (!value || value === 'default') {
    return null
  }

  return `htimg://bg/${value}`
}

export default function App() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [tab, setTab] = useState<TabKey>(initialTab)
  const [maximized, setMaximized] = useState(false)
  const persistTimer = useRef<number | null>(null)
  const pendingPatch = useRef<Partial<Settings>>({})

  // 加载设置；无桥接（截图/预览）时用默认值渲染
  useEffect(() => {
    const bridge = ht()

    if (bridge?.settings) {
      void bridge.settings.get().then(setSettings)
    } else {
      setSettings(DEFAULT_SETTINGS)
    }
  }, [])


  // 同步自定义标题栏的最大化/还原状态；窗口仍由主进程负责实际控制。
  useEffect(() => {
    const bridge = ht()?.settings

    if (!bridge) {
      return
    }

    let active = true
    void bridge.getWindowState().then(state => {
      if (active) {
        setMaximized(state.maximized)
      }
    })

    return bridge.onWindowState(state => setMaximized(state.maximized))
  }, [])

  // 乐观更新 + 主进程持久化（副作用如开机自启由主进程处理）
  const update = useCallback((patch: Partial<Settings>) => {
    setSettings(prev => (prev ? { ...prev, ...patch } : prev))
    ht()?.settings?.previewAppearance(patch as Record<string, unknown>)
    pendingPatch.current = { ...pendingPatch.current, ...patch }

    if (persistTimer.current !== null) {
      window.clearTimeout(persistTimer.current)
    }

    persistTimer.current = window.setTimeout(() => {
      persistTimer.current = null
      const nextPatch = pendingPatch.current
      pendingPatch.current = {}
      void ht()?.settings?.set(nextPatch as Record<string, unknown>)
    }, 100)
  }, [])

  useEffect(() => () => {
    if (persistTimer.current !== null) {
      window.clearTimeout(persistTimer.current)
      persistTimer.current = null
    }

    const nextPatch = pendingPatch.current
    pendingPatch.current = {}
    if (Object.keys(nextPatch).length > 0) {
      void ht()?.settings?.set(nextPatch as Record<string, unknown>)
    }
  }, [])

  // 设置窗口只使用自己的主窗口外观；popup 字体与颜色不再污染这里。
  const themeStyle = settings
    ? ({
        ['--ht-accent' as string]: '#96d2ff'
      } as CSSProperties)
    : undefined

  if (!settings) {
    return <div className="settings-root" />
  }

  const settingsBg = backgroundUrl(settings.settingsBackground)
  const language = settings.uiLanguage

  return (
    <div className="settings-root" style={themeStyle}>
      {settingsBg && <div className="settings-bg" style={{ backgroundImage: `url("${settingsBg}")` }} />}

      <div
        className="settings-titlebar"
        onDoubleClick={event => {
          if (!(event.target as HTMLElement).closest('button')) {
            ht()?.settings?.toggleMaximize()
          }
        }}
      >
        <div className="settings-titlegroup">
          <h1>{uiText(language, 'appName')}</h1>
          <span>{uiText(language, 'appearanceSub')}</span>
        </div>
        <span className="spacer" />
        <div className="settings-window-controls">
          <button className="titlebar-btn" title={uiText(language, 'minimize')} onClick={() => ht()?.settings?.minimize()}>
            <svg viewBox="0 0 24 24">
              <path d="M5 12h14" />
            </svg>
          </button>
          <button
            className="titlebar-btn"
            title={uiText(language, maximized ? 'restore' : 'maximize')}
            onClick={() => ht()?.settings?.toggleMaximize()}
          >
            <svg viewBox="0 0 24 24">
              {maximized ? <path d="M8 8h10v10M6 16V6h10" /> : <path d="M6 6h12v12H6z" />}
            </svg>
          </button>
          <button className="titlebar-btn titlebar-close" title={uiText(language, 'close')} onClick={() => window.close()}>
            <svg viewBox="0 0 24 24">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
      </div>

      <LiquidGlass
        radius={20}
        // 主体与 Header 使用同一套玻璃组件；Appearance 的参数完整直通，
        // 调整 opacity / blur / color 后立即反映到这张卡片。
        tintAlpha={settings.mainGlassOpacity}
        tintColor={settings.mainGlassColor}
        blur={Math.max(MIN_GLASS_BLUR, settings.mainGlassBlur)}
        className="settings-panel"
      >
        <nav className="settings-nav">
          {TABS.map(t => (
            <button key={t.key} className={tab === t.key ? 'active' : ''} onClick={() => setTab(t.key)}>
              {uiText(language, t.text)}
            </button>
          ))}
        </nav>

        <div className="settings-content">
          {tab === 'general' && <General settings={settings} update={update} language={language} />}
          {tab === 'translation' && <Translation settings={settings} update={update} language={language} />}
          {tab === 'appearance' && <Appearance settings={settings} update={update} language={language} />}
          {tab === 'behaviour' && <Behaviour settings={settings} update={update} language={language} />}
          {tab === 'models' && <Models language={language} />}
          {tab === 'history' && <History settings={settings} update={update} language={language} />}
        </div>
      </LiquidGlass>
    </div>
  )
}

/* ------------------------------------------------------------ 各设置分区 */

interface SectionProps {
  settings: Settings
  update: (patch: Partial<Settings>) => void
  language: UiLanguage
}

function General({ settings, update, language }: SectionProps) {
  const running = settings.autoTranslate

  return (
    <section className="settings-section">
      <h2>{uiText(language, 'general')}</h2>
      <p className="section-sub">{uiText(language, 'generalSub')}</p>

      {/* 启动/停止按钮：醒目的一级控制，等同托盘与划词开关 */}
      <div className={`start-row ${running ? 'running' : ''}`}>
        <button
          className={`start-btn ${running ? 'running' : ''}`}
          onClick={() => update({ autoTranslate: !running })}
        >
          {running ? uiText(language, 'stopTranslator') : uiText(language, 'startTranslator')}
        </button>
        <div className="start-info">
          <strong>{running ? uiText(language, 'translatorRunning') : uiText(language, 'translatorStopped')}</strong>
          <small>
            {running
               ? uiText(language, 'runningHint')
               : uiText(language, 'stoppedHint')}
          </small>
        </div>
        <span className={`status ${running ? '' : 'off'}`}>{running ? uiText(language, 'running') : uiText(language, 'stopped')}</span>
      </div>

      <SwitchRow
        title={uiText(language, 'launchAtStartup')}
        subtitle={uiText(language, 'launchAtStartupSub')}
        checked={settings.launchAtStartup}
        onChange={v => update({ launchAtStartup: v })}
      />
      <SwitchRow
        title={uiText(language, 'startMinimized')}
        subtitle={uiText(language, 'startMinimizedSub')}
        checked={settings.startMinimized}
        onChange={v => update({ startMinimized: v })}
      />
      <SelectRow
        title={uiText(language, 'popupVisibility')}
        subtitle={uiText(language, 'popupVisibilitySub')}
        value={settings.popupMode}
        options={[
          { value: 'on-selection', label: uiText(language, 'showOnHighlight') },
          { value: 'pinned', label: uiText(language, 'keepPinnedOpen') }
        ]}
        onChange={v => update({ popupMode: v as Settings['popupMode'] })}
      />

      <div className="switch-row">
        <div>
          <strong>{uiText(language, 'previewPopup')}</strong>
          <small>{uiText(language, 'previewPopupSub')}</small>
        </div>
        <button className="glass-btn" onClick={() => ht()?.settings?.openPopupTest()}>
          {uiText(language, 'showPopup')}
        </button>
      </div>
      <SelectRow
        title={uiText(language, 'interfaceLanguage')}
        subtitle={uiText(language, 'interfaceLanguageSub')}
        value={settings.uiLanguage}
        options={[
          { value: 'en', label: uiText(language, 'english') },
          { value: 'zh', label: uiText(language, 'chinese') }
        ]}
        onChange={v => update({ uiLanguage: v as UiLanguage })}
      />
    </section>
  )
}

function Translation({ settings, update, language }: SectionProps) {
  return (
    <section className="settings-section">
      <h2>{uiText(language, 'translation')}</h2>
      <p className="section-sub">{uiText(language, 'translationSub')}</p>

      <SelectRow
        title={uiText(language, 'targetLanguage')}
        subtitle={uiText(language, 'targetLanguageSub')}
        value={settings.targetLanguage}
        options={[
          { value: 'zh', label: uiText(language, 'chineseSimplified') },
          { value: 'en', label: uiText(language, 'english') }
        ]}
        onChange={v => update({ targetLanguage: v as Settings['targetLanguage'] })}
      />
      <SliderRow
        title={uiText(language, 'minimumSelection')}
        subtitle={uiText(language, 'minimumSelectionSub')}
        min={1}
        max={10}
        step={1}
        value={settings.minChars}
        format={v => `${v} ${uiText(language, 'chars')}`}
        onChange={v => update({ minChars: v })}
      />
      <SliderRow
        title={uiText(language, 'maximumSelection')}
        subtitle={uiText(language, 'maximumSelectionSub')}
        min={500}
        max={8000}
        step={100}
        value={settings.maxChars}
        format={v => `${v} ${uiText(language, 'chars')}`}
        onChange={v => update({ maxChars: v })}
      />
      <SwitchRow
        title={uiText(language, 'clipboardFallback')}
        subtitle={uiText(language, 'clipboardFallbackSub')}
        checked={settings.clipboardFallback}
        onChange={v => update({ clipboardFallback: v })}
      />
    </section>
  )
}

type AppearanceScope = 'main' | 'popup'

interface AppearanceSubProps extends SectionProps {
  pick: (purpose: BackgroundPurpose) => Promise<void>
  reset: (purpose: BackgroundPurpose) => void
}

/** 外观分区：主设置窗口与翻译 popup 使用两套互不影响的外观参数。 */
function Appearance({ settings, update, language }: SectionProps) {
  const [scope, setScope] = useState<AppearanceScope>(initialAppearanceScope)

  const pick = async (purpose: BackgroundPurpose) => {
    const name = await ht()?.appearance?.pickImage(purpose)

    if (name) {
      update(purpose === 'popup' ? { popupBackground: name } : { settingsBackground: name })
    }
  }

  const reset = (purpose: BackgroundPurpose) => {
    void ht()?.appearance?.resetImage(purpose)
    update(purpose === 'popup' ? { popupBackground: 'default' } : { settingsBackground: 'default' })
  }

  return (
    <section className="settings-section">
      <h2>{uiText(language, 'appearance')}</h2>
      <p className="section-sub">{uiText(language, 'appearanceSub')}</p>

      <div className="appearance-switcher" role="tablist" aria-label={uiText(language, 'appearance')}>
        <button
          role="tab"
          aria-selected={scope === 'main'}
          className={scope === 'main' ? 'active' : ''}
          onClick={() => setScope('main')}
        >
          {uiText(language, 'mainWindow')}
        </button>
        <button
          role="tab"
          aria-selected={scope === 'popup'}
          className={scope === 'popup' ? 'active' : ''}
          onClick={() => setScope('popup')}
        >
          {uiText(language, 'popupWindow')}
        </button>
      </div>

      <div className="appearance-scope-description">
        <strong>{uiText(language, scope === 'main' ? 'mainWindow' : 'popupWindow')}</strong>
        <small>{uiText(language, scope === 'main' ? 'mainWindowSub' : 'popupWindowSub')}</small>
      </div>

      {scope === 'main' ? (
        <MainAppearance settings={settings} update={update} language={language} pick={pick} reset={reset} />
      ) : (
        <PopupAppearanceSettings settings={settings} update={update} language={language} pick={pick} reset={reset} />
      )}
    </section>
  )
}

function MainAppearance({ settings, update, language, pick, reset }: AppearanceSubProps) {
  return (
    <>
      <SliderRow
        title={uiText(language, 'mainGlassOpacity')}
        subtitle={uiText(language, 'mainGlassOpacitySub')}
        // 主窗口要能调回 Header 的 7% 参数；这里不能复用 popup 的 82% 下限。
        min={0.02}
        max={0.9}
        step={0.02}
        value={settings.mainGlassOpacity}
        format={v => `${Math.round(v * 100)}%`}
        onChange={v => update({ mainGlassOpacity: v })}
      />
      <SliderRow
        title={uiText(language, 'mainGlassBlur')}
        subtitle={uiText(language, 'mainGlassBlurSub')}
        min={MIN_GLASS_BLUR}
        max={30}
        step={1}
        value={settings.mainGlassBlur}
        format={v => `${v} px`}
        onChange={v => update({ mainGlassBlur: v })}
      />
      <ColorRow
        title={uiText(language, 'mainGlassColor')}
        subtitle={uiText(language, 'mainGlassColorSub')}
        value={settings.mainGlassColor}
        onChange={v => update({ mainGlassColor: v })}
      />
      <ImageRow
        title={uiText(language, 'settingsBackground')}
        subtitle={uiText(language, 'settingsBackgroundSub')}
        value={settings.settingsBackground}
        language={language}
        onPick={() => void pick('settings')}
        onReset={() => reset('settings')}
      />
    </>
  )
}

function PopupAppearanceSettings({ settings, update, language }: AppearanceSubProps) {
  return (
    <>
      <div className="theme-presets">
        <div className="theme-presets-head">
          <div>
            <strong>{uiText(language, 'themePresets')}</strong>
            <small>{uiText(language, 'themePresetsSub')}</small>
          </div>
        </div>
        <div className="theme-preset-grid">
          {POPUP_THEME_PRESETS.map(preset => (
            <button
              className="theme-preset"
              key={preset.key}
              type="button"
              onClick={() => update(preset.values)}
            >
              <span
                className="theme-preset-font"
                aria-hidden="true"
                style={{ fontFamily: englishFontStack(preset.values.englishFontFamily) }}
              >
                Aa
              </span>
              <span>{uiText(language, `theme${preset.key[0].toUpperCase()}${preset.key.slice(1)}` as UiTextKey)}</span>
            </button>
          ))}
        </div>
      </div>
      <SliderRow
        title={uiText(language, 'glassOpacity')}
        subtitle={uiText(language, 'glassOpacitySub')}
        min={0}
        max={0.9}
        step={0.02}
        value={settings.glassOpacity}
        format={v => `${Math.round(v * 100)}%`}
        onChange={v => update({ glassOpacity: v })}
      />
      <SliderRow
        title={uiText(language, 'glassBlur')}
        subtitle={uiText(language, 'glassBlurSub')}
        min={POPUP_FROSTED_BLUR_MIN}
        max={POPUP_FROSTED_BLUR_MAX}
        step={1}
        value={settings.glassBlur}
        format={v => `${v} px`}
        onChange={v => update({ glassBlur: v })}
      />
      <div className="switch-row">
        <div>
          <strong>{uiText(language, 'popupSize')}</strong>
          <small>{uiText(language, 'popupSizeSub')}</small>
        </div>
        <div className="slider-wrap popup-size-wrap">
          <input
            type="range"
            min={380}
            max={900}
            step={10}
            value={settings.popupWidth}
            onChange={e => update({ popupWidth: Number(e.target.value) })}
          />
          <input
            type="range"
            min={240}
            max={640}
            step={10}
            value={settings.popupHeight}
            onChange={e => update({ popupHeight: Number(e.target.value) })}
          />
          <span className="value">{Math.round(settings.popupWidth)}×{Math.round(settings.popupHeight)}</span>
        </div>
      </div>
      <SwitchRow
        title={uiText(language, 'showOriginal')}
        subtitle={uiText(language, 'showOriginalSub')}
        checked={settings.showOriginal}
        onChange={v => update({ showOriginal: v })}
      />
      <SelectRow
        title={uiText(language, 'englishFont')}
        subtitle={uiText(language, 'englishFontSub')}
        value={settings.englishFontFamily}
        options={Object.entries(EN_FONT_STACKS).map(([value, f]) => ({ value, label: f.label }))}
        onChange={v => update({ englishFontFamily: v })}
      />
      <SelectRow
        title={uiText(language, 'chineseFont')}
        subtitle={uiText(language, 'chineseFontSub')}
        value={settings.chineseFontFamily}
        options={Object.entries(ZH_FONT_STACKS).map(([value, f]) => ({ value, label: f.label }))}
        onChange={v => update({ chineseFontFamily: v })}
      />
      <SliderRow
        title={uiText(language, 'englishSize')}
        subtitle={uiText(language, 'englishSizeSub')}
        min={11}
        max={22}
        step={1}
        value={settings.englishFontSize}
        format={v => `${v} px`}
        onChange={v => update({ englishFontSize: v })}
      />
      <SliderRow
        title={uiText(language, 'chineseSize')}
        subtitle={uiText(language, 'chineseSizeSub')}
        min={12}
        max={24}
        step={1}
        value={settings.chineseFontSize}
        format={v => `${v} px`}
        onChange={v => update({ chineseFontSize: v })}
      />
      <ColorRow
        title={uiText(language, 'englishTextColor')}
        subtitle={uiText(language, 'englishTextColorSub')}
        value={settings.originalTextColor}
        onChange={v => update({ originalTextColor: v })}
      />
      <ColorRow
        title={uiText(language, 'chineseTextColor')}
        subtitle={uiText(language, 'chineseTextColorSub')}
        value={settings.translationTextColor}
        onChange={v => update({ translationTextColor: v })}
      />
    </>
  )
}

function Behaviour({ settings, update, language }: SectionProps) {
  return (
    <section className="settings-section">
      <h2>{uiText(language, 'behaviour')}</h2>
      <p className="section-sub">{uiText(language, 'behaviourSub')}</p>

      <SliderRow
        title={uiText(language, 'autoHideDelay')}
        subtitle={uiText(language, 'autoHideDelaySub')}
        min={200}
        max={2000}
        step={50}
        value={settings.autoHideDelay}
        format={v => `${v} ms`}
        onChange={v => update({ autoHideDelay: v })}
      />
    </section>
  )
}

/** 模型与服务状态页：显示本地 LibreTranslate 服务与两个 Argos 语言对。 */
function Models({ language }: { language: UiLanguage }) {
  const [status, setStatus] = useState<{
    installed: Record<ModelKey, boolean>
    downloading: Record<ModelKey, boolean>
  } | null>(null)
  const [service, setService] = useState<{ installed: boolean; running: boolean } | null>(null)
  const [busy, setBusy] = useState<ModelKey | null>(null)
  const [setupBusy, setSetupBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(() => {
    void ht()?.models?.status().then(setStatus)
    void ht()?.models?.serviceStatus().then(setService)
  }, [])

  useEffect(() => {
    refresh()
    const off = ht()?.models?.onChanged(() => refresh())
    return () => off?.()
  }, [refresh])

  const download = async (key: ModelKey) => {
    setBusy(key)
    setError(null)

    try {
      await ht()?.models?.download(key)
      refresh()
    } catch (e) {
      setError(String((e as Error)?.message ?? e))
    } finally {
      setBusy(null)
    }
  }

  const setup = async () => {
    setSetupBusy(true)
    setError(null)

    try {
      await ht()?.models?.setup()
      refresh()
    } catch (e) {
      setError(String((e as Error)?.message ?? e))
    } finally {
      setSetupBusy(false)
    }
  }

  const pairLabel = (key: ModelKey) =>
    key === 'en-zh'
      ? `${uiText(language, 'english')} → ${uiText(language, 'chinese')}`
      : `${uiText(language, 'chinese')} → ${uiText(language, 'english')}`

  return (
    <section className="settings-section">
      <h2>{uiText(language, 'modelsService')}</h2>
      <p className="section-sub">{uiText(language, 'modelsSub')}</p>

      <div className="model-row">
        <div>
            <strong>{uiText(language, 'translationService')}</strong>
          <small>
            {service
              ? service.running
                 ? uiText(language, 'serviceRunning')
                 : uiText(language, 'serviceInstalled')
               : uiText(language, 'serviceMissing')}
          </small>
        </div>
          <span className={`status ${service?.running ? '' : 'off'}`}>
             {service?.running
               ? uiText(language, 'running')
               : service?.installed
                 ? uiText(language, 'installed')
                 : uiText(language, 'missing')}
          </span>
          <button className="glass-btn" disabled={setupBusy || busy !== null} onClick={() => void setup()}>
             {setupBusy
               ? uiText(language, 'installing')
               : service?.installed
                 ? uiText(language, 'repairEngine')
                 : uiText(language, 'installLocalEngine')}
          </button>
        </div>

      {(['en-zh', 'zh-en'] as ModelKey[]).map(key => (
        <div className="model-row" key={key}>
          <div>
            <strong>{pairLabel(key)}</strong>
            <small>{uiText(language, 'argosModel')}</small>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span className={`status ${status?.installed?.[key] ? '' : 'off'}`}>
               {status?.downloading?.[key] || busy === key
                 ? uiText(language, 'downloading')
                 : status?.installed?.[key]
                   ? uiText(language, 'installed')
                   : uiText(language, 'notInstalled')}
            </span>
            <button className="glass-btn" disabled={busy !== null || setupBusy} onClick={() => void download(key)}>
               {status?.installed?.[key] ? uiText(language, 'reinstall') : uiText(language, 'install')}
            </button>
          </div>
        </div>
      ))}

      {error && (
        <p className="section-sub" style={{ color: 'rgba(255,150,150,0.95)' }}>
          {uiText(language, 'installFailed')}: {error}
        </p>
      )}
    </section>
  )
}

/** 历史记录页：本地 SQLite，默认不保存（隐私优先）。 */
function History({ settings, update, language }: SectionProps) {
  const [rows, setRows] = useState<HistoryRow[] | null>(null)
  const [query, setQuery] = useState('')

  const reload = useCallback(() => {
    void ht()?.history?.list().then(setRows)
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  const filtered = (rows ?? []).filter(row => {
    if (!query.trim()) return true
    const q = query.toLowerCase()
    return (
      row.original_text.toLowerCase().includes(q) ||
      row.translated_text.toLowerCase().includes(q)
    )
  })

  const copy = (text: string) => {
    void navigator.clipboard?.writeText(text)
  }

  return (
    <section className="settings-section">
      <h2>{uiText(language, 'history')}</h2>
      <p className="section-sub">{uiText(language, 'historySub')}</p>

      <SwitchRow
        title={uiText(language, 'saveHistory')}
        subtitle={uiText(language, 'saveHistorySub')}
        checked={settings.saveHistory}
        onChange={v => update({ saveHistory: v })}
      />

      <div className="history-toolbar">
        <input
          placeholder={uiText(language, 'searchHistory')}
          value={query}
          onChange={e => setQuery(e.target.value)}
        />
        <button
          className="glass-btn danger"
          onClick={() => {
            void ht()?.history?.clear().then(reload)
          }}
        >
          {uiText(language, 'clearAll')}
        </button>
      </div>

      <div className="history-list">
        {filtered.length === 0 && <div className="history-empty">{uiText(language, 'noHistory')}</div>}
        {filtered.map(row => (
          <div className="history-item" key={row.id}>
            <div className="meta">
              <span>{new Date(row.created_at).toLocaleString()}</span>
              <span>·</span>
              <span>
                {row.source_language} → {row.target_language}
              </span>
              {row.application_name && (
                <>
                  <span>·</span>
                  <span>{row.application_name}</span>
                </>
              )}
            </div>
            <div className="original">{row.original_text}</div>
            <div className="translated">{row.translated_text}</div>
            <div className="actions">
              <button onClick={() => copy(row.translated_text)}>{uiText(language, 'copy')}</button>
              <button
                onClick={() => {
                  void ht()?.history?.remove(row.id).then(reload)
                }}
              >
                {uiText(language, 'delete')}
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

/* ------------------------------------------------------------ 玻璃控件 */

function SwitchRow(props: { title: string; subtitle: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="switch-row">
      <div>
        <strong>{props.title}</strong>
        <small>{props.subtitle}</small>
      </div>
      <label className="switch">
        <input type="checkbox" checked={props.checked} onChange={e => props.onChange(e.target.checked)} />
        <span className="switch-track" />
      </label>
    </div>
  )
}

function SliderRow(props: {
  title: string
  subtitle: string
  min: number
  max: number
  step: number
  value: number
  format: (v: number) => string
  onChange: (v: number) => void
}) {
  return (
    <div className="slider-row">
      <div>
        <strong>{props.title}</strong>
        <small>{props.subtitle}</small>
      </div>
      <div className="slider-wrap">
        <input
          type="range"
          min={props.min}
          max={props.max}
          step={props.step}
          value={props.value}
          onInput={e => props.onChange(Number(e.currentTarget.value))}
        />
        <span className="value">{props.format(props.value)}</span>
      </div>
    </div>
  )
}

function SelectRow(props: {
  title: string
  subtitle: string
  value: string
  options: Array<{ value: string; label: string }>
  onChange: (v: string) => void
}) {
  return (
    <div className="select-row">
      <div>
        <strong>{props.title}</strong>
        <small>{props.subtitle}</small>
      </div>
      <select value={props.value} onChange={e => props.onChange(e.target.value)}>
        {props.options.map(o => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  )
}

/** 调色盘行：原生取色器 + 当前色块预览 + HEX 值。 */
function ColorRow(props: { title: string; subtitle: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="color-row">
      <div>
        <strong>{props.title}</strong>
        <small>{props.subtitle}</small>
      </div>
      <div className="color-wrap">
        <span className="hex">{props.value.toUpperCase()}</span>
        <label className="swatch" style={{ background: props.value }}>
          <input
            type="color"
            value={props.value}
            onChange={e => props.onChange(e.target.value)}
          />
        </label>
      </div>
    </div>
  )
}

/** 背景图行：选择文件 + 恢复默认 + 缩略预览。 */
function ImageRow(props: {
  title: string
  subtitle: string
  value: string
  language: UiLanguage
  onPick: () => void
  onReset: () => void
}) {
  const url = backgroundUrl(props.value)

  return (
    <div className="image-row">
      <div>
        <strong>{props.title}</strong>
        <small>{props.subtitle}</small>
        <div className="image-actions">
          <button className="glass-btn" onClick={props.onPick}>
            {uiText(props.language, 'chooseImage')}
          </button>
          {url && (
            <button className="glass-btn" onClick={props.onReset}>
              {uiText(props.language, 'useDefault')}
            </button>
          )}
        </div>
      </div>
      <div
        className="image-thumb"
        style={url ? { backgroundImage: `url("${url}")` } : undefined}
      >
        {!url && <span>{uiText(props.language, 'default')}</span>}
      </div>
    </div>
  )
}
