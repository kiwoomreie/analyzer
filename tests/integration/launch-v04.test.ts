// v0.3 독립 검토 지적 3·4: auto-launch 경로 일관성, 수집 상태 분리(모의 요청·모의 공공 API)
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { AddressInfo } from "node:net";
import { createApp, type App } from "../../server/app.ts";
import { loadConfig } from "../../server/config.ts";
import { mockState, mockTransport } from "../helpers/mockPublicApi.ts";

let app: App, base: string;
const deps = { logger: () => {}, publicDataDeps: { lookup: (_h: string, cb: any) => cb(null, [{ address: "203.0.113.10", family: 4 }]), transport: mockTransport } };
before(async () => {
  const dir = mkdtempSync(join(tmpdir(), "la-v04-"));
  app = createApp(loadConfig({ DB_PATH: join(dir, "t.db"), WEB_ROOT: "dist/web", COOKIE_SECURE: "false", LAUNCH_RECEIVER_ENABLED: "true", PUBLIC_DATA_AUTO_FETCH: "true", MOLIT_SERVICE_KEY: "fake", KAKAO_REST_KEY: "fake", PUBLIC_DATA_MAX_MONTHS: "2" } as any), deps);
  await new Promise<void>((r) => app.server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
});
after(() => app.close());

async function launch(): Promise<any> {
  const cookies = new Map<string, string>();
  const go = async (path: string, init: RequestInit = {}) => {
    const h = new Headers(init.headers);
    if (cookies.size) h.set("cookie", [...cookies].map(([k, v]) => `${k}=${v}`).join("; "));
    const r = await fetch(base + path, { ...init, headers: h, redirect: "manual" });
    for (const sc of r.headers.getSetCookie()) { const [kv] = sc.split(";"); const i = kv.indexOf("="); cookies.set(kv.slice(0, i), kv.slice(i + 1)); }
    return r;
  };
  const doc = JSON.parse(readFileSync("examples/launch-fixtures/valid-full.json", "utf8"));
  doc.launchId = `fixture-auto-${Math.random().toString(36).slice(2, 10)}`;
  const r1 = await go("/launch", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ payload: JSON.stringify(doc) }).toString() });
  const r2 = await go(r1.headers.get("location")!);
  const key = r2.headers.get("location")!.split("/").pop();
  return (await (await go(`/api/temp-analyses/${key}`)).json()).record;
}

test("[지적3] auto-launch도 일반 분석과 같은 경로: 반경 시군구 수집·병합·단지 좌표·수집 보고·입력 스냅샷", async () => {
  const rec = await launch();
  const run = rec.runs[0];
  assert.equal(run.trigger, "auto-launch");
  assert.ok(run.input, "실행 당시 입력 스냅샷 보관");
  assert.equal(run.inputHash, run.result.inputHash);
  const col = rec.working.collections[0];
  assert.ok(col, "수집 보고 기록");
  assert.equal(col.regions.length, 2, "단일 시군구가 아니라 반경 주변 시군구");
  assert.ok(rec.working.complexInfo.length > 0, "단지 좌표 확인 수행");
  assert.ok(rec.working.transactions.every((t: any) => t.idKey), "병합 경로로 식별 키 부여");
  assert.deepEqual(rec.original.working.transactions, [], "최초 수신 사본은 받은 그대로(자동 조회 결과는 작업본에만)");
  assert.equal(run.input.transactions.length, rec.working.transactions.length);
});

test("[지적3] auto-launch 수집이 일부 실패하면 그대로 기록되고 불확실성에 반영", async () => {
  mockState.failYm = "202610";
  const rec = await launch();
  mockState.failYm = "";
  assert.notEqual(rec.working.collections[0].trades.status, "complete");
  assert.ok(rec.runs[0].result.flags.some((f: any) => f.text.includes("거래 응답")));
});

test("[지적4] 거래 수집·행정구역 탐색·단지 좌표 확인 상태를 분리하고, 표본 방식은 완전성을 주장하지 않음", async () => {
  const rec = await launch();
  const col = rec.working.collections[0];
  assert.equal(col.trades.status, "complete");
  assert.equal(col.regionDiscovery.status, "sampled"); // ‘완료’가 아니라 ‘표본 확인’
  assert.match(col.regionDiscovery.note, /경계 전체를 보장하지 않음/);
  assert.ok(["complete", "partial"].includes(col.complexGeocode.status));
});

test("[지적4] 상한·실패 시 각 상태가 따로 낮아지고 대표 비교단지 영향 문구 표시", async () => {
  mockState.failPoints = 3;
  mockState.failGeocode = true;
  const rec = await launch();
  mockState.failPoints = 0;
  mockState.failGeocode = false;
  const col = rec.working.collections[0];
  assert.equal(col.trades.status, "complete");
  assert.equal(col.regionDiscovery.status, "partial");
  assert.equal(col.complexGeocode.status, "failed");
  const flags = rec.runs[0].result.flags.map((f: any) => f.text).join("\n");
  assert.match(flags, /행정구역 탐색.*대표 비교단지/);
  assert.match(flags, /단지 좌표.*대표 비교단지/);
});
