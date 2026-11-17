// 화면 번들 빌드(esbuild). 출력: dist/web/{index.html, assets/app.js, assets/styles.css, assets/page.css}
// LauncherHarness 번들: dist/harness/assets/harness.js
import { build } from "esbuild";
import { cpSync, mkdirSync, rmSync } from "node:fs";

rmSync("dist", { recursive: true, force: true });
mkdirSync("dist/web/assets", { recursive: true });
mkdirSync("dist/harness/assets", { recursive: true });
const common = { bundle: true, format: "esm" as const, target: "es2022", minify: true, sourcemap: false, jsx: "automatic" as const, define: { "process.env.NODE_ENV": '"production"' }, logLevel: "warning" as const };
await build({ ...common, entryPoints: ["web/main.tsx"], outfile: "dist/web/assets/app.js" });
await build({ ...common, entryPoints: ["examples/launcher-harness/harness.tsx"], outfile: "dist/harness/assets/harness.js" });
cpSync("web/index.html", "dist/web/index.html");
cpSync("web/styles.css", "dist/web/assets/styles.css");
cpSync("web/page.css", "dist/web/assets/page.css");
cpSync("examples/launcher-harness/index.html", "dist/harness/index.html");
cpSync("examples/launcher-harness/harness.css", "dist/harness/assets/harness.css");
console.log("build ok → dist/web, dist/harness");
