// 파일 가져오기: 협의체 반출 JSON, 새 앱 백업 JSON, 일반 CSV(비교거래), 일반 JSON(사건·근거·거래·지수).
// 모든 경로에 공통 안전 검사를 적용한다. 입력 내용의 HTML·스크립트·수식·URL은 실행·조회하지 않는다.
import { isSecretLike, isForbiddenKey, scanSafety, type SafetyIssue } from "./safety.ts";
import { validateContractDocument, type ContractValidation } from "./validate.ts";
import { parseDateValue } from "./dates.ts";
import {
  ANALYSIS_FORMAT, migrateRecord, newKey, type AnalysisRecord, type DataMode, type Evidence,
  type LocationEvent, type Transaction, type WorkingInputs,
} from "./model.ts";

export const FREE_TEXT_KEYS = ["sourceUrl", "fact", "note", "appraisalNote", "routeSource", "purpose", "title", "publisher", "source", "detail", "distanceSource", "userReason"];

/** 작업본 안전 검사(앱 내 편집·백업 복구). 첨부 텍스트 본문은 비밀값 형태만 따로 검사. */
export function scanWorking(w: unknown): SafetyIssue[] {
  if (!w || typeof w !== "object") return [{ path: "$", code: "FORBIDDEN_FIELD", message: "작업본 형식 오류" }];
  const copy: any = { ...(w as any), attachments: ((w as any).attachments ?? []).map((a: any) => ({ ...a, text: undefined })) };
  const issues = scanSafety(copy, { urlAllowedKeys: FREE_TEXT_KEYS });
  ((w as any).attachments ?? []).forEach((a: any, i: number) => {
    if (typeof a?.text === "string" && isSecretLike(a.text)) issues.push({ path: `$.attachments[${i}].text`, code: "SECRET_LIKE_VALUE", message: "첨부 본문에 비밀값 형태가 있음" });
  });
  return issues;
}

/** 작업본 구조 검사(형식·단위·날짜). 화면 편집 저장과 백업 복구에 공통 사용. */
export function checkWorkingShape(w: WorkingInputs): string[] {
  const errs: string[] = [];
  const num = (v: unknown, path: string, opt = true) => {
    if (v === undefined || v === null) { if (!opt) errs.push(`${path}: 필수`); return; }
    if (typeof v !== "number" || !Number.isFinite(v)) errs.push(`${path}: 숫자 아님`);
  };
  const date = (v: unknown, path: string) => {
    if (v === undefined || v === null || v === "") return;
    if (typeof v !== "string" || !parseDateValue(v)) errs.push(`${path}: 날짜 형식(YYYY-MM 또는 YYYY-MM-DD) 아님`);
  };
  if (!parseDateValue(w.asOf) || parseDateValue(w.asOf)!.precision !== "day") errs.push("asOf: YYYY-MM-DD 필요");
  if (!w.property || typeof w.property.address !== "string") errs.push("property.address: 필수");
  num(w.property?.exclusiveAreaM2, "property.exclusiveAreaM2");
  num(w.property?.buildYear, "property.buildYear");
  for (const k of ["events", "evidence", "transactions", "complexInfo", "attachments"] as const) if (!Array.isArray((w as any)[k])) errs.push(`${k}: 목록 형식 오류`);
  if (w.reviewPrice) { num(w.reviewPrice.amount, "reviewPrice.amount", false); date(w.reviewPrice.basisDate, "reviewPrice.basisDate"); if (!["KRW", "KRW_10K", "KRW_100M"].includes(w.reviewPrice.unit)) errs.push("reviewPrice.unit: 단위 오류"); if (!["household", "perExclusiveM2", "perExclusivePyeong"].includes(w.reviewPrice.basis)) errs.push("reviewPrice.basis: 가격 기준 오류"); }
  for (const [k, v] of Object.entries(w.schedule ?? {})) date(v, `schedule.${k}`);
  (w.transactions ?? []).forEach((t, i) => { num(t.priceKrw, `transactions[${i}].priceKrw`, false); num(t.exclusiveAreaM2, `transactions[${i}].exclusiveAreaM2`, false); date(t.contractDate, `transactions[${i}].contractDate`); });
  (w.events ?? []).forEach((e, i) => (e.milestones ?? []).forEach((m, j) => { date(m.date, `events[${i}].milestones[${j}].date`); date(m.announcedOn, `events[${i}].milestones[${j}].announcedOn`); }));
  if ((w.transactions ?? []).length > 20000) errs.push("transactions: 20,000건 초과");
  return errs.slice(0, 30);
}

