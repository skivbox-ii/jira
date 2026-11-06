const test=require('node:test');
const assert=require('node:assert/strict');
const {loadUnit,metadataFixture}=require('./helpers/ticket-assistant-fixture');
const {harness}=require('./helpers/ticket-assistant-chat-fixture');
const fields=loadUnit('fields'),validation=loadUnit('validation',{_ujgTA_fields:fields});
const managed={appManagedQuestions:true};
const sectionValues={goal:'Восстановить доступ команды к API.',work:'Обновить конфигурацию и перезапустить API.',location:'TEST, API.',acceptance:'API возвращает HTTP 200 на /health.',links:'https://git.example/api'};
const description='Цель: Восстановить доступ команды к API.\nЧто сделать: Обновить конфигурацию и перезапустить API.\nГде: TEST, API.\nКритерии приёмки: API возвращает HTTP 200 на /health.\nСсылки: https://git.example/api';

test('section merge changes only supplied section and isolates malformed siblings',()=>{
    const source=description+'\n\nМой раздел: **сохранить** vRC-1\nРодительская история: APP-123';
    const result=validation.mergeDescriptionSections(metadataFixture(),'10',source,{location:'PREPROD, API.',goal:{invalid:true},unknown:'No'},'task');
    assert.deepEqual(Array.from(result.applied),['location']);assert.equal(result.rejected.length,2);
    assert.ok(result.description.includes('Где: PREPROD, API.'));assert.ok(result.description.includes('Что сделать: Обновить конфигурацию и перезапустить API.'));
    assert.ok(result.description.includes('Мой раздел: **сохранить** vRC-1'));assert.ok(result.description.includes('Родительская история: APP-123'));
    assert.equal(validation.mergeDescriptionSections(metadataFixture(),'10',result.description,{location:'PREPROD, API.'},'task').description,result.description);
});

test('data entry applies valid siblings with optional fields and replaces stale model questions',async t=>{
    const h=await harness(),c=h.controller;t.after(()=>c.destroy());
    await c.chatUpdate({fields:{},questions:[{id:'model-old',text:'Придуманный старый вопрос?',required:true}]},c.chatSnapshot());
    let result=await c.chatUpdate({fields:{summary:'Обновить API на TEST',components:[{id:'APP-9'}]},descriptionSections:sectionValues,
        questions:[{id:'model-new',text:'Новый вопрос модели?',required:true}]},c.chatSnapshot(),undefined,managed);
    assert.equal(result.ok,true);assert.ok(result.rejected.some(r=>r.id==='components'));
    let state=c.getState();assert.equal(state.draft.fields.summary,'Обновить API на TEST');assert.equal(state.draft.fields.components,undefined);
    assert.ok(state.draft.fields.description.includes('Где: TEST, API.'));assert.ok(!state.draft.questions.some(q=>q.id.startsWith('model-')));
    assert.equal((await c.chatValidate(c.chatSnapshot())).ok,true);
    result=await c.chatUpdate({descriptionSections:{location:'PREPROD, API.',goal:99}},c.chatSnapshot(),undefined,managed);
    assert.equal(result.ok,true);assert.ok(result.rejected.some(r=>r.id==='goal'));
    assert.ok(c.getState().draft.fields.description.includes('Где: PREPROD, API.'));assert.ok(c.getState().draft.fields.description.includes('Цель: Восстановить доступ'));
});

test('manual and pending values survive scoped updates and require explicit acceptance',async t=>{
    const h=await harness(),c=h.controller;t.after(()=>c.destroy());
    await c.updateField('summary','Моя ручная тема');await c.updateField('description',description);
    await c.chatUpdate({fields:{summary:'Предложенная тема',description:description.replace('TEST, API.','DEV, API.')}},c.chatSnapshot());
    const pending=c.getState().draft.pendingFields;
    const result=await c.chatUpdate({fields:{components:[{id:'DO-9'}]},descriptionSections:{acceptance:'API отвечает HTTP 201.'}},c.chatSnapshot(),undefined,managed);
    assert.equal(result.ok,true);const state=c.getState();
    assert.equal(state.draft.fields.summary,'Моя ручная тема');assert.equal(state.draft.fields.description,description);
    assert.equal(state.draft.pendingFields.summary,pending.summary);
    assert.ok(state.draft.pendingFields.description.includes('Где: DEV, API.'));assert.ok(state.draft.pendingFields.description.includes('HTTP 201'));
    assert.equal((await c.chatValidate(c.chatSnapshot())).ok,false);assert.equal(c.getState().draft.checked,null);
});

