// 새 앱 내부 분석 모델. 시동·반출·직접 입력·데모·백업 복구가 모두 이 모델로 변환된다.
import type {
  AssetType, ContractDocument, ContractProperty, ContractSchedule, ContractScenario, DebtDefinition,
  DateOrMonth, MoneyUnit, PriceBasis, PriceKind, SeniorStatus,
} from "./contract.ts";
import { LAUNCH_DOCUMENT_TYPE } from "./contract.ts";
import { hashOf } from "./hash.ts";
import { seoulNowIso, seoulToday } from "./dates.ts";

export const ANALYSIS_FORMAT = "location-analyzer-analysis" as const;
export const ANALYSIS_FORMAT_VERSION = 1 as const;
export const ENGINE_VERSION = "0.1.0";

/** demo=가상, user=사용자 제공, official-api=공식 API 실제 자료, committee-copy=협의체가 보낸 가정 사본 */
export type DataMode = "demo" | "user" | "official-api" | "committee-copy";

export const DATA_MODE_LABEL: Record<DataMode, string> = {
  demo: "가상 자료",
  user: "사용자 제공",
  "official-api": "공식 API",
  "committee-copy": "협의체 사본",
};

export interface PriceEntry {
  key: string;
  kind: PriceKind;
  amount: number;
  unit: MoneyUnit;
  basis: PriceBasis;
  basisDate?: DateOrMonth;
  dataMode: DataMode;
}

export interface DebtEntry {
  amount: number;
  unit: MoneyUnit;
  definition: DebtDefinition;
  seniorStatus: SeniorStatus;
  seniorAmount?: number;
  basisDate?: DateOrMonth;
  dataMode: DataMode;
}

export type EventCategory = "transport" | "employment" | "supply";
export const EVENT_CATEGORY_LABEL: Record<EventCategory, string> = {
  transport: "교통 변화",
  employment: "대형 업무·고용시설",
  supply: "경쟁 주택 공급",
};

export type MilestoneType =
  | "announcement" | "notice" | "approval" | "permit" | "constructionStart" | "opening" | "delay" | "cancellation" | "sale" | "occupancy" | "other";
export const MILESTONE_LABEL: Record<MilestoneType, string> = {
  announcement: "발표",
  notice: "고시",
  approval: "승인",
  permit: "인허가",
  constructionStart: "착공",
  opening: "개통·개장",
  delay: "지연(변경 일정)",
  cancellation: "취소",
  sale: "분양",
  occupancy: "입주",
  other: "기타",
};

export interface Milestone {
  key: string;
  type: MilestoneType;
  /** planned=예정, actual=실제 발생 */
  status: "planned" | "actual";
  /** 적용·실행(예정)일 — 지연 항목은 변경된 개통 예정일 */
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
  priceMinPerM2Krw?: number;
  priceMaxPerM2Krw?: number;
  saleDate?: DateOrMonth;
  occupancyDate?: DateOrMonth;
  demandGroups?: string[];
}

export interface LocationEvent {
  key: string;
  category: EventCategory;
  name: string;
  direction: "favorable" | "adverse" | "mixed" | "unknown";
  location?: { lat: number; lng: number; label?: string };
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
  /** 원문 식별자(문서번호 등) */
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
  exclusiveAreaM2: number;
  floor?: number;
  priceKrw: number;
  /** 계약일 YYYY-MM-DD 또는 YYYY-MM */
  contractDate: string;
  cancelled: boolean;
  cancelDate?: string;
  /** target=본건 권역, comparator=비교 권역 */
  group: "target" | "comparator";
  buildYear?: number;
  dataMode: DataMode;
  manualExclusion?: string;
}

export interface IndexComparisonInput {
  key: string;
  label: string;
  periodStart?: string;
  periodEnd?: string;
  targetStart: number;
  targetEnd: number;
  comparatorStart: number;
  comparatorEnd: number;
  source: string;
  dataMode: DataMode;
}

export interface AttachmentMeta {
  key: string;
  filename: string;
  mime: string;
  size: number;
  sha256: string;
  /** 텍스트 형식 소용량 첨부만 보관(표시 시 그대로 텍스트로만 표시) */
  text?: string;
  addedAt: string;
}

export interface WorkingInputs {
  asOf: string;
  property: ContractProperty & { targetDemand?: string[] };
  prices: PriceEntry[];
  debt: DebtEntry | null;
  ltvChecks: {
    valueKind: PriceKind;
    collateralScopeConfirmed: boolean;
    basisDateConfirmed: boolean;
  };
  schedule: ContractSchedule;
  scenario: ContractScenario;
  options: {
    comparisonMonthsBefore: number;
    comparisonMonthsAfter: number;
    purpose?: string;
    areaBandPct: number;
    minSample: number;
    anchorEventKey?: string;
  };
  appraisalNote?: string;
  events: LocationEvent[];
  evidence: Evidence[];
  transactions: Transaction[];
  indexComparisons: IndexComparisonInput[];
  attachments: AttachmentMeta[];
}

