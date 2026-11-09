const test=require('node:test');
const assert=require('node:assert/strict');
const {loadUnit}=require('./helpers/ticket-assistant-fixture');
const {harness}=require('./helpers/ticket-assistant-chat-fixture');
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
const narrative='Восстановить доступ к сервису на DEV. Проверка: вход по RDP.';
const completeNarrative=narrative+'\nЦель: вернуть команде доступ для проверки сервиса.\nЧто сделать: восстановить доступ к сервису по RDP.\nГде: сервис на стенде DEV.\nКритерии приёмки: команда успешно входит по RDP.';
async function setup(t,mode='throw') {
    const h=await harness();
    const Tools=loadUnit('chat-tools',{_ujgTA_fields:h.fields});
    const Chat=loadUnit('chat',{_ujgTA_chatTools:Tools,_ujgTA_draft:h.drafts},{AbortController});
    const runtime=mode==='missing'?null:{createSession(config){return {
        async prompt(){
            if(typeof mode==='function')return mode(config);
            if(mode==='event'){config.onEvent({type:'error',code:'transport'});return {status:'error'};}
            throw Error('provider unavailable');
        },getMessages(){return [];},abort(){},dispose(){}
    };}};
    const chat=Chat.create({controller:h.controller,store:h.store,runtime});
    t.after(()=>{chat.destroy();h.controller.destroy();});
    return {...h,chat};
}
async function modelSetup(t,fields={summary:'Восстановить доступ к сервису на DEV.',description:completeNarrative},questions=[]) {
    const h=await setup(t);h.chat.destroy();
    const runtime=await import('../ujg-ticket-assistant-chat/runtime.mjs');
    const Chat=loadUnit('chat',{_ujgTA_chatTools:loadUnit('chat-tools',{_ujgTA_fields:h.fields}),_ujgTA_draft:h.drafts},{AbortController});
    const chat=Chat.create({controller:h.controller,store:h.store,runtime,requestText:async()=>({text:JSON.stringify({fields,missing:questions})})});
    t.after(()=>chat.destroy());return {...h,chat};
}
for(const mode of ['throw','event','missing'])for(const prefix of ['', 'Описание: '])
test('unavailable '+mode+' preserves fields except explicit description: '+prefix,async t=>{
    const h=await setup(t,mode),before=JSON.stringify(h.controller.getState().draft.fields);let creates=0;
    h.api.createIssue=async()=>{creates++;return {key:'DO-123'};};
    await h.chat.send(prefix+completeNarrative);const d=h.controller.getState().draft,chat=h.chat.getState();
    assert.equal(d.fields.description,prefix?completeNarrative:undefined);assert.equal(d.fields.summary,undefined);
    if(!prefix)assert.equal(JSON.stringify(d.fields),before);
    assert.equal(d.checked,null);assert.equal(h.store.load('DO').draft.checked,null);
    assert.equal(chat.status,'error');assert.ok(chat.error);assert.equal(creates,0);
    assert.equal(chat.transcript.filter(m=>m.role==='user')[0].text,prefix+completeNarrative);
    await h.controller.submit();assert.equal(creates,0);
});
test('failed direct description command preserves a manually entered summary',async t=>{
    const h=await setup(t);await h.controller.updateField('summary','Моя тема');
    await h.chat.send('Описание: '+completeNarrative);
    assert.equal(h.controller.getState().draft.fields.summary,'Моя тема');assert.equal(h.controller.getState().draft.checked,null);assert.ok(h.chat.getState().error);
});
for(const blocker of ['question','proposal','required','review','protected-empty'])
test('unavailability cannot bypass '+blocker,async t=>{
    const h=await setup(t),c=h.controller;
    if(blocker==='required'){
        const read=h.api.getCreateMeta;h.api.getCreateMeta=async(...args)=>{const raw=await read(...args);raw.projects[0].issuetypes.forEach(x=>x.fields.customfield_2.required=true);return raw;};
        await c.selectProject('DO');
    }
    if(blocker==='question')await c.chatUpdate({fields:{},questions:[{id:'template:goal',text:'Зачем нужна эта работа и какой результат она должна дать?',required:true}]},c.chatSnapshot());
    if(blocker==='proposal'){
        await c.updateField('summary','Моя тема');await c.chatUpdate({fields:{summary:'Предложение'}},c.chatSnapshot());
    }
    if(blocker==='protected-empty')await c.updateField('summary','');
    if(blocker==='review')await c.chatApplyTemplate({instructions:'Новые правила'},c.chatSnapshot());
    await h.chat.send('Описание: '+(blocker==='question'?narrative:completeNarrative));
    assert.equal(c.getState().draft.checked,null);
    if(blocker==='question')assert.ok(c.getState().draft.questions.some(q=>q.id==='template:goal'));
    if(blocker==='proposal')assert.equal(c.getState().draft.pendingFields.summary,'Предложение');
    if(blocker==='protected-empty')assert.equal(c.getState().draft.fields.summary,'');
    if(blocker==='review')assert.equal(c.getState().draft.templateReviewPending,true);
});
for(const command of ['Покажи шаблон','Измени шаблон: текст','Настрой подключение AI','Модель: example','URL: https://example.test','Покажи поля'])
test('unavailable command leaves task intact: '+command,async t=>{
    const h=await setup(t),before=JSON.stringify(h.controller.getState().draft);
    await h.chat.send(command);assert.equal(JSON.stringify(h.controller.getState().draft),before);
});
test('later narrative cannot silently replace a user description or check missed facts',async t=>{
    const h=await setup(t);await h.controller.updateField('description','Моё описание');
    await h.chat.send(narrative);
    assert.equal(h.controller.getState().draft.fields.description,'Моё описание');assert.equal(h.controller.getState().draft.checked,null);
});
test('malformed initial response leaves user facts in chat; reconciliation stays blocked',async t=>{
    const h=await setup(t,async config=>{config.onEvent({type:'error',code:'response'});return {status:'error'};});
    await h.chat.send(completeNarrative);
    assert.deepEqual(h.controller.getState().draft.fields,{});assert.equal(h.controller.getState().draft.checked,null);
    assert.equal(h.chat.getState().error.code,'response');assert.equal(h.chat.getState().error.action,'retry');
    const h2=await setup(t);await h2.chat.reconcile();assert.equal(h2.controller.getState().draft.checked,null);assert.ok(h2.chat.getState().error);
});

