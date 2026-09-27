const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const load=require('./helpers/load-amd-module'),dir=path.join(__dirname,'../ujg-excel-story-importer-modules');
async function setup() {
 const app={},calls=[],config=load(path.join(dir,'config.js'),{});
 const raw=key=>({key,fields:{summary:key,created:'2026-09-27T10:00:00Z',issuelinks:key==='PR-1'?[{type:{name:'Child',outward:'is parent of',inward:'is child of'},outwardIssue:{key:'PR-2'}}]:[],subtasks:[],comment:{total:0,comments:[]},worklog:{total:0,worklogs:[]}},changelog:{total:0,histories:[]}});
 const reader={plan:['GET /search'],requests:[],readStories:async start=>({startAt:start,total:1,issues:[{key:'PR-1'}]}),readIssue:async key=>{calls.push(key);return raw(key);},readPage:async()=>{throw Error('Unexpected page');}};
 const Gadget=load(path.join(dir,'main.js'),{jquery:()=>({length:0}),_ujgESI_config:config,_ujgESI_api:{getProjects:async()=>[]},'_ujgESI_excel-loader':{},_ujgESI_parser:{},_ujgESI_creator:{},_ujgESI_mappingStore:null,_ujgESI_xlsxPatcher:null,
 _ujgESI_teams:null,_ujgESI_activity:null,_ujgESI_deadlines:load(path.join(dir,'deadlines.js'),{}),_ujgESI_dueDateSync:null,_ujgESI_componentSync:null,_ujgESI_activityLoader:require('./helpers/import-activity-loader'),_ujgESI_remarkReportLoader:null,_ujgShared_llmClient:null,
 _ujgESI_sourceExport:load(path.join(dir,'source-export.js'),{}),_ujgESI_sourceExportApi:{create:scope=>{calls.push(scope.projectKey);return reader;}},_ujgESI_rendering:{init:(_,cb)=>app.cb=cb,render:s=>app.state=s}});
 new Gadget({getGadgetContentEl:()=>({find:()=>({length:1})}),resize(){}});await new Promise(r=>setImmediate(r));app.state.projectKey='P';return {app,calls,reader};
}
test('source export reads fresh complete project parents, not displayed row filter; no synthetic Excel',async()=>{
 const x=await setup();x.app.state.rows=[];x.app.state.viewMode='jira';
 assert.deepEqual(Array.from(x.app.cb.onSourceExportPlan()),['GET /search']);
 const result=await x.app.cb.onLoadSourceExport({});
 assert.deepEqual(Array.from(result.issues.map(i=>i.key)),['PR-1','PR-2']);assert.equal(result.coverage.complete,true);assert.equal(result.journalRows.length,0);assert.equal(x.app.state.rows.length,0);
});
test('source export cancels upon dataset/scope switch and never continues child reads',async()=>{
 const x=await setup(),read=x.reader.readIssue;x.reader.readIssue=async key=>{x.app.state.projectKey='OTHER';return read(key);};
 await assert.rejects(x.app.cb.onLoadSourceExport({}),/отмен/);assert.ok(!x.calls.includes('PR-2'));
});
