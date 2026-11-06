const test=require('node:test');
const assert=require('node:assert/strict');
const {loadUnit,memoryStorage}=require('./helpers/ticket-assistant-fixture');
const plain=x=>JSON.parse(JSON.stringify(x));
function setup(options={}) {
    const backend=options.backend || memoryStorage(),drafts=loadUnit('draft'),profiles=loadUnit('profiles'),fields=loadUnit('fields');
    const storage=loadUnit('storage',{_ujgTA_profiles:profiles,_ujgTA_draft:drafts});
    const validation=loadUnit('validation',{_ujgTA_fields:fields});
    const Creator=loadUnit('creator',{_ujgTA_draft:drafts,_ujgTA_fields:fields,_ujgTA_validation:validation});
    const Controller=loadUnit('controller',{_ujgTA_draft:drafts,_ujgTA_profiles:profiles,_ujgTA_fields:fields,_ujgTA_validation:validation,_ujgTA_creator:Creator},{AbortController});
    const stores=[],calls=[];let identity=options.user===undefined?'alice':options.user;
    const api={getCurrentUser:async()=>identity?{key:identity,name:identity}:null,
        getProjects:async()=>({values:['DO','APP','DEVOPS'].map(key=>({key,id:key+'-project',name:key})),complete:true}),
        getCreateMeta:async key=>{calls.push(key);return {projects:[{key,id:key+'-project',issuetypes:['Task','Bug','Deployment'].map((name,index)=>({id:String(index+10),name,subtask:false,fields:{summary:{required:true,name:'Summary',schema:{type:'string',system:'summary'}},description:{name:'Description',schema:{type:'string',system:'description'}}}}))}]};},
        getComponents:async key=>({projectKey:key,values:[],complete:true}),getVersions:async key=>({projectKey:key,values:[],complete:true}),...options.api};
    const ai=options.ai || {},c=Controller.create({api,ai:ai,createStore(userKey){const s=storage.createStore({storage:backend,origin:options.origin || 'https://jira.example',userKey});stores.push(s);return s;}});
    return {c,api,ai,backend,stores,calls,drafts,profiles,storage,setUser:user=>{identity=user;}};
}
async function select(c,key='DO',type='11',template='bug') {await c.selectProject(key);await c.selectIssueType(type);await c.selectTemplate(template);}

test('preferences are isolated per user and instance, survive draft clear and do not advance task CAS',()=>{
    const h=setup(),store=h.storage.createStore({storage:h.backend,origin:'https://jira.example',userKey:'alice'});
    const current=store.load('DO');assert.equal(store.saveLastProject('DO').ok,true);
    assert.equal(store.saveProjectSelection('DO',{issueTypeId:'11',templateId:'bug',profileId:'universal'}).ok,true);
    assert.equal(store.load('DO').revision,current.revision);
    store.clearDraft('DO',current.revision);
    const reload=h.storage.createStore({storage:h.backend,origin:'https://jira.example',userKey:'alice'});
    assert.equal(reload.loadLastProject(),'DO');assert.equal(reload.loadProjectSelection('DO').issueTypeId,'11');
    for(const extra of [{userKey:'bob'},{origin:'https://other.example'}]) {
        const other=h.storage.createStore({storage:h.backend,origin:'https://jira.example',userKey:'alice',...extra});
        assert.equal(other.loadLastProject(),null);assert.equal(other.loadProjectSelection('DO'),null);
    }
});

test('startup restores authorized last project and valid per-project type/template',async t=>{
    const h=setup();t.after(()=>h.c.destroy());await h.c.init();assert.equal(h.c.getState().draft,null);
    await select(h.c);await h.c.updateSource('Сохранить исходные факты');await h.c.init();
    const state=h.c.getState();assert.equal(state.draft.projectKey,'DO');assert.equal(state.draft.issueTypeId,'11');assert.equal(state.draft.templateId,'bug');assert.equal(state.draft.source,'Сохранить исходные факты');
    const other=setup({backend:h.backend});t.after(()=>other.c.destroy());await other.c.init();assert.equal(other.c.getState().draft.projectKey,'DO');
    h.setUser('bob');await h.c.init();assert.equal(h.c.getState().draft,null);
});

