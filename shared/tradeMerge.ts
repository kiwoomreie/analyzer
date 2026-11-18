// 실거래 중복 제거·정정·취소 대사.
//
// 식별 기준
// 1) 원천 거래 식별자(officialId)가 있으면 그것만 사용한다.
// 2) 없으면 복합 키: 단지 식별(complexKeyOf) | 전용면적(소수 2자리) | 층 | 동 | 계약일 | 거래금액.
//    해제(취소) 여부·해제일은 키에 넣지 않는다 — 같은 거래가 나중에 해제로 표시돼도 원거래와 대사하기 위함.
// 3) 한 번에 받은 자료 안에서 복합 키가 완전히 같은 거래가 여러 건이면(같은 날 같은 층·면적·금액의 다른 호실 등)
//    서로 다른 거래로 보고 순번(#1, #2…)을 붙여 유지한다. 재조회 시에는 같은 순번끼리만 같은 거래로 본다.
//    → 같은 자료를 여러 번 불러와도 늘지 않고, 서로 다른 거래를 하나로 합치지 않는다.
//
// 정정: 복합 키 중 금액만 다른 건이 같은 출처 종류에서 1:1로만 대응될 때 정정으로 보고 이력을 남긴다.
//       대응이 1:1이 아니면 합치지 않고 신규로 추가하되 ‘정정 여부 확인 필요’로 집계한다.
import { complexKeyOf, type MergeReport, type Transaction } from "./model.ts";

const n2 = (v: number) => (Number.isFinite(v) ? v.toFixed(2) : "?");

/** 금액·해제 여부를 뺀 거래 조건 키 */
export function baseKeyOf(t: Transaction): string {
  return [complexKeyOf(t), n2(t.exclusiveAreaM2), t.floor ?? "", (t.aptDong ?? "").trim(), t.contractDate].join("|");
}

export function fullKeyOf(t: Transaction): string {
  return `${baseKeyOf(t)}|${Math.round(t.priceKrw)}`;
}

/** 목록 안에서 순번을 붙여 식별 키를 정한다(입력 순서 기준). */
export function assignIdKeys(list: Transaction[]): Transaction[] {
  const seen = new Map<string, number>();
  return list.map((t) => {
    if (t.officialId) return { ...t, idKey: `O:${t.officialId}`, idBasis: "official" as const };
    const fk = fullKeyOf(t);
    const n = (seen.get(fk) ?? 0) + 1;
    seen.set(fk, n);
    return { ...t, idKey: `C:${fk}#${n}`, idBasis: "composite" as const };
  });
}

function sourceFamily(t: Transaction): string {
  return t.dataMode;
}

export interface MergeResult { transactions: Transaction[]; report: MergeReport }

/**
 * 기존 목록에 새 자료를 병합. 기존 거래의 사용자 입력(사용자 제외 사유 등)은 덮어쓰지 않는다.
 * @param at 처리 시각(이력 기록용)
 * @param source 출처 설명(이력 기록용)
 */