const greeted='Добрый день!\nНа стендах DEV, TEST и PREPROD приложение не запускается. Нужно восстановить запуск. Проверка: успешный вход.';
for(const failure of ['Pico HTTP 502','Invalid Pico text envelope'])for(const prefix of ['', 'Описание: '])
test('incomplete failed first turn does not extract or validate fields: '+failure+' / '+prefix,async t=>{
    const h=await setup(t,async()=>{throw Error(failure);});const before=h.controller.getState().draft;
    await h.chat.send(prefix+narrative);const d=h.controller.getState().draft;
    assert.equal(d.fields.description,prefix?narrative:undefined);assert.equal(d.source,prefix?prefix+narrative:before.source);
    assert.equal(d.fields.summary,undefined);assert.equal(d.checked,null);
    assert.equal(h.chat.getState().status,'error');assert.equal(h.chat.getState().error.action,'retry');
    assert.equal(h.chat.getState().transcript.filter(m=>m.role==='user').at(-1).text,prefix+narrative);
});
async function requireEstimate(h) {
    const read=h.api.getCreateMeta;
    h.api.getCreateMeta=async(...args)=>{const raw=await read(...args);for(const type of raw.projects[0].issuetypes)
        type.fields.timetracking={name:'Оценка трудозатрат',required:true,schema:{type:'timetracking',system:'timetracking'}};
        return raw;};
    await h.controller.selectProject('DO');
}
async function restoreMalformed(t,h,texts) {
    h.chat.destroy();const id=h.controller.getState().draft.id;
    const previous=h.store.loadConversation('DO',id);
    h.store.saveConversation('DO',id,{transcript:texts.map((text,i)=>({id:'legacy-'+i,role:'user',text})),messages:[],pendingTemplateProposal:null,notices:[]},previous?.revision || 0);
    const runtime=await import('../ujg-ticket-assistant-chat/runtime.mjs');
    const Tools=loadUnit('chat-tools',{_ujgTA_fields:h.fields});
    const Chat=loadUnit('chat',{_ujgTA_chatTools:Tools,_ujgTA_draft:h.drafts},{AbortController});
    let calls=0;
    const chat=Chat.create({controller:h.controller,store:h.store,runtime,requestText:async()=>{calls++;return {text:JSON.stringify({text:'EVIL',toolCalls:[
        {id:'write',name:'update_task',arguments:{fields:{summary:'EVIL',description:'EVIL',timetracking:{originalEstimate:'1h'}},questions:[]}},
        {id:'create',name:'create_issue',arguments:{}}]})};}});
    t.after(()=>chat.destroy());return {chat,calls:()=>calls};
}
for(const restored of [false,true])test('greeted narrative is retained without filling fields or estimate; restored duplicates='+restored,async t=>{
    const h=await setup(t);await requireEstimate(h);
    const r=await restoreMalformed(t,h,restored?[greeted,greeted,greeted]:[]),before=h.controller.getState().draft;
    if(restored)await r.chat.reconcile();else await r.chat.send(greeted);
    const d=h.controller.getState().draft,s=r.chat.getState();
    assert.deepEqual(d.fields,before.fields);assert.equal(d.source,before.source);assert.equal(d.checked,null);
    assert.equal(s.status,'error');assert.equal(s.error.action,'retry');assert.doesNotMatch(JSON.stringify(s.transcript),/EVIL|Проверка пройдена/);
    assert.equal(s.transcript.filter(m=>m.role==='user').length,restored?3:1);assert.equal(r.calls(),2);
    assert.equal(h.store.loadConversation('DO',d.id).value.transcript.filter(m=>m.role==='user').length,restored?3:1);
});
test('exact malformed retries collapse legacy user entries without creating a card',async t=>{
    const h=await setup(t),r=await restoreMalformed(t,h,[greeted,greeted,greeted]);
    await r.chat.send(greeted);
    assert.equal(r.chat.getState().transcript.filter(m=>m.role==='user').length,1);
    assert.equal(h.controller.getState().draft.source,'');
    await r.chat.send(greeted);
    assert.equal(r.chat.getState().transcript.filter(m=>m.role==='user').length,1);
    assert.equal(h.controller.getState().draft.source,'');
});
test('the same short answer to successive assistant questions stays visible',async t=>{
    let turn=0;
    const h=await setup(t,async config=>{config.onEvent({type:'assistant',text:++turn===1?'Проверить TEST?':'Проверить DEV?'});});
    await h.chat.send('Да');await h.chat.send('Да');
    assert.deepEqual(h.chat.getState().transcript.filter(m=>m.role==='user').map(m=>m.text),['Да','Да']);
});
test('failed greeting-like narrative remains verbatim without deriving a summary',async t=>{
    const text='Приветствие не отображается на странице входа. Исправить текст.',h=await setup(t);await h.chat.send(text);
    assert.equal(h.controller.getState().draft.fields.summary,undefined);assert.equal(h.chat.getState().transcript[0].text,text);
    assert.ok(h.chat.getState().error);
});
test('missing estimate answer still requires a structured model response',async t=>{
    const h=await setup(t);await requireEstimate(h);const r=await restoreMalformed(t,h,[completeNarrative]);
    await r.chat.reconcile();const before=h.controller.getState().draft,calls=r.calls();await r.chat.send('Оценка: 2 часа');
    assert.equal(r.calls(),calls+2);assert.deepEqual(h.controller.getState().draft.fields,before.fields);
    assert.equal(h.controller.getState().draft.fields.timetracking,undefined);assert.equal(h.controller.getState().draft.checked,null);
    assert.equal(r.chat.getState().error.action,'retry');assert.equal(r.chat.getState().transcript.at(-1).text,'Оценка: 2 часа');
});
test('malformed recovery preserves protected summary and pending replacement',async t=>{
    const h=await setup(t),c=h.controller;
    await c.updateField('summary','Ручная тема');await c.chatUpdate({fields:{summary:'Предложенная тема'}},c.chatSnapshot());
    const r=await restoreMalformed(t,h,[greeted,greeted,greeted]);await r.chat.reconcile();
    const d=c.getState().draft;assert.equal(d.fields.summary,'Ручная тема');assert.equal(d.pendingFields.summary,'Предложенная тема');
    assert.equal(d.protectedFields.summary,true);assert.equal(d.checked,null);assert.equal(d.fields.description,undefined);
    assert.equal(r.chat.getState().error.action,'retry');
});
test('failed recovery creates no field changes or undo entry',async t=>{
    const h=await setup(t),r=await restoreMalformed(t,h,[greeted]);const before=h.controller.getState().draft;
    await r.chat.reconcile();assert.equal(r.chat.getState().canUndo,false);
    assert.deepEqual(h.controller.getState().draft.fields,before.fields);assert.equal(h.controller.getState().draft.source,before.source);
    assert.equal(r.chat.getState().transcript.filter(m=>m.role==='user').length,1);
});
for(const texts of [[greeted,'Не трогайте DEV, работать только на TEST'],['Покажи шаблон'],['Добрый день!']])
test('restored reconciliation cannot seed from ambiguous, command or greeting evidence: '+texts.join(' / '),async t=>{
    const h=await setup(t),r=await restoreMalformed(t,h,texts),before=JSON.stringify(h.controller.getState().draft.fields);
    await r.chat.reconcile();assert.equal(JSON.stringify(h.controller.getState().draft.fields),before);
    assert.equal(h.controller.getState().draft.checked,null);assert.ok(r.chat.getState().error);
});
for(const guard of ['description','question','review','exception'])test('restored malformed recovery preserves semantic guard '+guard,async t=>{
    const h=await setup(t),c=h.controller;
    if(guard==='description')await c.updateField('description','Ручное описание');
    if(guard==='question')await c.chatUpdate({fields:{},questions:[{id:'q',text:'Какие стенды?',required:true}]},c.chatSnapshot());
    if(guard==='review')await c.chatApplyTemplate({instructions:'Новые правила'},c.chatSnapshot());
    if(guard==='exception')await c.chatUpdate({fields:{},taskException:'Не проверять доступ'},c.chatSnapshot());
    const r=await restoreMalformed(t,h,[greeted,greeted,greeted]),before=JSON.stringify(c.getState().draft.fields);
    await r.chat.reconcile();assert.equal(JSON.stringify(c.getState().draft.fields),before);assert.equal(c.getState().draft.checked,null);
});
test('late failed provider cannot change a newer manual edit',async t=>{
    const gate=deferred();const h=await setup(t,async()=>{await gate.promise;throw Error('transport');});
    const sending=h.chat.send(narrative);await new Promise(r=>setImmediate(r));
    await h.controller.updateField('summary','Новая ручная тема');gate.resolve();await sending;
    assert.equal(h.controller.getState().draft.fields.summary,'Новая ручная тема');assert.equal(h.controller.getState().draft.checked,null);
    assert.equal(h.controller.getState().draft.fields.description,undefined);
});
test('Jira preflight network error does not become successful create',async t=>{
    const h=await modelSetup(t);let creates=0;h.api.createIssue=async()=>{creates++;return {key:'DO-1'};};
    await h.chat.send(completeNarrative);assert.ok(h.controller.getState().draft.checked);
    h.api.getCreateMeta=async()=>{throw Error('Jira unavailable');};await h.controller.submit();
    assert.equal(creates,0);assert.equal(h.controller.getState().draft.creation.issueKey,null);
    assert.ok(h.controller.getState().draft.creation.error);
});

