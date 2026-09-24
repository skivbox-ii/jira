const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const load = require("./helpers/load-amd-module");
const dir = path.join(__dirname,"../ujg-excel-story-importer-modules");
const teams = load(path.join(dir,"teams.js"),{});
const stats = () => load(path.join(dir,"statistics.js"),{_ujgESI_teams:teams});
const task = (key,role,status,extra={}) => Object.assign({key,role,status},extra);
const row = (key,status,children=[]) => ({jiraKey:key,storyDetails:task(key,"",status),childStatuses:children});
const count = (result,key) => result.outcomes.find(x=>x.key===key).count;

test("team matching uses stable identifiers or exact role aliases, never names",()=>{
  const list=teams.defaults(); list[0].members=[{id:"dev",label:"Alex",identifiers:["u1"]}];
  assert.equal(teams.forUser(list,["u1"])[0].id,"be");
  assert.equal(teams.forUser(list,["Alex"]).length,0);
  assert.equal(teams.forRole(list,"be")[0].id,"be");
  assert.equal(teams.forRole(list,"BEST").length,0);
});

test("local reassignment replaces memberships without mutating source and accepts explicit removal",()=>{
  const list=teams.defaults(); list[0].members=[{id:"dev",label:"Alex",identifiers:["u1"]}];
  list[3].members=[{id:"u1",label:"Alex",identifiers:["dev"]}];
  const next=teams.assignUser(list,{id:"u1",label:"Alex",identifiers:["u1","dev"]},"fe");
  assert.equal(teams.forUser(next,["dev"]).length,1);
  assert.equal(teams.forUser(next,["dev"])[0].id,"fe");
  assert.equal(list[0].members.length,1);
  assert.equal(teams.forUser(teams.assignUser(next,{id:"dev",label:"Alex",identifiers:["dev"]},""),["dev"]).length,0);
  assert.throws(()=>teams.assignUser(next,{label:"Alex"},"qa"),/идентификатор/i);
  assert.throws(()=>teams.assignUser(next,{id:"dev"},"missing"),/команд/i);
});

test("one unique remark can have simultaneous development and testing without inflating the total",()=>{
  const a=row("P-1","Open",[task("P-2","BE","In progress"),task("P-3","QA","Testing")]);
  const result=stats().summarize([a,a],teams.defaults());
  assert.equal(result.total,1); assert.equal(result.sourceRows,2); assert.equal(count(result,"open"),1);
  assert.equal(result.directions.find(x=>x.key==="development").remarks,1);
  assert.equal(result.directions.find(x=>x.key==="testing").remarks,1);
  assert.equal(result.teams.find(x=>x.key==="be").open,1);
  assert.equal(result.teams.find(x=>x.key==="qa").open,1);
  assert.equal(result.outcomes.reduce((sum,x)=>sum+x.count,0),result.total);
});

test("ready requires parent and every linked task done; missing or unlinked data never imply ready",()=>{
  const result=stats().summarize([
    row("P-1","Done",[task("P-2","QA","Done")]),
    row("P-3","Open",[task("P-4","QA","Done")]),
    row("P-5","Done",[task("P-6","QA","Unknown")]),
    {jiraKey:"P-7"},
    row("P-8","Done",[task("P-9","QA","Done",{linkedToParent:false})]),
    {id:"sheet:2",summary:"New"}
  ],teams.defaults());
  assert.equal(count(result,"ready"),1); assert.equal(count(result,"open"),1);
  assert.equal(count(result,"incomplete"),3); assert.equal(count(result,"uncreated"),1);
});

test("cancellations are separate from readiness and completed parents with open children remain open",()=>{
  const result=stats().summarize([
    row("P-1","Cancelled"),row("P-2","Done",[task("P-3","QA","Cancelled")]),
    row("P-4","Done",[task("P-5","BE","In progress")])
  ],teams.defaults());
  assert.equal(count(result,"ready"),0); assert.equal(count(result,"cancelled"),2); assert.equal(count(result,"open"),1);
});

test("withdrawn Jira tasks in a done category are cancelled, not successfully completed",()=>{
  const withdrawn=row("P-1","Снята"); withdrawn.storyDetails.statusCategory="done";
  const result=stats().summarize([withdrawn],teams.defaults());
  assert.equal(count(result,"ready"),0); assert.equal(count(result,"cancelled"),1);
});

