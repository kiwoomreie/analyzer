// 브라우저 시험(Chromium, 로컬 http). 실제 공공 API 호출은 검증하지 않는다.
// v0.6 검토 지적: 기존 전후 관찰 표 복원, 실행·보고서 연결, 선택 단지 소실 표시, 단위·내부키, 자동 저장 즉시 반영
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium, type Browser, type Page } from "playwright";
import { createApp, type App } from "../../server/app.ts";
import { loadConfig } from "../../server/config.ts";
import { newManualRecord, type AnalysisRecord } from "../../shared/model.ts";
import { withRun } from "../../shared/runs.ts";
import { fixture } from "../helpers/observationFixture.ts";
import { openSec, reveal, stepAware } from "../helpers/stepAware.ts";

const PORT = 5285, BASE = `http://localhost:${PORT}`;
let app: App, browser: Browser;
before(async () => {
  app = createApp(loadConfig({ DB_PATH: ":memory:", WEB_ROOT: "dist/web" } as any), { logger: () => {} });
  await new Promise<void>((r) => app.server.listen(PORT, "127.0.0.1", r));
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined });
});
after(async () => { await browser.close(); await app.close(); });

async function openSaved(page: Page, rec: AnalysisRecord) {
  await page.goto(`${BASE}/app`);
  await page.evaluate((r) => localStorage.setItem("location-analyzer.saved.v1", JSON.stringify({ [r.key]: r })), rec);
  await page.goto(`${BASE}/app/l/${rec.key}`);
  await page.waitForSelector("[data-testid=summary]");
  if ((await page.locator("#sec-market").getAttribute("open")) === null) await page.locator("#sec-market > summary").click();
  await page.waitForSelector("[data-testid=observation-panel]");
}
const saved = (page: Page, key: string) => page.evaluate((k) => JSON.parse(localStorage.getItem("location-analyzer.saved.v1")!)[k], key);

