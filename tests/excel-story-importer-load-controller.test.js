const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const load=require('./helpers/load-amd-module'),dir=path.join(__dirname,'../ujg-excel-story-importer-modules');
const flush=()=>new Promise(r=>setImmediate(r));
function deferred() { let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject}; }
function issue(key,status='Open') { return {key,fields:{summary:'Same summary',status:{name:status},assignee:{displayName:'Jira Owner'},issuelinks:[],issuetype:{name:'Story'}},changelog:{histories:[]}}; }
async function setup(options={}) {
  const a={renders:0,historyPaints:0};a.api={getIssueComments:()=>Promise.resolve({startAt:0,total:0,comments:[]}),getProjects:()=>Promise.resolve([]),getProjectEpics:()=>Promise.resolve({issues:[]}),getProjectCreateMeta:()=>Promise.resolve({projects:[]}),
    getProjectIssues:()=>Promise.resolve({issues:[issue('P-1')]}),getIssuesByKeys:()=>Promise.resolve({issues:[issue('P-1')]}),searchIssueBySummary:()=>Promise.resolve({issues:[issue('P-1')]})};
  a.patcher={patchWorkbook:()=>Promise.resolve(new ArrayBuffer(2))};
  const Gadget=load(path.join(dir,'main.js'),{jquery:()=>({length:0}),_ujgESI_config:load(path.join(dir,'config.js'),{}),_ujgESI_api:a.api,
    '_ujgESI_excel-loader':{readFileBuffer:()=>Promise.resolve(new ArrayBuffer(1)),readWorkbookFromBuffer:()=>Promise.resolve({SheetNames:['Sheet1']})},
    _ujgESI_parser:{extractJiraKey:value=>/^P-\d+$/.test(value)?value:'',parseWorkbook:()=>({sheetName:'Sheet1',rows:[{id:'1',jiraKey:'P-1',summary:'Same summary',sourceColumns:{'Ответственный':'Excel Owner'},storyDetails:{key:'P-1',status:'Old'},createdChildren:[]}]})},
    _ujgESI_statusTransition:load(path.join(dir,"status-transition.js"),{}),_ujgESI_creator:{},_ujgESI_mappingStore:null,_ujgESI_xlsxPatcher:a.patcher,_ujgShared_llmClient:null,_ujgESI_teams:null,_ujgESI_activity:options.activity ? load(path.join(dir,"activity.js"),{_ujgESI_teams:load(path.join(dir,"teams.js"),{}),_ujgESI_remarkId:load(path.join(dir,"remark-id.js"),{}),_ujgESI_deadlines:load(path.join(dir,"deadlines.js"),{})}) : null,
    _ujgESI_activityLoader:require('./helpers/import-activity-loader'),_ujgESI_deadlines:load(path.join(dir,'deadlines.js'),{}),_ujgESI_dueDateSync:null,_ujgESI_componentSync:null,_ujgESI_remarkReportLoader:null,_ujgESI_sourceExport:null,_ujgESI_sourceExportApi:null,
    _ujgESI_rendering:{init:(_,cb)=>a.cb=cb,render:s=>{a.renders++;a.state=s;},renderRegistryHistory:()=>{a.historyPaints++;return true;},renderRequestProgress:()=>true}});
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
function light(key){const x=issue(key);delete x.changelog;x.fields.created='2026-01-01T00:00:00Z';x.fields.updated='2026-10-20T00:00:00Z';return x;}
function history(key){const x=light(key);x.changelog={startAt:0,total:0,histories:[]};return x;}
async function progressive(options){const a=await setup(options);a.calls=[];a.pending=[];a.api.getProjectIssues=(_p,_e,opts)=>{a.searchOptions=opts;return Promise.resolve({issues:[light('P-1'),light('P-2')]});};a.api.getIssueWithHistory=(key,opts)=>{const d=deferred();a.calls.push({key,opts});a.pending.push(d);return d.promise;};a.cb.onViewModeChange('jira');a.cb.onLoadRegistry();await flush();await flush();return a;}
test('complete base publishes before sequential light history and only missing keys retry after failure',async()=>{
  const a=await progressive(),rows=a.state.rows;
  assert.equal(rows.length,2);assert.equal(a.searchOptions.profile,'registry');assert.equal(a.searchOptions.expand,null);assert.equal(a.searchOptions.pageSize,50);
  assert.equal(a.calls.length,1);assert.equal(a.calls[0].opts.profile,'registry-history');assert.equal(rows[0].storyDetails.historyState,'pending');assert.equal(a.state.registryLoading,false);
  a.pending[0].resolve(history('P-1'));await flush();assert.ok(rows[0].storyDetails.statusSince);assert.equal(rows[0].storyDetails.historyState,'complete');assert.equal(a.calls.length,2);
  a.pending[1].reject(new Error('offline'));await flush();assert.equal(a.state.rows,rows);assert.equal(a.state.registryProgress.status,'error');assert.equal(rows[1].storyDetails.historyState,'error');
  a.cb.onRetryRegistryLoad();await flush();assert.ok(a.state.registryProgress.rows.some(r=>r.state==='error'&&r.runId!==a.state.registryProgress.runId),'Retry retains earlier failure evidence');assert.deepEqual(a.calls.map(c=>c.key),['P-1','P-2','P-2']);a.pending[2].resolve(history('P-2'));await flush();assert.equal(a.state.registryProgress.status,'completed');assert.equal(a.state.rows,rows);
});
test('history Stop and scope changes isolate late unabortable responses; restart keeps ready keys',async()=>{
  const a=await progressive();a.pending[0].resolve(history('P-1'));await flush();const rows=a.state.rows;
  a.cb.onStopRegistryLoad();assert.equal(rows[1].storyDetails.historyState,'cancelled');assert.equal(a.state.registryProgress.status,'cancelled');
  a.cb.onRestartRegistryLoad();await flush();assert.deepEqual(a.calls.map(c=>c.key),['P-1','P-2','P-2']);
  a.pending[1].resolve(history('P-2'));await flush();assert.equal(rows[1].storyDetails.historyState,'pending');
  a.cb.onProjectChange('OTHER');a.pending[2].resolve(history('P-2'));await flush();assert.equal(rows[1].storyDetails.statusSince,'');
});
test('history cannot overwrite a newer base status or assignment, nor validate an older updated snapshot',async()=>{
  const a=await progressive(),detail=a.state.rows[0].storyDetails;
  detail.status='Confirmed';detail.assignee='Confirmed owner';const stale=history('P-1');a.pending[0].resolve(stale);await flush();
  assert.equal(detail.status,'Confirmed');assert.equal(detail.assignee,'Confirmed owner');assert.equal(detail.statusSince,'');assert.equal(detail.historyState,'error');
  const older=history('P-2');older.fields.updated='2026-01-02T00:00:00Z';a.pending[1].resolve(older);await flush();assert.equal(a.state.rows[1].storyDetails.historyState,'error');
});
test('Excel sync publishes workbook before history and uses the same light base profile',async()=>{
  const a=await setup(),d=deferred();let opts,reads=0;
  a.api.getIssuesByKeys=(_keys,o)=>{opts=o;return Promise.resolve({issues:[light('P-1')]});};a.api.getIssueWithHistory=()=>{reads++;return d.promise;};
  a.cb.onSyncJira();await flush();await flush();assert.equal(opts.profile,'registry');assert.equal(a.state.syncLoading,false);assert.ok(a.state.exportBuffer);assert.equal(reads,1);assert.equal(a.state.rows[0].storyDetails.historyState,'pending');
  d.resolve(history('P-1'));await flush();assert.equal(a.state.rows[0].storyDetails.historyState,'complete');
});
test('Dynamics cancels registry history and uses full loader including comment pagination, reusing base rows',async()=>{
  const a=await progressive({activity:true}),rows=a.state.rows;let searches=0,commentCalls=0;
  // First history is unabortable: even a late valid reply cannot race the full loader.
  a.api.getProjectIssues=()=>{searches++;return Promise.resolve({issues:[]});};
  const full=deferred();a.api.getIssueWithHistory=(_key,opts)=>{assert.equal(opts,undefined);return full.promise;};
  a.api.getIssueComments=(_key,offset)=>{commentCalls++;return Promise.resolve({startAt:offset,total:1,comments:[{id:'one',created:'2026-01-02T00:00:00Z',body:'Full comment'}]});};
  a.cb.onReportViewChange('activity');await flush();assert.equal(searches,0);assert.equal(a.state.rows,rows);assert.equal(a.state.activityLoading,true);
  // Separate full replies for both keys, as the full loader validates keys.
  a.cb.onStopActivityHistory();
  a.api.getIssueWithHistory=(key,opts)=>{assert.equal(opts,undefined);const x=history(key);x.fields.comment={startAt:0,total:1,comments:[]};x.fields.worklog={startAt:0,total:0,worklogs:[]};return Promise.resolve(x);};
  a.cb.onLoadActivityHistory({force:true});await flush();await flush();assert.equal(commentCalls,2);assert.equal(rows[0].storyDetails.activity.comments.complete,true);
  a.pending[0].resolve(history('P-1'));await flush();assert.equal(rows[0].storyDetails.activity.comments.entries[0].body,'Full comment');
  a.cb.onReportViewChange('registry');await flush();assert.equal(rows[0].storyDetails.historyState,'complete');assert.equal(a.state.registryProgress.status,'completed');
  full.resolve(history('P-1'));await flush();
});
test('pending status editor stops history and ignores late replies before and after confirmed readback',async()=>{
  const a=await progressive(),rows=a.state.rows;let writes=0;
  a.api.getIssueTransitions=()=>Promise.resolve({transitions:[{id:'21',name:'Confirmed',to:{id:'3',name:'Confirmed'},fields:{}}]});
  a.api.transitionIssue=()=>{writes++;return Promise.resolve();};
  await a.cb.onOpenStatusTransition({key:'P-1'});assert.equal(rows[0].storyDetails.historyState,'cancelled');
  a.pending[0].resolve(history('P-1'));await flush();assert.equal(rows[0].storyDetails.statusSince,'');assert.equal(a.calls.length,1);
  a.api.getIssueWithHistory=()=>{const x=history('P-1');x.fields.status={id:'3',name:'Confirmed'};x.fields.resolution=null;return Promise.resolve(x);};
  a.cb.onSelectStatusTransition('21');await a.cb.onApplyStatusTransition();assert.equal(writes,1);assert.equal(rows[0].storyDetails.status,'Confirmed');assert.ok(rows[0].storyDetails.statusSince);
});
test('partial history stays an explicit error and duplicate parent/linked keys enrich only once',async()=>{
  const a=await setup(),calls=[];
  const parent=light('P-1');parent.fields.issuelinks=[{type:{name:'Child'},outwardIssue:{key:'P-2'}}];
  a.api.getProjectIssues=()=>Promise.resolve({issues:[parent,light('P-2')]});a.api.getIssuesByKeys=()=>Promise.resolve({issues:[light('P-2')]});
  a.api.getIssueWithHistory=key=>{calls.push(key);const x=history(key);if(key==='P-1')x.changelog.total=2;return Promise.resolve(x);};
  a.cb.onViewModeChange('jira');a.cb.onLoadRegistry();await flush();await flush();assert.deepEqual(calls,['P-1','P-2']);assert.equal(a.state.rows[0].storyDetails.historyState,'error');assert.equal(a.state.rows[0].storyDetails.statusSince,'');assert.match(a.state.rows[0].storyDetails.statusSinceReason,/Полнота/);
});
test('1000 immediate histories coalesce age paints and never rerender the complete registry',async()=>{
  const a=await setup();let reads=0,renderCountAtFirstRead;
  a.api.getProjectIssues=()=>Promise.resolve({issues:Array.from({length:1000},(_,i)=>light('P-'+(i+1)))});
  a.api.getIssueWithHistory=key=>{if(!reads)renderCountAtFirstRead=a.renders;reads++;return Promise.resolve(history(key));};
  a.cb.onViewModeChange('jira');a.cb.onLoadRegistry();await flush();await flush();
  assert.equal(reads,1000);assert.equal(a.state.rows.length,1000);assert.equal(a.state.registryProgress.status,'completed');assert.equal(a.renders,renderCountAtFirstRead);
  assert.ok(a.historyPaints<=2,'Immediate completions flush together rather than painting 1000 times');
});
test('review P2 Excel history cannot hand off cached Jira membership to Dynamics',async()=>{
  const a=await setup({activity:true}),fullReads=[],excelHistory=deferred();let searches=0;
  a.api.getProjectIssues=()=>Promise.resolve({issues:[light('P-9')]});
  a.api.getIssueWithHistory=key=>Promise.resolve(history(key));
  a.cb.onViewModeChange('jira');a.cb.onLoadRegistry();await flush();await flush();
  assert.equal(a.state.rows[0].jiraKey,'P-9');assert.equal(a.state.registryProgress.status,'completed');
  a.cb.onViewModeChange('excel');
  a.api.getIssuesByKeys=()=>Promise.resolve({issues:[light('P-1')]});
  a.api.getIssueWithHistory=(key,opts)=>{
    if(opts&&opts.profile==='registry-history')return excelHistory.promise;
    fullReads.push(key);return Promise.resolve(history(key));
  };
  a.cb.onSyncJira();await flush();await flush();assert.equal(a.state.registryProgress.kind,'excel');assert.equal(a.state.registryProgress.status,'running');
  a.api.getProjectIssues=(project,epic)=>{searches++;assert.equal(project,'P');assert.equal(epic,'');return Promise.resolve({issues:[light('P-10')]});};
  a.cb.onReportViewChange('activity');await flush();await flush();
  assert.equal(searches,1,'Excel enrichment must not suppress a fresh Jira base search');
  assert.deepEqual(Array.from(a.state.rows,row=>row.jiraKey),['P-10']);assert.deepEqual(fullReads,['P-10']);
  excelHistory.resolve(history('P-1'));await flush();assert.equal(a.state.rows[0].jiraKey,'P-10');
});
