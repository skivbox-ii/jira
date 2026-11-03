const test = require('node:test');
const assert = require('node:assert/strict');
const load = require('./helpers/load-amd-module');
const path = require('node:path');
const modulePath = path.resolve(__dirname, '../ujg-knowledge-assistant-modules/storage.js');
function backend() {const data = new Map(); return {data, getItem:k=>data.get(k), setItem:(k,v)=>data.set(k,v)};}
test('isolates origin/user history and persists only settings/public transcript/historical metadata', () => {
    const mod = load(modulePath, {}), storage = backend();
    const a = mod.createStore({storage, origin:'https://jira', userKey:'alice', redact:s=>s.replaceAll('PAT_SECRET','[скрыто]')});
    a.save({settings:{bridgeBaseUrl:'http://localhost:8000',spaces:['DOC'],projects:['DO'],token:'PAT_SECRET'},
        history:[{role:'assistant',text:'Answer PAT_SECRET',toolResult:'CORPUS',sources:[{sourceId:'confluence:42',title:'Rules',url:'https://wiki/42',offset:0,end:5,text:'CORPUS',confirmed:true}]}],token:'PAT_SECRET'});
    const raw = [...storage.data.values()][0];
    assert.doesNotMatch(raw,/PAT_SECRET|CORPUS|toolResult|"token"/);
    assert.equal([...storage.data.keys()][0], 'ujg.knowledgeAssistant.v1:https://jira:alice');
    assert.equal(a.load().history[0].sources[0].historical,true);
    assert.equal(a.load().history[0].sources[0].confirmed,false);
    assert.equal(mod.createStore({storage,origin:'https://jira',userKey:'bob'}).load().history.length,0);
    assert.equal(mod.createStore({storage,origin:'https://other',userKey:'alice'}).load().history.length,0);
});
test('unavailable or corrupt storage falls back to memory with visible persistence status', () => {
    const mod = load(modulePath, {});
    const store = mod.createStore({origin:'x',userKey:'a',storage:{getItem(){throw Error('private');},setItem(){throw Error('quota');}}});
    store.save({history:[{role:'user',text:'Question'}]});
    assert.equal(store.load().history[0].text,'Question'); assert.equal(store.isPersistent(),false);
});
test('settings are discoverable by verified Jira user while history requires matching Confluence identity',()=>{
    const mod=load(modulePath,{}),storage=backend();
    const a=mod.createStore({storage,origin:'jira',userKey:'alice',historyKey:'alice/conf-a'});
    a.save({settings:{bridgeBaseUrl:'http://localhost:8000'},history:[{role:'assistant',text:'CONF_A_PRIVATE'}]});
    const settings=mod.createStore({storage,origin:'jira',userKey:'alice',settingsOnly:true}).load();
    assert.equal(settings.settings.bridgeBaseUrl,'http://localhost:8000');assert.equal(settings.history.length,0);
    assert.equal(mod.createStore({storage,origin:'jira',userKey:'alice',historyKey:'alice/conf-b'}).load().history.length,0);
    assert.equal(a.load().history[0].text,'CONF_A_PRIVATE');
});
test('save reload preserves every sanitized UI message beyond 100 and retains full memory on quota failure',()=>{
    const mod=load(modulePath,{}),storage=backend();
    const messages=Array.from({length:240},(_,i)=>({role:i%2?'assistant':'user',text:'Message '+i,toolResult:'PRIVATE_CORPUS',sources:[{sourceId:'confluence:42',text:'PRIVATE_CORPUS',confirmed:true}]}));
    const store=mod.createStore({storage,origin:'jira',userKey:'alice'});store.save({history:messages});
    const restored=mod.createStore({storage,origin:'jira',userKey:'alice'}).load();
    assert.equal(restored.history.length,240);assert.equal(restored.history[0].text,'Message 0');assert.equal(restored.history[239].text,'Message 239');
    assert.doesNotMatch([...storage.data.values()].join(''),/PRIVATE_CORPUS|toolResult/);assert.equal(restored.history[0].sources[0].historical,true);
    storage.setItem=()=>{throw Error('quota');};store.save({history:messages.concat({role:'user',text:'Latest'})});
    assert.equal(store.isPersistent(),false);assert.equal(store.load().history.length,241);assert.equal(store.load().history[0].text,'Message 0');assert.equal(store.load().history.at(-1).text,'Latest');
});
test('saving B preserves A and Jira-only settings discovery never exposes either transcript',()=>{
    const mod=load(modulePath,{}),storage=backend(),opts={storage,origin:'jira',userKey:'alice'};
    const a=mod.createStore({...opts,historyKey:'verified-A'});a.save({settings:{spaces:['A']},history:[{role:'assistant',text:'A_PRIVATE'}]});
    const b=mod.createStore({...opts,historyKey:'verified-B'});assert.equal(b.load().history.length,0);
    b.save({settings:{spaces:['B']},history:[]});assert.equal(a.load().history[0].text,'A_PRIVATE');
    b.save({settings:{spaces:['B']},history:[{role:'assistant',text:'B_PRIVATE'}]});
    a.save({settings:{spaces:['A']},history:a.load().history});assert.equal(b.load().history[0].text,'B_PRIVATE');
    const settings=mod.createStore({...opts,settingsOnly:true}).load();assert.equal(settings.history.length,0);assert.equal(JSON.stringify(settings).includes('PRIVATE'),false);assert.equal(settings.settings.spaces[0],'A');
});
test('legacy bound transcript migrates under its original identity when another identity saves first',()=>{
    const mod=load(modulePath,{}),storage=backend(),opts={storage,origin:'jira',userKey:'alice'};
    storage.setItem('ujg.knowledgeAssistant.v1:jira:alice',JSON.stringify({settings:{spaces:['DOC']},historyIdentity:'verified-A',history:[{role:'assistant',text:'LEGACY_A',toolResult:'PRIVATE_CORPUS'}]}));
    const b=mod.createStore({...opts,historyKey:'verified-B'});assert.equal(b.load().history.length,0);b.save({settings:{spaces:['NEW']},history:[{role:'user',text:'B_ONLY'}]});
    assert.equal(mod.createStore({...opts,historyKey:'verified-A'}).load().history[0].text,'LEGACY_A');
    assert.equal(b.load().history[0].text,'B_ONLY');assert.doesNotMatch([...storage.data.values()].join(''),/PRIVATE_CORPUS/);
    const settings=mod.createStore({...opts,settingsOnly:true});settings.save({settings:{spaces:['SAVED']}});
    assert.equal(b.load().history[0].text,'B_ONLY');assert.equal(settings.load().history.length,0);
});

