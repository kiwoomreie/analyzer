// v0.8 단계 화면(서버 없는 웹 버전, GitHub Pages와 같은 정적 파일) — PC·390px
// 주소 → ①자료 → ②비교군 → ③결과 → 근거 열기·복귀 → ④저장·재열기 → 보고서, 뒤로 가기, 모션 줄이기,
// 실행 1 인용 근거 보존(거래 삭제·재실행·새로고침·JSON 복원 후), 과거 저장본 ‘당시 근거 상세 미보존’.
// 실제 국토부·카카오 호출 없음.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { readFileSync, writeFileSync } from "node:fs";
import { chromium, type Browser, type Page } from "playwright";
import { newManualRecord } from "../../shared/model.ts";
import { withRun } from "../../shared/runs.ts";
import { demoWorking } from "../../shared/demo.ts";

const PORT = 5296, BASE = `http://localhost:${PORT}`;
const CSV = "examples/sample-data/demo-nearby-trades.csv";
const EVENTS = "examples/sample-data/demo-location-events.json";
let server: Server, browser: Browser;
before(async () => {
  const html = readFileSync("dist/preview/index.html");
  server = createServer((_q, r) => { r.writeHead(200, { "content-type": "text/html; charset=utf-8" }); r.end(html); });
  await new Promise<void>((r) => server.listen(PORT, "127.0.0.1", r));
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined });
});
after(async () => { await browser.close(); server.close(); });

