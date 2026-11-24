/** v0.6: descriptive matched-cohort analysis; never a causal or pricing adjustment.
 *  v0.6.1: 선택 단지 소실 경고, 같은 사건 다른 일정 중첩 경고, 상시 안내(notes)와 경고(warnings) 분리, 기준일·단위·출처 정보 */
import { complexKeyOf, DATA_MODE_LABEL, MILESTONE_LABEL, type WorkingInputs, type Transaction } from './model.ts';
import { addMonths, isBefore, parseDateValue } from './dates.ts';
import { availableBy, eventKnownOn, milestoneKnownOn, tradeAvailable, transactionAsOf } from './asOf.ts';
import { computeStats, haversineM } from './analysis.ts';
import { diagnoseTrades, liveCancelAmbiguity } from './tradeMerge.ts';
export interface ObservationOptions {
  anchorBasis?: 'known' | 'actual'; eventKey?: string; milestoneKey?: string; months: 3 | 6 | 12;
  impact: string[]; control: string[];
}
export const defaultObservation = (): ObservationOptions => ({ months: 6, impact: [], control: [] });
export function observationOptions(w: WorkingInputs): ObservationOptions {
  const o = w.observation;
  return { ...(o?.anchorBasis === 'known' ? {anchorBasis: 'known' as const} : {}), eventKey: o?.eventKey, milestoneKey: o?.milestoneKey, months: [3,6,12].includes(o?.months ?? 0) ? o!.months : 6,
    impact: Array.isArray(o?.impact) ? [...new Set(o.impact.filter(x => typeof x === 'string'))] : [],
    control: Array.isArray(o?.control) ? [...new Set(o.control.filter(x => typeof x === 'string'))] : [] };
}
/** 숫자 범위까지 확인한 좌표만 기록 있음으로 표시한다. */
export function validObservationLocation(loc: { lat: number; lng: number } | undefined): boolean {
  return !!loc && Number.isFinite(loc.lat) && Number.isFinite(loc.lng) && Math.abs(loc.lat) <= 90 && Math.abs(loc.lng) <= 180;
}

/** 그룹 관측을 설정했는지(사건·일정 또는 그룹 선택이 하나라도 있음) */
export function observationConfigured(w: WorkingInputs): boolean {
  const o = observationOptions(w);
  return !!(o.eventKey || o.milestoneKey || o.impact.length || o.control.length);
}

/** 화면 표시용 단지 이름(내부 식별키를 그대로 보이지 않음) */
export interface ComplexLabel { name: string; detail: string }
export function labelOfComplexKey(key: string, list: Transaction[] = []): ComplexLabel {
  const t = list.find(x => complexKeyOf(x) === key);
  if (t) return { name: t.complexName, detail: [t.sggCd && `시군구 ${t.sggCd}`, t.dong, t.jibun && `지번 ${t.jibun}`, t.complexId && `단지 ID ${t.complexId}`].filter(Boolean).join(' · ') || '시군구·법정동 미기재' };
  if (key.startsWith('S:')) return { name: `단지 ID ${key.slice(2)}`, detail: '공식 단지 ID' };
  const [name = key, sgg = '', dong = '', jibun = ''] = key.replace(/^N:/, '').split('|');
  return { name, detail: [sgg && `시군구 ${sgg}`, dong, jibun && `지번 ${jibun}`].filter(Boolean).join(' · ') || '시군구·법정동 미기재' };
}

/** 보고서용 단지명: 기본은 "단지명(법정동)", 같은 표기가 다른 단지와 겹치면 시군구·지번·단지 ID까지 붙여 구별 */
export function reportLabelOf(key: string, list: Transaction[]): string {
  const short = (k: string) => { const t = list.find(x => complexKeyOf(x) === k); const l = labelOfComplexKey(k, list); return t ? `${t.complexName}${t.dong ? `(${t.dong})` : ''}` : l.name; };
  const mine = short(key);
  const keys = new Set([...list.map(complexKeyOf), key]);
  const clash = [...keys].some(k => k !== key && short(k) === mine);
  return clash ? `${labelOfComplexKey(key, list).name}(${labelOfComplexKey(key, list).detail})` : mine;
}

/** 선택 단지별 사용·제외 내역(상세 표시용). 계산 결과에는 영향 없음 */
export interface ObservationTrade {
  group: 'impact' | 'control';
  period: '전' | '후';
  name: string;
  date: string;
  area: number;
  priceKrw: number;
  source: string;
}
export const OBSERVATION_EVIDENCE_LIMIT = 40;

