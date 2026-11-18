// 실거래 중복 제거·해제 대사(v0.4).
//
// 식별 기준
// 1) 원천 거래 식별자(officialId)가 있으면 그것으로 1:1 대사한다. 같은 식별자에서 값이 바뀌면 ‘정정’으로 처리한다.
// 2) 없으면 ‘동조건 묶음’ 키를 쓴다: 단지 식별 | 전용면적(소수 2자리) | 층 | 동 | 계약일 | 거래금액.
//    해제 여부·해제일은 키에 넣지 않는다(나중에 해제로 표시돼도 같은 묶음으로 대사).
//    묶음 안의 거래들은 기록된 정보로는 서로 구별할 수 없으므로 입력 순서를 식별자로 쓰지 않는다.
//    묶음 단위로 건수와 해제 건수만 대사한다.
//      - 건수: 새 자료의 묶음 건수가 기존보다 많으면 차이만큼 추가, 적으면 기존 유지(부분 자료일 수 있음).
//      - 해제: 해제는 되돌리지 않는다. 새 자료의 해제 건수가 더 많으면 차이만큼 반영하되,
//        묶음이 2건 이상이면 ‘어느 거래가 해제됐는지 특정 불가’로 표시한다.
// 3) 가격만 다른 거래는 원천의 정정 연결 정보가 없으면 자동 정정하지 않는다. 둘 다 보존하고
//    ‘별도 거래 또는 정정 여부 확인 필요’로 표시한다. 단, 기존 거래와 같은 묶음이 이번 자료에도 함께 들어왔다면
//    원천이 두 거래를 함께 제공한 것이므로 별도 거래로 본다.
import { complexKeyOf, type MergeReport, type Transaction } from "./model.ts";

const n2 = (v: number) => (Number.isFinite(v) ? v.toFixed(2) : "?");

/** 금액·해제 여부를 뺀 거래 조건 키 */
export function baseKeyOf(t: Transaction): string {
  return [complexKeyOf(t), n2(t.exclusiveAreaM2), t.floor ?? "", (t.aptDong ?? "").trim(), t.contractDate].join("|");
}

export function fullKeyOf(t: Transaction): string {
  return `${baseKeyOf(t)}|${Math.round(t.priceKrw)}`;
}

/** 식별 키: 원천 식별자 또는 동조건 묶음 키(순번 없음) */
export function idKeyOf(t: Transaction): string {
  return t.officialId ? `O:${t.officialId}` : `C:${fullKeyOf(t)}`;
}

export interface MergeResult { transactions: Transaction[]; report: MergeReport }

const wonText = (v: number) => `${(v / 1e4).toLocaleString("ko-KR")}만원`;

/**
 * 기존 목록에 새 자료를 병합. 기존 거래와 사용자 입력(사용자 제외 사유 등)은 덮어쓰거나 지우지 않는다.
 */
