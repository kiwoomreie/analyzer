// 아파트 입지·가격 분석기 내부 모델(아파트 전용).
// 입력은 주소 1개로 시작하며 전용면적·검토가격·준공연도·분양/준공 예정일은 선택 입력이다.
// PF 현금흐름·대출구조·LTV·엑싯·회수 판단 항목은 두지 않는다(협의체와 역할 분리).
import type { ContractDocument, DateOrMonth, MoneyUnit, PriceBasis } from "./contract.ts";
import { LAUNCH_DOCUMENT_TYPE } from "./contract.ts";
import { hashOf } from "./hash.ts";
import { seoulNowIso, seoulToday } from "./dates.ts";

export const ANALYSIS_FORMAT = "location-analyzer-analysis" as const;
export const ANALYSIS_FORMAT_VERSION = 1 as const;
export const ENGINE_VERSION = "0.2.0";
export const APP_NAME = "아파트 입지·가격 분석기";

/** demo=가상, user=사용자 제공, official-api=공식 API 실제 자료, committee-copy=협의체가 보낸 가정 사본(수신 대기 중) */
export type DataMode = "demo" | "user" | "official-api" | "committee-copy";

export const DATA_MODE_LABEL: Record<DataMode, string> = {
  demo: "가상 자료",
  user: "사용자 제공",
  "official-api": "공식 API",
  "committee-copy": "협의체 사본",
};

/** 검토가격: 금액 단위와 가격 기준을 분리. 내부 계산은 원·전용㎡. */
export interface ReviewPrice {
  amount: number;
  unit: MoneyUnit;
  /** household=세대당(비교 타입 1세대), perExclusiveM2, perExclusivePyeong. 사업 전체 가격은 비교에 쓰지 않음 */
  basis: Exclude<PriceBasis, "project">;
  basisDate?: DateOrMonth;
  /** 예: 제시 분양가, 감정가, 매각 희망가 등 사용자가 붙인 이름 */
  label?: string;
  dataMode: DataMode;
}

export type EventCategory = "transport" | "amenity" | "development" | "supply";
export const EVENT_CATEGORY_LABEL: Record<EventCategory, string> = {
  transport: "교통",
  amenity: "생활편의",
  development: "개발사업",
  supply: "주변 입주 물량",
};

export type MilestoneType =
  | "announcement" | "notice" | "approval" | "permit" | "constructionStart" | "opening" | "delay" | "cancellation" | "sale" | "occupancy" | "other";
export const MILESTONE_LABEL: Record<MilestoneType, string> = {
  announcement: "발표",
  notice: "고시",
  approval: "승인",
  permit: "인허가",
  constructionStart: "착공",
  opening: "개통·개장·준공",
  delay: "지연(변경 일정)",
  cancellation: "취소",
  sale: "분양",
  occupancy: "입주",
  other: "기타",
};

export interface Milestone {
  key: string;
  type: MilestoneType;
  status: "planned" | "actual";
  /** 적용·실행(예정)일. 지연 항목은 변경된 예정일 */
  date?: DateOrMonth;
  /** 발표일(그 정보가 알려진 날) */
  announcedOn?: DateOrMonth;
  /** 수집일(이 앱에 기록한 날) */
  collectedOn?: string;
  note?: string;
  evidenceKeys: string[];
}

export type SupplyStage = "plan" | "permit" | "construction" | "sale" | "occupancy";
export const SUPPLY_STAGE_LABEL: Record<SupplyStage, string> = {
  plan: "계획",
  permit: "인허가",
  construction: "착공",
  sale: "분양",
  occupancy: "입주",
};

export interface SupplyDetail {
  stage: SupplyStage;
  households?: number;
  areaMinM2?: number;
  areaMaxM2?: number;
  saleDate?: DateOrMonth;
  occupancyDate?: DateOrMonth;
}

export interface LocationEvent {
  key: string;
  category: EventCategory;
  name: string;
  direction: "favorable" | "adverse" | "mixed" | "unknown";
  location?: { lat: number; lng: number };
  milestones: Milestone[];
  access?: { routeWalkMinutes?: number; routeSource?: string; routeCheckedOn?: string };
  supply?: SupplyDetail;
  evidenceKeys: string[];
  dataMode: DataMode;
  note?: string;
}

export type EvidenceStatus = "confirmed" | "needsApplicability" | "inconsistent" | "hardToVerify";
export const EVIDENCE_STATUS_LABEL: Record<EvidenceStatus, string> = {
  confirmed: "확인된 사실",
  needsApplicability: "본건 적용 추가 검토",
  inconsistent: "자료 간 불일치",
  hardToVerify: "확인 어려움",
};

