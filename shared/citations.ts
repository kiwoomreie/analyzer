// 실행본 인용 근거: 결과 카드의 [실거래-01]·[입지-01]·[관측-01] 버튼이 가리키는 거래·단지·사건을
// 그 실행 시점 값으로 별도 보존한다. 이후 입력(거래 수정·삭제, 단지명 변경)으로 다시 채우지 않는다.
import type { AnalysisResult } from "./analysis.ts";
import { EVIDENCE_LEVEL_LABEL, EVIDENCE_SOURCE_LABEL, EVIDENCE_STATUS_LABEL, MILESTONE_LABEL, type DataMode, type Evidence, type Transaction, type WorkingInputs } from "./model.ts";
import { isBefore, parseDateValue } from "./dates.ts";
import { evidenceLevel } from "./analysis.ts";

export interface CitedTrade { key: string; contractDate: string; areaM2: number; floor?: number; priceKrw: number; perM2Krw: number; cancelled: boolean; dataMode: DataMode; source?: string }
export interface CitationBase { id: string; title: string; summary: string; dataMode?: DataMode }
export interface TradeCitation extends CitationBase { kind: "trade"; complexKey: string; name: string; dong?: string; distanceM: number | null; buildYear: number | null; medianPerM2: number | null; trades: CitedTrade[]; tradeTotal: number }
/** 입지 사건 근거 문서(실행 시점 값). 원문 파일·주소는 앱이 조회하지 않으며 텍스트로만 남김 */
export interface CitedDocument {
  key: string; title: string; publisher: string; sourceType: string; sourceRef?: string; sourceUrl?: string;
  publishedOn?: string; effectiveOn?: string; checkedOn?: string; pageOrSection?: string;
  fact: string; status: string; level: string; originalReviewed: boolean; dataMode: DataMode;
  /** 이 문서를 근거로 기록한 일정(예: 고시 2024-02-20) */
  milestones: string[];
  /** 분석 기준일 이후 발행된 문서(기준일 시점에는 알 수 없던 정보) */
  afterAsOf: boolean;
}
export interface EventCitation extends CitationBase { kind: "event"; eventKey: string; name: string; categoryLabel: string; stageAsOf: string; timeline: { type: string; status: string; date: string; announcedOn: string; knownAsOf: boolean; note?: string }[]; evidenceText: string; documents?: CitedDocument[] }
export interface ObservationCitation extends CitationBase { kind: "observation"; anchor: string; window: string; usage: { group: string; label: string; used: boolean; pre: number; post: number; reason?: string }[] }
export type Citation = TradeCitation | EventCitation | ObservationCitation;
export interface CitationSet { version: 1; savedAt: string; items: Citation[] }

/** 인용 1건당 보존하는 거래 상한(최근 계약 순). 전체 건수는 tradeTotal에 남긴다 */
export const MAX_TRADES_PER_CITATION = 40;
const pad = (n: number) => String(n).padStart(2, "0");

export const tradeCitationId = (i: number) => `실거래-${pad(i + 1)}`;
export const eventCitationId = (i: number) => `입지-${pad(i + 1)}`;
export const OBS_CITATION_ID = "관측-01";

