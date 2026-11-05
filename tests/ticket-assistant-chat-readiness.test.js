const test=require('node:test');
const assert=require('node:assert/strict');
const {harness}=require('./helpers/ticket-assistant-chat-fixture');
test('chat requires nonblank writable description even when Jira metadata makes it optional',async t=>{
    const h=await harness();t.after(()=>h.controller.destroy());
    await h.controller.updateField('summary','Проверить доступ');
    for(const description of [undefined,'','   \n ']) {
        if(description!==undefined)await h.controller.updateField('description',description);
        const result=await h.controller.chatValidate(h.controller.chatSnapshot());
        assert.equal(result.ok,false);assert.match(result.validation.fieldErrors.description.join(' '),/описан|description/i);
        assert.equal(h.controller.getState().draft.checked,null);
    }
});
test('chat cannot mark protected replacements ready until the user accepts or rejects them',async t=>{
    const h=await harness();t.after(()=>h.controller.destroy());const c=h.controller;
    await c.updateField('summary','Ручная тема');await c.updateField('description','Проверить доступ к DEV.');
    await c.chatUpdate({fields:{summary:'Предложенная тема'},questions:[]},c.chatSnapshot());
    const result=await c.chatValidate(c.chatSnapshot());
    assert.equal(result.ok,false);assert.equal(c.getState().draft.checked,null);
    assert.match(result.validation.fieldErrors.summary.join(' '),/предлож|подтверд|отклон/i);
    await c.rejectField('summary');assert.equal((await c.chatValidate(c.chatSnapshot())).ok,true);
    assert.equal(c.getState().draft.fields.summary,'Ручная тема');
});
test('accepting a proposed description permits checking the accepted canonical value',async t=>{
    const h=await harness();t.after(()=>h.controller.destroy());const c=h.controller;
    await c.updateField('summary','Проверить доступ');await c.updateField('description','Проверить DEV.');
    await c.chatUpdate({fields:{description:'Проверить RDP-доступ к стенду DEV.'},questions:[]},c.chatSnapshot());
    assert.equal((await c.chatValidate(c.chatSnapshot())).ok,false);
    await c.acceptField('description');assert.equal((await c.chatValidate(c.chatSnapshot())).ok,true);
    assert.equal(c.getState().draft.fields.description,'Проверить RDP-доступ к стенду DEV.');
});
for(const writable of [false,null])test('chat does not require a description absent from the writable Jira fields: '+writable,async t=>{
    const h=await harness();t.after(()=>h.controller.destroy());const c=h.controller;
    const read=h.api.getCreateMeta;
    h.api.getCreateMeta=async(...args)=>{const raw=await read(...args);for(const type of raw.projects[0].issuetypes){
        if(writable===null)delete type.fields.description;else type.fields.description.operations=[];
    }return raw;};
    await c.selectProject('DO');await c.updateField('summary','Проверить доступ');
    assert.equal((await c.chatValidate(c.chatSnapshot())).ok,true);
});
