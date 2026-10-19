const test = require('node:test');
const assert = require('node:assert/strict');
const {JSDOM} = require('jsdom');
const jquery = require('jquery');
const {loadUnit, metadataFixture} = require('../helpers/ticket-assistant-fixture');

function setup() {
    const dom = new JSDOM('<div class="ujg-ticket-assistant" id="root"></div>', {url: 'http://localhost/jira'});
    const {window} = dom, $ = jquery(window);
    const globals = {window, document: window.document, navigator: window.navigator, URL,
        setInterval, clearInterval, AbortController};
    const icons = loadUnit('icons', {}, globals);
    const fieldUi = loadUnit('field-ui', {'_ujgTA_icons': icons}, globals);
    const uiModule = loadUnit('ui', {'_ujgTA_fieldUi': fieldUi, '_ujgTA_icons': icons}, globals);
    const drafts = loadUnit('draft');
    const draft = drafts.setSelection(drafts.createDraft({projectKey: 'DO'}), {issueTypeId: '10', templateId: 'task'});
    draft.source = 'Source text <img src=x onerror=alert(1)>';
    draft.fields = {summary: 'Manual title', description: 'Current description'};
    draft.protectedFields = {summary: true}; draft.pendingFields = {summary: 'Proposed title'};
    draft.questions = [{id: 'q1', text: 'Which release?', reason: 'Missing version', required: true}];
    const meta = metadataFixture();
    let state = {draft, meta, settings: loadUnit('profiles').createDefaults(), projects: [{id: 'DO-project', key: 'DO', name: 'Delivery'}],
        stage: 'idle', startedAt: null, error: null, validation: {ok: false, fieldErrors: {summary: ['Required']}, unsupportedRequired: []},
        generationFieldIds: ['summary', 'description'], contextScope: {excludedFieldIds: ['customfield_2']}, routeCandidates: []};
    const calls = [];
    const controller = {getState: () => state};
    for (const name of ['updateSource','updateField','prepare','check','cancel','answer','acceptField','setGenerationFields','selectProject','selectTemplate','selectIssueType']) {
        controller[name] = (...args) => { calls.push([name, ...args]); return Promise.resolve(state); };
    }
    const root = window.document.querySelector('#root');
    const ui = uiModule.create({$, controller, baseUrl: '/jira'});
    ui.mount(root); ui.update(state);
    return {dom, $, window, root, ui, uiModule, fieldUi, calls, state, setState(next) { state = next; ui.update(next); }};
}

test('sequential labels retain delimiters and caret through normalized echoes, while external values replace the buffer', t => {
    const s = setup(); t.after(() => {s.ui.destroy(); s.dom.window.close();});
    const host = s.window.document.createElement('div'); s.root.append(host);
    const field = {id:'labels',name:'Labels',kind:'labels',supported:true,writable:true,allowedValues:[]};
    let value = [], view;
    view = s.fieldUi.create({$:s.$,onChange:(id,next) => {value=next; view.update({field,value,errors:[]});}});
    view.mount(host); view.update({field,value,errors:[]}); const input=host.querySelector('input'); input.focus();
    for (const char of 'alpha,beta') {
        input.setRangeText(char,input.selectionStart,input.selectionEnd,'end'); input.dispatchEvent(new s.window.Event('input',{bubbles:true}));
    }
    assert.equal(input.value,'alpha,beta'); assert.deepEqual([...value],['alpha','beta']);
    input.value='alpha,  beta,'; input.setSelectionRange(7,7); input.dispatchEvent(new s.window.Event('input',{bubbles:true}));
    assert.equal(input.value,'alpha,  beta,'); assert.equal(input.selectionStart,7); assert.equal(input.selectionEnd,7);
    view.update({field,value:[...value],errors:['Visible error']});
    assert.equal(input.value,'alpha,  beta,'); assert.equal(input.selectionStart,7);
    view.update({field,value:['external','replacement'],errors:[]}); assert.equal(input.value,'external, replacement');
    view.destroy();
});

