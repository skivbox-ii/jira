const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright');
const {startPreview}=require('./ticket-assistant-preview-server.cjs');
const {sourcePreviewResponse}=require('../helpers/ticket-assistant-source-preview.cjs');

// Screenshot wording is preserved; the private IP prefix is anonymized to TEST-NET-1.
// Transport fixture only. These values are authored examples, never inferred by
// the preview or the application. A personal check can inject the same object
// as window.taScreenshotExample before /preview.js is evaluated.
const screenshotExample={
 source:'Стенд для тестирования виртуализации EVOSCADA-20446.\n\nПриложения на серверах 192.0.2.166 и 192.0.2.167\n\npostgres и redis на серверах 192.0.2.160, 192.0.2.161, 192.0.2.162\n\nredis sentinel на серверах 192.0.2.163, 192.0.2.164, 192.0.2.165\n\nПрошу\n\nЗабэкапить и очистить БД postgres и redis.\nПерезапустить приложения на сервере приложений\nПроверить, что приложения запускаются с пустой БД\n\nЭти работы необходимы для тестирования конверторов WinCCOA -> EVOSCADA .',
 fields:{summary:'Забэкапить и очистить БД PostgreSQL и Redis на стенде EVOSCADA-20446'},
 descriptionSections:{
  location:'Стенд для тестирования виртуализации EVOSCADA-20446; приложения — 192.0.2.166 и 192.0.2.167; postgres и redis — 192.0.2.160, 192.0.2.161, 192.0.2.162; redis sentinel — 192.0.2.163, 192.0.2.164, 192.0.2.165.',
  order:'Сделать резервную копию БД PostgreSQL и Redis, очистить базы и перезапустить приложения.',
  verification:'Приложения запускаются с пустой БД.'
 }
};
// Set TA_PREVIEW_SOURCE_MODULES=1 to inspect source without invoking builders.
const sourceModules=process.env.TA_PREVIEW_SOURCE_MODULES==='1';
const screenshotDir=process.env.TA_NO_FALLBACK_SCREENSHOTS;

for(const mode of ['malformed','error'])test('no narrative fallback: '+mode+' → Retry → structured model fields; manual summary survives',async t=>{
 const server=await startPreview({port:0,sourceAssets:false});
 t.after(()=>server.close());
 const browser=await chromium.launch({channel:'chrome',headless:true});
 t.after(()=>browser.close());
 const page=await browser.newPage({viewport:{width:1440,height:1100}}),errors=[],requests=[];
 page.setDefaultTimeout(6000);
 page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(example=>{window.taScreenshotExample=example;},screenshotExample);
 await page.route('**/*',route=>{
  const request=route.request();requests.push({url:request.url(),method:request.method()});
  if(!request.url().startsWith(server.url)||request.method()!=='GET')return route.abort();
  const source=sourceModules?sourcePreviewResponse(new URL(request.url()).pathname):null;
  return source?route.fulfill(source):route.continue();
 });
 await page.goto(server.url+'?devops=1&screenshot=1');
 await page.waitForSelector('html[data-ta-preview-ready="true"]');
 const state=()=>page.evaluate(()=>window.taPreview.instance.controller.getState());
 const composer=page.locator('[data-ta-chat-input]'),retry=page.locator('[data-ta-chat-retry]');
 async function settled(){await page.waitForFunction(()=>window.taPreview.instance.chat.getState().status!=='running');}
 async function capture(name){
  if(!screenshotDir)return;
  fs.mkdirSync(screenshotDir,{recursive:true});
  await page.screenshot({path:path.join(screenshotDir,mode+'-'+name+'.png'),fullPage:true});
 }
 await page.locator('[data-ta-preview-pico='+mode+']').click();
 await composer.fill(screenshotExample.source);await composer.press('Enter');await settled();
 let current=await state();
 assert.equal(await page.locator('[data-ta-chat-log] [data-role=user] .ta-message-text').first().innerText(),screenshotExample.source);
 assert.equal(current.draft.fields.summary||'','');
 assert.equal(current.draft.fields.description||'','');
 assert.equal(current.draft.fields.timetracking,undefined);
 assert.equal(current.draft.checked,null);
 assert.equal(await page.locator('[data-ta-task-card] [data-ta-field=summary] input').inputValue(),'');
 assert.equal(await page.locator('[data-ta-task-card] [data-ta-field=description] textarea').inputValue(),'');
 assert.equal(await retry.isVisible(),true);
 assert.match(await page.evaluate(()=>window.taPreview.instance.chat.getState().error.code),mode==='error'?/^transport$/:/^response(?:-repair)?$/);
 assert.equal(await page.locator('[data-ta-card-create]').isDisabled(),true);
 assert.doesNotMatch(JSON.stringify(current.draft.fields),/UNTRUSTED/);
 await capture('01-failure-retry');
 await page.locator('[data-ta-preview-pico=normal]').click();await retry.click();await settled();
 current=await state();
 assert.equal(current.draft.fields.summary,screenshotExample.fields.summary);
 assert.doesNotMatch(current.draft.fields.description,/\bTEST\b/);
 for(const [id,value] of Object.entries(screenshotExample.descriptionSections)) {
  const rows=await page.evaluate(()=>{const c=window.taPreview.instance.controller,s=c.getState();return window.taRequire('_ujgTA_validation').descriptionTableRows(s.meta,s.draft.issueTypeId,s.draft.fields.description);});
  const label={location:'Среда',order:'Порядок',verification:'Проверка'}[id];
  assert.equal(rows.find(row=>row.label===label).value.trim(),value);
 }
 for(const id of ['window','release','verifier'])assert.ok(current.validation.questions.some(q=>q.id==='devops:'+id),id);
 assert.equal(current.draft.fields.timetracking,undefined);
 assert.equal(current.draft.checked,null);
 assert.equal(await page.locator('[data-ta-card-create]').isDisabled(),true);
 assert.equal(await retry.isVisible(),false);
 assert.equal(await page.locator('[data-ta-chat-log] [data-role=user]').count(),1);
 await capture('02-structured-model');
 const summary=page.locator('[data-ta-task-card] [data-ta-field=summary] input');
 await summary.fill('Моя ручная тема');await summary.press('Tab');
 const before=(await state()).draft.fields;
 await page.locator('[data-ta-preview-pico=error]').click();
 await composer.fill(screenshotExample.source);await composer.press('Enter');await settled();
 assert.deepEqual((await state()).draft.fields,before);
 assert.equal(await retry.isVisible(),true);
 await capture('03-manual-preserved-on-error');
 await page.locator('[data-ta-preview-pico=normal]').click();await retry.click();await settled();
 assert.equal((await state()).draft.fields.summary,'Моя ручная тема');
 assert.equal((await state()).draft.fields.description,before.description);
 assert.equal(await summary.inputValue(),'Моя ручная тема');
 await capture('04-manual-preserved-after-retry');
 assert.equal(await page.evaluate(()=>window.taPreview.calls.filter(x=>x==='create').length),0);
 assert.ok(requests.every(r=>r.method==='GET'&&r.url.startsWith(server.url)));
 assert.deepEqual(errors,[]);
});
