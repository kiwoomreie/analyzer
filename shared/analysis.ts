// 아파트 입지·가격 분석 엔진(순수 함수). 화면·보고서가 같은 결과를 사용한다.
// 원칙: 확인된 사실 / 관찰된 변화 / 비교 차이 / 미추정을 구분하고, 자료가 없으면 적정가격·상승률을 만들지 않는다.
import { addMonths, compareMonth, formatDateValue, isBefore, monthDiff, parseDateValue, type DateParts } from "./dates.ts";
import { hashOf } from "./hash.ts";
import {
  complexKeyOf, DATA_MODE_LABEL, ENGINE_VERSION, EVENT_CATEGORY_LABEL, MILESTONE_LABEL, SUPPLY_STAGE_LABEL,
  type DataMode, type EvidenceStatus, type LocationEvent, type Milestone, type Transaction, type WorkingInputs,
} from "./model.ts";
import { deriveUnitPrices, fmtMan, fmtPct, m2ToPyeong, safeDivide, toKrw } from "./units.ts";
import { LABELS } from "./contract.ts";

export type Level = "high" | "medium" | "low";
export interface Flag { level: Level; area: "location" | "price" | "supply" | "data"; text: string }
export interface MissingItem { field: string; label: string; affects: string }

export interface Stats {
  count: number; complexes: number;
  medianPerM2: number | null; meanPerM2: number | null; p25PerM2: number | null; p75PerM2: number | null; minPerM2: number | null; maxPerM2: number | null;
}

export interface EventResult {
  key: string; name: string; category: LocationEvent["category"]; categoryLabel: string; direction: LocationEvent["direction"]; dataMode: DataMode;
  stageAsOf: string; cancelled: boolean;
  announcement: DateParts | null; initialTarget: DateParts | null; expectedTarget: DateParts | null; expectedTargetStatus: "planned" | "actual" | null; delayCount: number;
  timeline: { key: string; type: string; status: string; date: string; announcedOn: string; collectedOn: string; knownAsOf: boolean; note?: string }[];
  excludedAfterAsOf: number; undatedKnowledge: number;
  scheduleGaps: { against: "saleStart" | "completion"; label: string; months: number; text: string }[];
  access: { straightDistanceM: number | null; walkMinutes: number | null; text: string };
  evidence: { total: number; byStatus: Record<EvidenceStatus, number>; confirmedOfficial: boolean };
  prepricing: { text: string; assessment: "possible" | "unclear" | "notApplicable"; shareAfter: number | null; quantification: "정량 분리 어려움" } | null;
}

export interface ComplexResult {
  complexKey: string; name: string; dong?: string;
  buildYear: number | null; buildYearSource: string;
  distanceM: number | null; distanceSource: string;
  recentTrades: number; recentAreaMin: number | null; recentAreaMax: number | null;
  stats: Stats; latestTrade: string | null;
  status: "selected" | "eligible" | "excluded";
  reasons: string[];
  selectionReason: string;
  differences: { buildYearDiff: number | null; distanceM: number | null; areaDiffM2: number | null };
  dataModes: DataMode[];
  sources: string[];
}

export interface MarketResult {
  recentWindow: { start: string; end: string; months: number };
  areaFilter: { minM2: number; maxM2: number } | null;
  complexes: ComplexResult[];
  comparables: ComplexResult[];
  pooled: Stats;
  excludedTrades: Record<string, number>;
  validTrades: number;
  txRows: { key: string; complexKey: string; included: boolean; reasons: string[]; perM2: number | null }[];
  dataModes: DataMode[];
  sources: string[];
}

export interface PriceComparison {
  status: "computed" | "held";
  reason?: string;
  reviewText: string;
  reviewPerM2: number | null;
  reviewPerPyeong: number | null;
  basisDate: string;
  comparableMedianPerM2: number | null;
  comparableRange: { min: number; max: number } | null;
  diffPct: number | null;
  position: "above" | "within" | "below" | null;
  text: string;
}

export interface ObservedChange {
  status: "computed" | "notComputed";
  anchor: string;
  window: string;
  pre: Stats; post: Stats;
  changePct: number | null;
  text: string;
}

export interface SupplyResult {
  key: string; name: string; stage: string; households: number | null; dataMode: DataMode;
  timing: "yes" | "no" | "unknown"; area: "yes" | "no" | "unknown"; notes: string[];
}

export interface AnalysisResult {
  engineVersion: string; inputHash: string; asOf: string;
  missing: MissingItem[];
  property: { address: string; exclusiveAreaM2: number | null; exclusivePyeong: number | null; buildYear: number | null; coordinatesText: string };
  events: EventResult[];
  market: MarketResult;
  price: PriceComparison;
  observed: ObservedChange;
  supply: { rows: SupplyResult[]; window: string; overlappingHouseholds: number; text: string };
  causalEffect: { status: "notEstimated"; text: string };
  flags: Flag[];
  summary: {
    location: { key: string; text: string; detail: string }[];
    price: { comparison: string; comparables: string; observed: string; prepricing: string; causal: string; basis: string };
    uncertainties: Flag[];
  };
}