test('number editing preserves decimal representation on equivalent echoes and accepts external values', t => {
    const s = setup(); t.after(() => {s.ui.destroy(); s.dom.window.close();});
    const host=s.window.document.createElement('div'); s.root.append(host);
    const field={id:'effort',name:'Effort',kind:'number',supported:true,writable:true,allowedValues:[]}; let value=null, view;
    view=s.fieldUi.create({$:s.$,onChange:(id,next) => {value=next; view.update({field,value,errors:[]});}});
    view.mount(host); view.update({field,value,errors:[]}); const input=host.querySelector('input'); input.focus();
    for (const text of ['1','1.0','1.02']) {input.value=text; input.dispatchEvent(new s.window.Event('input',{bubbles:true})); assert.equal(input.value,text);}
    assert.equal(value,1.02); view.update({field,value:42,errors:[]}); assert.equal(input.value,'42');
    input.value='-0.50'; input.dispatchEvent(new s.window.Event('input',{bubbles:true})); assert.equal(input.value,'-0.50'); assert.equal(value,-0.5);
    view.update({field,value:null,errors:[]}); assert.equal(input.value,''); view.destroy();
});

test('real controller retries failed project metadata with empty source, second read succeeds without AI', async t => {
    const s=setup(); s.ui.destroy(); const drafts=loadUnit('draft'), profiles=loadUnit('profiles'), fields=loadUnit('fields');
    const validation=loadUnit('validation',{'_ujgTA_fields':fields});
    const controllerModule=loadUnit('controller',{'_ujgTA_draft':drafts,'_ujgTA_profiles':profiles,'_ujgTA_fields':fields,'_ujgTA_validation':validation},{AbortController});
    const storage=loadUnit('storage',{'_ujgTA_profiles':profiles,'_ujgTA_draft':drafts});
    let reads=0, aiCalls=0, ui;
    const c=controllerModule.create({api:{getCurrentUser:async()=>({key:'offline-test'}),getProjects:async()=>({values:[{id:'1',key:'DO',name:'Delivery'}]}),
        getCreateMeta:async()=>{reads++; if(reads===1) throw {kind:'network'}; return {projects:[{id:'1',key:'DO',issuetypes:[{id:'10',name:'Task',subtask:false,fields:{summary:{name:'Summary',required:true,schema:{type:'string',system:'summary'}}}}]}]};},
        getComponents:async()=>({values:[],complete:true,projectKey:'DO'}),getVersions:async()=>({values:[],complete:true,projectKey:'DO'})},
        ai:{route:async()=>{aiCalls++;},prepare:async()=>{aiCalls++;},check:async()=>{aiCalls++;}},
        createStore:key=>storage.createStore({userKey:key,origin:'http://localhost',storage:null}),onChange:state=>{if(ui)ui.update(state);}});
    ui=s.uiModule.create({$:s.$,controller:c}); ui.mount(s.root); t.after(()=>{ui.destroy();c.destroy();s.dom.window.close();}); await c.init();
    s.root.querySelector('[data-ta-project] [data-ta-picker]').click(); s.root.querySelector('[data-ta-project] [data-ta-candidate]').click();
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(reads,1); assert.equal(c.getState().stage,'error'); assert.equal(c.getState().draft.source,'');
    assert.equal(s.root.querySelector('[data-ta-retry-host]').hidden,false);
    s.root.querySelector('[data-ta-retry]').click(); await new Promise(resolve=>setImmediate(resolve));
    assert.equal(reads,2); assert.equal(c.getState().stage,'idle'); assert.equal(c.getState().meta.projectKey,'DO');
    assert.equal(c.getState().draft.source,''); assert.equal(aiCalls,0); assert.equal(s.root.querySelector('[data-ta-error]').hidden,true);
});

