const test=require('node:test');
const assert=require('node:assert/strict');
const {loadUnit,memoryStorage}=require('./helpers/ticket-assistant-fixture');

// Keep literal fixtures independent of the formatter and payload builder under test.
const cases=[
    {id:'10',template:'task',summary:'Восстановить доступ к API на TEST',description:[
        'Цель: вернуть команде доступ к API.',
        'Что сделать: обновить конфигурацию API и перезапустить сервис.',
        'Где: API на стенде TEST, узел test-01.',
        'Критерии приёмки: API возвращает HTTP 200 на /health.',
        'Ссылки: https://git.example/api/runbook'
    ].join('\n\n')},
    {id:'11',template:'bug',summary:'Исправить HTTP 500 при загрузке файла в API на TEST',description:[
        'Что происходит: API возвращает HTTP 500 при загрузке файла.',
        'Что ожидалось: API принимает файл и отвечает HTTP 201.',
        'Шаги воспроизведения: открыть загрузку на TEST и отправить sample.csv.',
        'Где: API версии 2.3 на стенде TEST, узел test-01.',
        'Логи / скриншоты: https://logs.example/incidents/123',
        'Критерии приёмки: sample.csv загружается с HTTP 201.',
        'Ссылки: https://git.example/api'
    ].join('\n\n')},
    {id:'12',template:'deployment',summary:'Развернуть API версии 2.3 на TEST',description:[
        'Среда: TEST, сервис API на test-01.',
        'Версия и состав: API 2.3, артефакт registry.example/api:2.3.',
        'Порядок: обновить образ API, перезапустить deployment, выполнить миграцию 23.',
        'Окно: 10 ноября с 14:00 до 16:00 МСК.',
        'Проверка: инженер команды разработки проверяет HTTP 200 на /health.',
        'Ссылки: https://git.example/api/releases/2.3'
    ].join('\n\n')}
];

async function setup(t,scenario,format,custom=false) {
    const profiles=loadUnit('profiles'),posts=[],h={drafts:loadUnit('draft'),fields:loadUnit('fields')};
    h.validation=loadUnit('validation',{_ujgTA_fields:h.fields});
    const Storage=loadUnit('storage',{_ujgTA_profiles:profiles,_ujgTA_draft:h.drafts});
    h.store=Storage.createStore({storage:memoryStorage(),userKey:'alice',origin:'https://jira.test'});
    h.api={getCurrentUser:async()=>({key:'alice'}),getComponents:async key=>({projectKey:key,values:[],complete:true}),
        getVersions:async key=>({projectKey:key,values:[],complete:true}),getCreateMeta:async key=>({projects:[{key,id:'103',issuetypes:cases.map(item=>({
            id:item.id,name:{task:'Task',bug:'Bug',deployment:'Deployment'}[item.template],fields:{
                summary:{name:'Summary',required:true,schema:{type:'string',system:'summary'}},
                description:{name:'Description',schema:{type:'string',system:'description'}}
            }
        }))}]})};
    // Supply the production dependency graph explicitly, independently of shared harnesses.
    const deps={_ujgTA_draft:h.drafts,_ujgTA_fields:h.fields,_ujgTA_validation:h.validation,_ujgTA_profiles:profiles};
    const Creator=loadUnit('creator',deps);
    const Controller=loadUnit('controller',{...deps,_ujgTA_creator:Creator},{AbortController});
    h.controller=Controller.create({api:h.api,ai:{},createStore:()=>h.store});
    const c=h.controller,read=h.api.getCreateMeta;
    t.after(()=>c.destroy());
    h.api.getProjects=async()=>({values:[{key:'DEVOPS',id:'DO-project',name:'DEVOPS'}]});
    h.api.getCreateMeta=async key=>{
        const raw=await read(key);
        for(const type of raw.projects[0].issuetypes)type.fields.priority={name:'Приоритет',schema:{type:'priority',system:'priority'},
            hasDefaultValue:true,defaultValue:{id:'medium'},allowedValues:[{id:'medium',name:'Средний'}]};
        return raw;
    };
    h.api.checkDevopsIssue=async()=>({fieldErrors:{},warnings:[],link:null});
    // Use the actual API adapter: inspect serialized HTTP data, not buildCreatePayload's return value.
    const api=loadUnit('api',{}, {location:{origin:'https://jira.test',pathname:'/jira/plugins/servlet/gadgets'},URL}).createApi({baseUrl:'/jira',ajax:async request=>{
        assert.equal(request.type,'POST');assert.equal(request.url,'/jira/rest/api/2/issue');
        assert.equal(request.contentType,'application/json');
        assert.equal(typeof request.data,'string');posts.push(JSON.parse(request.data));
        return {id:'123',key:'DEVOPS-123'};
    }});
    h.api.createIssue=api.createIssue;
    await c.init();await c.selectProject('DEVOPS');
    assert.equal(c.getState().settings.descriptionFormat,'markdown');
    if(format==='plain' || custom) {
        const settings=c.getState().settings;settings.descriptionFormat=format;
        if(custom) {
            const p=settings.profiles.find(p=>p.id==='devops'),base=p.templates.find(x=>x.id===scenario.template);
            if(custom==='edited-default')base.instructions+=' Сохрани личные пометки и оформление.';
            else p.templates.push({...base,id:'personal-'+scenario.template,name:'Личный шаблон',instructions:base.instructions+' Сохрани личные пометки и оформление.',issueTypeId:scenario.id});
        }
        await c.applySettings(settings);
    }
    await c.selectIssueType(scenario.id);
    assert.equal(c.getState().draft.templateId,custom==='personal'?'personal-'+scenario.template:scenario.template);
    return {...h,posts,custom:!!custom};
}

