const test = require('node:test');
const assert = require('node:assert/strict');
const {JSDOM} = require('jsdom');
const path = require('node:path');
const load = require('./helpers/load-amd-module');
const base = path.resolve(__dirname,'../ujg-knowledge-assistant-modules');
const tick = () => new Promise(r=>setImmediate(r));
function setup(extra={}) {
    const dom = new JSDOM('<div id="root"></div>',{url:'https://jira/'}), root = dom.window.document.querySelector('#root');
    const mod = load(path.join(base,'ui.js'),{}, {document:dom.window.document});
    let saved; const chat = {prompt:async()=>({status:'complete',answer:'Done',sources:[],warnings:[]}),abort(){},...extra.chat};
    const ui = mod.mount(root,{chat,identity:{key:'alice'},connection:{getSettings:()=>({spaces:['DOC'],projects:['DO']}),apply:async()=>{},...extra.connection},storage:{load:()=>({history:extra.history||[]}),save:v=>{saved=v;},isPersistent:()=>true}});
    const q = s=>root.querySelector(s);
    async function send(text='Rules?') {q('[data-ka-prompt]').value=text; q('[data-ka-composer]').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true})); await tick();}
    return {dom,root,ui,q,send,saved:()=>saved};
}
test('late answer is ignored on scope/session replacement and disposal',async()=>{
    let resolve, aborted=0; const h=setup({chat:{prompt:()=>new Promise(r=>resolve=r),abort(){aborted++;}}});
    await h.send(); h.ui.setSession({identity:{key:'bob'},history:[]});
    resolve({status:'complete',answer:'ALICE_PRIVATE',sources:[],warnings:[]}); await tick();
    assert.doesNotMatch(h.root.textContent,/ALICE_PRIVATE|Rules\?/); assert.ok(aborted);
    h.ui.dispose(); assert.equal(h.root.childElementCount,0);
});
test('stop cancels request and retry resends last question',async()=>{
    let resolve, calls=0,aborted=0; const h=setup({chat:{prompt:()=>{calls++;return new Promise(r=>resolve=r);},abort(){aborted++;}}});
    await h.send(); h.q('[data-ka-stop]').click(); assert.equal(aborted,1);
    resolve({status:'aborted',answer:'',sources:[],warnings:[]}); await tick();
    assert.match(h.q('[data-ka-status]').textContent,/остановлен/i);
    h.q('[data-ka-retry]').click(); await tick(); assert.equal(calls,2); h.ui.dispose();
});
test('HTML and javascript Markdown stay inert; restored sources disclose historical status without evidence',()=>{
    const h=setup({history:[{role:'assistant',text:'<script>window.pwned=1</script> [x](javascript:alert(1))',sources:[{sourceId:'jira:DO-1',title:'Task',url:'javascript:alert(1)',historical:true}]}]});
    assert.equal(h.root.querySelectorAll('script,a[href^="javascript"]').length,0);
    assert.match(h.root.textContent,/Исторический/); assert.match(h.root.textContent,/Описание задачи/); h.ui.dispose();
});
test('authorization failure offers settings recovery without exposing raw provider error',async()=>{
    const h=setup({connection:{apply:async()=>{throw {code:'unauthorized',message:'SECRET_RAW_BODY'};}}});
    h.q('[data-ka-settings]').click(); h.q('[data-ka-panel]').scrollTop=500; h.q('[data-ka-apply]').click(); await tick();
    assert.match(h.q('[data-ka-status]').textContent,/авторизац|вход/i);
    assert.match(h.q('[data-ka-status]').textContent,/PAT|настройк/i); assert.doesNotMatch(h.root.textContent,/SECRET_RAW_BODY/); assert.match(h.q('[data-ka-panel-status]').textContent,/авторизац/); assert.equal(h.q('[data-ka-panel]').scrollTop,0); h.ui.dispose();
});
test('final result replaces intermediate source numbering and reads only memory fragments',async()=>{
    const h=setup({chat:{prompt:async()=>({status:'complete',answer:'Final [Источник 1]',warnings:['Макрос недоступен'],sources:[{sourceId:'confluence:42',title:'Rules',url:'https://wiki/42',offset:0,end:4,version:2,complete:false,confirmed:false}]}),getFragment:()=> 'READ'}});
    await h.send(); assert.match(h.root.textContent,/Final/); assert.match(h.root.textContent,/Неполно|неполно/); assert.match(h.root.textContent,/READ/); assert.equal(h.root.querySelectorAll('[data-ka-source]').length,1);
    assert.doesNotMatch(JSON.stringify(h.saved()),/READ/); h.ui.dispose();
});