test('metadata fields, source, questions, current values and protected proposals render as text', t => {
    const s = setup(); t.after(() => {s.ui.destroy(); s.dom.window.close();});
    assert.equal(s.root.querySelector('[data-ta-source]').value, s.state.draft.source);
    const input = s.root.querySelector('[data-ta-field="summary"] input');
    assert.equal(input.value, 'Manual title');
    assert.match(s.root.textContent, /Proposed title/);
    assert.match(s.root.textContent, /Which release/);
    assert.equal(s.root.querySelectorAll('img[src="x"], select').length, 0);
    const errors = s.root.querySelector('[data-ta-field="summary"] [data-ta-errors]');
    assert.match(errors.textContent, /Required/);
    assert.equal(input.getAttribute('aria-describedby'), errors.id);
    assert.equal(input.getAttribute('aria-invalid'), 'true');
    s.root.querySelector('[data-ta-accept="summary"]').click();
    assert.deepEqual(s.calls.pop(), ['acceptField', 'summary']);
    assert.equal(s.root.querySelector('[data-ta-create]').disabled, true);
});

test('summary and description lead draft without changing metadata order or signature', t => {
    const s = setup(); t.after(() => {s.ui.destroy(); s.dom.window.close();});
    const before = JSON.stringify(s.state.meta), original = s.state.meta.issueTypes[0].fields.map(field => field.id);
    s.ui.update(s.state);
    const ids = [...s.root.querySelectorAll('[data-ta-field]')].map(el => el.getAttribute('data-ta-field'));
    assert.deepEqual(ids,['summary','description',...original.filter(id => id !== 'summary' && id !== 'description' && id !== 'project' && id !== 'issuetype')]);
    assert.equal(JSON.stringify(s.state.meta),before);
});

test('identity reset clears prior generation controls and omissions along with draft values', t => {
    const s = setup(); t.after(() => {s.ui.destroy(); s.dom.window.close();});
    s.setState({...s.state,draft:null,meta:null,settings:null,projects:[],generationFieldIds:[],contextScope:null,validation:null});
    assert.equal(s.root.querySelectorAll('[data-ta-generation]').length,0);
    assert.equal(s.root.querySelector('[data-ta-omitted]').textContent,'');
    assert.doesNotMatch(s.root.textContent,/Manual title|Proposed title|Which release/);
});

test('progress preserves input identity, caret and field nodes; success hides timer', t => {
    const s = setup(); t.after(() => {s.ui.destroy(); s.dom.window.close();});
    const input = s.root.querySelector('[data-ta-source]');
    const field = s.root.querySelector('[data-ta-field="summary"] input');
    input.focus(); input.setSelectionRange(2, 5);
    s.setState({...s.state, stage: 'preparing', startedAt: Date.now()});
    assert.equal(s.root.querySelector('[data-ta-source]'), input);
    assert.equal(s.window.document.activeElement, input);
    assert.equal(input.selectionStart, 2); assert.equal(input.selectionEnd, 5);
    assert.equal(s.root.querySelector('[data-ta-field="summary"] input'), field);
    assert.equal(s.root.querySelector('[data-ta-progress]').hidden, false);
    assert.equal(s.root.querySelector('[data-ta-elapsed]').getAttribute('aria-live'), 'off');
    s.setState({...s.state, stage: 'idle', startedAt: null});
    assert.equal(s.root.querySelector('[data-ta-progress]').hidden, true);
});

test('scope is explicit, omissions visible, safe numeric limits and persistent retry', t => {
    const s = setup(); t.after(() => {s.ui.destroy(); s.dom.window.close();});
    assert.match(s.root.querySelector('[data-ta-omitted]').textContent, /customfield_2/);
    const scope = s.root.querySelector('[data-ta-generation="summary"]');
    assert.equal(scope.checked, true); scope.click();
    assert.equal(s.calls.at(-1)[0], 'setGenerationFields');
    assert.ok(!s.calls.at(-1)[1].includes('summary'));
    s.setState({...s.state, stage: 'error', error: {code: 'limit', message: 'Too large', details: {systemBytes: 6001, systemLimit: 6000, userBytes: 43000, userLimit: 42000, raw: '<secret>'}}});
    assert.match(s.root.querySelector('[data-ta-error]').textContent, /6001.*6000/);
    assert.match(s.root.querySelector('[data-ta-error]').textContent, /43000.*42000/);
    assert.doesNotMatch(s.root.textContent, /secret/);
    s.root.querySelector('[data-ta-retry]').click(); assert.equal(s.calls.at(-1)[0], 'prepare');
});

