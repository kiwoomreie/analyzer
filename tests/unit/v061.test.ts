// v0.6 검토(2026-11-19) 지적 사항 회귀 시험
import { test } from "node:test";
import assert from "node:assert/strict";
import { complexKeyOf, newManualRecord, migrateRecord } from "../../shared/model.ts";
import { observeGroups } from "../../shared/observation.ts";
import { withRun, latestRun } from "../../shared/runs.ts";
import { reportDraft, reportSummary } from "../../shared/report.ts";
import { fixture } from "../helpers/observationFixture.ts";

test("[2] 그룹 관측 설정이 있으면 실행 기록에 같은 입력 스냅샷 기준 결과를 보관하고 보고서에 포함", () => {
  const rec = withRun(newManualRecord("lc_g", fixture()), "manual");
  const r = latestRun(rec).result!;
  assert.ok(r.groupObservation);
  assert.ok(Math.abs(r.groupObservation!.differencePp! - 10) < 1e-8);
  const md = reportSummary(rec, r);
  assert.match(md, /수동 확인 그룹 관측 \(실행 #1 입력 기준 · 인과효과 아님\)/);
  assert.match(md, /\| 영향권 \| 1\/1 \| 3건 \| 3건 \| 100만원 \| 120만원 \| 20\.0% \|/);
  assert.match(md, /비교군 대비 관측 차이 \+10\.0%p/);
  assert.match(md, /영향권\(사용자 확인\): A · 비교군\(사용자 확인\): B/);
  assert.doesNotMatch(md, /N:A\|\|\|/, "내부 식별키 노출 금지");
  assert.match(md, /### E\. 수동 확인 그룹 월별/);
  assert.match(reportDraft(rec, r), /수동 확인 그룹 관측.*영향권 20\.0%.*비교군 10\.0%.*\+10\.0%p/);
});

test("[2] 실행 후 그룹·기간을 바꿔도 보고서는 실행 당시 값 유지(현재 작업본과 분리), 다시 실행하면 갱신", () => {
  let rec = withRun(newManualRecord("lc_g2", fixture()), "manual");
  rec = { ...rec, working: { ...rec.working, observation: { ...rec.working.observation!, control: [] } } };
  const { result, stale } = latestRun(rec);
  assert.equal(stale, true);
  assert.match(reportSummary(rec, result!), /비교군 대비 관측 차이 \+10\.0%p/);
  assert.equal(observeGroups(rec.working).differencePp, null);
  rec = withRun(rec, "manual");
  assert.match(reportSummary(rec, latestRun(rec).result!), /비교군 대비 관측 차이: 표시 안 함 — 유효한 비교가 아님/);
});

test("[2] 그룹 관측 설정이 없으면 실행 결과에 넣지 않고, v0.6 이전 실행 기록은 보고서에 ‘설정 없음’ 한 줄", () => {
  const w = fixture();
  delete w.observation;
  const rec = withRun(newManualRecord("lc_n", w), "manual");
  assert.equal(latestRun(rec).result!.groupObservation, undefined);
  assert.match(reportSummary(rec, latestRun(rec).result!), /그룹 관측 설정이 없음/);
  // v0.5.2에서 저장된 기록(그룹 관측 필드 없음) 호환
  const old = migrateRecord(JSON.parse(JSON.stringify(rec)));
  assert.doesNotThrow(() => reportSummary(old, latestRun(old).result!));
});

test("[3] 선택한 단지의 식별 정보가 바뀌면 조용히 0건이 되지 않고 ‘현재 거래 없음’ 경고·같은 이름 후보 표시(자동 변경 안 함)", () => {
  const w = fixture();
  const before = JSON.stringify(w.observation);
  w.transactions.forEach((t) => { t.sggCd = "11110"; });
  const r = observeGroups(w);
  assert.equal(r.missingSelections.length, 2);
  assert.deepEqual(r.missingSelections.map((m) => [m.group, m.label.name, m.similar.length]), [["impact", "A", 1], ["control", "B", 1]]);
  assert.match(r.warnings.join(" "), /선택했던 단지 2개가 현재 거래 자료에 없습니다/);
  assert.doesNotMatch(r.warnings.join(" "), /좌표 미확인/, "없는 단지를 좌표 미확인으로 잘못 안내하지 않음");
  assert.equal(JSON.stringify(w.observation), before, "선택은 자동으로 바꾸지 않음");
  // 거래 삭제로 사라진 경우(같은 이름 후보 없음)
  const w2 = fixture();
  w2.transactions = w2.transactions.filter((t) => t.complexName !== "B");
  const r2 = observeGroups(w2);
  assert.equal(r2.missingSelections.length, 1);
  assert.equal(r2.missingSelections[0].similar.length, 0);
});

test("[4] 단위·기준일·출처 정보 제공, 상시 안내(notes)와 상황 경고(warnings) 분리", () => {
  const w = fixture();
  w.transactions.forEach((t) => { t.source = "가상 CSV"; });
  const r = observeGroups(w);
  assert.equal(r.basis.asOf, "2026-11-01");
  assert.match(r.basis.unit, /만원\/전용㎡/);
  assert.deepEqual(r.basis.sources, ["가상 CSV"]);
  assert.ok(r.notes.some((x) => /인과 효과가 아닙니다/.test(x)));
  assert.ok(!r.warnings.some((x) => /인과 효과가 아닙니다|5㎡ 구간|일 단위 계약만/.test(x)), "고정 안내는 경고 목록에 섞지 않음");
  assert.ok(r.warnings.some((x) => /가상 자료/.test(x)));
});

test("[5] 같은 사건의 다른 일정이 관찰기간에 있으면 경고(관찰기간 밖이면 경고 없음)", () => {
  const w = fixture();
  w.events[0].milestones.push({ key: "ms2", type: "constructionStart", status: "actual", date: "2025-09-01", evidenceKeys: [] } as any);
  assert.match(observeGroups(w).warnings.join(" "), /같은 사건의 다른 일정이 관찰기간에 있습니다\(착공 2025-09-01\)/);
  w.events[0].milestones[1].date = "2024-01-01";
  assert.doesNotMatch(observeGroups(w).warnings.join(" "), /같은 사건의 다른 일정/);
  w.observation!.months = 3;
  w.events[0].milestones[1].date = "2025-12-01";
  assert.doesNotMatch(observeGroups(w).warnings.join(" "), /같은 사건의 다른 일정/, "3개월 창 밖");
});

test("[호환] 그룹 키가 화면용 이름으로만 노출되도록 단지 라벨 생성", async () => {
  const { labelOfComplexKey } = await import("../../shared/observation.ts");
  const w = fixture();
  const k = complexKeyOf(w.transactions[0]);
  assert.equal(labelOfComplexKey(k, w.transactions).name, "A");
  assert.deepEqual(labelOfComplexKey("N:가람|11110|청운동|"), { name: "가람", detail: "시군구 11110 · 청운동" });
  assert.equal(labelOfComplexKey("S:123").name, "단지 ID 123");
});
