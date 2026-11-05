const test=require('node:test');
const assert=require('node:assert/strict');
const {loadUnit}=require('./helpers/ticket-assistant-fixture');
const {harness}=require('./helpers/ticket-assistant-chat-fixture');
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
const narrative='Восстановить доступ к сервису на DEV. Проверка: вход по RDP.';
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
for(const mode of ['throw','event','missing'])for(const prefix of ['', 'Описание: '])
test('unavailable '+mode+' checks a real description and derives an empty summary: '+prefix,async t=>{
    const h=await setup(t,mode);let creates=0;
    h.api.createIssue=async payload=>{creates++;assert.equal(payload.fields.description,narrative);return {id:'123',key:'DO-123'};};
    await h.chat.send(prefix+narrative);
    const s=h.controller.getState();
    assert.equal(s.draft.fields.description,narrative);
    assert.equal(s.draft.fields.summary,'Восстановить доступ к сервису на DEV.');
    assert.equal(s.validation.ok,true);assert.ok(s.draft.checked);
    assert.equal(h.store.load('DO').draft.checked.draftRevision,s.draft.draftRevision);
    assert.equal(creates,0);assert.match(h.chat.getState().transcript.at(-1).text,/Проверка пройдена/);
    await h.controller.submit();assert.equal(creates,1);assert.equal(h.controller.getState().draft.creation.issueKey,'DO-123');
});
test('fallback preserves a manually entered summary',async t=>{
    const h=await setup(t);await h.controller.updateField('summary','Моя тема');
    await h.chat.send('Описание: '+narrative);
    assert.equal(h.controller.getState().draft.fields.summary,'Моя тема');assert.ok(h.controller.getState().draft.checked);
});
for(const blocker of ['question','proposal','required','review','protected-empty'])
test('unavailability cannot bypass '+blocker,async t=>{
    const h=await setup(t),c=h.controller;
    if(blocker==='required'){
        const read=h.api.getCreateMeta;h.api.getCreateMeta=async(...args)=>{const raw=await read(...args);raw.projects[0].issuetypes.forEach(x=>x.fields.customfield_2.required=true);return raw;};
        await c.selectProject('DO');
    }
    if(blocker==='question')await c.chatUpdate({fields:{},questions:[{id:'semantic',text:'Какой результат нужен?',required:true}]},c.chatSnapshot());
    if(blocker==='proposal'){
        await c.updateField('summary','Моя тема');await c.chatUpdate({fields:{summary:'Предложение'}},c.chatSnapshot());
    }
    if(blocker==='protected-empty')await c.updateField('summary','');
    if(blocker==='review')await c.chatApplyTemplate({instructions:'Новые правила'},c.chatSnapshot());
    await h.chat.send('Описание: '+narrative);
    assert.equal(c.getState().draft.checked,null);
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
test('fallback is not used for malformed model output or reconciliation',async t=>{
    const h=await setup(t,async config=>{config.onEvent({type:'error',code:'response'});return {status:'error'};});
    const before=JSON.stringify(h.controller.getState().draft);await h.chat.send(narrative);
    assert.equal(JSON.stringify(h.controller.getState().draft),before);
    const h2=await setup(t);await h2.chat.reconcile();assert.equal(h2.controller.getState().draft.checked,null);
});
test('late failed provider cannot change a newer manual edit',async t=>{
    const gate=deferred();const h=await setup(t,async()=>{await gate.promise;throw Error('transport');});
    const sending=h.chat.send(narrative);await new Promise(r=>setImmediate(r));
    await h.controller.updateField('summary','Новая ручная тема');gate.resolve();await sending;
    assert.equal(h.controller.getState().draft.fields.summary,'Новая ручная тема');assert.equal(h.controller.getState().draft.checked,null);
    assert.equal(h.controller.getState().draft.fields.description,undefined);
});
test('Jira preflight network error does not become successful create',async t=>{
    const h=await setup(t);let creates=0;h.api.createIssue=async()=>{creates++;return {key:'DO-1'};};
    await h.chat.send(narrative);assert.ok(h.controller.getState().draft.checked);
    h.api.getCreateMeta=async()=>{throw Error('Jira unavailable');};await h.controller.submit();
    assert.equal(creates,0);assert.equal(h.controller.getState().draft.creation.issueKey,null);
    assert.ok(h.controller.getState().draft.creation.error);
});

test('plain API incident narrative is task data, not a connection command',async t=>{
    const h=await setup(t);await h.chat.send('Исправить API на DEV. Проверка: ответ 200.');
    assert.equal(h.controller.getState().draft.fields.description,'Исправить API на DEV. Проверка: ответ 200.');
    assert.ok(h.controller.getState().draft.checked);
});
for(const cancel of ['stop','edit','switch','destroy'])test('late Jira relation check cannot check a '+cancel+' turn',async t=>{
    const h=await setup(t),c=h.controller,read=h.api.getCreateMeta,gate=deferred();let started=false,signal;
    h.api.getCreateMeta=async(...args)=>{const raw=await read(...args);raw.projects[0].issuetypes.forEach(x=>x.fields.customfield_923={name:'Epic',schema:{type:'any',custom:'com.pyxis.greenhopper.jira:gh-epic-link'}});return raw;};
    await c.selectProject('DO');await c.updateField('customfield_923','DO-42');
    h.api.getEpic=(project,key,request)=>{started=true;signal=request.signal;return gate.promise;};
    const sending=h.chat.send(narrative);
    for(let i=0;i<40&&!started;i++)await Promise.resolve();assert.equal(started,true);
    if(cancel==='stop')h.chat.stop();
    if(cancel==='edit')await c.updateField('summary','Моя новая тема');
    if(cancel==='switch')await c.selectProject('APP');
    if(cancel==='destroy')h.chat.destroy();
    assert.equal(signal.aborted,true);gate.resolve({id:'DO-42',label:'Epic'});await sending;
    assert.equal(c.getState().draft.checked,null);
    assert.ok(!h.chat.getState().transcript.some(m=>/Проверка пройдена/.test(m.text)));
});
test('Jira relation network error blocks fallback readiness',async t=>{
    const h=await setup(t),c=h.controller,read=h.api.getCreateMeta;
    h.api.getCreateMeta=async(...args)=>{const raw=await read(...args);raw.projects[0].issuetypes.forEach(x=>x.fields.customfield_923={name:'Epic',schema:{type:'any',custom:'com.pyxis.greenhopper.jira:gh-epic-link'}});return raw;};
    await c.selectProject('DO');await c.updateField('customfield_923','DO-42');
    h.api.getEpic=async()=>{throw Error('Jira unavailable');};await h.chat.send(narrative);
    assert.equal(c.getState().draft.checked,null);assert.ok(!h.chat.getState().transcript.some(m=>/Проверка пройдена/.test(m.text)));
});
test('concurrent send is ignored while recovering a failed model turn',async t=>{
    const gate=deferred();let calls=0;const h=await setup(t,async()=>{calls++;await gate.promise;throw Error('transport');});
    const sending=h.chat.send(narrative);await h.chat.send('Другой запрос');gate.resolve();await sending;
    assert.equal(calls,1);assert.equal(h.controller.getState().draft.fields.description,narrative);
    assert.equal(h.chat.getState().transcript.filter(m=>m.role==='user').length,1);assert.ok(h.controller.getState().draft.checked);
});

test('READY chat card permits explicit create and shows recovered transport as a notice',async t=>{
    const {JSDOM}=require('jsdom'),jquery=require('jquery');
    const h=await setup(t),dom=new JSDOM('<div id="root"><div class="ta-layout"><header class="ta-header"><div class="ta-header-tools"></div></header></div></div>',{url:'https://jira.test/'});
    const window=dom.window,$=jquery(window),globals={window,document:window.document};let creates=0;
    h.api.createIssue=async()=>{creates++;return {id:'123',key:'DO-123'};};
    await h.chat.send('Описание: '+narrative);assert.equal(h.chat.getState().error,null);
    const ui=loadUnit('chat-ui',{_ujgTA_icons:loadUnit('icons',{},globals)},globals).create({$,controller:h.controller,chat:h.chat,editor:{openEditor(){}}});
    ui.mount(window.document.querySelector('#root'));t.after(()=>{ui.destroy();window.close();});
    const button=window.document.querySelector('[data-ta-card-create]');assert.equal(button.disabled,false);
    assert.equal(window.document.querySelector('[data-ta-chat-error]').hidden,true);
    assert.match(window.document.querySelector('[data-ta-chat-status]').textContent,/Не удалось получить ответ/);
    assert.doesNotMatch(window.document.querySelector('[data-ta-chat-status]').textContent,/Остальные поля требуют проверки/);
    assert.match(window.document.querySelector('[data-ta-task-card-id]').textContent,/Готово к созданию/);assert.equal(creates,0);
    button.click();for(let i=0;i<50&&!creates;i++)await new Promise(r=>setImmediate(r));
    assert.equal(creates,1);
});

for(const questions of [[],undefined])test('successful description-only model response derives summary; questions='+JSON.stringify(questions),async t=>{
    const h=await setup(t,async config=>{
        await config.tools.find(x=>x.name==='update_task').execute({fields:{description:narrative},...(questions?{questions}:{})},{});
        config.onEvent({type:'assistant',text:'Описание сохранено.'});
    });
    await h.chat.send('Восстановить доступ');const s=h.controller.getState();
    assert.equal(s.draft.fields.summary,'Восстановить доступ к сервису на DEV.');assert.equal(s.draft.fields.description,narrative);
    if(questions)assert.ok(s.draft.checked);else assert.equal(s.draft.checked,null);
});
test('successful model description does not replace manual summary',async t=>{
    const h=await setup(t,async config=>{await config.tools.find(x=>x.name==='update_task').execute({fields:{description:narrative},questions:[]},{});});
    await h.controller.updateField('summary','Моя тема');await h.chat.send('Восстановить доступ');
    assert.equal(h.controller.getState().draft.fields.summary,'Моя тема');assert.ok(h.controller.getState().draft.checked);
});
test('successful local validation turns provider diagnostic into a notice without a red stale blocker',async t=>{
    const h=await setup(t,async()=>{throw Error('Pico HTTP 502');});await h.chat.send('Описание: '+narrative);
    const s=h.chat.getState();assert.equal(s.error,null);assert.equal(s.status,'idle');assert.ok(h.controller.getState().draft.checked);
    assert.match(s.notices.join(' '),/HTTP 502/);assert.doesNotMatch(s.notices.join(' '),/Остальные поля требуют проверки/);
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
        await config.tools.find(x=>x.name==='update_task').execute({fields:echo?{description:'Restart DEV'}:{},questions:[]},{});
        throw Error('Pico HTTP 502');
    });const c=h.controller;
    await c.updateField('summary','Restart DEV');await c.updateField('description','Restart DEV');await c.chatValidate(c.chatSnapshot());
    assert.ok(c.getState().draft.checked);
    await h.chat.send('работать только на TEST, DEV не трогать');
    assert.equal(c.getState().draft.fields.description,'Restart DEV');assert.equal(c.getState().draft.checked,null);
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
    await c.updateField('summary','Restart DEV');await c.updateField('description','Restart DEV');await c.chatValidate(c.chatSnapshot());
    const before=JSON.stringify(c.getState().draft);await h.chat.send('Set API key: secret-test-token');
    assert.equal(JSON.stringify(c.getState().draft),before);assert.equal(calls,0);
});
test('real runtime description-only success derives summary before final readiness check',async t=>{
    const h=await setup(t);h.chat.destroy();const runtime=await import('../ujg-ticket-assistant-chat/runtime.mjs');
    const Tools=loadUnit('chat-tools',{_ujgTA_fields:h.fields});
    const Chat=loadUnit('chat',{_ujgTA_chatTools:Tools,_ujgTA_draft:h.drafts},{AbortController});let calls=0;
    const chat=Chat.create({controller:h.controller,store:h.store,runtime,requestText:async()=>({text:++calls===1?
        JSON.stringify({text:'',toolCalls:[{id:'description-only',name:'update_task',arguments:{fields:{description:narrative},questions:[]}}]}):'Задача готова к созданию.'})});
    t.after(()=>chat.destroy());await chat.send('Восстановить доступ');
    assert.equal(chat.getState().error,null);assert.equal(h.controller.getState().draft.fields.summary,'Восстановить доступ к сервису на DEV.');
    assert.ok(h.controller.getState().draft.checked);assert.match(chat.getState().transcript.at(-1).text,/Проверка пройдена/);
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
test('successful fallback notice describes recovery without retry instructions: '+String(mode),async t=>{
    const h=await setup(t,mode);await h.chat.send(narrative);
    const notices=h.chat.getState().notices.join(' ');
    assert.match(notices,/провер|Провер/);assert.doesNotMatch(notices,/повтор|обновите|продолжите.*редактор|требуют проверки|проверьте доступность/i);
});
