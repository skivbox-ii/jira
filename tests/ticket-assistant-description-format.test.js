const test=require('node:test');
const assert=require('node:assert/strict');
const {harness}=require('./helpers/ticket-assistant-chat-fixture');
const {loadUnit}=require('./helpers/ticket-assistant-fixture');
const raw='Учебный черновик. Обновить сервис demo-api в DEV до версии 1.0 из тега v1.0 в рабочее время. Поменять образ и перезапустить сервис. Постановщик проверит HTTP 200 на /health. Исходная оценка: 30 минут. Приоритет: Средний. Ссылки на репозиторий для примера нет.';
const modified=raw.replace('Ссылки на репозиторий для примера нет.','')+'\nНеизвестно: ссылка на репозиторий отсутствует.';
const linkQuestion='Добавьте ссылку на репозиторий, документацию или базу знаний.';
function assertMissingLink(h,chat) {
    const s=h.controller.getState();
    assert.equal(s.draft.checked,null);assert.equal(s.validation.ok,false);
    assert.equal(s.validation.questions[0].id,'devops:links');assert.equal(s.validation.questions[0].text,linkQuestion);
    assert.equal(chat.getState().transcript.at(-1).text,'Карточка заполнена по вашему сообщению. Создание пока недоступно. '+linkQuestion);
}
async function setup(t,actual=false) {
    const h=await harness();h.calls=[];
    if(!actual)h.validation.formatDevopsDescription=(meta,typeId,description)=>{h.calls.push({project:meta.projectKey,typeId,description});return description.startsWith('Отформатировано: ')?description:'Отформатировано: '+description;};
    h.api.getProjects=async()=>({values:[{key:'DEVOPS',id:'DO-project',name:'DEVOPS'},{key:'APP',id:'APP-project',name:'Application'}]});
    h.api.checkDevopsIssue=async()=>({fieldErrors:{},warnings:[],link:null});
    await h.controller.init();await h.controller.selectProject('DEVOPS');await h.controller.selectIssueType('12');
    const Chat=loadUnit('chat',{_ujgTA_chatTools:loadUnit('chat-tools',{_ujgTA_fields:h.fields}),_ujgTA_draft:h.drafts},{AbortController});
    h.makeChat=action=>Chat.create({controller:h.controller,store:h.store,runtime:{createSession(config){return {prompt:async()=>{await action(config);return {status:'complete'};},getMessages:()=>[],abort(){},dispose(){}};}}});
    t.after(()=>h.controller.destroy());return h;
}
test('normal automatic model update formats the actual Jira field and keeps applied-model provenance',async t=>{
    const h=await setup(t),c=h.controller,chat=h.makeChat(async config=>{
        await config.tools.find(x=>x.name==='update_task').execute({fields:{summary:'Обновить demo-api в DEV',description:raw},questions:[]},{});
        config.afterStep({hasTools:true,failedTool:false,draftExtracted:true});
    });t.after(()=>chat.destroy());await chat.send(raw);
    assert.equal(c.getState().draft.fields.description,'Отформатировано: '+raw);assert.equal(c.getState().draft.source,raw);
    assert.equal(chat.getState().error,null);assertMissingLink(h,chat);
    assert.ok(h.calls.some(x=>x.typeId==='12' && x.description===raw));
});
test('malformed fallback and exact retry use the actual formatted field without duplicate user messages',async t=>{
    const h=await setup(t),c=h.controller,chat=h.makeChat(async()=>{throw Error('Invalid Pico text envelope');});t.after(()=>chat.destroy());
    await chat.send(raw);await chat.send(raw);
    assert.equal(c.getState().draft.fields.description,'Отформатировано: '+raw);assert.equal(c.getState().draft.source,raw);
    assert.equal(chat.getState().error,null);assert.equal(chat.getState().transcript.filter(m=>m.role==='user').length,1);
    assert.equal(h.store.load('DEVOPS').draft.fields.description,c.getState().draft.fields.description);
});
test('restore formats the existing unprotected screenshot description, including its added unknown note',async t=>{
    const h=await setup(t),c=h.controller;
    const saved=h.store.load('DEVOPS');saved.draft.source=raw;saved.draft.sourceRevision++;
    saved.draft.fields={summary:'Учебный черновик.',description:modified};
    assert.equal(h.store.save('DEVOPS',{draft:saved.draft,settings:saved.settings},saved.revision).ok,true);
    await c.init();await c.selectProject('DEVOPS');const d=c.getState().draft;
    assert.equal(d.id,saved.draft.id);assert.equal(d.fields.description,'Отформатировано: '+modified);assert.equal(d.source,raw);
    assert.match(d.fields.description,/Неизвестно: ссылка/);assert.equal(d.fields.summary,'Обновить сервис demo-api в DEV до версии 1.0 из тега v1.0 в рабочее время.');
    await c.init();await c.selectProject('DEVOPS');assert.equal(c.getState().draft.fields.description,d.fields.description);
});
for(const guard of ['protected','pending','verbatim','custom','generic'])test('description formatter preserves '+guard+' intent across updates and reload',async t=>{
    const h=await setup(t),c=h.controller;
    if(guard==='generic'){await c.selectProject('APP');await c.selectIssueType('20');await c.selectTemplate('task');}
    if(guard==='custom'){const settings=c.getState().settings,p=settings.profiles.find(p=>p.id==='devops');p.templates.push({...p.templates[2],id:'custom',name:'Личное оформление',issueTypeId:'12'});await c.applySettings(settings);}
    if(guard==='protected' || guard==='pending')await c.updateField('description','Ручной текст');
    if(guard==='pending')await c.chatUpdate({fields:{description:'Предложение'}},c.chatSnapshot());
    if(guard==='verbatim') {
        const chat=h.makeChat(async()=>{throw Error('provider unavailable');});await chat.send('Описание: '+raw);chat.destroy();
        assert.equal(c.getState().draft.fields.description,raw);
    } else await c.chatUpdate({fields:{description:raw}},c.chatSnapshot(),raw);
    const before=c.getState().draft,callCount=h.calls.length;
    await c.init();await c.selectProject(before.projectKey);const d=c.getState().draft;
    assert.equal(d.fields.description,before.fields.description);assert.equal(h.calls.length,callCount);
    assert.equal(h.calls.length,0);if(guard==='pending')assert.equal(d.pendingFields.description,raw);
});


