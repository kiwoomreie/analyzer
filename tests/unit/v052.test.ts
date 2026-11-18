// v0.5.1 재검토(2026-11-18 16:41): 동조건 묶음의 해제 불확실성이 후속 수집에서 갱신되지 않던 문제 재현·회귀 시험
import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeTrades } from "../../shared/tradeMerge.ts";
import { runAnalysis } from "../../shared/analysis.ts";
import { emptyWorking, newManualRecord, type Transaction } from "../../shared/model.ts";
import { withRun } from "../../shared/runs.ts";
import { reportSummary } from "../../shared/report.ts";

let n = 0;
const tx = (o: Partial<Transaction> = {}): Transaction => ({ key: `u${++n}`, complexName: "서울단지", sggCd: "11110", dong: "청운동", exclusiveAreaM2: 84, floor: 5, priceKrw: 900_000_000, contractDate: "2026-09-10", cancelled: false, dataMode: "user", ...o });
const AT = "2026-11-18T16:50:00+09:00";
const base = { contractDate: "2026-09-10" };
/** 동조건 거래 g건(그중 c건 해제) + 별도 정상 거래 2건(층 9·11) */
const batch = (g: number, c: number) => [
  ...Array.from({ length: g }, (_, i) => tx({ ...base, cancelled: i < c })),
  tx({ ...base, floor: 9 }),
  tx({ ...base, floor: 11 }),
];
const analyze = (list: Transaction[]) => {
  const w = emptyWorking("주소", "2026-10-31");
  w.property = { address: "주소", exclusiveAreaM2: 84, coordinates: { lat: 37.5, lng: 127, source: "시험" } };
  w.options.minComplexTrades = 1;
  w.transactions = list;
  w.complexInfo = [{ complexKey: "N:서울단지|11110|청운동|", distanceM: 200 }];
  return { w, r: runAnalysis(w) };
};
const group = (list: Transaction[]) => list.filter((t) => t.floor === 5);
const rangeFlag = (r: ReturnType<typeof runAnalysis>) => r.flags.find((f) => /유효 표본 \d+~\d+건/.test(f.text));

/** 2건 수집 → 1건 사용자 제외 → 1건 해제(특정 불가) */
function ambiguousStart() {
  const a = mergeTrades([], batch(2, 0), AT, "api");
  group(a.transactions)[0].manualExclusion = "특수 거래";
  const b = mergeTrades(a.transactions, batch(2, 1), AT, "api");
  return b.transactions;
}

test("[재현] 1건 해제 시 2~3건 → 다음 수집에서 2건 모두 해제되면 2건으로 확정, 오래된 불확실성 표시 제거", async () => {
  const s1 = ambiguousStart();
  assert.deepEqual(analyze(s1).r.market.sampleRange, { certain: 2, min: 2, max: 3, uncertainGroups: 1 });

  const s2 = mergeTrades(s1, batch(2, 2), AT, "api").transactions;
  const g = group(s2);
  assert.equal(g.length, 2, "거래 기록 보존(삭제 없음)");
  assert.ok(g.every((t) => t.cancelled));
  assert.ok(g.every((t) => !t.cancelAmbiguity), "해소된 불확실성 표시 제거");
  assert.ok(g.some((t) => (t.revisions ?? []).some((rv) => /특정 불가 해소/.test(rv.change))), "해소 이력 기록");
  assert.equal(g.find((t) => t.manualExclusion)!.manualExclusion, "특수 거래", "사용자 제외 보존");
  // 이전 이력 보존
  assert.ok(g.some((t) => (t.revisions ?? []).some((rv) => /어느 거래인지 특정 불가/.test(rv.change))));

  const { w, r } = analyze(s2);
  assert.deepEqual(r.market.sampleRange, { certain: 2, min: 2, max: 2, uncertainGroups: 0 });
  assert.equal(rangeFlag(r), undefined);
  const rec = withRun(newManualRecord("lc_x", w), "manual");
  assert.doesNotMatch(reportSummary(rec, rec.runs[0].result), /유효 표본 \d+~\d+건/);
});

test("[반복 수집] 같은 자료를 여러 번 다시 받아도 불확실성·건수 그대로, 거래 추가 없음", () => {
  let s = ambiguousStart();
  for (let i = 0; i < 3; i++) {
    const m = mergeTrades(s, batch(2, 1), AT, "api");
    assert.equal(m.report.added, 0);
    assert.equal(m.report.cancellationsApplied, 0);
    s = m.transactions;
  }
  assert.ok(group(s).every((t) => t.cancelAmbiguity?.size === 2 && t.cancelAmbiguity.cancelled === 1));
  assert.deepEqual(analyze(s).r.market.sampleRange, { certain: 2, min: 2, max: 3, uncertainGroups: 1 });
});

test("[묶음 증가] 2→3건으로 늘면 새 거래도 불확실 묶음에 포함 — 근거 없이 확정 표본으로 분류하지 않음", () => {
  const s = mergeTrades(ambiguousStart(), batch(3, 1), AT, "api").transactions;
  const g = group(s);
  assert.equal(g.length, 3);
  assert.ok(g.every((t) => t.cancelAmbiguity?.size === 3 && t.cancelAmbiguity.cancelled === 1), JSON.stringify(g.map((t) => t.cancelAmbiguity)));
  const { r } = analyze(s);
  // S=3, 해제 1, 제외 1 → 묶음 유효 1~2건 + 별도 정상 2건
  assert.deepEqual(r.market.sampleRange, { certain: 2, min: 3, max: 4, uncertainGroups: 1 });
  for (const t of g) assert.ok(!r.market.txRows.find((x) => x.key === t.key)!.included, "묶음 거래(새 합류 포함)가 확정 표본에 들어가면 안 됨");
  const newcomer = g.find((t) => (t.revisions ?? []).length === 1);
  assert.ok(newcomer && /묶음에 포함/.test(newcomer.revisions![0].change), "새 합류 거래에 불확실 묶음 포함 이력");
});

