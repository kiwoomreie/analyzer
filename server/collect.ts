// 공공 자료 수집(일반 자동 조회·협의체 자동 실행 공용 경로).
// 주소 → 좌표 → 반경 주변 시군구(17개 표본 지점) → 시군구·월별 전 페이지 수집·건수 대사 → 단지 지번 좌표.
// 세 단계의 상태를 따로 기록하며, 상한·실패가 있으면 해당 단계를 완료로 표시하지 않는다.
import type { AppConfig } from "./config.ts";
import { fetchMolitMonth, geocodeComplex, geocodeKakao, OutboundBlocked, regionsAround, type RegionInfo, type SafeFetchDeps } from "./publicData.ts";
import { HttpError } from "./http.ts";
import { complexKeyOf, type CollectionReport, type Transaction } from "../shared/model.ts";
import { seoulNowIso } from "../shared/dates.ts";
import type { LookupPayload } from "../shared/applyData.ts";

export const LIMITS = { regions: 6, complexes: 80 };

export function recentMonths(asOf: string, n: number): string[] {
  const [y, m] = asOf.split("-").map(Number);
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const total = y * 12 + (m - 1) - i;
    out.push(`${Math.floor(total / 12)}${String((total % 12) + 1).padStart(2, "0")}`);
  }
  return out;
}

