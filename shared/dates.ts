// 날짜 처리: 입력 정밀도(월/일)를 보존한다. 월만 받은 날짜를 특정 일자로 바꾸지 않는다.
// 달력 날짜는 Asia/Seoul 기준. 연월 차이 = 연도 차이 × 12 + 월 차이(실제 일수와 구분).

export interface DateParts {
  raw: string;
  precision: "month" | "day";
  y: number;
  m: number;
  d?: number;
}

const RE = /^(\d{4})-(0[1-9]|1[0-2])(?:-(0[1-9]|[12]\d|3[01]))?$/;

export function parseDateValue(raw: string | undefined | null): DateParts | null {
  if (!raw) return null;
  const m = RE.exec(raw);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  if (m[3] === undefined) return { raw, precision: "month", y, m: mo };
  const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null; // 2025-02-30 등
  return { raw, precision: "day", y, m: mo, d };
}

export function isValidDateValue(raw: string): boolean {
  return parseDateValue(raw) !== null;
}

/** b - a 의 연월 차이(개월). 일 정밀도는 무시하고 연·월만 사용. */
export function monthDiff(a: DateParts, b: DateParts): number {
  return (b.y - a.y) * 12 + (b.m - a.m);
}

/** 실제 일수 차이. 양쪽 모두 일 정밀도일 때만 계산. */
export function dayDiff(a: DateParts, b: DateParts): number | null {
  if (a.precision !== "day" || b.precision !== "day") return null;
  const ta = Date.UTC(a.y, a.m - 1, a.d!);
  const tb = Date.UTC(b.y, b.m - 1, b.d!);
  return Math.round((tb - ta) / 86400000);
}

/** 개월 가산. 결과 정밀도는 원래 정밀도를 따르며, 일 정밀도에서 말일 초과 시 해당 월 말일로 맞춘다. */
export function addMonths(p: DateParts, months: number): DateParts {
  const total = p.y * 12 + (p.m - 1) + months;
  const y = Math.floor(total / 12);
  const m = (total % 12) + 1;
  if (p.precision === "month") return { raw: `${y}-${pad(m)}`, precision: "month", y, m };
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const d = Math.min(p.d!, last);
  return { raw: `${y}-${pad(m)}-${pad(d)}`, precision: "day", y, m, d };
}

/** 정렬·비교용 키. 월 정밀도는 해당 월 전체를 뜻하므로 비교 시 월 단위로만 판단해야 한다. */
export function compareMonth(a: DateParts, b: DateParts): number {
  return a.y * 12 + a.m - (b.y * 12 + b.m);
}

/** a 가 b 이전인지. 둘 다 일 정밀도면 일 단위, 아니면 월 단위로만 판단(같은 달이면 null=판단 불가). */
export function isBefore(a: DateParts, b: DateParts): boolean | null {
  const cm = compareMonth(a, b);
  if (cm !== 0) return cm < 0;
  if (a.precision === "day" && b.precision === "day") return a.d! < b.d!;
  return null;
}

export function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** 현재 Asia/Seoul 달력 날짜 (YYYY-MM-DD). */
export function seoulToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** 시간대를 포함한 현재 시각(ISO, +09:00). */
export function seoulNowIso(now: Date = new Date()): string {
  const t = new Date(now.getTime() + 9 * 3600000);
  return t.toISOString().replace("Z", "+09:00");
}

export function formatDateValue(p: DateParts | null): string {
  if (!p) return "미입력";
  return p.precision === "month" ? `${p.y}년 ${p.m}월(월 단위)` : `${p.y}-${pad(p.m)}-${pad(p.d!)}`;
}