test('startup never restores missing authorization or a project absent from the available list',async t=>{
    const h=setup();t.after(()=>h.c.destroy());await h.c.init();await select(h.c);
    for(const restricted of [setup({backend:h.backend,user:null}),setup({backend:h.backend,api:{getProjects:async()=>({values:[{key:'APP',id:'APP-project'}],complete:true})}})]) {
        t.after(()=>restricted.c.destroy());await restricted.c.init();assert.equal(restricted.c.getState().draft,null);assert.equal(restricted.calls.length,0);
    }
});

test('selection-preserving clear resets only the current card and retains different choices per project',async t=>{
    const h=setup(),c=h.c;t.after(()=>c.destroy());await c.init();await select(c);
    await c.updateField('summary','Удалить только эту карточку');await c.selectFiles([new File(['x'],'test.txt')]);
    await select(c,'APP','12','deployment');await c.updateSource('Другой проект сохраняется');await c.selectProject('DO');
    const before=c.getState().draft;await c.discardDraft(true,{preserveSelection:true});
    let d=c.getState().draft;assert.notEqual(d.id,before.id);assert.equal(d.source,'');assert.deepEqual(d.attachments,[]);assert.equal(d.issueTypeId,'11');assert.equal(d.templateId,'bug');assert.equal(d.checked,null);
    await c.init();d=c.getState().draft;assert.equal(d.projectKey,'DO');assert.equal(d.issueTypeId,'11');assert.equal(d.templateId,'bug');
    await c.selectProject('APP');d=c.getState().draft;assert.equal(d.issueTypeId,'12');assert.equal(d.templateId,'deployment');assert.equal(d.source,'Другой проект сохраняется');
});

test('new-draft preserveSelection keeps available type/template and all write guards',async t=>{
    const h=setup(),c=h.c;t.after(()=>c.destroy());await c.init();await select(c);
    let before=c.getState().draft;await c.newDraft({preserveSelection:true});let d=c.getState().draft;
    assert.notEqual(d.id,before.id);assert.equal(d.issueTypeId,'11');assert.equal(d.templateId,'bug');
    for(const status of ['unknown','submitting']) {
        const guarded=setup(),g=guarded.c;t.after(()=>g.destroy());await g.init();await select(g);
        const saved=guarded.stores.at(-1).load('DO');saved.draft.creation={status,attemptId:'keep',issueKey:null,error:null};assert.equal(guarded.stores.at(-1).save('DO',saved,saved.revision).ok,true);
        await g.init();before=g.getState().draft;await g.newDraft({preserveSelection:true});await g.discardDraft(true,{preserveSelection:true});
        assert.equal(g.getState().draft.id,before.id);assert.equal(g.getState().draft.creation.attemptId,'keep');
    }
});

test('recent choices are revalidated against fresh Jira types and configured templates',async t=>{
    const h=setup(),c=h.c;t.after(()=>c.destroy());await c.init();await select(c);await c.discardDraft(true,{preserveSelection:true});
    const read=h.api.getCreateMeta;h.api.getCreateMeta=async key=>{const raw=await read(key);raw.projects[0].issuetypes=raw.projects[0].issuetypes.filter(type=>type.id!=='11');return raw;};
    await c.init();assert.equal(c.getState().draft.issueTypeId,null);assert.equal(c.getState().draft.templateId,null);
    h.api.getCreateMeta=read;await select(c);const settings=c.getState().settings;settings.profiles[0].templates=settings.profiles[0].templates.filter(template=>template.id!=='bug');
    await c.applySettings(settings);await c.discardDraft(true,{preserveSelection:true});await c.init();
    assert.equal(c.getState().draft.templateId,null);
});

test('fresh startup selection validates availability and an explicit selection supersedes an older restore response',async t=>{
    const h=setup();t.after(()=>h.c.destroy());await h.c.init();await select(h.c);
    let resolve,started;const startedPromise=new Promise(r=>{started=r;});
    const restored=setup({backend:h.backend}),read=restored.api.getCreateMeta;t.after(()=>restored.c.destroy());
    restored.api.getCreateMeta=key=>key==='DO'?new Promise(r=>{resolve=r;started();}):read(key);
    const initializing=restored.c.init();await startedPromise;
    await restored.c.selectProject('APP');resolve(await read('DO'));await initializing;
    assert.equal(restored.c.getState().draft.projectKey,'APP');assert.equal(restored.stores.at(-1).loadLastProject(),'APP');
});

