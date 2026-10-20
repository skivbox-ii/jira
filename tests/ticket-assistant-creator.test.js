const test = require('node:test');
const assert = require('node:assert/strict');
const {loadUnit, memoryStorage} = require('./helpers/ticket-assistant-fixture');

const plain = v => JSON.parse(JSON.stringify(v));
function deferred() {let resolve; const promise = new Promise(r => {resolve=r;}); return {promise,resolve};}
function setup(overrides = {}) {
    const drafts=loadUnit('draft'), profiles=loadUnit('profiles'), fields=loadUnit('fields');
    const validation=loadUnit('validation',{_ujgTA_fields:fields});
    const storage=loadUnit('storage',{_ujgTA_profiles:profiles,_ujgTA_draft:drafts});
    const raw={projects:[{key:'DO',id:'100',issuetypes:[{id:'10',name:'Task',subtask:false,fields:{
        summary:{name:'Summary',required:true,schema:{type:'string',system:'summary'}},
        components:{name:'Components',schema:{type:'array',items:'component',system:'components'}}
    }}]}]};
    const catalog={projectKey:'DO',values:[{id:'1',name:'API'}],complete:true};
    const settings=profiles.createDefaults(), backing=memoryStorage();
    const store=storage.createStore({storage:backing,userKey:'alice',origin:'https://jira.test'});
    const meta=fields.normalizeMeta(raw,'DO',{components:catalog,versions:{projectKey:'DO',values:[],complete:true}});
    let draft=drafts.createDraft({projectKey:'DO'});
    draft=drafts.setSelection(draft,{issueTypeId:'10',templateId:'task',settingsRevision:settings.revision,metaSignature:meta.signature});
    draft=drafts.setSource(draft,'Original source'); draft=drafts.editField(draft,'summary','Title');
    draft=drafts.markChecked(draft,{ok:true,fieldErrors:{},warnings:[],unsupportedRequired:[]},[],drafts.snapshot(draft));
    const posts=[], uploads=[];
    const api={getCreateMeta:async()=>raw,getComponents:async()=>catalog,getVersions:async()=>({projectKey:'DO',values:[],complete:true}),
        getAttachmentMeta:async()=>({enabled:true,uploadLimit:1000}),
        createIssue:async payload=>{posts.push(plain(payload)); return {key:'DO-123',id:'123'};},
        uploadAttachment:async(key,file)=>{uploads.push([key,file.name]);return {id:file.name,filename:file.name};},
        getIssueAttachments:async()=>[],...overrides};
    const module=loadUnit('creator',{_ujgTA_draft:drafts,_ujgTA_fields:fields,_ujgTA_validation:validation});
    const creator=module.create({api,store,now:()=>123});
    let latest=draft;
    function capture(d) {latest=d;}
    function persist(d=draft) {const saved=store.load('DO');return store.save('DO',{draft:d,settings},saved.revision);}
    persist();
    return {draft,settings,store,backing,api,posts,uploads,creator,drafts,raw,catalog,capture,persist,get latest(){return latest;}};
}

