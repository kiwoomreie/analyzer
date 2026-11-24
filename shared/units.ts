// 단위 정규화. 내부 금액은 원(KRW), 면적은 전용㎡. 1평 = 400/121 ㎡.
import type { MoneyUnit, PriceBasis } from "./contract.ts";

export const M2_PER_PYEONG = 400 / 121;

export function toKrw(amount: number, unit: MoneyUnit): number | null {
  if (!Number.isFinite(amount) || amount < 0) return null;
  const mult = unit === "KRW" ? 1 : unit === "KRW_10K" ? 1e4 : unit === "KRW_100M" ? 1e8 : NaN;
  if (!Number.isFinite(mult)) return null;
  const v = Math.round(amount * mult);
  return Number.isSafeInteger(v) ? v : null;
}

export function m2ToPyeong(m2: number): number {
  return (m2 * 121) / 400;
}

export function pyeongToM2(py: number): number {
  return py * M2_PER_PYEONG;
}

/** 분모 0·미입력이면 null(계산 불가). */
export function safeDivide(n: number | null | undefined, d: number | null | undefined): number | null {
  if (n === null || n === undefined || d === null || d === undefined) return null;
  if (!Number.isFinite(n) || !Number.isFinite(d) || d === 0) return null;
  return n / d;
}

export interface UnitPrices {
  /** 원 기준 원래 금액 */
  amountKrw: number;
  basis: PriceBasis;
  /** 전용㎡당 원. 환산 근거가 없으면 null */
  perM2Krw: number | null;
  /** 전용평당 원 */
  perPyeongKrw: number | null;
  /** 세대(비교 타입 1세대) 총액. 환산 근거가 없으면 null */
  householdKrw: number | null;
  /** 사업 전체 금액. project 기준일 때만 */
  projectKrw: number | null;
  conversionNote: string;
}

/**
 * 가격 기준별 환산.
 * - household: 비교 타입 전용면적이 있을 때만 ㎡당으로 환산.
 * - perExclusiveM2 / perExclusivePyeong: 서로 환산, 전용면적이 있으면 세대 총액 환산.
 * - project: 사업 전체 전용면적 합계(totalExclusiveAreaM2)가 있을 때만 ㎡당 환산.
 *   세대 전용면적으로 나누거나 총세대수로 환산하지 않는다.
 */
export function deriveUnitPrices(amountKrw: number, basis: PriceBasis, exclusiveAreaM2?: number | null, totalExclusiveAreaM2?: number | null): UnitPrices {
  const area = exclusiveAreaM2 && exclusiveAreaM2 > 0 ? exclusiveAreaM2 : null;
  const totalArea = totalExclusiveAreaM2 && totalExclusiveAreaM2 > 0 ? totalExclusiveAreaM2 : null;
  let perM2: number | null = null;
  let household: number | null = null;
  let project: number | null = null;
  let note = "";
  switch (basis) {
    case "household":
      household = amountKrw;
      perM2 = safeDivide(amountKrw, area);
      note = area ? "세대 금액 ÷ 비교 타입 전용면적" : "전용면적 미입력 — ㎡당 환산 불가";
      break;
    case "perExclusiveM2":
      perM2 = amountKrw;
      household = area ? amountKrw * area : null;
      note = "전용㎡당 입력값";
      break;
    case "perExclusivePyeong":
      perM2 = amountKrw / M2_PER_PYEONG;
      household = area ? perM2 * area : null;
      note = "전용평당 ÷ (400/121)";
      break;
    case "project":
      project = amountKrw;
      perM2 = safeDivide(amountKrw, totalArea);
      note = totalArea
        ? "사업 전체 금액 ÷ 사업 전체 전용면적 합계"
        : "사업 전체 금액 — 사업 전체 전용면적 합계가 없어 ㎡당 환산하지 않음(세대 면적·세대수로 나누지 않음)";
      break;
  }
  return {
    amountKrw,
    basis,
    perM2Krw: perM2,
    perPyeongKrw: perM2 === null ? null : perM2 * M2_PER_PYEONG,
    householdKrw: household,
    projectKrw: project,
    conversionNote: note,
  };
}

// ── 화면 표시용 서식 ──
export function fmtEok(krw: number | null | undefined, digits = 2): string {
  if (krw === null || krw === undefined || !Number.isFinite(krw)) return "미산출";
  return `${(krw / 1e8).toLocaleString("ko-KR", { maximumFractionDigits: digits })}억원`;
}

export function fmtMan(krw: number | null | undefined, digits = 1): string {
  if (krw === null || krw === undefined || !Number.isFinite(krw)) return "미산출";
  return `${(krw / 1e4).toLocaleString("ko-KR", { maximumFractionDigits: digits })}만원`;
}

export function fmtKrwAuto(krw: number | null | undefined): string {
  if (krw === null || krw === undefined || !Number.isFinite(krw)) return "미산출";
  return Math.abs(krw) >= 1e8 ? fmtEok(krw) : fmtMan(krw);
}

export function fmtPct(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "미산출";
  return `${v.toLocaleString("ko-KR", { maximumFractionDigits: digits, minimumFractionDigits: digits })}%`;
}

export function fmtPp(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "미산출";
  const s = v.toLocaleString("ko-KR", { maximumFractionDigits: digits, minimumFractionDigits: digits });
  return `${v > 0 ? "+" : ""}${s}%p`;
}

export function fmtNum(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "미산출";
  return v.toLocaleString("ko-KR", { maximumFractionDigits: digits });
}

export function fmtExclusivePyeong(perM2: number | null) {
  return perM2 === null ? "미산출" : fmtMan(perM2 * M2_PER_PYEONG);
}
