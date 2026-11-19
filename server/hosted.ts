// Vercel 등 서버리스 배포용 API 핸들러(상태 없음). 로컬 서버(server/app.ts)와 별개.
// - 국토부·카카오 키는 서버 환경변수에만 두고 브라우저로 보내지 않는다(카카오 JS 키 제외 — 도메인 제한 필수).
// - 자동 조회는 접속 비밀번호 로그인 후에만 허용. 비밀번호·세션 비밀값이 설정되지 않으면 조회를 막는다(한도 소진 방지).
// - 세션·CSRF 토큰은 서버 저장 없이 HMAC 서명으로 확인한다. 협의체(Render) 서버로는 어떤 요청도 보내지 않는다.
import type { IncomingMessage, ServerResponse } from "node:http";
import { createHmac, timingSafeEqual } from "node:crypto";
import { loadConfig, type AppConfig } from "./config.ts";
import { collectPublicData } from "./collect.ts";
import { addSetCookie, clientIp, cookie, HttpError, parseCookies, RateLimiter, readBody, sendJson, sendPage, securityHeaders } from "./http.ts";
import type { SafeFetchDeps } from "./publicData.ts";

export const AUTH_COOKIE = "la_auth";
const SESSION_HOURS = 12;

export interface HostedEnv { cfg: AppConfig; password: string | null; secret: string | null }

export function hostedEnv(env: NodeJS.ProcessEnv = process.env): HostedEnv {
  const cfg = loadConfig({ ...env, TRUST_PROXY: "true", COOKIE_SECURE: env.COOKIE_SECURE ?? "true" });
  const secret = env.APP_SESSION_SECRET && env.APP_SESSION_SECRET.length >= 32 ? env.APP_SESSION_SECRET : null;
  return { cfg, password: env.APP_ACCESS_PASSWORD || null, secret };
}

const hmac = (secret: string, msg: string) => createHmac("sha256", secret).update(msg).digest("base64url");
const eq = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };

/** 로그인 쿠키 값: "<만료 ms>.<서명>" */
export function issueAuth(secret: string, now: number): string {
  const exp = String(now + SESSION_HOURS * 3600_000);
  return `${exp}.${hmac(secret, `auth.${exp}`)}`;
}
export function validAuth(secret: string, value: string | undefined, now: number): boolean {
  if (!value) return false;
  const [exp, sig] = value.split(".");
  if (!exp || !sig || !/^\d{10,16}$/.test(exp) || Number(exp) <= now) return false;
  return eq(sig, hmac(secret, `auth.${exp}`));
}
/** CSRF 토큰: 로그인 쿠키에 묶인 서명(쿠키를 모르는 다른 사이트는 만들 수 없음) */
export const csrfFor = (secret: string, auth: string) => hmac(secret, `csrf.${auth}`);