// ── CSV
export function parseCsv(text: string, maxRows = 20000): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let q = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      if (ch === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
      if (rows.length > maxRows + 1) throw new Error(`행 수가 ${maxRows}를 초과함`);
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  return rows;
}

const HEADER_MAP: Record<string, keyof RawTx> = {
  단지명: "complexName", 아파트: "complexName", aptnm: "complexName", complexname: "complexName",
  전용면적: "area", 전용면적m2: "area", excluusear: "area", exclusiveaream2: "area",
  층: "floor", floor: "floor",
  거래금액만원: "priceMan", 거래금액: "priceMan", dealamount: "priceMan",
  거래금액원: "priceKrw", pricekrw: "priceKrw",
  계약일: "contractDate", contractdate: "contractDate",
  계약년월: "ym", dealym: "ym", 계약일자: "day",
  해제여부: "cancelled", cdealtype: "cancelled", cancelled: "cancelled",
  해제사유발생일: "cancelDate", cdealday: "cancelDate",
  법정동: "dong", umdnm: "dong",
  지번: "jibun", jibun: "jibun",
  시군구코드: "sggCd", sggcd: "sggCd",
  단지코드: "complexId", 단지일련번호: "complexId", aptseq: "complexId",
  동: "aptDong", aptdong: "aptDong",
  거래id: "officialId", 거래번호: "officialId", tradeid: "officialId",
  건축년도: "buildYear", 준공연도: "buildYear", buildyear: "buildYear",
};
interface RawTx { complexName?: string; area?: string; floor?: string; priceMan?: string; priceKrw?: string; contractDate?: string; ym?: string; day?: string; cancelled?: string; cancelDate?: string; dong?: string; jibun?: string; sggCd?: string; complexId?: string; aptDong?: string; officialId?: string; buildYear?: string }

export interface ImportOutcome<T> { ok: boolean; items: T[]; errors: string[]; skipped: number }

