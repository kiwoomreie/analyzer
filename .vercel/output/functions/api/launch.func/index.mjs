import { createRequire as __cr } from "node:module"; const require = __cr(import.meta.url);

// server/hosted.ts
import { createHmac, timingSafeEqual } from "node:crypto";

// server/config.ts
var int = (v, d) => v && /^\d+$/.test(v) ? Number(v) : d;
function loadConfig(env = process.env) {
  const prod = env.NODE_ENV === "production";
  return {
    host: env.HOST ?? "127.0.0.1",
    port: int(env.PORT, 5174),
    dbPath: env.DB_PATH ?? "./data/location-analyzer.db",
    webRoot: env.WEB_ROOT ?? "./dist/web",
    cookieSecure: env.COOKIE_SECURE ? env.COOKIE_SECURE !== "false" : true,
    launchMaxBodyBytes: int(env.LAUNCH_MAX_BODY_BYTES, 64 * 1024),
    apiMaxBodyBytes: int(env.API_MAX_BODY_BYTES, 4 * 1024 * 1024),
    launchPendingTtlSec: int(env.LAUNCH_PENDING_TTL_SEC, 600),
    tempAnalysisTtlHours: int(env.TEMP_ANALYSIS_TTL_HOURS, 24),
    workspaceTtlDays: int(env.WORKSPACE_TTL_DAYS, 30),
    rateLimitLaunchPerMin: int(env.RATE_LIMIT_LAUNCH_PER_MIN, 30),
    rateLimitApiPerMin: int(env.RATE_LIMIT_API_PER_MIN, 600),
    cleanupIntervalSec: int(env.CLEANUP_INTERVAL_SEC, 60),
    kakaoJsKey: env.KAKAO_JS_KEY || null,
    kakaoRestKey: env.KAKAO_REST_KEY || null,
    launchReceiverEnabled: env.LAUNCH_RECEIVER_ENABLED === "true",
    molit: {
      serviceKey: env.MOLIT_SERVICE_KEY || null,
      // 공식 문서(data.go.kr 15126469)로 최종 확인 필요. 호스트는 publicData.ts 허용목록으로 고정.
      endpoint: env.MOLIT_APT_TRADE_ENDPOINT ?? "https://apis.data.go.kr/1613000/RTMSDataSvcAptTrade/getRTMSDataSvcAptTrade",
      autoFetch: env.PUBLIC_DATA_AUTO_FETCH === "true",
      maxMonths: int(env.PUBLIC_DATA_MAX_MONTHS, 12)
    },
    trustProxy: env.TRUST_PROXY === "true" || prod
  };
}