function gadgetHarness({fetchImpl, requestText, storage, settings}={}) {
    const dom=new JSDOM('<div id="gadget"></div>',{url:'https://jira.example/'});
    const globals={window:dom.window,document:dom.window.document,location:dom.window.location,URL,AbortController,TextEncoder,TextDecoder,performance,structuredClone,crypto:require('node:crypto').webcrypto};
    const deps={};
    for(const [file,id] of [['transport','transport'],['evidence','evidence'],['jira-api','jiraApi'],['confluence-api','confluenceApi'],['tools','tools'],['skills','skills'],['storage','storage'],['ui','ui']]) deps['_ujgKA_'+id]=load(path.join(base,file+'.js'),deps,globals);
    deps._ujgKA_picoRuntime=load(path.resolve(base,'../vendor/pico-1.4.0.amd.js'),{},globals);
    deps._ujgKA_chat=load(path.join(base,'chat.js'),deps,globals);
    deps._ujgShared_llmClient=load(path.resolve(base,'../ujg-shared-modules/llm-client.js'),{},globals);
    const Main=load(path.join(base,'main.js'),deps,globals);
    const gadget=new Main({getGadgetContentEl:()=>dom.window.document.querySelector('#gadget'),getBaseUrl:()=>'',resize(){}},{fetchImpl,requestText,storage,settings:settings||{bridgeBaseUrl:'http://localhost:8000',confluenceBaseUrl:'https://wiki.example',spaces:['DOC'],projects:['DO']}});
    return {gadget,dom,q:s=>dom.window.document.querySelector(s)};
}
test('main registration is offline; Apply verifies both identities; actual Pico rereads historical sources each turn',async()=>{
    const urls=[],requests=[],values=new Map();let reads=0,modelCalls=0;
    const fetchImpl=async(url,options)=>{urls.push(url);const p=new URL(url,'https://jira.example').pathname;let data;
        if(p.endsWith('/myself'))data={name:'alice',key:'a'};
        else if(p.endsWith('/user/current'))data={type:'known',username:'alice',userKey:'ca'};
        else if(p.endsWith('/content/42')){reads++;data={id:'42',type:'page',title:'Rules',space:{key:'DOC'},version:{number:1,when:'today'},body:{storage:{value:'<p>Use template</p>'}}};}
        else throw Error('Unexpected route '+p);
        return {ok:true,headers:{get:()=> 'application/json'},json:async()=>data};};
    const h=gadgetHarness({fetchImpl,storage:{getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)},requestText:async r=>{requests.push(r);modelCalls++;return {text:JSON.stringify(modelCalls%2?{text:'',toolCalls:[{id:'r'+modelCalls,name:'read_page',arguments:{id:'42'}}]}:{text:'Use template [[confluence:42@0:12]]',toolCalls:[]})};}});
    await h.gadget.ready; assert.equal(urls.length,0);assert.equal(h.q('[data-ka-send]').disabled,true);
    h.gadget.openSettings();h.q('[data-ka-token]').value='PAT_PRIVATE';h.q('[data-ka-apply]').click();
    for(let i=0;i<8;i++)await tick();
    assert.equal(h.q('[data-ka-send]').disabled,false);
    assert.deepEqual(urls.map(url=>new URL(url).pathname),['/rest/api/2/myself','/rest/api/user/current','/rest/api/2/myself'],'Apply rechecks Jira after Confluence before restoring history');
    for(let turn=0;turn<2;turn++){const before=urls.length;h.q('[data-ka-prompt]').value='Rules?';h.q('[data-ka-composer]').dispatchEvent(new h.dom.window.Event('submit',{cancelable:true}));for(let i=0;i<12;i++)await tick();
        const during=urls.slice(before).map(url=>new URL(url).pathname), read=during.indexOf('/rest/api/content/42');
        assert.equal(during[0],'/rest/api/2/myself','turn starts with a fresh principal check');
        assert.ok(read>0 && during.slice(read+1).includes('/rest/api/2/myself'),'source settlement crosses a fresh principal check');
    }
    assert.equal(reads,2); assert.match(h.q('[data-ka-messages]').textContent,/Use template/);
    assert.doesNotMatch(JSON.stringify(requests),/PAT_PRIVATE|Authorization/);assert.doesNotMatch([...values.values()].join(''),/PAT_PRIVATE|toolResult|body.storage/);
    h.gadget.destroy();assert.equal(h.q('.ujg-knowledge-assistant'),null);
});
test('main authorization failure disables send and exposes a safe recovery action',async()=>{
    const h=gadgetHarness({fetchImpl:async()=>({ok:false,status:401,headers:{get:()=>null}}),requestText:async()=>{throw Error('Must not call LLM');}});
    h.gadget.openSettings();h.q('[data-ka-token]').value='SECRET';h.q('[data-ka-apply]').click();for(let i=0;i<8;i++)await tick();
    assert.equal(h.q('[data-ka-send]').disabled,true);assert.match(h.q('[data-ka-status]').textContent,/авторизац/);assert.doesNotMatch(h.dom.window.document.body.textContent,/SECRET/);h.gadget.destroy();
});
test('known credential pasted into a question or skill never enters UI transcript or model context',async()=>{
    const requests=[];const h=gadgetHarness({fetchImpl:async url=>({ok:true,headers:{get:()=> 'application/json'},json:async()=>url.includes('myself')?{key:'alice'}:{type:'known',userKey:'alice'}}),requestText:async r=>{requests.push(r);return {text:JSON.stringify({text:'Safe answer',toolCalls:[]})};}});
    h.gadget.openSettings();h.q('[data-ka-token]').value='PAT_PRIVATE';h.q('[data-ka-skill]').value='Rules PAT_PRIVATE';h.q('[data-ka-apply]').click();for(let i=0;i<8;i++)await tick();
    h.q('[data-ka-prompt]').value='Question PAT_PRIVATE';h.q('[data-ka-composer]').dispatchEvent(new h.dom.window.Event('submit',{cancelable:true}));for(let i=0;i<12;i++)await tick();
    assert.doesNotMatch(h.q('[data-ka-messages]').textContent,/PAT_PRIVATE/);assert.doesNotMatch(JSON.stringify(requests),/PAT_PRIVATE/);h.gadget.destroy();
});
test('saved settings can be loaded explicitly without applying draft skill until Apply',async()=>{
    let applied;const h=setup({connection:{restoreSettings:()=>({spaces:['OLD'],projects:['SAVE'],skill:{instructions:'Saved rules'}}),apply:async s=>{applied=s;}}});
    h.q('[data-ka-settings]').click();h.q('[data-ka-restore]').click();await tick();
    assert.equal(h.q('[data-ka-skill]').value,'Saved rules');assert.equal(applied,undefined);
    h.q('[data-ka-apply]').click();await tick();assert.deepEqual(Array.from(applied.spaces),['OLD']);h.ui.dispose();
});
test('tool authorization recovery remains visible after final completion',async()=>{
    let resolve;const h=setup({chat:{prompt:()=>new Promise(r=>resolve=r)}});await h.send();
    h.ui.onEvent({type:'error',message:'Требуется авторизация: проверьте PAT в настройках.'});
    resolve({status:'complete',answer:'Не удалось прочитать источник.',warnings:[],sources:[]});await tick();
    assert.match(h.q('[data-ka-status]').textContent,/PAT.*настройк/);h.ui.dispose();
});
test('memory-only storage warning remains visible beside normal completion status',async()=>{
    const h=setup();h.ui.setSession({identity:{key:'alice'},history:[],storage:{save(){},isPersistent:()=>false}});await h.send();
    assert.equal(h.q('[data-ka-storage-warning]').hidden,false);assert.match(h.q('[data-ka-storage-warning]').textContent,/памяти/);h.ui.dispose();
});

