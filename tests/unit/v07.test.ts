// v0.7.2: 가격 영향 카드 분리(현재 검토가격 비교 / 입지 사건 전후 관측), 사용·제외 단지, 유효성·문구
import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture } from "../helpers/observationFixture.ts";
import { complexKeyOf, newManualRecord } from "../../shared/model.ts";
import { observeGroups } from "../../shared/observation.ts";
import { withRun, latestRun } from "../../shared/runs.ts";
import { reportDraft, reportSummary } from "../../shared/report.ts";
import { currentPriceView, observationView, priceInputOf } from "../../shared/priceView.ts";
import { demoWorking } from "../../shared/demo.ts";

test("사용·제외 단지: 사용·양쪽 중복·현재 거래 없음·전후 같은 면적구간 없음 사유", () => {
  const w = fixture();
  // C: 전 기간은 84㎡, 후 기간은 89㎡ → 같은 5㎡ 구간이 전후 양쪽에 없음
  for (const [d, a] of [["2025-06-01", 84], ["2025-08-01", 89]] as const) w.transactions.push({ key: `c-${d}`, complexName: "C", exclusiveAreaM2: a, priceKrw: 84_000_000 * (a / 84), contractDate: d, cancelled: false, dataMode: "demo" });
  w.transactions.push({ key: "a-cancel", complexName: "A", exclusiveAreaM2: 84, priceKrw: 84_000_000, contractDate: "2025-06-20", cancelled: true, dataMode: "demo" });
  const kC = complexKeyOf({ complexName: "C" });
  w.complexInfo.push({complexKey:kC,location:{lat:37.401,lng:127.1}});
  w.observation!.impact.push(kC, "N:사라진단지|||");
  w.observation!.control.push(w.observation!.impact[0]);
  const r = observeGroups(w);
  const by = (g: string, label: string) => r.usage.find((u) => u.group === g && u.label === label)!;
  assert.equal(by("impact", "A").reason, "영향권·비교군 양쪽에 선택 — 양쪽에서 제외");
  assert.equal(by("impact", "C").used, false);
  assert.match(by("impact", "C").reason!, /같은 전용면적 구간\(5㎡\) 거래 없음/);
  assert.match(by("impact", "사라진단지").reason!, /현재 거래 자료에 없음/);
  const b = by("control", "B");
  assert.deepEqual([b.used, b.pre, b.post, b.strata], [true, 3, 3, 1]);
  // 중복 제외하지 않은 경우 A의 해제 거래가 사유별로 집계됨
  const w2 = fixture();
  w2.transactions.push({ key: "a-cancel", complexName: "A", exclusiveAreaM2: 84, priceKrw: 84_000_000, contractDate: "2025-06-20", cancelled: true, dataMode: "demo" });
  assert.equal(observeGroups(w2).usage.find((u) => u.label === "A")!.excluded["해제"], 1);
});

test("사용·제외 내역을 더해도 숫자(중위·건수·변동률·%p)는 그대로", () => {
  const w = fixture();
  const r = observeGroups(w);
  assert.equal(r.valid, true);
  assert.ok(Math.abs(r.differencePp! - 10) < 1e-9);
  assert.deepEqual([r.impact.pre.count, r.impact.post.count, r.control.pre.count, r.control.post.count], [3, 3, 3, 3]);
});

test("유효한 비교가 아니면 차이를 숨김: 표본 부족·기준 일정이 기준일 이후에 알려짐·미완료", () => {
  const w = fixture();
  w.transactions.shift();
  assert.equal(observationView(observeGroups(w)).difference, null);
  const w2 = fixture();
  w2.events[0].milestones[0].announcedOn = "2026-12-01";
  const r2 = observeGroups(w2);
  assert.equal(r2.differencePp,null);
  assert.equal(r2.impact.pre.count,0);
  assert.equal(r2.valid, false);
  assert.equal(observationView(r2).difference, null, "차이는 숨김");
  assert.match(r2.warnings.join(" "), /기준일 이후\(2026-12-01\)에 알려진/);
  const w3 = fixture();
  w3.asOf = "2025-09-01";
  assert.equal(observationView(observeGroups(w3)).difference, null);
});

test("문구: ‘비교군 대비 관측 차이 +x%p’만 쓰고 인과 표현을 쓰지 않음", () => {
  const rec = withRun(newManualRecord("lc_w", fixture()), "manual");
  const r = latestRun(rec).result!;
  assert.equal(observationView(r.groupObservation).difference, "비교군 대비 관측 차이 +10.0%p");
  for (const md of [reportSummary(rec, r), reportDraft(rec, r)]) {
    assert.match(md, /비교군 대비 관측 차이 \+10\.0%p/);
    assert.doesNotMatch(md, /호재로|영향권 − 비교군|상승 효과/);
  }
  assert.match(reportSummary(rec, r), /### 2-1\. 현재 검토가격 비교[\s\S]*### 2-2\. 입지 사건 전후 관측/);
});

test("현재 검토가격 비교: 세대당 총액과 전용평당가 구분, 면적 없으면 보류, 중위는 적정가가 아님", () => {
  const w = demoWorking();
  const rec = withRun(newManualRecord("lc_p", w), "manual");
  const pv = currentPriceView(priceInputOf(w), latestRun(rec).result!);
  assert.equal(pv.review.household, "9.6억원");
  assert.match(pv.review.perPyeong, /만원\/전용평$/);
  assert.match(pv.review.perM2, /만원\/전용㎡$/);
  assert.ok(pv.market.complexes <= 5);
  assert.match(pv.disclaimer, /적정가격이 아님/);
  const w2 = demoWorking();
  delete w2.property.exclusiveAreaM2;
  const pv2 = currentPriceView(priceInputOf(w2), latestRun(withRun(newManualRecord("lc_p2", w2), "manual")).result!);
  assert.equal(pv2.review.status, "held");
  assert.equal(pv2.review.household, "9.6억원", "세대당 총액은 그대로");
  assert.equal(pv2.review.perPyeong, "전용면적 필요");
});

test("가상 데모: 12개월 관측은 유효(+5.9%p), 3개월은 표본 부족으로 차이 숨김, 가상 자료 표시", () => {
  const w = demoWorking();
  const g = observeGroups(w);
  assert.equal(g.valid, true);
  assert.ok(Math.abs(g.differencePp! - 5.9416) < 1e-3, String(g.differencePp));
  const v = observationView(g);
  assert.equal(v.demo, true);
  assert.equal(v.difference, "비교군 대비 관측 차이 +5.9%p");
  w.observation!.months = 3;
  const g3 = observeGroups(w);
  assert.equal(observationView(g3).difference, null);
  assert.match(g3.warnings.join(" "), /표본 부족/);
});

test("이전 실행 결과(valid 필드 없음)도 차이 산출 여부로 표시, 설정 없음은 미설정", () => {
  const rec = withRun(newManualRecord("lc_o", fixture()), "manual");
  const g = structuredClone(latestRun(rec).result!.groupObservation!) as any;
  delete g.valid;
  assert.equal(observationView(g).difference, "비교군 대비 관측 차이 +10.0%p");
  assert.equal(observationView(undefined).configured, false);
});
