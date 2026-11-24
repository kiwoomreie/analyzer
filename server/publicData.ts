import { seoulToday, parseDateValue } from "../shared/dates.ts";
// 허용된 공공데이터 어댑터만 외부 호출한다. 임의 URL을 대신 요청하는 범용 프록시·다운로더는 없다.
// 방어: https만, 고정 호스트 허용목록, 사설·루프백·링크로컬·메타데이터 주소 차단(DNS 결과 검사 후 그 주소로 접속),
// 리디렉션 거부, 시간·응답 크기 상한.
import { request as httpsRequest } from "node:https";
import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { isIP } from "node:net";
import type { Transaction } from "../shared/model.ts";
import { newKey } from "../shared/model.ts";

export const ALLOWED_HOSTS = new Set(["apis.data.go.kr", "dapi.kakao.com"]);

export class OutboundBlocked extends Error {
  constructor(public code: string, message: string) { super(message); }
}

export function isBlockedIp(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224 || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19));
  }
  if (v === 6) {
    const s = ip.toLowerCase();
    if (s === "::" || s === "::1") return true;
    if (s.startsWith("fe8") || s.startsWith("fe9") || s.startsWith("fea") || s.startsWith("feb")) return true; // link-local
    if (s.startsWith("fc") || s.startsWith("fd")) return true; // ULA
    if (s.startsWith("ff")) return true;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(s);
    if (mapped) return isBlockedIp(mapped[1]);
    return false;
  }
  return true;
}

/** 요청 대상 URL 검사(DNS 이전 단계). */
export function checkTargetUrl(raw: string): URL {
  let u: URL;
  try { u = new URL(raw); } catch { throw new OutboundBlocked("BAD_URL", "주소 형식 오류"); }
  if (u.protocol !== "https:") throw new OutboundBlocked("SCHEME", "https만 허용");
  if (u.username || u.password) throw new OutboundBlocked("USERINFO", "주소에 계정정보 불가");
  if (isIP(u.hostname.replace(/^\[|\]$/g, ""))) throw new OutboundBlocked("IP_LITERAL", "IP 주소 직접 지정 불가");
  if (!ALLOWED_HOSTS.has(u.hostname.toLowerCase())) throw new OutboundBlocked("HOST_NOT_ALLOWED", "허용목록 외 호스트");
  if (u.port && u.port !== "443") throw new OutboundBlocked("PORT", "443 외 포트 불가");
  return u;
}

type LookupFn = (host: string, cb: (err: Error | null, addrs: LookupAddress[]) => void) => void;
const defaultLookup: LookupFn = (host, cb) => dnsLookup(host, { all: true }, (e, a) => cb(e, a as LookupAddress[]));

export interface SafeFetchDeps {
  lookup?: LookupFn;
  /** 시험용: 실제 네트워크 대신 응답을 흉내 */
  transport?: (u: URL, address: LookupAddress, headers: Record<string, string>) => Promise<{ status: number; headers: Record<string, string>; body: Buffer }>;
}

export async function safeGet(raw: string, opts: { timeoutMs?: number; maxBytes?: number; headers?: Record<string, string> } = {}, deps: SafeFetchDeps = {}): Promise<{ status: number; body: Buffer }> {
  const u = checkTargetUrl(raw);
  const lookup = deps.lookup ?? defaultLookup;
  const addrs = await new Promise<LookupAddress[]>((resolve, reject) => lookup(u.hostname, (e, a) => (e ? reject(new OutboundBlocked("DNS", "이름 해석 실패")) : resolve(a))));
  if (!addrs.length || addrs.some((a) => isBlockedIp(a.address))) throw new OutboundBlocked("PRIVATE_ADDRESS", "사설·보호 주소로 해석됨");
  const address = addrs[0];
  const timeoutMs = opts.timeoutMs ?? 8000;
  const maxBytes = opts.maxBytes ?? 2 * 1024 * 1024;
  const transport = deps.transport ?? ((url, addr, h) => realTransport(url, addr, timeoutMs, maxBytes, h));
  const r = await transport(u, address, opts.headers ?? {});
  if (r.status >= 300 && r.status < 400) throw new OutboundBlocked("REDIRECT", "리디렉션은 따르지 않음");
  if (r.body.length > maxBytes) throw new OutboundBlocked("TOO_LARGE", "응답 크기 상한 초과");
  return { status: r.status, body: r.body };
}

