import { db } from './db'
import {
  clampPopupSize,
  DEFAULT_SETTINGS,
  EN_FONT_STACKS,
  MIN_GLASS_BLUR,
  POPUP_FROSTED_BLUR_MAX,
  POPUP_FROSTED_BLUR_MIN,
  POPUP_FROSTED_MIN_OPACITY,
  POPUP_SIZE,
  ZH_FONT_STACKS
} from '@shared/types'
import type { Settings } from '@shared/types'
import { app } from 'electron'

// v2：玻璃默认值改为浅色雾面（v1 的深色旧默认不再适用，全新默认生效）
const SETTINGS_KEY = 'settings.v3' // v3：保存弹窗显示模式；默认值由 DEFAULT_SETTINGS 唯一提供

let cache: Settings = { ...DEFAULT_SETTINGS }
let firstRun = false

const HEX_COLOR = /^#[0-9a-f]{6}$/i
const BACKGROUND_NAME = /^[a-z0-9_-]+\.(png|jpg|jpeg|webp|bmp|gif)$/i

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function numberValue(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
    ? value
    : fallback
}

function stringValue(value: unknown, fallback: string, valid: (candidate: string) => boolean): string {
  return typeof value === 'string' && valid(value) ? value : fallback
}

/**
 * v3 早期版本把 Settings 主体默认保存成 90% / 30px，导致白色 tint 覆盖整张页面。
 * 只对没有迁移标记的旧记录处理；当前用户之后主动调到相同数值时不会再被覆盖。
 */
function isLegacyMainGlassRecord(source: Record<string, unknown>): boolean {
  const schemaVersion = numberValue(source['mainGlassSchemaVersion'], 0, 0, 1)

  if (schemaVersion >= 1) {
    return false
  }

  const hasMainValues = 'mainGlassOpacity' in source || 'mainGlassBlur' in source || 'mainGlassColor' in source

  // 旧记录没有独立主窗口参数，不能再把 popup 的 84% / 24px 误当成主窗口参数。
  if (!hasMainValues) {
    return true
  }

  return source['mainGlassOpacity'] === 0.9
    && source['mainGlassBlur'] === 30
    && source['mainGlassColor'] === '#ffffff'
}

/** 旧版 popup 默认会保存灰色底色；新版本默认无底色，首次读取时迁移一次。 */
function isLegacyPopupGlassRecord(source: Record<string, unknown>): boolean {
  return numberValue(source['popupGlassSchemaVersion'], 0, 0, 1) < 1
}

/** 统一现有安装的 popup 初始尺寸；迁移完成后继续保留用户后续的自定义尺寸。 */
function isLegacyPopupSizeRecord(source: Record<string, unknown>): boolean {
  return numberValue(source['popupSizeSchemaVersion'], 0, 0, 1) < 1
}

/**
 * 对磁盘设置和 Renderer patch 使用同一套白名单/范围校验。
 * 非法值回退默认值，避免持久化设置破坏窗口尺寸或 IPC 行为。
 */