test('offline preview uses actual Pico across multiple turns with unique tool IDs and synthetic template labels',async()=>{
    const {chromium}=require('playwright');
    const {startPreview}=require('./browser/knowledge-assistant-preview-server.cjs');
    const preview=await startPreview({port:0});
    const browser=await chromium.launch({channel:'chrome',headless:true});
    try {
        const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
        page.on('pageerror',e=>errors.push(e.message));
        await page.goto(preview.url);await page.locator('[data-ka-apply]').click();await page.locator('[data-ka-send]').waitFor({state:'visible'});
        await page.waitForFunction(()=>!document.querySelector('[data-ka-send]').disabled);
        for(let turn=1;turn<=3;turn++){
            await page.locator('[data-ka-prompt]').fill('Синтетический DevOps, ход '+turn);await page.locator('[data-ka-send]').click();
            await page.waitForFunction(()=>!document.querySelector('[data-ka-send]').disabled);
            assert.equal(await page.locator('[data-ka-role="assistant"]').count(),turn);
            assert.equal(await page.locator('[data-ka-role="assistant"]').last().locator('[data-ka-source]').count(),2);
            assert.match(await page.locator('[data-ka-role="assistant"]').last().textContent(),/Задача, Ошибка и Задача развёртывания/);
        }
        await page.locator('#fixture-long').click();await page.locator('[data-ka-prompt]').fill('Длинный ответ');await page.locator('[data-ka-send]').click();await page.waitForFunction(()=>!document.querySelector('[data-ka-send]').disabled);
        assert.ok((await page.locator('[data-ka-role="assistant"]').last().locator('[data-ka-text]').textContent()).length>2000);
        assert.match(await page.locator('[data-ka-status]').textContent(),/Ответ готов/);
        assert.deepEqual(errors,[]);
    }finally{await browser.close();await preview.close();}
});
test('reload explicitly verifies Jira to discover personal nonsecret settings without PAT or history disclosure',async()=>{
    const values=new Map(),storage={getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)};let user='alice';const urls=[];
    const fetchImpl=async url=>{urls.push(url);return {ok:true,headers:{get:()=> 'application/json'},json:async()=>url.includes('myself')?{key:user}:{type:'known',userKey:user}};};
    const options={fetchImpl,storage,requestText:async()=>({text:JSON.stringify({text:'ALICE_HISTORY',toolCalls:[]})})};
    let h=gadgetHarness(options);h.gadget.openSettings();h.q('[data-ka-token]').value='PAT_PRIVATE';h.q('[data-ka-skill]').value='Saved strategy';h.q('[data-ka-apply]').click();for(let i=0;i<8;i++)await tick();
    h.q('[data-ka-prompt]').value='Rules?';h.q('[data-ka-composer]').dispatchEvent(new h.dom.window.Event('submit',{cancelable:true}));for(let i=0;i<12;i++)await tick();h.gadget.destroy();
    h=gadgetHarness({...options,settings:{}});await h.gadget.ready;h.gadget.openSettings();assert.equal(h.q('[data-ka-bridge]').value,'');const before=urls.length;
    h.q('[data-ka-restore]').click();for(let i=0;i<8;i++)await tick();
    assert.equal(urls.length,before+1);assert.match(urls.at(-1),/myself/);
    assert.equal(h.q('[data-ka-bridge]').value,'http://localhost:8000');assert.equal(h.q('[data-ka-spaces]').value,'DOC');assert.equal(h.q('[data-ka-skill]').value,'Saved strategy');assert.equal(h.q('[data-ka-token]').value,'');
    assert.doesNotMatch(h.q('[data-ka-messages]').textContent,/ALICE_HISTORY/);assert.equal(h.q('[data-ka-send]').disabled,true);
    h.q('[data-ka-token]').value='NEW_PRIVATE';h.q('[data-ka-apply]').click();for(let i=0;i<8;i++)await tick();assert.match(h.q('[data-ka-messages]').textContent,/ALICE_HISTORY/);h.gadget.destroy();
    user='bob';h=gadgetHarness({...options,settings:{}});h.gadget.openSettings();h.q('[data-ka-restore]').click();for(let i=0;i<8;i++)await tick();assert.equal(h.q('[data-ka-bridge]').value,'');assert.doesNotMatch(h.dom.window.document.body.textContent,/ALICE_HISTORY|Saved strategy/);h.gadget.destroy();
});
test('rate limit reports a safe retry delay and settings recovery',async()=>{
    const h=setup({connection:{apply:async()=>{throw {code:'rate-limit',retryAfter:5,message:'PRIVATE_RAW'};}}});h.q('[data-ka-settings]').click();h.q('[data-ka-apply]').click();await tick();
    assert.match(h.q('[data-ka-panel-status]').textContent,/лимит.*5/);assert.doesNotMatch(h.root.textContent,/PRIVATE_RAW/);h.ui.dispose();
});

