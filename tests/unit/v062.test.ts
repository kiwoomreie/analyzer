import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from '../helpers/observationFixture.ts';
import {newManualRecord} from '../../shared/model.ts';
import {withRun,latestRun} from '../../shared/runs.ts';
import {reportSummary,reportDraft} from '../../shared/report.ts';
import {observeGroups} from '../../shared/observation.ts';
test('같은 입력 재실행은 최신 실행 번호와 스냅샷을 사용',()=>{
 let r=withRun(newManualRecord('lc_same',fixture()),'manual');r=withRun(r,'manual');
 assert.match(reportSummary(r,latestRun(r).result!),/수동 확인 그룹 관측 \(실행 #2 입력 기준/);
 r.working.transactions.forEach(t=>t.complexName='현재 변경 이름');
 assert.match(reportSummary(r,latestRun(r).result!),/영향권\(사용자 확인\): A · 비교군\(사용자 확인\): B/);
});
test('지난 실행의 그룹 이름은 현재 작업본으로 재해석하지 않음',()=>{
 let r=withRun(newManualRecord('lc_past',fixture()),'manual');const old=r.runs[0].result;
 r.working.observation!.impact=[];r=withRun(r,'manual');
 assert.match(reportSummary(r,old),/영향권\(사용자 확인\): A/);
});
test('표본 미산출 보고서에도 계산 한계·신고 지연 안내 유지',()=>{
 const w=fixture();w.asOf='2024-01-01';const rec=withRun(newManualRecord('lc_future',w),'manual');
 assert.match(reportSummary(rec,latestRun(rec).result!),/신고 지연/);
 assert.match(reportDraft(rec,latestRun(rec).result!),/미래 사건/);
});
test('공간 경고에서 잘못된 좌표도 미확인 취급',()=>{
 const w=fixture();w.complexInfo=[{complexKey:w.observation!.impact[0],location:{lat:999,lng:999}},{complexKey:w.observation!.control[0],location:{lat:37,lng:127}}];
 assert.match(observeGroups(w).warnings.join(' '),/좌표 미확인 1개/);
});
test('같은 일정의 종료 경계는 관찰기간 바깥',()=>{
 const w=fixture();w.events[0].milestones.push({key:'end',type:'announcement',status:'actual',date:'2026-01-15',evidenceKeys:[]});
 assert.doesNotMatch(observeGroups(w).warnings.join(' '),/같은 사건의 다른 일정/);
});
test('표본 수치가 같아도 출처 변경은 보고서 재실행 필요로 안내',async()=>{
 const React=(await import('react')).default;
 const moduleName='react-dom/server';const {renderToStaticMarkup}=await import(moduleName);
 const {ObservationPanel}=await import('../../web/sections/ObservationPanel.tsx');
 const rec=withRun(newManualRecord('lc_status',fixture()),'manual');
 rec.working.transactions.forEach(t=>t.source='변경된 출처');
 const html=renderToStaticMarkup(React.createElement(ObservationPanel,{rec,update:()=>{}}));
 assert.match(html,/마지막 분석 실행\(#1\) 결과와 다릅니다/);
 assert.doesNotMatch(html,/같은 값입니다/);
});
test('v0.6.1의 메타데이터 없는 과거 결과도 현재 그룹명으로 대체하지 않음',()=>{
 let rec=withRun(newManualRecord('lc_legacy',fixture()),'manual');
 delete (rec.runs[0].result.groupObservation as any).selectionLabels;
 const old=rec.runs[0].result;rec.working.observation!.impact=[];rec=withRun(rec,'manual');
 assert.match(reportSummary(rec,old),/단지명 당시 정보 미보존/);
});
test('백업 복구 후 같은 입력 재실행의 최신 번호 유지',()=>{
 let rec=withRun(newManualRecord('lc_restored',fixture()),'manual');rec=withRun(rec,'manual');rec=JSON.parse(JSON.stringify(rec));
 assert.match(reportSummary(rec,latestRun(rec).result!),/실행 #2 입력 기준/);
});
