// ‘이 브라우저에 저장’ — localStorage 기반 로컬 영속 저장. 브라우저 데이터 삭제·다른 기기에서는 복구되지 않는다.
// 저장소가 없거나(차단) 쓰기·검증에 실패하면 오류 문자열을 돌려준다(성공으로 처리하지 않음).
import { migrateRecord, type AnalysisRecord, type RunRecord } from "../shared/model.ts";
import { stableStringify } from "../shared/hash.ts";

const KEY = "location-analyzer.saved.v1";
const DRAFT = "location-analyzer.drafts.v1";

export type StoreResult = string | null; // null=성공, 문자열=실패 사유

function getStorage(kind: "local" | "session"): Storage | null {
  try {
    const s = kind === "local" ? window.localStorage : window.sessionStorage;
    if (!s) return null;
    const probe = "__la_probe__";
    s.setItem(probe, "1");
    s.removeItem(probe);
    return s;
  } catch { return null; }
}

function readMap(kind: "local" | "session", key: string): Record<string, AnalysisRecord> {
  const s = getStorage(kind);
  if (!s) return {};
  try {
    const raw = s.getItem(key);
    const m = raw ? (JSON.parse(raw) as Record<string, AnalysisRecord>) : {};
    Object.values(m).forEach((r) => migrateRecord(r));
    return m;
  } catch { return {}; }
}

/** 저장 크기 절약: 최근 실행 외 입력 스냅샷 제거 */
function compact(rec: AnalysisRecord): AnalysisRecord {
  const runs = rec.runs ?? [];
  const last = runs.length - 1;
  return { ...rec, runs: runs.map((r, i) => (i === last ? r : (({ input: _x, ...rest }) => rest as RunRecord)(r))) };
}

function writeMap(kind: "local" | "session", key: string, map: Record<string, AnalysisRecord>): StoreResult {
  const s = getStorage(kind);
  const where = kind === "local" ? "이 브라우저 저장소" : "탭 임시 저장소";
  if (!s) return `${where}를 사용할 수 없음(브라우저 설정·개인정보 보호 모드 등으로 차단). 저장되지 않았습니다 — ‘JSON 내보내기’로 파일로 보관하십시오.`;
  const text = JSON.stringify(map);
  try {
    s.setItem(key, text);
  } catch (e) {
    const quota = (e as any)?.name === "QuotaExceededError" || /quota/i.test(String((e as any)?.message));
    return `${where}에 저장하지 못했습니다(${quota ? "저장 공간 부족" : "쓰기 실패"}). 변경 내용은 저장되지 않았습니다 — ‘JSON 내보내기’로 파일로 보관하거나 거래 자료를 줄이십시오.`;
  }
  try {
    if (s.getItem(key) !== text) return `${where} 저장 확인 실패 — 저장되지 않았을 수 있습니다. ‘JSON 내보내기’로 보관하십시오.`;
  } catch { return `${where} 저장 확인 실패 — ‘JSON 내보내기’로 보관하십시오.`; }
  return null;
}

function makeStore(kind: "local" | "session", key: string) {
  return {
    available(): boolean { return getStorage(kind) !== null; },
    list(): AnalysisRecord[] { return Object.values(readMap(kind, key)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); },
    get(k: string): AnalysisRecord | null { return readMap(kind, key)[k] ?? null; },
    put(rec: AnalysisRecord): StoreResult { const m = readMap(kind, key); m[rec.key] = compact(rec); return writeMap(kind, key, m); },
    remove(k: string): StoreResult { const m = readMap(kind, key); delete m[k]; return writeMap(kind, key, m); },
    findByExportId(exportId: string): AnalysisRecord | null { return this.list().find((r) => r.origin.exportId === exportId) ?? null; },
    /** 같은 키에 내용이 다른 기록이 있으면 덮어쓰지 않고 'conflict' */
    putIfAbsent(rec: AnalysisRecord): { result: "saved" | "same" | "conflict"; error: StoreResult } {
      const m = readMap(kind, key);
      const ex = m[rec.key];
      if (ex) return { result: stableStringify(compact(ex)) === stableStringify(compact(rec)) ? "same" : "conflict", error: null };
      m[rec.key] = compact(rec);
      return { result: "saved", error: writeMap(kind, key, m) };
    },
  };
}

export const localStore = makeStore("local", KEY);
/** 저장 전 작업(탭 세션 동안 유지) */
export const draftStore = makeStore("session", DRAFT);

/** 탭 저장소까지 차단된 경우의 메모리 보관(새로고침·탭 닫기 시 사라짐 — 화면에 경고 표시) */
export const memoryDrafts = new Map<string, AnalysisRecord>();
