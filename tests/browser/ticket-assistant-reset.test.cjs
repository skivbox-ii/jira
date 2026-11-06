const test=require('node:test');
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const {startPreview}=require('./ticket-assistant-preview-server.cjs');
const {sourcePreviewResponse}=require('../helpers/ticket-assistant-source-preview.cjs');
async function fixture(t,width=1440) {
    const server=await startPreview({port:0,sourceAssets:false}),browser=await chromium.launch({channel:'chrome',headless:true});
    t.after(async()=>{await browser.close();await server.close();});
    const page=await browser.newPage({viewport:{width,height:1000}}),errors=[];page.setDefaultTimeout(5000);page.on('pageerror',e=>errors.push(e.message));
    // The old preview's store adapter intentionally exposes only draft/history.
    // Reset persistence uses the real gadget store, including navigation methods.
    await page.addInitScript(()=>{
        document.addEventListener('DOMContentLoaded',()=>{
            window.taPreview.ready.then(async()=>{
                const f=window.taPreview,Gadget=window.taRequire('_ujgTicketAssistantRuntime');f.instance.destroy();
                const runtime={createSession(config){return {
                    async prompt(text){
                        if(f.chatMode==='error')throw Error('Synthetic transport failure');
                        if(f.chatMode==='slow')await new Promise(resolve=>setTimeout(resolve,2200));
                        const tool=name=>config.tools.find(t=>t.name===name);
                        if(/^покажи/i.test(text))await tool('read_template').execute({},{});
                        else if(/^измени шаблон/i.test(text)) {
                            const read=await tool('read_template').execute({},{});
                            await tool('propose_template_change').execute({changes:{instructions:read.template.instructions+'\nОбязательно укажи среду проверки.'}},{});
                        } else await tool('update_task').execute({fields:{summary:'Поздний ответ',description:'Поздние сведения на DEV.'},questions:[]},{});
                    },getMessages:()=>[],abort(){},dispose(){}
                };}};
                const ai={assist:async(_input,request)=>new Promise(resolve=>{f.assistSignal=request.signal;f.finishAssist=()=>resolve({fields:{summary:'Поздняя помощь полю'},questions:[],warnings:[],evidence:[]});})};
                f.instance=new Gadget({getGadgetContentEl:()=>window.jQuery('#ticket-assistant')},{api:f.api,storage:window.localStorage,runtime,ai});
                await f.instance.ready;const c=f.instance.controller;
                if(!c.getState().draft)await c.selectProject('DEMO');
                if(!c.getState().draft.issueTypeId){await c.selectIssueType('10');await c.selectTemplate('task');}
                window.taResetReady=true;
            });
        });
    });
    await page.route('**/*',route=>{const r=route.request();if(!r.url().startsWith(server.url)||r.method()!=='GET')return route.abort();const source=sourcePreviewResponse(new URL(r.url()).pathname);return source?route.fulfill(source):route.continue();});
    await page.goto(server.url);await page.waitForFunction(()=>window.taResetReady===true);
    async function turn(text) {await page.locator('[data-ta-chat-input]').fill(text);await page.locator('[data-ta-chat-input]').press('Enter');await page.waitForFunction(()=>window.taPreview.instance.chat.getState().status!=='running');}
    return {page,errors,turn,state:()=>page.evaluate(()=>window.taPreview.instance.controller.getState())};
}
for(const width of [1440,390])test('visible header clear resets only the current card and keeps type/template at '+width,async t=>{
    const {page,errors,turn,state}=await fixture(t,width),clear=page.getByRole('button',{name:'Очистить',exact:true});
    assert.equal(await clear.isVisible(),true);assert.equal(await clear.locator('span').isVisible(),true);
    await page.evaluate(async()=>{const c=window.taPreview.instance.controller;await c.selectProject('APP');await c.selectIssueType('20');await c.selectTemplate('task');await c.updateField('summary','Черновик APP');await c.updateField('description','Сохранить данные другого проекта.');});
    await turn('Покажи шаблон APP');const other=await state();
    await page.evaluate(async()=>{const c=window.taPreview.instance.controller;await c.selectProject('DEMO');await c.selectIssueType('11');await c.selectTemplate('bug');await c.updateField('summary','Очистить эту тему');await c.updateField('description','Убрать это описание.');await c.updateField('components',[{id:'31'}]);});
    await page.locator('[data-ta-files]').setInputFiles({name:'clear-me.txt',mimeType:'text/plain',buffer:Buffer.from('saved attachment')});
    await turn('Покажи шаблон');await turn('Измени шаблон: укажи среду проверки');assert.equal(await page.locator('[data-ta-template-proposal]').isVisible(),true);
    await page.evaluate(()=>{window.taPreview.chatMode='error';});await turn('Покажи доступные поля');assert.equal(await page.locator('[data-ta-chat-error]').isVisible(),true);
    await page.locator('[data-ta-chat-input]').fill('Неотправленный текст');const before=await state();
    await clear.click();await page.waitForFunction(id=>window.taPreview.instance.controller.getState().draft.id!==id,before.draft.id);
    const after=await state();assert.equal(after.draft.projectKey,'DEMO');assert.equal(after.draft.issueTypeId,'11');assert.equal(after.draft.templateId,'bug');assert.deepEqual(after.settings,before.settings);
    assert.equal(after.draft.source,'');assert.deepEqual(after.draft.attachments,[]);assert.deepEqual(after.draft.pendingFields,{});assert.deepEqual(after.draft.questions,[]);assert.equal(after.draft.checked,null);
    assert.equal(await page.locator('[data-ta-field=summary] input').inputValue(),'');assert.equal(await page.locator('[data-ta-field=description] textarea').inputValue(),'');assert.equal(await page.locator('[data-ta-file-list]').innerText(),'');
    assert.equal(await page.locator('[data-ta-chat-input]').inputValue(),'');assert.equal(await page.locator('[data-ta-chat-input]').evaluate(el=>el===document.activeElement),true);
    assert.equal(await page.locator('[data-ta-message]').count(),0);assert.equal(await page.locator('[data-ta-chat-error]').isHidden(),true);assert.equal(await page.locator('[data-ta-template-proposal]').isHidden(),true);assert.equal(await page.locator('[data-ta-card-create]').isEnabled(),false);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await page.reload();await page.waitForFunction(()=>window.taResetReady===true);const restored=await state();assert.equal(restored.draft.issueTypeId,'11');assert.equal(restored.draft.templateId,'bug');assert.equal(restored.draft.source,'');assert.equal(await page.locator('[data-ta-message]').count(),0);
    await page.evaluate(async()=>{await window.taPreview.instance.controller.selectProject('APP');});const preserved=await state();assert.equal(preserved.draft.id,other.draft.id);assert.equal(preserved.draft.fields.summary,'Черновик APP');assert.equal(preserved.draft.fields.description,'Сохранить данные другого проекта.');assert.match(await page.locator('[data-ta-chat-log]').innerText(),/Покажи шаблон APP/);
    assert.equal(await page.evaluate(()=>window.taPreview.calls.filter(x=>x==='create'||x.startsWith('upload:')).length),0);assert.deepEqual(errors,[]);
});
test('clear during a slow chat request leaves an immediately usable blank composer and ignores the late answer',async t=>{
    const {page,errors,state}=await fixture(t);const before=await state();await page.evaluate(()=>{window.taPreview.chatMode='slow';});
    await page.locator('[data-ta-chat-input]').fill('Ошибка при сохранении API на DEV.');await page.locator('[data-ta-chat-input]').press('Enter');await page.waitForFunction(()=>window.taPreview.instance.chat.getState().status==='running');
    await page.getByRole('button',{name:'Очистить',exact:true}).click();await page.waitForFunction(id=>window.taPreview.instance.controller.getState().draft.id!==id,before.draft.id);
    await page.locator('[data-ta-chat-input]').fill('Следующее неотправленное сообщение');assert.equal(await page.locator('[data-ta-chat-send]').isEnabled(),true);
    await page.waitForTimeout(2400);assert.equal(await page.locator('[data-ta-message]').count(),0);assert.equal(await page.locator('[data-ta-chat-input]').inputValue(),'Следующее неотправленное сообщение');assert.equal(await page.locator('[data-ta-field=summary] input').inputValue(),'');assert.equal(await page.locator('[data-ta-chat-error]').isHidden(),true);assert.deepEqual(errors,[]);
});
test('queued clear cannot reset a project selected after the click',async t=>{
    const {page,errors,state}=await fixture(t);await page.evaluate(async()=>{const c=window.taPreview.instance.controller;await c.selectProject('APP');await c.selectIssueType('20');await c.selectTemplate('task');await c.updateField('summary','Не трогать APP');await c.selectProject('DEMO');});
    await page.evaluate(async()=>{const c=window.taPreview.instance.controller;document.querySelector('[data-ta-chat-new]').click();await c.selectProject('APP');document.querySelector('[data-ta-chat-input]').value='Ввод APP';});
    assert.equal((await state()).draft.fields.summary,'Не трогать APP');assert.equal(await page.locator('[data-ta-chat-input]').inputValue(),'Ввод APP');assert.deepEqual(errors,[]);
});
test('clear cancels native field assistance without reviving its late proposal',async t=>{
    const {page,state,errors}=await fixture(t);await page.evaluate(async()=>{const c=window.taPreview.instance.controller;await c.updateField('summary','Исходная тема');await c.updateSource('Уточнить обработку ошибок API');window.taPreview.assisting=c.assistField('summary','improve');});
    await page.waitForFunction(()=>window.taPreview.instance.controller.getState().stage==='assisting');const before=await state();
    await page.getByRole('button',{name:'Очистить',exact:true}).click();await page.waitForFunction(id=>window.taPreview.instance.controller.getState().draft.id!==id,before.draft.id);
    assert.equal(await page.evaluate(()=>window.taPreview.assistSignal.aborted),true);assert.equal((await state()).assistance,null);
    await page.evaluate(async()=>{window.taPreview.finishAssist();await window.taPreview.assisting;});
    assert.equal(await page.locator('[data-ta-field=summary] input').inputValue(),'');assert.deepEqual((await state()).draft.pendingFields,{});assert.deepEqual(errors,[]);
});
async function ready(page) {await page.evaluate(async()=>{const c=window.taPreview.instance.controller;await c.chatUpdate({fields:{summary:'Восстановить API на DEV',description:'Цель: Восстановить сохранение через API.\n\nЧто сделать: Исправить сбой сохранения.\n\nГде: DEV, сервис API.\n\nКритерии приёмки: Сохранение завершается без ошибки.'},questions:[]},c.chatSnapshot());await c.chatValidate(c.chatSnapshot());});}
for(const status of ['preflight','submitting','unknown'])test('header reset preserves the '+status+' write guard',async t=>{
    const {page,errors,state}=await fixture(t);assert.equal(await page.getByRole('button',{name:'Очистить',exact:true}).isVisible(),true);await ready(page);const before=await state();
    await page.evaluate(status=>{const f=window.taPreview;if(status==='preflight')f.api.getCreateMeta=()=>new Promise((_resolve,reject)=>{f.releasePreflight=()=>reject(Error('End test preflight'));});else if(status==='submitting')f.api.createIssue=()=>new Promise(resolve=>{f.releaseCreate=()=>resolve({id:'1',key:'DEMO-1'});});else f.api.createIssue=async()=>{throw {outcome:'unknown'};};f.submission=f.instance.controller.submit();},status);
    await page.waitForFunction(status=>window.taPreview.instance.controller.getState().draft.creation.status===status,status);
    const reset=page.locator('[data-ta-chat-new]');assert.equal(await reset.isDisabled(),true);await reset.dispatchEvent('click');assert.equal((await state()).draft.id,before.draft.id);assert.equal((await state()).draft.fields.summary,before.draft.fields.summary);
    await page.evaluate(async()=>{window.taPreview.releasePreflight?.();window.taPreview.releaseCreate?.();await window.taPreview.submission;});assert.deepEqual(errors,[]);
});
test('after creation header offers a new task with the same selection and never recreates the previous issue',async t=>{
    const {page,errors,state}=await fixture(t);await ready(page);const before=await state();await page.locator('[data-ta-card-create]').click();await page.waitForFunction(()=>window.taPreview.instance.controller.getState().draft.creation.status==='created');
    const next=page.getByRole('button',{name:'Новая задача',exact:true});assert.equal(await next.isVisible(),true);await next.click();await page.waitForFunction(id=>window.taPreview.instance.controller.getState().draft.id!==id,before.draft.id);
    const blank=await state();assert.equal(blank.draft.issueTypeId,before.draft.issueTypeId);assert.equal(blank.draft.templateId,before.draft.templateId);assert.equal(blank.draft.creation.issueKey,null);assert.equal(blank.draft.source,'');assert.equal(await page.locator('[data-ta-field=summary] input').inputValue(),'');assert.equal(await page.evaluate(()=>window.taPreview.calls.filter(x=>x==='create').length),1);assert.deepEqual(errors,[]);
});
test('header cannot abandon an attachment that is uploading after issue creation',async t=>{
    const {page,state,errors}=await fixture(t);await page.locator('[data-ta-files]').setInputFiles({name:'pending.txt',mimeType:'text/plain',buffer:Buffer.from('pending upload')});await ready(page);const before=await state();
    await page.evaluate(()=>{const f=window.taPreview;f.api.createIssue=async()=>({id:'1',key:'DEMO-1'});f.api.uploadAttachment=()=>new Promise(resolve=>{f.finishUpload=()=>resolve({id:'a1',filename:'pending.txt'});});f.submission=f.instance.controller.submit();});
    await page.waitForFunction(()=>window.taPreview.instance.controller.getState().draft.attachments.some(a=>a.status==='uploading'));
    const reset=page.locator('[data-ta-chat-new]');assert.equal(await reset.isDisabled(),true);await reset.dispatchEvent('click');assert.equal((await state()).draft.id,before.draft.id);
    await page.evaluate(async()=>{window.taPreview.finishUpload();await window.taPreview.submission;});assert.equal(await reset.isEnabled(),true);assert.deepEqual(errors,[]);
});
test('an unseen durable creation guard leaves content and composer intact when clear is requested',async t=>{
    const {page,state,errors}=await fixture(t);await page.evaluate(async()=>{await window.taPreview.instance.controller.updateField('summary','Не терять содержимое');});const before=await state();await page.locator('[data-ta-chat-input]').fill('Сохранить этот ввод');
    await page.evaluate(()=>{const c=window.taPreview.instance.controller,store=c.getStore(),saved=store.load('DEMO');saved.draft.creation={status:'unknown',attemptId:'other-tab',issueKey:null,error:null};if(!store.save('DEMO',saved,saved.revision).ok)throw Error('Could not seed durable guard');});
    await page.getByRole('button',{name:'Очистить',exact:true}).click();await page.waitForFunction(()=>window.taPreview.instance.controller.getState().error?.code==='conflict');
    const after=await state();assert.equal(after.draft.id,before.draft.id);assert.equal(after.draft.fields.summary,'Не терять содержимое');assert.equal(await page.locator('[data-ta-chat-input]').inputValue(),'Сохранить этот ввод');assert.equal(await page.locator('[data-ta-chat-error]').isVisible(),true);
    assert.equal(await page.evaluate(()=>window.taPreview.instance.controller.getStore().load('DEMO').draft.creation.status),'unknown');assert.deepEqual(errors,[]);
});
