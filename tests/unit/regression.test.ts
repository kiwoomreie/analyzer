// 2026-11-18 검토 의견 결함별 재현·회귀 시험
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runAnalysis, evidenceLevel } from "../../shared/analysis.ts";
import { applyLookup, applyTrades } from "../../shared/applyData.ts";
import { mergeTrades } from "../../shared/tradeMerge.ts";
import { transactionsFromCsv } from "../../shared/importers.ts";
import { complexKeyOf, emptyWorking, migrateRecord, newManualRecord, type CollectionReport, type Evidence, type Transaction, type WorkingInputs } from "../../shared/model.ts";
import { demoWorking } from "../../shared/demo.ts";
import { reportSummary } from "../../shared/report.ts";
import { withRun, latestRun } from "../../web/nav.ts";

const CSV = readFileSync("examples/sample-data/demo-nearby-trades.csv", "utf8");
const AT = "2026-11-18T09:00:00+09:00";
const report = (o: Partial<CollectionReport> = {}): CollectionReport => ({
  at: AT, status: "complete", trades: { status: "complete", monthsOk: 1, monthsTotal: 1, capped: false, note: "" },
  regionDiscovery: { status: "sampled", sampled: 17, failedPoints: 0, regionsFound: 1, regionsUsed: 1, capped: false, note: "" },
  complexGeocode: { status: "complete", total: 1, attempted: 1, located: 1, failed: 0, capped: false },
  regions: [], regionNote: "", months: [], notes: [], ...o,
});
let seq = 0;
const tx = (o: Partial<Transaction>): Transaction => ({ key: `t${++seq}`, complexName: "A", exclusiveAreaM2: 84, floor: 5, priceKrw: 900_000_000, contractDate: "2026-09-10", cancelled: false, dataMode: "official-api", ...o });

function located(): WorkingInputs {
  const w = emptyWorking("주소", "2026-10-31");
  w.property = { address: "주소", exclusiveAreaM2: 84, buildYear: 2020, coordinates: { lat: 37.5, lng: 127, source: "시험" } };
  return w;
}

// ── 1. 실거래 중복·정정·해제
test("[1] 같은 CSV를 두 번 가져와도 중복 집계되지 않음(신규 0·중복 전량)", () => {
  const w = located();
  const a = applyTrades(w, transactionsFromCsv(CSV).items, AT, "csv");
  const n = w.transactions.length;
  const b = applyTrades(w, transactionsFromCsv(CSV).items, AT, "csv");
  assert.equal(a.added, n);
  assert.equal(b.added, 0);
  assert.equal(b.duplicates, n);
  assert.equal(w.transactions.length, n);
});

test("[1] 한 자료 안의 완전히 같은 조건 거래 2건은 합치지 않고, 재조회해도 2건 유지", () => {
  const w = located();
  const batch = () => [tx({ key: "x1" }), tx({ key: "x2" })];
  const r1 = applyTrades(w, batch(), AT, "api");
  assert.equal(w.transactions.length, 2);
  assert.equal(r1.sameKeyGroups, 1);
  applyTrades(w, batch(), AT, "api");
  assert.equal(w.transactions.length, 2);
});

test("[1] 해제(취소)는 원거래와 대사해 표시만 바꾸고 건수는 늘리지 않음", () => {
  const w = located();
  applyTrades(w, [tx({}), tx({ floor: 9 })], AT, "api");
  const r = applyTrades(w, [tx({ cancelled: true, cancelDate: "26.10.01" }), tx({ floor: 9 })], AT, "api");
  assert.equal(r.cancellationsApplied, 1);
  assert.equal(r.duplicates, 1);
  assert.equal(w.transactions.length, 2);
  assert.equal(w.transactions.filter((t) => t.cancelled).length, 1);
  assert.match(w.transactions.find((t) => t.cancelled)!.revisions![0].change, /해제/);
});

test("[1→v0.4] 금액만 다른 거래는 자동 정정하지 않음(둘 다 보존, 확인 필요)", () => {
  const w = located();
  applyTrades(w, [tx({ priceKrw: 900_000_000 })], AT, "api");
  const r = applyTrades(w, [tx({ priceKrw: 910_000_000 })], AT, "api");
  assert.equal(r.corrected, 0);
  assert.equal(r.possibleCorrections, 1);
  assert.equal(w.transactions.length, 2);
});

test("[1] 원천 거래 식별자가 있으면 우선 사용(값이 바뀌면 정정), 사용자 제외 사유는 보존", () => {
  const w = located();
  applyTrades(w, [tx({ officialId: "R-1", idScope: "원천A", floor: 3 })], AT, "csv");
  w.transactions[0].manualExclusion = "특수 거래";
  const r = applyTrades(w, [tx({ officialId: "R-1", idScope: "원천A", floor: 3, priceKrw: 950_000_000 }), tx({ officialId: "R-2", idScope: "원천A", floor: 3 })], AT, "csv");
  assert.equal(r.corrected, 1);
  assert.equal(r.added, 1);
  assert.equal(w.transactions[0].manualExclusion, "특수 거래");
});