export function mergeTrades(existing: Transaction[], incomingRaw: Transaction[], at: string, source: string): MergeResult {
  const report: MergeReport = { received: incomingRaw.length, added: 0, duplicates: 0, corrected: 0, cancellationsApplied: 0, addedCancelled: 0, ambiguous: 0, sameKeyGroups: 0, notes: [] };
  const current = existing.some((t) => !t.idKey) ? assignIdKeys(existing) : existing.map((t) => ({ ...t }));
  const incoming = assignIdKeys(incomingRaw);

  const groupCount = new Map<string, number>();
  incoming.forEach((t) => { if (t.idBasis === "composite") { const fk = fullKeyOf(t); groupCount.set(fk, (groupCount.get(fk) ?? 0) + 1); } });
  report.sameKeyGroups = [...groupCount.values()].filter((c) => c > 1).length;
  if (report.sameKeyGroups) report.notes.push(`같은 조건(단지·면적·층·동·계약일·금액)의 거래 묶음 ${report.sameKeyGroups}개 — 서로 다른 거래로 보고 각각 유지`);

  const byId = new Map(current.map((t, i) => [t.idKey!, i]));
  const matchedExisting = new Set<number>();
  const unmatched: Transaction[] = [];
  for (const t of incoming) {
    const i = byId.get(t.idKey!);
    if (i === undefined) { unmatched.push(t); continue; }
    matchedExisting.add(i);
    const ex = current[i];
    if (t.cancelled && !ex.cancelled) {
      current[i] = { ...ex, cancelled: true, cancelDate: t.cancelDate ?? ex.cancelDate, revisions: [...(ex.revisions ?? []), { at, source, change: `해제(취소) 반영${t.cancelDate ? `, 해제일 ${t.cancelDate}` : ""}` }] };
      report.cancellationsApplied++;
    } else if (t.idBasis === "official" && (t.priceKrw !== ex.priceKrw || t.exclusiveAreaM2 !== ex.exclusiveAreaM2 || t.contractDate !== ex.contractDate)) {
      // 원천 식별자가 같은데 값이 바뀐 경우 = 정정
      const ch = [t.priceKrw !== ex.priceKrw ? `거래금액 ${(ex.priceKrw / 1e4).toLocaleString("ko-KR")}→${(t.priceKrw / 1e4).toLocaleString("ko-KR")}만원` : null, t.exclusiveAreaM2 !== ex.exclusiveAreaM2 ? `전용면적 ${ex.exclusiveAreaM2}→${t.exclusiveAreaM2}㎡` : null, t.contractDate !== ex.contractDate ? `계약일 ${ex.contractDate}→${t.contractDate}` : null].filter(Boolean).join(", ");
      current[i] = { ...ex, priceKrw: t.priceKrw, exclusiveAreaM2: t.exclusiveAreaM2, contractDate: t.contractDate, cancelled: ex.cancelled || t.cancelled, revisions: [...(ex.revisions ?? []), { at, source, change: `정정: ${ch}` }] };
      report.corrected++;
    } else {
      if (!t.cancelled && ex.cancelled) report.notes.push("이미 해제로 대사된 거래가 해제 표시 없이 다시 들어옴 — 해제 상태 유지");
      report.duplicates++;
    }
  }

  // 정정 후보: 금액만 다른 거래(같은 출처 종류, 1:1 대응만)
  const unmatchedByBase = new Map<string, Transaction[]>();
  unmatched.forEach((t) => { if (t.idBasis === "composite") unmatchedByBase.set(baseKeyOf(t), [...(unmatchedByBase.get(baseKeyOf(t)) ?? []), t]); });
  const added: Transaction[] = [];
  const consumed = new Set<Transaction>();
  for (const [bk, inc] of unmatchedByBase) {
    const cands = current.map((t, i) => ({ t, i })).filter(({ t, i }) => !matchedExisting.has(i) && t.idBasis === "composite" && baseKeyOf(t) === bk && sourceFamily(t) === sourceFamily(inc[0]));
    if (!cands.length) continue;
    if (inc.length === 1 && cands.length === 1) {
      const { t: ex, i } = cands[0];
      const nt = inc[0];
      current[i] = {
        ...ex, priceKrw: nt.priceKrw, idKey: nt.idKey, cancelled: ex.cancelled || nt.cancelled, cancelDate: nt.cancelDate ?? ex.cancelDate,
        revisions: [...(ex.revisions ?? []), { at, source, change: `정정: 거래금액 ${(ex.priceKrw / 1e4).toLocaleString("ko-KR")}만원 → ${(nt.priceKrw / 1e4).toLocaleString("ko-KR")}만원` }],
      };
      matchedExisting.add(i);
      consumed.add(nt);
      report.corrected++;
    } else {
      inc.forEach((x) => consumed.add(x));
      added.push(...inc);
      report.added += inc.length;
      report.addedCancelled += inc.filter((x) => x.cancelled).length;
      report.ambiguous += inc.length;
    }
  }
  if (report.ambiguous) report.notes.push(`금액만 다른 기존 거래와 1:1로 대응되지 않는 ${report.ambiguous}건 — 합치지 않고 추가, 정정 여부 확인 필요`);
  for (const t of unmatched) {
    if (consumed.has(t)) continue;
    added.push(t);
    report.added++;
    if (t.cancelled) report.addedCancelled++;
  }
  return { transactions: [...current, ...added], report };
}

export function mergeReportText(r: MergeReport): string {
  return `받은 ${r.received}건: 신규 ${r.added}(이 중 해제 ${r.addedCancelled}) · 중복 ${r.duplicates} · 정정 ${r.corrected} · 해제 반영 ${r.cancellationsApplied}${r.ambiguous ? ` · 정정 여부 확인 필요 ${r.ambiguous}` : ""}`;
}
