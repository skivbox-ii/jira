const test = require('node:test');
const assert = require('node:assert/strict');
const {loadUnit, metadataFixture} = require('./helpers/ticket-assistant-fixture');
const fields = loadUnit('fields');
const validation = loadUnit('validation', {_ujgTA_fields: fields});
function meta() {
    const m = metadataFixture('DEVOPS');
    m.issueTypes.forEach(t => t.fields.push({id:'priority',name:'Приоритет',kind:'option',required:false,supported:true,writable:true,optionsComplete:true,allowedValues:[{id:'medium',label:'Средний'},{id:'critical',label:'Критический'}],defaultApplicable:true,defaultValue:{id:'medium'}}));
    return m;
}
const descriptions = {
    '10': 'Цель: Обеспечить доступ команды к API.\nЧто сделать: Обновить конфигурацию API и перезапустить сервис.\nГде: API на стенде TEST, узел test-01.\nКритерии приёмки: API возвращает HTTP 200 на /health.\nСсылки: https://git.example/api/runbook',
    '11': 'Что происходит: API на TEST возвращает HTTP 500 при загрузке файла.\nЧто ожидалось: API принимает файл и отвечает HTTP 201.\nШаги воспроизведения: Открыть загрузку на TEST и отправить sample.csv.\nГде: API версии 2.3 на стенде TEST, узел test-01.\nЛоги / скриншоты: https://logs.example/incidents/123\nКритерии приёмки: sample.csv загружается с HTTP 201.\nСсылки: https://git.example/api',
    '12': 'Среда: TEST, сервис API на test-01.\nВерсия и состав: API 2.3, артефакт registry.example/api:2.3.\nПорядок: Обновить тег образа API, перезапустить deployment и выполнить миграцию 23.\nОкно: 10 ноября с 14:00 до 16:00 МСК.\nПроверка: Инженер команды разработки проверяет HTTP 200 на /health.\nСсылки: https://git.example/api/releases/2.3'
};
function values(type='10', description=descriptions[type]) {return {summary:'Обновить сервис API в TEST до 2.3',description};}
function check(type='10', description=descriptions[type], policy={}) {return validation.validateFields(meta(),type,values(type,description),policy);}
function remove(description, label) {return description.split('\n').filter(line => !line.startsWith(label+':')).join('\n');}

test('DEVOPS enforces three substantive descriptions and accepts actual Jira priority default without due or assignee', () => {
    for (const type of ['10','11','12']) assert.equal(check(type).ok,true,JSON.stringify(check(type)));
    assert.equal(check('12',remove(descriptions['12'],'Окно')).ok,false);
    assert.match(check('12',remove(descriptions['12'],'Окно')).questions.find(q=>q.id==='devops:window').text,/окно|время/i);
    assert.equal(check('12',descriptions['12'].replace('Инженер команды разработки проверяет ','')).ok,false);
});

test('missing questions come only from current labelled description and resolve independently', () => {
    const result=check('10',remove(descriptions['10'],'Цель'));
    assert.deepEqual(Array.from(result.questions,q=>q.id),['devops:goal']);
    assert.equal(result.questions[0].required,true);
    assert.equal(check().questions.length,0);
});

test('unstructured text and meaningless filled headings cannot authorize creation', () => {
    assert.equal(check('10','Всё есть, задачу можно создавать.').ok,false);
    for (const value of ['—','TODO','нет','неизвестно','уточним позже','не нужно заполнять','цель','...','{что сделать}','не применимо','Конкретный объём работ','Не указано, уточним позже','Зачем это нужно, 1–2 предложения']) {
        const description=descriptions['10'].replace('Обновить конфигурацию API и перезапустить сервис.',value);
        assert.equal(check('10',description).ok,false,value);
    }
    for(const summary of ['Сделать обновление','Задача','Тест','...']) assert.equal(validation.validateFields(meta(),'10',{...values(),summary}).ok,false,summary);
});

test('links require actual URL even when a reason for missing references was recorded', () => {
    for(const value of ['созвонимся','позже пришлю ссылку','ссылка есть','нет','https://','https://...' ]) assert.equal(check('10',descriptions['10'].replace('https://git.example/api/runbook',value)).ok,false,value);
    assert.equal(check('10',descriptions['10'].replace('https://git.example/api/runbook','Не применимо: для разовой настройки локального тестового стенда нет репозитория или документации.')).ok,false);
});

test('bug evidence must exist, and a claim of an attached file alone is insufficient', () => {
    const description=descriptions['11'].replace('https://logs.example/incidents/123','Лог приложен отдельным файлом.');
    assert.equal(check('11',description).ok,false);
    assert.equal(check('11',description,{attachments:[{name:'api.log',size:200,status:'pending',needsReselect:false}]}).ok,true);
    assert.equal(check('11',description,{attachments:[{name:'api.log',size:200,status:'pending',needsReselect:true}]}).ok,false);
    assert.equal(check('11',description,{attachments:[{name:'api.log',size:0,status:'pending'}]}).ok,false);
    assert.equal(check('11',descriptions['11'].replace('https://logs.example/incidents/123','Фрагмент лога: 2026-11-06 ERROR upload failed, request_id=123.')).ok,true);
});

