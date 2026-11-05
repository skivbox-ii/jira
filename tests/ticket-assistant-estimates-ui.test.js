const test=require('node:test');
const assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');
const jquery=require('jquery');
const {loadUnit,metadataFixture}=require('./helpers/ticket-assistant-fixture');
const plain=value=>JSON.parse(JSON.stringify(value));
function setup(t) {
    const dom=new JSDOM('<div id="root"></div>',{url:'https://jira.test/'}),window=dom.window,$=jquery(window);
    const globals={window,document:window.document,AbortController,URL,setInterval,clearInterval};
    const fields=loadUnit('fields'),icons=loadUnit('icons',{},globals),fieldUi=loadUnit('field-ui',{_ujgTA_fields:fields,_ujgTA_icons:icons},globals);
    t.after(()=>window.close());return {window,$,globals,fields,icons,fieldUi,host:window.document.querySelector('#root')};
}
test('manual estimate editor has two accessible duration inputs, preserves both members and clears without inference',t=>{
    const h=setup(t),changes=[],view=h.fieldUi.create({$:h.$,onChange:(id,value)=>changes.push([id,plain(value)])});
    const field={id:'timetracking',name:'Оценка трудозатрат',kind:'timetracking',supported:true,writable:true,required:true};
    view.mount(h.host);t.after(()=>view.destroy());view.update({field,value:{originalEstimate:'2h',remainingEstimate:'30m'},errors:[],scopeKey:'DO:10'});
    const original=h.host.querySelector('[data-ta-estimate="originalEstimate"]'),remaining=h.host.querySelector('[data-ta-estimate="remainingEstimate"]');
    assert.ok(original);assert.ok(remaining);assert.equal(original.value,'2h');assert.equal(remaining.value,'30m');
    assert.match(h.host.querySelector('label[for="'+remaining.id+'"]').textContent,/Оставшаяся/);
    original.value='3h';original.dispatchEvent(new h.window.Event('input',{bubbles:true}));
    remaining.value='45m';remaining.dispatchEvent(new h.window.Event('input',{bubbles:true}));
    assert.deepEqual(changes.at(-1),['timetracking',{originalEstimate:'3h',remainingEstimate:'45m'}]);
    original.focus();original.setSelectionRange(1,1);view.update({field,value:{originalEstimate:'3h',remainingEstimate:'45m'},errors:['Нужна явная оценка'],scopeKey:'DO:10'});
    assert.equal(original.selectionStart,1);assert.equal(original.getAttribute('aria-invalid'),'true');assert.equal(remaining.getAttribute('aria-invalid'),'true');
    original.value='';original.dispatchEvent(new h.window.Event('input',{bubbles:true}));assert.deepEqual(changes.at(-1)[1],{remainingEstimate:'45m'});
    remaining.value='';remaining.dispatchEvent(new h.window.Event('input',{bubbles:true}));assert.equal(changes.at(-1)[1],null);
    view.update({field,value:{originalEstimate:'1d'},errors:[],scopeKey:'APP:20',disabled:true});assert.equal(original.value,'1d');assert.equal(remaining.value,'');assert.equal(original.disabled,true);assert.equal(remaining.disabled,true);
});
test('manual widget shows estimate values and guidance without generic AI generation controls or Jira fallback',t=>{
    const h=setup(t),drafts=loadUnit('draft'),profiles=loadUnit('profiles');
    const settingsUi=loadUnit('settings-ui',{_ujgTA_profiles:profiles,_ujgTA_fieldUi:h.fieldUi,_ujgTA_icons:h.icons},h.globals);
    const UI=loadUnit('ui',{_ujgTA_fieldUi:h.fieldUi,_ujgTA_icons:h.icons,_ujgTA_settingsUi:settingsUi},h.globals);
    const draft=drafts.createDraft({projectKey:'DO'});draft.issueTypeId='10';draft.templateId='task';draft.fields={summary:'Task',timetracking:{originalEstimate:'2h',remainingEstimate:'1h'}};
    const meta=metadataFixture();meta.issueTypes[0].fields.push({id:'timetracking',name:'Оценка трудозатрат',kind:'timetracking',supported:true,writable:true,required:true,allowedValues:[]});
    const state={draft,meta,settings:profiles.createDefaults(),projects:[],stage:'idle',error:null,generationFieldIds:['summary','timetracking'],routeCandidates:[],validation:null};
    const ui=UI.create({$:h.$,controller:{getState:()=>state}});ui.mount(h.host);t.after(()=>ui.destroy());ui.update(state);
    const row=h.host.querySelector('[data-ta-field="timetracking"]');assert.ok(row);assert.equal(row.querySelector('[data-ta-estimate="originalEstimate"]').value,'2h');
    assert.match(row.textContent,/только.*явн/i);assert.match(row.textContent,/окн.*выкладк/i);
    assert.equal(row.querySelector('[data-ta-assist]'),null);assert.equal(row.textContent.includes('[object Object]'),false);
});
test('chat card renders reporter and both estimate members readably, including manual proposals',t=>{
    const h=setup(t),drafts=loadUnit('draft');h.host.innerHTML='<div class="ta-layout"><header class="ta-header"><div class="ta-header-tools"></div></header></div>';
    const draft=drafts.createDraft({projectKey:'DO'});draft.issueTypeId='10';draft.templateId='task';
    draft.fields={summary:'Task',reporter:{name:'alice',displayName:'Алиса'},timetracking:{originalEstimate:'2h',remainingEstimate:'30m'}};
    draft.pendingFields={timetracking:{originalEstimate:'3h'}};
    const meta=metadataFixture();meta.issueTypes[0].fields.push({id:'reporter',name:'Автор',kind:'user',supported:true,writable:true,allowedValues:[]},
        {id:'timetracking',name:'Трудозатраты',kind:'timetracking',supported:true,writable:true,allowedValues:[]});
    const state={draft,meta,validation:null};
    const ChatUI=loadUnit('chat-ui',{_ujgTA_icons:h.icons},h.globals),chat={getState:()=>({status:'idle',transcript:[]})};
    const ui=ChatUI.create({$:h.$,controller:{getState:()=>state},chat,editor:{}});ui.mount(h.host);t.after(()=>ui.destroy());
    assert.equal(h.host.querySelector('[data-ta-card-field="reporter"] .ta-card-value').textContent,'Алиса (alice)');
    assert.equal(h.host.querySelector('[data-ta-card-field="timetracking"] .ta-card-value').textContent,'Исходная оценка: 2h · Оставшаяся оценка: 30m');
    const pending=h.host.querySelector('[data-ta-card-pending]').textContent;
    assert.match(pending,/Предложено: Исходная оценка: 3h/);assert.doesNotMatch(pending,/"originalEstimate"|\[object Object\]/);
});