test("[1] 공공 API 수집 결과가 부분 실패면 ‘누락 가능’ 불확실성 표시", () => {
  const w = located();
  applyLookup(w, { geocode: null, trades: [tx({})], complexes: [], report: report({ status: "partial", trades: { status: "partial", monthsOk: 0, monthsTotal: 1, capped: false, note: "" }, months: [{ lawdCode: "11110", yearMonth: "202609", totalCount: 1200, collected: 1000, pagesExpected: 2, pagesFetched: 1, ok: false, error: "2쪽 호출 실패" }] }) }, AT);
  const r = runAnalysis(w);
  assert.ok(r.flags.some((f) => f.level === "high" && f.text.includes("미완료")));
  assert.equal(r.collection?.status, "partial");
});

test("[1] 자동 조회는 본건 좌표·단지 정보를 덮어쓰지 않음", () => {
  const w = located();
  w.complexInfo.push({ complexKey: complexKeyOf({ complexName: "A" }), location: { lat: 37.51, lng: 127.01 }, locationSource: "사용자" });
  applyLookup(w, { geocode: { lat: 1, lng: 1, source: "api" }, trades: [], complexes: [{ complexKey: complexKeyOf({ complexName: "A" }), location: { lat: 30, lng: 120 }, locationSource: "api", address: "x" }], report: report() }, AT);
  assert.equal(w.property.coordinates!.lat, 37.5);
  assert.equal(w.complexInfo[0].location!.lat, 37.51);
});

// ── 2. 삭제와 결과 일관성
test("[2] 결과는 실행 당시 입력 스냅샷 기준 — 거래 전체 삭제 후에도 이전 결과·보고서가 깨지지 않고 ‘재분석 필요’", () => {
  const w = demoWorking();
  let rec = withRun(newManualRecord("lc_t", w, "demo"), "auto-create");
  const before = latestRun(rec).result!.market.pooled.count;
  rec = { ...rec, working: { ...rec.working, transactions: [] } };
  const lr = latestRun(rec);
  assert.equal(lr.stale, true);
  assert.equal(lr.result!.market.pooled.count, before);
  assert.ok(lr.input.transactions.length > 0);
  const md = reportSummary(rec, lr.result!);
  assert.match(md, /대표 비교단지/);
  rec = withRun(rec, "manual");
  assert.equal(latestRun(rec).stale, false);
  assert.equal(latestRun(rec).result!.market.pooled.count, 0);
  assert.equal(rec.runs[0].input, undefined); // 이전 실행 스냅샷은 보관하지 않음(용량)
});

// ── 3. 비교단지와 거리
test("[3] 거리 미확인 단지는 ‘확인 필요 후보’로 분리하고 대표 통계에 섞지 않음", () => {
  const w = located();
  w.transactions = [1, 2, 3, 4].flatMap((i) => [tx({ complexName: "근처", contractDate: `2026-0${i + 4}-10` }), tx({ complexName: "위치모름", contractDate: `2026-0${i + 4}-10`, priceKrw: 2_000_000_000 })]);
  w.complexInfo = [{ complexKey: complexKeyOf({ complexName: "근처" }), location: { lat: 37.501, lng: 127 }, locationSource: "시험" }];
  const r = runAnalysis(w);
  assert.deepEqual(r.market.comparables.map((c) => c.name), ["근처"]);
  assert.deepEqual(r.market.needsCheck.map((c) => c.name), ["위치모름"]);
  assert.equal(r.market.pooled.count, 4);
  assert.ok(r.market.pooled.maxPerM2! < 2_000_000_000 / 84);
});

test("[3] 본건 좌표가 없으면 사용자 입력 거리 단지만 선정, 반경 밖 단지는 ‘포함’ 지정해도 제외", () => {
  const w = emptyWorking("주소", "2026-10-31");
  w.property.exclusiveAreaM2 = 84;
  w.transactions = [1, 2, 3].flatMap((i) => [tx({ complexName: "B", contractDate: `2026-0${i + 5}-10` }), tx({ complexName: "C", contractDate: `2026-0${i + 5}-10` }), tx({ complexName: "D", contractDate: `2026-0${i + 5}-10` })]);
  w.complexInfo = [
    { complexKey: complexKeyOf({ complexName: "B" }), distanceM: 700, distanceSource: "사용자 입력 거리" },
    { complexKey: complexKeyOf({ complexName: "C" }), distanceM: 9000, userDecision: "include" },
  ];
  const r = runAnalysis(w);
  assert.deepEqual(r.market.comparables.map((c) => c.name), ["B"]);
  assert.equal(r.market.complexes.find((c) => c.name === "C")!.status, "excluded");
  assert.equal(r.market.complexes.find((c) => c.name === "D")!.status, "needsCheck");
  assert.ok(r.flags.some((f) => f.text.includes("본건 좌표 없음")));
});