test('field bug log exception needs reason, configuration, version and observed conditions', () => {
    const description=descriptions['11'].replace('https://logs.example/incidents/123','Логи недоступны: ошибка с поля, установщик не имеет доступа к окружению.\nКонфигурация: Linux 6, API в контейнере на узле test-01.\nВерсия: API 2.3.\nУсловия возникновения: Установщик отправил sample.csv после обновления API.');
    assert.equal(check('11',description).ok,true);
    assert.equal(check('11',description.replace('Версия: API 2.3.','Версия: 2.3.')).ok,true);
    for(const label of ['Конфигурация','Версия','Условия возникновения']) assert.equal(check('11',remove(description,label)).ok,false,label);
    assert.equal(check('11',descriptions['11'].replace('https://logs.example/incidents/123','Не нужно заполнять, пользователь отказался.')).ok,false);
});

test('pipeline failure needs failing-stage build evidence', () => {
    const description=descriptions['11'].replace('API на TEST возвращает HTTP 500 при загрузке файла.','Пайплайн API падает на шаге build.');
    assert.equal(check('11',description).ok,false);
    assert.equal(check('11',description+'\nЛог сборки: https://ci.example/api/build/123, упавший шаг build.').ok,true);
});

test('critical priority requires actual service failure and halted work evidence', () => {
    const m=meta(),v={...values(),priority:{id:'critical'}};
    assert.equal(validation.validateFields(m,'10',v).ok,false);
    assert.equal(validation.validateFields(m,'10',{...v,description:v.description+'\nВлияние: Очень срочно, начальник просит сегодня.'}).ok,false);
    const critical=validation.validateFields(m,'10',{...v,description:v.description+'\nВлияние: Сервис API упал, тестирование остановлено.'});
    assert.equal(critical.ok,true);assert.match(critical.warnings.join(' '),/комментари.*обоих|обоих.*комментари/);
    assert.equal(validation.validateFields(m,'10',{...v,description:v.description+'\nВлияние: Сервис API не упал, тестирование не остановлено.'}).ok,false);
});

test('mandatory priority cannot be invented or disappear behind a boolean default flag', () => {
    const m=meta(),p=m.issueTypes[0].fields.find(f=>f.id==='priority');
    p.defaultApplicable=false;p.defaultValue=null;
    assert.equal(validation.validateFields(m,'10',values()).ok,false);
    assert.equal(validation.validateFields(m,'10',{...values(),priority:{id:'medium'}}).ok,true);
    p.defaultApplicable=true;
    assert.equal(validation.validateFields(m,'10',values()).ok,false);
    assert.equal(validation.validateFields(meta(),'10',{...values(),priority:null}).ok,false);
});

test('builder rejects an old checked card independently, while partial field validation and other projects work', () => {
    assert.throws(()=>validation.buildCreatePayload(meta(),'12',values('12',remove(descriptions['12'],'Окно'))),e=>e.kind==='validation' && e.validation.questions.some(q=>q.id==='devops:window'));
    assert.equal(validation.validateFields(metadataFixture(),'10',{summary:'A'}).ok,true);
    const m=meta();delete m.projectKey;
    assert.equal(validation.validateFields(m,'10',{summary:'Title'}).ok,true);
});

test('unavailable DEVOPS types and empty acceptance criteria are blocked', () => {
    const m=meta();m.issueTypes[0].name='История';
    assert.equal(validation.validateFields(m,'10',values()).ok,false);
    assert.equal(check('10',remove(descriptions['10'],'Критерии приёмки')).ok,false);
    assert.equal(check('11',remove(descriptions['11'],'Критерии приёмки')).ok,false);
});

async function devopsHarness(type='12') {
    const {harness}=require('./helpers/ticket-assistant-chat-fixture');
    const h=await harness(),original=h.api.getCreateMeta;
    h.posts=[];
    h.api.getProjects=async()=>({values:[{key:'DEVOPS',id:'DO-project',name:'DEVOPS'}]});
    h.api.getCreateMeta=async key=>{
        const raw=await original(key);
        raw.projects[0].issuetypes.forEach(t=>{t.fields.priority={name:'Приоритет',schema:{type:'priority',system:'priority'},hasDefaultValue:true,defaultValue:{id:'medium'},allowedValues:[{id:'medium',name:'Средний'},{id:'critical',name:'Критический'}]};});
        return raw;
    };
    h.api.checkDevopsIssue=async()=>({fieldErrors:{},warnings:[],link:null});
    h.api.createIssue=async payload=>{h.posts.push(payload);return {key:'DEVOPS-123',id:'123'};};
    h.api.getAttachmentMeta=async()=>({enabled:true,uploadLimit:100000});
    h.api.uploadAttachment=async()=>({id:'a'});
    await h.controller.init();await h.controller.selectProject('DEVOPS');await h.controller.selectIssueType(type);
    return h;
}

