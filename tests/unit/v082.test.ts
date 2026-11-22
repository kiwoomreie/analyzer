import {test} from 'node:test';
import assert from 'node:assert/strict';
import {demoWorking} from '../../shared/demo.ts';
import {newManualRecord} from '../../shared/model.ts';
import {withRun} from '../../shared/runs.ts';
import {reportSummary} from '../../shared/report.ts';
import {makeBackup,restoreBackup} from '../../shared/importers.ts';

test('구버전 최신 입력은 재실행으로 압축되기 전에 당시 맥락·근거로 보존',()=>{
 let rec=withRun(newManualRecord('lc_upgrade',demoWorking()),'manual');
 delete rec.runs[0].result.reportContext; delete rec.runs[0].result.citations;
 const original=JSON.stringify(rec);const title=rec.working.property.displayName;
 rec={...rec,working:structuredClone(rec.working)};rec.working.property.displayName='현재 제목';rec.working.evidence=[];
 const saved=withRun(rec,'manual');assert.ok(saved.runs[0].result.reportContext);
 assert.equal(saved.runs[0].result.reportContext!.displayName,title);
 assert.ok(saved.runs[0].result.citations?.items.some(c=>c.kind==='event'&&c.documents?.length));
 assert.equal(rec.runs[0].result.reportContext,undefined,'입력 기록 자체를 변이하지 않음');
 assert.equal(saved.runs[0].input,undefined);
 const restored=restoreBackup(JSON.parse(JSON.stringify(makeBackup([saved],'2026-11-23T00:00:00Z'))));
 assert.equal(restored.type,'backup');if(restored.type==='backup')assert.equal(reportSummary(restored.records[0],restored.records[0].runs[0].result),reportSummary(saved,saved.runs[0].result));
 assert.ok(original.length);
});

test('과거 결과에 입력 금액이 남아 있고 면적만 없으면 미입력으로 오표시하지 않음',()=>{
 const w=demoWorking();w.property.exclusiveAreaM2=undefined;
 let rec=withRun(newManualRecord('lc_price',w),'manual');
 delete rec.runs[0].result.reportContext;delete rec.runs[0].input;
 const r=rec.runs[0].result;assert.equal(r.price.reviewPerM2,null);assert.notEqual(r.price.reviewText,'미입력');
 const md=reportSummary(rec,r);assert.doesNotMatch(md,/- 검토가격: 미입력/);assert.ok(md.includes(r.price.reviewText));
});
import {reportFileTitle,MAX_DATALOG} from '../../shared/runContext.ts';
import {analysisStep} from '../../shared/viewState.ts';
test('구버전 최신 실행의 파일명은 현재 제목 대신 당시 입력 제목 사용',()=>{
 const rec=withRun(newManualRecord('lc_title',demoWorking()),'manual');delete rec.runs[0].result.reportContext;
 const expected=rec.working.property.displayName||rec.working.property.address;
 rec.title='현재 제목';assert.equal(reportFileTitle(rec,rec.runs[0].result),expected);
 delete rec.runs[0].input;assert.equal(reportFileTitle(rec,rec.runs[0].result),'실행');
});
test('손상된 저장 단계와 소수는 첫 단계로 복구',()=>{
 for(const v of [null,undefined,'', 'bad','99',-1,0,1.5,'2.5',Infinity,{},true])assert.equal(analysisStep(v),1);
 for(const v of [1,2,3,4]){assert.equal(analysisStep(v),v);assert.equal(analysisStep(String(v)),v);}
});
test('조회 기록 상한을 적용하되 보고서에 생략 사실 명시',()=>{
 const w=demoWorking();w.dataLog=Array.from({length:MAX_DATALOG+5},(_,i)=>({at:'2026-11-01',source:'가상',detail:String(i)}));
 const rec=withRun(newManualRecord('lc_log',w),'manual');const r=rec.runs[0].result;
 assert.equal(r.reportContext!.dataLog.length,MAX_DATALOG);assert.match(reportSummary(rec,r),/전체 35건 중 최근 30건 보존/);
});
test('입력 스냅샷이 없거나 해시가 다르면 과거 맥락을 추정하지 않음',()=>{
 const rec=withRun(newManualRecord('lc_mismatch',demoWorking()),'manual');delete rec.runs[0].result.reportContext;delete rec.runs[0].result.citations;
 rec.runs[0].input!.property.address='손상된 입력';const next=withRun(rec,'manual');assert.equal(next.runs[0].result.reportContext,undefined);assert.equal(next.runs[0].result.citations,undefined);
 delete rec.runs[0].input;assert.equal(withRun(rec,'manual').runs[0].result.reportContext,undefined);
});
test('기존 보존본·계산값은 업그레이드 보완으로 변경하지 않음',()=>{
 const rec=withRun(newManualRecord('lc_keep',demoWorking()),'manual');const original=JSON.stringify(rec.runs[0].result);
 assert.equal(JSON.stringify(withRun(rec,'manual').runs[0].result),original);
});