function sanitizeSettings(input: unknown): Settings {
  const source = isRecord(input) ? input : {}
  const migrateMainGlass = isLegacyMainGlassRecord(source)
  const migratePopupGlass = isLegacyPopupGlassRecord(source)
  const migratePopupSize = isLegacyPopupSizeRecord(source)
  const storedModels = isRecord(source['modelsInstalled']) ? source['modelsInstalled'] : {}
  const size = migratePopupSize
    ? clampPopupSize(DEFAULT_SETTINGS.popupWidth, DEFAULT_SETTINGS.popupHeight)
    : clampPopupSize(
        numberValue(source['popupWidth'], DEFAULT_SETTINGS.popupWidth, POPUP_SIZE.minW, POPUP_SIZE.maxW),
        numberValue(source['popupHeight'], DEFAULT_SETTINGS.popupHeight, POPUP_SIZE.minH, POPUP_SIZE.maxH)
      )

  return {
    launchAtStartup: booleanValue(source['launchAtStartup'], DEFAULT_SETTINGS.launchAtStartup),
    startMinimized: booleanValue(source['startMinimized'], DEFAULT_SETTINGS.startMinimized),
    autoTranslate: booleanValue(source['autoTranslate'], DEFAULT_SETTINGS.autoTranslate),
    uiLanguage: source['uiLanguage'] === 'zh' || source['uiLanguage'] === 'en'
      ? source['uiLanguage']
      : DEFAULT_SETTINGS.uiLanguage,
    targetLanguage: source['targetLanguage'] === 'en' || source['targetLanguage'] === 'zh'
      ? source['targetLanguage']
      : DEFAULT_SETTINGS.targetLanguage,
    maxChars: numberValue(source['maxChars'], DEFAULT_SETTINGS.maxChars, 2, 20_000),
    minChars: numberValue(source['minChars'], DEFAULT_SETTINGS.minChars, 1, 100),
    clipboardFallback: booleanValue(source['clipboardFallback'], DEFAULT_SETTINGS.clipboardFallback),
    autoHideDelay: numberValue(source['autoHideDelay'], DEFAULT_SETTINGS.autoHideDelay, 100, 10_000),
    glassOpacity: migratePopupGlass
      ? DEFAULT_SETTINGS.glassOpacity
      : numberValue(source['glassOpacity'], DEFAULT_SETTINGS.glassOpacity, POPUP_FROSTED_MIN_OPACITY, 0.9),
    popupGlassSchemaVersion: 1,
    glassBlur: numberValue(
      source['glassBlur'],
      DEFAULT_SETTINGS.glassBlur,
      POPUP_FROSTED_BLUR_MIN,
      POPUP_FROSTED_BLUR_MAX
    ),
    // 主窗口与 popup 已经是两套独立参数；旧记录只迁移一次，不能继续复用 popup 的值。
    mainGlassOpacity: migrateMainGlass
      ? DEFAULT_SETTINGS.mainGlassOpacity
      : numberValue(source['mainGlassOpacity'], DEFAULT_SETTINGS.mainGlassOpacity, 0, 1),
    mainGlassBlur: migrateMainGlass
      ? DEFAULT_SETTINGS.mainGlassBlur
      : numberValue(source['mainGlassBlur'], DEFAULT_SETTINGS.mainGlassBlur, MIN_GLASS_BLUR, 80),
    mainGlassColor: migrateMainGlass
      ? DEFAULT_SETTINGS.mainGlassColor
      : stringValue(source['mainGlassColor'], DEFAULT_SETTINGS.mainGlassColor, value => HEX_COLOR.test(value)),
    mainGlassSchemaVersion: 1,
    popupWidth: size.width,
    popupHeight: size.height,
    popupSizeSchemaVersion: 1,
    showOriginal: booleanValue(source['showOriginal'], DEFAULT_SETTINGS.showOriginal),
    englishFontFamily: stringValue(source['englishFontFamily'], DEFAULT_SETTINGS.englishFontFamily, value => value in EN_FONT_STACKS),
    chineseFontFamily: stringValue(source['chineseFontFamily'], DEFAULT_SETTINGS.chineseFontFamily, value => value in ZH_FONT_STACKS),
    englishFontSize: numberValue(source['englishFontSize'], DEFAULT_SETTINGS.englishFontSize, 8, 48),
    chineseFontSize: numberValue(source['chineseFontSize'], DEFAULT_SETTINGS.chineseFontSize, 8, 48),
    originalTextColor: stringValue(source['originalTextColor'], DEFAULT_SETTINGS.originalTextColor, value => HEX_COLOR.test(value)),
    translationTextColor: stringValue(source['translationTextColor'], DEFAULT_SETTINGS.translationTextColor, value => HEX_COLOR.test(value)),
    glassColor: stringValue(source['glassColor'], DEFAULT_SETTINGS.glassColor, value => HEX_COLOR.test(value)),
    popupBackground: stringValue(source['popupBackground'], DEFAULT_SETTINGS.popupBackground, value => value === 'default' || BACKGROUND_NAME.test(value)),
    settingsBackground: stringValue(source['settingsBackground'], DEFAULT_SETTINGS.settingsBackground, value => value === 'default' || BACKGROUND_NAME.test(value)),
    popupMode: source['popupMode'] === 'on-selection' || source['popupMode'] === 'pinned'
      ? source['popupMode']
      : DEFAULT_SETTINGS.popupMode,
    saveHistory: booleanValue(source['saveHistory'], DEFAULT_SETTINGS.saveHistory),
    modelsInstalled: {
      'en-zh': booleanValue(storedModels['en-zh'], DEFAULT_SETTINGS.modelsInstalled['en-zh']),
      'zh-en': booleanValue(storedModels['zh-en'], DEFAULT_SETTINGS.modelsInstalled['zh-en'])
    }
  }
}

/** 本次启动是否为首次运行（settings 表尚无记录）。 */
export function isFirstRun(): boolean {
  return firstRun
}

/** 启动时读取设置；首次运行时写入默认值并标记 firstRun。 */
export function loadSettings(): Settings {
  const row = db().prepare('SELECT value FROM settings WHERE key = ?').get(SETTINGS_KEY) as
    | { value: string }
    | undefined

  if (row) {
    try {
      const stored = JSON.parse(row.value) as Partial<Settings>
      cache = sanitizeSettings(stored)

      // 把旧的主窗口玻璃参数和缺失的内部迁移标记一次性写回，后续启动直接读取规范化结果。
      if (JSON.stringify(stored) !== JSON.stringify(cache)) {
        db()
          .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
          .run(SETTINGS_KEY, JSON.stringify(cache))
      }
    } catch {
      // 设置损坏时回退到默认值
      cache = { ...DEFAULT_SETTINGS }
    }
  } else {
    firstRun = true
    // 立即落盘，下一次启动不再视为首次运行
    db()
      .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(SETTINGS_KEY, JSON.stringify(cache))
  }

  applySideEffects(cache)

  return cache
}

export function getSettings(): Settings {
  return cache
}

/** 合并写入设置并应用系统级副作用（开机自启注册等）。 */
export function setSettings(patch: Partial<Settings>): Settings {
  const patchRecord = isRecord(patch) ? patch : {}
  const patchModels = isRecord(patchRecord['modelsInstalled']) ? patchRecord['modelsInstalled'] : {}

  cache = sanitizeSettings({
    ...cache,
    ...patchRecord,
    modelsInstalled: { ...cache.modelsInstalled, ...patchModels }
  })

  db()
    .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(SETTINGS_KEY, JSON.stringify(cache))

  applySideEffects(cache)
  return cache
}

/** 需要同步到操作系统的设置项。 */
function applySideEffects(settings: Settings): void {
  try {
    app.setLoginItemSettings({
      openAtLogin: settings.launchAtStartup,
      args: ['--hidden']
    })
  } catch {
    // 自启注册失败不致命
  }
}
