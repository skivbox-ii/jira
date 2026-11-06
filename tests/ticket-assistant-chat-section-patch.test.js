const test=require('node:test');
const assert=require('node:assert/strict');
const {harness}=require('./helpers/ticket-assistant-chat-fixture');
const {loadUnit}=require('./helpers/ticket-assistant-fixture');
const raw='Обновить сервис demo-api в DEV до версии 1.0 из тега v1.0 в рабочее время. Поменять образ и перезапустить сервис. Постановщик проверит HTTP 200 на /health. Ссылки на репозиторий нет.';
async function setup(t,{missingWindow=false}={}) {
    const h=await harness(),c=h.controller,read=h.api.getCreateMeta;
    h.api.getProjects=async()=>({values:[{key:'DEVOPS',id:'DO-project',name:'DEVOPS'},{key:'APP',id:'APP-project',name:'APP'}]});
    h.api.getCreateMeta=async key=>{const m=await read(key);m.projects[0].issuetypes.forEach(type=>{
        type.fields.priority={name:'Приоритет',schema:{type:'priority',system:'priority'},hasDefaultValue:true,defaultValue:{id:'medium'},allowedValues:[{id:'medium',name:'Средний'}]};
        type.fields.timetracking={name:'Исходная оценка',schema:{type:'timetracking',system:'timetracking'}};
    });return m;};
    h.api.checkDevopsIssue=async()=>({fieldErrors:{},warnings:[],link:null});let posts=0;h.api.createIssue=async()=>{posts++;throw Error('No create');};
    await c.init();await c.selectProject('DEVOPS');await c.selectIssueType('12');
    await c.chatUpdate({fields:{summary:'Обновить demo-api в DEV',description:missingWindow?raw.replace(' в рабочее время',''):raw},questions:[{id:'old:ai',text:'Какая версия? Нужны логи?',required:true}]},c.chatSnapshot());
    await c.chatValidate(c.chatSnapshot());
    const Tools=loadUnit('chat-tools',{_ujgTA_fields:h.fields}),Chat=loadUnit('chat',{_ujgTA_chatTools:Tools,_ujgTA_draft:h.drafts},{AbortController});
    const runtime=await import('../ujg-ticket-assistant-chat/runtime.mjs');
    h.create=(requestText)=>{const configs=[];const chat=Chat.create({controller:c,store:h.store,runtime:{createSession(config){configs.push(config);return runtime.createSession(config);}},requestText});t.after(()=>chat.destroy());return {chat,configs};};
    t.after(()=>c.destroy());return {...h,Tools,posts:()=>posts};
}
test('one data reply applies several fields plus section patches and ends before any model review question',async t=>{
    const h=await setup(t),c=h.controller,requests=[];
    const {chat,configs}=h.create(async request=>{requests.push(request);return {text:JSON.stringify({text:'Какая версия? Нужны логи?',toolCalls:[{id:'one',name:'update_task',arguments:{
        fields:{summary:'Обновить demo-api DEV в рабочие часы',timetracking:{originalEstimate:'30m'}},
        descriptionSections:{window:'Рабочие часы с 10:00 до 11:00.',links:'https://git.example/demo-api'},
        questions:[{id:'stale',text:'Какая версия?',required:true}]
    }}]})};});
    await chat.send('Тема: Обновить demo-api DEV в рабочие часы; Исходная оценка: 30 минут; Окно с 10:00 до 11:00; Ссылка https://git.example/demo-api');
    assert.equal(configs[0].appManagedPatch,true);assert.equal(requests.length,1);assert.equal(chat.getState().error,null);
    const d=c.getState().draft;assert.equal(d.fields.timetracking.originalEstimate,'30m');assert.equal(d.fields.summary,'Обновить demo-api DEV в рабочие часы');
    assert.match(d.fields.description,/10:00 до 11:00/);assert.match(d.fields.description,/Поменять образ и перезапустить сервис/);assert.match(d.fields.description,/git.example/);
    assert.ok(d.checked);assert.equal(d.questions.length,0);assert.doesNotMatch(chat.getState().transcript.at(-1).text,/Какая версия|Нужны логи/);assert.equal(h.posts(),0);
    const ctx=JSON.parse(requests[0].user).authoritativeContext;assert.ok(ctx.descriptionSectionIds.includes('window'));assert.ok(ctx.descriptionSectionIds.includes('verifier'));assert.equal(ctx.draft.questions.some(q=>q.id==='old:ai'),false);
});
test('section-only update needs no fields map and asks only the first real missing requirement',async t=>{
    const h=await setup(t,{missingWindow:true}),requests=[];
    const {chat}=h.create(async r=>{requests.push(r);return {text:JSON.stringify({text:'Какая версия?',toolCalls:[{id:'patch',name:'update_task',arguments:{descriptionSections:{verification:'QA проверит HTTP 200 на /health.'}}}]})};});
    await chat.send('Проверку HTTP 200 на /health выполнит QA.');
    assert.equal(requests.length,1);assert.equal(chat.getState().error,null);const s=h.controller.getState();
    assert.match(s.draft.fields.description,/QA проверит/);assert.equal(s.draft.checked,null);assert.ok(s.validation.questions.length>=2);
    const reply=chat.getState().transcript.at(-1).text;assert.ok(reply.includes(s.validation.questions[0].text));assert.equal(reply.includes(s.validation.questions[1].text),false);assert.doesNotMatch(reply,/Какая версия/);
});
test('inspection remains a tool conversation and never enables appManagedPatch',async t=>{
    const h=await setup(t),before=JSON.stringify(h.controller.getState().draft);let calls=0;
    const {chat,configs}=h.create(async()=>({text:++calls===1?JSON.stringify({text:'',toolCalls:[{id:'read',name:'read_template',arguments:{}}]}):'Шаблон показан выше.'}));
    await chat.send('Покажи шаблон');assert.equal(configs[0].appManagedPatch,false);assert.equal(calls,2);assert.equal(JSON.stringify(h.controller.getState().draft),before);assert.equal(chat.getState().error,null);
});
test('tool forwards optional field/section proposal with app-managed questions but does not forward stale model questions',async t=>{
    const h=await setup(t),c=h.controller,original=c.chatUpdate;let seen;
    c.chatUpdate=(proposal,snapshot,source,options)=>{seen={proposal,source,options};return original(proposal,snapshot,source,options);};
    const tool=h.Tools.create({controller:c,appManagedQuestions:true}).find(t=>t.name==='update_task');
    const result=await tool.execute({descriptionSections:{window:'Рабочие часы'},questions:[{id:'stale',text:'Какая версия?',required:true}]},{});
    assert.equal(result.ok,true);assert.equal(seen.options.appManagedQuestions,true);assert.equal(Object.hasOwn(seen.proposal,'questions'),false);assert.equal(seen.proposal.descriptionSections.window,'Рабочие часы');
});