function realTransport(u: URL, addr: LookupAddress, timeoutMs: number, maxBytes: number, extraHeaders: Record<string, string>) {
  return new Promise<{ status: number; headers: Record<string, string>; body: Buffer }>((resolve, reject) => {
    const req = httpsRequest(
      {
        host: u.hostname, servername: u.hostname, path: u.pathname + u.search, method: "GET", port: 443, family: addr.family, timeout: timeoutMs,
        // 검사한 주소로만 접속(DNS 재바인딩 방지)
        lookup: (_h: string, _o: unknown, cb: (e: Error | null, a: string, f: number) => void) => cb(null, addr.address, addr.family),
        headers: { Accept: "application/xml, text/xml, application/json", ...extraHeaders },
      } as any,
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (c: Buffer) => { size += c.length; if (size > maxBytes) { req.destroy(); reject(new OutboundBlocked("TOO_LARGE", "응답 크기 상한 초과")); } else chunks.push(c); });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers as any, body: Buffer.concat(chunks) }));
      },
    );
    req.on("timeout", () => { req.destroy(); reject(new OutboundBlocked("TIMEOUT", "시간 초과")); });
    req.on("error", () => reject(new OutboundBlocked("NETWORK", "외부 호출 실패")));
    req.end();
  });
}

// ── 국토교통부 아파트 매매 실거래가 어댑터(실제 호출 미검증)
function tag(item: string, name: string): string | undefined {
  const m = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(item);
  return m ? m[1].trim() : undefined;
}

/** XML 응답에서 필요한 필드만 텍스트로 읽는다(실행·외부 참조 없음). 금액 단위는 만원. */
export function parseMolitAptTrades(xml: string, source = "국토교통부 아파트 매매 실거래가 API"): { items: Transaction[]; resultCode?: string; resultMsg?: string; totalCount: number | null; numOfRows: number | null; pageNo: number | null; rawItemCount: number } {
  const resultCode = tag(xml, "resultCode");
  const resultMsg = tag(xml, "resultMsg");
  const num = (v?: string) => (v !== undefined && /^\d+$/.test(v) ? Number(v) : null);
  const items: Transaction[] = [];
  const re = /<item>([\s\S]*?)<\/item>/g;
  let m: RegExpExecArray | null;
  let rawItemCount = 0;
  while ((m = re.exec(xml)) && rawItemCount < 20000) {
    rawItemCount++;
    const it = m[1];
    const amountMan = Number((tag(it, "dealAmount") ?? "").replace(/[,\s]/g, ""));
    const area = Number(tag(it, "excluUseAr"));
    const y = tag(it, "dealYear"), mo = tag(it, "dealMonth"), d = tag(it, "dealDay");
    if (!(amountMan > 0) || !(area > 0) || !y || !mo) continue;
    const contractDate = `${y}-${mo.padStart(2, "0")}${d ? `-${d.padStart(2, "0")}` : ""}`;
    if (!parseDateValue(contractDate) || !Number.isFinite(area) || !Number.isSafeInteger(Math.round(amountMan * 1e4)) || !tag(it, "aptNm")) continue;
    const cdeal = (tag(it, "cdealType") ?? "").trim();
    items.push({
      key: newKey("tx"), complexName: (tag(it, "aptNm") ?? "단지명 미상").slice(0, 80),
      complexId: tag(it, "aptSeq")?.slice(0, 40) || undefined, sggCd: tag(it, "sggCd")?.slice(0, 5) || undefined,
      dong: tag(it, "umdNm")?.slice(0, 40) || undefined, jibun: tag(it, "jibun")?.slice(0, 40) || undefined, aptDong: tag(it, "aptDong")?.slice(0, 20) || undefined,
      exclusiveAreaM2: area, floor: Number(tag(it, "floor")) || undefined, priceKrw: Math.round(amountMan * 1e4), contractDate,
      knownOn: seoulToday(), cancelled: !!tag(it, "cdealDay") || !["", "0", "N"].includes(cdeal.toUpperCase()), cancelDate: tag(it, "cdealDay") || undefined,
      buildYear: Number(tag(it, "buildYear")) || undefined, dataMode: "official-api", source,
    });
  }
  return { items, resultCode, resultMsg, totalCount: num(tag(xml, "totalCount")), numOfRows: num(tag(xml, "numOfRows")), pageNo: num(tag(xml, "pageNo")), rawItemCount };
}