test('current manual description removes stale local questions and revokes readiness on later edits',async t=>{
    const h=await devopsHarness(),c=h.controller;t.after(()=>c.destroy());
    await c.updateField('summary',values('12').summary);await c.updateField('description',remove(descriptions['12'],'Окно'));
    let result=await c.chatValidate(c.chatSnapshot());
    assert.equal(result.ok,false);assert.deepEqual(Array.from(result.questions,q=>q.id),['devops:window']);
    await c.updateField('description',descriptions['12']);result=await c.chatValidate(c.chatSnapshot());
    assert.equal(result.ok,true);assert.equal(c.getState().draft.questions.length,0);assert.ok(c.getState().draft.checked);
    await c.updateField('description',remove(descriptions['12'],'Окно'));assert.equal(c.getState().draft.checked,null);
    await c.submit();assert.equal(h.posts.length,0);
});

test('creator independently rejects legacy checked DEVOPS content and exposes actionable errors before POST',async t=>{
    const h=await devopsHarness(),c=h.controller;t.after(()=>c.destroy());
    await c.updateField('summary',values('12').summary);await c.updateField('description',remove(descriptions['12'],'Окно'));
    const current=c.getState(),d=h.drafts.markChecked(current.draft,{ok:true,fieldErrors:{},warnings:[],unsupportedRequired:[]},[],h.drafts.snapshot(current.draft));
    const saved=h.store.load('DEVOPS');h.store.save('DEVOPS',{draft:d,settings:current.settings},saved.revision);
    const creator=loadUnit('creator',{_ujgTA_draft:h.drafts,_ujgTA_fields:h.fields,_ujgTA_validation:validation}).create({api:h.api,store:h.store});
    t.after(()=>creator.destroy());let latest,info;
    await creator.submit({draft:d,settings:current.settings},(draft,extra)=>{latest=draft;info=extra;});
    assert.equal(h.posts.length,0);assert.equal(latest.checked,null);assert.match(latest.creation.error,/окно|время/i);
    assert.ok(info.fieldErrors.description);assert.equal(latest.questions[0].id,'devops:window');
    await creator.submit({draft:latest,settings:current.settings},()=>{});assert.equal(h.posts.length,0);
});

test('create without attachments cannot reuse bug readiness grounded in a selected evidence file',async t=>{
    const h=await devopsHarness('11'),c=h.controller;t.after(()=>c.destroy());
    await c.updateField('summary','Исправить HTTP 500 при загрузке в API на TEST');
    await c.updateField('description',descriptions['11'].replace('https://logs.example/incidents/123','Лог приложен отдельным файлом.'));
    await c.selectFiles([new File(['2026 ERROR failed'],'api.log',{type:'text/plain'})]);
    assert.equal((await c.chatValidate(c.chatSnapshot())).ok,true);
    await c.submit({withoutAttachments:true});assert.equal(h.posts.length,0);assert.match(c.getState().draft.creation.error,/лог|скриншот/i);
});

test('HTTP 429 local fallback asks one distinct next missing question and full blockers stay in card',async t=>{
    const h=await devopsHarness(),c=h.controller;t.after(()=>c.destroy());
    const tools=loadUnit('chat-tools',{_ujgTA_fields:h.fields}),Chat=loadUnit('chat',{_ujgTA_chatTools:tools,_ujgTA_draft:h.drafts},{AbortController});
    const chat=Chat.create({controller:c,store:h.store,runtime:{createSession(){return {prompt:async()=>{throw Error('Pico HTTP 429');},abort(){},dispose(){},getMessages(){return [];}};}}});
    t.after(()=>chat.destroy());
    await chat.send(remove(remove(descriptions['12'],'Окно'),'Проверка'));
    const state=c.getState(),answer=chat.getState().transcript.filter(m=>m.role==='assistant').at(-1).text;
    const question=state.validation.questions[0].text;
    assert.equal(answer.split(question).length-1,1,answer);
    assert.ok(!answer.includes(state.validation.questions[1].text),answer);
    assert.equal(state.validation.questions.length,2);assert.equal(state.draft.checked,null);assert.equal(h.posts.length,0);
});

