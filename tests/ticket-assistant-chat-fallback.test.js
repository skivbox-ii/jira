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
    if(!prefix)assert.match(h.chat.getState().transcript.at(-1).text,/Тема и описание взяты из вашего текста/);
    assert.doesNotMatch(h.chat.getState().transcript.at(-1).text,/Резервное копирование|модель не заполняла/);
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
test('malformed initial response recovers user facts; reconciliation without evidence stays blocked',async t=>{
    const h=await setup(t,async config=>{config.onEvent({type:'error',code:'response'});return {status:'error'};});
    await h.chat.send(narrative);
    assert.equal(h.controller.getState().draft.fields.description,narrative);
    assert.ok(h.controller.getState().draft.checked);
    const h2=await setup(t);await h2.chat.reconcile();assert.equal(h2.controller.getState().draft.checked,null);
});

const greeted='Добрый день!\nНа стендах DEV, TEST и PREPROD приложение не запускается. Нужно восстановить запуск. Проверка: успешный вход.';
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
for(const restored of [false,true])test('greeted narrative recovers from user text with a real estimate blocker; restored duplicates='+restored,async t=>{
    const h=await setup(t);await requireEstimate(h);
    const r=await restoreMalformed(t,h,restored?[greeted,greeted,greeted]:[]);
    if(restored)await r.chat.reconcile();else await r.chat.send(greeted);
    const d=h.controller.getState().draft,s=r.chat.getState();
    assert.equal(d.fields.description,greeted);assert.equal(d.source,greeted);
    assert.equal(d.fields.summary,'На стендах DEV, TEST и PREPROD приложение не запускается.');
    assert.equal(d.fields.timetracking,undefined);assert.equal(d.checked,null);
    assert.ok(h.controller.getState().validation.fieldErrors.timetracking);
    assert.equal(s.error,null);assert.equal(s.status,'idle');
    assert.match(s.transcript.at(-1).text,/исходную оценку трудозатрат/);
    assert.doesNotMatch(s.transcript.at(-1).text,/Проверка пройдена|EVIL/);
    assert.match(s.notices.join(' '),/неверного формата/);assert.doesNotMatch(s.notices.join(' '),/Pico недоступен/);
    assert.equal(s.transcript.filter(m=>m.role==='user').length,1);
    assert.equal(r.calls(),2);
    assert.equal(h.store.loadConversation('DO',d.id).value.transcript.filter(m=>m.role==='user').length,1);
});
test('exact malformed retries collapse legacy user entries and do not duplicate the recovered narrative',async t=>{
    const h=await setup(t),r=await restoreMalformed(t,h,[greeted,greeted,greeted]);
    await r.chat.send(greeted);
    assert.equal(r.chat.getState().transcript.filter(m=>m.role==='user').length,1);
    assert.equal(h.controller.getState().draft.source,greeted);
    await r.chat.send(greeted);
    assert.equal(r.chat.getState().transcript.filter(m=>m.role==='user').length,1);
    assert.equal(h.controller.getState().draft.source,greeted);
});
test('the same short answer to successive assistant questions stays visible',async t=>{
    let turn=0;
    const h=await setup(t,async config=>{config.onEvent({type:'assistant',text:++turn===1?'Проверить TEST?':'Проверить DEV?'});});
    await h.chat.send('Да');await h.chat.send('Да');
    assert.deepEqual(h.chat.getState().transcript.filter(m=>m.role==='user').map(m=>m.text),['Да','Да']);
});
test('summary greeting removal respects Russian word boundaries',async t=>{
    const h=await setup(t);await h.chat.send('Приветствие не отображается на странице входа. Исправить текст.');
    assert.equal(h.controller.getState().draft.fields.summary,'Приветствие не отображается на странице входа.');
});
test('missing estimate after malformed recovery can be answered locally without another model request',async t=>{
    const h=await setup(t);await requireEstimate(h);const r=await restoreMalformed(t,h,[greeted,greeted,greeted]);
    await r.chat.reconcile();assert.equal(h.controller.getState().draft.checked,null);
    const calls=r.calls();await r.chat.send('Оценка: 2 часа');
    assert.equal(r.calls(),calls);assert.equal(h.controller.getState().draft.fields.timetracking.originalEstimate,'2h');
    assert.ok(h.controller.getState().draft.checked);assert.match(r.chat.getState().transcript.at(-1).text,/Проверка пройдена/);
});
test('malformed recovery preserves protected summary and pending replacement',async t=>{
    const h=await setup(t),c=h.controller;
    await c.updateField('summary','Ручная тема');await c.chatUpdate({fields:{summary:'Предложенная тема'}},c.chatSnapshot());
    const r=await restoreMalformed(t,h,[greeted,greeted,greeted]);await r.chat.reconcile();
    const d=c.getState().draft;assert.equal(d.fields.summary,'Ручная тема');assert.equal(d.pendingFields.summary,'Предложенная тема');
    assert.equal(d.protectedFields.summary,true);assert.equal(d.checked,null);assert.equal(d.fields.description,greeted);
    assert.match(r.chat.getState().transcript.at(-1).text,/Подтвердите или отклоните/);
});
test('one undo removes only automatically recovered fields and leaves the original narrative',async t=>{
    const h=await setup(t),r=await restoreMalformed(t,h,[greeted,greeted,greeted]);await r.chat.reconcile();
    assert.equal(r.chat.getState().canUndo,true);await r.chat.undo();
    const d=h.controller.getState().draft;assert.equal(d.fields.summary,undefined);assert.equal(d.fields.description,undefined);
    assert.equal(d.source,greeted);assert.equal(d.checked,null);
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
for(const failure of ['transport','response'])for(const cancel of ['stop','edit','switch','destroy'])test('late Jira relation check cannot check a '+cancel+' turn after '+failure,async t=>{
    const h=await setup(t,async()=>{throw Error(failure==='response'?'Invalid Pico text envelope':'provider unavailable');}),c=h.controller,read=h.api.getCreateMeta,gate=deferred();let started=false,signal;
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

const liveTraining='Учебный черновик. Обновить сервис demo-api в DEV до версии 1.0 из тега v1.0 в рабочее время. Поменять образ и перезапустить сервис. Постановщик проверит HTTP 200 на /health. Исходная оценка: 30 минут. Приоритет: Средний. Ссылки на репозиторий для примера нет.';
const liveSummary='Обновить сервис demo-api в DEV до версии 1.0 из тега v1.0 в рабочее время.';
test('malformed fallback uses the live task action and exact retries retain one user turn and one recovery notice',async t=>{
    const h=await setup(t),r=await restoreMalformed(t,h,[]);
    await r.chat.send(liveTraining);assert.equal(h.controller.getState().draft.fields.summary,liveSummary);
    await r.chat.send(liveTraining);await r.chat.send(liveTraining);
    const s=r.chat.getState(),d=h.controller.getState().draft;
    assert.equal(s.transcript.filter(m=>m.role==='user').length,1);assert.equal(d.source,liveTraining);assert.equal(d.fields.summary,liveSummary);
    assert.equal(s.notices.filter(n=>/формата|получить ответ/.test(n)).length,1);
    assert.doesNotMatch(s.transcript.filter(m=>m.role==='assistant').at(-1).text,/Получен ответ неверного формата/);
    const saved=h.store.loadConversation('DO',d.id).value;
    assert.equal(saved.transcript.filter(m=>m.role==='user').length,1);assert.equal(saved.messages.filter(m=>m.role==='user').length,1);
});
for(const manual of [false,true])test('legacy placeholder summary is repaired only when generated; manual real edits remain: '+manual,async t=>{
    const h=await setup(t),c=h.controller;
    await c.chatUpdate({fields:{summary:'Учебный черновик.',description:liveTraining},questions:[]},c.chatSnapshot(),liveTraining);
    if(manual)await c.updateField('summary','Ручная тема: сохранить demo-api');
    const r=await restoreMalformed(t,h,[liveTraining]);await r.chat.send(liveTraining);
    assert.equal(c.getState().draft.fields.summary,manual?'Ручная тема: сохранить demo-api':liveSummary);
    assert.equal(c.getState().draft.pendingFields.summary,undefined);
});

for(const modelQuestion of [false,true])test('restored raw DEVOPS retry revalidates local questions but retains genuine model blockers: '+modelQuestion,async t=>{
    const h=await setup(t),c=h.controller,read=h.api.getCreateMeta;
    h.api.getProjects=async()=>({values:[{key:'DEVOPS',id:'DO-project',name:'DEVOPS'}]});
    h.api.getCreateMeta=async key=>{const raw=await read(key);raw.projects[0].issuetypes.forEach(type=>{type.fields.priority={name:'Приоритет',schema:{type:'priority',system:'priority'},hasDefaultValue:true,defaultValue:{id:'medium'},allowedValues:[{id:'medium',name:'Средний'}]};});return raw;};
    h.api.checkDevopsIssue=async()=>({fieldErrors:{},warnings:[],link:null});
    await c.init();await c.selectProject('DEVOPS');await c.selectIssueType('12');
    const Tools=loadUnit('chat-tools',{_ujgTA_fields:h.fields}),Chat=loadUnit('chat',{_ujgTA_chatTools:Tools,_ujgTA_draft:h.drafts},{AbortController});
    const makeChat=()=>Chat.create({controller:c,store:h.store,runtime:{createSession(){return {prompt:async()=>{throw Error('Invalid Pico text envelope');},getMessages:()=>[],abort(){},dispose(){}};}}});
    let chat=makeChat();await chat.send(liveTraining);assert.equal(chat.getState().error,null);assert.equal(c.getState().draft.fields.description,liveTraining);
    const draftId=c.getState().draft.id;chat.destroy();
    // Reproduce the old generated summary alongside local validation.questions.
    await c.chatUpdate({fields:{summary:'Учебный черновик.'},questions:modelQuestion?[{id:'model:question',text:'Нужно ли затронуть второй сервис?',required:true}]:[]},c.chatSnapshot());
    await c.chatValidate(c.chatSnapshot());assert.ok(c.getState().validation.questions.some(q=>q.id==='devops:links'));
    await c.init();await c.selectProject('DEVOPS');chat=makeChat();t.after(()=>chat.destroy());
    assert.equal(c.getState().draft.id,draftId);
    await chat.send(liveTraining);const state=chat.getState(),d=c.getState().draft;
    assert.equal(d.fields.summary,liveSummary);assert.equal(d.checked,null);assert.equal(d.source,liveTraining);
    assert.equal(state.transcript.filter(m=>m.role==='user').length,1);
    assert.equal(state.notices.filter(n=>/формата/.test(n)).length,1);
    if(modelQuestion){assert.equal(state.error.code,'response');assert.ok(d.questions.some(q=>q.id==='model:question'));}
    else {assert.equal(state.error,null);assert.equal(state.status,'idle');assert.deepEqual(Array.from(c.getState().validation.questions,q=>q.id),['devops:links']);assert.match(state.transcript.at(-1).text,/репозитор|ссылк/i);}
});