async function applyGadget(h, token, skill) {
    h.gadget.openSettings();h.q('[data-ka-token]').value=token;
    if(skill!==undefined)h.q('[data-ka-skill]').value=skill;
    h.q('[data-ka-apply]').click();for(let i=0;i<8;i++)await tick();
    assert.equal(h.q('[data-ka-send]').disabled,false);
}
async function sendGadget(h, text) {
    h.q('[data-ka-prompt]').value=text;h.q('[data-ka-composer]').dispatchEvent(new h.dom.window.Event('submit',{cancelable:true}));
    for(let i=0;i<16;i++)await tick();
}
test('rotated known PATs stay redacted in questions settings outputs fragments model requests and persistence',async()=>{
    const old='PAT_OLD."\\[synthetic]',current='PAT_NEW_SYNTHETIC',values=new Map(),requests=[];
    const corpus='Private fragment '+old+' and '+current;let calls=0;
    const h=gadgetHarness({storage:{getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)},fetchImpl:async url=>({ok:true,headers:{get:()=> 'application/json'},json:async()=>{
        if(url.includes('myself'))return {key:'alice'};
        if(url.includes('user/current'))return {type:'known',userKey:'confluence-a'};
        return {id:'42',type:'page',title:'Rules '+old,space:{key:'DOC'},version:{number:1},body:{storage:{value:'<p>'+corpus+'</p>'}}};
    }}),requestText:async request=>{requests.push(request);calls++;return {text:JSON.stringify(calls%2?{text:'',toolCalls:[{id:'read-'+calls,name:'read_page',arguments:{id:'42'}}]}:{text:'Echo '+old+' '+current+' [[confluence:42@0:'+corpus.length+']]',toolCalls:[]})};}});
    try {
        await applyGadget(h,old);await applyGadget(h,current,'Find rules '+old+' '+current);
        await sendGadget(h,'Question '+old+' '+current);
        const publicText=h.q('[data-ka-messages]').textContent;
        assert.match(publicText,/Echo/);assert.equal(h.q('[data-ka-fragment]').textContent.includes('[скрыто]'),true);
        function strings(value){if(typeof value==='string'){try{return [value,...strings(JSON.parse(value))];}catch(ignored){return [value];}}if(value && typeof value==='object')return Object.values(value).flatMap(strings);return [];}
        const modelStrings=requests.flatMap(r=>[r.system,...strings(JSON.parse(r.user))]);
        const storedStrings=[...values.values()].flatMap(raw=>strings(JSON.parse(raw)));
        for(const secret of [old,current]) {
            assert.equal(publicText.includes(secret),false,'UI question/output/source/fragment contains known PAT');
            assert.equal(modelStrings.some(text=>text.includes(secret)),false,'model request including tool corpus contains known PAT');
            assert.equal(storedStrings.some(text=>text.includes(secret)),false,'persistence contains known PAT');
        }
        h.gadget.openSettings();assert.doesNotMatch(h.q('[data-ka-skill]').value,/PAT_OLD|PAT_NEW/);
        assert.equal(h.q('[data-ka-token]').value,'');
    }finally{h.gadget.destroy();}
});
test('real Main preserves separate verified A B A transcripts through Apply saves and reload',async()=>{
    const values=new Map(),storage={getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)};let conf='A';const checks=[];
    const options={storage,fetchImpl:async url=>{checks.push(url);return {ok:true,headers:{get:()=> 'application/json'},json:async()=>url.includes('myself')?{key:'alice'}:{type:'known',userKey:conf}};},requestText:async()=>({text:JSON.stringify({text:'ANSWER_'+conf,toolCalls:[]})})};
    let h=gadgetHarness(options);
    try {
        await applyGadget(h,'TOKEN_A');await sendGadget(h,'QUESTION_A');assert.match(h.q('[data-ka-messages]').textContent,/ANSWER_A/);
        conf='B';await applyGadget(h,'TOKEN_B');assert.doesNotMatch(h.q('[data-ka-messages]').textContent,/QUESTION_A|ANSWER_A/);
        await sendGadget(h,'QUESTION_B');assert.match(h.q('[data-ka-messages]').textContent,/ANSWER_B/);
        conf='A';const before=checks.length;await applyGadget(h,'TOKEN_A');assert.match(h.q('[data-ka-messages]').textContent,/QUESTION_A.*ANSWER_A/s);assert.doesNotMatch(h.q('[data-ka-messages]').textContent,/QUESTION_B|ANSWER_B/);
        assert.deepEqual(checks.slice(before).map(url=>new URL(url).pathname),['/rest/api/2/myself','/rest/api/user/current','/rest/api/2/myself'],'Apply verifies both identities and the final Jira principal before transcript access');
        h.gadget.destroy();h=gadgetHarness(options);await applyGadget(h,'TOKEN_A');assert.match(h.q('[data-ka-messages]').textContent,/ANSWER_A/);
        conf='B';await applyGadget(h,'TOKEN_B');assert.match(h.q('[data-ka-messages]').textContent,/ANSWER_B/);assert.doesNotMatch(h.q('[data-ka-messages]').textContent,/ANSWER_A/);
    }finally{h.gadget.destroy();}
});

