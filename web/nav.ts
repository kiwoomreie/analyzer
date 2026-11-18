export { withRun, latestRun } from "../shared/runs.ts";

declare const __PREVIEW__: boolean | undefined;
/** 단일 파일 미리보기에서는 주소 경로 대신 # 경로를 사용(새로고침해도 같은 화면) */
export const PREVIEW = typeof __PREVIEW__ !== "undefined" && __PREVIEW__;

export function currentPath(): string {
  if (PREVIEW) return location.hash.startsWith("#/app") ? location.hash.slice(1) : "/app";
  return location.pathname;
}

export function navigate(path: string) {
  if (PREVIEW) location.hash = path;
  else history.pushState(null, "", path);
  window.dispatchEvent(new Event("la:navigate"));
}
