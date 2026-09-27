const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const load = require("./helpers/load-amd-module");
const dir = path.join(__dirname, "../ujg-excel-story-importer-modules");
const teams = load(path.join(dir, "teams.js"), {});
const remarkId = load(path.join(dir, "remark-id.js"), {});
const config = load(path.join(dir, "config.js"), {});
const deadlines = load(path.join(dir, "deadlines.js"), {_ujgESI_config:config});
const activity = load(path.join(dir, "activity.js"), {_ujgESI_teams:teams,_ujgESI_remarkId:remarkId,_ujgESI_deadlines:deadlines},{URL});
const brief = () => load(path.join(dir, "activity-brief.js"), {_ujgESI_activity:activity});
const person = name => ({key:name,displayName:name});
function issue(key, status="Open", histories=[], extra={}) {
  return {key,fields:{summary:key+" summary",created:"2026-09-18T00:00:00Z",updated:"2026-09-27T10:00:00Z",
    status:{id:status==="Done"?"2":"1",name:status,statusCategory:{key:status==="Done"?"done":"new"}},assignee:person("Owner"),...extra},
    changelog:{startAt:0,total:histories.length,histories}};
}
function detail(jira, role="") { return {key:jira.key,summary:jira.fields.summary,status:jira.fields.status.name,role,activity:activity.capture(jira)}; }
function row(jira, extras={}) { return {jiraKey:jira.key,summary:"Remark "+jira.key,storyDetails:detail(jira),childStatuses:[],...extras}; }
function transition(id, at, from, to) { return {id,created:at,author:person("Editor"),items:[{field:"status",from:from==="Done"?"2":"1",to:to==="Done"?"2":"1",fromString:from,toString:to}]}; }
const options = {date:"2026-09-27",now:"2026-09-27T12:00:00Z",scope:{projectKey:"P",epicKey:"P-0",baseUrl:"https://jira.test",components:null}};
function prepared(rows, more={}) { return brief().prepare(rows,teams.defaults(),{...options,...more}); }

test("seven days deduplicate remark returns and include quiet open scope", () => {
  const changed=issue("P-1","Open",[
    transition("a","2026-09-22T05:00:00Z","Done","Open"),
    transition("middle","2026-09-23T05:00:00Z","Open","Done"),
    transition("b","2026-09-24T05:00:00Z","Done","Open")]);
  const plan=prepared([row(changed),row(issue("P-2"))]);
  assert.equal(plan.fromDate,"2026-09-21");
  assert.equal(plan.meta.totalRemarks,2);
  assert.equal(plan.coverage.complete,2);
  assert.equal(plan.coverage.total,2);
  assert.equal(plan.coverage.isComplete,true);
  assert.equal(plan.facts.returns.remarks,1);
  assert.equal(plan.facts.completedDuringPeriod,1);
  assert.equal(plan.facts.completedRemarks,1);
  assert.equal(plan.facts.countSources.returns,"observed");
  assert.equal(plan.facts.countSources.completedDuringPeriod,"certified");
  assert.match(plan.factsMarkdown,/за период.*могли быть вновь открыты/i);
  assert.equal(plan.facts.openAtEnd,2);
  assert.equal(plan.facts.daily.length,7);
  assert.equal(plan.facts.daily.find(day=>day.date==="2026-09-22").events,1);
  assert.match(plan.request.userPrompt,/P-1 2026-09-22 08:00 МСК/);
  assert.match(plan.request.userPrompt,/P-2/);
  assert.match(plan.request.userPrompt,/нет зарегистрированных изменений создания, статуса или назначения/i);
  assert.ok(Object.isFrozen(plan) && Object.isFrozen(plan.request));
});

test("component scope respects null, selected components and empty selection", () => {
  const a=row(issue("P-1")), b=row(issue("P-2"));
  a.storyDetails.components=[{id:"10",name:"A"}];
  b.storyDetails.components=[{id:"20",name:"B"}];
  assert.equal(prepared([a,b]).meta.totalRemarks,2);
  assert.equal(prepared([a,b],{scope:{...options.scope,components:[{id:"component:10",name:"A"}]}}).meta.totalRemarks,1);
  assert.equal(prepared([a,b],{scope:{...options.scope,components:[]}}).meta.totalRemarks,0);
});

