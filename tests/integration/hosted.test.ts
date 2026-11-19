// 서버리스(Vercel) 함수 시험 — 모의 공공 API만 사용. 실제 국토부·카카오 호출과 실제 Vercel은 검증하지 않음.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { hostedEnv, hostedHandlers, issueAuth, validAuth } from "../../server/hosted.ts";
import { mockTransport } from "../helpers/mockPublicApi.ts";

const SECRET = "s".repeat(40);
const ENV = { MOLIT_SERVICE_KEY: "fake-molit-key-xyz", KAKAO_REST_KEY: "fake-kakao-rest-xyz", KAKAO_JS_KEY: "jskey", APP_ACCESS_PASSWORD: "pw-1234", APP_SESSION_SECRET: SECRET, COOKIE_SECURE: "false" } as any;
const deps = { publicDataDeps: { lookup: (_h: string, cb: any) => cb(null, [{ address: "203.0.113.10", family: 4 }]), transport: mockTransport } as any };

async function serve(env: any): Promise<{ base: string; close: () => void }> {
  const h = hostedHandlers(hostedEnv(env), deps);
  const routes: Record<string, any> = { "/api/session": h.session, "/api/login": h.login, "/api/logout": h.logout, "/api/public-data/lookup": h.lookup, "/launch": h.launch };
  const s: Server = createServer((req, res) => { const f = routes[new URL(req.url!, "http://x").pathname]; f ? f(req, res) : (res.statusCode = 404, res.end()); });
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
  return { base: `http://127.0.0.1:${(s.address() as any).port}`, close: () => s.close() };
}
const json = { "Content-Type": "application/json" };
const cookieOf = (r: Response) => (r.headers.get("set-cookie") ?? "").split(";")[0];

test("서명 쿠키: 만료·위조 거부", () => {
  const now = Date.now();
  const v = issueAuth(SECRET, now);
  assert.ok(validAuth(SECRET, v, now));
  assert.ok(!validAuth(SECRET, v, now + 13 * 3600_000), "만료");
  assert.ok(!validAuth("x".repeat(40), v, now), "다른 비밀값");
  assert.ok(!validAuth(SECRET, v.replace(/.$/, (c) => (c === "A" ? "B" : "A")), now), "서명 변조");
});

test("세션 응답에 국토부·카카오 REST 키가 없음, 로그인 전 자동 조회 401", async () => {
  const s = await serve(ENV);
  const r = await fetch(`${s.base}/api/session`);
  const text = await r.text();
  assert.doesNotMatch(text, /fake-molit-key-xyz|fake-kakao-rest-xyz|pw-1234|s{40}/);
  const j = JSON.parse(text);
  assert.deepEqual(j.config.auth, { required: true, ready: true, signedIn: false });
  assert.equal(j.config.publicData, "configured");
  const l = await fetch(`${s.base}/api/public-data/lookup`, { method: "POST", headers: json, body: JSON.stringify({ address: "a", asOf: "2026-11-01" }) });
  assert.equal(l.status, 401);
  s.close();
});

test("틀린 비밀번호 401, 맞으면 로그인 → CSRF 토큰 필요 → 모의 응답으로 조회, 로그아웃", async () => {
  const s = await serve(ENV);
  assert.equal((await fetch(`${s.base}/api/login`, { method: "POST", headers: json, body: JSON.stringify({ password: "wrong" }) })).status, 401);
  const ok = await fetch(`${s.base}/api/login`, { method: "POST", headers: json, body: JSON.stringify({ password: "pw-1234" }) });
  assert.equal(ok.status, 200);
  const c = cookieOf(ok);
  assert.match(ok.headers.get("set-cookie")!, /HttpOnly; SameSite=Strict/);
  const sess = await (await fetch(`${s.base}/api/session`, { headers: { cookie: c } })).json();
  assert.equal(sess.config.auth.signedIn, true);
  const body = JSON.stringify({ address: "경기도 성남시 분당구 정자동 1", asOf: "2026-11-01", months: 2, radiusM: 1500 });
  assert.equal((await fetch(`${s.base}/api/public-data/lookup`, { method: "POST", headers: { ...json, cookie: c, "X-CSRF-Token": "bad" }, body })).status, 403);
  assert.equal((await fetch(`${s.base}/api/public-data/lookup`, { method: "POST", headers: { ...json, cookie: c, "X-CSRF-Token": sess.csrfToken, "Sec-Fetch-Site": "cross-site" }, body })).status, 403);
  const r = await fetch(`${s.base}/api/public-data/lookup`, { method: "POST", headers: { ...json, cookie: c, "X-CSRF-Token": sess.csrfToken }, body });
  assert.equal(r.status, 200);
  const out = await r.json();
  assert.ok(out.trades.length > 0, "모의 거래 수신");
  assert.doesNotMatch(JSON.stringify(out), /fake-molit-key-xyz|fake-kakao-rest-xyz/);
  const lo = await fetch(`${s.base}/api/logout`, { method: "POST", headers: { ...json, cookie: c }, body: "{}" });
  assert.match(lo.headers.get("set-cookie")!, /Max-Age=0/);
  s.close();
});

test("비밀번호·세션 비밀값 미설정이면 자동 조회를 막음(503), 로그인 시도 5회 초과 429", async () => {
  const s = await serve({ ...ENV, APP_ACCESS_PASSWORD: "" });
  const sess = await (await fetch(`${s.base}/api/session`)).json();
  assert.deepEqual(sess.config.auth, { required: true, ready: false, signedIn: false });
  assert.equal((await fetch(`${s.base}/api/public-data/lookup`, { method: "POST", headers: json, body: "{}" })).status, 503);
  s.close();
  const s2 = await serve({ ...ENV, APP_SESSION_SECRET: "short" });
  assert.equal((await fetch(`${s2.base}/api/login`, { method: "POST", headers: json, body: JSON.stringify({ password: "pw-1234" }) })).status, 503, "짧은 비밀값 거부");
  s2.close();
  const s3 = await serve(ENV);
  const codes = [];
  for (let i = 0; i < 6; i++) codes.push((await fetch(`${s3.base}/api/login`, { method: "POST", headers: json, body: JSON.stringify({ password: "x" }) })).status);
  assert.deepEqual(codes, [401, 401, 401, 401, 401, 429]);
  s3.close();
});

test("/launch는 서버리스 배포에서도 대기(503), 본문 저장 없음", async () => {
  const s = await serve(ENV);
  const r = await fetch(`${s.base}/launch`, { method: "POST", body: "x" });
  assert.equal(r.status, 503);
  assert.match(await r.text(), /대기 중/);
  s.close();
});