export interface Evidence {
  key: string;
  publisher: string;
  title: string;
  sourceRef?: string;
  /** 참고 주소 — 텍스트로만 보관하며 앱이 조회·실행하지 않음 */
  sourceUrl?: string;
  attachmentKey?: string;
  publishedOn?: string;
  effectiveOn?: string;
  checkedOn?: string;
  pageOrSection?: string;
  fact: string;
  status: EvidenceStatus;
  linked: string[];
  dataMode: DataMode;
}

export interface Transaction {
  key: string;
  complexName: string;
  /** 법정동(단지 구분 보조) */
  dong?: string;
  exclusiveAreaM2: number;
  floor?: number;
  priceKrw: number;
  /** 계약일 YYYY-MM-DD 또는 YYYY-MM */
  contractDate: string;
  cancelled: boolean;
  cancelDate?: string;
  buildYear?: number;
  dataMode: DataMode;
  /** 자료 출처 설명(예: 국토교통부 실거래가 API 2026-11-17 조회, 사용자 CSV 파일명) */
  source?: string;
  manualExclusion?: string;
}

/** 단지별 보완 정보(거리·준공연도·좌표 등). 거래 자료에 없는 정보를 사용자가 확인해 입력 */
export interface ComplexInfo {
  /** complexKey = 단지명|법정동 */
  complexKey: string;
  distanceM?: number;
  distanceSource?: string;
  buildYear?: number;
  households?: number;
  location?: { lat: number; lng: number };
  /** 사용자가 비교단지에서 제외/포함 지정 */
  userDecision?: "exclude" | "include";
  userReason?: string;
}

export interface AttachmentMeta {
  key: string;
  filename: string;
  mime: string;
  size: number;
  sha256: string;
  text?: string;
  addedAt: string;
}

export interface WorkingInputs {
  asOf: string;
  property: {
    address: string;
    displayName?: string;
    coordinates?: { lat: number; lng: number; source: string };
    lawdCode?: string;
    exclusiveAreaM2?: number;
    /** 본건 준공(예정) 연도 — 비교단지 준공연도 차이 비교용 */
    buildYear?: number;
    householdCount?: number;
    comparisonType?: string;
  };
  reviewPrice: ReviewPrice | null;
  /** 입력한 경우에만 입지 변화 예정 시점과 비교 */
  schedule: { saleStart?: DateOrMonth; completion?: DateOrMonth };
  options: {
    comparisonMonthsBefore: number;
    comparisonMonthsAfter: number;
    /** 비교거래 최근 기간(가격 비교용) */
    recentMonths: number;
    areaBandPct: number;
    radiusM: number;
    buildYearBand: number;
    minComplexTrades: number;
    minSample: number;
    anchorEventKey?: string;
    purpose?: string;
  };
  appraisalNote?: string;
  events: LocationEvent[];
  evidence: Evidence[];
  transactions: Transaction[];
  complexInfo: ComplexInfo[];
  attachments: AttachmentMeta[];
  /** 자동 조회 기록(어떤 자료를 언제 어디서) */
  dataLog: { at: string; source: string; detail: string }[];
}

export type OriginKind = "manual" | "demo" | "backup-restore" | "launch" | "committee-import";
export const ORIGIN_LABEL: Record<OriginKind, string> = {
  manual: "직접 입력",
  demo: "가상 데모",
  "backup-restore": "백업 복구",
  launch: "협의체 ‘분석기 시동’(대기 기능)",
  "committee-import": "협의체 반출 파일(대기 기능)",
};

export interface RunRecord {
  runNo: number;
  at: string;
  trigger: "auto-launch" | "manual" | "auto-create";
  inputHash: string;
  result: import("./analysis.ts").AnalysisResult;
}

export interface VersionRecord {
  versionNo: number;
  at: string;
  note: string;
  working: WorkingInputs;
}

export interface AnalysisRecord {
  format: typeof ANALYSIS_FORMAT;
  formatVersion: typeof ANALYSIS_FORMAT_VERSION;
  key: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  origin: {
    kind: OriginKind;
    launchId?: string;
    exportId?: string;
    sourceLabel?: string;
    senderCreatedAt?: string;
    receivedAt?: string;
    payloadHash?: string;
  };
  original: { document?: ContractDocument; working: WorkingInputs };
  working: WorkingInputs;
  runs: RunRecord[];
  versions: VersionRecord[];
}