test('app-owned requirements refresh on manual edits without API calls and never restore checked',async t=>{
    const h=await harness(),c=h.controller;t.after(()=>c.destroy());
    await c.chatUpdate({fields:{summary:'Обновить API на TEST'},descriptionSections:sectionValues},c.chatSnapshot(),undefined,managed);
    assert.equal((await c.chatValidate(c.chatSnapshot())).ok,true);
    let calls=0;for(const key of Object.keys(h.api))h.api[key]=async()=>{calls++;throw Error('No API per keystroke');};
    await c.updateField('description',description.replace('Критерии приёмки: API возвращает HTTP 200 на /health.','Критерии приёмки:'));
    let state=c.getState();assert.equal(calls,0);assert.equal(state.draft.checked,null);assert.equal(state.validation.ok,false);
    assert.ok(state.draft.questions.some(q=>q.text.includes('наблюдаемым')));
    await c.updateField('description',description);state=c.getState();assert.equal(calls,0);assert.equal(state.validation.ok,true);assert.equal(state.draft.checked,null);
    assert.equal(state.draft.questions.length,0);
});

test('section prototype keys cannot pollute state and active template review remains blocking',async t=>{
    const h=await harness(),c=h.controller;t.after(()=>c.destroy());
    const changes=JSON.parse('{"location":"TEST, API.","__proto__":"pollute"}');
    const result=await c.chatUpdate({fields:{summary:'Настроить API на TEST'},descriptionSections:changes},c.chatSnapshot(),undefined,managed);
    assert.equal(result.ok,true);assert.ok(result.rejected.some(r=>r.id==='__proto__'));assert.equal({}.pollute,undefined);
    const template=c.chatReadTemplate();await c.chatApplyTemplate({instructions:template.template.instructions+' Требуется согласование.'},c.chatSnapshot());
    await c.chatUpdate({descriptionSections:sectionValues},c.chatSnapshot(),undefined,managed);
    const checked=await c.chatValidate(c.chatSnapshot());assert.equal(checked.ok,false);assert.equal(c.getState().draft.templateReviewPending,true);
    assert.ok(c.getState().draft.questions.some(q=>q.id.includes('templateReview')));
});

test('non-DEVOPS template checks never require a reference, assignee or optional due date',async t=>{
    const h=await harness(),c=h.controller;t.after(()=>c.destroy());
    const sections={...sectionValues};delete sections.links;
    await c.chatUpdate({fields:{summary:'Настроить API на TEST'},descriptionSections:sections},c.chatSnapshot(),undefined,managed);
    const result=await c.chatValidate(c.chatSnapshot());assert.equal(result.ok,true,JSON.stringify(result));
    assert.equal(result.questions.length,0);assert.equal(c.getState().draft.fields.duedate,undefined);
});

test('explicit personal-template review retains its actual required questions before readiness',async t=>{
    const h=await harness(),c=h.controller;t.after(()=>c.destroy());
    await c.chatUpdate({fields:{summary:'Настроить API на TEST'},descriptionSections:sectionValues},c.chatSnapshot(),undefined,managed);
    const read=c.chatReadTemplate();await c.chatApplyTemplate({instructions:read.template.instructions+' Требуется согласование DBA.'},c.chatSnapshot());
    await c.chatUpdate({fields:{},questions:[{id:'custom:dba',text:'Подтвердите согласование DBA.',required:true}]},c.chatSnapshot());
    const result=await c.chatCompleteTemplateReview(c.chatSnapshot(),c.getState().draft.settingsRevision);
    assert.equal(result.ok,false);assert.ok(result.questions.some(q=>q.id==='custom:dba'));assert.equal(c.getState().draft.checked,null);
    assert.ok(c.chatReadTemplate().template.instructions.includes('согласование DBA'));
});