// ───────────── helpers
function quantile(sorted: number[], q: number): number | null {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export function computeStats(rows: { perM2: number; complex: string }[]): Stats {
  const v = rows.map((r) => r.perM2).sort((a, b) => a - b);
  if (!v.length) return { count: 0, complexes: 0, medianPerM2: null, meanPerM2: null, p25PerM2: null, p75PerM2: null, minPerM2: null, maxPerM2: null };
  return {
    count: v.length, complexes: new Set(rows.map((r) => r.complex)).size,
    medianPerM2: quantile(v, 0.5), meanPerM2: v.reduce((a, b) => a + b, 0) / v.length,
    p25PerM2: quantile(v, 0.25), p75PerM2: quantile(v, 0.75), minPerM2: v[0], maxPerM2: v[v.length - 1],
  };
}

/** 두 지수의 기간 변화: 상승률 차이(%p)와 상대 종가지수 격차(%). 인과효과가 아님. */
export function compareIndices(targetStart: number, targetEnd: number, compStart: number, compEnd: number) {
  const a = safeDivide(targetEnd, targetStart), b = safeDivide(compEnd, compStart);
  const targetChangePct = a === null ? null : (a - 1) * 100;
  const comparatorChangePct = b === null ? null : (b - 1) * 100;
  const diffPp = targetChangePct === null || comparatorChangePct === null ? null : targetChangePct - comparatorChangePct;
  const rel = a === null || b === null ? null : safeDivide(a, b);
  return { targetChangePct, comparatorChangePct, diffPp, relativeGapPct: rel === null ? null : (rel - 1) * 100 };
}

export function haversineM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371008.8, toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const monthKey = (p: DateParts) => `${p.y}-${String(p.m).padStart(2, "0")}`;
const sortKey = (p: DateParts | null) => (p ? p.y * 400 + p.m * 32 + (p.d ?? 0) : -1);

function knownAsOf(m: Milestone, asOf: DateParts): boolean | "undated" {
  const k = parseDateValue(m.announcedOn ?? null) ?? parseDateValue(m.collectedOn ?? null);
  if (!k) return "undated";
  const b = isBefore(k, asOf);
  if (b === null) return compareMonth(k, asOf) <= 0;
  return b || (compareMonth(k, asOf) === 0 && k.precision === "day" && asOf.precision === "day" && k.d === asOf.d);
}

function mode<T>(arr: T[]): T | null {
  const m = new Map<T, number>();
  arr.forEach((x) => m.set(x, (m.get(x) ?? 0) + 1));
  let best: T | null = null, n = 0;
  m.forEach((c, k) => { if (c > n) { n = c; best = k; } });
  return best;
}

// ───────────── main
export function runAnalysis(w: WorkingInputs): AnalysisResult {
  const asOf = parseDateValue(w.asOf)!;
  const flags: Flag[] = [];
  const missing: MissingItem[] = [];
  const area = w.property.exclusiveAreaM2 ?? null;
  const coords = w.property.coordinates ?? null;
  const o = w.options;

  if (!coords) missing.push({ field: "property.coordinates", label: "본건 좌표", affects: "비교단지·입지 사건까지 거리(주소 자동 변환 미설정 시 직접 입력)" });
  if (!area) missing.push({ field: "property.exclusiveAreaM2", label: "전용면적", affects: "유사면적 비교·세대당 검토가격의 ㎡당 환산(가격 판단 보류)" });
  if (!w.reviewPrice) missing.push({ field: "reviewPrice", label: "검토가격", affects: "검토가격과 실거래 비교(시세 수준만 표시)" });
  if (!w.transactions.length) missing.push({ field: "transactions", label: "인근 실거래", affects: "비교단지·시세 수준(공공데이터 키 미설정 시 CSV로 추가)" });
  if (!w.events.length) missing.push({ field: "events", label: "입지 사건", affects: "입지 변화 정리" });

  const evByKey = new Map(w.evidence.map((e) => [e.key, e]));
  const events: EventResult[] = w.events.map((ev) => analyzeEvent(ev, w, asOf, coords, evByKey, flags));
  const market = analyzeMarket(w, asOf, area, coords, flags);
  const price = comparePrice(w, area, market, flags);
  const observed = observeChange(w, asOf, events, market, flags);

  // 선반영 가능성
  const priceDate = parseDateValue(w.reviewPrice?.basisDate ?? null);
  const txByKey = new Map(w.transactions.map((t) => [t.key, t]));
  const poolRows = market.txRows.filter((r) => r.included);
  for (const er of events) {
    if (er.category === "supply") continue;
    if (!er.announcement) { er.prepricing = { text: "발표일 미확인 — 선반영 검토 불가", assessment: "notApplicable", shareAfter: null, quantification: "정량 분리 어려움" }; continue; }
    const after = priceDate ? isBefore(er.announcement, priceDate) : null;
    const afterCount = poolRows.filter((r) => { const d = parseDateValue(txByKey.get(r.key)!.contractDate); return d && compareMonth(d, er.announcement!) >= 0; }).length;
    const share = poolRows.length ? afterCount / poolRows.length : null;
    const possible = after === true || (share !== null && share > 0);
    er.prepricing = {
      assessment: possible ? "possible" : "unclear", shareAfter: share, quantification: "정량 분리 어려움",
      text: [
        `발표 ${formatDateValue(er.announcement)}`,
        priceDate ? `검토가격 기준일 ${formatDateValue(priceDate)}${after === true ? "(발표 이후)" : after === false ? "(발표 이전)" : "(같은 달)"}` : "검토가격 기준일 미입력",
        share === null ? "비교거래 없음" : `대표 비교단지 최근 거래 중 발표 이후 계약 ${fmtPct(share * 100, 0)}`,
        w.appraisalNote ? "가격 근거 문서의 설명 입력됨" : "가격 근거 문서의 반영 설명 미입력",
      ].join(" · ") + `. ${possible ? "발표 이후 거래·가격이 있어 기대가 일부 반영됐을 가능성이 있음" : "반영 여부를 판단할 근거 부족"}. 반영 정도는 정량 분리 어려움.`,
    };
  }

  const supply = analyzeSupply(w, asOf, area, flags);
  if (w.transactions.some((t) => t.dataMode === "demo") || w.events.some((e) => e.dataMode === "demo")) flags.push({ level: "high", area: "data", text: "가상 자료가 포함됨 — 실제 판단에 사용 불가" });

  const order: Record<Level, number> = { high: 0, medium: 1, low: 2 };
  flags.sort((a, b) => order[a.level] - order[b.level]);

  const summaryLocation = events.filter((e) => e.category !== "supply").map((e) => ({
    key: e.key,
    text: `[${e.categoryLabel}] ${e.name} — ${e.stageAsOf}${e.expectedTarget ? `, ${e.expectedTargetStatus === "actual" ? "완료" : "예정"} ${formatDateValue(e.expectedTarget)}` : ""}`,
    detail: [
      e.evidence.confirmedOfficial ? `공식 확인 ${e.evidence.byStatus.confirmed}건` : "공식 자료 미확인",
      e.delayCount ? `지연 ${e.delayCount}회` : null,
      ...e.scheduleGaps.map((g) => g.text),
      e.access.text,
      e.dataMode === "demo" ? "가상 자료" : null,
    ].filter(Boolean).join(" · "),
  }));
  if (supply.rows.length) summaryLocation.push({ key: "supply", text: `[주변 입주 물량] ${supply.rows.length}건 — ${supply.text}`, detail: supply.rows.map((s) => `${s.name}(${s.stage}${s.households ? `, ${s.households.toLocaleString("ko-KR")}세대` : ""})`).join(" · ") });

  const comparablesText = market.comparables.length
    ? `대표 비교단지 ${market.comparables.length}개(최근 ${o.recentMonths}개월 ${area ? "유사면적 " : ""}거래 ${market.pooled.count}건, 중위 ${fmtMan(market.pooled.medianPerM2)}/전용㎡)`
    : "비교 가능한 단지 없음 — 대표 비교단지를 억지로 채우지 않음";
  const firstPre = events.find((e) => e.prepricing && e.prepricing.assessment !== "notApplicable");

  return {
    engineVersion: ENGINE_VERSION, inputHash: hashOf(w), asOf: w.asOf, missing,
    property: {
      address: w.property.address, exclusiveAreaM2: area, exclusivePyeong: area ? m2ToPyeong(area) : null, buildYear: w.property.buildYear ?? null,
      coordinatesText: coords ? `${coords.lat.toFixed(6)}, ${coords.lng.toFixed(6)} (${coords.source})` : "좌표 미입력",
    },
    events, market, price, observed, supply,
    causalEffect: { status: "notEstimated", text: "미추정 — 검증된 통계 모델을 적용하지 않아 입지 변화의 인과적 가격효과를 추정하지 않음" },
    flags,
    summary: {
      location: summaryLocation,
      price: {
        comparison: price.text,
        comparables: comparablesText,
        observed: observed.text,
        prepricing: firstPre?.prepricing ? `${firstPre.name}: ${firstPre.prepricing.assessment === "possible" ? "선반영 가능성 있음" : "판단 근거 부족"}(정량 분리 어려움)` : "선반영: 검토할 발표일 자료 없음",
        causal: "인과 추정 효과: 미추정",
        basis: `기준일 ${w.asOf} · 금액 만원 · 면적 전용㎡ · 출처 ${market.sources.length ? market.sources.join(", ") : "거래 자료 없음"}`,
      },
      uncertainties: flags.filter((f) => f.level !== "low").slice(0, 7),
    },
  };
}

function analyzeEvent(ev: LocationEvent, w: WorkingInputs, asOf: DateParts, coords: { lat: number; lng: number } | null, evByKey: Map<string, WorkingInputs["evidence"][number]>, flags: Flag[]): EventResult {
  const timeline = ev.milestones.map((m) => {
    const k = knownAsOf(m, asOf);
    return { key: m.key, type: MILESTONE_LABEL[m.type], status: m.status === "actual" ? "실제" : "예정", date: m.date ?? "미입력", announcedOn: m.announcedOn ?? "미입력", collectedOn: m.collectedOn ?? "미입력", knownAsOf: k !== false, note: m.note, _m: m, _u: k === "undated" };
  });
  const known = timeline.filter((t) => t.knownAsOf).map((t) => t._m);
  const excludedAfterAsOf = timeline.filter((t) => !t.knownAsOf).length;
  const undatedKnowledge = timeline.filter((t) => t._u).length;
  if (excludedAfterAsOf) flags.push({ level: "low", area: "data", text: `${ev.name}: 분석 기준일 이후 알려진 일정 ${excludedAfterAsOf}건 제외(과거 시점 재현 한계)` });
  if (undatedKnowledge) flags.push({ level: "low", area: "data", text: `${ev.name}: 발표일·수집일 없는 일정 ${undatedKnowledge}건` });

  const byAnn = (a: Milestone, b: Milestone) => sortKey(parseDateValue(a.announcedOn ?? a.collectedOn ?? null)) - sortKey(parseDateValue(b.announcedOn ?? b.collectedOn ?? null));
  const anns = known.filter((m) => m.type === "announcement").sort(byAnn);
  const announcement = parseDateValue(anns[0]?.date ?? anns[0]?.announcedOn ?? null);
  const targetTypes = ev.category === "supply" ? ["occupancy", "delay"] : ["opening", "delay"];
  const tms = known.filter((m) => targetTypes.includes(m.type)).sort(byAnn);
  const initialTarget = parseDateValue(tms.find((m) => m.type !== "delay")?.date ?? null);
  const latest = [...tms].reverse().find((m) => parseDateValue(m.date ?? null));
  const actual = known.find((m) => targetTypes.includes(m.type) && m.type !== "delay" && m.status === "actual" && parseDateValue(m.date ?? null));
  let expectedTarget = parseDateValue((actual ?? latest)?.date ?? null);
  if (!expectedTarget && ev.category === "supply") expectedTarget = parseDateValue(ev.supply?.occupancyDate ?? null);
  const expectedTargetStatus = expectedTarget ? (actual ? "actual" : "planned") : null;
  const cancelled = known.some((m) => m.type === "cancellation");
  const delayCount = known.filter((m) => m.type === "delay").length;
  const actuals = known.filter((m) => m.status === "actual").sort((a, b) => sortKey(parseDateValue(a.date ?? null)) - sortKey(parseDateValue(b.date ?? null)));
  const stageAsOf = cancelled ? "취소" : actuals.length ? `${MILESTONE_LABEL[actuals[actuals.length - 1].type]} 완료` : known.length ? "계획·예정 단계" : ev.supply ? `${SUPPLY_STAGE_LABEL[ev.supply.stage]} 단계` : "기준일 현재 확인된 일정 없음";

  const scheduleGaps: EventResult["scheduleGaps"] = [];
  if (expectedTarget) {
    for (const [k, label] of [["saleStart", "분양"], ["completion", "준공"]] as const) {
      const d = parseDateValue(w.schedule[k] ?? null);
      if (!d) continue;
      const months = monthDiff(d, expectedTarget);
      scheduleGaps.push({ against: k, label, months, text: months > 0 ? `본건 ${label}보다 ${months}개월 뒤` : months < 0 ? `본건 ${label}보다 ${-months}개월 앞` : `본건 ${label}과 같은 달` });
    }
  }
  if (cancelled) flags.push({ level: "high", area: "location", text: `${ev.name}: 취소 이력` });
  if (delayCount) flags.push({ level: "high", area: "location", text: `${ev.name}: 계획 지연 ${delayCount}회(최초 ${formatDateValue(initialTarget)} → 최신 ${formatDateValue(expectedTarget)})` });
  const gc = scheduleGaps.find((g) => g.against === "completion");
  if (gc && gc.months > 0 && ev.category !== "supply") flags.push({ level: "medium", area: "location", text: `${ev.name}: 본건 준공보다 ${gc.months}개월 뒤 완료 예정 — 실제 이용 편익은 그 이후 발생하며 현재 가격 반영 여부는 별도 검토(영향을 0으로 단정하지 않음)` });

  const straight = coords && ev.location ? haversineM(coords, ev.location) : null;
  const walk = ev.access?.routeWalkMinutes ?? null;
  const accessText = [
    straight === null ? "직선거리 미산출(좌표 부족)" : `직선거리 약 ${Math.round(straight).toLocaleString("ko-KR")}m`,
    ev.category === "supply" ? null : walk === null ? "보행 경로 자료 없음 — 보행시간 미산출" : `보행 ${walk}분(${ev.access?.routeSource ?? "출처 미기재"})`,
  ].filter(Boolean).join(" · ");

  const evs = ev.evidenceKeys.map((k) => evByKey.get(k)).filter(Boolean) as WorkingInputs["evidence"];
  const byStatus = { confirmed: 0, needsApplicability: 0, inconsistent: 0, hardToVerify: 0 } as Record<EvidenceStatus, number>;
  evs.forEach((e) => byStatus[e.status]++);
  const confirmedOfficial = byStatus.confirmed > 0;
  if (!confirmedOfficial) flags.push({ level: ev.category === "supply" ? "medium" : "high", area: ev.category === "supply" ? "supply" : "location", text: `${ev.name}: 공식 자료로 확인된 근거 없음` });
  if (byStatus.inconsistent) flags.push({ level: "medium", area: "location", text: `${ev.name}: 자료 간 불일치 ${byStatus.inconsistent}건` });

  return {
    key: ev.key, name: ev.name, category: ev.category, categoryLabel: EVENT_CATEGORY_LABEL[ev.category], direction: ev.direction, dataMode: ev.dataMode,
    stageAsOf, cancelled, announcement, initialTarget, expectedTarget, expectedTargetStatus, delayCount,
    timeline: timeline.map(({ _m, _u, ...t }) => t), excludedAfterAsOf, undatedKnowledge, scheduleGaps,
    access: { straightDistanceM: straight, walkMinutes: walk, text: accessText },
    evidence: { total: evs.length, byStatus, confirmedOfficial }, prepricing: null,
  };
}

function analyzeMarket(w: WorkingInputs, asOf: DateParts, area: number | null, coords: { lat: number; lng: number } | null, flags: Flag[]): MarketResult {
  const o = w.options;
  const asOfMonth: DateParts = { raw: monthKey(asOf), precision: "month", y: asOf.y, m: asOf.m };
  const start = addMonths(asOfMonth, -(o.recentMonths - 1));
  const band = area ? { minM2: area * (1 - o.areaBandPct / 100), maxM2: area * (1 + o.areaBandPct / 100) } : null;
  const excludedTrades: Record<string, number> = {};
  const infoByKey = new Map(w.complexInfo.map((c) => [c.complexKey, c]));

  const txRows = w.transactions.map((t: Transaction) => {
    const reasons: string[] = [];
    const d = parseDateValue(t.contractDate);
    if (t.cancelled) reasons.push("해제(취소) 거래");
    if (!d) reasons.push("계약일 형식 오류");
    else {
      if (isBefore(asOf, d) === true) reasons.push("분석 기준일 이후 계약");
      else if (compareMonth(d, start) < 0) reasons.push(`최근 ${o.recentMonths}개월 이전`);
    }
    if (!(t.exclusiveAreaM2 > 0) || !(t.priceKrw > 0)) reasons.push("면적·금액 미입력");
    else if (band && (t.exclusiveAreaM2 < band.minM2 || t.exclusiveAreaM2 > band.maxM2)) reasons.push("유사면적 범위 외");
    if (t.manualExclusion) reasons.push(`사용자 제외: ${t.manualExclusion}`);
    reasons.forEach((r) => { const k = r.startsWith("사용자 제외") ? "사용자 제외" : r; excludedTrades[k] = (excludedTrades[k] ?? 0) + 1; });
    return { key: t.key, complexKey: complexKeyOf(t), included: false, reasons, perM2: t.exclusiveAreaM2 > 0 && t.priceKrw > 0 ? t.priceKrw / t.exclusiveAreaM2 : null };
  });
  const validTrades = w.transactions.filter((t) => !t.cancelled && t.exclusiveAreaM2 > 0 && t.priceKrw > 0 && parseDateValue(t.contractDate)).length;

  const groups = new Map<string, Transaction[]>();
  w.transactions.forEach((t) => { const k = complexKeyOf(t); groups.set(k, [...(groups.get(k) ?? []), t]); });
  const rowByKey = new Map(txRows.map((r) => [r.key, r]));
  const complexes: ComplexResult[] = [];
  for (const [ck, txs] of groups) {
    const info = infoByKey.get(ck);
    const ok = txs.filter((t) => rowByKey.get(t.key)!.reasons.length === 0);
    const by = info?.buildYear ?? mode(txs.map((t) => t.buildYear).filter((x): x is number => !!x));
    const loc = info?.location;
    const dist = info?.distanceM ?? (coords && loc ? haversineM(coords, loc) : null);
    const stats = computeStats(ok.map((t) => ({ perM2: t.priceKrw / t.exclusiveAreaM2, complex: ck })));
    const dates = ok.map((t) => t.contractDate).sort();
    const reasons: string[] = [];
    const subjectYear = w.property.buildYear ?? null;
    const byDiff = by && subjectYear ? by - subjectYear : null;
    let excluded = false;
    const forced = info?.userDecision === "include";
    if (info?.userDecision === "exclude") { reasons.push(`사용자 제외${info.userReason ? `: ${info.userReason}` : ""}`); excluded = true; }
    if (ok.length === 0) { reasons.push(`최근 ${o.recentMonths}개월 ${band ? "유사면적 " : ""}거래 없음`); excluded = true; }
    else if (ok.length < o.minComplexTrades && !forced) { reasons.push(`최근 ${o.recentMonths}개월 ${band ? "유사면적 " : ""}거래 ${ok.length}건 — 표본 부족(기준 ${o.minComplexTrades}건)`); excluded = true; }
    if (dist !== null && dist > o.radiusM && !forced) { reasons.push(`거리 약 ${Math.round(dist).toLocaleString("ko-KR")}m — 반경 ${o.radiusM.toLocaleString("ko-KR")}m 초과`); excluded = true; }
    if (byDiff !== null && Math.abs(byDiff) > o.buildYearBand && !forced) { reasons.push(`준공연도 차이 ${Math.abs(byDiff)}년 — 기준 ${o.buildYearBand}년 초과`); excluded = true; }
    if (dist === null) reasons.push("거리 미확인");
    if (by === null) reasons.push("준공연도 미확인");
    if (forced) reasons.push("사용자 포함 지정");
    const areas = ok.map((t) => t.exclusiveAreaM2).sort((a, b) => a - b);
    const medArea = areas.length ? areas[Math.floor(areas.length / 2)] : null;
    complexes.push({
      complexKey: ck, name: txs[0].complexName, dong: txs[0].dong,
      buildYear: by, buildYearSource: info?.buildYear ? "사용자 확인" : by ? "거래 자료" : "없음",
      distanceM: dist, distanceSource: info?.distanceM !== undefined ? (info.distanceSource ?? "사용자 입력") : dist !== null ? "좌표 간 직선거리" : "없음",
      recentTrades: ok.length, recentAreaMin: areas.length ? areas[0] : null, recentAreaMax: areas.length ? areas[areas.length - 1] : null,
      stats, latestTrade: dates[dates.length - 1] ?? null,
      status: excluded ? "excluded" : "eligible", reasons, selectionReason: "",
      differences: { buildYearDiff: byDiff, distanceM: dist, areaDiffM2: area && medArea ? medArea - area : null },
      dataModes: [...new Set(txs.map((t) => t.dataMode))], sources: [...new Set(txs.map((t) => t.source ?? DATA_MODE_LABEL[t.dataMode]))],
    });
  }
  // 대표 비교단지: 거리 확인된 단지 우선 → 가까운 순 → 준공연도 차이 작은 순 → 거래 많은 순, 최대 5개
  const eligible = complexes.filter((c) => c.status === "eligible").sort((a, b) =>
    (a.distanceM === null ? 1 : 0) - (b.distanceM === null ? 1 : 0) || (a.distanceM ?? 0) - (b.distanceM ?? 0) ||
    Math.abs(a.differences.buildYearDiff ?? 99) - Math.abs(b.differences.buildYearDiff ?? 99) || b.recentTrades - a.recentTrades);
  const comparables = eligible.slice(0, 5);
  comparables.forEach((c) => {
    c.status = "selected";
    c.selectionReason = [
      c.distanceM !== null ? `약 ${Math.round(c.distanceM).toLocaleString("ko-KR")}m(반경 ${o.radiusM.toLocaleString("ko-KR")}m 이내)` : "거리 미확인(확인 필요)",
      c.buildYear ? `준공 ${c.buildYear}년${c.differences.buildYearDiff !== null ? `(본건 대비 ${c.differences.buildYearDiff > 0 ? "+" : ""}${c.differences.buildYearDiff}년)` : ""}` : "준공연도 미확인",
      `최근 ${o.recentMonths}개월 ${area ? "유사면적 " : ""}거래 ${c.recentTrades}건`,
    ].join(" · ");
  });
  eligible.slice(5).forEach((c) => c.reasons.push("대표 5개 순위 밖(거리·연식 기준)"));
  const selectedKeys = new Set(comparables.map((c) => c.complexKey));
  txRows.forEach((r) => { r.included = r.reasons.length === 0 && selectedKeys.has(r.complexKey); if (r.reasons.length === 0 && !r.included) r.reasons.push("대표 비교단지 아님"); });
  const pooled = computeStats(txRows.filter((r) => r.included).map((r) => ({ perM2: r.perM2!, complex: r.complexKey })));

  if (w.transactions.length && !comparables.length) flags.push({ level: "high", area: "price", text: "비교 가능한 단지 없음(거래 표본·면적·거리·준공연도 기준 미충족)" });
  else if (comparables.length && comparables.length < 3) flags.push({ level: "medium", area: "price", text: `비교 가능한 단지 ${comparables.length}개뿐 — 비교 범위 제한` });
  if (comparables.some((c) => c.distanceM === null)) flags.push({ level: "medium", area: "price", text: "일부 비교단지 거리 미확인 — 단지 위치 확인 필요" });
  if (comparables.length && !w.property.buildYear) flags.push({ level: "medium", area: "price", text: "본건 준공(예정)연도 미입력 — 비교단지와 연식 차이 비교 불가" });
  else if (comparables.some((c) => c.buildYear === null)) flags.push({ level: "medium", area: "price", text: "일부 비교단지 준공연도 미확인" });
  const bigYear = comparables.filter((c) => c.differences.buildYearDiff !== null && Math.abs(c.differences.buildYearDiff) >= 5);
  if (bigYear.length) flags.push({ level: "medium", area: "price", text: `비교단지와 연식 차이 5년 이상: ${bigYear.map((c) => c.name).join(", ")} — 신축·구축 차이 해석 필요` });
  if (pooled.count > 0 && pooled.count < o.minSample) flags.push({ level: "high", area: "price", text: `비교 거래 표본 ${pooled.count}건(기준 ${o.minSample}건 미만)` });
  if (!area && w.transactions.length) flags.push({ level: "medium", area: "price", text: "전용면적 미입력 — 모든 면적 거래를 ㎡당으로 비교(면적대 차이 미반영)" });

  return {
    recentWindow: { start: start.raw, end: asOfMonth.raw, months: o.recentMonths }, areaFilter: band, complexes, comparables, pooled, excludedTrades, validTrades, txRows,
    dataModes: [...new Set(w.transactions.map((t) => t.dataMode))], sources: [...new Set(w.transactions.map((t) => t.source ?? DATA_MODE_LABEL[t.dataMode]))].slice(0, 5),
  };
}

function comparePrice(w: WorkingInputs, area: number | null, market: MarketResult, flags: Flag[]): PriceComparison {
  const rp = w.reviewPrice;
  const base = { reviewPerM2: null, reviewPerPyeong: null, comparableMedianPerM2: market.pooled.medianPerM2, comparableRange: null, diffPct: null, position: null } as const;
  if (!rp) return { ...base, status: "held", reason: "검토가격 미입력", reviewText: "미입력", basisDate: "-", text: `가격 판단 보류 — 검토가격 미입력. 시세 수준: ${market.pooled.count ? `대표 비교단지 거래 중위 ${fmtMan(market.pooled.medianPerM2)}/전용㎡` : "비교 가능한 거래 없음"}` };
  const krw = toKrw(rp.amount, rp.unit);
  const reviewText = `${rp.label ?? "검토가격"} ${rp.amount.toLocaleString("ko-KR")}${LABELS.moneyUnit[rp.unit]}(${LABELS.priceBasis[rp.basis]})`;
  const basisDate = rp.basisDate ?? "기준일 미입력";
  if (!rp.basisDate) flags.push({ level: "low", area: "price", text: "검토가격 기준일 미입력" });
  if (krw === null) return { ...base, status: "held", reason: "금액 환산 불가", reviewText, basisDate, text: "가격 판단 보류 — 금액 환산 불가" };
  const u = deriveUnitPrices(krw, rp.basis, area, null);
  if (u.perM2Krw === null) return { ...base, status: "held", reason: "전용면적 필요", reviewText, basisDate, text: "가격 판단 보류 — 세대당 검토가격을 ㎡당으로 바꾸려면 전용면적 필요" };
  const med = market.pooled.medianPerM2;
  const meds = market.comparables.map((c) => c.stats.medianPerM2).filter((x): x is number => x !== null);
  const range = meds.length ? { min: Math.min(...meds), max: Math.max(...meds) } : null;
  if (med === null) return { ...base, status: "held", reason: "비교 거래 없음", reviewText, basisDate, reviewPerM2: u.perM2Krw, reviewPerPyeong: u.perPyeongKrw, text: `가격 판단 보류 — 비교 가능한 실거래 없음(검토가격 ${fmtMan(u.perM2Krw)}/전용㎡)` };
  const diffPct = (u.perM2Krw / med - 1) * 100;
  const position = range ? (u.perM2Krw > range.max ? "above" : u.perM2Krw < range.min ? "below" : "within") : null;
  if (position === "above") flags.push({ level: "high", area: "price", text: `검토가격이 대표 비교단지 중위 단가 범위(${fmtMan(range!.min)}~${fmtMan(range!.max)}/전용㎡)보다 높음 — 상회 근거 확인 필요` });
  else if (Math.abs(diffPct) >= 10) flags.push({ level: "medium", area: "price", text: `검토가격이 비교 거래 중위값과 ${diffPct > 0 ? "+" : ""}${diffPct.toFixed(1)}% 차이` });
  return {
    status: "computed", reviewText, basisDate, reviewPerM2: u.perM2Krw, reviewPerPyeong: u.perPyeongKrw, comparableMedianPerM2: med, comparableRange: range, diffPct, position,
    text: `검토가격 ${fmtMan(u.perM2Krw)}/전용㎡는 대표 비교단지 거래 중위 ${fmtMan(med)}/전용㎡ 대비 ${diffPct > 0 ? "+" : ""}${diffPct.toFixed(1)}%${range ? `, 단지별 중위 범위(${fmtMan(range.min)}~${fmtMan(range.max)}) ${position === "above" ? "상단 초과" : position === "below" ? "하단 미만" : "안"}` : ""}. 적정가격을 산정한 것이 아님.`,
  };
}

function observeChange(w: WorkingInputs, asOf: DateParts, events: EventResult[], market: MarketResult, flags: Flag[]): ObservedChange {
  const o = w.options;
  const anchorEv = events.find((e) => e.key === o.anchorEventKey && e.announcement) ?? events.find((e) => e.category !== "supply" && e.announcement);
  const empty = computeStats([]);
  if (!anchorEv) return { status: "notComputed", anchor: "-", window: "-", pre: empty, post: empty, changePct: null, text: "관찰된 변화: 발표일이 확인된 입지 사건이 없어 전후 비교 안 함" };
  const a = anchorEv.announcement!;
  const am: DateParts = { raw: monthKey(a), precision: "month", y: a.y, m: a.m };
  const start = addMonths(am, -o.comparisonMonthsBefore);
  let end = addMonths(am, o.comparisonMonthsAfter);
  if (compareMonth(end, asOf) > 0) end = { raw: monthKey(asOf), precision: "month", y: asOf.y, m: asOf.m };
  const sel = new Set(market.comparables.map((c) => c.complexKey));
  const band = market.areaFilter;
  const rows = w.transactions.filter((t) => sel.has(complexKeyOf(t)) && !t.cancelled && !t.manualExclusion && t.exclusiveAreaM2 > 0 && t.priceKrw > 0 && (!band || (t.exclusiveAreaM2 >= band.minM2 && t.exclusiveAreaM2 <= band.maxM2)));
  const pre: { perM2: number; complex: string }[] = [], post: { perM2: number; complex: string }[] = [];
  rows.forEach((t) => {
    const d = parseDateValue(t.contractDate);
    if (!d || compareMonth(d, start) < 0 || compareMonth(d, end) > 0 || isBefore(asOf, d) === true) return;
    const c = compareMonth(d, am);
    if (c < 0) pre.push({ perM2: t.priceKrw / t.exclusiveAreaM2, complex: complexKeyOf(t) });
    else if (c > 0) post.push({ perM2: t.priceKrw / t.exclusiveAreaM2, complex: complexKeyOf(t) });
  });
  const ps = computeStats(pre), qs = computeStats(post);
  const window = `${start.raw}~${end.raw}(발표월 제외)`;
  const firstMonth = rows.map((t) => t.contractDate).sort()[0];
  if (rows.length && (!firstMonth || firstMonth.slice(0, 7) > start.raw)) flags.push({ level: "medium", area: "data", text: `사건 전 비교기간(${start.raw}부터) 중 거래 자료가 ${firstMonth?.slice(0, 7) ?? "없음"}부터만 있음 — 기간 부족, 빈 기간을 채우지 않음` });
  if (ps.count < o.minSample || qs.count < o.minSample) {
    flags.push({ level: "medium", area: "price", text: `${anchorEv.name} 전후 거래 표본 부족(전 ${ps.count}건·후 ${qs.count}건, 기준 ${o.minSample}건) — 관찰 변화 미산출` });
    return { status: "notComputed", anchor: `${anchorEv.name} 발표 ${formatDateValue(a)}`, window, pre: ps, post: qs, changePct: null, text: `관찰된 변화: 표본 부족으로 미산출(전 ${ps.count}건·후 ${qs.count}건)` };
  }
  const changePct = (qs.medianPerM2! / ps.medianPerM2! - 1) * 100;
  return { status: "computed", anchor: `${anchorEv.name} 발표 ${formatDateValue(a)}`, window, pre: ps, post: qs, changePct, text: `관찰된 변화: ${anchorEv.name} 발표 전후 대표 비교단지 중위 단가 ${changePct > 0 ? "+" : ""}${changePct.toFixed(1)}%(전 ${ps.count}건·후 ${qs.count}건). 시장 전반 변화가 섞여 있어 입지 효과로 볼 수 없음.` };
}

function analyzeSupply(w: WorkingInputs, asOf: DateParts, area: number | null, flags: Flag[]): AnalysisResult["supply"] {
  const o = w.options;
  const sale = parseDateValue(w.schedule.saleStart ?? null), comp = parseDateValue(w.schedule.completion ?? null);
  let from: DateParts, to: DateParts, windowText: string;
  if (sale || comp) {
    from = addMonths(sale ?? comp!, -12);
    to = addMonths(comp ?? sale!, 12);
    windowText = `본건 ${sale ? "분양" : "준공"} 12개월 전 ~ ${comp ? "준공" : "분양"} 12개월 후(${monthKey(from)}~${monthKey(to)})`;
  } else {
    from = { raw: monthKey(asOf), precision: "month", y: asOf.y, m: asOf.m };
    to = addMonths(from, 36);
    windowText = `기준일 이후 36개월(${monthKey(from)}~${monthKey(to)}, 본건 일정 미입력)`;
  }
  const band = area ? [area * (1 - o.areaBandPct / 100), area * (1 + o.areaBandPct / 100)] : null;
  let overlappingHouseholds = 0;
  const rows: SupplyResult[] = w.events.filter((e) => e.category === "supply").map((e) => {
    const s = e.supply ?? { stage: "plan" as const };
    const notes: string[] = [];
    const dates = [parseDateValue(s.saleDate ?? null), parseDateValue(s.occupancyDate ?? null)].filter(Boolean) as DateParts[];
    let timing: SupplyResult["timing"] = "unknown";
    if (!dates.length) notes.push("공급 시기 미입력");
    else timing = dates.some((d) => compareMonth(d, from) >= 0 && compareMonth(d, to) <= 0) ? "yes" : "no";
    let areaO: SupplyResult["area"] = "unknown";
    if (band && s.areaMinM2 && s.areaMaxM2) areaO = s.areaMaxM2 >= band[0] && s.areaMinM2 <= band[1] ? "yes" : "no";
    else notes.push("면적대 비교 불가");
    if (timing === "yes" && s.households) overlappingHouseholds += s.households;
    if (timing === "yes") flags.push({ level: areaO === "yes" ? "high" : "medium", area: "supply", text: `경쟁 공급 ${e.name}(${SUPPLY_STAGE_LABEL[s.stage]}${s.households ? `, ${s.households.toLocaleString("ko-KR")}세대` : ""}) — 시기${areaO === "yes" ? "·면적대" : ""} 겹침` });
    return { key: e.key, name: e.name, stage: SUPPLY_STAGE_LABEL[s.stage], households: s.households ?? null, dataMode: e.dataMode, timing, area: areaO, notes };
  });
  return {
    rows, window: windowText, overlappingHouseholds,
    text: rows.length ? `시기 겹침 ${rows.filter((r) => r.timing === "yes").length}건(${overlappingHouseholds.toLocaleString("ko-KR")}세대, ${windowText}). 분양률·매각기간으로 환산하지 않음` : "입력된 주변 입주 물량 없음",
  };
}
