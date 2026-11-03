const test = require('node:test');
const assert = require('node:assert/strict');
const {loadUnit, memoryStorage, metadataFixture} = require('./helpers/ticket-assistant-fixture');
const plain = x => JSON.parse(JSON.stringify(x));
const {harness}=require('./helpers/ticket-assistant-chat-fixture');

test('automatic patch rejects foreign IDs and manual-only fields atomically',async()=>{
    const {controller:c}=await harness();
    assert.equal(typeof c.chatUpdate,'function');
    for(const patch of [{summary:'Unsafe',components:[{id:'APP-9'}]},{assignee:{name:'alice'}},{customfield_1:8},{foreign:'x'},JSON.parse('{"__proto__":{}}')]) {
        const result=await c.chatUpdate({fields:patch},c.chatSnapshot());assert.equal(result.ok,false);
        assert.equal(c.getState().draft.fields.summary,undefined);
    }
    assert.equal((await c.chatUpdate({fields:{components:[{id:'DO-9'}],summary:'Valid'}},c.chatSnapshot())).ok,true);
    assert.equal(c.getState().draft.fields.summary,'Valid');
});
test('automatic patch protects manual fields and undo cannot clobber later human edits',async()=>{
    const {controller:c}=await harness();await c.updateField('summary','Human');
    const before=c.chatSnapshot();assert.equal((await c.chatUpdate({fields:{summary:'Pico',description:'Auto'}},before)).ok,true);
    assert.equal(c.getState().draft.fields.summary,'Human');assert.equal(c.getState().draft.pendingFields.summary,'Pico');
    assert.equal(c.chatCanUndo(),true);assert.equal((await c.chatUndo()).ok,true);
    assert.equal(c.getState().draft.fields.description,undefined);assert.equal(c.getState().draft.fields.summary,'Human');
    await c.chatUpdate({fields:{description:'Again'}},c.chatSnapshot());await c.updateField('description','Manual');
    assert.equal((await c.chatUndo()).ok,false);assert.equal(c.getState().draft.fields.description,'Manual');
    assert.equal((await c.chatUpdate({fields:{summary:'Late'}},before)).ok,false);
});
test('deterministic validation marks current draft checked without LLM and required questions block',async()=>{
    const {controller:c}=await harness();
    let result=await c.chatValidate(c.chatSnapshot());assert.equal(result.ok,false);assert.ok(result.validation.fieldErrors.summary);
    await c.chatUpdate({fields:{summary:'Ready'},questions:[{id:'q',text:'Which?',required:true}]},c.chatSnapshot());
    result=await c.chatValidate(c.chatSnapshot());assert.equal(result.ok,false);assert.equal(c.getState().draft.checked,null);
    await c.chatUpdate({fields:{},questions:[]},c.chatSnapshot());result=await c.chatValidate(c.chatSnapshot());
    assert.equal(result.ok,true);assert.ok(c.getState().draft.checked);
});
test('exact template read and explicit revision checked changes never alter other settings',async()=>{
    const {controller:c}=await harness();const before=c.chatReadTemplate();
    assert.equal(before.template.instructions,c.getState().settings.profiles[0].templates[0].instructions);
    assert.equal((await c.chatApplyTemplate({instructions:'  Exact\nnew rules\n'},before.snapshot)).ok,true);
    assert.equal(c.chatReadTemplate().template.instructions,'  Exact\nnew rules\n');assert.equal(c.getState().draft.checked,null);
    assert.equal((await c.chatApplyTemplate({instructions:'Stale'},before.snapshot)).ok,false);
    assert.equal((await c.chatApplyTemplate({allowAssignee:true},c.chatSnapshot())).ok,false);
});

test('bounded tools report catalogs, validate schemas and stage template proposals without writing settings',async()=>{
    const h=await harness();let proposal;
    const Tools=loadUnit('chat-tools',{_ujgTA_fields:h.fields});
    const tools=Tools.create({controller:h.controller,onTemplateProposal:p=>{proposal=p;}});
    assert.deepEqual(plain(tools.map(t=>t.name)),['get_task','list_fields','find_options','update_task','read_template','propose_template_change','validate_task']);
    const run=(name,args={})=>tools.find(t=>t.name===name).execute(args,{});
    const options=await run('find_options',{fieldId:'customfield_2',query:'TEST',limit:1});assert.equal(options.values.length,1);assert.equal(options.complete,false);
    const fields=await run('list_fields');assert.equal(fields.fields.find(f=>f.id==='customfield_1').humanOnly,true);
    const before=h.controller.chatReadTemplate();await run('propose_template_change',{changes:{instructions:'Changed'}});
    assert.equal(h.controller.chatReadTemplate().template.instructions,before.template.instructions);assert.equal(proposal.after.instructions,'Changed');
    await assert.rejects(run('propose_template_change',{changes:{allowAssignee:true}}));
    await assert.rejects(run('update_task',{fields:{summary:'Bad'},create:true}));
    await run('update_task',{fields:{summary:'Safe'}});assert.equal(h.controller.getState().draft.fields.summary,'Safe');
});

