const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const load=require('./helpers/load-amd-module'),dir=path.join(__dirname,'../ujg-excel-story-importer-modules');
const flush=()=>new Promise(r=>setImmediate(r));
function deferred() { let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject}; }
function issue(key,status='Open') { return {key,fields:{summary:'Same summary',status:{name:status},assignee:{displayName:'Jira Owner'},issuelinks:[],issuetype:{name:'Story'}},changelog:{histories:[]}}; }
async function setup() {
  const a={};a.api={getProjects:()=>Promise.resolve([]),getProjectEpics:()=>Promise.resolve({issues:[]}),getProjectCreateMeta:()=>Promise.resolve({projects:[]}),
    getProjectIssues:()=>Promise.resolve({issues:[issue('P-1')]}),getIssuesByKeys:()=>Promise.resolve({issues:[issue('P-1')]}),searchIssueBySummary:()=>Promise.resolve({issues:[issue('P-1')]})};
  a.patcher={patchWorkbook:()=>Promise.resolve(new ArrayBuffer(2))};
  const Gadget=load(path.join(dir,'main.js'),{jquery:()=>({length:0}),_ujgESI_config:load(path.join(dir,'config.js'),{}),_ujgESI_api:a.api,
    '_ujgESI_excel-loader':{readFileBuffer:()=>Promise.resolve(new ArrayBuffer(1)),readWorkbookFromBuffer:()=>Promise.resolve({SheetNames:['Sheet1']})},
    _ujgESI_parser:{extractJiraKey:value=>/^P-\d+$/.test(value)?value:'',parseWorkbook:()=>({sheetName:'Sheet1',rows:[{id:'1',jiraKey:'P-1',summary:'Same summary',sourceColumns:{'Ответственный':'Excel Owner'},storyDetails:{key:'P-1',status:'Old'},createdChildren:[]}]})},
    _ujgESI_creator:{},_ujgESI_mappingStore:null,_ujgESI_xlsxPatcher:a.patcher,_ujgShared_llmClient:null,_ujgESI_teams:null,_ujgESI_activity:null,
    _ujgESI_activityLoader:require('./helpers/import-activity-loader'),_ujgESI_deadlines:load(path.join(dir,'deadlines.js'),{}),_ujgESI_dueDateSync:null,_ujgESI_componentSync:null,_ujgESI_remarkReportLoader:null,_ujgESI_sourceExport:null,_ujgESI_sourceExportApi:null,
    _ujgESI_rendering:{init:(_,cb)=>a.cb=cb,render:s=>a.state=s,renderRequestProgress:()=>true}});
  new Gadget({getGadgetContentEl:()=>({find:()=>({length:1})}),resize(){}});await flush();
  a.cb.onFileChange({name:'original.xlsx'});await flush();await flush();a.cb.onProjectChange('P');await flush();return a;
}
test('registry Stop keeps old complete rows and isolates late unabortable results; restart publishes new run',async()=>{
  const a=await setup();a.cb.onViewModeChange('jira');a.cb.onLoadRegistry();await flush();await flush();const old=a.state.rows;
  const d=deferred();a.api.getProjectIssues=()=>d.promise;a.cb.onLoadRegistry();
  assert.equal(a.state.registryProgress.status,'running');assert.ok(a.state.registrySnapshotAt);
  a.cb.onStopRegistryLoad();assert.equal(a.state.registryProgress.status,'cancelled');assert.equal(a.state.rows,old);
  const first=a.state.registryProgress.runId;a.api.getProjectIssues=()=>Promise.resolve({issues:[issue('P-2')]});a.cb.onRestartRegistryLoad();await flush();await flush();
  d.resolve({issues:[issue('P-99')]});await flush();assert.equal(a.state.rows[0].jiraKey,'P-2');assert.notEqual(a.state.registryProgress.runId,first);
});
test('registry retry retains failed request rows during new generation and never accepts failed partial results',async()=>{
  const a=await setup();a.cb.onViewModeChange('jira');a.cb.onLoadRegistry();await flush();await flush();const old=a.state.rows;
  a.api.getProjectIssues=(_p,_e,opts)=>{opts.onRequest({id:'bad',stage:'stories',state:'error',startedAt:Date.now(),error:'offline'});return Promise.reject(new Error('offline'));};
  a.cb.onLoadRegistry();await flush();assert.equal(a.state.rows,old);assert.equal(a.state.registryProgress.status,'error');
  const d=deferred();a.api.getProjectIssues=()=>d.promise;a.cb.onRetryRegistryLoad();assert.ok(a.state.registryProgress.rows.some(r=>r.id==='bad'&&r.state==='error'));
  a.cb.onStopRegistryLoad();d.resolve({issues:[]});await flush();
});
test('Excel cancellation and workbook failure preserve rows, matching data, source and prior export atomically',async()=>{
  const a=await setup();a.cb.onSyncJira();await flush();await flush();const old=a.state.rows,exported=a.state.exportBuffer;
  const d=deferred();a.patcher.patchWorkbook=()=>d.promise;a.api.getIssuesByKeys=()=>Promise.resolve({issues:[issue('P-1','New')]});a.cb.onSyncJira();await flush();await flush();
  assert.equal(a.state.rows,old);assert.equal(old[0].storyDetails.status,'Open');assert.equal(a.state.exportBuffer,exported);
  a.cb.onStopRegistryLoad();d.resolve(new ArrayBuffer(8));await flush();assert.equal(a.state.rows,old);assert.equal(a.state.exportBuffer,exported);
  a.patcher.patchWorkbook=()=>Promise.reject(new Error('patch failed'));a.cb.onRestartRegistryLoad();await flush();await flush();
  assert.equal(a.state.rows,old);assert.equal(a.state.exportBuffer,exported);assert.equal(a.state.registryProgress.status,'error');
  assert.equal(a.state.sourceFileName,'original.xlsx');assert.equal(old[0].sourceColumns['Ответственный'],'Excel Owner');
});
test('Excel summary matching is staged and cancelled reads cannot leak matched keys into source rows',async()=>{
  const a=await setup(),old=a.state.rows;old[0].jiraKey='';old[0].storyDetails=null;
  const d=deferred();a.api.getIssuesByKeys=()=>d.promise;a.cb.onSyncJira();await flush();await flush();
  assert.equal(old[0].jiraKey,'');assert.equal(old[0].matchedBySummary,undefined);
  a.cb.onStopRegistryLoad();d.resolve({issues:[issue('P-1')]});await flush();assert.equal(old[0].jiraKey,'');
  a.api.getIssuesByKeys=()=>Promise.resolve({issues:[issue('P-1')]});a.cb.onRestartRegistryLoad();await flush();await flush();
  assert.equal(a.state.rows[0].jiraKey,'P-1');assert.equal(a.state.rows[0].matchedBySummary,true);assert.equal(a.state.rows[0].sourceColumns['Ответственный'],'Excel Owner');
});
test('selecting a new source file immediately aborts pending enrichment before the workbook is read',async()=>{
  const a=await setup(),d=deferred();let aborted=0;d.promise.abort=()=>aborted++;
  a.api.getIssuesByKeys=()=>d.promise;a.cb.onSyncJira();await flush();
  a.cb.onFileChange({name:'next.xlsx'});assert.equal(aborted,1);d.resolve({issues:[issue('P-1','Late')]});await flush();await flush();
  assert.equal(a.state.rows[0].storyDetails.status,'Old');assert.equal(a.state.sourceFileName,'next.xlsx');
});
test('Stop during summary matching aborts that read and prevents key lookup and matched-row publication',async()=>{
  const a=await setup(),d=deferred(),old=a.state.rows;let aborted=0,lookups=0;
  old[0].jiraKey='';old[0].storyDetails=null;d.promise.abort=()=>aborted++;
  a.api.searchIssueBySummary=()=>d.promise;a.api.getIssuesByKeys=()=>{lookups++;return Promise.resolve({issues:[]});};
  a.cb.onSyncJira();await flush();a.cb.onStopRegistryLoad();assert.equal(aborted,1);
  d.resolve({issues:[issue('P-1')]});await flush();assert.equal(lookups,0);assert.equal(old[0].jiraKey,'');assert.equal(old[0].matchedBySummary,undefined);
});
