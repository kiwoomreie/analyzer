// v0.6.2 검토(2026-11-19) 지적: 패널 안내 과장, 보고서 단지명 구별
import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture } from "../helpers/observationFixture.ts";
import { complexKeyOf, newManualRecord } from "../../shared/model.ts";
import { withRun, latestRun } from "../../shared/runs.ts";
import { reportSummary } from "../../shared/report.ts";
import { reportLabelOf } from "../../shared/observation.ts";

async function statusOf(rec: ReturnType<typeof withRun>) {
  const React = (await import("react")).default;
  const moduleName = "react-dom/server";
  const { renderToStaticMarkup } = await import(moduleName);
  const { ObservationPanel } = await import("../../web/sections/ObservationPanel.tsx");
  const html: string = renderToStaticMarkup(React.createElement(ObservationPanel, { rec, update: () => {} }));
  return (html.match(/data-testid="obs-run-status">([^<]*)/) ?? [])[1] ?? "";
}

test("그룹 관측과 무관한 입력만 바뀌면 ‘값이 다르다’고 하지 않고 재실행 필요만 안내", async () => {
  const rec = withRun(newManualRecord("lc_u", fixture()), "manual");
  rec.working.property.buildYear = 2010;
  const s = await statusOf(rec);
  assert.match(s, /그룹 관측 값은 마지막 분석 실행\(#1\)과 같지만 다른 입력이 바뀌었습니다/);
  assert.doesNotMatch(s, /결과와 다릅니다/);
});

test("그룹 선택이 바뀌면 ‘결과와 다릅니다’, 입력이 그대로면 ‘같은 값’", async () => {
  const rec = withRun(newManualRecord("lc_g", fixture()), "manual");
  assert.match(await statusOf(rec), /같은 값입니다/);
  rec.working.observation!.control = [];
  assert.match(await statusOf(rec), /결과와 다릅니다/);
});

test("보고서 단지명: 이름·법정동이 같고 시군구만 다른 단지는 시군구까지 붙여 구별, 겹치지 않으면 짧게", () => {
  const w = fixture();
  w.transactions.forEach((t) => { t.dong = "청운동"; t.sggCd = t.complexName === "A" ? "11110" : "11140"; });
  // B 단지 거래를 A 이름으로 바꿔 ‘A(청운동)’ 표기가 두 단지에서 겹치게 함
  w.transactions.filter((t) => t.sggCd === "11140").forEach((t) => { t.complexName = "A"; });
  const kA = complexKeyOf(w.transactions[0]), kB = complexKeyOf(w.transactions[6]);
  assert.notEqual(kA, kB);
  w.observation!.impact = [kA];
  w.observation!.control = [kB];
  assert.equal(reportLabelOf(kA, w.transactions), "A(시군구 11110 · 청운동)");
  assert.equal(reportLabelOf(kB, w.transactions), "A(시군구 11140 · 청운동)");
  const rec = withRun(newManualRecord("lc_l", w), "manual");
  assert.match(reportSummary(rec, latestRun(rec).result!), /영향권\(사용자 확인\): A\(시군구 11110 · 청운동\) · 비교군\(사용자 확인\): A\(시군구 11140 · 청운동\)/);
  // 겹치지 않으면 기존처럼 짧게
  const w2 = fixture();
  assert.equal(reportLabelOf(complexKeyOf(w2.transactions[0]), w2.transactions), "A");
});
