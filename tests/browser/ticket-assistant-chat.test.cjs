const test = require('node:test');
const assert = require('node:assert/strict');
const {JSDOM} = require('jsdom');
const jquery = require('jquery');
const {loadUnit, metadataFixture} = require('../helpers/ticket-assistant-fixture');
const {chromium}=require('playwright');
const {startPreview}=require('./ticket-assistant-preview-server.cjs');
const fs=require('node:fs');
const {harness}=require('../helpers/ticket-assistant-chat-fixture');

test('actual Pico failures reach chat and UI as safe actionable categories, including each hard limit',async t=>{
    const actual=await import('../../ujg-ticket-assistant-chat/runtime.mjs');
    const cases=[
        {name:'config',code:'config',message:/подключени/i,action:'connection',request:()=>{throw Error('Pico connection configuration invalid');}},
        {name:'response',code:'response',message:/формат/i,action:'retry',request:()=>({text:'PRIVATE_PROVIDER_BODY <b>Bearer synthetic-secret</b>'})},
        {name:'model',code:'model-calls',message:/модели/i,action:'editor',calls:8,loop:1},
        {name:'tools',code:'tool-calls',message:/инструмент/i,action:'editor',calls:7,loop:2},
        {name:'time',code:'elapsed',message:/врем/i,action:'editor',limits:{wallMs:20},request:()=>new Promise(()=>{})},
        {name:'context',code:'context',message:/контекст/i,action:'budget',budget:{context:1024,reserve:128},calls:0,request:()=>{throw Error('Must not request');}},
        {name:'reserve',code:'reserve',message:/резерв/i,action:'budget',budget:{context:32768,reserve:128},request:()=>({text:JSON.stringify({text:'я'.repeat(500),toolCalls:[]})})},
        {name:'transport',code:'transport',message:/повтор/i,action:'retry',request:()=>{throw Error('PRIVATE_PROVIDER_BODY https://secret.invalid/ Bearer synthetic-secret');}}
    ];
    for(const scenario of cases)await t.test(scenario.name,async()=>{
        const h=await harness();if(scenario.budget){const settings=h.controller.getState().settings;settings.tokenBudget=scenario.budget;await h.controller.applySettings(settings);}
        const dom=new JSDOM('<div id="root"><div class="ta-layout"><header class="ta-header"><div class="ta-header-tools"></div></header></div></div>',{url:'https://jira.test/'});
        const {window}=dom,$=jquery(window),globals={window,document:window.document,AbortController};
        const Tools=loadUnit('chat-tools',{_ujgTA_fields:h.fields}),Chat=loadUnit('chat',{_ujgTA_chatTools:Tools,_ujgTA_draft:h.drafts},{AbortController});
        let calls=0,ui;
        const chat=Chat.create({controller:h.controller,runtime:{createSession:config=>actual.createSession({...config,limits:scenario.limits})},
            requestText:()=>{
                calls++;
                if(scenario.loop)return {text:JSON.stringify({text:'',toolCalls:Array.from({length:scenario.loop},(_,i)=>({id:'step_'+calls+'_'+i,name:'get_task',arguments:{}}))})};
                return scenario.request();
            },onChange:()=>{if(ui)ui.update(h.controller.getState());}});
        let invoked;const editor={openEditor(){invoked='editor';},openConnection(){invoked='connection';},openSettings(){invoked='budget';}};
        ui=loadUnit('chat-ui',{'_ujgTA_icons':loadUnit('icons',{},globals)},globals).create({$,controller:h.controller,chat,editor});ui.mount(window.document.querySelector('#root'));
        try {
            window.document.querySelector('[data-ta-chat-input]').value='Текст запроса должен сохраниться';
            $('[data-ta-chat-input]').trigger('input');
            window.document.querySelector('[data-ta-chat-send]').click();
            await new Promise(resolve=>setImmediate(resolve));
            while(chat.getState().status==='running')await new Promise(resolve=>setImmediate(resolve));
            const state=chat.getState();
            assert.equal(state.status,'error');assert.equal(state.error.code,scenario.code);assert.equal(state.error.action,scenario.action);
            assert.match(state.error.message,scenario.message);assert.match(window.document.querySelector('[data-ta-chat-error]').textContent,scenario.message);
            assert.equal(state.transcript[0].text,'Текст запроса должен сохраниться');
            assert.doesNotMatch(JSON.stringify(state),/PRIVATE_PROVIDER_BODY|synthetic-secret|secret\.invalid|Bearer/);
            if(['model','tools','time'].includes(scenario.name))assert.doesNotMatch(state.error.message,/бюджет|резерв|сократите контекст/i);
            if(scenario.calls!==undefined)assert.equal(calls,scenario.calls);
            if(scenario.action!=='retry') {
                const selector={connection:'[data-ta-chat-configure]',budget:'[data-ta-chat-error-budget]',editor:'[data-ta-chat-error-edit]'}[scenario.action];
                const action=window.document.querySelector(selector);assert.equal(action.hidden,false);action.click();assert.equal(invoked,scenario.action);
            } else {
                assert.equal(window.document.querySelector('[data-ta-chat-retry]').hidden,false);
                assert.equal(window.document.querySelector('[data-ta-chat-configure]').hidden,true);
                if(scenario.name==='response') {
                    assert.match(state.error.message,/Текст сохранён/);
                    assert.doesNotMatch(state.error.message,/подключени|URL|ключ/i);
                }
            }
            assert.equal(h.controller.getState().draft.checked,null);
        } finally {ui.destroy();chat.destroy();h.controller.destroy();window.close();}
    });
});