const shot = async (page: Page, name: string) => { if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/${name}.png` }); };
const visibleStep = (page: Page) => page.evaluate(() => (document.querySelector(".step-panel:not([hidden])") as HTMLElement | null)?.dataset.step);
const ensureOpen = async (page: Page, id: string) => { if ((await page.locator(`#${id}`).getAttribute("open")) === null) await page.locator(`#${id} > summary`).click(); };

for (const [vp, size] of [["pc", { width: 1340, height: 920 }], ["m390", { width: 390, height: 844 }]] as const) {
  test(`[${vp}] 주소 → 자료 → 비교군 → 결과 → 근거 열기·복귀 → 저장·재열기 → 보고서, 뒤로 가기`, async () => {
    const ctx = await browser.newContext({ viewport: size });
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(BASE);
    await shot(page, `${vp}-00-home`);
    // 첫 화면: 주소 입력이 중심, ‘분석 시작’이 가장 눈에 띄는 버튼
    const startBg = await page.locator("[data-testid=start]").evaluate((b) => getComputedStyle(b).backgroundColor);
    assert.notEqual(startBg, "rgba(0, 0, 0, 0)");
    await page.fill("[data-testid=new-address]", "[가상] 누리시 가람동 100");
    await page.click("[data-testid=start]");
    await page.waitForSelector("[data-testid=hero]");
    assert.equal(await visibleStep(page), "1");
    // 상단 요약: 없는 값은 ‘미입력’
    const meta = await page.locator("[data-testid=meta]").innerText();
    assert.match(meta, /주소\s*\[가상\] 누리시 가람동 100/);
    assert.match(meta, /전용면적\s*미입력/);
    assert.match(meta, /검토가격\s*미입력/);

    // ① 대상·자료
    await ensureOpen(page, "sec-input");
    await page.fill("[data-testid=f-area]", "84");
    assert.equal(await page.isDisabled("[data-testid=public-lookup]"), true, "키 없으면 자동 조회 미설정");
    await page.setInputFiles("[data-testid=csv-import]", CSV);
    await page.waitForSelector("[data-testid=market-msg]");
    assert.match(await page.locator("[data-testid=meta]").innerText(), /전용면적\s*84㎡/);
    await shot(page, `${vp}-01-data`);

    // ② 입지·비교 조건
    await page.click("[data-testid=step-next]");
    assert.equal(await visibleStep(page), "2");
    await ensureOpen(page, "sec-events");
    await page.locator("#sec-events input[type=file]").first().setInputFiles(EVENTS);
    await page.waitForSelector("[data-testid=events-msg]");
    const panel = page.locator("[data-testid=observation-panel]");
    await panel.locator("[data-testid=obs-event]").selectOption({ label: "[가상] 가람선 누리역 신설" });
    await panel.locator("[data-testid=obs-milestone]").selectOption({ label: "고시 · 2024-02-20" });
    await panel.locator("[data-testid=obs-months]").selectOption("12");
    for (const n of ["[가상]가람마을 1단지", "[가상]가람마을 2단지", "[가상]누리숲 아파트"]) await panel.getByRole("checkbox", { name: `${n} 영향권`, exact: true }).check();
    for (const n of ["[가상]동편마을 A", "[가상]은빛마을"]) await panel.getByRole("checkbox", { name: `${n} 비교군`, exact: true }).check();
    const sel = await panel.locator("[data-testid=obs-selection]").innerText();
    assert.match(sel, /영향권 3곳 · 거래 \d+건/);
    assert.match(sel, /비교군 2곳 · 거래 \d+건/);
    assert.match(sel, /중복 없음/);
    await shot(page, `${vp}-02-conditions`);

    // 뒤로 가기(브라우저) → ①, 입력 보존 → 앞으로 → ②, 선택 보존
    await page.goBack();
    await page.waitForFunction(() => (document.querySelector(".step-panel:not([hidden])") as HTMLElement | null)?.dataset.step === "1");
    assert.equal(await page.inputValue("[data-testid=f-area]"), "84");
    await page.goForward();
    await page.waitForFunction(() => (document.querySelector(".step-panel:not([hidden])") as HTMLElement | null)?.dataset.step === "2");
    assert.match(await panel.locator("[data-testid=obs-selection]").innerText(), /영향권 3곳/);

    // ③ 분석 결과
    await page.click("[data-testid=step-next]"); // 분석 실행하고 결과 보기
    assert.equal(await visibleStep(page), "3");
    await page.waitForSelector("[data-testid=obs-diff], [data-testid=obs-diff-hidden]");
    const sum = await page.locator("[data-testid=obs-summary]").innerText();
    assert.match(sum, /비교군 대비 관측 차이 \+5\.9%p/);
    await shot(page, `${vp}-03-result`);

    // 근거 열기·복귀: [입지-01] → 상세 패널 → 닫으면 같은 버튼·스크롤 위치
    const btn = page.locator("[data-testid=summary-location] [data-cite='입지-01']");
    await btn.scrollIntoViewIfNeeded();
    const y0 = await page.evaluate(() => window.scrollY);
    await btn.click();
    await page.waitForSelector("[data-testid=evidence-drawer]");
    assert.match(await page.locator("[data-testid=evidence-body]").innerText(), /발표|고시/);
    await page.waitForTimeout(400);
    assert.equal(await page.evaluate(() => { const d = document.querySelector(".drawer")!.getBoundingClientRect(); const el = document.elementFromPoint(d.left + d.width / 2, 40); return !!el?.closest(".drawer"); }), true, "근거 패널이 상단 위에 표시");
    await shot(page, `${vp}-04-evidence`);
    await page.click("[data-testid=evidence-close]");
    await page.waitForSelector("[data-testid=evidence-drawer]", { state: "detached" });
    assert.equal(await page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset?.cite), "입지-01", "닫으면 누른 버튼으로 포커스 복귀");
    assert.ok(Math.abs((await page.evaluate(() => window.scrollY)) - y0) < 4, "스크롤 위치 복귀");

    // ④ 보고서·저장 → 다시 열기
    await page.click("[data-testid=step-next]");
    assert.equal(await visibleStep(page), "4");
    await page.click("[data-testid=save-browser-4]");
    await page.waitForFunction(() => location.hash.startsWith("#/app/l/"));
    await page.reload();
    await page.waitForSelector("[data-testid=hero]");
    assert.equal(await visibleStep(page), "4", "다시 열면 보던 단계");
    const md = await page.locator("[data-testid=report-preview]").innerText();
    assert.match(md, /비교군 대비 관측 차이 \+5\.9%p/);
    assert.match(md, /### G\. 인용 근거\(이 실행 시점 기록\)[\s\S]*\[입지-01\]/);
    await shot(page, `${vp}-05-report`);
    await page.click("[data-testid=step-3]");
    assert.equal(await page.locator("[data-testid=obs-summary]").innerText(), sum, "다시 열어도 같은 숫자");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), 0, "가로 넘침 없음");
    assert.deepEqual(errors, []);
    await ctx.close();
  });
}