test('lost create response cannot lead to a second POST, including a reloaded store',async()=>{
    const h=setup(); h.api.createIssue=async()=>{h.posts.push(1);throw {outcome:'unknown'};};
    await h.creator.submit(h,h.capture); assert.equal(h.latest.creation.status,'unknown');
    await h.creator.submit({...h,draft:h.latest},h.capture); assert.equal(h.posts.length,1);
    const restored=h.drafts.restore(h.store.load('DO').draft);
    await h.creator.submit({...h,draft:restored},h.capture); assert.equal(h.posts.length,1);
});
test('creation refreshes relation identity after Check and keeps numeric sprint payload canonical',async()=>{
    for(const forbidden of [false,true]) {
        const h=setup();h.raw.projects[0].issuetypes[0].fields.customfield_847={schema:{type:'array',items:'string',custom:'com.pyxis.greenhopper.jira:gh-sprint'}};
        const fields=loadUnit('fields');const meta=fields.normalizeMeta(h.raw,'DO',{components:h.catalog,versions:{projectKey:'DO',values:[],complete:true}});
        h.draft=h.drafts.setSelection(h.draft,{metaSignature:meta.signature});h.draft=h.drafts.editField(h.draft,'customfield_847',73);
        h.draft=h.drafts.markChecked(h.draft,{ok:true,fieldErrors:{},warnings:[],unsupportedRequired:[]},[],h.drafts.snapshot(h.draft));h.persist(h.draft);
        let reads=0;h.api.getSprint=async()=>{reads++;if(forbidden)throw {kind:'forbidden'};return {id:'73'};};
        await h.creator.submit(h,h.capture);assert.equal(reads,1);assert.equal(h.posts.length,forbidden?0:1);
        if(!forbidden)assert.equal(h.posts[0].fields.customfield_847,73);
    }
});
test('fresh metadata and catalogs invalidate a changed checked signature without POST',async()=>{
    for(const change of ['required','component']) {
        const h=setup();
        if(change==='required') h.raw.projects[0].issuetypes[0].fields.description={required:true,name:'Description',schema:{type:'string',system:'description'}};
        else h.catalog.values=[];
        await h.creator.submit(h,h.capture);assert.equal(h.posts.length,0);assert.equal(h.latest.checked,null);
        assert.equal(h.latest.source,'Original source');
    }
});
test('checked revision and persisted policy must match; stale check never posts',async()=>{
    const h=setup(); h.draft.checked.draftRevision--;
    await h.creator.submit(h,h.capture);assert.equal(h.posts.length,0);
    const k=setup(); k.settings.profiles[0].allowAssignee=true;
    await k.creator.submit(k,k.capture);assert.equal(k.posts.length,0);
});
test('submitting is durable before POST and key is durable before uploads; double clicks coalesce',async()=>{
    const wait=deferred(), h=setup();
    h.draft.attachments=[{id:'a',name:'a.txt',size:1,type:'text/plain',status:'pending'}];h.persist();
    h.api.createIssue=async()=>{h.posts.push(1);assert.equal(h.store.load('DO').draft.creation.status,'submitting');await wait.promise;return {key:'DO-123',id:'123'};};
    h.api.uploadAttachment=async()=>{assert.equal(h.store.load('DO').draft.creation.issueKey,'DO-123');h.uploads.push(1);return {id:'9',filename:'a.txt'};};
    const request={...h,files:[{id:'a',file:new File(['a'],'a.txt',{type:'text/plain'})}]};
    const one=h.creator.submit(request,h.capture),two=h.creator.submit(request,h.capture);
    await new Promise(r=>setImmediate(r));wait.resolve();await Promise.all([one,two]);
    assert.equal(h.posts.length,1);assert.equal(h.uploads.length,1);assert.equal(h.latest.creation.status,'created');
});
test('manual edits during preflight and persistence conflicts block the POST without replacing source',async()=>{
    const wait=deferred(),h=setup({getCreateMeta:()=>wait.promise});
    const run=h.creator.submit(h,h.capture);await new Promise(r=>setImmediate(r));
    const saved=h.store.load('DO');saved.draft=h.drafts.setSource(saved.draft,'New source');h.store.save('DO',saved,saved.revision);
    wait.resolve(h.raw);await run;assert.equal(h.posts.length,0);assert.equal(h.store.load('DO').draft.source,'New source');
    const k=setup();k.store.save=()=>({ok:false,reason:'conflict'});await k.creator.submit(k,k.capture);assert.equal(k.posts.length,0);
});
test('rejected creation preserves source and clears checked; known outcome never posts again',async()=>{
    const h=setup({createIssue:async()=>{throw {outcome:'rejected',fieldErrors:{summary:['Required']}};}});
    await h.creator.submit(h,h.capture);assert.equal(h.latest.creation.status,'rejected');assert.equal(h.latest.checked,null);assert.equal(h.latest.source,'Original source');
    const k=setup();await k.creator.submit(k,k.capture);await k.creator.submit({...k,draft:k.latest},k.capture);assert.equal(k.posts.length,1);
});
test('partial attachments retry only definite failures, unknown upload only reconciles by GET',async()=>{
    const h=setup();h.draft.attachments=['a','b'].map(id=>({id,name:id+'.txt',size:1,type:'text/plain',status:'pending'}));h.persist();
    const files=['a','b'].map(id=>({id,file:new File(['x'],id+'.txt')}));
    h.api.uploadAttachment=async(key,file)=>{h.uploads.push(file.name);if(file.name==='b.txt')throw {outcome:'rejected'};return {id:'1',filename:file.name};};
    await h.creator.submit({...h,files},h.capture);assert.equal(h.latest.creation.issueKey,'DO-123');
    assert.deepEqual(h.latest.attachments.map(a=>a.status),['uploaded','failed']);
    h.api.uploadAttachment=async()=>{h.uploads.push('retry');throw {outcome:'unknown'};};
    await h.creator.retryAttachment({draft:h.latest,file:files[1]},h.capture);
    let reads=0;h.api.getIssueAttachments=async()=>{reads++;return [];};
    await h.creator.retryAttachment({draft:h.latest,file:files[1]},h.capture);
    assert.equal(reads,1);assert.deepEqual(h.uploads,['a.txt','b.txt','retry']);assert.equal(h.posts.length,1);
});
test('unavailable attachment limits preserve files until explicit create without files',async()=>{
    const h=setup({getAttachmentMeta:async()=>{throw {};}});
    h.draft.attachments=[{id:'a',name:'a.txt',size:1,status:'pending'}];h.persist();
    await h.creator.submit({...h,files:[{id:'a',file:new File(['x'],'a.txt')}]},h.capture);
    assert.equal(h.posts.length,0);assert.equal(h.latest.attachments.length,1);
    await h.creator.submit({...h,draft:h.latest,withoutAttachments:true},h.capture);
    assert.equal(h.posts.length,1);assert.equal(h.latest.attachments.length,1);assert.equal(h.uploads.length,0);
});

