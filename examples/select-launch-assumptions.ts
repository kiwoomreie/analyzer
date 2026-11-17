// [대기·미확정 초안] 협의체 연동은 입력 규격·수신 주소 확정 전까지 대기 상태입니다. docs/committee-button-integration.md 참고.
// 인계물 ③ — 허용값 선택·단위 정규화 예제(순수 함수).
//
// 주어진 협의체 현재 가정(currentAssumptions)에서 입력 계약 v1.0의 허용 필드만 골라 새 객체를 만든다.
// - 전체 상태 객체를 직렬화하지 않는다. 원본 서버(Render)를 조회하지 않는다. 부수효과·네트워크 호출이 없다.
// - launchId·createdAt 같은 비결정 값은 호출하는 쪽(버튼 클릭 처리)에서 만들어 넘긴다.
// - 채권정보는 사용자가 현재 사업장에서 ‘채권정보 포함’을 명시적으로 선택했을 때만(includeDebt=true) 넣는다.
//
// ⚠ 아래 CommitteeAssumptionsExample 의 필드명은 설명용 가상 구조이다. 실제 Archive 협의체의 상태 필드명·구조는
//   다를 수 있으며, 후속 작업에서 실제 필드에 맞춰 이 매핑 부분만 바꾸면 된다(출력 계약은 바꾸지 않음).

import type {
  AssetType, ContractDebt, ContractPrice, DebtDefinition, ImportDocument, LaunchDocument, MoneyUnit, PriceBasis, SeniorStatus,
} from "../shared/contract.ts";

/** 설명용 가상 협의체 상태. 실제 Archive 필드와 다를 수 있음. */
export interface CommitteeAssumptionsExample {
  site: {
    name?: string;
    address?: string;
    lat?: number;
    lng?: number;
    /** 협의체에서 좌표를 확인했는지 */
    coordinateConfirmed?: boolean;
    /** 예: "아파트", "오피스", "호텔" */
    assetType?: string;
    unitExclusiveAreaM2?: number;
    totalExclusiveAreaM2?: number;
    typeName?: string;
    households?: number;
    sigunguCode?: string;
  };
  pricing: {
    salePrice?: CommitteeMoney;
    appraisal?: CommitteeMoney;
    disposal?: CommitteeMoney;
  };
  debt?: {
    amount?: number;
    unit?: string;
    /** "대출잔액" | "채권최고액" */
    definition?: string;
    /** "없음" | "있음" | "미확인" */
    senior?: string;
    seniorAmount?: number;
    basisDate?: string;
  };
  schedule: { saleStart?: string; completion?: string; maturity?: string; disposal?: string };
  scenario: { name?: string; priceDeclinePct?: number; eventDelayMonths?: number; disposalDelayMonths?: number };
  analysis: { asOf: string; monthsBefore?: number; monthsAfter?: number; purpose?: string };
  // ── 아래는 협의체 상태에 있을 수 있으나 절대 전달하지 않는 예(선택 함수가 읽지 않음)
  cashflow?: unknown;
  waterfall?: unknown;
  votes?: unknown;
  reviewers?: unknown;
  otherSites?: unknown;
  session?: unknown;
}

export interface CommitteeMoney {
  value?: number;
  /** "원" | "만원" | "억원" */
  unit?: string;
  /** "세대당" | "사업 전체" | "전용㎡당" | "전용평당" */
  basis?: string;
  basisDate?: string;
}

export interface SelectOptions {
  launchId: string;
  createdAt: string;
  sourceLabel?: string;
  /** 사용자가 현재 사업장에 대해 ‘채권정보 포함’을 체크했을 때만 true. 기본 false. */
  includeDebt?: boolean;
}

export interface SelectResult<D> {
  document: D;
  /** 값이 있었지만 형식·단위를 확정하지 못해 보내지 않은 항목(새 앱에서 보완) */
  skipped: string[];
}

