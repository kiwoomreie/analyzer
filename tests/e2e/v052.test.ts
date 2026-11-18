// 브라우저 시험(Chromium, 로컬 http, CSV 가져오기 경로). 실제 공공 API 호출은 검증하지 않는다.
// v0.5.1 재검토: 동조건 묶음 해제 불확실성이 후속 수집(전량 해제·묶음 증가)에서 화면·보고서에 갱신되는지
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { chromium, type Browser, type Page } from "playwright";
import { createApp, type App } from "../../server/app.ts";
import { loadConfig } from "../../server/config.ts";

const PORT = 5281;
let app: App, browser: Browser, dir: string;
before(async () => {
  dir = mkdtempSync(join(tmpdir(), "la-v052-"));
  app = createApp(loadConfig({ DB_PATH: join(dir, "a.db"), WEB_ROOT: "dist/web" } as any), { logger: () => {} });
  await new Promise<void>((r) => app.server.listen(PORT, "127.0.0.1", r));
  browser = await chromium.launch();
});
after(async () => { await browser.close(); await app.close(); });

const HEAD = "단지명,법정동,전용면적,층,거래금액(만원),계약일,해제여부,건축년도";
/** 동조건(5층·9억) g건 중 c건 해제 + 별도 정상 5건(최소 거래 수 기준 충족용). ASCII 파일명(Playwright 제약). */
function csv(name: string, g: number, c: number) {
  const rows = [HEAD];
  for (let i = 0; i < g; i++) rows.push(`시험단지,시험동,84,5,90000,2026-09-10,${i < c ? "O" : ""},2015`);
  for (const f of [9, 11, 12, 13, 14]) rows.push(`시험단지,시험동,84,${f},90000,2026-09-10,,2015`);
  const p = join(dir, `${name}.csv`);
  writeFileSync(p, rows.join("\n"));
  return p;
}
const open = async (page: Page, id: string) => { if ((await page.locator(`#${id}`).getAttribute("open")) === null) await page.click(`#${id} > summary`); await page.waitForTimeout(120); };
const importCsv = async (page: Page, p: string) => {
  await page.setInputFiles("[data-testid=csv-import]", p);
  await page.waitForSelector("[data-testid=market-msg]");
  await page.click("[data-testid=rerun]");
  await page.waitForTimeout(150);
};
const uncertainty = async (page: Page) => (await page.textContent("[data-testid=summary-uncertainty]")) ?? "";
const report = async (page: Page) => { await open(page, "sec-report"); return (await page.textContent("[data-testid=report-preview]")) ?? ""; };

test("동조건 2건·1건 사용자 제외 → 1건 해제(5~6건) → 전량 해제(범위 표시 사라짐) → 저장·다시 열기·보고서", async () => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`http://localhost:${PORT}/app`);
  await page.fill("[data-testid=new-address]", "[가상] 시험시 시험동 1");
  await page.click("[data-testid=start]");
  await page.waitForSelector("[data-testid=summary]");
  await open(page, "sec-input");
  await page.fill("[data-testid=f-area]", "84");
  await open(page, "sec-market");
  await importCsv(page, csv("b1", 2, 0));
  // 거리 확인 입력 → 대표 단지
  await page.locator("[data-testid=complex-table] tr[data-status=needsCheck] td:nth-child(9) input").first().fill("300");
  // 첫 번째 5층 거래 사용자 제외
  const row5 = page.locator("[data-testid=tx-table] tbody tr").filter({ has: page.locator("td:nth-child(3)", { hasText: /^5$/ }) });
  assert.equal(await row5.count(), 2);
  await row5.first().locator("td:nth-child(9) input").fill("특수 거래");
  await page.click("[data-testid=rerun]");

  await importCsv(page, csv("b2", 2, 1));
  assert.match(await uncertainty(page), /유효 표본 5~6건/);
  assert.equal(await page.locator("[data-testid=amb-note]").count(), 2);

  await importCsv(page, csv("b3", 2, 2));
  assert.doesNotMatch(await uncertainty(page), /유효 표본 \d+~\d+건/, "전량 해제 후 오래된 범위 표시가 남으면 안 됨");
  assert.equal(await page.locator("[data-testid=amb-note]").count(), 0);
  assert.equal(await row5.first().locator("td:nth-child(9) input").inputValue(), "특수 거래", "사용자 제외 보존");
  assert.match(await row5.first().textContent() ?? "", /특정 불가 해소/, "해소 이력 표시");
  assert.doesNotMatch(await report(page), /유효 표본 \d+~\d+건/);

  await page.click("[data-testid=save-browser]");
  await page.waitForURL(/\/app\/l\//);
  await page.reload();
  await page.waitForSelector("[data-testid=summary]");
  assert.doesNotMatch(await uncertainty(page), /유효 표본 \d+~\d+건/);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("묶음 증가(2→3건, 해제 1건)는 범위 6~7건, 이후 전량 해제 시 확정", async () => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`http://localhost:${PORT}/app`);
  await page.fill("[data-testid=new-address]", "[가상] 시험시 시험동 2");
  await page.click("[data-testid=start]");
  await page.waitForSelector("[data-testid=summary]");
  await open(page, "sec-input");
  await page.fill("[data-testid=f-area]", "84");
  await open(page, "sec-market");
  await importCsv(page, csv("c1", 2, 0));
  await page.locator("[data-testid=complex-table] tr[data-status=needsCheck] td:nth-child(9) input").first().fill("300");
  const row5 = page.locator("[data-testid=tx-table] tbody tr").filter({ has: page.locator("td:nth-child(3)", { hasText: /^5$/ }) });
  await row5.first().locator("td:nth-child(9) input").fill("특수 거래");
  await page.click("[data-testid=rerun]");
  await importCsv(page, csv("c2", 2, 1));
  await importCsv(page, csv("c3", 3, 1));
  assert.match(await uncertainty(page), /유효 표본 6~7건/);
  assert.equal(await page.locator("[data-testid=amb-note]").count(), 3);
  await importCsv(page, csv("c4", 3, 3));
  assert.doesNotMatch(await uncertainty(page), /유효 표본 \d+~\d+건/);
  await ctx.close();
});
