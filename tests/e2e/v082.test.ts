// v0.8.2: 구버전 최신 스냅샷 보존·손상 단계 복구. 로컬 정적 미리보기만 사용.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
import {chromium,type Browser} from 'playwright';
import {demoWorking} from '../../shared/demo.ts';
import {newManualRecord} from '../../shared/model.ts';
import {withRun} from '../../shared/runs.ts';
test('잘못 저장된 단계에서 복구 후 구버전 실행의 보고서를 보존',async()=>{
 const html=readFileSync('dist/preview/index.html');
 const server=createServer((_q,res)=>{res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html);});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base=`http://localhost:${(server.address() as any).port}`;let browser:Browser|undefined;
 try {
  browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH||undefined});
  const page=await browser.newPage();const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',r=>new URL(r.request().url()).hostname==='localhost'?r.continue():r.abort());
  await page.goto(base);
  const w=demoWorking();w.property.displayName='보존할 과거 사업지';
  const rec=withRun(newManualRecord('lc_upgrade_ui',w),'manual');delete rec.runs[0].result.reportContext;delete rec.runs[0].result.citations;
  rec.working=structuredClone(rec.working);rec.working.property.displayName='현재 사업지';rec.working.evidence=[];
  await page.evaluate(r=>{localStorage.setItem('location-analyzer.saved.v1',JSON.stringify({[r.key]:r}));sessionStorage.setItem(`la.step.${r.key}`,'99');},rec);
  await page.goto(`${base}/#/app/l/${rec.key}`);await page.getByTestId('step-1').waitFor();
  assert.equal(await page.getByTestId('step-1').getAttribute('aria-current'),'step');
  await page.getByTestId('rerun').click();await page.getByTestId('step-4').click();
  await page.getByTestId('report-run').selectOption('1');
  assert.match(await page.getByTestId('report-preview').innerText(),/보존할 과거 사업지/);
  assert.doesNotMatch(await page.getByTestId('report-preview').innerText(),/현재 사업지/);
  assert.deepEqual(errors,[]);
 } finally {await browser?.close();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
