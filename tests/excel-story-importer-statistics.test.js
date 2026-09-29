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

test("implementation assignee moves only nonclosed original stories into processed",()=>{
  const configured=teams.defaults();
  configured.find(x=>x.direction==="implementation").members=[{id:"impl-old",label:"Alex",identifiers:["impl-current"]}];
  const cases=[
    ["Open",{}],
    ["На тестировании",{done:true,statusCategory:"done",statusState:"done"}],
    ["Done",{}],
    ["Снята",{done:true,statusCategory:"done"}],
    ["Mystery",{}]
  ];
  const rows=cases.map(([status,metadata],index)=>{
    const r=row("P-"+(index+1),status);
    Object.assign(r.storyDetails,metadata,{assigneeIdentifiers:["impl-current"]});
    return r;
  });
  rows.push(row("P-6","Open",[task("P-60","IMP","Open",{assigneeIdentifiers:["impl-current"]})]));
  rows.push(row("P-7","Open")); rows[6].storyDetails.assignee="Alex";
  rows.push(row("P-8","Testing")); rows[7].storyDetails.role="IMP";
  rows.push({id:"sheet:1",summary:"Uncreated"});
  rows.push(rows[0]);
  const conflict=row("P-9","Done"); conflict.storyDetails.assigneeIdentifiers=["impl-current"];
  const conflictCopy=row("P-9","Open"); conflictCopy.storyDetails.assigneeIdentifiers=["impl-current"];
  rows.push(conflict,conflictCopy);
  for(const input of [rows,rows.slice().reverse()]) {
    const result=stats().summarize(input,configured),s=result.stories;
    assert.equal(s.total,9); assert.equal(s.processed,2);
    assert.equal(s.done,1); assert.equal(s.cancelled,1); assert.equal(s.testing,1);
    assert.equal(s.open,2); assert.equal(s.unknown,2); assert.equal(s.uncreated,1);
    assert.equal(s.done+s.processed+s.testing+s.cancelled+s.open+s.unknown,s.total);
    assert.equal(result.sourceRows,12);
  }
});

test("cancelled testing metadata remains cancelled for implementation assignees",()=>{
  const configured=teams.defaults();
  configured.find(x=>x.direction==="implementation").members=[{id:"impl",label:"Impl",identifiers:[]}];
  const r=row("P-1","Testing");
  Object.assign(r.storyDetails,{statusState:"cancelled",assigneeIdentifiers:["impl"]});
  const s=stats().summarize([r],configured).stories;
  assert.equal(s.cancelled,1); assert.equal(s.processed,0); assert.equal(s.testing,0);
});

test("same-key active story snapshots with conflicting implementation membership stay unknown",()=>{
  const configured=teams.defaults();
  configured.find(x=>x.direction==="implementation").members=[
    {id:"impl-old",label:"Impl A",identifiers:["impl-alias"]},
    {id:"impl-two",label:"Impl B",identifiers:[]}
  ];
  configured.find(x=>x.direction==="development").members=[{id:"dev",label:"Dev",identifiers:[]}];
  function assigned(status,id) {
    const r=row("P-1",status);
    r.storyDetails.assigneeIdentifiers=id ? [id] : [];
    return r;
  }
  for(const other of ["", "dev"]) {
    for(const input of [[assigned("Open","impl-old"),assigned("Open",other)],
      [assigned("Open",other),assigned("Open","impl-old")]]) {
      const s=stats().summarize(input,configured).stories;
      assert.equal(s.total,1); assert.equal(s.unknown,1);
      assert.equal(s.processed,0); assert.equal(s.open,0);
    }
  }
  for(const other of ["impl-alias","impl-two"]) {
    for(const input of [[assigned("Testing","impl-old"),assigned("Testing",other)],
      [assigned("Testing",other),assigned("Testing","impl-old")]]) {
      const s=stats().summarize(input,configured).stories;
      assert.equal(s.total,1); assert.equal(s.processed,1);
      assert.equal(s.unknown,0); assert.equal(s.testing,0);
    }
  }
  for(const status of ["Done","Cancelled"]) {
    const s=stats().summarize([assigned(status,"impl-old"),assigned(status,"")],configured).stories;
    assert.equal(s[status==="Done" ? "done" : "cancelled"],1);
    assert.equal(s.unknown,0); assert.equal(s.processed,0);
  }
});