test('required unsupported fallback preserves draft, links ordinary form, only explicitly copies', t => {
    const s = setup(); t.after(() => {s.ui.destroy(); s.dom.window.close();});
    s.state.meta.issueTypes[0].fields.push({id: 'customfield_99', name: 'Approval', supported: false, writable: false, required: true, kind: 'unknown', allowedValues: []});
    s.setState({...s.state, validation: {ok:false, fieldErrors: {customfield_99: ['Unsupported required Approval']}, unsupportedRequired:['customfield_99']}});
    const link = s.root.querySelector('[data-ta-jira-form]');
    assert.equal(link.getAttribute('href'), '/jira/secure/CreateIssue!default.jspa?pid=DO-project&issuetype=10');
    assert.match(s.root.querySelector('[data-ta-fallback]').textContent, /Approval/);
    assert.equal(s.calls.length, 0);
    s.root.querySelector('[data-ta-copy="summary"]').click();
    assert.equal(s.root.querySelector('[data-ta-copy-text]').value, 'Manual title');
    assert.equal(s.root.querySelector('[data-ta-source]').value, s.state.draft.source);
    assert.equal(s.calls.length, 0);
});

test('type picker renders only current-origin HTTP icons and escapes option labels', t => {
    const s = setup(); t.after(() => {s.ui.destroy(); s.dom.window.close();});
    const host = s.window.document.createElement('div'); s.root.append(host);
    const view = s.fieldUi.create({$:s.$,onChange:() => {}}); view.mount(host);
    view.update({field:{id:'type',name:'Type',kind:'option',supported:true,writable:true,allowedValues:[
        {id:'1',label:'<img src=x>',iconUrl:'https://external.invalid/image.png'},
        {id:'2',label:'Local type',iconUrl:'/images/type.png'},
        {id:'3',label:'Data icon',iconUrl:'data:image/png;base64,AA=='},
        {id:'4',label:'Script icon',iconUrl:'javascript:alert(1)'}]},value:null,errors:[]});
    host.querySelector('[data-ta-picker]').click();
    const images = [...host.querySelectorAll('img')]; assert.equal(images.length,1); assert.equal(images[0].src,'http://localhost/images/type.png');
    assert.match(host.textContent,/<img src=x>/); view.destroy();
});

test('retry keeps explicit check action and answers append only on explicit action', t => {
    const s = setup(); t.after(() => {s.ui.destroy(); s.dom.window.close();});
    s.root.querySelector('[data-ta-check]').click(); s.calls.length=0;
    s.setState({...s.state,stage:'error',error:{code:'transport',message:'Check failed'}});
    s.root.querySelector('[data-ta-retry]').click(); assert.deepEqual(s.calls.pop(),['check']);
    const answer = s.root.querySelector('[data-ta-question="q1"] textarea'); answer.value='Next release'; answer.dispatchEvent(new s.window.Event('input'));
    assert.equal(s.calls.length,0); s.root.querySelector('[data-ta-question="q1"] button').click();
    assert.equal(s.calls[0][0],'answer'); assert.equal(s.calls[0][1].q1,'Next release');
});