for(const mixed of [false,true])test('rejected optional changes remain visible even when the existing card is otherwise ready: '+mixed,async t=>{
    const h=await setup(t),c=h.controller;
    await c.chatUpdate({descriptionSections:{links:'https://git.example/demo-api'}},c.chatSnapshot(),undefined,{appManagedQuestions:true});await c.chatValidate(c.chatSnapshot());assert.ok(c.getState().draft.checked);
    const before=c.getState().draft;
    const {chat}=h.create(async()=>({text:JSON.stringify({text:'Карточка готова к созданию.',toolCalls:[{id:'invalid',name:'update_task',arguments:{fields:Object.assign({duedate:'tomorrow'},mixed?{summary:'Обновить API DEV в рабочие часы'}:{})}}]})}));
    await chat.send('Срок: tomorrow'+(mixed?'; Тема: Обновить API DEV в рабочие часы':''));
    const d=c.getState().draft,reply=chat.getState().transcript.at(-1).text;
    assert.equal(chat.getState().lastTurnUsage.modelCalls,1);assert.equal(d.fields.duedate,before.fields.duedate);
    assert.match(reply,/Due date|duedate|Срок/);assert.match(reply,mixed?/частично/:/Изменения не применены/);
    assert.doesNotMatch(reply,/Проверка пройдена|Карточка заполнена|готова к созданию/);
    if(mixed)assert.equal(d.fields.summary,'Обновить API DEV в рабочие часы');else assert.equal(d.checked,null);
});
test('plain multi-field and section data response works in a non-DEVOPS project without a review round',async t=>{
    const h=await setup(t),c=h.controller;await c.selectProject('APP');await c.selectIssueType('20');await c.selectTemplate('task');
    const requests=[],{chat,configs}=h.create(async r=>{requests.push(r);return {text:JSON.stringify({fields:{summary:'Настроить сервис API в TEST',priority:{id:'medium'},duedate:'2026-11-30'},descriptionSections:{
        goal:'Команда должна получить доступ к API.',work:'Настроить сервис API.',location:'API на стенде TEST.',acceptance:'GET /health возвращает HTTP 200.'
    }})};});
    await chat.send('Настроить сервис API на TEST для доступа команды; проверка GET /health HTTP 200; приоритет Средний; срок 2026-11-30.');
    assert.equal(configs[0].appManagedPatch,true);assert.equal(requests.length,1);assert.equal(chat.getState().error,null);
    const d=c.getState().draft;assert.equal(d.fields.priority.id,'medium');assert.equal(d.fields.duedate,'2026-11-30');assert.match(d.fields.description,/GET \/health/);assert.ok(d.checked);assert.equal(h.posts(),0);
    const ctx=JSON.parse(requests[0].user).authoritativeContext;assert.ok(ctx.descriptionSectionIds.includes('goal'));assert.ok(ctx.fieldSchema.find(f=>f.id==='priority').choices.some(v=>v.id==='medium'));
});


