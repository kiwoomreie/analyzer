// [3] 조회 중 편집 보존 — 지연된 모의 응답·연속 조회(브라우저). 실제 공공 API 호출 아님.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { chromium, type Browser, type Page } from "playwright";
import { createApp, type App } from "../../server/app.ts";
import { loadConfig } from "../../server/config.ts";
import { mockState, mockTransport } from "../helpers/mockPublicApi.ts";
import { openSec, reveal, stepAware } from "../helpers/stepAware.ts";

const PORT = 5277, BASE = `http://localhost:${PORT}`;
let app: App, browser: Browser;
before(async () => {
  app = createApp(loadConfig({ DB_PATH: join(mkdtempSync(join(tmpdir(), "la-v05-")), "k.db"), WEB_ROOT: "dist/web", MOLIT_SERVICE_KEY: "fake", KAKAO_REST_KEY: "fake", PUBLIC_DATA_MAX_MONTHS: "1" } as any),
    { logger: () => {}, publicDataDeps: { lookup: (_h, cb) => cb(null, [{ address: "203.0.113.10", family: 4 }]), transport: mockTransport } });
  await new Promise<void>((r) => app.server.listen(PORT, "127.0.0.1", r));
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined });
});
after(async () => { mockState.delayMs = 0; await browser.close(); await app.close(); });

const open = openSec;

async function start(page: Page) {
  await page.goto(`${BASE}/app`);
  await page.fill("[data-testid=new-address]", "경기도 성남시 시험로 1");
  await page.click("[data-testid=start]");
  await page.waitForSelector("[data-testid=summary]");
  await open(page, "sec-input");
  await open(page, "sec-market");
}

test("[3-재현] 조회 응답을 기다리는 동안 바꾼 검토가격·제외 사유를 오래된 사본으로 덮어쓰지 않음", async () => {
  const page = stepAware(await (await browser.newContext()).newPage());
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await start(page);
  await page.click("[data-testid=price-toggle]");
  await page.fill("[data-testid=f-price]", "8");
  mockState.delayMs = 120;
  await page.click("[data-testid=public-lookup]");
  await page.fill("[data-testid=f-price]", "9.9");
  await page.locator("[data-testid=tx-table] tbody tr").first().locator("input").fill("사용자 제외 시험");
  await page.waitForFunction(() => !/조회 중/.test(document.querySelector("[data-testid=public-lookup]")?.textContent ?? ""), null, { timeout: 30000 });
  mockState.delayMs = 0;
  await page.waitForTimeout(600);
  assert.equal(await page.inputValue("[data-testid=f-price]"), "9.9");
  assert.equal(await page.locator("[data-testid=tx-table] tbody tr").first().locator("input").inputValue(), "사용자 제외 시험");
  assert.match(await page.textContent("[data-testid=market-msg]") ?? "", /신규 0.*중복/);
  assert.deepEqual(errors, []);
});

test("[3] 조회 중 주소를 바꾸면 이전 주소의 응답은 적용 보류(충돌 안내), 연속 조회도 중복 없이 동작", async () => {
  const page = stepAware(await (await browser.newContext()).newPage());
  await start(page);
  const count0 = await page.locator("[data-testid=tx-table] tbody tr").count();
  mockState.delayMs = 120;
  await page.click("[data-testid=public-lookup]");
  await page.fill("[data-testid=f-address]", "경기도 성남시 다른로 9");
  await page.waitForSelector("[data-testid=lookup-held]", { timeout: 30000 });
  mockState.delayMs = 0;
  assert.match(await page.textContent("[data-testid=lookup-held]") ?? "", /주소.*바뀌어.*보류/);
  assert.equal(await page.inputValue("[data-testid=f-address]"), "경기도 성남시 다른로 9");
  await page.click("[data-testid=lookup-discard]");
  for (let i = 0; i < 2; i++) {
    await page.click("[data-testid=public-lookup]");
    await page.waitForFunction(() => /받은/.test(document.querySelector("[data-testid=market-msg]")?.textContent ?? ""));
    await page.waitForFunction(() => !/조회 중/.test(document.querySelector("[data-testid=public-lookup]")?.textContent ?? ""));
  }
  assert.equal(await page.locator("[data-testid=tx-table] tbody tr").count(), count0);
  assert.equal(await page.inputValue("[data-testid=f-address]"), "경기도 성남시 다른로 9");
});

test("[1] 저장 원문 손상: 첫 화면 경고·원문 내보내기, 새 저장은 차단되고 원문 유지(브라우저)", async () => {
  const ctx = await browser.newContext({ acceptDownloads: true });
  await ctx.addInitScript(() => { if (!sessionStorage.getItem("__seeded")) { localStorage.setItem("location-analyzer.saved.v1", '{"lc_a": BROKEN'); sessionStorage.setItem("__seeded", "1"); } });
  const page = stepAware(await ctx.newPage());
  await page.goto(`${BASE}/app`);
  await page.waitForSelector("[data-testid=store-unreadable]");
  const [dl] = await Promise.all([page.waitForEvent("download"), page.click("[data-testid=export-raw]")]);
  assert.ok(dl);
  await page.click("[data-testid=load-demo]");
  await page.waitForSelector("[data-testid=summary]");
  await page.click("[data-testid=save-browser]");
  await page.waitForSelector("[data-testid=save-error]");
  assert.match(await page.textContent("[data-testid=save-error]") ?? "", /쓰기 차단/);
  assert.equal(await page.evaluate(() => localStorage.getItem("location-analyzer.saved.v1")), '{"lc_a": BROKEN');
  await ctx.close();
});