test('actual Main Pico model envelopes preserve exact numeric JSON and code text alongside nested escaped PATs',async()=>{
    const old='PAT_OLD."\\[lossless]',current='PAT_NEW_LOSSLESS',requests=[];
    const questions=[
        '9007199254740993', '1e400', '-0',
        '{ "id":9007199254740993, "overflow":1e400, "code":"\\u0041", "fraction":1.2300 }',
        '```js\nconst id = 9007199254740993;\nconst json = {"id":9007199254740993};\n```'
    ];
    const plainSources=[
        '{ \"numericId\":9007199254740993 }', '{ \"measurement\":1e400 }', '{ \"signedZero\":-0 }',
        '{ \"sourceId\":9007199254740993, \"overflow\":1e400, \"code\":\"\\u0041\", \"fraction\":1.2300 }',
        '// source example\n'+questions[4]
    ];
    const mixed='{ "id":9007199254740993, "overflow":1e400, "credential":'+JSON.stringify(old)+', "code":"\\u0041", "current":'+JSON.stringify(current)+' }';
    const sources=plainSources.concat(mixed);let sourceIndex=0,calls=0;
    const h=gadgetHarness({fetchImpl:async url=>({ok:true,headers:{get:()=> 'application/json'},json:async()=>{
        if(url.includes('myself'))return {key:'alice'};
        if(url.includes('user/current'))return {type:'known',userKey:'confluence-a'};
        return {key:'DO-1',fields:{summary:'Exact text',description:sources[sourceIndex],project:{key:'DO'},updated:'today'}};
    }}),requestText:async request=>{requests.push(request);calls++;return {text:JSON.stringify(calls%2?{text:'',toolCalls:[{id:'lossless-'+calls,name:'read_issue',arguments:{id:'DO-1'}}]}:{text:'Read [[jira:DO-1@0:'+sources[sourceIndex].length+']]',toolCalls:[]})};}});
    function texts(value){
        if(typeof value==='string'){
            // Keep literal text first; decode nested envelopes only to inspect their string leaves.
            try{return [value,...texts(JSON.parse(value))];}catch(ignored){return [value];}
        }
        return value && typeof value==='object'?Object.values(value).flatMap(texts):[];
    }
    try {
        await applyGadget(h,old);await applyGadget(h,current);
        for(sourceIndex=0;sourceIndex<sources.length;sourceIndex++){
            const question=sourceIndex<questions.length?questions[sourceIndex]:'Compare '+old+' '+current;
            const start=requests.length;await sendGadget(h,question);
            assert.equal(requests.length,start+2,'Pico must issue read and answer model requests');
            const first=texts(JSON.parse(requests[start].user)), second=texts(JSON.parse(requests[start+1].user));
            const expected=sourceIndex<plainSources.length?sources[sourceIndex]:mixed.replace(JSON.stringify(old),JSON.stringify('[скрыто]')).replace(JSON.stringify(current),JSON.stringify('[скрыто]'));
            if(sourceIndex<plainSources.length)assert.ok(first.includes(question),'question text changed: '+question);
            assert.ok(second.includes(expected),'source text changed: '+expected);
            for(const secret of [old,current])assert.equal(second.some(text=>text.includes(secret)),false,'nested model envelope leaked PAT');
        }
    }finally{h.gadget.destroy();}
});

