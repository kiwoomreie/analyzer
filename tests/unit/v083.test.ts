import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from '../helpers/observationFixture.ts';
import {observeGroups} from '../../shared/observation.ts';
import {fmtExclusivePyeong} from '../../shared/units.ts';
import {transactionsFromCsv} from '../../shared/importers.ts';
import {newManualRecord} from '../../shared/model.ts';
import {withRun} from '../../shared/runs.ts';
import {reportSummary} from '../../shared/report.ts';

test('3건씩 매칭한 전용평당 중위 · ID 사본과 해제 거래 제외',()=>{
  const w=fixture(), first=w.transactions[0];
  first.officialId='1'; first.idScope='mock';
  w.transactions.push({...first,key:'copy'},{...first,key:'cancel',officialId:'2',cancelled:true,priceKrw:1});
  const {impact}=observeGroups(w);
  assert.deepEqual([impact.pre.count,impact.post.count],[3,3]);
  assert.equal(fmtExclusivePyeong(impact.pre.medianPerM2),'330.6만원');
  assert.equal(fmtExclusivePyeong(impact.post.medianPerM2),'396.7만원');
  assert.ok(Math.abs(impact.changePct!-20)<1e-9);
});

test('표본 부족·좌표 미확인·반경 밖이면 전후 가격을 보류',()=>{
  const w=fixture();
  w.transactions.shift();
  const {impact}=observeGroups(w);
  assert.equal(impact.pre.count,2);
  assert.equal(impact.pre.medianPerM2,null);
  assert.equal(impact.changePct,null);
  w.complexInfo[0].location=undefined;
  assert.match(observeGroups(w).usage[0].reason!,/좌표 미확인/);
  w.complexInfo[0].location={lat:37,lng:128};
  assert.match(observeGroups(w).usage[0].reason!,/반경 밖/);
});

test('사건 공개일과 실제 발생일을 구분하고 후발 거래·일정·문서는 근거에서도 제외',()=>{
  const w=fixture(), e=w.events[0], ms=e.milestones[0];
  e.milestones.push({...ms,key:'announce',type:'announcement',date:'2025-04-01',announcedOn:'2025-04-01'});
  w.observation!.anchorBasis='known';
  assert.equal(observeGroups(w).anchor,'2025-04-01');
  w.observation!.anchorBasis='actual';
  assert.equal(observeGroups(w).anchor,'2025-07-15');
  w.transactions[0].knownOn='2026-12-01';
  assert.equal(observeGroups(w).impact.pre.count,2);
  ms.announcedOn='2026-12-01';
  w.evidence=[{key:'late',publisher:'가상',title:'늦게 나온 문서',fact:'사후 사실',publishedOn:'2026-12-01',status:'confirmed',dataMode:'demo',linked:[e.key]}];
  e.evidenceKeys=['late'];
  const rec=withRun(newManualRecord('lc_past',w),'manual'),r=rec.runs[0].result;
  assert.equal(r.groupObservation!.impact.pre.count,0);
  assert.equal(r.groupObservation!.differencePp,null);
  assert.doesNotMatch(reportSummary(rec,r),/늦게 나온 문서|사후 사실/);
  assert.equal(r.events[0].timeline.length,1);
});

test('공식 거래가 있어도 시군구·월 대사 기록이 없으면 수치 대신 누락 사유',()=>{
  const w=fixture();
  w.transactions.forEach(t=>{t.dataMode='official-api';t.knownOn=t.contractDate;});
  const r=observeGroups(w);
  assert.equal(r.impact.pre.count,3);
  assert.equal(r.impact.pre.medianPerM2,null);
  assert.equal(r.impact.changePct,null);
  assert.match(r.warnings.join(' '),/거래 누락/);
});

test('공급평당으로 표시한 CSV를 세대 거래금액으로 해석하지 않음',()=>{
  const r=transactionsFromCsv('단지명,전용면적,거래금액(만원),계약일,가격기준\n가상,84,3000,2025-06-01,공급평당');
  assert.equal(r.ok,false);
  assert.match(r.errors[0],/가격 기준 불일치/);
});