// ── 단위·기준 정규화(라벨 → 계약 코드). 알 수 없으면 undefined를 반환해 보내지 않는다(추측 금지).
const MONEY_UNIT: Record<string, MoneyUnit> = { 원: "KRW", 만원: "KRW_10K", 억원: "KRW_100M", KRW: "KRW", KRW_10K: "KRW_10K", KRW_100M: "KRW_100M" };
const PRICE_BASIS: Record<string, PriceBasis> = { 세대당: "household", 호당: "household", "사업 전체": "project", 사업전체: "project", "전용㎡당": "perExclusiveM2", "전용m2당": "perExclusiveM2", 전용평당: "perExclusivePyeong" };
const ASSET: Record<string, AssetType> = { 아파트: "apartment", 오피스텔: "officetel", 오피스: "office", 호텔: "hotel", 상업시설: "retail", 물류: "logistics", 복합: "mixedUse", apartment: "apartment" };
const DEBT_DEF: Record<string, DebtDefinition> = { 대출잔액: "loanBalance", 채권최고액: "maxSecuredAmount" };
const SENIOR: Record<string, SeniorStatus> = { 없음: "confirmedNone", 있음: "confirmedAmount", 미확인: "unknown" };

export const normalizeMoneyUnit = (label?: string): MoneyUnit | undefined => (label ? MONEY_UNIT[label.trim()] : undefined);
export const normalizePriceBasis = (label?: string): PriceBasis | undefined => (label ? PRICE_BASIS[label.trim()] : undefined);
export const normalizeAssetType = (label?: string): AssetType => (label ? ASSET[label.trim()] ?? "other" : "other");

const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])(-(0[1-9]|[12]\d|3[01]))?$/;
/** "2030.11" / "2030-11" / "2030-11-30" → 받은 정밀도 그대로 정규화. 월만 있으면 일자를 붙이지 않는다. */
export function normalizeDate(s?: string): string | undefined {
  if (!s) return undefined;
  const t = s.trim().replace(/[./]/g, "-");
  const m = /^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?$/.exec(t);
  if (!m) return undefined;
  const out = `${m[1]}-${m[2].padStart(2, "0")}${m[3] ? `-${m[3].padStart(2, "0")}` : ""}`;
  return DATE_RE.test(out) ? out : undefined;
}

const finitePos = (n?: number) => (typeof n === "number" && Number.isFinite(n) && n > 0 ? n : undefined);
const clip = (s: string | undefined, n: number) => (s && s.trim() ? s.trim().slice(0, n) : undefined);
const drop = <T extends object>(o: T): T => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;