function jsonReply(data) {return {ok:true,headers:{get:()=> 'application/json'},json:async()=>data};}
function submitGadget(h,text) {
    h.q('[data-ka-prompt]').value=text;
    h.q('[data-ka-composer]').dispatchEvent(new h.dom.window.Event('submit',{cancelable:true}));
}
for(const change of ['bob','auth-loss']) {
    test('final fix Main gates new question persistence and old context after between-turn '+change,async()=>{
        const values=new Map(),requests=[],checks=[];let principal='alice';
        const h=gadgetHarness({storage:{getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)},fetchImpl:async url=>{
            if(url.includes('myself')){checks.push(principal);return principal==='auth-loss'?{ok:false,status:401}:jsonReply({key:principal});}
            return jsonReply({type:'known',userKey:'conf-a'});
        },requestText:async request=>{requests.push(request);return {text:JSON.stringify({text:'ALICE_PRIVATE_ANSWER',toolCalls:[]})};}});
        try {
            await applyGadget(h,'SYNTHETIC_PAT');await sendGadget(h,'ALICE_PRIVATE_QUESTION');
            const saved=[...values.values()].join(''), before=requests.length, beforeChecks=checks.length;
            principal=change;await sendGadget(h,'NEW_PRINCIPAL_PRIVATE_QUESTION');
            assert.equal(requests.length,before,'no old context reaches a model for the changed principal');
            assert.ok(checks.length>beforeChecks,'turn freshly reads cookie-backed myself');
            assert.equal([...values.values()].join(''),saved,'identity gate precedes even the user-question write');
            assert.doesNotMatch([...values.values()].join(''),/NEW_PRINCIPAL_PRIVATE_QUESTION/);
            assert.doesNotMatch(h.q('[data-ka-messages]').textContent,/ALICE_PRIVATE|NEW_PRINCIPAL/);
            assert.equal(h.q('[data-ka-send]').disabled,true);assert.equal(h.q('[data-ka-retry]').hidden,true);
            assert.match(h.q('[data-ka-status]').textContent,/Jira.*PAT.*настройк|авторизац/);
            // Invalidated sessions cannot silently reuse their retained active PAT.
            h.gadget.openSettings();h.q('[data-ka-apply]').click();for(let i=0;i<10;i++)await tick();
            assert.equal(h.q('[data-ka-send]').disabled,true);
            principal='bob';await applyGadget(h,'NEW_SYNTHETIC_PAT');await sendGadget(h,'BOB_VERIFIED_QUESTION');
            assert.doesNotMatch(requests.at(-1).user,/ALICE_PRIVATE_QUESTION|NEW_PRINCIPAL_PRIVATE_QUESTION/);
            assert.doesNotMatch(values.get('ujg.knowledgeAssistant.v1:https://jira.example:alice'),/BOB_VERIFIED_QUESTION|NEW_PRINCIPAL_PRIVATE_QUESTION/);
            assert.match(values.get('ujg.knowledgeAssistant.v1:https://jira.example:bob'),/BOB_VERIFIED_QUESTION/);
        }finally{h.gadget.destroy();}
    });
    for(const pending of ['model','read','model-error','read-error']) {
        test('final fix Main rejects '+pending+' settlement after principal '+change,async()=>{
            let principal='alice',settle,phase='first',reads=0;const values=new Map(),requests=[];
            const h=gadgetHarness({storage:{getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)},fetchImpl:async(url,options)=>{
                if(url.includes('myself'))return principal==='auth-loss'?{ok:false,status:401}:jsonReply({key:principal});
                if(url.includes('user/current'))return jsonReply({type:'known',userKey:'conf-a'});
                reads++;assert.match(url,/issue\/DO-1/);
                return new Promise((resolve,reject)=>{settle=()=>pending==='read-error'?reject(Error('RAW_SYNTHETIC_SOURCE_ERROR')):resolve(jsonReply({key:'DO-1',fields:{summary:'NEW_PRINCIPAL_TITLE',description:'NEW_PRINCIPAL_CORPUS',project:{key:'DO'},updated:'v1'}}));});
            },requestText:async request=>{
                requests.push(request);
                if(phase==='first')return {text:JSON.stringify({text:'ALICE_HISTORY',toolCalls:[]})};
                if(pending.startsWith('model'))return new Promise((resolve,reject)=>{settle=()=>pending==='model-error'?reject(Error('RAW_SYNTHETIC_MODEL_ERROR')):resolve({text:JSON.stringify({text:'NEW_PRINCIPAL_ANSWER',toolCalls:[{id:'late-read',name:'read_issue',arguments:{id:'DO-1'}}]})});});
                return {text:JSON.stringify(requests.length===2?{text:'',toolCalls:[{id:'pending-read',name:'read_issue',arguments:{id:'DO-1'}}]}:{text:'NEW_PRINCIPAL_ANSWER [[jira:DO-1@0:19]]',toolCalls:[]})};
            }});
            try {
                await applyGadget(h,'SYNTHETIC_PAT');await sendGadget(h,'ALICE_QUESTION');phase='pending';
                await sendGadget(h,'A_STARTED_THIS_TURN');assert.equal(typeof settle,'function');
                principal=change;settle();for(let i=0;i<24;i++)await tick();
                assert.equal(requests.length,2,'no settled response or read corpus enters another model request');
                assert.equal(reads,pending.startsWith('read')?1:0,'changed model result cannot dispatch tools');
                assert.equal(requests[1].signal.aborted,true,'principal invalidation aborts the actual Pico request');
                assert.equal(h.q('[data-ka-send]').disabled,true);assert.equal(h.q('[data-ka-source]'),null);
                assert.doesNotMatch(h.q('[data-ka-messages]').textContent,/ALICE_|NEW_PRINCIPAL/);
                assert.doesNotMatch(h.dom.window.document.body.textContent,/RAW_SYNTHETIC/);
                assert.doesNotMatch([...values.values()].join(''),/NEW_PRINCIPAL/);
                assert.match(h.q('[data-ka-status]').textContent,/Jira.*PAT.*настройк|авторизац/);
            }finally{h.gadget.destroy();}
        });
    }
}

