const test=require('node:test');
const assert=require('node:assert/strict');
const {loadUnit,memoryStorage}=require('./helpers/ticket-assistant-fixture');
const plain=value=>JSON.parse(JSON.stringify(value));
function setup({required=true,schema={type:'timetracking',system:'timetracking'},operations=['set']}={}) {
    const fields=loadUnit('fields'),validation=loadUnit('validation',{_ujgTA_fields:fields}),drafts=loadUnit('draft'),profiles=loadUnit('profiles');
    const raw={projects:[{key:'DO',id:'100',issuetypes:[{id:'10',name:'Task',fields:{summary:{name:'Тема',required:true,schema:{type:'string',system:'summary'}},description:{name:'Описание',schema:{type:'string',system:'description'}},
        timetracking:{name:'Оценка трудозатрат',required,schema,operations}}}]}]};
    const meta=fields.normalizeMeta(raw,'DO',{});
    const storage=loadUnit('storage',{_ujgTA_draft:drafts,_ujgTA_profiles:profiles});
    return {fields,validation,drafts,profiles,raw,meta,storage};
}
test('Jira timetracking schema is supported only for the system field and writable metadata',()=>{
    const h=setup(),spec=h.fields.getField(h.meta,'10','timetracking');
    assert.equal(spec.kind,'timetracking');assert.equal(spec.supported,true);assert.equal(spec.writable,true);
    for(const schema of [{type:'string',system:'timetracking'},{type:'object',system:'timetracking'},{type:'timetracking',system:'summary'},{type:'timetracking',custom:'foreign'}]) {
        const bad=setup({schema});assert.equal(bad.fields.getField(bad.meta,'10','timetracking').supported,false);
    }
    const readonly=setup({operations:['add']});assert.equal(readonly.fields.getField(readonly.meta,'10','timetracking').writable,false);
});
for(const [value,want] of [
    [{originalEstimate:'2h',remainingEstimate:'30m'},{originalEstimate:'2h',remainingEstimate:'30m'}],
    [{originalEstimate:' 1w 2d 3h 4m '},{originalEstimate:'1w 2d 3h 4m'}],
    [{remainingEstimate:'0m'},{remainingEstimate:'0m'}],
    [{originalEstimate:'1h30m'},{originalEstimate:'1h 30m'}]
]) test('validated duration payload contains only explicitly supplied estimate members: '+JSON.stringify(value),()=>{
    const h=setup();assert.equal(h.validation.validateFields(h.meta,'10',{summary:'Task',timetracking:value},{}).ok,true);
    const result=h.validation.buildCreatePayload(h.meta,'10',{summary:'Task',timetracking:value},{});
    assert.deepEqual(plain(result.fields.timetracking),want);
});
for(const value of [null,{},'2h',2,[],{originalEstimate:2},{originalEstimate:''},{originalEstimate:'2'},
    {originalEstimate:'22:00–23:00'},{originalEstimate:'2026-11-05'},{originalEstimate:'окно выкладки 2h'},
    {originalEstimate:'-1h'},{originalEstimate:'1.5h'},{originalEstimate:'1m 2h'},{originalEstimate:'1h 2h'},
    {originalEstimate:'1h',timeSpent:'1h'},{originalEstimate:'1h',originalEstimateSeconds:3600},
    JSON.parse('{"originalEstimate":"1h","__proto__":{}}')]) test('required estimate rejects malformed, ambiguous and deployment-window values: '+JSON.stringify(value),()=>{
    const h=setup(),values={summary:'Task',timetracking:value};
    assert.equal(h.validation.validateFields(h.meta,'10',values,{}).ok,false);
    assert.throws(()=>h.validation.buildCreatePayload(h.meta,'10',values,{}),e=>e.kind==='validation');
});
test('deployment window prose does not create an estimate; required estimates remain actionable manual fields',()=>{
    const h=setup(),result=h.validation.validateFields(h.meta,'10',{summary:'Deploy',description:'Окно выкладки 22:00–23:00, длительность окна 1h.'},{});
    assert.equal(result.ok,false);assert.ok(result.fieldErrors.timetracking);assert.deepEqual(plain(result.unsupportedRequired),[]);
    const optional=setup({required:false});const payload=optional.validation.buildCreatePayload(optional.meta,'10',{summary:'Deploy',description:'Окно 1h'},{});
    assert.equal(Object.hasOwn(payload.fields,'timetracking'),false);
});
test('estimate objects survive automatic patches, protected manual proposals, storage reload and acceptance',()=>{
    const h=setup(),backend=memoryStorage(),store=h.storage.createStore({storage:backend,userKey:'alice',origin:'https://jira.test'});
    let d=h.drafts.createDraft({projectKey:'DO'});
    d=h.drafts.applyProposal(d,{fields:{timetracking:{originalEstimate:'2h',remainingEstimate:'30m'}},questions:[]},h.drafts.snapshot(d));
    assert.deepEqual(plain(d.fields.timetracking),{originalEstimate:'2h',remainingEstimate:'30m'});
    d=h.drafts.editField(d,'timetracking',{originalEstimate:'3h'});
    d=h.drafts.applyProposal(d,{fields:{timetracking:{originalEstimate:'4h',remainingEstimate:'1h'}},questions:[]},h.drafts.snapshot(d));
    assert.deepEqual(plain(d.fields.timetracking),{originalEstimate:'3h'});
    const settings=h.profiles.createDefaults();assert.equal(store.save('DO',{draft:d,settings},0).ok,true);
    const restored=h.storage.createStore({storage:backend,userKey:'alice',origin:'https://jira.test'}).load('DO').draft;
    assert.deepEqual(plain(restored.pendingFields.timetracking),{originalEstimate:'4h',remainingEstimate:'1h'});
    assert.equal(restored.protectedFields.timetracking,true);
    assert.deepEqual(plain(h.drafts.acceptField(restored,'timetracking').fields.timetracking),{originalEstimate:'4h',remainingEstimate:'1h'});
    assert.throws(()=>h.drafts.editField(restored,'timetracking',{originalEstimate:'2h',name:'bad'}));
});
test('normal chat tools persist explicit estimates and existing guarded creator sends Jira timetracking payload',async()=>{
    const {harness}=require('./helpers/ticket-assistant-chat-fixture'),h=await harness(),posts=[];
    const originalMeta=h.api.getCreateMeta;
    h.api.getCreateMeta=async key=>{
        const raw=await originalMeta(key);
        for(const type of raw.projects[0].issuetypes)type.fields.timetracking={name:'Оценка трудозатрат',required:true,schema:{type:'timetracking',system:'timetracking'},operations:['set']};
        return raw;
    };
    h.api.createIssue=async payload=>{posts.push(plain(payload));return {key:'DO-123',id:'123'};};
    await h.controller.selectProject('DO');await h.controller.selectIssueType('10');await h.controller.selectTemplate('task');
    const Tools=loadUnit('chat-tools',{_ujgTA_fields:h.fields});
    const source='Исходная оценка трудозатрат: 2h; Оставшаяся оценка: 30m';
    const tools=Tools.create({controller:h.controller,isCurrent:()=>true,getSnapshot:()=>h.controller.chatSnapshot(),mutate:fn=>fn(),getSourceText:()=>source,
        getEstimates:()=>Tools.statedEstimates([{role:'user',text:source}])});
    const update=await tools.find(t=>t.name==='update_task').execute({fields:{summary:'Investigate startup',description:'Ошибка запуска, исходная оценка 2h, осталось 30m.',timetracking:{originalEstimate:'2h',remainingEstimate:'30m'}},questions:[]},{});
    assert.equal(update.ok,true);
    assert.deepEqual(plain(h.controller.getState().draft.fields.timetracking),{originalEstimate:'2h',remainingEstimate:'30m'});
    assert.deepEqual(plain(h.store.load('DO').draft.fields.timetracking),{originalEstimate:'2h',remainingEstimate:'30m'});
    await tools.find(t=>t.name==='validate_task').execute({},{});assert.ok(h.controller.getState().draft.checked);
    await h.controller.submit();assert.equal(posts.length,1);
    assert.deepEqual(posts[0].fields.timetracking,{originalEstimate:'2h',remainingEstimate:'30m'});
    h.controller.destroy();
});
test('legacy AI prepare/check preserves manual timetracking but cannot generate or infer estimates',()=>{
    const path=require('node:path'),shared=require('./helpers/load-amd-module')(path.resolve(__dirname,'../ujg-shared-modules/llm-client.js'),{}),h=setup();
    const ai=loadUnit('ai',{_ujgShared_llmClient:shared,_ujgTA_validation:h.validation});
    const input={source:'Окно выкладки 22:00–23:00.',meta:h.meta,profile:{id:'p',instructions:'Facts only',allowAssignee:false,templates:[{id:'task',name:'Task',instructions:'Ask',whenToUse:'',issueTypeId:null}]},
        issueTypeId:'10',templateId:'task',allowFieldIds:['summary','description','timetracking'],draft:{fields:{summary:'Deploy',timetracking:{originalEstimate:'2h',remainingEstimate:'30m'}}}};
    const request=JSON.parse(ai.buildRequest('prepare',input).userPrompt);
    assert.deepEqual(request.fields.timetracking,{originalEstimate:'2h',remainingEstimate:'30m'});
    assert.equal(request.issueTypes[0].fieldSchema.some(f=>f.id==='timetracking'),false);
    const checked=ai.parseResponse('check',JSON.stringify({schemaVersion:1,kind:'check',questions:[],warnings:[],evidence:[]}),input);
    assert.equal(checked.questions.some(q=>q.id==='required:timetracking'),false);
    const inferred={schemaVersion:1,kind:'draft',issueTypeId:'10',templateId:'task',fields:{timetracking:{originalEstimate:'1h'}},questions:[],warnings:[],evidence:[]};
    assert.throws(()=>ai.parseResponse('prepare',JSON.stringify(inferred),input),e=>e.code==='response');
    assert.throws(()=>ai.buildRequest('assist',{...input,allowFieldIds:['timetracking'],targetFieldId:'timetracking',fieldAction:'generate'}));
    delete input.draft.fields.timetracking;
    const missing=ai.parseResponse('check',JSON.stringify({schemaVersion:1,kind:'check',questions:[],warnings:[],evidence:[]}),input);
    assert.ok(missing.questions.some(q=>q.id==='required:timetracking'));assert.equal(Object.hasOwn(input.draft.fields,'timetracking'),false);
});
