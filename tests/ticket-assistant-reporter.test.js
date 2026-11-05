const test=require('node:test');
const assert=require('node:assert/strict');
const {loadUnit,memoryStorage}=require('./helpers/ticket-assistant-fixture');
const plain=value=>value===undefined?undefined:JSON.parse(JSON.stringify(value));
async function setup(options={}) {
    const drafts=loadUnit('draft'),profiles=loadUnit('profiles'),fields=loadUnit('fields');
    const validation=loadUnit('validation',{_ujgTA_fields:fields});
    const storage=loadUnit('storage',{_ujgTA_profiles:profiles,_ujgTA_draft:drafts});
    const store=storage.createStore({storage:options.backing || memoryStorage(),userKey:'account-17',origin:'https://jira.test'});
    const raw={projects:[{key:'DO',id:'100',issuetypes:[{id:'10',name:'Task',fields:{
        summary:{name:'Тема',required:true,schema:{type:'string',system:'summary'}},
        description:{name:'Описание',required:false,schema:{type:'string',system:'description'}},
        reporter:{name:'Автор',required:true,operations:['set'],schema:{type:'user',system:'reporter'},...options.reporter}
    }}]}]};
    if(Object.hasOwn(options,'alternateReporter')) {
        const type=plain(raw.projects[0].issuetypes[0]);type.id='20';type.name='Other';
        if(options.alternateReporter===null)delete type.fields.reporter;
        else type.fields.reporter=Object.assign(type.fields.reporter,options.alternateReporter);
        raw.projects[0].issuetypes.push(type);
    }
    if(options.saved) {
        let d=drafts.setSelection(drafts.createDraft({projectKey:'DO'}),{issueTypeId:'10',templateId:'task'});
        d=drafts.editField(d,'summary','Восстановить доступ');
        if(Object.hasOwn(options,'manual'))d=drafts.editField(d,'reporter',options.manual);
        if(options.locked)d.creation={status:'unknown',attemptId:'previous-attempt',issueKey:null,error:null};
        store.save('DO',{draft:d,settings:profiles.createDefaults()},0);
    }
    const posts=[];
    const api={getCurrentUser:async()=>{if(options.identityError)throw Error('Unauthorized');return Object.hasOwn(options,'user')?options.user:{key:'account-17',name:'alice',displayName:'Alice',token:'PRIVATE'};},
        getProjects:async()=>({values:[{key:'DO',id:'100'}]}),getCreateMeta:async()=>raw,
        getComponents:async()=>({projectKey:'DO',values:[],complete:true}),getVersions:async()=>({projectKey:'DO',values:[],complete:true}),
        createIssue:async payload=>{posts.push(plain(payload));return {key:'DO-1',id:'1'};}};
    const creator=loadUnit('creator',{_ujgTA_draft:drafts,_ujgTA_fields:fields,_ujgTA_validation:validation});
    const Controller=loadUnit('controller',{_ujgTA_draft:drafts,_ujgTA_profiles:profiles,_ujgTA_fields:fields,_ujgTA_validation:validation,_ujgTA_creator:creator},{AbortController});
    const c=Controller.create({api,ai:{check:async()=>({questions:[],warnings:[],evidence:[]})},createStore:()=>store});
    await c.init();await c.selectProject('DO');await c.selectIssueType('10');await c.selectTemplate('task');
    return {c,store,posts,api,raw};
}
test('authenticated Jira login fills missing reporter and reaches actual create payload after chat check',async t=>{
    const h=await setup();t.after(()=>h.c.destroy());
    assert.deepEqual(plain(h.c.getState().draft.fields.reporter),{name:'alice'});
    assert.deepEqual(plain(h.store.load('DO').draft.fields.reporter),{name:'alice'});
    await h.c.updateField('summary','Восстановить доступ');await h.c.updateField('description','Сервис недоступен в DEV.');
    assert.equal((await h.c.chatValidate(h.c.chatSnapshot())).ok,true);
    await h.c.submit();assert.equal(h.posts.length,1);assert.deepEqual(h.posts[0].fields.reporter,{name:'alice'});
    assert.doesNotMatch(JSON.stringify(h.posts),/account-17|PRIVATE|displayName/);
});
test('restored missing reporter and new selected draft both receive current user',async t=>{
    const h=await setup({saved:true});t.after(()=>h.c.destroy());
    assert.deepEqual(plain(h.c.getState().draft.fields.reporter),{name:'alice'});
    const old=h.c.getState().draft.id;await h.c.newDraft();await h.c.selectIssueType('10');await h.c.selectTemplate('task');
    assert.notEqual(h.c.getState().draft.id,old);assert.deepEqual(plain(h.c.getState().draft.fields.reporter),{name:'alice'});
});
test('native editor check can still create with Jira optional description omitted',async t=>{
    const h=await setup();t.after(()=>h.c.destroy());
    await h.c.updateSource('Проверить доступ');await h.c.updateField('summary','Проверить доступ');
    await h.c.check();assert.ok(h.c.getState().draft.checked);
    await h.c.submit();assert.equal(h.posts.length,1);
    assert.deepEqual(h.posts[0].fields.reporter,{name:'alice'});assert.equal(h.posts[0].fields.description,undefined);
});
test('optional writable reporter is filled, and refreshed nonwritable metadata prevents posting it',async t=>{
    const h=await setup({reporter:{required:false}});t.after(()=>h.c.destroy());
    assert.deepEqual(plain(h.c.getState().draft.fields.reporter),{name:'alice'});
    await h.c.updateField('summary','Проверить доступ');await h.c.updateField('description','Проверить DEV.');
    assert.equal((await h.c.chatValidate(h.c.chatSnapshot())).ok,true);
    h.raw.projects[0].issuetypes[0].fields.reporter.operations=[];
    await h.c.submit();assert.equal(h.posts.length,0);assert.equal(h.c.getState().draft.checked,null);
});
test('loading a draft with unknown creation outcome never autofills or rewrites the creation guard',async t=>{
    const h=await setup({saved:true,locked:true});t.after(()=>h.c.destroy());
    const saved=h.store.load('DO');
    assert.equal(h.c.getState().draft.fields.reporter,undefined);
    assert.equal(saved.draft.fields.reporter,undefined);assert.equal(saved.draft.creation.status,'unknown');
    await h.c.selectProject('DO');assert.deepEqual(plain(h.store.load('DO')),plain(saved));
});
for(const reporter of [null,{operations:[]},{schema:{type:'unsupported'}}])
test('automatic reporter is removed on a type without writable reporter and restored on return: '+JSON.stringify(reporter),async t=>{
    const h=await setup({alternateReporter:reporter});t.after(()=>h.c.destroy());
    await h.c.updateField('summary','Проверить доступ');await h.c.updateField('description','Проверить DEV.');
    await h.c.selectIssueType('20');
    assert.equal(h.c.getState().draft.fields.reporter,undefined);
    assert.equal(h.store.load('DO').draft.fields.reporter,undefined);
    assert.equal(h.c.getState().draft.projectKey,'DO');assert.equal(h.c.getState().draft.fields.description,'Проверить DEV.');
    if(reporter===null || reporter.operations)assert.equal((await h.c.chatValidate(h.c.chatSnapshot())).ok,reporter===null);
    await h.c.selectIssueType('10');assert.deepEqual(plain(h.c.getState().draft.fields.reporter),{name:'alice'});
});
test('restored automatic reporter retains provenance while an explicit same-user selection remains manual',async t=>{
    const backing=memoryStorage(),h=await setup({backing,alternateReporter:null});t.after(()=>h.c.destroy());
    const restored=await setup({backing,alternateReporter:null});t.after(()=>restored.c.destroy());
    await restored.c.selectIssueType('20');assert.equal(restored.c.getState().draft.fields.reporter,undefined);
    await restored.c.selectIssueType('10');await restored.c.updateField('reporter',{name:'alice'});
    await restored.c.selectIssueType('20');assert.deepEqual(plain(restored.c.getState().draft.fields.reporter),{name:'alice'});
});
test('manual reporter is preserved across unsupported type switches and new drafts do not inherit it',async t=>{
    const h=await setup({alternateReporter:null});t.after(()=>h.c.destroy());
    await h.c.updateField('reporter',{name:'bob'});await h.c.selectIssueType('20');
    assert.deepEqual(plain(h.c.getState().draft.fields.reporter),{name:'bob'});
    await h.c.selectIssueType('10');assert.deepEqual(plain(h.c.getState().draft.fields.reporter),{name:'bob'});
    await h.c.newDraft();await h.c.selectIssueType('10');
    assert.deepEqual(plain(h.c.getState().draft.fields.reporter),{name:'alice'});
});
test('automatic reporter cleanup in another project does not change the first project manual reporter',async t=>{
    const h=await setup({alternateReporter:null});t.after(()=>h.c.destroy());
    await h.c.updateField('reporter',{name:'bob'});
    const read=h.api.getCreateMeta;
    h.api.getProjects=async()=>({values:[{key:'DO',id:'100'},{key:'APP',id:'200'}]});
    h.api.getCreateMeta=async key=>{const raw=plain(await read());raw.projects[0].key=key;raw.projects[0].id=key==='DO'?'100':'200';return raw;};
    h.api.getComponents=async key=>({projectKey:key,values:[],complete:true});
    h.api.getVersions=async key=>({projectKey:key,values:[],complete:true});
    await h.c.init();await h.c.selectProject('APP');await h.c.selectIssueType('10');await h.c.selectTemplate('task');
    assert.deepEqual(plain(h.c.getState().draft.fields.reporter),{name:'alice'});
    await h.c.selectIssueType('20');assert.equal(h.c.getState().draft.fields.reporter,undefined);
    await h.c.selectProject('DO');assert.deepEqual(plain(h.c.getState().draft.fields.reporter),{name:'bob'});
    assert.equal(h.c.getState().draft.projectKey,'DO');assert.equal(h.store.load('APP').draft.fields.reporter,undefined);
});
test('a type without reporter can be checked and actually created without the automatic reporter in its payload',async t=>{
    const h=await setup({alternateReporter:null});t.after(()=>h.c.destroy());
    await h.c.updateField('summary','Проверить доступ');await h.c.updateField('description','Проверить доступ к DEV.');
    await h.c.selectIssueType('20');assert.equal((await h.c.chatValidate(h.c.chatSnapshot())).ok,true);
    await h.c.submit();assert.equal(h.posts.length,1);
    assert.equal(h.posts[0].fields.issuetype.id,'20');assert.equal(h.posts[0].fields.reporter,undefined);
});
test('restored and later explicit manual reporters survive checking, creation and project reload',async t=>{
    const h=await setup({saved:true,manual:{name:'bob'}});t.after(()=>h.c.destroy());
    assert.deepEqual(plain(h.c.getState().draft.fields.reporter),{name:'bob'});
    await h.c.updateField('reporter',{name:'carol'});await h.c.selectProject('DO');
    await h.c.updateSource('Проверить доступ');await h.c.updateField('description','Проверить доступ к DEV.');
    await h.c.check();assert.ok(h.c.getState().draft.checked);await h.c.submit();
    assert.equal(h.posts.length,1);assert.deepEqual(h.posts[0].fields.reporter,{name:'carol'});
});
for(const manual of [null,{name:''}])test('explicit manual clearing is not refilled: '+JSON.stringify(manual),async t=>{
    const h=await setup({saved:true,manual});t.after(()=>h.c.destroy());
    assert.deepEqual(plain(h.c.getState().draft.fields.reporter),manual);
    await h.c.updateField('description','Проверить доступ.');
    assert.equal((await h.c.chatValidate(h.c.chatSnapshot())).ok,false);assert.equal(h.c.getState().draft.checked,null);
});
for(const options of [{user:{key:'account-17'}},{user:{name:'   '}},{identityError:true},{reporter:{operations:[]}},{reporter:{schema:{type:'unsupported'}}}])
test('reporter autofill requires authenticated login and writable supported field: '+JSON.stringify(options),async t=>{
    const h=await setup(options);t.after(()=>h.c.destroy());
    assert.equal(h.c.getState().draft.fields.reporter,undefined);
    await h.c.updateField('summary','Проверить доступ');await h.c.updateField('description','Проверить DEV.');
    assert.equal((await h.c.chatValidate(h.c.chatSnapshot())).ok,false);assert.equal(h.c.getState().draft.checked,null);
});
