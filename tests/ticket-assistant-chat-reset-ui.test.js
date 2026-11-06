const test=require('node:test');
const assert=require('node:assert/strict');
const {liveFixture}=require('./helpers/ticket-assistant-live-card-fixture');
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
const inputEvent=(h,el)=>el.dispatchEvent(new h.window.Event('input',{bubbles:true}));
test('header reset has a visible text label and clears the current composer only after successful reset',async t=>{
    const h=await liveFixture(t),button=h.doc.querySelector('[data-ta-chat-new]');assert.equal(button.textContent,'Очистить');assert.equal(button.classList.contains('ta-icon-button'),false);
    await h.controller.updateField('summary','Удалить тему');const before=h.controller.getState().draft,composer=h.doc.querySelector('[data-ta-chat-input]');composer.value='Удалить ввод';
    button.click();button.click();await tick();await tick();const after=h.controller.getState().draft;assert.notEqual(after.id,before.id);assert.equal(after.issueTypeId,before.issueTypeId);assert.equal(after.templateId,before.templateId);assert.equal(after.fields.summary,undefined);assert.equal(composer.value,'');assert.equal(h.doc.activeElement,composer);
});
test('a failed clear retains fields and unsent input and exposes the action failure',async t=>{
    const h=await liveFixture(t);await h.controller.updateField('summary','Не терять тему');const before=h.controller.getState().draft;
    h.controller.discardDraft=async()=>{throw Error('storage unavailable');};const composer=h.doc.querySelector('[data-ta-chat-input]');composer.value='Не терять ввод';h.doc.querySelector('[data-ta-chat-new]').click();await tick();await tick();
    assert.equal(h.controller.getState().draft.id,before.id);assert.equal(h.controller.getState().draft.fields.summary,'Не терять тему');assert.equal(composer.value,'Не терять ввод');assert.equal(h.doc.querySelector('[data-ta-chat-error]').hidden,false);
});
test('reset settles the UI even when the stopped model promise has not returned',async t=>{
    const h=await liveFixture(t);let finish;h.setPrompt(()=>new Promise(resolve=>{finish=resolve;}));
    const composer=h.doc.querySelector('[data-ta-chat-input]');composer.value='Старое сообщение';composer.dispatchEvent(new h.window.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));await tick();
    const before=h.controller.getState().draft;h.doc.querySelector('[data-ta-chat-new]').click();await tick();await tick();assert.notEqual(h.controller.getState().draft.id,before.id);
    composer.value='Следующее сообщение';inputEvent(h,composer);assert.equal(h.doc.querySelector('[data-ta-chat-send]').disabled,false);
    finish();await tick();assert.equal(composer.value,'Следующее сообщение');assert.equal(h.doc.querySelectorAll('[data-ta-message]').length,0);
});
test('reset aborts an in-flight local check and suppresses its stale result',async t=>{
    const h=await liveFixture(t);await h.controller.updateField('summary','Тема');await h.controller.updateField('description','Описание');let finish,signal;
    h.controller.chatValidate=async(_snapshot,request)=>{signal=request.signal;return new Promise(resolve=>{finish=resolve;});};
    h.doc.querySelector('[data-ta-card-local-check]').click();await tick();h.doc.querySelector('[data-ta-chat-new]').click();await tick();await tick();assert.equal(signal.aborted,true);
    const composer=h.doc.querySelector('[data-ta-chat-input]');composer.value='Новый ввод';inputEvent(h,composer);assert.equal(h.doc.querySelector('[data-ta-chat-send]').disabled,false);
    finish({code:'metadata'});await tick();assert.equal(composer.value,'Новый ввод');assert.equal(h.doc.querySelector('[data-ta-chat-error]').hidden,true);
});