test("[묶음 증가 + 해제 증가] 3건 중 해제 2건 → 범위 갱신, 이후 3건 모두 해제 → 확정", () => {
  let s = mergeTrades(ambiguousStart(), batch(3, 2), AT, "api").transactions;
  assert.ok(group(s).every((t) => t.cancelAmbiguity?.size === 3 && t.cancelAmbiguity.cancelled === 2));
  // S=3, k=2, U=1 → 묶음 0~1건
  assert.deepEqual(analyze(s).r.market.sampleRange, { certain: 2, min: 2, max: 3, uncertainGroups: 1 });
  s = mergeTrades(s, batch(3, 3), AT, "api").transactions;
  assert.ok(group(s).every((t) => t.cancelled && !t.cancelAmbiguity));
  assert.deepEqual(analyze(s).r.market.sampleRange, { certain: 2, min: 2, max: 2, uncertainGroups: 0 });
});

test("[묶음 증가 후 즉시 전량 해제] 2→3건이 한 번에 모두 해제로 들어오면 불확실성 없음", () => {
  const s = mergeTrades(ambiguousStart(), batch(3, 3), AT, "api").transactions;
  assert.equal(group(s).length, 3);
  assert.ok(group(s).every((t) => t.cancelled && !t.cancelAmbiguity));
  assert.equal(rangeFlag(analyze(s).r), undefined);
});

test("[사용자 제외 조합] 불확실 묶음에서 제외 해제 → 건수 확정(3건), 다시 제외 → 범위, 전량 해제 → 2건", () => {
  let s = ambiguousStart();
  group(s).forEach((t) => { delete t.manualExclusion; });
  assert.deepEqual(analyze(s).r.market.sampleRange, { certain: 3, min: 3, max: 3, uncertainGroups: 0 });
  group(s)[1].manualExclusion = "다른 사유";
  assert.deepEqual(analyze(s).r.market.sampleRange, { certain: 2, min: 2, max: 3, uncertainGroups: 1 });
  group(s).forEach((t) => { t.manualExclusion = "둘 다 제외"; });
  assert.deepEqual(analyze(s).r.market.sampleRange, { certain: 2, min: 2, max: 2, uncertainGroups: 0 }, "전부 제외면 불확실성 없음");
  group(s).forEach((t) => { delete t.manualExclusion; });
  group(s)[0].manualExclusion = "특수 거래";
  s = mergeTrades(s, batch(2, 2), AT, "api").transactions;
  assert.deepEqual(analyze(s).r.market.sampleRange, { certain: 2, min: 2, max: 2, uncertainGroups: 0 });
});

test("[부분 자료] 불확실 묶음이 이번 자료에 1건만 들어와도 기존 거래·불확실성 유지", () => {
  const s = mergeTrades(ambiguousStart(), [tx({ ...base, cancelled: true }), tx({ ...base, floor: 9 }), tx({ ...base, floor: 11 })], AT, "api").transactions;
  assert.equal(group(s).length, 2);
  assert.ok(group(s).every((t) => t.cancelAmbiguity?.size === 2 && t.cancelAmbiguity.cancelled === 1));
  assert.deepEqual(analyze(s).r.market.sampleRange, { certain: 2, min: 2, max: 3, uncertainGroups: 1 });
});

test("[기존 저장 호환] v0.5.1에서 저장된 오래된 표시(전량 해제인데 {2,1} 잔존)도 분석은 현재 상태로 계산, 저장 원본은 건드리지 않음", () => {
  const s = ambiguousStart();
  group(s).forEach((t) => { t.cancelled = true; }); // v0.5.1 병합 결과 재현: 표시는 {size:2,cancelled:1} 그대로
  const snapshot = JSON.stringify(s);
  const { r } = analyze(s);
  assert.deepEqual(r.market.sampleRange, { certain: 2, min: 2, max: 2, uncertainGroups: 0 });
  assert.equal(JSON.stringify(s), snapshot, "분석은 입력을 바꾸지 않음");
  // 다음 병합 때 정리
  const m = mergeTrades(s, batch(2, 2), AT, "api").transactions;
  assert.ok(group(m).every((t) => !t.cancelAmbiguity));
});

test("[기존 저장 호환] v0.5.1에서 묶음이 커져 새 거래에 표시가 빠진 기록도 분석은 묶음 전체를 불확실로 처리", () => {
  const s = ambiguousStart();
  const extra = { ...group(s).find((t) => !t.manualExclusion)!, key: "legacy-new", cancelled: false, cancelAmbiguity: undefined, revisions: [] };
  const list = [...s, extra];
  const { r } = analyze(list);
  assert.deepEqual(r.market.sampleRange, { certain: 2, min: 3, max: 4, uncertainGroups: 1 });
  assert.ok(!r.market.txRows.find((x) => x.key === "legacy-new")!.included);
});
