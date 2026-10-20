const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {JSDOM} = require('jsdom');
const jquery = require('jquery');
const loadAmd = require('../helpers/load-amd-module');
const {loadUnit, memoryStorage} = require('../helpers/ticket-assistant-fixture');
const tick = () => new Promise(resolve => setImmediate(resolve));
const key = 'ujg-shared-llm-config';
const secret = 'synthetic-connection-only';
const config = {apiBase:'https://offline.invalid/v1',model:'offline-model',apiKey:secret,basePrompt:'Existing context',useLegacyCompletionsEndpoint:true};

async function setup(t, storage = memoryStorage(), requestText) {
    const dom = new JSDOM('<div id="root"></div>', {url:'http://localhost/jira'});
    const {window} = dom, $ = jquery(window);
    const globals = {window,document:window.document,navigator:window.navigator,URL,AbortController,setInterval,clearInterval};
    const calls = [];
    const shared = loadAmd(path.resolve(__dirname,'../../ujg-shared-modules/llm-client.js'),{},globals);
    const deps = {jquery:$,_ujgShared_llmClient:Object.assign({},shared,{requestText:requestText || ((cfg, request) => {
        calls.push({cfg,request});
        return Promise.resolve({text:JSON.stringify({schemaVersion:1,kind:'check',questions:[],warnings:[],evidence:[]})});
    })})};
    for (const name of ['profiles','fields','validation','draft','storage','api','ai','creator','controller','icons','field-ui','settings-ui','ui','main']) {
        deps['_ujgTA_'+({'field-ui':'fieldUi','settings-ui':'settingsUi'}[name] || name)] = loadUnit(name,deps,globals);
    }
    const api = {
        getCurrentUser:async()=>({key:'connection-fixture'}),
        getProjects:async()=>({values:[{id:'1',key:'DO',name:'Delivery'},{id:'2',key:'APP',name:'Application'}]}),
        getCreateMeta:async project=>({projects:[{id:project,key:project,issuetypes:[{id:'10',name:'Task',subtask:false,fields:{
            summary:{name:'Summary',required:true,schema:{type:'string',system:'summary'}}
        }}]}]}),
        getComponents:async project=>({values:[],complete:true,projectKey:project}),
        getVersions:async project=>({values:[],complete:true,projectKey:project})
    };
    const gadget = new deps._ujgTA_main({getGadgetContentEl:()=>$('#root')},{storage,api,baseUrl:'',fetchImpl:()=>{throw new Error('No network');}});
    await gadget.ready;
    t.after(()=>{gadget.destroy();window.close();});
    const root=window.document.querySelector('.ujg-ticket-assistant');
    const q=selector=>{const el=root.querySelector(selector);assert.ok(el,'Missing '+selector);return el;};
    const click=async selector=>{q(selector).click();await tick();};
    const input=(selector,value)=>{q(selector).value=value;q(selector).dispatchEvent(new window.Event('input',{bubbles:true}));};
    async function select() {
        await gadget.controller.selectProject('DO');await gadget.controller.selectIssueType('10');await gadget.controller.selectTemplate('task');
        await gadget.controller.updateSource('Source');await gadget.controller.updateField('summary','Title');
    }
    async function fill() {
        input('[data-ta-connection-base]',config.apiBase);input('[data-ta-connection-model]',config.model);input('[data-ta-connection-key]',secret);
    }
    return {gadget,c:gadget.controller,root,q,click,input,select,fill,shared,calls,window,storage,$,deps,api};
}

test('first-run connection is accessible before project; cancel and invalid input never write or call AI',async t=>{
    const s=await setup(t);assert.equal(s.c.getState().draft,null);
    await s.click('[data-ta-open-connection]');
    assert.equal(s.q('[data-ta-connection-dialog]').getAttribute('role'),'dialog');
    assert.equal(s.q('[data-ta-connection-key]').type,'password');
    assert.equal(s.window.document.activeElement,s.q('[data-ta-connection-base]'));
    s.q('[data-ta-connection-close]').focus();
    s.q('[data-ta-connection-close]').dispatchEvent(new s.window.KeyboardEvent('keydown',{key:'Tab',shiftKey:true,bubbles:true,cancelable:true}));
    assert.equal(s.window.document.activeElement,s.q('[data-ta-connection-save]'));
    s.q('[data-ta-connection-save]').dispatchEvent(new s.window.KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true}));
    assert.equal(s.window.document.activeElement,s.q('[data-ta-connection-close]'));
    await s.fill();await s.click('[data-ta-connection-cancel]');assert.equal(s.storage.getItem(key),null);
    assert.equal(s.q('[data-ta-connection-key]').value,'');
    assert.equal(s.window.document.activeElement,s.q('[data-ta-open-connection]'));
    await s.click('[data-ta-open-connection]');await s.click('[data-ta-connection-save]');
    assert.match(s.q('[data-ta-connection-error]').textContent,/URL|модель|ключ/);
    await s.fill();s.input('[data-ta-connection-base]','javascript:invalid');await s.click('[data-ta-connection-save]');
    assert.equal(s.storage.getItem(key),null);assert.equal(s.calls.length,0);
    s.q('[data-ta-connection-dialog]').dispatchEvent(new s.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
    assert.equal(s.q('[data-ta-connection-dialog]').hidden,true);assert.equal(s.q('[data-ta-connection-key]').value,'');
});