test("기존 전후 관찰 표·새 그룹 패널 공존, 실행 기준 안내, 다시 실행 후 보고서 포함, 단위·내부키", async () => {
  const ctx = await browser.newContext();
  const page = stepAware(await ctx.newPage());
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const w = fixture();
  w.transactions.forEach((t) => { t.source = "가상 CSV"; });
  // v0.5.2 이전처럼 그룹 관측 없이 실행된 기록에 이후 설정이 추가된 상태
  const base = withRun(newManualRecord("lc_e1", { ...w, observation: undefined }), "manual");
  const rec = { ...base, working: w };
  await openSaved(page, rec);

  await openSec(page, "sec-results");
  assert.equal(await page.locator("[data-testid=observed-table]").count(), 1, "기존 입지 사건 전후 관찰 표 복원");
  assert.match(await page.locator("#sec-results").innerText(), /마지막 분석 실행 #1 기준/);
  assert.match(await page.locator("[data-testid=obs-run-status]").innerText(), /마지막 분석 실행\(#1\)에는 그룹 관측이 없습니다/);
  const panel = await page.locator("[data-testid=observation-panel]").innerText();
  assert.match(panel, /100만원/);
  assert.match(panel, /120만원/);
  assert.match(await page.locator("[data-testid=obs-difference]").innerText(), /\+10\.0%p/);
  assert.match(await page.locator("[data-testid=obs-basis]").innerText(), /분석 기준일 2026-11-01 · 단위 만원\/전용㎡.*출처 가상 CSV/);
  assert.doesNotMatch(panel, /N:A\|/, "내부 식별키를 화면에 노출하지 않음");
  assert.doesNotMatch(await page.locator("[data-testid=obs-warnings]").innerText(), /인과 효과가 아닙니다/, "상시 안내는 접힌 영역으로");
  assert.match(await page.locator("[data-testid=obs-notes] summary").innerText(), /계산 기준·한계/);

  await page.click("[data-testid=rerun]");
  await page.waitForSelector("[data-testid=obs-run-status]:has-text('같은 값입니다')");
  await openSec(page, "sec-report");
  assert.match(await page.locator("[data-testid=report-preview]").innerText(), /수동 확인 그룹 관측 \(실행 #2 입력 기준/);

  // 그룹 변경 → 실행 결과와 다름 안내, 보고서는 실행 #2 값 유지
  await page.click("[data-testid=step-2]"); // 숨은 단계의 체크박스는 접근성 트리에 없어 이름으로 찾을 수 없음
  await page.getByRole("checkbox", { name: "B 비교군", exact: true }).uncheck();
  assert.match(await page.locator("[data-testid=obs-run-status]").innerText(), /마지막 분석 실행\(#2\) 결과와 다릅니다/);
  assert.match(await page.locator("[data-testid=report-preview]").innerText(), /비교군 대비 관측 차이 \+10\.0%p/);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("수정 직후 바로 새로고침해도 마지막 수정이 저장됨(자동 저장 대기분 즉시 반영)", async () => {
  const ctx = await browser.newContext();
  const page = stepAware(await ctx.newPage());
  const rec = withRun(newManualRecord("lc_e2", fixture()), "manual");
  await openSaved(page, rec);
  await page.selectOption("[data-testid=obs-months]", "12");
  await page.reload(); // 0.4초 대기 없이
  await page.waitForSelector("[data-testid=summary]");
  assert.equal((await saved(page, "lc_e2")).working.observation.months, 12);
  if ((await page.locator("#sec-market").getAttribute("open")) === null) await page.locator("#sec-market > summary").click();
  assert.equal(await page.inputValue("[data-testid=obs-months]"), "12");
  // 수정 직후 첫 화면으로 이동해도 저장
  await page.selectOption("[data-testid=obs-months]", "3");
  await page.goto(`${BASE}/app`);
  assert.equal((await saved(page, "lc_e2")).working.observation.months, 3);
  await ctx.close();
});

test("선택했던 단지가 현재 거래에 없으면 ‘현재 거래 없음’ 행·경고 표시, 선택 해제 가능, 삭제 후 다시 저장하지 않음", async () => {
  const ctx = await browser.newContext();
  const page = stepAware(await ctx.newPage());
  const w = fixture();
  w.transactions.forEach((t) => { if (t.complexName === "B") t.sggCd = "11110"; }); // 식별 정보 변경
  const rec = withRun(newManualRecord("lc_e3", w), "manual");
  await openSaved(page, rec);
  const missing = page.locator("[data-testid=obs-groups] tr[data-missing='1']");
  assert.equal(await missing.count(), 1);
  assert.match(await missing.innerText(), /B.*현재 거래 없음[\s\S]*같은 이름 다른 식별: 시군구 11110/);
  assert.match(await page.locator("[data-testid=obs-warnings]").innerText(), /선택했던 단지 1개가 현재 거래 자료에 없습니다/);
  await missing.getByRole("checkbox", { name: "B 비교군", exact: true }).click(); // 해제하면 행이 사라지므로 uncheck() 대신 click
  assert.equal(await missing.count(), 0);
  await page.waitForTimeout(500);
  assert.deepEqual((await saved(page, "lc_e3")).working.observation.control, []);

  // 삭제 직후 화면 이동 때 대기 중 저장이 기록을 되살리지 않음
  await page.selectOption("[data-testid=obs-months]", "12");
  await page.click("[data-testid=delete]");
  await page.waitForURL(`${BASE}/app`);
  await page.waitForTimeout(600);
  const store = await page.evaluate(() => localStorage.getItem("location-analyzer.saved.v1"));
  assert.ok(!JSON.parse(store!)["lc_e3"], "삭제한 기록이 대기 중 저장으로 되살아나면 안 됨");
  await ctx.close();
});

test("모바일 390px: 그룹 패널 가로 넘침 없음", async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = stepAware(await ctx.newPage());
  await openSaved(page, withRun(newManualRecord("lc_e4", fixture()), "manual"));
  const ov = await page.evaluate(() => { const w = innerWidth; return [document.documentElement.scrollWidth - w, [...document.querySelectorAll("body *")].filter((e) => e.getBoundingClientRect().right > w + 1 && !e.closest(".stepbar,.tbl,pre,.table-scroll")).slice(0, 12).map((e) => `${e.tagName}.${e.className}#${e.id}|${Math.round(e.getBoundingClientRect().right)}|${(e.textContent ?? "").slice(0, 30)}`)]; });
  assert.equal(ov[0], 0, `가로 넘침 없음 ${JSON.stringify(ov[1])}`);
  assert.ok(await page.locator("[data-testid=observation-panel]").isVisible());
  await ctx.close();
});