test("[1] 일부 기록 손상: 정상 기록은 열리고 저장 후에도 손상 기록 원문 유지(브라우저)", async () => {
  const ctx = await browser.newContext();
  const page = stepAware(await ctx.newPage());
  await page.goto(`${BASE}/app`);
  await page.click("[data-testid=load-demo]");
  await page.waitForSelector("[data-testid=summary]");
  await page.click("[data-testid=save-browser]");
  await page.waitForURL(/\/app\/l\//);
  await page.evaluate(() => { const k = "location-analyzer.saved.v1"; const o = JSON.parse(localStorage.getItem(k)!); o.lc_bad = { key: "lc_bad", working: "망가짐" }; localStorage.setItem(k, JSON.stringify(o)); });
  await page.goto(`${BASE}/app`);
  await page.waitForSelector("[data-testid=store-partial]");
  assert.equal(await page.locator("[data-testid=local-list] tbody tr").count(), 1);
  await page.click("[data-testid=open-local]");
  await page.waitForSelector("[data-testid=summary]");
  await page.click("[data-testid=rerun]");
  await page.waitForTimeout(600);
  const raw = await page.evaluate(() => JSON.parse(localStorage.getItem("location-analyzer.saved.v1")!));
  assert.deepEqual(raw.lc_bad, { key: "lc_bad", working: "망가짐" });
  await ctx.close();
});

test("API 키 없을 때 제한 기능을 화면에 표시, 가상 예시로 입력→분석→저장→재열기→보고서", async () => {
  const keyless = createApp(loadConfig({ DB_PATH: join(mkdtempSync(join(tmpdir(), "la-kl-")), "k.db"), WEB_ROOT: "dist/web" } as any), { logger: () => {} });
  await new Promise<void>((r) => keyless.server.listen(5278, "127.0.0.1", r));
  const ctx = await browser.newContext({ acceptDownloads: true });
  const page = stepAware(await ctx.newPage());
  await page.goto("http://localhost:5278/app");
  const lim = await page.textContent("[data-testid=key-limits]") ?? "";
  assert.match(lim, /주소 → 좌표 자동 변환.*사용 불가/);
  assert.match(lim, /실거래 자동 수집.*사용 불가/);
  await page.fill("[data-testid=new-address]", "서울특별시 어딘가 1");
  await page.click("[data-testid=start]");
  await page.waitForSelector("[data-testid=summary]");
  await open(page, "sec-input");
  await page.fill("[data-testid=f-area]", "84");
  await open(page, "sec-market");
  await page.click("[data-testid=add-sample]");
  await page.click("[data-testid=rerun]");
  assert.ok((await page.locator("[data-testid=comparables] tbody tr").count()) >= 1);
  await page.click("[data-testid=save-browser]");
  await page.waitForURL(/\/app\/l\//);
  await page.reload();
  await open(page, "sec-input");
  assert.equal(await page.inputValue("[data-testid=f-area]"), "84");
  await open(page, "sec-report");
  assert.match(await page.textContent("[data-testid=report-preview]") ?? "", /가상/);
  await ctx.close();
  await keyless.close();
});

test('첫 화면에서 B 조회가 먼저 완료되면 지연된 A 응답으로 다시 열거나 저장하지 않는다', async () => {
  const page=await browser.newPage({reducedMotion:'reduce'});
  let release!: () => void;
  const gate=new Promise<void>(resolve=>{release=resolve;});
  let arrived!: () => void;
  const started=new Promise<void>(resolve=>{arrived=resolve;});
  try {
    await page.route('**/api/public-data/lookup',async route=>{
      if (route.request().postDataJSON().address==='[가상] A') {
        arrived();
        await gate;
      }
      await route.continue();
    });
    await page.goto(BASE+'/app');
    await page.getByTestId('new-address').fill('[가상] A');
    await page.getByTestId('start').click();
    await started;
    await page.getByTestId('new-address').fill('[가상] B');
    await page.getByTestId('start').click();
    await page.getByTestId('hero').waitFor();
    const current=page.url();
    const completed=page.waitForResponse(r=>r.url().endsWith('/api/public-data/lookup') && r.request().postDataJSON().address==='[가상] A');
    release();
    await (await completed).finished();
    await page.waitForFunction(()=>document.querySelector('[data-testid=f-address]') !== null);
    assert.equal(page.url(),current);
    assert.equal(await page.getByTestId('f-address').inputValue(),'[가상] B');
    await page.getByTestId('go-home').click();
    assert.equal(await page.getByRole('button',{name:'[가상] A',exact:true}).count(),0);
    assert.equal(await page.getByRole('button',{name:'[가상] B',exact:true}).count(),1);
  } finally {release(); await page.close();}
});
