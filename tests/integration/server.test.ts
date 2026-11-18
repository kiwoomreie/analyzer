// 새 앱 서버 경계 시험(로컬 포트·http). 운영 HTTPS·교차 사이트 쿠키·CSP 정책 검증을 대신하지 않는다.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { AddressInfo } from "node:net";
import { createApp, type App } from "../../server/app.ts";
import { loadConfig } from "../../server/config.ts";
import { checkTargetUrl, isBlockedIp, safeGet, parseMolitAptTrades, parseKakaoAddress, fetchMolitMonth, regionsAround, samplePoints } from "../../server/publicData.ts";

const FIX = "examples/launch-fixtures";
const fixture = (f: string) => readFileSync(join(FIX, f), "utf8");
const logs: string[] = [];

import { mockState, mockTransport, item } from "../helpers/mockPublicApi.ts";

function mk(env: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), "la-test-"));
  const cfg = loadConfig({ DB_PATH: join(dir, "t.db"), WEB_ROOT: "dist/web", COOKIE_SECURE: "false", ...env } as any);
  return createApp(cfg, {
    logger: (e) => logs.push(JSON.stringify(e)),
    publicDataDeps: { lookup: (_h, cb) => cb(null, [{ address: "203.0.113.10", family: 4 }]), transport: mockTransport },
  });
}

