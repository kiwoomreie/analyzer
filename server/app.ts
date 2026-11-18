// 새 앱 서버. 외부 입력 전용 진입점(/launch)과 새 앱 내부 API(/api)를 분리한다.
// 협의체 서버를 조회·호출하는 코드는 없다(결과 반환·콜백·상태조회 없음).
import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import type { AppConfig } from "./config.ts";
import { cleanup, openDb, type Db } from "./db.ts";
import {
  addSetCookie, clientIp, consoleLogger, cookie, escHtml, HttpError, parseCookies, randomToken, RateLimiter, readBody,
  redirect303, safeEqualHex, securityHeaders, sendJson, sendPage, sha256, type Logger,
} from "./http.ts";
import { ensureWorkspace, findWorkspace, requireWriteAccess } from "./session.ts";
import { validateContractDocument } from "../shared/validate.ts";
import { hashOf, stableStringify } from "../shared/hash.ts";
import { complexKeyOf, recordFromContract, type AnalysisRecord, type CollectionReport, type Transaction, type WorkingInputs } from "../shared/model.ts";
import { runAnalysis } from "../shared/analysis.ts";
import { checkWorkingShape, scanWorking } from "../shared/importers.ts";
import { seoulNowIso } from "../shared/dates.ts";
import { fetchMolitAptTrades, fetchMolitMonth, geocodeComplex, geocodeKakao, OutboundBlocked, regionsAround, type RegionInfo, type SafeFetchDeps } from "./publicData.ts";

const MIME: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".json": "application/json" };

export interface AppDeps { logger?: Logger; now?: () => number; publicDataDeps?: SafeFetchDeps }

export interface App { server: Server; db: Db; cfg: AppConfig; runCleanup: () => ReturnType<typeof cleanup>; close: () => Promise<void> }

const bindCookieName = (pid: string) => `la_lb_${pid}`;

