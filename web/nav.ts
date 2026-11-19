export { withRun, latestRun } from "../shared/runs.ts";

declare const __PREVIEW__: boolean | undefined;
/** 단일 파일 미리보기에서는 주소 경로 대신 # 경로를 사용(새로고침해도 같은 화면) */
export const PREVIEW = typeof __PREVIEW__ !== "undefined" && __PREVIEW__;
/** 다른 페이지 안(예: claude.ai 미리보기 프레임)에서 실행 중 — 내려받기·인쇄가 막힐 수 있음. GitHub Pages 단독 접속이면 false */
export const FRAMED = (() => { try { return window.top !== window.self; } catch { return true; } })();

export function currentPath(): string {
  if (PREVIEW) return location.hash.startsWith("#/app") ? location.hash.slice(1) : "/app";
  return location.pathname;
}

export function navigate(path: string) {
  if (PREVIEW) location.hash = path;
  else history.pushState(null, "", path);
  window.dispatchEvent(new Event("la:navigate"));
}
