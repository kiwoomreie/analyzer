// 새 앱 서버 API(같은 출처). 협의체 서버로는 어떤 요청도 보내지 않는다.
import type { AnalysisRecord } from "../shared/model.ts";

export interface SessionInfo {
  csrfToken: string;
  config: {
    kakaoJsKey: string | null;
    publicData: "configured" | "unset";
    geocoder: "configured" | "unset";
    launchReceiver: "enabled" | "standby";
    publicDataAutoFetch: boolean;
    tempAnalysisTtlHours: number;
    launchPendingTtlSec: number;
    launchMaxBodyBytes: number;
    serverPersistentStorage: "disabled";
    externalAi: "disabled";
    /** 서버리스(Vercel) 배포 표시. 로컬 서버는 없음 */
    hosting?: "serverless";
    /** 서버리스 배포: 자동 조회는 접속 비밀번호 로그인 후에만 */
    auth?: { required: boolean; ready: boolean; signedIn: boolean };
  };
}

let session: SessionInfo | null = null;
let sessionError: string | null = null;

declare const __PREVIEW__: boolean | undefined;
export async function getSession(): Promise<SessionInfo | null> {
  if (session) return session;
  if (typeof __PREVIEW__ !== "undefined" && __PREVIEW__) { sessionError = "서버 없는 웹 버전: 이 브라우저에서만 실행 중(저장도 이 브라우저에만 됨) — 공공데이터·카카오 자동 조회는 사용할 수 없고, 분석·저장·보고서는 동작합니다"; return null; }
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
/** 세션 정보를 다시 받음(로그인·로그아웃 후) */
export async function refreshSession(): Promise<SessionInfo | null> { session = null; return getSession(); }

/** 서버리스 배포의 접속 비밀번호 로그인. 비밀번호는 이 요청 본문으로만 보내고 저장하지 않음 */
export async function login(password: string): Promise<SessionInfo | null> {
  const r = await fetch("/api/login", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.message ?? `오류 ${r.status}`);
  return refreshSession();
}
export async function logout(): Promise<SessionInfo | null> {
  await fetch("/api/logout", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: "{}" }).catch(() => {});
  return refreshSession();
}

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
/** 새 앱 서버의 고정 어댑터(주소→좌표, 반경 주변 시군구, 국토부 실거래 전 페이지)만 호출. 키가 없으면 503(미설정). */
export const lookupPublicData = (q: { address: string; lawdCode?: string; asOf: string; months: number; radiusM: number; center?: { lat: number; lng: number }; extraLawdCodes?: string[] }): Promise<import("../shared/applyData.ts").LookupPayload> => write("POST", "/api/public-data/lookup", q);