test("an explicit active status category takes precedence over a completion-like name",()=>{
  const active=row("P-1","Resolved");
  Object.assign(active.storyDetails,{done:false,statusCategory:"indeterminate",statusState:"progress"});
  const result=stats().summarize([active],teams.defaults());
  assert.equal(count(result,"ready"),0); assert.equal(count(result,"open"),1);
});

test("conflicting copies of a linked task are incomplete consistently across all remarks and slices",()=>{
  const a=row("P-1","Done",[task("P-9","BE","Done")]);
  const b=row("P-2","Done",[task("P-9","BE","Open")]);
  for (const rows of [[a,b],[b,a]]) {
    const result=stats().summarize(rows,teams.defaults());
    assert.equal(count(result,"ready"),0); assert.equal(count(result,"incomplete"),2);
    const be=result.roles.find(x=>x.key==="BE");
    assert.equal(be.unknown,1); assert.equal(be.open,0); assert.equal(be.done,0);
    assert.equal(result.teams.find(x=>x.key==="be").open,0);
  }
  const duplicate=row("P-1","Open",[task("P-9","BE","Done")]);
  assert.equal(count(stats().summarize([a,duplicate],teams.defaults()),"incomplete"),1);
});

test("moving a user clears memberships connected through stable aliases regardless of team order",()=>{
  const list=teams.defaults();
  list[0].members=[{id:"legacy",label:"Alex",identifiers:["middle"]}];
  list[3].members=[{id:"middle",label:"Alex",identifiers:["latest"]}];
  const next=teams.assignUser(list,{id:"latest",label:"Alex"},"fe");
  assert.equal(next[0].members.length,0); assert.equal(next[3].members.length,0);
  assert.deepEqual(Array.from(teams.forUser(next,["legacy"]),x=>x.id),["fe"]);
});

test("team ownership uses membership before role and roles remain a separate work slice",()=>{
  const list=teams.defaults(); list[3].members=[{id:"qa-user",label:"Alex",identifiers:["u1"]}];
  const result=stats().summarize([row("P-1","Open",[task("P-2","BE","Testing",{assigneeIdentifiers:["u1"]})])],list);
  assert.equal(result.teams.find(x=>x.key==="qa").testing,1);
  assert.equal(result.teams.find(x=>x.key==="be").open,0);
  assert.equal(result.roles.find(x=>x.key==="BE").testing,1);
});

test("generic coordinator does not manufacture development team workload",()=>{
  const list=teams.defaults(); list[0].members=[{id:"dev",label:"Dev",identifiers:["dev"]}];
  const a=row("P-1","In progress",[task("P-2","QA","Testing")]);
  a.storyDetails.assigneeIdentifiers=["dev"];
  const result=stats().summarize([a],list);
  assert.equal(result.teams.find(x=>x.key==="be").open,0);
  assert.equal(result.teams.find(x=>x.key==="qa").open,1);
});

test("duplicate child keys across remarks count once per team but both affected remarks",()=>{
  const child=task("P-9","BE","Open");
  const result=stats().summarize([row("P-1","Open",[child,child]),row("P-2","Open",[child])],teams.defaults());
  const be=result.teams.find(x=>x.key==="be");
  assert.equal(be.open,1); assert.equal(be.remarks,2); assert.equal(be.waiting,1);
});

test("unassigned work and unknown role are visible without arbitrary team assignment",()=>{
  const result=stats().summarize([row("P-1","Open",[task("P-2","","In progress")])],teams.defaults());
  assert.equal(result.teams.find(x=>x.key==="__unassigned").open,1);
  assert.equal(result.roles.find(x=>x.key==="__none").open,1);
});

test("statistics handle empty input and unsafe labels as data",()=>{
  const result=stats().summarize([],teams.defaults());
  assert.equal(result.total,0); assert.equal(result.outcomes.reduce((sum,x)=>sum+x.count,0),0);
  const r=stats().summarize([row("__proto__","Open",[task("P-2","<script>","Open")])],[]);
  assert.equal(r.total,1); assert.equal(r.roles.find(x=>x.key==="<SCRIPT>").waiting,1);
});
