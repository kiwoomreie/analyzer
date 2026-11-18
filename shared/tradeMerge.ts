// 실거래 중복 제거·해제 대사(v0.4).
//
// 식별 기준
// 1) 원천 거래 식별자(officialId)는 출처 범위(idScope)와 함께 관리한다(‘출처 A의 ID 1’ ≠ ‘출처 B의 ID 1’).
//    - 같은 배치에 같은 출처·ID가 같은 내용으로 반복되면 1건만 보존한다. 내용이 다르면 모두 보존하고 ‘ID 충돌 확인 필요’.
//    - 기존 거래와 출처·ID가 같아도 지역·단지(단지명·시군구·법정동·단지코드)가 다르면 병합하지 않고 ‘ID 충돌 확인 필요’.
//    - 출처가 지정된 같은 ID에서 원천 값(금액·면적·계약일·층·동·지번·준공연도·해제)이 바뀌면 ‘원천 정정’으로 반영하고 이력을 남긴다.
//    - 출처 미지정 ID에서 값이 바뀌면 같은 출처인지 확정할 수 없으므로 자동 반영하지 않고 ‘변경 확인 필요’로 보류한다.
//      단, 지역·단지와 다른 원천 값이 모두 같고 해제 표시만 새로 붙은 경우는 해제를 반영한다(유령 정상 거래 방지).
//    - 사용자 입력(사용자 제외 사유, 단지별 거리·준공연도 확인값)은 원천 정정으로 바꾸지 않는다.
//    - 이미 저장된 같은 ID 사본은 지우지 않는다. 내용이 모두 같으면 변경을 사본 모두에 반영(유령 정상 거래 방지),
//      다르면 반영하지 않고 확인 필요로 둔다. 정리는 diagnoseTrades·cleanupIdenticalDuplicates(사용자 실행)로만 한다.
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

/** 식별 키: 출처 범위+원천 식별자 또는 동조건 묶음 키(순번 없음) */
export function idKeyOf(t: Transaction): string {
  return t.officialId ? `O:${scopeOf(t)}:${t.officialId}` : `C:${fullKeyOf(t)}`;
}

export const UNSPECIFIED_SCOPE = "?";
export const scopeOf = (t: Transaction) => (t.idScope?.trim() ? t.idScope.trim() : UNSPECIFIED_SCOPE);

/** 원천 값(사용자 입력 제외) */
const SOURCE_FIELDS = ["complexName", "complexId", "sggCd", "dong", "jibun", "aptDong", "exclusiveAreaM2", "floor", "priceKrw", "contractDate", "cancelled", "cancelDate", "buildYear"] as const;
/** 원천 정정으로 반영할 수 있는 값 */
const CORRECTABLE: { f: keyof Transaction; label: string; fmt?: (v: any) => string }[] = [
  { f: "priceKrw", label: "거래금액", fmt: (v) => wonText(v) }, { f: "exclusiveAreaM2", label: "전용면적", fmt: (v) => `${v}㎡` }, { f: "contractDate", label: "계약일" },
  { f: "floor", label: "층" }, { f: "aptDong", label: "동" }, { f: "jibun", label: "지번" }, { f: "buildYear", label: "준공연도" },
];
export function sourceSignature(t: Transaction): string {
  return JSON.stringify(SOURCE_FIELDS.map((f) => t[f] ?? null));
}
/** 지역·단지 동일성(다르면 같은 ID라도 같은 거래로 보지 않음) */
function anchorOf(t: Transaction): string {
  return [t.complexName.trim(), t.sggCd ?? "", (t.dong ?? "").trim(), t.complexId ?? ""].join("|");
}
function anchorsCompatible(a: Transaction, b: Transaction): boolean {
  if (a.complexName.trim() !== b.complexName.trim()) return false;
  if (a.sggCd && b.sggCd && a.sggCd !== b.sggCd) return false;
  if (a.dong && b.dong && a.dong.trim() !== b.dong.trim()) return false;
  if (a.complexId && b.complexId && a.complexId !== b.complexId) return false;
  return true;
}
function changesBetween(ex: Transaction, t: Transaction): string[] {
  return CORRECTABLE.filter(({ f }) => (t[f] ?? null) !== (ex[f] ?? null) && t[f] !== undefined).map(({ f, label, fmt }) => `${label} ${fmt ? fmt(ex[f]) : ex[f] ?? "없음"}→${fmt ? fmt(t[f]) : t[f]}`);
}