test("story summary counts original statuses once, independently of child completion",()=>{
  const ready=row("P-1","Выполнено",[task("P-11","BE","In progress")]);
  const withdrawn=row("P-3","Снята"); withdrawn.storyDetails.statusCategory="done";
  const issued=row("P-4","Выдано",[task("P-13","BE","Done")]); issued.storyDetails.statusCategory="new";
  const rows=[ready,ready,row("P-2","На тестировании",[task("P-12","QA","Cancelled")]),
    withdrawn,issued,row("P-5","В работе")];
  const before=JSON.stringify(rows),result=stats().summarize(rows,[]);
  assert.ok(result.stories,"main story summary is present");
  const s=result.stories;
  assert.equal(s.total,5); assert.equal(s.done,1); assert.equal(s.testing,1);
  assert.equal(s.cancelled,1); assert.equal(s.open,2); assert.equal(s.unknown,0);
  assert.equal(s.done+s.testing+s.cancelled+s.open+s.unknown,s.total);
  assert.deepEqual(Array.from(s.openStatuses,x=>[x.label,x.count]),[["В работе",1],["Выдано",1]]);
  assert.equal(count(result,"ready"),0,"legacy all-ticket completion stays separate");
  assert.equal(JSON.stringify(rows),before);
});

test("unknown and conflicting parent status stays outside the four known story groups",()=>{
  const rows=[{jiraKey:"P-1"},row("P-2","Unknown"),row("P-3","Done"),row("P-3","Open"),
    {id:"sheet:1",summary:"Not created"},row("P-4","Done",[task("P-14","QA","Unknown")])];
  for(const input of [rows,rows.slice().reverse()]) {
    const result=stats().summarize(input,[]),s=result.stories;
    assert.ok(s,"main story summary is present");
    assert.equal(s.total,4); assert.equal(s.unknown,3); assert.equal(s.done,1);
    assert.equal(s.open,0); assert.equal(s.testing,0); assert.equal(s.cancelled,0);
    assert.equal(s.uncreated,1); assert.equal(s.total+s.uncreated,result.total);
  }
});

test("story summary honors active Jira category and does not invent stories from Excel rows",()=>{
  const active=row("P-1","Resolved");
  Object.assign(active.storyDetails,{done:false,statusCategory:"indeterminate",statusState:"progress"});
  const s=stats().summarize([active,{id:"source:1"}],[]).stories;
  assert.ok(s,"main story summary is present");
  assert.equal(s.done,0); assert.equal(s.open,1); assert.equal(s.total,1); assert.equal(s.uncreated,1);
  const empty=stats().summarize([],[]).stories;
  assert.equal(empty.total+empty.done+empty.testing+empty.cancelled+empty.open+empty.unknown+empty.uncreated,0);
  assert.equal(empty.openStatuses.length,0);
});

test("explicit testing story status is not counted as fixed by a terminal workflow category",()=>{
  for(const status of ["На тестировании","Тестирование","In Testing","На проверке"]) {
    const r=row("P-1",status);
    Object.assign(r.storyDetails,{done:true,statusCategory:"done",statusState:"done"});
    const s=stats().summarize([r],[]).stories;
    assert.equal(s.testing,1,status); assert.equal(s.done,0,status);
  }
});

test("story status conflicts within one broad stage and missing status names stay unknown",()=>{
  const a=row("P-1","Open"),b=row("P-1","To do");
  const missing=row("P-2",""); missing.storyDetails.statusCategory="new";
  for(const rows of [[a,b,missing],[b,a,missing]]) {
    const s=stats().summarize(rows,[]).stories;
    assert.equal(s.unknown,2); assert.equal(s.open,0); assert.equal(s.openStatuses.length,0);
  }
});

test("story totals use original parent data rather than linked copies in another group",()=>{
  const rows=[row("P-1","Open",[task("P-2","","Open")]),row("P-2","Done")];
  for(const input of [rows,rows.slice().reverse()]) {
    const s=stats().summarize(input,[]).stories;
    assert.equal(s.total,2); assert.equal(s.done,1); assert.equal(s.open,1); assert.equal(s.unknown,0);
  }
  const active=row("P-2","Done"); Object.assign(active.storyDetails,{done:false,statusCategory:"indeterminate"});
  assert.equal(stats().summarize([row("P-2","Done"),active],[]).stories.unknown,1,
    "Contradictory original parent stages remain unknown even with identical names");
});

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