export type OriginKind = "launch" | "committee-import" | "manual" | "demo" | "backup-restore";
export const ORIGIN_LABEL: Record<OriginKind, string> = {
  launch: "협의체 ‘분석기 시동’",
  "committee-import": "협의체 반출 파일",
  manual: "직접 입력",
  demo: "가상 데모",
  "backup-restore": "백업 복구",
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
    /** 협의체에서 사본을 만든 시각 */
    senderCreatedAt?: string;
    /** 새 앱이 수신한 시각 */
    receivedAt?: string;
    payloadHash?: string;
  };
  /** 최초 수신·생성 사본(수정 불가) */
  original: {
    document?: ContractDocument;
    working: WorkingInputs;
  };
  /** 새 앱 내부 작업본 */
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
  return { comparisonMonthsBefore: 24, comparisonMonthsAfter: 24, areaBandPct: 10, minSample: 10 };
}

export function emptyWorking(asOf = seoulToday(), assetType: AssetType = "apartment"): WorkingInputs {
  return {
    asOf,
    property: { assetType },
    prices: [],
    debt: null,
    ltvChecks: { valueKind: "appraisalValue", collateralScopeConfirmed: false, basisDateConfirmed: false },
    schedule: {},
    scenario: {},
    options: defaultOptions(),
    events: [],
    evidence: [],
    transactions: [],
    indexComparisons: [],
    attachments: [],
  };
}

/** 계약 문서(검증 완료)를 내부 작업 입력으로 변환. 시나리오 이름으로 숨은 규칙을 만들지 않고 전달된 숫자만 사용. */
export function workingFromContract(doc: ContractDocument): WorkingInputs {
  const w = emptyWorking(doc.asOf, doc.property.assetType);
  w.property = structuredClone(doc.property);
  w.prices = (doc.selectedPrices?.prices ?? []).map((p, i) => ({ ...p, key: `price_${i + 1}`, dataMode: "committee-copy" as const }));
  const d = doc.selectedPrices?.debt;
  w.debt = d
    ? { amount: d.amount, unit: d.unit, definition: d.definition, seniorStatus: d.seniorStatus, seniorAmount: d.seniorAmount, basisDate: d.basisDate, dataMode: "committee-copy" }
    : null;
  w.schedule = structuredClone(doc.schedule ?? {});
  w.scenario = structuredClone(doc.scenario ?? {});
  const o = doc.analysisOptions ?? {};
  w.options = {
    ...defaultOptions(),
    ...(o.comparisonMonthsBefore ? { comparisonMonthsBefore: o.comparisonMonthsBefore } : {}),
    ...(o.comparisonMonthsAfter ? { comparisonMonthsAfter: o.comparisonMonthsAfter } : {}),
    ...(o.purpose ? { purpose: o.purpose } : {}),
  };
  return w;
}

export function titleFor(w: WorkingInputs, fallback: string): string {
  return w.property.displayName || w.property.address || fallback;
}

export function recordFromContract(doc: ContractDocument, opts: { key: string; receivedAt?: string; kind: OriginKind }): AnalysisRecord {
  const working = workingFromContract(doc);
  const now = opts.receivedAt ?? seoulNowIso();
  const isLaunch = doc.documentType === LAUNCH_DOCUMENT_TYPE;
  return {
    format: ANALYSIS_FORMAT,
    formatVersion: ANALYSIS_FORMAT_VERSION,
    key: opts.key,
    title: titleFor(working, "표시명 미입력 사업장"),
    createdAt: now,
    updatedAt: now,
    origin: {
      kind: opts.kind,
      launchId: isLaunch ? doc.launchId : undefined,
      exportId: isLaunch ? undefined : doc.exportId,
      sourceLabel: doc.sourceLabel,
      senderCreatedAt: isLaunch ? doc.createdAt : doc.exportedAt,
      receivedAt: now,
      payloadHash: hashOf(doc),
    },
    original: { document: structuredClone(doc), working: structuredClone(working) },
    working,
    runs: [],
    versions: [],
  };
}

export function newManualRecord(key: string, working: WorkingInputs, kind: OriginKind = "manual"): AnalysisRecord {
  const now = seoulNowIso();
  return {
    format: ANALYSIS_FORMAT,
    formatVersion: ANALYSIS_FORMAT_VERSION,
    key,
    title: titleFor(working, kind === "demo" ? "가상 데모" : "새 분석"),
    createdAt: now,
    updatedAt: now,
    origin: { kind },
    original: { working: structuredClone(working) },
    working,
    runs: [],
    versions: [],
  };
}
