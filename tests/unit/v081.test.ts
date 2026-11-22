// v0.8.1: 입지 근거 문서 보존 + 실행 번호별 보고서 재출력(당시 제목·주소·수치·근거 한 묶음, 당시 정보가 없으면 현재 값으로 채우지 않음)
import { test } from "node:test";
import assert from "node:assert/strict";
import { migrateRecord, newManualRecord, type AnalysisRecord } from "../../shared/model.ts";
import { withRun } from "../../shared/runs.ts";
import { demoWorking } from "../../shared/demo.ts";
import { makeBackup, restoreBackup } from "../../shared/importers.ts";
import { findCitation } from "../../shared/citations.ts";
import { reportDraft, reportQuestions, reportSummary } from "../../shared/report.ts";
import { runAnalysis } from "../../shared/analysis.ts";

const snap = (x: unknown) => JSON.stringify(x);

function twoRuns() {
  let rec = withRun(newManualRecord("lc_r81", demoWorking(), "demo"), "manual", "2026-11-20T09:00:00+09:00");
  const w = structuredClone(rec.working);
  w.property.address = "바뀐 주소 999";
  w.property.displayName = "바뀐 사업지명";
  const d1 = w.evidence.find((e) => e.key === "evd_d1")!;
  d1.title = "바뀐 문서 제목"; d1.sourceRef = "바뀐 문서번호"; d1.pageOrSection = "99쪽";
  w.evidence = w.evidence.filter((e) => e.key !== "evd_d2");
  w.reviewPrice = null;
  rec = withRun({ ...rec, working: w }, "manual", "2026-11-21T09:00:00+09:00");
  return rec;
}

test("[입지-01]은 실행 시점 문서 제목·발행기관·발행일·문서번호·페이지를 보존하고, 실행 2의 근거 수정·삭제 뒤에도 그대로", () => {
  const rec = twoRuns();
  const e1 = findCitation(rec.runs[0].result, "입지-01");
  assert.ok(e1 && e1.kind === "event" && e1.documents, "문서 목록 보존");
  if (!e1 || e1.kind !== "event" || !e1.documents) return;
  const doc = e1.documents.find((d) => d.key === "evd_d1")!;
  assert.equal(doc.title, "[가상] 가람선 광역철도 기본계획 고시");
  assert.equal(doc.publisher, "[가상] 국토교통부");
  assert.equal(doc.publishedOn, "2024-02-20");
  assert.equal(doc.sourceRef, "[가상] 고시 제2024-000호");
  assert.equal(doc.pageOrSection, "[가상] 3쪽 2절");
  assert.ok(e1.documents.some((d) => d.key === "evd_d2"), "실행 2에서 삭제한 문서도 실행 1 인용에는 남음");
  const e2 = findCitation(rec.runs[1].result, "입지-01");
  assert.ok(e2 && e2.kind === "event" && e2.documents?.find((d) => d.key === "evd_d1")?.title === "바뀐 문서 제목", "실행 2는 새 값");
  // 보고서 부록 G에도 문서 표시
  const md1 = reportSummary(rec, rec.runs[0].result);
  assert.match(md1, /문서: 「\[가상\] 가람선 광역철도 기본계획 고시」 · 문서번호 \[가상\] 고시 제2024-000호 · \[가상\] 국토교통부 · 발행일 2024-02-20 · 페이지·절 \[가상\] 3쪽 2절/);
  assert.doesNotMatch(md1, /바뀐 문서/);
});

test("실행 1 보고서는 주소 변경 뒤에도 당시 제목·주소·수치·근거로 나오고, 새로고침·JSON 복원 후에도 같음", () => {
  const rec = twoRuns();
  const r1 = rec.runs[0].result;
  const outs = (x: AnalysisRecord) => [reportSummary(x, x.runs[0].result), reportQuestions(x, x.runs[0].result), reportDraft(x, x.runs[0].result)];
  const [sum, q, draft] = outs(rec);
  for (const md of [sum, q, draft]) {
    assert.doesNotMatch(md, /바뀐 주소|바뀐 사업지명|바뀐 문서/, "현재 작업본 값이 섞이지 않음");
    assert.match(md, /실행 #1 당시 기록 기준/);
    assert.match(md, new RegExp(r1.inputHash.slice(0, 12)));
  }
  assert.match(sum, new RegExp(`대상: .*${demoWorking().property.address.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  assert.match(sum, /검토가격: 세대당 총액/, "실행 1의 검토가격(실행 2에서 지움)을 유지");
  assert.match(sum, /\[가상\] 가람선 추진현황 보도자료/, "부록 A는 당시 근거 목록");
  assert.match(draft, new RegExp(`본건 소재지는 ${demoWorking().property.address.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}임`));
  // 실행 2 보고서는 새 값
  assert.match(reportSummary(rec, rec.runs[1].result), /바뀐 사업지명 \(바뀐 주소 999\)/);

  const reloaded = migrateRecord(JSON.parse(JSON.stringify(rec)) as AnalysisRecord);
  assert.deepEqual(outs(reloaded), [sum, q, draft], "새로고침 후 같은 보고서");
  const restored = restoreBackup(JSON.parse(JSON.stringify(makeBackup([reloaded], "2026-11-23T08:00:00+09:00"))));
  assert.equal(restored.type, "backup");
  if (restored.type !== "backup") return;
  assert.deepEqual(outs(restored.records[0]), [sum, q, draft], "JSON 복원 후 같은 보고서");
});

test("당시 맥락이 없는 과거 실행은 ‘당시 정보 미보존’으로 표시하고 현재 값으로 채우지 않음", () => {
  const rec = twoRuns();
  const old = structuredClone(rec);
  delete (old.runs[0].result as any).reportContext;
  old.runs[0].result.citations!.items.forEach((c: any) => { if (c.kind === "event") delete c.documents; });
  const r = old.runs[0].result;
  const md = reportSummary(old, r) + reportDraft(old, r) + reportQuestions(old, r);
  assert.doesNotMatch(md, /바뀐 주소|바뀐 사업지명|바뀐 문서/);
  assert.match(md, /사업지명 당시 정보 미보존/);
  assert.match(md, /당시 입력 맥락 미보존/);
  assert.match(md, /당시 정보 미보존\(이 실행의 근거 목록이 남아 있지 않음/);
  assert.match(md, /문서 상세: 당시 미보존/);
  assert.match(md, /반경 당시 정보 미보존/);
  // 결과에 남은 주소와 수치는 그대로
  assert.match(md, new RegExp(r.property.address.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(md, new RegExp(r.price.text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("보고서 맥락·문서 보존을 넣어도 계산값은 변경 전과 동일", () => {
  const w = demoWorking();
  const r = withRun(newManualRecord("lc_s81", w), "manual").runs[0].result;
  const direct = runAnalysis(structuredClone(w));
  for (const k of ["market", "price", "events", "flags", "summary", "supply", "observed"] as const) assert.equal(snap(r[k]), snap(direct[k]), k);
});