test('API classifies write ambiguity and uses browser multipart without Content-Type',async()=>{
    const requests=[];let response={key:'DO-1',id:'1'},error;
    const api=loadUnit('api',{}, {FormData}).createApi({baseUrl:'/jira',ajax:options=>{requests.push(options);return error?Promise.reject(error):Promise.resolve(response);}});
    assert.deepEqual(plain(await api.createIssue({fields:{summary:'Title'}})),{key:'DO-1',id:'1'});
    assert.equal(requests[0].type,'POST');assert.equal(requests[0].contentType,'application/json');
    response={};await assert.rejects(api.createIssue({fields:{}}),e=>e.outcome==='unknown');
    for(const status of [0,500,400,403]) {error={status,responseJSON:{errors:{summary:'SECRET'}}};await assert.rejects(api.createIssue({fields:{}}),e=>e.outcome===(status===400||status===403?'rejected':'unknown')&&!JSON.stringify(e).includes('SECRET'));}
    error=null;response=[{id:'9',filename:'a.txt'}];await api.uploadAttachment('DO-1',new File(['a'],'a.txt'));
    const req=requests.at(-1);assert.equal(req.contentType,false);assert.equal(req.processData,false);assert.equal(req.headers['X-Atlassian-Token'],'no-check');assert.ok(req.data instanceof FormData);
    response={fields:{attachment:[{id:'9',filename:'a.txt',size:1}]}};assert.equal((await api.getIssueAttachments('DO-1'))[0].id,'9');
});