// shared/dates.ts
var RE = /^(\d{4})-(0[1-9]|1[0-2])(?:-(0[1-9]|[12]\d|3[01]))?$/;
function parseDateValue(raw) {
  if (!raw) return null;
  const m = RE.exec(raw);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  if (m[3] === void 0) return { raw, precision: "month", y, m: mo };
  const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return { raw, precision: "day", y, m: mo, d };
}
function seoulToday(now = /* @__PURE__ */ new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
function seoulNowIso(now = /* @__PURE__ */ new Date()) {
  const t = new Date(now.getTime() + 9 * 36e5);
  return t.toISOString().replace("Z", "+09:00");
}

// server/publicData.ts
import { request as httpsRequest } from "node:https";
import { lookup as dnsLookup } from "node:dns";
import { isIP } from "node:net";

// shared/hash.ts
var K = new Uint32Array([
  1116352408,
  1899447441,
  3049323471,
  3921009573,
  961987163,
  1508970993,
  2453635748,
  2870763221,
  3624381080,
  310598401,
  607225278,
  1426881987,
  1925078388,
  2162078206,
  2614888103,
  3248222580,
  3835390401,
  4022224774,
  264347078,
  604807628,
  770255983,
  1249150122,
  1555081692,
  1996064986,
  2554220882,
  2821834349,
  2952996808,
  3210313671,
  3336571891,
  3584528711,
  113926993,
  338241895,
  666307205,
  773529912,
  1294757372,
  1396182291,
  1695183700,
  1986661051,
  2177026350,
  2456956037,
  2730485921,
  2820302411,
  3259730800,
  3345764771,
  3516065817,
  3600352804,
  4094571909,
  275423344,
  430227734,
  506948616,
  659060556,
  883997877,
  958139571,
  1322822218,
  1537002063,
  1747873779,
  1955562222,
  2024104815,
  2227730452,
  2361852424,
  2428436474,
  2756734187,
  3204031479,
  3329325298
]);

// shared/model.ts
var counter = 0;
function newKey(prefix) {
  counter = (counter + 1) % 1e6;
  const rnd = Math.floor(Math.random() * 36 ** 6).toString(36).padStart(6, "0");
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${rnd}`;
}
var complexKeyOf = (t) => t.complexId ? `S:${t.complexId.trim()}` : `N:${t.complexName.trim()}|${(t.sggCd ?? "").trim()}|${(t.dong ?? "").trim()}|${(t.jibun ?? "").trim()}`;

// server/publicData.ts
var ALLOWED_HOSTS = /* @__PURE__ */ new Set(["apis.data.go.kr", "dapi.kakao.com"]);
var OutboundBlocked = class extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
  code;
};
function isBlockedIp(ip) {
  const v = isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168 || a === 100 && b >= 64 && b <= 127 || a >= 224 || a === 192 && b === 0 || a === 198 && (b === 18 || b === 19);
  }
  if (v === 6) {
    const s = ip.toLowerCase();
    if (s === "::" || s === "::1") return true;
    if (s.startsWith("fe8") || s.startsWith("fe9") || s.startsWith("fea") || s.startsWith("feb")) return true;
    if (s.startsWith("fc") || s.startsWith("fd")) return true;
    if (s.startsWith("ff")) return true;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(s);
    if (mapped) return isBlockedIp(mapped[1]);
    return false;
  }
  return true;
}
function checkTargetUrl(raw) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    throw new OutboundBlocked("BAD_URL", "\uC8FC\uC18C \uD615\uC2DD \uC624\uB958");
  }
  if (u.protocol !== "https:") throw new OutboundBlocked("SCHEME", "https\uB9CC \uD5C8\uC6A9");
  if (u.username || u.password) throw new OutboundBlocked("USERINFO", "\uC8FC\uC18C\uC5D0 \uACC4\uC815\uC815\uBCF4 \uBD88\uAC00");
  if (isIP(u.hostname.replace(/^\[|\]$/g, ""))) throw new OutboundBlocked("IP_LITERAL", "IP \uC8FC\uC18C \uC9C1\uC811 \uC9C0\uC815 \uBD88\uAC00");
  if (!ALLOWED_HOSTS.has(u.hostname.toLowerCase())) throw new OutboundBlocked("HOST_NOT_ALLOWED", "\uD5C8\uC6A9\uBAA9\uB85D \uC678 \uD638\uC2A4\uD2B8");
  if (u.port && u.port !== "443") throw new OutboundBlocked("PORT", "443 \uC678 \uD3EC\uD2B8 \uBD88\uAC00");
  return u;
}
var defaultLookup = (host, cb) => dnsLookup(host, { all: true }, (e, a) => cb(e, a));
async function safeGet(raw, opts = {}, deps = {}) {
  const u = checkTargetUrl(raw);
  const lookup = deps.lookup ?? defaultLookup;
  const addrs = await new Promise((resolve, reject) => lookup(u.hostname, (e, a) => e ? reject(new OutboundBlocked("DNS", "\uC774\uB984 \uD574\uC11D \uC2E4\uD328")) : resolve(a)));
  if (!addrs.length || addrs.some((a) => isBlockedIp(a.address))) throw new OutboundBlocked("PRIVATE_ADDRESS", "\uC0AC\uC124\xB7\uBCF4\uD638 \uC8FC\uC18C\uB85C \uD574\uC11D\uB428");
  const address = addrs[0];
  const timeoutMs = opts.timeoutMs ?? 8e3;
  const maxBytes = opts.maxBytes ?? 2 * 1024 * 1024;
  const transport = deps.transport ?? ((url, addr, h) => realTransport(url, addr, timeoutMs, maxBytes, h));
  const r = await transport(u, address, opts.headers ?? {});
  if (r.status >= 300 && r.status < 400) throw new OutboundBlocked("REDIRECT", "\uB9AC\uB514\uB809\uC158\uC740 \uB530\uB974\uC9C0 \uC54A\uC74C");
  if (r.body.length > maxBytes) throw new OutboundBlocked("TOO_LARGE", "\uC751\uB2F5 \uD06C\uAE30 \uC0C1\uD55C \uCD08\uACFC");
  return { status: r.status, body: r.body };
}
function realTransport(u, addr, timeoutMs, maxBytes, extraHeaders) {
  return new Promise((resolve, reject) => {
    const req = httpsRequest(
      {
        host: u.hostname,
        servername: u.hostname,
        path: u.pathname + u.search,
        method: "GET",
        port: 443,
        family: addr.family,
        timeout: timeoutMs,
        // 검사한 주소로만 접속(DNS 재바인딩 방지)
        lookup: (_h, _o, cb) => cb(null, addr.address, addr.family),
        headers: { Accept: "application/xml, text/xml, application/json", ...extraHeaders }
      },
      (res) => {
        const chunks = [];
        let size = 0;
        res.on("data", (c) => {
          size += c.length;
          if (size > maxBytes) {
            req.destroy();
            reject(new OutboundBlocked("TOO_LARGE", "\uC751\uB2F5 \uD06C\uAE30 \uC0C1\uD55C \uCD08\uACFC"));
          } else chunks.push(c);
        });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
      }
    );
    req.on("timeout", () => {
      req.destroy();
      reject(new OutboundBlocked("TIMEOUT", "\uC2DC\uAC04 \uCD08\uACFC"));
    });
    req.on("error", () => reject(new OutboundBlocked("NETWORK", "\uC678\uBD80 \uD638\uCD9C \uC2E4\uD328")));
    req.end();
  });
}
function tag(item, name) {
  const m = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(item);
  return m ? m[1].trim() : void 0;
}
function parseMolitAptTrades(xml, source = "\uAD6D\uD1A0\uAD50\uD1B5\uBD80 \uC544\uD30C\uD2B8 \uB9E4\uB9E4 \uC2E4\uAC70\uB798\uAC00 API") {
  const resultCode = tag(xml, "resultCode");
  const resultMsg = tag(xml, "resultMsg");
  const num = (v) => v !== void 0 && /^\d+$/.test(v) ? Number(v) : null;
  const items = [];
  const re = /<item>([\s\S]*?)<\/item>/g;
  let m;
  let rawItemCount = 0;
  while ((m = re.exec(xml)) && rawItemCount < 2e4) {
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
      key: newKey("tx"),
      complexName: (tag(it, "aptNm") ?? "\uB2E8\uC9C0\uBA85 \uBBF8\uC0C1").slice(0, 80),
      complexId: tag(it, "aptSeq")?.slice(0, 40) || void 0,
      sggCd: tag(it, "sggCd")?.slice(0, 5) || void 0,
      dong: tag(it, "umdNm")?.slice(0, 40) || void 0,
      jibun: tag(it, "jibun")?.slice(0, 40) || void 0,
      aptDong: tag(it, "aptDong")?.slice(0, 20) || void 0,
      exclusiveAreaM2: area,
      floor: Number(tag(it, "floor")) || void 0,
      priceKrw: Math.round(amountMan * 1e4),
      contractDate,
      knownOn: seoulToday(),
      cancelled: !!tag(it, "cdealDay") || !["", "0", "N"].includes(cdeal.toUpperCase()),
      cancelDate: tag(it, "cdealDay") || void 0,
      buildYear: Number(tag(it, "buildYear")) || void 0,
      dataMode: "official-api",
      source
    });
  }
  return { items, resultCode, resultMsg, totalCount: num(tag(xml, "totalCount")), numOfRows: num(tag(xml, "numOfRows")), pageNo: num(tag(xml, "pageNo")), rawItemCount };
}
async function fetchMolitMonth(cfg, lawdCode, ym, deps = {}, rows = 1e3) {
  const out = { lawdCode, yearMonth: ym, totalCount: null, collected: 0, pagesExpected: null, pagesFetched: 0, ok: false, items: [] };
  const maxPages = cfg.maxPages ?? 20;
  const source = `\uAD6D\uD1A0\uAD50\uD1B5\uBD80 \uC544\uD30C\uD2B8 \uB9E4\uB9E4 \uC2E4\uAC70\uB798\uAC00 API(${seoulToday()} \uC870\uD68C)`;
  for (let page = 1; page <= (out.pagesExpected ?? 1); page++) {
    if (page > maxPages) {
      out.error = `\uD398\uC774\uC9C0 \uC0C1\uD55C(${maxPages}) \uCD08\uACFC \u2014 \uC77C\uBD80 \uBBF8\uC218\uC9D1`;
      break;
    }
    const u = new URL(cfg.endpoint);
    u.searchParams.set("serviceKey", cfg.serviceKey);
    u.searchParams.set("LAWD_CD", lawdCode);
    u.searchParams.set("DEAL_YMD", ym);
    u.searchParams.set("numOfRows", String(rows));
    u.searchParams.set("pageNo", String(page));
    try {
      const r = await safeGet(u.toString(), {}, deps);
      if (r.status !== 200) {
        out.error = `${page}\uCABD \uC751\uB2F5 ${r.status}`;
        break;
      }
      const p = parseMolitAptTrades(r.body.toString("utf8"), source);
      if (!/^0+$/.test(p.resultCode ?? "")) {
        out.error = `${page}\uCABD \uC131\uACF5 \uCF54\uB4DC \uBBF8\uD655\uC778`;
        break;
      }
      if (p.totalCount === null) {
        out.error = "\uC804\uCCB4 \uAC74\uC218(totalCount) \uC5C6\uC74C \u2014 \uB300\uC0AC \uBD88\uAC00";
        out.items.push(...p.items);
        out.pagesFetched++;
        break;
      }
      if ((p.pageNo !== null || p.totalCount > (p.numOfRows || rows)) && p.pageNo !== page || page > 1 && out.totalCount !== p.totalCount) {
        out.error = `${page}\uCABD \uD398\uC774\uC9C0 \uBC88\uD638 \uB610\uB294 \uC804\uCCB4 \uAC74\uC218 \uBD88\uC77C\uCE58`;
        break;
      }
      if (p.items.some((t) => t.contractDate.slice(0, 7).replace("-", "") !== ym || t.sggCd && t.sggCd !== lawdCode)) {
        out.error = `${page}\uCABD \uC694\uCCAD \uC2DC\uAD70\uAD6C\xB7\uACC4\uC57D\uC6D4 \uBD88\uC77C\uCE58`;
        break;
      }
      p.items.forEach((t) => {
        t.sggCd ??= lawdCode;
      });
      if (p.items.length !== p.rawItemCount) {
        out.error = `${page}\uCABD \uAC70\uB798 \uD544\uC218\uAC12 \uB204\uB77D \xB7 \uAC74\uC218 \uB300\uC0AC \uBD88\uAC00`;
        break;
      }
      if (p.numOfRows !== null && p.numOfRows < 1) {
        out.error = "\uD398\uC774\uC9C0 \uD06C\uAE30 \uC624\uB958";
        break;
      }
      out.totalCount = p.totalCount;
      out.pagesExpected = Math.max(1, Math.ceil(p.totalCount / (p.numOfRows || rows)));
      out.items.push(...p.items);
      out.collected += p.rawItemCount;
      out.pagesFetched++;
    } catch (e) {
      out.error = `${page}\uCABD ${e instanceof OutboundBlocked ? e.code : "\uD638\uCD9C \uC2E4\uD328"}`;
      break;
    }
  }
  out.ok = !out.error && out.totalCount !== null && out.collected === out.totalCount && out.pagesFetched === out.pagesExpected;
  if (!out.error && out.totalCount !== null && out.collected !== out.totalCount) out.error = `\uAC74\uC218 \uBD88\uC77C\uCE58(\uC804\uCCB4 ${out.totalCount}, \uC218\uC9D1 ${out.collected})`;
  return out;
}
function parseKakaoAddress(json) {
  let d;
  try {
    d = JSON.parse(json);
  } catch {
    return null;
  }
  const doc = Array.isArray(d?.documents) ? d.documents[0] : null;
  if (!doc) return null;
  const lng = Number(doc.x), lat = Number(doc.y);
  if (!(lat >= 33 && lat <= 39 && lng >= 124 && lng <= 132)) return null;
  const bcode = String(doc.address?.b_code ?? "");
  return { lat, lng, lawdCode: /^\d{10}$/.test(bcode) ? bcode.slice(0, 5) : void 0, source: `\uCE74\uCE74\uC624 \uB85C\uCEEC \uC8FC\uC18C\uAC80\uC0C9(${seoulToday()})` };
}
async function geocodeKakao(restKey, address, deps = {}) {
  if (!restKey || !address.trim()) return null;
  const u = new URL("https://dapi.kakao.com/v2/local/search/address.json");
  u.searchParams.set("query", address.slice(0, 200));
  const r = await safeGet(u.toString(), { headers: { Authorization: `KakaoAK ${restKey}` } }, deps);
  if (r.status !== 200) throw new OutboundBlocked("STATUS", `\uC8FC\uC18C \uAC80\uC0C9 \uC751\uB2F5 ${r.status}`);
  return parseKakaoAddress(r.body.toString("utf8"));
}
function samplePoints(center, radiusM) {
  const pts = [center];
  for (const f of [1, 0.5]) for (let k = 0; k < 8; k++) {
    const ang = k * Math.PI / 4;
    const dLat = radiusM * f * Math.cos(ang) / 111320;
    const dLng = radiusM * f * Math.sin(ang) / (111320 * Math.cos(center.lat * Math.PI / 180));
    pts.push({ lat: center.lat + dLat, lng: center.lng + dLng });
  }
  return pts;
}
async function regionsAround(restKey, center, radiusM, deps = {}) {
  const pts = samplePoints(center, radiusM);
  const map = /* @__PURE__ */ new Map();
  let failed = 0;
  for (const p of pts) {
    const u = new URL("https://dapi.kakao.com/v2/local/geo/coord2regioncode.json");
    u.searchParams.set("x", String(p.lng));
    u.searchParams.set("y", String(p.lat));
    try {
      const r = await safeGet(u.toString(), { headers: { Authorization: `KakaoAK ${restKey}` } }, deps);
      const d = JSON.parse(r.body.toString("utf8"));
      const b = (d?.documents ?? []).find((x) => x.region_type === "B") ?? d?.documents?.[0];
      const code = String(b?.code ?? "");
      if (r.status !== 200 || !/^\d{10}$/.test(code)) {
        failed++;
        continue;
      }
      map.set(code.slice(0, 5), { code: code.slice(0, 5), name1: String(b.region_1depth_name ?? ""), name2: String(b.region_2depth_name ?? "") });
    } catch {
      failed++;
    }
  }
  return { regions: [...map.values()], failedPoints: failed, sampled: pts.length };
}
async function geocodeComplex(restKey, region, dong, jibun, deps = {}) {
  if (!region?.name2 || !dong || !jibun) return null;
  const address = `${region.name1} ${region.name2} ${dong} ${jibun}`.trim();
  const g = await geocodeKakao(restKey, address, deps);
  return g && g.lawdCode === region.code ? { lat: g.lat, lng: g.lng, address } : null;
}

// server/http.ts
function parseCookies(req) {
  const out = {};
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
function cookie(name, value, o) {
  return [`${name}=${value}`, `Path=${o.path ?? "/"}`, "HttpOnly", `SameSite=${o.sameSite ?? "Lax"}`, o.secure ? "Secure" : "", o.maxAgeSec !== void 0 ? `Max-Age=${o.maxAgeSec}` : ""].filter(Boolean).join("; ");
}
function addSetCookie(res, c) {
  const prev = res.getHeader("Set-Cookie");
  res.setHeader("Set-Cookie", prev ? [...Array.isArray(prev) ? prev : [String(prev)], c] : [c]);
}
function securityHeaders(res, opts) {
  const kakaoScript = opts.kakao ? " https://dapi.kakao.com https://t1.daumcdn.net" : "";
  const kakaoImg = opts.kakao ? " https://*.daumcdn.net https://*.kakao.com" : "";
  res.setHeader(
    "Content-Security-Policy",
    `default-src 'self'; script-src 'self'${kakaoScript}; style-src 'self'; img-src 'self' data:${kakaoImg}; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; form-action 'self'; base-uri 'none'; object-src 'none'`
  );
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Permissions-Policy", "geolocation=(), camera=(), microphone=(), payment=()");
}
var HttpError = class extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
  status;
  code;
};
function readBody(req, limit) {
  const declared = Number(req.headers["content-length"] ?? "NaN");
  if (Number.isFinite(declared) && declared > limit) {
    req.resume();
    return Promise.reject(new HttpError(413, "BODY_TOO_LARGE", `\uC694\uCCAD \uBCF8\uBB38\uC774 \uC0C1\uD55C(${limit}\uBC14\uC774\uD2B8)\uC744 \uCD08\uACFC\uD568`));
  }
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let done = false;
    req.on("data", (c) => {
      if (done) return;
      size += c.length;
      if (size > limit) {
        done = true;
        req.resume();
        reject(new HttpError(413, "BODY_TOO_LARGE", `\uC694\uCCAD \uBCF8\uBB38\uC774 \uC0C1\uD55C(${limit}\uBC14\uC774\uD2B8)\uC744 \uCD08\uACFC\uD568`));
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      if (!done) {
        done = true;
        resolve(Buffer.concat(chunks));
      }
    });
    req.on("error", () => {
      if (!done) {
        done = true;
        reject(new HttpError(400, "BODY_READ", "\uBCF8\uBB38 \uC77D\uAE30 \uC2E4\uD328"));
      }
    });
  });
}
function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}
var escHtml = (s) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
function sendPage(res, status, title, bodyHtml) {
  res.statusCode = status;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escHtml(title)}</title><link rel="stylesheet" href="/assets/page.css"></head><body><main class="notice"><h1>${escHtml(title)}</h1>${bodyHtml}<p class="muted">\uC544\uD30C\uD2B8 \uC785\uC9C0\xB7\uAC00\uACA9 \uBD84\uC11D\uAE30 \xB7 \uC774 \uD654\uBA74\uC740 \uD611\uC758\uCCB4\uB85C \uACB0\uACFC\uB97C \uBCF4\uB0B4\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.</p></main></body></html>`);
}
function clientIp(req, trustProxy) {
  if (trustProxy) {
    const xf = req.headers["x-forwarded-for"];
    if (typeof xf === "string" && xf) return xf.split(",")[0].trim();
  }
  return req.socket.remoteAddress ?? "unknown";
}
var RateLimiter = class {
  constructor(perMin) {
    this.perMin = perMin;
  }
  perMin;
  hits = /* @__PURE__ */ new Map();
  allow(key, now = Date.now()) {
    const h = this.hits.get(key);
    if (!h || h.reset <= now) {
      this.hits.set(key, { n: 1, reset: now + 6e4 });
      return true;
    }
    h.n++;
    if (this.hits.size > 1e4) {
      for (const [k, v] of this.hits) if (v.reset <= now) this.hits.delete(k);
    }
    return h.n <= this.perMin;
  }
};

