// 계산·분석 원칙 시험(가상 조건 — 실제 시장 예측값이 아님)
import { test } from "node:test";
import assert from "node:assert/strict";
import { compareIndices, computeStats, haversineM, runAnalysis } from "../../shared/analysis.ts";
import { addMonths, monthDiff, parseDateValue } from "../../shared/dates.ts";
import { deriveUnitPrices, m2ToPyeong, safeDivide, toKrw } from "../../shared/units.ts";
import { complexKeyOf, emptyWorking, type Transaction, type WorkingInputs } from "../../shared/model.ts";
import { demoWorking } from "../../shared/demo.ts";
import { reportChanges, reportDraft, reportQuestions, reportSummary } from "../../shared/report.ts";
import { newManualRecord } from "../../shared/model.ts";

const close = (a: number | null, b: number, eps = 1e-6) => assert.ok(a !== null && Math.abs(a - b) < eps, `${a} ≈ ${b}`);

test("지수 100→112 vs 100→108: 상승률 차이 4%p, 상대 종가지수 격차 약 3.7037037%", () => {
  const r = compareIndices(100, 112, 100, 108);
  close(r.diffPp, 4);
  close(r.relativeGapPct, 3.7037037, 1e-6);
});

test("전용 84㎡·8.4억원: 25.41전용평, ㎡당 1,000만원, 전용평당 약 3,305.7851만원", () => {
  const krw = toKrw(8.4, "KRW_100M")!;
  assert.equal(krw, 840_000_000);
  close(m2ToPyeong(84), 25.41, 1e-9);
  const u = deriveUnitPrices(krw, "household", 84, null);
  close(u.perM2Krw, 10_000_000);
  close(u.perPyeongKrw! / 1e4, 3305.7851, 1e-4);
});

test("사업 전체 가격은 세대 전용면적·세대수로 나누지 않음", () => {
  const u = deriveUnitPrices(100_000_000_000, "project", 84, null);
  assert.equal(u.perM2Krw, null);
});

test("연월 차이: 2030-11 → 2031-06 = 7개월, 24개월 지연 시 31개월. 월 정밀도 보존", () => {
  const a = parseDateValue("2030-11")!, b = parseDateValue("2031-06")!;
  assert.equal(monthDiff(a, b), 7);
  const d = addMonths(b, 24);
  assert.equal(d.raw, "2033-06");
  assert.equal(d.precision, "month");
  assert.equal(monthDiff(a, d), 31);
  assert.equal(parseDateValue("2025-02-30"), null);
});

test("분모 0·미입력은 계산 불가", () => {
  assert.equal(safeDivide(1, 0), null);
  assert.equal(safeDivide(1, undefined), null);
});

test("주소만으로 분석 시작: 전체 분석을 막지 않고 가격 판단만 보류", () => {
  const w = emptyWorking("서울특별시 어딘가 1", "2026-10-31");
  const r = runAnalysis(w);
  assert.equal(r.price.status, "held");
  assert.match(r.price.text, /검토가격 미입력/);
  assert.equal(r.market.comparables.length, 0);
  assert.ok(r.missing.some((m) => m.field === "property.exclusiveAreaM2"));
  assert.ok(!r.missing.some((m) => m.field.includes("household") || m.field.includes("comparisonType")));
});

test("세대당 검토가격 + 전용면적 없음: 가격 판단 보류(㎡당 환산 불가)", () => {
  const w = emptyWorking("주소", "2026-10-31");
  w.reviewPrice = { amount: 9, unit: "KRW_100M", basis: "household", dataMode: "user" };
  assert.equal(runAnalysis(w).price.reason, "전용면적 필요");
});

function tx(over: Partial<Transaction>): Transaction {
  return { key: Math.random().toString(36).slice(2), complexName: "A", exclusiveAreaM2: 84, priceKrw: 900_000_000, contractDate: "2026-09-10", cancelled: false, dataMode: "user", ...over };
}

test("비교거래가 모두 해제: 유효 표본 없음, 평균·중위 0원 표시 금지", () => {
  const w = emptyWorking("주소", "2026-10-31");
  w.property.exclusiveAreaM2 = 84;
  w.transactions = [tx({ cancelled: true }), tx({ cancelled: true })];
  const r = runAnalysis(w);
  assert.equal(r.market.pooled.count, 0);
  assert.equal(r.market.pooled.medianPerM2, null);
  assert.equal(r.market.pooled.meanPerM2, null);
  assert.equal(r.market.comparables.length, 0);
  assert.ok(r.flags.some((f) => f.text.includes("비교 가능한 단지 없음")));
});

test("직선거리 500m·경로 자료 없음: 보행시간을 만들지 않음", () => {
  const w = emptyWorking("주소", "2026-10-31");
  w.property.coordinates = { lat: 37.5, lng: 127.0, source: "시험" };
  const dLat = 500 / 111_195; // 약 500m
  w.events = [{ key: "e", category: "transport", name: "역", direction: "favorable", location: { lat: 37.5 + dLat, lng: 127.0 }, milestones: [], evidenceKeys: [], dataMode: "user" }];
  const r = runAnalysis(w);
  close(r.events[0].access.straightDistanceM, 500, 2);
  assert.equal(r.events[0].access.walkMinutes, null);
  assert.match(r.events[0].access.text, /보행시간 미산출/);
});

