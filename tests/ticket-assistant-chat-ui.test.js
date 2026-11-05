const test=require('node:test');
const assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');
const jquery=require('jquery');
const {loadUnit,metadataFixture}=require('./helpers/ticket-assistant-fixture');
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
function setup(t) {
    const dom=new JSDOM('<div id="root"><div class="ta-layout"><header class="ta-header"><div class="ta-header-tools"></div></header></div></div>',{url:'https://jira.test/'});
    const window=dom.window,$=jquery(window),globals={window,document:window.document};
    const draft=loadUnit('draft').createDraft({projectKey:'DO'});draft.issueTypeId='10';draft.templateId='task';
    draft.fields={summary:'Проверить API <img src=x>',description:'Подробное описание'};
    draft.questions=[{id:'env',text:'В какой среде?',required:true}];draft.pendingFields={summary:'Предложенная тема'};
    const state={draft,meta:metadataFixture(),validation:{ok:false,fieldErrors:{description:['Нужны детали']}},settings:loadUnit('profiles').createDefaults()};
    const chatState={transcript:[],status:'idle',pendingTemplateProposal:null,canUndo:false};
    let opened=null,checks=0,creates=0,reconciles=0;
    const controller={getState:()=>state,check:()=>{checks++;},submit:()=>{creates++;}};
    const chat={getState:()=>chatState,reconcile:async()=>{reconciles++;}};
    const ui=loadUnit('chat-ui',{_ujgTA_icons:loadUnit('icons',{},globals)},globals).create({$,controller,chat,editor:{openEditor:invoker=>{opened=invoker;}}});
    ui.mount(window.document.querySelector('#root'));
    t.after(()=>{ui.destroy();window.close();});
    return {state,chatState,chat,ui,window,doc:window.document,opened:()=>opened,checks:()=>checks,creates:()=>creates,reconciles:()=>reconciles};
}
test('task card starts collapsed with safe theme, blockers and reachable actions; details exposes fields and proposals',async t=>{
    const h=setup(t),details=h.doc.querySelector('[data-ta-card-details]');
    assert.ok(details);assert.equal(details.open,false);
    const summary=details.querySelector('summary');assert.match(summary.textContent,/Проверить API <img src=x>/);assert.match(summary.textContent,/Нужны детали/);
    assert.match(summary.textContent,/обязательных вопросов: 1/i);assert.match(summary.textContent,/предложений: 1/i);
    assert.equal(summary.querySelectorAll('img').length,0);
    for(const selector of ['[data-ta-card-check]','[data-ta-card-edit]','[data-ta-card-create]','[data-ta-card-undo]']) {
        assert.ok(h.doc.querySelector(selector));assert.equal(details.contains(h.doc.querySelector(selector)),false);
    }
    details.open=true;details.dispatchEvent(new h.window.Event('toggle'));await tick();
    assert.match(details.textContent,/Подробное описание/);assert.match(details.textContent,/В какой среде/);assert.match(details.textContent,/Предложенная тема/);
    h.state.draft.fields.summary='Новая тема';h.ui.update(h.state);assert.equal(details.open,true);assert.match(summary.textContent,/Новая тема/);
});
test('card expansion is remembered per project and draft while new drafts start collapsed',async t=>{
    const h=setup(t),details=h.doc.querySelector('[data-ta-card-details]'),original=h.state.draft;
    details.open=true;details.dispatchEvent(new h.window.Event('toggle'));await tick();
    h.state.draft={...original,id:'second'};h.ui.update(h.state);assert.equal(details.open,false);
    h.state.draft=original;h.ui.update(h.state);assert.equal(details.open,true);
    details.open=false;details.dispatchEvent(new h.window.Event('toggle'));await tick();
    h.state.draft={...original,projectKey:'APP'};h.ui.update(h.state);assert.equal(details.open,false);
    h.state.draft=original;h.ui.update(h.state);assert.equal(details.open,false);
});
test('collapsed reconciliation uses chat API without sending composer, running check, creating or marking ready',async t=>{
    const h=setup(t),before=JSON.stringify(h.state.draft),button=h.doc.querySelector('[data-ta-card-check]');
    const input=h.doc.querySelector('[data-ta-chat-input]');input.value='Неотправленный текст';input.focus();input.setSelectionRange(2,2);
    assert.ok(button);assert.match(button.textContent,/Сверить с чатом/);button.click();button.click();await tick();
    assert.equal(h.reconciles(),1);assert.equal(h.opened(),null);assert.equal(input.value,'Неотправленный текст');assert.equal(input.selectionStart,2);
    assert.equal(h.checks(),0);assert.equal(h.creates(),0);assert.equal(JSON.stringify(h.state.draft),before);
    assert.equal(h.doc.querySelector('[data-ta-card-create]').disabled,true);
    h.chatState.status='running';h.ui.update(h.state);assert.equal(button.disabled,true);
    h.chatState.status='idle';h.state.draft.creation.status='unknown';h.ui.update(h.state);assert.equal(button.disabled,true);
});
test('required reporter and unsupported timetracking remain blocked with a clear editor route',t=>{
    const h=setup(t);h.state.validation={ok:false,unsupportedRequired:['timetracking'],fieldErrors:{reporter:['Автор обязателен.'],timetracking:['Учёт времени: неподдерживаемое обязательное поле. Откройте форму Jira.']}};
    h.ui.update(h.state);const summary=h.doc.querySelector('[data-ta-card-details] > summary');
    assert.match(summary.textContent,/Автор обязателен/);assert.match(summary.textContent,/неподдерживаемое обязательное поле/);
    assert.match(summary.textContent,/Редактировать.*Открыть форму Jira/);assert.doesNotMatch(summary.textContent,/Готово к созданию|права подтверждены/);
    assert.equal(h.doc.querySelector('[data-ta-card-create]').disabled,true);
    h.doc.querySelector('[data-ta-card-edit]').click();assert.equal(h.opened(),h.doc.querySelector('[data-ta-card-edit]'));
    assert.equal(h.checks(),0);assert.equal(h.creates(),0);
});
test('queued reconcile is inert after draft switch or destruction and never overlaps an active run',async t=>{
    for(const change of [h=>{h.state.draft={...h.state.draft,id:'replacement'};h.ui.update(h.state);},h=>h.ui.destroy(),h=>{h.chatState.status='running';}]) {
        const h=setup(t);h.doc.querySelector('[data-ta-card-check]').click();change(h);await tick();assert.equal(h.reconciles(),0);
    }
});
test('pending reconciliation blocks competing sends and preserves composer through chat updates',async t=>{
    const h=setup(t);let finish,sends=0,started=0;
    h.chat.reconcile=()=>{started++;return new Promise(resolve=>{finish=resolve;});};
    h.chat.send=async()=>{sends++;};
    const input=h.doc.querySelector('[data-ta-chat-input]'),button=h.doc.querySelector('[data-ta-card-check]');
    input.value='Неотправленный ответ';button.click();await tick();assert.equal(started,1);assert.equal(button.disabled,true);
    input.dispatchEvent(new h.window.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));await tick();assert.equal(sends,0);
    h.chatState.status='running';h.ui.update(h.state);assert.equal(input.value,'Неотправленный ответ');
    h.chatState.status='idle';finish();await tick();assert.equal(input.value,'Неотправленный ответ');assert.equal(button.disabled,false);
});
test('retry after reconciliation error reruns reconciliation without resending old message or overwriting composer',async t=>{
    const h=setup(t),input=h.doc.querySelector('[data-ta-chat-input]'),sent=[];let reconciles=0;
    h.chat.send=async text=>{sent.push(text);h.chatState.status='idle';h.chatState.error=null;};
    input.value='Ранее отправлено';input.dispatchEvent(new h.window.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));await tick();
    h.chat.reconcile=async()=>{reconciles++;h.chatState.status='error';h.chatState.error={action:'retry',message:'Повторите сверку'};};
    input.value='Неотправленные подробности';input.setSelectionRange(3,3);
    h.doc.querySelector('[data-ta-card-check]').click();await tick();
    const retry=h.doc.querySelector('[data-ta-chat-retry]');assert.equal(retry.hidden,false);retry.click();await tick();
    assert.equal(reconciles,2);assert.deepEqual(sent,['Ранее отправлено']);assert.equal(input.value,'Неотправленные подробности');assert.equal(input.selectionStart,3);
    h.doc.querySelector('[data-ta-card-edit]').click();h.ui.update(h.state);assert.equal(retry.hidden,true);
});
test('scope switch clears reconciliation retry while ordinary message retry retains its behavior',async t=>{
    const h=setup(t),input=h.doc.querySelector('[data-ta-chat-input]'),sent=[];let reconciles=0;
    h.chat.reconcile=async()=>{reconciles++;h.chatState.status='error';h.chatState.error={action:'retry'};};
    h.doc.querySelector('[data-ta-card-check]').click();await tick();
    h.state.draft={...h.state.draft,id:'other'};h.ui.update(h.state);
    const retry=h.doc.querySelector('[data-ta-chat-retry]');assert.equal(retry.hidden,true);retry.click();await tick();assert.equal(reconciles,1);
    h.chat.send=async text=>{sent.push(text);h.chatState.status='error';h.chatState.error={action:'retry'};};
    input.value='Новый запрос';input.dispatchEvent(new h.window.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));await tick();
    assert.equal(retry.hidden,false);retry.click();await tick();assert.deepEqual(sent,['Новый запрос','Новый запрос']);assert.equal(reconciles,1);
});
test('explicit facts/question history collapses only facts without losing text or hiding the question',t=>{
    const h=setup(t),facts='Известные факты:\n1. Ошибка в ENV (DEV: тестовая среда).\n2. Инструменты: ["update_task"]';
    h.chatState.transcript=[{id:'old',role:'assistant',text:facts+'\nВопрос: Когда появилась ошибка?'}];h.ui.update(h.state);
    const row=h.doc.querySelector('[data-ta-message="old"]'),details=row.querySelector('[data-ta-message-facts]');
    assert.ok(details);assert.equal(details.open,false);assert.equal(details.querySelector('[data-ta-message-facts-text]').textContent,facts+'\n');
    assert.equal(row.querySelector('[data-ta-message-question]').textContent,'Вопрос: Когда появилась ошибка?');
    assert.equal(details.contains(row.querySelector('[data-ta-message-question]')),false);
});
test('ordinary replies, user text and exact templates keep their existing rendering',t=>{
    const h=setup(t),text='Известные факты:\nТочный текст\nВопрос: Кто?';
    h.chatState.transcript=[{id:'ordinary',role:'assistant',text:'**Ответ:** всё сохранено.'},{id:'user',role:'user',text},{id:'template',role:'assistant',kind:'template',text}];h.ui.update(h.state);
    assert.equal(h.doc.querySelectorAll('[data-ta-message-facts]').length,0);
    assert.equal(h.doc.querySelector('[data-ta-template-read]').textContent,text);assert.equal(h.doc.querySelector('[data-ta-message="ordinary"] strong').textContent,'Ответ:');
});
test('bold explicit facts/question headings collapse saved facts and preserve their rendering',t=>{
    const h=setup(t),facts='**Известные факты:**\n1. Literal <b>text</b> и **важная деталь**.\n';
    h.chatState.transcript=[{id:'saved',role:'assistant',text:facts+'**Вопрос:** Когда?'}];h.ui.update(h.state);
    const row=h.doc.querySelector('[data-ta-message="saved"]'),details=row.querySelector('[data-ta-message-facts]');
    assert.ok(details);assert.equal(details.open,false);
    assert.equal(details.querySelector('[data-ta-message-facts-text]').textContent,'Известные факты:\n1. Literal <b>text</b> и важная деталь.\n');
    assert.equal(details.querySelector('b'),null);assert.equal(details.querySelector('strong').textContent,'Известные факты:');
    assert.equal(row.querySelector('[data-ta-message-question]').textContent,'Вопрос: Когда?');
});
test('quoted, fenced, embedded and template facts headings remain unsplit with all text retained',t=>{
    const h=setup(t),text='**Известные факты:**\nПолный текст\n**Вопрос:** Кто?';
    const values=['> '+text.replaceAll('\n','\n> '),'"'+text+'"','```\n'+text+'\n```','Пример:\n'+text];
    h.chatState.transcript=values.map((value,i)=>({id:'quoted'+i,role:'assistant',text:value})).concat([{id:'literal-template',role:'assistant',kind:'template',text}]);h.ui.update(h.state);
    assert.equal(h.doc.querySelectorAll('[data-ta-message-facts]').length,0);
    for(let i=0;i<values.length;i++)assert.match(h.doc.querySelector('[data-ta-message="quoted'+i+'"] .ta-message-text').textContent,/Полный текст/);
    assert.equal(h.doc.querySelector('[data-ta-template-read]').textContent,text);
});
