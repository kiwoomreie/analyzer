// [5] 수집 상태값과 경고 문구 일치(모의 공공 API)
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadConfig } from "../../server/config.ts";
import { collectPublicData } from "../../server/collect.ts";
import { mockState, mockTransport } from "../helpers/mockPublicApi.ts";
import { collectionStatusText } from "../../shared/applyData.ts";
import { runAnalysis } from "../../shared/analysis.ts";
import { applyLookup } from "../../shared/applyData.ts";
import { emptyWorking } from "../../shared/model.ts";

const cfg = loadConfig({ DB_PATH: join(mkdtempSync(join(tmpdir(), "la-st-")), "x.db"), MOLIT_SERVICE_KEY: "fake", KAKAO_REST_KEY: "fake", PUBLIC_DATA_MAX_MONTHS: "1" } as any);
const deps = { lookup: (_h: string, cb: any) => cb(null, [{ address: "203.0.113.10", family: 4 }]), transport: mockTransport };

test("[5-재현] 주변 시군구가 상한(6곳)을 넘으면 상태도 ‘일부’ — 상태값과 경고 문구 일치", async () => {
  mockState.manyRegions = true;
  const res = await collectPublicData(cfg, { address: "주소", asOf: "2026-10-31", months: 1, radiusM: 3000 }, deps);
  mockState.manyRegions = false;
  const rd = res.report.regionDiscovery;
  assert.equal(rd.capped, true);
  assert.equal(rd.status, "partial");
  assert.match(collectionStatusText(res.report), /주변 행정구역 탐색: 일부/);
  assert.match(rd.note, /경계 전체를 보장하지 않음/);
  const w = emptyWorking("주소", "2026-10-31");
  applyLookup(w, res, "2026-11-18T14:00:00+09:00");
  const flags = runAnalysis(w).flags.map((f) => f.text).join("\n");
  assert.match(flags, /주변 행정구역 탐색 일부/);
  assert.doesNotMatch(flags, /17개 표본 지점으로 확인 — 행정구역 경계 전체를 보장하지 않음$/m);
});
