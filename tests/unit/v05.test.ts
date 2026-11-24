// v0.4 재검토(2026-11-18 오후) 지적 사항 재현·회귀 시험
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mergeTrades } from "../../shared/tradeMerge.ts";
import { runAnalysis } from "../../shared/analysis.ts";
import { emptyWorking, newManualRecord, type Transaction } from "../../shared/model.ts";
import { withRun } from "../../shared/runs.ts";

// ── 1. 저장소 손상
class FakeStorage {
  m = new Map<string, string>();
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string) { this.m.set(k, v); }
  removeItem(k: string) { this.m.delete(k); }
}
const KEY = "location-analyzer.saved.v1";
let ls: FakeStorage;
beforeEach(() => { ls = new FakeStorage(); (globalThis as any).window = { localStorage: ls, sessionStorage: new FakeStorage() }; });
const store = async () => (await import("../../web/store.ts")).localStore;
const good = (k: string) => withRun(newManualRecord(k, emptyWorking(`주소 ${k}`, "2026-10-31")), "manual");

test("[1-재현] 저장소 원문이 손상(JSON 아님)되면 새 저장으로 덮어쓰지 않고 쓰기 차단, 원문 내보내기 가능", async () => {
  const s = await store();
  ls.setItem(KEY, '{"lc_a": {"format": "location-analyzer-analysis", BROKEN');
  const before = ls.getItem(KEY);
  const err = s.put(good("lc_new"));
  assert.ok(err && /쓰기 차단/.test(err), String(err));
  assert.equal(ls.getItem(KEY), before, "원문 그대로");
  assert.equal(s.health().state, "unreadable");
  assert.equal(s.exportRaw(), before);
});

test("[1-재현] 정상 기록과 손상 기록이 섞여도 정상 기록은 열리고, 새 저장 시 손상 기록 원문을 그대로 보존", async () => {
  const s = await store();
  const ok = good("lc_ok");
  ls.setItem(KEY, JSON.stringify({ lc_ok: ok, lc_bad: { format: "location-analyzer-analysis", key: "lc_bad", working: "망가짐" }, lc_bad2: 42 }));
  assert.equal(s.list().length, 1);
  assert.equal(s.health().state, "partial");
  assert.deepEqual(s.health().badKeys.sort(), ["lc_bad", "lc_bad2"]);
  assert.equal(s.put(good("lc_new")), null);
  const raw = JSON.parse(ls.getItem(KEY)!);
  assert.deepEqual(raw.lc_bad, { format: "location-analyzer-analysis", key: "lc_bad", working: "망가짐" });
  assert.equal(raw.lc_bad2, 42);
  assert.ok(raw.lc_ok && raw.lc_new);
});

test("[1] 손상 원문 보관 후 새로 시작은 사용자 실행으로만, 원문은 보관 키에 남김", async () => {
  const s = await store();
  ls.setItem(KEY, "not json");
  const r = s.quarantineAndReset();
  assert.equal(r.error, null);
  assert.equal(ls.getItem(r.quarantineKey!), "not json");
  assert.equal(s.health().state, "ok");
  assert.equal(s.put(good("lc_after")), null);
});

// ── 2. 거래 ID
let n = 0;
const tx = (o: Partial<Transaction> = {}): Transaction => ({ key: `t${++n}`, complexName: "서울단지", sggCd: "11110", dong: "청운동", exclusiveAreaM2: 84, floor: 5, priceKrw: 900_000_000, contractDate: "2026-09-10", knownOn: "2026-09-11", cancelled: false, dataMode: "user", ...o });
const AT = "2026-11-18T14:00:00+09:00";

test("[2-재현] 빈 목록에 같은 ID가 한 배치에 두 번: 1건만 보존, 이후 취소 시 유령 정상 거래 없음", () => {
  const a = mergeTrades([], [tx({ officialId: "1", idScope: "A" }), tx({ officialId: "1", idScope: "A" })], AT, "A");
  assert.equal(a.transactions.length, 1);
  assert.equal(a.report.idDuplicatesInBatch, 1);
  const b = mergeTrades(a.transactions, [tx({ officialId: "1", idScope: "A", cancelled: true })], AT, "A");
  assert.equal(b.transactions.filter((t) => !t.cancelled).length, 0);
});

test("[2] 같은 배치의 같은 ID인데 내용이 다르면 둘 다 보존하고 ID 충돌 확인 필요", () => {
  const a = mergeTrades([], [tx({ officialId: "1", idScope: "A" }), tx({ officialId: "1", idScope: "A", priceKrw: 950_000_000 })], AT, "A");
  assert.equal(a.transactions.length, 2);
  assert.ok(a.transactions.every((t) => t.reviewFlag?.kind === "idConflict"));
});

test("[2-재현] 출처 A 서울 9억(ID 1)과 출처 B 부산 3억(ID 1)을 섞지 않음", () => {
  const a = mergeTrades([], [tx({ officialId: "1", idScope: "A" })], AT, "A");
  const b = mergeTrades(a.transactions, [tx({ officialId: "1", idScope: "B", complexName: "부산단지", sggCd: "26110", dong: "중앙동", priceKrw: 300_000_000 })], AT, "B");
  assert.equal(b.transactions.length, 2);
  assert.ok(!b.transactions.some((t) => t.complexName === "서울단지" && t.priceKrw === 300_000_000), "혼합 거래 금지");
  assert.equal(b.report.corrected, 0);
});