export function mergeTrades(existing: Transaction[], incomingRaw: Transaction[], at: string, source: string): MergeResult {
  const report: MergeReport = { received: incomingRaw.length, added: 0, duplicates: 0, corrected: 0, cancellationsApplied: 0, addedCancelled: 0, cancelUnspecified: 0, possibleCorrections: 0, partialGroups: 0, sameKeyGroups: 0, notes: [] };
  const norm = (t: Transaction): Transaction => ({ ...t, idKey: idKeyOf(t), idBasis: t.officialId ? "official" : "composite" });
  const current = existing.map(norm);
  const incoming = incomingRaw.map(norm);

  // ── 1) 원천 식별자: 1:1
  const byOfficial = new Map(current.map((t, i) => [t.idKey!, i]).filter(([k]) => (k as string).startsWith("O:")) as [string, number][]);
  const added: Transaction[] = [];
  for (const t of incoming.filter((x) => x.idBasis === "official")) {
    const i = byOfficial.get(t.idKey!);
    if (i === undefined) { added.push(t); report.added++; if (t.cancelled) report.addedCancelled++; continue; }
    const ex = current[i];
    const changes = [t.priceKrw !== ex.priceKrw ? `거래금액 ${wonText(ex.priceKrw)}→${wonText(t.priceKrw)}` : null, t.exclusiveAreaM2 !== ex.exclusiveAreaM2 ? `전용면적 ${ex.exclusiveAreaM2}→${t.exclusiveAreaM2}㎡` : null, t.contractDate !== ex.contractDate ? `계약일 ${ex.contractDate}→${t.contractDate}` : null].filter(Boolean);
    let next = ex;
    if (changes.length) { next = { ...next, priceKrw: t.priceKrw, exclusiveAreaM2: t.exclusiveAreaM2, contractDate: t.contractDate, revisions: [...(next.revisions ?? []), { at, source, change: `정정(원천 식별자 일치): ${changes.join(", ")}` }] }; report.corrected++; }
    if (t.cancelled && !ex.cancelled) { next = { ...next, cancelled: true, cancelDate: t.cancelDate ?? ex.cancelDate, revisions: [...(next.revisions ?? []), { at, source, change: `해제 반영${t.cancelDate ? `(해제일 ${t.cancelDate})` : ""}` }] }; report.cancellationsApplied++; }
    if (!changes.length && !(t.cancelled && !ex.cancelled)) report.duplicates++;
    current[i] = next;
  }

  // ── 2) 동조건 묶음
  const groupOf = (list: Transaction[]) => {
    const g = new Map<string, Transaction[]>();
    list.forEach((t) => { if (t.idBasis === "composite") g.set(t.idKey!, [...(g.get(t.idKey!) ?? []), t]); });
    return g;
  };
  const exIdx = new Map<string, number[]>();
  current.forEach((t, i) => { if (t.idBasis === "composite") exIdx.set(t.idKey!, [...(exIdx.get(t.idKey!) ?? []), i]); });
  const inGroups = groupOf(incoming);
  const incomingKeys = new Set(inGroups.keys());

  for (const [k, items] of inGroups) {
    const idx = exIdx.get(k) ?? [];
    const nIn = items.length, cIn = items.filter((x) => x.cancelled).length;
    if (nIn > 1) report.sameKeyGroups++;
    let matched = Math.min(nIn, idx.length);
    if (nIn < idx.length) report.partialGroups++;
    // 건수 차이만큼 추가(해제 표시는 아래에서 묶음 단위로 대사)
    const newOnes: Transaction[] = [];
    for (let j = idx.length; j < nIn; j++) newOnes.push({ ...items[j], cancelled: false, cancelDate: undefined });
    const groupRefs = [...idx.map((i) => ({ get: () => current[i], set: (t: Transaction) => { current[i] = t; } })), ...newOnes.map((t, j) => ({ get: () => newOnes[j], set: (x: Transaction) => { newOnes[j] = x; } }))];
    const size = groupRefs.length;
    const cNow = groupRefs.filter((r) => r.get().cancelled).length;
    const cTarget = Math.min(size, Math.max(cNow, cIn));
    if (cIn < cNow) report.notes.push("기존에 해제로 대사된 거래가 이번 자료에서는 해제 표시 없이 들어옴 — 해제 상태 유지");
    if (cTarget > cNow) {
      const dates = items.filter((x) => x.cancelled).map((x) => x.cancelDate);
      const free = groupRefs.filter((r) => !r.get().cancelled);
      const unspecified = size > 1 && free.length > cTarget - cNow;
      for (let j = 0; j < cTarget - cNow; j++) {
        const r = free[j];
        if (groupRefs.indexOf(r) < idx.length) matched--; // 기존 거래에 해제 반영 → ‘중복’이 아니라 ‘해제 반영’으로 집계
        const t = r.get();
        r.set({ ...t, cancelled: true, cancelDate: dates[j] ?? t.cancelDate, revisions: [...(t.revisions ?? []), { at, source, change: `해제 반영${unspecified ? `(같은 조건 ${size}건 중 해제 ${cTarget}건 — 어느 거래인지 특정 불가)` : ""}` }] });
      }
      report.cancellationsApplied += cTarget - cNow;
      if (unspecified) report.cancelUnspecified += cTarget - cNow;
    }
    report.duplicates += Math.max(0, matched);
    // 같은 묶음 크기 기록(구별 불가 표시)
    groupRefs.forEach((r) => { const t = r.get(); if (size > 1 || t.sameKeyCount) r.set({ ...t, sameKeyCount: size }); });
    report.added += newOnes.length;
    report.addedCancelled += newOnes.filter((t) => t.cancelled).length;
    added.push(...newOnes);
  }
  if (report.cancelUnspecified) report.notes.push(`같은 조건 묶음에서 해제 ${report.cancelUnspecified}건 반영 — 어느 거래가 해제됐는지 특정 불가(건수만 대사)`);
  if (report.partialGroups) report.notes.push(`같은 조건 묶음 ${report.partialGroups}개는 기존보다 적게 들어옴 — 부분 자료일 수 있어 기존 거래 유지`);
  if (report.sameKeyGroups) report.notes.push(`같은 조건(단지·면적·층·동·계약일·금액) 거래 묶음 ${report.sameKeyGroups}개 — 구별 불가하므로 건수 단위로 대사`);

  // ── 3) 가격만 다른 거래: 자동 정정하지 않고 확인 필요 표시
  const flagged = new Set<number>();
  added.forEach((t, j) => {
    if (t.idBasis !== "composite") return;
    const base = baseKeyOf(t);
    // 같은 조건·다른 금액의 기존 거래 중, 이번 자료에 함께 오지 않은 것
    const others = current.map((x, i) => ({ x, i })).filter(({ x }) => x.idBasis === "composite" && baseKeyOf(x) === base && x.idKey !== t.idKey && !incomingKeys.has(x.idKey!));
    if (!others.length) return;
    const note = `같은 조건(단지·면적·층·동·계약일)에 금액만 다른 거래가 따로 들어옴 — 별도 거래인지 정정인지 확인 필요(원천 정정 연결 정보 없음, 둘 다 보존)`;
    added[j] = { ...t, reviewFlag: { kind: "possibleCorrection", base, note } };
    report.possibleCorrections++;
    others.forEach(({ x, i }) => { if (!flagged.has(i)) { current[i] = { ...x, reviewFlag: { kind: "possibleCorrection", base, note } }; flagged.add(i); } });
  });
  if (report.possibleCorrections) report.notes.push(`금액만 다른 같은 조건 거래 ${report.possibleCorrections}건 — 자동 정정하지 않고 보존, 별도 거래 또는 정정 여부 확인 필요`);
  return { transactions: [...current, ...added], report };
}

export function mergeReportText(r: MergeReport): string {
  return `받은 ${r.received}건: 신규 ${r.added} · 중복 ${r.duplicates} · 해제 반영 ${r.cancellationsApplied}${r.cancelUnspecified ? `(거래 특정 불가 ${r.cancelUnspecified})` : ""}${r.corrected ? ` · 정정(원천 식별자) ${r.corrected}` : ""}${r.possibleCorrections ? ` · 별도 거래/정정 확인 필요 ${r.possibleCorrections}` : ""}${r.partialGroups ? ` · 부분 자료 묶음 ${r.partialGroups}` : ""}`;
}