test('plain API incident narrative is task data, not a connection command',async t=>{
    let calls=0;const text='Исправить API на DEV. Проверка: ответ 200.';
    const h=await setup(t,async()=>{calls++;throw Error('Pico HTTP 502');});await h.chat.send(text);
    assert.equal(calls,1);assert.deepEqual(h.controller.getState().draft.fields,{});assert.equal(h.controller.getState().draft.checked,null);
    assert.equal(h.chat.getState().error.code,'transport');assert.equal(h.chat.getState().transcript[0].text,text);
});
for(const failure of ['transport','response'])for(const cancel of ['stop','edit','switch','destroy'])test('failed model never starts a Jira relation check before cancellation: '+cancel+' turn after '+failure,async t=>{
    const gate=deferred(),h=await setup(t,async()=>{await gate.promise;throw Error(failure==='response'?'Invalid Pico text envelope':'provider unavailable');}),c=h.controller;
    const read=h.api.getCreateMeta;h.api.getCreateMeta=async(...args)=>{const raw=await read(...args);raw.projects[0].issuetypes.forEach(x=>x.fields.customfield_923={name:'Epic',schema:{type:'any',custom:'com.pyxis.greenhopper.jira:gh-epic-link'}});return raw;};
    await c.selectProject('DO');await c.updateField('customfield_923','DO-42');let checks=0;h.api.getEpic=async()=>{checks++;return {id:'DO-42',label:'Epic'};};
    const sending=h.chat.send(completeNarrative);await new Promise(r=>setImmediate(r));
    if(cancel==='stop')h.chat.stop();if(cancel==='edit')await c.updateField('summary','Моя новая тема');
    if(cancel==='switch')await c.selectProject('APP');if(cancel==='destroy')h.chat.destroy();gate.resolve();await sending;
    assert.equal(checks,0);assert.equal(c.getState().draft.checked,null);
    assert.ok(!h.chat.getState().transcript.some(m=>/Проверка пройдена/.test(m.text)));
});
test('failed model cannot authorize readiness through Jira relation checks',async t=>{
    const h=await setup(t),c=h.controller,read=h.api.getCreateMeta;
    h.api.getCreateMeta=async(...args)=>{const raw=await read(...args);raw.projects[0].issuetypes.forEach(x=>x.fields.customfield_923={name:'Epic',schema:{type:'any',custom:'com.pyxis.greenhopper.jira:gh-epic-link'}});return raw;};
    await c.selectProject('DO');await c.updateField('customfield_923','DO-42');
    h.api.getEpic=async()=>{throw Error('Jira unavailable');};await h.chat.send(completeNarrative);
    assert.equal(c.getState().draft.checked,null);assert.ok(!h.chat.getState().transcript.some(m=>/Проверка пройдена/.test(m.text)));
});
test('concurrent send is ignored while a failed model turn settles',async t=>{
    const gate=deferred();let calls=0;const h=await setup(t,async()=>{calls++;await gate.promise;throw Error('transport');});
    const sending=h.chat.send(completeNarrative);await h.chat.send('Другой запрос');gate.resolve();await sending;
    assert.equal(calls,1);assert.equal(h.controller.getState().draft.fields.description,undefined);
    assert.equal(h.chat.getState().transcript.filter(m=>m.role==='user').length,1);assert.equal(h.controller.getState().draft.checked,null);assert.ok(h.chat.getState().error);
});