test("worklogs use period entries, deduplicate issue records and flag incomplete coverage", () => {
  const jira=issue("P-1","Open",[],{timespent:99999,worklog:{startAt:0,total:2,worklogs:[
    {id:"1",started:"2026-09-22T10:00:00Z",timeSpentSeconds:1800,author:person("Dev")},
    {id:"2",started:"2026-09-18T10:00:00Z",timeSpentSeconds:3600,author:person("Dev")}]}});
  const plan=prepared([row(jira),row(jira)]);
  assert.equal(plan.facts.worklogs.knownSeconds,1800);
  assert.equal(plan.facts.worklogs.records,1);
  assert.equal(plan.facts.worklogs.incompleteIssues,0);
  assert.equal(plan.facts.worklogs.snapshotSpentSeconds,99999);
  assert.match(plan.factsMarkdown,/Команда неизвестна.*Без роли/);
  assert.equal(plan.facts.worklogs.byTeamRole.totalGroups,1);
  assert.deepEqual(JSON.parse(JSON.stringify(plan.facts.worklogs.byTeamRole.groups)),[
    {team:"Команда неизвестна",role:"Без роли",seconds:1800,records:1}]);
  const incomplete=issue("P-2");
  assert.equal(prepared([row(jira),row(incomplete)]).facts.worklogs.incompleteIssues,1);
});

test("bounded detail and UTF-8 budgets preserve aggregate counts and disclose omissions", () => {
  const rows=Array.from({length:35},(_,i)=>row(issue("P-"+(i+1)),{summary:"Замечание "+"🙂".repeat(300)}));
  const plan=prepared(rows);
  assert.equal(plan.meta.totalRemarks,35);
  assert.equal(plan.meta.detailedRemarks,10);
  assert.equal(plan.meta.omittedRemarks,25);
  assert.ok(plan.meta.truncatedFields>0);
  assert.ok(plan.meta.userBytes<=18000);
  assert.ok(plan.meta.userBytes<=15000);
  assert.ok(plan.meta.systemBytes<=4000);
  assert.equal(plan.meta.requestCount,1);
  assert.equal(plan.request.allowProtocolFallback,false);
  assert.equal(plan.facts.openAtEnd,35);
  assert.notEqual(plan.fingerprint,prepared(rows.map((r,i)=>i===34?{...r,summary:"changed"}:r)).fingerprint);
  assert.doesNotMatch(plan.request.userPrompt,/\uD83D(?!\uDE42)/);
});

test("missing deadline coverage never becomes a zero-risk claim", () => {
  const plan=prepared([row(issue("P-1"))]);
  assert.equal(plan.facts.deadlines.known,0);
  assert.equal(plan.facts.deadlines.missing,1);
  assert.equal(plan.facts.overdueRemarks,null);
  assert.match(plan.request.userPrompt,/срок/i);
});

test("Moscow period and cutoff exclude later events without losing quiet remarks", () => {
  const jira=issue("P-1","Open",[
    transition("before","2026-09-20T20:59:59Z","Done","Open"),
    transition("at-start","2026-09-20T21:00:00Z","Open","Done"),
    transition("after-cutoff","2026-09-27T11:00:00Z","Done","Open")]);
  jira.fields.updated="2026-09-27T12:00:00Z";
  const plan=prepared([row(jira),row(issue("P-2"))],{cutoff:"2026-09-27T10:00:00Z"});
  assert.equal(plan.fromDate,"2026-09-21");
  assert.equal(plan.asOf,"2026-09-27T10:00:00.000Z");
  assert.equal(plan.eventCount,1);
  assert.match(plan.request.userPrompt,/2026-09-21 00:00 МСК/);
  assert.doesNotMatch(plan.request.userPrompt,/2026-09-27T11:00:00/);
});

test("partial history keeps open balance unknown and fixed oversized context fails locally", () => {
  const jira=issue("P-1");
  const source=row(jira);
  source.storyDetails.activity.complete=false;
  const plan=prepared([source]);
  assert.equal(plan.facts.openAtEnd,null);
  assert.equal(plan.facts.openAtEndUnknown,1);
  assert.equal(plan.coverage.daysWithIncompleteCoverage,7);
  assert.equal(plan.coverage.isComplete,false);
  assert.throws(()=>prepared([source],{scopeWarning:"🙂".repeat(10000)}),/фиксированный контекст.*лимит.*байт/i);
});

test("detail names the actor and assignee with current parent status clearly labeled", () => {
  const jira=issue("P-1","Open",[transition("a","2026-09-24T05:00:00Z","Done","Open")]);
  const plan=prepared([row(jira)]), detailLine=JSON.parse(plan.request.userPrompt).detail[0];
  assert.match(detailLine,/текущий статус родителя: Open/);
  assert.match(detailLine,/автор: Editor/);
  assert.match(detailLine,/назначен: Owner/);
  assert.match(detailLine,/2026-09-24 08:00 МСК/);
});

