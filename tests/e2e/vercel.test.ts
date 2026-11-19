// Vercel 빌드 결과(.vercel/output)를 로컬 흉내 서버로 띄운 브라우저 시험. 자동 조회는 모의 응답.
// 실제 Vercel 배포·실제 국토부·카카오 호출은 검증하지 않는다.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import type { Server } from "node:http";
import { chromium, type Browser } from "playwright";
import { startVercelLocal } from "../helpers/vercelLocal.ts";
import { hostedEnv, hostedHandlers } from "../../server/hosted.ts";
import { mockTransport } from "../helpers/mockPublicApi.ts";
import { openSec, reveal, stepAware } from "../helpers/stepAware.ts";

const PORT = 5289, BASE = `http://localhost:${PORT}`;
let server: Server, browser: Browser;
before(async () => {
  // 빌드는 npm run test:e2e가 먼저 수행(병렬 실행 중 dist 삭제 방지)
  if (!existsSync(".vercel/output/config.json")) throw new Error("먼저 npm run build:vercel 실행");
  Object.assign(process.env, { MOLIT_SERVICE_KEY: "fake-molit-key-xyz", KAKAO_REST_KEY: "fake-kakao-rest-xyz", APP_ACCESS_PASSWORD: "pw-1234", APP_SESSION_SECRET: "s".repeat(40), COOKIE_SECURE: "false" });
  const mocked = hostedHandlers(hostedEnv(process.env), { publicDataDeps: { lookup: (_h: string, cb: any) => cb(null, [{ address: "203.0.113.10", family: 4 }]), transport: mockTransport } as any });
  server = await startVercelLocal(PORT, { "/api/public-data/lookup": mocked.lookup });
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined });
});
after(async () => { await browser.close(); server.close(); for (const k of ["MOLIT_SERVICE_KEY", "KAKAO_REST_KEY", "APP_ACCESS_PASSWORD", "APP_SESSION_SECRET", "COOKIE_SECURE"]) delete process.env[k]; });

test("Vercel 빌드: / → /app, 보안 헤더, /launch 대기, 키가 화면·번들에 없음", async () => {
  const r = await fetch(`${BASE}/`, { redirect: "manual" });
  assert.equal(r.status, 308);
  assert.equal(r.headers.get("location"), "/app");
  const app = await fetch(`${BASE}/app/l/abc`);
  assert.equal(app.status, 200);
  assert.match(app.headers.get("content-security-policy") ?? "", /default-src 'self'/);
  const js = await (await fetch(`${BASE}/assets/app.js`)).text();
  assert.doesNotMatch(js + (await app.text()), /fake-molit-key-xyz|fake-kakao-rest-xyz|pw-1234/);
  assert.equal((await fetch(`${BASE}/launch`, { method: "POST", body: "x" })).status, 503);
});

test("로그인 전에는 자동 조회 비활성, 틀린 비밀번호 안내, 로그인 후 모의 자동 조회로 거래 반영·저장", async () => {
  const ctx = await browser.newContext();
  const page = stepAware(await ctx.newPage());
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${BASE}/app`);
  await page.waitForSelector("[data-testid=auth-form]");
  await page.fill("[data-testid=new-address]", "경기도 성남시 분당구 정자동 1");
  await page.click("[data-testid=start]");
  await page.waitForSelector("[data-testid=summary]");
  await openSec(page, "sec-market");
  assert.equal(await page.isDisabled("[data-testid=public-lookup]"), true);
  assert.match(await page.locator("#sec-market").innerText(), /접속 비밀번호로 로그인한 뒤 사용/);

  await page.fill("[data-testid=auth-password]", "wrong");
  await page.click("[data-testid=auth-login]");
  assert.match(await page.locator("[data-testid=auth-error]").innerText(), /비밀번호가 맞지 않음/);
  await page.fill("[data-testid=auth-password]", "pw-1234");
  await page.click("[data-testid=auth-login]");
  await page.waitForSelector("[data-testid=auth-state]:has-text('로그인됨')");
  assert.equal(await page.isDisabled("[data-testid=public-lookup]"), false);
  await page.click("[data-testid=public-lookup]");
  await page.waitForSelector("[data-testid=market-msg]");
  assert.match(await page.locator("[data-testid=market-msg]").innerText(), /신규 \d+/);
  await page.click("[data-testid=save-browser]");
  await page.waitForURL(/\/app\/l\//);
  await page.reload();
  await page.waitForSelector("[data-testid=summary]");
  assert.match(await page.locator("[data-testid=auth-state]").innerText(), /로그인됨/);
  await page.click("[data-testid=logout]");
  await page.waitForSelector("[data-testid=auth-form]");
  assert.deepEqual(errors, []);
  await ctx.close();
});
