const test=require('node:test');
const assert=require('node:assert/strict');
const {harness}=require('./helpers/ticket-assistant-chat-fixture');
const {loadUnit}=require('./helpers/ticket-assistant-fixture');
const plain=x=>JSON.parse(JSON.stringify(x));
async function setup(t,options={}) {
    const h=await harness(),c=h.controller,base=h.api.getCreateMeta;
    h.api.getCreateMeta=async key=>{const raw=await base(key);for(const type of raw.projects[0].issuetypes){
        type.fields.timetracking={name:'Трудозатраты',schema:{type:'timetracking',system:'timetracking'}};
        type.fields.priority={name:'Приоритет',schema:{type:'priority',system:'priority'},allowedValues:[{id:'2',name:'High'}]};
    }return raw;};
    await c.selectProject('DO');await c.selectIssueType('10');await c.selectTemplate('task');t.after(()=>c.destroy());
    const Tools=loadUnit('chat-tools',{_ujgTA_fields:h.fields});
    const tools=Tools.create({controller:c,getSnapshot:()=>c.chatSnapshot(),getEstimates:()=>({}),explicitReview:true,reviewUserText:'Проверить API; метка confirmed',...options});
    return {...h,c,update:args=>tools.find(t=>t.name==='update_task').execute(args,{})};
}
test('explicit review saves valid live-shaped fields atomically and persists disclosures through validation/reload',async t=>{
    const h=await setup(t);await h.c.chatUpdate({fields:{labels:['existing'],components:[{id:'DO-9'}]}},h.c.chatSnapshot());
    const result=await h.update({fields:{summary:'Проверить API',description:'Проверить доступ к API.',timetracking:{enabled:true},priority:'2',components:[{id:'DO-9'}],labels:['confirmed','invented']},questions:[]});
    assert.equal(result.ok,true);const d=h.c.getState().draft;
    assert.equal(d.fields.description,'Проверить доступ к API.');assert.equal(d.fields.timetracking,undefined);assert.equal(d.fields.priority,undefined);
    assert.deepEqual(plain(d.fields.labels),['existing','confirmed']);assert.deepEqual(plain(d.fields.components),[{id:'DO-9'}]);
    for(const id of ['timetracking','priority','labels'])assert.match(d.warnings.join(' '),new RegExp(id));
    assert.ok(result.warnings.length);await h.c.chatValidate(h.c.chatSnapshot());
    for(const id of ['timetracking','priority','labels'])assert.match(h.store.load('DO').draft.warnings.join(' '),new RegExp(id));
});
for(const fields of [{description:{text:'bad'},labels:['confirmed']},{summary:42,description:'Valid'},{description:'   ',labels:['confirmed']},{summary:'',description:'Valid'}])
test('bad core has zero partial effects: '+JSON.stringify(fields),async t=>{
    const h=await setup(t),before=JSON.stringify(h.c.getState().draft);
    await assert.rejects(h.update({fields,questions:[]}));assert.equal(JSON.stringify(h.c.getState().draft),before);
});
test('normal update remains strict and atomic for malformed optional fields',async t=>{
    const h=await setup(t,{explicitReview:false}),before=JSON.stringify(h.c.getState().draft);
    await assert.rejects(h.update({fields:{description:'Useful',priority:'2'},questions:[]}));assert.equal(JSON.stringify(h.c.getState().draft),before);
});
test('invalid optional additions retain existing values and ungrounded effort cannot block description',async t=>{
    const h=await setup(t);await h.c.chatUpdate({fields:{components:[{id:'DO-9'}],timetracking:{originalEstimate:'1h'},labels:['old']}},h.c.chatSnapshot());
    await h.update({fields:{description:'New facts',components:[{id:'APP-9'}],timetracking:{originalEstimate:'2h'},labels:'guessed'},questions:[]});
    const d=h.c.getState().draft;assert.equal(d.fields.description,'New facts');assert.deepEqual(plain(d.fields.components),[{id:'DO-9'}]);
    assert.deepEqual(plain(d.fields.timetracking),{originalEstimate:'1h'});assert.deepEqual(plain(d.fields.labels),['old']);
    for(const id of ['components','timetracking','labels'])assert.match(d.warnings.join(' '),new RegExp(id));
});
test('grounded effort is accepted and shared filtering helper is read-only and snapshot guarded',async t=>{
    const h=await setup(t,{getEstimates:()=>({originalEstimate:'2h'})});const before=JSON.stringify(h.c.getState().draft),snap=h.c.chatSnapshot();
    assert.equal(h.c.chatFilterReviewFields({description:'Facts',priority:'2'},snap).ok,true);assert.equal(JSON.stringify(h.c.getState().draft),before);
    await h.update({fields:{description:'Facts',timetracking:{originalEstimate:'2h'}},questions:[]});
    assert.deepEqual(plain(h.c.getState().draft.fields.timetracking),{originalEstimate:'2h'});
    assert.equal(h.c.chatFilterReviewFields({description:'Stale'},snap).ok,false);
});
test('null and unsupported extra fields never erase existing fields during explicit review',async t=>{
    const h=await setup(t);await h.c.chatUpdate({fields:{timetracking:{originalEstimate:'1h'},components:[{id:'DO-9'}],labels:['old']}},h.c.chatSnapshot());
    await h.update({fields:{description:'Facts',timetracking:null,components:null,labels:null,foreign:'invented'},questions:[]});
    const d=h.c.getState().draft;assert.deepEqual(plain(d.fields.timetracking),{originalEstimate:'1h'});assert.deepEqual(plain(d.fields.components),[{id:'DO-9'}]);assert.deepEqual(plain(d.fields.labels),['old']);
    for(const id of ['timetracking','components','labels','foreign'])assert.match(d.warnings.join(' '),new RegExp(id));
});
test('normal literal description overrides model rewrite exactly without duplicated notes',async t=>{
    const literal='  Версия не нужна.\nПричина: восстанавливаем доступ.  ';
    const h=await setup(t,{explicitReview:false,getVerbatimDescription:()=>literal,getTurnText:()=>literal});
    await h.update({fields:{description:'Переписано моделью'},taskException:'Версия не нужна',questions:[]});
    assert.equal(h.c.getState().draft.fields.description,literal);assert.equal(h.store.load('DO').draft.fields.description,literal);
    assert.doesNotMatch(h.c.getState().draft.fields.description,/Со слов пользователя/);
});
test('other normal turns retain both refusal reason and taskException note',async t=>{
    const h=await setup(t,{explicitReview:false,getTurnText:()=> 'Версия не нужна. Причина: восстанавливаем доступ.'});
    await h.update({fields:{description:'Проверить вход.'},taskException:'Однократное исключение: без версии',questions:[]});
    const d=h.store.load('DO').draft;assert.match(d.fields.description,/Причина: восстанавливаем доступ/);assert.match(d.fields.description,/Однократное исключение: без версии/);
    assert.ok(d.taskExceptions.includes('Однократное исключение: без версии'));
});
test('actual flat reconciliation filters invalid additions while saving core and disclosing omissions',async t=>{
    const h=await setup(t),runtime=await import('../ujg-ticket-assistant-chat/runtime.mjs');
    const Tools=loadUnit('chat-tools',{_ujgTA_fields:h.fields}),Chat=loadUnit('chat',{_ujgTA_chatTools:Tools,_ujgTA_draft:h.drafts},{AbortController});let calls=0;
    const chat=Chat.create({controller:h.c,store:h.store,runtime,requestText:async()=>{calls++;return {text:JSON.stringify({fields:{summary:'Проверить API',description:'Проверить доступ к API.',timetracking:{enabled:true},priority:'2',components:[{id:'DO-9'}],labels:['invented']},missing:[]})};}});t.after(()=>chat.destroy());
    await chat.reconcile();assert.equal(calls,1);assert.equal(chat.getState().error,null);
    const d=h.store.load('DO').draft;assert.equal(d.fields.description,'Проверить доступ к API.');assert.equal(d.fields.timetracking,undefined);
    assert.equal(d.fields.priority,undefined);assert.deepEqual(plain(d.fields.components),[{id:'DO-9'}]);assert.equal(d.fields.labels,undefined);
    for(const id of ['timetracking','priority','labels'])assert.match(d.warnings.join(' '),new RegExp(id));
});
