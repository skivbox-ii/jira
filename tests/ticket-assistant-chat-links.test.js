const test=require('node:test');
const assert=require('node:assert/strict');
const {harness}=require('./helpers/ticket-assistant-chat-fixture');
const {loadUnit}=require('./helpers/ticket-assistant-fixture');
const task='Учебный черновик. Обновить сервис demo-api в DEV до версии 1.0 из тега v1.0 в рабочее время. Поменять образ и перезапустить сервис. Постановщик проверит HTTP 200 на /health. Приоритет: Средний. Ссылки на репозиторий для примера нет.';
const good='https://git.example/team/demo-api/tree/v1.0';
const dashboard='https://jira.example/secure/Dashboard.jspa?selectPageId=123';
async function setup(t,{estimate=false}={}) {
    const h=await harness(),c=h.controller,read=h.api.getCreateMeta;let models=0,posts=0;
    h.api.getProjects=async()=>({values:[{key:'DEVOPS',id:'DO-project',name:'DEVOPS'},{key:'APP',id:'APP-project',name:'APP'}]});
    h.api.getCreateMeta=async key=>{const raw=await read(key);raw.projects[0].issuetypes.forEach(type=>{
        type.fields.priority={name:'Приоритет',schema:{type:'priority',system:'priority'},hasDefaultValue:true,defaultValue:{id:'medium'},allowedValues:[{id:'medium',name:'Средний'}]};
        if(estimate)type.fields.timetracking={name:'Исходная оценка',required:true,schema:{type:'timetracking',system:'timetracking'}};
    });return raw;};
    h.api.checkDevopsIssue=async()=>({fieldErrors:{},warnings:[],link:null});h.api.createIssue=async()=>{posts++;throw Error('Must never create');};
    await c.init();await c.selectProject('DEVOPS');await c.selectIssueType('12');
    await c.chatUpdate({fields:{summary:'Обновить сервис demo-api в DEV',description:task},questions:[]},c.chatSnapshot(),task);
    await c.chatValidate(c.chatSnapshot());assert.ok(c.getState().validation.questions.some(q=>q.id==='devops:links'));
    const Chat=loadUnit('chat',{_ujgTA_chatTools:loadUnit('chat-tools',{_ujgTA_fields:h.fields}),_ujgTA_draft:h.drafts},{AbortController});
    const makeChat=()=>Chat.create({controller:c,store:h.store,runtime:{createSession(){return {prompt:async()=>{models++;throw Error('Invalid Pico text envelope');},getMessages:()=>[],abort(){},dispose(){}};}}});
    const chat=makeChat();t.after(()=>{chat.destroy();c.destroy();});return {...h,chat,makeChat,models:()=>models,posts:()=>posts};
}
test('actual DEVOPS conversation rejects dashboard clearly, then fills a correct link without model or automatic creation',async t=>{
    const h=await setup(t),c=h.controller,before=c.getState().draft;
    await h.chat.send(dashboard);assert.equal(h.models(),0);assert.equal(h.chat.getState().error,null);
    assert.match(h.chat.getState().transcript.at(-1).text,/дашборд Jira/);assert.match(h.chat.getState().transcript.at(-1).text,/репозитор|документац/);
    assert.equal(c.getState().draft.fields.description,before.fields.description);assert.equal(c.getState().draft.source,before.source);
    await h.chat.send(good);const d=c.getState().draft;
    assert.equal(h.models(),0);assert.equal(h.posts(),0);assert.match(d.fields.description,/Ссылки: https:\/\/git.example/);
    assert.equal(d.fields.summary,before.fields.summary);assert.ok(d.checked);assert.equal(h.chat.getState().error,null);
    assert.equal(d.source,before.source+'\n\n'+good);assert.match(h.chat.getState().transcript.at(-1).text,/Ссылка сохранена/);
    await h.chat.send(good);assert.equal(c.getState().draft.source,d.source);assert.equal(h.chat.getState().transcript.filter(m=>m.role==='user' && m.text===good).length,1);assert.equal(h.models(),0);
});
for(const text of [dashboard,good])test('persisted screenshot user answer is handled once on retry without duplicated transcript/source: '+text,async t=>{
    const h=await setup(t),c=h.controller;h.chat.destroy();
    const d=c.getState().draft,loaded=h.store.loadConversation('DEVOPS',d.id);
    const notices=['Получен ответ неверного формата. Поля Jira проверены локально.','Уведомление хранилища.'];
    h.store.saveConversation('DEVOPS',d.id,{transcript:[{id:'q',role:'assistant',text:c.getState().validation.questions.find(q=>q.id==='devops:links').text},{id:'answer',role:'user',text}],messages:[],pendingTemplateProposal:null,notices},loaded?.revision || 0);
    await c.init();await c.selectProject('DEVOPS');const chat=h.makeChat();t.after(()=>chat.destroy());await chat.send(text);
    assert.equal(h.models(),0);assert.equal(chat.getState().error,null);assert.equal(chat.getState().transcript.filter(m=>m.role==='user').length,1);
    assert.ok(chat.getState().notices.includes('Уведомление хранилища.'));assert.doesNotMatch(chat.getState().notices.join(' '),/неверного формата/);
    const source=c.getState().draft.source;await chat.send(text);assert.equal(c.getState().draft.source,source);assert.equal(chat.getState().transcript.filter(m=>m.role==='user').length,1);
});
test('local link patch preserves other fields and revalidates remaining required Jira blockers',async t=>{
    const h=await setup(t,{estimate:true}),c=h.controller;await c.updateField('environment','Ручная среда');
    const before=c.getState().draft;await h.chat.send('Ссылка на репозиторий: '+good);
    const d=c.getState().draft;assert.equal(h.models(),0);assert.equal(d.fields.environment,before.fields.environment);assert.equal(d.protectedFields.environment,true);
    assert.equal(d.fields.timetracking,undefined);assert.equal(d.checked,null);assert.ok(c.getState().validation.fieldErrors.timetracking);
    assert.match(h.chat.getState().transcript.at(-1).text,/оценк/i);assert.equal(h.posts(),0);
});
for(const pending of [false,true])test('manual description remains protected and pending content is not overwritten: '+pending,async t=>{
    const h=await setup(t),c=h.controller;await c.updateField('description',c.getState().draft.fields.description);
    if(pending)await c.chatUpdate({fields:{description:c.getState().draft.fields.description+'\nДополнительно: моё предложение'}},c.chatSnapshot());
    await c.chatValidate(c.chatSnapshot());const before=c.getState().draft;await h.chat.send(good);const d=c.getState().draft;
    assert.equal(h.models(),0);assert.equal(d.fields.description,before.fields.description);assert.equal(d.protectedFields.description,true);assert.equal(d.checked,null);
    if(pending)assert.equal(d.pendingFields.description,before.pendingFields.description);else assert.match(d.pendingFields.description,/git.example/);
    assert.match(h.chat.getState().transcript.at(-1).text,/предложен|подтверд|отклон/i);assert.equal(h.posts(),0);
});
for(const text of [good+' И ещё сменить версию на 2.0.','Ссылка: '+good+'\nМиграции не выполнять.'])test('mixed link reply keeps all extra instructions for ordinary model handling: '+text,async t=>{
    const h=await setup(t),before=h.controller.getState().draft;await h.chat.send(text);
    assert.equal(h.models(),1);assert.equal(h.chat.getState().transcript.at(-1).text,text);
    assert.equal(h.controller.getState().draft.fields.description,before.fields.description);assert.equal(h.controller.getState().draft.source,before.source);
});
