import { availableBy, evidenceDate } from "./asOf.ts";
// 실행본 보고서 맥락: 보고서를 다시 뽑을 때 필요한 당시 입력(제목·주소·사업지명·면적·검토가격·기준일·조건·근거 목록·조회 기록)을
// 실행 결과와 함께 보존한다. 최신 실행만 전체 입력 스냅샷(run.input)을 갖고 이전 실행은 지워지므로, 이것이 없으면
// 과거 보고서가 현재 작업본 값으로 채워지게 된다. 당시 정보가 없으면 현재 값으로 채우지 않고 ‘당시 정보 미보존’으로 표시한다.
import type { AnalysisResult } from "./analysis.ts";
import { titleFor, type AnalysisRecord, type Evidence, type ReviewPrice, type WorkingInputs } from "./model.ts";

type DataLogEntry = WorkingInputs["dataLog"][number];

export interface ReportContext {
  version: 1;
  /** 이 맥락을 만든 출처: 실행 시점 보존(snapshot) 또는 최신 실행의 전체 입력(input) */
  source: "snapshot" | "input";
  title: string;
  address: string;
  displayName?: string;
  exclusiveAreaM2?: number;
  buildYear?: number;
  comparisonType?: string;
  reviewPrice?: ReviewPrice | null;
  schedule: WorkingInputs["schedule"];
  asOf: string;
  options: { radiusM: number; buildYearBand: number; areaBandPct: number; recentMonths: number; minSample: number; minComplexTrades: number };
  transactionsCount: number;
  evidence: Evidence[];
  dataLog: DataLogEntry[];
  dataLogTotal?: number;
}

/** 보고서에 남길 조회 기록 상한(최근 순) */
export const MAX_DATALOG = 30;

export function buildReportContext(w: WorkingInputs, source: ReportContext["source"] = "snapshot"): ReportContext {
  const p = w.property;
  // JSON 왕복과 같은 모양이 되도록 undefined 항목은 남기지 않는다.
  return JSON.parse(JSON.stringify({
    version: 1, source,
    title: titleFor(w), address: p.address, displayName: p.displayName, exclusiveAreaM2: p.exclusiveAreaM2, buildYear: p.buildYear, comparisonType: p.comparisonType,
    reviewPrice: w.reviewPrice ? structuredClone(w.reviewPrice) : undefined,
    schedule: structuredClone(w.schedule ?? {}),
    asOf: w.asOf,
    options: { radiusM: w.options.radiusM, buildYearBand: w.options.buildYearBand, areaBandPct: w.options.areaBandPct, recentMonths: w.options.recentMonths, minSample: w.options.minSample, minComplexTrades: w.options.minComplexTrades },
    transactionsCount: w.transactions.length,
    evidence: structuredClone((w.evidence ?? []).filter(e => availableBy(evidenceDate(e), w.asOf))),
    dataLog: (w.dataLog ?? []).slice(-MAX_DATALOG),
    dataLogTotal: (w.dataLog ?? []).length,
  })) as ReportContext;
}

/** 결과 r을 만든 실행(같은 객체 우선, 복원 후에는 같은 해시 중 최신) */
export function runOf(rec: AnalysisRecord, r: AnalysisResult) {
  return rec.runs.find((x) => x.result === r) ?? [...rec.runs].reverse().find((x) => x.inputHash === r.inputHash);
}

/** 실행 당시 보존된 보고서 맥락이 우선이며, 구버전은 당시 입력 스냅샷에서 복원한다. */
export function contextOf(rec: AnalysisRecord, r: AnalysisResult): ReportContext | null {
  const run = runOf(rec, r);
  if (r.reportContext) return r.reportContext;
  if (run?.input) return buildReportContext(run.input, "input");
  return null;
}

/** 파일명도 본문과 같은 당시 맥락을 사용하며 현재 작업본 제목을 대입하지 않는다. */
export function reportFileTitle(rec: AnalysisRecord, r: AnalysisResult): string {
  return contextOf(rec, r)?.title ?? "실행";
}
