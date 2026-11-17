// 분석 엔진(순수 함수). 화면·보고서·서버 자동 분석이 모두 이 함수를 사용한다.
// 원칙: 관찰된 변화 / 비교대상과의 차이 / 인과 추정 효과 / 사용자 스트레스 가정을 구분한다.
// 검증된 통계 모델이 없으므로 인과 추정 효과는 항상 '미추정'이다.
import { LABELS, type PriceKind } from "./contract.ts";
import { addMonths, compareMonth, formatDateValue, isBefore, monthDiff, parseDateValue, type DateParts } from "./dates.ts";
import { hashOf } from "./hash.ts";
import {
  DATA_MODE_LABEL, ENGINE_VERSION, EVENT_CATEGORY_LABEL, EVIDENCE_STATUS_LABEL, MILESTONE_LABEL, SUPPLY_STAGE_LABEL,
  type DataMode, type EvidenceStatus, type LocationEvent, type Milestone, type Transaction, type WorkingInputs,
} from "./model.ts";
import { deriveUnitPrices, fmtEok, fmtMan, fmtPct, fmtPp, m2ToPyeong, safeDivide, toKrw, type UnitPrices } from "./units.ts";

export type Level = "high" | "medium" | "low";

export interface Flag {
  level: Level;
  area: "location" | "price" | "supply" | "schedule" | "data" | "ltv";
  text: string;
}

export interface MissingItem {
  field: string;
  label: string;
  affects: string;
}

export interface PriceResult {
  key: string;
  kind: PriceKind;
  label: string;
  input: string;
  dataMode: DataMode;
  basisDate: string;
  unit: UnitPrices | null;
  error?: string;
}

export interface ScheduleGap {
  against: "saleStart" | "completion" | "maturity" | "expectedDisposal";
  label: string;
  months: number;
  text: string;
}

export interface EventResult {
  key: string;
  name: string;
  category: LocationEvent["category"];
  categoryLabel: string;
  direction: LocationEvent["direction"];
  dataMode: DataMode;
  stageAsOf: string;
  cancelled: boolean;
  announcement: DateParts | null;
  initialOpening: DateParts | null;
  expectedOpening: DateParts | null;
  expectedOpeningStatus: "planned" | "actual" | null;
  delayCount: number;
  timeline: { key: string; type: string; status: string; date: string; announcedOn: string; collectedOn: string; knownAsOf: boolean; note?: string }[];
  excludedAfterAsOf: number;
  undatedKnowledge: number;
  scheduleGaps: ScheduleGap[];
  delayedScenario: { delayMonths: number; opening: DateParts; gapToMaturity: number | null } | null;
  maturityNote: string | null;
  access: { straightDistanceM: number | null; walkMinutes: number | null; text: string };
  evidence: { total: number; byStatus: Record<EvidenceStatus, number>; confirmedOfficial: boolean };
  prepricing: PrepricingResult | null;
}

export interface PrepricingResult {
  announcement: string;
  appraisalBasisDate: string;
  appraisalAfterAnnouncement: boolean | null;
  compsAfterAnnouncementShare: number | null;
  assessment: "possible" | "unclear" | "notApplicable";
  quantification: "정량 분리 어려움";
  text: string;
}

export interface Stats {
  count: number;
  complexes: number;
  medianPerM2: number | null;
  meanPerM2: number | null;
  p25PerM2: number | null;
  p75PerM2: number | null;
  minPerM2: number | null;
  maxPerM2: number | null;
}

export interface CompsResult {
  anchor: { label: string; date: DateParts };
  window: { start: DateParts; end: DateParts; endCappedByAsOf: boolean; monthsBefore: number; monthsAfter: number };
  areaBand: { minM2: number; maxM2: number } | null;
  rows: { key: string; included: boolean; reasons: string[]; perM2: number | null; period: "pre" | "post" | "anchorMonth" | null; group: "target" | "comparator"; dataMode: DataMode }[];
  exclusionCounts: Record<string, number>;
  target: { all: Stats; pre: Stats; post: Stats };
  comparator: { all: Stats; pre: Stats; post: Stats };
  monthly: { month: string; target: number; comparator: number; targetMedianPerM2: number | null }[];
  emptyMonths: number;
  dataCoverage: { firstMonth: string | null; lastMonth: string | null; shortOfWindow: boolean };
  observed: {
    targetChangePct: number | null;
    comparatorChangePct: number | null;
    diffPp: number | null;
    relativeGapPct: number | null;
    sampleSufficient: boolean;
    text: string;
  };
  proposedComparison: { proposedPerM2: number | null; compsMedianPerM2: number | null; diffPct: number | null; text: string };
  validSample: boolean;
  dataModes: DataMode[];
}

export interface IndexComparisonResult {
  key: string;
  label: string;
  source: string;
  dataMode: DataMode;
  targetChangePct: number | null;
  comparatorChangePct: number | null;
  diffPp: number | null;
  relativeGapPct: number | null;
  text: string;
}

export interface SupplyResult {
  key: string;
  name: string;
  stage: string;
  households: number | null;
  dataMode: DataMode;
  timing: "yes" | "no" | "unknown";
  area: "yes" | "no" | "unknown";
  price: "yes" | "no" | "unknown";
  demand: "yes" | "no" | "unknown";
  overlapCount: number;
  notes: string[];
}

export interface LtvRow {
  label: string;
  valueKrw: number;
  ownLtvPct: number | null;
  combinedLtvPct: number | null;
}

export interface LtvResult {
  status: "computed" | "notComputable";
  reasons: string[];
  definition: string | null;
  seniorText: string | null;
  numeratorOwnKrw: number | null;
  numeratorCombinedKrw: number | null;
  valueLabel: string | null;
  valueBasisDate: string | null;
  debtBasisDate: string | null;
  rows: LtvRow[];
  note: string;
}