/** CSV 셀이 =,+,-,@ 로 시작해도 수식으로 해석하지 않고 숫자/텍스트로만 읽는다. */
export function transactionsFromCsv(text: string, dataMode: DataMode = "user", source = "사용자 CSV"): ImportOutcome<Transaction> {
  const errors: string[] = [];
  if (isSecretLike(text)) return { ok: false, items: [], errors: ["비밀값·접속정보 형태의 값이 포함되어 파일 전체를 거절함"], skipped: 0 };
  let rows: string[][];
  try { rows = parseCsv(text); } catch (e) { return { ok: false, items: [], errors: [(e as Error).message], skipped: 0 }; }
  if (rows.length < 2) return { ok: false, items: [], errors: ["머리행과 자료행이 필요함"], skipped: 0 };
  const header = rows[0].map((h) => h.trim());
  const forbidden = header.filter((h) => isForbiddenKey(h));
  if (forbidden.length) return { ok: false, items: [], errors: ["금지 필드(인증·주소·콜백 등) 머리행이 있어 파일 전체를 거절함"], skipped: 0 };
  const idx = header.map((h) => HEADER_MAP[h.toLowerCase().replace(/[\s_()\-㎡]/g, "").replace("m²", "m2")] ?? null);
  if (!idx.includes("complexName") || !idx.includes("area") || !(idx.includes("priceMan") || idx.includes("priceKrw")) || !(idx.includes("contractDate") || idx.includes("ym"))) {
    return { ok: false, items: [], errors: ["필수 열: 단지명, 전용면적, 거래금액(만원) 또는 거래금액(원), 계약일 또는 계약년월"], skipped: 0 };
  }
  const items: Transaction[] = [];
  let skipped = 0;
  const toNum = (s?: string) => { if (s === undefined) return NaN; const t = s.replace(/[,\s]/g, ""); return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : NaN; };
  rows.slice(1).forEach((r, i) => {
    const raw: RawTx = {};
    idx.forEach((k, j) => { if (k) (raw as any)[k] = (r[j] ?? "").trim(); });
    const area = toNum(raw.area);
    const price = raw.priceKrw ? toNum(raw.priceKrw) : toNum(raw.priceMan) * 1e4;
    let cd = raw.contractDate ?? "";
    if (!cd && raw.ym) { const ym = raw.ym.replace(/\D/g, ""); cd = ym.length === 6 ? `${ym.slice(0, 4)}-${ym.slice(4)}${raw.day ? `-${raw.day.padStart(2, "0")}` : ""}` : ""; }
    cd = cd.replace(/\./g, "-").replace(/\//g, "-");
    if (/^\d{8}$/.test(cd)) cd = `${cd.slice(0, 4)}-${cd.slice(4, 6)}-${cd.slice(6)}`;
    if (!raw.complexName || !(area > 0) || !(price > 0) || !parseDateValue(cd)) {
      skipped++;
      if (errors.length < 10) errors.push(`${i + 2}행: 단지명·면적·금액·계약일 확인 필요 — 건너뜀`);
      return;
    }
    const canc = (raw.cancelled ?? "").trim();
    items.push({
      key: newKey("tx"), complexName: raw.complexName.slice(0, 80), exclusiveAreaM2: area, floor: Number.isFinite(toNum(raw.floor)) ? toNum(raw.floor) : undefined,
      priceKrw: Math.round(price), contractDate: cd, cancelled: canc !== "" && canc !== "0" && canc.toLowerCase() !== "n" && canc !== "아니오",
      cancelDate: raw.cancelDate || undefined, dong: raw.dong ? raw.dong.slice(0, 40) : undefined,
      jibun: raw.jibun ? raw.jibun.slice(0, 40) : undefined, sggCd: raw.sggCd && /^\d{5}$/.test(raw.sggCd) ? raw.sggCd : undefined,
      complexId: raw.complexId ? raw.complexId.slice(0, 40) : undefined, aptDong: raw.aptDong ? raw.aptDong.slice(0, 20) : undefined,
      officialId: raw.officialId ? raw.officialId.slice(0, 80) : undefined,
      buildYear: Number.isFinite(toNum(raw.buildYear)) ? toNum(raw.buildYear) : undefined, dataMode, source: source.slice(0, 120),
    });
  });
  return { ok: items.length > 0, items, errors, skipped };
}

// ── 일반 JSON(사건·근거·거래·지수)
export interface GeneralJsonImport { events: LocationEvent[]; evidence: Evidence[]; transactions: Transaction[] }

export function generalJsonImport(data: unknown): { ok: boolean; result?: GeneralJsonImport; errors: string[] } {
  const issues = scanSafety(data, { urlAllowedKeys: FREE_TEXT_KEYS });
  if (issues.length) return { ok: false, errors: issues.map((i) => `${i.path}: ${i.message}`) };
  if (!data || typeof data !== "object" || Array.isArray(data)) return { ok: false, errors: ["{ events, evidence, transactions } 형태의 객체가 필요함"] };
  const d = data as any;
  const allowed = new Set(["events", "evidence", "transactions", "dataMode", "source"]);
  const extra = Object.keys(d).filter((k) => !allowed.has(k));
  if (extra.length) return { ok: false, errors: [`알 수 없는 최상위 필드: ${extra.join(", ")}`] };
  const mode: DataMode = d.dataMode === "demo" ? "demo" : "user";
  const errs: string[] = [];
  const arr = (x: unknown) => (Array.isArray(x) ? x : x === undefined ? [] : (errs.push("목록 형식 오류"), []));
  const events: LocationEvent[] = arr(d.events).map((e: any) => ({
    key: newKey("ev"), category: ["transport", "amenity", "development", "supply"].includes(e.category) ? e.category : "development", name: String(e.name ?? "이름 없음").slice(0, 120),
    direction: ["favorable", "adverse", "mixed", "unknown"].includes(e.direction) ? e.direction : "unknown",
    location: e.location && Number.isFinite(e.location.lat) && Number.isFinite(e.location.lng) ? { lat: e.location.lat, lng: e.location.lng } : undefined,
    milestones: (Array.isArray(e.milestones) ? e.milestones : []).map((m: any) => ({ key: newKey("ms"), type: m.type ?? "other", status: m.status === "actual" ? "actual" : "planned", date: m.date, announcedOn: m.announcedOn, collectedOn: m.collectedOn, note: m.note, evidenceKeys: [] })),
    access: e.access, supply: e.supply, evidenceKeys: [], dataMode: mode, note: e.note,
  }));
  const evidence: Evidence[] = arr(d.evidence).map((e: any) => ({
    key: newKey("evd"), publisher: String(e.publisher ?? "미기재"), title: String(e.title ?? "미기재"), sourceRef: e.sourceRef, sourceUrl: e.sourceUrl, publishedOn: e.publishedOn, effectiveOn: e.effectiveOn, checkedOn: e.checkedOn, pageOrSection: e.pageOrSection,
    fact: String(e.fact ?? ""), status: ["confirmed", "needsApplicability", "inconsistent", "hardToVerify"].includes(e.status) ? e.status : "hardToVerify", linked: [], dataMode: mode,
  }));
  const transactions: Transaction[] = arr(d.transactions).flatMap((t: any) => {
    if (!t || typeof t.complexName !== "string" || !(t.exclusiveAreaM2 > 0) || !(t.priceKrw > 0) || !parseDateValue(t.contractDate)) { errs.push("거래 1건 형식 오류 — 건너뜀"); return []; }
    const str = (v: unknown, n: number) => (typeof v === "string" && v ? v.slice(0, n) : undefined);
    return [{ key: newKey("tx"), complexName: t.complexName, dong: str(t.dong, 40), jibun: str(t.jibun, 40), sggCd: str(t.sggCd, 5), complexId: str(t.complexId, 40), aptDong: str(t.aptDong, 20), officialId: str(t.officialId, 80), exclusiveAreaM2: t.exclusiveAreaM2, floor: t.floor, priceKrw: Math.round(t.priceKrw), contractDate: t.contractDate, cancelled: !!t.cancelled, cancelDate: t.cancelDate, buildYear: t.buildYear, dataMode: mode, source: String(d.source ?? "사용자 JSON").slice(0, 120) } as Transaction];
  });
  return { ok: true, result: { events, evidence, transactions }, errors: errs.slice(0, 10) };
}

// ── 파일 판별
export type DetectedFile =
  | { type: "committee-import"; validation: ContractValidation }
  | { type: "launch-document"; validation: ContractValidation }
  | { type: "backup"; records: AnalysisRecord[]; errors: string[] }
  | { type: "general-json"; data: unknown }
  | { type: "csv"; text: string }
  | { type: "invalid"; errors: string[] };

export function detectFile(filename: string, text: string): DetectedFile {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".csv")) return { type: "csv", text };
  if (!lower.endsWith(".json")) return { type: "invalid", errors: ["지원 형식: .json(협의체 반출·백업·일반 자료), .csv(비교거래)"] };
  let data: any;
  try { data = JSON.parse(text); } catch { return { type: "invalid", errors: ["JSON 형식이 아님"] }; }
  if (data?.documentType === "location-analysis-import") return { type: "committee-import", validation: validateContractDocument(data, "import") };
  if (data?.documentType === "location-analysis-launch") return { type: "launch-document", validation: validateContractDocument(data, "launch") };
  if (data?.format === "location-analyzer-backup") return restoreBackup(data);
  return { type: "general-json", data };
}