test("실행 1 인용은 거래 삭제·재실행·새로고침·JSON 복원 후에도 그대로(브라우저)", async () => {
  const ctx = await browser.newContext({ acceptDownloads: true });
  const page = await ctx.newPage();
  await page.goto(BASE);
  await page.click("[data-testid=load-demo-top]");
  await page.waitForSelector("[data-testid=hero]");
  await page.click("[data-testid=step-3]");
  await page.click("[data-testid=summary-price] [data-cite='실거래-01']");
  await page.waitForSelector("[data-testid=evidence-trades]");
  const run1Trades = await page.locator("[data-testid=evidence-trades]").innerText();
  await page.click("[data-testid=evidence-close]");
  // 저장 후 거래 전체 삭제·재실행(실행 2)
  await page.click("[data-testid=save-browser]");
  await page.waitForFunction(() => location.hash.startsWith("#/app/l/"));
  await page.waitForSelector("[data-testid=hero]");
  await page.click("[data-testid=step-1]");
  await page.click("[data-testid=delete-all-tx]");
  await page.click("[data-testid=rerun]");
  await page.click("[data-testid=step-4]");
  await page.waitForSelector("[data-testid=run-row-2]");
  const openRun1 = async () => {
    await page.click("[data-testid=step-4]");
    await page.click("[data-testid='run-1-cite-실거래-01']");
    await page.waitForSelector("[data-testid=evidence-trades]");
    const t = await page.locator("[data-testid=evidence-trades]").innerText();
    await page.click("[data-testid=evidence-close]");
    return t;
  };
  assert.equal(await openRun1(), run1Trades, "실행 2 이후");
  await page.reload();
  await page.waitForSelector("[data-testid=hero]");
  assert.equal(await openRun1(), run1Trades, "새로고침 후");
  // JSON 내보내기 → 저장 목록 비우기 → 복원
  const [dl] = await Promise.all([page.waitForEvent("download"), page.click("[data-testid=export-json]")]);
  const file = "/tmp/la-v08-backup.json";
  writeFileSync(file, readFileSync(await dl.path()));
  await page.evaluate(() => localStorage.removeItem("location-analyzer.saved.v1"));
  await page.click("[data-testid=go-home]");
  await page.setInputFiles("[data-testid=file-import]", file);
  await page.waitForSelector("[data-testid=open-local]");
  await page.click("[data-testid=open-local]");
  await page.waitForSelector("[data-testid=hero]");
  assert.equal(await openRun1(), run1Trades, "JSON 복원 후");
  await ctx.close();
});

test("과거 저장본(인용 보존 이전)은 근거 버튼을 눌러도 ‘당시 근거 상세 미보존’", async () => {
  const page = await browser.newPage();
  const rec = withRun(newManualRecord("lc_old", demoWorking(), "demo"), "manual");
  delete (rec.runs[0].result as any).citations;
  await page.goto(BASE);
  await page.evaluate((r) => localStorage.setItem("location-analyzer.saved.v1", JSON.stringify({ [r.key]: r })), rec);
  await page.goto(`${BASE}/#/app/l/lc_old`);
  await page.waitForSelector("[data-testid=hero]");
  await page.click("[data-testid=step-3]");
  await page.click("[data-testid=summary-price] [data-cite='실거래-01']");
  await page.waitForSelector("[data-testid=evidence-missing]");
  assert.match(await page.locator("[data-testid=evidence-missing]").innerText(), /당시 근거 상세 미보존/);
  await page.close();
});

test("모션 줄이기 설정: 단계·근거 패널 애니메이션 없음, 흐름은 그대로", async () => {
  const ctx = await browser.newContext({ reducedMotion: "reduce", viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.goto(BASE);
  await page.fill("[data-testid=new-address]", "[가상] 시험시 1");
  await page.click("[data-testid=start]");
  await page.waitForSelector("[data-testid=hero]");
  const anim = await page.evaluate(() => [getComputedStyle(document.querySelector(".step-panel:not([hidden])")!).animationName, getComputedStyle(document.querySelector(".deal-head")!).animationName]);
  assert.deepEqual(anim, ["none", "none"]);
  await page.click("[data-testid=step-next]");
  assert.equal(await visibleStep(page), "2");
  await ctx.close();
});