export function createApp(cfg: AppConfig, deps: AppDeps = {}): App {
  const db = openDb(cfg.dbPath);
  const log = deps.logger ?? consoleLogger;
  const now = deps.now ?? (() => Date.now());
  const launchLimiter = new RateLimiter(cfg.rateLimitLaunchPerMin);
  const apiLimiter = new RateLimiter(cfg.rateLimitApiPerMin);
  const webRoot = resolve(cfg.webRoot);

  const server = createServer(async (req, res) => {
    const started = Date.now();
    let route = "unmatched";
    res.on("finish", () => log({ method: req.method ?? "?", route, status: res.statusCode, ms: Date.now() - started }));
    securityHeaders(res, { kakao: !!cfg.kakaoJsKey });
    try {
      const url = new URL(req.url ?? "/", "http://local");
      const p = url.pathname;
      const ip = clientIp(req, cfg.trustProxy);
      if (p === "/launch" || p.startsWith("/launch/")) {
        route = p === "/launch" ? "/launch" : "/launch/claim/:ticket";
        if (!cfg.launchReceiverEnabled) {
          // 입력 규격·수신 주소 확정 전까지 대기: 본문을 읽지 않고 거절(저장·기록 없음)
          req.resume();
          res.setHeader("Referrer-Policy", "no-referrer");
          sendPage(res, 503, "협의체 시동 수신은 대기 중입니다", "<p>입력 규격과 수신 주소가 확정되기 전까지 이 경로는 비활성입니다. 받은 자료는 저장하지 않았습니다.</p><p><a href=\"/app\">아파트 입지·가격 분석기에서 주소로 직접 시작하기</a></p>");
          return;
        }
        if (p === "/launch") await handleLaunch(req, res, ip);
        else if (p.startsWith("/launch/claim/")) await handleClaim(req, res, p.slice("/launch/claim/".length));
        else throw new HttpError(404, "NOT_FOUND", "없음");
      }
      else if (p.startsWith("/api/")) {
        route = apiRoute(p);
        if (!apiLimiter.allow(ip, now())) throw new HttpError(429, "RATE_LIMIT", "요청이 너무 많음");
        await handleApi(req, res, p);
      } else if (p === "/healthz") { route = "/healthz"; sendJson(res, 200, { ok: true }); }
      else { route = "static"; await serveStatic(req, res, p); }
    } catch (e) {
      const err = e instanceof HttpError ? e : new HttpError(500, "INTERNAL", "내부 오류");
      if (!(e instanceof HttpError)) log({ method: req.method ?? "?", route, status: 500, ms: Date.now() - started, note: `unhandled:${(e as Error)?.name ?? "Error"}` });
      if (!res.headersSent) {
        if (route.startsWith("/api")) sendJson(res, err.status, { error: err.code, message: err.message });
        else sendPage(res, err.status, "요청을 처리할 수 없음", `<p>${escHtml(err.message)}</p><p class="muted">오류 코드: ${escHtml(err.code)}</p>`);
      }
    }
  });

  function apiRoute(p: string): string {
    return p.replace(/\/an_[A-Za-z0-9_-]+/, "/:key");
  }

  // ───────── 외부 시동 진입점
  async function handleLaunch(req: IncomingMessage, res: ServerResponse, ip: string) {
    res.setHeader("Referrer-Policy", "no-referrer");
    if (req.method !== "POST") throw new HttpError(405, "METHOD", "POST만 허용");
    if (!launchLimiter.allow(ip, now())) throw new HttpError(429, "RATE_LIMIT", "시동 요청이 너무 많음. 잠시 후 다시 시도");
    const ct = String(req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
    if (ct !== "application/x-www-form-urlencoded") throw new HttpError(415, "CONTENT_TYPE", "application/x-www-form-urlencoded form POST만 허용");
    const body = await readBody(req, cfg.launchMaxBodyBytes);
    const form = new URLSearchParams(body.toString("utf8"));
    const keys = [...new Set(form.keys())];
    if (keys.length !== 1 || keys[0] !== "payload" || form.getAll("payload").length !== 1) throw new HttpError(400, "FORM_FIELDS", "form에는 payload 필드 1개만 허용");
    let parsed: unknown;
    try { parsed = JSON.parse(form.get("payload")!); } catch { throw new HttpError(400, "PAYLOAD_JSON", "payload가 JSON이 아님"); }
    const v = validateContractDocument(parsed, "launch");
    if (!v.ok) {
      const list = v.issues.slice(0, 20).map((i) => `<li><code>${escHtml(i.path)}</code> — ${escHtml(i.message)} <span class="muted">(${escHtml(i.code)})</span></li>`).join("");
      sendPage(res, v.safetyRejected ? 400 : 422, v.safetyRejected ? "시동 자료를 거절했습니다" : "시동 자료 형식이 맞지 않습니다",
        `<p>${v.safetyRejected ? "인증정보·콜백·주소·비밀값 등 전달이 금지된 항목이 있어 자료 전체를 받지 않았습니다. 받은 원문은 저장·기록하지 않았습니다." : "입력 계약(v1.0)과 다른 항목이 있습니다. 협의체 화면에서 값을 확인하거나 파일 내보내기로 전달하십시오."}</p><ul>${list}</ul><p><a href="/app">분석기 첫 화면으로 이동</a></p>`);
      return;
    }
    const doc = v.doc!;
    const pid = "pl_" + randomToken(12);
    const code = randomToken(32);
    const bind = randomToken(32);
    const t = now();
    db.prepare("INSERT INTO pending_launches (id, code_hash, bind_hash, doc_json, payload_hash, launch_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
      pid, sha256(code), sha256(bind), stableStringify(doc), hashOf(doc), (doc as any).launchId, t, t + cfg.launchPendingTtlSec * 1000,
    );
    // 수신 세션 결속 쿠키: 이 POST를 보낸 브라우저만 수령 가능. 탭마다 이름이 달라 섞이지 않음.
    addSetCookie(res, cookie(bindCookieName(pid), bind, { path: "/launch/claim/", secure: cfg.cookieSecure, sameSite: "Lax", maxAgeSec: cfg.launchPendingTtlSec }));
    redirect303(res, `/launch/claim/${pid}.${code}`);
  }

  async function handleClaim(req: IncomingMessage, res: ServerResponse, ticket: string) {
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Cache-Control", "no-store");
    if (req.method !== "GET") throw new HttpError(405, "METHOD", "GET만 허용");
    const m = /^(pl_[A-Za-z0-9_-]{16})\.([A-Za-z0-9_-]{43})$/.exec(ticket);
    if (!m) throw new HttpError(404, "TICKET", "수령 주소가 올바르지 않음");
    const [, pid, code] = m;
    const t = now();
    const row = db.prepare("SELECT * FROM pending_launches WHERE id = ?").get(pid) as any;
    if (!row || !safeEqualHex(row.code_hash, sha256(code))) throw new HttpError(404, "TICKET", "수령 코드가 없거나 일치하지 않음");
    // 새로고침·뒤로가기: 이미 이 브라우저 작업공간이 수령한 경우 같은 분석으로 이동(새 분석 없음)
    if (row.consumed_at) {
      const cur = findWorkspace(db, req, t);
      if (cur && row.consumed_ws === cur.id && row.analysis_key && db.prepare("SELECT key FROM temp_analyses WHERE key = ? AND workspace_id = ?").get(row.analysis_key, cur.id)) return redirect303(res, `/app/a/${row.analysis_key}`);
    }
    const bind = parseCookies(req)[bindCookieName(pid)];
    if (!bind || !safeEqualHex(row.bind_hash, sha256(bind))) {
      sendPage(res, 403, "수신 세션을 확인할 수 없습니다", "<p>이 시동 자료는 전송한 브라우저에서만 열 수 있습니다. 수령 코드만으로는 자료를 열거나 다른 세션에 연결하지 않습니다.</p><p>같은 브라우저에서 협의체의 ‘분석기 시동’을 다시 누르거나, 협의체의 파일 내보내기를 이용해 <a href=\"/app\">분석기</a>에서 가져오십시오.</p>");
      return;
    }
    const ws = ensureWorkspace(db, cfg, req, res, t);
    // 원자적 소비: 미사용·미만료일 때만 1회 성공
    const upd = db.prepare("UPDATE pending_launches SET consumed_at = ?, consumed_ws = ? WHERE id = ? AND consumed_at IS NULL AND expires_at > ?").run(t, ws.id, pid, t);
    if (Number(upd.changes) !== 1) {
      if (row.consumed_ws === ws.id && row.analysis_key) {
        const still = db.prepare("SELECT key FROM temp_analyses WHERE key = ? AND workspace_id = ?").get(row.analysis_key, ws.id);
        if (still) return redirect303(res, `/app/a/${row.analysis_key}`);
      }
      sendPage(res, 410, "만료되었거나 이미 사용된 시동입니다", "<p>수령 코드는 10분 동안 1회만 사용할 수 있습니다. 협의체에서 버튼을 다시 누르면 새 분석 사본이 만들어집니다.</p><p><a href=\"/app\">분석기 첫 화면</a></p>");
      return;
    }
    addSetCookie(res, cookie(bindCookieName(pid), "", { path: "/launch/claim/", secure: cfg.cookieSecure, maxAgeSec: 0 }));
    const docJson: string | null = row.doc_json;
    db.prepare("UPDATE pending_launches SET doc_json = NULL WHERE id = ?").run(pid);
    if (!docJson) throw new HttpError(410, "GONE", "시동 자료가 정리됨");
    const doc = JSON.parse(docJson);
    // 같은 작업공간 범위에서만 중복 판별
    const existing = db.prepare("SELECT key, payload_hash FROM temp_analyses WHERE workspace_id = ? AND launch_id = ?").get(ws.id, row.launch_id) as any;
    if (existing) {
      if (existing.payload_hash === row.payload_hash) {
        db.prepare("UPDATE temp_analyses SET last_duplicate_at = ? WHERE key = ?").run(t, existing.key);
        db.prepare("UPDATE pending_launches SET analysis_key = ? WHERE id = ?").run(existing.key, pid);
        return redirect303(res, `/app/a/${existing.key}`);
      }
      sendPage(res, 409, "같은 시동 ID에 다른 내용이 들어왔습니다", `<p>launchId가 같은데 내용이 달라 충돌로 처리했습니다. 기존 사본은 변경하지 않았고 새 사본도 만들지 않았습니다.</p><p><a href="/app/a/${escHtml(existing.key)}">기존 사본 열기</a> · 협의체에서 버튼을 다시 누르면 새 launchId로 전송됩니다.</p>`);
      return;
    }
    const key = "an_" + randomToken(16);
    const rec = recordFromContract(doc, { key, receivedAt: seoulNowIso(new Date(t)), kind: "launch" });
    if (cfg.molit.autoFetch && cfg.molit.serviceKey && rec.working.property.lawdCode) {
      const months = recentMonths(rec.working.asOf, cfg.molit.maxMonths);
      const r = await fetchMolitAptTrades(cfg.molit, rec.working.property.lawdCode, months, deps.publicDataDeps);
      rec.working.transactions.push(...r.items);
    }
    const result = runAnalysis(rec.working);
    rec.runs.push({ runNo: 1, at: seoulNowIso(new Date(t)), trigger: "auto-launch", inputHash: result.inputHash, result });
    db.prepare("INSERT INTO temp_analyses (key, workspace_id, launch_id, payload_hash, record_json, supported, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
      key, ws.id, row.launch_id, row.payload_hash, JSON.stringify(rec), doc.property?.assetType === "apartment" ? 1 : 0, t, t + cfg.tempAnalysisTtlHours * 3600000,
    );
    db.prepare("UPDATE pending_launches SET analysis_key = ? WHERE id = ?").run(key, pid);
    redirect303(res, `/app/a/${key}`);
  }

  // ───────── 새 앱 내부 API
  async function handleApi(req: IncomingMessage, res: ServerResponse, p: string) {
    const t = now();
    if (p === "/api/session" && req.method === "GET") {
      const ws = ensureWorkspace(db, cfg, req, res, t);
      return sendJson(res, 200, {
        csrfToken: ws.csrf,
        config: {
          kakaoJsKey: cfg.kakaoJsKey,
          publicData: cfg.molit.serviceKey ? "configured" : "unset",
          geocoder: cfg.kakaoRestKey ? "configured" : "unset",
          launchReceiver: cfg.launchReceiverEnabled ? "enabled" : "standby",
          publicDataAutoFetch: cfg.molit.autoFetch && !!cfg.molit.serviceKey,
          tempAnalysisTtlHours: cfg.tempAnalysisTtlHours,
          launchPendingTtlSec: cfg.launchPendingTtlSec,
          launchMaxBodyBytes: cfg.launchMaxBodyBytes,
          serverPersistentStorage: "disabled",
          externalAi: "disabled",
        },
      });
    }
    if (p === "/api/temp-analyses" && req.method === "GET") {
      const ws = findWorkspace(db, req, t);
      if (!ws) return sendJson(res, 200, { items: [] });
      const rows = db.prepare("SELECT key, record_json, supported, created_at, expires_at FROM temp_analyses WHERE workspace_id = ? AND expires_at > ? ORDER BY created_at DESC LIMIT 100").all(ws.id, t) as any[];
      return sendJson(res, 200, { items: rows.map((r) => { const rec = JSON.parse(r.record_json) as AnalysisRecord; return { key: r.key, title: rec.title, origin: rec.origin.kind, supported: !!r.supported, createdAt: r.created_at, expiresAt: r.expires_at }; }) });
    }
    const m = /^\/api\/temp-analyses\/(an_[A-Za-z0-9_-]{22})$/.exec(p);
    if (m) {
      const key = m[1];
      if (req.method === "GET") {
        const ws = findWorkspace(db, req, t);
        const row = ws ? (db.prepare("SELECT * FROM temp_analyses WHERE key = ? AND workspace_id = ? AND expires_at > ?").get(key, ws.id, t) as any) : null;
        if (!row) throw new HttpError(404, "NOT_FOUND", "이 브라우저 세션에서 열 수 있는 임시 분석이 없음(만료·삭제되었거나 다른 세션의 자료)");
        return sendJson(res, 200, { record: JSON.parse(row.record_json), expiresAt: row.expires_at, lastDuplicateAt: row.last_duplicate_at, supported: !!row.supported });
      }
      const ws = requireWriteAccess(db, req, t);
      const row = db.prepare("SELECT * FROM temp_analyses WHERE key = ? AND workspace_id = ? AND expires_at > ?").get(key, ws.id, t) as any;
      if (!row) throw new HttpError(404, "NOT_FOUND", "임시 분석 없음");
      if (req.method === "DELETE") {
        db.prepare("DELETE FROM temp_analyses WHERE key = ? AND workspace_id = ?").run(key, ws.id);
        return sendJson(res, 200, { deleted: true });
      }
      if (req.method === "PUT") {
        const body = await readJson(req);
        const stored = JSON.parse(row.record_json) as AnalysisRecord;
        const next = body?.record as AnalysisRecord;
        if (!next || next.key !== key) throw new HttpError(400, "KEY", "분석 식별자는 변경할 수 없음");
        // 최초 수신 사본·출처·자동 실행 기록은 변경 불가
        if (stableStringify(next.original) !== stableStringify(stored.original) || stableStringify(next.origin) !== stableStringify(stored.origin)) throw new HttpError(409, "ORIGINAL_IMMUTABLE", "최초 수신 사본은 수정할 수 없음");
        if (stored.runs[0] && stableStringify(next.runs?.[0]) !== stableStringify(stored.runs[0])) throw new HttpError(409, "RUN_IMMUTABLE", "자동 실행 기록은 수정할 수 없음");
        const safety = scanWorking(next.working);
        const shape = checkWorkingShape(next.working as WorkingInputs);
        if (safety.length || shape.length) throw new HttpError(422, "WORKING_INVALID", `작업본 검사 실패: ${[...safety.map((s) => s.path), ...shape].slice(0, 5).join(", ")}`);
        db.prepare("UPDATE temp_analyses SET record_json = ? WHERE key = ? AND workspace_id = ?").run(JSON.stringify(next), key, ws.id);
        return sendJson(res, 200, { saved: "server-temporary", expiresAt: row.expires_at });
      }
      throw new HttpError(405, "METHOD", "허용되지 않는 메서드");
    }
    if (p === "/api/public-data/lookup" && req.method === "POST") {
      requireWriteAccess(db, req, t);
      const body = await readJson(req);
      if (!cfg.molit.serviceKey && !cfg.kakaoRestKey) return sendJson(res, 503, { status: "unset", message: "공공데이터·지도 키 미설정 — 자동 조회 불가" });
      const out = await collectPublicData(body);
      return sendJson(res, 200, out);
    }
    throw new HttpError(404, "NOT_FOUND", "없는 API");
  }

  /**
   * 주소 → 좌표 → 반경 주변 시군구 → 시군구·월별 실거래 전 페이지 수집·대사 → 단지 좌표 조회.
   * 결과는 사용자 화면에서 기존 자료와 병합(덮어쓰기 없음)하며, 수집 상태(complete/partial/failed)를 함께 돌려준다.
   */
  async function collectPublicData(body: any) {
    const at = seoulNowIso();
    const notes: string[] = [];
    const address = typeof body?.address === "string" ? body.address.slice(0, 200) : "";
    const asOf = typeof body?.asOf === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.asOf) ? body.asOf : null;
    if (!address || !asOf) throw new HttpError(400, "INPUT", "address·asOf 필요");
    const radiusM = Math.min(Math.max(Number(body?.radiusM) || 1500, 100), 5000);
    const months = Math.min(Math.max(Number(body?.months) || 12, 1), cfg.molit.maxMonths);
    const pd = deps.publicDataDeps;
    // 1) 본건 좌표: 사용자가 이미 입력한 좌표를 우선(덮어쓰지 않음)
    let center: { lat: number; lng: number } | null = body?.center && Number.isFinite(body.center.lat) && Number.isFinite(body.center.lng) ? { lat: body.center.lat, lng: body.center.lng } : null;
    let geocode: { lat: number; lng: number; lawdCode?: string; source: string } | null = null;
    if (cfg.kakaoRestKey) {
      try { geocode = await geocodeKakao(cfg.kakaoRestKey, address, pd); notes.push(geocode ? "주소→좌표 조회됨" : "주소 검색 결과 없음"); }
      catch (e) { notes.push(`주소 검색 실패(${e instanceof OutboundBlocked ? e.code : "오류"})`); }
    } else notes.push("주소→좌표: 지도 키 미설정");
    center ??= geocode ? { lat: geocode.lat, lng: geocode.lng } : null;
    // 2) 반경 주변 시군구
    const extra = Array.isArray(body?.extraLawdCodes) ? body.extraLawdCodes.filter((x: unknown) => typeof x === "string" && /^\d{5}$/.test(x)).slice(0, 5) : [];
    const given = typeof body?.lawdCode === "string" && /^\d{5}$/.test(body.lawdCode) ? body.lawdCode : geocode?.lawdCode;
    const regionMap = new Map<string, RegionInfo>();
    let regionNote: string;
    let regionComplete = false;
    if (cfg.kakaoRestKey && center) {
      const r = await regionsAround(cfg.kakaoRestKey, center, radiusM, pd);
      r.regions.forEach((x) => regionMap.set(x.code, x));
      regionComplete = r.failedPoints === 0;
      regionNote = `반경 ${radiusM.toLocaleString("ko-KR")}m 안 ${r.sampled}개 지점 기준 시군구 ${r.regions.length}곳${r.failedPoints ? `(지점 ${r.failedPoints}곳 조회 실패 — 경계 밖 누락 가능)` : ""}. 지점 표본 방식이라 경계가 복잡하면 누락될 수 있음`;
    } else {
      regionNote = "반경 주변 시군구 확인 불가(지도 키 또는 좌표 없음) — 지정 시군구만 수집, 경계 밖 반경 내 단지 누락 가능";
    }
    if (given && !regionMap.has(given)) regionMap.set(given, { code: given, name1: "", name2: "" });
    extra.forEach((c: string) => { if (!regionMap.has(c)) regionMap.set(c, { code: c, name1: "", name2: "" }); });
    const regions = [...regionMap.values()].slice(0, 6);
    if (regionMap.size > 6) notes.push(`시군구 ${regionMap.size}곳 중 6곳만 수집(상한) — 누락 가능`);
    // 3) 실거래 전 페이지 수집·대사
    const monthResults: Awaited<ReturnType<typeof fetchMolitMonth>>[] = [];
    if (!cfg.molit.serviceKey) notes.push("실거래: 공공데이터 키 미설정");
    else if (!regions.length) notes.push("실거래: 시군구 코드 확인 불가");
    else for (const rg of regions) for (const ym of recentMonths(asOf, months)) monthResults.push(await fetchMolitMonth(cfg.molit, rg.code, ym, pd));
    const trades = monthResults.flatMap((m) => m.items);
    // 4) 단지 좌표(지번 주소) — 실패 단지는 거리 미확인으로 남김
    const complexes: { complexKey: string; location: { lat: number; lng: number }; locationSource: string; address: string }[] = [];
    let attempted = 0, failed = 0;
    if (cfg.kakaoRestKey) {
      const uniq = new Map<string, Transaction>();
      trades.forEach((x) => { const k = complexKeyOf(x); if (!uniq.has(k)) uniq.set(k, x); });
      for (const [k, x] of [...uniq].slice(0, 80)) {
        attempted++;
        try {
          const g = await geocodeComplex(cfg.kakaoRestKey, regionMap.get(x.sggCd ?? ""), x.dong, x.jibun, pd);
          if (g) complexes.push({ complexKey: k, location: { lat: g.lat, lng: g.lng }, locationSource: `카카오 주소검색(지번, ${at.slice(0, 10)})`, address: g.address });
          else failed++;
        } catch { failed++; }
      }
      if (uniq.size > 80) notes.push(`단지 ${uniq.size}곳 중 80곳만 좌표 조회(상한) — 나머지는 거리 미확인`);
    }
    const monthsOk = monthResults.length > 0 && monthResults.every((m) => m.ok);
    const status: CollectionReport["status"] = !cfg.molit.serviceKey ? "unset" : !monthResults.length ? "failed" : monthsOk && regionComplete ? "complete" : monthResults.some((m) => m.collected > 0) ? "partial" : "failed";
    if (status !== "complete" && cfg.molit.serviceKey) notes.push("전체 수집 완료가 아님 — 누락 가능성이 있음");
    const report: CollectionReport = {
      at, status, regions: regions.map((r) => ({ code: r.code, name: `${r.name1} ${r.name2}`.trim() || r.code })), regionNote,
      months: monthResults.map(({ items, ...m }) => m), complexGeocode: { attempted, located: complexes.length, failed }, notes,
    };
    return { geocode, trades, complexes, report };
  }

  async function readJson(req: IncomingMessage): Promise<any> {
    const ct = String(req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
    if (ct !== "application/json") throw new HttpError(415, "CONTENT_TYPE", "application/json 필요");
    const buf = await readBody(req, cfg.apiMaxBodyBytes);
    try { return JSON.parse(buf.toString("utf8")); } catch { throw new HttpError(400, "JSON", "JSON 형식 오류"); }
  }

  async function serveStatic(req: IncomingMessage, res: ServerResponse, p: string) {
    if (req.method !== "GET" && req.method !== "HEAD") throw new HttpError(405, "METHOD", "허용되지 않는 메서드");
    if (p === "/") return redirect303(res, "/app");
    let file: string;
    if (p === "/app" || p.startsWith("/app/")) file = join(webRoot, "index.html");
    else if (p.startsWith("/assets/")) {
      const n = normalize(join(webRoot, p));
      if (!n.startsWith(webRoot + "/")) throw new HttpError(404, "NOT_FOUND", "없음");
      file = n;
    } else throw new HttpError(404, "NOT_FOUND", "페이지 없음");
    try {
      const st = await stat(file);
      if (!st.isFile()) throw new Error();
    } catch {
      throw new HttpError(404, "NOT_FOUND", file.endsWith("index.html") ? "화면 파일 없음 — npm run build 필요" : "없음");
    }
    res.statusCode = 200;
    res.setHeader("Content-Type", MIME[extname(file)] ?? "application/octet-stream");
    res.setHeader("Cache-Control", file.endsWith("index.html") ? "no-store" : "public, max-age=300");
    res.end(req.method === "HEAD" ? undefined : await readFile(file));
  }

  const runCleanup = () => cleanup(db, now(), cfg.workspaceTtlDays * 86400000);
  const timer = setInterval(runCleanup, cfg.cleanupIntervalSec * 1000);
  timer.unref();

  return {
    server, db, cfg, runCleanup,
    close: () => new Promise((r) => { clearInterval(timer); server.close(() => { db.close(); r(); }); server.closeAllConnections?.(); }),
  };
}

function recentMonths(asOf: string, n: number): string[] {
  const [y, m] = asOf.split("-").map(Number);
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const total = y * 12 + (m - 1) - i;
    out.push(`${Math.floor(total / 12)}${String((total % 12) + 1).padStart(2, "0")}`);
  }
  return out;
}
