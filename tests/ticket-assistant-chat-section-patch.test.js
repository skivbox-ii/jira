const test=require('node:test');
const assert=require('node:assert/strict');
const {harness}=require('./helpers/ticket-assistant-chat-fixture');
const {loadUnit}=require('./helpers/ticket-assistant-fixture');
const raw='Среда: DEV\n\nВерсия и состав: demo-api 1.0 из тега v1.0\n\nПорядок: Поменять образ и перезапустить сервис.\n\nОкно: в рабочее время\n\nПроверка: Постановщик проверит HTTP 200 на /health.\n\nКто проверяет: Постановщик\n\nСсылки: ссылка на репозиторий отсутствует.';
async function setup(t,{missingWindow=false,backend}={}) {
    const h=await harness(backend),c=h.controller,read=h.api.getCreateMeta;
    h.api.getProjects=async()=>({values:[{key:'DEVOPS',id:'DO-project',name:'DEVOPS'},{key:'APP',id:'APP-project',name:'APP'}]});
    h.api.getCreateMeta=async key=>{const m=await read(key);m.projects[0].issuetypes.forEach(type=>{
        type.fields.priority={name:'Приоритет',schema:{type:'priority',system:'priority'},hasDefaultValue:true,defaultValue:{id:'medium'},allowedValues:[{id:'medium',name:'Средний'},{id:'high',name:'Высокий'}]};
        type.fields.timetracking={name:'Исходная оценка',schema:{type:'timetracking',system:'timetracking'}};
    });return m;};
    h.api.checkDevopsIssue=async()=>({fieldErrors:{},warnings:[],link:null});let posts=0;h.api.createIssue=async()=>{posts++;throw Error('No create');};
    await c.init();await c.selectProject('DEVOPS');await c.selectIssueType('12');
    if(!backend)await c.chatUpdate({fields:{summary:'Обновить demo-api в DEV',description:missingWindow?raw.replace(' в рабочее время',''):raw},questions:[{id:'old:ai',text:'Какая версия? Нужны логи?',required:true}]},c.chatSnapshot());
    await c.chatValidate(c.chatSnapshot());
    const Tools=loadUnit('chat-tools',{_ujgTA_fields:h.fields}),Chat=loadUnit('chat',{_ujgTA_chatTools:Tools,_ujgTA_draft:h.drafts},{AbortController});
    const runtime=await import('../ujg-ticket-assistant-chat/runtime.mjs');
    h.create=(requestText)=>{const configs=[];const chat=Chat.create({controller:c,store:h.store,runtime:{createSession(config){configs.push(config);return runtime.createSession(config);}},requestText});t.after(()=>chat.destroy());return {chat,configs};};
    t.after(()=>c.destroy());return {...h,Tools,posts:()=>posts};
}
for(const first of ['prose','unchanged'])test('restored structured deployment applies the live mixed answer after '+first+' without crediting unchanged fields',async t=>{
    const original=await setup(t);await original.controller.chatUpdate({fields:{priority:{id:'medium'}}},original.controller.chatSnapshot());const before=original.controller.getState().draft;
    assert.match(before.fields.description,/Окно:/);assert.equal(before.fields.priority.id,'medium');original.controller.destroy();
    const h=await setup(t,{backend:original.backend}),c=h.controller;assert.equal(c.getState().draft.fields.description,before.fields.description);
    const requests=[],{chat}=h.create(async request=>{
        requests.push(request);const ctx=JSON.parse(request.user);
        if(requests.length===1)return {text:first==='prose'?'Нужна ссылка на репозиторий.':JSON.stringify({fields:{priority:{id:'medium'}}})};
        assert.equal(ctx.currentTurn,'Окно развёртывания с 19:00 до 20:00. Приоритет высокий. Дежурный проверит HTTP 200 на /health.');assert.equal(ctx.authoritativeContext,undefined);assert.equal(ctx.messages,undefined);
        assert.ok(ctx.fields.find(f=>f.id==='priority').choices.some(v=>v.id==='high'));assert.ok(ctx.descriptionSections.some(section=>section.id==='window'));
        return {text:JSON.stringify({fields:{priority:{id:'high'}},descriptionSections:{window:'С 19:00 до 20:00.',verification:'Дежурный проверит HTTP 200 на /health.',verifier:'Дежурный'}})};
    });
    await chat.send('Окно развёртывания с 19:00 до 20:00. Приоритет высокий. Дежурный проверит HTTP 200 на /health.');
    const s=c.getState();assert.equal(requests.length,2);assert.equal(chat.getState().error,null);assert.equal(s.draft.fields.priority.id,'high');
    assert.match(s.draft.fields.description,/19:00 до 20:00/);assert.match(s.draft.fields.description,/Дежурный проверит HTTP 200/);assert.match(s.draft.fields.description,/Поменять образ и перезапустить сервис/);
    assert.equal(s.draft.checked,null);assert.ok(s.validation.questions.some(q=>q.id==='devops:links'));assert.match(chat.getState().transcript.at(-1).text,/ссылк/i);assert.equal(h.posts(),0);
});
test('unchanged model patches leave narrative instructions unapplied and available in user history',async t=>{
    const h=await setup(t),c=h.controller;await c.chatUpdate({fields:{priority:{id:'medium'}}},c.chatSnapshot());
    const before=c.getState().draft,text='Окно развёртывания с 19:00 до 20:00. Приоритет высокий. Дежурный проверит HTTP 200 на /health. Миграции не выполнять.';
    const requests=[],{chat}=h.create(async request=>{requests.push(request);return {text:JSON.stringify({fields:{priority:{id:'medium'}}})};});
    await chat.send(text);assert.equal(requests.length,2);assert.match(requests[0].user,/Миграции не выполнять/);
    assert.equal(chat.getState().error.code,'draft-update');assert.deepEqual(c.getState().draft.fields,before.fields);
    assert.equal(c.getState().draft.source,text);assert.equal(c.getState().draft.checked,null);
    assert.equal(chat.getState().transcript.filter(m=>m.role==='user' && m.text===text).length,1);assert.equal(h.posts(),0);
});
const liveAnswer='Окно развёртывания с 19:00 до 20:00. Приоритет высокий. Дежурный проверит HTTP 200 на /health.';
const liveProse='Спасибо за уточнение. Я зафиксировал окно развёртывания (19:00–20:00)…';
test('stable deployment subjects preserve restrictions, service facts and untouched formatting',async t=>{
    const h=await setup(t);
    for(const summary of ['Запретить развёртывание в рабочее время','Разрешить запуск только в рабочее время','Обновить правила запуска только в рабочее время','Сервис demo-api доступен в рабочее время','Обновить сервис, работающий в рабочее время','Обновить demo-api в рабочее время и перезапустить worker','Обновить demo-api и в рабочее время','Обновить demo-api, в рабочее время','Обновить  demo-api — DEV.','Обновить demo-api  в DEV.'])
        assert.equal(h.Tools.stableDeploymentSummary(h.controller,summary),summary,summary);
    assert.equal(h.Tools.stableDeploymentSummary(h.controller,'Обновить сервис рабочего времени в DEV в рабочее время.'),'Обновить сервис рабочего времени в DEV в рабочее время.');
    assert.equal(h.Tools.stableDeploymentSummary(h.controller,'Развернуть demo-api в DEV с 19:00 до 20:00 UTC+3.'),'Развернуть demo-api в DEV с 19:00 до 20:00 UTC+3.');
});
for(const mode of ['model-window','model-summary','model-new-schedule'])test('restored deployment title preserves the saved or model-supplied schedule: '+mode,async t=>{
    const original=await setup(t),old='Обновить сервис demo-api в DEV до версии 1.0 в рабочее время.';
    await original.controller.chatUpdate({fields:{summary:old}},original.controller.chatSnapshot());original.controller.destroy();
    const h=await setup(t,{backend:original.backend}),c=h.controller;assert.equal(c.getState().draft.fields.summary,old);
    const title='Обновить сервис demo-api в DEV до версии 1.0 с 19:00 до 20:00 UTC+3.';
    const proposal={fields:mode==='model-summary'?{summary:old}:mode==='model-new-schedule'?{summary:title}:{},descriptionSections:{window:'С 19:00 до 20:00.'}};
    assert.equal(h.Tools.withStableDeploymentSummary(c,proposal,'Окно развёртывания с 19:00 до 20:00.'),proposal);
    const tools=h.Tools.create({controller:c,appManagedQuestions:true});
    const result=await tools.find(t=>t.name==='update_task').execute(proposal,{}),d=c.getState().draft;
    assert.equal(result.ok,true);assert.equal(d.fields.summary,mode==='model-new-schedule'?title:old);
    assert.match(d.fields.description,/19:00 до 20:00/);assert.equal(d.checked,null);assert.equal(h.posts(),0);
});
for(const mode of ['model','failed-prose'])for(const pending of [false,true])test('deployment schedule correction preserves manual subject and pending proposal: '+mode+' '+pending,async t=>{
    const h=await setup(t),c=h.controller,manual='Обновить demo-api в рабочее время — моя тема';await c.updateField('summary',manual);
    if(pending)await c.chatUpdate({fields:{summary:'Моя неподтверждённая тема'}},c.chatSnapshot());
    const before=c.getState().draft,{chat}=h.create(async()=>({text:mode==='failed-prose'?liveProse:JSON.stringify({descriptionSections:{window:'С 19:00 до 20:00.'}})}));
    await chat.send('Окно развёртывания с 19:00 до 20:00.');const d=c.getState().draft;
    assert.equal(d.fields.summary,manual);assert.deepEqual(d.pendingFields.summary,before.pendingFields.summary);
    if(mode==='model'){assert.equal(chat.getState().error,null);assert.match(d.fields.description,/19:00 до 20:00/);}
    else {assert.equal(chat.getState().error.code,'draft-update');assert.equal(d.fields.description,before.fields.description);assert.equal(d.source,before.source);}
    assert.equal(h.posts(),0);
});
for(const resolution of ['reconcile','explicit-answer','retry-after-failure'])test('persisted unresolved prohibition survives failed reply and link model patch until '+resolution,async t=>{
    const first=await setup(t),c=first.controller,fact='Миграции не выполнять.';
    // Simulate unresolved evidence saved by an older client; failures must not erase it.
    await c.chatUpdate({fields:{}},c.chatSnapshot(),undefined,{appManagedQuestions:true,unresolvedChatFacts:[fact]});
    const before=c.getState().draft,{chat}=first.create(async()=>({text:liveProse}));
    await chat.send('Окно развёртывания с 19:00 до 20:00. Приоритет высокий. '+fact);
    assert.ok(chat.getState().error);assert.deepEqual(c.getState().draft.fields,before.fields);
    const linked=first.create(async()=>({text:JSON.stringify({descriptionSections:{links:'https://git.example/demo-api'}})}));
    await linked.chat.send('https://git.example/demo-api');assert.match(c.getState().draft.fields.description,/git.example/);
    await c.updateField('summary','Уточнённая тема');
    const validation=await c.chatValidate(c.chatSnapshot());assert.equal(validation.ok,false);assert.match(JSON.stringify(validation.questions),/Миграции не выполнять/);
    const forged=first.drafts.markChecked(c.getState().draft,{ok:true,fieldErrors:{},warnings:[],unsupportedRequired:[]},[],c.chatSnapshot());assert.equal(forged.checked,null);
    chat.destroy();linked.chat.destroy();c.destroy();const h=await setup(t,{backend:first.backend}),restored=h.controller;
    assert.equal(restored.getState().draft.checked,null);assert.equal((await restored.chatValidate(restored.chatSnapshot())).ok,false);
    const unchanged=h.create(async()=>({text:JSON.stringify({fields:{description:restored.getState().draft.fields.description},missing:[]})}));
    await unchanged.chat.reconcile();assert.equal(restored.getState().draft.checked,null);unchanged.chat.destroy();
    if(resolution==='retry-after-failure') {
        const failed=h.create(async()=>({text:liveProse})),beforeRetry=restored.getState().draft;
        await failed.chat.send('Дополнительно: '+fact);assert.ok(failed.chat.getState().error);
        assert.equal(restored.getState().draft.fields.description,beforeRetry.fields.description);failed.chat.destroy();
    }
    let calls=0;const resolved=h.create(async()=>{calls++;return {text:JSON.stringify(resolution==='reconcile'?{fields:{description:restored.getState().draft.fields.description+'\n\nДополнительно: '+fact},missing:[]}:{descriptionSections:{extra:fact}})};});
    if(resolution==='reconcile')await resolved.chat.reconcile();else await resolved.chat.send(fact);
    assert.equal(calls,1);assert.equal(resolved.chat.getState().error,null);assert.match(restored.getState().draft.fields.description,/Миграции не выполнять/);
    assert.ok(restored.getState().draft.checked);assert.equal(h.posts(),0);
});
for(const clause of ['QA проверит HTTP 200 на /health?','Если QA проверит HTTP 200 на /health.','Проверка: QA проверит /ready, если будет доступ.'])
test('a question or conditional correction cannot recheck the card after a failed model reply: '+clause,async t=>{
    const h=await setup(t),c=h.controller;
    await c.chatUpdate({fields:{priority:{id:'medium'}},descriptionSections:{links:'https://git.example/demo-api'}},c.chatSnapshot(),undefined,{appManagedQuestions:true});
    await c.chatValidate(c.chatSnapshot());assert.ok(c.getState().draft.checked);const before=c.getState().draft;
    const text=clause+' Приоритет высокий.',{chat}=h.create(async()=>({text:liveProse}));await chat.send(text);const d=c.getState().draft;
    assert.deepEqual(d.fields,before.fields);assert.equal(d.source,before.source);assert.equal(d.checked,null);assert.ok(chat.getState().error);
    assert.equal(chat.getState().transcript.findLast(m=>m.role==='user').text,text);assert.equal(h.posts(),0);
});
test('conversation reload cannot turn a persisted unresolved correction into a local readiness-only check',async t=>{
    const h=await setup(t),c=h.controller;
    await c.chatUpdate({fields:{priority:{id:'medium'}},descriptionSections:{links:'https://git.example/demo-api'}},c.chatSnapshot(),undefined,{appManagedQuestions:true,unresolvedChatFacts:['QA проверит HTTP 200 на /health?']});await c.chatValidate(c.chatSnapshot());
    const first=h.create(async()=>({text:liveProse}));await first.chat.send('QA проверит HTTP 200 на /health? Приоритет высокий.');
    assert.equal(c.getState().draft.checked,null);first.chat.destroy();let calls=0;
    const second=h.create(async()=>{calls++;return {text:liveProse};});assert.equal(second.chat.getState().error,null);
    await second.chat.send('Подтверди готовность задачи.');assert.equal(calls,2);assert.equal(c.getState().draft.checked,null);assert.match(JSON.stringify(c.getState().draft.unresolvedChatFacts),/QA проверит/);
});
for(const text of ['Приоритет: Высокий.','Окно: 21:30–22:15.','Проверка: /ready возвращает ready=true. Кто проверяет: Мария Иванова.','Команда эксплуатации проверяет код READY в /status.'])
test('labeled correction is sent to the model and never applied from prose alone: '+text,async t=>{
    const h=await setup(t),c=h.controller;await c.chatUpdate({fields:{priority:{id:'medium'}}},c.chatSnapshot());const before=c.getState().draft;
    const requests=[],{chat}=h.create(async request=>{requests.push(request);return {text:liveProse};});await chat.send(text);
    assert.equal(requests.length,2);assert.ok(requests[0].user.includes(text));assert.ok(chat.getState().error);
    assert.deepEqual(c.getState().draft.fields,before.fields);assert.deepEqual(c.getState().draft.pendingFields,before.pendingFields);
    assert.equal(c.getState().draft.source,before.source);assert.equal(c.getState().draft.checked,null);assert.equal(h.posts(),0);
});
test('repeated provider prose after reload preserves saved card and keeps the mixed answer in model context',async t=>{
    const original=await setup(t);await original.controller.chatUpdate({fields:{priority:{id:'medium'}}},original.controller.chatSnapshot());
    const before=original.controller.getState().draft;original.controller.destroy();
    const h=await setup(t,{backend:original.backend}),c=h.controller,requests=[];
    const {chat}=h.create(async request=>{requests.push(request);return {text:liveProse};});await chat.send(liveAnswer);
    assert.equal(requests.length,2);assert.ok(requests[0].user.includes(liveAnswer));assert.equal(chat.getState().error.code,'draft-update');
    assert.deepEqual(c.getState().draft.fields,before.fields);assert.equal(c.getState().draft.source,before.source);assert.equal(c.getState().draft.checked,null);
    assert.equal(chat.getState().transcript.filter(m=>m.role==='user' && m.text===liveAnswer).length,1);assert.equal(h.posts(),0);
});
for(const guard of ['extra','negative','ambiguous','unknown','manual','pending','manual-priority','pending-priority','excluded-priority'])test('failed model response preserves all saved authority without inferring corrections: '+guard,async t=>{
    const h=await setup(t),c=h.controller;await c.chatUpdate({fields:{priority:{id:'medium'}}},c.chatSnapshot());
    let text=liveAnswer;
    if(guard==='extra')text+=' Миграции не выполнять.';
    if(guard==='negative')text=text.replace('Дежурный проверит','Дежурный не проверит');
    if(guard==='unknown')text=text.replace('высокий','сверхвысокий');
    if(guard==='ambiguous')text=text.replace('высокий','высокий или средний');
    if(guard==='manual' || guard==='pending')await c.updateField('description',c.getState().draft.fields.description);
    if(guard==='pending')await c.chatUpdate({fields:{description:c.getState().draft.fields.description+'\nДополнительно: ручное предложение'}},c.chatSnapshot());
    if(guard==='manual-priority' || guard==='pending-priority')await c.updateField('priority',{id:'medium'});
    if(guard==='pending-priority')await c.chatUpdate({fields:{priority:{id:'high'}}},c.chatSnapshot());
    if(guard==='excluded-priority')await c.setGenerationFields(c.getState().generationFieldIds.filter(id=>id!=='priority'));
    const before=c.getState().draft,requests=[],{chat}=h.create(async request=>{requests.push(request);return {text:liveProse};});await chat.send(text);const d=c.getState().draft;
    assert.ok(chat.getState().error);assert.deepEqual(d.fields,before.fields);assert.deepEqual(d.pendingFields,before.pendingFields);
    assert.deepEqual(d.protectedFields,before.protectedFields);assert.equal(d.source,before.source);assert.equal(d.checked,null);
    assert.ok(requests[0].user.includes(text));assert.equal(chat.getState().transcript.findLast(m=>m.role==='user').text,text);assert.equal(h.posts(),0);
});
test('already matching model section values do not turn a failed reply into a successful update',async t=>{
    const h=await setup(t),c=h.controller;
    await c.chatUpdate({fields:{priority:{id:'high'}},descriptionSections:{window:'С 19:00 до 20:00.',verification:'Дежурный проверит HTTP 200 на /health.',verifier:'Дежурный'}},c.chatSnapshot(),undefined,{appManagedQuestions:true});
    const before=c.getState().draft,{chat}=h.create(async()=>({text:liveProse}));await chat.send(liveAnswer);
    assert.ok(chat.getState().error);assert.deepEqual(c.getState().draft.fields,before.fields);assert.equal(c.getState().draft.source,before.source);assert.equal(c.getState().draft.checked,null);
    assert.equal(h.posts(),0);
});
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
for(const failure of ['malformed','502'])for(const literal of [false,true])test('generic failed response only saves an explicitly commanded description and keeps validation blockers: '+failure+' literal='+literal,async t=>{
    const h=await setup(t),c=h.controller;await c.selectProject('APP');await c.selectIssueType('20');await c.selectTemplate('task');
    assert.notEqual(c.getState().draft.appManagedQuestions,true);
    const {chat}=h.create(async()=>{if(failure==='502')throw Error('Pico HTTP 502');return {text:'not a data response'};});
    await chat.send((literal?'Описание: ':'')+'Настроить API на стенде TEST для доступа команды.');
    const s=c.getState();assert.equal(s.draft.appManagedQuestions,literal);assert.equal(s.draft.checked,null);
    assert.equal(s.draft.fields.description,literal?'Настроить API на стенде TEST для доступа команды.':undefined);assert.ok(chat.getState().error);
    if(literal)assert.ok(s.validation.questions.some(q=>q.id==='template:acceptance'));
    else {assert.equal(s.validation,null);const checked=await c.chatValidate(c.chatSnapshot());assert.equal(checked.ok,false);assert.ok(checked.validation.fieldErrors.description);}
    assert.doesNotMatch(chat.getState().transcript.at(-1).text,/Проверка пройдена|Можно нажать «Создать»/);assert.equal(h.posts(),0);
});
test('complete generic narrative remains unfilled when the model fails',async t=>{
    const h=await setup(t),c=h.controller;await c.selectProject('APP');await c.selectIssueType('20');await c.selectTemplate('task');
    const {chat}=h.create(async()=>{throw Error('Pico HTTP 502');});
    await chat.send('Настроить API.\nЦель: доступ команды.\nЧто сделать: настроить API.\nГде: стенд TEST.\nКритерии приёмки: GET /health возвращает HTTP 200.');
    const s=c.getState();assert.equal(s.draft.appManagedQuestions,false);assert.equal(s.draft.fields.description,undefined);assert.equal(s.draft.fields.summary,undefined);assert.equal(s.draft.checked,null);assert.ok(chat.getState().error);assert.equal(h.posts(),0);
});
for(const failure of ['malformed','429'])test('failed custom-template response cannot infer DBA approval or modify the draft: '+failure,async t=>{
    const h=await setup(t),c=h.controller;await c.selectProject('APP');await c.selectIssueType('20');
    const settings=c.getState().settings;
    settings.profiles.find(p=>p.id==='universal').templates.push({id:'dba',name:'DBA',whenToUse:'Доступ',instructions:'Требуется согласование DBA. Если его нет, задай обязательный вопрос.',issueTypeId:'20'});
    await c.applySettings(settings);await c.selectTemplate('dba');assert.equal(c.chatDescriptionSections().length,0);const before=c.getState().draft;
    const {chat,configs}=h.create(async()=>{if(failure==='429')throw Error('Pico HTTP 429');return {text:'not a data response'};});
    await chat.send('Настроить API в TEST. Согласование DBA не получено.');
    const s=c.getState();assert.equal(configs[0].appManagedPatch,false);assert.equal(s.draft.checked,null);assert.equal(s.draft.templateReviewPending,before.templateReviewPending);assert.deepEqual(s.draft.fields,before.fields);assert.equal(s.draft.source,before.source);assert.ok(chat.getState().error);
    assert.doesNotMatch(chat.getState().transcript.at(-1).text,/Проверка пройдена|Можно нажать «Создать»/);assert.equal(h.posts(),0);
});
for(const ready of [true,false])test('readiness after a failed edit calls the model and cannot approve stale fields, including reload: '+ready,async t=>{
    const h=await setup(t),c=h.controller;
    await c.chatUpdate(ready?{descriptionSections:{links:'https://git.example/demo-api'}}:{fields:{}},c.chatSnapshot(),undefined,{appManagedQuestions:true});
    await c.chatValidate(c.chatSnapshot());if(ready)assert.ok(c.getState().draft.checked);
    const before=c.getState().draft,requests=[];
    const unavailable=async request=>{requests.push(request);throw Error('Pico HTTP 502');};
    const {chat}=h.create(unavailable);
    await chat.send('Работать только на TEST, DEV не трогать.');
    assert.equal(c.getState().draft.checked,null);
    await chat.send('Подтверди готовность задачи.');
    assert.equal(requests.length,2);assert.equal(chat.getState().error.code,'transport');
    assert.deepEqual(c.getState().draft.fields,before.fields);assert.equal(c.getState().draft.checked,null);
    chat.destroy();
    const restored=h.create(unavailable).chat;
    await restored.send('Подтверди готовность задачи.');
    assert.equal(requests.length,3);assert.equal(restored.getState().error.code,'transport');
    assert.ok(requests[2].user.includes('Работать только на TEST'));
    assert.deepEqual(c.getState().draft.fields,before.fields);assert.equal(c.getState().draft.checked,null);
    assert.equal(h.posts(),0);
    restored.destroy();
    const recovered=h.create(async request=>{
        const input=JSON.parse(request.user);
        assert.ok(input.current.description.includes('DEV'));
        assert.ok(input.userAnswers.some(entry=>entry.text.includes('Работать только на TEST')));
        return {text:JSON.stringify({fields:{summary:'Обновить demo-api на TEST',description:before.fields.description.replace(/DEV/g,'TEST')},missing:[]})};
    }).chat;
    await recovered.send('Подтверди готовность задачи.');
    assert.equal(recovered.getState().error,null);
    assert.match(c.getState().draft.fields.description,/Среда: TEST/);
    assert.equal(!!c.getState().draft.checked,ready);
    assert.equal(h.posts(),0);
});
