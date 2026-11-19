// .vercel/output(Build Output API) 결과를 로컬에서 흉내 내 띄우는 시험용 서버. 실제 Vercel을 대신하지 않는다.
// 라우트 규칙은 config.json을 그대로 읽어 적용하고, 함수는 빌드된 번들(index.mjs)을 불러 쓴다.
// 자동 조회 함수만 시험용 모의 전송을 주입할 수 있다(실제 국토부·카카오 호출 없음).
import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const MIME: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8" };
type Handler = (req: IncomingMessage, res: ServerResponse) => unknown;

export async function startVercelLocal(port: number, overrides: Record<string, Handler> = {}, root = ".vercel/output"): Promise<Server> {
  const cfg = JSON.parse(readFileSync(join(root, "config.json"), "utf8"));
  const staticRoot = resolve(root, "static");
  const fnCache = new Map<string, Handler>();
  const loadFn = async (p: string): Promise<Handler | null> => {
    if (overrides[p]) return overrides[p];
    const dir = join(root, "functions", `${p.replace(/^\//, "")}.func`);
    if (!existsSync(join(dir, "index.mjs"))) return null;
    if (!fnCache.has(p)) fnCache.set(p, (await import(pathToFileURL(resolve(dir, "index.mjs")).href)).default);
    return fnCache.get(p)!;
  };
  const server = createServer(async (req, res) => {
    let path = new URL(req.url ?? "/", "http://x").pathname;
    let phase: "pre" | "post" = "pre";
    for (const r of cfg.routes) {
      if (r.handle === "filesystem") {
        // 정적 파일 또는 함수
        const fn = await loadFn(path);
        if (fn) return void (await fn(req, res));
        const f = normalize(join(staticRoot, path));
        if (f.startsWith(staticRoot) && existsSync(f) && statSync(f).isFile()) { res.setHeader("Content-Type", MIME[extname(f)] ?? "application/octet-stream"); return void res.end(readFileSync(f)); }
        phase = "post";
        continue;
      }
      const m = new RegExp(`^${r.src}$`).exec(path);
      if (!m) continue;
      for (const [k, v] of Object.entries(r.headers ?? {})) res.setHeader(k, v as string);
      if (r.status && !r.dest) { res.statusCode = r.status; return void res.end(); }
      if (r.dest) {
        path = r.dest;
        const fn = await loadFn(path);
        if (fn) return void (await fn(req, res));
        const f = join(staticRoot, path);
        if (existsSync(f)) { res.setHeader("Content-Type", MIME[extname(f)] ?? "application/octet-stream"); return void res.end(readFileSync(f)); }
      }
      if (!r.continue && phase === "post") break;
    }
    res.statusCode = 404; res.end("not found");
  });
  await new Promise<void>((r) => server.listen(port, "127.0.0.1", r));
  return server;
}
