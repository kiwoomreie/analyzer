// 브라우저 시험(Chromium, 로컬 http). 실제 운영 HTTPS·회사망·실제 공공 API·실제 협의체 연결을 검증하지 않는다.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { chromium, type Browser, type Page } from "playwright";
import { createApp, type App } from "../../server/app.ts";
import { loadConfig } from "../../server/config.ts";
import { startHarness } from "../../examples/launcher-harness/server.ts";
import { mockState, mockTransport } from "../helpers/mockPublicApi.ts";
import { openSec, reveal, stepAware } from "../helpers/stepAware.ts";

const APP_PORT = 5274, KEYED_PORT = 5276, HARNESS_PORT = 5275;
const APP = `http://localhost:${APP_PORT}`;
const KEYED = `http://localhost:${KEYED_PORT}`;
const CSV = "examples/sample-data/demo-nearby-trades.csv";
const EVENTS = "examples/sample-data/demo-location-events.json";
let app: App, keyed: App, browser: Browser, harness: ReturnType<typeof startHarness>;

before(async () => {
  const dir = mkdtempSync(join(tmpdir(), "la-e2e-"));
  app = createApp(loadConfig({ DB_PATH: join(dir, "e.db"), WEB_ROOT: "dist/web", LAUNCH_RECEIVER_ENABLED: "true" } as any), { logger: () => {} });
  await new Promise<void>((r) => app.server.listen(APP_PORT, "127.0.0.1", r));
  // 모의 공공 API(키는 가짜, 응답은 tests/helpers/mockPublicApi.ts)
  keyed = createApp(loadConfig({ DB_PATH: join(dir, "k.db"), WEB_ROOT: "dist/web", MOLIT_SERVICE_KEY: "fake", KAKAO_REST_KEY: "fake" } as any), { logger: () => {}, publicDataDeps: { lookup: (_h, cb) => cb(null, [{ address: "203.0.113.10", family: 4 }]), transport: mockTransport } });
  await new Promise<void>((r) => keyed.server.listen(KEYED_PORT, "127.0.0.1", r));
  harness = startHarness({ port: HARNESS_PORT, launchUrl: `${APP}/launch`, allowLocalhost: true });
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined });
});
after(async () => { await browser.close(); harness.server.close(); await app.close(); await keyed.close(); });

async function startWith(page: Page, base: string, address = "[가상] 누리시 가람동 100") {
  await page.goto(`${base}/app`);
  await page.fill("[data-testid=new-address]", address);
  await page.click("[data-testid=start]");
  await page.waitForSelector("[data-testid=summary]");
}
const open = openSec;

