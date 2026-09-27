const test=require("node:test");
const assert=require("node:assert/strict");
const path=require("node:path");
const load=require("./helpers/load-amd-module");
const dir=path.join(__dirname,"../ujg-excel-story-importer-modules");
const flush=()=>new Promise(resolve=>setImmediate(resolve));
async function setup() {
  const calls=[],app={}, config=load(path.join(dir,"config.js"),{});
  const teams=load(path.join(dir,"teams.js"),{}),remarkId=load(path.join(dir,"remark-id.js"),{});
  const deadlines=load(path.join(dir,"deadlines.js"),{});
  const activity=load(path.join(dir,"activity.js"),{_ujgESI_teams:teams,_ujgESI_remarkId:remarkId,_ujgESI_deadlines:deadlines});
  const api={getProjects:async()=>[],getIssueWithHistory:async key=>{
    calls.push(key);
    return {key,fields:{summary:key==="PR-1"?"52. Исправить экран":"[QA] 52. Проверить экран",description:"Исходное замечание",issuetype:{name:"Story"},status:{id:"1",name:"Open",statusCategory:{key:"new"}},components:[],created:"2026-09-01T09:00:00Z",updated:"2026-09-27T09:00:00Z",assignee:null,
      issuelinks:key==="PR-1"?[{type:{name:"Parent-Child",inward:"is child of",outward:"is parent of"},outwardIssue:{key:"PR-2",fields:{summary:"[QA] 52. Проверка"}}}]:[],
      comment:{startAt:0,total:0,comments:[]},worklog:{startAt:0,total:0,worklogs:[]}},changelog:{startAt:0,total:0,histories:[]}};
  }};
  const Gadget=load(path.join(dir,"main.js"),{
    jquery:()=>({length:0}),_ujgESI_config:config,_ujgESI_api:api,
    "_ujgESI_excel-loader":{},_ujgESI_parser:{},_ujgESI_creator:{},_ujgESI_mappingStore:null,_ujgESI_xlsxPatcher:null,
    _ujgESI_teams:teams,_ujgESI_activity:activity,_ujgESI_deadlines:deadlines,_ujgESI_dueDateSync:null,_ujgESI_componentSync:null,
    _ujgESI_activityLoader:require("./helpers/import-activity-loader"),
    _ujgESI_sourceExport:null,_ujgESI_sourceExportApi:null,_ujgESI_remarkReportLoader:load(path.join(dir,"remark-report-loader.js"),{}),_ujgShared_llmClient:null,
    _ujgESI_rendering:{init:(_,cb)=>app.cb=cb,render:s=>app.state=s}
  });
  new Gadget({getGadgetContentEl:()=>({find:()=>({length:1})}),resize(){}});
  await flush();app.state.projectKey="P";app.state.rows=[{id:"row",jiraKey:"PR-1",remarkId:"52",summary:"52. Исправить экран",sourceColumns:{"№":"52"}}];
  return {app,calls,api,engine:load(path.join(dir,"remark-report.js"),{_ujgESI_activity:activity,_ujgESI_remarkId:remarkId})};
}
test("single-remark service reads fresh details and keeps existing registry untouched",async()=>{
  const x=await setup();assert.equal(typeof x.app.cb.onLoadRemarkReport,"function");
  x.app.state.rows[0].summary="Исходный текст Excel отличается от темы Jira";
  const before=JSON.stringify(x.app.state.rows),result=await x.app.cb.onLoadRemarkReport("PR-1",{});
  assert.equal(result.row.storyDetails.key,"PR-1");assert.equal(result.row.childStatuses.length,1);
  assert.equal(result.row.childStatuses[0].role,"QA");assert.equal(result.row.childStatuses[0].key,"PR-2");
  assert.equal(result.sourceWarnings.length,0);assert.equal(result.row.sourceColumns["№"],"52");
  assert.equal(JSON.stringify(x.app.state.rows),before);
  assert.equal(result.row.summary,"Исходный текст Excel отличается от темы Jira");
  assert.deepEqual(x.calls,["PR-1","PR-2","PR-2","PR-1"]);
});
test("unknown story cannot issue requests and context change cancels an active load",async()=>{
  const x=await setup();await assert.rejects(x.app.cb.onLoadRemarkReport("PR-99",{}),/срез|найден/i);assert.equal(x.calls.length,0);
  const read=x.api.getIssueWithHistory;x.api.getIssueWithHistory=async key=>{const result=await read(key);x.app.state.projectKey="Q";return result;};
  await assert.rejects(x.app.cb.onLoadRemarkReport("PR-1",{}),/отмен|срез/i);assert.equal(x.calls.length,1);
});
test("child-directed malformed links never become a complete source",async()=>{
  for(const broken of [null,{}, {key:""}]) {
    const x=await setup(),read=x.api.getIssueWithHistory;
    x.api.getIssueWithHistory=async key=>{const value=await read(key);if(key==="PR-1")value.fields.issuelinks[0].outwardIssue=broken;return value;};
    await assert.rejects(x.app.cb.onLoadRemarkReport("PR-1",{}),/связ|дочер/i);
  }
});
test("a link to the story's own parent is not mistaken for an inaccessible child",async()=>{
  const x=await setup(),read=x.api.getIssueWithHistory;
  x.api.getIssueWithHistory=async key=>{
    const value=await read(key);
    if(key==="PR-1")value.fields.issuelinks.push({type:{name:"Parent-Child",inward:"is child of",outward:"is parent of"},inwardIssue:{key:"PR-99"}});
    return value;
  };
  const result=await x.app.cb.onLoadRemarkReport("PR-1",{});
  assert.equal(result.sourceWarnings.length,0);
  assert.equal(result.row.childStatuses.length,1);
  assert.ok(!x.calls.includes("PR-99"));
});
for(const staleLink of [false,true]) test("explicitly empty Jira child description remains loaded"+(staleLink?" and replaces stale link description":""),async()=>{
  const x=await setup(),read=x.api.getIssueWithHistory;
  x.api.getIssueWithHistory=async key=>{
    const value=await read(key);
    if(key==="PR-2")value.fields.description=null;
    if(key==="PR-1" && staleLink)value.fields.issuelinks[0].outwardIssue.fields.description="Устаревший текст";
    return value;
  };
  const result=await x.app.cb.onLoadRemarkReport("PR-1",{});
  assert.equal(result.row.childStatuses[0].descriptionLoaded,true);
  assert.equal(result.row.childStatuses[0].description,"");
  const plan=x.engine.prepare(result.row,[],{asOf:result.asOf,sourceWarnings:result.sourceWarnings});
  assert.equal(plan.canGenerate,true,plan.blockers.join("; "));
});
for(const staleLink of [false,true]) test("omitted Jira child description is blocked even with stale link metadata: "+staleLink,async()=>{
  const x=await setup(),read=x.api.getIssueWithHistory;
  x.api.getIssueWithHistory=async key=>{
    const value=await read(key);
    if(key==="PR-2")delete value.fields.description;
    if(key==="PR-1" && staleLink)value.fields.issuelinks[0].outwardIssue.fields.description="Устаревший текст";
    return value;
  };
  const result=await x.app.cb.onLoadRemarkReport("PR-1",{});
  const plan=x.engine.prepare(result.row,[],{asOf:result.asOf,sourceWarnings:result.sourceWarnings});
  assert.equal(plan.canGenerate,false);
  assert.match(plan.blockers.join(),/PR-2.*описание/);
});