test('invalid oversized section does not discard valid sections and deliberate empty section remains missing',()=>{
    const m=metadataFixture(),spec=m.issueTypes[0].fields.find(f=>f.id==='description');spec.maxLength=description.length+40;
    const merged=validation.mergeDescriptionSections(m,'10',description,{goal:'X'.repeat(10000),location:'DEV, API.',acceptance:''},'task');
    assert.ok(merged.rejected.some(r=>r.id==='goal'));assert.deepEqual(Array.from(merged.applied),['location','acceptance']);
    assert.ok(merged.description.includes('Цель: Восстановить доступ'));assert.ok(merged.description.includes('Где: DEV, API.'));
    const result=validation.validateFields(m,'10',{summary:'Настроить API на DEV',description:merged.description},{appManagedQuestions:true,templateId:'task'});
    assert.ok(result.questions.some(q=>q.id==='template:acceptance'));
});

test('scoped proposal preserves unprotected pending assistance and undo restores the previous mode',async t=>{
    const h=await harness(),c=h.controller;t.after(()=>c.destroy());
    await c.chatUpdate({fields:{summary:'Тема до режима',description:description}},c.chatSnapshot());
    const saved=h.store.load('DO');saved.draft.pendingFields.summary='Существующее предложение';saved.draft.pendingAssistance={fieldId:'summary',action:'generate'};
    assert.equal(h.store.save('DO',saved,saved.revision).ok,true);
    await c.init();await c.selectProject('DO');
    await c.chatUpdate({descriptionSections:{location:'DEV, API.'}},c.chatSnapshot(),'Уточнение среды',managed);
    assert.equal(c.getState().draft.pendingFields.summary,'Существующее предложение');
    assert.equal((await c.chatValidate(c.chatSnapshot())).ok,false);
    assert.equal((await c.chatUndo()).ok,true);assert.equal(c.getState().draft.appManagedQuestions,false);
    assert.equal(c.getState().draft.fields.description,description);
});

async function dbaReview(h) {
    const c=h.controller;
    await c.chatUpdate({fields:{summary:'Настроить API на TEST'},descriptionSections:sectionValues},c.chatSnapshot(),undefined,managed);
    const read=c.chatReadTemplate();await c.chatApplyTemplate({instructions:read.template.instructions+' Требуется согласование DBA.'},c.chatSnapshot());
    await c.chatUpdate({fields:{},questions:[{id:'custom:dba',text:'Подтвердите согласование DBA.',required:true}]},c.chatSnapshot());
    const result=await c.chatCompleteTemplateReview(c.chatSnapshot(),c.getState().draft.settingsRevision);
    assert.equal(result.ok,false);assert.equal(c.getState().draft.templateReviewPending,false);
}

test('reviewed custom requirement survives repeated validation data updates manual edits and reload until explicit re-review',async t=>{
    const h=await harness(),c=h.controller;t.after(()=>c.destroy());await dbaReview(h);
    async function blocked() {
        const result=await c.chatValidate(c.chatSnapshot());
        assert.equal(result.ok,false);assert.ok(result.questions.some(q=>q.id==='custom:dba' && q.required));assert.equal(c.getState().draft.checked,null);
    }
    await blocked();await blocked();
    await c.chatUpdate({descriptionSections:{location:'PREPROD, API.'},questions:[]},c.chatSnapshot(),undefined,managed);await blocked();
    await c.updateField('summary','Ручная тема для API на PREPROD');
    assert.ok(c.getState().draft.questions.some(q=>q.id==='custom:dba'));await blocked();
    await c.init();await c.selectProject('DO');
    assert.ok(c.getState().draft.questions.some(q=>q.id==='custom:dba'));await blocked();
    await c.chatUpdate({fields:{},questions:[]},c.chatSnapshot());
    const reviewed=await c.chatCompleteTemplateReview(c.chatSnapshot(),c.getState().draft.settingsRevision);
    assert.equal(reviewed.ok,true,JSON.stringify(reviewed));assert.ok(!reviewed.questions.some(q=>q.id==='custom:dba'));assert.ok(c.getState().draft.checked);
    assert.equal((await c.chatValidate(c.chatSnapshot())).ok,true);
});

