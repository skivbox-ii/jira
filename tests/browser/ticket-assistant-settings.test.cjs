const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {JSDOM} = require('jsdom');
const jquery = require('jquery');
const {loadUnit, memoryStorage} = require('../helpers/ticket-assistant-fixture');
const tick = () => new Promise(resolve => setImmediate(resolve));

async function setup(t, backend = memoryStorage(), searchUsers = async()=>({values:[{name:'anna',displayName:'Anna'}]})) {
    const dom = new JSDOM('<div id="root"></div>', {url:'http://localhost/jira'});
    const {window} = dom, $ = jquery(window), root = window.document.querySelector('#root');
    const globals = {window, document:window.document, navigator:window.navigator, URL, AbortController, setInterval, clearInterval};
    const deps = {};
    for (const name of ['profiles','draft','fields','validation','storage','controller','icons','field-ui','settings-ui','ui']) {
        if (name === 'settings-ui' && !fs.existsSync(path.resolve(__dirname, '../../ujg-ticket-assistant-modules/settings-ui.js'))) continue;
        deps['_ujgTA_' + ({'field-ui':'fieldUi','settings-ui':'settingsUi'}[name] || name)] = loadUnit(name, deps, globals);
    }
    const api = {
        getCurrentUser:async()=>({key:'synthetic-settings-test'}),
        getProjects:async()=>({values:[{id:'1',key:'DO',name:'Delivery'},{id:'2',key:'APP',name:'App'}]}),
        getCreateMeta:async key=>({projects:[{id:key,key,issuetypes:[{id:key==='DO'?'10':'20',name:'Task',subtask:false,fields:{
            summary:{name:'Summary',required:true,schema:{type:'string',system:'summary'}},
            description:{name:'Description',schema:{type:'string',system:'description'}},
            assignee:{name:'Assignee',schema:{type:'user',system:'assignee'}}
        }}]}]}),
        getComponents:async key=>({values:[],complete:true,projectKey:key}), getVersions:async key=>({values:[],complete:true,projectKey:key})
    };
    let ui;
    const c = deps._ujgTA_controller.create({api, ai:{check:async()=>({questions:[],warnings:[],evidence:[]})},
        createStore:key=>deps._ujgTA_storage.createStore({storage:backend,origin:window.location.origin,userKey:key}),
        onChange:state=>{if(ui)ui.update(state);}});
    ui = deps._ujgTA_ui.create({$,controller:c,onSearch:searchUsers}); ui.mount(root);
    t.after(()=>{ui.destroy();c.destroy();window.close();});
    const q = selector => {const el=root.querySelector(selector);assert.ok(el, 'Missing '+selector);return el;};
    const input = (selector,value)=>{const el=q(selector);el.value=value;el.dispatchEvent(new window.Event('input',{bubbles:true}));};
    const click = async selector=>{q(selector).click();await tick();};
    const pick = async (host,text)=>{await click(host+' [data-ta-picker]');const b=[...q(host).querySelectorAll('[data-ta-candidate]')].find(el=>el.textContent.includes(text));assert.ok(b,text);b.click();await tick();};
    await c.init(); await pick('[data-ta-project]','DO');
    if (!c.getState().draft.issueTypeId) await pick('[data-ta-type]','10');
    if (!c.getState().draft.templateId) await pick('[data-ta-template]','task');
    input('[data-ta-source]','Original source');input('[data-ta-field="summary"] input','Manual title');
    return {c,ui,dom,window,root,q,input,click,pick,deps,backend};
}