export interface MolitConfig { serviceKey: string | null; endpoint: string; maxMonths: number; maxPages?: number }

export interface MonthCollection { lawdCode: string; yearMonth: string; totalCount: number | null; collected: number; pagesExpected: number | null; pagesFetched: number; ok: boolean; error?: string; items: Transaction[] }

/** 한 시군구·한 달의 모든 페이지를 수집하고 전체 건수(totalCount)와 대사한다. 실패·불일치는 ok=false. */
export async function fetchMolitMonth(cfg: MolitConfig, lawdCode: string, ym: string, deps: SafeFetchDeps = {}, rows = 1000): Promise<MonthCollection> {
  const out: MonthCollection = { lawdCode, yearMonth: ym, totalCount: null, collected: 0, pagesExpected: null, pagesFetched: 0, ok: false, items: [] };
  const maxPages = cfg.maxPages ?? 20;
  const source = `국토교통부 아파트 매매 실거래가 API(${seoulToday()} 조회)`;
  for (let page = 1; page <= (out.pagesExpected ?? 1); page++) {
    if (page > maxPages) { out.error = `페이지 상한(${maxPages}) 초과 — 일부 미수집`; break; }
    const u = new URL(cfg.endpoint);
    u.searchParams.set("serviceKey", cfg.serviceKey!);
    u.searchParams.set("LAWD_CD", lawdCode);
    u.searchParams.set("DEAL_YMD", ym);
    u.searchParams.set("numOfRows", String(rows));
    u.searchParams.set("pageNo", String(page));
    try {
      const r = await safeGet(u.toString(), {}, deps);
      if (r.status !== 200) { out.error = `${page}쪽 응답 ${r.status}`; break; }
      const p = parseMolitAptTrades(r.body.toString("utf8"), source);
      if (!/^0+$/.test(p.resultCode ?? "")) { out.error = `${page}쪽 성공 코드 미확인`; break; }
      if (p.totalCount === null) { out.error = "전체 건수(totalCount) 없음 — 대사 불가"; out.items.push(...p.items); out.pagesFetched++; break; }
      if (((p.pageNo !== null || p.totalCount > (p.numOfRows || rows)) && p.pageNo !== page) || (page > 1 && out.totalCount !== p.totalCount)) {
        out.error = `${page}쪽 페이지 번호 또는 전체 건수 불일치`;
        break;
      }
      if (p.items.some(t => t.contractDate.slice(0,7).replace('-','') !== ym || (t.sggCd && t.sggCd !== lawdCode))) {
        out.error = `${page}쪽 요청 시군구·계약월 불일치`; break;
      }
      p.items.forEach(t => { t.sggCd ??= lawdCode; });
      if (p.items.length !== p.rawItemCount) { out.error = `${page}쪽 거래 필수값 누락 · 건수 대사 불가`; break; }
      if (p.numOfRows !== null && p.numOfRows < 1) { out.error = "페이지 크기 오류"; break; }
      out.totalCount = p.totalCount;
      out.pagesExpected = Math.max(1, Math.ceil(p.totalCount / (p.numOfRows || rows)));
      out.items.push(...p.items);
      out.collected += p.rawItemCount;
      out.pagesFetched++;
    } catch (e) {
      out.error = `${page}쪽 ${e instanceof OutboundBlocked ? e.code : "호출 실패"}`;
      break;
    }
  }
  out.ok = !out.error && out.totalCount !== null && out.collected === out.totalCount && out.pagesFetched === out.pagesExpected;
  if (!out.error && out.totalCount !== null && out.collected !== out.totalCount) out.error = `건수 불일치(전체 ${out.totalCount}, 수집 ${out.collected})`;
  return out;
}

// ── 카카오 로컬 주소 검색(주소→좌표·법정동코드). 실제 호출 미검증.
export interface GeocodeResult { lat: number; lng: number; lawdCode?: string; source: string }

