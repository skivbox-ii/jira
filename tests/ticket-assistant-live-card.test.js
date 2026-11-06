const test=require('node:test');
const assert=require('node:assert/strict');
const {liveFixture}=require('./helpers/ticket-assistant-live-card-fixture');
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
function exposed(el){return !!el && !el.closest('[hidden],details:not([open])');}
test('chat immediately hosts the existing editable Jira fields in one live card and one Create action',async t=>{
    const h=await liveFixture(t),card=h.doc.querySelector('[data-ta-task-card]'),summary=card.querySelector('[data-ta-field="summary"] input');
    assert.ok(summary);assert.equal(summary,h.originalSummary);assert.equal(exposed(summary),true);assert.equal(summary.disabled,false);
    assert.equal(h.doc.querySelectorAll('[data-ta-field="summary"]').length,1);assert.equal(h.doc.querySelectorAll('[data-ta-create],[data-ta-card-create]').length,1);
    assert.equal(h.doc.querySelector('.ta-chat').parentElement,card.parentElement);assert.equal(h.doc.querySelector('[data-ta-editor-panel]').hidden,true);
    assert.equal(h.doc.querySelector('[data-ta-card-edit]').hidden,true);assert.equal(h.doc.querySelector('[data-ta-card-check]').hidden,true);assert.equal(h.doc.querySelector('[data-ta-card-local-check]').hidden,true);
    summary.value='Ручная тема';summary.dispatchEvent(new h.window.Event('input',{bubbles:true}));assert.equal(h.controller.getState().draft.fields.summary,'Ручная тема');assert.equal(h.controller.getState().draft.protectedFields.summary,true);
    summary.focus();summary.setSelectionRange(3,3);const composer=h.doc.querySelector('[data-ta-chat-input]');composer.value='Неотправленное сообщение';h.chatUi.update(h.controller.getState());
    assert.equal(h.doc.activeElement,summary);assert.equal(summary.selectionStart,3);assert.equal(composer.value,'Неотправленное сообщение');
});
test('manual field protection, proposals, local verification and one explicit create reuse the live editor',async t=>{
    const h=await liveFixture(t),summary=h.doc.querySelector('[data-ta-field="summary"] input');assert.ok(h.doc.querySelector('[data-ta-live-editor]'));
    summary.value='Ручная тема';summary.dispatchEvent(new h.window.Event('input',{bubbles:true}));
    await h.controller.chatUpdate({fields:{summary:'Тема модели',description:'Проверить вход на DEV.'},questions:[]},h.controller.chatSnapshot());
    assert.equal(summary.value,'Ручная тема');assert.equal(exposed(h.doc.querySelector('[data-ta-field="summary"] .ta-pending')),true);
    h.doc.querySelector('[data-ta-reject="summary"]').click();await tick();
    const check=h.doc.querySelector('[data-ta-card-local-check]');assert.equal(check.hidden,false);check.click();await tick();await tick();
    assert.ok(h.controller.getState().draft.checked);assert.equal(h.doc.querySelector('[data-ta-card-create]').disabled,false);assert.equal(check.hidden,true);
    let creates=0;h.api.createIssue=async()=>{creates++;return {id:'1',key:'DO-1'};};h.doc.querySelector('[data-ta-card-create]').click();await tick();await tick();
    assert.equal(creates,1);assert.equal(h.controller.getState().draft.creation.issueKey,'DO-1');assert.equal(summary.disabled,true);
});
test('429 fallback keeps the live card editable and ready, with recovery actions available only when needed',async t=>{
    const h=await liveFixture(t);assert.ok(h.doc.querySelector('[data-ta-live-editor]'));await h.chat.send('Восстановить доступ на DEV. Проверить вход по RDP.');
    assert.equal(h.doc.querySelector('[data-ta-chat-rate-retry]').hidden,false);assert.equal(h.doc.querySelector('[data-ta-card-create]').disabled,false);
    assert.equal(h.doc.querySelector('[data-ta-card-check]').hidden,true);assert.equal(h.doc.querySelector('[data-ta-card-local-check]').hidden,true);
    h.ui.openEditor();assert.equal(h.doc.querySelector('[data-ta-editor-panel]').hidden,true);
    assert.ok(h.doc.querySelector('[data-ta-live-editor]').contains(h.doc.activeElement));
    const snapshot=h.controller.chatSnapshot();await h.controller.chatUpdate({fields:{},questions:[]},snapshot);
    assert.equal(h.doc.querySelector('[data-ta-card-create]').disabled,true);
});
test('semantic questions remain visible beside live fields and template proposals stay reachable',async t=>{
    const h=await liveFixture(t);await h.controller.chatUpdate({fields:{description:'Известные факты'},questions:[{id:'window',text:'Какое окно согласовано?',required:true}]},h.controller.chatSnapshot());
    const questions=h.doc.querySelector('[data-ta-card-questions]');assert.equal(exposed(questions),true);assert.match(questions.textContent,/Какое окно/);
    h.setPrompt(async config=>{await config.tools.find(t=>t.name==='propose_template_change').execute({changes:{instructions:'Новые правила'}},{});});
    await h.chat.send('Измени шаблон: новые правила');const proposal=h.doc.querySelector('[data-ta-template-proposal]');assert.equal(exposed(proposal),true);
    h.doc.querySelector('[data-ta-template-reject]').focus();h.doc.querySelector('[data-ta-template-reject]').click();await tick();assert.equal(proposal.hidden,true);assert.equal(h.doc.activeElement,h.doc.querySelector('[data-ta-chat-input]'));
});
async function addPriority(h,{hasDefaultValue=true,defaultValue={id:'3'},optionsComplete=true}={}) {
    const read=h.api.getCreateMeta;h.api.getCreateMeta=async key=>{const raw=await read(key);raw.projects[0].issuetypes.forEach(type=>{type.fields.priority={name:'Приоритет',schema:{type:'priority',system:'priority'},hasDefaultValue,defaultValue,optionsComplete,allowedValues:[{id:'2',name:'Высокий'},{id:'3',name:'Обычный'},{id:'4',name:'Низкий'}]};});return raw;};await h.controller.selectProject('DO');
}
test('priority is pinned in the primary editor and displays only the actual Jira default without mutating the draft',async t=>{
    const h=await liveFixture(t);await addPriority(h);const row=h.doc.querySelector('[data-ta-field="priority"]');assert.equal(row.parentElement.hasAttribute('data-ta-fields'),true);
    assert.equal(exposed(row),true);assert.match(row.querySelector('[data-ta-picker]').textContent,/Обычный/);assert.match(row.textContent,/умолчанию Jira/);
    assert.equal(Object.hasOwn(h.controller.getState().draft.fields,'priority'),false);assert.equal(h.controller.getState().draft.protectedFields.priority,undefined);
    row.querySelector('[data-ta-picker]').click();const choices=row.querySelectorAll('[data-ta-candidate]');assert.equal(choices.length,2);choices[0].click();
    assert.equal(h.controller.getState().draft.fields.priority.id,'2');assert.equal(h.controller.getState().draft.protectedFields.priority,true);assert.match(row.querySelector('[data-ta-picker]').textContent,/Высокий/);assert.doesNotMatch(row.textContent,/умолчанию Jira/);
    await h.controller.updateField('priority',null);assert.doesNotMatch(row.querySelector('[data-ta-picker]').textContent,/Обычный/);
});
for(const config of [{hasDefaultValue:false},{defaultValue:{id:'missing'}},{defaultValue:null}])test('unverified priority default is never shown: '+JSON.stringify(config),async t=>{
    const h=await liveFixture(t);await addPriority(h,config);const row=h.doc.querySelector('[data-ta-field="priority"]');assert.equal(exposed(row),true);assert.doesNotMatch(row.querySelector('[data-ta-picker]').textContent,/Обычный/);assert.equal(h.controller.getState().draft.fields.priority,undefined);
});