test("child completion does not count a whole remark ready", () => {
  const parent=issue("P-1","Open"), child=issue("P-2","Done",[
    transition("done","2026-09-24T05:00:00Z","Open","Done")]);
  const source=row(parent,{childStatuses:[detail(child,"QA")]});
  const plan=prepared([source]);
  assert.equal(plan.facts.completedRemarks,0);
  assert.equal(plan.facts.openAtEnd,1);
  assert.equal(plan.facts.daily.find(day=>day.date==="2026-09-24").events,1);
});

test("description-only event counts as changed while the quiet status signal remains true", () => {
  const jira=issue("P-1","Open",[{id:"description",created:"2026-09-24T05:00:00Z",author:person("Writer"),items:[
    {field:"description",from:"private old text",to:"private new text",fromString:"private old text",toString:"private new text"}]}]);
  const plan=prepared([row(jira)]), payload=JSON.parse(plan.request.userPrompt);
  assert.equal(plan.eventCount,1);
  assert.equal(plan.facts.changedRemarks,1);
  assert.equal(plan.facts.significantChangedRemarks,0);
  assert.equal(plan.facts.quietOpenRemarks,1);
  assert.equal(plan.facts.countSources.changedRemarks,"observed");
  assert.match(payload.detail[0],/нет зарегистрированных изменений создания, статуса или назначения/);
  assert.match(payload.detail[0],/2026-09-24 08:00 МСК.*Описание.*Writer/);
  assert.doesNotMatch(plan.request.userPrompt,/private old text|private new text/);
});

test("no-op status record is observed but does not break the quiet transition signal", () => {
  const jira=issue("P-1","Open",[transition("noop","2026-09-24T05:00:00Z","Open","Open")]);
  const plan=prepared([row(jira)]);
  assert.equal(plan.facts.recordedEventRemarks,1);
  assert.equal(plan.facts.changedRemarks,0);
  assert.equal(plan.facts.significantChangedRemarks,0);
  assert.equal(plan.facts.quietOpenRemarks,1);
});

test("stale worklog snapshots remain incomplete even with a fully loaded list",()=>{
  const stale=row(issue("P-1","Open",[],{worklog:{startAt:0,total:0,worklogs:[]}}));
  stale.storyDetails.activity.capturedAt="2026-09-26T12:00:00Z";
  const fresh=row(issue("P-2","Open",[],{worklog:{startAt:0,total:0,worklogs:[]}}));
  const plan=prepared([stale,fresh]);
  assert.equal(plan.facts.worklogs.incompleteIssues,1);
  assert.equal(plan.facts.worklogs.staleIssues,1);
});

test("readiness at cutoff distinguishes done from cancelled and unknown across all remarks",()=>{
  const done=row(issue("P-1","Done"));
  const cancelled=issue("P-3","Cancelled");
  cancelled.fields.status={id:"9",name:"Cancelled",statusCategory:{key:"done"}};
  const mixed=row(issue("P-2","Done"),{childStatuses:[detail(cancelled,"QA")]});
  const partial=row(issue("P-4","Done"));partial.storyDetails.activity.complete=false;
  const plan=prepared([done,mixed,partial]);
  assert.deepEqual(JSON.parse(JSON.stringify(plan.facts.readinessAtEnd)),{ready:1,notReady:1,unknown:1});
  assert.equal(plan.facts.openAtEndConfirmed,0);
  assert.match(JSON.parse(plan.request.userPrompt).detail.join("\n"),/полностью готово: нет/);
});

test("period is part of the immutable report fingerprint",()=>{
  const rows=[row(issue("P-1"))];
  assert.notEqual(prepared(rows).fingerprint,prepared(rows,{days:1}).fingerprint);
});

test("worklog groups are deterministic, bounded and disclose omitted totals", () => {
  const rows=Array.from({length:16},(_,i)=>{
    const jira=issue("P-"+(i+1),"Open",[],{worklog:{startAt:0,total:1,worklogs:[
      {id:"one",started:"2026-09-24T05:00:00Z",timeSpentSeconds:(i+1)*60,author:person("Dev")}]}});
    return row(jira,{storyDetails:detail(jira,"ROLE-"+i)});
  });
  const plan=prepared(rows), grouping=plan.facts.worklogs.byTeamRole;
  assert.equal(grouping.totalGroups,16);
  assert.ok(grouping.groups.length<=10);
  assert.equal(grouping.omittedGroups,16-grouping.groups.length);
  assert.equal(grouping.omittedSeconds,Array.from({length:16-grouping.groups.length},(_,i)=>(i+1)*60).reduce((a,b)=>a+b,0));
  assert.equal(grouping.groups[0].role,"ROLE-15");
  assert.equal(plan.facts.worklogs.knownSeconds,8160);
  assert.match(plan.request.userPrompt,/omittedGroups/);
});

