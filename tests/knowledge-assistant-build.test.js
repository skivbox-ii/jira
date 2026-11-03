const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
function builder() {
    assert.ok(fs.existsSync(path.join(root, 'build-knowledge-assistant.js')), 'separate knowledge builder is missing');
    return require('../build-knowledge-assistant');
}
function assets() {
    const source=builder().build({write:false});
    assert.equal(source,fs.readFileSync(path.join(root,'ujg-knowledge-assistant.js'),'utf8'),'committed knowledge source matches the scoped builder');
    return require('../build-widget-bootstrap-assets').buildAssets({widgets:['ujg-knowledge-assistant'],releaseRef:'6f8b282'});
}

test('scoped source build validates modules/Pico and normalizes only knowledge build identifiers', () => {
    const {build} = builder(), source = build({write:false});
    assert.deepEqual([...source.matchAll(/Module: ([\w.-]+) /g)].map(m=>m[1]), build.MODULE_ORDER);
    assert.equal([...source.matchAll(/define\(["']_ujgKnowledgeAssistant["']/g)].length, 1);
    assert.match(source, /define\("_ujgKnowledgeAssistant",/);
    assert.match(source, /"_ujgShared_llmClient"/);
    assert.match(source, /define\("_ujgKA_picoRuntime"/);
    assert.doesNotMatch(source, /_ujgTA_/);
    assert.throws(()=>build({write:false,modulesDir:__dirname}), /Module not found: transport.js/);
    assert.throws(()=>build({write:false,picoPath:path.join(__dirname,'absent-pico.js')}), /Pico bundle not found/);
    const vendor=fs.readFileSync(path.join(root,'vendor/pico-1.4.0.amd.js'),'utf8').trim();
    assert.ok(source.includes(vendor.replace('"_ujgTA_picoRuntime"','"_ujgKA_picoRuntime"')), 'only embedded Pico AMD name changes');
});

test('knowledge runtime embeds a private shared client and no deployment hosts or literal credentials', () => {
    const runtime=assets()['ujg-knowledge-assistant.runtime.js'];
    assert.equal([...runtime.matchAll(/define\(["']_ujgKA_llmClient["']/g)].length,1);
    assert.equal([...runtime.matchAll(/define\(["']_ujgKnowledgeAssistantRuntime["']/g)].length,1);
    assert.doesNotMatch(runtime, /_ujgShared_llmClient|_ujgTA_|define\(["']_ujgKnowledgeAssistant["']/);
    const shared=fs.readFileSync(path.join(root,'ujg-shared-modules/llm-client.js'),'utf8');
    const vendor=fs.readFileSync(path.join(root,'vendor/pico-1.4.0.amd.js'),'utf8');
    const existingUrls=new Set((shared+'\n'+vendor).match(/https?:\/\/[^\s"'<>`]+/g)||[]);
    for(const url of runtime.match(/https?:\/\/[^\s"'<>`]+/g)||[]) assert.ok(existingUrls.has(url), 'new hardcoded URL: '+url);
    assert.doesNotMatch(runtime, /\b(?:sk-[A-Za-z0-9]{20,}|gh[pousr]_[A-Za-z0-9]{20,})\b|Bearer\s+[A-Za-z0-9_-]{12,}|(?:apiKey|token|password)\s*[:=]\s*["'][^"']{12,}["']/i);
});

test('bootstrap uses the public AMD and existing pinned runtime/CSS mechanism without shared script fetch', () => {
    const result=assets();
    assert.deepEqual(Object.keys(result).sort(),['ujg-knowledge-assistant.bootstrap.js','ujg-knowledge-assistant.runtime.js']);
    assert.equal(require('../build-widget-bootstrap-assets').WIDGETS.knowledgeAssistant,'ujg-knowledge-assistant');
    const boot=result['ujg-knowledge-assistant.bootstrap.js'];
    assert.match(boot, /define\("_ujgKnowledgeAssistant"/);
    assert.match(boot, /_ujgKnowledgeAssistantRuntime/);
    let Bootstrap;
    vm.runInNewContext(boot,{define(name,deps,factory){Bootstrap=factory();}});
    assert.equal(Bootstrap.runtimeJs,'https://cdn.jsdelivr.net/gh/skivbox-ii/jira@6f8b282/ujg-knowledge-assistant.runtime.js');
    assert.equal(Bootstrap.css,'https://cdn.jsdelivr.net/gh/skivbox-ii/jira@6f8b282/ujg-knowledge-assistant.css');
    assert.equal(Bootstrap.sharedJs.length,0);
    assert.match(boot, /ujg-knowledge-assistant\.runtime\.js/);
    assert.match(boot, /ujg-knowledge-assistant\.css/);
    assert.match(boot, /ujg\.dashboardReleaseRef/);
    assert.match(boot, /6f8b282/);
    assert.doesNotMatch(boot, /ujg-shared-modules\/llm-client\.js/);
});

function registry() {
    const {JSDOM}=require('jsdom');
    const dom=new JSDOM('<div id="ta"></div><div id="ka"></div>',{url:'https://jira.example/'});
    const $=require('jquery')(dom.window), modules=new Map([['jquery',{value:$}]]);
    const context=vm.createContext({window:dom.window,document:dom.window.document,location:dom.window.location,
        URL,AbortController,TextEncoder,TextDecoder,performance,structuredClone,crypto:require('node:crypto').webcrypto,
        setTimeout,clearTimeout,console,define(name,deps,factory){assert.ok(!modules.has(name),'duplicate AMD '+name);modules.set(name,{deps,factory});}});
    const ka=assets()['ujg-knowledge-assistant.runtime.js'];
    const ta=require('../build-widget-bootstrap-assets').buildAssets({widgets:['ujg-ticket-assistant'],releaseRef:'6f8b282'})['ujg-ticket-assistant.runtime.js'];
    vm.runInContext(ta,context);vm.runInContext(ka,context);
    function resolve(name){assert.ok(modules.has(name),'missing AMD '+name);const entry=modules.get(name);if(!('value' in entry))entry.value=entry.factory(...entry.deps.map(resolve));return entry.value;}
    return {dom,resolve};
}

test('both real AMD gadget constructors coexist; destroying either leaves the other usable', async () => {
    const h=registry(), doc=h.dom.window.document;
    const readApi={getCurrentUser:async()=>({key:'alice'}),getProjects:async()=>({values:[{key:'DO',id:'1'}]}),
        getCreateMeta:async()=>({projects:[{key:'DO',id:'1',issuetypes:[{id:'10',name:'Task',fields:{summary:{name:'Summary',required:true,schema:{type:'string',system:'summary'}}}}]}]}),
        getComponents:async()=>({projectKey:'DO',values:[],complete:true}),getVersions:async()=>({projectKey:'DO',values:[],complete:true})};
    const api=id=>({getGadgetContentEl:()=>doc.getElementById(id),getBaseUrl:()=>'',resize(){}});
    let requests=0;
    const ta=new (h.resolve('_ujgTicketAssistantRuntime'))(api('ta'), {storage:null,api:readApi,fetchImpl:()=>{requests++;throw Error('unexpected fetch');}});
    const ka=new (h.resolve('_ujgKnowledgeAssistantRuntime'))(api('ka'), {storage:null,fetchImpl:()=>{requests++;throw Error('unexpected fetch');}});
    try {
        await Promise.all([ta.ready,ka.ready]);
        assert.ok(doc.querySelector('#ta .ujg-ticket-assistant'));assert.ok(doc.querySelector('#ka [data-ka-settings]'));
        ta.destroy();ka.openSettings();assert.equal(doc.querySelector('#ka [data-ka-panel]').hidden,false);
        const ta2=new (h.resolve('_ujgTicketAssistantRuntime'))(api('ta'),{storage:null,api:readApi});
        try {await ta2.ready;await ta2.controller.selectProject('DO');ka.destroy();ta2.openSettings();assert.equal(doc.querySelector('#ta [data-ta-settings-dialog]').hidden,false);assert.equal(requests,0);} finally {ta2.destroy();}
    } finally {ta.destroy();ka.destroy();h.dom.window.close();}
});

test('actual independent Pico sessions continue after the other runtime session is disposed', async () => {
    const h=registry();
    const ta=h.resolve('_ujgTA_picoRuntime'), ka=h.resolve('_ujgKA_picoRuntime');
    assert.notEqual(ta,ka);
    const make=(runtime,text)=>runtime.createSession({system:'Offline test',tokenBudget:{context:32768,reserve:4096},requestText:async()=>({text:JSON.stringify({text,toolCalls:[]})})});
    const a=make(ta,'TA_ONLY'), b=make(ka,'KA_ONLY');
    try {
        const results=await Promise.all([a.prompt('task'),b.prompt('knowledge')]);
        assert.deepEqual(results.map(r=>r.status),['complete','complete']);
        assert.match(JSON.stringify(a.getMessages()),/TA_ONLY/);assert.doesNotMatch(JSON.stringify(a.getMessages()),/KA_ONLY/);
        assert.match(JSON.stringify(b.getMessages()),/KA_ONLY/);assert.doesNotMatch(JSON.stringify(b.getMessages()),/TA_ONLY/);
        a.dispose();assert.equal((await b.prompt('again')).status,'complete');
        const c=make(ta,'TA_NEW');try {b.dispose();assert.equal((await c.prompt('still alive')).status,'complete');} finally {c.dispose();}
    } finally {a.dispose();b.dispose();h.dom.window.close();}
});
