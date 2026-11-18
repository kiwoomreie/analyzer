// 분석 실행 공용 경로(화면·서버 자동 실행 모두 사용).
// 실행 당시 입력 스냅샷을 결과와 함께 보관하고(최근 실행만), 화면·보고서는 이 스냅샷 기준으로 표시한다.
import { runAnalysis } from "./analysis.ts";
import { seoulNowIso } from "./dates.ts";
import { hashOf } from "./hash.ts";
import type { AnalysisRecord, RunRecord } from "./model.ts";

export function withRun(rec: AnalysisRecord, trigger: RunRecord["trigger"], at = seoulNowIso()): AnalysisRecord {
  const input = structuredClone(rec.working);
  const result = runAnalysis(input);
  const older = rec.runs.map(({ input: _drop, ...r }) => r as RunRecord);
  return { ...rec, updatedAt: at, runs: [...older, { runNo: rec.runs.length + 1, at, trigger, inputHash: result.inputHash, input, result }] };
}

/** 최근 실행과 그 입력 스냅샷, 현재 입력과의 일치 여부 */
export function latestRun(rec: AnalysisRecord) {
  const run = rec.runs[rec.runs.length - 1];
  const input = run?.input ?? rec.working;
  const stale = run ? hashOf(rec.working) !== run.inputHash : true;
  return { run, input, result: run?.result, stale };
}