test("long role labels do not merge distinct full-scope worklog groups", () => {
  const rows=["A","B"].map((suffix,i)=>{
    const jira=issue("P-"+(i+1),"Open",[],{worklog:{startAt:0,total:1,worklogs:[
      {id:"one",started:"2026-09-24T05:00:00Z",timeSpentSeconds:60,author:person("Dev")}]}});
    return row(jira,{storyDetails:detail(jira,"R".repeat(90)+suffix)});
  });
  const plan=prepared(rows);
  assert.equal(plan.facts.worklogs.byTeamRole.totalGroups,2);
  assert.equal(plan.facts.worklogs.knownSeconds,120);
  assert.ok(plan.meta.truncatedFields>=2);
});

test("report leaves question headroom even when detail selection is dense", () => {
  const rows=Array.from({length:10},(_,i)=>{
    const jira=issue("P-"+(i+1),"Open",[
      transition("a","2026-09-22T05:00:00Z","Done","Open"),
      transition("b","2026-09-23T05:00:00Z","Open","Done"),
      transition("c","2026-09-24T05:00:00Z","Done","Open")]);
    return row(jira,{summary:"🙂".repeat(100)});
  });
  const engine=brief(), plan=engine.prepare(rows,teams.defaults(),options);
  assert.ok(plan.meta.userBytes<=15000);
  const preview=engine.preview(plan,{question:"Почему? "+"q".repeat(1700),history:[{question:"prior",answer:"context"}]});
  assert.equal(preview.meta.conversationOmitted,0);
  assert.ok(preview.meta.userBytes<=18000);
});

test("run makes one bounded call, supports a question, and rejects oversize before transport", async () => {
  const engine=brief(), plan=engine.prepare([row(issue("P-1"))],teams.defaults(),options), calls=[];
  const request=async payload=>{calls.push(payload);return {text:"Готово"};};
  const result=await engine.run(plan,request,{question:"Что изменилось?",history:[{question:"old",answer:"answer"}]});
  assert.equal(result.markdown,"Готово");
  assert.deepEqual([result.completedParts,result.totalParts,result.eventCount],[1,1,plan.eventCount]);
  assert.equal(calls.length,1);
  assert.ok(Buffer.byteLength(calls[0].userPrompt)<=18000);
  assert.match(calls[0].userPrompt,/Что изменилось/);
  await assert.rejects(engine.run(plan,request,{question:"🙂".repeat(10000)}),/лимит|размер|байт/i);
  assert.equal(calls.length,1);
});

test("preview uses run packing and discloses omitted conversation before transport", async () => {
  const engine=brief(), plan=engine.prepare([row(issue("P-1"))],teams.defaults(),options);
  const history=Array.from({length:20},(_,i)=>({question:"old "+i+"🙂".repeat(500),answer:"answer "+i+"🙂".repeat(500)}));
  const preview=engine.preview(plan,{question:"Что изменилось?",history});
  assert.ok(preview.meta.conversationOmitted>0);
  assert.equal(preview.meta.conversationClipped,0);
  assert.equal(preview.meta.userBytes,Buffer.byteLength(preview.request.userPrompt));
  assert.ok(preview.meta.userBytes<=18000);
  let sent;
  await engine.run(plan,async request=>{sent=request;return {text:"ok"};},{question:"Что изменилось?",history});
  assert.equal(sent.userPrompt,preview.request.userPrompt);
  assert.equal(preview.request.allowProtocolFallback,false);
  assert.equal(sent.allowProtocolFallback,false);
  assert.deepEqual(engine.preview(plan,{}).request,plan.request);
  assert.throws(()=>engine.preview(plan,{question:"🙂".repeat(10000)}),/лимит.*байт/i);
});

test("run checks cancellation before and after call, and never retries failures", async () => {
  const engine=brief(), plan=engine.prepare([],[],options); let calls=0;
  await assert.rejects(engine.run(plan,async()=>{calls++;return {text:"late"};},{isCancelled:()=>true}),/отмен/i);
  assert.equal(calls,0);
  await assert.rejects(engine.run(plan,async()=>{calls++;throw new Error("offline");}),/offline/);
  assert.equal(calls,1);
  let cancelled=false;
  await assert.rejects(engine.run(plan,async()=>{calls++;cancelled=true;return {text:"late"};},{isCancelled:()=>cancelled}),/отмен/i);
  assert.equal(calls,2);
});