export interface TradeDiagnosis {
  /** 같은 출처·ID·같은 원천 값 사본 묶음(사용자 입력이 같으면 정리 가능) */
  identicalGroups: { idKey: string; keys: string[]; cleanable: boolean }[];
  /** 같은 출처·ID인데 원천 값이 다른 묶음 */
  conflictGroups: { idKey: string; keys: string[] }[];
}

/** 저장된 거래의 같은 ID 중복 진단(변경 없음) */
export function diagnoseTrades(list: Transaction[]): TradeDiagnosis {
  const g = new Map<string, Transaction[]>();
  list.forEach((t) => { if (t.officialId) { const k = idKeyOf(t); g.set(k, [...(g.get(k) ?? []), t]); } });
  const out: TradeDiagnosis = { identicalGroups: [], conflictGroups: [] };
  for (const [k, items] of g) {
    if (items.length < 2) continue;
    const sig = new Set(items.map(sourceSignature));
    if (sig.size === 1) out.identicalGroups.push({ idKey: k, keys: items.map((t) => t.key), cleanable: new Set(items.map((t) => t.manualExclusion ?? "")).size === 1 });
    else out.conflictGroups.push({ idKey: k, keys: items.map((t) => t.key) });
  }
  return out;
}

/** 사용자 실행 전용: 원천 값·사용자 입력이 모두 같은 ID 사본만 1건으로 정리(충돌 묶음은 그대로) */
export function cleanupIdenticalDuplicates(list: Transaction[], at: string): { transactions: Transaction[]; removed: number } {
  const d = diagnoseTrades(list);
  const drop = new Set<string>();
  for (const g of d.identicalGroups) if (g.cleanable) g.keys.slice(1).forEach((k) => drop.add(k));
  const kept = list.filter((t) => !drop.has(t.key)).map((t) => {
    const g = d.identicalGroups.find((x) => x.cleanable && x.keys[0] === t.key);
    return g ? { ...t, revisions: [...(t.revisions ?? []), { at, source: "사용자 정리", change: `같은 ID·같은 내용 사본 ${g.keys.length - 1}건 정리` }] } : t;
  });
  return { transactions: kept, removed: drop.size };
}

export interface MergeResult { transactions: Transaction[]; report: MergeReport }

const wonText = (v: number) => `${(v / 1e4).toLocaleString("ko-KR")}만원`;

/**
 * 기존 목록에 새 자료를 병합. 기존 거래와 사용자 입력(사용자 제외 사유 등)은 덮어쓰거나 지우지 않는다.
 */
