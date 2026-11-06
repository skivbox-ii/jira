const test=require('node:test');
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const {startPreview}=require('./ticket-assistant-preview-server.cjs');
async function fixture(t,width=1440) {
 const server=await startPreview({port:0,sourceAssets:false}),browser=await chromium.launch({channel:'chrome',headless:true});
 t.after(async()=>{await browser.close();await server.close();});
 const page=await browser.newPage({viewport:{width,height:1100}}),errors=[],requests=[];page.setDefaultTimeout(6000);
 page.on('pageerror',e=>errors.push(e.message));
 // Exercise the exact offline URL/runtime served to a person, without builders.
 await page.route('**/*',route=>{const r=route.request();requests.push({url:r.url(),method:r.method()});return r.url().startsWith(server.url)&&r.method()==='GET'?route.continue():route.abort();});
 const ready=()=>page.waitForFunction(()=>document.documentElement.getAttribute('data-ta-preview-ready')==='true');
 await page.goto(server.url+'?devops=1');await ready();
 const state=()=>page.evaluate(()=>window.taPreview.instance.controller.getState());
 async function send(text){const input=page.locator('[data-ta-chat-input]');await input.fill(text);await input.press('Enter');await page.waitForFunction(()=>window.taPreview.instance.chat.getState().status!=='running');}
 return {page,state,send,errors,requests,server,ready};
}
for(const width of [1440,390])test('DEVOPS demo starts populated, editable, offline and restores without reseeding at '+width,async t=>{
 const h=await fixture(t,width),{page}=h;const initial=await h.state();
 assert.equal(initial.draft.projectKey,'DEVOPS');assert.equal(initial.draft.issueTypeId,'12');assert.equal(initial.draft.templateId,'deployment');
 assert.equal(initial.validation.ok,true);assert.ok(initial.draft.checked);assert.equal(initial.draft.fields.timetracking.originalEstimate,'30m');
 assert.match(initial.draft.fields.description,/5961fa4/);assert.match(initial.draft.fields.description,/https:\/\/example.org\/mama-myla-ramu/);
 assert.match(initial.draft.fields.summary,/виджет Jira в DEV/);
 assert.doesNotMatch(await page.locator('[data-ta-chat-log]').innerText(),/не подтверждены пользователем|применены частично/);
 assert.equal(await page.locator('[data-ta-card-create]').isEnabled(),true);
 const summary=page.locator('[data-ta-task-card] [data-ta-field=summary] input');await summary.fill('Мой пример развёртывания');await summary.press('Tab');
 await page.reload();await h.ready();assert.equal((await h.state()).draft.fields.summary,'Мой пример развёртывания');
 assert.equal(await page.evaluate(()=>window.taPreview.calls.filter(x=>x==='pico').length),0);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 assert.ok(h.requests.every(r=>r.method==='GET'&&r.url.startsWith(h.server.url)));assert.deepEqual(h.errors,[]);
});
for(const id of ['10','11','12'])test('DEVOPS local Pico supports incomplete input, correction, manual edit and create for '+id,async t=>{
 const h=await fixture(t),{page}=h;
 await page.locator('[data-ta-chat-new]').click();await page.locator('[data-ta-preview-example="'+id+'"]').click();
 const example=await page.locator('[data-ta-chat-input]').inputValue();
 const missing=id==='12'?'Окно:':'Ссылки:';
 const full=id==='12'?(await page.evaluate(()=>{const c=window.taPreview.instance.controller;return window.taRequire('_ujgTA_validation').formatDevopsDescription(c.getState().meta,'12',document.querySelector('[data-ta-chat-input]').value,true);})):example;
 const partial=full.split('\n').filter(line=>!line.startsWith(missing)).join('\n');
 await h.send(partial);let state=await h.state();assert.equal(state.draft.checked,null);assert.equal(state.validation.ok,false);assert.equal(await page.locator('[data-ta-card-create]').isDisabled(),true);
 assert.ok(state.validation.questions.some(q=>q.id==='devops:'+(id==='12'?'window':'links')));
 await h.send(id==='12'?'Окно: в рабочее время':'Ссылки: https://example.org/api/runbook');
 state=await h.state();assert.equal(state.validation.ok,true,JSON.stringify(state.validation));assert.ok(state.draft.checked);
 const summary=page.locator('[data-ta-task-card] [data-ta-field=summary] input');await summary.fill('Моя ручная тема '+id);await summary.press('Tab');
 await h.send('Оценка: 2 часа');state=await h.state();assert.equal(state.draft.fields.summary,'Моя ручная тема '+id);assert.equal(state.draft.fields.timetracking.originalEstimate,'2h');
 assert.equal(state.validation.ok,true);assert.ok(state.draft.checked);
 await page.locator('[data-ta-card-create]').click();await page.waitForFunction(()=>window.taPreview.instance.controller.getState().draft.creation.status==='created');
 assert.match((await h.state()).draft.creation.issueKey,/^DEVOPS-/);assert.equal(await page.evaluate(()=>window.taPreview.calls.filter(x=>x==='create').length),1);
 assert.ok(h.requests.every(r=>r.method==='GET'&&r.url.startsWith(h.server.url)));assert.deepEqual(h.errors,[]);
});
test('DEVOPS demo failure controls preserve manual input and can recover locally',async t=>{
 const h=await fixture(t),{page}=h;await page.locator('[data-ta-preview-pico=error]').click();
 const source=(await h.state()).draft.source;await h.send('Покажи шаблон');
 assert.ok((await h.state()).draft.checked);assert.equal((await h.state()).draft.source,source);
 assert.equal(await page.evaluate(()=>window.taPreview.instance.chat.getState().error.code),'transport');
 await page.locator('[data-ta-preview-pico=normal]').click();await h.send('Покажи шаблон');
 assert.equal((await h.state()).validation.ok,true);assert.ok((await h.state()).draft.checked);
 await page.locator('[data-ta-preview-scenario=rejected]').click();await page.locator('[data-ta-card-create]').click();
 await page.waitForFunction(()=>window.taPreview.instance.controller.getState().draft.creation.status==='rejected');assert.equal((await h.state()).draft.creation.issueKey,null);
 assert.deepEqual(h.errors,[]);
});
test('default preview remains DEMO, empty and does not show DEVOPS demo controls',async t=>{
 const h=await fixture(t),{page}=h;await page.goto(h.server.url);await h.ready();
 const s=await h.state();assert.equal(s.draft.projectKey,'DEMO');assert.equal(s.draft.issueTypeId,'10');assert.equal(s.draft.fields.description,undefined);
 assert.equal(await page.locator('[data-ta-preview-example]').count(),0);assert.equal(await page.evaluate(()=>window.taPreview.calls.filter(x=>x==='pico').length),0);
});