test("[3] 동명 단지는 시군구·법정동·지번(또는 단지코드)으로 구분하고 표시", () => {
  const w = located();
  w.transactions = [1, 2, 3].flatMap((i) => [tx({ complexName: "푸른마을", dong: "가동", jibun: "1", contractDate: `2026-0${i + 5}-10` }), tx({ complexName: "푸른마을", dong: "나동", jibun: "9", contractDate: `2026-0${i + 5}-10` })]);
  const r = runAnalysis(w);
  assert.equal(r.market.complexes.length, 2);
  assert.ok(r.market.complexes.every((c) => c.sameNameCount === 2 && /법정동/.test(c.identityBasis)));
  const w2 = located();
  w2.transactions = [tx({ complexName: "X", complexId: "11110-1" }), tx({ complexName: "X", complexId: "11110-2" })];
  assert.equal(runAnalysis(w2).market.complexes.length, 2);
});

test("[3] 이전 버전 저장분의 단지 키를 새 형식으로 변환(기존 입력 보존)", () => {
  const rec = newManualRecord("lc_old", located(), "manual");
  rec.working.complexInfo = [{ complexKey: "옛단지|가동", distanceM: 300 }];
  migrateRecord(rec);
  assert.equal(rec.working.complexInfo[0].complexKey, complexKeyOf({ complexName: "옛단지", dong: "가동" }));
  assert.equal(rec.working.complexInfo[0].distanceM, 300);
});

// ── 4. 입지 근거
test("[4] 사용자가 ‘사실로 기록’만 한 근거는 공식 원문 대조로 표시하지 않음", () => {
  const base: Evidence = { key: "e", publisher: "기관", title: "문서", fact: "사실", status: "confirmed", linked: [], dataMode: "user" };
  assert.equal(evidenceLevel(base), "userInput");
  assert.equal(evidenceLevel({ ...base, publishedOn: "2025-01-01" }), "sourceCited");
  assert.equal(evidenceLevel({ ...base, publishedOn: "2025-01-01", sourceType: "official", sourceRef: "고시 1호", pageOrSection: "3쪽" }), "sourceCited");
  assert.equal(evidenceLevel({ ...base, publishedOn: "2025-01-01", sourceType: "official", sourceRef: "고시 1호", pageOrSection: "3쪽", originalReviewed: true }), "originalChecked");
  const r = runAnalysis(demoWorking());
  const all = JSON.stringify(r.summary);
  assert.doesNotMatch(all, /공식 확인 \d/);
  assert.match(r.events[0].evidence.text, /사용자 기록/);
});

test("[4] 기준일 이후 처음 알려진 사건·근거는 제외, 기준일 이전 취소된 공급은 물량에서 제외", () => {
  const w = demoWorking();
  w.asOf = "2026-06-30"; // 하늘마을 3블록은 2026-08 처음 알려짐
  const r = runAnalysis(w);
  assert.ok(r.excludedEvents.some((e) => e.name.includes("하늘마을")));
  assert.ok(!r.supply.rows.some((s) => s.name.includes("하늘마을")));
  const rail = r.events.find((e) => e.key === "ev_rail")!;
  assert.equal(rail.evidence.afterAsOf, 0);
  const w2 = demoWorking();
  w2.events.find((e) => e.key === "ev_sup2")!.milestones.push({ key: "c", type: "cancellation", status: "actual", date: "2026-09", announcedOn: "2026-09-15", evidenceKeys: [] });
  const r2 = runAnalysis(w2);
  const b2 = r2.supply.rows.find((s) => s.name.includes("B2"))!;
  assert.equal(b2.cancelledAsOf, true);
  assert.equal(b2.timing, "no");
  w2.asOf = "2026-09-01"; // 취소가 기준일 이후에 알려짐 → 당시에는 유효한 공급
  const r3 = runAnalysis(w2);
  assert.equal(r3.supply.rows.find((s) => s.name.includes("B2"))!.cancelledAsOf, false);
});

test("[4] 입지 사건은 사용자 입력으로 표시(자동 수집 기능 없음)", () => {
  const r = runAnalysis(located() && (() => { const w = located(); w.events = [{ key: "e", category: "transport", name: "역", direction: "favorable", milestones: [], evidenceKeys: [], dataMode: "user" }]; return w; })());
  assert.ok(r.flags.some((f) => f.text.includes("자동 수집 기능 없음")));
});
