const test=require('node:test');
const assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');
const jquery=require('jquery');
const {loadUnit}=require('./helpers/ticket-assistant-fixture');
const {harness}=require('./helpers/ticket-assistant-chat-fixture');
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
const narrative='Восстановить доступ к сервису на DEV. Проверка: вход по RDP.';
const legacyNotice='Сервис модели вернул HTTP 429. Карточка прошла локальную проверку Jira.';
async function setup(t,{persisted=false}={}) {
    const h=await harness(),dom=new JSDOM('<div id="root"><div class="ta-layout"><header class="ta-header"><div class="ta-header-tools"></div></header></div></div>',{url:'https://jira.test/'});
    const window=dom.window,$=jquery(window),globals={window,document:window.document,AbortController};
    const Chat=loadUnit('chat',{_ujgTA_chatTools:loadUnit('chat-tools',{_ujgTA_fields:h.fields}),_ujgTA_draft:h.drafts},{AbortController});
    let action=async()=>{throw Error('Pico HTTP 429');},ui;const runs=[];
    if(persisted){
        await h.controller.chatUpdate({fields:{summary:'Доступ',description:narrative},questions:[]},h.controller.chatSnapshot(),narrative);
        await h.controller.chatValidate(h.controller.chatSnapshot());
        const id=h.controller.getState().draft.id;
        h.store.saveConversation('DO',id,{transcript:[{id:'old-user',role:'user',text:narrative}],messages:[],pendingTemplateProposal:null,notices:[legacyNotice,'Другое уведомление.']},0);
    }
    const chat=Chat.create({controller:h.controller,store:h.store,runtime:{createSession(config){return {
        async prompt(text){runs.push(text);await action(config);},getMessages(){return [];},abort(){},dispose(){}
    };}},onChange:()=>{if(ui)ui.update(h.controller.getState());}});
    ui=loadUnit('chat-ui',{_ujgTA_icons:loadUnit('icons',{},globals)},globals).create({$,controller:h.controller,chat,editor:{openEditor(){}}});ui.mount(window.document.querySelector('#root'));
    const unsubscribe=h.controller.subscribe(s=>ui.update(s));t.after(()=>{unsubscribe();ui.destroy();chat.destroy();h.controller.destroy();window.close();});
    const input=window.document.querySelector('[data-ta-chat-input]');
    async function settle(){for(let i=0;i<20;i++){await tick();if(chat.getState().status!=='running')break;}await tick();}
    async function send(text){input.value=text;input.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));await settle();}
    async function success(config){await config.tools.find(t=>t.name==='update_task').execute({fields:{summary:'Доступ восстановить',description:narrative},questions:[]},{});config.onEvent({type:'assistant',text:'Сохранено'});}
    return {...h,chat,ui,doc:window.document,input,runs,send,settle,success,setAction:fn=>{action=fn;},retry:()=>window.document.querySelector('[data-ta-chat-rate-retry]')};
}
for(const origin of ['send','reconcile','persisted'])test(origin+' 429 exposes adjacent manual retry, keeps ready card and unsent composer; repeat then success retires notice',async t=>{
    const h=await setup(t,{persisted:origin!=='send'});
    if(origin==='send')await h.send(narrative);
    if(origin==='reconcile'){await h.chat.reconcile();h.ui.update(h.controller.getState());}
    assert.equal(h.chat.getState().status,'idle');assert.equal(h.retry()?.hidden,false);
    assert.equal(h.doc.querySelector('[data-ta-card-create]').disabled,false);
    const region=h.retry().parentElement;assert.match(region.textContent,/HTTP 429/);assert.match(region.textContent,/огранич|слишком много/i);assert.match(h.retry().textContent,/Повторить/);
    const count=h.runs.length,users=h.chat.getState().transcript.filter(m=>m.role==='user');await tick();assert.equal(h.runs.length,count);
    h.input.value='Неотправленные сведения';h.input.focus();h.input.setSelectionRange(3,3);
    h.retry().click();h.retry().click();await h.settle();assert.equal(h.runs.length,count+1);assert.equal(h.retry().hidden,false);
    assert.equal(h.input.value,'Неотправленные сведения');assert.equal(h.input.selectionStart,3);assert.deepEqual(h.chat.getState().transcript.filter(m=>m.role==='user'),users);
    assert.equal(h.doc.querySelector('[data-ta-card-create]').disabled,false);
    h.setAction(h.success);h.retry().click();await h.settle();assert.equal(h.runs.length,count+2);assert.equal(h.retry().hidden,true);
    assert.doesNotMatch(h.chat.getState().notices.join(' '),/HTTP 429/);assert.deepEqual(h.chat.getState().transcript.filter(m=>m.role==='user'),users);
    if(origin==='persisted')assert.ok(h.chat.getState().notices.includes('Другое уведомление.'));
    assert.equal(h.input.value,'Неотправленные сведения');assert.equal(h.doc.querySelector('[data-ta-card-create]').disabled,false);
});
test('strict informational 429 retries original turn without changing composer, duplicating user history or reconciling',async t=>{
    const h=await setup(t);await h.send('Покажи доступные поля');assert.equal(h.chat.getState().status,'error');assert.equal(h.retry()?.hidden,false);
    h.input.value='Покажи доступные поля';h.setAction(async config=>{config.onEvent({type:'assistant',text:'Доступны тема и описание.'});});
    h.retry().click();h.retry().click();await h.settle();assert.deepEqual(h.runs,['Покажи доступные поля','Покажи доступные поля']);
    assert.equal(h.input.value,'Покажи доступные поля');assert.equal(h.chat.getState().transcript.filter(m=>m.role==='user').length,1);assert.equal(h.retry().hidden,true);
    assert.equal(h.controller.getState().draft.fields.description,undefined);
});
test('queued rate-limit retry is inert after scope switch, destruction or lock',async t=>{
    for(const change of [h=>h.controller.newDraft(),h=>h.ui.destroy(),h=>{const state=h.controller.getState();state.draft.creation.status='submitting';h.controller.getState=()=>state;h.ui.update(state);}]) {
        const h=await setup(t,{persisted:true});assert.equal(h.retry()?.hidden,false);h.retry().click();await change(h);await h.settle();assert.equal(h.runs.length,0);
    }
});
test('slow manual 429 retry is single flight and never consumes unsent composer text',async t=>{
    const h=await setup(t,{persisted:true});let finish;h.setAction(()=>new Promise(resolve=>{finish=resolve;}));
    h.input.value='Новый несохранённый ответ';h.retry().click();await tick();assert.equal(h.runs.length,1);assert.equal(h.retry().disabled,true);
    h.retry().click();h.input.dispatchEvent(new h.doc.defaultView.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));await tick();assert.equal(h.runs.length,1);
    finish();await h.settle();assert.equal(h.input.value,'Новый несохранённый ответ');assert.equal(h.chat.getState().transcript.filter(m=>m.role==='user').length,1);
});
test('informational retry does not duplicate original user turn even if a template was shown before 429',async t=>{
    const h=await setup(t);h.setAction(async config=>{await config.tools.find(t=>t.name==='read_template').execute({},{});throw Error('Pico HTTP 429');});
    await h.send('Покажи шаблон');assert.equal(h.chat.getState().status,'error');assert.equal(h.chat.getState().transcript.at(-1).kind,'template');
    h.setAction(async config=>{config.onEvent({type:'assistant',text:'Шаблон показан выше.'});});h.retry().click();await h.settle();
    assert.equal(h.chat.getState().transcript.filter(m=>m.role==='user').length,1);assert.deepEqual(h.runs,['Покажи шаблон','Покажи шаблон']);
});
test('a newer non-429 failure supersedes historical rate limit and keeps the ordinary retry visible',async t=>{
    const h=await setup(t,{persisted:true});h.setAction(async()=>{throw Error('Pico HTTP 502');});
    await h.send('Покажи доступные поля');assert.equal(h.chat.getState().status,'error');assert.match(h.chat.getState().error.message,/HTTP 502/);
    assert.equal(h.retry().hidden,true);assert.equal(h.doc.querySelector('[data-ta-chat-retry]').hidden,false);
    assert.doesNotMatch(h.chat.getState().notices.join(' '),/HTTP 429/);assert.ok(h.chat.getState().notices.includes('Другое уведомление.'));
    // Mixed historical state may also be restored/rendered by an older caller.
    const mixed={...h.chat.getState(),notices:[legacyNotice]};h.chat.getState=()=>mixed;h.ui.update(h.controller.getState());
    assert.equal(h.retry().hidden,true);assert.equal(h.doc.querySelector('[data-ta-chat-retry]').hidden,false);
    assert.doesNotMatch(h.doc.querySelector('[data-ta-chat-status]').textContent,/HTTP 429/);
});
test('strict informational 429 with an existing ready card retries the original inquiry, never reconciliation',async t=>{
    const h=await setup(t,{persisted:true});const before=JSON.stringify(h.controller.getState().draft.fields);
    await h.send('Покажи доступные поля');assert.equal(h.chat.getState().status,'error');assert.equal(h.doc.querySelector('[data-ta-card-create]').disabled,false);
    h.input.value='Неотправленный ответ';h.setAction(async config=>{config.onEvent({type:'assistant',text:'Доступны тема и описание.'});});
    h.retry().click();await h.settle();assert.deepEqual(h.runs,['Покажи доступные поля','Покажи доступные поля']);
    assert.equal(h.chat.getState().transcript.filter(m=>m.role==='user' && m.text==='Покажи доступные поля').length,1);
    assert.equal(JSON.stringify(h.controller.getState().draft.fields),before);assert.equal(h.doc.querySelector('[data-ta-card-create]').disabled,false);assert.equal(h.input.value,'Неотправленный ответ');
});
test('incomplete fallback retains persisted 429 notice and manual retry without claiming creation readiness',async t=>{
    const h=await setup(t),read=h.api.getCreateMeta;
    h.api.getCreateMeta=async key=>{const raw=await read(key);raw.projects[0].issuetypes.forEach(type=>{type.fields.customfield_2.required=true;});return raw;};
    await h.controller.selectProject('DO');await h.send(narrative);assert.equal(h.chat.getState().status,'idle');assert.equal(h.chat.getState().error,null);
    assert.equal(h.doc.querySelector('[data-ta-card-create]').disabled,true);assert.match(h.chat.getState().notices.join(' '),/HTTP 429/);assert.equal(h.retry().hidden,false);
    const d=h.controller.getState().draft,saved=h.store.loadConversation('DO',d.id);assert.match(saved.value.notices.join(' '),/HTTP 429/);
    h.input.value='Ещё не отправлено';h.retry().click();await h.settle();assert.equal(h.runs.length,2);assert.equal(h.retry().hidden,false);
    assert.equal(h.doc.querySelector('[data-ta-card-create]').disabled,true);assert.equal(h.input.value,'Ещё не отправлено');assert.equal(h.chat.getState().transcript.filter(m=>m.role==='user').length,1);
});