test('chat tools expose exact DEVOPS sections and normal successful update offers only the next missing question',async t=>{
    const h=await devopsHarness(),c=h.controller;t.after(()=>c.destroy());
    const tools=loadUnit('chat-tools',{_ujgTA_fields:h.fields}),Chat=loadUnit('chat',{_ujgTA_chatTools:tools,_ujgTA_draft:h.drafts},{AbortController});
    let n=0;
    const chat=Chat.create({controller:c,store:h.store,runtime:{createSession(config){return {
        async prompt(){
            const task=await config.tools.find(t=>t.name==='get_task').execute({});
            assert.equal(task.devopsRequirements.kind,'deployment');assert.ok(task.devopsRequirements.sections.some(s=>s.id==='window'));
            await config.tools.find(t=>t.name==='update_task').execute({fields:values('12',remove(remove(descriptions['12'],'Окно'),'Проверка')),questions:[]});
            const validated=await config.tools.find(t=>t.name==='validate_task').execute({});assert.equal(validated.ok,false);
            config.onEvent({type:'text',text:'Карточка готова к созданию. '+validated.questions.map(q=>q.text).join(' ')});n++;
        },getMessages(){return [];},abort(){},dispose(){}
    };}}});
    t.after(()=>chat.destroy());await chat.send('Развернуть API 2.3 на TEST.');
    const state=c.getState(),answer=chat.getState().transcript.filter(m=>m.role==='assistant').at(-1)?.text || '';
    assert.equal(n,1);assert.equal(state.draft.checked,null);assert.equal(state.validation.questions.length,2);
    assert.equal(answer.split(state.validation.questions[0].text).length-1,1,answer);
    assert.ok(!answer.includes(state.validation.questions[1].text),answer);
});

test('restored same-signature DEVOPS checked card is revalidated before ready and preserves unrelated data',async t=>{
    const h=await devopsHarness(),c=h.controller;t.after(()=>c.destroy());
    await c.updateSource('Оригинальный текст пользователя');await c.updateField('summary',values('12').summary);
    await c.updateField('description',remove(descriptions['12'],'Окно'));
    const saved=h.store.load('DEVOPS');
    saved.draft.taskExceptions=['Не назначать исполнителя'];
    saved.draft=h.drafts.markChecked(saved.draft,{ok:true,fieldErrors:{},warnings:[],unsupportedRequired:[]},[],h.drafts.snapshot(saved.draft));
    saved.draft.warnings=['Сохранённая пользовательская пометка'];
    assert.equal(h.store.save('DEVOPS',saved,saved.revision).ok,true);
    await c.init();const states=[],unsubscribe=c.subscribe(s=>states.push(s));t.after(unsubscribe);
    await c.selectProject('DEVOPS');const restored=c.getState();
    assert.equal(restored.draft.checked,null);assert.equal(restored.validation.ok,false);
    assert.deepEqual(Array.from(restored.draft.questions,q=>q.id),['devops:window']);
    assert.equal(restored.draft.source,'Оригинальный текст пользователя');
    assert.equal(restored.draft.fields.description,remove(descriptions['12'],'Окно'));
    assert.deepEqual(restored.draft.taskExceptions,['Не назначать исполнителя']);
    assert.ok(restored.draft.protectedFields.description);assert.ok(restored.draft.warnings.includes('Сохранённая пользовательская пометка'));
    assert.ok(states.every(s=>!s.draft?.checked),'No transient old ready marker during restore');
});

test('legacy editor AI check returns specific local DEVOPS question without generic description duplicate',()=>{
    const ai=loadUnit('ai',{_ujgTA_validation:validation,_ujgShared_llmClient:loadUnit('../ujg-shared-modules/llm-client')});
    const input={source:'Развернуть API 2.3 в TEST',meta:meta(),profile:{id:'devops',name:'DEVOPS',instructions:'Правила DEVOPS',allowAssignee:false,
        templates:[{id:'deployment',name:'Развёртывание',whenToUse:'',instructions:'Заполнить разделы',issueTypeId:null}]},
        issueTypeId:'12',templateId:'deployment',allowFieldIds:['summary','description'],draft:{fields:values('12',remove(descriptions['12'],'Окно'))}};
    const response=JSON.stringify({schemaVersion:1,kind:'check',questions:[],warnings:[],evidence:[]});
    const result=ai.parseResponse('check',response,input);
    assert.deepEqual(Array.from(result.questions,q=>q.id),['devops:window']);
});

test('compact typed facts and a dedicated QA verifier are accepted without repeating answered questions',()=>{
    for(const location of ['DEV','TEST','API']) {
        const description=descriptions['12'].replace('TEST, сервис API на test-01.',location)
            .replace('API 2.3, артефакт registry.example/api:2.3.','2.3')
            .replace('Инженер команды разработки проверяет HTTP 200 на /health.','/health возвращает HTTP 200.\nКто проверяет: QA');
        const result=check('12',description);
        assert.equal(result.ok,true,location+': '+JSON.stringify(result));
        assert.equal(result.questions.length,0);
    }
    const fieldBug=descriptions['11'].replace('https://logs.example/incidents/123','Логи недоступны: ошибка с поля, установщик не имеет доступа к окружению.\nКонфигурация: x86\nВерсия: 2.3\nУсловия возникновения: Импорт файла после обновления.');
    assert.equal(check('11',fieldBug).ok,true);
});

