// ‘이 브라우저에 저장’ — localStorage 기반 로컬 영속 저장. 브라우저 데이터 삭제·다른 기기에서는 복구되지 않는다.
//
// 손상 보호(v0.5)
// - 저장소 원문을 읽지 못하면(JSON이 아님 등) 빈 저장소로 취급하지 않는다. 쓰기를 차단하고 원문 내보내기를 제공한다.
// - 일부 기록만 손상(형식 불일치·변환 실패)이면 정상 기록만 목록에 보여주고, 저장할 때 손상 기록의 원문 값을 그대로 다시 쓴다.
// - 저장된 원문은 자동 삭제하지 않는다. ‘손상 원문 보관 후 새로 시작’은 사용자가 실행할 때만, 원문을 보관 키에 복사·검증한 뒤 수행한다.
// - 저장소가 없거나(차단) 쓰기·검증에 실패하면 오류 문자열을 돌려준다(성공으로 처리하지 않음).
import { ANALYSIS_FORMAT, migrateRecord, type AnalysisRecord, type RunRecord } from "../shared/model.ts";
import { stableStringify } from "../shared/hash.ts";

const KEY = "location-analyzer.saved.v1";
const DRAFT = "location-analyzer.drafts.v1";

export type StoreResult = string | null; // null=성공, 문자열=실패 사유

export interface StoreHealth {
  /** ok=정상, partial=일부 기록 손상(정상 기록은 사용 가능), unreadable=원문 해석 불가(쓰기 차단), unavailable=저장소 사용 불가 */
  state: "ok" | "partial" | "unreadable" | "unavailable";
  badKeys: string[];
  message: string;
}

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

/** 저장 기록 형태 검사 + 변환(사본에서). 실패하면 null — 원문은 건드리지 않는다. */
function toRecord(raw: unknown): AnalysisRecord | null {
  try {
    const r = raw as any;
    if (!r || typeof r !== "object" || r.format !== ANALYSIS_FORMAT || typeof r.key !== "string") return null;
    if (!r.working || typeof r.working !== "object" || !r.original || typeof r.original.working !== "object" || !Array.isArray(r.runs)) return null;
    if (typeof r.working.property !== "object" || !Array.isArray(r.working.transactions)) return null;
    return migrateRecord(structuredClone(r));
  } catch { return null; }
}

interface Snapshot { raw: string | null; obj: Record<string, unknown> | null; records: Record<string, AnalysisRecord>; health: StoreHealth }

function snapshot(kind: "local" | "session", key: string): Snapshot {
  const s = getStorage(kind);
  if (!s) return { raw: null, obj: null, records: {}, health: { state: "unavailable", badKeys: [], message: "저장소를 사용할 수 없음(차단·개인정보 보호 모드 등)" } };
  let raw: string | null;
  try { raw = s.getItem(key); } catch { return { raw: null, obj: null, records: {}, health: { state: "unavailable", badKeys: [], message: "저장소 읽기 실패" } }; }
  if (raw === null) return { raw, obj: {}, records: {}, health: { state: "ok", badKeys: [], message: "" } };
  let obj: unknown;
  try { obj = JSON.parse(raw); } catch { obj = undefined; }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
    return { raw, obj: null, records: {}, health: { state: "unreadable", badKeys: [], message: "저장된 원문을 해석할 수 없음 — 원문 보호를 위해 쓰기를 차단했습니다. ‘원문 내보내기’로 먼저 보관하십시오." } };
  }
  const records: Record<string, AnalysisRecord> = {};
  const badKeys: string[] = [];
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const r = toRecord(v);
    if (r) records[k] = r; else badKeys.push(k);
  }
  return {
    raw, obj: obj as Record<string, unknown>, records,
    health: badKeys.length
      ? { state: "partial", badKeys, message: `손상되었거나 읽을 수 없는 기록 ${badKeys.length}건 — 원문은 그대로 보존(저장해도 지우지 않음). ‘원문 내보내기’로 보관할 수 있습니다.` }
      : { state: "ok", badKeys: [], message: "" },
  };
}

/** 저장 크기 절약: 최근 실행 외 입력 스냅샷 제거 */
function compact(rec: AnalysisRecord): AnalysisRecord {
  const runs = rec.runs ?? [];
  const last = runs.length - 1;
  return { ...rec, runs: runs.map((r, i) => (i === last ? r : (({ input: _x, ...rest }) => rest as RunRecord)(r))) };
}