test('legacy reviewed custom questions survive a first manual edit after restore and stale re-review cannot clear them',async t=>{
    const h=await harness(),c=h.controller;t.after(()=>c.destroy());await dbaReview(h);
    const saved=h.store.load('DO');delete saved.draft.reviewedTemplateQuestions;
    assert.equal(h.store.save('DO',saved,saved.revision).ok,true);
    await c.init();await c.selectProject('DO');await c.updateField('summary','Новая ручная тема');
    assert.ok(c.getState().draft.questions.some(q=>q.id==='custom:dba'));
    await c.chatUpdate({fields:{},questions:[]},c.chatSnapshot());
    await c.updateField('summary','Правка после ответа проверки');
    let result=await c.chatCompleteTemplateReview(c.chatSnapshot(),c.getState().draft.settingsRevision);
    assert.equal(result.ok,false);assert.ok(result.questions.some(q=>q.id==='custom:dba'));assert.equal(c.getState().draft.checked,null);
    await c.chatBeginReview(c.chatSnapshot());await c.chatUpdate({fields:{},questions:[]},c.chatSnapshot());
    result=await c.chatCompleteTemplateReview(c.chatSnapshot(),c.getState().draft.settingsRevision);
    assert.equal(result.ok,true);assert.ok(c.getState().draft.checked);
});

test('ordinary checked marking and undo cannot erase an explicitly reviewed custom blocker',async t=>{
    const h=await harness(),c=h.controller;t.after(()=>c.destroy());await dbaReview(h);
    const d=c.getState().draft;
    const forged=h.drafts.markChecked(d,{ok:true,fieldErrors:{},warnings:[],unsupportedRequired:[]},[],h.drafts.snapshot(d));
    assert.equal(forged.checked,null);
    await c.chatUpdate({descriptionSections:{location:'PREPROD, API.'}},c.chatSnapshot(),undefined,managed);
    await c.chatUndo();assert.ok(c.getState().draft.questions.some(q=>q.id==='custom:dba'));
    assert.equal((await c.chatValidate(c.chatSnapshot())).ok,false);
});

async function personalTextDraft(h) {
    const c=h.controller,settings=c.getState().settings,p=settings.profiles.find(p=>p.id===settings.activeProfileId);
    p.templates.push({id:'personal-text',name:'Личный текст',whenToUse:'Личный процесс',instructions:'Обязательно согласование DBA. Пользователь должен назвать согласовавшего.',issueTypeId:null});
    await c.applySettings(settings);await c.selectTemplate('personal-text');
    await c.chatUpdate({fields:{summary:'Восстановить доступ к API',description:'Нужно восстановить доступ к API на TEST.'}},c.chatSnapshot(),'Нужно восстановить доступ к API на TEST.');
    assert.equal(c.chatDescriptionSections().length,0);assert.equal(c.getState().draft.checked,null);
}

for(const failure of ['malformed','HTTP 429'])test('first-turn '+failure+' fallback cannot certify unreviewed personal text template',async t=>{
    const h=await harness(),c=h.controller;t.after(()=>c.destroy());await personalTextDraft(h);
    assert.equal(c.chatBeginReview(c.chatSnapshot()).ok,true); // beginLocalReview uses this guard before fallback applies facts.
    const result=await c.chatValidate(c.chatSnapshot(),{signal:new AbortController().signal});
    assert.equal(result.ok,false);assert.equal(c.getState().draft.templateReviewPending,true);assert.equal(c.getState().draft.checked,null);
    assert.ok(result.validation.fieldErrors._templateReview);
    assert.equal((await c.chatValidate(c.chatSnapshot())).ok,false);
});

test('completed explicit personal-template review remains valid until actual fallback review begins after an edit',async t=>{
    const h=await harness(),c=h.controller;t.after(()=>c.destroy());await personalTextDraft(h);
    await c.chatBeginReview(c.chatSnapshot());await c.chatUpdate({fields:{},questions:[]},c.chatSnapshot());
    assert.equal((await c.chatCompleteTemplateReview(c.chatSnapshot(),c.getState().draft.settingsRevision)).ok,true);
    assert.equal((await c.chatValidate(c.chatSnapshot())).ok,true);
    await c.init();await c.selectProject('DO');
    assert.equal((await c.chatValidate(c.chatSnapshot())).ok,true);
    await c.updateField('description','Теперь требуется доступ к API на PREPROD.');
    assert.equal(c.chatBeginReview(c.chatSnapshot()).ok,true);
    assert.equal((await c.chatValidate(c.chatSnapshot())).ok,false);
    assert.equal(c.getState().draft.checked,null);
});