test('search picker pins removable user chips, excludes duplicates, supports Escape and ignores late search', async t => {
    const s = setup(); t.after(() => {s.ui.destroy(); s.dom.window.close();});
    let finish; const changes = [];
    const picker = s.fieldUi.create({$: s.$, onChange: (...args) => changes.push(args), onSearch: () => new Promise(resolve => {finish = resolve;})});
    const host = s.window.document.createElement('div'); s.root.append(host); picker.mount(host);
    picker.update({field: {id:'reviewers', name:'Reviewers', kind:'user', multiple:true, supported:true, writable:true, allowedValues:[]},
        value: [{name:'anna'}], selectedUsers:[{name:'anna', displayName:'Anna'}], errors: []});
    host.querySelector('[data-ta-picker]').click();
    const search = host.querySelector('[data-ta-search]'); search.value = 'a'; search.dispatchEvent(new s.window.Event('input'));
    await new Promise(resolve => setImmediate(resolve));
    finish({values:[{name:'anna', displayName:'Anna'}, {name:'alex', displayName:'Alex'}]}); await new Promise(resolve => setImmediate(resolve));
    assert.equal(host.querySelectorAll('[data-ta-chip]').length, 1);
    assert.equal(host.querySelectorAll('[data-ta-candidate]').length, 1);
    assert.match(host.querySelector('[data-ta-candidate]').textContent, /Alex/);
    search.dispatchEvent(new s.window.KeyboardEvent('keydown', {key:'Escape', bubbles:true}));
    assert.equal(host.querySelector('[data-ta-popover]').hidden, true);
    host.querySelector('[data-ta-remove]').click(); assert.equal(changes.at(-1)[1].length, 0);
    picker.destroy();
});

test('destroy before deferred user search dispatch starts no read; stale search cannot replace current results', async t => {
    const s = setup(); t.after(() => {s.ui.destroy(); s.dom.window.close();});
    const field = {id:'reporter',name:'Reporter',kind:'user',supported:true,writable:true,allowedValues:[]};
    const host = s.window.document.createElement('div'); s.root.append(host); const pending = [];
    const picker = s.fieldUi.create({$:s.$,onChange:() => {},onSearch:(query, spec, options) => new Promise(resolve => pending.push({query,resolve,signal:options.signal}))});
    picker.mount(host); picker.update({field,value:null,errors:[]}); host.querySelector('[data-ta-picker]').click(); picker.destroy();
    await new Promise(resolve => setImmediate(resolve)); assert.equal(pending.length,0);
    const second = s.fieldUi.create({$:s.$,onChange:() => {},onSearch:(query, spec, options) => new Promise(resolve => pending.push({query,resolve,signal:options.signal}))});
    second.mount(host); second.update({field,value:null,errors:[]}); host.querySelector('[data-ta-picker]').click();
    await new Promise(resolve => setImmediate(resolve));
    const search = host.querySelector('[data-ta-search]'); search.value='new'; search.dispatchEvent(new s.window.Event('input'));
    await new Promise(resolve => setImmediate(resolve)); assert.equal(pending[0].signal.aborted,true);
    pending[1].resolve({values:[{name:'new',displayName:'Current user'}]}); await new Promise(resolve => setImmediate(resolve));
    pending[0].resolve({values:[{name:'old',displayName:'Stale user'}]}); await new Promise(resolve => setImmediate(resolve));
    assert.match(host.textContent,/Current user/); assert.doesNotMatch(host.textContent,/Stale user/); second.destroy();
});

