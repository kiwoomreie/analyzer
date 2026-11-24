// 서버 없는 웹 버전(dist/preview, GitHub Pages와 같은 정적 파일)으로 전체 흐름 시험 — PC·390px.
// 주소 → CSV(가상) → 입지 사건 JSON(가상) → 영향권·비교군 설정 → 분석 → 저장·다시 열기 → 보고서.
// 실제 국토부·카카오 호출 없음(자동 조회는 ‘미설정’으로 표시되는지만 확인).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { readFileSync, writeFileSync } from "node:fs";
import { chromium, type Browser, type Page } from "playwright";
import { observeGroups } from "../../shared/observation.ts";
import { fmtExclusivePyeong, fmtMan, fmtPp } from "../../shared/units.ts";
import { fmtChange } from "../../shared/priceView.ts";
import { openSec, reveal, stepAware } from "../helpers/stepAware.ts";

const PORT = 5293, BASE = `http://localhost:${PORT}`;
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

const open = openSec;
const shot = async (page: Page, name: string, sel?: string) => { const dir = process.env.SHOT_DIR; if (!dir) return; if (sel) await page.locator(sel).screenshot({ path: `${dir}/${name}.png` }); else await page.screenshot({ path: `${dir}/${name}.png`, fullPage: false }); };