test('live formatted deployment prose credits explicit environment release actions working hours and named verifier',()=>{
    const description='**Задача:** Обновить сервис demo-api в среде DEV до версии 1.0 из тега v1.0.\n'+
        '**Действия:**\n1. Заменить образ сервиса.\n2. Перезапустить сервис.\n'+
        '**Окно:** В рабочее время.\n'+
        '**Проверка:** Проверку проводит Иванов Иван.\n'+
        '**Критерии приемки:** Сервис запускается без ошибок, GET /health возвращает HTTP 200.\n'+
        '**Ссылки:** https://git.example/services/demo-api/releases/v1.0';
    const result=validation.validateFields(meta(),'12',{summary:'Обновление сервиса demo-api в DEV до версии 1.0',description});
    assert.equal(result.ok,true,JSON.stringify(result));assert.equal(result.questions.length,0);
    const withoutWindow=description.replace('**Окно:** В рабочее время.\n','');
    assert.deepEqual(Array.from(check('12',withoutWindow).questions,q=>q.id),['devops:window']);
});

test('inline formatted headings and alternate real service values satisfy the same deployment rules',()=>{
    const description='**Задача:** Развернуть reporting-worker в окружении PREPROD до версии 2026.11.6 из тега release-2026.11.6. '+
        '**Действия:** Обновить образ, затем перезапустить worker. '+
        '**Время выполнения:** В рабочие часы. '+
        '**Проверяющий:** QA '+
        '**Критерии готовности:** Очередь обрабатывается, ошибок в логах нет. '+
        '**Ссылки:** https://code.example/reporting/releases/2026.11.6';
    const result=check('12',description);
    assert.equal(result.ok,true,JSON.stringify(result));
});

test('environment and release examples negations and unresolved alternatives do not become task facts',()=>{
    for(const sentence of ['Среда пока неизвестна, например DEV.', 'Обновить сервис не в среде DEV, окружение пока не выбрано.', 'Обновить сервис в DEV или TEST, выбор ещё не сделан.']) {
        const description='**Задача:** '+sentence+'\n**Действия:** Заменить образ API и перезапустить сервис.\nОкно: В рабочее время.\nПроверка: Команда QA проверяет HTTP 200.\nСсылки: https://git.example/api';
        const result=check('12',description);
        assert.ok(result.questions.some(q=>q.id==='devops:location'),sentence);
        assert.ok(result.questions.some(q=>q.id==='devops:release'),sentence);
    }
});

test('complete production prose with working-time window health criterion and named requester leaves only link missing',()=>{
    const description='**Задача:** Обновить сервис demo-api в среде DEV до версии 1.0 из тега v1.0.\n'+
        '**Действия:**\n1. Заменить образ сервиса.\n2. Перезапустить сервис.\n'+
        '**Окно выполнения:** Рабочее время.\n'+
        '**Критерии приёмки:**\n- Проверка HTTP 200 на эндпоинте /health\n- Проверку выполнит: Постановщик.';
    const result=validation.validateFields(meta(),'12',{summary:'Обновление сервиса demo-api в DEV до версии 1.0',description});
    assert.deepEqual(Array.from(result.questions,q=>q.id),['devops:links']);
    assert.equal(check('12',description+'\nСсылки: https://git.example/api/releases/v1.0').ok,true);
});

test('an observable outcome without a person does not invent a named verifier',()=>{
    const description=descriptions['12'].replace('Инженер команды разработки проверяет HTTP 200 на /health.','Сервис запускается без ошибок.');
    assert.deepEqual(Array.from(check('12',description).questions,q=>q.id),['devops:verifier']);
});

test('deployment references do not invent environment and an unspecified tag does not invent a release',()=>{
    const description='Задача: Обновить сервис API из тега неизвестно.\nДействия: Перезапустить сервис.\nОкно выполнения: В рабочее время.\nКритерии приёмки: HTTP 200 на /health.\nКто проверяет: QA\nСсылки: Инструкция по обновлению API в DEV https://git.example/api';
    assert.deepEqual(Array.from(check('12',description).questions,q=>q.id),['devops:location','devops:release']);
});

test('reviewer ambiguous targets source versions and placeholder tags stay incomplete',()=>{
    for(const [sentence,missing] of [
        ['Обновить API в DEV или на TEST до версии 1.0','devops:location'],
        ['Обновить API в DEV с версии 1.0; целевая версия пока неизвестна','devops:release'],
        ['Обновить API в DEV из тега TBD','devops:release'],
        ['Обновить API в DEV до версии 1.0 или 2.0','devops:release']
    ]) {
        const description='Задача: '+sentence+'\nДействия: Заменить образ и перезапустить API.\nОкно: Рабочее время.\nПроверка: HTTP 200 на /health.\nКто проверяет: QA\nСсылки: https://git.example/api';
        assert.deepEqual(Array.from(check('12',description).questions,q=>q.id),[missing],sentence);
    }
});