export interface AnalysisResult {
  engineVersion: string;
  inputHash: string;
  asOf: string;
  assetSupported: boolean;
  unsupportedMessage?: string;
  missing: MissingItem[];
  property: { exclusiveAreaM2: number | null; exclusivePyeong: number | null; coordinatesText: string };
  prices: PriceResult[];
  events: EventResult[];
  comps: CompsResult | null;
  indexComparisons: IndexComparisonResult[];
  supply: { rows: SupplyResult[]; stageCounts: Record<string, number>; overlappingHouseholds: number; text: string };
  causalEffect: { status: "notEstimated"; text: string };
  stress: {
    priceDeclinePct: number | null;
    stressedValueKrw: number | null;
    disposal: { base: string; delayMonths: number | null; delayed: string | null; gapToMaturityMonths: number | null; text: string } | null;
  };
  ltv: LtvResult;
  flags: Flag[];
  summary: {
    location: { key: string; text: string; detail: string }[];
    price: { observed: string; comparison: string; causal: string; stress: string; evidence: string };
    uncertainties: Flag[];
  };
}

// ───────────────────────── helpers
function quantile(sorted: number[], q: number): number | null {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export function computeStats(rows: { perM2: number; complex: string }[]): Stats {
  const v = rows.map((r) => r.perM2).sort((a, b) => a - b);
  if (!v.length) return { count: 0, complexes: 0, medianPerM2: null, meanPerM2: null, p25PerM2: null, p75PerM2: null, minPerM2: null, maxPerM2: null };
  return {
    count: v.length,
    complexes: new Set(rows.map((r) => r.complex)).size,
    medianPerM2: quantile(v, 0.5),
    meanPerM2: v.reduce((a, b) => a + b, 0) / v.length,
    p25PerM2: quantile(v, 0.25),
    p75PerM2: quantile(v, 0.75),
    minPerM2: v[0],
    maxPerM2: v[v.length - 1],
  };
}

/** 두 지수(대상·비교)의 기간 변화. 상승률 차이(%p)와 상대 종가지수 격차(%)를 따로 계산. 인과효과가 아님. */
export function compareIndices(targetStart: number, targetEnd: number, compStart: number, compEnd: number) {
  const a = safeDivide(targetEnd, targetStart);
  const b = safeDivide(compEnd, compStart);
  const targetChangePct = a === null ? null : (a - 1) * 100;
  const comparatorChangePct = b === null ? null : (b - 1) * 100;
  const diffPp = targetChangePct === null || comparatorChangePct === null ? null : targetChangePct - comparatorChangePct;
  const rel = a === null || b === null ? null : safeDivide(a, b);
  const relativeGapPct = rel === null ? null : (rel - 1) * 100;
  return { targetChangePct, comparatorChangePct, diffPp, relativeGapPct };
}

/** LTV = 채권(분자) ÷ 담보가치(분모) × 100. 분모 0·미입력이면 null. */
export function ltvPct(numeratorKrw: number | null, valueKrw: number | null): number | null {
  const r = safeDivide(numeratorKrw, valueKrw);
  return r === null ? null : r * 100;
}

export function haversineM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371008.8;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const monthKey = (p: DateParts) => `${p.y}-${String(p.m).padStart(2, "0")}`;

function knownAsOf(m: Milestone, asOf: DateParts): boolean | "undated" {
  const k = parseDateValue(m.announcedOn ?? null) ?? parseDateValue(m.collectedOn ?? null);
  if (!k) return "undated";
  const before = isBefore(k, asOf);
  if (before === null) return compareMonth(k, asOf) <= 0; // 같은 달(월 정밀도) — 기준월 내 정보로 간주
  return before || (k.precision === "day" && asOf.precision === "day" && k.d === asOf.d && compareMonth(k, asOf) === 0);
}

function sortKey(p: DateParts | null): number {
  return p ? p.y * 400 + p.m * 32 + (p.d ?? 0) : -1;
}

// ───────────────────────── main
export function runAnalysis(w: WorkingInputs): AnalysisResult {
  const asOf = parseDateValue(w.asOf)!;
  const flags: Flag[] = [];
  const missing: MissingItem[] = [];
  const area = w.property.exclusiveAreaM2 ?? null;
  const assetSupported = w.property.assetType === "apartment";

  const base: Pick<AnalysisResult, "engineVersion" | "inputHash" | "asOf"> = { engineVersion: ENGINE_VERSION, inputHash: hashOf(w), asOf: w.asOf };
  const coordText = w.property.coordinates
    ? `${w.property.coordinates.lat.toFixed(6)}, ${w.property.coordinates.lng.toFixed(6)} (${w.property.coordinates.senderVerified ? "협의체에서 확인한 좌표 — 새 앱 미검증" : "확인 여부 미표시 좌표"})`
    : "좌표 미입력";

  if (!assetSupported) {
    const msg = `현재 아파트만 지원합니다. 받은 자산유형(${LABELS.assetType[w.property.assetType]})에는 아파트 분석을 적용하지 않았습니다. 받은 허용 입력 사본은 임시 보관되며 직접 삭제하거나 파일로 내보낼 수 있습니다.`;
    return {
      ...base, assetSupported, unsupportedMessage: msg, missing: [],
      property: { exclusiveAreaM2: area, exclusivePyeong: area ? m2ToPyeong(area) : null, coordinatesText: coordText },
      prices: [], events: [], comps: null, indexComparisons: [],
      supply: { rows: [], stageCounts: {}, overlappingHouseholds: 0, text: "미적용" },
      causalEffect: { status: "notEstimated", text: "미추정" },
      stress: { priceDeclinePct: null, stressedValueKrw: null, disposal: null },
      ltv: { status: "notComputable", reasons: ["지원하지 않는 자산유형"], definition: null, seniorText: null, numeratorOwnKrw: null, numeratorCombinedKrw: null, valueLabel: null, valueBasisDate: null, debtBasisDate: null, rows: [], note: "" },
      flags: [{ level: "high", area: "data", text: msg }],
      summary: { location: [], price: { observed: "미적용", comparison: "미적용", causal: "미추정", stress: "미적용", evidence: "미적용" }, uncertainties: [{ level: "high", area: "data", text: msg }] },
    };
  }

  // ── 누락 항목(해당 기능만 보완 안내)
  if (!w.property.displayName) missing.push({ field: "property.displayName", label: "표시명", affects: "화면 표시만(분석 영향 없음)" });
  if (!area) missing.push({ field: "property.exclusiveAreaM2", label: "전용면적", affects: "㎡·평당 단가, 비교거래 면적 필터" });
  if (!w.property.coordinates) missing.push({ field: "property.coordinates", label: "좌표", affects: "입지 사건까지 직선거리, 지도" });
  if (!w.prices.length) missing.push({ field: "selectedPrices.prices", label: "제시 가격", affects: "비교거래 대비 차이, 가격 참고계산" });
  if (!w.schedule.maturity) missing.push({ field: "schedule.maturity", label: "만기", affects: "입지 일정과 만기 비교" });
  if (!w.schedule.saleStart) missing.push({ field: "schedule.saleStart", label: "분양 시점", affects: "분양 시점 대비 일정·공급 시기 비교" });
  if (!w.events.length) missing.push({ field: "events", label: "입지 사건", affects: "입지 변화 확인 전체" });
  if (!w.transactions.length) missing.push({ field: "transactions", label: "비교거래", affects: "가격 비교·관찰 변화" });

  // ── 가격 정규화
  const prices: PriceResult[] = w.prices.map((p) => {
    const krw = toKrw(p.amount, p.unit);
    const r: PriceResult = {
      key: p.key, kind: p.kind, label: LABELS.priceKind[p.kind],
      input: `${p.amount.toLocaleString("ko-KR")}${LABELS.moneyUnit[p.unit]} (${LABELS.priceBasis[p.basis]})`,
      dataMode: p.dataMode, basisDate: p.basisDate ?? "기준일 미입력",
      unit: krw === null ? null : deriveUnitPrices(krw, p.basis, area, w.property.totalExclusiveAreaM2),
    };
    if (krw === null) r.error = "금액 환산 불가";
    if (!p.basisDate) flags.push({ level: "low", area: "price", text: `${r.label} 기준일 미입력` });
    return r;
  });
  const proposed = prices.find((p) => p.kind === "proposedSalePrice" && p.unit?.perM2Krw != null);
  const proposedPerM2 = proposed?.unit?.perM2Krw ?? null;

  // ── 입지 사건
  const evByKey = new Map(w.evidence.map((e) => [e.key, e]));
  const maturity = parseDateValue(w.schedule.maturity);
  const delay = w.scenario.eventDelayMonths ?? null;
  const events: EventResult[] = w.events.map((ev) => {
    const timeline = ev.milestones.map((m) => {
      const k = knownAsOf(m, asOf);
      return {
        key: m.key, type: MILESTONE_LABEL[m.type], status: m.status === "actual" ? "실제" : "예정",
        date: m.date ?? "미입력", announcedOn: m.announcedOn ?? "미입력", collectedOn: m.collectedOn ?? "미입력",
        knownAsOf: k !== false, note: m.note, _m: m, _undated: k === "undated",
      };
    });
    const known = timeline.filter((t) => t.knownAsOf).map((t) => t._m);
    const excludedAfterAsOf = timeline.filter((t) => !t.knownAsOf).length;
    const undatedKnowledge = timeline.filter((t) => t._undated).length;
    if (excludedAfterAsOf) flags.push({ level: "medium", area: "data", text: `${ev.name}: 분석 기준일 이후 알려진 일정 ${excludedAfterAsOf}건은 입력에서 제외(과거 시점 재현 한계)` });
    if (undatedKnowledge) flags.push({ level: "low", area: "data", text: `${ev.name}: 발표일·수집일이 없는 일정 ${undatedKnowledge}건 — 기준일 시점 인지 여부 확인 필요` });

    const byAnn = (a: Milestone, b: Milestone) => sortKey(parseDateValue(a.announcedOn ?? a.collectedOn ?? null)) - sortKey(parseDateValue(b.announcedOn ?? b.collectedOn ?? null));
    const announcements = known.filter((m) => m.type === "announcement").sort(byAnn);
    const announcement = parseDateValue(announcements[0]?.date ?? announcements[0]?.announcedOn ?? null);
    const openingMs = known.filter((m) => m.type === "opening" || m.type === "delay").sort(byAnn);
    const initialOpening = parseDateValue(openingMs.find((m) => m.type === "opening")?.date ?? null);
    const latest = [...openingMs].reverse().find((m) => parseDateValue(m.date ?? null));
    const actualOpening = known.find((m) => m.type === "opening" && m.status === "actual" && parseDateValue(m.date ?? null));
    const expectedOpening = parseDateValue((actualOpening ?? latest)?.date ?? null);
    const expectedOpeningStatus = expectedOpening ? (actualOpening ? "actual" : "planned") : null;
    const cancelled = known.some((m) => m.type === "cancellation");
    const delayCount = known.filter((m) => m.type === "delay").length;
    const actuals = known.filter((m) => m.status === "actual").sort((a, b) => sortKey(parseDateValue(a.date ?? null)) - sortKey(parseDateValue(b.date ?? null)));
    const stageAsOf = cancelled ? "취소" : actuals.length ? `${MILESTONE_LABEL[actuals[actuals.length - 1].type]} 완료` : known.length ? "계획·예정 단계" : "기준일 현재 확인된 일정 없음";

    const scheduleGaps: ScheduleGap[] = [];
    if (expectedOpening && ev.category !== "supply") {
      const pairs: [ScheduleGap["against"], string][] = [["saleStart", "분양"], ["completion", "준공"], ["maturity", "만기"], ["expectedDisposal", "예상 처분"]];
      for (const [k, label] of pairs) {
        const d = parseDateValue(w.schedule[k] ?? null);
        if (!d) continue;
        const months = monthDiff(d, expectedOpening);
        scheduleGaps.push({ against: k, label, months, text: months > 0 ? `${label}보다 ${months}개월 뒤` : months < 0 ? `${label}보다 ${-months}개월 앞` : `${label}과 같은 달` });
      }
    }
    let delayedScenario: EventResult["delayedScenario"] = null;
    if (expectedOpening && expectedOpeningStatus === "planned" && delay && ev.category !== "supply") {
      const op = addMonths(expectedOpening, delay);
      delayedScenario = { delayMonths: delay, opening: op, gapToMaturity: maturity ? monthDiff(maturity, op) : null };
    }
    let maturityNote: string | null = null;
    const gm = scheduleGaps.find((g) => g.against === "maturity");
    if (gm && gm.months > 0) {
      maturityNote = `개통·개장 예정이 만기보다 ${gm.months}개월 뒤임. 실제 이용 편익은 만기 이후 발생하나, 현재 가격에 기대가 반영됐는지는 별도 검토 대상(영향을 0으로 단정하지 않음).`;
      flags.push({ level: "high", area: "schedule", text: `${ev.name}: ${maturityNote}` });
    }
    if (delayedScenario?.gapToMaturity != null && delayedScenario.gapToMaturity > 0 && !(gm && gm.months > 0)) {
      flags.push({ level: "medium", area: "schedule", text: `${ev.name}: 지연 ${delayedScenario.delayMonths}개월 가정 시 만기보다 ${delayedScenario.gapToMaturity}개월 뒤` });
    }
    if (cancelled) flags.push({ level: "high", area: "location", text: `${ev.name}: 취소 이력 있음` });
    if (delayCount) flags.push({ level: "medium", area: "location", text: `${ev.name}: 일정 지연 ${delayCount}회 기록(최초 ${formatDateValue(initialOpening)} → 최신 ${formatDateValue(expectedOpening)})` });

    // 접근성 — 직선거리와 실제 보행경로를 구분. 경로 자료 없이 보행시간을 만들지 않는다.
    const straight = w.property.coordinates && ev.location ? haversineM(w.property.coordinates, ev.location) : null;
    const walk = ev.access?.routeWalkMinutes ?? null;
    const accessText = [
      straight === null ? "직선거리 미산출(좌표 부족)" : `직선거리 약 ${Math.round(straight).toLocaleString("ko-KR")}m`,
      walk === null ? "경로 자료 없음 — 보행시간 미산출" : `보행 ${walk}분(${ev.access?.routeSource ?? "출처 미기재"}${ev.access?.routeCheckedOn ? `, ${ev.access.routeCheckedOn} 확인` : ""})`,
    ].join(" · ");

    const evs = ev.evidenceKeys.map((k) => evByKey.get(k)).filter(Boolean) as WorkingInputs["evidence"];
    const byStatus = { confirmed: 0, needsApplicability: 0, inconsistent: 0, hardToVerify: 0 } as Record<EvidenceStatus, number>;
    evs.forEach((e) => byStatus[e.status]++);
    const confirmedOfficial = byStatus.confirmed > 0;
    if (!confirmedOfficial) flags.push({ level: ev.category === "supply" ? "medium" : "high", area: ev.category === "supply" ? "supply" : "location", text: `${ev.name}: 공식 자료로 ‘확인된 사실’ 근거 없음` });
    if (byStatus.inconsistent) flags.push({ level: "medium", area: "location", text: `${ev.name}: 자료 간 불일치 ${byStatus.inconsistent}건` });
    if (ev.dataMode === "demo") flags.push({ level: "low", area: "data", text: `${ev.name}: 가상 자료` });

    return {
      key: ev.key, name: ev.name, category: ev.category, categoryLabel: EVENT_CATEGORY_LABEL[ev.category], direction: ev.direction, dataMode: ev.dataMode,
      stageAsOf, cancelled, announcement, initialOpening, expectedOpening, expectedOpeningStatus, delayCount,
      timeline: timeline.map(({ _m, _undated, ...t }) => t), excludedAfterAsOf, undatedKnowledge,
      scheduleGaps, delayedScenario, maturityNote,
      access: { straightDistanceM: straight, walkMinutes: walk, text: accessText },
      evidence: { total: evs.length, byStatus, confirmedOfficial },
      prepricing: null,
    };
  });

  // ── 비교거래
  const comps = analyzeComps(w, asOf, area, proposedPerM2, events, flags);

  // ── 선반영 검토(사건별)
  const appraisal = w.prices.find((p) => p.kind === "appraisalValue");
  const appraisalDate = parseDateValue(appraisal?.basisDate ?? null);
  for (const er of events) {
    if (er.category === "supply") continue;
    if (!er.announcement) {
      er.prepricing = { announcement: "미확인", appraisalBasisDate: appraisal?.basisDate ?? "미입력", appraisalAfterAnnouncement: null, compsAfterAnnouncementShare: null, assessment: "notApplicable", quantification: "정량 분리 어려움", text: "발표일이 확인되지 않아 선반영 검토 불가" };
      continue;
    }
    const after = appraisalDate ? isBefore(er.announcement, appraisalDate) : null;
    let share: number | null = null;
    if (comps) {
      const inc = comps.rows.filter((r) => r.included && r.group === "target");
      const tx = new Map(w.transactions.map((t) => [t.key, t]));
      const afterCount = inc.filter((r) => {
        const d = parseDateValue(tx.get(r.key)!.contractDate);
        return d && compareMonth(d, er.announcement!) >= 0;
      }).length;
      share = inc.length ? afterCount / inc.length : null;
    }
    const possible = after === true || (share !== null && share > 0);
    const parts = [
      `발표 ${formatDateValue(er.announcement)}`,
      appraisalDate ? `평가 기준일 ${formatDateValue(appraisalDate)}${after === true ? "(발표 이후)" : after === false ? "(발표 이전)" : "(같은 달 — 선후 판단 불가)"}` : "평가 기준일 미입력",
      share === null ? "비교거래 시점 분포 미산출" : `포함 비교거래 중 발표 이후 계약 ${fmtPct(share * 100, 0)}`,
      w.appraisalNote ? "평가서 설명 입력됨(내용 대조 필요)" : "평가서의 해당 기대 반영 설명 미입력",
    ];
    er.prepricing = {
      announcement: formatDateValue(er.announcement), appraisalBasisDate: appraisal?.basisDate ?? "미입력",
      appraisalAfterAnnouncement: after, compsAfterAnnouncementShare: share,
      assessment: possible ? "possible" : "unclear", quantification: "정량 분리 어려움",
      text: `${parts.join(" · ")}. ${possible ? "현재 가격·평가액에 기대가 일부 반영됐을 가능성이 있음" : "반영 여부 판단 근거 부족"}. 반영 정도는 정량 분리 어려움(발표 후 거래라는 사실만으로 전부 반영됐다고 보지 않음).`,
    };
    if (possible) flags.push({ level: "medium", area: "price", text: `${er.name}: 가격 선반영 가능성 — 정량 분리 어려움` });
  }

  // ── 지수 비교(사용자 입력)
  const indexComparisons: IndexComparisonResult[] = w.indexComparisons.map((ic) => {
    const r = compareIndices(ic.targetStart, ic.targetEnd, ic.comparatorStart, ic.comparatorEnd);
    return {
      key: ic.key, label: ic.label, source: ic.source, dataMode: ic.dataMode, ...r,
      text: `관찰 비교: 대상 ${fmtPct(r.targetChangePct)} vs 비교 ${fmtPct(r.comparatorChangePct)} → 상승률 차이 ${fmtPp(r.diffPp)}, 상대 종가지수 격차 ${fmtPct(r.relativeGapPct, 4)}. 인과효과가 아닌 관찰된 차이임.`,
    };
  });

  // ── 경쟁 공급
  const supply = analyzeSupply(w, asOf, area, proposedPerM2, flags);

  // ── 스트레스(사용자 가정) & LTV 참고
  const decline = w.scenario.priceDeclinePct ?? null;
  const ltv = computeLtv(w, decline);
  if (ltv.status === "notComputable" && w.debt) flags.push({ level: "low", area: "ltv", text: `LTV 참고계산 미산출: ${ltv.reasons.join(", ")}` });
  const valueEntry = w.prices.find((p) => p.kind === w.ltvChecks.valueKind && p.basis === "project");
  const valueKrw = valueEntry ? toKrw(valueEntry.amount, valueEntry.unit) : null;
  const stressedValueKrw = decline !== null && valueKrw !== null ? valueKrw * (1 - decline / 100) : null;
  let disposal: AnalysisResult["stress"]["disposal"] = null;
  const disp = parseDateValue(w.schedule.expectedDisposal);
  if (disp) {
    const dm = w.scenario.disposalDelayMonths ?? null;
    const delayed = dm ? addMonths(disp, dm) : null;
    const gap = maturity ? monthDiff(maturity, delayed ?? disp) : null;
    disposal = {
      base: formatDateValue(disp), delayMonths: dm, delayed: delayed ? formatDateValue(delayed) : null, gapToMaturityMonths: gap,
      text: gap === null ? "만기 미입력 — 비교 불가" : gap > 0 ? `${dm ? "지연 가정 시 " : ""}예상 처분이 만기보다 ${gap}개월 뒤` : `${dm ? "지연 가정 시에도 " : ""}예상 처분이 만기 ${gap === 0 ? "같은 달" : `${-gap}개월 전`}`,
    };
    if (gap !== null && gap > 0) flags.push({ level: "medium", area: "schedule", text: `일정 가정: ${disposal.text}` });
  }

  if (prices.some((p) => p.dataMode === "demo") || w.transactions.some((t) => t.dataMode === "demo")) flags.push({ level: "high", area: "data", text: "가상 자료가 포함됨 — 실제 판단에 사용 불가" });

  // ── 요약 3블록
  const order: Record<Level, number> = { high: 0, medium: 1, low: 2 };
  flags.sort((a, b) => order[a.level] - order[b.level]);
  const summaryLocation = events
    .filter((e) => e.category !== "supply")
    .map((e) => ({
      key: e.key,
      text: `${e.name} (${e.categoryLabel}) — ${e.stageAsOf}${e.expectedOpening ? `, ${e.expectedOpeningStatus === "actual" ? "개통·개장" : "개통·개장 예정"} ${formatDateValue(e.expectedOpening)}` : ""}`,
      detail: [e.evidence.confirmedOfficial ? `근거: 확인된 사실 ${e.evidence.byStatus.confirmed}건` : "근거: 공식 확인 안 됨", e.scheduleGaps.find((g) => g.against === "maturity")?.text ? `만기 대비 ${e.scheduleGaps.find((g) => g.against === "maturity")!.text}` : null, e.access.text, e.dataMode === "demo" ? "가상 자료" : null].filter(Boolean).join(" · "),
    }));
  if (supply.rows.length) summaryLocation.push({ key: "supply", text: `경쟁 공급 ${supply.rows.length}건 — ${supply.text}`, detail: "" });

  const observedText = comps?.observed.sampleSufficient && comps.observed.targetChangePct !== null
    ? `관찰된 변화: 본건 권역 중위 ㎡당 단가 ${fmtPct(comps.observed.targetChangePct)}${comps.observed.comparatorChangePct !== null ? `, 비교 권역 ${fmtPct(comps.observed.comparatorChangePct)}` : ""} (사건 전후, 표본 ${comps.target.pre.count}/${comps.target.post.count}건 — 인과효과 아님)`
    : indexComparisons[0]
      ? `관찰된 변화(입력 지수): 대상 ${fmtPct(indexComparisons[0].targetChangePct)}, 비교 ${fmtPct(indexComparisons[0].comparatorChangePct)}`
      : "관찰된 변화: 미산출(전후 비교 표본 부족 또는 자료 없음)";
  const comparisonText = [
    comps?.observed.diffPp != null && comps.observed.sampleSufficient ? `비교대상과의 차이: 상승률 차이 ${fmtPp(comps.observed.diffPp)}` : indexComparisons[0]?.diffPp != null ? `비교대상과의 차이(입력 지수): ${fmtPp(indexComparisons[0].diffPp)}` : "비교대상과의 차이: 미산출",
    comps?.proposedComparison.diffPct != null ? `제시 분양가 ㎡당 단가는 포함 비교거래 중위값 대비 ${fmtPp(comps.proposedComparison.diffPct).replace("%p", "%")}` : "제시가격 비교: 미산출",
  ].join(" / ");
  const evidenceText = events.length
    ? `공식 확인 근거가 있는 사건 ${events.filter((e) => e.evidence.confirmedOfficial).length}/${events.length}건${comps ? `, 비교거래 포함 ${comps.target.all.count + comps.comparator.all.count}건(${comps.dataModes.map((m) => DATA_MODE_LABEL[m]).join("·") || "자료 없음"})` : ""}`
    : "입지 사건 미입력";

  return {
    ...base, assetSupported, missing,
    property: { exclusiveAreaM2: area, exclusivePyeong: area ? m2ToPyeong(area) : null, coordinatesText: coordText },
    prices, events, comps, indexComparisons, supply,
    causalEffect: { status: "notEstimated", text: "미추정 — 검증된 통계 모델을 적용하지 않았으므로 입지 변화의 인과적 가격효과를 추정하지 않음" },
    stress: { priceDeclinePct: decline, stressedValueKrw, disposal },
    ltv, flags,
    summary: {
      location: summaryLocation,
      price: {
        observed: observedText,
        comparison: comparisonText,
        causal: "인과 추정 효과: 미추정",
        stress: decline !== null ? `사용자 스트레스 가정: 가격 ${decline}% 하락${w.scenario.eventDelayMonths ? `, 사건 지연 ${w.scenario.eventDelayMonths}개월` : ""}${w.scenario.disposalDelayMonths ? `, 처분 지연 ${w.scenario.disposalDelayMonths}개월` : ""} (전망 아님)` : "사용자 스트레스 가정: 미입력",
        evidence: evidenceText,
      },
      uncertainties: flags.filter((f) => f.level !== "low").slice(0, 6),
    },
  };
}

function analyzeComps(w: WorkingInputs, asOf: DateParts, area: number | null, proposedPerM2: number | null, events: EventResult[], flags: Flag[]): CompsResult | null {
  if (!w.transactions.length) return null;
  const anchorEv = events.find((e) => e.key === w.options.anchorEventKey && e.announcement) ?? events.find((e) => e.category !== "supply" && e.announcement);
  const anchor = anchorEv ? { label: `${anchorEv.name} 발표`, date: anchorEv.announcement! } : { label: "분석 기준일(사건 발표일 미확인)", date: asOf };
  const before = w.options.comparisonMonthsBefore;
  const after = w.options.comparisonMonthsAfter;
  const start = addMonths({ ...anchor.date, precision: "month", d: undefined, raw: "" }, -before);
  let end = addMonths({ ...anchor.date, precision: "month", d: undefined, raw: "" }, after);
  let capped = false;
  if (compareMonth(end, asOf) > 0) {
    end = { raw: monthKey(asOf), precision: "month", y: asOf.y, m: asOf.m };
    capped = true;
  }
  const band = area ? { minM2: area * (1 - w.options.areaBandPct / 100), maxM2: area * (1 + w.options.areaBandPct / 100) } : null;
  if (!band) flags.push({ level: "medium", area: "price", text: "전용면적 미입력 — 비교거래 면적 필터 미적용" });

  const exclusionCounts: Record<string, number> = {};
  const rows: CompsResult["rows"] = w.transactions.map((t: Transaction) => {
    const reasons: string[] = [];
    const d = parseDateValue(t.contractDate);
    if (t.cancelled) reasons.push("해제(취소) 거래");
    if (!d) reasons.push("계약일 형식 오류");
    else {
      if (compareMonth(d, start) < 0 || compareMonth(d, end) > 0) reasons.push("비교기간 외");
      const ba = isBefore(asOf, d);
      if (ba === true) reasons.push("분석 기준일 이후 계약");
    }
    if (!(t.exclusiveAreaM2 > 0)) reasons.push("전용면적 미입력");
    else if (band && (t.exclusiveAreaM2 < band.minM2 || t.exclusiveAreaM2 > band.maxM2)) reasons.push("면적 범위 외");
    if (!(t.priceKrw > 0)) reasons.push("가격 미입력");
    if (t.manualExclusion) reasons.push(`사용자 제외: ${t.manualExclusion}`);
    reasons.forEach((r) => { const k = r.startsWith("사용자 제외") ? "사용자 제외" : r; exclusionCounts[k] = (exclusionCounts[k] ?? 0) + 1; });
    const perM2 = t.exclusiveAreaM2 > 0 && t.priceKrw > 0 ? t.priceKrw / t.exclusiveAreaM2 : null;
    let period: "pre" | "post" | "anchorMonth" | null = null;
    if (d) {
      const cm = compareMonth(d, anchor.date);
      if (cm < 0) period = "pre";
      else if (cm > 0) period = "post";
      else {
        const b = isBefore(d, anchor.date);
        period = b === true ? "pre" : b === false ? "post" : "anchorMonth";
      }
    }
    return { key: t.key, included: reasons.length === 0, reasons, perM2, period, group: t.group, dataMode: t.dataMode };
  });
  const txByKey = new Map(w.transactions.map((t) => [t.key, t]));
  const pick = (g: "target" | "comparator", p?: "pre" | "post") =>
    computeStats(rows.filter((r) => r.included && r.group === g && (!p || r.period === p)).map((r) => ({ perM2: r.perM2!, complex: txByKey.get(r.key)!.complexName })));
  const target = { all: pick("target"), pre: pick("target", "pre"), post: pick("target", "post") };
  const comparator = { all: pick("comparator"), pre: pick("comparator", "pre"), post: pick("comparator", "post") };

  // 월별 분포
  const monthly: CompsResult["monthly"] = [];
  for (let cur = start; compareMonth(cur, end) <= 0; cur = addMonths(cur, 1)) {
    const mk = monthKey(cur);
    const inMonth = rows.filter((r) => r.included && monthKey(parseDateValue(txByKey.get(r.key)!.contractDate)!) === mk);
    const tg = inMonth.filter((r) => r.group === "target");
    monthly.push({ month: mk, target: tg.length, comparator: inMonth.length - tg.length, targetMedianPerM2: computeStats(tg.map((r) => ({ perM2: r.perM2!, complex: "" }))).medianPerM2 });
    if (monthly.length > 600) break;
  }
  const emptyMonths = monthly.filter((m) => m.target + m.comparator === 0).length;
  const incMonths = monthly.filter((m) => m.target + m.comparator > 0).map((m) => m.month);
  const dataCoverage = { firstMonth: incMonths[0] ?? null, lastMonth: incMonths[incMonths.length - 1] ?? null, shortOfWindow: !incMonths.length || incMonths[0] !== monthly[0]?.month || incMonths[incMonths.length - 1] !== monthly[monthly.length - 1]?.month };
  if (dataCoverage.shortOfWindow) flags.push({ level: "medium", area: "data", text: `비교기간(${monthKey(start)}~${monthKey(end)}) 중 실제 자료 범위 ${dataCoverage.firstMonth ?? "없음"}~${dataCoverage.lastMonth ?? "없음"} — 기간 부족, 빈 기간을 채우지 않음` });
  if (capped) flags.push({ level: "low", area: "data", text: "사건 후 비교기간이 분석 기준일을 넘어 기준일까지로 제한됨" });

  const min = w.options.minSample;
  const sampleSufficient = target.pre.count >= min && target.post.count >= min;
  const tc = target.pre.medianPerM2 && target.post.medianPerM2 ? (target.post.medianPerM2 / target.pre.medianPerM2 - 1) * 100 : null;
  const cc = comparator.pre.medianPerM2 && comparator.post.medianPerM2 ? (comparator.post.medianPerM2 / comparator.pre.medianPerM2 - 1) * 100 : null;
  const cmpSufficient = comparator.pre.count >= min && comparator.post.count >= min;
  const idx = tc !== null && cc !== null && cmpSufficient ? compareIndices(100, 100 + tc, 100, 100 + cc) : null;
  if (!sampleSufficient) flags.push({ level: "high", area: "price", text: `사건 전후 본건 권역 표본 부족(전 ${target.pre.count}건·후 ${target.post.count}건, 기준 ${min}건) — 관찰 변화 미산출` });
  const validSample = target.all.count + comparator.all.count > 0;
  if (!validSample) flags.push({ level: "high", area: "price", text: "유효한 비교거래 없음 — 평균·중위값을 표시하지 않음" });

  const compsMedian = target.all.medianPerM2;
  const diffPct = proposedPerM2 !== null && compsMedian ? (proposedPerM2 / compsMedian - 1) * 100 : null;
  if (diffPct !== null && Math.abs(diffPct) >= 10) flags.push({ level: "medium", area: "price", text: `제시 분양가 ㎡당 단가가 비교거래 중위값과 ${diffPct > 0 ? "+" : ""}${diffPct.toFixed(1)}% 차이` });

  return {
    anchor, window: { start, end, endCappedByAsOf: capped, monthsBefore: before, monthsAfter: after }, areaBand: band, rows, exclusionCounts,
    target, comparator, monthly, emptyMonths, dataCoverage,
    observed: {
      targetChangePct: sampleSufficient ? tc : null,
      comparatorChangePct: cmpSufficient ? cc : null,
      diffPp: sampleSufficient && idx ? idx.diffPp : null,
      relativeGapPct: sampleSufficient && idx ? idx.relativeGapPct : null,
      sampleSufficient,
      text: sampleSufficient
        ? `관찰: 본건 권역 중위 ㎡당 단가 ${fmtPct(tc)}${idx ? `, 비교 권역 ${fmtPct(cc)}, 차이 ${fmtPp(idx.diffPp)}` : ", 비교 권역 표본 부족"}. 인과효과 아님.`
        : "표본 부족으로 관찰 변화 미산출",
    },
    proposedComparison: {
      proposedPerM2, compsMedianPerM2: compsMedian, diffPct,
      text: proposedPerM2 === null ? "제시 분양가의 ㎡당 단가 산출 불가(전용면적 또는 가격 기준 확인 필요)" : compsMedian === null ? "유효 비교거래 없음" : `제시 ${fmtMan(proposedPerM2)}/㎡ vs 포함 비교거래 중위 ${fmtMan(compsMedian)}/㎡ (${diffPct! > 0 ? "+" : ""}${diffPct!.toFixed(1)}%)`,
    },
    validSample,
    dataModes: [...new Set(rows.filter((r) => r.included).map((r) => r.dataMode))],
  };
}

function analyzeSupply(w: WorkingInputs, asOf: DateParts, area: number | null, proposedPerM2: number | null, flags: Flag[]): AnalysisResult["supply"] {
  const supplies = w.events.filter((e) => e.category === "supply" && e.supply);
  const horizon = parseDateValue(w.schedule.expectedDisposal) ?? parseDateValue(w.schedule.maturity);
  const saleStart = parseDateValue(w.schedule.saleStart);
  const band = area ? [area * (1 - w.options.areaBandPct / 100), area * (1 + w.options.areaBandPct / 100)] : null;
  const myDemand = new Set((w.property.targetDemand ?? []).map((s) => s.trim()).filter(Boolean));
  const stageCounts: Record<string, number> = {};
  let overlappingHouseholds = 0;
  const rows: SupplyResult[] = supplies.map((e) => {
    const s = e.supply!;
    stageCounts[SUPPLY_STAGE_LABEL[s.stage]] = (stageCounts[SUPPLY_STAGE_LABEL[s.stage]] ?? 0) + 1;
    const notes: string[] = [];
    const sd = parseDateValue(s.saleDate ?? null);
    const od = parseDateValue(s.occupancyDate ?? null);
    let timing: SupplyResult["timing"] = "unknown";
    const from = saleStart ? addMonths(saleStart, -12) : asOf;
    if (!horizon) notes.push("만기·처분 일정 미입력 — 시기 비교 불가");
    else if (!sd && !od) notes.push("공급 시기 미입력");
    else timing = [sd, od].some((d) => d && compareMonth(d, from) >= 0 && compareMonth(d, horizon) <= 0) ? "yes" : "no";
    let areaO: SupplyResult["area"] = "unknown";
    if (band && s.areaMinM2 && s.areaMaxM2) areaO = s.areaMaxM2 >= band[0] && s.areaMinM2 <= band[1] ? "yes" : "no";
    else notes.push("면적대 비교 불가");
    let priceO: SupplyResult["price"] = "unknown";
    if (proposedPerM2 && s.priceMinPerM2Krw && s.priceMaxPerM2Krw) priceO = s.priceMaxPerM2Krw >= proposedPerM2 * 0.9 && s.priceMinPerM2Krw <= proposedPerM2 * 1.1 ? "yes" : "no";
    else notes.push("가격대 비교 불가");
    let demand: SupplyResult["demand"] = "unknown";
    if (myDemand.size && s.demandGroups?.length) demand = s.demandGroups.some((g) => myDemand.has(g.trim())) ? "yes" : "no";
    else notes.push("수요층 비교 불가");
    const overlapCount = [timing, areaO, priceO, demand].filter((x) => x === "yes").length;
    if (timing === "yes" && s.households) overlappingHouseholds += s.households;
    if (overlapCount >= 3) flags.push({ level: "high", area: "supply", text: `${e.name}: 시기·면적·가격·수요층 중 ${overlapCount}개 겹치는 경쟁 공급(${SUPPLY_STAGE_LABEL[s.stage]})` });
    else if (timing === "yes") flags.push({ level: "medium", area: "supply", text: `${e.name}: 본건 분양~회수 기간과 시기가 겹치는 공급(${SUPPLY_STAGE_LABEL[s.stage]}${s.households ? `, ${s.households.toLocaleString("ko-KR")}세대` : ""})` });
    return { key: e.key, name: e.name, stage: SUPPLY_STAGE_LABEL[s.stage], households: s.households ?? null, dataMode: e.dataMode, timing, area: areaO, price: priceO, demand, overlapCount, notes };
  });
  const text = rows.length
    ? `${Object.entries(stageCounts).map(([k, v]) => `${k} ${v}`).join(", ")}; 시기 겹침 ${rows.filter((r) => r.timing === "yes").length}건(${overlappingHouseholds.toLocaleString("ko-KR")}세대). 공개 자료로 분양률·매각 소요기간을 환산하지 않음.`
    : "경쟁 공급 미입력";
  return { rows, stageCounts, overlappingHouseholds, text };
}

/** LTV 참고계산(제한적). 담보 범위·기준일 확인, 분자 정의, 선순위 상태가 모두 충족될 때만 계산. 판정하지 않음. */
export function computeLtv(w: WorkingInputs, declinePct: number | null): LtvResult {
  const reasons: string[] = [];
  const d = w.debt;
  const value = w.prices.find((p) => p.kind === w.ltvChecks.valueKind && p.basis === "project");
  if (!d) reasons.push("채권정보 미전달·미입력(선택 항목)");
  if (!value) reasons.push(`사업 전체 기준 ${LABELS.priceKind[w.ltvChecks.valueKind]} 없음(세대당 가격과 사업 전체 채권은 직접 나누지 않음)`);
  if (d && value && !w.ltvChecks.collateralScopeConfirmed) reasons.push("가격과 채권의 담보 범위 일치 확인 필요");
  const sameDate = d?.basisDate && value?.basisDate && d.basisDate === value.basisDate;
  if (d && value && !sameDate && !w.ltvChecks.basisDateConfirmed) reasons.push("가격·채권 기준일 일치 확인 필요");
  const valueKrw = value ? toKrw(value.amount, value.unit) : null;
  const own = d ? toKrw(d.amount, d.unit) : null;
  let combined: number | null = null;
  let seniorText: string | null = null;
  if (d) {
    if (d.seniorStatus === "confirmedNone") { combined = own; seniorText = "선순위 없음(확인)"; }
    else if (d.seniorStatus === "confirmedAmount" && d.seniorAmount !== undefined) {
      const s = toKrw(d.seniorAmount, d.unit);
      combined = own !== null && s !== null ? own + s : null;
      seniorText = `선순위 ${fmtEok(s)} 포함`;
    } else seniorText = "선순위 미확인 — 통합 담보부담비율 미산출(0원으로 처리하지 않음)";
  }
  const note = "가정 비교용 산술 참고값. 회수 가능·불가, 승인·보류·거절, 본PF 전환·상환가능성을 판정하지 않음.";
  if (reasons.length || valueKrw === null) {
    return { status: "notComputable", reasons: reasons.length ? reasons : ["가치 환산 불가"], definition: d ? LABELS.debtDefinition[d.definition] : null, seniorText, numeratorOwnKrw: own, numeratorCombinedKrw: combined, valueLabel: value ? LABELS.priceKind[value.kind] : null, valueBasisDate: value?.basisDate ?? null, debtBasisDate: d?.basisDate ?? null, rows: [], note };
  }
  const mk = (label: string, v: number): LtvRow => ({ label, valueKrw: v, ownLtvPct: ltvPct(own, v), combinedLtvPct: d!.seniorStatus === "unknown" ? null : ltvPct(combined, v) });
  const rows = [mk("기준 가치", valueKrw), mk("가치 +10% (산술 비교)", Math.round(valueKrw * 1.1)), mk("가치 −10% (산술 비교)", Math.round(valueKrw * 0.9))];
  if (declinePct !== null && declinePct !== 10) rows.push(mk(`사용자 가정: 가치 −${declinePct}%`, Math.round(valueKrw * (1 - declinePct / 100))));
  return { status: "computed", reasons: [], definition: LABELS.debtDefinition[d!.definition], seniorText, numeratorOwnKrw: own, numeratorCombinedKrw: combined, valueLabel: `${LABELS.priceKind[value!.kind]}(사업 전체)`, valueBasisDate: value!.basisDate ?? null, debtBasisDate: d!.basisDate ?? null, rows, note };
}