export const BACKUP_FORMAT = "location-analyzer-backup";

export function makeBackup(records: AnalysisRecord[], exportedAt: string) {
  return { format: BACKUP_FORMAT, formatVersion: 1, exportedAt, note: "새 앱 전용 백업. 협의체 결과 반환 형식이 아님.", analyses: records };
}

export function restoreBackup(data: any): DetectedFile {
  const errors: string[] = [];
  if (data.formatVersion !== 1 || !Array.isArray(data.analyses)) return { type: "backup", records: [], errors: ["백업 형식 버전 오류"] };
  data.analyses.forEach((r: any) => { if (r?.working && r?.original?.working) migrateRecord(r); });
  const recs: AnalysisRecord[] = [];
  for (const [i, r] of data.analyses.entries()) {
    if (r?.format !== ANALYSIS_FORMAT || r.formatVersion !== 1 || !r.working || !r.original?.working) { errors.push(`analyses[${i}]: 형식 오류`); continue; }
    const s = [...scanWorking(r.working), ...scanWorking(r.original.working)];
    if (r.original.document) {
      const v = validateContractDocument(r.original.document);
      if (!v.ok) s.push(...(v.issues as any));
    }
    const shape = [...checkWorkingShape(r.working), ...checkWorkingShape(r.original.working)];
    if (s.length || shape.length) { errors.push(`analyses[${i}]: 안전·형식 검사 실패(${[...s.map((x: any) => x.path), ...shape].slice(0, 3).join(", ")})`); continue; }
    recs.push(r);
  }
  return { type: "backup", records: recs, errors };
}