test('created-card new draft retains selection while clearing its outcome and preserving guard transitions',async t=>{
    const h=setup(),c=h.c;t.after(()=>c.destroy());await c.init();await select(c);
    h.api.createIssue=async()=>({id:'123',key:'DO-123'});
    await c.chatUpdate({fields:{summary:'Учебная задача',description:'Проверка создания карточки с известным результатом.'}},c.chatSnapshot());
    assert.equal((await c.chatValidate(c.chatSnapshot())).ok,true);await c.submit();
    const created=c.getState().draft;assert.equal(created.creation.issueKey,'DO-123');
    await c.newDraft({preserveSelection:true});const next=c.getState().draft;
    assert.notEqual(next.id,created.id);assert.equal(next.creation.issueKey,null);assert.equal(next.issueTypeId,'11');assert.equal(next.templateId,'bug');assert.equal(next.checked,null);assert.deepEqual(next.fields,{});
});

test('selection restoration does not discard a pending assistance proposal on same-project reselect',async t=>{
    const h=setup(),c=h.c;t.after(()=>c.destroy());await c.init();await select(c);
    const stored=h.stores.at(-1).load('DO');stored.draft.pendingFields.description='Ожидающее предложение';stored.draft.pendingAssistance={fieldId:'description',action:'generate'};
    assert.equal(h.stores.at(-1).save('DO',stored,stored.revision).ok,true);
    await c.init();assert.equal(c.getState().draft.pendingFields.description,'Ожидающее предложение');
    await c.selectProject('DO');assert.equal(c.getState().draft.pendingFields.description,'Ожидающее предложение');
    assert.equal(c.getState().draft.pendingAssistance.fieldId,'description');
});

test('damaged or unavailable navigation preferences cannot damage drafts or expose identities',()=>{
    const backend=memoryStorage(),h=setup({backend}),store=h.storage.createStore({storage:backend,origin:'https://jira.example',userKey:'alice'});
    const value=store.load('DO');value.draft={source:'Сохранить исходный текст'};assert.equal(store.save('DO',value,0).ok,true);
    assert.equal(store.saveLastProject('DO').ok,true);const navKey=Array.from({length:backend.length},(_,index)=>backend.key(index)).find(key=>key.includes('%24navigation'));
    backend.setItem(navKey,'{broken');const reader=h.storage.createStore({storage:backend,origin:'https://jira.example',userKey:'alice'});
    assert.equal(reader.loadLastProject(),null);assert.equal(reader.isPersistent(),true);assert.equal(reader.load('DO').draft.source,'Сохранить исходный текст');
    const anonymous=h.storage.createStore({storage:backend,origin:'https://jira.example',userKey:null}),count=backend.length;
    anonymous.saveLastProject('APP');assert.equal(backend.length,count);
    const detached=store.loadProjectSelection('DO');assert.equal(detached,null);
});

test('editing ordinary draft text does not repeatedly rewrite recent-selection preferences',async t=>{
    const h=setup(),c=h.c;t.after(()=>c.destroy());let selectionWrites=0;const write=h.backend.setItem;
    h.backend.setItem=(key,value)=>{if(key.endsWith(':selection'))selectionWrites++;write(key,value);};
    await c.init();await select(c);const selected=selectionWrites;
    await c.updateSource('А');await c.updateSource('Аб');await c.updateField('summary','Ручной текст');
    assert.equal(selectionWrites,selected);await c.selectIssueType('12');assert.ok(selectionWrites>selected);
});

test('quota failure does not cause a second navigation write or lose canonical data',()=>{
    for(const first of ['draft','navigation','conversation']) {
        const h=setup(),store=h.storage.createStore({storage:h.backend,origin:'https://jira.example',userKey:'alice'});
        const saved=store.load('DO');saved.draft={source:'Сохранённый исходный текст'};assert.equal(store.save('DO',saved,0).ok,true);
        let writes=0;h.backend.setItem=()=>{writes++;const error=new Error('QuotaExceededError');error.name='QuotaExceededError';throw error;};
        if(first==='navigation')store.saveLastProject('DO');
        if(first==='conversation')store.saveConversation('DO','d',{transcript:[],messages:[]},0);
        const current=store.load('DO');assert.equal(current.draft.source,'Сохранённый исходный текст');current.draft.source='Новая правка';
        assert.equal(store.save('DO',current,current.revision).ok,true);
        store.saveProjectSelection('DO',{issueTypeId:'11',templateId:'bug',profileId:'universal'});store.saveLastProject('DO');
        store.saveConversation('DO','another',{transcript:[],messages:[]},0);
        assert.equal(writes,1,first);assert.equal(store.load('DO').draft.source,'Новая правка');assert.equal(store.loadProjectSelection('DO').issueTypeId,'11');
    }
});

