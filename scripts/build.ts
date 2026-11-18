// 화면 번들 빌드(esbuild). 출력: dist/web/{index.html, assets/app.js, assets/styles.css, assets/page.css}
// LauncherHarness 번들: dist/harness/assets/harness.js
import { build } from "esbuild";
import { cpSync, mkdirSync, rmSync } from "node:fs";

rmSync("dist", { recursive: true, force: true });
mkdirSync("dist/web/assets", { recursive: true });
mkdirSync("dist/harness/assets", { recursive: true });
const common = { bundle: true, format: "esm" as const, target: "es2022", minify: true, sourcemap: false, jsx: "automatic" as const, define: { "process.env.NODE_ENV": '"production"', __PREVIEW__: "false" } as Record<string, string>, logLevel: "warning" as const };
await build({ ...common, entryPoints: ["web/main.tsx"], outfile: "dist/web/assets/app.js" });
await build({ ...common, entryPoints: ["examples/launcher-harness/harness.tsx"], outfile: "dist/harness/assets/harness.js" });
cpSync("web/index.html", "dist/web/index.html");
cpSync("web/styles.css", "dist/web/assets/styles.css");
cpSync("web/page.css", "dist/web/assets/page.css");
cpSync("examples/launcher-harness/index.html", "dist/harness/index.html");
cpSync("examples/launcher-harness/harness.css", "dist/harness/assets/harness.css");
// 단일 파일 미리보기(서버 없이 브라우저에서만 실행: 분석·저장·보고서 동작, 자동 조회 불가)
const prev = await build({ ...common, entryPoints: ["web/main.tsx"], write: false, define: { ...common.define, __PREVIEW__: "true" } });
const js = prev.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
const css = (await import("node:fs")).readFileSync("web/styles.css", "utf8");
mkdirSync("dist/preview", { recursive: true });
(await import("node:fs")).writeFileSync("dist/preview/index.html", `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>아파트 입지·가격 분석기 — 미리보기</title><style>${css}</style></head><body><div id="root"></div><script type="module">${js}</script></body></html>`);
console.log("build ok → dist/web, dist/harness, dist/preview/index.html");
