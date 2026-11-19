// v0.8: 실행본 인용 근거 보존 — 실행 1의 인용은 이후 거래·사건 수정·삭제, 새로고침(직렬화), JSON 백업 복원 후에도 바뀌지 않음
import { test } from "node:test";
import assert from "node:assert/strict";
import { migrateRecord, newManualRecord, type AnalysisRecord } from "../../shared/model.ts";
import { withRun, latestRun } from "../../shared/runs.ts";
import { demoWorking } from "../../shared/demo.ts";
import { makeBackup, restoreBackup } from "../../shared/importers.ts";
import { findCitation, citationIdForComplex } from "../../shared/citations.ts";
import { reportSummary } from "../../shared/report.ts";
import { runAnalysis } from "../../shared/analysis.ts";
import { observeGroups } from "../../shared/observation.ts";

const snap = (x: unknown) => JSON.stringify(x);

test("실행 1 인용 근거는 실행 2의 거래 수정·삭제·사건 삭제·단지명 변경, 새로고침, JSON 복원 후에도 그대로", () => {
  let rec = withRun(newManualRecord("lc_cite", demoWorking(), "demo"), "manual");
  const run1 = rec.runs[0].result;
  const c1 = findCitation(run1, "실거래-01");
  const e1 = findCitation(run1, "입지-01");
  assert.ok(c1 && c1.kind === "trade" && c1.trades.length > 0, "대표 비교단지 인용 보존");
  assert.ok(e1 && e1.kind === "event", "입지 사건 인용 보존");
  assert.ok(findCitation(run1, "관측-01"), "그룹 관측 인용 보존");
  const before = snap(run1.citations);

  // 실행 2: 인용된 거래 금액 수정, 다른 인용 거래 삭제, 첫 사건 삭제, 단지명 변경
  const w = structuredClone(rec.working);
  const citedKeys = (c1 as any).trades.map((t: any) => t.key);
  const t0 = w.transactions.find((t) => t.key === citedKeys[0])!;
  t0.priceKrw = 1;
  w.transactions = w.transactions.filter((t) => t.key !== citedKeys[1]);
  w.events = w.events.filter((e) => e.key !== (e1 as any).eventKey);
  w.transactions.forEach((t) => { if (t.complexName === (c1 as any).name) t.complexName = `${t.complexName} (이름 변경)`; });
  rec = withRun({ ...rec, working: w }, "manual");
  assert.equal(rec.runs.length, 2);
  assert.equal(snap(rec.runs[0].result.citations), before, "실행 2 후에도 실행 1 인용 불변");
  assert.notEqual(snap(rec.runs[1].result.citations), before, "실행 2는 새 값으로 인용");

  // 새로고침(저장소 직렬화·마이그레이션)
  const reloaded = migrateRecord(JSON.parse(JSON.stringify(rec)) as AnalysisRecord);
  assert.equal(snap(reloaded.runs[0].result.citations), before, "새로고침 후 불변");

  // JSON 백업 → 복원
  const restored = restoreBackup(JSON.parse(JSON.stringify(makeBackup([reloaded], "2026-11-20T08:00:00+09:00"))));
  assert.equal(restored.type, "backup");
  if (restored.type !== "backup") return;
  assert.deepEqual(restored.errors, []);
  assert.equal(snap(restored.records[0].runs[0].result.citations), before, "JSON 복원 후 불변");
  // 인용된 거래 값은 실행 1 시점 값(금액 1원으로 바뀐 값이 아님)
  const t0cited = (findCitation(restored.records[0].runs[0].result, "실거래-01") as any).trades.find((t: any) => t.key === citedKeys[0]);
  assert.notEqual(t0cited.priceKrw, 1);
});

test("과거 실행본(인용 보존 이전)은 ‘당시 근거 상세 미보존’, 현재 입력으로 다시 채우지 않음", () => {
  const rec = withRun(newManualRecord("lc_old", demoWorking(), "demo"), "manual");
  const old = structuredClone(rec);
  delete (old.runs[0].result as any).citations;
  const r = old.runs[0].result;
  assert.equal(findCitation(r, "실거래-01"), null);
  assert.ok(citationIdForComplex(r, r.market.comparables[0].complexKey), "버튼 ID는 같은 규칙으로 표시");
  assert.match(reportSummary(old, r), /당시 근거 상세 미보존/);
});

test("인용 보존을 넣어도 계산값(분석·관측)은 변경 전과 동일", () => {
  const w = demoWorking();
  const rec = withRun(newManualRecord("lc_same", w), "manual");
  const r = latestRun(rec).result!;
  const direct = runAnalysis(structuredClone(w));
  assert.equal(snap(r.market), snap(direct.market));
  assert.equal(snap(r.price), snap(direct.price));
  assert.equal(snap(r.groupObservation), snap(observeGroups(structuredClone(w))));
});