test('manual summary is retained while real fields and section-only information are updated',async t=>{
    const h=await setup(t),c=h.controller;await c.updateField('summary','Ручная тема API');
    const {chat}=h.create(async()=>({text:JSON.stringify({fields:{summary:'Название модели',priority:{id:'medium'},duedate:'2026-11-30'},descriptionSections:{window:'Рабочие часы по МСК.',links:'https://git.example/demo-api'}})}));
    await chat.send('Приоритет Средний; срок 2026-11-30; окно рабочие часы по МСК; ссылка https://git.example/demo-api');
    const d=c.getState().draft;assert.equal(chat.getState().lastTurnUsage.modelCalls,1);assert.equal(d.fields.summary,'Ручная тема API');assert.equal(d.pendingFields.summary,'Название модели');
    assert.equal(d.fields.priority.id,'medium');assert.equal(d.fields.duedate,'2026-11-30');assert.match(d.fields.description,/по МСК/);assert.equal(d.checked,null);
    const reply=chat.getState().transcript.at(-1).text;assert.match(reply,/Подтвердите|предложение/);assert.doesNotMatch(reply,/Какая версия/);
});
test('first data turn exposes small catalogs; large catalogs require a trusted lookup before field patch',async t=>{
    const h=await setup(t),c=h.controller,read=h.api.getCreateMeta;
    h.api.getCreateMeta=async key=>{const raw=await read(key);raw.projects[0].issuetypes.forEach(type=>{type.fields.priority.allowedValues=[{id:'medium',name:'Средний'}].concat(Array.from({length:24},(_,i)=>({id:'p'+i,name:'Другой '+i})));});return raw;};
    await c.selectProject('DEVOPS');const requests=[];
    const {chat}=h.create(async r=>{requests.push(r);return {text:JSON.stringify(requests.length===1?{text:'',toolCalls:[{id:'options',name:'find_options',arguments:{fieldId:'priority',query:'Средний'}}]}:{fields:{priority:{id:'medium'}},descriptionSections:{window:'Рабочие часы.'}})};});
    await chat.send('Приоритет Средний, окно рабочие часы.');assert.equal(requests.length,2);assert.equal(chat.getState().error,null);
    const spec=JSON.parse(requests[0].user).authoritativeContext.fieldSchema.find(f=>f.id==='priority');assert.deepEqual(spec.choices,[]);assert.equal(spec.choicesComplete,false);
    assert.match(requests[1].user,/Средний/);assert.equal(c.getState().draft.fields.priority.id,'medium');
});
test('explicit reconciliation keeps the legacy compact review protocol and does not enable plain data patches',async t=>{
    const h=await setup(t),c=h.controller,description=c.getState().draft.fields.description;let calls=0;
    const {chat,configs}=h.create(async()=>{calls++;return {text:JSON.stringify({fields:{description},missing:[]})};});
    await chat.reconcile();assert.equal(configs[0].appManagedPatch,false);assert.equal(calls,1);assert.equal(chat.getState().error,null);
});
test('read-only template inspection preserves a pending custom review without a review error',async t=>{
    const h=await setup(t),c=h.controller;
    const applied=await c.chatApplyTemplate({instructions:'Обязательно согласование DBA.'},c.chatSnapshot());assert.equal(applied.ok,true);
    assert.equal(c.getState().draft.templateReviewPending,true);
    const before=JSON.stringify(c.getState().draft);let calls=0;
    const {chat,configs}=h.create(async()=>({text:++calls===1?JSON.stringify({text:'',toolCalls:[{id:'read',name:'read_template',arguments:{}}]}):'Обязательно согласование DBA.'}));
    await chat.send('Покажи шаблон');
    assert.equal(chat.getState().error,null);assert.equal(configs[0].appManagedPatch,false);assert.equal(calls,2);
    assert.equal(JSON.stringify(c.getState().draft),before);assert.equal(c.getState().draft.templateReviewPending,true);assert.equal(c.getState().draft.checked,null);
});
for(const failure of ['malformed','502'])for(const literal of [false,true])test('legacy generic draft recovery retains mandatory template blockers: '+failure+' literal='+literal,async t=>{
    const h=await setup(t),c=h.controller;await c.selectProject('APP');await c.selectIssueType('20');await c.selectTemplate('task');
    assert.notEqual(c.getState().draft.appManagedQuestions,true);
    const {chat}=h.create(async()=>{if(failure==='502')throw Error('Pico HTTP 502');return {text:'not a data response'};});
    await chat.send((literal?'Описание: ':'')+'Настроить API на стенде TEST для доступа команды.');
    const s=c.getState();assert.equal(s.draft.appManagedQuestions,true);assert.equal(s.draft.checked,null);assert.equal(s.validation.ok,false);
    assert.ok(s.validation.questions.some(q=>q.id==='template:acceptance'));assert.doesNotMatch(chat.getState().transcript.at(-1).text,/Проверка пройдена|Можно нажать «Создать»/);assert.equal(h.posts(),0);
});
test('legacy generic raw facts already answering requirements do not acquire phantom blockers on recovery',async t=>{
    const h=await setup(t),c=h.controller;await c.selectProject('APP');await c.selectIssueType('20');await c.selectTemplate('task');
    const {chat}=h.create(async()=>{throw Error('Pico HTTP 502');});
    await chat.send('Настроить API.\nЦель: доступ команды.\nЧто сделать: настроить API.\nГде: стенд TEST.\nКритерии приёмки: GET /health возвращает HTTP 200.');
    const s=c.getState();assert.equal(s.draft.appManagedQuestions,true);assert.deepEqual(s.validation.questions,[]);assert.ok(s.draft.checked);assert.equal(h.posts(),0);
});
for(const failure of ['malformed','429'])test('custom template fallback cannot resolve missing DBA approval: '+failure,async t=>{
    const h=await setup(t),c=h.controller;await c.selectProject('APP');await c.selectIssueType('20');
    const settings=c.getState().settings;
    settings.profiles.find(p=>p.id==='universal').templates.push({id:'dba',name:'DBA',whenToUse:'Доступ',instructions:'Требуется согласование DBA. Если его нет, задай обязательный вопрос.',issueTypeId:'20'});
    await c.applySettings(settings);await c.selectTemplate('dba');assert.equal(c.chatDescriptionSections().length,0);
    const {chat,configs}=h.create(async()=>{if(failure==='429')throw Error('Pico HTTP 429');return {text:'not a data response'};});
    await chat.send('Настроить API в TEST. Согласование DBA не получено.');
    const s=c.getState();assert.equal(configs[0].appManagedPatch,false);assert.equal(s.draft.checked,null);assert.equal(s.draft.templateReviewPending,true);
    assert.doesNotMatch(chat.getState().transcript.at(-1).text,/Проверка пройдена|Можно нажать «Создать»/);assert.equal(h.posts(),0);
});
for(const ready of [true,false])test('control-only readiness command validates the current card without model or field writes: '+ready,async t=>{
    const h=await setup(t),c=h.controller;
    await c.chatUpdate(ready?{descriptionSections:{links:'https://git.example/demo-api'}}:{fields:{}},c.chatSnapshot(),undefined,{appManagedQuestions:true});
    await c.chatValidate(c.chatSnapshot());if(ready)assert.ok(c.getState().draft.checked);
    const before=c.getState().draft;let calls=0;
    const {chat}=h.create(async()=>{calls++;throw Error('No model call for readiness command');});
    await chat.send('Подтверди готовность задачи.');const after=c.getState().draft;
    assert.equal(calls,0);assert.equal(chat.getState().error,null);assert.deepEqual(after.fields,before.fields);assert.equal(after.source,before.source);
    assert.equal(!!after.checked,ready);assert.match(chat.getState().transcript.at(-1).text,ready?/Проверка пройдена/:/Создание пока недоступно/);
});