test('chat repairs a misplaced question and keeps the subsequent prose and updated card visible', async t => {
    const {page, send, errors} = await browserFixture(t);
    await page.evaluate(async () => {
        const records = window.taPreview;
        const Gadget = window.taRequire('_ujgTicketAssistantRuntime');
        const fields = {summary:'Восстановить доступ', description:'Доступ к тестовому сервису прерван.'};
        const questions = [{id:'env', text:'В какой среде произошёл сбой?', required:true}];
        const call = {id:'update_1', name:'update_task', arguments:{fields}};
        const responses = [
            JSON.stringify({text:'', toolCalls:[{...call, questions}]}),
            JSON.stringify({text:'', toolCalls:[{...call, arguments:{fields, questions}}]}),
            'Известные факты:\n1. Доступ прерван.\nВ какой среде (DEV, TEST, PREPROD) произошёл сбой?'
        ];
        records.cardAtRequest = [];
        records.instance = new Gadget({getGadgetContentEl:() => window.jQuery('#ticket-assistant')}, {
            api:records.api, storage:null,
            requestText:async () => {
                records.cardAtRequest.push(records.instance.controller.getState().draft.fields.summary || null);
                return {text:responses.shift()};
            }
        });
        await records.instance.ready;
        await records.instance.controller.selectProject('DEMO');
        await records.instance.controller.selectIssueType('10');
        await records.instance.controller.selectTemplate('task');
    });
    await send('Доступ к сервису прерван. Нужно его восстановить.');
    assert.deepEqual(await page.evaluate(() => window.taPreview.cardAtRequest), [null, null, 'Восстановить доступ']);
    assert.match(await page.locator('[data-ta-card-field="description"]').innerText(), /Доступ к тестовому сервису/);
    assert.match(await page.locator('[data-ta-chat-log]').innerText(), /В какой среде \(DEV, TEST, PREPROD\)/);
    assert.equal(await page.locator('[data-ta-chat-error]').isVisible(), false);
    assert.equal(await page.locator('[data-ta-card-create]').isDisabled(), true);
    assert.deepEqual(errors, []);
});

test('default shared bridge identifies missing/invalid configuration before HTTP and opens connection settings',async t=>{
    const {page,errors}=await browserFixture(t);
    for(const mode of ['missing','invalid','throwing']) {
        await page.evaluate(async mode=>{
            const records=window.taPreview,Gadget=window.taRequire('_ujgTicketAssistantRuntime');records.configFetches=0;
            records.instance=new Gadget({getGadgetContentEl:()=>window.jQuery('#ticket-assistant')},{api:records.api,storage:null,
                readConfig:()=>{if(mode==='throwing')throw Error('PRIVATE_CONFIG synthetic-secret');return mode==='missing'?null:{apiBase:'not a URL',model:'offline',apiKey:'synthetic-secret'};},
                fetchImpl:()=>{records.configFetches++;throw Error('PRIVATE_PROVIDER_BODY');}});
            await records.instance.ready;await records.instance.controller.selectProject('DEMO');await records.instance.controller.selectIssueType('10');await records.instance.controller.selectTemplate('task');
        },mode);
        await page.locator('[data-ta-chat-input]').fill('Сохранить запрос при ошибке конфигурации');await page.locator('[data-ta-chat-input]').press('Enter');
        await page.waitForFunction(()=>window.taPreview.instance.chat.getState().status==='error');
        assert.equal(await page.evaluate(()=>window.taPreview.configFetches),0);
        const publicState=await page.evaluate(()=>window.taPreview.instance.chat.getState());assert.equal(publicState.error.code,'config');
        assert.doesNotMatch(JSON.stringify(publicState),/PRIVATE_|synthetic-secret/);
        await page.locator('[data-ta-chat-configure]').click();assert.equal(await page.locator('[data-ta-connection-dialog]').isVisible(),true);
        await page.locator('[data-ta-connection-cancel]').click();
    }
    assert.deepEqual(errors,[]);
});