// server/collect.ts
var LIMITS = { regions: 6, complexes: 80 };
function recentMonths(asOf, n) {
  const [y, m] = asOf.split("-").map(Number);
  const out = [];
  for (let i = 0; i < n; i++) {
    const total = y * 12 + (m - 1) - i;
    out.push(`${Math.floor(total / 12)}${String(total % 12 + 1).padStart(2, "0")}`);
  }
  return out;
}
async function collectPublicData(cfg, body, pd) {
  const at = seoulNowIso();
  const notes = [];
  const address = typeof body?.address === "string" ? body.address.slice(0, 200) : "";
  const asOf = typeof body?.asOf === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.asOf) ? body.asOf : null;
  if (!address || !asOf || !parseDateValue(asOf)) throw new HttpError(400, "INPUT", "address\xB7asOf \uD544\uC694");
  const through = body?.through ?? asOf;
  if (typeof through !== "string" || parseDateValue(through)?.precision !== "day" || through > asOf) throw new HttpError(400, "INPUT", "\uC870\uD68C \uC885\uB8CC\uC77C \uD655\uC778 \uD544\uC694");
  const radiusM = Math.min(Math.max(Number(body?.radiusM) || 1500, 100), 5e3);
  const months = Math.min(Math.max(Number(body?.months) || 12, 1), cfg.molit.maxMonths);
  if ((Number(body?.months) || 12) > cfg.molit.maxMonths) notes.push(`\uC694\uCCAD ${Number(body?.months)}\uAC1C\uC6D4 \uC911 ${months}\uAC1C\uC6D4\uB9CC \uC218\uC9D1(\uC0C1\uD55C)`);
  let center = body?.center && Number.isFinite(body.center.lat) && Number.isFinite(body.center.lng) ? { lat: body.center.lat, lng: body.center.lng } : null;
  let geocode = null;
  if (cfg.kakaoRestKey) {
    try {
      geocode = await geocodeKakao(cfg.kakaoRestKey, address, pd);
      notes.push(geocode ? "\uC8FC\uC18C\u2192\uC88C\uD45C \uC870\uD68C\uB428" : "\uC8FC\uC18C \uAC80\uC0C9 \uACB0\uACFC \uC5C6\uC74C");
    } catch (e) {
      notes.push(`\uC8FC\uC18C \uAC80\uC0C9 \uC2E4\uD328(${e instanceof OutboundBlocked ? e.code : "\uC624\uB958"})`);
    }
  } else notes.push("\uC8FC\uC18C\u2192\uC88C\uD45C: \uC9C0\uB3C4 \uD0A4 \uBBF8\uC124\uC815");
  center ??= geocode ? { lat: geocode.lat, lng: geocode.lng } : null;
  const extra = Array.isArray(body?.extraLawdCodes) ? body.extraLawdCodes.filter((x) => typeof x === "string" && /^\d{5}$/.test(x)).slice(0, 5) : [];
  const given = typeof body?.lawdCode === "string" && /^\d{5}$/.test(body.lawdCode) ? body.lawdCode : geocode?.lawdCode;
  const regionMap = /* @__PURE__ */ new Map();
  let rd;
  if (cfg.kakaoRestKey && center) {
    const r = await regionsAround(cfg.kakaoRestKey, center, radiusM, pd);
    r.regions.forEach((x) => regionMap.set(x.code, x));
    rd = {
      status: r.failedPoints ? "partial" : "sampled",
      sampled: r.sampled,
      failedPoints: r.failedPoints,
      regionsFound: r.regions.length,
      regionsUsed: 0,
      capped: false,
      note: `\uBC18\uACBD ${radiusM.toLocaleString("ko-KR")}m \uC548 ${r.sampled}\uAC1C \uD45C\uBCF8 \uC9C0\uC810\uC5D0\uC11C \uC2DC\uAD70\uAD6C ${r.regions.length}\uACF3 \uD655\uC778${r.failedPoints ? `, ${r.failedPoints}\uAC1C \uC9C0\uC810 \uC870\uD68C \uC2E4\uD328` : ""}. \uD45C\uBCF8 \uC9C0\uC810 \uBC29\uC2DD\uC774\uB77C \uD589\uC815\uAD6C\uC5ED \uACBD\uACC4 \uC804\uCCB4\uB97C \uBCF4\uC7A5\uD558\uC9C0 \uC54A\uC74C`
    };
  } else {
    rd = { status: "notPerformed", sampled: 0, failedPoints: 0, regionsFound: 0, regionsUsed: 0, capped: false, note: "\uC8FC\uBCC0 \uD589\uC815\uAD6C\uC5ED \uD0D0\uC0C9 \uBBF8\uC218\uD589(\uC9C0\uB3C4 \uD0A4 \uB610\uB294 \uC88C\uD45C \uC5C6\uC74C) \u2014 \uC9C0\uC815 \uC2DC\uAD70\uAD6C\uB9CC \uC218\uC9D1, \uACBD\uACC4 \uBC16 \uBC18\uACBD \uB0B4 \uB2E8\uC9C0 \uB204\uB77D \uAC00\uB2A5. \uD589\uC815\uAD6C\uC5ED \uACBD\uACC4 \uC804\uCCB4\uB97C \uBCF4\uC7A5\uD558\uC9C0 \uC54A\uC74C" };
  }
  if (given && !regionMap.has(given)) regionMap.set(given, { code: given, name1: "", name2: "" });
  extra.forEach((c) => {
    if (!regionMap.has(c)) regionMap.set(c, { code: c, name1: "", name2: "" });
  });
  const regions = [...regionMap.values()].slice(0, LIMITS.regions);
  rd.regionsUsed = regions.length;
  if (regionMap.size > LIMITS.regions) {
    rd.capped = true;
    if (rd.status === "sampled") rd.status = "partial";
    rd.note += ` \xB7 \uC2DC\uAD70\uAD6C ${regionMap.size}\uACF3 \uC911 ${LIMITS.regions}\uACF3\uB9CC \uC218\uC9D1(\uC0C1\uD55C) \u2014 \uB098\uBA38\uC9C0 \uC2DC\uAD70\uAD6C\uC758 \uBC18\uACBD \uB0B4 \uB2E8\uC9C0 \uB204\uB77D \uAC00\uB2A5`;
  }
  const monthResults = [];
  if (cfg.molit.serviceKey && regions.length) for (const rg of regions) for (const ym of recentMonths(through, months)) monthResults.push(await fetchMolitMonth(cfg.molit, rg.code, ym, pd));
  const trades = monthResults.flatMap((m) => m.items);
  const monthsOk = monthResults.filter((m) => m.ok).length;
  const pageCapped = monthResults.some((m) => (m.error ?? "").includes("\uC0C1\uD55C"));
  const trStatus = !cfg.molit.serviceKey ? "unset" : !monthResults.length ? "failed" : monthsOk === monthResults.length ? "complete" : monthResults.some((m) => m.collected > 0) ? "partial" : "failed";
  const trNote = !cfg.molit.serviceKey ? "\uACF5\uACF5\uB370\uC774\uD130 \uD0A4 \uBBF8\uC124\uC815" : !regions.length ? "\uC2DC\uAD70\uAD6C \uCF54\uB4DC \uD655\uC778 \uBD88\uAC00" : `${regions.length}\uAC1C \uC2DC\uAD70\uAD6C \xD7 ${months}\uAC1C\uC6D4`;
  const complexes = [];
  const uniq = /* @__PURE__ */ new Map();
  trades.forEach((x) => {
    const k = complexKeyOf(x);
    if (!uniq.has(k)) uniq.set(k, x);
  });
  let attempted = 0, failed = 0;
  if (cfg.kakaoRestKey) {
    for (const [k, x] of [...uniq].slice(0, LIMITS.complexes)) {
      attempted++;
      try {
        const g = await geocodeComplex(cfg.kakaoRestKey, regionMap.get(x.sggCd ?? ""), x.dong, x.jibun, pd);
        if (g) complexes.push({ complexKey: k, location: { lat: g.lat, lng: g.lng }, locationSource: `\uCE74\uCE74\uC624 \uC8FC\uC18C\uAC80\uC0C9(\uC9C0\uBC88, ${at.slice(0, 10)})`, address: g.address });
        else failed++;
      } catch {
        failed++;
      }
    }
  }
  const total = uniq.size;
  const gcCapped = total > LIMITS.complexes;
  const gc = {
    status: !cfg.kakaoRestKey || total === 0 ? "notPerformed" : complexes.length === total ? "complete" : complexes.length ? "partial" : "failed",
    total,
    attempted,
    located: complexes.length,
    failed,
    capped: gcCapped
  };
  if (gcCapped) notes.push(`\uB2E8\uC9C0 ${total}\uACF3 \uC911 ${LIMITS.complexes}\uACF3\uB9CC \uC88C\uD45C \uC870\uD68C(\uC0C1\uD55C) \u2014 \uB098\uBA38\uC9C0\uB294 \uD655\uC778 \uD544\uC694 \uD6C4\uBCF4`);
  if (trStatus !== "complete" && cfg.molit.serviceKey) notes.push("\uAC70\uB798 \uC751\uB2F5 \uC218\uC9D1\uC774 \uC644\uB8CC\uB418\uC9C0 \uC54A\uC74C \u2014 \uB204\uB77D \uAC00\uB2A5\uC131\uC774 \uC788\uC74C");
  const report = {
    at,
    status: trStatus,
    trades: { status: trStatus, monthsOk, monthsTotal: monthResults.length, capped: pageCapped, note: trNote },
    regionDiscovery: rd,
    complexGeocode: gc,
    regions: regions.map((r) => ({ code: r.code, name: `${r.name1} ${r.name2}`.trim() || r.code })),
    regionNote: rd.note,
    months: monthResults.map(({ items, ...m }) => m),
    notes
  };
  return { geocode, trades, complexes, report };
}