function sameOrigin(req: IncomingMessage) {
  const site = req.headers["sec-fetch-site"];
  if (site && site !== "same-origin" && site !== "none") throw new HttpError(403, "CROSS_SITE", "다른 사이트에서 보낸 요청은 허용하지 않음");
}
async function readJson(req: IncomingMessage, limit: number) {
  const ct = String(req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
  if (ct !== "application/json") throw new HttpError(415, "CONTENT_TYPE", "application/json 필요");
  const buf = await readBody(req, limit);
  try { return JSON.parse(buf.toString("utf8")); } catch { throw new HttpError(400, "JSON", "JSON 형식 오류"); }
}
function wrap(fn: (req: IncomingMessage, res: ServerResponse) => Promise<void>) {
  return async (req: IncomingMessage, res: ServerResponse) => {
    securityHeaders(res, { kakao: false });
    res.setHeader("Cache-Control", "no-store");
    try { await fn(req, res); }
    catch (e) {
      if (e instanceof HttpError) return sendJson(res, e.status, { code: e.code, message: e.message });
      // 본문·키·주소를 로그에 남기지 않음
      console.error(JSON.stringify({ t: new Date().toISOString(), route: req.url?.split("?")[0], error: (e as Error)?.name ?? "Error" }));
      sendJson(res, 500, { code: "INTERNAL", message: "서버 오류" });
    }
  };
}

export function hostedHandlers(he: HostedEnv = hostedEnv(), deps: { now?: () => number; publicDataDeps?: SafeFetchDeps } = {}) {
  const now = deps.now ?? (() => Date.now());
  const { cfg, password, secret } = he;
  const authOf = (req: IncomingMessage) => {
    const v = parseCookies(req)[AUTH_COOKIE];
    return secret && validAuth(secret, v, now()) ? v! : null;
  };
  const authReady = !!(password && secret);
  // 서버리스 인스턴스 단위 제한(인스턴스가 여러 개면 합산되지 않음 — 비밀번호가 1차 방어)
  const loginLimiter = new RateLimiter(5);
  const lookupLimiter = new RateLimiter(6);

  const session = wrap(async (req, res) => {
    if (req.method !== "GET") throw new HttpError(405, "METHOD", "허용되지 않는 메서드");
    const auth = authOf(req);
    sendJson(res, 200, {
      csrfToken: auth && secret ? csrfFor(secret, auth) : "",
      config: {
        kakaoJsKey: cfg.kakaoJsKey,
        publicData: cfg.molit.serviceKey ? "configured" : "unset",
        geocoder: cfg.kakaoRestKey ? "configured" : "unset",
        launchReceiver: "standby",
        publicDataAutoFetch: false,
        tempAnalysisTtlHours: 0,
        launchPendingTtlSec: 0,
        launchMaxBodyBytes: 0,
        serverPersistentStorage: "disabled",
        externalAi: "disabled",
        hosting: "serverless",
        auth: { required: true, ready: authReady, signedIn: !!auth },
      },
    });
  });

  const login = wrap(async (req, res) => {
    if (req.method !== "POST") throw new HttpError(405, "METHOD", "허용되지 않는 메서드");
    sameOrigin(req);
    if (!authReady) throw new HttpError(503, "AUTH_UNSET", "접속 비밀번호·세션 비밀값이 서버에 설정되지 않아 자동 조회를 사용할 수 없음");
    if (!loginLimiter.allow(clientIp(req, true), now())) throw new HttpError(429, "RATE_LIMIT", "로그인 시도가 너무 많음. 1분 후 다시 시도");
    const body = await readJson(req, 4096);
    const given = typeof body?.password === "string" ? body.password : "";
    const a = Buffer.from(hmac(secret!, `pw.${given}`)), b = Buffer.from(hmac(secret!, `pw.${password}`));
    if (!timingSafeEqual(a, b)) throw new HttpError(401, "WRONG_PASSWORD", "비밀번호가 맞지 않음");
    const v = issueAuth(secret!, now());
    addSetCookie(res, cookie(AUTH_COOKIE, v, { secure: cfg.cookieSecure, sameSite: "Strict", maxAgeSec: SESSION_HOURS * 3600 }));
    sendJson(res, 200, { signedIn: true, csrfToken: csrfFor(secret!, v) });
  });

  const logout = wrap(async (req, res) => {
    if (req.method !== "POST") throw new HttpError(405, "METHOD", "허용되지 않는 메서드");
    sameOrigin(req);
    addSetCookie(res, cookie(AUTH_COOKIE, "", { secure: cfg.cookieSecure, sameSite: "Strict", maxAgeSec: 0 }));
    sendJson(res, 200, { signedIn: false });
  });

  const lookup = wrap(async (req, res) => {
    if (req.method !== "POST") throw new HttpError(405, "METHOD", "허용되지 않는 메서드");
    sameOrigin(req);
    if (!authReady) throw new HttpError(503, "AUTH_UNSET", "접속 비밀번호가 설정되지 않아 자동 조회를 막았음(한도 소진 방지)");
    const auth = authOf(req);
    if (!auth) throw new HttpError(401, "NO_SESSION", "자동 조회는 접속 비밀번호로 로그인한 뒤 사용할 수 있음");
    const tok = req.headers["x-csrf-token"];
    if (typeof tok !== "string" || !eq(tok, csrfFor(secret!, auth))) throw new HttpError(403, "CSRF", "CSRF 토큰 불일치");
    if (!lookupLimiter.allow(clientIp(req, true), now())) throw new HttpError(429, "RATE_LIMIT", "조회가 너무 잦음. 잠시 후 다시 시도");
    if (!cfg.molit.serviceKey && !cfg.kakaoRestKey) return sendJson(res, 503, { status: "unset", message: "공공데이터·지도 키 미설정 — 자동 조회 불가" });
    const body = await readJson(req, 64 * 1024);
    sendJson(res, 200, await collectPublicData(cfg, body, deps.publicDataDeps));
  });

  /** 협의체 시동 수신은 서버리스 배포에서 계속 대기(비활성) */
  const launch = async (req: IncomingMessage, res: ServerResponse) => {
    req.resume();
    securityHeaders(res, { kakao: false });
    res.setHeader("Referrer-Policy", "no-referrer");
    sendPage(res, 503, "협의체 시동 수신은 대기 중입니다", "<p>입력 규격과 수신 주소가 확정되기 전까지 이 경로는 비활성입니다. 받은 자료는 저장하지 않았습니다.</p><p><a href=\"/app\">아파트 입지·가격 분석기에서 주소로 직접 시작하기</a></p>");
  };

  return { session, login, logout, lookup, launch };
}