function selectBody(cur: CommitteeAssumptionsExample, includeDebt: boolean, skipped: string[]) {
  const s = cur.site ?? {};
  const property = drop({
    displayName: clip(s.name, 120),
    address: clip(s.address, 200),
    coordinates: finitePos(s.lat) && finitePos(s.lng) ? { lat: s.lat!, lng: s.lng!, senderVerified: s.coordinateConfirmed === true } : undefined,
    assetType: normalizeAssetType(s.assetType),
    exclusiveAreaM2: finitePos(s.unitExclusiveAreaM2),
    totalExclusiveAreaM2: finitePos(s.totalExclusiveAreaM2),
    comparisonType: clip(s.typeName, 40),
    householdCount: Number.isInteger(s.households) && s.households! > 0 ? s.households : undefined,
    lawdCode: s.sigunguCode && /^\d{5}$/.test(s.sigunguCode) ? s.sigunguCode : undefined,
  });

  const prices: ContractPrice[] = [];
  const pushPrice = (kind: ContractPrice["kind"], m: CommitteeMoney | undefined, label: string) => {
    if (!m || m.value === undefined) return;
    const unit = normalizeMoneyUnit(m.unit);
    const basis = normalizePriceBasis(m.basis);
    const amount = finitePos(m.value);
    if (!unit || !basis || !amount) { skipped.push(`${label}: 금액 단위·가격 기준·금액을 확정할 수 없어 보내지 않음`); return; }
    prices.push(drop({ kind, amount, unit, basis, basisDate: normalizeDate(m.basisDate) }));
  };
  pushPrice("proposedSalePrice", cur.pricing?.salePrice, "제시 분양가");
  pushPrice("appraisalValue", cur.pricing?.appraisal, "평가액");
  pushPrice("disposalPrice", cur.pricing?.disposal, "처분가");

  let debt: ContractDebt | undefined;
  if (includeDebt && cur.debt) {
    const d = cur.debt;
    const unit = normalizeMoneyUnit(d.unit);
    const definition = d.definition ? DEBT_DEF[d.definition.trim()] : undefined;
    const seniorStatus = d.senior ? SENIOR[d.senior.trim()] : "unknown"; // 미입력은 ‘미확인’(0원·없음으로 보지 않음)
    const amount = finitePos(d.amount);
    if (!unit || !definition || !amount || !seniorStatus || (seniorStatus === "confirmedAmount" && d.seniorAmount === undefined)) {
      skipped.push("채권정보: 금액·단위·정의(대출잔액/채권최고액)·선순위를 확정할 수 없어 보내지 않음");
    } else {
      debt = drop({ includedByUserChoice: true as const, amount, unit, definition, seniorStatus, seniorAmount: seniorStatus === "confirmedAmount" ? d.seniorAmount : undefined, basisDate: normalizeDate(d.basisDate) });
    }
  }

  const schedule = drop({
    saleStart: normalizeDate(cur.schedule?.saleStart),
    completion: normalizeDate(cur.schedule?.completion),
    maturity: normalizeDate(cur.schedule?.maturity),
    expectedDisposal: normalizeDate(cur.schedule?.disposal),
  });
  const sc = cur.scenario ?? {};
  const scenario = drop({
    name: clip(sc.name, 80),
    priceDeclinePct: typeof sc.priceDeclinePct === "number" && sc.priceDeclinePct >= 0 && sc.priceDeclinePct <= 100 ? sc.priceDeclinePct : undefined,
    eventDelayMonths: Number.isInteger(sc.eventDelayMonths) && sc.eventDelayMonths! >= 0 && sc.eventDelayMonths! <= 240 ? sc.eventDelayMonths : undefined,
    disposalDelayMonths: Number.isInteger(sc.disposalDelayMonths) && sc.disposalDelayMonths! >= 0 && sc.disposalDelayMonths! <= 240 ? sc.disposalDelayMonths : undefined,
  });
  const a = cur.analysis;
  const analysisOptions = drop({
    comparisonMonthsBefore: Number.isInteger(a.monthsBefore) ? a.monthsBefore : undefined,
    comparisonMonthsAfter: Number.isInteger(a.monthsAfter) ? a.monthsAfter : undefined,
    purpose: clip(a.purpose, 300),
  });
  const selectedPrices = drop({ prices: prices.length ? prices : undefined, debt });
  return drop({
    asOf: a.asOf,
    property,
    selectedPrices: Object.keys(selectedPrices).length ? selectedPrices : undefined,
    schedule: Object.keys(schedule).length ? schedule : undefined,
    scenario: Object.keys(scenario).length ? scenario : undefined,
    analysisOptions: Object.keys(analysisOptions).length ? analysisOptions : undefined,
  });
}

/** 버튼 시동용 문서(location-analysis-launch). */
export function selectLaunchAssumptions(current: CommitteeAssumptionsExample, opts: SelectOptions): SelectResult<LaunchDocument> {
  const skipped: string[] = [];
  const body = selectBody(current, opts.includeDebt === true, skipped);
  return {
    document: { documentType: "location-analysis-launch", schemaVersion: "1.0", launchId: opts.launchId, createdAt: opts.createdAt, ...(opts.sourceLabel ? { sourceLabel: opts.sourceLabel.slice(0, 120) } : {}), ...body } as LaunchDocument,
    skipped,
  };
}

/** 파일 내보내기 대안용 문서(location-analysis-import). 같은 허용 필드를 사용한다. */
export function selectImportAssumptions(current: CommitteeAssumptionsExample, opts: { exportId: string; exportedAt: string; sourceLabel?: string; includeDebt?: boolean }): SelectResult<ImportDocument> {
  const skipped: string[] = [];
  const body = selectBody(current, opts.includeDebt === true, skipped);
  return {
    document: { documentType: "location-analysis-import", schemaVersion: "1.0", exportId: opts.exportId, exportedAt: opts.exportedAt, ...(opts.sourceLabel ? { sourceLabel: opts.sourceLabel.slice(0, 120) } : {}), ...body } as ImportDocument,
    skipped,
  };
}