for(const mode of ['memory','quota','stale-quota']) {
    test('final fix Main retains same-identity and A B A sanitized UI history across Apply in '+mode,async()=>{
        const values=new Map();let quota=false,conf='A',calls=0;
        const storage=mode==='memory'?null:{getItem:k=>values.get(k),setItem:(k,v)=>{if(quota||mode==='quota')throw Error('quota');values.set(k,v);}};
        const h=gadgetHarness({storage,fetchImpl:async url=>jsonReply(url.includes('myself')?{key:'alice'}:url.includes('user/current')?{type:'known',userKey:conf}:{key:'DO-1',fields:{summary:'Synthetic',description:'CORPUS_MUST_STAY_IN_EVIDENCE_ONLY',project:{key:'DO'},updated:'v1'}}),requestText:async()=>{
            calls++;return {text:JSON.stringify(calls%2?{text:'',toolCalls:[{id:'read-'+calls,name:'read_issue',arguments:{id:'DO-1'}}]}:{text:'ANSWER_'+conf+' SYNTHETIC_PAT [[jira:DO-1@0:5]]',toolCalls:[]})};
        }});
        try {
            await applyGadget(h,'SYNTHETIC_PAT');await sendGadget(h,'OLD_QUESTION_A');
            quota=true;await sendGadget(h,'LATEST_QUESTION_A SYNTHETIC_PAT');
            if(mode==='stale-quota')assert.doesNotMatch([...values.values()].join(''),/LATEST_QUESTION_A/);
            assert.equal(h.q('[data-ka-storage-warning]').hidden,false);
            await applyGadget(h,'SYNTHETIC_PAT','Edited skill');
            assert.match(h.q('[data-ka-messages]').textContent,/OLD_QUESTION_A.*LATEST_QUESTION_A.*ANSWER_A/s);
            assert.doesNotMatch(h.q('[data-ka-messages]').textContent,/SYNTHETIC_PAT|CORPUS_MUST/);
            assert.match(h.q('[data-ka-source]').textContent,/Исторический/);
            conf='B';await applyGadget(h,'SYNTHETIC_PAT');assert.doesNotMatch(h.q('[data-ka-messages]').textContent,/QUESTION_A|ANSWER_A/);
            await sendGadget(h,'QUESTION_B');conf='A';await applyGadget(h,'SYNTHETIC_PAT');
            assert.match(h.q('[data-ka-messages]').textContent,/LATEST_QUESTION_A.*ANSWER_A/s);assert.doesNotMatch(h.q('[data-ka-messages]').textContent,/QUESTION_B|ANSWER_B/);
            conf='B';await applyGadget(h,'SYNTHETIC_PAT');assert.match(h.q('[data-ka-messages]').textContent,/QUESTION_B.*ANSWER_B/s);
            assert.doesNotMatch([...values.values()].join(''),/SYNTHETIC_PAT|CORPUS_MUST/);
            h.gadget.destroy();const fresh=gadgetHarness({storage:null});assert.equal(fresh.q('[data-ka-send]').disabled,true);assert.doesNotMatch(fresh.q('[data-ka-messages]').textContent,/QUESTION_|ANSWER_/);fresh.gadget.destroy();
        }finally{h.gadget.destroy();}
    });
}

for(const example of [
    {name:'overlapping and contained',text:'abcdef',offsets:[3,0,2],start:0,end:6,want:'abcdef'},
    {name:'clipped overlap',text:'abcdef',offsets:[0,3],start:1,end:5,want:'bcde'},
    {name:'adjacent split UTF16 surrogate pair',text:'x'.repeat(7999)+'🔐SYNTHETIC_PATtail',offsets:[0,8000],start:7999,end:8018,want:'🔐[скрыто]tail'},
    {name:'adjacent split secret',text:'x'.repeat(7990)+'🔐SYNTHETIC_PATtail',offsets:[0,8000],start:7990,end:8009,want:'🔐[скрыто]tail'}
]) {
    test('final fix actual Main Pico UI discloses '+example.name+' exactly once',async()=>{
        let calls=0;const values=new Map();
        const h=gadgetHarness({storage:{getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)},fetchImpl:async url=>jsonReply(url.includes('myself')?{key:'alice'}:url.includes('user/current')?{type:'known',userKey:'conf-a'}:{key:'DO-1',fields:{summary:'Synthetic',description:example.text,project:{key:'DO'},updated:'v1'}}),requestText:async()=>{
            const offset=example.offsets[calls++];return {text:JSON.stringify(offset===undefined?{text:'Result [[jira:DO-1@'+example.start+':'+example.end+']]',toolCalls:[]}:{text:'',toolCalls:[{id:'range-'+calls,name:'read_issue',arguments:{id:'DO-1',offset}}]})};
        }});
        try {
            await applyGadget(h,'SYNTHETIC_PAT');await sendGadget(h,'Read ranges');
            assert.equal(h.q('[data-ka-fragment]').textContent,example.want);
            assert.equal(h.q('[data-ka-source]').textContent.includes('диапазон '+example.start+'–'+example.end),true);
            assert.doesNotMatch([...values.values()].join(''),/SYNTHETIC_PAT|abcdef|xxxxxxxx|🔐/);
        }finally{h.gadget.destroy();}
    });
}

for(const action of ['stop','apply','destroy']) {
    test('final fix actual Main ignores late preparation after '+action,async()=>{
        let pause=false,release,identitySignal,models=0;const values=new Map();
        const h=gadgetHarness({storage:{getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)},fetchImpl:async(url,options)=>{
            if(url.includes('myself')&&pause){pause=false;identitySignal=options.signal;return new Promise(resolve=>{release=()=>resolve(jsonReply({key:'alice'}));});}
            return jsonReply(url.includes('myself')?{key:'alice'}:{type:'known',userKey:'conf-a'});
        },requestText:async()=>{models++;return {text:JSON.stringify({text:'Answer',toolCalls:[]})};}});
        try {
            await applyGadget(h,'SYNTHETIC_PAT');const saved=[...values.values()].join('');
            pause=true;submitGadget(h,'QUESTION_MUST_NOT_BE_SAVED');await tick();assert.equal(typeof release,'function');
            assert.doesNotMatch(h.q('[data-ka-messages]').textContent,/QUESTION_MUST_NOT_BE_SAVED/);
            assert.equal([...values.values()].join(''),saved,'pending identity check cannot write the question');
            if(action==='apply')await applyGadget(h,'NEW_SYNTHETIC_PAT');
            else if(action==='stop')h.q('[data-ka-stop]').click();
            else h.gadget.destroy();
            assert.equal(identitySignal.aborted,true,'Stop/Apply/destroy abort the pending identity fetch');
            release();for(let i=0;i<12;i++)await tick();
            assert.equal(models,0);assert.doesNotMatch([...values.values()].join(''),/QUESTION_MUST_NOT_BE_SAVED/);
            if(action!=='destroy')assert.equal(h.q('[data-ka-send]').disabled,false,'late preparation cannot disable the current valid session');
        }finally{h.gadget.destroy();}
    });
}