export async function collectPublicData(cfg: AppConfig, body: any, pd?: SafeFetchDeps): Promise<LookupPayload> {
  const at = seoulNowIso();
  const notes: string[] = [];
  const address = typeof body?.address === "string" ? body.address.slice(0, 200) : "";
  const asOf = typeof body?.asOf === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.asOf) ? body.asOf : null;
  if (!address || !asOf) throw new HttpError(400, "INPUT", "address·asOf 필요");
  const radiusM = Math.min(Math.max(Number(body?.radiusM) || 1500, 100), 5000);
  const months = Math.min(Math.max(Number(body?.months) || 12, 1), cfg.molit.maxMonths);
  if ((Number(body?.months) || 12) > cfg.molit.maxMonths) notes.push(`요청 ${Number(body?.months)}개월 중 ${months}개월만 수집(상한)`);

  // 1) 본건 좌표 — 이미 입력된 좌표가 있으면 그것을 중심으로 사용
  let center: { lat: number; lng: number } | null = body?.center && Number.isFinite(body.center.lat) && Number.isFinite(body.center.lng) ? { lat: body.center.lat, lng: body.center.lng } : null;
  let geocode: LookupPayload["geocode"] = null;
  if (cfg.kakaoRestKey) {
    try { geocode = await geocodeKakao(cfg.kakaoRestKey, address, pd); notes.push(geocode ? "주소→좌표 조회됨" : "주소 검색 결과 없음"); }
    catch (e) { notes.push(`주소 검색 실패(${e instanceof OutboundBlocked ? e.code : "오류"})`); }
  } else notes.push("주소→좌표: 지도 키 미설정");
  center ??= geocode ? { lat: geocode.lat, lng: geocode.lng } : null;

  // 2) 주변 행정구역 탐색(표본)
  const extra = Array.isArray(body?.extraLawdCodes) ? body.extraLawdCodes.filter((x: unknown) => typeof x === "string" && /^\d{5}$/.test(x)).slice(0, 5) : [];
  const given = typeof body?.lawdCode === "string" && /^\d{5}$/.test(body.lawdCode) ? body.lawdCode : geocode?.lawdCode;
  const regionMap = new Map<string, RegionInfo>();
  let rd: CollectionReport["regionDiscovery"];
  if (cfg.kakaoRestKey && center) {
    const r = await regionsAround(cfg.kakaoRestKey, center, radiusM, pd);
    r.regions.forEach((x) => regionMap.set(x.code, x));
    rd = { status: r.failedPoints ? "partial" : "sampled", sampled: r.sampled, failedPoints: r.failedPoints, regionsFound: r.regions.length, regionsUsed: 0, capped: false,
      note: `반경 ${radiusM.toLocaleString("ko-KR")}m 안 ${r.sampled}개 표본 지점에서 시군구 ${r.regions.length}곳 확인${r.failedPoints ? `, ${r.failedPoints}개 지점 조회 실패` : ""}. 표본 지점 방식이라 행정구역 경계 전체를 보장하지 않음` };
  } else {
    rd = { status: "notPerformed", sampled: 0, failedPoints: 0, regionsFound: 0, regionsUsed: 0, capped: false, note: "주변 행정구역 탐색 미수행(지도 키 또는 좌표 없음) — 지정 시군구만 수집, 경계 밖 반경 내 단지 누락 가능. 행정구역 경계 전체를 보장하지 않음" };
  }
  if (given && !regionMap.has(given)) regionMap.set(given, { code: given, name1: "", name2: "" });
  extra.forEach((c: string) => { if (!regionMap.has(c)) regionMap.set(c, { code: c, name1: "", name2: "" }); });
  const regions = [...regionMap.values()].slice(0, LIMITS.regions);
  rd.regionsUsed = regions.length;
  if (regionMap.size > LIMITS.regions) {
    rd.capped = true;
    if (rd.status === "sampled") rd.status = "partial"; // 상한으로 누락 가능 → 상태와 경고를 일치
    rd.note += ` · 시군구 ${regionMap.size}곳 중 ${LIMITS.regions}곳만 수집(상한) — 나머지 시군구의 반경 내 단지 누락 가능`;
  }

  // 3) 거래 응답 수집·건수 대사
  const monthResults: Awaited<ReturnType<typeof fetchMolitMonth>>[] = [];
  if (cfg.molit.serviceKey && regions.length) for (const rg of regions) for (const ym of recentMonths(asOf, months)) monthResults.push(await fetchMolitMonth(cfg.molit, rg.code, ym, pd));
  const trades = monthResults.flatMap((m) => m.items);
  const monthsOk = monthResults.filter((m) => m.ok).length;
  const pageCapped = monthResults.some((m) => (m.error ?? "").includes("상한"));
  const trStatus: CollectionReport["trades"]["status"] = !cfg.molit.serviceKey ? "unset" : !monthResults.length ? "failed" : monthsOk === monthResults.length ? "complete" : monthResults.some((m) => m.collected > 0) ? "partial" : "failed";
  const trNote = !cfg.molit.serviceKey ? "공공데이터 키 미설정" : !regions.length ? "시군구 코드 확인 불가" : `${regions.length}개 시군구 × ${months}개월`;

  // 4) 단지 좌표 확인
  const complexes: LookupPayload["complexes"] = [];
  const uniq = new Map<string, Transaction>();
  trades.forEach((x) => { const k = complexKeyOf(x); if (!uniq.has(k)) uniq.set(k, x); });
  let attempted = 0, failed = 0;
  if (cfg.kakaoRestKey) {
    for (const [k, x] of [...uniq].slice(0, LIMITS.complexes)) {
      attempted++;
      try {
        const g = await geocodeComplex(cfg.kakaoRestKey, regionMap.get(x.sggCd ?? ""), x.dong, x.jibun, pd);
        if (g) complexes.push({ complexKey: k, location: { lat: g.lat, lng: g.lng }, locationSource: `카카오 주소검색(지번, ${at.slice(0, 10)})`, address: g.address });
        else failed++;
      } catch { failed++; }
    }
  }
  const total = uniq.size;
  const gcCapped = total > LIMITS.complexes;
  const gc: CollectionReport["complexGeocode"] = {
    status: !cfg.kakaoRestKey || total === 0 ? "notPerformed" : complexes.length === total ? "complete" : complexes.length ? "partial" : "failed",
    total, attempted, located: complexes.length, failed, capped: gcCapped,
  };
  if (gcCapped) notes.push(`단지 ${total}곳 중 ${LIMITS.complexes}곳만 좌표 조회(상한) — 나머지는 확인 필요 후보`);
  if (trStatus !== "complete" && cfg.molit.serviceKey) notes.push("거래 응답 수집이 완료되지 않음 — 누락 가능성이 있음");

  const report: CollectionReport = {
    at, status: trStatus,
    trades: { status: trStatus, monthsOk, monthsTotal: monthResults.length, capped: pageCapped, note: trNote },
    regionDiscovery: rd, complexGeocode: gc,
    regions: regions.map((r) => ({ code: r.code, name: `${r.name1} ${r.name2}`.trim() || r.code })), regionNote: rd.note,
    months: monthResults.map(({ items, ...m }) => m), notes,
  };
  return { geocode, trades, complexes, report };
}
