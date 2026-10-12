const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const load = require('./helpers/load-amd-module');
const dir=path.join(__dirname,'../ujg-excel-story-importer-modules');
const flush=()=>new Promise(r=>setTimeout(r,0));
const plain=x=>JSON.parse(JSON.stringify(x));
function issue(key, assignee='new') { return {key,fields:{summary:key,status:{name:'Testing',statusCategory:{key:'indeterminate'}},assignee:{name:assignee,displayName:assignee},resolution:null,updated:'2026-10-12',description:'Actual',issuelinks:[],issuetype:{name:'Story'}},changelog:{histories:[]}}; }
async function setup() {
  const app={reads:[],writes:[]};
  const api={getProjects:()=>Promise.resolve([]),getProjectEpics:()=>Promise.resolve({issues:[]}),getProjectCreateMeta:()=>Promise.resolve({projects:[]}),
    getProjectIssues:()=>Promise.resolve({issues:[issue('TEST-1','old')]}),getIssuesByKeys:()=>Promise.resolve({issues:[]}),
    getIssueTransitions:key=>{app.reads.push(key);return Promise.resolve({transitions:[{id:'21',name:'Testing',to:{id:'3',name:'Testing'},fields:{}}]});},
    transitionIssue:(key,id)=>{app.writes.push([key,id]);return Promise.resolve();},getIssueWithHistory:key=>Promise.resolve(issue(key))};
  const Gadget=load(path.join(dir,'main.js'),{
    jquery:()=>({length:0}),_ujgESI_config:load(path.join(dir,'config.js'),{}),_ujgESI_api:api,
    '_ujgESI_excel-loader':{readFileBuffer:()=>Promise.resolve(new ArrayBuffer(1)),readWorkbookFromBuffer:()=>Promise.resolve({SheetNames:['Sheet1']})},
    _ujgESI_parser:{parseWorkbook:()=>({sheetName:'Sheet1',rows:[{id:'1',jiraKey:'TEST-1',sourceColumns:{'Ответственный':'Excel Owner'},ownerIdentifiers:['excel'],storyDetails:{key:'TEST-1',status:'Open'},childStatuses:[{key:'TEST-2',role:'QA',status:'Open',linkedToParent:false}]}]})},
    _ujgESI_creator:{},_ujgESI_mappingStore:null,_ujgESI_xlsxPatcher:{},_ujgShared_llmClient:null,_ujgESI_teams:null,_ujgESI_activity:null,
    _ujgESI_activityLoader:require('./helpers/import-activity-loader'),_ujgESI_deadlines:load(path.join(dir,'deadlines.js'),{}),
    _ujgESI_dueDateSync:null,_ujgESI_componentSync:null,_ujgESI_remarkReportLoader:null,_ujgESI_sourceExport:null,_ujgESI_sourceExportApi:null,
    _ujgESI_statusTransition:load(path.join(dir,'status-transition.js'),{}),
    _ujgESI_rendering:{init:(_,cb)=>app.cb=cb,render:s=>app.state=s,renderStatusTransition:s=>app.state=s}
  });
  new Gadget({getGadgetContentEl:()=>({find:()=>({length:1})}),resize(){}}); await flush();
  app.cb.onFileChange({name:'original.xlsx'}); await flush(); await flush(); app.cb.onProjectChange('TEST'); await flush();
  return {...app,api,ref:app};
}
test('status hooks update actual Story details in both sets, retaining Excel ownership and source file', async () => {
  const a=await setup(),cb=a.cb;
  assert.equal(typeof cb.onOpenStatusTransition,'function');
  const excel=a.state.rows[0], oldDetails=excel.storyDetails, oldCols=plain(excel.sourceColumns), originalFile=a.state.sourceFileName;
  cb.onViewModeChange('jira'); cb.onLoadRegistry(); await flush(); await flush();
  const jira=a.state.rows[0];
  await cb.onOpenStatusTransition({key:'TEST-1'}); cb.onSelectStatusTransition('21'); await cb.onApplyStatusTransition();
  assert.equal(excel.storyDetails.status,'Testing'); assert.equal(oldDetails.status,'Open');
  assert.equal(excel.storyDetails.assignee,'new'); assert.deepEqual(plain(excel.sourceColumns),oldCols);
  assert.deepEqual(plain(excel.ownerIdentifiers),['excel']); assert.equal(a.state.sourceFileName,originalFile);
  assert.equal(jira.storyDetails.assignee,'new'); assert.deepEqual(plain(jira.ownerIdentifiers),['new']);
  assert.equal(jira.sourceColumns['Ответственный'],'new'); assert.equal(jira.sourceColumns['Исполнитель в Jira'],'new');
  assert.equal(jira.storyDetails.resolution,null);
});
test('child hook targets exact child and preserves its link/role metadata', async () => {
  const a=await setup(),cb=a.cb; assert.equal(typeof cb.onOpenStatusTransition,'function');
  const row=a.state.rows[0], child=row.childStatuses[0];
  await cb.onOpenStatusTransition({key:'TEST-2'}); cb.onSelectStatusTransition('21'); await cb.onApplyStatusTransition();
  assert.deepEqual(a.writes,[['TEST-2','21']]); assert.equal(child.status,'Open');
  assert.equal(row.childStatuses[0].status,'Testing'); assert.equal(row.childStatuses[0].role,'QA');
  assert.equal(row.childStatuses[0].linkedToParent,false); assert.equal(row.storyDetails.status,'Open');
});
test('loads block open/apply; in-flight Apply blocks file/project/view changes and registry reads', async () => {
  const a=await setup(),cb=a.cb; assert.equal(typeof cb.onOpenStatusTransition,'function');
  a.state.registryLoading=true; await cb.onOpenStatusTransition({key:'TEST-1'}); assert.equal(a.reads.length,0); a.state.registryLoading=false;
  await cb.onOpenStatusTransition({key:'UNKNOWN-1'}); assert.equal(a.reads.length,0);
  await cb.onOpenStatusTransition({key:'TEST-1'}); cb.onSelectStatusTransition('21');
  a.state.syncLoading=true; await cb.onApplyStatusTransition(); assert.equal(a.writes.length,0); a.state.syncLoading=false;
  let resolve; a.api.transitionIssue=()=>new Promise(r=>resolve=r);
  const pending=cb.onApplyStatusTransition(); await flush();
  cb.onProjectChange('OTHER');cb.onFileChange({name:'other.xlsx'});cb.onViewModeChange('jira');cb.onLoadRegistry();
  assert.equal(a.state.projectKey,'TEST'); assert.equal(a.state.sourceFileName,'original.xlsx');assert.equal(a.state.viewMode,'excel');
  resolve();await pending;
});