let counter = 0;
export function newKey(prefix: string): string {
  counter = (counter + 1) % 1e6;
  const rnd = Math.floor(Math.random() * 36 ** 6).toString(36).padStart(6, "0");
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${rnd}`;
}

export function defaultOptions(): WorkingInputs["options"] {
  return { comparisonMonthsBefore: 24, comparisonMonthsAfter: 24, recentMonths: 12, areaBandPct: 15, radiusM: 1500, buildYearBand: 10, minComplexTrades: 3, minSample: 10 };
}

export function emptyWorking(address: string, asOf = seoulToday()): WorkingInputs {
  return {
    asOf,
    property: { address },
    reviewPrice: null,
    schedule: {},
    options: defaultOptions(),
    events: [],
    evidence: [],
    transactions: [],
    complexInfo: [],
    attachments: [],
    dataLog: [],
  };
}

export const complexKeyOf = (t: { complexName: string; dong?: string }) => `${t.complexName.trim()}|${(t.dong ?? "").trim()}`;

export function titleFor(w: WorkingInputs): string {
  return w.property.displayName || w.property.address || "주소 미입력";
}

/**
 * (수신 대기 기능) 계약 문서 → 작업 입력. 아파트 범위 밖 항목(채권·만기·처분·사업 전체 가격·시나리오)은 사용하지 않는다.
 */
export function workingFromContract(doc: ContractDocument): WorkingInputs {
  const p = doc.property;
  const w = emptyWorking(p.address ?? p.displayName ?? "", doc.asOf);
  w.property = {
    address: p.address ?? "",
    displayName: p.displayName,
    coordinates: p.coordinates ? { lat: p.coordinates.lat, lng: p.coordinates.lng, source: p.coordinates.senderVerified ? "협의체에서 확인한 좌표(새 앱 미검증)" : "협의체 전달 좌표(확인 표시 없음)" } : undefined,
    lawdCode: p.lawdCode,
    exclusiveAreaM2: p.exclusiveAreaM2,
    householdCount: p.householdCount,
    comparisonType: p.comparisonType,
  };
  const pr = (doc.selectedPrices?.prices ?? []).find((x) => x.kind === "proposedSalePrice" && x.basis !== "project");
  w.reviewPrice = pr ? { amount: pr.amount, unit: pr.unit, basis: pr.basis as ReviewPrice["basis"], basisDate: pr.basisDate, label: "제시 분양가", dataMode: "committee-copy" } : null;
  w.schedule = { saleStart: doc.schedule?.saleStart, completion: doc.schedule?.completion };
  const o = doc.analysisOptions ?? {};
  if (o.comparisonMonthsBefore) w.options.comparisonMonthsBefore = o.comparisonMonthsBefore;
  if (o.comparisonMonthsAfter) w.options.comparisonMonthsAfter = o.comparisonMonthsAfter;
  if (o.purpose) w.options.purpose = o.purpose;
  return w;
}

export function recordFromContract(doc: ContractDocument, opts: { key: string; receivedAt?: string; kind: OriginKind }): AnalysisRecord {
  const working = workingFromContract(doc);
  const now = opts.receivedAt ?? seoulNowIso();
  const isLaunch = doc.documentType === LAUNCH_DOCUMENT_TYPE;
  return {
    format: ANALYSIS_FORMAT, formatVersion: ANALYSIS_FORMAT_VERSION, key: opts.key, title: titleFor(working), createdAt: now, updatedAt: now,
    origin: {
      kind: opts.kind, launchId: isLaunch ? doc.launchId : undefined, exportId: isLaunch ? undefined : doc.exportId, sourceLabel: doc.sourceLabel,
      senderCreatedAt: isLaunch ? doc.createdAt : doc.exportedAt, receivedAt: now, payloadHash: hashOf(doc),
    },
    original: { document: structuredClone(doc), working: structuredClone(working) },
    working, runs: [], versions: [],
  };
}

export function newManualRecord(key: string, working: WorkingInputs, kind: OriginKind = "manual"): AnalysisRecord {
  const now = seoulNowIso();
  return {
    format: ANALYSIS_FORMAT, formatVersion: ANALYSIS_FORMAT_VERSION, key, title: titleFor(working), createdAt: now, updatedAt: now,
    origin: { kind }, original: { working: structuredClone(working) }, working, runs: [], versions: [],
  };
}