export function buildCitations(input: WorkingInputs, r: AnalysisResult, at: string): CitationSet {
  const byKey = new Map<string, Transaction>(input.transactions.map((t) => [t.key, t]));
  const items: Citation[] = [];
  r.market.comparables.forEach((c, i) => {
    const rows = r.market.txRows.filter((x) => x.complexKey === c.complexKey && x.included);
    const trades = rows.map((x) => byKey.get(x.key)).filter((t): t is Transaction => !!t)
      .sort((a, b) => (a.contractDate < b.contractDate ? 1 : -1))
      .map((t) => ({ key: t.key, contractDate: t.contractDate, areaM2: t.exclusiveAreaM2, floor: t.floor, priceKrw: t.priceKrw, perM2Krw: t.priceKrw / t.exclusiveAreaM2, cancelled: t.cancelled, dataMode: t.dataMode, source: t.source }));
    items.push({ kind: "trade", id: tradeCitationId(i), title: `${c.name}${c.dong ? `(${c.dong})` : ""}`, name: c.name, dong: c.dong, complexKey: c.complexKey,
      summary: `대표 비교단지 ${i + 1} · 최근 유사면적 거래 ${rows.length}건 · ${c.selectionReason}`,
      distanceM: c.distanceM, buildYear: c.buildYear, medianPerM2: c.stats.medianPerM2, trades: trades.slice(0, MAX_TRADES_PER_CITATION), tradeTotal: trades.length, dataMode: c.dataModes?.[0] });
  });
  const asOf = parseDateValue(input.asOf);
  r.events.forEach((e, i) => {
    const ev = input.events.find((x) => x.key === e.key);
    const docKeys = new Set([...(ev?.evidenceKeys ?? []), ...(ev?.milestones ?? []).flatMap((m) => m.evidenceKeys ?? [])]);
    const docs: Evidence[] = (input.evidence ?? []).filter((d) => docKeys.has(d.key) || (d.linked ?? []).includes(e.key));
    const documents: CitedDocument[] = docs.map((d) => {
      const pub = parseDateValue(d.publishedOn ?? null);
      return {
        key: d.key, title: d.title, publisher: d.publisher, sourceType: d.sourceType ? EVIDENCE_SOURCE_LABEL[d.sourceType] : "미기재", sourceRef: d.sourceRef, sourceUrl: d.sourceUrl,
        publishedOn: d.publishedOn, effectiveOn: d.effectiveOn, checkedOn: d.checkedOn, pageOrSection: d.pageOrSection,
        fact: d.fact, status: EVIDENCE_STATUS_LABEL[d.status], level: EVIDENCE_LEVEL_LABEL[evidenceLevel(d)], originalReviewed: !!d.originalReviewed, dataMode: d.dataMode,
        milestones: (ev?.milestones ?? []).filter((m) => (m.evidenceKeys ?? []).includes(d.key)).map((m) => `${MILESTONE_LABEL[m.type] ?? m.type} ${m.date ?? "날짜 미기재"}`),
        afterAsOf: !!(pub && asOf && isBefore(asOf, pub) === true),
      };
    });
    items.push({ kind: "event", id: eventCitationId(i), eventKey: e.key, name: e.name, title: e.name, categoryLabel: e.categoryLabel, stageAsOf: e.stageAsOf, documents,
      summary: `${e.categoryLabel} · ${e.stageAsOf}`, dataMode: e.dataMode, evidenceText: e.evidence.text,
      timeline: e.timeline.map((t) => ({ type: t.type, status: t.status, date: t.date, announcedOn: t.announcedOn, knownAsOf: t.knownAsOf, note: t.note })) });
  });
  const g = r.groupObservation;
  if (g) items.push({ kind: "observation", id: OBS_CITATION_ID, title: `수동 확인 영향권·비교군 관측 ${g.anchorLabel || ""}`.trim(), summary: `기준 ${g.anchor || "미선택"} · 전후 ${g.start ? `${g.start}~${g.end}` : "미산출"}`,
    anchor: g.anchor, window: g.start ? `${g.start}~${g.end}` : "", usage: (g.usage ?? []).map((u) => ({ group: u.group === "impact" ? "영향권" : "비교군", label: u.label, used: u.used, pre: u.pre, post: u.post, reason: u.reason })) });
  return { version: 1, savedAt: at, items };
}

/** 결과 화면용: 비교단지·사건 → 인용 ID (과거 실행에 인용이 없어도 같은 규칙으로 ID를 붙이고, 상세는 ‘미보존’) */
export function citationIdForComplex(r: AnalysisResult, complexKey: string): string | null {
  const i = r.market.comparables.findIndex((c) => c.complexKey === complexKey);
  return i < 0 ? null : tradeCitationId(i);
}
export function citationIdForEvent(r: AnalysisResult, eventKey: string): string | null {
  const i = r.events.findIndex((e) => e.key === eventKey);
  return i < 0 ? null : eventCitationId(i);
}
export function findCitation(r: AnalysisResult, id: string): Citation | null {
  return r.citations?.items.find((c) => c.id === id) ?? null;
}
