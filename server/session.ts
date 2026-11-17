// 새 앱 자체 브라우저 작업공간 세션. 협의체 로그인·쿠키·인증정보와 연결하지 않는다.
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Db } from "./db.ts";
import type { AppConfig } from "./config.ts";
import { addSetCookie, cookie, HttpError, parseCookies, randomToken, sha256 } from "./http.ts";

export const WS_COOKIE = "la_ws";

export interface Workspace { id: string; csrf: string }

export function findWorkspace(db: Db, req: IncomingMessage, now: number): Workspace | null {
  const tok = parseCookies(req)[WS_COOKIE];
  if (!tok || !/^[A-Za-z0-9_-]{40,60}$/.test(tok)) return null;
  const row = db.prepare("SELECT id, csrf FROM workspaces WHERE token_hash = ?").get(sha256(tok)) as { id: string; csrf: string } | undefined;
  if (!row) return null;
  db.prepare("UPDATE workspaces SET last_seen = ? WHERE id = ?").run(now, row.id);
  return row;
}

/** 기존 작업공간이 있으면 그대로 사용(덮어쓰지 않음). 없을 때만 새로 만들고 쿠키를 설정. */
export function ensureWorkspace(db: Db, cfg: AppConfig, req: IncomingMessage, res: ServerResponse, now: number): Workspace {
  const found = findWorkspace(db, req, now);
  if (found) return found;
  const id = "ws_" + randomToken(12);
  const tok = randomToken(32);
  const csrf = randomToken(24);
  db.prepare("INSERT INTO workspaces (id, token_hash, csrf, created_at, last_seen) VALUES (?, ?, ?, ?, ?)").run(id, sha256(tok), csrf, now, now);
  addSetCookie(res, cookie(WS_COOKIE, tok, { secure: cfg.cookieSecure, sameSite: "Lax", maxAgeSec: cfg.workspaceTtlDays * 86400 }));
  return { id, csrf };
}

/** 상태 변경 API 보호: 작업공간 세션 + CSRF 토큰 헤더 + JSON 본문. Fetch Metadata는 보조 신호로만 사용. */
export function requireWriteAccess(db: Db, req: IncomingMessage, now: number): Workspace {
  const ws = findWorkspace(db, req, now);
  if (!ws) throw new HttpError(401, "NO_SESSION", "이 브라우저의 새 앱 세션이 없음");
  const site = req.headers["sec-fetch-site"];
  if (site && site !== "same-origin" && site !== "none") throw new HttpError(403, "CROSS_SITE", "다른 사이트에서 보낸 변경 요청은 허용하지 않음");
  const tok = req.headers["x-csrf-token"];
  if (typeof tok !== "string" || tok !== ws.csrf) throw new HttpError(403, "CSRF", "CSRF 토큰 불일치");
  return ws;
}