test('structured model update makes READY card available only for explicit create',async t=>{
    const {JSDOM}=require('jsdom'),jquery=require('jquery');
    const h=await modelSetup(t),dom=new JSDOM('<div id="root"><div class="ta-layout"><header class="ta-header"><div class="ta-header-tools"></div></header></div></div>',{url:'https://jira.test/'});
    const window=dom.window,$=jquery(window),globals={window,document:window.document};let creates=0;
    h.api.createIssue=async()=>{creates++;return {id:'123',key:'DO-123'};};
    await h.chat.send(completeNarrative);assert.equal(h.chat.getState().error,null);
    const ui=loadUnit('chat-ui',{_ujgTA_icons:loadUnit('icons',{},globals)},globals).create({$,controller:h.controller,chat:h.chat,editor:{openEditor(){}}});
    ui.mount(window.document.querySelector('#root'));t.after(()=>{ui.destroy();window.close();});
    const button=window.document.querySelector('[data-ta-card-create]');assert.equal(button.disabled,false);
    assert.equal(window.document.querySelector('[data-ta-chat-error]').hidden,true);
    assert.doesNotMatch(window.document.querySelector('[data-ta-chat-status]').textContent,/Не удалось получить ответ/);
    assert.doesNotMatch(window.document.querySelector('[data-ta-chat-status]').textContent,/Остальные поля требуют проверки/);
    assert.match(window.document.querySelector('[data-ta-task-card-id]').textContent,/Готово к созданию/);assert.equal(creates,0);
    button.click();for(let i=0;i<50&&!creates;i++)await new Promise(r=>setImmediate(r));
    assert.equal(creates,1);
});

