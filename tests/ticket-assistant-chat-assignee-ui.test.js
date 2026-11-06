const test=require('node:test');
const assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');
const jquery=require('jquery');
const {loadUnit,metadataFixture}=require('./helpers/ticket-assistant-fixture');
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
function setup(t,{allow=true,search=async()=>({values:[],complete:true}),self=async()=>({name:'me'})}={}) {
    const dom=new JSDOM('<div id="root"><div class="ta-layout"><header class="ta-header"><div class="ta-header-tools"></div></header></div></div>',{url:'https://jira.test/'});
    const window=dom.window,$=jquery(window),globals={window,document:window.document,AbortController,URL};
    const icons=loadUnit('icons',{},globals),fieldUi=loadUnit('field-ui',{_ujgTA_icons:icons,_ujgTA_fields:loadUnit('fields')},globals);
    const drafts=loadUnit('draft'),draft=drafts.createDraft({projectKey:'DO'});draft.issueTypeId='10';draft.templateId='task';draft.fields={summary:'Task',description:'Details'};
    const state={draft,meta:metadataFixture(),settings:loadUnit('profiles').createDefaults()};state.settings.profiles[0].allowAssignee=allow;
    const chatState={status:'idle',transcript:[]},sent=[];let ui,settingsOpened=0;
    const controller={getState:()=>state,updateField:(id,value)=>{state.draft=drafts.editField(state.draft,id,value);ui.update(state);}};
    const chat={getState:()=>chatState,send:async text=>{sent.push(text);},stop(){}};
    ui=loadUnit('chat-ui',{_ujgTA_icons:icons},globals).create({$,controller,chat,onSearch:search,getCurrentUser:self,createAssigneePicker:opts=>fieldUi.create(opts),editor:{openEditor(){},openSettings(){settingsOpened++;}}});
    ui.mount(window.document.querySelector('#root'));t.after(()=>{ui.destroy();window.close();});
    async function send(text){const input=window.document.querySelector('[data-ta-chat-input]');input.value=text;input.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));await tick();await tick();}
    return {state,ui,chatState,sent,send,doc:window.document,window,settingsOpened:()=>settingsOpened};
}
test('explicit exact Jira login is filled as a protected manual edit without a model call',async t=>{
    const h=setup(t,{search:async q=>{assert.equal(q,'alice');return {values:[{name:'alice',displayName:'Alice'}],complete:false};}});
    await h.send('Назначь на alice');assert.equal(h.state.draft.fields.assignee.name,'alice');assert.equal(h.state.draft.protectedFields.assignee,true);assert.deepEqual(h.sent,[]);
});
test('disabled active profile explains settings path and offers settings without lookup or mutation',async t=>{
    let lookups=0;const h=setup(t,{allow:false,search:async()=>{lookups++;return {values:[]};}});
    await h.send('Исполнитель: Алиса');assert.equal(lookups,0);assert.equal(h.state.draft.fields.assignee,undefined);assert.deepEqual(h.sent,[]);
    assert.match(h.doc.querySelector('[data-ta-chat-assignee]').textContent,/Настройки.*Профили.*Разрешить ручной выбор исполнителя/);
    h.doc.querySelector('[data-ta-assignee-settings]').click();assert.equal(h.settingsOpened(),1);
});
test('ambiguous Jira matches require in-chat selection using existing picker and never reach model',async t=>{
    const users=[{name:'alice1',displayName:'Алиса'},{name:'alice2',displayName:'Алиса'},{name:'inactive',displayName:'Алиса',active:false}];
    const h=setup(t,{search:async()=>({values:users,complete:true})});await h.send('Назначь на Алиса');
    assert.equal(h.state.draft.fields.assignee,undefined);assert.deepEqual(h.sent,[]);
    h.doc.querySelector('[data-ta-chat-assignee] [data-ta-picker]').click();await tick();
    const candidates=h.doc.querySelectorAll('[data-ta-chat-assignee] [data-ta-candidate]');assert.equal(candidates.length,2);
    candidates[1].click();assert.equal(h.state.draft.fields.assignee.name,'alice2');assert.equal(h.state.draft.protectedFields.assignee,true);assert.deepEqual(h.sent,[]);
});
test('self uses verified Jira identity and explicit unassigned uses policy-protected null',async t=>{
    const h=setup(t);await h.send('Назначь на меня');assert.equal(h.state.draft.fields.assignee.name,'me');
    await h.send('Без исполнителя');assert.equal(h.state.draft.fields.assignee,null);assert.equal(h.state.draft.protectedFields.assignee,true);assert.deepEqual(h.sent,[]);
});
test('unknown people and failed identity never invent assignees',async t=>{
    const h=setup(t,{self:async()=>({displayName:'Me',key:'storage-key'})});await h.send('Назначь на Nobody');assert.equal(h.state.draft.fields.assignee,undefined);
    assert.match(h.doc.querySelector('[data-ta-chat-assignee]').textContent,/не найден/i);await h.send('На меня');assert.equal(h.state.draft.fields.assignee,undefined);assert.deepEqual(h.sent,[]);
});
test('late lookup is cancelled by scope, policy, manual field edits, newer message, lock and destruction',async t=>{
    for(const change of [h=>{h.state.draft.id='other';h.ui.update(h.state);},h=>{h.state.settings.profiles[0].allowAssignee=false;h.ui.update(h.state);},h=>{h.state.draft.fields.assignee={name:'manual'};h.ui.update(h.state);},async h=>h.send('Обычный ответ'),h=>{h.state.draft.creation.status='preflight';h.ui.update(h.state);},h=>h.ui.destroy()]) {
        let finish,signal;const h=setup(t,{search:(_q,_f,o)=>{signal=o.signal;return new Promise(resolve=>{finish=resolve;});}});
        await h.send('Назначь на alice');await change(h);assert.equal(signal.aborted,true);
        finish({values:[{name:'alice'}],complete:true});await tick();assert.notEqual(h.state.draft.fields.assignee?.name,'alice');
    }
});
test('ordinary mentions stay ordinary chat and mixed explicit clause preserves task text',async t=>{
    const h=setup(t,{search:async()=>({values:[{name:'alice'}],complete:true})});await h.send('Алиса сообщила об ошибке');assert.deepEqual(h.sent,['Алиса сообщила об ошибке']);
    await h.send('Исправить API; исполнитель: alice');assert.equal(h.state.draft.fields.assignee.name,'alice');assert.deepEqual(h.sent,['Алиса сообщила об ошибке','Исправить API']);
});
test('partial exact display names still need selection and refined results can be explicitly chosen',async t=>{
    const h=setup(t,{search:async q=>({values:q==='bob'?[{name:'bob',displayName:'Боб'}]:[{name:'alice1',displayName:'Алиса'}],complete:false})});
    await h.send('Исполнитель: Алиса');assert.equal(h.state.draft.fields.assignee,undefined);
    h.doc.querySelector('[data-ta-assignee-picker] [data-ta-picker]').click();await tick();
    const search=h.doc.querySelector('[data-ta-assignee-picker] [data-ta-search]');search.value='bob';search.dispatchEvent(new h.window.Event('input'));await tick();
    h.doc.querySelector('[data-ta-assignee-picker] [data-ta-candidate]').click();assert.equal(h.state.draft.fields.assignee.name,'bob');assert.deepEqual(h.sent,[]);
});
test('explicit cancellation aborts lookup and detached stale candidate cannot overwrite manual edits',async t=>{
    let finish,signal;const h=setup(t,{search:(_q,_f,o)=>{signal=o.signal;return new Promise(resolve=>{finish=resolve;});}});
    await h.send('Назначь на alice');h.doc.querySelector('[data-ta-assignee-cancel]').click();assert.equal(signal.aborted,true);
    finish({values:[{name:'alice'}],complete:true});await tick();assert.equal(h.state.draft.fields.assignee,undefined);
    const j=setup(t,{search:async()=>({values:[{name:'alice',displayName:'Алиса'}],complete:false})});await j.send('Исполнитель: Алиса');
    j.doc.querySelector('[data-ta-assignee-picker] [data-ta-picker]').click();await tick();const candidate=j.doc.querySelector('[data-ta-assignee-picker] [data-ta-candidate]');
    j.state.draft.fields.assignee={name:'manual'};j.ui.update(j.state);candidate.click();assert.equal(j.state.draft.fields.assignee.name,'manual');
});
test('required and unavailable assignee fields reject clearing and assignment without lookup',async t=>{
    let lookups=0;const h=setup(t,{search:async()=>{lookups++;return {values:[{name:'alice'}]};}}),field=h.state.meta.issueTypes[0].fields.find(f=>f.id==='assignee');
    field.required=true;await h.send('Без исполнителя');assert.equal(h.state.draft.fields.assignee,undefined);assert.match(h.doc.querySelector('[data-ta-chat-assignee]').textContent,/обязателен/);
    field.writable=false;await h.send('Назначь на alice');assert.equal(lookups,0);assert.equal(h.state.draft.fields.assignee,undefined);
});
test('lookup failure leaves manual assignee intact and no directory data enters chat',async t=>{
    const h=setup(t,{search:async()=>{throw new Error('directory-private-error');}});h.state.draft.fields.assignee={name:'manual'};
    await h.send('Назначь на alice');assert.equal(h.state.draft.fields.assignee.name,'manual');assert.match(h.doc.querySelector('[data-ta-chat-assignee]').textContent,/Не удалось проверить/);
    assert.doesNotMatch(h.doc.body.textContent,/directory-private-error/);assert.deepEqual(h.sent,[]);
});
test('only active profile grants assignment even when another profile allows it',async t=>{
    const h=setup(t,{allow:true});h.state.settings.profiles.push({id:'DEVOPS',name:'DEVOPS',allowAssignee:false,templates:[]});h.state.settings.activeProfileId='DEVOPS';
    await h.send('На меня');assert.equal(h.state.draft.fields.assignee,undefined);assert.match(h.doc.querySelector('[data-ta-chat-assignee]').textContent,/отключён активным профилем/);
});
async function realSetup(t,search) {
    const h=await require('./helpers/ticket-assistant-chat-fixture').harness();
    const settings=h.controller.getState().settings;settings.profiles.find(p=>p.id===settings.activeProfileId).allowAssignee=true;await h.controller.applySettings(settings);
    const dom=new JSDOM('<div id="root"><div class="ta-layout"><header class="ta-header"><div class="ta-header-tools"></div></header></div></div>',{url:'https://jira.test/'}),window=dom.window,$=jquery(window),globals={window,document:window.document,AbortController,URL};
    const icons=loadUnit('icons',{},globals),fieldUi=loadUnit('field-ui',{_ujgTA_icons:icons,_ujgTA_fields:h.fields},globals);
    const Chat=loadUnit('chat',{_ujgTA_chatTools:loadUnit('chat-tools',{_ujgTA_fields:h.fields}),_ujgTA_draft:h.drafts},{AbortController});
    let ui;const runs=[];
    const chat=Chat.create({controller:h.controller,store:h.store,runtime:{createSession(config){const run={aborted:false};runs.push(run);return {
        async prompt(text){run.text=text;run.assignee=h.controller.getState().draft.fields.assignee;await tick();await config.tools.find(t=>t.name==='update_task').execute({fields:{summary:'Развернуть сервис',description:'Проверить доступ после выкладки'},questions:[]},{});config.onEvent({type:'assistant',text:'Сохранено'});},
        abort(){run.aborted=true;},dispose(){},getMessages(){return [];}
    };}},onChange:()=>{if(ui)ui.update(h.controller.getState());}});
    ui=loadUnit('chat-ui',{_ujgTA_icons:icons},globals).create({$,controller:h.controller,chat,onSearch:search,createAssigneePicker:opts=>fieldUi.create(opts),editor:{openEditor(){},openSettings(){}}});
    const unsubscribe=h.controller.subscribe(s=>ui.update(s));ui.mount(window.document.querySelector('#root'));
    t.after(()=>{unsubscribe();ui.destroy();chat.destroy();h.controller.destroy();window.close();});
    async function send(text){const input=window.document.querySelector('[data-ta-chat-input]');input.value=text;input.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));await tick();await tick();}
    return {...h,ui,chat,runs,send,doc:window.document};
}
test('mixed message waits for delayed verified assignment before real chat mutates draft, in either clause order',async t=>{
    for(const text of ['Развернуть сервис; исполнитель: alice','Исполнитель: alice\nРазвернуть сервис']) {
        let finish;const h=await realSetup(t,()=>new Promise(resolve=>{finish=resolve;}));await h.send(text);assert.equal(h.runs.length,0);
        assert.equal(h.doc.querySelector('[data-ta-chat-send]').disabled,false);finish({values:[{name:'alice'}],complete:true});await tick();await tick();await tick();
        assert.equal(h.runs.length,1);assert.equal(h.runs[0].assignee.name,'alice');assert.equal(h.runs[0].aborted,false);
        assert.equal(h.controller.getState().draft.fields.summary,'Развернуть сервис');assert.equal(h.controller.getState().draft.fields.assignee.name,'alice');
        const users=h.chat.getState().transcript.filter(m=>m.role==='user');assert.equal(users.length,1);assert.equal(users[0].text,'Развернуть сервис');
    }
});
test('mixed ambiguous lookup waits for picker selection before real chat starts and does not lose task text',async t=>{
    let finish;const h=await realSetup(t,()=>new Promise(resolve=>{finish=resolve;}));await h.send('Развернуть сервис; исполнитель: Алиса');assert.equal(h.runs.length,0);
    finish({values:[{name:'alice1',displayName:'Алиса'},{name:'alice2',displayName:'Алиса'}],complete:true});await tick();
    assert.equal(h.runs.length,0);assert.equal(h.doc.querySelector('[data-ta-chat-input]').value,'Развернуть сервис');
    h.doc.querySelector('[data-ta-assignee-picker] [data-ta-picker]').click();await tick();h.doc.querySelectorAll('[data-ta-assignee-picker] [data-ta-candidate]')[1].click();
    await tick();await tick();await tick();assert.equal(h.runs.length,1);assert.equal(h.runs[0].assignee.name,'alice2');assert.equal(h.runs[0].aborted,false);
});
test('a newer send cancels mixed lookup and queued old task while real chat changes fields',async t=>{
    let finish,signal;const h=await realSetup(t,(_q,_f,o)=>{signal=o.signal;return new Promise(resolve=>{finish=resolve;});});
    await h.send('Старая задача; исполнитель: alice');await h.send('Новая задача');assert.equal(signal.aborted,true);
    finish({values:[{name:'alice'}],complete:true});await tick();await tick();assert.equal(h.runs.length,1);assert.equal(h.runs[0].aborted,false);assert.equal(h.controller.getState().draft.fields.assignee,undefined);
    assert.deepEqual(h.chat.getState().transcript.filter(m=>m.role==='user').map(m=>m.text),['Новая задача']);
});
test('cancelled mixed picker retains task in composer and never starts real chat',async t=>{
    const h=await realSetup(t,async()=>({values:[{name:'alice1',displayName:'Алиса'},{name:'alice2',displayName:'Алиса'}],complete:true}));
    await h.send('Исполнитель: Алиса\nРазвернуть сервис');h.doc.querySelector('[data-ta-assignee-cancel]').click();await tick();
    assert.equal(h.runs.length,0);assert.equal(h.doc.querySelector('[data-ta-chat-input]').value,'Развернуть сервис');assert.equal(h.controller.getState().draft.fields.assignee,undefined);
    await h.send('Развернуть сервис');assert.equal(h.runs.length,1);assert.equal(h.runs[0].aborted,false);
});
test('real draft switch or manual edit cancels queued mixed task and delayed identity',async t=>{
    for(const change of [h=>h.controller.newDraft(),h=>h.controller.selectProject('APP'),h=>h.controller.updateField('summary','Ручная тема')]) {
        let finish,signal;const h=await realSetup(t,(_q,_f,o)=>{signal=o.signal;return new Promise(resolve=>{finish=resolve;});});
        await h.send('Развернуть сервис; исполнитель: alice');await change(h);assert.equal(signal.aborted,true);
        finish({values:[{name:'alice'}],complete:true});await tick();await tick();assert.equal(h.runs.length,0);assert.equal(h.controller.getState().draft.fields.assignee,undefined);
    }
});
