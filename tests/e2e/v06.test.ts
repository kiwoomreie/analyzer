import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createApp } from '../../server/app.ts';
import { loadConfig } from '../../server/config.ts';
import { newManualRecord } from '../../shared/model.ts';
import { withRun } from '../../shared/runs.ts';
import { fixture } from '../helpers/observationFixture.ts';
import { openSec, reveal, stepAware } from "../helpers/stepAware.ts";
test('v0.6 수동 비교·기간·그룹 중복·저장 재열기·모바일',async()=>{
 const app=createApp(loadConfig({DB_PATH:':memory:',WEB_ROOT:'dist/web'} as any),{logger:()=>{}});
 await new Promise<void>(r=>app.server.listen(5283,'127.0.0.1',r));
 const browser=await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined });
 try {
 const page=stepAware(await browser.newPage());const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',route=>new URL(route.request().url()).hostname==='localhost'?route.continue():route.abort());
 await page.goto('http://localhost:5283/app');
 const rec=withRun(newManualRecord('lc_v06',fixture()),'manual');
 await page.evaluate(r=>localStorage.setItem('location-analyzer.saved.v1',JSON.stringify({[r.key]:r})),rec);
 await page.goto('http://localhost:5283/app/l/lc_v06');
 await page.waitForSelector('[data-testid=summary]');
 await page.locator('#sec-market > summary').click();
 await page.waitForSelector('[data-testid=obs-results]');
 assert.match(await page.locator('[data-testid=obs-difference]').innerText(),/10\.0%p/);
 for(const n of ['3','12','6']){await page.selectOption('[data-testid=obs-months]',n);assert.match(await page.locator('[data-testid=obs-difference]').innerText(),/10\.0%p/);}
 const box=page.getByRole('checkbox',{name:'A 비교군',exact:true});await box.check();assert.match(await page.locator('[data-testid=obs-warnings]').innerText(),/그룹 중복/);assert.match(await page.locator('[data-testid=obs-difference]').innerText(),/비교 불가/);await box.uncheck();
 await page.waitForSelector('[data-testid=save-state]:has-text("이 브라우저에 저장됨")');await page.reload();await page.waitForSelector('[data-testid=summary]');if(await page.locator('#sec-market').getAttribute('open')===null)await page.locator('#sec-market > summary').click();assert.equal(await page.inputValue('[data-testid=obs-months]'),'6');assert.match(await page.locator('[data-testid=obs-difference]').innerText(),/10\.0%p/);
 await page.setViewportSize({width:390,height:844});assert.equal(await page.locator('[data-testid=observation-panel]').isVisible(),true);assert.deepEqual(errors,[]);
 } finally {await browser.close();await app.close();}
});
