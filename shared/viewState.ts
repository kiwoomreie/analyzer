/** 저장된 단계 값은 1~4 정수만 허용한다. 손상·이전 버전 값은 첫 단계로 복구. */
export function analysisStep(value: unknown): number {
  const n = typeof value === 'string' && value.trim() ? Number(value) : value;
  return typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 4 ? n : 1;
}