test('chat turn usage allowlists numeric accounting, omits secrets, resets scope and never replays after reload',async()=>{
    const h=await harness(),Tools=loadUnit('chat-tools',{_ujgTA_fields:h.fields}),Chat=loadUnit('chat',{_ujgTA_chatTools:Tools,_ujgTA_draft:h.drafts},{AbortController});
    const runtime={createSession:config=>({prompt:async()=>{
        config.onEvent({type:'done',status:'complete',usage:{modelCalls:2,toolCalls:1,inputTokens:1234,outputTokens:222,compactions:0,elapsedMs:15,
            apiKey:'PRIVATE_USAGE',headers:{Authorization:'Bearer synthetic-secret'}}});
        return {status:'complete'};
    },getMessages:()=>[],dispose(){},abort(){}})};
    const chat=Chat.create({controller:h.controller,runtime,requestText:()=>{throw Error('No HTTP');}});
    try {
        await chat.send('Accounting');
        assert.deepEqual(JSON.parse(JSON.stringify(chat.getState().lastTurnUsage)),{modelCalls:2,toolCalls:1,inputTokens:1234,outputTokens:222,compactions:0,elapsedMs:15,status:'complete'});
        assert.doesNotMatch(JSON.stringify(chat.getState()),/PRIVATE_USAGE|synthetic-secret/);
        chat.destroy();
        const restored=Chat.create({controller:h.controller,runtime:{createSession:()=>{throw Error('Must not replay');}}});
        assert.equal(restored.getState().lastTurnUsage,null);restored.destroy();
    } finally {chat.destroy();h.controller.destroy();}
});

test('default chat token popover reflects growing actual Pico turns instead of unchanged manual preflight',async t=>{
    const {page,errors,send}=await browserFixture(t);
    await page.evaluate(async()=>{
        const records=window.taPreview,Gadget=window.taRequire('_ujgTicketAssistantRuntime'),shared=window.taRequire('_ujgTA_llmClient');records.estimates=[];
        records.instance=new Gadget({getGadgetContentEl:()=>window.jQuery('#ticket-assistant')},{api:records.api,storage:null,requestText:request=>{
            records.estimates.push(shared.estimateTokens(request.system)+shared.estimateTokens(request.user)+32);
            return Promise.resolve({text:JSON.stringify({text:'Подробное пояснение к вопросу. '.repeat(140),toolCalls:[]})});
        }});
        await records.instance.ready;await records.instance.controller.selectProject('DEMO');await records.instance.controller.selectIssueType('10');await records.instance.controller.selectTemplate('task');
        records.manualEstimate=records.instance.controller.getState().tokenPreflight.input;
    });
    await page.locator('[data-ta-tokens]').click();
    assert.match(await page.locator('[data-ta-token-summary]').innerText(),/Pico.*32768/);
    assert.match(await page.locator('[data-ta-token-breakdown]').innerText(),/4096/);
    await send('Первый вопрос');const first=await page.locator('[data-ta-token-usage]').innerText();
    await send('Второй вопрос с предыдущим ответом');
    const {estimates,manualEstimate,currentManual,usage}=await page.evaluate(()=>({estimates:window.taPreview.estimates,manualEstimate:window.taPreview.manualEstimate,
        currentManual:window.taPreview.instance.controller.getState().tokenPreflight.input,usage:window.taPreview.instance.chat.getState().lastTurnUsage}));
    assert.equal(estimates.length,2);assert.ok(estimates[1]>estimates[0]);assert.equal(currentManual,manualEstimate);
    assert.equal(usage.inputTokens,estimates[1]);assert.equal(usage.modelCalls,1);
    const second=await page.locator('[data-ta-token-usage]').innerText();assert.notEqual(second,first);
    assert.match(second,new RegExp('вход '+estimates[1]));assert.match(second,/сумма|Сумма/);assert.match(second,/оценка/);
    assert.doesNotMatch(second,/Точно по usage|Текст 0/);assert.deepEqual(errors,[]);
});

test('default chat visibly retries an initial Jira projects failure without resending a message',async t=>{
    const {page,errors}=await browserFixture(t);
    await page.evaluate(async()=>{
        const records=window.taPreview,read=records.api.getProjects;
        records.jiraAttempts=0;
        const api=Object.assign({},records.api,{getProjects:()=>{
            records.jiraAttempts++;
            return records.jiraAttempts===1?Promise.reject(new Error('Transient Jira read')):read();
        }});
        const Gadget=window.taRequire('_ujgTicketAssistantRuntime');
        records.instance=new Gadget({getGadgetContentEl:()=>window.jQuery('#ticket-assistant')},{api,storage:null,
            requestText:()=>{throw new Error('LLM must not be called by Jira retry');}});
        await records.instance.ready;
    });
    assert.equal(await page.evaluate(()=>window.taPreview.instance.controller.getState().draft),null);
    assert.equal(await page.locator('[data-ta-jira-retry]').isVisible(),true);
    assert.equal(await page.locator('[data-ta-editor-panel]').isHidden(),true);
    await page.locator('[data-ta-jira-retry]').click();
    await page.waitForFunction(()=>window.taPreview.jiraAttempts===2 && window.taPreview.instance.controller.getState().projects.length>0);
    assert.equal(await page.locator('[data-ta-jira-retry]').isHidden(),true);
    assert.equal(await page.evaluate(()=>window.taPreview.instance.controller.getState().error),null);
    assert.equal(await page.evaluate(()=>window.taPreview.calls.filter(c=>c==='pico'||c==='create').length),0);
    assert.deepEqual(errors,[]);
});

