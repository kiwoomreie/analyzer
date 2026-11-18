import { runAnalysis } from "../shared/analysis.ts";
import { seoulNowIso } from "../shared/dates.ts";
import { hashOf } from "../shared/hash.ts";
import type { AnalysisRecord, RunRecord } from "../shared/model.ts";

export function navigate(path: string) {
  history.pushState(null, "", path);
  window.dispatchEvent(new Event("la:navigate"));
}

/** 분석 실행: 실행 당시 입력 스냅샷을 결과와 함께 보관(최근 실행만). 화면·보고서는 이 스냅샷 기준. */
export function withRun(rec: AnalysisRecord, trigger: "manual" | "auto-create"): AnalysisRecord {
  const input = structuredClone(rec.working);
  const result = runAnalysis(input);
  const older = rec.runs.map(({ input: _drop, ...r }) => r as RunRecord);
  return { ...rec, updatedAt: seoulNowIso(), runs: [...older, { runNo: rec.runs.length + 1, at: seoulNowIso(), trigger, inputHash: result.inputHash, input, result }] };
}

/** 최근 실행과 그 입력 스냅샷, 현재 입력과의 일치 여부 */
export function latestRun(rec: AnalysisRecord) {
  const run = rec.runs[rec.runs.length - 1];
  const input = run?.input ?? rec.working;
  const stale = run ? hashOf(rec.working) !== run.inputHash : true;
  return { run, input, result: run?.result, stale };
}
