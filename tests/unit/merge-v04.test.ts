// v0.3 독립 검토(2026-11-18) 지적 사항 재현·회귀 시험 — 거래 병합
import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeTrades } from "../../shared/tradeMerge.ts";
import { runAnalysis } from "../../shared/analysis.ts";
import { emptyWorking, type Transaction } from "../../shared/model.ts";

let n = 0;
const tx = (o: Partial<Transaction> = {}): Transaction => ({ key: `t${++n}`, complexName: "A", exclusiveAreaM2: 84, floor: 5, priceKrw: 900_000_000, contractDate: "2026-09-10", cancelled: false, dataMode: "user", ...o });
const p95 = { priceKrw: 950_000_000 };
const prices = (l: Transaction[]) => l.map((t) => t.priceKrw / 1e8).sort();
const merge = (ex: Transaction[], inc: Transaction[]) => mergeTrades(ex, inc, "2026-11-18T10:00:00+09:00", "시험");

test("[재현1] 같은 조건 9억·9.5억을 별도 CSV로 가져오면 둘 다 보존, 자동 정정하지 않고 ‘확인 필요’", () => {
  const a = merge([], [tx()]);
  const b = merge(a.transactions, [tx(p95)]);
  assert.deepEqual(prices(b.transactions), [9, 9.5]);
  assert.equal(b.report.corrected, 0);
  assert.equal(b.report.possibleCorrections, 1);
  assert.ok(b.transactions.every((t) => t.reviewFlag?.kind === "possibleCorrection"));
});

test("[재현2] 동일 조건 2건 [취소, 정상] → 순서만 바꾼 [정상, 취소] 재수집: 취소 1건 유지", () => {
  const a = merge([], [tx({ cancelled: true }), tx()]);
  const b = merge(a.transactions, [tx(), tx({ cancelled: true })]);
  assert.equal(b.transactions.length, 2);
  assert.equal(b.transactions.filter((t) => t.cancelled).length, 1);
  assert.equal(b.report.cancellationsApplied, 0);
  assert.equal(b.report.duplicates, 2);
});

test("입력 순서를 식별자로 쓰지 않음: 어떤 순서로 몇 번 수집해도 결과 동일", () => {
  const batch = [tx({ cancelled: true }), tx(), tx(), tx({ floor: 9 }), tx(p95)];
  const orders = [[0, 1, 2, 3, 4], [4, 3, 2, 1, 0], [2, 0, 4, 1, 3]];
  let cur = merge([], batch).transactions;
  for (let rep = 0; rep < 3; rep++) for (const o of orders) cur = merge(cur, o.map((i) => ({ ...batch[i], key: `r${++n}` }))).transactions;
  assert.equal(cur.length, 5);
  assert.equal(cur.filter((t) => t.cancelled).length, 1);
  assert.ok(!cur.some((t) => t.reviewFlag)); // 한 자료 안에서 함께 온 9억·9.5억은 서로 다른 거래로 확인됨
});

test("한 자료 안의 같은 조건·다른 가격(다른 호실)은 별도 거래로 유지, 확인 필요 표시 없음", () => {
  const r = merge([], [tx(), tx(p95)]);
  assert.equal(r.transactions.length, 2);
  assert.equal(r.report.possibleCorrections, 0);
});

test("전체 자료 후 일부 자료: 일부 자료에 없는 거래는 지우지 않고, 동조건 묶음이 줄어도 기존 유지", () => {
  const full = merge([], [tx(), tx(), tx(p95), tx({ floor: 9 })]);
  const part = merge(full.transactions, [tx(p95), tx()]);
  assert.equal(part.transactions.length, 4);
  assert.equal(part.report.added, 0);
  assert.equal(part.report.possibleCorrections, 0); // 9억 묶음이 같은 자료에 함께 있으므로 9.5억은 별도 거래
  assert.equal(part.report.partialGroups, 1); // 9억 2건 묶음에 1건만 들어옴
});

test("실제 정정 사례(원천 식별자 있음)는 정정으로 처리, 식별자 없으면 정정 건수를 주장하지 않음", () => {
  const a = merge([], [tx({ officialId: "R1" })]);
  const b = merge(a.transactions, [tx({ officialId: "R1", ...p95 })]);
  assert.equal(b.report.corrected, 1);
  assert.deepEqual(prices(b.transactions), [9.5]);
  const c = merge([], [tx()]);
  const d = merge(c.transactions, [tx(p95)]); // 정정 후 전체 재조회일 수도, 다른 호실 일부 자료일 수도 있음
  assert.equal(d.report.corrected, 0);
  assert.equal(d.report.possibleCorrections, 1);
  assert.equal(d.transactions.length, 2);
});

