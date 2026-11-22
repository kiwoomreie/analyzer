// 분석 실행 공용 경로(화면·서버 자동 실행 모두 사용).
// 실행 당시 입력 스냅샷을 결과와 함께 보관하고(최근 실행만), 화면·보고서는 이 스냅샷 기준으로 표시한다.
import { runAnalysis } from "./analysis.ts";
import { observationConfigured, observeGroups } from "./observation.ts";
import { buildCitations } from "./citations.ts";
import { buildReportContext } from "./runContext.ts";
import { seoulNowIso } from "./dates.ts";
import { hashOf } from "./hash.ts";
import type { AnalysisRecord, RunRecord } from "./model.ts";

export function withRun(rec: AnalysisRecord, trigger: RunRecord["trigger"], at = seoulNowIso()): AnalysisRecord {
  const input = structuredClone(rec.working);
  const result = runAnalysis(input);
  // v0.6.1: 수동 확인 그룹 관측도 같은 입력 스냅샷으로 계산해 실행 기록에 보관(보고서 재현용). 설정이 없으면 생략.
  if (observationConfigured(input)) result.groupObservation = observeGroups(input);
  // v0.8: 인용 근거(대표 비교단지 거래·입지 사건·관측)를 이 실행 시점 값으로 보존
  result.citations = buildCitations(input, result, at);
  // v0.8.1: 과거 실행 보고서를 당시 제목·주소·검토가격·조건·근거 목록으로 다시 만들 수 있게 보존(입력 스냅샷은 최신 실행만 남으므로)
  result.reportContext = buildReportContext(input);
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
