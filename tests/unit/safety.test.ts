// 입력 안전 검사·가져오기 시험
import { test } from "node:test";
import assert from "node:assert/strict";
import { scanSafety } from "../../shared/safety.ts";
import { detectFile, makeBackup, parseCsv, scanWorking, transactionsFromCsv, generalJsonImport } from "../../shared/importers.ts";
import { demoWorking } from "../../shared/demo.ts";
import { newManualRecord } from "../../shared/model.ts";

test("콜백·토큰·DB 접속정보·외부 식별자 필드는 거절, 결과에 원문 값 없음", () => {
  const secret = "postgres://admin:pw@internal-db:5432/x";
  const issues = scanSafety({ a: { callbackUrl: "x" }, b: secret, userId: "u1", analysisId: "a1", note: "Bearer abcdefghijklmnop" });
  const codes = issues.map((i) => i.code);
  assert.ok(codes.includes("FORBIDDEN_FIELD"));
  assert.ok(codes.includes("SECRET_LIKE_VALUE"));
  assert.ok(!JSON.stringify(issues).includes("pw@internal"));
});

test("CSV 머리행에 금지 필드가 있으면 파일 전체 거절", () => {
  const r = transactionsFromCsv("단지명,전용면적,거래금액(만원),계약일,token\nA,84,90000,2026-01-01,abc");
  assert.equal(r.ok, false);
});

test("CSV 수식 형태 셀은 실행하지 않고 숫자로도 해석하지 않음", () => {
  const r = transactionsFromCsv('단지명,전용면적,거래금액(만원),계약일\n"=HYPERLINK(""x"")",84,=1+1,2026-01-01\nB,84,"90,000",2026-01-02');
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].priceKrw, 900_000_000);
  assert.equal(r.skipped, 1);
});

test("CSV 따옴표·줄바꿈 처리", () => {
  assert.deepEqual(parseCsv('a,"b,c"\r\n"d""e",f'), [["a", "b,c"], ['d"e', "f"]]);
});

test("일반 JSON: 첨부 HTML·스크립트 값 거절, 알 수 없는 최상위 필드 거절", () => {
  assert.equal(generalJsonImport({ events: [{ name: "<script>alert(1)</script>" }] }).ok, false);
  assert.equal(generalJsonImport({ webhook: "x" }).ok, false);
  assert.equal(generalJsonImport({ events: [], extra: 1 }).ok, false);
});

test("근거의 참고 주소는 텍스트로만 허용(다른 필드의 URL은 거절)", () => {
  const ok = generalJsonImport({ evidence: [{ publisher: "기관", title: "문서", fact: "사실", sourceUrl: "https://example.go.kr/doc" }] });
  assert.equal(ok.ok, true);
  assert.equal(generalJsonImport({ evidence: [{ publisher: "https://evil.example", title: "t", fact: "f" }] }).ok, true); // publisher는 자유 텍스트(조회하지 않음)
  assert.equal(generalJsonImport({ events: [{ name: "https://evil.example" }] }).ok, false);
});

test("백업 복구: 정상 백업은 복구, 금지 필드가 섞인 백업은 거절", () => {
  const rec = newManualRecord("lc_x", demoWorking(), "demo");
  const ok = detectFile("b.json", JSON.stringify(makeBackup([rec], "2026-10-31T00:00:00+09:00")));
  assert.equal(ok.type, "backup");
  assert.equal((ok as any).records.length, 1);
  const bad = structuredClone(rec) as any;
  bad.working.property.sessionToken = "abc";
  const r = detectFile("b.json", JSON.stringify(makeBackup([bad], "2026-10-31T00:00:00+09:00")));
  assert.equal((r as any).records.length, 0);
});

test("작업본 검사: 첨부 본문 속 비밀값 거절", () => {
  const w = demoWorking();
  w.attachments.push({ key: "a", filename: "x.txt", mime: "text/plain", size: 10, sha256: "0", text: "-----BEGIN RSA PRIVATE KEY-----", addedAt: "2026-10-31" });
  assert.ok(scanWorking(w).some((i) => i.code === "SECRET_LIKE_VALUE"));
});
