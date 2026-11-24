// 로컬 서버·SQLite·브라우저 저장·실제 어댑터를 사용하고 두 외부 기관의 HTTP 응답만 대체한다.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from 'playwright';
import {createApp} from '../../server/app.ts';
import {loadConfig} from '../../server/config.ts';
import {mockTransport,item} from '../helpers/mockPublicApi.ts';

test('가상 사업지 · 모의 API 경계 조회 → 개통 전후 → 저장·재열기·실행 당시 보고서',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'la-event-'));
  const requests=new Set<string>();
  const app=createApp(loadConfig({DB_PATH:join(dir,'test.db'),MOLIT_SERVICE_KEY:'fixture-m',KAKAO_REST_KEY:'fixture-k'}),{
    logger:()=>{},publicDataDeps:{lookup:(_h,cb)=>cb(null,[{address:'203.0.113.10',family:4}]),
      transport:async u=>{
        if (u.hostname==='dapi.kakao.com') return mockTransport(u);
        const ym=u.searchParams.get('DEAL_YMD')!,region=u.searchParams.get('LAWD_CD')!;
        requests.add(region+'/'+ym);
        const impact=region==='41135';
        const rows:string[]=[];
        if (ym==='202506'||ym==='202508') for(let day=1;day<=12;day++){
          const amount=ym==='202506'?84000:impact?92400:85680;
          rows.push(item(impact?'[모의] 가람아파트':'[모의] 동편아파트',impact?'정자동':'신흥동',impact?'1번지':'2번지',day,region)
            .replace('95,000',String(amount)).replace('84.97','84').replace('2026','2025').replace('<dealMonth>9','<dealMonth>'+ym.slice(-2)));
        }
        return {status:200,headers:{},body:Buffer.from(`<response><header><resultCode>000</resultCode></header><body><pageNo>1</pageNo><numOfRows>1000</numOfRows><totalCount>${rows.length}</totalCount><items>${rows.join('')}</items></body></response>`)};
      }}
  });
  await new Promise<void>(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH||undefined});
  try {
    const page=await browser.newPage({viewport:{width:1280,height:900},reducedMotion:'reduce'});
    const errors:string[]=[];
    page.on('pageerror',e=>errors.push(e.message));
    const id=(name:string)=>page.getByTestId(name);
    await page.goto(`http://localhost:${(app.server.address() as {port:number}).port}/app`);
    await id('new-address').fill('[모의] 가람시 경계로 100');
    await id('start').click();
    await id('f-area').fill('84');
    const imported={dataMode:'demo',events:[{key:'rail',category:'transport',name:'[모의] 가람역 개통',evidenceKeys:['doc'],milestones:[
      {type:'announcement',status:'actual',date:'2025-03-01',announcedOn:'2025-03-01'},
      {type:'opening',status:'actual',date:'2025-07-15',announcedOn:'2025-07-15'}]}],
      evidence:[{key:'doc',publisher:'[모의] 가람시',title:'[모의] 개통 일정 공고',publishedOn:'2025-03-01',fact:'가상 노선 개통 일정 발표',linked:['rail']}]};
    await page.locator('#sec-events input[type=file]').first().setInputFiles({name:'mock-events.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(imported))});
    await id('events-msg').waitFor();
    await id('step-next').click();
    await id('obs-event').selectOption({label:'[모의] 가람역 개통'});
    await id('obs-milestone').selectOption({label:'개통·개장·준공 · 2025-07-15'});
    await id('obs-months').selectOption('3');
    await id('public-lookup').click();
    await id('market-msg').waitFor();
    assert.match(await id('market-msg').innerText(),/대사 일치/);
    assert.ok(requests.has('41135/202504') && requests.has('41133/202510'));
    await page.getByRole('checkbox',{name:'[모의] 가람아파트 영향권',exact:true}).check();
    await page.getByRole('checkbox',{name:'[모의] 동편아파트 비교군',exact:true}).check();
    await id('step-next').click();
    const summary=await id('obs-summary').innerText();
    assert.match(summary,/3,305\.8만원 → 3,636\.4만원/);
    assert.match(summary,/전 12건·후 12건/);
    assert.match(summary,/\+8\.0%p/);
    assert.match(summary,/반경 1500m/);
    const shots=process.env.EVENT_SHOT_DIR;
    if(shots){
      await id('obs-summary').scrollIntoViewIfNeeded();
      await page.screenshot({path:join(shots,'comparison.png')});
      await page.setViewportSize({width:390,height:844});
      await id('obs-summary').scrollIntoViewIfNeeded();
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
      await page.screenshot({path:join(shots,'mobile.png')});
      await page.setViewportSize({width:1280,height:900});
    }
    await id('step-4').click();
    const original=await id('report-preview').innerText();
    assert.match(original,/개통 일정 공고/);
    assert.match(original,/전후 비교 거래 근거/);
    assert.match(original,/2025-06-12 \| 84 \| 84,000만원/);
    assert.match(original,/전용평당 중위가격 · 전 3,305\.8만원 \/ 후 3,636\.4만원/);
    await id('save-browser-4').click();
    await page.waitForURL('**/app/l/**');
    await id('go-home').click();
    await id('open-local').click();
    await id('step-4').click();
    assert.equal(await id('report-preview').innerText(),original);
    await id('step-1').click();
    await id('f-area').fill('59');
    await id('stale-banner').waitFor();
    await id('rerun').click();
    await id('step-4').click();
    await id('report-run').selectOption('2');
    assert.equal((await id('report-preview').innerText()).replace(' · 최신 실행 #3 아님',''),original);
    if(shots){
      await page.locator('#sec-report > summary').scrollIntoViewIfNeeded();
      await page.screenshot({path:join(shots,'report.png')});
    }
    assert.deepEqual(errors,[]);
  } finally {await browser.close(); await app.close(); rmSync(dir,{recursive:true,force:true});}
});
