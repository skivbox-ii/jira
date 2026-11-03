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