function write(kind: "local" | "session", key: string, mutate: (obj: Record<string, unknown>, snap: Snapshot) => void): StoreResult {
  const where = kind === "local" ? "이 브라우저 저장소" : "탭 임시 저장소";
  const snap = snapshot(kind, key);
  if (snap.health.state === "unavailable") return `${where}를 사용할 수 없음(브라우저 설정·개인정보 보호 모드 등으로 차단). 저장되지 않았습니다 — ‘JSON 내보내기’로 파일로 보관하십시오.`;
  if (snap.health.state === "unreadable") return `${where}의 저장 원문이 손상되어 쓰기 차단 — 기존 원문을 덮어쓰지 않았습니다. 첫 화면의 ‘원문 내보내기’로 보관한 뒤 ‘손상 원문 보관 후 새로 시작’을 실행하거나, 이 분석은 ‘JSON 내보내기’로 보관하십시오.`;
  const s = getStorage(kind)!;
  // 손상 기록을 포함한 원문 객체를 그대로 두고 해당 키만 바꾼다
  const obj = { ...(snap.obj ?? {}) };
  mutate(obj, snap);
  const text = JSON.stringify(obj);
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
    health(): StoreHealth { return snapshot(kind, key).health; },
    list(): AnalysisRecord[] { return Object.values(snapshot(kind, key).records).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); },
    get(k: string): AnalysisRecord | null { return snapshot(kind, key).records[k] ?? null; },
    put(rec: AnalysisRecord): StoreResult { return write(kind, key, (obj) => { obj[rec.key] = compact(rec); }); },
    remove(k: string): StoreResult { return write(kind, key, (obj) => { delete obj[k]; }); },
    findByExportId(exportId: string): AnalysisRecord | null { return this.list().find((r) => r.origin.exportId === exportId) ?? null; },
    /** 같은 키에 기록(손상 기록 포함)이 있으면 덮어쓰지 않음 */
    putIfAbsent(rec: AnalysisRecord): { result: "saved" | "same" | "conflict"; error: StoreResult } {
      const snap = snapshot(kind, key);
      const ex = snap.records[rec.key];
      if (ex) return { result: stableStringify(compact(ex)) === stableStringify(compact(rec)) ? "same" : "conflict", error: null };
      if (snap.obj && rec.key in snap.obj) return { result: "conflict", error: null };
      const error = write(kind, key, (obj) => { obj[rec.key] = compact(rec); });
      return { result: "saved", error };
    },
    /** 저장 원문 그대로(손상 포함) — 내보내기용 */
    exportRaw(): string | null { return snapshot(kind, key).raw; },
    /** 손상 기록 원문만(부분 손상) */
    exportBad(): Record<string, unknown> {
      const snap = snapshot(kind, key);
      return Object.fromEntries(snap.health.badKeys.map((k) => [k, snap.obj?.[k]]));
    },
    /**
     * 사용자 실행 전용: 해석할 수 없는 원문을 보관 키에 복사·검증한 뒤 저장소를 새로 시작한다(원문 삭제 없음).
     */
    quarantineAndReset(): { error: StoreResult; quarantineKey: string | null } {
      const s = getStorage(kind);
      if (!s) return { error: "저장소를 사용할 수 없음", quarantineKey: null };
      const raw = s.getItem(key);
      if (raw === null) return { error: null, quarantineKey: null };
      const qk = `${key}.quarantine.${Date.now()}`;
      try {
        s.setItem(qk, raw);
        if (s.getItem(qk) !== raw) return { error: "보관 복사 확인 실패 — 원문을 그대로 두었습니다", quarantineKey: null };
        s.setItem(key, "{}");
      } catch { return { error: "보관 복사 실패(저장 공간 부족 등) — 원문을 그대로 두었습니다. ‘원문 내보내기’로 파일 보관 후 브라우저 저장 공간을 확보하십시오", quarantineKey: null }; }
      return { error: null, quarantineKey: qk };
    },
  };
}

export const localStore = makeStore("local", KEY);
/** 저장 전 작업(탭 세션 동안 유지) */
export const draftStore = makeStore("session", DRAFT);

/** 탭 저장소까지 차단된 경우의 메모리 보관(새로고침·탭 닫기 시 사라짐 — 화면에 경고 표시) */
export const memoryDrafts = new Map<string, AnalysisRecord>();
