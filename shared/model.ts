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
  user: "사용자 입력",
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
/** 근거 내용 판단(사용자가 기록). ‘공식 확인’을 뜻하지 않는다. */
export const EVIDENCE_STATUS_LABEL: Record<EvidenceStatus, string> = {
  confirmed: "사실로 기록(사용자 판단)",
  needsApplicability: "본건 적용 추가 검토",
  inconsistent: "자료 간 불일치",
  hardToVerify: "확인 어려움",
};

/** 출처 종류: 공공기관 원문(고시·공고·인허가 등) / 보도자료·언론 / 분양광고 / 기타 */
export type EvidenceSourceType = "official" | "press" | "marketing" | "other";
export const EVIDENCE_SOURCE_LABEL: Record<EvidenceSourceType, string> = { official: "공공기관 원문", press: "보도자료·언론", marketing: "분양·홍보물", other: "기타" };

/**
 * 근거 기록 수준(앱이 자동 검증한 것이 아님).
 * - userInput: 사용자 입력 — 출처·발행일 미기재
 * - sourceCited: 출처 기재 — 발행기관·문서명·발행일은 있으나 공식 원문 대조 기록 없음
 * - originalChecked: 공식 원문 대조 기록 — 공공기관 원문이며 문서번호 또는 첨부, 페이지·절, 발행일과 ‘원문 직접 대조’ 표시를 사용자가 기록
 * 입지 뉴스·고시의 자동 수집·자동 검증 기능은 없다.
 */
export type EvidenceLevel = "userInput" | "sourceCited" | "originalChecked";
export const EVIDENCE_LEVEL_LABEL: Record<EvidenceLevel, string> = {
  userInput: "사용자 입력(출처 미기재)",
  sourceCited: "출처 기재(원문 대조 기록 없음)",
  originalChecked: "공식 원문 대조 기록(사용자 기록, 자동 검증 아님)",
};

export interface Evidence {
  key: string;
  publisher: string;
  title: string;
  sourceType?: EvidenceSourceType;
  /** 사용자가 공식 원문을 직접 대조했다고 기록함 */
  originalReviewed?: boolean;
  sourceRef?: string;
  /** 참고 주소 — 텍스트로만 보관하며 앱이 조회·실행하지 않음 */
  sourceUrl?: string;
  attachmentKey?: string;
  /** 발행일 */
  publishedOn?: string;
  /** 자료 기준일·적용일 */
  effectiveOn?: string;
  /** 사용자가 확인한 날 */
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
  /** 공식 단지 식별자(국토부 aptSeq 등). 있으면 단지 구분에 우선 사용 */
  complexId?: string;
  /** 시군구 코드(5자리) */
  sggCd?: string;
  /** 법정동(단지 구분 보조) */
  dong?: string;
  jibun?: string;
  /** 동(등기 완료 건만 공개) */
  aptDong?: string;
  /** 원천 거래 식별자(있을 때만). 국토부 아파트 매매 API에는 거래 단위 공식 식별자가 없음 */
  officialId?: string;
  /** 식별자를 발급한 출처 범위(예: 기관·시스템 이름). 없으면 ‘출처 미지정’으로 보고 자동 정정하지 않음 */
  idScope?: string;
  /** 같은 조건 묶음에서 해제 대상을 특정할 수 없었음(묶음 크기·해제 건수) */
  cancelAmbiguity?: { size: number; cancelled: number };
  /** 중복 판별 키(tradeMerge.ts) */
  idKey?: string;
  idBasis?: "official" | "composite";
  /** 정정·취소 대사 이력 */
  revisions?: { at: string; source: string; change: string }[];
  /** 같은 조건 묶음의 크기(2 이상이면 기록된 정보로 서로 구별 불가) */
  sameKeyCount?: number;
  /** 확인 필요 표시(예: 금액만 다른 같은 조건 거래 — 별도 거래인지 정정인지 미확정) */
  reviewFlag?: { kind: "possibleCorrection" | "idConflict" | "idChangeUnconfirmed"; base: string; note: string };
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
  /** complexKey: 공식 단지 식별자 또는 단지명·시군구·법정동·지번 조합(complexKeyOf) */
  complexKey: string;
  /** 사용자가 확인해 입력한 거리(m) */
  distanceM?: number;
  distanceSource?: string;
  buildYear?: number;
  households?: number;
  /** 좌표(자동 조회 또는 사용자 입력) */
  location?: { lat: number; lng: number };
  locationSource?: string;
  address?: string;
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
  /** 자동 조회·가져오기 기록(어떤 자료를 언제 어디서) */
  dataLog: { at: string; source: string; detail: string }[];
  /** 공공 API 수집 대사 결과(최근 것부터) */
  collections?: CollectionReport[];
}

export interface CollectionReport {
  at: string;
  /** 이전 버전 호환: 거래 응답 수집 상태와 같음 */
  status: "complete" | "partial" | "failed" | "unset";
  /** ① 거래 응답 수집·건수 대사(시군구·월별 전체 건수와 수집 건수 일치 여부) */
  trades: { status: "complete" | "partial" | "failed" | "unset"; monthsOk: number; monthsTotal: number; capped: boolean; note: string };
  /** ② 주변 행정구역 탐색(표본 지점 방식 — 경계 전체를 보장하지 않으므로 ‘완료’ 상태가 없음) */
  regionDiscovery: { status: "sampled" | "partial" | "notPerformed"; sampled: number; failedPoints: number; regionsFound: number; regionsUsed: number; capped: boolean; note: string };
  /** ③ 단지 좌표 확인 */
  complexGeocode: { status: "complete" | "partial" | "failed" | "notPerformed"; total: number; attempted: number; located: number; failed: number; capped: boolean };
  regions: { code: string; name: string }[];
  regionNote: string;
  months: { lawdCode: string; yearMonth: string; totalCount: number | null; collected: number; pagesExpected: number | null; pagesFetched: number; ok: boolean; error?: string }[];
  merge?: MergeReport;
  notes: string[];
}