async function fill(t,h,scenario,description,via) {
    const fields={summary:scenario.summary,description},c=h.controller;
    if(via==='controller') {
        const applied=await c.chatUpdate({fields,questions:[]},c.chatSnapshot(),description);
        assert.equal(applied.ok,true);await c.chatValidate(c.chatSnapshot());
    } else {
        const runtime=await import('../ujg-ticket-assistant-chat/runtime.mjs');
        const Chat=loadUnit('chat',{_ujgTA_chatTools:loadUnit('chat-tools',{_ujgTA_fields:h.fields}),_ujgTA_draft:h.drafts},{AbortController});
        const chat=Chat.create({controller:c,store:h.store,runtime,requestText:async()=>({text:JSON.stringify({text:'',toolCalls:[{id:'fill',name:'update_task',arguments:{fields,questions:[]}}]})})});
        t.after(()=>chat.destroy());await chat.send(description);assert.equal(chat.getState().error,null);
    }
    // Personal rules require their explicit semantic-review completion after the
    // update; exercise the controller's guarded API rather than clearing flags.
    const state=c.getState();
    if(state.draft.templateReviewPending) {
        assert.equal(h.custom,true);
        const reviewed=await c.chatCompleteTemplateReview(c.chatSnapshot(),state.draft.settingsRevision);
        assert.ok(reviewed.validation);
    }
    assert.equal(c.getState().draft.source,description);assert.equal(h.posts.length,0);
}

for(const scenario of cases)for(const format of ['markdown','plain'])for(const via of ['controller','chat']) {
    const label=scenario.template+' / '+format+' / '+via;
    test('DEVOPS default template reaches mock create POST with structured description: '+label,async t=>{
        const h=await setup(t,scenario,format);await fill(t,h,scenario,scenario.description,via);
        const s=h.controller.getState();assert.equal(s.validation.ok,true);assert.ok(s.draft.checked);
        await h.controller.submit();assert.equal(h.posts.length,1,JSON.stringify(h.controller.getState().draft.creation));
        const payload=h.posts[0];
        assert.deepEqual(payload.fields.project,{id:'103'});assert.deepEqual(payload.fields.issuetype,{id:scenario.id});
        assert.equal(payload.fields.summary,scenario.summary);
        const description=payload.fields.description;
        if(format==='markdown') {
            assert.ok(description.startsWith('||Поле||Описание||\n'));
            // The literal source fixtures independently define expected table cells.
            const posted=description.split('\n').slice(1).map(line=>{
                assert.ok(line.startsWith('|') && line.endsWith('|'));
                const cells=line.slice(1,-1).split('|');assert.equal(cells.length,2);
                return {label:cells[0],value:cells[1].replace(/\\([|{}\[\]*_!^~#+-])/g,'$1').replace(/&amp;/g,'&')};
            });
            assert.deepEqual(posted,scenario.description.split('\n\n').map(block=>{
                const colon=block.indexOf(':');return {label:block.slice(0,colon),value:block.slice(colon+2)};
            }));
            assert.equal(h.controller.getState().draft.fields.description,scenario.description,'serialized wiki must not replace canonical draft state');
        } else assert.equal(description,scenario.description);
        assert.equal(h.controller.getState().draft.creation.status,'created');
        await h.controller.submit();assert.equal(h.posts.length,1,'a successful create must not be repeated');
    });
    test('unstructured DEVOPS description cannot become ready or reach create POST: '+label,async t=>{
        const h=await setup(t,scenario,format);await fill(t,h,scenario,'Все необходимые работы согласованы. Создайте задачу.',via);
        const s=h.controller.getState();assert.equal(s.validation.ok,false);assert.equal(s.draft.checked,null);
        assert.ok(s.validation.questions.some(q=>q.required));
        await h.controller.submit();assert.equal(h.posts.length,0);assert.notEqual(h.controller.getState().draft.creation.status,'created');
    });
    for(const custom of ['personal','edited-default'])test('custom DEVOPS template description reaches create POST unchanged: '+custom+' / '+label,async t=>{
        const h=await setup(t,scenario,format,custom),description=scenario.description+'\n\nЛичная пометка: оставить *ручное выделение* и `api.conf` без изменений.';
        await fill(t,h,scenario,description,via);
        assert.equal(h.controller.getState().draft.fields.description,description);
        assert.equal(h.controller.getState().validation.ok,true,JSON.stringify(h.controller.getState().validation));assert.ok(h.controller.getState().draft.checked);
        await h.controller.submit();assert.equal(h.posts.length,1);assert.equal(h.posts[0].fields.description,description);
        assert.equal(h.controller.getState().draft.creation.status,'created');
    });
}