for (const [kind,id] of [['profile','devops'],['template','bug']]) {
    test('keyboard-activated '+kind+' replacement retains focus while prompt typing retains its caret', async t=>{
        const s=await setup(t);await s.click('[data-ta-open-settings]');
        const selector='[data-ta-'+kind+'-row][data-id="'+id+'"]',old=s.q(selector);
        old.focus();old.click();await tick();
        assert.notEqual(s.q(selector),old);assert.equal(s.q(selector).getAttribute('aria-pressed'),'true');
        assert.equal(s.window.document.activeElement,s.q(selector));
        for (const prompt of ['[data-ta-profile-instructions]','[data-ta-template-instructions]']) {
            const input=s.q(prompt);input.focus();input.setSelectionRange(3,5);input.setRangeText('X',3,5,'end');
            const value=input.value,start=input.selectionStart,end=input.selectionEnd;
            input.dispatchEvent(new s.window.Event('input',{bubbles:true}));
            assert.equal(s.window.document.activeElement,input);assert.equal(input.value,value);
            assert.equal(input.selectionStart,start);assert.equal(input.selectionEnd,end);
        }
    });
}

test('settings editing is local until Apply; cancel confirmation, Escape and focus preserve source and fields', async t=>{
    const s=await setup(t);await s.click('[data-ta-check]');assert.ok(s.c.getState().draft.checked);
    const revision=s.c.getState().settings.revision;
    await s.click('[data-ta-open-settings]'); s.input('[data-ta-profile-instructions]','Edited general prompt');
    assert.equal(s.c.getState().settings.revision,revision);
    s.q('[data-ta-settings-dialog]').dispatchEvent(new s.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
    assert.equal(s.q('[data-ta-discard-confirm]').hidden,false);
    await s.click('[data-ta-keep-editing]');assert.equal(s.q('[data-ta-profile-instructions]').value,'Edited general prompt');
    await s.click('[data-ta-settings-close]');await s.click('[data-ta-discard-settings]');
    assert.equal(s.q('[data-ta-settings-dialog]').hidden,true);assert.equal(s.window.document.activeElement,s.q('[data-ta-open-settings]'));
    await s.click('[data-ta-open-settings]');s.input('[data-ta-profile-instructions]','Applied prompt');await s.click('[data-ta-settings-apply]');
    const state=s.c.getState();assert.equal(state.settings.profiles[0].instructions,'Applied prompt');assert.equal(state.settings.revision,revision+1);
    assert.equal(state.draft.source,'Original source');assert.equal(state.draft.fields.summary,'Manual title');assert.equal(state.draft.checked,null);
});

test('profile and template add duplicate delete reset are editable and require explicit Apply', async t=>{
    const s=await setup(t);await s.click('[data-ta-open-settings]');
    await s.click('[data-ta-template-add]');assert.equal(s.root.querySelectorAll('[data-ta-template-row]').length,4);
    s.input('[data-ta-template-name]','Fourth');s.input('[data-ta-template-instructions]','Fourth rules');s.input('[data-ta-template-when]','When fourth');
    await s.click('[data-ta-template-duplicate]');assert.equal(s.root.querySelectorAll('[data-ta-template-row]').length,5);
    await s.click('[data-ta-template-delete]');assert.equal(s.root.querySelectorAll('[data-ta-template-row]').length,4);
    await s.click('[data-ta-profile-duplicate]');s.input('[data-ta-profile-name]','My copy');
    await s.click('[data-ta-profile-add]');await s.click('[data-ta-profile-delete]');
    assert.equal(s.c.getState().settings.profiles.length,2);await s.click('[data-ta-settings-apply]');
    assert.equal(s.c.getState().settings.profiles.length,3);assert.equal(s.c.getState().settings.profiles[2].name,'My copy');
    assert.equal(s.c.getState().draft.templateId,null);assert.equal(s.c.getState().draft.fields.summary,'Manual title');
    await s.click('[data-ta-open-settings]');await s.click('[data-ta-reset]');await s.click('[data-ta-reset-confirm]');
    assert.equal(s.c.getState().settings.profiles.length,3);await s.click('[data-ta-settings-apply]');
    assert.equal(s.c.getState().settings.profiles.length,2);assert.equal(s.c.getState().draft.source,'Original source');
});

test('JSON import previews safely, preserves foreign text, requires searchable mapping and exports whitelist only', async t=>{
    const s=await setup(t);await s.click('[data-ta-open-settings]');
    const foreign=s.deps._ujgTA_profiles.createDefaults();foreign.profiles[0].instructions='<img src=x onerror=alert(1)> Foreign';
    foreign.profiles[0].templates[0].issueTypeId='20';foreign.source='PRIVATE';
    s.input('[data-ta-import-json]',JSON.stringify(foreign));await s.click('[data-ta-import-preview]');
    assert.match(s.q('[data-ta-import-result]').textContent,/20/);assert.notEqual(s.q('[data-ta-profile-instructions]').value,foreign.profiles[0].instructions);
    await s.click('[data-ta-import-use]');assert.equal(s.q('[data-ta-profile-instructions]').value,foreign.profiles[0].instructions);
    assert.equal(s.root.querySelector('img'),null);assert.match(s.q('[data-ta-mapping-warning]').textContent,/20/);
    await s.click('[data-ta-settings-apply]');assert.equal(s.c.getState().draft.issueTypeId,null);assert.equal(s.c.getState().draft.checked,null);assert.equal(s.q('[data-ta-create]').disabled,true);
    assert.equal(s.c.getState().draft.fields.summary,'Manual title');assert.equal(s.c.getState().draft.source,'Original source');
    await s.click('[data-ta-open-settings]');await s.pick('[data-ta-template-mapping]','10');
    assert.equal(s.q('[data-ta-mapping-warning]').textContent,'');await s.click('[data-ta-export]');
    const exported=s.q('[data-ta-export-json]').value;assert.ok(!exported.includes('PRIVATE'));assert.equal(JSON.parse(exported).profiles[0].templates[0].issueTypeId,'10');
    await s.click('[data-ta-settings-apply]');assert.equal(s.c.getState().draft.issueTypeId,null);
});

test('conflict remains visible with local copy; load saved settings preserves local draft until explicit reapply persists it', async t=>{
    const backend=memoryStorage(),a=await setup(t,backend),b=await setup(t,backend);
    await a.click('[data-ta-open-settings]');a.input('[data-ta-profile-instructions]','Local settings');
    await b.click('[data-ta-open-settings]');b.input('[data-ta-profile-instructions]','Remote settings');b.input('[data-ta-source]','Remote draft');await b.click('[data-ta-settings-apply]');
    await a.click('[data-ta-settings-apply]');assert.equal(a.q('[data-ta-settings-conflict]').hidden,false);
    a.input('[data-ta-profile-name]','Still local');assert.equal(a.q('[data-ta-settings-conflict]').hidden,false);
    assert.equal(a.q('[data-ta-profile-instructions]').value,'Local settings');
    await a.click('[data-ta-conflict-load]');assert.equal(a.q('[data-ta-profile-instructions]').value,'Remote settings');
    assert.equal(a.c.getState().draft.source,'Original source');
    const saved=()=>JSON.parse(backend.getItem(backend.key(0)));
    assert.equal(saved().draft.source,'Remote draft');
    a.input('[data-ta-profile-instructions]','Resolved settings');await a.click('[data-ta-settings-apply]');
    assert.equal(saved().draft.source,'Original source');assert.equal(saved().settings.profiles[0].instructions,'Resolved settings');
    const c=await setup(t,backend);await c.click('[data-ta-open-settings]');c.input('[data-ta-profile-instructions]','Third settings');
    await a.click('[data-ta-open-settings]');a.input('[data-ta-profile-instructions]','Fourth settings');await a.click('[data-ta-settings-apply]');
    await c.click('[data-ta-settings-apply]');await c.click('[data-ta-conflict-reapply]');assert.equal(saved().settings.profiles[0].instructions,'Third settings');
    assert.equal(c.q('[data-ta-settings-dialog]').hidden,true);
});

test('assignee policy prevents new choice, retains manual value on change and explicitly discards rather than sending null', async t=>{
    const s=await setup(t);assert.equal(s.q('[data-ta-field="assignee"] [data-ta-picker]').disabled,true);
    await s.click('[data-ta-open-settings]');s.q('[data-ta-allow-assignee]').click();await s.click('[data-ta-settings-apply]');
    await s.pick('[data-ta-field="assignee"]','anna');assert.equal(s.c.getState().draft.fields.assignee.name,'anna');
    await s.click('[data-ta-open-settings]');s.q('[data-ta-allow-assignee]').click();await s.click('[data-ta-settings-apply]');
    assert.equal(s.c.getState().draft.fields.assignee.name,'anna');await s.click('[data-ta-check]');assert.equal(s.c.getState().validation.ok,false);
    await s.click('[data-ta-discard-field="assignee"]');assert.equal(Object.hasOwn(s.c.getState().draft.fields,'assignee'),false);
    await s.click('[data-ta-check]');assert.equal(s.c.getState().validation.ok,true);
});

test('deleting active template and switching profiles retain draft text and clear checked selection', async t=>{
    const s=await setup(t);await s.click('[data-ta-check]');assert.ok(s.c.getState().draft.checked);
    await s.click('[data-ta-open-settings]');await s.click('[data-ta-template-delete]');await s.click('[data-ta-settings-apply]');
    assert.equal(s.c.getState().draft.templateId,null);assert.equal(s.c.getState().draft.source,'Original source');assert.equal(s.c.getState().draft.fields.summary,'Manual title');
    assert.equal(s.c.getState().draft.checked,null);assert.equal(s.q('[data-ta-check]').disabled,true);assert.equal(s.q('[data-ta-create]').disabled,true);
    await s.pick('[data-ta-template]','bug');await s.click('[data-ta-open-settings]');await s.click('[data-ta-profile-row][data-id="devops"]');await s.click('[data-ta-settings-apply]');
    assert.equal(s.c.getState().draft.templateId,null);assert.equal(s.c.getState().draft.fields.summary,'Manual title');
});

test('open settings never apply to another project after an external controller scope change', async t=>{
    const s=await setup(t);await s.click('[data-ta-open-settings]');s.input('[data-ta-profile-instructions]','DO only');
    await s.c.selectProject('APP');await s.click('[data-ta-settings-apply]');
    assert.notEqual(s.c.getState().settings.profiles[0].instructions,'DO only');
    assert.equal(s.q('[data-ta-settings-dialog]').hidden,false);assert.equal(s.q('[data-ta-profile-instructions]').value,'DO only');
    assert.match(s.q('[data-ta-settings-error]').textContent,/проект|область/);
});

test('loading saved rules with a different profile clears the old template but never writes or replaces local fields', async t=>{
    const backend=memoryStorage(),a=await setup(t,backend),b=await setup(t,backend);
    await b.click('[data-ta-open-settings]');await b.click('[data-ta-profile-row][data-id="devops"]');await b.click('[data-ta-settings-apply]');
    await a.click('[data-ta-open-settings]');a.input('[data-ta-profile-name]','Local');await a.click('[data-ta-settings-apply]');
    const before=backend.getItem(backend.key(0));await a.click('[data-ta-conflict-load]');
    assert.equal(a.c.getState().settings.activeProfileId,'devops');assert.equal(a.c.getState().draft.templateId,null);
    assert.equal(a.c.getState().draft.fields.summary,'Manual title');assert.equal(backend.getItem(backend.key(0)),before);
    assert.equal(a.q('[data-ta-settings-conflict]').hidden,false);
});

test('policy change while assignee popup was open prevents choosing a stale candidate', async t=>{
    const s=await setup(t);await s.click('[data-ta-open-settings]');s.q('[data-ta-allow-assignee]').click();await s.click('[data-ta-settings-apply]');
    await s.click('[data-ta-field="assignee"] [data-ta-picker]');
    // An external settings update can arrive while the existing editor popup is open.
    const settings=s.c.getState().settings;settings.profiles[0].allowAssignee=false;await s.c.applySettings(settings);
    s.q('[data-ta-field="assignee"] [data-ta-candidate]').click();await tick();assert.equal(Object.hasOwn(s.c.getState().draft.fields,'assignee'),false);
    assert.equal(s.q('[data-ta-field="assignee"] [data-ta-search]').disabled,true);
});

test('late assignee search results cannot repopulate choices after policy changes', async t=>{
    let finish;const s=await setup(t,memoryStorage(),()=>new Promise(resolve=>{finish=resolve;}));
    await s.click('[data-ta-open-settings]');s.q('[data-ta-allow-assignee]').click();await s.click('[data-ta-settings-apply]');
    await s.click('[data-ta-field="assignee"] [data-ta-picker]');
    const settings=s.c.getState().settings;settings.profiles[0].allowAssignee=false;await s.c.applySettings(settings);
    finish({values:[{name:'anna',displayName:'Anna'}]});await tick();
    assert.equal(s.root.querySelectorAll('[data-ta-field="assignee"] [data-ta-candidate]').length,0);
});

test('explicit null assignee remains policy blocked until the user excludes the field', async t=>{
    const s=await setup(t);await s.click('[data-ta-open-settings]');s.q('[data-ta-allow-assignee]').click();await s.click('[data-ta-settings-apply]');
    await s.pick('[data-ta-field="assignee"]','anna');await s.click('[data-ta-field="assignee"] [data-ta-picker]');
    await s.click('[data-ta-field="assignee"] [data-ta-remove]');assert.equal(s.c.getState().draft.fields.assignee,null);
    await s.click('[data-ta-open-settings]');s.q('[data-ta-allow-assignee]').click();await s.click('[data-ta-settings-apply]');
    await s.click('[data-ta-check]');assert.equal(s.c.getState().validation.ok,false);assert.equal(s.c.getState().draft.fields.assignee,null);
    await s.click('[data-ta-discard-field="assignee"]');assert.equal(Object.hasOwn(s.c.getState().draft.fields,'assignee'),false);
    await s.click('[data-ta-check]');assert.equal(s.c.getState().validation.ok,true);
});

test('installed Chrome persists real settings and source across reload, transfers foreign mappings and scrolls at 1440 and 390', async()=>{
    const {chromium}=require('playwright'),{startPreview}=require('./ticket-assistant-preview-server.cjs');
    const server=await startPreview({port:0}),browser=await chromium.launch({channel:'chrome',headless:true});
    const faults=[],requests=[],screenshots='/tmp/ujg-ticket-assistant-screenshots';fs.mkdirSync(screenshots,{recursive:true});
    try {
        for (const width of [1440,390]) {
            const context=await browser.newContext({viewport:{width,height:width===390?844:900}}),page=await context.newPage();
            page.on('pageerror',error=>faults.push(error.message));
            await page.route('**/*',route=>{const r=route.request();requests.push(r.method());if(!r.url().startsWith(server.url)){faults.push(r.url());return route.abort();}return route.continue();});
            await page.goto(server.url);await page.waitForSelector('html[data-ta-preview-ready="true"]');
            await page.locator('[data-ta-source]').fill('Persisted source '+width);await page.locator('[data-ta-field="summary"] input').fill('Persisted summary');
            await page.locator('[data-ta-open-settings]').click();
            for (const [selector,key,next] of [
                ['[data-ta-profile-row][data-id="devops"]','Enter','[data-ta-profile-add]'],
                ['[data-ta-template-row][data-id="bug"]','Space','[data-ta-template-row][data-id="deployment"]']
            ]) {
                await page.locator(selector).focus();await page.keyboard.press(key);
                assert.equal(await page.locator(selector).getAttribute('aria-pressed'),'true');
                assert.equal(await page.locator(selector).evaluate(el=>el===document.activeElement),true);
                await page.keyboard.press('Tab');assert.equal(await page.locator(next).evaluate(el=>el===document.activeElement),true);
            }
            await page.locator('[data-ta-profile-row][data-id="universal"]').focus();await page.keyboard.press('Enter');
            for (const selector of ['[data-ta-profile-instructions]','[data-ta-template-instructions]']) {
                const prompt=page.locator(selector);await prompt.focus();await prompt.evaluate(el=>el.setSelectionRange(3,3));
                await page.keyboard.type('X');assert.equal(await prompt.evaluate(el=>el===document.activeElement),true);
                assert.equal(await prompt.evaluate(el=>el.selectionStart),4);assert.equal(await prompt.evaluate(el=>el.selectionEnd),4);
            }
            const rules='Длинный общий промпт '.repeat(250);await page.locator('[data-ta-profile-instructions]').fill(rules);
            await page.locator('[data-ta-template-add]').click();await page.locator('[data-ta-template-name]').fill('Четвёртый шаблон');
            await page.locator('[data-ta-template-instructions]').fill('Длинные правила шаблона '.repeat(250));
            await page.locator('[data-ta-template-mapping] [data-ta-picker]').click();await page.locator('[data-ta-template-mapping] [data-ta-search]').fill('10');
            await page.locator('[data-ta-template-mapping] [data-ta-candidate]').click();
            await page.screenshot({path:path.join(screenshots,'settings-mapping-'+width+'.png')});
            await page.locator('[data-ta-settings-apply]').click();
            await page.reload();await page.waitForSelector('html[data-ta-preview-ready="true"]');
            assert.equal(await page.locator('[data-ta-source]').inputValue(),'Persisted source '+width);
            assert.equal(await page.locator('[data-ta-field="summary"] input').inputValue(),'Persisted summary');
            await page.locator('[data-ta-open-settings]').click();assert.equal(await page.locator('[data-ta-profile-instructions]').inputValue(),rules);
            assert.equal(await page.locator('[data-ta-template-row]').count(),4);
            await page.locator('[data-ta-profile-name]').focus();await page.keyboard.press('Shift+Tab');await page.keyboard.press('Tab');
            await page.screenshot({path:path.join(screenshots,'settings-'+width+'.png')});
            await page.locator('.ta-settings-transfer summary').click();await page.locator('[data-ta-export]').click();
            const exported=await page.locator('[data-ta-export-json]').inputValue();assert.ok(!exported.includes('Persisted source'));
            await page.locator('[data-ta-settings-cancel]').click();assert.equal(await page.locator('[data-ta-open-settings]').evaluate(el=>el===document.activeElement),true);
            await page.locator('[data-ta-project] [data-ta-picker]').click();await page.locator('[data-ta-project] [data-ta-candidate]').filter({hasText:'APP'}).click();
            await page.locator('[data-ta-open-settings]').click();await page.locator('.ta-settings-transfer summary').click();
            await page.locator('[data-ta-import-json]').fill(exported);await page.locator('[data-ta-import-preview]').click();await page.locator('[data-ta-import-use]').click();
            await page.locator('[data-ta-template-row]').filter({hasText:'Четвёртый'}).click();
            assert.match(await page.locator('[data-ta-mapping-warning]').textContent(),/10/);
            assert.equal(await page.locator('[data-ta-template-instructions]').inputValue(),'Длинные правила шаблона '.repeat(250));
            await page.locator('[data-ta-template-mapping] [data-ta-picker]').click();await page.locator('[data-ta-template-mapping] [data-ta-search]').fill('20');
            await page.locator('[data-ta-template-mapping] [data-ta-candidate]').click();await page.locator('[data-ta-settings-apply]').click();
            assert.equal(await page.locator('[data-ta-create]').isDisabled(),true);
            await page.locator('[data-ta-open-settings]').click();await page.locator('[data-ta-profile-name]').fill('Unsaved');await page.keyboard.press('Escape');
            await page.locator('[data-ta-keep-editing]').click();assert.equal(await page.locator('[data-ta-profile-name]').inputValue(),'Unsaved');
            await page.keyboard.press('Escape');await page.locator('[data-ta-discard-settings]').click();
            assert.equal(await page.locator('[data-ta-open-settings]').evaluate(el=>el===document.activeElement),true);
            assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
            await context.close();
        }
        assert.deepEqual(faults,[]);assert.ok(requests.every(method=>method==='GET'));
    } finally {await browser.close();await server.close();}
});