function controllerHarness() {
    const h=setup();
    const fields=loadUnit('fields'),profiles=loadUnit('profiles');
    const validation=loadUnit('validation',{_ujgTA_fields:fields});
    const creator=loadUnit('creator',{_ujgTA_draft:h.drafts,_ujgTA_fields:fields,_ujgTA_validation:validation});
    const mod=loadUnit('controller',{_ujgTA_draft:h.drafts,_ujgTA_fields:fields,_ujgTA_validation:validation,_ujgTA_profiles:profiles,_ujgTA_creator:creator},{AbortController});
    h.api.getCurrentUser=async()=>({key:'alice'});h.api.getProjects=async()=>({values:[{key:'DO',id:'100'},{key:'APP',id:'200'}]});
    const createController=(store=h.store)=>mod.create({api:h.api,ai:{check:async()=>({questions:[],warnings:[],evidence:[]})},createStore:()=>store});
    return {...h,c:createController(),createController};
}
test('controller owns File bytes outside state, locks submitted draft and preserves original scope callback',async()=>{
    const h=controllerHarness();await h.c.init();await h.c.selectProject('DO');
    await h.c.selectFiles([new File(['SECRET_BYTES'],'a.txt')]);
    let d=h.c.getState().draft;assert.equal(d.attachments.length,1);assert.equal(d.attachments[0].needsReselect,false);
    assert.equal(JSON.stringify(h.c.getState()).includes('SECRET_BYTES'),false);
    await h.c.check();const wait=deferred();h.api.createIssue=async()=>{h.posts.push(1);await wait.promise;return {key:'DO-123',id:'123'};};
    const submitting=h.c.submit();await new Promise(r=>setImmediate(r));
    await h.c.updateSource('Forbidden edit');await h.c.newDraft();await h.c.cancel();
    assert.equal(h.c.getState().draft.source,'Original source');assert.notEqual(h.c.getState().stage,'stopped');
    await h.c.selectProject('APP');wait.resolve();await submitting;
    assert.equal(h.c.getState().draft.projectKey,'APP');assert.equal(h.c.getState().draft.creation.issueKey,null);
    assert.equal(h.store.load('DO').draft.creation.issueKey,'DO-123');assert.equal(h.posts.length,1);
});
test('T7 explicit settings conflict resolution cannot erase another tab durable creation guard',async()=>{
    for(const status of ['submitting','unknown','created']) {
        const h=controllerHarness();await h.c.init();await h.c.selectProject('DO');
        const profiles=loadUnit('profiles'),storage=loadUnit('storage',{_ujgTA_profiles:profiles,_ujgTA_draft:h.drafts});
        const other=storage.createStore({storage:h.backing,userKey:'alice',origin:'https://jira.test'});
        const local=h.c.getState(),saved=other.load('DO');
        saved.draft.creation={status,attemptId:'other-attempt',issueKey:status==='created'?'DO-555':null,error:null};
        assert.equal(other.save('DO',saved,saved.revision).ok,true);
        await h.c.loadSavedSettings();await h.c.applySettings(local.settings);await h.c.resolveSettingsConflict(local.settings);
        assert.equal(other.load('DO').draft.creation.status,status);
        await h.c.newDraft();
        const durable=other.load('DO').draft;
        assert.equal(durable.creation.status,status);assert.equal(durable.creation.attemptId,'other-attempt');
        await h.c.check();await h.c.submit();assert.equal(h.posts.length,0);
    }
});
test('reload recovers uploading as unknown and submitting as unknown while retaining known key',()=>{
    const h=setup();h.draft.creation={status:'submitting',attemptId:'old',issueKey:'DO-1'};
    h.draft.attachments=[{id:'a',name:'a',status:'uploading'}];
    const restored=h.drafts.restore(h.drafts.serialize(h.draft));
    assert.equal(restored.creation.status,'unknown');assert.equal(restored.creation.issueKey,'DO-1');assert.equal(restored.attachments[0].status,'unknown');
});
test('adding files during preflight invalidates checked and stops the stale POST; settings edits also stop it',async()=>{
    for(const edit of ['files','settings']) {
        const h=controllerHarness();await h.c.init();await h.c.selectProject('DO');await h.c.check();
        const wait=deferred();h.api.getCreateMeta=()=>wait.promise;
        const pending=h.c.submit();await new Promise(r=>setImmediate(r));
        if(edit==='files') await h.c.selectFiles([new File(['A'],'new.txt')]);
        else {const s=h.c.getState().settings;s.profiles[0].instructions+=' edited';await h.c.applySettings(s);}
        assert.equal(h.c.getState().draft.checked,null);
        wait.resolve(h.raw);await pending;assert.equal(h.posts.length,0);assert.equal(h.c.getState().draft.creation.status,'idle');
    }
});
test('switching project during preflight cancels that POST; switching after POST preserves original result',async()=>{
    const h=controllerHarness();await h.c.init();await h.c.selectProject('DO');await h.c.check();
    const wait=deferred();h.api.getCreateMeta=key=>key==='DO'?wait.promise:Promise.reject({});
    const submit=h.c.submit();await new Promise(r=>setImmediate(r));await h.c.selectProject('APP');
    wait.resolve(h.raw);await submit;assert.equal(h.posts.length,0);assert.equal(h.c.getState().draft.projectKey,'APP');
});
test('durability fallback warns before POST and known-key save conflict prevents upload',async()=>{
    const h=setup();h.store.isPersistent=()=>false;let warned=false;
    h.api.createIssue=async()=>{assert.equal(warned,true);return {key:'DO-1',id:'1'};};
    await h.creator.submit(h,(d)=>{if(d.creation.status==='submitting')warned=d.warnings.some(w=>/перезагрузки/.test(w));});
    const k=setup();k.draft.attachments=[{id:'a',name:'a',size:1,status:'pending'}];k.persist();
    k.api.createIssue=async()=>{const old=k.store.save;k.store.save=()=>({ok:false,reason:'conflict'});return {key:'DO-1',id:'1'};};
    await k.creator.submit({...k,files:[{id:'a',file:new File(['A'],'a')}]},k.capture);
    assert.equal(k.latest.creation.issueKey,'DO-1');assert.equal(k.uploads.length,0);
    await k.creator.submit({...k,draft:k.draft},k.capture);assert.equal(k.uploads.length,0);
});
test('only explicit unknown reconciliation permits another checked attempt; found key never permits issue POST',async()=>{
    const h=setup({createIssue:async()=>{throw {outcome:'unknown'};}});await h.creator.submit(h,h.capture);
    await h.creator.reconcileUnknown({draft:h.latest,resolution:'found',issueKey:'DO-9'},h.capture);
    assert.equal(h.latest.creation.issueKey,'DO-9');assert.equal(h.store.load('DO').draft.creation.issueKey,'DO-9');
    const k=setup({createIssue:async()=>{throw {outcome:'unknown'};}});await k.creator.submit(k,k.capture);
    await k.creator.reconcileUnknown({draft:k.latest,resolution:'confirmed-not-created'},k.capture);
    assert.equal(k.latest.creation.status,'idle');assert.equal(k.latest.checked,null);
});
test('memory-only warning does not prevent explicit reconciliation of an unknown outcome',async()=>{
    const h=setup({createIssue:async()=>{throw {outcome:'unknown'};}});h.store.isPersistent=()=>false;
    await h.creator.submit(h,h.capture);assert.equal(h.latest.creation.status,'unknown');
    await h.creator.reconcileUnknown({draft:h.latest,resolution:'found',issueKey:'DO-77'},h.capture);
    assert.equal(h.latest.creation.issueKey,'DO-77');
});
test('a rejected submitting save sends no POST and does not falsely lock the unsent local draft',async()=>{
    const h=setup(),save=h.store.save;
    h.store.save=(key,value,revision,transition)=>value.draft.creation.status==='submitting'?{ok:false,reason:'conflict'}:save(key,value,revision,transition);
    await h.creator.submit(h,h.capture);assert.equal(h.posts.length,0);
    assert.equal(h.latest.creation.status,'idle');assert.equal(h.latest.checked,null);
});
test('unknown reload reads metadata without saving or altering the durable creation guard',async()=>{
    const h=controllerHarness();h.draft.creation={status:'unknown',attemptId:'lost',issueKey:null,error:'Unknown'};h.persist();
    const before=h.store.load('DO');await h.c.init();await h.c.selectProject('DO');
    assert.ok(h.c.getState().meta);assert.equal(h.c.getState().draft.creation.status,'unknown');
    const after=h.store.load('DO');assert.equal(after.revision,before.revision);assert.deepEqual(plain(after.draft.creation),plain(before.draft.creation));
});
test('unpersisted field or manual-policy changes cannot reuse a checked revision',async()=>{
    for(const change of ['field','policy']) {
        const h=setup();
        if(change==='field')h.draft.fields.summary='Unreviewed title';else h.draft.protectedFields.reporter=true;
        await h.creator.submit(h,h.capture);assert.equal(h.posts.length,0);
    }
});
test('reload then adding a different file keeps descriptor IDs, byte mapping, removal and retries independent',async()=>{
    const h=controllerHarness(),a=new File(['AAA'],'a.txt'),b=new File(['BBB'],'b.txt');
    await h.c.init();await h.c.selectProject('DO');await h.c.selectFiles([a]);
    const originalId=h.c.getState().draft.attachments[0].id;
    await h.c.destroy();
    const profiles=loadUnit('profiles'),storage=loadUnit('storage',{_ujgTA_profiles:profiles,_ujgTA_draft:h.drafts});
    const restoredStore=storage.createStore({storage:h.backing,userKey:'alice',origin:'https://jira.test'});
    const c=h.createController(restoredStore);
    try {
        await c.init();await c.selectProject('DO');await c.selectFiles([b]);
        let attachments=c.getState().draft.attachments;
        assert.equal(new Set(attachments.map(f=>f.id)).size,2);
        assert.equal(attachments[0].id,originalId);
        assert.deepEqual(attachments.map(f=>f.needsReselect),[true,false]);
        await c.selectFiles([a]);attachments=c.getState().draft.attachments;
        assert.equal(attachments.length,2);assert.equal(attachments[0].id,originalId);
        assert.deepEqual(attachments.map(f=>f.needsReselect),[false,false]);
        await c.removeFile(attachments[1].id);
        assert.deepEqual(c.getState().draft.attachments.map(f=>[f.id,f.needsReselect]),[[originalId,false]]);
        await c.selectFiles([b]);attachments=c.getState().draft.attachments;
        const bId=attachments[1].id;
        assert.notEqual(originalId,bId);
        const uploaded=[];let reject=true;
        h.api.uploadAttachment=async(key,file)=>{
            uploaded.push([key,file.name,await file.text()]);
            if(reject)throw {outcome:'rejected'};
            return {id:file.name,filename:file.name};
        };
        await c.check();await c.submit();
        assert.deepEqual(uploaded,[['DO-123','a.txt','AAA'],['DO-123','b.txt','BBB']]);
        assert.deepEqual(c.getState().draft.attachments.map(f=>f.status),['failed','failed']);
        reject=false;await c.retryAttachment(originalId);
        assert.deepEqual(c.getState().draft.attachments.map(f=>f.status),['uploaded','failed']);
        await c.retryAttachment(bId);
        assert.deepEqual(uploaded.slice(2),[['DO-123','a.txt','AAA'],['DO-123','b.txt','BBB']]);
        assert.deepEqual(c.getState().draft.attachments.map(f=>f.status),['uploaded','uploaded']);
        assert.equal(h.posts.length,1);
    } finally {await c.destroy();}
});
