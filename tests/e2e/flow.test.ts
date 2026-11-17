// 브라우저 시험(Chromium, 로컬 http). 실제 운영 HTTPS·회사망·실제 협의체 연결을 검증하지 않는다.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { chromium, type Browser } from "playwright";
import { createApp, type App } from "../../server/app.ts";
import { loadConfig } from "../../server/config.ts";
import { startHarness } from "../../examples/launcher-harness/server.ts";

const APP_PORT = 5274, HARNESS_PORT = 5275;
const APP = `http://localhost:${APP_PORT}`; // 하네스(127.0.0.1)와 다른 사이트
const CSV = "examples/sample-data/demo-nearby-trades.csv";
const EVENTS = "examples/sample-data/demo-location-events.json";
let app: App, browser: Browser, harness: ReturnType<typeof startHarness>;

before(async () => {
  const dir = mkdtempSync(join(tmpdir(), "la-e2e-"));
  app = createApp(loadConfig({ DB_PATH: join(dir, "e.db"), WEB_ROOT: "dist/web", LAUNCH_RECEIVER_ENABLED: "true" } as any), { logger: () => {} });
  await new Promise<void>((r) => app.server.listen(APP_PORT, "127.0.0.1", r));
  harness = startHarness({ port: HARNESS_PORT, launchUrl: `${APP}/launch`, allowLocalhost: true });
  browser = await chromium.launch();
});
after(async () => { await browser.close(); harness.server.close(); await app.close(); });

test("독립 사용: 주소 입력 → 분석 → CSV·사건 추가 → 재실행 → 저장 → 재열기 → 보고서 출력", async () => {
  const ctx = await browser.newContext({ acceptDownloads: true });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${APP}/app`);
  await page.fill("[data-testid=new-address]", "[가상] 누리시 가람동 100");
  await page.click("[data-testid=start]");
  await page.waitForSelector("[data-testid=summary]");
  // 주소만: 가격 판단 보류, 비교단지 없음(채우지 않음)
  assert.match(await page.textContent("[data-testid=price-compare]") ?? "", /보류/);
  assert.equal(await page.locator("[data-testid=no-comparables]").count(), 1);

  await page.click("#sec-input > summary");
  await page.fill("[data-testid=f-area]", "84");
  await page.fill("[data-testid=f-buildyear]", "2022");
  await page.click("[data-testid=price-toggle]");
  await page.fill("[data-testid=f-price]", "9.6");
  await page.click("#sec-market > summary");
  await page.setInputFiles("[data-testid=csv-import]", CSV);
  await page.waitForSelector("[data-testid=market-msg]");
  await page.click("#sec-events > summary");
  await page.locator("#sec-events input[type=file]").first().setInputFiles(EVENTS);
  await page.waitForSelector("[data-testid=events-msg]");
  await page.click("[data-testid=rerun]");
  const price = await page.textContent("[data-testid=price-compare]");
  assert.match(price ?? "", /만원\/전용㎡.*대비/);
  const rows = await page.locator("[data-testid=comparables] tbody tr").count();
  assert.ok(rows >= 1 && rows <= 5);
  assert.match(await page.textContent("[data-testid=summary-location]") ?? "", /교통/);

  await page.click("[data-testid=save-browser]");
  await page.waitForURL(/\/app\/l\//);
  const url = page.url();
  await page.goto(`${APP}/app`);
  await page.click("[data-testid=open-local]");
  await page.waitForURL(url);
  await page.reload();
  assert.match(await page.textContent("[data-testid=price-compare]") ?? "", /대비/);

  await page.click("#sec-report > summary").catch(() => {});
  await page.waitForSelector("[data-testid=dl-md]");
  const [dl] = await Promise.all([page.waitForEvent("download"), page.click("[data-testid=dl-md]")]);
  const md = readFileSync((await dl.path())!, "utf8");
  assert.match(md, /아파트 입지·가격 검토 요약/);
  assert.match(md, /분석 기준일/);
  await page.emulateMedia({ media: "print" });
  const pdf = await page.pdf();
  assert.ok(pdf.length > 1000);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("[대기 기능] 하네스 버튼 1회 → 새 탭(opener null) → 자동 분석 1회, 원본 저장·협의체 요청 0건", async () => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`http://127.0.0.1:${HARNESS_PORT}/`);
  const [tab] = await Promise.all([ctx.waitForEvent("page"), page.click("[data-testid=launch-button]")]);
  await tab.waitForSelector("[data-testid=summary]");
  assert.equal(await tab.evaluate(() => window.opener), null);
  assert.match(tab.url(), /\/app\/a\/an_/);
  assert.match(await tab.textContent("[data-testid=run-info]") ?? "", /#1/);
  assert.match(await page.textContent("[data-testid=launch-notice]") ?? "", /전송을 시도/);
  assert.match(await page.textContent("[data-testid=save-count]") ?? "", /0회/);
  assert.equal(harness.hits.length, 0);
  await ctx.close();
});
