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

export function collectionStatusText(r: CollectionReport): string {
  const okMonths = r.months.filter((m) => m.ok).length;
  const label = r.status === "complete" ? "전체 수집·건수 대사 완료" : r.status === "partial" ? "일부 수집 — 누락 가능" : r.status === "unset" ? "미설정" : "수집 실패";
  return `${label}(시군구 ${r.regions.length}곳, 월 ${okMonths}/${r.months.length} 대사 일치, 단지 좌표 ${r.complexGeocode.located}/${r.complexGeocode.attempted})`;
}
