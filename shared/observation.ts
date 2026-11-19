/** v0.6: descriptive matched-cohort analysis; never a causal or pricing adjustment.
 *  v0.6.1: 선택 단지 소실 경고, 같은 사건 다른 일정 중첩 경고, 상시 안내(notes)와 경고(warnings) 분리, 기준일·단위·출처 정보 */
import { complexKeyOf, DATA_MODE_LABEL, MILESTONE_LABEL, type WorkingInputs, type Transaction } from './model.ts';
import { addMonths, isBefore, parseDateValue } from './dates.ts';
import { computeStats } from './analysis.ts';
import { diagnoseTrades, liveCancelAmbiguity } from './tradeMerge.ts';
export interface ObservationOptions {
  eventKey?: string; milestoneKey?: string; months: 3 | 6 | 12;
  impact: string[]; control: string[];
}
export const defaultObservation = (): ObservationOptions => ({ months: 6, impact: [], control: [] });
export function observationOptions(w: WorkingInputs): ObservationOptions {
  const o = w.observation;
  return { eventKey: o?.eventKey, milestoneKey: o?.milestoneKey, months: [3,6,12].includes(o?.months ?? 0) ? o!.months : 6,
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

export interface MissingSelection { group: 'impact' | 'control'; key: string; label: ComplexLabel; similar: { key: string; label: ComplexLabel }[] }
export type ObservationResult = ReturnType<typeof observeGroups>;

export function observeGroups(w: WorkingInputs) {
  const o = observationOptions(w);
  /** 상황에 따라 나오는 경고(확인이 필요한 것) */
  const warnings: string[] = [];
  /** 항상 적용되는 계산 기준·한계 안내 */
  const notes = ['관측된 변화이며 인과 효과가 아닙니다. 자동 가격 보정·적정가격·예상 상승률을 생성하지 않습니다.',
    '수동 확인 그룹입니다. 좌표·공간적 비교 가능성은 자동 검증하지 않습니다. 직선거리는 보행 접근성이나 실제 영향 범위를 보장하지 않습니다.',
    '신고 지연·취소·정정으로 최근 거래가 달라질 수 있습니다.'];
  const ev = w.events.find(e => e.key === o.eventKey);
  const ms = ev?.milestones.find(m => m.key === o.milestoneKey && m.status === 'actual');
  const anchor = parseDateValue(ms?.date), asOf = parseDateValue(w.asOf);
  const empty = () => ({ pre: computeStats([]), post: computeStats([]), changePct: null as number | null, complexes: 0, strata: 0 });
  const presentKeys = new Set(w.transactions.map(complexKeyOf));
  const sourcesOf = (list: Transaction[]) => [...new Set(list.map(t => t.source ?? '출처 미기재'))].slice(0, 6);
  const result = { anchor: ms?.date ?? '', anchorLabel: ev && ms ? `${ev.name} · ${MILESTONE_LABEL[ms.type]}(실제)` : '', start: '', end: '', complete: false, warnings, notes,
    impact: empty(), control: empty(), differencePp: null as number | null,
    monthly: [] as { month: string; impact: number | null; control: number | null; impactN: number; controlN: number }[], overlap: o.impact.filter(k => o.control.includes(k)),
    missingSelections: [] as MissingSelection[],
    // 오래된 실행의 입력 스냅샷이 압축돼도 당시 선택 단지명을 재현한다.
    selectionLabels: Object.fromEntries((['impact', 'control'] as const).map(group => [group, o[group].map(key => {
      const t = w.transactions.find(t => complexKeyOf(t) === key);
      return t ? `${t.complexName}${t.dong ? `(${t.dong})` : ''}` : labelOfComplexKey(key).name;
    })])) as Record<'impact' | 'control', string[]>,
    basis: { asOf: w.asOf, unit: '만원/전용㎡(원 단위 계산)', sources: [] as string[], dataModes: [] as string[] } };
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
  const last = w.collections?.[0];
  if (!last) warnings.push('데이터 미수집 또는 수집 범위 미확인: 수동·CSV 입력의 완전성을 보장하지 않습니다.');
  else if (last.trades?.status !== 'complete' || last.regionDiscovery?.status !== 'sampled' || last.complexGeocode?.status !== 'complete') warnings.push('부분 수집 또는 좌표·주변 행정구역 확인 미완료.');
  else notes.push('최근 수집 완료 표시만으로 선택 관찰기간·그룹의 전량 수집은 보장되지 않습니다.');
  if (w.transactions.some(t => t.dataMode === 'demo') || ev?.dataMode === 'demo') warnings.push('가상 자료 포함 — 실제 판단에 사용 불가.');
  if (result.overlap.length) warnings.push(`그룹 중복 ${result.overlap.length}개 단지는 양쪽에서 제외했습니다.`);
  const selected = new Set([...o.impact, ...o.control].filter(k => presentKeys.has(k)));
  const unknown = [...selected].filter(k => !validObservationLocation(w.complexInfo.find(c => c.complexKey === k)?.location));
  if (unknown.length) warnings.push(`좌표 미확인 ${unknown.length}개 단지: 수동 확인의 공간적 타당성을 재확인하십시오.`);
  if (!anchor || anchor.precision !== 'day' || !asOf || asOf.precision !== 'day') { warnings.push('기록된 실제 일정과 분석 기준일을 일 단위로 지정해야 합니다. 월만 기록된 날짜에 임의 날짜를 만들지 않습니다.'); return result; }
  const start = addMonths(anchor, -o.months), end = addMonths(anchor, o.months);
  result.start = start.raw; result.end = end.raw;
  if (isBefore(asOf, anchor)) { warnings.push('미래 사건: 전후 분석을 계산하지 않습니다.'); return result; }
  const complete = isBefore(asOf, end) !== true;
  result.complete = complete;
  if (!complete) warnings.push('관찰기간 미완료: 현재까지의 표본·중위값만 표시하고 변동률·차이는 계산하지 않습니다.');
  const inWindow = (date?: string) => { const d = parseDateValue(date); return !!d && isBefore(d, start) !== true && isBefore(d, end) !== false; };
  if (w.events.some(e => e.key !== ev?.key && e.milestones.some(m => inWindow(m.date)))) warnings.push('관찰기간에 겹치는 다른 사건이 기록되어 있습니다. 독립적인 영향을 분리할 수 없습니다.');
  // 같은 사건의 다른 일정(예: 개통 기준인데 관찰기간 안에 착공·발표)도 영향이 섞일 수 있음
  const sameEvent = (ev?.milestones ?? []).filter(m => m.key !== ms!.key && inWindow(m.date));
  if (sameEvent.length) warnings.push(`같은 사건의 다른 일정이 관찰기간에 있습니다(${sameEvent.map(m => `${MILESTONE_LABEL[m.type] ?? m.type} ${m.date}${m.status === 'actual' ? '' : ' 예정'}`).join(', ')}) — 선택 일정만의 변화로 구분할 수 없습니다.`);
  const area = w.property.exclusiveAreaM2, band = w.options.areaBandPct;
  if (!area || !Number.isFinite(area) || area <= 0 || !Number.isFinite(band) || band < 0) { warnings.push('유사 전용면적 비교를 위해 본건 전용면적과 유효한 면적 범위가 필요합니다.'); return result; }
  const diag = diagnoseTrades(w.transactions);
  const excluded = new Set([...diag.identicalGroups.flatMap(g => g.keys.slice(1)), ...diag.conflictGroups.flatMap(g => g.keys)]);
  for (const g of liveCancelAmbiguity(w.transactions).values()) if (new Set(g.members.map(t => t.manualExclusion ?? '')).size > 1) g.members.forEach(t => excluded.add(t.key));
  const valid = w.transactions.filter(t => {
    const d = parseDateValue(t.contractDate);
    return d?.precision === 'day' && !excluded.has(t.key) && !t.cancelled && !t.manualExclusion && !t.reviewFlag &&
      Number.isFinite(t.priceKrw) && t.priceKrw > 0 && Number.isFinite(t.exclusiveAreaM2) && t.exclusiveAreaM2 > 0 &&
      Math.abs(t.exclusiveAreaM2 / area - 1) <= band / 100 && isBefore(d,start) !== true && isBefore(d,end) === true && isBefore(asOf,d) !== true;
  });
  notes.push('일 단위 계약만 사용; 해제·사용자 제외·ID 사본/충돌·정정 확인 필요·해제 대상과 사용자 제외가 겹친 불확실 묶음은 제외합니다.');
  notes.push('단지 × 전용면적 5㎡ 구간([0,5), [5,10)…), 본건 면적 허용범위 안에서 양기간 거래가 있는 구간만 사용합니다. 기간별 거래 가중 중위값으로 구성비 변화가 남을 수 있습니다.');
  const cohorts: Record<string, Transaction[]> = {};
  for (const group of ['impact','control'] as const) {
    const keys = new Set(o[group].filter(k => !result.overlap.includes(k)));
    const candidates = valid.filter(t => keys.has(complexKeyOf(t)));
    const stratum = (t: Transaction) => `${complexKeyOf(t)}|area:${Math.floor(t.exclusiveAreaM2 / 5)}`;
    const pre = new Set(candidates.filter(t => t.contractDate < anchor.raw).map(stratum));
    const post = new Set(candidates.filter(t => t.contractDate >= anchor.raw).map(stratum));
    const rows = candidates.filter(t => pre.has(stratum(t)) && post.has(stratum(t)));
    cohorts[group] = rows;
    const stats = (tx: Transaction[]) => computeStats(tx.map(t => ({perM2: t.priceKrw / t.exclusiveAreaM2, complex: complexKeyOf(t)})));
    const a = stats(rows.filter(t => t.contractDate < anchor.raw)), b = stats(rows.filter(t => t.contractDate >= anchor.raw));
    const enough = a.count >= Math.max(3, w.options.minSample || 3) && b.count >= Math.max(3, w.options.minSample || 3);
    if (!enough) warnings.push(`${group === 'impact' ? '영향권' : '비교군'} 표본 부족: 양기간 각각 최소 ${Math.max(3,w.options.minSample || 3)}건 필요, 변동률 미산출.`);
    result[group] = {pre:a, post:b, changePct: complete && enough && a.medianPerM2 ? (b.medianPerM2! / a.medianPerM2 - 1)*100 : null, complexes: new Set(rows.map(complexKeyOf)).size, strata: new Set(rows.map(stratum)).size};
  }
  if (result.impact.changePct !== null && result.control.changePct !== null) result.differencePp = result.impact.changePct - result.control.changePct;
  const used = [...cohorts.impact, ...cohorts.control];
  result.basis.sources = sourcesOf(used);
  result.basis.dataModes = [...new Set(used.map(t => DATA_MODE_LABEL[t.dataMode] ?? t.dataMode))];
  for (let month = start.raw.slice(0,7); month <= end.raw.slice(0,7); month = addMonths(parseDateValue(month)!,1).raw) {
    const row = (g: string) => { const tx = cohorts[g].filter(t => t.contractDate.startsWith(month)); return computeStats(tx.map(t => ({perM2:t.priceKrw/t.exclusiveAreaM2,complex:complexKeyOf(t)}))); };
    const a=row('impact'), b=row('control');
    result.monthly.push({month,impact:a.medianPerM2,control:b.medianPerM2,impactN:a.count,controlN:b.count});
  }
  return result;
}