test('actual multiselect selection preserves search focus, Escape closes even from body, outside action closes and destroy cleans listeners', t => {
    const s = setup(); t.after(() => {s.ui.destroy(); s.dom.window.close();});
    const host = s.window.document.createElement('div'); s.root.append(host); const doc = s.window.document;
    const added = [], removed = [], add = doc.addEventListener.bind(doc), remove = doc.removeEventListener.bind(doc);
    doc.addEventListener = (type, handler, options) => {added.push({type,handler}); add(type,handler,options);};
    doc.removeEventListener = (type, handler, options) => {removed.push({type,handler}); remove(type,handler,options);};
    const view = s.fieldUi.create({$:s.$,onChange:() => {}}); view.mount(host);
    view.update({field:{id:'components',name:'Компоненты',kind:'components',supported:true,writable:true,
        allowedValues:[{id:'31',label:'API'},{id:'32',label:'UI'}]},value:[],errors:[]});
    const toggle = host.querySelector('[data-ta-picker]'), panel = host.querySelector('[data-ta-popover]');
    toggle.click(); host.querySelector('[data-ta-candidate]').click();
    assert.equal(doc.activeElement,host.querySelector('[data-ta-search]'));
    assert.equal(host.querySelectorAll('[data-ta-chip]').length,1);
    assert.equal(host.querySelectorAll('[data-ta-candidate]').length,1);
    doc.activeElement.blur(); doc.body.dispatchEvent(new s.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
    assert.equal(panel.hidden,true); assert.equal(toggle.getAttribute('aria-expanded'),'false'); assert.equal(doc.activeElement,toggle);
    toggle.click(); host.querySelector('[data-ta-candidate]').click();
    s.root.querySelector('[data-ta-check]').click();
    assert.equal(panel.hidden,true); assert.equal(toggle.getAttribute('aria-expanded'),'false');
    toggle.click(); s.root.querySelector('[data-ta-source]').dispatchEvent(new s.window.Event('pointerdown',{bubbles:true}));
    assert.equal(panel.hidden,true);
    view.destroy();
    for (const event of added.filter(event => ['pointerdown','click','keydown'].includes(event.type)))
        assert.ok(removed.some(item => item.type === event.type && item.handler === event.handler),'removed '+event.type);
});

test('unsupported/read-only current values and orphaned draft fields stay visible', t => {
    const s = setup(); t.after(() => {s.ui.destroy(); s.dom.window.close();});
    s.state.meta.issueTypes[0].fields.find(field => field.id === 'summary').writable = false;
    s.state.draft.fields.removed_field = 'Retained old value'; s.setState(s.state);
    assert.match(s.root.querySelector('[data-ta-field="summary"]').textContent,/Manual title/);
    assert.match(s.root.textContent,/Retained old value/);
    assert.equal(s.root.querySelector('[data-ta-field]')?.getAttribute('data-ta-field'),'summary');
});

test('main composes real controller, reinitializes identity, replaces prior instance and cancels reads on teardown', async () => {
    const fs = require('node:fs'), path = require('node:path');
    const dom = new JSDOM('<div id="root"></div>',{url:'http://localhost/jira',runScripts:'outside-only'});
    const $ = jquery(dom.window), registry = new Map([['jquery',{value:$}]]);
    dom.window.define = (name,deps,factory) => registry.set(name,{deps,factory});
    dom.window.eval(fs.readFileSync(path.resolve(__dirname,'../../ujg-ticket-assistant.runtime.js'),'utf8'));
    function resolve(name) {const item=registry.get(name); if (!('value' in item)) item.value=item.factory(...item.deps.map(resolve)); return item.value;}
    const Gadget = resolve('_ujgTicketAssistantRuntime'), identities = []; let user = 'first', searchSignal;
    const api = {getCurrentUser:async () => ({key:user}),getProjects:async () => ({values:[{id:'1',key:'DO',name:'Delivery'}]}),
        getCreateMeta:async () => ({projects:[{key:'DO',id:'1',issuetypes:[{id:'10',name:'Task',subtask:false,fields:{summary:{name:'Summary',required:true,schema:{type:'string',system:'summary'}},reporter:{name:'Reporter',schema:{type:'user',system:'reporter'}}}}]}]}),
        getComponents:async () => ({values:[],complete:true,projectKey:'DO'}),getVersions:async () => ({values:[],complete:true,projectKey:'DO'}),
        searchUsers:(query,options) => {searchSignal=options.signal; return new Promise(() => {});}};
    const deps = {api,ai:{},baseUrl:'/jira',createStore:key => {identities.push(key); return resolve('_ujgTA_storage').createStore({userKey:key,origin:dom.window.location.origin,storage:null});}};
    const API = {getGadgetContentEl:() => $('#root')}; const first = new Gadget(API,deps);
    try {
        await first.ready; assert.deepEqual(identities,['first']); await first.controller.selectProject('DO'); await first.controller.selectIssueType('10');
        assert.deepEqual([...first.controller.getState().generationFieldIds],['summary']);
        await first.controller.updateSource('Private first draft'); user='second'; await first.init(); assert.deepEqual(identities,['first','second']);
        assert.equal(first.controller.getState().draft,null);
        const second = new Gadget(API,deps); await second.ready; await second.controller.selectProject('DO'); await second.controller.selectIssueType('10');
        assert.equal(dom.window.document.querySelectorAll('.ujg-ticket-assistant').length,1); assert.equal(dom.window.document.querySelectorAll('[data-ta-source]').length,1);
        assert.equal((await first.controller.updateSource('Late edit')).draft,null);
        dom.window.document.querySelector('[data-ta-field="reporter"] [data-ta-picker]').click();
        await new Promise(resolve => setImmediate(resolve)); assert.equal(searchSignal.aborted,false);
        second.destroy(); second.destroy(); assert.equal(searchSignal.aborted,true); assert.equal($('#root').find('[data-ta-source]').length,0);
    } finally {first.destroy(); dom.window.close();}
});

test('generated runtime works in installed Chrome at desktop and mobile, without external requests or writes', async () => {
    const {chromium} = require('playwright');
    const fs = require('node:fs');
    const {startPreview} = require('./ticket-assistant-preview-server.cjs');
    const server = await startPreview({port:0});
    const browser = await chromium.launch({channel:'chrome',headless:true});
    const screenshots = '/tmp/ujg-ticket-assistant-screenshots'; fs.mkdirSync(screenshots,{recursive:true});
    const faults = [], requests = [];
    try {
        for (const width of [1440,390]) {
            const page = await browser.newPage({viewport:{width,height:1000}});
            page.on('pageerror', error => faults.push(error.message));
            await page.route('**/*', route => {
                const request = route.request(); requests.push({url:request.url(),method:request.method()});
                if (!request.url().startsWith(server.url)) {faults.push('external request'); return route.abort();}
                return route.continue();
            });
            await page.goto(server.url); await page.waitForSelector('html[data-ta-preview-ready="true"]');
            const labels = page.locator('[data-ta-field="labels"] input');
            await labels.pressSequentially('alpha,beta');
            assert.equal(await labels.inputValue(),'alpha,beta');
            assert.deepEqual(await page.evaluate(()=>window.taPreview.instance.controller.getState().draft.fields.labels),['alpha','beta']);
            await labels.evaluate(el=>{el.setSelectionRange(3,3);});
            await page.evaluate(()=>{const c=window.taPreview.instance.controller; return c.updateField('labels',[...c.getState().draft.fields.labels]);});
            assert.equal(await labels.evaluate(el=>el.selectionStart),3); assert.equal(await labels.inputValue(),'alpha,beta');
            await page.evaluate(()=>window.taPreview.instance.controller.updateField('labels',['external','replacement']));
            assert.equal(await labels.inputValue(),'external, replacement');
            const effort=page.locator('[data-ta-field="customfield_1"] input');
            for(const [typed,value] of [['1.02',1.02],['-0.50',-0.5],['1e-2',0.01]]) {
                await effort.fill(''); await effort.pressSequentially(typed);
                assert.equal(await effort.inputValue(),typed);
                assert.equal(await page.evaluate(()=>window.taPreview.instance.controller.getState().draft.fields.customfield_1),value);
            }
            await effort.fill(''); await effort.pressSequentially('-');
            assert.equal(await effort.evaluate(el=>el.validity.badInput),true);
            await page.evaluate(()=>window.taPreview.instance.controller.updateField('labels',['unrelated']));
            assert.equal(await effort.evaluate(el=>el.validity.badInput),true);
            await effort.pressSequentially('0.5'); assert.equal(await effort.inputValue(),'-0.5');
            await page.locator('[data-ta-source]').fill('Проверить журнал ошибок API на тестовой среде');
            await page.locator('[data-ta-prepare]').click();
            await page.locator('[data-ta-stop]').click();
            await page.waitForFunction(() => window.taPreview.instance.controller.getState().stage === 'stopped');
            await page.locator('[data-ta-retry]').click();
            await page.waitForFunction(() => window.taPreview.instance.controller.getState().stage === 'idle' && !!window.taPreview.instance.controller.getState().draft.fields.summary);
            assert.equal(await page.locator('[data-ta-progress]').isVisible(),false);
            await page.locator('[data-ta-field="summary"] input').fill('Ручная тема');
            await page.locator('[data-ta-prepare]').click();
            await page.waitForSelector('[data-ta-accept="summary"]');
            assert.equal(await page.locator('[data-ta-field="summary"] input').inputValue(),'Ручная тема');
            await page.screenshot({path:screenshots + '/editor-' + width + '.png',fullPage:true});
            await page.locator('[data-ta-accept="summary"]').click();
            await page.locator('[data-ta-check]').click();
            await page.waitForSelector('[data-ta-checked]:not([hidden])');
            await page.screenshot({path:screenshots + '/checked-' + width + '.png',fullPage:true});
            const geometry = await page.evaluate(() => {
                const source = document.querySelector('.ta-source-area').getBoundingClientRect();
                const draft = document.querySelector('.ta-draft-area').getBoundingClientRect();
                return {source:{x:source.x,y:source.y,bottom:source.bottom},draft:{x:draft.x,y:draft.y},overflow:document.documentElement.scrollWidth > window.innerWidth};
            });
            assert.equal(geometry.overflow,false);
            if (width === 1440) assert.ok(geometry.draft.x > geometry.source.x && Math.abs(geometry.draft.y-geometry.source.y)<2);
            else assert.ok(geometry.draft.y >= geometry.source.bottom);
            assert.equal(await page.locator('[data-ta-create]').isDisabled(),true);
            const components = page.locator('[data-ta-field="components"]');
            await components.locator('[data-ta-picker]').click();
            await components.locator('[data-ta-candidate]').filter({hasText:'API'}).click();
            assert.equal(await components.locator('[data-ta-search]').evaluate(el => document.activeElement === el),true);
            assert.equal(await components.locator('[data-ta-picker]').getAttribute('aria-expanded'),'true');
            assert.equal(await components.locator('[data-ta-candidate]').filter({hasText:'API'}).count(),0);
            await page.screenshot({path:screenshots + '/picker-' + width + '.png',fullPage:true});
            await page.keyboard.press('Escape');
            assert.equal(await components.locator('[data-ta-popover]').isVisible(),false);
            assert.equal(await components.locator('[data-ta-picker]').evaluate(el => document.activeElement === el),true);
            await components.locator('[data-ta-picker]').click();
            await components.locator('[data-ta-candidate]').filter({hasText:'Интерфейс'}).click();
            await components.locator('[data-ta-search]').evaluate(el => el.blur());
            await page.keyboard.press('Escape');
            assert.equal(await components.locator('[data-ta-popover]').isVisible(),false);
            await components.locator('[data-ta-picker]').click(); await page.locator('[data-ta-check]').click();
            assert.equal(await components.locator('[data-ta-picker]').getAttribute('aria-expanded'),'false');
            assert.equal(await components.locator('[data-ta-popover]').isVisible(),false);
            await page.waitForFunction(() => window.taPreview.instance.controller.getState().stage === 'idle');
            await page.close();
        }
        assert.deepEqual(faults,[]); assert.ok(requests.every(request => request.method === 'GET'));
    } finally {await browser.close(); await server.close();}
});

test('preview binds loopback, serves runtime and CSP, returns actual port and closes', async () => {
    const {startPreview} = require('./ticket-assistant-preview-server.cjs');
    const server = await startPreview({port:0});
    try {
        assert.match(server.url, /^http:\/\/127\.0\.0\.1:\d+\/$/);
        const response = await fetch(server.url); assert.equal(response.status, 200);
        assert.match(response.headers.get('content-security-policy'), /connect-src 'none'/);
        const html = await response.text(); assert.match(html, /ujg-ticket-assistant.runtime.js/);
        assert.equal((await fetch(server.url + 'ujg-ticket-assistant.runtime.js')).status, 200);
        assert.equal((await fetch(server.url + 'rest/api/2/issue', {method:'POST'})).status, 405);
        const fallback = await startPreview({port:Number(new URL(server.url).port)});
        try {assert.notEqual(fallback.url,server.url);} finally {await fallback.close();}
    } finally {await server.close();}
});