test("독립 사용: 주소 → 분석 → CSV·사건·거리 입력 → 재실행 → 저장 → 재열기(입력 보존) → 보고서", async () => {
  const ctx = await browser.newContext({ acceptDownloads: true });
  const page = stepAware(await ctx.newPage());
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await startWith(page, APP);
  assert.match(await page.textContent("[data-testid=price-compare]") ?? "", /보류/);
  assert.equal(await page.locator("[data-testid=no-comparables]").count(), 1);

  await open(page, "sec-input");
  await page.fill("[data-testid=f-area]", "84");
  await page.fill("[data-testid=f-buildyear]", "2022");
  await page.click("[data-testid=price-toggle]");
  await page.fill("[data-testid=f-price]", "9.6");
  await open(page, "sec-market");
  await page.setInputFiles("[data-testid=csv-import]", CSV);
  await page.waitForSelector("[data-testid=market-msg]");
  await open(page, "sec-events");
  await page.locator("#sec-events input[type=file]").first().setInputFiles(EVENTS);
  await page.waitForSelector("[data-testid=events-msg]");
  await page.click("[data-testid=rerun]");
  // CSV에는 좌표가 없어 모든 단지가 ‘확인 필요’ → 대표 0, 통계 혼입 없음
  assert.equal(await page.locator("[data-testid=no-comparables]").count(), 1);
  assert.match(await page.textContent("[data-testid=needs-check]") ?? "", /확인 필요 후보/);
  // 사용자가 거리를 확인해 입력한 단지만 대표로 선정
  await openSec(page, "sec-results");
  const distInputs = page.locator("[data-testid=complex-table] tr[data-status=needsCheck] td:nth-child(9) input");
  for (const [i, d] of [[0, 300], [1, 500], [2, 2500]] as const) await distInputs.nth(i).fill(String(d));
  await page.click("[data-testid=rerun]");
  const rows = await page.locator("[data-testid=comparables] tbody tr").count();
  assert.ok(rows >= 1 && rows <= 2, `대표 ${rows}`); // 2,500m는 반경 1,500m 밖
  assert.match(await page.textContent("[data-testid=price-compare]") ?? "", /대비/);

  await page.click("[data-testid=save-browser]");
  await page.waitForURL(/\/app\/l\//);
  const url = page.url();
  await page.goto(`${APP}/app`);
  await page.click("[data-testid=open-local]");
  await page.waitForURL(url);
  await page.reload();
  await open(page, "sec-input");
  assert.equal(await page.inputValue("[data-testid=f-area]"), "84");
  assert.equal(await page.inputValue("[data-testid=f-price]"), "9.6");
  assert.equal(await page.locator("[data-testid=stale-banner]").count(), 0);

  await open(page, "sec-report");
  const [dl] = await Promise.all([page.waitForEvent("download"), page.click("[data-testid=dl-md]")]);
  const md = readFileSync((await dl.path())!, "utf8");
  assert.match(md, /아파트 입지·가격 검토 요약/);
  assert.match(md, /자동 수집·자동 검증 기능은 없음/);
  await page.emulateMedia({ media: "print" });
  assert.ok((await page.pdf()).length > 1000);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("[2] 전체 삭제·재가져오기·재분석 반복: 화면이 깨지지 않고 ‘이전 결과·재분석 필요’ 표시, 중복 집계 없음", async () => {
  const ctx = await browser.newContext();
  const page = stepAware(await ctx.newPage());
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await startWith(page, APP);
  await open(page, "sec-market");
  for (let round = 0; round < 2; round++) {
    await page.setInputFiles("[data-testid=csv-import]", CSV);
    await page.waitForFunction(() => /신규/.test(document.querySelector("[data-testid=market-msg]")?.textContent ?? ""));
    await page.setInputFiles("[data-testid=csv-import]", CSV);
    await page.waitForFunction(() => /신규 0/.test(document.querySelector("[data-testid=market-msg]")?.textContent ?? ""));
    const msg = await page.textContent("[data-testid=market-msg]");
    assert.match(msg ?? "", /중복 533/);
    await page.click("[data-testid=rerun]");
    await page.click("[data-testid=delete-all-tx]");
    await page.waitForSelector("[data-testid=stale-banner]");
    assert.equal(await page.locator("[data-testid=summary]").count(), 1);
    await openSec(page, "sec-results");
    assert.ok((await page.locator("[data-testid=complex-table] tbody tr").count()) > 1); // 이전 결과(스냅샷) 표시 유지
    await open(page, "sec-report");
    assert.match(await page.textContent("[data-testid=report-preview]") ?? "", /요약/);
    await page.click("[data-testid=rerun]");
    assert.equal(await page.locator("[data-testid=stale-banner]").count(), 0);
  }
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("[모의 응답] 자동 조회 2회: 두 번째는 신규 0·중복 전량, 부분 실패 시 누락 가능 표시", async () => {
  const ctx = await browser.newContext();
  const page = stepAware(await ctx.newPage());
  await startWith(page, KEYED, "경기도 성남시 시험로 1");
  await open(page, "sec-market");
  const colText = await page.textContent("[data-testid=collection-report]") ?? "";
  assert.match(colText, /거래 응답 수집·건수 대사: 완료/);
  assert.match(colText, /주변 행정구역 탐색: 표본 지점 확인\(경계 전체 보장 아님\)/);
  assert.match(colText, /단지 좌표 확인/);
  await page.click("[data-testid=public-lookup]");
  await page.waitForSelector("[data-testid=market-msg]");
  assert.match(await page.textContent("[data-testid=market-msg]") ?? "", /신규 0.*중복/);
  mockState.failYm = "202610";
  await page.click("[data-testid=public-lookup]");
  await page.waitForFunction(() => /일부만 수집/.test(document.querySelector("[data-testid=market-msg]")?.textContent ?? ""));
  mockState.failYm = "";
  await page.click("[data-testid=rerun]");
  assert.match(await page.textContent("[data-testid=summary-uncertainty]") ?? "", /거래 응답 수집·건수 대사 미완료/);
  await ctx.close();
});

test("[5] 저장소 차단: 성공으로 처리하지 않고 오류와 JSON 내보내기 대안 표시", async () => {
  const ctx = await browser.newContext();
  await ctx.addInitScript(() => {
    Object.defineProperty(window, "localStorage", { get() { throw new DOMException("blocked", "SecurityError"); } });
  });
  const page = stepAware(await ctx.newPage());
  await page.goto(`${APP}/app`);
  await page.waitForSelector("[data-testid=storage-blocked]");
  await page.click("[data-testid=load-demo]");
  await page.waitForSelector("[data-testid=summary]");
  const before = page.url();
  await page.click("[data-testid=save-browser]");
  await page.waitForSelector("[data-testid=save-error]");
  assert.match(await page.textContent("[data-testid=save-error]") ?? "", /저장되지 않았습니다.*JSON/);
  assert.equal(page.url(), before);
  await ctx.close();
});

test("모바일 화면(390×844): 가로 넘침 없이 요약·대표 비교단지 표시", async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = stepAware(await ctx.newPage());
  await page.goto(`${APP}/app`);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "첫 화면 가로 넘침");
  await page.click("[data-testid=load-demo]");
  await page.waitForSelector("[data-testid=summary]");
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "결과 화면 가로 넘침");
  await page.screenshot({ path: join(tmpdir(), "la-mobile.png"), fullPage: false });
  await ctx.close();
});

test("[대기 기능] 하네스 버튼 1회 → 새 탭(opener null) → 자동 분석 1회, 원본 저장·협의체 요청 0건", async () => {
  const ctx = await browser.newContext();
  const page = stepAware(await ctx.newPage());
  await page.goto(`http://127.0.0.1:${HARNESS_PORT}/`);
  const [tab0] = await Promise.all([ctx.waitForEvent("page"), page.click("[data-testid=launch-button]")]);
  const tab = stepAware(tab0);
  await tab.waitForSelector("[data-testid=summary]");
  assert.equal(await tab.evaluate(() => window.opener), null);
  assert.match(tab.url(), /\/app\/a\/an_/);
  assert.match(await tab.textContent("[data-testid=run-info]") ?? "", /#1/);
  assert.equal(harness.hits.length, 0);
  await ctx.close();
});