test('explicit save reloads shared config into AI, preserves prompt/protocol and excludes secret from state/export/prompts',async t=>{
    const backend=memoryStorage();backend.setItem(key,JSON.stringify(config));
    const s=await setup(t,backend);await s.select();await s.c.check();assert.ok(s.c.getState().draft.checked);
    await s.click('[data-ta-open-connection]');s.input('[data-ta-connection-model]','cancelled');await s.click('[data-ta-connection-cancel]');
    assert.equal(s.shared.readStoredConfig(backend).model,config.model);assert.ok(s.c.getState().draft.checked);
    await s.click('[data-ta-open-connection]');s.input('[data-ta-connection-model]','changed-model');await s.click('[data-ta-connection-save]');
    const saved=s.shared.readStoredConfig(backend);assert.equal(saved.model,'changed-model');assert.equal(saved.basePrompt,config.basePrompt);assert.equal(saved.useLegacyCompletionsEndpoint,true);
    assert.equal(s.c.getState().draft.checked,null);assert.equal(s.q('[data-ta-create]').disabled,true);
    assert.doesNotMatch(JSON.stringify(s.c.getState()),new RegExp(secret));
    await s.click('[data-ta-open-settings]');await s.click('[data-ta-export]');
    assert.doesNotMatch(s.q('[data-ta-export-json]').value,new RegExp(secret));await s.click('[data-ta-settings-cancel]');
    const reloaded=await setup(t,backend);await reloaded.select();await reloaded.c.check();
    assert.equal(reloaded.calls.length,1);assert.equal(reloaded.calls[0].cfg.apiKey,secret);assert.equal(reloaded.calls[0].cfg.model,'changed-model');
    assert.doesNotMatch(JSON.stringify(reloaded.calls[0].request),new RegExp(secret));
});

test('fresh explicit save uses the same shared default key and survives reload',async t=>{
    const s=await setup(t);await s.click('[data-ta-open-connection]');await s.fill();await s.click('[data-ta-connection-save]');
    assert.equal(s.shared.readStoredConfig(s.storage).apiKey,secret);assert.equal(s.q('[data-ta-connection-dialog]').hidden,true);
    const next=await setup(t,s.storage);await next.click('[data-ta-open-connection]');assert.equal(next.q('[data-ta-connection-model]').value,config.model);
    assert.equal(next.calls.length,0);
});

test('connection change invalidates both checked project drafts without losing content or cached storage revisions',async t=>{
    const backend=memoryStorage();backend.setItem(key,JSON.stringify(config));
    const s=await setup(t,backend), before={};
    for (const project of ['DO','APP']) {
        await s.c.selectProject(project);await s.c.selectIssueType('10');await s.c.selectTemplate('task');
        await s.c.updateSource('Source '+project);await s.c.updateField('summary','Manual '+project);
        const settings=s.c.getState().settings;settings.profiles[0].instructions='Rules '+project;await s.c.applySettings(settings);
        await s.c.check();before[project]=s.c.getState();assert.ok(before[project].draft.checked);
        assert.equal(s.q('[data-ta-create]').disabled,false);
    }
    await s.click('[data-ta-open-connection]');s.input('[data-ta-connection-model]','changed-model');await s.click('[data-ta-connection-save]');
    assert.equal(s.c.getState().validation,null);assert.equal(s.c.getState().draft.checked,null);
    assert.equal(s.q('[data-ta-create]').disabled,true);assert.equal(s.calls.length,2);
    for (const project of ['DO','APP']) {
        await s.c.selectProject(project);
        const state=s.c.getState(), {checked,draftRevision,...content}=state.draft;
        const {checked:oldChecked,draftRevision:oldRevision,...oldContent}=before[project].draft;
        assert.equal(checked,null,project);assert.equal(s.q('[data-ta-create]').disabled,true,project);
        assert.deepEqual(content,oldContent);assert.deepEqual(state.settings,before[project].settings);
        assert.equal(state.error,null,project);
        await s.c.updateField('summary','After connection '+project);
        assert.equal(s.c.getState().error,null,project);
        const saved=Array.from({length:backend.length},(_,i)=>JSON.parse(backend.getItem(backend.key(i))))
            .find(value=>value.draft && value.draft.projectKey===project);
        assert.equal(saved.draft.fields.summary,'After connection '+project);
        assert.equal(saved.draft.source,'Source '+project);
    }
});