test('card and protected replacements resolve metadata labels for single/multiple options with explicit ID fallback',t=>{
    const dom=new JSDOM('<div id="root"><div class="ta-layout"><header class="ta-header"><div class="ta-header-tools"></div></header></div></div>',{url:'https://jira.test/'});
    const {window}=dom,$=jquery(window),globals={window,document:window.document};
    const draft=loadUnit('draft').createDraft({projectKey:'DO'});draft.issueTypeId='10';draft.templateId='task';
    draft.fields={summary:'Title',description:'DO-9 is literal Jira text',components:[{id:'DO-9'}],fixVersions:[{id:'DO-v1'}],customfield_2:{id:'DO-1'},customfield_3:[{id:'DO-3'},{id:'obsolete'}]};
    draft.pendingFields={components:[{id:'DO-9'},{id:'missing'}],customfield_2:{id:'DO-2'}};
    const state={draft,meta:metadataFixture(),settings:loadUnit('profiles').createDefaults(),validation:null};
    const chat={getState:()=>({transcript:[],status:'idle',notices:[]})};
    const ui=loadUnit('chat-ui',{'_ujgTA_icons':loadUnit('icons',{},globals)},globals).create({$,controller:{getState:()=>state},chat,editor:{}});
    ui.mount(window.document.querySelector('#root'));t.after(()=>{ui.destroy();window.close();});
    const text=id=>window.document.querySelector('[data-ta-card-field="'+id+'"] .ta-card-value').textContent;
    assert.equal(text('components'),'Backend');assert.equal(text('fixVersions'),'1.0');assert.equal(text('customfield_2'),'TEST');
    assert.equal(text('customfield_3'),'Web, ID: obsolete');assert.equal(text('description'),'DO-9 is literal Jira text');
    const pending=window.document.querySelector('[data-ta-card-pending]').textContent;
    assert.match(pending,/Сейчас: Backend/);assert.match(pending,/Предложено: Backend, ID: missing/);assert.match(pending,/Сейчас: TEST/);assert.match(pending,/Предложено: TEST/);
});

