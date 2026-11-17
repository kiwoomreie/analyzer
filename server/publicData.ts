// 허용된 공공데이터 어댑터만 외부 호출한다. 임의 URL을 대신 요청하는 범용 프록시·다운로더는 없다.
// 방어: https만, 고정 호스트 허용목록, 사설·루프백·링크로컬·메타데이터 주소 차단(DNS 결과 검사 후 그 주소로 접속),
// 리디렉션 거부, 시간·응답 크기 상한.
import { request as httpsRequest } from "node:https";
import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { isIP } from "node:net";
import type { Transaction } from "../shared/model.ts";
import { newKey } from "../shared/model.ts";

export const ALLOWED_HOSTS = new Set(["apis.data.go.kr"]);

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
  transport?: (u: URL, address: LookupAddress) => Promise<{ status: number; headers: Record<string, string>; body: Buffer }>;
}

export async function safeGet(raw: string, opts: { timeoutMs?: number; maxBytes?: number } = {}, deps: SafeFetchDeps = {}): Promise<{ status: number; body: Buffer }> {
  const u = checkTargetUrl(raw);
  const lookup = deps.lookup ?? defaultLookup;
  const addrs = await new Promise<LookupAddress[]>((resolve, reject) => lookup(u.hostname, (e, a) => (e ? reject(new OutboundBlocked("DNS", "이름 해석 실패")) : resolve(a))));
  if (!addrs.length || addrs.some((a) => isBlockedIp(a.address))) throw new OutboundBlocked("PRIVATE_ADDRESS", "사설·보호 주소로 해석됨");
  const address = addrs[0];
  const timeoutMs = opts.timeoutMs ?? 8000;
  const maxBytes = opts.maxBytes ?? 2 * 1024 * 1024;
  const transport = deps.transport ?? ((url, addr) => realTransport(url, addr, timeoutMs, maxBytes));
  const r = await transport(u, address);
  if (r.status >= 300 && r.status < 400) throw new OutboundBlocked("REDIRECT", "리디렉션은 따르지 않음");
  if (r.body.length > maxBytes) throw new OutboundBlocked("TOO_LARGE", "응답 크기 상한 초과");
  return { status: r.status, body: r.body };
}

function realTransport(u: URL, addr: LookupAddress, timeoutMs: number, maxBytes: number) {
  return new Promise<{ status: number; headers: Record<string, string>; body: Buffer }>((resolve, reject) => {
    const req = httpsRequest(
      {
        host: u.hostname, servername: u.hostname, path: u.pathname + u.search, method: "GET", port: 443, timeout: timeoutMs,
        // 검사한 주소로만 접속(DNS 재바인딩 방지)
        lookup: (_h: string, _o: unknown, cb: (e: Error | null, a: string, f: number) => void) => cb(null, addr.address, addr.family),
        headers: { Accept: "application/xml, text/xml, application/json" },
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
export function parseMolitAptTrades(xml: string): { items: Transaction[]; resultCode?: string; resultMsg?: string } {
  const resultCode = tag(xml, "resultCode");
  const resultMsg = tag(xml, "resultMsg");
  const items: Transaction[] = [];
  const re = /<item>([\s\S]*?)<\/item>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) && items.length < 5000) {
    const it = m[1];
    const amountMan = Number((tag(it, "dealAmount") ?? "").replace(/[,\s]/g, ""));
    const area = Number(tag(it, "excluUseAr"));
    const y = tag(it, "dealYear"), mo = tag(it, "dealMonth"), d = tag(it, "dealDay");
    if (!(amountMan > 0) || !(area > 0) || !y || !mo) continue;
    const contractDate = `${y}-${mo.padStart(2, "0")}${d ? `-${d.padStart(2, "0")}` : ""}`;
    const cdeal = (tag(it, "cdealType") ?? "").trim();
    items.push({
      key: newKey("tx"), complexName: (tag(it, "aptNm") ?? "단지명 미상").slice(0, 80), exclusiveAreaM2: area,
      floor: Number(tag(it, "floor")) || undefined, priceKrw: Math.round(amountMan * 1e4), contractDate,
      cancelled: cdeal !== "", cancelDate: tag(it, "cdealDay") || undefined, group: "target",
      buildYear: Number(tag(it, "buildYear")) || undefined, dataMode: "official-api",
    });
  }
  return { items, resultCode, resultMsg };
}

export interface MolitConfig { serviceKey: string | null; endpoint: string; maxMonths: number }

export async function fetchMolitAptTrades(cfg: MolitConfig, lawdCode: string, yearMonths: string[], deps: SafeFetchDeps = {}) {
  if (!cfg.serviceKey) return { status: "unset" as const, items: [], errors: ["MOLIT_SERVICE_KEY 미설정"] };
  if (!/^\d{5}$/.test(lawdCode)) return { status: "error" as const, items: [], errors: ["시군구 코드는 5자리"] };
  const months = yearMonths.filter((ym) => /^\d{6}$/.test(ym)).slice(0, cfg.maxMonths);
  const items: Transaction[] = [];
  const errors: string[] = [];
  for (const ym of months) {
    const u = new URL(cfg.endpoint);
    u.searchParams.set("serviceKey", cfg.serviceKey);
    u.searchParams.set("LAWD_CD", lawdCode);
    u.searchParams.set("DEAL_YMD", ym);
    u.searchParams.set("numOfRows", "1000");
    u.searchParams.set("pageNo", "1");
    try {
      const r = await safeGet(u.toString(), {}, deps);
      if (r.status !== 200) { errors.push(`${ym}: 응답 ${r.status}`); continue; }
      const p = parseMolitAptTrades(r.body.toString("utf8"));
      if (p.resultCode && !/^0+$/.test(p.resultCode)) { errors.push(`${ym}: 결과코드 ${p.resultCode}`); continue; }
      items.push(...p.items);
    } catch (e) {
      errors.push(`${ym}: ${e instanceof OutboundBlocked ? e.code : "호출 실패"}`);
    }
  }
  return { status: errors.length && !items.length ? ("error" as const) : ("ok" as const), items, errors, requestedMonths: months };
}