test("대표 비교단지 최대 5개, 비교하기 어려운 단지는 사유와 함께 제외(억지로 채우지 않음)", () => {
  const w = emptyWorking("주소", "2026-10-31");
  w.property = { address: "주소", exclusiveAreaM2: 84, buildYear: 2020, coordinates: { lat: 37.5, lng: 127, source: "시험" } };
  const names = ["A", "B", "C", "D", "E", "F", "G"];
  w.transactions = names.flatMap((n) => [1, 2, 3, 4].map((i) => tx({ complexName: n, contractDate: `2026-0${i + 4}-10`, buildYear: n === "G" ? 1990 : 2018 })));
  w.complexInfo = names.map((n, i) => ({ complexKey: complexKeyOf({ complexName: n }), distanceM: n === "F" ? 5000 : 200 + i * 100 }));
  w.transactions.push(tx({ complexName: "H", contractDate: "2026-09-01" })); // 표본 1건
  const r = runAnalysis(w);
  assert.equal(r.market.comparables.length, 5);
  const byName = new Map(r.market.complexes.map((c) => [c.name, c]));
  assert.equal(byName.get("F")!.status, "excluded");
  assert.match(byName.get("F")!.reasons.join(), /반경/);
  assert.equal(byName.get("G")!.status, "excluded");
  assert.match(byName.get("G")!.reasons.join(), /준공연도 차이/);
  assert.match(byName.get("H")!.reasons.join(), /표본 부족/);
  // 거리 3개만 남는 경우 5개를 채우지 않음
  w.complexInfo.forEach((c, i) => { if (i >= 3) c.distanceM = 9000; });
  assert.equal(runAnalysis(w).market.comparables.length, 3);
});

test("분석 기준일 이후 계약·발표 정보는 사용하지 않음", () => {
  const w = emptyWorking("주소", "2026-06-30");
  w.property.exclusiveAreaM2 = 84;
  w.transactions = [1, 2, 3].map(() => tx({ contractDate: "2026-09-10" }));
  w.events = [{ key: "e", category: "transport", name: "역", direction: "favorable", milestones: [{ key: "m", type: "opening", status: "planned", date: "2030-01", announcedOn: "2026-08-01", evidenceKeys: [] }], evidenceKeys: [], dataMode: "user" }];
  const r = runAnalysis(w);
  assert.equal(r.market.pooled.count, 0);
  assert.ok(r.market.txRows.every((x) => x.reasons.includes("분석 기준일 이후 계약")));
  // 사건이 기준일 이후에 처음 알려졌으므로 사건 전체를 분석에서 제외
  assert.equal(r.events.length, 0);
  assert.equal(r.excludedEvents[0].firstKnown, "2026-08-01");
});

test("예정일은 본건 분양·준공을 입력한 경우에만 비교", () => {
  const w = demoWorking();
  w.schedule = {};
  assert.equal(runAnalysis(w).events[0].scheduleGaps.length, 0);
  w.schedule = { completion: "2029-12" };
  const g = runAnalysis(w).events[0].scheduleGaps;
  assert.equal(g.length, 1);
  assert.equal(g[0].months, 18); // 2029-12 → 2031-06
});

test("관찰된 변화·인과효과 구분: 인과 추정은 항상 미추정, 적정가격 산출 없음", () => {
  const r = runAnalysis(demoWorking());
  assert.equal(r.causalEffect.status, "notEstimated");
  assert.match(r.price.text, /적정가격을 산정한 것이 아님/);
  assert.ok(r.flags.some((f) => f.text.includes("가상 자료")));
  assert.equal(r.events[0].prepricing?.quantification, "정량 분리 어려움");
});

test("통계: 중위·사분위", () => {
  const s = computeStats([1, 2, 3, 4].map((v) => ({ perM2: v, complex: "x" })));
  assert.equal(s.medianPerM2, 2.5);
  assert.equal(s.count, 4);
});

test("haversine 기본값", () => close(haversineM({ lat: 37, lng: 127 }, { lat: 37, lng: 127 }), 0));

test("보고서 4종: 기준일·단위·출처 표기, 금지 항목(LTV 등) 없음", () => {
  const w: WorkingInputs = demoWorking();
  const rec = newManualRecord("lc_test", w, "demo");
  const r = runAnalysis(w);
  rec.runs.push({ runNo: 1, at: "2026-10-31T00:00:00+09:00", trigger: "auto-create", inputHash: r.inputHash, result: r });
  const all = [reportSummary(rec, r), reportQuestions(rec, r), reportDraft(rec, r), reportChanges(rec, r)].join("\n");
  assert.match(all, /분석 기준일: 2026-10-31/);
  assert.match(all, /면적: 전용㎡/);
  assert.match(all, /출처/);
  assert.doesNotMatch(all, /LTV|담보인정|워터폴|상환가능|회수 가능/);
  assert.match(reportDraft(rec, r), /임\.$/m);
});