for(const questions of [[],undefined])test('successful description-only model response does not derive missing summary; questions='+JSON.stringify(questions),async t=>{
    const description=questions?completeNarrative:narrative;
    const h=await modelSetup(t,{description},questions || []);await h.chat.send(description);const s=h.controller.getState();
    assert.equal(s.draft.fields.summary,undefined);assert.equal(s.draft.fields.description,description);assert.equal(s.draft.source,description);
    assert.equal(s.draft.checked,null);assert.equal(s.validation.ok,false);assert.ok(s.validation.fieldErrors.summary);
    assert.equal(h.chat.getState().error,null);
});
test('successful model description does not replace manual summary',async t=>{
    const h=await modelSetup(t,{description:completeNarrative});
    await h.controller.updateField('summary','Моя тема');await h.chat.send(completeNarrative);
    assert.equal(h.controller.getState().draft.fields.description,completeNarrative);assert.equal(h.controller.getState().draft.source,completeNarrative);
    assert.equal(h.controller.getState().draft.fields.summary,'Моя тема');assert.ok(h.controller.getState().draft.checked);
});
test('direct description command does not hide failed provider response or authorize creation',async t=>{
    const h=await setup(t,async()=>{throw Error('Pico HTTP 502');});await h.chat.send('Описание: '+completeNarrative);
    const s=h.chat.getState();assert.equal(s.status,'error');assert.equal(s.error.action,'retry');assert.match(s.error.message,/HTTP 502/);
    assert.equal(h.controller.getState().draft.fields.description,completeNarrative);assert.equal(h.controller.getState().draft.fields.summary,undefined);
    assert.equal(h.controller.getState().draft.checked,null);assert.doesNotMatch(s.notices.join(' '),/прошла локальную проверку/);
});
test('unhandled later instruction cannot be lost when no earlier card fields were saved',async t=>{
    const h=await setup(t,async()=>({status:'complete'}));
    await h.chat.send('Укажите в задаче среду PREPROD');
    // The first completed provider turn did not save its input. A subsequent
    // failure must not make a card READY from only the latest message.
    const Tools=loadUnit('chat-tools',{_ujgTA_fields:h.fields});
    const Chat=loadUnit('chat',{_ujgTA_chatTools:Tools,_ujgTA_draft:h.drafts},{AbortController});
    h.chat.destroy();const chat=Chat.create({controller:h.controller,store:h.store,runtime:null});t.after(()=>chat.destroy());
    await chat.send(narrative);assert.equal(h.controller.getState().draft.checked,null);
});

for(const echo of [false,true])test('empty or unchanged model patch then 502 cannot check an unstored correction; echo='+echo,async t=>{
    const h=await setup(t,async config=>{
        await config.tools.find(x=>x.name==='update_task').execute({fields:echo?{description:completeNarrative}:{},questions:[]},{});
        throw Error('Pico HTTP 502');
    });const c=h.controller;
    await c.updateField('summary','Restart DEV');await c.updateField('description',completeNarrative);await c.chatValidate(c.chatSnapshot());
    assert.ok(c.getState().draft.checked);
    await h.chat.send('работать только на TEST, DEV не трогать');
    assert.equal(c.getState().draft.fields.description,completeNarrative);assert.equal(c.getState().draft.checked,null);
    assert.ok(!h.chat.getState().transcript.some(m=>/Проверка пройдена/.test(m.text)));
});
for(const command of ['Set API key: secret-test-token','Set API key to secret-test-token','API key: secret-test-token','Настрой подключение AI: secret-test-token'])
for(const modelWrite of [false,true])test('connection credential input never reaches ticket fields/source: '+command+', model write='+modelWrite,async t=>{
    let calls=0;const h=await setup(t,async config=>{
        calls++;
        if(modelWrite)await config.tools.find(x=>x.name==='update_task').execute({fields:{summary:command,description:command},questions:[]},{});
        throw Error('Pico HTTP 502');
    });
    const before=JSON.stringify(h.controller.getState().draft);await h.chat.send(command);
    assert.equal(JSON.stringify(h.controller.getState().draft),before);assert.equal(calls,0);
});

