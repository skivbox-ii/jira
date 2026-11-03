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
    assert.equal(h.q('[data-ka-send]').disabled,false);assert.equal(urls.length,2);
    for(let turn=0;turn<2;turn++){h.q('[data-ka-prompt]').value='Rules?';h.q('[data-ka-composer]').dispatchEvent(new h.dom.window.Event('submit',{cancelable:true}));for(let i=0;i<12;i++)await tick();}
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
