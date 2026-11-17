import { runAnalysis } from "../shared/analysis.ts";
import { seoulNowIso } from "../shared/dates.ts";
import type { AnalysisRecord } from "../shared/model.ts";

export function navigate(path: string) {
  history.pushState(null, "", path);
  window.dispatchEvent(new Event("la:navigate"));
}

/** 분석 실행 기록 추가. 화면·보고서는 이 실행 결과를 사용한다. */
export function withRun(rec: AnalysisRecord, trigger: "manual" | "auto-create"): AnalysisRecord {
  const result = runAnalysis(rec.working);
  return { ...rec, updatedAt: seoulNowIso(), runs: [...rec.runs, { runNo: rec.runs.length + 1, at: seoulNowIso(), trigger, inputHash: result.inputHash, result }] };
}
