import { app } from 'electron'
import { DatabaseSync } from 'node:sqlite'
import path from 'node:path'
import fs from 'node:fs'

export type Db = DatabaseSync

let _db: Db | null = null

/** 返回单例数据库（首次调用时打开并建表）。 */
export function db(): Db {
  if (!_db) {
    return openDb()
  }

  return _db
}

export function openDb(): Db {
  if (_db) {
    return _db
  }

  const dir = app.getPath('userData')
  fs.mkdirSync(dir, { recursive: true })
  _db = new DatabaseSync(path.join(dir, 'highlight-translator.db'))

  // 三张表：设置（键值）、翻译缓存、翻译历史
  _db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS translation_cache (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      source_text      TEXT NOT NULL,
      source_language  TEXT NOT NULL,
      target_language  TEXT NOT NULL,
      translated_text  TEXT NOT NULL,
      created_at       TEXT NOT NULL,
      last_used_at     TEXT NOT NULL,
      UNIQUE (source_text, source_language, target_language)
    );

    CREATE INDEX IF NOT EXISTS idx_cache_lookup
      ON translation_cache (source_text, source_language, target_language);

    CREATE TABLE IF NOT EXISTS translation_history (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      original_text   TEXT NOT NULL,
      translated_text TEXT NOT NULL,
      source_language TEXT,
      target_language TEXT,
      application_name TEXT,
      created_at      TEXT NOT NULL
    );
  `)

  return _db
}