test("[2] 출처를 모르는(미지정) 같은 ID에서 지역·단지가 다르면 병합하지 않고 ID 충돌 확인 필요", () => {
  const a = mergeTrades([], [tx({ officialId: "1" })], AT, "csv1");
  const b = mergeTrades(a.transactions, [tx({ officialId: "1", complexName: "부산단지", sggCd: "26110", dong: "중앙동", priceKrw: 300_000_000 })], AT, "csv2");
  assert.equal(b.transactions.length, 2);
  assert.ok(b.transactions.every((t) => t.reviewFlag?.kind === "idConflict"));
  assert.equal(b.transactions.find((t) => t.complexName === "서울단지")!.priceKrw, 900_000_000);
});

test("[2] 같은 출처·같은 ID의 층·준공연도 변경은 원천 정정으로 반영·기록, 출처 미지정이면 반영 보류·확인 필요", () => {
  const a = mergeTrades([], [tx({ officialId: "7", idScope: "molit", buildYear: 2019 })], AT, "A");
  const b = mergeTrades(a.transactions, [tx({ officialId: "7", idScope: "molit", floor: 6, buildYear: 2020 })], AT, "A");
  assert.equal(b.report.corrected, 1);
  assert.equal(b.transactions[0].floor, 6);
  assert.equal(b.transactions[0].buildYear, 2020);
  assert.match(b.transactions[0].revisions!.at(-1)!.change, /층 5→6.*준공연도 2019→2020/);
  const c = mergeTrades([], [tx({ officialId: "8" })], AT, "csv");
  const d = mergeTrades(c.transactions, [tx({ officialId: "8", floor: 6 })], AT, "csv");
  assert.equal(d.transactions[0].floor, 5, "출처 미지정 — 자동 반영 안 함");
  assert.equal(d.transactions[0].reviewFlag?.kind, "idChangeUnconfirmed");
  assert.equal(d.report.corrected, 0);
});

test("[2] 사용자 제외 사유는 원천 정정으로 바뀌지 않음", () => {
  const a = mergeTrades([], [tx({ officialId: "9", idScope: "molit" })], AT, "A");
  a.transactions[0].manualExclusion = "특수 관계 거래";
  const b = mergeTrades(a.transactions, [tx({ officialId: "9", idScope: "molit", priceKrw: 910_000_000 })], AT, "A");
  assert.equal(b.transactions[0].manualExclusion, "특수 관계 거래");
});

test("[2-재현] 이미 저장된 같은 ID 중복: 진단만 하고 임의 삭제하지 않음, 통계는 1건으로, 정리는 같은 내용만·사용자 실행으로", async () => {
  const { diagnoseTrades, cleanupIdenticalDuplicates } = await import("../../shared/tradeMerge.ts");
  const dupA = tx({ officialId: "1", idScope: "A" }), dupB = { ...dupA, key: "t-dup" };
  const conf1 = tx({ officialId: "2", idScope: "A" }), conf2 = tx({ officialId: "2", idScope: "A", priceKrw: 1_000_000_000 });
  const list = [dupA, dupB, conf1, conf2];
  const d = diagnoseTrades(list);
  assert.equal(d.identicalGroups.length, 1);
  assert.equal(d.conflictGroups.length, 1);
  // 병합 시 저장된 중복을 지우지 않고, 취소는 같은 내용 사본 모두에 반영(유령 정상 거래 방지)
  const m = mergeTrades(list, [tx({ officialId: "1", idScope: "A", cancelled: true })], AT, "A");
  assert.equal(m.transactions.length, 4);
  assert.equal(m.transactions.filter((t) => t.officialId === "1" && !t.cancelled).length, 0);
  // 분석: 같은 내용 사본은 1건만 집계, 충돌 ID는 통계 제외
  const w = emptyWorking("주소", "2026-10-31");
  w.property = { address: "주소", exclusiveAreaM2: 84, coordinates: { lat: 37.5, lng: 127, source: "시험" } };
  w.transactions = [...list, tx({ contractDate: "2026-08-01" }), tx({ contractDate: "2026-07-01" })];
  w.complexInfo = [{ complexKey: "N:서울단지|11110|청운동|", distanceM: 200 }];
  const r = runAnalysis(w);
  const rows = new Map(r.market.txRows.map((x) => [x.key, x]));
  assert.match(rows.get("t-dup")!.reasons.join(), /같은 ID 중복 사본/);
  assert.match(rows.get(conf1.key)!.reasons.join(), /ID 충돌/);
  const c = cleanupIdenticalDuplicates(list, AT);
  assert.equal(c.transactions.length, 3);
  assert.equal(c.removed, 1);
});

