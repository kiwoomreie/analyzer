// LauncherHarness 정적 서버(로컬 시험 전용). 실제 협의체·Render와 무관.
// 기본 주소: http://127.0.0.1:5175  (분석기 기본 http://localhost:5174 와 다른 사이트 → 교차 사이트 POST 시험)
// 환경변수: ANALYZER_LAUNCH_URL(없으면 '운영 주소 미설정'), HARNESS_ALLOW_LOCALHOST=1(로컬 목적지 허용)
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export function startHarness(opts: { port?: number; host?: string; launchUrl?: string; allowLocalhost?: boolean; root?: string } = {}) {
  const root = opts.root ?? "dist/harness";
  const hits: { method: string; path: string }[] = [];
  const html = () => readFileSync(join(root, "index.html"), "utf8")
    .replace("__ANALYZER_LAUNCH_URL__", (opts.launchUrl ?? "").replace(/[<>"]/g, ""))
    .replace("__ALLOW_LOCALHOST__", opts.allowLocalhost ? "1" : "0");
  const server = createServer((req, res) => {
    const p = new URL(req.url ?? "/", "http://h").pathname;
    if (p.startsWith("/committee-api/")) {
      // 모의 협의체 백엔드: 분석기 버튼·새 탭이 여기로 요청하면 안 됨(시험에서 0건 확인)
      hits.push({ method: req.method ?? "?", path: p });
      res.writeHead(204).end();
      return;
    }
    if (p === "/__harness/hits") { res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(hits)); return; }
    res.setHeader("Content-Security-Policy", `default-src 'self'; form-action 'self' ${opts.launchUrl ? new URL(opts.launchUrl).origin : ""}; script-src 'self'; style-src 'self'`);
    if (p === "/" || p === "/index.html") { res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(html()); return; }
    if (p.startsWith("/assets/")) {
      try {
        const body = readFileSync(join(root, p.replace(/\.\./g, "")));
        res.writeHead(200, { "Content-Type": p.endsWith(".js") ? "text/javascript" : "text/css" }).end(body);
      } catch { res.writeHead(404).end(); }
      return;
    }
    res.writeHead(404).end();
  });
  server.listen(opts.port ?? 5175, opts.host ?? "127.0.0.1");
  return { server, hits };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const launchUrl = process.env.ANALYZER_LAUNCH_URL || "";
  const h = startHarness({ launchUrl, allowLocalhost: process.env.HARNESS_ALLOW_LOCALHOST === "1", port: Number(process.env.HARNESS_PORT ?? 5175) });
  h.server.on("listening", () => console.log(`[가상] LauncherHarness: http://127.0.0.1:${process.env.HARNESS_PORT ?? 5175}/  목적지: ${launchUrl || "운영 주소 미설정"}`));
}