async function browserFixture(t,width=1440) {
    const server=await startPreview({port:0}),browser=await chromium.launch({channel:'chrome',headless:true});
    t.after(async()=>{await browser.close();await server.close();});
    const page=await browser.newPage({viewport:{width,height:width===390?844:1000}}),errors=[],requests=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/*',route=>{
        const request=route.request();requests.push({url:request.url(),method:request.method()});
        return request.url().startsWith(server.url) && request.method()==='GET'?route.continue():route.abort();
    });
    await page.goto(server.url);await page.waitForSelector('html[data-ta-preview-ready="true"]');
    page.setDefaultTimeout(5000);
    async function send(text) {
        await page.locator('[data-ta-chat-input]').fill(text);await page.locator('[data-ta-chat-input]').press('Enter');
        await page.waitForFunction(()=>window.taPreview.instance.chat.getState().status==='error' || window.taPreview.instance.chat.getState().status!=='running' && document.querySelector('[data-ta-chat-input]').value==='');
        assert.equal(await page.evaluate(()=>window.taPreview.instance.chat.getState().error),null);
    }
    return {page,errors,requests,server,send,state:()=>page.evaluate(()=>window.taPreview.instance.controller.getState())};
}

for(const width of [1440,390])test('real Pico offline chat, editor, template, reload and one creation at '+width,async t=>{
    const {page,errors,requests,server,send,state}=await browserFixture(t,width);
    assert.equal(await page.locator('[data-ta-chat-input]').isVisible(),true);
    assert.equal(await page.locator('[data-ta-editor-panel]').isHidden(),true);
    await page.screenshot({path:'/tmp/ticket-assistant-chat-'+width+'-initial.png'});
    await send('При сохранении задача выдаёт ошибку API. <img src=x onerror=alert(1)>');
    assert.equal((await state()).draft.fields.summary,'Исправить ошибку API при сохранении');
    assert.equal(await page.locator('[data-ta-task-card]').count(),1);
    assert.equal(await page.locator('[data-ta-card-create]').isDisabled(),true);
    assert.match(await page.locator('[data-ta-card-questions]').innerText(),/среде/);
    assert.equal(await page.locator('[data-ta-chat-log] img').count(),0);
    await send('Тестовая среда, версия 2026.11. Сохранение должно завершиться без ошибки.');
    await send('Выбираю API');
    assert.equal(await page.locator('[data-ta-card-field="components"] .ta-card-value').innerText(),'API');
    assert.equal((await state()).validation.ok,true);
    assert.equal(await page.locator('[data-ta-card-create]').isEnabled(),true);
    await page.locator('[data-ta-chat-input]').fill('Неотправленный текст');
    await page.locator('[data-ta-card-edit]').click();
    const panel=page.locator('[data-ta-editor-panel]');assert.equal(await panel.isVisible(),true);
    assert.equal(await page.locator('[data-ta-editor-close]').evaluate(el=>document.activeElement===el),true);
    await page.locator('[data-ta-editor-close]').press('Shift+Tab');
    assert.equal(await panel.evaluate(el=>el.contains(document.activeElement)),true);
    const summary=page.locator('[data-ta-field="summary"] input');
    await summary.fill('Ручная тема API');await summary.press('Tab');
    assert.equal(await panel.evaluate(el=>el.getBoundingClientRect().top>=0),true);
    await page.screenshot({path:'/tmp/ticket-assistant-chat-'+width+'-editor.png'});
    await summary.press('Escape');assert.equal(await panel.isHidden(),true);
    assert.equal(await page.locator('[data-ta-card-edit]').evaluate(el=>document.activeElement===el),true);
    assert.equal(await page.locator('[data-ta-chat-input]').inputValue(),'Неотправленный текст');
    await send('Предложи другую тему');
    assert.equal((await state()).draft.fields.summary,'Ручная тема API');
    await page.locator('[data-ta-chat-accept="summary"]').click();
    assert.equal((await state()).draft.fields.summary,'Проверить обработку ошибок API');
    const description=(await state()).draft.fields.description;
    await send('Добавь критерий: повторное сохранение работает.');
    assert.equal(await page.locator('[data-ta-card-undo]').isEnabled(),true);
    await page.locator('[data-ta-card-undo]').click();
    assert.equal((await state()).draft.fields.description,description);
    await page.evaluate(async()=>{
        const c=window.taPreview.instance.controller,settings=c.getState().settings;
        settings.profiles[0].templates.find(t=>t.id==='task').instructions+='\n**Точный текст** `код` <b>без HTML</b> [ссылка](https://example.test/)';
        await c.applySettings(settings);
    });
    const exact=(await state()).settings.profiles[0].templates.find(t=>t.id==='task').instructions;
    await send('Покажи шаблон');
    assert.equal((await page.locator('[data-ta-chat-log]').innerText()).includes(exact),true);
    assert.equal(await page.locator('[data-ta-template-read] strong,[data-ta-template-read] a,[data-ta-template-read] b').count(),0);
    const revision=(await state()).settings.revision;
    await send('Измени шаблон: укажи среду проверки');
    assert.equal((await state()).settings.revision,revision);
    assert.equal(await page.locator('[data-ta-template-proposal]').isVisible(),true);
    assert.equal((await page.locator('[data-ta-template-before]').innerText()).includes(exact),true);
    assert.match(await page.locator('[data-ta-template-after]').innerText(),/Обязательно укажи среду проверки/);
    await page.locator('[data-ta-template-proposal]').screenshot({path:'/tmp/ticket-assistant-chat-'+width+'-template.png'});
    const descriptionBeforeApply=(await state()).draft.fields.description;
    await page.locator('[data-ta-template-apply]').click();
    await page.waitForFunction(revision=>window.taPreview.instance.controller.getState().settings.revision===revision+1,revision);
    await page.waitForFunction(()=>window.taPreview.instance.chat.getState().status!=='running');
    assert.equal((await state()).draft.templateReviewPending,false);
    assert.equal((await state()).draft.fields.description,descriptionBeforeApply,'semantic review must not append the internal review command');
    assert.doesNotMatch((await state()).draft.fields.description,/Проверь текущую задачу заново/);
    const transcriptCount=await page.locator('[data-ta-message]').count();
    await page.reload();await page.waitForSelector('html[data-ta-preview-ready="true"]');
    assert.equal(await page.locator('[data-ta-message]').count(),transcriptCount);
    assert.equal((await page.locator('[data-ta-template-read]').innerText()).includes(exact),true,'literal template display survives reload');
    assert.equal(await page.evaluate(()=>window.taPreview.chatRequests.length),0,'reload never invokes runtime or replays tools');
    await send('Подтверди готовность задачи.');
    await page.locator('[data-ta-card-create]').click();
    await page.waitForSelector('[data-ta-chat-issue-link]');
    assert.equal(await page.locator('[data-ta-card-create]').isDisabled(),true);
    assert.equal(await page.evaluate(()=>window.taPreview.calls.filter(c=>c==='create').length),1);
    assert.equal(await page.locator('[data-ta-task-card]').count(),1);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
    fs.mkdirSync('/tmp/ticket-assistant-chat',{recursive:true});
    await page.screenshot({path:'/tmp/ticket-assistant-chat/'+width+'-created.png',fullPage:true});
    assert.equal(await page.locator('[data-ta-chat-new]').isEnabled(),true);
    const createdId=(await state()).draft.id;
    await page.locator('[data-ta-chat-new]').click();
    await page.waitForFunction(id=>window.taPreview.instance.controller.getState().draft.id!==id,createdId);
    assert.equal(await page.locator('[data-ta-message]').count(),0);
    assert.equal(await page.locator('[data-ta-task-card]').count(),1);
    assert.equal(await page.evaluate(()=>window.taPreview.calls.filter(c=>c==='create').length),1);
    assert.deepEqual(errors,[]);assert.ok(requests.every(r=>r.method==='GET' && r.url.startsWith(server.url)));
});

test('real Pico stop ignores late results; retry preserves text; ambiguous options, rejected template and long text remain usable',async t=>{
    const {page,errors,send,state}=await browserFixture(t,390);
    const accessibility=await page.locator('body').ariaSnapshot();
    assert.doesNotMatch(accessibility,/Нет открытых вопросов|Исходные данные|Выбрать файлы/,'hidden manual form is absent from the accessibility tree');
    await page.evaluate(()=>{window.taPreview.chatMode='slow';});
    await page.locator('[data-ta-chat-input]').fill('Ошибка при сохранении API');await page.locator('[data-ta-chat-input]').press('Enter');
    await page.waitForFunction(()=>window.taPreview.instance.chat.getState().status==='running');
    const draft=(await state()).draft;
    await page.locator('[data-ta-chat-stop]').click();
    await page.waitForFunction(()=>window.taPreview.instance.chat.getState().status==='stopped');
    assert.equal(await page.locator('[data-ta-chat-input]').evaluate(el=>document.activeElement===el),true);
    await page.waitForTimeout(2400);
    assert.deepEqual((await state()).draft.fields,draft.fields,'aborted late tool call cannot mutate task');
    await page.evaluate(()=>{window.taPreview.chatMode='error';});
    await page.locator('[data-ta-chat-input]').fill('Повторный запрос');await page.locator('[data-ta-chat-input]').press('Enter');
    await page.waitForFunction(()=>window.taPreview.instance.chat.getState().status==='error');
    assert.equal(await page.locator('[data-ta-chat-input]').inputValue(),'Повторный запрос');
    assert.equal(await page.locator('[data-ta-chat-error]').isVisible(),true);
    await page.evaluate(()=>{window.taPreview.chatMode='normal';});
    await page.locator('[data-ta-chat-retry]').click();
    await page.waitForFunction(()=>window.taPreview.instance.chat.getState().status==='idle' && !document.querySelector('[data-ta-chat-input]').value);
    await send('Тестовая среда, версия 2026.11');
    await send('Какой компонент выбрать?');
    assert.match(await page.locator('[data-ta-chat-log]').innerText(),/API, Интерфейс, Инфраструктура/);
    await send('Выбираю API');assert.deepEqual((await state()).draft.fields.components,[{id:'31'}]);
    const revision=(await state()).settings.revision;
    await send('Измени шаблон: укажи среду проверки');await page.locator('[data-ta-template-reject]').click();
    assert.equal((await state()).settings.revision,revision);
    assert.equal(await page.locator('[data-ta-template-proposal]').isHidden(),true);
    assert.equal(await page.locator('[data-ta-chat-input]').evaluate(el=>document.activeElement===el),true);
    await send('Добавь длинный критерий: '+ 'ПроверкаОченьДлинногоСлова'.repeat(120));
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
    await page.locator('[data-ta-fullscreen]').click();assert.equal(await page.locator('.ta-fullscreen').count(),1);
    await page.locator('[data-ta-chat-input]').press('Escape');assert.equal(await page.locator('.ta-fullscreen').count(),0);
    assert.deepEqual(errors,[]);
});

test('default main bridges full Pico prompts and cancellation to the configured shared legacy transport',async t=>{
    const {page,errors}=await browserFixture(t);
    await page.evaluate(async()=>{
        const Gadget=window.taRequire('_ujgTicketAssistantRuntime'),records=window.taPreview;
        records.bridge=[];
        records.instance=new Gadget({getGadgetContentEl:()=>window.jQuery('#ticket-assistant')},{api:records.api,storage:null,
            readConfig:()=>({apiBase:'https://offline.invalid/v1',apiKey:'synthetic-bridge-key',model:'offline-model',basePrompt:'Saved context',useLegacyCompletionsEndpoint:true}),
            fetchImpl:async(url,config)=>{
                records.bridge.push({url,body:JSON.parse(config.body),signal:config.signal instanceof AbortSignal});
                return {ok:true,status:200,text:async()=>JSON.stringify({choices:[{text:JSON.stringify({text:'Сведения приняты.',toolCalls:[]})}]})};
            }});
        await records.instance.ready;await records.instance.controller.selectProject('DEMO');await records.instance.controller.selectIssueType('10');await records.instance.controller.selectTemplate('task');
        const settings=records.instance.controller.getState().settings;settings.tokenBudget={context:131072,reserve:4096};await records.instance.controller.applySettings(settings);
    });
    const source='PreserveCompletePrompt'.repeat(2200);
    await page.locator('[data-ta-chat-input]').fill(source);await page.locator('[data-ta-chat-input]').press('Enter');
    await page.waitForFunction(()=>window.taPreview.instance.chat.getState().status==='error' || window.taPreview.instance.chat.getState().status!=='running' && !document.querySelector('[data-ta-chat-input]').value);
    assert.equal(await page.evaluate(()=>window.taPreview.instance.chat.getState().error),null);
    const bridge=await page.evaluate(()=>window.taPreview.bridge);
    assert.equal(bridge.length,1);assert.equal(bridge[0].signal,true);
    assert.equal(bridge[0].url,'https://offline.invalid/v1/completions');
    assert.equal(bridge[0].body.prompt.includes(source),true,'shared defaults must not truncate the >42KB user prompt');
    assert.equal(bridge[0].body.prompt.includes('Available tools (JSON Schema)'),true);
    assert.equal(bridge[0].body.prompt.includes('synthetic-bridge-key'),false);
    assert.deepEqual(errors,[]);
});

test('old form drafts migrate into the chat card without invoking Pico',async t=>{
    const {page,server,errors}=await browserFixture(t,390);
    await page.goto(server.url+'?form=1');await page.waitForSelector('html[data-ta-preview-ready="true"]');
    await page.locator('[data-ta-source]').fill('Сохранённый исходник старой формы');
    await page.locator('[data-ta-field="summary"] input').fill('Ручной старый черновик');
    await page.goto(server.url);await page.waitForSelector('html[data-ta-preview-ready="true"]');
    assert.equal(await page.locator('[data-ta-card-field="summary"]').innerText(),'Тема\nРучной старый черновик');
    assert.match(await page.locator('.ta-chat-intro').innerText(),/Черновик восстановлен/);
    assert.equal(await page.locator('[data-ta-message]').count(),0);
    assert.equal(await page.evaluate(()=>window.taPreview.chatRequests.length),0);
    await page.locator('[data-ta-chat-input]').fill('Первая строка');await page.locator('[data-ta-chat-input]').press('Shift+Enter');
    assert.equal(await page.locator('[data-ta-chat-input]').inputValue(),'Первая строка\n');
    assert.deepEqual(errors,[]);
});

for(const outcome of ['rejected','lostresponse'])test('chat shows '+outcome+' creation outcome and preserves the duplicate guard',async t=>{
    const {page,send,state,errors}=await browserFixture(t);
    await send('Ошибка API при сохранении');await send('Тестовая среда, версия 2026.11');
    await page.locator('[data-ta-preview-scenario="'+outcome+'"]').click();await page.locator('[data-ta-card-create]').click();
    const status=outcome==='rejected'?'rejected':'unknown';
    await page.waitForFunction(status=>window.taPreview.instance.controller.getState().draft.creation.status===status,status);
    assert.equal(await page.locator('[data-ta-card-create]').isDisabled(),true);
    assert.equal(await page.evaluate(()=>window.taPreview.calls.filter(c=>c==='create').length),1);
    if(status==='unknown') {
        assert.match(await page.locator('[data-ta-card-reason]').innerText(),/неизвестен/);
        assert.equal(await page.locator('[data-ta-chat-new]').isDisabled(),true);
        await page.locator('[data-ta-card-edit]').click();assert.equal(await page.locator('[data-ta-reconcile]').isVisible(),true);
    } else assert.match(await page.locator('[data-ta-card-creation]').innerText(),/отклон/);
    assert.equal((await state()).draft.creation.status,status);assert.deepEqual(errors,[]);
});

test('chat keeps one canonical card, safe message text, composer and proposal focus across updates', async t => {
    const dom=new JSDOM('<div id="root"><div class="ta-layout"><header class="ta-header"><div class="ta-header-tools"></div></header></div></div>',{url:'https://jira.test/'});
    const {window}=dom,$=jquery(window),globals={window,document:window.document};
    const draft=loadUnit('draft').createDraft({projectKey:'DO'});draft.issueTypeId='10';draft.fields={summary:'Title',description:'h2. Exact Jira text'};
    const state={draft,meta:metadataFixture(),validation:{ok:false,fieldErrors:{summary:['Missing detail']}},settings:loadUnit('profiles').createDefaults()};
    const chatState={transcript:[{id:'1',role:'assistant',text:'**Pico** <img src=x onerror=alert(1)>'}],status:'idle',pendingTemplateProposal:null,canUndo:false};
    const sent=[];const chat={getState:()=>chatState,send:async text=>{sent.push(text);},stop(){},undo(){},applyTemplateProposal(){},rejectTemplateProposal(){}};
    const ui=loadUnit('chat-ui',{'_ujgTA_icons':loadUnit('icons',{},globals)},globals).create({$,controller:{getState:()=>state},chat,editor:{openEditor(){}},baseUrl:'/jira'});
    ui.mount(window.document.querySelector('#root'));t.after(()=>{ui.destroy();window.close();});
    const card=window.document.querySelector('[data-ta-task-card]'),composer=window.document.querySelector('[data-ta-chat-input]');
    assert.equal(window.document.querySelectorAll('[data-ta-task-card]').length,1);
    assert.equal(window.document.querySelector('[data-ta-chat-log] img'),null);
    assert.equal(window.document.querySelector('[data-ta-chat-log] strong').textContent,'Pico');
    composer.focus();composer.value='Unsent text';composer.setSelectionRange(2,2);
    chatState.transcript.push({id:'2',role:'assistant',text:'Next question'});ui.update(state);
    assert.equal(window.document.activeElement,composer);assert.equal(composer.value,'Unsent text');assert.equal(composer.selectionStart,2);
    assert.equal(window.document.querySelector('[data-ta-task-card]'),card);
    chatState.pendingTemplateProposal={before:{instructions:'old <b>',issueTypeId:'10'},after:{instructions:'new <b>',issueTypeId:'10'}};ui.update(state);
    const apply=window.document.querySelector('[data-ta-template-apply]');apply.focus();ui.update(state);assert.equal(window.document.activeElement,apply);
    assert.equal(window.document.querySelector('[data-ta-template-before]').textContent.includes('old <b>'),true);
    composer.focus();composer.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));await new Promise(resolve=>setImmediate(resolve));
    assert.deepEqual(sent,['Unsent text']);assert.equal(composer.value,'');
});

test('retained manual editor opens as a focus-contained panel and restores the invoking button', t => {
    const dom = new JSDOM('<div id="root"></div>', {url:'https://jira.test/'});
    const {window} = dom, $ = jquery(window);
    const globals={window,document:window.document,navigator:window.navigator,URL,AbortController,setInterval,clearInterval};
    const icons=loadUnit('icons',{},globals);
    const fieldUi=loadUnit('field-ui',{'_ujgTA_icons':icons,'_ujgTA_fields':loadUnit('fields')},globals);
    const settingsUi=loadUnit('settings-ui',{'_ujgTA_profiles':loadUnit('profiles'),'_ujgTA_fieldUi':fieldUi,'_ujgTA_icons':icons},globals);
    const uiModule=loadUnit('ui',{'_ujgTA_fieldUi':fieldUi,'_ujgTA_icons':icons,'_ujgTA_settingsUi':settingsUi},globals);
    const draft=loadUnit('draft').createDraft({projectKey:'DO'});
    draft.issueTypeId='10';draft.templateId='task';draft.fields.summary='Manual title';
    const state={draft,meta:metadataFixture(),settings:loadUnit('profiles').createDefaults(),projects:[],stage:'idle',error:null,generationFieldIds:[],routeCandidates:[]};
    const ui=uiModule.create({$,controller:{getState:()=>state},panel:true});
    ui.mount(window.document.querySelector('#root'));
    t.after(()=>{ui.destroy();window.close();});
    const invoke=$('<button>Редактировать</button>').appendTo('#root')[0];invoke.focus();
    const panel=window.document.querySelector('[data-ta-editor-panel]');
    assert.ok(panel);assert.equal(panel.hidden,true);
    ui.openEditor(invoke);assert.equal(panel.hidden,false);
    assert.ok(panel.contains(window.document.activeElement));
    ui.openSettings();window.document.querySelector('[data-ta-settings-cancel]').click();
    assert.equal(window.document.querySelector('.ta-layout').inert,true,'closing API-opened settings retains the editor modal');
    assert.ok(panel.contains(window.document.activeElement));
    const close=panel.querySelector('[data-ta-editor-close]');close.focus();
    close.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
    assert.equal(panel.hidden,true);assert.equal(window.document.activeElement,invoke);
    assert.equal(window.document.querySelector('[data-ta-field="summary"] input').value,'Manual title');
});
