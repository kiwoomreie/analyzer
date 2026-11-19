// 결과 화면·보고서 공용 가격 표시 정리. 계산은 runAnalysis·observeGroups 결과만 쓰며 새로 추정하지 않는다.
// - 현재 검토가격 비교: 검토가격(세대당 총액·전용평당·전용㎡당)과 인근 유사 거래·대표 비교단지 중위값
// - 입지 사건 전후 관측: 수동 확인 영향권·비교군의 전후 변동률과 ‘비교군 대비 관측 차이(%p)’
import type { AnalysisResult } from "./analysis.ts";
import type { ObservationResult } from "./observation.ts";
import type { WorkingInputs } from "./model.ts";
import { LABELS } from "./contract.ts";
import { deriveUnitPrices, fmtEok, fmtMan, fmtNum, fmtPct, fmtPp, M2_PER_PYEONG, toKrw } from "./units.ts";

export interface CurrentPriceView {
  review: { status: "ok" | "held"; label: string; household: string; perPyeong: string; perM2: string; basisDate: string; note?: string };
  market: { count: number; complexes: number; window: string; area: string; perM2: string; perPyeong: string; householdEquiv: string; range: string };
  diffText: string;
  disclaimer: string;
}

/** 현재 검토가격 비교(실행 당시 입력 w와 결과 r 기준) */
export function currentPriceView(w: WorkingInputs, r: AnalysisResult): CurrentPriceView {
  const area = w.property.exclusiveAreaM2 && w.property.exclusiveAreaM2 > 0 ? w.property.exclusiveAreaM2 : null;
  const rp = w.reviewPrice;
  const m = r.market;
  const med = m.pooled.medianPerM2;
  const range = r.price.comparableRange;
  let review: CurrentPriceView["review"];
  if (!rp) review = { status: "held", label: "검토가격", household: "미입력", perPyeong: "미입력", perM2: "미입력", basisDate: "-", note: "검토가격이 없어 가격 비교만 보류" };
  else {
    const krw = toKrw(rp.amount, rp.unit);
    const u = krw === null ? null : deriveUnitPrices(krw, rp.basis, area, null);
    review = {
      status: u?.perM2Krw != null ? "ok" : "held",
      label: `${rp.label ?? "검토가격"} ${rp.amount.toLocaleString("ko-KR")}${LABELS.moneyUnit[rp.unit]}(${LABELS.priceBasis[rp.basis]})${rp.dataMode === "demo" ? " [가상]" : ""}`,
      household: u?.householdKrw != null ? fmtEok(u.householdKrw) : area ? "환산 불가" : "전용면적 필요",
      perPyeong: u?.perPyeongKrw != null ? `${fmtMan(u.perPyeongKrw, 0)}/전용평` : area ? "환산 불가" : "전용면적 필요",
      perM2: u?.perM2Krw != null ? `${fmtMan(u.perM2Krw)}/전용㎡` : area ? "환산 불가" : "전용면적 필요",
      basisDate: rp.basisDate ?? "기준일 미입력",
      note: u?.perM2Krw == null ? (area ? "금액 환산 불가 — 가격 비교 보류" : "전용면적이 없어 세대당 금액을 ㎡·평당으로 바꿀 수 없음 — 가격 비교 보류") : undefined,
    };
  }
  return {
    review,
    market: {
      count: m.pooled.count, complexes: m.comparables.length,
      window: `최근 ${m.recentWindow.months}개월(${m.recentWindow.start}~${m.recentWindow.end})`,
      area: m.areaFilter ? `전용 ${fmtNum(m.areaFilter.minM2, 1)}~${fmtNum(m.areaFilter.maxM2, 1)}㎡` : "면적 필터 없음(본건 전용면적 미입력)",
      perM2: med === null ? "미산출" : `${fmtMan(med)}/전용㎡`,
      perPyeong: med === null ? "미산출" : `${fmtMan(med * M2_PER_PYEONG, 0)}/전용평`,
      householdEquiv: med === null || !area ? "미산출" : `${fmtEok(med * area)}(본건 전용 ${fmtNum(area, 2)}㎡ 환산, 참고)`,
      range: range ? `${fmtMan(range.min)}~${fmtMan(range.max)}/전용㎡` : "-",
    },
    diffText: r.price.status === "computed" && r.price.diffPct !== null ? `검토가격은 대표 비교단지 거래 중위보다 ${r.price.diffPct > 0 ? "+" : ""}${r.price.diffPct.toFixed(1)}%` : `가격 판단 보류 — ${r.price.reason ?? "비교 불가"}`,
    disclaimer: "실거래 중위는 비교 기준이며 적정가격이 아님.",
  };
}

export interface ObservationView {
  configured: boolean;
  valid: boolean;
  headline: string;
  impact: string;
  control: string;
  difference: string | null;
  flags: string[];
  demo: boolean;
}

/** 변동률 표시(+/− 부호 포함) */
export const fmtChange = (v: number | null) => (v === null ? "미산출" : `${v > 0 ? "+" : ""}${fmtPct(v)}`);
const groupLine = (name: string, x: ObservationResult["impact"]) =>
  `${name} ${x.changePct === null ? "변동률 미산출" : fmtChange(x.changePct)} (중위 ${fmtMan(x.pre.medianPerM2)}→${fmtMan(x.post.medianPerM2)}/전용㎡, 전 ${x.pre.count}건·후 ${x.post.count}건, 단지 ${x.complexes}곳)`;

/** 입지 사건 전후 관측(수동 확인 영향권·비교군). 유효한 비교가 아니면 차이(%p)를 숨긴다. */
export function observationView(g: ObservationResult | undefined): ObservationView {
  if (!g) return { configured: false, valid: false, headline: "영향권·비교군 미설정", impact: "", control: "", difference: null, flags: [], demo: false };
  // v0.6.1~0.6.3 실행 결과에는 valid가 없음 → 차이가 산출됐을 때만 유효로 봄
  const valid = (g as any).valid ?? g.differencePp !== null;
  const demo = g.warnings.some((x) => /가상 자료/.test(x)) || g.basis.dataModes.some((x) => /가상/.test(x));
  return {
    configured: true, valid,
    headline: `${g.anchorLabel || "기준 일정 미선택"} ${g.anchor} · 전후 ${g.start ? `${g.start}~${g.end}` : "미산출"}`,
    impact: groupLine("영향권", g.impact),
    control: groupLine("비교군", g.control),
    difference: valid && g.differencePp !== null ? `비교군 대비 관측 차이 ${fmtPp(g.differencePp)}` : null,
    flags: g.warnings,
    demo,
  };
}