test('original raw production fallback paragraph leaves exactly the missing repository link',()=>{
    const description='Учебный черновик. Обновить сервис demo-api в DEV до версии 1.0 из тега v1.0 в рабочее время. Поменять образ и перезапустить сервис. Постановщик проверит HTTP 200 на /health. Исходная оценка: 30 минут. Приоритет: Средний. Ссылки на репозиторий для примера нет.';
    const supplied={summary:'Обновление сервиса demo-api в DEV до версии 1.0',description};
    const result=validation.validateFields(meta(),'12',supplied);
    assert.deepEqual(Array.from(result.questions,q=>q.id),['devops:links']);
    assert.equal(supplied.description,description);
});

test('raw prose does not infer actual actions or verifier from negated or merely planned statements',()=>{
    for(const sentence of ['Поменять образ и перезапустить сервис. Кто-то проверит HTTP 200 на /health.', 'Не поменять образ. Постановщик не проверит HTTP 200 на /health.']) {
        const result=check('12','Обновить сервис API в DEV до версии 1.0 в рабочее время. '+sentence);
        assert.ok(result.questions.some(q=>q.id==='devops:verification'),sentence);
        if(sentence.startsWith('Не '))assert.ok(result.questions.some(q=>q.id==='devops:order'),sentence);
    }
});

test('raw deployment operation must not be negated or explicitly unresolved after its verb',()=>{
    for(const operation of [
        'Поменять образ не нужно, порядок действий пока не согласован',
        'Поменять образ пока не согласовано',
        'Поменять образ. Порядок действий пока не определён'
    ]) {
        const description='Обновить API в DEV до версии 1.0 в рабочее время. '+operation+'. Постановщик проверит HTTP 200 на /health.';
        const ids=Array.from(check('12',description).questions,q=>q.id).sort();
        assert.deepEqual(ids,['devops:links','devops:order'],operation);
    }
});

test('raw attributed HTTP check does not credit a negated or unspecified check outcome',()=>{
    for(const verification of [
        'Постановщик проверит HTTP 200 на /health не нужно, проверка отменена',
        'Постановщик проверит HTTP 200 на /health, результат пока неизвестен',
        'Постановщик проверит HTTP 200 на /health, ожидаемый код не определён',
        'Постановщик проверит HTTP 200 на /health. Проверка пока не согласована'
    ]) {
        const description='Обновить API в DEV до версии 1.0 в рабочее время. Поменять образ и перезапустить API. '+verification+'.';
        const ids=Array.from(check('12',description).questions,q=>q.id).sort();
        assert.deepEqual(ids,['devops:links','devops:verification'],verification);
    }
});

const liveRaw='Учебный черновик. Обновить сервис demo-api в DEV до версии 1.0 из тега v1.0 в рабочее время. Поменять образ и перезапустить сервис. Постановщик проверит HTTP 200 на /health. Исходная оценка: 30 минут. Приоритет: Средний. Ссылки на репозиторий для примера нет.';

test('pure formatter splits the live deployment paragraph into actual headings without duplicating raw text',()=>{
    const m=meta(),before=JSON.stringify(m),formatted=validation.formatDevopsDescription(m,'12',liveRaw);
    for(const heading of ['Среда:','Версия и состав:','Порядок:','Окно:','Проверка:'])assert.ok(formatted.includes(heading),formatted);
    for(const fact of ['Учебный черновик','demo-api','DEV','1.0','v1.0','Поменять образ и перезапустить сервис','Постановщик проверит HTTP 200 на /health','Исходная оценка: 30 минут','Приоритет: Средний','Ссылки на репозиторий для примера нет'])assert.ok(formatted.includes(fact),fact);
    assert.equal(formatted.split('Обновить сервис demo-api').length-1,1);
    assert.equal(formatted.split('Постановщик проверит HTTP 200').length-1,1);
    assert.deepEqual(Array.from(check('12',formatted).questions,q=>q.id),['devops:links']);
    assert.equal(validation.formatDevopsDescription(m,'12',formatted),formatted);
    assert.equal(JSON.stringify(m),before);
});

test('formatter preserves structured descriptions exact custom content parent and attachment references',()=>{
    for(const type of ['10','11','12']) {
        const description=descriptions[type]+'\nРодительская история: APP-123\nВложение: trace-2026.LOG\nМой раздел: Содержимое НеМенять.';
        assert.equal(validation.formatDevopsDescription(meta(),type,description),description);
    }
    const raw=liveRaw+'\nНеизвестно: ссылка на репозиторий, документацию или базу знаний (требуется для создания).\nРодительская история: APP-123\nВложение: trace-2026.LOG\nМой раздел: Не менять регистр vRC-1.';
    const formatted=validation.formatDevopsDescription(meta(),'12',raw);
    for(const fact of ['Неизвестно: ссылка на репозиторий, документацию или базу знаний (требуется для создания).','Родительская история: APP-123','Вложение: trace-2026.LOG','Мой раздел: Не менять регистр vRC-1.'])assert.ok(formatted.includes(fact),fact);
    assert.deepEqual(Array.from(check('12',formatted).questions,q=>q.id),['devops:links']);
});

