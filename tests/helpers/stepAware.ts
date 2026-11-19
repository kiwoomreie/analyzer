// 시험 도우미(v0.8 단계 화면 대응): 화면이 ①~④ 단계로 나뉘어 한 단계만 보이므로,
// 시험이 어떤 요소를 누르거나 읽기 전에 그 요소가 있는 단계로 이동하고(단계 버튼 클릭) 접힌 상위 상세 영역을 연다.
// 앱 동작을 바꾸지 않고, 사용자가 단계 버튼·펼치기를 누르는 것과 같은 방식으로만 이동한다.
import type { Page } from "playwright";

/** Playwright 전용 의사 선택자(:has-text 등)는 문서 검색용으로 떼어 냄 */
const cssOf = (sel: string) => sel.replace(/:has-text\([^)]*\)/g, "").replace(/:text\([^)]*\)/g, "");

export async function reveal(page: Page, selector: string): Promise<boolean> {
  const css = cssOf(selector);
  const res = await page.evaluate((s) => {
    let el: Element | null = null;
    try { el = document.querySelector(s); } catch { return "bad"; }
    if (!el) return "none";
    const panel = el.closest(".step-panel") as HTMLElement | null;
    if (panel && panel.hidden) {
      const n = panel.getAttribute("data-step");
      (document.querySelector(`[data-testid=step-${n}]`) as HTMLElement | null)?.click();
      return "switched";
    }
    return "ok";
  }, css).catch(() => "bad");
  if (res === "switched") await page.waitForTimeout(80);
  // 상위 접힘 영역 열기(요소 자신이 summary면 그 영역은 시험이 직접 다룸)
  await page.evaluate((s) => {
    let el: Element | null = null;
    try { el = document.querySelector(s); } catch { return; }
    if (!el) return;
    let d = el.closest("details");
    if (d && el.tagName === "SUMMARY" && el.parentElement === d) d = d.parentElement?.closest("details") ?? null;
    while (d) { if (!(d as HTMLDetailsElement).open) (d as HTMLDetailsElement).open = true; d = d.parentElement?.closest("details") ?? null; }
  }, css).catch(() => {});
  return res !== "none" && res !== "bad";
}

const ACTIONS = ["click", "fill", "check", "uncheck", "selectOption", "setInputFiles", "isDisabled", "isEnabled", "inputValue", "type", "press", "hover", "dblclick"] as const;

/** 요소 기준 reveal(프레임 안 요소도 그 문서 기준으로 처리) */
async function revealLocator(loc: any) {
  const switched = await loc.first().evaluate((el: Element) => {
    const panel = el.closest(".step-panel") as HTMLElement | null;
    let did = false;
    if (panel && panel.hidden) { (el.ownerDocument.querySelector(`[data-testid=step-${panel.getAttribute("data-step")}]`) as HTMLElement | null)?.click(); did = true; }
    let d = el.closest("details");
    if (d && el.tagName === "SUMMARY" && el.parentElement === d) d = d.parentElement?.closest("details") ?? null;
    while (d) { if (!(d as HTMLDetailsElement).open) (d as HTMLDetailsElement).open = true; d = d.parentElement?.closest("details") ?? null; }
    return did;
  }, undefined, { timeout: 8000 }).catch(() => false);
  if (switched) await new Promise((r) => setTimeout(r, 80));
}

let locatorPatched = false;
const LOC_ACTIONS = ["click", "fill", "check", "uncheck", "selectOption", "setInputFiles", "isDisabled", "isEnabled", "inputValue", "press", "hover", "screenshot", "scrollIntoViewIfNeeded", "waitFor", "isVisible"] as const;
function patchLocator(page: Page) {
  if (locatorPatched) return;
  locatorPatched = true;
  const proto = Object.getPrototypeOf(page.locator("body"));
  for (const name of LOC_ACTIONS) {
    const orig = proto[name];
    if (typeof orig !== "function") continue;
    proto[name] = async function (this: any, ...args: any[]) {
      if (name === "waitFor" && args[0]?.state && args[0].state !== "visible") return orig.apply(this, args);
      if (name === "isVisible") { await revealLocator(this); return orig.apply(this, args); }
      await revealLocator(this);
      return orig.apply(this, args);
    };
  }
}

/** page의 선택자 기반 동작 앞에 reveal을 끼워 넣음 */
export function stepAware<T extends Page>(page: T): T {
  patchLocator(page);
  const p = page as any;
  for (const name of ACTIONS) {
    const orig = p[name].bind(page);
    p[name] = async (selector: string, ...rest: any[]) => {
      if (typeof selector === "string") {
        await page.waitForSelector(selector, { state: "attached", timeout: rest.find((r) => r?.timeout)?.timeout ?? 30000 } as any).catch(() => {});
        await reveal(page, selector);
      }
      return orig(selector, ...rest);
    };
  }
  const origWait = p.waitForSelector.bind(page);
  p.waitForSelector = async (selector: string, options?: any) => {
    if (options?.state && options.state !== "visible") return origWait(selector, options);
    await origWait(selector, { ...(options ?? {}), state: "attached" });
    await reveal(page, selector);
    return origWait(selector, options);
  };
  return page;
}

/** 상세 영역 id가 있는 단계로 이동해 펼침 */
export async function openSec(page: Page, id: string) {
  await reveal(page, `#${id}`);
  const open = await page.locator(`#${id}`).getAttribute("open");
  if (open === null) await page.locator(`#${id} > summary`).click();
  await page.waitForTimeout(120);
}