async function listen(app: App): Promise<string> {
  await new Promise<void>((r) => app.server.listen(0, "127.0.0.1", r));
  return `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
}

class Jar {
  c = new Map<string, string>();
  header() { return [...this.c].map(([k, v]) => `${k}=${v}`).join("; "); }
  take(res: Response) {
    for (const sc of res.headers.getSetCookie()) {
      const [kv] = sc.split(";");
      const i = kv.indexOf("=");
      const k = kv.slice(0, i), v = kv.slice(i + 1);
      if (/Max-Age=0/.test(sc)) this.c.delete(k); else this.c.set(k, v);
    }
  }
}

async function req(base: string, path: string, jar: Jar | null, init: RequestInit = {}) {
  const h = new Headers(init.headers);
  if (jar && jar.c.size) h.set("cookie", jar.header());
  const res = await fetch(base + path, { ...init, headers: h, redirect: "manual" });
  jar?.take(res);
  return res;
}

const form = (payload: string) => ({ method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ payload }).toString() });

let standby: App, standbyBase: string, enabled: App, enabledBase: string, keyed: App, keyedBase: string;
before(async () => {
  standby = mk({});
  standbyBase = await listen(standby);
  enabled = mk({ LAUNCH_RECEIVER_ENABLED: "true" });
  enabledBase = await listen(enabled);
  keyed = mk({ MOLIT_SERVICE_KEY: "test-key-not-real", KAKAO_REST_KEY: "test-kakao" });
  keyedBase = await listen(keyed);
});
after(async () => { await standby.close(); await enabled.close(); await keyed.close(); });

test("기본: /launch 수신 대기(503), 본문을 저장하지 않음", async () => {
  const r = await req(standbyBase, "/launch", null, form(fixture("valid-full.json")));
  assert.equal(r.status, 503);
  assert.match(await r.text(), /대기/);
  const n = standby.db.prepare("SELECT COUNT(*) n FROM pending_launches").get() as any;
  assert.equal(n.n, 0);
  assert.equal((await req(standbyBase, "/launch/claim/x", null)).status, 503);
});

test("세션 설정 상태: 키 미설정·수신 대기·서버 영구 보관 비활성", async () => {
  const jar = new Jar();
  const r = await req(standbyBase, "/api/session", jar);
  const j = await r.json();
  assert.equal(j.config.publicData, "unset");
  assert.equal(j.config.geocoder, "unset");
  assert.equal(j.config.launchReceiver, "standby");
  assert.ok(jar.c.has("la_ws"));
  assert.match(r.headers.get("set-cookie")!, /HttpOnly/);
});

test("자동 조회 API: 세션·CSRF 필요, 키 미설정이면 503(가상 값으로 채우지 않음)", async () => {
  const body = JSON.stringify({ address: "주소", asOf: "2026-10-31", months: 12 });
  assert.equal((await req(standbyBase, "/api/public-data/lookup", null, { method: "POST", headers: { "content-type": "application/json" }, body })).status, 401);
  const jar = new Jar();
  const s = await (await req(standbyBase, "/api/session", jar)).json();
  assert.equal((await req(standbyBase, "/api/public-data/lookup", jar, { method: "POST", headers: { "content-type": "application/json" }, body })).status, 403);
  assert.equal((await req(standbyBase, "/api/public-data/lookup", jar, { method: "POST", headers: { "content-type": "application/json", "x-csrf-token": s.csrfToken, "sec-fetch-site": "cross-site" }, body })).status, 403);
  const r = await req(standbyBase, "/api/public-data/lookup", jar, { method: "POST", headers: { "content-type": "application/json", "x-csrf-token": s.csrfToken }, body });
  assert.equal(r.status, 503);
  assert.equal((await r.json()).status, "unset");
});

async function lookup(body: object) {
  const jar = new Jar();
  const sess = await (await req(keyedBase, "/api/session", jar)).json();
  return (await req(keyedBase, "/api/public-data/lookup", jar, { method: "POST", headers: { "content-type": "application/json", "x-csrf-token": sess.csrfToken }, body: JSON.stringify(body) })).json();
}

test("[모의 응답] 주소→좌표 → 반경 주변 시군구 2곳(경계 밖 포함) → 월별 전 페이지 대사 → 단지 좌표", async () => {
  const j = await lookup({ address: "주소", asOf: "2026-10-31", months: 2, radiusM: 1500 });
  assert.equal(j.geocode.lawdCode, "41135");
  assert.deepEqual(j.report.regions.map((r: any) => r.code).sort(), ["41133", "41135"]);
  assert.equal(j.report.months.length, 4); // 2개 시군구 × 2개월
  assert.ok(j.report.months.every((m: any) => m.ok && m.totalCount === m.collected));
  assert.equal(j.report.status, "complete");
  assert.ok(j.trades.some((t: any) => t.complexName === "경계밖단지"));
  assert.equal(j.trades[0].dataMode, "official-api");
  assert.equal(j.trades.find((t: any) => t.complexName === "시험단지").complexId, "41135-1번지");
  assert.equal(j.complexes.length, 2);
});

test("[모의 응답] 한 달 수집 실패·지점 조회 실패 → partial, 누락 가능 안내(완료로 표시하지 않음)", async () => {
  mockState.failYm = "202609";
  mockState.failPoints = 2;
  const j = await lookup({ address: "주소", asOf: "2026-10-31", months: 2, radiusM: 1500 });
  mockState.failYm = "";
  mockState.failPoints = 0;
  assert.equal(j.report.status, "partial");
  assert.ok(j.report.months.some((m: any) => !m.ok));
  assert.match(j.report.regionNote, /누락 가능/);
  assert.ok(j.report.notes.some((n: string) => n.includes("누락 가능성")));
});

test("[모의 응답] 국토부 여러 페이지 수집과 전체 건수 대사, 중간 페이지 실패·건수 불일치 검출", async () => {
  const cfg = { serviceKey: "k", endpoint: "https://apis.data.go.kr/x", maxMonths: 12 };
  const page = (n: number, total: number) => `<response><header><resultCode>000</resultCode></header><body><items>${Array.from({ length: n }, (_, i) => item("P", "동", String(i), 1, "11110")).join("")}</items><totalCount>${total}</totalCount></body></response>`;
  const lookupOk = (_h: string, cb: any) => cb(null, [{ address: "203.0.113.10", family: 4 }]);
  const ok = await fetchMolitMonth(cfg, "11110", "202609", { lookup: lookupOk, transport: async (u) => ({ status: 200, headers: {}, body: Buffer.from(page(u.searchParams.get("pageNo") === "3" ? 1 : 2, 5)) }) }, 2);
  assert.equal(ok.pagesExpected, 3);
  assert.equal(ok.pagesFetched, 3);
  assert.equal(ok.collected, 5);
  assert.equal(ok.ok, true);
  const fail = await fetchMolitMonth(cfg, "11110", "202609", { lookup: lookupOk, transport: async (u) => (u.searchParams.get("pageNo") === "2" ? { status: 500, headers: {}, body: Buffer.alloc(0) } : { status: 200, headers: {}, body: Buffer.from(page(2, 5)) }) }, 2);
  assert.equal(fail.ok, false);
  assert.match(fail.error!, /2쪽/);
  const mismatch = await fetchMolitMonth(cfg, "11110", "202609", { lookup: lookupOk, transport: async () => ({ status: 200, headers: {}, body: Buffer.from(page(1, 2)) }) }, 2);
  assert.equal(mismatch.ok, false);
  assert.match(mismatch.error!, /불일치/);
});

test("반경 표본 지점 17개(중심+반경·1/2반경 8방위)", async () => {
  assert.equal(samplePoints({ lat: 37.5, lng: 127 }, 1000).length, 17);
  const r = await regionsAround("k", { lat: 37.412, lng: 127.126 }, 1500, { lookup: (_h, cb) => cb(null, [{ address: "203.0.113.10", family: 4 }]), transport: mockTransport });
  assert.equal(r.regions.length, 2);
});

test("외부 호출 방어: https·허용 호스트만, 사설·메타데이터 주소·리디렉션 차단", async () => {
  assert.throws(() => checkTargetUrl("http://apis.data.go.kr/x"), /https/);
  assert.throws(() => checkTargetUrl("https://evil.example/x"), /허용목록/);
  assert.throws(() => checkTargetUrl("https://169.254.169.254/latest"), /IP/);
  assert.ok(isBlockedIp("169.254.169.254") && isBlockedIp("10.0.0.1") && isBlockedIp("::1") && isBlockedIp("::ffff:127.0.0.1"));
  await assert.rejects(safeGet("https://apis.data.go.kr/x", {}, { lookup: (_h, cb) => cb(null, [{ address: "127.0.0.1", family: 4 }]) }), /사설/);
  await assert.rejects(safeGet("https://apis.data.go.kr/x", {}, { lookup: (_h, cb) => cb(null, [{ address: "203.0.113.5", family: 4 }]), transport: async () => ({ status: 302, headers: { location: "http://169.254.169.254" }, body: Buffer.alloc(0) }) }), /리디렉션/);
  assert.equal(parseKakaoAddress("{}"), null);
  assert.equal(parseMolitAptTrades("<item><aptNm>x</aptNm></item>").items.length, 0);
});

test("보안 헤더·화면 제공", async () => {
  const r = await req(standbyBase, "/app", null);
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-security-policy")!, /frame-ancestors 'none'/);
  assert.equal(r.headers.get("cross-origin-opener-policy"), "same-origin");
  assert.equal(r.headers.get("referrer-policy"), "no-referrer");
});

// ── 대기 기능 회귀 시험(LAUNCH_RECEIVER_ENABLED=true). 운영에서는 비활성.
async function launchAndClaim(base: string, payload: string, jar: Jar) {
  const r1 = await req(base, "/launch", jar, form(payload));
  if (r1.status !== 303) return { r1 };
  const loc = r1.headers.get("location")!;
  const r2 = await req(base, loc, jar);
  return { r1, r2, loc };
}

test("[대기 기능] 시험자료 manifest대로 수락·거절", async () => {
  const m = JSON.parse(fixture("manifest.json"));
  for (const c of m.cases) {
    const r = await req(enabledBase, "/launch", new Jar(), form(fixture(c.file)));
    assert.equal(r.status, c.status, c.file);
  }
});

test("[대기 기능] 버튼 1회 → 303 → 수령 → 임시 분석 1회 자동 실행, URL에 실제 가정 없음", async () => {
  const jar = new Jar();
  const { r1, r2, loc } = await launchAndClaim(enabledBase, fixture("valid-full.json"), jar);
  assert.equal(r1.status, 303);
  assert.doesNotMatch(loc!, /8\.4|가람동|84/);
  assert.equal(r2!.status, 303);
  const key = r2!.headers.get("location")!.split("/").pop()!;
  const g = await (await req(enabledBase, `/api/temp-analyses/${key}`, jar)).json();
  assert.equal(g.record.runs.length, 1);
  assert.equal(g.record.working.property.exclusiveAreaM2, 84);
  // 같은 수령 주소 재사용 → 같은 분석(중복 생성 없음)
  const again = await req(enabledBase, loc!, jar);
  assert.equal(again.headers.get("location"), r2!.headers.get("location"));
});

test("[대기 기능] 코드만 아는 다른 브라우저는 수령 불가, 타 세션 분석 조회 불가", async () => {
  const a = new Jar();
  const r1 = await req(enabledBase, "/launch", a, form(fixture("valid-minimal.json")));
  const loc = r1.headers.get("location")!;
  const b = new Jar();
  const rb = await req(enabledBase, loc, b);
  assert.equal(rb.status, 403);
  const ra = await req(enabledBase, loc, a);
  assert.equal(ra.status, 303);
  const key = ra.headers.get("location")!.split("/").pop()!;
  await req(enabledBase, "/api/session", b);
  assert.equal((await req(enabledBase, `/api/temp-analyses/${key}`, b)).status, 404);
});

test("[대기 기능] 같은 launchId: 같은 내용은 기존 사본, 다른 내용은 409, 다른 세션은 별도", async () => {
  const jar = new Jar();
  const first = await launchAndClaim(enabledBase, fixture("valid-full.json"), jar);
  const dup = await launchAndClaim(enabledBase, fixture("valid-full.json"), jar);
  assert.equal(dup.r2!.headers.get("location"), first.r2!.headers.get("location"));
  const conflict = await launchAndClaim(enabledBase, fixture("duplicate-changed.json"), jar);
  assert.equal(conflict.r2!.status, 409);
  const other = await launchAndClaim(enabledBase, fixture("valid-full.json"), new Jar());
  assert.notEqual(other.r2!.headers.get("location"), first.r2!.headers.get("location"));
});

test("[대기 기능] 본문 상한 64KiB(413), form 필드 1개만, Origin:null은 권한 근거 아님", async () => {
  const big = JSON.parse(fixture("valid-full.json"));
  big.sourceLabel = "x".repeat(70_000);
  assert.equal((await req(enabledBase, "/launch", new Jar(), form(JSON.stringify(big)))).status, 413);
  const two = await req(enabledBase, "/launch", new Jar(), { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "payload=%7B%7D&callbackUrl=x" });
  assert.equal(two.status, 400);
  const withOrigin = await req(enabledBase, "/launch", new Jar(), { ...form(fixture("valid-minimal.json")), headers: { "content-type": "application/x-www-form-urlencoded", origin: "null" } });
  assert.equal(withOrigin.status, 303); // Origin 값과 무관하게 계약 검증만으로 처리, 기존 자료 접근 권한은 부여하지 않음
});

test("로그에 본문·실제 가정·비밀값·수령 코드가 남지 않음", () => {
  const all = logs.join("\n");
  assert.doesNotMatch(all, /postgres:|가람동|8\.4|callbackUrl|pl_[A-Za-z0-9_-]{16}\./);
  assert.ok(logs.some((l) => l.includes("/launch/claim/:ticket")));
});

test("만료 정리: 미소비 시동 자료·임시 분석 삭제", () => {
  const app = enabled;
  app.db.prepare("UPDATE pending_launches SET expires_at = 0").run();
  app.db.prepare("UPDATE temp_analyses SET expires_at = 0").run();
  const r = app.runCleanup();
  assert.ok(r.pending > 0 && r.temp > 0);
});