test('formatter leaves ambiguity negation and missing evidence unsatisfied and preserves other projects',()=>{
    for(const sentence of [
        'Обновить API в DEV или на TEST до версии 1.0.',
        'Обновить API в DEV с версии 1.0; целевая версия пока неизвестна.',
        'Обновить API в DEV из тега TBD.',
        'Обновить API в DEV до версии 1.0 или 2.0.',
        'Поменять образ не нужно, порядок действий пока не согласован.',
        'Постановщик проверит HTTP 200 на /health, результат пока неизвестен.'
    ]) {
        const formatted=validation.formatDevopsDescription(meta(),'12',sentence);
        assert.deepEqual(Array.from(check('12',formatted).questions,q=>q.id),Array.from(check('12',sentence).questions,q=>q.id),sentence);
        assert.ok(formatted.includes(sentence.trim()),formatted);
        assert.equal(validation.formatDevopsDescription(meta(),'12',formatted),formatted);
    }
    assert.equal(validation.formatDevopsDescription(metadataFixture(),'10',liveRaw),liveRaw);
    assert.equal(validation.formatDevopsDescription(meta(),'11','Сбой API. Логи недоступны.'),'Сбой API. Логи недоступны.');
});

test('formatter groups confident task and bug location facts while retaining their unanswered requirements',()=>{
    for(const type of ['10','11']) {
        const source='Сервис API на TEST возвращает HTTP 500. Причина пока неизвестна. Требуется расследование.';
        const formatted=validation.formatDevopsDescription(meta(),type,source);
        assert.ok(formatted.includes('Где:'),formatted);
        for(const sentence of source.split('. ').map(s=>s.replace(/\.$/,'')))assert.ok(formatted.includes(sentence),sentence);
        assert.deepEqual(Array.from(check(type,formatted).questions,q=>q.id),Array.from(check(type,source).questions,q=>q.id));
        assert.equal(validation.formatDevopsDescription(meta(),type,formatted),formatted);
    }
});

test('formatter keeps custom headings in their own lines even when they contain recognized facts',()=>{
    const description=liveRaw+'\nКонтекст клиента: Обновить API в DEV до версии 1.0.';
    const formatted=validation.formatDevopsDescription(meta(),'12',description);
    assert.ok(formatted.split('\n').includes('Контекст клиента: Обновить API в DEV до версии 1.0.'),formatted);
});

test('formatted deployment shows required groups first then literal missing-reference reasons and additional facts',()=>{
    const reason='Неизвестно: ссылка на репозиторий, документацию или базу знаний (требуется для создания).';
    const formatted=validation.formatDevopsDescription(meta(),'12',liveRaw+'\n'+reason);
    const headings=['Среда:','Версия и состав:','Порядок:','Окно:','Проверка:','Ссылки:','Дополнительно:'];
    const positions=headings.map(heading=>formatted.indexOf(heading));
    assert.ok(positions.every((position,index)=>position>=0 && (!index || position>positions[index-1])),formatted);
    assert.ok(formatted.startsWith('Среда:'),formatted);
    const links=formatted.slice(positions[5],positions[6]),extra=formatted.slice(positions[6]);
    assert.ok(links.includes('Ссылки на репозиторий для примера нет.'));assert.ok(links.includes(reason));
    for(const fact of ['Учебный черновик.','Исходная оценка: 30 минут.','Приоритет: Средний.'])assert.ok(extra.includes(fact),fact);
    assert.equal(validation.formatDevopsDescription(meta(),'12',formatted),formatted);
    assert.deepEqual(Array.from(check('12',formatted).questions,q=>q.id),['devops:links']);
    const withUrl=formatted.replace('Ссылки:','Ссылки: https://git.example/api/releases/v1.0\n');
    assert.equal(check('12',withUrl).ok,true);
    assert.doesNotThrow(()=>validation.buildCreatePayload(meta(),'12',values('12',withUrl)));
    assert.deepEqual(Array.from(check('12',formatted+'\nДополнительно: Справочный URL https://unrelated.example/notes').questions,q=>q.id),['devops:links']);
});

test('reference answer accepts only an explicit URL or short reference phrase and preserves internal URL query',()=>{
    const url='https://git.internal/scm/API/repo.git?at=refs%2Ftags%2Fv1.0&path=README.md#usage';
    for(const reply of [url,'ссылка на репу '+url,'Вот ссылка на документацию: '+url,'база знаний '+url]) {
        const parsed=validation.parseDevopsReferenceAnswer(reply);assert.equal(parsed.ok,true,JSON.stringify(parsed));assert.equal(parsed.url,url);
    }
    for(const reply of ['git.internal/scm/repo','Создай задачу '+url,'Не добавляй '+url,'ссылка потом','https://',url+' https://docs.internal/a'])assert.equal(validation.parseDevopsReferenceAnswer(reply).ok,false,reply);
});

