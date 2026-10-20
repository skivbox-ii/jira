const test = require('node:test');
const assert = require('node:assert/strict');
const {loadUnit} = require('./helpers/ticket-assistant-fixture');
const fields = loadUnit('fields');
const validation = loadUnit('validation', {_ujgTA_fields: fields});
function raw() {
    return {projects:[{key:'DO',id:'1',issuetypes:[{id:'10',fields:{
        customfield_923:{name:'Localized epic',schema:{type:'any',custom:'com.pyxis.greenhopper.jira:gh-epic-link'}},
        customfield_847:{name:'Localized sprint',schema:{type:'array',items:'string',custom:'com.pyxis.greenhopper.jira:gh-sprint'}},
        customfield_123:{name:'Story Points',schema:{type:'number',custom:'com.atlassian.jira.plugin.system.customfieldtypes:float'}},
        customfield_456:{name:'Sprint',schema:{type:'array',items:'string',custom:'unknown:sprint'}}
    }}]}]};
}
test('dynamic schema IDs distinguish relations, real numeric estimates and unknown plugins',()=>{
    const meta=fields.normalizeMeta(raw(),'DO');
    assert.equal(fields.getField(meta,'10','customfield_923').kind,'epic');
    assert.equal(fields.getField(meta,'10','customfield_847').kind,'sprint');
    assert.equal(fields.getField(meta,'10','customfield_123').kind,'number');
    assert.equal(fields.getField(meta,'10','customfield_456').supported,false);
});
test('relation payloads require confirmed canonical values and preserve manual numeric estimates',async()=>{
    const meta=fields.normalizeMeta(raw(),'DO'), values={customfield_923:'DO-42',customfield_847:73,customfield_123:0.5};
    assert.equal(validation.validateFields(meta,'10',values,{}).ok,false);
    const api={getEpic:async(project,key)=>({id:key,label:'Epic'}),getSprint:async(project,id)=>({id:String(id),label:'Sprint'})};
    const confirmations=await fields.confirmRelations(meta,'10',values,api,{});
    const payload=validation.buildCreatePayload(meta,'10',values,{relations:confirmations});
    assert.equal(payload.fields.customfield_923,'DO-42'); assert.equal(payload.fields.customfield_847,73);
    assert.equal(payload.fields.customfield_123,0.5);
    for(const value of ['73',{id:'73'},-1,1.5]) assert.equal(validation.validateFields(meta,'10',{customfield_847:value},{relations:confirmations}).ok,false);
    assert.equal(validation.validateFields(meta,'10',{customfield_923:'APP-42'},{relations:confirmations}).ok,false);
    assert.equal(meta.signature,fields.normalizeMeta(raw(),'DO').signature);
});
test('relation confirmation honors explicit create-screen restrictions even for partial catalogs',async()=>{
    const source=raw(); source.projects[0].issuetypes[0].fields.customfield_923.allowedValues=[{key:'DO-42'}];
    let reads=0;const api={getEpic:async()=>{reads++;return {id:'DO-43'};}};
    const meta=fields.normalizeMeta(source,'DO');
    await assert.rejects(fields.confirmRelations(meta,'10',{customfield_923:'DO-43'},api,{})); assert.equal(reads,0);
    source.projects[0].issuetypes[0].fields.customfield_923.optionsComplete=false;
    await assert.rejects(fields.confirmRelations(fields.normalizeMeta(source,'DO'),'10',{customfield_923:'DO-43'},api,{})); assert.equal(reads,0);
    source.projects[0].issuetypes[0].fields.customfield_923.operations=['add'];
    await assert.rejects(fields.confirmRelations(fields.normalizeMeta(source,'DO'),'10',{customfield_923:'DO-43'},api,{})); assert.equal(reads,0);
});