test("동조건 3건 중 재수집에서 1건 취소: 취소 1건 반영하되 ‘어느 거래인지 특정 불가’ 표시", () => {
  const a = merge([], [tx(), tx(), tx()]);
  const b = merge(a.transactions, [tx(), tx({ cancelled: true }), tx()]);
  assert.equal(b.transactions.filter((t) => t.cancelled).length, 1);
  assert.equal(b.report.cancellationsApplied, 1);
  assert.equal(b.report.cancelUnspecified, 1);
  assert.ok(b.report.notes.some((x) => x.includes("특정 불가")));
});

test("취소·정정·신규·중복 혼합", () => {
  const a = merge([], [tx(), tx({ floor: 9 }), tx({ floor: 12 })]);
  const b = merge(a.transactions, [tx({ cancelled: true }), tx({ floor: 9, priceKrw: 910_000_000 }), tx({ floor: 12 }), tx({ floor: 15 })]);
  assert.equal(b.report.cancellationsApplied, 1);
  assert.equal(b.report.possibleCorrections, 1);
  assert.equal(b.report.duplicates, 1); // 해제 반영 1 + 신규 2 + 중복 1 = 받은 4건
  assert.equal(b.report.added, 2);
  assert.equal(b.report.received, b.report.duplicates + b.report.added + b.report.cancellationsApplied);
  assert.equal(b.transactions.length, 5);
});

test("분석: 정정 여부 확인 필요 거래가 있으면 표본 수 확정 아님을 불확실성으로 표시", () => {
  const w = emptyWorking("주소", "2026-10-31");
  w.property = { address: "주소", exclusiveAreaM2: 84, coordinates: { lat: 37.5, lng: 127, source: "시험" } };
  const a = merge([], [tx(), tx({ contractDate: "2026-08-01" }), tx({ contractDate: "2026-07-01" })]);
  w.transactions = merge(a.transactions, [tx(p95)]).transactions;
  w.complexInfo = [{ complexKey: "N:A|||", distanceM: 200 }];
  const r = runAnalysis(w);
  assert.ok(r.flags.some((f) => f.text.includes("정정 여부 확인 필요")));
});

test("v0.3에서 가격 차이로 자동 정정된 기록은 이력을 보존하고 확인 필요로 표시", () => {
  const w = emptyWorking("주소", "2026-10-31");
  w.property.exclusiveAreaM2 = 84;
  w.transactions = [tx({ idBasis: "composite", revisions: [{ at: "x", source: "v0.3", change: "정정: 거래금액 90,000만원 → 95,000만원" }] })];
  const r = runAnalysis(w);
  assert.ok(r.flags.some((f) => f.text.includes("v0.3")));
});

test("v0.3에서 저장한 기록 보존: 옛 순번 식별 키·옛 수집 보고를 변환하고, 같은 자료 재수집 시 늘지 않음·과거 결과 유지", async () => {
  const { migrateRecord, newManualRecord } = await import("../../shared/model.ts");
  const { withRun, latestRun } = await import("../../shared/runs.ts");
  const { reportSummary } = await import("../../shared/report.ts");
  const w = emptyWorking("주소", "2026-10-31");
  w.property.exclusiveAreaM2 = 84;
  w.transactions = [tx({ idKey: "C:x#1", idBasis: "composite" }), tx({ idKey: "C:x#2", idBasis: "composite", cancelled: true })];
  (w as any).collections = [{ at: "2026-11-18T09:00:00+09:00", status: "complete", regions: [], regionNote: "반경 1,500m 안 17개 지점 기준 시군구 1곳", months: [], complexGeocode: { attempted: 0, located: 0, failed: 0 }, notes: [] }];
  let rec = withRun(newManualRecord("lc_v03", w, "manual"), "manual");
  const savedResult = JSON.stringify(rec.runs[0].result);
  rec = migrateRecord(JSON.parse(JSON.stringify(rec)));
  assert.equal(JSON.stringify(rec.runs[0].result), savedResult, "과거 결과 그대로");
  assert.equal((rec.working.collections![0] as any).trades.status, "complete");
  const again = mergeTrades(rec.working.transactions, [tx(), tx({ cancelled: true })], "t", "재수집");
  assert.equal(again.transactions.length, 2);
  assert.equal(again.transactions.filter((t) => t.cancelled).length, 1);
  assert.match(reportSummary(rec, latestRun(rec).result!), /요약/);
});
