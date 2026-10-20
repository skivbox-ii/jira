const test=require('node:test');
const assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');
const jquery=require('jquery');
const {loadUnit}=require('./helpers/ticket-assistant-fixture');
const tick=()=>new Promise(r=>setTimeout(r,280));
function setup(t,kind,onSearch,value=null) {
    const dom=new JSDOM('<div id="host"></div>',{url:'https://jira.test/'}),window=dom.window,$=jquery(window);
    const globals={window,document:window.document,AbortController,URL};
    const fields=loadUnit('fields'),icons=loadUnit('icons',{},globals);
    const module=loadUnit('field-ui',{_ujgTA_fields:fields,_ujgTA_icons:icons},globals);
    const field={id:'customfield_999',name:'Field',kind,supported:true,writable:true,allowedValues:[],optionsComplete:false};
    const changes=[],view=module.create({$,onSearch,onChange:(id,v)=>changes.push([id,v])}),host=window.document.querySelector('#host');
    view.mount(host);view.update({field,value,errors:[],scopeKey:'DO:10'});
    t.after(()=>{view.destroy();dom.window.close();});return {host,view,field,changes,window};
}
test('Epic selector searches remotely, pins selected key and writes canonical key',async t=>{
    const s=setup(t,'epic',async()=>({values:[{id:'DO-42',label:'Selected'},{id:'DO-43',label:'Next'}],complete:false}),'DO-42');
    s.host.querySelector('[data-ta-picker]').click();await tick();
    assert.equal(s.host.querySelectorAll('[data-ta-chip]').length,1);
    assert.equal(s.host.querySelectorAll('[data-ta-candidate]').length,1);
    s.host.querySelector('[data-ta-candidate]').click();assert.equal(s.changes[0][1],'DO-43');
});
test('Sprint selector requires board choice, filters choices and emits numeric ID',async t=>{
    const requests=[];
    const s=setup(t,'sprint',async(q,f,o)=>{requests.push(o);return o.boardId?{values:[{id:'73',label:'Sprint'}],complete:true,boardId:'12',boards:[{id:'12',label:'A'}]}:
        {values:[],complete:false,needsBoard:true,boards:[{id:'12',label:'A'},{id:'13',label:'B'}]};});
    s.host.querySelector('[data-ta-picker]').click();await tick();
    assert.equal(s.host.querySelectorAll('[data-ta-board]').length,2);
    assert.equal(s.host.querySelectorAll('[data-ta-candidate]').length,0);
    s.host.querySelector('[data-ta-board="12"]').click();await tick();
    assert.equal(requests.at(-1).boardId,'12');s.host.querySelector('[data-ta-candidate]').click();
    assert.equal(s.changes[0][1],73);
});
test('relation scope change cancels search and prevents late candidates from crossing projects',async t=>{
    let finish,signal;const s=setup(t,'epic',(q,f,o)=>{signal=o.signal;return new Promise(r=>{finish=r;});});
    s.host.querySelector('[data-ta-picker]').click();await tick();
    s.host.querySelector('[data-ta-search]').value='old project query';
    s.view.update({field:s.field,value:null,errors:[],scopeKey:'APP:10'});assert.equal(signal.aborted,true);
    assert.equal(s.host.querySelector('[data-ta-search]').value,'');
    finish({values:[{id:'DO-42',label:'Late'}],complete:false});await tick();
    assert.equal(s.host.querySelectorAll('[data-ta-candidate]').length,0);
});
test('closing a relation picker aborts pending search and suppresses its late options',async t=>{
    let finish,signal;const s=setup(t,'epic',(q,f,o)=>{signal=o.signal;return new Promise(r=>{finish=r;});});
    const toggle=s.host.querySelector('[data-ta-picker]');toggle.click();await tick();toggle.click();
    assert.equal(signal.aborted,true);finish({values:[{id:'DO-42'}],complete:false});await tick();
    assert.equal(s.host.querySelectorAll('[data-ta-candidate]').length,0);
});
test('manual numeric control emits numbers including zero and decimals',t=>{
    const s=setup(t,'number',null),input=s.host.querySelector('input');
    for(const [text,value] of [['0',0],['0.5',0.5],['',null]]) {input.value=text;input.dispatchEvent(new s.window.Event('input'));assert.equal(s.changes.at(-1)[1],value);}
});
test('main routes relation search options to controller and keeps user lookup on the Jira adapter',async t=>{
    const dom=new JSDOM('<div id="root"></div>',{url:'https://jira.test/'}),window=dom.window,$=jquery(window);
    let uiOptions;const calls=[];
    const main=loadUnit('main',{jquery:$,_ujgShared_llmClient:{},_ujgTA_api:{createApi:()=>({})},_ujgTA_ai:{},_ujgTA_storage:{},
        _ujgTA_controller:{create:()=>({init:async()=>({}),destroy(){},searchRelation:async(...args)=>{calls.push(['relation',...args]);return {values:[]};}})},
        _ujgTA_ui:{create:opts=>{uiOptions=opts;return {mount(){},destroy(){}};}}},{window,document:window.document,AbortController});
    const gadget=new main({getGadgetContentEl:()=>window.document.querySelector('#root')},{ai:{},api:{searchUsers:async q=>{calls.push(['user',q]);return {values:[]};}},storage:null});
    t.after(()=>{gadget.destroy();dom.window.close();});await gadget.ready;
    const options={boardId:'12',signal:new AbortController().signal};await uiOptions.onSearch('S',{id:'s',kind:'sprint'},options);
    assert.equal(calls[0][0],'relation');assert.equal(calls[0][3],options);
    await uiOptions.onSearch('Alice',{kind:'user'},{});assert.equal(calls[1][0],'user');
});
test('relation queries debounce rapid typing and dispatch only the latest term',async t=>{
    const terms=[],s=setup(t,'epic',async q=>{terms.push(q);return {values:[],complete:false};});
    s.host.querySelector('[data-ta-picker]').click();await new Promise(r=>setTimeout(r,40));
    assert.equal(terms.length,0);
    const search=s.host.querySelector('[data-ta-search]');
    for(const text of ['a','ab','abc']) {search.value=text;search.dispatchEvent(new s.window.Event('input'));}
    await tick();assert.deepEqual(terms,['abc']);
    assert.ok(s.host.querySelector('[data-ta-partial]'));
});
for(const kind of ['epic','sprint']) test(kind+' search preserves pending/error on same-scope updates without reviving previous candidates',async t=>{
    const pending=[],selected=kind==='epic'?'DO-41':71;
    const s=setup(t,kind,()=>new Promise((resolve,reject)=>pending.push({resolve,reject})),selected);
    const props={field:s.field,value:selected,errors:[],scopeKey:'DO:10'};
    const count=()=>s.host.querySelectorAll('[data-ta-candidate]').length;
    const choices=()=>s.host.querySelector('.ta-candidates').textContent;
    s.host.querySelector('[data-ta-picker]').click();await tick();
    pending[0].resolve({values:[{id:kind==='epic'?'DO-42':'72',label:'Old query'}],complete:false});
    await new Promise(r=>setImmediate(r));assert.equal(count(),1);
    const search=s.host.querySelector('[data-ta-search]');
    search.value='new query';search.dispatchEvent(new s.window.Event('input'));
    s.view.update(props);assert.equal(count(),0);assert.match(choices(),/Поиск/);
    assert.equal(s.host.querySelectorAll('[data-ta-partial]').length,0);
    assert.equal(s.host.querySelectorAll('[data-ta-chip]').length,1);
    await tick();s.view.update(props);assert.equal(count(),0);assert.match(choices(),/Поиск/);
    pending[1].reject({kind:'forbidden'});await new Promise(r=>setImmediate(r));
    s.view.update(props);assert.equal(count(),0);assert.match(choices(),/Нет доступа/);
    assert.ok(s.host.querySelector('.ta-candidates .ta-errors'));
    search.value='retry';search.dispatchEvent(new s.window.Event('input'));
    s.view.update(props);assert.match(choices(),/Поиск/);assert.equal(count(),0);
    await tick();pending[2].resolve({values:[{id:kind==='epic'?'DO-43':'73',label:'Retry result'}],complete:false});
    await new Promise(r=>setImmediate(r));s.view.update(props);
    assert.equal(count(),1);assert.match(choices(),/Retry result/);assert.doesNotMatch(choices(),/Old query|Нет доступа/);
});