for (const outcome of ['created','unknown']) {
    test('connection change from another project preserves submitting and '+outcome+' creation guards',async t=>{
        const backend=memoryStorage();backend.setItem(key,JSON.stringify(config));
        const s=await setup(t,backend);await s.select();await s.c.check();
        let resolveCreate,rejectCreate,creates=0;
        s.api.createIssue=()=>{creates++;return new Promise((resolve,reject)=>{resolveCreate=resolve;rejectCreate=reject;});};
        const pending=s.c.submit();await tick();
        assert.equal(s.c.getState().draft.creation.status,'submitting');
        const submitted=s.c.getState().draft;
        await s.c.selectProject('APP');
        await s.click('[data-ta-open-connection]');s.input('[data-ta-connection-model]','during-submit');await s.click('[data-ta-connection-save]');
        await s.c.selectProject('DO');
        assert.deepEqual(s.c.getState().draft,submitted);assert.equal(s.q('[data-ta-create]').disabled,true);
        await s.c.submit();assert.equal(creates,1);
        if (outcome==='created') resolveCreate({id:'offline-1',key:'DO-101'});else rejectCreate({outcome:'unknown'});
        await pending;
        const guarded=s.c.getState().draft;assert.equal(guarded.creation.status,outcome);
        await s.c.selectProject('APP');
        await s.click('[data-ta-open-connection]');s.input('[data-ta-connection-model]','after-submit');await s.click('[data-ta-connection-save]');
        await s.c.selectProject('DO');
        assert.deepEqual(s.c.getState().draft,guarded);assert.equal(s.q('[data-ta-create]').disabled,true);
        await s.c.submit();assert.equal(creates,1);
    });
}

for (const storage of [null,{getItem:()=>null,setItem:()=>{throw new Error(secret);}},{getItem:()=>null,setItem:()=>{}}]) {
    test('unavailable, throwing or silently dropping storage cannot report saved connection',async t=>{
        const s=await setup(t,storage);await s.click('[data-ta-open-connection]');await s.fill();await s.click('[data-ta-connection-save]');
        assert.equal(s.q('[data-ta-connection-dialog]').hidden,false);
        assert.match(s.q('[data-ta-connection-error]').textContent,/хранилищ/);
        assert.doesNotMatch(s.q('[data-ta-connection-error]').textContent,new RegExp(secret));assert.equal(s.calls.length,0);
    });
}

test('connection edits lock during active AI and creation states, including an already open dialog',async t=>{
    let finish;const backend=memoryStorage();backend.setItem(key,JSON.stringify(config));
    const s=await setup(t,backend,()=>new Promise(resolve=>{finish=resolve;}));await s.select();
    await s.click('[data-ta-open-connection]');s.input('[data-ta-connection-model]','unsaved');
    const pending=s.c.check();await tick();
    assert.equal(s.q('[data-ta-open-connection]').disabled,true);assert.equal(s.q('[data-ta-connection-save]').disabled,true);
    assert.equal(s.q('[data-ta-connection-model]').disabled,true);assert.equal(s.shared.readStoredConfig(backend).model,config.model);
    finish({text:JSON.stringify({schemaVersion:1,kind:'check',questions:[],warnings:[],evidence:[]})});await pending;
    await s.click('[data-ta-connection-cancel]');
    for (const status of ['preflight','submitting','unknown','created']) {
        const state=s.c.getState();state.draft.creation.status=status;
        const host=s.window.document.createElement('div');s.root.after(host);
        const view=s.deps._ujgTA_ui.create({$:s.$,controller:{getState:()=>state},connection:{shared:s.shared,storage:backend}});
        view.mount(host);
        assert.equal(host.querySelector('[data-ta-open-connection]').disabled,true,status);
        view.destroy();host.remove();
    }
});

test('mandatory project has no removal control, retains its chip and can switch projects; optional chips remain removable',async t=>{
    const s=await setup(t);await s.select();await s.click('[data-ta-project] [data-ta-picker]');
    assert.equal(s.root.querySelectorAll('[data-ta-project] [data-ta-remove]').length,0);
    assert.equal(s.root.querySelectorAll('[data-ta-project] [data-ta-chip]').length,1);
    assert.equal(s.c.getState().draft.projectKey,'DO');assert.equal(s.c.getState().error,null);
    const other=[...s.q('[data-ta-project]').querySelectorAll('[data-ta-candidate]')].find(el=>el.textContent.includes('APP'));assert.ok(other);other.click();await tick();
    assert.equal(s.c.getState().draft.projectKey,'APP');assert.match(s.q('[data-ta-project] [data-ta-picker]').textContent,/APP/);
    await s.c.selectTemplate('task');await s.click('[data-ta-template] [data-ta-picker]');await s.click('[data-ta-template] [data-ta-remove]');
    assert.equal(s.c.getState().draft.templateId,null);
});
