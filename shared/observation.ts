/** v0.6: descriptive matched-cohort analysis; never a causal or pricing adjustment. */
import { complexKeyOf, type WorkingInputs, type Transaction } from './model.ts';
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
export function observeGroups(w: WorkingInputs) {
  const o = observationOptions(w);
  const warnings = ['관측된 변화이며 인과 효과가 아닙니다. 자동 가격 보정·적정가격·예상 상승률을 생성하지 않습니다.',
    '수동 확인 그룹입니다. 좌표·공간적 비교 가능성은 자동 검증하지 않습니다. 직선거리는 보행 접근성이나 실제 영향 범위를 보장하지 않습니다.',
    '신고 지연·취소·정정으로 최근 거래가 달라질 수 있습니다.'];
  const ev = w.events.find(e => e.key === o.eventKey);
  const ms = ev?.milestones.find(m => m.key === o.milestoneKey && m.status === 'actual');
  const anchor = parseDateValue(ms?.date), asOf = parseDateValue(w.asOf);
  const empty = () => ({ pre: computeStats([]), post: computeStats([]), changePct: null as number | null, complexes: 0, strata: 0 });
  const result = { anchor: ms?.date ?? '', start: '', end: '', warnings, impact: empty(), control: empty(), differencePp: null as number | null,
    monthly: [] as { month: string; impact: number | null; control: number | null; impactN: number; controlN: number }[], overlap: o.impact.filter(k => o.control.includes(k)) };
  const last = w.collections?.[0];
  if (!last) warnings.push('데이터 미수집 또는 수집 범위 미확인: 수동·CSV 입력의 완전성을 보장하지 않습니다.');
  else if (last.trades?.status !== 'complete' || last.regionDiscovery?.status !== 'sampled' || last.complexGeocode?.status !== 'complete') warnings.push('부분 수집 또는 좌표·주변 행정구역 확인 미완료.');
  else warnings.push('최근 수집 완료 표시만으로 선택 관찰기간·그룹의 전량 수집은 보장되지 않습니다.');
  if (w.transactions.some(t => t.dataMode === 'demo') || ev?.dataMode === 'demo') warnings.push('가상 자료 포함 — 실제 판단에 사용 불가.');
  if (result.overlap.length) warnings.push(`그룹 중복 ${result.overlap.length}개 단지는 양쪽에서 제외했습니다.`);
  const selected = new Set([...o.impact, ...o.control]);
  const unknown = [...selected].filter(k => !w.complexInfo.find(c => c.complexKey === k)?.location);
  if (unknown.length) warnings.push(`좌표 미확인 ${unknown.length}개 단지: 수동 확인의 공간적 타당성을 재확인하십시오.`);
  if (!anchor || anchor.precision !== 'day' || !asOf || asOf.precision !== 'day') { warnings.push('기록된 실제 일정과 분석 기준일을 일 단위로 지정해야 합니다. 월만 기록된 날짜에 임의 날짜를 만들지 않습니다.'); return result; }
  const start = addMonths(anchor, -o.months), end = addMonths(anchor, o.months);
  result.start = start.raw; result.end = end.raw;
  if (isBefore(asOf, anchor)) { warnings.push('미래 사건: 전후 분석을 계산하지 않습니다.'); return result; }
  const complete = isBefore(asOf, end) !== true;
  if (!complete) warnings.push('관찰기간 미완료: 현재까지의 표본·중위값만 표시하고 변동률·차이는 계산하지 않습니다.');
  if (w.events.some(e => e.key !== ev?.key && e.milestones.some(m => { const d = parseDateValue(m.date); return d && isBefore(d,start) !== true && isBefore(end,d) !== true; }))) warnings.push('관찰기간에 겹치는 다른 사건이 기록되어 있습니다. 독립적인 영향을 분리할 수 없습니다.');
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
  warnings.push('일 단위 계약만 사용; 해제·사용자 제외·ID 사본/충돌·정정 확인 필요·해제 대상과 사용자 제외가 겹친 불확실 묶음은 제외합니다.');
  warnings.push('단지 × 전용면적 5㎡ 구간([0,5), [5,10)…), 본건 면적 허용범위 안에서 양기간 거래가 있는 구간만 사용합니다. 기간별 거래 가중 중위값으로 구성비 변화가 남을 수 있습니다.');
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
  for (let month = start.raw.slice(0,7); month <= end.raw.slice(0,7); month = addMonths(parseDateValue(month)!,1).raw) {
    const row = (g: string) => { const tx = cohorts[g].filter(t => t.contractDate.startsWith(month)); return computeStats(tx.map(t => ({perM2:t.priceKrw/t.exclusiveAreaM2,complex:complexKeyOf(t)}))); };
    const a=row('impact'), b=row('control');
    result.monthly.push({month,impact:a.medianPerM2,control:b.medianPerM2,impactN:a.count,controlN:b.count});
  }
  return result;
}
