// ‘이 브라우저에 저장’ — localStorage 기반 로컬 영속 저장. 브라우저 데이터 삭제·다른 기기에서는 복구되지 않는다.
import type { AnalysisRecord } from "../shared/model.ts";
import { hashOf } from "../shared/hash.ts";

const KEY = "location-analyzer.saved.v1";
const DRAFT = "location-analyzer.drafts.v1";

function readMap(storage: Storage | null, key: string): Record<string, AnalysisRecord> {
  try {
    const raw = storage?.getItem(key);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function writeMap(storage: Storage | null, key: string, map: Record<string, AnalysisRecord>): string | null {
  try {
    storage?.setItem(key, JSON.stringify(map));
    return null;
  } catch {
    return "브라우저 저장 공간이 부족하거나 저장이 차단됨 — JSON 내보내기로 보관하십시오";
  }
}

const ls = (): Storage | null => { try { return window.localStorage; } catch { return null; } };
const ss = (): Storage | null => { try { return window.sessionStorage; } catch { return null; } };

export const localStore = {
  available(): boolean { try { const s = ls(); s?.setItem("__t", "1"); s?.removeItem("__t"); return !!s; } catch { return false; } },
  list(): AnalysisRecord[] { return Object.values(readMap(ls(), KEY)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); },
  get(key: string): AnalysisRecord | null { return readMap(ls(), KEY)[key] ?? null; },
  put(rec: AnalysisRecord): string | null { const m = readMap(ls(), KEY); m[rec.key] = rec; return writeMap(ls(), KEY, m); },
  remove(key: string): string | null { const m = readMap(ls(), KEY); delete m[key]; return writeMap(ls(), KEY, m); },
  /** 같은 exportId 의 기존 기록(이 브라우저 저장 범위) */
  findByExportId(exportId: string): AnalysisRecord | null { return this.list().find((r) => r.origin.exportId === exportId) ?? null; },
};

/** 저장 전 작업 중인 직접 입력·가져오기 분석(탭 세션 동안 유지) */
export const draftStore = {
  list(): AnalysisRecord[] { return Object.values(readMap(ss(), DRAFT)); },
  get(key: string): AnalysisRecord | null { return readMap(ss(), DRAFT)[key] ?? null; },
  put(rec: AnalysisRecord): string | null { const m = readMap(ss(), DRAFT); m[rec.key] = rec; return writeMap(ss(), DRAFT, m); },
  remove(key: string) { const m = readMap(ss(), DRAFT); delete m[key]; writeMap(ss(), DRAFT, m); },
  findByExportId(exportId: string): AnalysisRecord | null { return this.list().find((r) => r.origin.exportId === exportId) ?? null; },
};

export function payloadHashOf(rec: AnalysisRecord): string | undefined {
  return rec.origin.payloadHash ?? (rec.original.document ? hashOf(rec.original.document) : undefined);
}
