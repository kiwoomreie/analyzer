import { isBefore, parseDateValue } from "./dates.ts";
import type { Evidence, LocationEvent, Milestone, Transaction } from "./model.ts";

/** 월만 기록된 자료는 그 달이 지난 후에만 기준일 당시 공개를 확정할 수 있다. */
export function availableBy(date: string | undefined, cutoff: string) {
  const d = parseDateValue(date), end = parseDateValue(cutoff);
  return !!d && !!end && isBefore(end, d) === false;
}
export function evidenceDate(e: Evidence) {
  return e.publishedOn || e.checkedOn;
}
export function milestoneKnownOn(m: Milestone, evidence: Evidence[]) {
  return m.announcedOn || evidence.filter(e => m.evidenceKeys?.includes(e.key))
    .map(evidenceDate).filter((d): d is string => !!d).sort()[0] || m.collectedOn;
}
export function eventKnownOn(ev: LocationEvent, evidence: Evidence[]) {
  return [...ev.milestones.map(m => milestoneKnownOn(m, evidence)), ...evidence
    .filter(e => ev.evidenceKeys?.includes(e.key) || e.linked?.includes(ev.key)).map(evidenceDate)]
    .filter((d): d is string => !!parseDateValue(d)).sort()[0];
}
export function tradeKnownOn(t: Transaction) {
  return t.knownOn || (t.dataMode === "official-api" ? t.source?.match(/(\d{4}-\d{2}-\d{2}) 조회/)?.[1] : undefined);
}
export function tradeAvailable(t: Transaction, cutoff: string) {
  if (t.dataMode === "demo" && !t.knownOn) return availableBy(t.contractDate, cutoff);
  return availableBy(tradeKnownOn(t), cutoff);
}

/** 뒤늦게 붙은 해제 표시는 기준일 당시 확인된 원거래의 상태를 바꾸지 않는다. */
export function transactionAsOf(t: Transaction, cutoff: string): Transaction {
  if (!t.cancelled || !t.cancelDate) return t;
  const date = parseDateValue(t.cancelDate), end = parseDateValue(cutoff);
  return date && end && isBefore(end,date) === true ? {...t,cancelled:false,cancelDate:undefined} : t;
}
