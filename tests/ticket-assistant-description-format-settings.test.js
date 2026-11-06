const test=require('node:test');
const assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');
const jquery=require('jquery');
const {loadUnit,memoryStorage}=require('./helpers/ticket-assistant-fixture');
function setup(t,settings) {
    const dom=new JSDOM('<div id="host"></div>',{url:'https://jira.example/'}),window=dom.window,$=jquery(window),profiles=loadUnit('profiles');
    const globals={window,document:window.document,AbortController},fields=loadUnit('fields'),icons=loadUnit('icons',{},globals),fieldUi=loadUnit('field-ui',{_ujgTA_fields:fields,_ujgTA_icons:icons},globals);
    const Settings=loadUnit('settings-ui',{_ujgTA_profiles:profiles,_ujgTA_fieldUi:fieldUi,_ujgTA_icons:icons},globals),applied=[];
    const ui=Settings.create({$,host:window.document.querySelector('#host'),onApply:async value=>{applied.push(value);return {};}});
    ui.open({settings:settings || profiles.createDefaults(),meta:{issueTypes:[]}});
    t.after(()=>{ui.destroy();window.close();});
    function click(selector){const element=window.document.querySelector(selector);assert.ok(element,selector);element.click();return new Promise(resolve=>setImmediate(resolve));}
    async function choose(id){await click('[data-ta-description-format] [data-ta-picker]');const option=[...window.document.querySelectorAll('[data-ta-description-format] [data-ta-candidate]')].find(element=>element.textContent.endsWith('('+id+')'));assert.ok(option,id);option.click();await new Promise(resolve=>setImmediate(resolve));}
    return {ui,profiles,window,$,applied,click,choose,host:window.document.querySelector('#host')};
}

test('settings uses existing picker for markdown/plain and applies only after explicit confirmation',async t=>{
    const h=setup(t),control=h.host.querySelector('[data-ta-description-format]');
    assert.ok(control);assert.match(control.textContent,/Markdown/);assert.equal(control.querySelector('select'),null);
    await h.choose('plain');assert.equal(h.applied.length,0);await h.click('[data-ta-settings-apply]');
    assert.equal(h.applied.length,1);assert.equal(h.applied[0].descriptionFormat,'plain');
    h.ui.open({settings:h.applied[0],meta:{issueTypes:[]}});assert.match(h.host.querySelector('[data-ta-description-format]').textContent,/Обычный текст/);
    await h.choose('markdown');await h.click('[data-ta-settings-cancel]');assert.equal(h.applied.length,1);
    await h.click('[data-ta-discard-settings]');h.ui.open({settings:h.applied[0],meta:{issueTypes:[]}});
    assert.match(h.host.querySelector('[data-ta-description-format]').textContent,/Обычный текст/);
});

test('format import preview and JSON export roundtrip through the existing settings controls',async t=>{
    const h=setup(t),settings=h.profiles.createDefaults();settings.descriptionFormat='plain';
    const input=h.host.querySelector('[data-ta-import-json]');input.value=h.profiles.exportSettings(settings);input.dispatchEvent(new h.window.Event('input',{bubbles:true}));
    await h.click('[data-ta-import-preview]');assert.match(h.host.querySelector('[data-ta-import-result]').textContent,/Обычный текст/);await h.click('[data-ta-import-use]');
    assert.match(h.host.querySelector('[data-ta-description-format]').textContent,/Обычный текст/);
    await h.click('[data-ta-export]');assert.equal(JSON.parse(h.host.querySelector('[data-ta-export-json]').value).descriptionFormat,'plain');
    await h.click('[data-ta-reset]');await h.click('[data-ta-reset-confirm]');assert.match(h.host.querySelector('[data-ta-description-format]').textContent,/Markdown/);
});

test('legacy stored settings migrate once without changing draft CAS or personal template text',()=>{
    const profiles=loadUnit('profiles'),drafts=loadUnit('draft'),storage=loadUnit('storage',{_ujgTA_profiles:profiles,_ujgTA_draft:drafts}),backend=memoryStorage();
    const settings=profiles.createDefaults();delete settings.descriptionFormat;settings.profiles[0].templates[0].instructions='Личная структура **Сохранить**';
    backend.setItem('ujg-ticket-assistant:v1:https%3A%2F%2Fjira.example:alice:DO',JSON.stringify({revision:7,settings,draft:null}));
    const store=storage.createStore({origin:'https://jira.example',userKey:'alice',storage:backend}),loaded=store.load('DO');
    assert.equal(loaded.settings.descriptionFormat,'markdown');assert.equal(loaded.revision,7);assert.equal(loaded.settings.profiles[0].templates[0].instructions,'Личная структура **Сохранить**');
    loaded.settings.descriptionFormat='plain';assert.equal(store.save('DO',loaded,loaded.revision).ok,true);
    assert.equal(storage.createStore({origin:'https://jira.example',userKey:'alice',storage:backend}).load('DO').settings.descriptionFormat,'plain');
});