test('connection command preserves an already checked card and never invokes task model',async t=>{
    let calls=0;const h=await setup(t,async()=>{calls++;throw Error('transport');});const c=h.controller;
    await c.updateField('summary','Restart DEV');await c.updateField('description',completeNarrative);await c.chatValidate(c.chatSnapshot());
    const before=JSON.stringify(c.getState().draft);await h.chat.send('Set API key: secret-test-token');
    assert.equal(JSON.stringify(c.getState().draft),before);assert.equal(calls,0);
});
test('real runtime description-only success preserves missing summary and blocks readiness',async t=>{
    const h=await modelSetup(t,{description:completeNarrative});await h.chat.send(completeNarrative);
    const d=h.controller.getState().draft;assert.equal(h.chat.getState().error,null);assert.equal(d.fields.summary,undefined);
    assert.equal(d.fields.description,completeNarrative);assert.equal(d.source,completeNarrative);assert.equal(d.checked,null);
    assert.ok(h.controller.getState().validation.fieldErrors.summary);assert.doesNotMatch(h.chat.getState().transcript.at(-1).text,/Проверка пройдена/);
});

for(const command of ['Set API key: secret-test-token','Настрой подключение AI: secret-test-token'])
test('connection secret is never persisted or replayed in the next model turn: '+command,async t=>{
    let calls=0;const h=await setup(t,async config=>{
        calls++;assert.doesNotMatch(JSON.stringify(config.messages),/secret-test-token|Set API key|Настрой подключение AI/);
        assert.doesNotMatch(JSON.stringify(config.getContext()),/secret-test-token|Set API key|Настрой подключение AI/);
    });
    await h.chat.send(command);
    assert.doesNotMatch(JSON.stringify(h.chat.getState()),/secret-test-token/);
    const saved=h.store.loadConversation('DO',h.controller.getState().draft.id);
    assert.doesNotMatch(JSON.stringify(saved),/secret-test-token|Set API key|Настрой подключение AI/);
    await h.chat.send('Покажи поля');assert.equal(calls,1);
    assert.doesNotMatch(JSON.stringify(h.store.loadConversation('DO',h.controller.getState().draft.id)),/secret-test-token/);
});
for(const task of ['обнови модель данных','Update model relationships','Настрой подключение к Redis','Обнови настройки кеширования'])
test('ordinary task request is not hijacked as model connection setup: '+task,async t=>{
    let calls=0;const h=await setup(t,async config=>{
        calls++;await config.tools.find(x=>x.name==='update_task').execute({fields:{description:task},questions:[]},{});
    });await h.chat.send(task);assert.equal(calls,1);assert.equal(h.controller.getState().draft.fields.description,task);
});
for(const mode of ['throw','missing',async()=>{throw Error('Pico HTTP 502');}])
test('model failure remains an error without a fabricated recovery notice: '+String(mode),async t=>{
    const h=await setup(t,mode);await h.chat.send(completeNarrative);const s=h.chat.getState();
    assert.equal(s.status,'error');assert.ok(s.error);assert.doesNotMatch(s.notices.join(' '),/прошла локальную проверку/);
    assert.deepEqual(h.controller.getState().draft.fields,{});assert.equal(h.controller.getState().draft.checked,null);
});

const liveTraining='Учебный черновик. Обновить сервис demo-api в DEV до версии 1.0 из тега v1.0 в рабочее время. Поменять образ и перезапустить сервис. Постановщик проверит HTTP 200 на /health. Исходная оценка: 30 минут. Приоритет: Средний. Ссылки на репозиторий для примера нет.';
test('malformed live task retries retain one user turn and never extract fields',async t=>{
    const h=await setup(t),r=await restoreMalformed(t,h,[]),before=h.controller.getState().draft;
    await r.chat.send(liveTraining);await r.chat.send(liveTraining);await r.chat.send(liveTraining);
    const s=r.chat.getState(),d=h.controller.getState().draft;assert.deepEqual(d.fields,before.fields);assert.equal(d.source,before.source);
    assert.equal(s.transcript.filter(m=>m.role==='user').length,1);assert.equal(s.error.action,'retry');assert.equal(s.notices.length,0);
    const saved=h.store.loadConversation('DO',d.id).value;
    assert.equal(saved.transcript.filter(m=>m.role==='user').length,1);assert.equal(saved.messages.filter(m=>m.role==='user').length,1);
});
for(const manual of [false,true])test('failed model never repairs legacy placeholder or manual summary: '+manual,async t=>{
    const h=await setup(t),c=h.controller;
    await c.chatUpdate({fields:{summary:'Учебный черновик.',description:liveTraining},questions:[]},c.chatSnapshot(),liveTraining);
    if(manual)await c.updateField('summary','Ручная тема: сохранить demo-api');
    const r=await restoreMalformed(t,h,[liveTraining]);await r.chat.send(liveTraining);
    assert.equal(c.getState().draft.fields.summary,manual?'Ручная тема: сохранить demo-api':'Учебный черновик.');
    assert.equal(c.getState().draft.pendingFields.summary,undefined);
});

