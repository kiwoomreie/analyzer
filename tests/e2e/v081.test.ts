// v0.8.1(서버 없는 웹 버전) — [입지-01] 근거 패널에 실행 시점 문서(제목·문서번호·발행기관·발행일·페이지),
// ④에서 실행 번호를 골라 그 실행 당시 제목·주소·수치·근거로 보고서 재출력. 실제 국토부·카카오 호출 없음.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { readFileSync } from "node:fs";
import { chromium, type Browser, type Page } from "playwright";
import { stepAware } from "../helpers/stepAware.ts";

const PORT = 5297, BASE = `http://localhost:${PORT}`;
let server: Server, browser: Browser;
before(async () => {
  const html = readFileSync("dist/preview/index.html");
  server = createServer((_q, r) => { r.writeHead(200, { "content-type": "text/html; charset=utf-8" }); r.end(html); });
  await new Promise<void>((r) => server.listen(PORT, "127.0.0.1", r));
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined });
});
after(async () => { await browser.close(); server.close(); });
const shot = async (page: Page, name: string) => { if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/${name}.png` }); };

for (const [vp, size] of [["pc", { width: 1340, height: 920 }], ["m390", { width: 390, height: 844 }]] as const) {
  test(`[${vp}] [입지-01] 문서 표시 + 실행 1 보고서는 주소·근거 변경 뒤에도 당시 값`, async () => {
    const ctx = await browser.newContext({ viewport: size });
    const page = stepAware(await ctx.newPage());
    await page.goto(BASE);
    await page.click("[data-testid=load-demo-top]");
    await page.waitForSelector("[data-testid=hero]");
    await page.click("[data-testid=step-3]");
    await page.locator("[data-cite='입지-01']").first().click();
    await page.waitForSelector("[data-testid=evidence-docs]");
    await page.waitForTimeout(400);
    const docs = await page.locator("[data-testid=evidence-docs]").innerText();
    assert.match(docs, /\[가상\] 가람선 광역철도 기본계획 고시/);
    assert.match(docs, /\[가상\] 고시 제2024-000호/);
    assert.match(docs, /\[가상\] 국토교통부/);
    assert.match(docs, /2024-02-20/);
    assert.match(docs, /\[가상\] 3쪽 2절/);
    await page.locator("[data-testid=evidence-doc-evd_d1]").scrollIntoViewIfNeeded();
    await shot(page, `v081-${vp}-evidence-docs`);
    await page.click("[data-testid=evidence-close]");

    const oldAddr = await page.locator("[data-testid=f-address]").inputValue();
    await page.fill("[data-testid=f-address]", "바뀐 주소 999");
    await page.click("[data-testid=rerun]");
    await page.click("[data-testid=step-4]");
    await page.waitForSelector("[data-testid=run-row-2]");
    const latest = await page.locator("[data-testid=report-preview]").innerText();
    assert.match(latest, /바뀐 주소 999/);
    assert.match(latest, /실행 #2\(최신\)|실행 #2 당시 기록 기준/);

    await page.selectOption("[data-testid=report-run]", "1");
    const r1 = await page.locator("[data-testid=report-preview]").innerText();
    assert.doesNotMatch(r1, /바뀐 주소/);
    assert.ok(r1.includes(oldAddr), "실행 1 당시 주소");
    assert.match(r1, /실행 #1 당시 기록 기준/);
    assert.match(r1, /문서: 「\[가상\] 가람선 광역철도 기본계획 고시」 · 문서번호 \[가상\] 고시 제2024-000호/);
    assert.match(await page.locator("[data-testid=report-run-note]").innerText(), /실행 #1 당시 기록 기준 — 그 뒤 바뀐/);
    for (const k of ["draft", "questions"]) {
      await page.selectOption("[data-testid=report-kind]", k);
      const t = await page.locator("[data-testid=report-preview]").innerText();
      assert.doesNotMatch(t, /바뀐 주소/, k);
    }
    await page.selectOption("[data-testid=report-kind]", "summary");
    await page.evaluate(() => document.querySelector("[data-testid=report-run]")!.scrollIntoView({ block: "start" })); await page.evaluate(() => window.scrollBy(0, -90));
    await shot(page, `v081-${vp}-report-run1`);
    await ctx.close();
  });
}