/** 이전 버전 수집 보고 변환 */
export function migrateCollection(c: any): CollectionReport {
  if (c.trades && c.regionDiscovery) {
    // v0.4: 상한에 걸렸는데 ‘표본 확인’으로 남은 기록 → ‘일부’로 맞춤(원 기록의 다른 값은 유지)
    if (c.regionDiscovery.capped && c.regionDiscovery.status === "sampled") return { ...c, regionDiscovery: { ...c.regionDiscovery, status: "partial" } };
    if (c.complexGeocode?.capped && c.complexGeocode.status === "complete") return { ...c, complexGeocode: { ...c.complexGeocode, status: "partial" } };
    return c;
  }
  const months = c.months ?? [];
  const ok = months.filter((m: any) => m.ok).length;
  return {
    ...c,
    trades: { status: c.status ?? "failed", monthsOk: ok, monthsTotal: months.length, capped: false, note: "이전 버전 기록" },
    regionDiscovery: { status: /누락 가능|확인 불가/.test(c.regionNote ?? "") ? "partial" : "sampled", sampled: 0, failedPoints: 0, regionsFound: (c.regions ?? []).length, regionsUsed: (c.regions ?? []).length, capped: false, note: c.regionNote ?? "" },
    complexGeocode: { status: c.complexGeocode?.attempted ? (c.complexGeocode.failed ? "partial" : "complete") : "notPerformed", total: c.complexGeocode?.attempted ?? 0, attempted: c.complexGeocode?.attempted ?? 0, located: c.complexGeocode?.located ?? 0, failed: c.complexGeocode?.failed ?? 0, capped: false },
  };
}

export interface MergeReport {
  received: number;
  added: number;
  duplicates: number;
  /** 원천 거래 식별자가 같은데 값이 바뀐 정정만 집계(가격 차이만으로는 정정으로 보지 않음) */
  corrected: number;
  cancellationsApplied: number;
  addedCancelled: number;
  /** 같은 조건 묶음에서 반영한 해제 중 어느 거래인지 특정할 수 없는 건수 */
  cancelUnspecified: number;
  /** 금액만 다른 같은 조건 거래 — 별도 거래 또는 정정 여부 확인 필요 */
  possibleCorrections: number;
  /** 기존보다 적게 들어온 같은 조건 묶음(부분 자료 가능) */
  partialGroups: number;
  /** 해제 대상 특정 불가 묶음 중 전량 해제 등으로 해소된 묶음 수(v0.5.2~) */
  ambiguityResolved?: number;
  /** 묶음 증가·해제 추가로 건수가 갱신된 불확실 묶음 수(v0.5.2~) */
  ambiguityUpdated?: number;
  /** 같은 배치 안에서 같은 출처·ID·같은 내용으로 반복된 건수(1건만 보존) */
  idDuplicatesInBatch: number;
  /** 같은 출처·ID인데 내용·지역·단지가 충돌해 병합하지 않고 확인 필요로 보존한 건수 */
  idConflicts: number;
  /** 출처 미지정 ID의 값 변경 — 자동 반영하지 않고 확인 필요로 보류한 건수 */
  idChangesHeld: number;
  /** 이미 저장된 같은 ID·같은 내용 사본에 함께 반영한 건수 */
  storedDuplicatesUpdated: number;
  sameKeyGroups: number;
  notes: string[];
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
  /** 실행 당시 입력 스냅샷. 결과·보고서는 이 스냅샷 기준으로 표시(최근 실행에만 보관) */
  input?: WorkingInputs;
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
    collections: [],
  };
}

/**
 * 단지 식별 키. 공식 단지 식별자가 있으면 우선 사용하고, 없으면 단지명·시군구·법정동·지번 조합을 사용한다.
 * 같은 이름이라도 시군구·법정동·지번이 다르면 다른 단지로 본다.
 */
export const complexKeyOf = (t: { complexName: string; complexId?: string; sggCd?: string; dong?: string; jibun?: string }) =>
  t.complexId ? `S:${t.complexId.trim()}` : `N:${t.complexName.trim()}|${(t.sggCd ?? "").trim()}|${(t.dong ?? "").trim()}|${(t.jibun ?? "").trim()}`;

/** 이전 버전 저장분 변환(기존 입력 보존): 옛 단지 키 "단지명|법정동" → 새 키 형식 */
export function migrateWorking(w: WorkingInputs): WorkingInputs {
  for (const c of w.complexInfo ?? []) {
    if (!/^[SN]:/.test(c.complexKey)) {
      const [name, dong = ""] = c.complexKey.split("|");
      c.complexKey = `N:${name}||${dong}|`;
    }
  }
  w.collections = (w.collections ?? []).map(migrateCollection);
  w.dataLog ??= [];
  return w;
}

export function migrateRecord(r: AnalysisRecord): AnalysisRecord {
  migrateWorking(r.working);
  migrateWorking(r.original.working);
  r.versions?.forEach((v) => migrateWorking(v.working));
  r.runs?.forEach((x) => x.input && migrateWorking(x.input));
  return r;
}

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
