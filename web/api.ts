// 새 앱 서버 API(같은 출처). 협의체 서버로는 어떤 요청도 보내지 않는다.
import type { AnalysisRecord } from "../shared/model.ts";

export interface SessionInfo {
  csrfToken: string;
  config: {
    kakaoJsKey: string | null;
    publicData: "configured" | "unset";
    publicDataAutoFetch: boolean;
    tempAnalysisTtlHours: number;
    launchPendingTtlSec: number;
    launchMaxBodyBytes: number;
    serverPersistentStorage: "disabled";
    externalAi: "disabled";
  };
}

let session: SessionInfo | null = null;
let sessionError: string | null = null;

export async function getSession(): Promise<SessionInfo | null> {
  if (session) return session;
  try {
    const r = await fetch("/api/session", { credentials: "same-origin" });
    if (!r.ok) throw new Error(String(r.status));
    session = await r.json();
    return session;
  } catch {
    sessionError = "새 앱 서버에 연결할 수 없음 — 직접 입력·파일·이 브라우저 저장 기능은 계속 사용 가능";
    return null;
  }
}
export const getSessionError = () => sessionError;

async function write(method: string, path: string, body?: unknown) {
  const s = await getSession();
  if (!s) throw new Error("서버 세션 없음");
  const r = await fetch(path, {
    method, credentials: "same-origin",
    headers: { "Content-Type": "application/json", "X-CSRF-Token": s.csrfToken },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.message ?? `오류 ${r.status}`), { status: r.status, body: j });
  return j;
}

export interface TempListItem { key: string; title: string; origin: string; supported: boolean; createdAt: number; expiresAt: number }

export async function listTemp(): Promise<TempListItem[]> {
  try {
    const r = await fetch("/api/temp-analyses", { credentials: "same-origin" });
    if (!r.ok) return [];
    return (await r.json()).items;
  } catch { return []; }
}

export async function getTemp(key: string): Promise<{ record: AnalysisRecord; expiresAt: number; lastDuplicateAt: number | null; supported: boolean }> {
  const r = await fetch(`/api/temp-analyses/${encodeURIComponent(key)}`, { credentials: "same-origin" });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.message ?? `오류 ${r.status}`);
  return j;
}

export const putTemp = (rec: AnalysisRecord) => write("PUT", `/api/temp-analyses/${encodeURIComponent(rec.key)}`, { record: rec });
export const deleteTemp = (key: string) => write("DELETE", `/api/temp-analyses/${encodeURIComponent(key)}`);
export const fetchAptTrades = (lawdCode: string, yearMonths: string[]) => write("POST", "/api/public-data/apt-trades", { lawdCode, yearMonths });