export function parseKakaoAddress(json: string): GeocodeResult | null {
  let d: any;
  try { d = JSON.parse(json); } catch { return null; }
  const doc = Array.isArray(d?.documents) ? d.documents[0] : null;
  if (!doc) return null;
  const lng = Number(doc.x), lat = Number(doc.y);
  if (!(lat >= 33 && lat <= 39 && lng >= 124 && lng <= 132)) return null;
  const bcode = String(doc.address?.b_code ?? "");
  return { lat, lng, lawdCode: /^\d{10}$/.test(bcode) ? bcode.slice(0, 5) : undefined, source: `카카오 로컬 주소검색(${seoulToday()})` };
}

export async function geocodeKakao(restKey: string | null, address: string, deps: SafeFetchDeps = {}): Promise<GeocodeResult | null> {
  if (!restKey || !address.trim()) return null;
  const u = new URL("https://dapi.kakao.com/v2/local/search/address.json");
  u.searchParams.set("query", address.slice(0, 200));
  const r = await safeGet(u.toString(), { headers: { Authorization: `KakaoAK ${restKey}` } }, deps);
  if (r.status !== 200) throw new OutboundBlocked("STATUS", `주소 검색 응답 ${r.status}`);
  return parseKakaoAddress(r.body.toString("utf8"));
}

// ── 반경 주변 시군구 확인(행정구역 경계 밖 단지 누락 방지)
/** 중심과 반경 위 16개 지점(반경·반경의 1/2, 8방위)의 시군구를 조회. 경계가 복잡하면 누락 가능(샘플 지점 기반). */
export function samplePoints(center: { lat: number; lng: number }, radiusM: number): { lat: number; lng: number }[] {
  const pts = [center];
  for (const f of [1, 0.5]) for (let k = 0; k < 8; k++) {
    const ang = (k * Math.PI) / 4;
    const dLat = (radiusM * f * Math.cos(ang)) / 111_320;
    const dLng = (radiusM * f * Math.sin(ang)) / (111_320 * Math.cos((center.lat * Math.PI) / 180));
    pts.push({ lat: center.lat + dLat, lng: center.lng + dLng });
  }
  return pts;
}

export interface RegionInfo { code: string; name1: string; name2: string }

export async function regionsAround(restKey: string, center: { lat: number; lng: number }, radiusM: number, deps: SafeFetchDeps = {}): Promise<{ regions: RegionInfo[]; failedPoints: number; sampled: number }> {
  const pts = samplePoints(center, radiusM);
  const map = new Map<string, RegionInfo>();
  let failed = 0;
  for (const p of pts) {
    const u = new URL("https://dapi.kakao.com/v2/local/geo/coord2regioncode.json");
    u.searchParams.set("x", String(p.lng));
    u.searchParams.set("y", String(p.lat));
    try {
      const r = await safeGet(u.toString(), { headers: { Authorization: `KakaoAK ${restKey}` } }, deps);
      const d = JSON.parse(r.body.toString("utf8"));
      const b = (d?.documents ?? []).find((x: any) => x.region_type === "B") ?? d?.documents?.[0];
      const code = String(b?.code ?? "");
      if (r.status !== 200 || !/^\d{10}$/.test(code)) { failed++; continue; }
      map.set(code.slice(0, 5), { code: code.slice(0, 5), name1: String(b.region_1depth_name ?? ""), name2: String(b.region_2depth_name ?? "") });
    } catch { failed++; }
  }
  return { regions: [...map.values()], failedPoints: failed, sampled: pts.length };
}

/** 단지 지번 주소로 좌표 조회(카카오 주소검색). 실패하면 null — 거리 미확인으로 남긴다. */
export async function geocodeComplex(restKey: string, region: RegionInfo | undefined, dong?: string, jibun?: string, deps: SafeFetchDeps = {}): Promise<{ lat: number; lng: number; address: string } | null> {
  if (!region?.name2 || !dong || !jibun) return null;
  const address = `${region.name1} ${region.name2} ${dong} ${jibun}`.trim();
  const g = await geocodeKakao(restKey, address, deps);
  return g && g.lawdCode === region.code ? { lat: g.lat, lng: g.lng, address } : null;
}