export function mergeTrades(existing: Transaction[], incomingRaw: Transaction[], at: string, source: string): MergeResult {
  const report: MergeReport = { received: incomingRaw.length, added: 0, duplicates: 0, corrected: 0, cancellationsApplied: 0, addedCancelled: 0, cancelUnspecified: 0, possibleCorrections: 0, partialGroups: 0, sameKeyGroups: 0, idDuplicatesInBatch: 0, idConflicts: 0, idChangesHeld: 0, storedDuplicatesUpdated: 0, notes: [] };
  const norm = (t: Transaction): Transaction => ({ ...t, idKey: idKeyOf(t), idBasis: t.officialId ? "official" : "composite" });
  void anchorOf;
  const current = existing.map(norm);
  const incoming = incomingRaw.map(norm);

  // ── 1) 출처 범위+원천 식별자
  const added: Transaction[] = [];
  const flagged = new Set<number>();
  const flagEx = (i: number, kind: NonNullable<Transaction["reviewFlag"]>["kind"], note: string) => { current[i] = { ...current[i], reviewFlag: { kind, base: current[i].idKey!, note } }; flagged.add(i); };
  const exById = new Map<string, number[]>();
  current.forEach((t, i) => { if (t.idBasis === "official") exById.set(t.idKey!, [...(exById.get(t.idKey!) ?? []), i]); });
  const inById = new Map<string, Transaction[]>();
  incoming.filter((x) => x.idBasis === "official").forEach((t) => inById.set(t.idKey!, [...(inById.get(t.idKey!) ?? []), t]));
  const conflictNote = "같은 출처·거래 ID인데 내용·지역·단지가 달라 같은 거래로 볼 수 없음 — 병합하지 않고 원본 보존, 확인 필요(대표 통계 제외)";
  for (const [k, group] of inById) {
    // 같은 배치 안 반복
    const sigs = new Set(group.map(sourceSignature));
    if (group.length > 1 && sigs.size === 1) report.idDuplicatesInBatch += group.length - 1;
    if (sigs.size > 1) {
      group.forEach((t) => added.push({ ...t, reviewFlag: { kind: "idConflict", base: k, note: conflictNote } }));
      report.added += group.length;
      report.idConflicts += group.length;
      (exById.get(k) ?? []).forEach((i) => flagEx(i, "idConflict", conflictNote));
      continue;
    }
    const t = group[0];
    const idx = exById.get(k) ?? [];
    if (!idx.length) { added.push(t); report.added++; if (t.cancelled) report.addedCancelled++; continue; }
    const exSigs = new Set(idx.map((i) => sourceSignature(current[i])));
    if (exSigs.size > 1 || !idx.every((i) => anchorsCompatible(current[i], t))) {
      added.push({ ...t, reviewFlag: { kind: "idConflict", base: k, note: conflictNote } });
      report.added++;
      report.idConflicts++;
      idx.forEach((i) => flagEx(i, "idConflict", conflictNote));
      continue;
    }
    const ex = current[idx[0]];
    const changes = changesBetween(ex, t);
    const cancelNew = t.cancelled && !ex.cancelled;
    if (!changes.length && !cancelNew) { report.duplicates++; continue; }
    if (scopeOf(t) === UNSPECIFIED_SCOPE && changes.length) {
      const note = `출처 미지정 거래 ID의 값 변경(${[...changes, cancelNew ? "해제" : null].filter(Boolean).join(", ")}) — 같은 출처인지 확정할 수 없어 자동 반영하지 않음, 확인 필요`;
      idx.forEach((i) => flagEx(i, "idChangeUnconfirmed", note));
      report.idChangesHeld++;
      continue;
    }
    idx.forEach((i) => {
      let next = current[i];
      if (changes.length) {
        const patch: Partial<Transaction> = {};
        CORRECTABLE.forEach(({ f }) => { if (t[f] !== undefined) (patch as any)[f] = t[f]; });
        next = { ...next, ...patch, revisions: [...(next.revisions ?? []), { at, source, change: `원천 정정(출처 ${scopeOf(t)}·ID 일치): ${changes.join(", ")}` }] };
      }
      if (cancelNew) next = { ...next, cancelled: true, cancelDate: t.cancelDate ?? next.cancelDate, revisions: [...(next.revisions ?? []), { at, source, change: `해제 반영${t.cancelDate ? `(해제일 ${t.cancelDate})` : ""}${scopeOf(t) === UNSPECIFIED_SCOPE ? " — 출처 미지정이나 지역·단지와 다른 값이 모두 같아 같은 거래로 판단" : ""}` }] };
      current[i] = next;
    });
    if (changes.length) report.corrected++;
    if (cancelNew) report.cancellationsApplied++;
    if (idx.length > 1) report.storedDuplicatesUpdated += idx.length - 1;
  }
  if (report.idDuplicatesInBatch) report.notes.push(`같은 자료 안에서 같은 출처·ID·같은 내용으로 반복된 ${report.idDuplicatesInBatch}건 — 1건만 보존`);
  if (report.idConflicts) report.notes.push(`거래 ID 충돌 ${report.idConflicts}건 — 병합하지 않고 원본 보존, 확인 필요`);
  if (report.idChangesHeld) report.notes.push(`출처 미지정 ID의 값 변경 ${report.idChangesHeld}건 — 자동 반영 보류, 확인 필요(ID 출처 열을 지정하면 원천 정정으로 반영)`);
  if (report.storedDuplicatesUpdated) report.notes.push(`이미 저장된 같은 ID·같은 내용 사본 ${report.storedDuplicatesUpdated}건에 함께 반영 — ‘거래 진단’에서 정리 가능`);

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
  const newlyAmbiguous = new Set<string>();

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
      if (unspecified) {
        report.cancelUnspecified += cTarget - cNow;
        newlyAmbiguous.add(k); // 묶음 전체 ‘해제 대상 특정 불가’ 표시는 아래 재계산 단계에서 현재 건수 기준으로 기록
      }
    }
    report.duplicates += Math.max(0, matched);
    // 같은 묶음 크기 기록(구별 불가 표시)
    groupRefs.forEach((r) => { const t = r.get(); if (size > 1 || t.sameKeyCount) r.set({ ...t, sameKeyCount: size }); });
    report.added += newOnes.length;
    report.addedCancelled += newOnes.filter((t) => t.cancelled).length;
    added.push(...newOnes);
  }
  // 매 병합 후 동조건 묶음의 해제 불확실성을 현재 거래 수·해제 수로 다시 계산(오래된 표시 정리, 늘어난 묶음의 새 거래 포함)
  {
    const all = [...current, ...added];
    const rc = reconcileCancelAmbiguity(all, at, source, newlyAmbiguous);
    rc.list.forEach((t, i) => { if (i < current.length) current[i] = t; else added[i - current.length] = t; });
    report.ambiguityResolved = rc.resolved;
    report.ambiguityUpdated = rc.updated;
    if (rc.resolved) report.notes.push(`해제 대상 특정 불가 묶음 ${rc.resolved}개 해소 — 묶음 거래가 모두 해제되어 유효 표본 확정`);
    if (rc.updated) report.notes.push(`해제 대상 특정 불가 묶음 ${rc.updated}개의 건수 갱신(묶음 증가 또는 해제 추가) — 새로 합류한 거래도 확정 표본으로 보지 않음`);
  }
  if (report.cancelUnspecified) report.notes.push(`같은 조건 묶음에서 해제 ${report.cancelUnspecified}건 반영 — 어느 거래가 해제됐는지 특정 불가(건수만 대사)`);
  if (report.partialGroups) report.notes.push(`같은 조건 묶음 ${report.partialGroups}개는 기존보다 적게 들어옴 — 부분 자료일 수 있어 기존 거래 유지`);
  if (report.sameKeyGroups) report.notes.push(`같은 조건(단지·면적·층·동·계약일·금액) 거래 묶음 ${report.sameKeyGroups}개 — 구별 불가하므로 건수 단위로 대사`);

  // ── 3) 가격만 다른 거래: 자동 정정하지 않고 확인 필요 표시
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

