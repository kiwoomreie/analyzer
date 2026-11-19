// Vercel 배포용 빌드(Build Output API v3). 출력: .vercel/output/{config.json, static/, functions/}
// - 정적 화면: dist/web (경로 /app, /app/...) — 저장은 사용자 브라우저에만
// - 함수: /api/session, /api/login, /api/logout, /api/public-data/lookup, /api/launch(대기 안내)
// 국토부·카카오 키, 접속 비밀번호, 세션 비밀값은 Vercel 환경변수로만 넣는다(저장소·빌드 결과에 넣지 않음).
import { build } from "esbuild";
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";

await import("./build.ts");
const OUT = ".vercel/output";
rmSync(OUT, { recursive: true, force: true });
mkdirSync(`${OUT}/static`, { recursive: true });
cpSync("dist/web", `${OUT}/static`, { recursive: true });

const fns: [string, string][] = [["session", "api/session"], ["login", "api/login"], ["logout", "api/logout"], ["lookup", "api/public-data/lookup"], ["launch", "api/launch"]];
for (const [entry, route] of fns) {
  const dir = `${OUT}/functions/${route}.func`;
  mkdirSync(dir, { recursive: true });
  await build({
    entryPoints: [`scripts/vercel/${entry}.ts`], outfile: `${dir}/index.mjs`, bundle: true, platform: "node", format: "esm", target: "node22",
    banner: { js: 'import { createRequire as __cr } from "node:module"; const require = __cr(import.meta.url);' }, minify: false, logLevel: "warning",
  });
  writeFileSync(`${dir}/.vc-config.json`, JSON.stringify({ runtime: "nodejs22.x", handler: "index.mjs", launcherType: "Nodejs", shouldAddHelpers: false, maxDuration: 60 }, null, 1));
}

const csp = "default-src 'self'; script-src 'self' https://dapi.kakao.com https://t1.daumcdn.net; style-src 'self'; img-src 'self' data: https://*.daumcdn.net https://*.kakao.com; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; form-action 'self'; base-uri 'none'; object-src 'none'";
const headers = { "Content-Security-Policy": csp, "Cross-Origin-Opener-Policy": "same-origin", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "X-Frame-Options": "DENY", "Permissions-Policy": "geolocation=(), camera=(), microphone=(), payment=()" };
writeFileSync(`${OUT}/config.json`, JSON.stringify({
  version: 3,
  routes: [
    { src: "/(.*)", headers, continue: true },
    { src: "/", status: 308, headers: { Location: "/app" } },
    { src: "/launch(?:/.*)?", dest: "/api/launch" },
    { handle: "filesystem" },
    { src: "/app(?:/.*)?", dest: "/index.html", headers: { "Cache-Control": "no-store" } },
  ],
}, null, 1));
console.log(`vercel build ok → ${OUT}`);