export interface ComplexUsage {
  group: 'impact' | 'control'; key: string; label: string; used: boolean;
  pre: number; post: number; strata: number;
  reason?: string;
  /** 이 단지 거래 중 관측에서 뺀 건수(사유별) */
  excluded: Record<string, number>;
}

export interface MissingSelection { group: 'impact' | 'control'; key: string; label: ComplexLabel; similar: { key: string; label: ComplexLabel }[] }
export type ObservationResult = ReturnType<typeof observeGroups>;

export function observationAnchor(w: WorkingInputs) {
  const o = observationOptions(w);
  const ev = w.events.find(e => e.key === o.eventKey);
  const ms = ev?.milestones.find(m => m.key === o.milestoneKey && m.status === 'actual');
  const firstKnown = ev && eventKnownOn(ev, w.evidence);
  const knownBasis = o.anchorBasis === 'known';
  const date = knownBasis ? firstKnown : ms?.date;
  return {ev, ms, firstKnown, knownBasis, date};
}

export function observeGroups(w: WorkingInputs, periods?: {before: number; after: number}) {
  const o = observationOptions(w);
  /** 상황에 따라 나오는 경고(확인이 필요한 것) */
  const warnings: string[] = [];
  /** 항상 적용되는 계산 기준·한계 안내 */
  const notes = ['관측된 변화이며 인과 효과가 아닙니다. 자동 가격 보정·적정가격·예상 상승률을 생성하지 않습니다.',
    '좌표를 확인한 단지만 사용합니다. 영향권은 본건 반경 이내, 수동 대조군은 반경 밖도 선택할 수 있습니다. 직선거리는 보행 접근성이나 실제 영향 범위를 보장하지 않습니다.',
    '신고 지연·취소·정정으로 최근 거래가 달라질 수 있습니다.'];
  const {ev, ms, firstKnown, knownBasis, date} = observationAnchor(w);
  const anchor = parseDateValue(date), asOf = parseDateValue(w.asOf);
  const empty = () => ({ pre: computeStats([]), post: computeStats([]), changePct: null as number | null, complexes: 0, strata: 0 });
  const presentKeys = new Set(w.transactions.map(complexKeyOf));
  const sourcesOf = (list: Transaction[]) => [...new Set(list.map(t => t.source ?? '출처 미기재'))].slice(0, 6);
  const result = { anchor: date ?? '', anchorLabel: knownBasis && ev ? `${ev.name} · 처음 알려진 날` : ev && ms ? `${ev.name} · ${MILESTONE_LABEL[ms.type]}(실제)` : '', start: '', end: '', complete: false, warnings, notes,
    impact: empty(), control: empty(), differencePp: null as number | null,
    monthly: [] as { month: string; impact: number | null; control: number | null; impactN: number; controlN: number }[], overlap: o.impact.filter(k => o.control.includes(k)),
    missingSelections: [] as MissingSelection[],
    // 오래된 실행의 입력 스냅샷이 압축돼도 당시 선택 단지명을 재현한다.
    selectionLabels: Object.fromEntries((['impact', 'control'] as const).map(group => [group, o[group].map(key => reportLabelOf(key, w.transactions))])) as Record<'impact' | 'control', string[]>,
    basis: { asOf: w.asOf, radiusM: w.options.radiusM, firstKnown: availableBy(firstKnown,w.asOf) ? firstKnown : undefined, actualDate: ms && availableBy(milestoneKnownOn(ms,w.evidence),w.asOf) && availableBy(ms.date,w.asOf) ? ms.date : undefined, unit: '만원/전용㎡ · 만원/전용평(1평=400/121㎡)', sources: [] as string[], dataModes: [] as string[],
      area: (w.property.exclusiveAreaM2 && Number.isFinite(w.options.areaBandPct)) ? { m2: w.property.exclusiveAreaM2, bandPct: w.options.areaBandPct, min: w.property.exclusiveAreaM2 * (1 - w.options.areaBandPct / 100), max: w.property.exclusiveAreaM2 * (1 + w.options.areaBandPct / 100) } : null,
      stratumM2: 5, minSample: Math.max(3, w.options.minSample || 3) },
    /** 선택 단지별 사용·제외 내역 */
    usage: [] as ComplexUsage[],
    tradeEvidence: [] as ObservationTrade[],
    /** 비교군 대비 관측 차이를 보여줄 수 있는지(두 그룹 변동률이 모두 산출되고 기준 정보가 유효할 때만) */
    valid: false };
  const stopUsage = (why: string) => {
    for (const group of ['impact', 'control'] as const) for (const key of o[group]) result.usage.push({ group, key, label: reportLabelOf(key, w.transactions), used: false, pre: 0, post: 0, strata: 0, reason: result.overlap.includes(key) ? '영향권·비교군 양쪽에 선택 — 양쪽에서 제외' : !presentKeys.has(key) ? '현재 거래 자료에 없음(식별 정보 변경 또는 거래 삭제)' : `계산 안 함 — ${why}`, excluded: {} });
    return result;
  };
  // 선택했지만 현재 거래 자료에 없는 단지(식별 정보 변경·거래 삭제) — 조용히 0건이 되지 않도록 표시
  for (const group of ['impact', 'control'] as const) for (const key of o[group]) if (!presentKeys.has(key)) {
    const label = labelOfComplexKey(key);
    const similar = [...presentKeys].filter(k => k !== key && labelOfComplexKey(k, w.transactions).name.trim() === label.name.trim()).map(k => ({ key: k, label: labelOfComplexKey(k, w.transactions) }));
    result.missingSelections.push({ group, key, label, similar });
  }
  if (result.missingSelections.length) {
    const sim = result.missingSelections.filter(m => m.similar.length).length;
    warnings.push(`선택했던 단지 ${result.missingSelections.length}개가 현재 거래 자료에 없습니다(단지 식별 정보 변경 또는 거래 삭제) — 계산에서 빠졌습니다.${sim ? ` 같은 이름의 다른 식별 단지 ${sim}건이 있어 확인 후 다시 선택해야 합니다(자동으로 바꾸지 않음).` : ''}`);
  }
  const reports = (w.collections ?? []).filter(c => availableBy(c.at?.slice(0,10), w.asOf));
  const last = reports[0];
  if (!last) warnings.push('데이터 미수집 또는 수집 범위 미확인: 수동·CSV 입력의 완전성을 보장하지 않습니다.');
  else if (last.trades?.status !== 'complete' || last.regionDiscovery?.status !== 'sampled' || last.complexGeocode?.status !== 'complete') warnings.push('부분 수집 또는 좌표·주변 행정구역 확인 미완료.');
  else notes.push('최근 수집 완료 표시만으로 선택 관찰기간·그룹의 전량 수집은 보장되지 않습니다.');
  if (w.transactions.some(t => t.dataMode === 'demo') || ev?.dataMode === 'demo') warnings.push('가상 자료 포함 — 실제 판단에 사용 불가.');
  if (result.overlap.length) warnings.push(`그룹 중복 ${result.overlap.length}개 단지는 양쪽에서 제외했습니다.`);
  const selected = new Set([...o.impact, ...o.control].filter(k => presentKeys.has(k)));
  const unknown = [...selected].filter(k => !validObservationLocation(w.complexInfo.find(c => c.complexKey === k)?.location));
  if (unknown.length) warnings.push(`좌표 미확인 ${unknown.length}개 단지: 관측에서 제외했습니다.`);
  if (!anchor || anchor.precision !== 'day' || !asOf || asOf.precision !== 'day') { warnings.push('기록된 실제 일정과 분석 기준일을 일 단위로 지정해야 합니다. 월만 기록된 날짜에 임의 날짜를 만들지 않습니다.'); return stopUsage('기준 일정 미선택 또는 일 단위 날짜 아님'); }
  if (periods && ![periods.before,periods.after].every(n => Number.isInteger(n) && n > 0 && n < 1200)) {
    warnings.push('비교기간 입력 범위를 확인하세요.'); return stopUsage('비교기간 범위 오류');
  }
  const start = addMonths(anchor, -(periods?.before ?? o.months)), end = addMonths(anchor, periods?.after ?? o.months);
  result.start = start.raw; result.end = end.raw;
  if (isBefore(asOf, anchor)) { warnings.push('미래 사건: 전후 분석을 계산하지 않습니다.'); return stopUsage('기준 일정이 분석 기준일 이후'); }
  // 기준 일정이 분석 기준일 이후에 알려진 것으로 기록된 경우: 기준일 시점 정보가 아니므로 관측 차이를 보여주지 않음
  const known = knownBasis ? firstKnown : ms && milestoneKnownOn(ms, w.evidence);
  if (!availableBy(known, w.asOf)) {
    const why = known ? `기준일 이후(${known})에 알려진 일정이거나 공개 날짜의 정밀도가 부족합니다` : '일정이 처음 알려진 날짜를 확인할 근거가 없습니다';
    warnings.push(why);
    return stopUsage(why);
  }
  if (!validObservationLocation(w.property.coordinates)) { warnings.push('본건 좌표 미확인 · 반경을 확인할 수 없습니다.'); return stopUsage('본건 좌표 미확인'); }
  const lastDay = new Date(Date.UTC(end.y,end.m-1,end.d! - 1)).toISOString().slice(0,10);
  const complete = w.asOf >= lastDay;
  result.complete = complete;
  if (!complete) warnings.push('관찰기간 미완료: 확인된 건수만 표시합니다. 중위가격과 변동률은 전체 기간 확인 후 산출합니다.');
  const inWindow = (date?: string) => { const d = parseDateValue(date); return !!d && isBefore(d, start) !== true && isBefore(d, end) !== false; };
  if (w.events.some(e => e.key !== ev?.key && e.milestones.some(m => availableBy(milestoneKnownOn(m,w.evidence),w.asOf) && inWindow(m.date)))) warnings.push('관찰기간에 겹치는 다른 사건이 기록되어 있습니다. 독립적인 영향을 분리할 수 없습니다.');
  // 같은 사건의 다른 일정(예: 개통 기준인데 관찰기간 안에 착공·발표)도 영향이 섞일 수 있음
  const sameEvent = (ev?.milestones ?? []).filter(m => m.key !== ms?.key && availableBy(milestoneKnownOn(m,w.evidence),w.asOf) && inWindow(m.date));
  if (sameEvent.length) warnings.push(`같은 사건의 다른 일정이 관찰기간에 있습니다(${sameEvent.map(m => `${MILESTONE_LABEL[m.type] ?? m.type} ${m.date}${m.status === 'actual' ? '' : ' 예정'}`).join(', ')}) — 선택 일정만의 변화로 구분할 수 없습니다.`);
  const area = w.property.exclusiveAreaM2, band = w.options.areaBandPct;
  if (!area || !Number.isFinite(area) || area <= 0 || !Number.isFinite(band) || band < 0) { warnings.push('유사 전용면적 비교를 위해 본건 전용면적과 유효한 면적 범위가 필요합니다.'); return stopUsage('본건 전용면적 미입력'); }
  const available = w.transactions.filter(t => tradeAvailable(t,w.asOf)).map(t => transactionAsOf(t,w.asOf));
  const diag = diagnoseTrades(available);
  const excluded = new Set([...diag.identicalGroups.flatMap(g => g.keys.slice(1)), ...diag.conflictGroups.flatMap(g => g.keys)]);
  for (const g of liveCancelAmbiguity(available).values()) if (new Set(g.members.map(t => t.manualExclusion ?? '')).size > 1) g.members.forEach(t => excluded.add(t.key));
  const valid = available.filter(t => {
    const d = parseDateValue(t.contractDate);
    return d?.precision === 'day' && !excluded.has(t.key) && !t.cancelled && !t.manualExclusion && !t.reviewFlag &&
      Number.isFinite(t.priceKrw) && t.priceKrw > 0 && Number.isFinite(t.exclusiveAreaM2) && t.exclusiveAreaM2 > 0 &&
      Math.abs(t.exclusiveAreaM2 / area - 1) <= band / 100 && isBefore(d,start) !== true && isBefore(d,end) === true && isBefore(asOf,d) !== true;
  });
  const unavailable = w.transactions.filter(t => selected.has(complexKeyOf(t)) && !tradeAvailable(t,w.asOf)).length;
  if (unavailable) warnings.push(`자료 공개일 미확인 또는 분석 기준일 이후인 거래 ${unavailable}건 제외`);
  notes.push('일 단위 계약만 사용; 해제·사용자 제외·ID 사본/충돌·정정 확인 필요·해제 대상과 사용자 제외가 겹친 불확실 묶음은 제외합니다.');
  notes.push('단지 × 전용면적 5㎡ 구간([0,5), [5,10)…), 본건 면적 허용범위 안에서 양기간 거래가 있는 구간만 사용합니다. 기간별 거래 가중 중위값으로 구성비 변화가 남을 수 있습니다.');
  const spatialReasons = new Map<string,string>();
  for (const group of ['impact','control'] as const) for (const key of o[group]) {
    const info = w.complexInfo.find(c => c.complexKey === key);
    if (!validObservationLocation(info?.location)) spatialReasons.set(group + key, '단지 좌표 미확인');
    else if (info?.userDecision === 'exclude') spatialReasons.set(group + key, '사용자가 제외한 단지');
    else if (group === 'impact' && haversineM(w.property.coordinates!,info!.location!) > w.options.radiusM) spatialReasons.set(group + key, '본건 반경 밖');
  }
  const cohorts: Record<string, Transaction[]> = {};
  for (const group of ['impact','control'] as const) {
    const keys = new Set(o[group].filter(k => !result.overlap.includes(k) && !spatialReasons.has(group + k)));
    const candidates = valid.filter(t => keys.has(complexKeyOf(t)));
    const stratum = (t: Transaction) => `${complexKeyOf(t)}|area:${Math.floor(t.exclusiveAreaM2 / 5)}`;
    const pre = new Set(candidates.filter(t => t.contractDate < anchor.raw).map(stratum));
    const post = new Set(candidates.filter(t => t.contractDate >= anchor.raw).map(stratum));
    const rows = candidates.filter(t => pre.has(stratum(t)) && post.has(stratum(t)));
    cohorts[group] = rows;
    for (const period of ['전','후'] as const) {
      const sample = rows.filter(t => (t.contractDate < anchor.raw) === (period === '전'))
        .sort((a,b) => b.contractDate.localeCompare(a.contractDate) || a.key.localeCompare(b.key))
        .slice(0, OBSERVATION_EVIDENCE_LIMIT);
      for (const t of sample) result.tradeEvidence.push({group, period, name:t.complexName, date:t.contractDate,
        area:t.exclusiveAreaM2, priceKrw:t.priceKrw, source:t.source ?? DATA_MODE_LABEL[t.dataMode]});
    }
    const stats = (tx: Transaction[]) => computeStats(tx.map(t => ({perM2: t.priceKrw / t.exclusiveAreaM2, complex: complexKeyOf(t)})));
    const a = stats(rows.filter(t => t.contractDate < anchor.raw)), b = stats(rows.filter(t => t.contractDate >= anchor.raw));
    const enough = a.count >= Math.max(3, w.options.minSample || 3) && b.count >= Math.max(3, w.options.minSample || 3);
    // 공식 응답이 대상 지역·월을 모두 포함해야 해당 그룹의 통계를 제시한다.
    const official = available.filter(t => keys.has(complexKeyOf(t)) && t.dataMode === 'official-api');
    const regions = new Set(official.map(t => t.sggCd));
    let missing = false;
    for (let month = start.raw.slice(0,7); month <= end.raw.slice(0,7); month = addMonths(parseDateValue(month)!,1).raw) {
      if (month + '-01' >= end.raw) break;
      for (const region of regions) {
        const entry = reports.flatMap(c => c.months).find(m => m.lawdCode === region && m.yearMonth === month.replace('-',''));
        if (!entry?.ok) missing = true;
      }
    }
    if (missing) warnings.push(`${group === 'impact' ? '영향권' : '비교군'} 거래 누락 가능 · 관찰기간 시군구·월별 전 페이지 대사 미확인`);
    if (!enough) warnings.push(`${group === 'impact' ? '영향권' : '비교군'} 표본 부족: 양기간 각각 최소 ${Math.max(3,w.options.minSample || 3)}건 필요, 변동률 미산출.`);
    const mixed = rows.some(t => t.dataMode === 'demo') && rows.some(t => t.dataMode !== 'demo');
    if (mixed) warnings.push(`${group === 'impact' ? '영향권' : '비교군'}에 가상·일반 거래가 혼합되어 단가 비교를 보류합니다.`);
    const publish = complete && enough && !missing && !mixed;
    const withheld = (s: typeof a) => ({...computeStats([]), count: s.count, complexes: s.complexes});
    result[group] = {pre:publish ? a : withheld(a), post:publish ? b : withheld(b), changePct: publish && a.medianPerM2 ? (b.medianPerM2! / a.medianPerM2 - 1)*100 : null, complexes: new Set(rows.map(complexKeyOf)).size, strata: new Set(rows.map(stratum)).size};
  }
  if (result.impact.changePct !== null && result.control.changePct !== null) {
    const demo = [...cohorts.impact,...cohorts.control].map(t => t.dataMode === 'demo');
    if (demo.includes(true) && demo.includes(false)) warnings.push('가상 표본과 일반 거래가 섞여 비교군 대비 차이를 산출하지 않습니다.');
    else result.differencePp = result.impact.changePct - result.control.changePct;
  }
  result.valid = result.differencePp !== null;
  // 단지별 사용·제외 내역(표시용)
  const validKeys = new Set(valid.map(t => t.key));
  const whyOut = (t: Transaction): string => {
    const d = parseDateValue(t.contractDate);
    if (!tradeAvailable(t,w.asOf)) return '자료 공개일 미확인 또는 분석 기준일 이후';
    if (t.cancelled) return '해제';
    if (t.manualExclusion) return '사용자 제외';
    if (excluded.has(t.key)) return 'ID 사본·충돌 또는 해제 대상 불확실';
    if (t.reviewFlag) return '정정 확인 필요';
    if (d?.precision !== 'day') return '계약일이 일 단위 아님';
    if (!(t.priceKrw > 0) || !(t.exclusiveAreaM2 > 0)) return '금액·면적 미입력';
    if (Math.abs(t.exclusiveAreaM2 / area - 1) > band / 100) return '면적 범위 밖';
    if (isBefore(asOf, d) === true) return '분석 기준일 이후 계약';
    return '관찰기간 밖';
  };
  const stratumOf = (t: Transaction) => `${complexKeyOf(t)}|area:${Math.floor(t.exclusiveAreaM2 / 5)}`;
  for (const group of ['impact', 'control'] as const) for (const key of o[group]) {
    const label = reportLabelOf(key, w.transactions);
    if (result.overlap.includes(key)) { result.usage.push({ group, key, label, used: false, pre: 0, post: 0, strata: 0, reason: '영향권·비교군 양쪽에 선택 — 양쪽에서 제외', excluded: {} }); continue; }
    if (!presentKeys.has(key)) { result.usage.push({ group, key, label, used: false, pre: 0, post: 0, strata: 0, reason: '현재 거래 자료에 없음(식별 정보 변경 또는 거래 삭제)', excluded: {} }); continue; }
    const spatial = spatialReasons.get(group + key);
    if (spatial) { result.usage.push({group,key,label,used:false,pre:0,post:0,strata:0,reason:spatial,excluded:{}}); continue; }
    const mine = w.transactions.filter(t => complexKeyOf(t) === key);
    const excludedCounts: Record<string, number> = {};
    for (const t of mine) if (!validKeys.has(t.key)) { const r = whyOut(t); excludedCounts[r] = (excludedCounts[r] ?? 0) + 1; }
    const used = cohorts[group].filter(t => complexKeyOf(t) === key);
    const validMine = mine.filter(t => validKeys.has(t.key));
    const pre = used.filter(t => t.contractDate < anchor.raw).length, post = used.length - pre;
    const unpaired = validMine.length - used.length;
    if (unpaired > 0) excludedCounts['전·후 한쪽에만 있는 면적구간'] = unpaired;
    result.usage.push({ group, key, label, used: used.length > 0, pre, post, strata: new Set(used.map(stratumOf)).size, excluded: excludedCounts,
      reason: used.length ? undefined : validMine.length ? '전·후 양쪽에 같은 전용면적 구간(5㎡) 거래 없음' : '관찰기간·면적 범위 안 유효 거래 없음' });
  }
  const used = [...cohorts.impact, ...cohorts.control];
  result.basis.sources = sourcesOf(used);
  result.basis.dataModes = [...new Set(used.map(t => DATA_MODE_LABEL[t.dataMode] ?? t.dataMode))];
  for (let month = start.raw.slice(0,7); month <= end.raw.slice(0,7); month = addMonths(parseDateValue(month)!,1).raw) {
    const row = (g: string) => { const tx = cohorts[g].filter(t => t.contractDate.startsWith(month)); return computeStats(tx.map(t => ({perM2:t.priceKrw/t.exclusiveAreaM2,complex:complexKeyOf(t)}))); };
    const a=row('impact'), b=row('control');
    result.monthly.push({month,impact:result.impact.changePct !== null && a.count >= result.basis.minSample ? a.medianPerM2 : null,control:result.control.changePct !== null && b.count >= result.basis.minSample ? b.medianPerM2 : null,impactN:a.count,controlN:b.count});
  }
  return result;
}
