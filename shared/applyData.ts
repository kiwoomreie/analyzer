// 가져온 자료를 작업본에 반영(순수 함수). 기존 사용자 입력은 덮어쓰지 않는다.
import type { CollectionReport, ComplexInfo, MergeReport, Transaction, WorkingInputs } from "./model.ts";
import { mergeReportText, mergeTrades } from "./tradeMerge.ts";

export interface LookupPayload {
  geocode: { lat: number; lng: number; lawdCode?: string; source: string } | null;
  trades: Transaction[];
  complexes: { complexKey: string; location: { lat: number; lng: number }; locationSource: string; address: string }[];
  report: CollectionReport;
}

/** 실거래 병합(중복 제거·정정·해제 대사) */
export function applyTrades(w: WorkingInputs, items: Transaction[], at: string, source: string): MergeReport {
  const { transactions, report } = mergeTrades(w.transactions, items, at, source);
  w.transactions = transactions;
  w.dataLog.push({ at, source, detail: mergeReportText(report) + (report.notes.length ? ` · ${report.notes.join(" · ")}` : "") });
  return report;
}

/** 공공 API 조회 결과 반영. 본건 좌표·시군구·단지 정보는 비어 있을 때만 채운다. */
export function applyLookup(w: WorkingInputs, res: LookupPayload, at: string): CollectionReport {
  if (res.geocode && !w.property.coordinates) w.property.coordinates = { lat: res.geocode.lat, lng: res.geocode.lng, source: res.geocode.source };
  if (res.geocode?.lawdCode && !w.property.lawdCode) w.property.lawdCode = res.geocode.lawdCode;
  const merge = res.trades.length ? applyTrades(w, res.trades, at, "국토교통부 아파트 매매 실거래가 API") : undefined;
  for (const c of res.complexes) {
    const ex = w.complexInfo.find((x) => x.complexKey === c.complexKey);
    if (!ex) w.complexInfo.push({ complexKey: c.complexKey, location: c.location, locationSource: c.locationSource, address: c.address } as ComplexInfo);
    else if (!ex.location) { ex.location = c.location; ex.locationSource = c.locationSource; ex.address ??= c.address; }
  }
  const report: CollectionReport = { ...res.report, merge };
  w.collections = [report, ...(w.collections ?? [])].slice(0, 10);
  w.dataLog.push({ at, source: "공공·지도 API 수집", detail: `${collectionStatusText(report)} · ${report.regionNote}` });
  return report;
}

export const TRADE_STATUS_LABEL = { complete: "완료(건수 대사 일치)", partial: "일부만 수집 — 누락 가능", failed: "실패", unset: "미설정" } as const;
export const REGION_STATUS_LABEL = { sampled: "표본 지점 확인(경계 전체 보장 아님)", partial: "일부 지점 실패·상한 — 누락 가능", notPerformed: "미수행 — 지정 시군구만" } as const;
export const GEOCODE_STATUS_LABEL = { complete: "확인 대상 모두 좌표 확인", partial: "일부 미확인", failed: "확인 실패", notPerformed: "미수행" } as const;

/** 세 가지 상태를 따로 표시(하나의 ‘완료’로 합치지 않음) */
export function collectionStatusText(r: CollectionReport): string {
  return [
    `거래 응답 수집·건수 대사: ${TRADE_STATUS_LABEL[r.trades.status]}(월 ${r.trades.monthsOk}/${r.trades.monthsTotal}${r.trades.capped ? ", 상한 도달" : ""})`,
    `주변 행정구역 탐색: ${REGION_STATUS_LABEL[r.regionDiscovery.status]}(시군구 ${r.regionDiscovery.regionsUsed}곳${r.regionDiscovery.failedPoints ? `, 실패 지점 ${r.regionDiscovery.failedPoints}` : ""}${r.regionDiscovery.capped ? ", 상한 도달" : ""})`,
    `단지 좌표 확인: ${GEOCODE_STATUS_LABEL[r.complexGeocode.status]}(${r.complexGeocode.located}/${r.complexGeocode.total}${r.complexGeocode.capped ? ", 상한 도달" : ""})`,
  ].join(" · ");
}