// ── 4. 동조건 취소 + 사용자 제외
test("[4-재현] 동조건 2건 중 1건 사용자 제외 + 어느 거래가 취소됐는지 특정 불가: 유효 표본을 확정하지 않고 범위 표시", async () => {
  const base = { complexName: "서울단지", contractDate: "2026-09-10" };
  const a = mergeTrades([], [tx(base), tx(base), tx({ ...base, floor: 9 }), tx({ ...base, floor: 11 })], AT, "api");
  a.transactions[0].manualExclusion = "특수 거래";
  const b = mergeTrades(a.transactions, [tx(base), tx({ ...base, cancelled: true }), tx({ ...base, floor: 9 }), tx({ ...base, floor: 11 })], AT, "api");
  const w = emptyWorking("주소", "2026-10-31");
  w.property = { address: "주소", exclusiveAreaM2: 84, coordinates: { lat: 37.5, lng: 127, source: "시험" } };
  w.options.minComplexTrades = 1;
  w.transactions = b.transactions;
  w.complexInfo = [{ complexKey: "N:서울단지|11110|청운동|", distanceM: 200 }];
  const r = runAnalysis(w);
  assert.deepEqual(r.market.sampleRange, { certain: 2, min: 2, max: 3, uncertainGroups: 1 });
  assert.ok(r.flags.some((f) => /유효 표본 2~3건/.test(f.text)));
  const rec = withRun(newManualRecord("lc_r", w), "manual");
  const { reportSummary } = await import("../../shared/report.ts");
  assert.match(reportSummary(rec, rec.runs[0].result), /유효 표본 2~3건/);
});


test("[호환] v0.3·v0.4 저장 기록을 그대로 읽고 분석·보고서 표시, 새 저장 시 다른 기록 원문 유지", async () => {
  const s = await store();
  const { latestRun } = await import("../../shared/runs.ts");
  const { reportSummary } = await import("../../shared/report.ts");
  const v03 = good("lc_v03") as any;
  v03.working.transactions = [tx({ idKey: "C:x#1", idBasis: "composite" }), tx({ idKey: "C:x#2", idBasis: "composite", cancelled: true })];
  v03.working.collections = [{ at: "2026-11-18T09:00:00+09:00", status: "partial", regions: [], regionNote: "지점 2곳 조회 실패 — 경계 밖 누락 가능", months: [], complexGeocode: { attempted: 3, located: 2, failed: 1 }, notes: [] }];
  delete v03.runs[0].input; // v0.3 이전 실행 형태
  const v04 = good("lc_v04") as any;
  v04.working.transactions = [tx({ officialId: "R-1", idKey: "O:R-1", idBasis: "official" }), tx({ priceKrw: 950_000_000, reviewFlag: { kind: "possibleCorrection", base: "b", note: "n" } })];
  v04.working.collections = [{ at: "2026-11-18T10:00:00+09:00", status: "complete", trades: { status: "complete", monthsOk: 1, monthsTotal: 1, capped: false, note: "" }, regionDiscovery: { status: "sampled", sampled: 17, failedPoints: 0, regionsFound: 7, regionsUsed: 6, capped: true, note: "상한" }, complexGeocode: { status: "complete", total: 3, attempted: 3, located: 3, failed: 0, capped: false }, regions: [], regionNote: "상한", months: [], notes: [] }];
  const rawObj = { lc_v03: v03, lc_v04: v04 };
  ls.setItem(KEY, JSON.stringify(rawObj));
  assert.equal(s.health().state, "ok");
  const r3 = s.get("lc_v03")!, r4 = s.get("lc_v04")!;
  assert.equal(r3.working.collections![0].regionDiscovery.status, "partial");
  assert.equal(r4.working.collections![0].regionDiscovery.status, "partial", "v0.4 상한+표본 → 일부로 맞춤");
  for (const r of [r3, r4]) {
    const res = runAnalysis(r.working);
    assert.ok(res.market);
    assert.match(reportSummary(r, latestRun(r).result!), /요약/);
  }
  assert.equal(s.put(good("lc_new")), null);
  const after = JSON.parse(ls.getItem(KEY)!);
  assert.deepEqual(after.lc_v03, rawObj.lc_v03, "다른 기록은 원문 그대로(자동 변환해 덮어쓰지 않음)");
  assert.deepEqual(after.lc_v04, rawObj.lc_v04);
});

test("[2] 출처 미지정 ID라도 다른 값이 모두 같고 해제만 새로 붙으면 해제 반영(유령 정상 거래 없음), 값 변경이 섞이면 보류", () => {
  const a = mergeTrades([], [tx({ officialId: "1" }), tx({ officialId: "1" })], AT, "csv");
  const b = mergeTrades(a.transactions, [tx({ officialId: "1", cancelled: true })], AT, "csv");
  assert.equal(b.transactions.length, 1);
  assert.equal(b.transactions[0].cancelled, true);
  const c = mergeTrades(a.transactions, [tx({ officialId: "1", cancelled: true, priceKrw: 950_000_000 })], AT, "csv");
  assert.equal(c.transactions[0].cancelled, false);
  assert.equal(c.transactions[0].reviewFlag?.kind, "idChangeUnconfirmed");
});