test('retained per-identity stores keep newer quota history above a stale snapshot without retaining corpus',()=>{
    const mod=load(modulePath,{}),storage=backend(),opts={storage,origin:'jira',userKey:'alice',redact:s=>s.replaceAll('SYNTHETIC_PAT','[скрыто]')};
    const a=mod.createStore({...opts,historyKey:'verified-A'});
    a.save({history:[{role:'user',text:'Old A'}]});const stale=[...storage.data.values()][0];
    storage.setItem=()=>{throw Error('quota');};
    a.save({history:[{role:'user',text:'Old A'},{role:'assistant',text:'Latest A SYNTHETIC_PAT',toolResult:'RAW_CORPUS',sources:[{sourceId:'jira:DO-1',text:'RAW_CORPUS',confirmed:true}]}]});
    const b=mod.createStore({...opts,historyKey:'verified-B'});assert.equal(b.load().history.length,0);
    b.save({history:[{role:'assistant',text:'B only'}]});
    assert.equal(a.load().history.at(-1).text,'Latest A [скрыто]');assert.equal(b.load().history[0].text,'B only');
    assert.equal([...storage.data.values()][0],stale);
    assert.doesNotMatch(JSON.stringify(a.load()),/RAW_CORPUS|toolResult|SYNTHETIC_PAT|B only/);
    assert.equal(a.load().history.at(-1).sources[0].historical,true);
    assert.equal(a.isPersistent(),false);assert.equal(b.isPersistent(),false);
});