for(const modelQuestion of [false,true])test('restored raw DEVOPS failed retry preserves fields and model blockers without revalidation: '+modelQuestion,async t=>{
    const h=await setup(t),c=h.controller,read=h.api.getCreateMeta;
    h.api.getProjects=async()=>({values:[{key:'DEVOPS',id:'DO-project',name:'DEVOPS'}]});
    h.api.getCreateMeta=async key=>{const raw=await read(key);raw.projects[0].issuetypes.forEach(type=>{type.fields.priority={name:'Приоритет',schema:{type:'priority',system:'priority'},hasDefaultValue:true,defaultValue:{id:'medium'},allowedValues:[{id:'medium',name:'Средний'}]};});return raw;};
    h.api.checkDevopsIssue=async()=>({fieldErrors:{},warnings:[],link:null});
    await c.init();await c.selectProject('DEVOPS');await c.selectIssueType('12');
    const Tools=loadUnit('chat-tools',{_ujgTA_fields:h.fields}),Chat=loadUnit('chat',{_ujgTA_chatTools:Tools,_ujgTA_draft:h.drafts},{AbortController});
    const makeChat=()=>Chat.create({controller:c,store:h.store,runtime:{createSession(){return {prompt:async()=>{throw Error('Invalid Pico text envelope');},getMessages:()=>[],abort(){},dispose(){}};}}});
    let chat=makeChat();await chat.send(liveTraining);assert.equal(chat.getState().error.code,'response');assert.equal(c.getState().draft.fields.description,undefined);
    const draftId=c.getState().draft.id;chat.destroy();
    // Seed a genuinely legacy unformatted record; chatUpdate now formats new values.
    const legacy=h.store.load('DEVOPS');legacy.draft.fields.summary='Учебный черновик.';legacy.draft.fields.description=liveTraining;legacy.draft.source=liveTraining;
    legacy.draft.questions=modelQuestion?[{id:'model:question',text:'Нужно ли затронуть второй сервис?',required:true}]:[];
    assert.equal(h.store.save('DEVOPS',{draft:legacy.draft,settings:legacy.settings},legacy.revision).ok,true);
    await c.init();await c.selectProject('DEVOPS');chat=makeChat();t.after(()=>chat.destroy());
    assert.equal(c.getState().draft.id,draftId);
    await chat.send(liveTraining);const state=chat.getState(),d=c.getState().draft;
    assert.equal(d.fields.summary,'Учебный черновик.');assert.equal(d.fields.description,liveTraining);assert.equal(d.checked,null);assert.equal(d.source,liveTraining);
    assert.equal(state.transcript.filter(m=>m.role==='user').length,1);assert.equal(state.error.code,'response');assert.equal(state.status,'error');
    assert.equal(d.questions.some(q=>q.id==='model:question'),modelQuestion);assert.equal(state.notices.filter(n=>/формата/.test(n)).length,0);
});

for(const failure of ['malformed','502','429'])for(const existing of [false,true])
test('failed '+failure+' preserves '+(existing?'existing':'empty')+' fields and exact retry history',async t=>{
    const h=await setup(t);h.chat.destroy();
    if(existing){await h.controller.updateField('summary','Ручная тема');await h.controller.updateField('description','Ручное описание');}
    const beforeDraft=h.controller.getState().draft,before=JSON.stringify(beforeDraft.fields),runtime=await import('../ujg-ticket-assistant-chat/runtime.mjs');
    const Chat=loadUnit('chat',{_ujgTA_chatTools:loadUnit('chat-tools',{_ujgTA_fields:h.fields}),_ujgTA_draft:h.drafts},{AbortController});
    const chat=Chat.create({controller:h.controller,store:h.store,runtime,requestText:async()=>{
        if(failure!=='malformed')throw Error('Pico HTTP '+failure);
        return {text:JSON.stringify({text:'EVIL',toolCalls:[{id:'write',name:'update_task',arguments:{fields:{summary:'EVIL',description:'EVIL'}}},{id:'create',name:'create_issue',arguments:{}}]})};
    }});t.after(()=>chat.destroy());
    for(let i=0;i<3;i++){
        await chat.send(completeNarrative);
        const draft=h.controller.getState().draft;assert.equal(JSON.stringify(draft.fields),before);
        assert.deepEqual(draft.pendingFields,beforeDraft.pendingFields);assert.equal(draft.source,beforeDraft.source);
        assert.equal(draft.checked,null);
        assert.equal(chat.getState().status,'error');assert.equal(chat.getState().error.action,'retry');
        assert.equal(chat.getState().transcript.filter(m=>m.role==='user').length,1);
        const saved=h.store.loadConversation('DO',h.controller.getState().draft.id).value;
        assert.equal(saved.transcript.filter(m=>m.role==='user').length,1);
        assert.equal(saved.messages.filter(m=>m.role==='user').length,1);
        assert.doesNotMatch(JSON.stringify(chat.getState().transcript),/EVIL|Проверка пройдена/);
    }
});