test('recognized Jira Dashboard path is rejected both as answer and in normal manual validation',()=>{
    for(const url of ['https://jira.internal/secure/Dashboard.jspa?selectPageId=13210','https://jira.internal/jira/secure/Dashboard.jspa?x=1#abc']) {
        const parsed=validation.parseDevopsReferenceAnswer(url);assert.equal(parsed.ok,false);assert.equal(parsed.code,'dashboard');assert.match(parsed.message,/дашборд Jira/);
        const result=check('12',descriptions['12'].replace('https://git.example/api/releases/2.3',url));
        assert.deepEqual(Array.from(result.questions,q=>q.id),['devops:links']);assert.match(result.questions[0].text,/дашборд Jira/);
        assert.throws(()=>validation.buildCreatePayload(meta(),'12',values('12',descriptions['12'].replace('https://git.example/api/releases/2.3',url))),e=>e.kind==='validation');
    }
    for(const url of ['http://git/scm/repo?at=v1.0','https://kb.internal/pages/viewpage.action?pageId=123','https://docs.internal/search?q=/secure/Dashboard.jspa']) {
        assert.equal(validation.parseDevopsReferenceAnswer(url).ok,true,url);
        assert.equal(check('12',descriptions['12'].replace('https://git.example/api/releases/2.3',url)).ok,true,url);
    }
});

test('merge replaces only simple missing-source markers and is idempotent with no fact or Markdown loss',()=>{
    const url='https://git.internal/scm/API/repo?at=v1.0&x=1';
    const source=descriptions['12'].replace('Ссылки: https://git.example/api/releases/2.3','**Ссылки:** Ссылки на репозиторий для примера нет.\nНеизвестно: ссылка на репозиторий, документацию или базу знаний (требуется для создания).')+'\n\n**Дополнительно:**\nИсходная оценка: 30 минут.\nМой раздел: **НЕ МЕНЯТЬ** vRC-1.\nРодительская история: APP-123';
    const merged=validation.mergeDevopsReference(source,url);assert.equal(merged.ok,true);assert.ok(merged.description.includes('**Ссылки:** '+url));
    assert.ok(!merged.description.includes('Ссылки на репозиторий для примера нет.'));assert.ok(!merged.description.includes('Неизвестно: ссылка'));
    for(const fact of ['**Дополнительно:**','Исходная оценка: 30 минут.','Мой раздел: **НЕ МЕНЯТЬ** vRC-1.','Родительская история: APP-123'])assert.ok(merged.description.includes(fact),fact);
    assert.equal(validation.mergeDevopsReference(merged.description,url).description,merged.description);
    assert.equal(check('12',merged.description).ok,true);
});

test('merge preserves unrelated missing-source notes and custom sections, and inserts absent section before extras',()=>{
    const url='https://docs.internal/doc?id=5';
    const source='## Ссылки\nДокументации нет, но есть отдельный риск миграции — согласовать с DBA.\n\n## Риски\nСохранить эту строку и **Markdown**.';
    const merged=validation.mergeDevopsReference(source,url);assert.equal(merged.ok,true);assert.ok(merged.description.includes('Документации нет, но есть отдельный риск миграции — согласовать с DBA.'));assert.ok(merged.description.includes('## Риски\nСохранить эту строку и **Markdown**.'));
    assert.equal(validation.mergeDevopsReference(merged.description,url).description,merged.description);
    const absent=validation.mergeDevopsReference('Среда: DEV\n\nДополнительно:\nАвторская пометка',url);
    assert.equal(absent.ok,true);assert.ok(absent.description.indexOf('Ссылки:')<absent.description.indexOf('Дополнительно:'));assert.ok(absent.description.includes('Авторская пометка'));
    const rejected=validation.mergeDevopsReference(source,'https://jira.internal/secure/Dashboard.jspa');assert.equal(rejected.ok,false);assert.equal(rejected.description,source);
});

test('merge preserves literal query punctuation and never duplicates it on retry',()=>{
    for(const url of ['https://git/repo?q=value.','https://git/repo?q=value)','http://kb:8080/article?x=a%2Fb&return=/secure/Dashboard.jspa#Part-1']) {
        assert.equal(validation.parseDevopsReferenceAnswer(url).url,url);
        const one=validation.mergeDevopsReference('Ссылки: Нет.\n\nДополнительно:\nСохранить заметку.',url);
        assert.equal(one.ok,true);assert.ok(one.description.includes(url));
        assert.equal(validation.mergeDevopsReference(one.description,url).description,one.description,url);
    }
});