test('relation confirmation cannot mark a later human revision checked',async()=>{
    const h=await harness();const c=h.controller;
    // Add a manual Epic field to live Jira metadata and refresh the controller.
    const base=h.api.getCreateMeta;h.api.getCreateMeta=async key=>{const raw=await base(key);for(const t of raw.projects[0].issuetypes)t.fields.customfield_923={name:'Epic',schema:{type:'any',custom:'com.pyxis.greenhopper.jira:gh-epic-link'}};return raw;};
    await c.selectProject('DO');await c.updateField('summary','Ready');await c.updateField('customfield_923','DO-42');
    let resolve;h.api.getEpic=()=>new Promise(r=>{resolve=r;});const pending=c.chatValidate(c.chatSnapshot());
    await Promise.resolve();await c.updateField('summary','Changed');resolve({id:'DO-42',label:'Epic'});
    assert.equal((await pending).ok,false);assert.equal(c.getState().draft.checked,null);
});
test('chat readiness permits exactly one existing guarded mocked creation',async()=>{
    const h=await harness(),c=h.controller;let calls=0;h.api.createIssue=async()=>{calls++;return {id:'1',key:'DO-1'};};
    await c.chatUpdate({fields:{summary:'Create once'}},c.chatSnapshot());await c.chatValidate(c.chatSnapshot());
    await Promise.all([c.submit(),c.submit()]);assert.equal(calls,1);assert.equal(c.getState().draft.creation.issueKey,'DO-1');
    assert.equal((await c.chatUpdate({fields:{summary:'Overwrite'}},c.chatSnapshot())).ok,false);await c.submit();assert.equal(calls,1);
});

test('selecting a bound template takes its Jira type from the binding',async()=>{
    const {controller:c}=await harness();const settings=c.getState().settings;
    settings.profiles[0].templates.find(t=>t.id==='bug').issueTypeId='11';await c.applySettings(settings);await c.selectTemplate('bug');
    assert.equal(c.getState().draft.issueTypeId,'11');assert.equal(c.getState().draft.templateId,'bug');
});

test('latest automatic undo survives reload and remains revision checked',async()=>{
    const h=await harness();await h.controller.updateField('summary','Human');
    await h.controller.chatUpdate({fields:{description:'Automatic'}},h.controller.chatSnapshot());
    const restored=await harness(h.backend),c=restored.controller;
    assert.equal(c.chatCanUndo(),true);assert.equal((await c.chatUndo()).ok,true);
    assert.equal(c.getState().draft.fields.description,undefined);assert.equal(c.getState().draft.fields.summary,'Human');
    assert.equal(c.getState().draft.checked,null);
});

test('conversation corruption and history quota cannot hide another store unknown creation guard',async()=>{
    for(const failure of ['corrupt','quota']) {
        const h=await harness(),c=h.controller;let creates=0;
        h.api.createIssue=async()=>{creates++;return {id:'77',key:'DO-77'};};
        await c.chatUpdate({fields:{summary:'Ready'}},c.chatSnapshot());await c.chatValidate(c.chatSnapshot());
        const chatKey=Array.from({length:h.backend.length},(_,i)=>h.backend.key(i)).find(k=>!k.includes(':chat:'))+':chat:'+encodeURIComponent(c.getState().draft.id);
        if(failure==='corrupt') {h.backend.setItem(chatKey,'{invalid');h.store.loadConversation('DO',c.getState().draft.id);}
        else {
            const set=h.backend.setItem;h.backend.setItem=(key,value)=>{if(key.includes(':chat:')) throw Error('History quota');return set(key,value);};
            assert.equal(h.store.saveConversation('DO',c.getState().draft.id,{transcript:[{id:'u',role:'user',text:'Keep local'}],messages:[]},0).ok,true);
            assert.equal(h.store.loadConversation('DO',c.getState().draft.id).value.transcript[0].text,'Keep local');
        }
        const Storage=loadUnit('storage',{_ujgTA_profiles:loadUnit('profiles'),_ujgTA_draft:h.drafts});
        const other=Storage.createStore({storage:h.backend,userKey:'alice',origin:'https://jira.test'});
        const saved=other.load('DO');saved.draft.creation={status:'unknown',attemptId:'external',issueKey:null,error:null};
        assert.equal(other.save('DO',saved,saved.revision).ok,true);
        assert.equal(h.store.load('DO').draft.creation.status,'unknown');
        await c.submit();assert.equal(creates,0);assert.equal(other.load('DO').draft.creation.status,'unknown');
    }
});

test('template Apply remains semantically pending across reload and deterministic validation cannot clear it',async()=>{
    const h=await harness(),c=h.controller;await c.updateField('summary','Ready');await c.chatValidate(c.chatSnapshot());
    assert.ok(c.getState().draft.checked);const result=await c.chatApplyTemplate({instructions:'Ask for required customer reference'},c.chatSnapshot());
    assert.equal(result.ok,true);assert.equal(result.reviewRequired,true);assert.equal(c.getState().draft.templateReviewPending,true);
    assert.equal((await c.chatValidate(c.chatSnapshot())).ok,false);assert.equal(c.getState().draft.checked,null);
    const restored=await harness(h.backend);assert.equal(restored.controller.getState().draft.templateReviewPending,true);assert.equal((await restored.controller.chatValidate(restored.controller.chatSnapshot())).ok,false);
});