test('legacy form also pins priority and preserves explicit protected values instead of reapplying defaults',async t=>{
    const h=await liveFixture(t,{legacy:true});await addPriority(h);const row=h.doc.querySelector('[data-ta-field="priority"]');
    assert.equal(exposed(row),true);assert.match(row.querySelector('[data-ta-picker]').textContent,/Обычный/);assert.equal(h.controller.getState().draft.fields.priority,undefined);
    await h.controller.updateField('priority',{id:'4'});h.ui.update(h.controller.getState());assert.match(row.querySelector('[data-ta-picker]').textContent,/Низкий/);
    assert.equal(h.controller.getState().draft.protectedFields.priority,true);assert.doesNotMatch(row.textContent,/умолчанию Jira/);
});
test('editing the live card during a slow model turn cancels stale writes without replacing the composer',async t=>{
    const h=await liveFixture(t);let finish;
    h.setPrompt(async config=>{await new Promise(resolve=>{finish=resolve;});await config.tools.find(t=>t.name==='update_task').execute({fields:{summary:'Поздняя тема',description:'Поздний ответ модели'},questions:[]},{});});
    const pending=h.chat.send('Восстановить доступ на DEV.');await tick();assert.equal(h.chat.getState().status,'running');
    const composer=h.doc.querySelector('[data-ta-chat-input]');composer.value='Следующее сообщение';const summary=h.doc.querySelector('[data-ta-live-editor] [data-ta-field="summary"] input');assert.equal(summary.disabled,false);
    summary.value='Человек редактирует';summary.dispatchEvent(new h.window.Event('input',{bubbles:true}));finish();await pending;
    assert.equal(h.controller.getState().draft.fields.summary,'Человек редактирует');assert.equal(h.controller.getState().draft.protectedFields.summary,true);assert.equal(composer.value,'Следующее сообщение');
    assert.doesNotMatch(h.chat.getState().transcript.map(m=>m.text).join(' '),/Поздняя тема|Поздний ответ модели/);
});
