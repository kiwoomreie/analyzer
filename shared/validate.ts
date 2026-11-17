// 시동·반출 문서 검증: 안전 검사 → 스키마 검사 → 의미 검사. 원문 값은 결과에 넣지 않는다.
import schema from "../contracts/location-analysis-launch.schema.json" with { type: "json" };
import { validateAgainst, type SchemaIssue } from "./jsonschema.ts";
import { scanSafety, type SafetyIssue } from "./safety.ts";
import { isValidDateValue } from "./dates.ts";
import { IMPORT_DOCUMENT_TYPE, LAUNCH_DOCUMENT_TYPE, type ContractDocument } from "./contract.ts";

export const CONTRACT_SCHEMA: Record<string, any> = schema as any;

export type ContractIssue = { path: string; code: string; message: string };

export interface ContractValidation {
  ok: boolean;
  kind: "launch" | "import" | null;
  doc?: ContractDocument;
  /** 금지 필드·비밀값이 있으면 true — 자료 전체 거절 대상 */
  safetyRejected: boolean;
  issues: ContractIssue[];
}

export function validateContractDocument(input: unknown, expect?: "launch" | "import"): ContractValidation {
  const safety: SafetyIssue[] = scanSafety(input);
  if (safety.length) return { ok: false, kind: null, safetyRejected: true, issues: safety };
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, kind: null, safetyRejected: false, issues: [{ path: "$", code: "TYPE", message: "JSON 객체여야 함" }] };
  }
  const dt = (input as any).documentType;
  const kind = dt === LAUNCH_DOCUMENT_TYPE ? "launch" : dt === IMPORT_DOCUMENT_TYPE ? "import" : null;
  if (!kind) {
    return { ok: false, kind: null, safetyRejected: false, issues: [{ path: "$.documentType", code: "DOCUMENT_TYPE", message: `${LAUNCH_DOCUMENT_TYPE} 또는 ${IMPORT_DOCUMENT_TYPE} 이어야 함` }] };
  }
  if (expect && kind !== expect) {
    return { ok: false, kind, safetyRejected: false, issues: [{ path: "$.documentType", code: "DOCUMENT_TYPE", message: expect === "launch" ? "시동 수신 경로에는 location-analysis-launch 만 허용" : "파일 가져오기에는 location-analysis-import 사용" }] };
  }
  const def = CONTRACT_SCHEMA.$defs[kind === "launch" ? "launchDocument" : "importDocument"];
  const issues: SchemaIssue[] = validateAgainst(CONTRACT_SCHEMA, def, input);
  if (!issues.length) issues.push(...semanticIssues(input as ContractDocument));
  return issues.length
    ? { ok: false, kind, safetyRejected: false, issues }
    : { ok: true, kind, safetyRejected: false, issues: [], doc: input as ContractDocument };
}

function semanticIssues(doc: ContractDocument): ContractIssue[] {
  const out: ContractIssue[] = [];
  const checkDate = (path: string, v: string | undefined) => {
    if (v !== undefined && !isValidDateValue(v)) out.push({ path, code: "INVALID_DATE", message: "존재하지 않는 날짜" });
  };
  checkDate("$.asOf", doc.asOf);
  const ts = doc.documentType === LAUNCH_DOCUMENT_TYPE ? doc.createdAt : doc.exportedAt;
  if (Number.isNaN(Date.parse(ts))) out.push({ path: doc.documentType === LAUNCH_DOCUMENT_TYPE ? "$.createdAt" : "$.exportedAt", code: "INVALID_DATETIME", message: "해석할 수 없는 시각" });
  for (const [k, v] of Object.entries(doc.schedule ?? {})) checkDate(`$.schedule.${k}`, v as string);
  (doc.selectedPrices?.prices ?? []).forEach((p, i) => checkDate(`$.selectedPrices.prices[${i}].basisDate`, p.basisDate));
  const debt = doc.selectedPrices?.debt;
  if (debt) {
    checkDate("$.selectedPrices.debt.basisDate", debt.basisDate);
    if (debt.seniorStatus === "confirmedAmount" && debt.seniorAmount === undefined) out.push({ path: "$.selectedPrices.debt.seniorAmount", code: "SENIOR_AMOUNT_REQUIRED", message: "선순위 금액 확인 상태에는 seniorAmount 필요" });
    if (debt.seniorStatus !== "confirmedAmount" && debt.seniorAmount !== undefined) out.push({ path: "$.selectedPrices.debt.seniorAmount", code: "SENIOR_AMOUNT_UNEXPECTED", message: "선순위 금액은 confirmedAmount 상태에서만 전달" });
  }
  return out;
}
