import { db } from './db'
import type { HistoryRow } from '@shared/types'

/** 新增一条历史记录（仅在设置开启 saveHistory 时由翻译管理器调用）。 */
export function addHistory(row: {
  original_text: string
  translated_text: string
  source_language: string
  target_language: string
  application_name: string
}): void {
  db()
    .prepare(
      `INSERT INTO translation_history
         (original_text, translated_text, source_language, target_language, application_name, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      row.original_text,
      row.translated_text,
      row.source_language,
      row.target_language,
      row.application_name,
      new Date().toISOString()
    )
}

/** 按时间倒序取最近 300 条历史。 */
export function listHistory(): HistoryRow[] {
  return db()
    .prepare('SELECT * FROM translation_history ORDER BY id DESC LIMIT 300')
    .all() as unknown as HistoryRow[]
}

/** 删除单条历史。 */
export function deleteHistory(id: number): void {
  db().prepare('DELETE FROM translation_history WHERE id = ?').run(id)
}

/** 清空全部历史。 */
export function clearHistory(): void {
  db().prepare('DELETE FROM translation_history').run()
}
