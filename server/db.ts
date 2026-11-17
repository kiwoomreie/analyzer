// 새 앱 전용 SQLite 저장소(node:sqlite). 서버에는 '임시 분석'만 보관한다.
// 사용자의 '저장'은 브라우저 로컬 저장(이 브라우저에 저장)이며 서버 영구 보관은 첫 버전에서 비활성.
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type Db = DatabaseSync;

export function openDb(path: string): Db {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY,
      token_hash TEXT NOT NULL UNIQUE,
      csrf TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      last_seen INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS pending_launches (
      id TEXT PRIMARY KEY,
      code_hash TEXT NOT NULL,
      bind_hash TEXT NOT NULL,
      doc_json TEXT,
      payload_hash TEXT NOT NULL,
      launch_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      consumed_at INTEGER,
      consumed_ws TEXT,
      analysis_key TEXT
    );
    CREATE TABLE IF NOT EXISTS temp_analyses (
      key TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      launch_id TEXT,
      payload_hash TEXT,
      record_json TEXT NOT NULL,
      supported INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      last_duplicate_at INTEGER,
      UNIQUE (workspace_id, launch_id)
    );
    CREATE INDEX IF NOT EXISTS idx_temp_ws ON temp_analyses(workspace_id);
    CREATE INDEX IF NOT EXISTS idx_pending_exp ON pending_launches(expires_at);
  `);
  return db;
}

/** 만료 자료 정리. 미소비 시동 자료(기본 10분), 임시 분석(기본 24시간), 비활성 작업공간. */
export function cleanup(db: Db, now: number, workspaceTtlMs: number): { pending: number; consumedPayloads: number; temp: number; workspaces: number } {
  const pending = Number(db.prepare("DELETE FROM pending_launches WHERE expires_at <= ?").run(now).changes);
  // 소비된 시동 자료의 본문은 소비 즉시 비우지만, 혹시 남은 경우 정리
  const consumedPayloads = Number(db.prepare("UPDATE pending_launches SET doc_json = NULL WHERE consumed_at IS NOT NULL AND doc_json IS NOT NULL").run().changes);
  const temp = Number(db.prepare("DELETE FROM temp_analyses WHERE expires_at <= ?").run(now).changes);
  const workspaces = Number(
    db.prepare("DELETE FROM workspaces WHERE last_seen <= ? AND id NOT IN (SELECT workspace_id FROM temp_analyses)").run(now - workspaceTtlMs).changes,
  );
  return { pending, consumedPayloads, temp, workspaces };
}
