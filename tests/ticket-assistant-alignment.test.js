const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require('jsdom');
const jquery=require('jquery');
const {loadUnit,metadataFixture}=require('./helpers/ticket-assistant-fixture');

function setup(t,resizeObserver) {
    const dom=new JSDOM('<div id="root"></div>',{url:'https://jira.test/'}),window=dom.window,$=jquery(window);
    if(resizeObserver)window.ResizeObserver=resizeObserver;
    const globals={window,document:window.document,AbortController,URL};
    const fields=loadUnit('fields'),icons=loadUnit('icons',{},globals);
    const fieldUi=loadUnit('field-ui',{_ujgTA_fields:fields,_ujgTA_icons:icons},globals);
    const draft=loadUnit('draft').createDraft({projectKey:'DO'});
    Object.assign(draft,{source:'Full source',issueTypeId:'10',templateId:'t'});
    const state={draft,meta:metadataFixture(),settings:{activeProfileId:'p',profiles:[{id:'p',templates:[{id:'t',name:'Task',issueTypeId:'10'}]}]},
        projects:[{key:'DO',name:'Delivery'}],stage:'idle',generationFieldIds:['summary','description']};
    const calls=[],controller={getState:()=>state,assistField:(...args)=>calls.push(args)};
    const ui=loadUnit('ui',{_ujgTA_fieldUi:fieldUi,_ujgTA_icons:icons,_ujgTA_settingsUi:{}},globals).create({$,controller});
    const root=window.document.querySelector('#root');ui.mount(root);
    t.after(()=>{ui.destroy();window.close();});
    return {root,ui,state,calls,window,$};
}
test('fixed dialogs stay outside responsive container containment',t=>{
    const s=setup(t);
    assert.equal(s.root.querySelector('[data-ta-settings]').closest('.ta-layout'),null);
    assert.ok(s.root.querySelector('.ta-layout .ta-workspace'));
    assert.ok(s.root.querySelector('.ta-layout .ta-primary-actions'));
});
test('header pickers retain names and meaningful empty placeholders',t=>{
    const s=setup(t);s.state.draft.projectKey=null;s.state.draft.issueTypeId=null;s.state.draft.templateId=null;s.ui.update(s.state);
    for(const [id,name] of [['project','Проект'],['template','Шаблон'],['type','Тип Jira']]) {
        const host=s.root.querySelector('[data-ta-'+id+']');
        assert.ok(host.querySelector('label').classList.contains('ta-visually-hidden'));
        assert.match(host.querySelector('[data-ta-picker]').textContent,new RegExp(name,'i'));
        assert.equal(host.querySelector('label').htmlFor,host.querySelector('[data-ta-picker]').id);
    }
});
test('primary click generates once; context, keyboard and touch menus wait for an action',t=>{
    const s=setup(t),host=s.root.querySelector('[data-ta-field="summary"]');
    const primary=host.querySelector('[data-ta-assist-primary]'),menu=host.querySelector('[role="menu"]');
    assert.ok(primary);primary.click();assert.deepEqual(s.calls,[['summary','generate']]);
    primary.dispatchEvent(new s.window.MouseEvent('contextmenu',{bubbles:true,cancelable:true}));
    assert.equal(menu.hidden,false);assert.equal(s.calls.length,1);
    host.querySelector('[data-ta-assist="improve"]').click();
    assert.deepEqual(s.calls.at(-1),['summary','improve']);
    primary.dispatchEvent(new s.window.KeyboardEvent('keydown',{key:'F10',shiftKey:true,bubbles:true}));
    assert.equal(menu.hidden,false);assert.equal(s.calls.length,2);
    host.querySelector('[data-ta-assist="shorten"]').click();assert.deepEqual(s.calls.at(-1),['summary','shorten']);
    host.querySelector('[data-ta-assist-menu]').click();assert.equal(s.calls.length,3);
});
test('AI controls refresh accessible names after fallback metadata names change',t=>{
    const s=setup(t),field=s.state.meta.issueTypes[0].fields.find(f=>f.id==='description');
    field.name='Restored Jira description';s.ui.update(s.state);
    for(const selector of ['[data-ta-assist-primary]','[data-ta-assist-menu]']) {
        const control=s.root.querySelector('[data-ta-field="description"] '+selector);
        assert.match(control.getAttribute('aria-label'),/Restored Jira description/);
        assert.match(control.title,/Restored Jira description/);
    }
});
test('comparison values stay complete in keyboard reachable scroll areas with actions outside',t=>{
    const s=setup(t),old='current '.repeat(5000),next='proposal '.repeat(5000);
    s.state.draft.fields.description=old;s.state.draft.pendingFields.description=next;s.ui.update(s.state);
    const host=s.root.querySelector('[data-ta-field="description"]'),areas=host.querySelectorAll('[data-ta-comparison-value]');
    assert.equal(areas.length,2);assert.equal(areas[0].textContent,'Сейчас: '+old);assert.equal(areas[1].textContent,'Предложение: '+next);
    for(const area of areas) {assert.equal(area.tabIndex,0);assert.equal(area.contains(host.querySelector('[data-ta-accept]')),false);}
    assert.equal(s.state.draft.source,'Full source');
});
test('separator clamps pointer and keyboard widths and removes active drag listeners on destroy',t=>{
    const s=setup(t),workspace=s.root.querySelector('.ta-workspace'),separator=s.root.querySelector('[data-ta-divider]');
    assert.ok(separator);workspace.getBoundingClientRect=()=>({left:0,width:1000});
    const key=key=>separator.dispatchEvent(new s.window.KeyboardEvent('keydown',{key,bubbles:true,cancelable:true}));
    key('Home');assert.equal(separator.getAttribute('aria-valuenow'),'220');
    key('End');assert.equal(separator.getAttribute('aria-valuenow'),'648');
    key('ArrowLeft');assert.equal(separator.getAttribute('aria-valuenow'),'628');
    separator.dispatchEvent(new s.window.MouseEvent('pointerdown',{button:0,clientX:628,bubbles:true}));
    s.window.document.dispatchEvent(new s.window.MouseEvent('pointermove',{clientX:-100,bubbles:true}));
    assert.equal(separator.getAttribute('aria-valuenow'),'220');
    const before=workspace.style.getPropertyValue('--ta-source-width');s.ui.destroy();
    s.window.document.dispatchEvent(new s.window.MouseEvent('pointermove',{clientX:900,bubbles:true}));
    assert.equal(workspace.style.getPropertyValue('--ta-source-width'),before);
});
test('separator reclamps on container resize and ignores narrow-container drags',t=>{
    const s=setup(t),workspace=s.root.querySelector('.ta-workspace'),separator=s.root.querySelector('[data-ta-divider]');
    let width=1000;workspace.getBoundingClientRect=()=>({left:0,width});
    separator.dispatchEvent(new s.window.KeyboardEvent('keydown',{key:'End',bubbles:true}));
    width=800;s.window.dispatchEvent(new s.window.Event('resize'));
    assert.equal(separator.getAttribute('aria-valuenow'),'448');
    width=600;const before=workspace.style.getPropertyValue('--ta-source-width');
    separator.dispatchEvent(new s.window.MouseEvent('pointerdown',{button:0,bubbles:true}));
    s.window.document.dispatchEvent(new s.window.MouseEvent('pointermove',{clientX:100,bubbles:true}));
    assert.equal(workspace.style.getPropertyValue('--ta-source-width'),before);
    width=1100;s.window.dispatchEvent(new s.window.Event('resize'));
    assert.equal(separator.getAttribute('aria-valuenow'),'448');
});
test('separator observer disconnects and queued callbacks are inert after destroy',t=>{
    let callback,observed,disconnected=false;
    const s=setup(t,class {
        constructor(fn) {callback=fn;}
        observe(el) {observed=el;}
        disconnect() {disconnected=true;}
    });
    const workspace=s.root.querySelector('.ta-workspace');assert.equal(observed,workspace);
    workspace.getBoundingClientRect=()=>({left:0,width:1000});callback();
    const before=workspace.style.getPropertyValue('--ta-source-width');
    s.ui.destroy();assert.equal(disconnected,true);
    workspace.getBoundingClientRect=()=>({left:0,width:800});callback();
    assert.equal(workspace.style.getPropertyValue('--ta-source-width'),before);
});
test('offline preview generates a bounded synthetic Summary from long source and waits for Apply',async t=>{
    const dom=new JSDOM('<div id="ticket-assistant"></div>',{url:'https://jira.test/?review=guided',runScripts:'outside-only'}),window=dom.window;
    window.jQuery=jquery(window);window.AbortController=AbortController;
    const modules=new Map([['jquery',{value:window.jQuery}]]);
    window.define=(id,deps,factory)=>modules.set(id,{deps,factory});
    window.taRequire=id=>{
        const entry=modules.get(id);assert.ok(entry,'module '+id);
        if(!('value' in entry))entry.value=entry.factory(...entry.deps.map(window.taRequire));
        return entry.value;
    };
    const root=path.resolve(__dirname,'..');
    window.eval(fs.readFileSync(path.join(root,'ujg-shared-modules/llm-client.js'),'utf8'));
    for(const file of fs.readdirSync(path.join(root,'ujg-ticket-assistant-modules')).filter(file=>file.endsWith('.js')))
        window.eval(fs.readFileSync(path.join(root,'ujg-ticket-assistant-modules',file),'utf8'));
    modules.set('_ujgTA_llmClient',modules.get('_ujgShared_llmClient'));
    modules.set('_ujgTicketAssistantRuntime',modules.get('_ujgTA_main'));
    window.eval(fs.readFileSync(path.join(__dirname,'browser/ticket-assistant-preview.cjs'),'utf8'));
    t.after(()=>{window.taPreview.instance.destroy();window.close();});
    await window.taPreview.ready;
    const controller=window.taPreview.instance.controller,source='Long source fact. '.repeat(900);
    await controller.updateSource(source);
    window.document.querySelector('[data-ta-field="summary"] [data-ta-assist-primary]').click();
    for(let attempt=0;!['idle','error','stopped'].includes(controller.getState().stage) && attempt<200;attempt++)await new Promise(r=>setTimeout(r,20));
    const draft=controller.getState().draft;
    assert.equal(controller.getState().error,null);
    assert.equal(draft.fields.summary,undefined);assert.ok(draft.pendingFields.summary.length<=255);
    assert.equal(window.taPreview.calls.filter(call=>call==='ai:assist').length,1);
    const proposed=draft.pendingFields.summary;
    window.document.querySelector('[data-ta-accept="summary"]').click();
    assert.equal(controller.getState().draft.fields.summary,proposed);
    assert.equal(controller.getState().draft.source,source);
});
test('page panes and footer use normal flow; only comparison values and fullscreen root scroll',()=>{
    const css=fs.readFileSync(path.resolve(__dirname,'../ujg-ticket-assistant.css'),'utf8');
    assert.doesNotMatch(css,/\.ta-workspace\s*\{[^}]*height:\s*min\(/);
    assert.doesNotMatch(css,/\.ta-primary-actions\s*\{[^}]*position:\s*(sticky|fixed)/);
    assert.doesNotMatch(css,/\.ta-source-area[^}]*overflow-y:\s*auto/);
    assert.match(css,/\.ta-comparison-value\s*\{[^}]*max-height:[^}]*overflow-y:\s*auto/);
});
