// HTTP 공통: 보안 헤더, 쿠키, 본문 상한 읽기, 응답, 본문 없는 접근 로그.
import type { IncomingMessage, ServerResponse } from "node:http";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
export const randomToken = (bytes = 32) => randomBytes(bytes).toString("base64url");

export function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}

export function parseCookies(req: IncomingMessage): Record<string, string> {
  const out: Record<string, string> = {};
  const h = req.headers.cookie;
  if (!h) return out;
  for (const part of h.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (!/^[A-Za-z0-9_-]+$/.test(k)) continue;
    out[k] = part.slice(i + 1).trim();
  }
  return out;
}

export interface CookieOpts { maxAgeSec?: number; path?: string; sameSite?: "Lax" | "Strict"; secure: boolean }
export function cookie(name: string, value: string, o: CookieOpts): string {
  return [`${name}=${value}`, `Path=${o.path ?? "/"}`, "HttpOnly", `SameSite=${o.sameSite ?? "Lax"}`, o.secure ? "Secure" : "", o.maxAgeSec !== undefined ? `Max-Age=${o.maxAgeSec}` : ""].filter(Boolean).join("; ");
}

export function addSetCookie(res: ServerResponse, c: string) {
  const prev = res.getHeader("Set-Cookie");
  res.setHeader("Set-Cookie", prev ? [...(Array.isArray(prev) ? prev : [String(prev)]), c] : [c]);
}

export function securityHeaders(res: ServerResponse, opts: { kakao: boolean }) {
  const kakaoScript = opts.kakao ? " https://dapi.kakao.com https://t1.daumcdn.net" : "";
  const kakaoImg = opts.kakao ? " https://*.daumcdn.net https://*.kakao.com" : "";
  res.setHeader(
    "Content-Security-Policy",
    `default-src 'self'; script-src 'self'${kakaoScript}; style-src 'self'; img-src 'self' data:${kakaoImg}; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; form-action 'self'; base-uri 'none'; object-src 'none'`,
  );
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Permissions-Policy", "geolocation=(), camera=(), microphone=(), payment=()");
}

export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

/** 상한을 넘으면 즉시 중단(413). 본문 내용은 로그에 남기지 않는다. */
export function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  const declared = Number(req.headers["content-length"] ?? "NaN");
  if (Number.isFinite(declared) && declared > limit) {
    req.resume();
    return Promise.reject(new HttpError(413, "BODY_TOO_LARGE", `요청 본문이 상한(${limit}바이트)을 초과함`));
  }
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let done = false;
    req.on("data", (c: Buffer) => {
      if (done) return;
      size += c.length;
      if (size > limit) {
        done = true;
        req.resume();
        reject(new HttpError(413, "BODY_TOO_LARGE", `요청 본문이 상한(${limit}바이트)을 초과함`));
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => { if (!done) { done = true; resolve(Buffer.concat(chunks)); } });
    req.on("error", () => { if (!done) { done = true; reject(new HttpError(400, "BODY_READ", "본문 읽기 실패")); } });
  });
}

export function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

const escHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
export { escHtml };

/** 서버가 직접 그리는 간단한 안내 페이지(시동 오류 등). 스크립트 없음. */
export function sendPage(res: ServerResponse, status: number, title: string, bodyHtml: string) {
  res.statusCode = status;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escHtml(title)}</title><link rel="stylesheet" href="/assets/page.css"></head><body><main class="notice"><h1>${escHtml(title)}</h1>${bodyHtml}<p class="muted">아파트 입지·가격 분석기 · 이 화면은 협의체로 결과를 보내지 않습니다.</p></main></body></html>`);
}

export function redirect303(res: ServerResponse, location: string) {
  res.statusCode = 303;
  res.setHeader("Location", location);
  res.setHeader("Cache-Control", "no-store");
  res.end();
}

export function clientIp(req: IncomingMessage, trustProxy: boolean): string {
  if (trustProxy) {
    const xf = req.headers["x-forwarded-for"];
    if (typeof xf === "string" && xf) return xf.split(",")[0].trim();
  }
  return req.socket.remoteAddress ?? "unknown";
}

export class RateLimiter {
  private hits = new Map<string, { n: number; reset: number }>();
  constructor(private perMin: number) {}
  allow(key: string, now = Date.now()): boolean {
    const h = this.hits.get(key);
    if (!h || h.reset <= now) { this.hits.set(key, { n: 1, reset: now + 60000 }); return true; }
    h.n++;
    if (this.hits.size > 10000) for (const [k, v] of this.hits) if (v.reset <= now) this.hits.delete(k);
    return h.n <= this.perMin;
  }
}

/** 접근 로그: 메서드·경로 패턴·상태·시간만. 본문·쿼리·쿠키·수령 코드·실제 경로 토큰은 남기지 않는다. */
export type Logger = (entry: { method: string; route: string; status: number; ms: number; note?: string }) => void;
export const consoleLogger: Logger = (e) => console.log(JSON.stringify({ t: new Date().toISOString(), ...e }));
