const {loadUnit,memoryStorage,metadataFixture}=require('./ticket-assistant-fixture');
const plain=x=>JSON.parse(JSON.stringify(x));
async function harness(backend = memoryStorage()) {
    const drafts=loadUnit('draft'), profiles=loadUnit('profiles'), fields=loadUnit('fields');
    const validation=loadUnit('validation',{_ujgTA_fields:fields});
    const storage=loadUnit('storage',{_ujgTA_profiles:profiles,_ujgTA_draft:drafts});
    const store=storage.createStore({storage:backend,userKey:'alice',origin:'https://jira.test'});
    const schema={string:{type:'string',system:'summary'},textarea:{type:'string',system:'description'},user:{type:'user'},number:{type:'number'},option:{type:'option'},components:{type:'array',items:'component'},versions:{type:'array',items:'version'},labels:{type:'array',items:'string'},date:{type:'date'},datetime:{type:'datetime'}};
    const api={getCurrentUser:async()=>({key:'alice'}),getProjects:async()=>({values:[{key:'DO',id:'DO-project'},{key:'APP',id:'APP-project'}]}),
        getCreateMeta:async key=>({projects:[{key,id:key+'-project',issuetypes:metadataFixture(key).issueTypes.map(t=>({id:t.id,name:t.name,fields:Object.fromEntries(t.fields.map(f=>[f.id,{name:f.name,required:f.required,schema:{...(schema[f.kind]||{type:'unsupported'}),system:f.id,...(f.id.startsWith('customfield_')?{custom: f.kind==='option'?'com.atlassian.jira.plugin.system.customfieldtypes:select': f.kind==='number'?'com.atlassian.jira.plugin.system.customfieldtypes:float': f.kind==='textarea'?'com.atlassian.jira.plugin.system.customfieldtypes:textarea':''}:{})},...(f.kind==='option'?{allowedValues:f.allowedValues.map(v=>({id:v.id,value:v.label}))}:{})}]))}))}]}),
        getComponents:async key=>({projectKey:key,values:[{id:key+'-9',name:'Backend'}],complete:true}),getVersions:async key=>({projectKey:key,values:[],complete:true})};
    const creator=loadUnit('creator',{_ujgTA_draft:drafts,_ujgTA_fields:fields,_ujgTA_validation:validation});
    const Controller=loadUnit('controller',{_ujgTA_draft:drafts,_ujgTA_profiles:profiles,_ujgTA_fields:fields,_ujgTA_validation:validation,_ujgTA_creator:creator},{AbortController});
    const controller=Controller.create({api,ai:{},createStore:()=>store});
    await controller.init();await controller.selectProject('DO');await controller.selectIssueType('10');await controller.selectTemplate('task');
    return {controller,store,drafts,fields,validation,api,backend};
}
module.exports={harness,plain};