/**
 * 현재 거래 구성 기준의 해제 불확실 묶음(저장된 {size,cancelled} 값은 쓰지 않음).
 * 불확실 표시가 한 번이라도 있었던 묶음 중 해제 수가 0 < c < 묶음 크기인 것만 반환.
 */
export function liveCancelAmbiguity(list: Transaction[]): Map<string, { size: number; cancelled: number; members: Transaction[] }> {
  const g = new Map<string, Transaction[]>();
  list.forEach((t) => { if (t.idKey && (t.idBasis === "composite" || t.cancelAmbiguity)) g.set(t.idKey, [...(g.get(t.idKey) ?? []), t]); });
  const out = new Map<string, { size: number; cancelled: number; members: Transaction[] }>();
  for (const [k, members] of g) {
    if (!members.some((m) => m.cancelAmbiguity)) continue;
    const c = members.filter((m) => m.cancelled).length;
    if (c > 0 && c < members.length) out.set(k, { size: members.length, cancelled: c, members });
  }
  return out;
}

/**
 * 동조건(복합키) 묶음별로 해제 불확실성 표시를 현재 상태에 맞춘다.
 * - 불확실 묶음: 이전에 불확실 표시가 있었거나 이번에 새로 생긴 묶음 중, 해제 수가 0보다 크고 묶음 크기보다 작은 것
 * - 묶음 전원이 해제(또는 해제 0)면 표시 제거(해소 이력 남김). 거래·사용자 제외·이전 이력은 그대로 둔다.
 * - 묶음이 커지면 새 거래를 포함해 모든 거래에 같은 {size, cancelled}를 기록한다.
 */