test('Retry after list_fields then 502 preserves tool evidence and one model user message',async t=>{
    const h=await setup(t);h.chat.destroy();const runtime=await import('../ujg-ticket-assistant-chat/runtime.mjs');
    const Chat=loadUnit('chat',{_ujgTA_chatTools:loadUnit('chat-tools',{_ujgTA_fields:h.fields}),_ujgTA_draft:h.drafts},{AbortController});let calls=0;
    const chat=Chat.create({controller:h.controller,store:h.store,runtime,requestText:async()=>{
        if(++calls===1)return {text:JSON.stringify({text:'',toolCalls:[{id:'fields-once',name:'list_fields',arguments:{}}]})};
        throw Error('Pico HTTP 502');
    }});t.after(()=>chat.destroy());
    const text='Покажи поля';await chat.send(text);await chat.send(text);
    const saved=h.store.loadConversation('DO',h.controller.getState().draft.id).value;
    assert.equal(saved.transcript.filter(m=>m.role==='user').length,1);
    assert.equal(saved.messages.filter(m=>m.role==='user').length,1);
    assert.equal(saved.messages.filter(m=>m.role==='toolResult' && m.toolCallId==='fields-once').length,1);
    assert.equal(calls,3);assert.equal(chat.getState().error.action,'retry');
});

for(const failure of ['malformed','502','429'])test('failed '+failure+' shows Retry and clicking it preserves transcript and model history',async t=>{
    const h=await setup(t);h.chat.destroy();const runtime=await import('../ujg-ticket-assistant-chat/runtime.mjs');
    const {JSDOM}=require('jsdom'),jquery=require('jquery');
    const dom=new JSDOM('<div id="root"><div class="ta-layout"><header class="ta-header"><div class="ta-header-tools"></div></header></div></div>',{url:'https://jira.test/'});
    const window=dom.window,$=jquery(window),globals={window,document:window.document};
    const Chat=loadUnit('chat',{_ujgTA_chatTools:loadUnit('chat-tools',{_ujgTA_fields:h.fields}),_ujgTA_draft:h.drafts},{AbortController});let ui,calls=0;
    const chat=Chat.create({controller:h.controller,store:h.store,runtime,requestText:async()=>{
        calls++;if(failure!=='malformed')throw Error('Pico HTTP '+failure);
        return {text:'{"answer":"UNTRUSTED","actions":[]}'};
    },onChange:()=>ui?.update(h.controller.getState())});
    ui=loadUnit('chat-ui',{_ujgTA_icons:loadUnit('icons',{},globals)},globals).create({$,controller:h.controller,chat,editor:{openEditor(){}}});
    ui.mount(window.document.querySelector('#root'));t.after(()=>{ui.destroy();chat.destroy();window.close();});
    const input=window.document.querySelector('[data-ta-chat-input]');input.value=completeNarrative;
    input.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
    async function settle(){for(let i=0;i<100;i++){await new Promise(r=>setImmediate(r));if(chat.getState().status==='error')return;}assert.fail('failed turn did not settle');}
    await settle();const count=calls;
    const error=window.document.querySelector('[data-ta-chat-error]');assert.equal(error.hidden,false);
    assert.match(error.textContent,failure==='malformed'?/формат/:new RegExp('HTTP '+failure));
    const retry=window.document.querySelector(failure==='429'?'[data-ta-chat-rate-retry]':'[data-ta-chat-retry]');
    assert.equal(retry.hidden,false);assert.equal(window.document.querySelector('[data-ta-card-create]').disabled,true);
    input.value='Неотправленный следующий ответ';retry.click();await settle();
    assert.equal(calls,count*2);assert.equal(input.value,failure==='429'?'Неотправленный следующий ответ':completeNarrative);assert.equal(retry.hidden,false);
    const d=h.controller.getState().draft,saved=h.store.loadConversation('DO',d.id).value;
    assert.deepEqual(d.fields,{});assert.equal(d.checked,null);assert.equal(saved.transcript.filter(m=>m.role==='user').length,1);
    assert.equal(saved.messages.filter(m=>m.role==='user').length,1);assert.doesNotMatch(JSON.stringify(saved.transcript),/UNTRUSTED|Проверка пройдена/);
});
