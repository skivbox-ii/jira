const test=require('node:test');
const assert=require('node:assert/strict');
const {loadUnit,metadataFixture}=require('./helpers/ticket-assistant-fixture');
const {harness}=require('./helpers/ticket-assistant-chat-fixture');
const fields=loadUnit('fields'),validation=loadUnit('validation',{_ujgTA_fields:fields});
const live='Учебный черновик. Обновить виджет Jira в DEV до версии из коммита 5961fa4 в рабочее время. Заменить скрипт и перезагрузить страницу. Постановщик проверит открытие карточки DEVOPS. Исходная оценка: 30 минут. Приоритет: Средний.';
function meta() {
    const m=metadataFixture('DEVOPS');
    for(const type of m.issueTypes)type.fields.push({id:'priority',name:'Приоритет',kind:'option',supported:true,writable:true,optionsComplete:true,allowedValues:[{id:'medium',label:'Средний'}],defaultApplicable:true,defaultValue:{id:'medium'}});
    return m;
}
function missing(description) {return Array.from(validation.validateFields(meta(),'12',{summary:'Обновить виджет Jira в DEV',description}).questions,q=>q.id);}
test('unlabeled deployment prose remains incomplete until the model maps it',()=>{
    for(const text of [live,'Развернуть портал в TEST из коммита a0b1c2d. Заменить пакет приложения и перезапустить сервис. В рабочее время. Заказчик проверит загрузку страницы отчёта.']) {
        assert.deepEqual(missing(text).sort(),['devops:location','devops:release','devops:order','devops:window','devops:verification','devops:links'].sort());
        assert.equal(validation.formatDevopsDescription(meta(),'12',text),text);
    }
});
for(const action of ['Возможно, развернуть виджет в DEV из коммита 5961fa4.','Не разворачивать виджет в DEV из коммита a0b1c2d.','Если обновить виджет в DEV из коммита 123abcd.','Обновить виджет в DEV. Текущая сборка из коммита 5961fa4.','Обновить виджет в DEV, исходная сборка из коммита a0b1c2d.','Виджет собран из коммита 123abcd. Обновить его в DEV.','Обновить виджет в DEV с коммита 5961fa4.','Завершённое развёртывание в DEV выполнено из коммита 5961fa4.','Нужно ли развернуть портал в TEST из коммита a0b1c2d?'])
test('a source-only, conditional, uncertain or prohibited commit is not a deployment target: '+action,()=>{
    const text=action+' В рабочее время. Заменить скрипт и перезагрузить страницу. Постановщик проверит открытие карточки DEVOPS.';
    assert.ok(missing(text).includes('devops:release'));
});
for(const ref of ['abcdef','not-a-sha','5961fa4g','5961fa4 или a0b1c2d'])test('invalid or alternative commit does not supply a release: '+ref,()=>{
    assert.ok(missing(live.replace('5961fa4',ref)).includes('devops:release'));
});
for(const clause of ['Постановщик проверит открытие карточки DEVOPS?','Постановщик проверит открытие карточки DEVOPS, если будет доступ.','Постановщик не проверит открытие карточки DEVOPS.','Постановщик проверит результат.'])test('unconfirmed or unobservable UI verification remains missing: '+clause,()=>{
    assert.ok(missing(live.replace('Постановщик проверит открытие карточки DEVOPS.',clause)).includes('devops:verification'));
});
test('questioned or negated operational steps remain missing',()=>{
    for(const clause of ['Заменить скрипт и перезагрузить страницу?','Не заменять скрипт и не перезагружать страницу.'])
        assert.ok(missing(live.replace('Заменить скрипт и перезагрузить страницу.',clause)).includes('devops:order'));
});
test('invalid model response keeps original text in chat without filling the card',async t=>{
    const h=await harness(),c=h.controller,read=h.api.getCreateMeta;
    h.api.getProjects=async()=>({values:[{key:'DEVOPS',id:'DEVOPS-project',name:'DEVOPS'}]});
    h.api.getCreateMeta=async key=>{const m=await read(key);for(const type of m.projects[0].issuetypes)type.fields.priority={name:'Приоритет',schema:{type:'priority',system:'priority'},hasDefaultValue:true,defaultValue:{id:'medium'},allowedValues:[{id:'medium',name:'Средний'}]};return m;};
    let posts=0;h.api.createIssue=async()=>{posts++;throw Error('No Jira writes');};
    await c.init();await c.selectProject('DEVOPS');await c.selectIssueType('12');
    const runtime=await import('../ujg-ticket-assistant-chat/runtime.mjs');
    const Chat=loadUnit('chat',{_ujgTA_chatTools:loadUnit('chat-tools',{_ujgTA_fields:h.fields}),_ujgTA_draft:h.drafts},{AbortController});
    const chat=Chat.create({controller:c,store:h.store,runtime,requestText:async()=>({text:'```json\n{}\n```'})});t.after(()=>{chat.destroy();c.destroy();});
    await chat.send(live);const d=c.getState().draft;
    assert.ok(chat.getState().error);
    assert.equal(d.fields.description,undefined);assert.equal(d.fields.summary,undefined);
    assert.equal(chat.getState().transcript.some(e=>e.role==='user' && e.text===live),true);
    assert.equal(d.checked,null);assert.equal(posts,0);
});