test('final fix Main rechecks Jira after pending Confluence verification before exposing cached history',async()=>{
    let principal='alice',pause=false,release;const values=new Map();
    const h=gadgetHarness({storage:{getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)},fetchImpl:async url=>{
        if(url.includes('user/current')&&pause)return new Promise(resolve=>{release=()=>resolve(jsonReply({type:'known',userKey:'conf-a'}));});
        return jsonReply(url.includes('myself')?{key:principal}:{type:'known',userKey:'conf-a'});
    },requestText:async()=>({text:JSON.stringify({text:'ALICE_PRIVATE_HISTORY',toolCalls:[]})})});
    try {
        await applyGadget(h,'SYNTHETIC_PAT');await sendGadget(h,'ALICE_QUESTION');
        pause=true;h.gadget.openSettings();h.q('[data-ka-apply]').click();for(let i=0;i<8;i++)await tick();
        assert.equal(typeof release,'function');principal='bob';release();for(let i=0;i<12;i++)await tick();
        assert.equal(h.q('[data-ka-send]').disabled,true);assert.doesNotMatch(h.q('[data-ka-messages]').textContent,/ALICE_/);
        assert.equal(values.has('ujg.knowledgeAssistant.v1:https://jira.example:bob'),false);
    }finally{h.gadget.destroy();}
});

test('final fix new turn guard never reuses a prior turn pending principal request',async()=>{
    let principal='alice',holdChecks=false,models=0;const reads=new Map(),checks=[],values=new Map();
    const h=gadgetHarness({storage:{getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)},fetchImpl:async(url,options)=>{
        if(url.includes('myself')){
            const captured=principal;
            if(holdChecks)return new Promise(resolve=>checks.push({signal:options.signal,resolve:()=>resolve(jsonReply({key:captured}))}));
            return jsonReply({key:captured});
        }
        if(url.includes('user/current'))return jsonReply({type:'known',userKey:'conf-a'});
        const id=new URL(url).pathname.split('/').at(-1);
        return new Promise(resolve=>reads.set(id,()=>resolve(jsonReply({key:id,fields:{summary:'Private '+principal,description:'PRINCIPAL_SOURCE_'+principal,project:{key:'DO'},updated:'v1'}}))));
    },requestText:async()=>{models++;return {text:JSON.stringify(models===1?{text:'',toolCalls:[{id:'pending-1',name:'read_issue',arguments:{id:'DO-1'}}]}:{text:'Should not reach this model',toolCalls:[]})};}});
    try {
        await applyGadget(h,'SYNTHETIC_PAT');await sendGadget(h,'Read first');assert.equal(reads.size,1);
        holdChecks=true;reads.get('DO-1')();for(let i=0;i<8;i++)await tick();assert.equal(checks.length,1);
        h.q('[data-ka-stop]').click();principal='bob';await sendGadget(h,'NEW_PRINCIPAL_QUESTION');
        assert.equal(checks.length,2,'new boundary must not reuse the previous turn still-pending Alice check');
        checks[1].resolve();for(let i=0;i<12;i++)await tick();
        assert.equal(checks[0].signal.aborted,true);checks[0].resolve();for(let i=0;i<8;i++)await tick();
        assert.equal(models,1);assert.equal(h.q('[data-ka-send]').disabled,true);assert.equal(h.q('[data-ka-source]'),null);
        assert.doesNotMatch([...values.values()].join(''),/PRINCIPAL_SOURCE|Private bob|NEW_PRINCIPAL_QUESTION/);
    }finally{h.gadget.destroy();checks.forEach(check=>check.resolve());}
});

for(const pending of ['identity','model']) {
    test('final fix UI 180 second deadline includes pending initial '+pending+' guard work',async()=>{
        let pause=false,release,signal,deadline,deadlines=0,models=0;const values=new Map();
        const h=gadgetHarness({storage:{getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)},fetchImpl:async(url,options)=>{
            if(url.includes('myself')&&pause&&pending==='identity'){signal=options.signal;return new Promise(resolve=>{release=()=>resolve(jsonReply({key:'alice'}));});}
            return jsonReply(url.includes('myself')?{key:'alice'}:{type:'known',userKey:'conf-a'});
        },requestText:async request=>{models++;signal=request.signal;return new Promise(resolve=>{release=()=>resolve({text:JSON.stringify({text:'LATE_ANSWER',toolCalls:[]})});});}});
        try {
            await applyGadget(h,'SYNTHETIC_PAT');const saved=[...values.values()].join('');
            const realTimeout=h.dom.window.setTimeout.bind(h.dom.window);
            h.dom.window.setTimeout=(callback,ms)=>{if(ms===180000){deadline=callback;deadlines++;return 999999;}return realTimeout(callback,ms);};
            pause=true;await sendGadget(h,'QUESTION_AT_DEADLINE');assert.equal(typeof release,'function');
            assert.equal(typeof deadline,'function','UI deadline starts before identity preparation');assert.equal(deadlines,1,'deadline is shared with the whole turn');
            deadline();assert.equal(signal.aborted,true);release();for(let i=0;i<12;i++)await tick();
            assert.equal(h.q('[data-ka-send]').disabled,false);assert.match(h.q('[data-ka-status]').textContent,/180/);
            assert.doesNotMatch(h.q('[data-ka-messages]').textContent,/LATE_ANSWER/);
            if(pending==='identity'){assert.equal(models,0);assert.equal([...values.values()].join(''),saved);}
        }finally{h.gadget.destroy();}
    });
}