// server/hosted.ts
var AUTH_COOKIE = "la_auth";
var SESSION_HOURS = 12;
function hostedEnv(env = process.env) {
  const cfg = loadConfig({ ...env, TRUST_PROXY: "true", COOKIE_SECURE: env.COOKIE_SECURE ?? "true" });
  const secret = env.APP_SESSION_SECRET && env.APP_SESSION_SECRET.length >= 32 ? env.APP_SESSION_SECRET : null;
  return { cfg, password: env.APP_ACCESS_PASSWORD || null, secret };
}
var hmac = (secret, msg) => createHmac("sha256", secret).update(msg).digest("base64url");
var eq = (a, b) => {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};
function issueAuth(secret, now) {
  const exp = String(now + SESSION_HOURS * 36e5);
  return `${exp}.${hmac(secret, `auth.${exp}`)}`;
}
function validAuth(secret, value, now) {
  if (!value) return false;
  const [exp, sig] = value.split(".");
  if (!exp || !sig || !/^\d{10,16}$/.test(exp) || Number(exp) <= now) return false;
  return eq(sig, hmac(secret, `auth.${exp}`));
}
var csrfFor = (secret, auth) => hmac(secret, `csrf.${auth}`);
function sameOrigin(req) {
  const site = req.headers["sec-fetch-site"];
  if (site && site !== "same-origin" && site !== "none") throw new HttpError(403, "CROSS_SITE", "\uB2E4\uB978 \uC0AC\uC774\uD2B8\uC5D0\uC11C \uBCF4\uB0B8 \uC694\uCCAD\uC740 \uD5C8\uC6A9\uD558\uC9C0 \uC54A\uC74C");
}
async function readJson(req, limit) {
  const ct = String(req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
  if (ct !== "application/json") throw new HttpError(415, "CONTENT_TYPE", "application/json \uD544\uC694");
  const buf = await readBody(req, limit);
  try {
    return JSON.parse(buf.toString("utf8"));
  } catch {
    throw new HttpError(400, "JSON", "JSON \uD615\uC2DD \uC624\uB958");
  }
}
function wrap(fn) {
  return async (req, res) => {
    securityHeaders(res, { kakao: false });
    res.setHeader("Cache-Control", "no-store");
    try {
      await fn(req, res);
    } catch (e) {
      if (e instanceof HttpError) return sendJson(res, e.status, { code: e.code, message: e.message });
      console.error(JSON.stringify({ t: (/* @__PURE__ */ new Date()).toISOString(), route: req.url?.split("?")[0], error: e?.name ?? "Error" }));
      sendJson(res, 500, { code: "INTERNAL", message: "\uC11C\uBC84 \uC624\uB958" });
    }
  };
}
function hostedHandlers(he = hostedEnv(), deps = {}) {
  const now = deps.now ?? (() => Date.now());
  const { cfg, password, secret } = he;
  const authOf = (req) => {
    const v = parseCookies(req)[AUTH_COOKIE];
    return secret && validAuth(secret, v, now()) ? v : null;
  };
  const authReady = !!(password && secret);
  const loginLimiter = new RateLimiter(5);
  const lookupLimiter = new RateLimiter(6);
  const session = wrap(async (req, res) => {
    if (req.method !== "GET") throw new HttpError(405, "METHOD", "\uD5C8\uC6A9\uB418\uC9C0 \uC54A\uB294 \uBA54\uC11C\uB4DC");
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
        auth: { required: true, ready: authReady, signedIn: !!auth }
      }
    });
  });
  const login = wrap(async (req, res) => {
    if (req.method !== "POST") throw new HttpError(405, "METHOD", "\uD5C8\uC6A9\uB418\uC9C0 \uC54A\uB294 \uBA54\uC11C\uB4DC");
    sameOrigin(req);
    if (!authReady) throw new HttpError(503, "AUTH_UNSET", "\uC811\uC18D \uBE44\uBC00\uBC88\uD638\xB7\uC138\uC158 \uBE44\uBC00\uAC12\uC774 \uC11C\uBC84\uC5D0 \uC124\uC815\uB418\uC9C0 \uC54A\uC544 \uC790\uB3D9 \uC870\uD68C\uB97C \uC0AC\uC6A9\uD560 \uC218 \uC5C6\uC74C");
    if (!loginLimiter.allow(clientIp(req, true), now())) throw new HttpError(429, "RATE_LIMIT", "\uB85C\uADF8\uC778 \uC2DC\uB3C4\uAC00 \uB108\uBB34 \uB9CE\uC74C. 1\uBD84 \uD6C4 \uB2E4\uC2DC \uC2DC\uB3C4");
    const body = await readJson(req, 4096);
    const given = typeof body?.password === "string" ? body.password : "";
    const a = Buffer.from(hmac(secret, `pw.${given}`)), b = Buffer.from(hmac(secret, `pw.${password}`));
    if (!timingSafeEqual(a, b)) throw new HttpError(401, "WRONG_PASSWORD", "\uBE44\uBC00\uBC88\uD638\uAC00 \uB9DE\uC9C0 \uC54A\uC74C");
    const v = issueAuth(secret, now());
    addSetCookie(res, cookie(AUTH_COOKIE, v, { secure: cfg.cookieSecure, sameSite: "Strict", maxAgeSec: SESSION_HOURS * 3600 }));
    sendJson(res, 200, { signedIn: true, csrfToken: csrfFor(secret, v) });
  });
  const logout = wrap(async (req, res) => {
    if (req.method !== "POST") throw new HttpError(405, "METHOD", "\uD5C8\uC6A9\uB418\uC9C0 \uC54A\uB294 \uBA54\uC11C\uB4DC");
    sameOrigin(req);
    addSetCookie(res, cookie(AUTH_COOKIE, "", { secure: cfg.cookieSecure, sameSite: "Strict", maxAgeSec: 0 }));
    sendJson(res, 200, { signedIn: false });
  });
  const lookup = wrap(async (req, res) => {
    if (req.method !== "POST") throw new HttpError(405, "METHOD", "\uD5C8\uC6A9\uB418\uC9C0 \uC54A\uB294 \uBA54\uC11C\uB4DC");
    sameOrigin(req);
    if (!authReady) throw new HttpError(503, "AUTH_UNSET", "\uC811\uC18D \uBE44\uBC00\uBC88\uD638\uAC00 \uC124\uC815\uB418\uC9C0 \uC54A\uC544 \uC790\uB3D9 \uC870\uD68C\uB97C \uB9C9\uC558\uC74C(\uD55C\uB3C4 \uC18C\uC9C4 \uBC29\uC9C0)");
    const auth = authOf(req);
    if (!auth) throw new HttpError(401, "NO_SESSION", "\uC790\uB3D9 \uC870\uD68C\uB294 \uC811\uC18D \uBE44\uBC00\uBC88\uD638\uB85C \uB85C\uADF8\uC778\uD55C \uB4A4 \uC0AC\uC6A9\uD560 \uC218 \uC788\uC74C");
    const tok = req.headers["x-csrf-token"];
    if (typeof tok !== "string" || !eq(tok, csrfFor(secret, auth))) throw new HttpError(403, "CSRF", "CSRF \uD1A0\uD070 \uBD88\uC77C\uCE58");
    if (!lookupLimiter.allow(clientIp(req, true), now())) throw new HttpError(429, "RATE_LIMIT", "\uC870\uD68C\uAC00 \uB108\uBB34 \uC7A6\uC74C. \uC7A0\uC2DC \uD6C4 \uB2E4\uC2DC \uC2DC\uB3C4");
    if (!cfg.molit.serviceKey && !cfg.kakaoRestKey) return sendJson(res, 503, { status: "unset", message: "\uACF5\uACF5\uB370\uC774\uD130\xB7\uC9C0\uB3C4 \uD0A4 \uBBF8\uC124\uC815 \u2014 \uC790\uB3D9 \uC870\uD68C \uBD88\uAC00" });
    const body = await readJson(req, 64 * 1024);
    sendJson(res, 200, await collectPublicData(cfg, body, deps.publicDataDeps));
  });
  const launch = async (req, res) => {
    req.resume();
    securityHeaders(res, { kakao: false });
    res.setHeader("Referrer-Policy", "no-referrer");
    sendPage(res, 503, "\uD611\uC758\uCCB4 \uC2DC\uB3D9 \uC218\uC2E0\uC740 \uB300\uAE30 \uC911\uC785\uB2C8\uB2E4", '<p>\uC785\uB825 \uADDC\uACA9\uACFC \uC218\uC2E0 \uC8FC\uC18C\uAC00 \uD655\uC815\uB418\uAE30 \uC804\uAE4C\uC9C0 \uC774 \uACBD\uB85C\uB294 \uBE44\uD65C\uC131\uC785\uB2C8\uB2E4. \uBC1B\uC740 \uC790\uB8CC\uB294 \uC800\uC7A5\uD558\uC9C0 \uC54A\uC558\uC2B5\uB2C8\uB2E4.</p><p><a href="/app">\uC544\uD30C\uD2B8 \uC785\uC9C0\xB7\uAC00\uACA9 \uBD84\uC11D\uAE30\uC5D0\uC11C \uC8FC\uC18C\uB85C \uC9C1\uC811 \uC2DC\uC791\uD558\uAE30</a></p>');
  };
  return { session, login, logout, lookup, launch };
}

// scripts/vercel/launch.ts
var launch_default = hostedHandlers().launch;
export {
  launch_default as default
};
