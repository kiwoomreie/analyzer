// 시동·반출 입력 계약 v1.0 의 TypeScript 타입.
// 원본 정의는 contracts/location-analysis-launch.schema.json 이며 이 타입은 그와 1:1 로 맞춘다.

export const SCHEMA_VERSION = "1.0" as const;
export const LAUNCH_DOCUMENT_TYPE = "location-analysis-launch" as const;
export const IMPORT_DOCUMENT_TYPE = "location-analysis-import" as const;

export type MoneyUnit = "KRW" | "KRW_10K" | "KRW_100M";
export type PriceBasis = "household" | "project" | "perExclusiveM2" | "perExclusivePyeong";
export type PriceKind = "proposedSalePrice" | "appraisalValue" | "disposalPrice";
export type AssetType =
  | "apartment" | "officetel" | "office" | "hotel" | "retail" | "logistics" | "mixedUse" | "other";
export type DebtDefinition = "loanBalance" | "maxSecuredAmount";
export type SeniorStatus = "confirmedNone" | "confirmedAmount" | "unknown";

/** YYYY-MM 또는 YYYY-MM-DD */
export type DateOrMonth = string;

export interface ContractProperty {
  displayName?: string;
  address?: string;
  coordinates?: { lat: number; lng: number; senderVerified: boolean };
  assetType: AssetType;
  exclusiveAreaM2?: number;
  totalExclusiveAreaM2?: number;
  comparisonType?: string;
  householdCount?: number;
  lawdCode?: string;
}

export interface ContractPrice {
  kind: PriceKind;
  amount: number;
  unit: MoneyUnit;
  basis: PriceBasis;
  basisDate?: DateOrMonth;
}

export interface ContractDebt {
  includedByUserChoice: true;
  amount: number;
  unit: MoneyUnit;
  definition: DebtDefinition;
  seniorStatus: SeniorStatus;
  seniorAmount?: number;
  basisDate?: DateOrMonth;
}

export interface ContractSelectedPrices {
  prices?: ContractPrice[];
  debt?: ContractDebt;
}

export interface ContractSchedule {
  saleStart?: DateOrMonth;
  completion?: DateOrMonth;
  maturity?: DateOrMonth;
  expectedDisposal?: DateOrMonth;
}

export interface ContractScenario {
  name?: string;
  priceDeclinePct?: number;
  eventDelayMonths?: number;
  disposalDelayMonths?: number;
}

export interface ContractAnalysisOptions {
  comparisonMonthsBefore?: number;
  comparisonMonthsAfter?: number;
  purpose?: string;
}

interface ContractBody {
  schemaVersion: typeof SCHEMA_VERSION;
  asOf: string;
  sourceLabel?: string;
  property: ContractProperty;
  selectedPrices?: ContractSelectedPrices;
  schedule?: ContractSchedule;
  scenario?: ContractScenario;
  analysisOptions?: ContractAnalysisOptions;
}

export interface LaunchDocument extends ContractBody {
  documentType: typeof LAUNCH_DOCUMENT_TYPE;
  launchId: string;
  createdAt: string;
}

export interface ImportDocument extends ContractBody {
  documentType: typeof IMPORT_DOCUMENT_TYPE;
  exportId: string;
  exportedAt: string;
}

export type ContractDocument = LaunchDocument | ImportDocument;

export const LABELS = {
  moneyUnit: { KRW: "원", KRW_10K: "만원", KRW_100M: "억원" } as Record<MoneyUnit, string>,
  priceBasis: {
    household: "세대당",
    project: "사업 전체",
    perExclusiveM2: "전용㎡당",
    perExclusivePyeong: "전용평당",
  } as Record<PriceBasis, string>,
  priceKind: {
    proposedSalePrice: "제시 분양가",
    appraisalValue: "평가액",
    disposalPrice: "처분가",
  } as Record<PriceKind, string>,
  assetType: {
    apartment: "아파트",
    officetel: "오피스텔",
    office: "오피스",
    hotel: "호텔",
    retail: "상업시설",
    logistics: "물류",
    mixedUse: "복합",
    other: "기타",
  } as Record<AssetType, string>,
  debtDefinition: { loanBalance: "대출잔액", maxSecuredAmount: "채권최고액" } as Record<DebtDefinition, string>,
  seniorStatus: {
    confirmedNone: "선순위 없음(확인)",
    confirmedAmount: "선순위 금액 확인",
    unknown: "선순위 미확인",
  } as Record<SeniorStatus, string>,
};