for(const structured of [false,true])for(const placeholder of [false,true])test('real formatter derives an action topic from proven source, not a section heading: '+JSON.stringify({structured,placeholder}),async t=>{
    const h=await setup(t,true),c=h.controller,formatted=h.validation.formatDevopsDescription(c.getState().meta,'12',raw);
    assert.notEqual(formatted,raw);assert.match(formatted,/^Среда:/);
    const chat=h.makeChat(async config=>{
        const fields={description:structured?formatted:raw};if(placeholder)fields.summary='Учебный черновик.';
        await config.tools.find(x=>x.name==='update_task').execute({fields,questions:[]},{});
        config.afterStep({hasTools:true,failedTool:false,draftExtracted:true});
    });t.after(()=>chat.destroy());await chat.send(raw);
    assert.equal(c.getState().draft.fields.description,formatted);
    assert.equal(c.getState().draft.fields.summary,'Обновить сервис demo-api в DEV до версии 1.0 из тега v1.0.');
    assert.equal(c.getState().draft.source,raw);
    assert.equal(chat.getState().error,null);assertMissingLink(h,chat);
});
test('opposite model facts never become source-equivalent or authorize local readiness on malformed retry',async t=>{
    const h=await setup(t,true),c=h.controller,source=raw+' Миграции не выполнять.';
    const opposite=raw.replace('Поменять образ и перезапустить сервис.','Поменять образ, выполнить миграцию и перезапустить сервис.');let turns=0,checks=0;
    const check=c.chatValidate;c.chatValidate=(...args)=>{checks++;return check(...args);};
    const chat=h.makeChat(async config=>{if(++turns===1)await config.tools.find(x=>x.name==='update_task').execute({fields:{summary:'Обновить сервис demo-api в DEV',description:opposite},questions:[]},{});throw Error('Invalid Pico text envelope');});t.after(()=>chat.destroy());
    await chat.send(source);const description=c.getState().draft.fields.description;
    assert.equal(c.chatDescriptionMatchesSource(source),false);assert.match(description,/выполнить миграцию/);
    await chat.send(source);
    assert.equal(c.getState().draft.fields.description,description);assert.equal(c.getState().draft.checked,null);assert.equal(checks,0);
    assert.equal(chat.getState().error.code,'response');assert.doesNotMatch(chat.getState().transcript.at(-1).text,/Проверка пройдена/);
});
test('restored screenshot preserves its differing unknown note and cannot claim exact equivalence to source',async t=>{
    const h=await setup(t,true),c=h.controller,saved=h.store.load('DEVOPS');
    saved.draft.source=raw;saved.draft.sourceRevision++;saved.draft.fields={summary:'Учебный черновик.',description:modified};
    assert.equal(h.store.save('DEVOPS',{draft:saved.draft,settings:saved.settings},saved.revision).ok,true);
    await c.init();await c.selectProject('DEVOPS');const d=c.getState().draft;
    assert.equal(d.fields.description,h.validation.formatDevopsDescription(c.getState().meta,'12',modified));assert.match(d.fields.description,/Неизвестно: ссылка/);
    assert.equal(c.chatDescriptionMatchesSource(raw),false);
    const chat=h.makeChat(async()=>{throw Error('Invalid Pico text envelope');});t.after(()=>chat.destroy());await chat.send(raw);
    assert.equal(chat.getState().error.code,'response');assert.equal(c.getState().draft.checked,null);assert.equal(c.getState().draft.fields.description,d.fields.description);
});


test('an unverified structured model description never supplies a section heading as the topic',async t=>{
    const h=await setup(t,true),c=h.controller,source=raw+' Миграции не выполнять.';
    const opposite=h.validation.formatDevopsDescription(c.getState().meta,'12',raw.replace('Поменять образ и перезапустить сервис.','Поменять образ, выполнить миграцию и перезапустить сервис.'));
    const chat=h.makeChat(async config=>{await config.tools.find(x=>x.name==='update_task').execute({fields:{description:opposite},questions:[]},{});config.afterStep({hasTools:true,failedTool:false,draftExtracted:true});});t.after(()=>chat.destroy());
    await chat.send(source);assert.equal(c.chatDescriptionMatchesSource(source),false);
    assert.equal(c.getState().draft.fields.summary,undefined);assert.equal(c.getState().draft.checked,null);
    assert.equal(Object.hasOwn(c.getState().draft,'automaticDescriptionSourceRevision'),false);
});


test('even an exact structured source does not turn its first section heading into a topic',async t=>{
    const h=await setup(t,true),c=h.controller,source=h.validation.formatDevopsDescription(c.getState().meta,'12',raw);
    const chat=h.makeChat(async config=>{await config.tools.find(x=>x.name==='update_task').execute({fields:{description:source},questions:[]},{});config.afterStep({hasTools:true,failedTool:false,draftExtracted:true});});t.after(()=>chat.destroy());
    await chat.send(source);assert.equal(c.getState().draft.fields.summary,undefined);assert.equal(c.getState().draft.checked,null);
});