test('unchanged navigation preference saves do not duplicate storage writes',()=>{
    const h=setup(),store=h.storage.createStore({storage:h.backend,origin:'https://jira.example',userKey:'alice'}),write=h.backend.setItem;let writes=0;
    h.backend.setItem=(key,value)=>{writes++;write(key,value);};
    store.saveLastProject('DO');store.saveLastProject('DO');
    const choice={issueTypeId:'11',templateId:'bug',profileId:'universal'};store.saveProjectSelection('DO',choice);store.saveProjectSelection('DO',choice);
    assert.equal(writes,2);
});

for(const reset of ['discard','new'])test('successful '+reset+' clears previous assistance and provider statistics only after persistence',async t=>{
    const h=setup({ai:{assist:async()=>({fields:{description:'Предложенное описание'},questions:[],warnings:[],evidence:[],usage:{inputTokens:20,outputTokens:5}})}}),c=h.c;
    t.after(()=>c.destroy());await c.init();await select(c);await c.updateSource('Факты для новой карточки');await c.assistField('description','generate');
    assert.equal(c.getState().assistance.status,'ready');assert.equal(c.getState().providerUsage.inputTokens,20);
    if(reset==='discard')await c.discardDraft(true,{preserveSelection:true});else await c.newDraft({preserveSelection:true});
    const after=c.getState();assert.equal(after.assistance,null);assert.equal(after.providerUsage,null);assert.equal(after.stage,'idle');assert.equal(after.startedAt,null);
    assert.equal(after.draft.issueTypeId,'11');assert.deepEqual(after.draft.pendingFields,{});
});

test('failed clear preserves previous assistance and provider statistics for the surviving card',async t=>{
    const h=setup({ai:{assist:async()=>({fields:{description:'Предложенное описание'},questions:[],warnings:[],evidence:[],usage:{inputTokens:20}})}}),c=h.c;
    t.after(()=>c.destroy());await c.init();await select(c);await c.updateSource('Исходные факты');await c.assistField('description','generate');
    const before=c.getState();h.stores.at(-1).clearDraft=()=>({ok:false,reason:'conflict'});await c.discardDraft(true,{preserveSelection:true});
    const after=c.getState();assert.equal(after.draft.id,before.draft.id);assert.deepEqual(after.assistance,before.assistance);assert.deepEqual(after.providerUsage,before.providerUsage);
});

test('preference quota retains unseen project creation guards while own failed draft save remains a local overlay',()=>{
    const h=setup(),options={storage:h.backend,origin:'https://jira.example',userKey:'alice'},seed=h.storage.createStore(options);
    for(const key of ['DO','APP','OPS']) {
        const value=seed.load(key);value.draft={id:'draft-'+key,projectKey:key,source:'Persisted '+key,creation:{status:key==='DO'?'idle':key==='APP'?'unknown':'submitting',attemptId:key==='DO'?null:'guard-'+key,issueKey:null,error:null}};
        assert.equal(seed.save(key,value,0).ok,true);
    }
    const reader=h.storage.createStore(options);let attempts=0;
    h.backend.setItem=()=>{attempts++;const error=new Error('QuotaExceededError');error.name='QuotaExceededError';throw error;};
    reader.saveLastProject('DO');const own=reader.load('DO');own.draft.source='Unsaved DO edit';assert.equal(reader.save('DO',own,own.revision).ok,true);
    for(const key of ['APP','OPS']) {
        const unseen=reader.load(key);assert.equal(unseen.draft.source,'Persisted '+key);assert.equal(unseen.draft.creation.status,'unknown');assert.equal(unseen.draft.creation.attemptId,'guard-'+key);
        assert.equal(reader.clearDraft(key,unseen.revision).reason,'creation-guard');
    }
    assert.equal(reader.load('DO').draft.source,'Unsaved DO edit');assert.equal(attempts,1);
    const disk=h.storage.createStore(options).load('DO');assert.equal(disk.draft.source,'Persisted DO');
});