for (const [vp, size] of [["pc", { width: 1440, height: 900 }], ["m390", { width: 390, height: 844 }]] as const) {
  test(`[${vp}] 주소 → CSV → 사건 → 영향권·비교군 → 분석 → 저장·재열기 → 보고서`, async () => {
    const ctx = await browser.newContext({ viewport: size, acceptDownloads: true });
    const page = stepAware(await ctx.newPage());
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(BASE);
    // 자동 조회 미설정 표시(흉내 내지 않음)
    assert.match(await page.locator("[data-testid=key-limits]").innerText(), /실거래 자동 수집[\s\S]*사용 불가/);
    await page.fill("[data-testid=new-address]", "[가상] 누리시 가람동 100");
    await page.click("[data-testid=start]");
    await page.waitForSelector("[data-testid=summary]");
    // 면적·검토가격 없을 때: 가격 비교만 보류
    assert.match(await page.locator("[data-testid=price-current]").innerText(), /보류/);
    assert.match(await page.locator("[data-testid=obs-summary]").innerText(), /영향권·비교군 미설정/);

    await open(page, "sec-input");
    await page.fill("[data-testid=f-area]", "84");
    await page.locator("#sec-input [data-testid=coord-input]").fill("37.412, 127.126");
    await page.locator("#sec-input [data-testid=coord-input]").press("Tab");
    await open(page, "sec-market");
    assert.equal(await page.isDisabled("[data-testid=public-lookup]"), true, "키 없으면 자동 조회 비활성");
    await page.setInputFiles("[data-testid=csv-import]", CSV);
    await page.waitForSelector("[data-testid=market-msg]");
    await open(page, "sec-events");
    await page.locator("#sec-events input[type=file]").first().setInputFiles(EVENTS);
    await page.waitForSelector("[data-testid=events-msg]");

    // 영향권·비교군 설정
    const panel = page.locator("[data-testid=observation-panel]");
    await panel.locator("[data-testid=obs-event]").selectOption({ label: "[가상] 가람선 누리역 신설" });
    await panel.locator("[data-testid=obs-milestone]").selectOption({ label: "고시 · 2024-02-20" });
    await panel.locator("[data-testid=obs-months]").selectOption("12");
    for (const row of await panel.locator("[data-testid=obs-groups] tbody tr").all()) {
      await row.locator("details > summary").click();
      await row.locator("input[placeholder]").fill("37.413, 127.127");
      await row.locator("input[placeholder]").press("Tab");
    }
    for (const n of ["[가상]가람마을 1단지", "[가상]가람마을 2단지", "[가상]누리숲 아파트"]) await panel.getByRole("checkbox", { name: `${n} 영향권`, exact: true }).check();
    for (const n of ["[가상]동편마을 A", "[가상]은빛마을"]) await panel.getByRole("checkbox", { name: `${n} 비교군`, exact: true }).check();
    assert.match(await panel.locator("[data-testid=obs-run-status]").innerText(), /그룹 관측이 없습니다|다릅니다/);
    await page.click("[data-testid=rerun]");
    await page.waitForSelector("[data-testid=obs-diff], [data-testid=obs-diff-hidden]");

    // 화면 숫자 = 같은 입력으로 계산한 관측값
    await page.click("[data-testid=save-browser]");
    await page.waitForFunction(() => location.hash.startsWith("#/app/l/"));
    await page.waitForTimeout(500);
    const key = (await page.evaluate(() => location.hash)).split("/").pop()!;
    const saved = await page.evaluate((k) => JSON.parse(localStorage.getItem("location-analyzer.saved.v1")!)[k], key);
    if (process.env.SAVE_WORKING_TO) writeFileSync(`${process.env.SAVE_WORKING_TO}-${vp}.json`, JSON.stringify(saved.working));
    const g = observeGroups(saved.working);
    const runG = saved.runs.at(-1).result.groupObservation;
    assert.equal(JSON.stringify(runG.impact), JSON.stringify(g.impact), "실행본 저장값 = 재계산값");
    const sum = await page.locator("[data-testid=obs-summary]").innerText();
    const sumText = await page.locator("[data-testid=obs-summary]").textContent();
    assert.ok(sum.includes(`영향권 ${fmtChange(g.impact.changePct)}`), `영향권 변동률 ${fmtChange(g.impact.changePct)}`);
    assert.ok(sum.includes(`비교군 ${fmtChange(g.control.changePct)}`));
    assert.ok(sum.includes(`${fmtExclusivePyeong(g.impact.pre.medianPerM2)} → ${fmtExclusivePyeong(g.impact.post.medianPerM2)}`));
    assert.ok(sum.includes(`전 ${g.impact.pre.count}건·후 ${g.impact.post.count}건`));
    if (g.valid) assert.match(sum, new RegExp(`비교군 대비 관측 차이 ${fmtPp(g.differencePp).replace("+", "\\+")}`));
    else assert.match(sum, /차이를 표시하지 않습니다/);
    assert.match(sum, /가상 자료/);
    await shot(page, `summary-${vp}`, "[data-testid=summary-price]");

    // 다시 열기
    await page.reload();
    await page.waitForSelector("[data-testid=summary]");
    assert.equal(await page.locator("[data-testid=obs-summary]").textContent(), sumText, "다시 열어도 같은 결과");
    await open(page, "sec-market");
    await page.locator("[data-testid=obs-usage] > summary").click();
    assert.match(await page.locator("[data-testid=obs-usage]").innerText(), /가격 기준: 전용㎡당 거래가[\s\S]*사용/);
    await shot(page, `usage-${vp}`, "[data-testid=observation-panel]");

    // 보고서
    await open(page, "sec-report");
    const md = await page.locator("[data-testid=report-preview]").innerText();
    assert.match(md, /### 2-1\. 현재 검토가격 비교[\s\S]*검토가격: 미입력[\s\S]*### 2-2\. 입지 사건 전후 관측/);
    assert.match(md, /수동 확인 그룹 관측 \(실행 #2 입력 기준/);
    assert.match(md, /### F\. 수동 확인 그룹 사용·제외 단지/);

    // 입력 변경 → 이전 결과·재분석 필요, 보고서는 실행본 유지
    await panel.locator("[data-testid=obs-months]").selectOption("3");
    await page.waitForSelector("[data-testid=stale-banner]");
    assert.equal(await page.locator("[data-testid=obs-summary]").textContent(), sumText, "요약은 실행본 기준 유지");
    assert.match(await page.locator("[data-testid=report-preview]").innerText(), /실행 #2 입력 기준/);
    const over = await page.evaluate(() => { const w = innerWidth; return [document.documentElement.scrollWidth - w, [...document.querySelectorAll("body *")].filter((e) => e.getBoundingClientRect().right > w + 1 && !e.parentElement?.closest(".tbl,pre")).slice(0, 6).map((e) => `${e.tagName}.${e.className}|${(e.textContent ?? "").slice(0, 40)}`)]; });
    assert.equal(over[0], 0, `가로 넘침 없음 ${JSON.stringify(over[1])}`);
    await shot(page, `view-${vp}`);
    assert.deepEqual(errors, []);
    await ctx.close();
  });
}
