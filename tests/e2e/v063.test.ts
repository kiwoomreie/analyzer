// 서버 없는 웹 버전(GitHub Pages와 같은 단독 정적 파일)을 브라우저로 직접 열어 시험. 실제 Pages 주소는 시험하지 않음.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { readFileSync } from "node:fs";
import { chromium, type Browser } from "playwright";
import { openSec, reveal, stepAware } from "../helpers/stepAware.ts";

const PORT = 5287;
let server: Server, browser: Browser;
before(async () => {
  const html = readFileSync("dist/preview/index.html");
  server = createServer((req, res) => {
    if (req.url === "/" || req.url?.startsWith("/index.html")) { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); res.end(html); }
    else if (req.url === "/framed.html") { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); res.end('<!doctype html><iframe id="f" src="/index.html" sandbox="allow-scripts allow-same-origin allow-forms" style="width:100vw;height:100vh;border:0"></iframe>'); }
    else { res.writeHead(404); res.end(); }
  });
  await new Promise<void>((r) => server.listen(PORT, "127.0.0.1", r));
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined });
});
after(async () => { await browser.close(); server.close(); });

test("단독 접속(Pages): 외부 요청 없음, 주소→가상 예시→분석→저장→다시 열기→보고서 내려받기(내용 패널 없이), 인쇄 제한 표시 없음", async () => {
  const ctx = await browser.newContext({ acceptDownloads: true });
  const page = stepAware(await ctx.newPage());
  const errors: string[] = [], external: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => { if (!r.url().startsWith(`http://localhost:${PORT}`) && !r.url().startsWith("data:") && !r.url().startsWith("blob:")) external.push(r.url()); });
  await page.goto(`http://localhost:${PORT}/`);
  assert.match(await page.textContent("[data-testid=preview-badge]") ?? "", /서버 없는 웹 버전/);
  await page.fill("[data-testid=new-address]", "[가상] 시험시 1");
  await page.click("[data-testid=start]");
  await page.waitForSelector("[data-testid=summary]");
  await openSec(page, "sec-market");
  await page.click("[data-testid=add-sample]");
  await page.click("[data-testid=rerun]");
  await page.click("[data-testid=save-browser]");
  await page.waitForFunction(() => location.hash.startsWith("#/app/l/"));
  await page.reload();
  await page.waitForSelector("[data-testid=summary]");
  await openSec(page, "sec-report");
  const [dl] = await Promise.all([page.waitForEvent("download"), page.click("[data-testid=dl-md]")]);
  // 이 시험 환경(로캘 미설정 헤드리스 Chromium)은 한글 파일명을 "download"로 바꾸므로 확장자만 가능할 때 확인
  assert.ok(/\.md$/.test(dl.suggestedFilename()) || dl.suggestedFilename() === "download", dl.suggestedFilename());
  assert.match(readFileSync(await dl.path(), "utf8"), /^# 아파트 입지·가격 검토 요약/);
  await page.waitForTimeout(300);
  assert.equal(await page.locator("[data-testid=dl-fallback]").count(), 0, "단독 접속에서는 내용 패널을 띄우지 않음");
  assert.doesNotMatch(await page.locator("#sec-report").innerText(), /미리보기에선 제한/);
  assert.deepEqual(external, [], "외부 주소 요청 없음(키·자료 전송 없음)");
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("다른 화면 안(프레임)에서는 내려받기 내용 패널과 인쇄 제한 표시", async () => {
  const page = stepAware(await browser.newPage());
  await page.goto(`http://localhost:${PORT}/framed.html`);
  const f = page.frameLocator("#f");
  await f.locator("[data-testid=new-address]").fill("[가상] 시험시 2");
  await f.locator("[data-testid=start]").click();
  await f.locator("[data-testid=summary]").waitFor();
  if ((await f.locator("#sec-report").getAttribute("open")) === null) await f.locator("#sec-report > summary").click();
  assert.match(await f.locator("#sec-report").innerText(), /미리보기에선 제한/);
  await f.locator("[data-testid=dl-md]").click();
  await f.locator("[data-testid=dl-fallback]").waitFor();
  await page.close();
});