export function reconcileCancelAmbiguity(list: Transaction[], at: string, source: string, newlyAmbiguous: Set<string> = new Set()): { list: Transaction[]; resolved: number; updated: number } {
  const out = list.slice();
  const groups = new Map<string, number[]>();
  out.forEach((t, i) => { if (t.idBasis === "composite" && t.idKey) groups.set(t.idKey, [...(groups.get(t.idKey) ?? []), i]); });
  let resolved = 0, updated = 0;
  for (const [k, idx] of groups) {
    const members = idx.map((i) => out[i]);
    const wasAmb = members.some((t) => t.cancelAmbiguity);
    if (!wasAmb && !newlyAmbiguous.has(k)) continue;
    const size = members.length, cancelled = members.filter((t) => t.cancelled).length;
    const amb = cancelled > 0 && cancelled < size;
    if (!amb) {
      if (wasAmb) resolved++;
      idx.forEach((i) => {
        const t = out[i];
        if (!t.cancelAmbiguity) return;
        const { cancelAmbiguity: _old, ...rest } = t;
        out[i] = { ...rest, revisions: [...(t.revisions ?? []), { at, source, change: `해제 대상 특정 불가 해소 — 같은 조건 ${size}건 중 해제 ${cancelled}건(${cancelled === size ? "모두 해제" : "해제 없음"})` }] };
      });
      continue;
    }
    let changed = false;
    idx.forEach((i) => {
      const t = out[i];
      const cur = t.cancelAmbiguity;
      if (cur && cur.size === size && cur.cancelled === cancelled) return;
      changed = true;
      const change = !cur
        ? `해제 대상 특정 불가 묶음에 포함 — 같은 조건 ${size}건 중 해제 ${cancelled}건(이 거래의 해제 여부 확정 불가)`
        : `해제 대상 특정 불가 묶음 갱신 — ${cur.size}건 중 해제 ${cur.cancelled}건 → ${size}건 중 해제 ${cancelled}건`;
      out[i] = { ...t, cancelAmbiguity: { size, cancelled }, revisions: [...(t.revisions ?? []), { at, source, change }] };
    });
    if (changed && wasAmb) updated++;
  }
  return { list: out, resolved, updated };
}

export function mergeReportText(r: MergeReport): string {
  return `받은 ${r.received}건: 신규 ${r.added} · 중복 ${r.duplicates + (r.idDuplicatesInBatch ?? 0)} · 해제 반영 ${r.cancellationsApplied}${r.cancelUnspecified ? `(거래 특정 불가 ${r.cancelUnspecified})` : ""}${r.corrected ? ` · 원천 정정 ${r.corrected}` : ""}${r.idConflicts ? ` · ID 충돌 확인 필요 ${r.idConflicts}` : ""}${r.idChangesHeld ? ` · ID 변경 보류 ${r.idChangesHeld}` : ""}${r.possibleCorrections ? ` · 별도 거래/정정 확인 필요 ${r.possibleCorrections}` : ""}${r.partialGroups ? ` · 부분 자료 묶음 ${r.partialGroups}` : ""}`;
}
