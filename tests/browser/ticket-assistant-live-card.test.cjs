const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {chromium}=require('playwright');
const {harness}=require('../helpers/ticket-assistant-chat-fixture');
const root=path.resolve(__dirname,'../..');
// Load individual AMD source modules directly. This fixture never invokes a builder.
async function fixture(t,width) {
    const h=await harness(),meta=await h.api.getCreateMeta('DO'),components=await h.api.getComponents('DO'),versions=await h.api.getVersions('DO');h.controller.destroy();
    meta.projects[0].issuetypes.forEach(type=>{type.fields.priority={name:'Приоритет',schema:{type:'priority',system:'priority'},hasDefaultValue:true,defaultValue:{id:'3'},allowedValues:[{id:'2',name:'Высокий'},{id:'3',name:'Обычный'}]};});
    const browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage({viewport:{width,height:1000}}),errors=[];
    page.setDefaultTimeout(5000);page.on('pageerror',e=>errors.push(e.message));t.after(()=>browser.close());
    await page.setContent('<html><head></head><body style="margin:0"><div id="root"></div></body></html>');
    await page.addStyleTag({path:path.join(root,'ujg-ticket-assistant.css')});await page.addScriptTag({path:require.resolve('jquery/dist/jquery.js')});
    await page.addScriptTag({content:`window.amdModules=new Map([['jquery',{value:window.jQuery}],['_ujgShared_llmClient',{value:{}}],['_ujgTA_picoRuntime',{value:{}}]]);window.define=(name,deps,factory)=>amdModules.set(name,{deps,factory});window.define.amd=true;window.taRequire=name=>{const m=amdModules.get(name);if(!m)throw Error('Missing '+name);if(!('value' in m))m.value=m.factory(...m.deps.map(taRequire));return m.value;};`});
    for(const name of ['icons','fields','field-ui','profiles','draft','validation','creator','storage','api','ai','settings-ui','controller','ui','chat-tools','chat','chat-ui','main'])await page.addScriptTag({path:path.join(root,'ujg-ticket-assistant-modules',name+'.js')});
    await page.evaluate(async ({meta,components,versions})=>{
        const values=new Map(),storage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,String(v)),removeItem:k=>values.delete(k),key:i=>[...values.keys()][i]??null,get length(){return values.size;}};
        const api={getCurrentUser:async()=>({name:'alice',key:'alice'}),getProjects:async()=>({values:[{key:'DO',id:'DO-project',name:'Проект'}]}),getCreateMeta:async()=>meta,getComponents:async()=>components,getVersions:async()=>versions,searchUsers:async()=>({values:[{name:'alice',displayName:'Алиса'}],complete:true}),createIssue:async()=>{window.creates++;return {id:'1',key:'DO-1'};}};
        window.creates=0;window.fail429=false;window.modelTurns=0;
        const runtime={createSession(config){return {async prompt(){if(window.fail429)throw Error('Pico HTTP 429');const fields={description:'Восстановить доступ на DEV. Проверить вход.'};if(++window.modelTurns===1)fields.summary='Тема из чата';await config.tools.find(t=>t.name==='update_task').execute({fields,questions:[]},{});config.onEvent({type:'assistant',text:'Данные внесены в карточку.'});},getMessages:()=>[],abort(){},dispose(){}};}};
        const Gadget=taRequire('_ujgTA_main');window.gadget=new Gadget({getGadgetContentEl:()=>document.querySelector('#root')},{api,ai:{},storage,runtime,baseUrl:''});
        await gadget.ready;await gadget.controller.selectProject('DO');await gadget.controller.selectIssueType('10');await gadget.controller.selectTemplate('task');
    },{meta,components,versions});return {page,errors};
}
for(const width of [1440,900,390])test('source modules expose editable live card, compact responsive chat and one Create at '+width,async t=>{
    const {page,errors}=await fixture(t,width),summary=page.locator('[data-ta-task-card] [data-ta-field="summary"] input');
    assert.equal(await page.locator('[data-ta-fields] [data-ta-field="priority"] [data-ta-picker]').isVisible(),true);assert.match(await page.locator('[data-ta-field="priority"] [data-ta-picker]').innerText(),/Обычный/);
    assert.equal(await summary.isVisible(),true);assert.equal(await summary.isEditable(),true);
    assert.equal(await page.locator('[data-ta-create],[data-ta-card-create]').count(),1);assert.equal(await page.locator('[data-ta-editor-panel]').isVisible(),false);
    const chat=await page.locator('.ta-chat').boundingBox(),card=await page.locator('[data-ta-task-card]').boundingBox();
    if(width>=900){assert.ok(chat.x+chat.width<=card.x);assert.ok(Math.abs(chat.y-card.y)<3);}else {assert.ok(card.y>=chat.y+chat.height);}
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await summary.fill('Ручная тема');assert.equal(await page.evaluate(()=>gadget.controller.getState().draft.protectedFields.summary),true);
    const composer=page.locator('[data-ta-chat-input]');await composer.fill('Восстановить доступ на DEV. Проверить вход.');await composer.press('Enter');
    await page.waitForFunction(()=>gadget.chat.getState().status!=='running' && gadget.controller.getState().draft.pendingFields.summary);
    assert.equal(await summary.inputValue(),'Ручная тема');assert.equal(await page.locator('[data-ta-reject="summary"]').isVisible(),true);
    await page.locator('[data-ta-reject="summary"]').click();
    assert.equal(await page.locator('[data-ta-card-check]').isVisible(),true);await page.locator('[data-ta-card-check]').click();
    await page.waitForFunction(()=>!!gadget.controller.getState().draft.checked);
    assert.equal(await page.locator('[data-ta-card-create]').isEnabled(),true);assert.equal(await page.locator('[data-ta-card-check]').isVisible(),false);
    await page.locator('[data-ta-card-create]').click();await page.waitForFunction(()=>gadget.controller.getState().draft.creation.status==='created');assert.equal(await page.evaluate(()=>creates),1);
    assert.equal(await summary.isEditable(),false);assert.deepEqual(errors,[]);
});
