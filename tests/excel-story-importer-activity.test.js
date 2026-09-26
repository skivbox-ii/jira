const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const load = require("./helpers/load-amd-module");
const dir = path.join(__dirname, "../ujg-excel-story-importer-modules");
const teams = load(path.join(dir, "teams.js"), {});
const remarkId = load(path.join(dir,"remark-id.js"),{});
const deadlines = load(path.join(dir,"deadlines.js"),{_ujgESI_config:load(path.join(dir,"config.js"),{})});
const activity = () => load(path.join(dir, "activity.js"), {_ujgESI_teams: teams,_ujgESI_remarkId:remarkId,_ujgESI_deadlines:deadlines},{URL});
const complete = histories => ({startAt: 0, total: histories.length, histories});
const person = (key, label) => ({key, displayName: label});
const item = (field, from, to, fromString = from, toString = to) => ({field, from, to, fromString, toString});
const history = (id, created, author, items) => ({id, created, author: person(author, author), items});
test("task returns survive an unfinished parent and distinguish reopening from review rollback", () => {
  const api=activity(), parent=detail(api,issue("P-1","Open"));
  const child=detail(api,issue("P-2","In Progress",[
    history("a","2026-09-24T05:00:00Z","QA",[item("status","2","3","Done","In Review")]),
    history("b","2026-09-24T05:23:00Z","Reviewer",[item("status","3","1","In Review","In Progress")])
  ]),"BE");
  const result=report(api,[row(parent,[child])]);
  assert.equal(result.metrics.reopened,0,"The whole remark was never fully ready");
  assert.equal(result.metrics.taskReturns,1,"Count distinct tasks, not transitions");
  assert.deepEqual(Array.from(result.groups[0].taskReturns,e=>e.returnKind),["reopened","review"]);
  assert.equal(result.groups[0].taskReturns[1].author.label,"Reviewer");
  assert.match(api.eventText(result.events[0]),/Переоткрыта после завершения/);
  assert.match(api.eventText(result.events[1]),/Возвращена с проверки/);
  assert.equal(result.returns.events,2);
  assert.equal(result.returns.remarks,1);
});
test("all known unfinished destinations reopen a completed task, without guessing unknown or cancelled states", () => {
  const api=activity();
  for (const to of ["In Progress","In Review","Testing","Open","Выдано","Готово к тестированию","Blocked"]) {
    assert.equal(api.returnKind({kind:"status",from:"Готово",to}),"reopened",to);
    assert.match(api.eventText({kind:"status",from:"Готово",to}),/Переоткрыта после завершения/,to);
  }
  for (const [from,to] of [["Done","Done"],["Done","Cancelled"],["Done","Unknown stage"],["In Progress","In Review"],["Open","In Progress"],["Cancelled","In Progress"]]) {
    assert.equal(api.returnKind({kind:"status",from,to}),null,from+" -> "+to);
  }
  assert.equal(api.returnKind({kind:"status",from:"Тестирование",to:"Выдано"}),"testing");
  assert.equal(api.returnKind({kind:"status",from:"Custom finished",to:"Custom active",fromStatus:{name:"Custom finished",category:"done"},toStatus:{name:"Custom active",category:"indeterminate"}}),"reopened");
  assert.equal(api.returnKind({kind:"status",from:"Done",to:"In Progress",fromStatus:{name:"Done",category:"new"}}),null,"Category overrides the label");
});
test("partial history exposes observed task returns as a lower bound and deduplicates shared tasks", () => {
  const api=activity(), child=detail(api,issue("P-2","In Progress",[history("a","2026-09-24T05:23:00Z","Reviewer",[item("status","3","1","In Review","In Progress")])]),"BE");
  const parent=detail(api,issue("P-1","Open")), other=detail(api,issue("P-3","Open"));
  other.activity.complete=false;
  const result=report(api,[row(parent,[child]),row(other,[child])]);
  assert.equal(result.metrics.taskReturns,null);
  assert.equal(result.observed.taskReturns,1);
  assert.equal(result.returns.events,1);
  assert.equal(result.returns.remarks,2);
  assert.equal(result.groups[0].taskReturns.length,1);
});
test("status tones distinguish issued active review testing done and unknown states", () => {
  const api=activity();
  for (const [name,tone] of [["Выдано","todo"],["В работе","progress"],["На проверке","review"],["Тестирование","testing"],["Выполнено","done"],["Готово","done"],["Принято","done"],["Неизвестно","unknown"]]) assert.equal(api.statusTone(name),tone);
  assert.equal(api.statusTone({name:"Custom",category:"done"}),"done");
  assert.equal(api.statusTone({name:"Done",category:"new"}),"todo");
});
test("HTML export retains task return evidence and color labels", () => {
  const api=activity(), parent=detail(api,issue("P-1","Open")), child=detail(api,issue("P-2","In Progress",[history("a","2026-09-24T05:23:00Z","Reviewer",[item("status","3","1","In Review","In Progress")])]),"BE");
  const html=api.exportHtml(report(api,[row(parent,[child])]),{baseUrl:"https://jira.test"});
  assert.match(html,/<th>Возвраты задач<\/th><td>1<\/td>/);
  assert.match(html,/aria-label="Возвраты задач"/);
  assert.match(html,/class="status is-review"/);
  assert.match(html,/08:23 МСК.*href="https:\/\/jira.test\/browse\/P-2".*BE.*Возвращена с проверки.*Reviewer/s);
});
test("category overrides also govern event wording and same-name status IDs remain real transitions", () => {
  const api=activity();
  const terminal={kind:"status",from:"In Review",to:"In Progress",toStatus:{name:"In Progress",category:"done"}};
  assert.equal(api.returnKind(terminal),null);
  assert.doesNotMatch(api.eventText(terminal),/Возвращена|Взята в работу/);
  const task=detail(api,issue("P-1","Done",[history("a","2026-09-24T05:23:00Z","Reviewer",[item("status","2","3","Done","Done")])],{fields:{status:{id:"3",name:"Done",statusCategory:{key:"new"}}}}));
  const result=report(api,[row(task)]);
  assert.equal(result.metrics.taskReturns,1);
  assert.match(api.eventText(result.events[0]),/Переоткрыта после завершения/);
  assert.equal(result.transitions.length,1);
  assert.equal(result.transitions[0].count,1);
});
function issue(key, status, histories = [], extra = {}) {
  return {key, fields: {summary: key + " summary", created: "2026-09-20T00:00:00Z", updated: "2026-09-24T20:00:00Z",
    status: {id: status === "Done" ? "2" : "1", name: status, statusCategory: {key: status === "Done" ? "done" : "new"}},
    assignee: person("owner", "Owner"), ...extra.fields}, changelog: extra.changelog || complete(histories)};
}
function detail(api, jira, role = "") {
  return {key: jira.key, summary: jira.fields.summary, status: jira.fields.status.name,
    statusCategory: jira.fields.status.statusCategory && jira.fields.status.statusCategory.key || "", assignee: jira.fields.assignee && jira.fields.assignee.displayName || "",
    assigneeIdentifiers: jira.fields.assignee ? [jira.fields.assignee.key] : [], role, activity: api.capture(jira)};
}
function row(parent, children = []) { return {jiraKey: parent.key, summary: "Remark", storyDetails: parent, childStatuses: children}; }
function report(api, rows, options = {}) { return api.summarize(rows, teams.defaults(), {date: "2026-09-24", now: "2026-09-24T12:00:00Z", ...options}); }

test("component scope uses parent components, OR selection and distinct remark counts", () => {
  const api=activity(), a=detail(api,issue("P-1","Done")), b=detail(api,issue("P-3","Done"));
  const child=detail(api,issue("P-2","Open"));
  a.components=[{id:"10",name:"Экран"},{id:"20",name:"Сервер"}];
  b.components=[{id:"20",name:"Сервер"}]; child.components=[{id:"30",name:"Другое"}];
  const rows=[row(a,[child]),row(b)], full=report(api,rows);
  assert.equal(api.componentFacets(full).find(c=>c.id==="component:10").open,1);
  assert.equal(api.componentFacets(full).find(c=>c.id==="component:20").open,1);
  assert.equal(api.componentFacets(full).some(c=>c.id==="component:30"),false);
  assert.equal(api.componentRows(rows,["component:10","component:20"]).length,2);
  assert.equal(api.componentRows(rows,[]).length,0);
  assert.equal(api.componentRows(rows,null).length,2);
  const scoped=report(api,api.componentRows(rows,["component:10"]));
  assert.equal(scoped.groups.length,1);
  assert.equal(scoped.confirmed.balance.endOpen,1,"Ready parent with open child is not a ready remark");
});

test("component selection retains every source row of a matching parent", () => {
  const api=activity(), parent=detail(api,issue("P-1","Done")), child=detail(api,issue("P-2","Open"));
  parent.components=[{id:"10",name:"Экран"}];
  const rows=[row(parent),row({...parent,components:[]},[child])];
  const full=report(api,rows), facets=api.componentFacets(full), selected=api.componentRows(rows,["component:10"]);
  assert.equal(selected.length,2);
  assert.deepEqual(Array.from(full.groups[0].components,item=>item.id),["component:10","none"]);
  assert.equal(facets.find(item=>item.id==="component:10").total,1);
  assert.equal(facets.find(item=>item.id==="none").open,1);
  assert.equal(report(api,selected).confirmed.balance.endOpen,1);
});

test("scoped cutoff stays at the full snapshot while deadline day stays current", () => {
  const api=activity(), early=detail(api,issue("P-1","Open"));
  const later=detail(api,issue("P-2","Done",[history("close","2026-09-24T10:00:00Z","Closer",[item("status","1","2","Open","Done")])]));
  early.components=[{id:"1",name:"A"}]; later.components=[{id:"2",name:"B"}];
  early.activity.capturedAt="2026-09-24T09:00:00Z";
  later.activity.capturedAt="2026-09-24T12:00:00Z";
  const rows=[row(early),row(later)], full=report(api,rows);
  const scoped=report(api,api.componentRows(rows,["component:2"]),{cutoff:full.asOf});
  assert.equal(full.asOf,"2026-09-24T09:00:00.000Z");
  assert.equal(api.componentFacets(full).find(item=>item.id==="component:2").open,1);
  assert.equal(scoped.asOf,full.asOf);
  assert.equal(scoped.confirmed.balance.endOpen,1);
  assert.equal(scoped.deadlineReferenceDate,full.deadlineReferenceDate);
});

test("component facets distinguish absent fields, empty lists and unconfirmed histories", () => {
  const api=activity(), a=detail(api,issue("P-1","Open")), b=detail(api,issue("P-2","Open")), c=detail(api,issue("P-3","Open"));
  b.components=[]; c.components=[{id:"10",name:"Экран"}]; c.activity.complete=false;
  const rows=[row(a),row(b),row(c)], facets=api.componentFacets(report(api,rows));
  assert.equal(facets.find(c=>c.id==="unknown").total,1);
  assert.equal(facets.find(c=>c.id==="none").open,1);
  assert.equal(facets.find(c=>c.id==="component:10").unknown,1);
  assert.equal(facets.find(c=>c.id==="component:10").open,0);
  b.componentsKnown=false;
  assert.equal(api.componentRows(rows,["none"]).length,0);
});

test("screen form is explicit source metadata, never inferred from summary", () => {
  const api=activity(), parent=detail(api,issue("P-1","Open"));
  parent.description="Импортировано из журнала замечаний.\n\n||Поле||Значение||\n|Экранная форма|Тренды|";
  let rows=[{...row(parent),summary:"Пульт 25"}];
  assert.deepEqual(Array.from(report(api,rows).groups[0].screenForms),["Тренды"]);
  const journalRows=[{jiraKey:"P-1",sourceColumns:{"Привязка к экранной форме":"Главная"}}];
  assert.deepEqual(Array.from(report(api,rows,{journalRows}).groups[0].screenForms),["Главная"]);
  parent.description="Проблема в форме отчёта";
  assert.deepEqual(Array.from(report(api,rows).groups[0].screenForms),[]);
});

test("duplicate parent rows retain each row's explicit imported screen form", () => {
  const api=activity(), parent=detail(api,issue("P-1","Open"));
  const first={...parent,description:"Импортировано из журнала замечаний.\n\n||Поле||Значение||\n|Экранная форма|Тренды|"};
  const second={...parent,description:"Импортировано из журнала замечаний.\n\n||Поле||Значение||\n|Экранная форма|Главная|"};
  assert.deepEqual(Array.from(report(api,[row(first),row(second)]).groups[0].screenForms),["Тренды","Главная"]);
});

test("HTML names the global component scope and explicit screen form safely", () => {
  const api=activity(), parent=detail(api,issue("P-1","Open")), result=report(api,[row(parent)]);
  result.componentScope=[{id:"component:10",name:"<Экран>"}];
  result.groups[0].screenForms=["<Главная>"];
  const html=api.exportHtml(result,{});
  assert.match(html,/Компоненты: &lt;Экран&gt;/);
  assert.match(html,/Форма: &lt;Главная&gt;/);
});

test("confirmed summary keeps verified remark totals beside an unrelated incomplete history", () => {
  const api=activity(), done=detail(api,issue("P-1","Done",[
    history("close","2026-09-24T05:00:00Z","Closer",[item("status","1","2","Open","Done")])
  ])), open=detail(api,issue("P-2","Open")), bad=detail(api,issue("P-3","Open"));
  bad.activity.complete=false; bad.activity.warnings=["Полнота истории Jira не подтверждена"];
  const result=report(api,[row(done),row(open),row(bad)]);
  assert.equal(result.metrics.completed,null,"Strict global totals remain unknown");
  assert.equal(result.confirmed.metrics.completed,1);
  assert.equal(result.confirmed.metrics.changed,1);
  assert.equal(result.confirmed.remarks,2);
  assert.equal(result.confirmed.totalRemarks,3);
  assert.deepEqual(JSON.parse(JSON.stringify(result.confirmed.balance)),{startOpen:2,endOpen:1});
  assert.equal(result.confirmed.excluded[0].key,"P-3");
  assert.match(result.confirmed.excluded[0].reasons.join(" "),/P-3.*Полнота истории/);
  assert.deepEqual(Array.from(result.groups,g=>g.confirmed),[true,true,false]);
});

test("subsecond Jira skew remains diagnostic across a second boundary, but a full second stays blocking", () => {
  const api=activity();
  for (const [updated,expectedComplete] of [["2026-09-25T10:53:03.998Z",true],["2026-09-25T10:53:03.001Z",true],["2026-09-25T10:53:03.000Z",false],["2026-09-25T10:53:02.999Z",false]]) {
    const jira=issue("P-21769","Open",[history("last","2026-09-25T10:53:04.000Z","Worker",[item("summary","Old","New")])],{fields:{updated}});
    const result=api.capture(jira);
    assert.equal(result.complete,expectedComplete,updated);
    assert.equal(result.diagnostics.length,expectedComplete?1:0,updated);
    assert.equal(result.histories[0].at,"2026-09-25T10:53:04.000Z","Do not alter source timestamps");
    assert.equal(result.updated,updated);
  }
});

test("confirmed summary never promotes incomplete, stale, future or missing-link groups to zero totals", () => {
  const api=activity();
  for (const mode of ["incomplete","stale","future","missing-links","conflict"]) {
    const parent=detail(api,issue("P-1","Done"));
    const source=row(parent), options={};
    if (mode==="incomplete") parent.activity.complete=false;
    if (mode==="stale") { parent.activity.capturedAt="2026-09-24T10:00:00Z"; options.now="2026-09-25T12:00:00Z"; }
    if (mode==="future") options.date="2026-09-26";
    if (mode==="missing-links") parent.activity.linkedKeys=["P-2"];
    const rows=[source];
    if (mode==="conflict") rows.push(row(detail(api,issue("P-1","Open"))));
    const result=report(api,rows,options);
    assert.equal(result.confirmed.remarks,0,mode);
    assert.equal(result.confirmed.metrics.completed,null,mode);
    assert.equal(result.confirmed.balance.endOpen,null,mode);
    assert.equal(result.confirmed.excluded.length,1,mode);
    assert.ok(result.confirmed.excluded[0].reasons.length,mode);
  }
});

test("one previous-day snapshot cannot move the fresh current-day confirmed slice before midnight", () => {
  const api=activity(), good=detail(api,issue("P-1","Done",[
    history("close","2026-09-24T05:00:00Z","Closer",[item("status","1","2","Open","Done")])
  ])), stale=detail(api,issue("P-2","Open"));
  good.activity.capturedAt="2026-09-24T11:59:00Z";
  stale.activity.capturedAt="2026-09-23T20:59:00Z";
  const result=report(api,[row(good),row(stale)]);
  assert.equal(result.asOf,"2026-09-24T11:59:00.000Z");
  assert.equal(result.confirmed.metrics.completed,1);
  assert.equal(result.confirmed.remarks,1);
  assert.equal(result.confirmed.excluded[0].key,"P-2");
  assert.match(result.confirmed.excluded[0].reasons.join(" "),/Данные задачи загружены раньше времени среза/);
});

test("confirmed summary excludes unknown boundary and intermediate statuses", () => {
  const api=activity();
  for (const histories of [[],[
    history("a","2026-09-24T05:00:00Z","Worker",[item("status","3","2","Mystery","Done")])
  ]]) {
    const jira=issue("P-1",histories.length?"Done":"Mystery",histories);
    if (!histories.length) jira.fields.status.statusCategory={key:""};
    const result=report(api,[row(detail(api,jira))]);
    assert.equal(result.confirmed.remarks,0);
    assert.equal(result.confirmed.metrics.completed,null);
    assert.match(result.confirmed.excluded[0].reasons.join(" "),/статус/);
  }
});

test("confirmed summary counts shared returned tasks once and excludes unverified new remarks", () => {
  const api=activity(), child=detail(api,issue("P-2","Open",[
    history("return","2026-09-24T05:00:00Z","Reviewer",[item("status","2","1","Done","Open")])
  ])), a=detail(api,issue("P-1","Open")), b=detail(api,issue("P-3","Open")), bad=detail(api,issue("P-4","Open",[],{fields:{created:"2026-09-24T01:00:00Z"}}));
  bad.activity.complete=false;
  const result=report(api,[row(a,[child]),row(b,[child]),row(bad)]);
  assert.equal(result.confirmed.metrics.taskReturns,1);
  assert.equal(result.confirmed.metrics.changed,2);
  assert.equal(result.confirmed.metrics.newRemarks,0);
  assert.equal(result.observed.newRemarks,1);
  assert.equal(result.confirmed.metrics.events,result.events.length,"Events retain their observed meaning");
});

test("full coverage has identical confirmed and strict counts including original remarks only", () => {
  const api=activity(), parent=detail(api,issue("P-1","Open")), child=detail(api,issue("P-2","Done",[
    history("close","2026-09-24T05:00:00Z","Closer",[item("status","1","2","Open","Done")])
  ]));
  const result=report(api,[row(parent,[child])]);
  assert.equal(result.confirmed.metrics.completed,0,"Closing a child is not closing the remark");
  assert.deepEqual(JSON.parse(JSON.stringify(result.confirmed.metrics)),JSON.parse(JSON.stringify(result.metrics)));
  assert.deepEqual(JSON.parse(JSON.stringify(result.confirmed.balance)),JSON.parse(JSON.stringify(result.balance)));
  assert.equal(result.confirmed.excluded.length,0);
});

test("HTML confirmed summary has plain numbers and explicit exclusions with safe links", () => {
  const api=activity(), good=detail(api,issue("P-1","Done",[
    history("close","2026-09-24T05:00:00Z","Closer",[item("status","1","2","Open","Done")])
  ])), bad=detail(api,issue("P-2","Open"));
  bad.activity.complete=false; bad.activity.warnings=["<script>bad</script>"];
  const result=report(api,[row(good),row(bad)]), html=api.exportHtml(result,{baseUrl:"https://jira.test"});
  assert.match(html,/<th>Завершённые<\/th><td>1<\/td>/);
  assert.doesNotMatch(html,/[≥≤]/);
  assert.match(html,/Подтверждено замечаний: 1 из 2/);
  assert.match(html,/Не включены в итоги замечаний/);
  assert.match(html,/href="https:\/\/jira.test\/browse\/P-2"/);
  assert.match(html,/&lt;script&gt;bad&lt;\/script&gt;/);
  assert.match(html,/на момент загрузки/);
  assert.doesNotMatch(html,/<script>bad/);
});

function withDeadline(parent, value, children = []) {
  return {...row(parent,children),sheetName:"Замечания",excelRowNumber:3,sourceColumns:{"Срок исполнения":value}};
}

test("overdue includes a remark with no events and exposes pending tasks and its owner", () => {
  const api=activity(), parent=detail(api,issue("P-1","Open"));
  const result=report(api,[withDeadline(parent,"23.09.2026")]);
  assert.equal(result.events.length,0);
  assert.equal(result.metrics.overdue,1);
  assert.equal(result.observed.overdue,1);
  const due=result.groups[0].deadline;
  assert.equal(due.state,"overdue");
  assert.equal(due.date,"2026-09-23");
  assert.equal(due.referenceDate,"2026-09-24");
  assert.equal(due.daysOverdue,1);
  assert.equal(due.owner.label,"Owner");
  assert.equal(due.pendingTasks[0].key,"P-1");
  assert.equal(result.deadlineCoverage.known,1);
});

test("inclusive current Moscow deadlines distinguish today tomorrow upcoming and yesterday", () => {
  const api=activity();
  for (const [date,state,remaining] of [["23.09.2026","overdue",-1],["24.09.2026","today",0],["25.09.2026","tomorrow",1],["26.09.2026","upcoming",2]]) {
    const result=report(api,[withDeadline(detail(api,issue("P-1","Open")),date)]);
    assert.equal(result.groups[0].deadline.state,state,date);
    assert.equal(result.groups[0].deadline.daysRemaining,remaining);
    assert.equal(result.metrics.overdue,state === "overdue" ? 1 : 0);
  }
  const midnightParent=detail(api,issue("P-1","Open"));
  midnightParent.activity.capturedAt="2026-09-24T21:00:01Z";
  const midnight=report(api,[withDeadline(midnightParent,"24.09.2026")],{now:"2026-09-24T21:00:00Z"});
  assert.equal(midnight.groups[0].deadline.state,"overdue","Midnight advances today's deadline even when the report day stays unchanged");
  assert.equal(midnight.groups[0].deadline.referenceDate,"2026-09-25");
});

test("closed root with open QA remains overdue but fully ready and cancelled remarks do not", () => {
  const api=activity(), done=detail(api,issue("P-1","Done")), qa=detail(api,issue("P-2","Open"),"QA");
  let result=report(api,[withDeadline(done,"21.09.2026",[qa])]);
  assert.equal(result.metrics.overdue,1);
  assert.deepEqual(Array.from(result.groups[0].deadline.pendingTasks,t=>t.key),["P-2"]);
  assert.equal(result.groups[0].deadline.pendingTasks[0].role,"QA");
  result=report(api,[withDeadline(done,"21.09.2026")]);
  assert.equal(result.groups[0].deadline.state,"completed");
  assert.equal(result.metrics.overdue,0);
  const cancelled=detail(api,issue("P-3","Cancelled",[],{fields:{status:{id:"3",name:"Cancelled",statusCategory:{key:"done"}}}}));
  result=report(api,[withDeadline(cancelled,"21.09.2026")]);
  assert.equal(result.groups[0].deadline.state,"cancelled");
  assert.equal(result.metrics.overdue,0);
});

test("deadline state is current and independent of the selected historical report day", () => {
  const api=activity(), parent=detail(api,issue("P-1","Open",[
    history("h1","2026-09-23T11:00:00Z","closer",[item("status","1","2","Open","Done")]),
    history("h2","2026-09-24T01:00:00Z","reviewer",[item("status","2","1","Done","Open")])
  ]));
  const rows=[withDeadline(parent,"22.09.2026")];
  const previous=report(api,rows,{date:"2026-09-23"});
  assert.equal(previous.groups[0].deadline.state,"overdue");
  assert.equal(previous.metrics.overdue,1);
  assert.equal(previous.groups[0].deadline.referenceDate,"2026-09-24");
  const current=report(api,rows);
  assert.equal(current.groups[0].deadline.state,"overdue");
  assert.equal(current.groups[0].deadline.daysOverdue,2);
  assert.equal(current.metrics.overdue,1);
});

test("missing invalid and conflicting deadlines are explicit and never replaced with creation dates", () => {
  const api=activity(), parent=detail(api,issue("P-1","Open"));
  const missing=report(api,[row(parent)]);
  assert.equal(missing.groups[0].deadline.state,"missing");
  assert.equal(missing.groups[0].deadline.date,null);
  assert.equal(missing.deadlineCoverage.missing,1);
  assert.equal(missing.metrics.overdue,0);
  const invalid=report(api,[withDeadline(parent,"31.02.2026")]);
  assert.equal(invalid.groups[0].deadline.state,"invalid");
  assert.equal(invalid.deadlineCoverage.invalid,1);
  assert.equal(invalid.metrics.overdue,null);
  const conflicting=report(api,[withDeadline(parent,"22.09.2026"),withDeadline(parent,"26.09.2026")]);
  assert.equal(conflicting.groups.length,1);
  assert.equal(conflicting.groups[0].deadline.state,"conflict");
  assert.equal(conflicting.deadlineCoverage.conflict,1);
  assert.equal(conflicting.metrics.overdue,null);
});

test("duplicate identical rows count once and deadline resolution leaves rows untouched", () => {
  const api=activity(), parent=detail(api,issue("P-1","Open"));
  const rows=[withDeadline(parent,"23.09.2026"),withDeadline(parent,"2026-09-23")], before=JSON.stringify(rows);
  const result=report(api,rows);
  assert.equal(result.metrics.overdue,1);
  assert.equal(result.deadlineCoverage.total,1);
  assert.equal(JSON.stringify(rows),before);
});

test("missing current snapshot leaves overdue state unknown and retains a confirmed lower bound", () => {
  const api=activity(), first=detail(api,issue("P-1","Open")), second=detail(api,issue("P-2","Open"));
  second.activity=null;
  const result=report(api,[withDeadline(first,"22.09.2026"),withDeadline(second,"23.09.2026")]);
  assert.equal(result.metrics.overdue,null);
  assert.equal(result.observed.overdue,1);
  assert.equal(result.groups[1].deadline.state,"unknown");
  assert.equal(result.deadlineCoverage.unknownState,1);
  const scoped=report(api,[withDeadline(first,"22.09.2026")],{scopeWarning:"Загружена часть проекта"});
  assert.equal(scoped.metrics.overdue,null);
  assert.equal(scoped.observed.overdue,1);
});

test("unknown statuses and missing children cannot certify overdue; report date does not affect it", () => {
  const api=activity(), parent=detail(api,issue("P-1","Open"));
  for (const rows of [[{...withDeadline(parent,"21.09.2026"),status:"partial"}],
    [withDeadline(detail(api,issue("P-2","Unknown",[],{fields:{status:{id:"9",name:"Unexpected"}}})),"21.09.2026")]]) {
    const result=report(api,rows);
    assert.equal(result.groups[0].deadline.state,"unknown");
    assert.equal(result.metrics.overdue,null);
  }
  const future=report(api,[withDeadline(parent,"21.09.2026")],{date:"2026-09-25"});
  assert.equal(future.metrics.overdue,1);
  assert.equal(future.observed.overdue,1);
});

test("current deadline needs current fields, not complete transition history", () => {
  const api=activity(), parent=detail(api,issue("P-1","Open"));
  parent.activity.complete=false;
  const result=report(api,[withDeadline(parent,"23.09.2026")],{date:"2026-09-20"});
  assert.equal(result.metrics.overdue,1);
  assert.equal(result.deadlineReferenceDate,"2026-09-24");
  parent.activity.capturedAt="2026-09-23T12:00:00Z";
  const stale=report(api,[withDeadline(parent,"23.09.2026")]);
  assert.equal(stale.metrics.overdue,null);
  assert.equal(stale.deadlineCoverage.unknownState,1);
});

test("overdue work uses the current owner even when the selected day had another assignee", () => {
  const api=activity(), parent=detail(api,issue("P-1","Open",[
    history("h1","2026-09-24T08:00:00Z","owner",[item("assignee","previous","owner","Previous","Owner")])
  ]));
  const result=report(api,[withDeadline(parent,"23.09.2026")],{date:"2026-09-23"});
  assert.equal(result.groups[0].management.tasks[0].assignee.label,"Previous");
  assert.equal(result.groups[0].deadline.owner.label,"Owner");
  assert.equal(result.groups[0].deadline.pendingTasks[0].assignee.label,"Owner");
});

test("a remark not yet created on the historical cutoff is not overdue", () => {
  const api=activity(), parent=detail(api,issue("P-1","Open",[],{fields:{created:"2026-09-24T13:00:00Z"}}));
  const result=report(api,[withDeadline(parent,"20.09.2026")]);
  assert.equal(result.metrics.overdue,0);
  assert.notEqual(result.groups[0].deadline.state,"overdue");
});

test("conflicting creation dates cannot certify absence at cutoff in either row order", () => {
  const api=activity(), past=detail(api,issue("P-1","Open")), future=detail(api,issue("P-1","Open",[],{fields:{created:"2026-09-24T13:00:00Z"}}));
  for (const copies of [[future,past],[past,future]]) {
    const result=report(api,copies.map(parent=>withDeadline(parent,"23.09.2026")));
    assert.equal(result.metrics.overdue,null);
    assert.equal(result.deadlineCoverage.unknownState,1);
  }
});

test("known open cutoff certifies overdue despite an unclassified earlier status", () => {
  const api=activity(), parent=detail(api,issue("P-1","Open",[
    history("h1","2026-09-24T08:00:00Z","owner",[item("status","9","1","Unclassified","Open")])
  ]));
  const result=report(api,[withDeadline(parent,"23.09.2026")]);
  assert.equal(result.groups[0].dayComplete,false);
  assert.equal(result.groups[0].deadline.state,"overdue");
  assert.equal(result.metrics.overdue,1);
});

test("known uncreated Excel row does not invalidate overdue Jira count", () => {
  const api=activity(), parent=detail(api,issue("P-1","Open"));
  const uncreated={jiraKey:"",summary:"Not created",sheetName:"Замечания",excelRowNumber:4,sourceColumns:{"Срок исполнения":"23.09.2026"}};
  const result=report(api,[withDeadline(parent,"23.09.2026"),uncreated]);
  assert.equal(result.metrics.overdue,1);
  assert.equal(result.deadlineCoverage.unknownState,0);
  assert.equal(result.groups[1].deadline.reason,"not-created-in-jira");
});

test("overdue owner and pending work are assigned to teams by identity on the selected cutoff", () => {
  const api=activity(), parent=detail(api,issue("P-1","Done")), child=detail(api,issue("P-2","Open"),"BE");
  const result=api.summarize([withDeadline(parent,"23.09.2026",[child])],[{id:"be",name:"BE",stage:"development",roles:["BE"],color:"#123456",members:[{id:"owner",label:"Owner",identifiers:["owner"]}]}],{date:"2026-09-24",now:"2026-09-24T12:00:00Z"});
  assert.equal(result.groups[0].deadline.pendingTasks[0].team,"BE");
  assert.equal(result.groups[0].deadline.pendingTasks[0].color,result.teams[0].color);
});

test("overdue export includes no-event groups dates and clear current-journal basis", () => {
  const api=activity(), result=report(api,[withDeadline(detail(api,issue("P-1","Open")),"23.09.2026")]);
  const html=api.exportHtml(result,{baseUrl:"https://jira.example.test"});
  assert.match(html,/Просроченные/);
  assert.match(html,/23\.09\.2026/);
  assert.match(html,/P-1/);
  assert.match(html,/текущего журнала/i);
  assert.match(html,/href="https:\/\/jira\.example\.test\/browse\/P-1"/);
  const filtered=api.exportHtml({...result,groups:[],deadlineGroups:result.groups});
  assert.match(filtered,/23\.09\.2026/);
  assert.match(filtered,/P-1/);
  const unsafe=api.exportHtml(result,{baseUrl:"javascript:alert(1)"});
  assert.doesNotMatch(unsafe,/href="javascript:/);
});

test("deadline conflict across source rows keeps all candidates in a quiet group and escaped export", () => {
  const api=activity(), parent=detail(api,issue("P-1","Open"));
  const first=withDeadline(parent,'<img src=x onerror="alert(1)">');
  const second=withDeadline(parent,"26.09.2026");
  second.sourceColumns={"Срок устранения":"26.09.2026"};
  const result=report(api,[first,second]);
  assert.equal(result.events.length,0);
  assert.equal(result.groups.length,1);
  assert.equal(result.groups[0].deadline.problem,"conflict");
  assert.deepEqual(JSON.parse(JSON.stringify(result.groups[0].deadline.candidates)),[
    {raw:'<img src=x onerror="alert(1)">',source:"excel",field:"Срок исполнения"},
    {raw:"26.09.2026",source:"excel",field:"Срок устранения"}
  ]);
  assert.equal(result.metrics.overdue,null);
  const html=api.exportHtml({...result,groups:[],deadlineGroups:result.groups},{baseUrl:"https://jira.example.test"});
  assert.match(html,/Не распознаны сроки/);
  assert.match(html,/&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
  assert.doesNotMatch(html,/<img src=x/);
  assert.match(html,/26\.09\.2026/);
});

test("equal invalid source rows retain distinct provenance without creating a conflict", () => {
  const api=activity(), parent=detail(api,issue("P-1","Open"));
  const first=withDeadline(parent,"  someday  ");
  const second=withDeadline(parent,"someday"); second.sourceColumns={"Срок устранения":"someday"};
  const result=report(api,[first,second]);
  const due=result.groups[0].deadline;
  assert.equal(due.problem,"invalid");
  assert.deepEqual(Array.from(due.candidates,c=>c.field),["Срок исполнения","Срок устранения"]);
});

test("deadline export preserves raw whitespace while escaping source markup", () => {
  const api=activity(), parent=detail(api,issue("P-1","Open")), raw="\t <b>later</b> \n";
  const result=report(api,[withDeadline(parent,raw)]);
  assert.equal(result.groups[0].deadline.candidates[0].raw,raw);
  const html=api.exportHtml(result,{baseUrl:"https://jira.example.test"});
  assert.ok(html.includes("<pre><span>\t &lt;b&gt;later&lt;/b&gt; \n</span></pre>"));
  assert.doesNotMatch(html,/<b>later<\/b>/);
});

test("change categories depend on changed data, never transition text or values", () => {
  const api=activity();
  const examples=[
    [{kind:"created"},"Создание задачи"],
    [{kind:"status",from:"Open",to:"In Progress"},"Статус"],
    [{kind:"status",from:"In Progress",to:"In Review"},"Статус"],
    [{kind:"status",from:"Done",to:"Open"},"Статус"],
    [{kind:"assignee",from:"Alice",to:"Bob"},"Исполнитель"],
    [{kind:"field",field:"description",from:"Old",to:"New"},"Описание"],
    [{kind:"field",field:"summary"},"Тема"],
    [{kind:"field",field:"timespent",from:"0",to:"3600"},"Трудозатраты"],
    [{kind:"field",field:"WorklogId"},"Трудозатраты"],
    [{kind:"field",field:"Time Spent"},"Трудозатраты"],
    [{kind:"field",field:"timeestimate"},"Оценка трудозатрат"],
    [{kind:"field",field:"timeoriginalestimate"},"Оценка трудозатрат"],
    [{kind:"field",field:"resolution"},"Результат"],
    [{kind:"field",field:"priority"},"Приоритет"],
    [{kind:"field",field:"duedate"},"Сроки"],
    [{kind:"field",field:"Link"},"Связи задач"],
    [{kind:"field",field:"attachment"},"Вложения"],
    [{kind:"field",field:"comment"},"Комментарии"],
    [{kind:"field",field:"labels"},"Параметры задачи"],
    [{kind:"field",field:"fixVersions"},"Параметры задачи"],
    [{kind:"field",field:"Описание"},"Описание"],
    [{kind:"field",field:"Локализованное поле",fieldId:"description"},"Описание"],
    [{kind:"field",field:"customfield_123",to:"Done"},"Другие поля"],
    [{kind:"field",field:"constructor"},"Другие поля"],
    [{kind:"field",field:"__proto__"},"Другие поля"],
    [null,"Другие поля"]
  ];
  examples.forEach(([event,expected])=>assert.equal(api.eventCategory(event),expected,JSON.stringify(event)));
});
test("captured field IDs survive into events for localized change categories", () => {
  const api=activity(), change={...item("Localized description","old","new"),fieldId:"description"};
  const parent=detail(api,issue("P-1","Open",[history("h1","2026-09-24T01:00:00Z","editor",[change])]));
  assert.equal(parent.activity.histories[0].items[0].fieldId,"description");
  const event=report(api,[row(parent)]).events[0];
  assert.equal(event.field,"Localized description");
  assert.equal(event.fieldId,"description");
  assert.equal(api.eventCategory(event),"Описание");
});

test("group context uses current parent status, unique linked children and observed day outcomes", () => {
  const api=activity();
  const parent=detail(api,issue("P-1","Open"));
  const done=detail(api,issue("P-2","Open",[
    history("h1","2026-09-24T01:00:00Z","editor",[item("status","1","2","Open","Done")]),
    history("h2","2026-09-24T02:00:00Z","editor",[item("status","2","1","Done","Open")]),
    history("h3","2026-09-24T03:00:00Z","editor",[item("status","1","1","Open","Open")])
  ]));
  const created=detail(api,issue("P-3","Open",[],{fields:{created:"2026-09-24T04:00:00Z"}}));
  const result=report(api,[row(parent,[done,created,done])]);
  assert.equal(result.groups[0].currentStatus,"Open");
  assert.equal(result.groups[0].linkedTaskCount,2);
  assert.deepEqual(JSON.parse(JSON.stringify(result.groups[0].dayHighlights)),{completed:1,created:1,reopened:1});
});

test("missing parent history cannot imply current readiness or complete day summary", () => {
  const api=activity(), parent={key:"P-1",summary:"Missing",status:"",role:""};
  const child=detail(api,issue("P-2","Done",[history("h","2026-09-24T01:00:00Z","editor",[item("status","1","2","Open","Done")])]));
  const result=report(api,[row(parent,[child])]);
  assert.equal(result.groups[0].currentStatus,null);
  assert.equal(result.groups[0].dayComplete,false);
  assert.deepEqual(JSON.parse(JSON.stringify(result.groups[0].dayHighlights)),{completed:1,created:0,reopened:0});
});
test("group status names the current parent state even when selected day predates its transition", () => {
  const api=activity();
  const parent=detail(api,issue("P-1","Done",[history("later","2026-09-25T01:00:00Z","editor",[item("status","1","2","Open","Done")])],{fields:{updated:"2026-09-25T02:00:00Z"}}));
  const result=report(api,[row(parent)],{now:"2026-09-26T12:00:00Z"});
  assert.equal(result.groups[0].currentStatus,"Done");
  assert.equal(result.groups[0].dayHighlights.completed,0);
  assert.match(api.exportHtml(result),/Сейчас: Выполнено/);
});
test("no-op status history does not count as day work", () => {
  const api=activity(), parent=detail(api,issue("P-1","Open",[
    history("h","2026-09-24T01:00:00Z","editor",[item("status","1","1","Open","Open")])
  ]));
  const result=report(api,[row(parent)]);
  assert.equal(result.groups[0].dayActivityCount,0);
  assert.equal(result.groups[0].dayNoopStatusCount,1);
  assert.match(api.exportHtml(result),/Статус без изменений/);
});
test("ordinary day edits count distinct tasks", () => {
  const api=activity(), parent=detail(api,issue("P-1","Open",[
    history("h1","2026-09-24T01:00:00Z","editor",[item("priority","1","2","Low","High")]),
    history("h2","2026-09-24T02:00:00Z","editor",[item("summary","a","b","Old","New")])
  ]));
  assert.equal(report(api,[row(parent)]).groups[0].dayActivityCount,1);
});
test("completion badge requires a known open prior status", () => {
  const api=activity();
  for (const prior of ["Released","Cancelled","Done"]) {
    const jira=issue("P-1","Done",[history("h","2026-09-24T01:00:00Z","editor",[item("status",prior === "Done" ? "2" : "1","2",prior,"Done")])]);
    const result=report(api,[row(detail(api,jira))]);
    assert.equal(result.groups[0].dayHighlights.completed,0,prior);
    assert.equal(result.groups[0].dayActivityCount,prior === "Done" ? 0 : 1,prior);
    assert.doesNotMatch(api.exportHtml(result),/Завершено 1/,prior);
  }
  const cancelled=issue("P-1","Cancelled",[history("h","2026-09-24T01:00:00Z","editor",[item("status","3","3","Cancelled","Cancelled")])],
    {fields:{status:{id:"3",name:"Cancelled",statusCategory:{key:"done"}}}});
  assert.equal(report(api,[row(detail(api,cancelled))]).groups[0].dayActivityCount,0);
});
test("identical field values are not activity, but distinct IDs and Worklog bookkeeping are", () => {
  const api=activity(), jira=issue("P-1","Open",[
    history("h1","2026-09-24T01:00:00Z","editor",[item("priority","1","1","Low","Low")]),
    history("h2","2026-09-24T02:00:00Z","editor",[item("assignee","a","b","Alex","Alex")]),
    history("h3","2026-09-24T03:00:00Z","editor",[item("WorklogId",null,null,null,null)])
  ],{fields:{assignee:person("b","Alex")}});
  const result=report(api,[row(detail(api,jira))]);
  assert.equal(result.groups[0].dayActivityCount,1);
  const onlyNoop=issue("P-2","Open",[history("h","2026-09-24T01:00:00Z","editor",[item("priority","1","1","Low","Low")])]);
  const noOpReport=report(api,[row(detail(api,onlyNoop))]);
  assert.equal(noOpReport.groups[0].dayActivityCount,0);
  assert.match(api.exportHtml(noOpReport),/Без изменений/);
  assert.doesNotMatch(api.exportHtml(noOpReport),/Изменено 1/);
  const worklog=issue("P-3","Open",[history("h","2026-09-24T01:00:00Z","editor",[item("WorklogId",null,null,null,null)])]);
  assert.equal(report(api,[row(detail(api,worklog))]).groups[0].dayActivityCount,1);
  const sameNameTransfer=issue("P-4","Open",[history("h","2026-09-24T01:00:00Z","editor",[item("assignee","a","b","Alex","Alex")])],
    {fields:{assignee:person("b","Alex")}});
  assert.equal(report(api,[row(detail(api,sameNameTransfer))]).groups[0].dayActivityCount,1);
  const sameNameValue=issue("P-5","Open",[history("h","2026-09-24T01:00:00Z","editor",[item("priority","1","2","Medium","Medium")])]);
  assert.equal(report(api,[row(detail(api,sameNameValue))]).groups[0].dayActivityCount,1);
});

test("search timestamps rounded to seconds do not invalidate millisecond changelog entries", () => {
  const api = activity();
  const h = history("h", "2026-09-24T09:00:00.853Z", "editor", [item("status", "1", "2", "Open", "Done")]);
  const jira = issue("P-1", "Done", [h], {fields:{updated:"2026-09-24T09:00:00.000Z"}});
  let snapshot = api.capture(jira);
  assert.equal(snapshot.complete, true);
  assert.deepEqual(Array.from(snapshot.warnings), []);
  assert.equal(snapshot.diagnostics.length, 1);
  assert.match(snapshot.diagnostics[0], /09:00:00\.853Z > 2026-09-24T09:00:00\.000Z/);
  let result = report(api,[row(detail(api,jira))],{now:"2026-09-24T09:00:01Z"});
  assert.equal(result.coverage.isComplete,true);
  assert.equal(result.coverage.incomplete,0);
  assert.match(result.coverage.diagnostics[0],/^P-1:.*09:00:00\.853Z/);
  jira.fields.updated = "2026-09-24T08:59:59.000Z";
  snapshot = api.capture(jira);
  assert.equal(snapshot.complete, false, "A later second remains contradictory");
  assert.match(snapshot.warnings.join(" "),/Изменение позже обновления/);
  assert.deepEqual(Array.from(snapshot.diagnostics),[]);
  jira.fields.updated = "2026-09-24T09:00:00.100Z";
  snapshot = api.capture(jira);
  assert.equal(snapshot.complete, true, "A same-second discrepancy stays diagnostic even with nonzero updated milliseconds");
  assert.equal(snapshot.diagnostics.length,1);
  assert.equal(snapshot.histories[0].at,"2026-09-24T09:00:00.853Z");
  result = report(api,[row(detail(api,jira))],{now:"2026-09-24T09:00:01Z"});
  assert.equal(result.coverage.isComplete,true);
  assert.equal(result.coverage.diagnostics.length,1);
});

test("events describe statuses, assignments and durations in plain Russian", () => {
  const api = activity();
  assert.equal(api.statusLabel("In Progress"), "В работе");
  assert.equal(api.statusLabel("In Review"), "На проверке");
  assert.equal(api.statusLabel("Done"), "Выполнено");
  assert.equal(api.statusLabel("Custom customer gate"), "Custom customer gate");
  assert.equal(api.eventText({kind:"status",from:"In Progress",to:"In Review"}), "Передана на проверку · В работе → На проверке");
  assert.equal(api.eventText({kind:"status",from:"Принята",to:"Done"}), "Задача выполнена · Принята → Выполнено");
  assert.equal(api.eventText({kind:"status",from:"Готово",to:"Готово"}), "Статус не изменился: Готово");
  assert.equal(api.eventText({kind:"field",field:"timespent",from:"14400",to:"18000"}), "Учтено 1 ч работы · всего 5 ч");
  assert.equal(api.eventText({kind:"field",field:"timespent",from:"18000",to:"14400"}), "Скорректированы трудозатраты: 5 ч → 4 ч");
  assert.equal(api.eventText({kind:"field",field:"timeestimate",from:"14400",to:"10800"}), "Оставшаяся оценка: 4 ч → 3 ч");
  assert.equal(api.eventText({kind:"field",field:"timeoriginalestimate",from:"0",to:"5400"}), "Исходная оценка: 0 мин → 1 ч 30 мин");
  assert.equal(api.eventText({kind:"field",field:"WorklogId",from:"151371",to:""}), "Обновлена запись трудозатрат");
  assert.equal(api.eventText({kind:"field",field:"resolution",from:"",to:"Done"}), "Установлен результат: Выполнено");
  assert.equal(api.eventText({kind:"field",field:"resolution",from:"Done",to:""}), "Сброшен результат: Выполнено");
  assert.equal(api.eventText({kind:"assignee",from:"Alice",to:""}), "Снято назначение: Alice");
  assert.equal(api.eventText({kind:"created"}), "Создана задача");
  assert.match(api.eventText({kind:"field",field:"customfield_1",from:"a",to:"b"}), /customfield_1.*a → b/);
  assert.doesNotMatch(api.eventText({kind:"field",field:"timespent",from:"",to:"60"}), /Учтено/, "Unknown previous total is not zero");
  assert.equal(api.eventText({kind:"field",field:"timespent",from:"",to:"7200"}), "Указаны трудозатраты: 2 ч");
});

test("duplicate WorklogId bookkeeping is hidden only alongside time changes in the same history", () => {
  const api=activity();
  const jira=issue("P-1","Open",[
    history("h1","2026-09-24T01:00:00Z","editor",[item("timespent","0","1800"),item("WorklogId","42",null)]),
    history("h2","2026-09-24T02:00:00Z","editor",[item("WorklogId","43",null)])
  ]);
  const result=report(api,[row(detail(api,jira))]);
  assert.equal(result.events.length,2);
  assert.deepEqual(Array.from(result.events,event=>event.field),["timespent","WorklogId"]);
});

test("review status is classified as open even when historical category is unavailable", () => {
  const api=activity();
  const jira=issue("P-1","Done",[history("h","2026-09-24T01:00:00Z","editor",[item("status","3","2","In Review","Done")])]);
  const result=report(api,[row(detail(api,jira))]);
  assert.equal(result.coverage.isComplete,true);
  assert.equal(result.metrics.completed,1);
  assert.equal(result.balance.startOpen,1);
});

test("HTML exports readable event descriptions and transition matrices instead of raw Jira fields", () => {
  const api=activity();
  const jira=issue("P-1","Done",[history("h","2026-09-24T01:00:00Z","editor",[
    item("status","1","2","In Review","Done"),item("timeestimate","3600","0"),item("timespent","0","1800"),item("WorklogId","42",null)
  ])]);
  const html=api.exportHtml(report(api,[row(detail(api,jira))]),{filters:{role:["QA","BE"]},sort:{key:"time",descending:true}});
  assert.match(html,/Задача выполнена/);
  assert.match(html,/Учтено 30 мин работы/);
  assert.match(html,/Оставшаяся оценка: 1 ч → 0 мин/);
  assert.doesNotMatch(html,/WorklogId|timeestimate|timespent|In Review|Done/);
  assert.match(html,/<table[^>]*aria-label="Переходы статусов"/);
  assert.match(html,/Из → В/);
});

test("Moscow day is half-open, today uses Moscow, and invalid dates fail", () => {
  const api = activity();
  assert.deepEqual(JSON.parse(JSON.stringify(api.day("2026-09-24"))), {date: "2026-09-24", start: Date.parse("2026-09-23T21:00:00Z"), end: Date.parse("2026-09-24T21:00:00Z")});
  assert.equal(api.today("2026-09-23T22:00:00Z"), "2026-09-24");
  for (const bad of ["2026-02-30", "2026-9-24", "2026-13-01"]) assert.throws(() => api.day(bad));
});

test("null assignee transitions are validated and never replaced by an inferred user", () => {
  const api=activity(), jira=issue("P-1","Open",[
    history("h1","2026-09-24T01:00:00Z","editor",[item("assignee","a","b","Alice","Bob")]),
    history("h2","2026-09-24T02:00:00Z","editor",[item("assignee",null,"c",null,"Carol")])
  ],{fields:{assignee:person("c","Carol")}});
  assert.equal(api.capture(jira).complete,false);
  const result=report(api,[row(detail(api,jira))]);
  assert.deepEqual(Array.from(result.events[1].fromAssignee.identifiers),[]);
  assert.notEqual(result.events[1].fromAssignee.label,"Bob");
  const unassigned=issue("P-2","Open",[history("h3","2026-09-24T01:00:00Z","editor",[item("assignee","a",null,"Alice",null)])]);
  assert.equal(api.capture(unassigned).complete,false,"Last null must match actual current assignee");
  unassigned.fields.assignee=null;
  assert.equal(api.capture(unassigned).complete,true);
});

test("disputed duplicate histories and conflicting shared copies do not create flows", () => {
  const api=activity(), h=history("same","2026-09-24T01:00:00Z","editor",[item("status","1","2","Open","Done")]);
  const jira=issue("P-1","Done",[h,{...h,items:[item("status","3","2","Cancelled","Done")]}]);
  const result=report(api,[row(detail(api,jira))]);
  assert.equal(result.coverage.isComplete,false);
  assert.equal(result.events.length,0);
  assert.equal(result.transitions.length,0);
  const child=detail(api,issue("P-3","Done",[h]));
  const alternative=detail(api,issue("P-3","Done",[{...h,items:[item("status","3","2","Cancelled","Done")]}]));
  const shared=report(api,[row(detail(api,issue("P-10","Open")),[child]),row(detail(api,issue("P-20","Open")),[alternative])]);
  assert.equal(shared.coverage.isComplete,false);
  assert.equal(shared.events.length,0);
});

test("creation already Done and cancellation never masquerade as completion or reopening", () => {
  const api=activity();
  const bornDone=detail(api,issue("P-1","Done",[],{fields:{created:"2026-09-24T01:00:00Z"}}));
  const born=report(api,[row(bornDone)]);
  assert.equal(born.metrics.newRemarks,1);
  assert.equal(born.metrics.completed,0);
  const cancelled=detail(api,issue("P-3","Cancelled",[history("cancel","2026-09-24T02:00:00Z","editor",[item("status","2","3","Done","Cancelled")])],{fields:{status:{id:"3",name:"Cancelled",statusCategory:{key:"done"}}}}));
  const result=report(api,[row(detail(api,issue("P-2","Done")),[cancelled])]);
  assert.equal(result.coverage.isComplete,true);
  assert.equal(result.metrics.reopened,0);
});

test("simultaneous opposite child transitions do not invent transient completion", () => {
  const api=activity();
  const a=detail(api,issue("P-2","Done",[history("a","2026-09-24T02:00:00Z","editor",[item("status","1","2","Open","Done")])]));
  const b=detail(api,issue("P-3","Open",[history("b","2026-09-24T02:00:00Z","editor",[item("status","2","1","Done","Open")])]));
  const result=report(api,[row(detail(api,issue("P-1","Done")),[a,b])]);
  assert.equal(result.coverage.isComplete,true);
  assert.equal(result.metrics.completed,0);
  assert.equal(result.metrics.reopened,0);
});

test("management membership and milestone evidence follow certified group readiness", () => {
  const api=activity();
  const parent=detail(api,issue("P-1","Open",[
    history("a","2026-09-24T01:00:00Z","maker",[item("status","1","2","Open","Done")]),
    history("b","2026-09-24T02:00:00Z","reviewer",[item("status","2","1","Done","Open")])
  ]));
  const result=report(api,[row(parent)]), management=result.groups[0].management;
  assert.equal(management.changed,true);
  assert.equal(management.newRemark,false);
  assert.deepEqual(JSON.parse(JSON.stringify(management.completed.map(x=>[x.at,x.events.map(e=>e.id)]))),[["2026-09-24T01:00:00.000Z",["P-1:a:0"]]]);
  assert.deepEqual(JSON.parse(JSON.stringify(management.reopened.map(x=>[x.at,x.events.map(e=>e.id)]))),[["2026-09-24T02:00:00.000Z",["P-1:b:0"]]]);
  assert.equal(management.tasks[0].status,"Open");
  assert.equal(result.metrics.completed,1);
  assert.equal(result.metrics.reopened,1);
});

test("management task detail separates closure duration, active status time and snapshot work", () => {
  const api=activity();
  const jira=issue("P-1","Done",[
    history("a","2026-09-20T01:00:00Z","worker",[item("status","1","3","Open","In Progress")]),
    history("b","2026-09-20T02:00:00Z","worker",[item("status","3","4","In Progress","In Review")]),
    history("c","2026-09-20T03:00:00Z","reviewer",[item("status","4","2","In Review","Done")])
  ],{fields:{timespent:1800,worklog:{startAt:0,total:2,worklogs:[
    {id:"w1",started:"2026-09-20T01:30:00Z",author:person("worker","Worker"),timeSpentSeconds:1200},
    {id:"w2",started:"2026-09-20T02:30:00Z",author:person("reviewer","Reviewer"),timeSpentSeconds:600}
  ]},comment:{startAt:0,total:1,comments:[{id:"c1",created:"2026-09-24T02:00:00Z",author:person("reviewer","Reviewer"),body:"Looks good"}]}}});
  const result=report(api,[row(detail(api,jira,"QA"))]), task=result.groups[0].management.tasks[0];
  assert.equal(task.completedAt,"2026-09-20T03:00:00.000Z");
  assert.equal(task.completedBy.label,"reviewer");
  assert.equal(task.elapsedSeconds,10800);
  assert.equal(task.inProgressSeconds,7200);
  assert.equal(task.spentSeconds,1800);
  assert.ok(Number.isFinite(Date.parse(task.spentAsOf)));
  assert.equal(task.worklogsComplete,true);
  assert.deepEqual(Array.from(task.worklogs,w=>w.seconds),[1200,600]);
  assert.equal(task.commentsComplete,true);
  assert.equal(task.comments[0].body,"Looks good");
});

test("missing and disputed detail does not manufacture precision or milestones", () => {
  const api=activity(), jira=issue("P-1","Done",[history("a","2026-09-24T01:00:00Z","maker",[item("status","1","2","Open","Done")])],
    {fields:{timespent:NaN,worklog:{startAt:0,total:2,worklogs:[{id:"same",started:"2026-09-24T00:00:00Z",author:person("a","A"),timeSpentSeconds:60},{id:"same",started:"2026-09-24T00:00:00Z",author:person("a","A"),timeSpentSeconds:60}]}}});
  const parent=detail(api,jira); parent.activity.complete=false;
  const result=report(api,[row(parent)]), management=result.groups[0].management, task=management.tasks[0];
  assert.equal(management.completed.length,0);
  assert.equal(management.reopened.length,0);
  assert.equal(task.completedAt,null);
  assert.equal(task.inProgressSeconds,null);
  assert.equal(task.spentSeconds,null);
  assert.equal(task.worklogsComplete,false);
  assert.equal(task.commentsComplete,false);
  assert.equal(task.worklogs.length,1);
  assert.ok(management.notes.length);
  assert.ok(task.notes.length);
});

test("worklog team follows its author and invalid seconds remain unknown", () => {
  const api=activity(), jira=issue("P-1","Open",[],{fields:{timespent:90,worklog:{startAt:0,total:2,worklogs:[
    {id:"ok",started:"2026-09-24T01:00:00Z",author:person("worker","Worker"),timeSpentSeconds:90},
    {id:"bad",started:"2026-09-24T02:00:00Z",author:person("worker","Worker"),timeSpentSeconds:"unknown"}
  ]}}});
  const teamRows=teams.defaults();
  teamRows[0].members=[{id:"worker",label:"Worker",identifiers:["worker"]}];
  teamRows[1].members=[{id:"owner",label:"Owner",identifiers:["owner"]}];
  const task=api.summarize([row(detail(api,jira))],teamRows,{date:"2026-09-24",now:"2026-09-24T12:00:00Z"}).groups[0].management.tasks[0];
  assert.equal(task.worklogsComplete,false);
  assert.equal(task.worklogs[0].team,"BE");
  assert.equal(task.worklogs[0].color,teamRows[0].color);
  assert.equal(task.worklogs[1].seconds,null);
  assert.equal(task.worklogs[1].team,"BE");
});

test("management status and closure stop at the endpoint while snapshot spend keeps its capture time", () => {
  const api=activity(), jira=issue("P-1","Done",[
    history("first","2026-09-24T01:00:00Z","worker",[item("status","1","2","Open","Done")]),
    history("reopen","2026-09-24T08:00:00Z","reviewer",[item("status","2","1","Done","Open")]),
    history("last","2026-09-24T10:00:00Z","worker",[item("status","1","2","Open","Done")])
  ],{fields:{created:"2026-09-24T00:00:00Z",timespent:3600}});
  const parent=detail(api,jira), result=report(api,[row(parent)],{now:"2026-09-24T09:00:00Z"}), task=result.groups[0].management.tasks[0];
  assert.equal(task.status,"Open");
  assert.equal(task.completedAt,null);
  assert.equal(task.elapsedSeconds,null);
  assert.equal(task.dayCompletions.length,1);
  assert.equal(task.dayCompletions[0].at,"2026-09-24T01:00:00.000Z");
  assert.equal(task.dayCompletions[0].author.label,"worker");
  assert.equal(task.spentSeconds,3600);
  assert.equal(task.spentAsOf,parent.activity.capturedAt);
});

test("management assignee reflects the endpoint before a future assignment", () => {
  const api=activity(), jira=issue("P-1","Open",[
    history("future","2026-09-24T18:00:00Z","editor",[item("assignee","old","owner","Old","Owner")])
  ]);
  const result=report(api,[row(detail(api,jira))]);
  const task=result.groups[0].management.tasks[0];
  assert.equal(result.coverage.isComplete,true);
  assert.equal(task.assignee && task.assignee.label,"Old");
  assert.deepEqual(Array.from(task.assignee && task.assignee.identifiers || []),["old"]);
});

test("management assignee stays null for missing and conflicting snapshots", () => {
  const api=activity();
  const missing=report(api,[row({key:"P-1",summary:"Missing",status:"Open",role:""})]);
  assert.equal(missing.groups[0].management.tasks[0].assignee,null);

  const child=detail(api,issue("P-3","Open"));
  const alternative={...child,activity:{...child.activity,currentAssignee:{label:"Other",identifiers:["other"],color:""}}};
  const disputed=report(api,[
    row(detail(api,issue("P-10","Open")),[child]),
    row(detail(api,issue("P-20","Open")),[alternative])
  ]);
  for (const group of disputed.groups) {
    assert.equal(group.management.tasks.find(task=>task.key==="P-3").assignee,null);
  }
});

test("historical task detail hides future comments and labels later edits to visible comments", () => {
  const api=activity(), jira=issue("P-1","Open",[],{fields:{comment:{startAt:0,total:3,comments:[
    {id:"old",created:"2026-09-24T01:00:00Z",updated:"2026-09-24T01:00:00Z",author:person("a","A"),body:"Original"},
    {id:"edited",created:"2026-09-24T02:00:00Z",updated:"2026-09-24T14:00:00Z",author:person("b","B"),body:"Edited text"},
    {id:"future",created:"2026-09-24T13:00:00Z",updated:"2026-09-24T13:00:00Z",author:person("c","C"),body:"After endpoint"}
  ]}}});
  const task=report(api,[row(detail(api,jira))]).groups[0].management.tasks[0];
  assert.deepEqual(Array.from(task.comments,c=>c.id),["old","edited"]);
  assert.equal(task.commentsComplete,true);
  assert.equal(task.comments[1].updatedAt,"2026-09-24T14:00:00.000Z");
  assert.match(task.notes.join(" "),/редактир/);
  assert.doesNotMatch(task.notes.join(" "),/old/);
});

test("current worklogs may start after endpoint but are not presented as period totals", () => {
  const api=activity(), jira=issue("P-1","Open",[],{fields:{timespent:600,worklog:{startAt:0,total:1,worklogs:[
    {id:"future",started:"2026-09-24T14:00:00Z",author:person("a","A"),timeSpentSeconds:600}
  ]}}});
  const parent=detail(api,jira), task=report(api,[row(parent)]).groups[0].management.tasks[0];
  assert.equal(task.worklogs[0].at,"2026-09-24T14:00:00.000Z");
  assert.equal(task.spentAsOf,parent.activity.capturedAt);
  assert.match(task.notes.join(" "),/текущ|снимк/);
});

test("shared issue copies with conflicting management details are not silently selected", () => {
  const api=activity(), child=detail(api,issue("P-3","Open",[],{fields:{timespent:60,comment:{startAt:0,total:0,comments:[]}}}));
  for (const detailChange of [
    {spentSeconds:120},
    {worklogs:{entries:[{id:"w",at:"2026-09-24T01:00:00.000Z",author:{label:"A",identifiers:[],color:""},seconds:60}],complete:true}},
    {comments:{entries:[{id:"x",at:"2026-09-24T01:00:00.000Z",author:{label:"A",identifiers:[],color:""},body:"Different"}],complete:true}}
  ]) {
    const other={...child,activity:{...child.activity,...detailChange}};
    const result=report(api,[row(detail(api,issue("P-1","Open")),[child]),row(detail(api,issue("P-2","Open")),[other])]);
    assert.equal(result.coverage.isComplete,false,JSON.stringify(detailChange));
    const task=result.groups[0].management.tasks.find(t=>t.key==="P-3");
    assert.equal(task.completedAt,null);
    assert.equal(task.spentSeconds,null);
    assert.equal(task.comments.length,0);
    assert.equal(task.worklogs.length,0);
    assert.match(result.coverage.warnings.join(" "),/противоречивые снимки/);
  }
});

test("completion author color uses current team membership", () => {
  const api=activity(), jira=issue("P-1","Done",[history("done","2026-09-24T01:00:00Z","maker",[item("status","1","2","Open","Done")])]);
  const teamRows=teams.defaults();
  teamRows[0].members=[{id:"maker",label:"Maker",identifiers:["maker"]}];
  const task=api.summarize([row(detail(api,jira))],teamRows,{date:"2026-09-24",now:"2026-09-24T12:00:00Z"}).groups[0].management.tasks[0];
  assert.equal(task.completedBy.color,teamRows[0].color);
});

test("latest uncertain entry into Done cannot reuse an older completion", () => {
  const api=activity(), jira=issue("P-1","Done",[
    history("a","2026-09-24T01:00:00Z","A",[item("status","1","2","Open","Done")]),
    history("review","2026-09-24T02:00:00Z","R",[item("status","2","3","Done","Custom Review")]),
    history("b","2026-09-24T03:00:00Z","B",[item("status","3","2","Custom Review","Done")])
  ],{fields:{created:"2026-09-24T00:00:00Z"}});
  const task=report(api,[row(detail(api,jira))]).groups[0].management.tasks[0];
  assert.equal(task.completedAt,null);
  assert.equal(task.completedBy,null);
  assert.equal(task.elapsedSeconds,null);
  assert.match(task.notes.join(" "),/завершен/);
});

test("latest known review to Done attributes completion to the later author", () => {
  const api=activity(), jira=issue("P-1","Done",[
    history("a","2026-09-24T01:00:00Z","A",[item("status","1","2","Open","Done")]),
    history("review","2026-09-24T02:00:00Z","R",[item("status","2","3","Done","In Review")]),
    history("b","2026-09-24T03:00:00Z","B",[item("status","3","2","In Review","Done")])
  ],{fields:{created:"2026-09-24T00:00:00Z"}});
  const task=report(api,[row(detail(api,jira))]).groups[0].management.tasks[0];
  assert.equal(task.completedAt,"2026-09-24T03:00:00.000Z");
  assert.equal(task.completedBy.label,"B");
  assert.equal(task.elapsedSeconds,10800);
});

test("current custom terminal status retains its done category in completion detail", () => {
  const api=activity(), jira=issue("P-1","Verified",[
    history("verified","2026-09-24T01:00:00Z","checker",[item("status","1","5","Open","Verified")])
  ],{fields:{created:"2026-09-24T00:00:00Z",status:{id:"5",name:"Verified",statusCategory:{key:"done"}}}});
  const result=report(api,[row(detail(api,jira))]), task=result.groups[0].management.tasks[0];
  assert.equal(result.metrics.completed,1);
  assert.equal(task.completedAt,"2026-09-24T01:00:00.000Z");
  assert.equal(task.completedBy.label,"checker");
  assert.equal(task.elapsedSeconds,3600);
});

test("unknown open-category custom status leaves active work time unknown", () => {
  const api=activity(), jira=issue("P-1","Developing",[],{fields:{created:"2026-09-24T00:00:00Z",
    status:{id:"7",name:"Developing",statusCategory:{key:"indeterminate"}}}});
  const task=report(api,[row(detail(api,jira))]).groups[0].management.tasks[0];
  assert.equal(task.status,"Developing");
  assert.equal(task.inProgressSeconds,null);
  assert.match(task.notes.join(" "),/Время в работе/);
});
test("a refreshed parent with a changed linked scope cannot claim complete remark totals", () => {
  const api=activity(), parent=detail(api,issue("P-1","Done"));
  parent.activity.linkedKeys=["P-2"];
  const result=report(api,[row(parent)]);
  assert.equal(result.coverage.isComplete,false);
  assert.equal(result.metrics.completed,null);
  assert.match(result.coverage.warnings.join(" "),/Связи/);
});

test("capture requires complete metadata, valid ordered chains, and unique history ids", () => {
  const api = activity();
  const h = history("h1", "2026-09-24T09:00:00+0300", "editor", [item("status", "1", "2", "Open", "Done")]);
  assert.equal(api.capture(issue("P-1", "Done", [h])).complete, true);
  for (const changelog of [
    {histories: [h]}, {total: 1, histories: [h]}, {startAt: 1, total: 1, histories: [h]}, {startAt: 0, total: 2, histories: [h]},
    {startAt: 0, isLast: false, histories: [h]}, complete([h, {...h}]),
    complete([{...h, created: "2026-09-24T09:00:00"}]),
    complete([{...h, created: "2026-02-30T09:00:00Z"}]),
    complete([h, history("h2", "2026-09-24T10:00:00Z", "editor", [item("status", "1", "2", "Open", "Done")])]),
  ]) assert.equal(api.capture(issue("P-1", "Done", [], {changelog})).complete, false);
  assert.equal(api.capture(issue("P-1", "Done", [], {changelog: {startAt: 0, isLast: true, histories: [h]}})).complete, true);
  assert.equal(api.capture(issue("P-1", "Done", [], {changelog: {startAt: 0, total: 2, isLast: true, histories: [h]}})).complete, false);
  assert.equal(api.capture(issue("P-1","Done",[history("missing-from","2026-09-24T09:00:00Z","editor",[item("status",null,"2",null,"Done")])])).complete,false);
});

test("status and assignee reconstruct backwards; author remains the change author", () => {
  const api = activity();
  const jira = issue("P-1", "Done", [
    history("h1", "2026-09-24T01:00:00Z", "editor", [item("status", "1", "2", "Open", "Done"), item("assignee", "old", "owner", "Old", "Owner")]),
  ]);
  const result = report(api, [row(detail(api, jira))]);
  assert.equal(result.coverage.isComplete, true);
  assert.deepEqual(JSON.parse(JSON.stringify(result.metrics)), {changed: 1, newRemarks: 0, completed: 1, reopened: 0, taskReturns:0, events: 2, overdue:0});
  assert.deepEqual(JSON.parse(JSON.stringify(result.balance)), {startOpen: 1, endOpen: 0});
  assert.equal(result.events[0].author.label, "editor");
  assert.equal(result.events[0].assignee.label, "Old");
  assert.equal(result.events[1].fromAssignee.label, "Old");
  assert.equal(result.events[1].toAssignee.label, "Owner");
});

test("partial history retains observed events but leaves unknown totals null", () => {
  const api = activity();
  const h = history("h1", "2026-09-24T01:00:00Z", "editor", [item("status", "1", "2", "Open", "Done")]);
  const jira = issue("P-1", "Done", [], {changelog: {startAt: 0, total: 2, histories: [h]}});
  const result = report(api, [row(detail(api, jira))]);
  assert.equal(result.coverage.isComplete, false);
  assert.ok(result.coverage.warnings.length);
  assert.equal(result.events.length, 1);
  assert.equal(result.metrics.events, 1);
  assert.equal(result.metrics.changed, null);
  assert.equal(result.metrics.completed, null);
  assert.equal(result.balance.startOpen, null);
});

test("parent creation is separate from child creation and linked children gate readiness", () => {
  const api = activity();
  const parent = issue("P-1", "Done", [history("p", "2026-09-24T02:00:00Z", "editor", [item("status", "1", "2", "Open", "Done")])]);
  const child = issue("P-2", "Done", [history("c", "2026-09-24T03:00:00Z", "editor", [item("status", "1", "2", "Open", "Done")])]);
  const result = report(api, [row(detail(api, parent), [detail(api, child, "BE")])]);
  assert.equal(result.metrics.completed, 1);
  assert.equal(result.metrics.newRemarks, 0);
  assert.equal(result.balance.startOpen, 1);
  assert.equal(result.balance.endOpen, 0);
});

test("new remarks count only parent Jira creation", () => {
  const api = activity();
  const parent = issue("P-1","Open",[],{fields:{created:"2026-09-24T01:00:00Z"}});
  const child = issue("P-2","Open",[],{fields:{created:"2026-09-24T02:00:00Z"}});
  const result = report(api,[row(detail(api,parent),[detail(api,child)])]);
  assert.equal(result.metrics.newRemarks,1);
  assert.equal(result.events.filter(e => e.kind === "created").length,2);
  assert.equal(result.balance.startOpen,0);
  assert.equal(result.balance.endOpen,1);
});

test("current-day totals use earliest capture as an explicit cutoff", () => {
  const api = activity();
  const d = detail(api,issue("P-1","Open"));
  d.activity.capturedAt = "2026-09-24T04:00:00Z";
  const result = report(api,[row(d)],{now:"2026-09-24T12:00:00Z"});
  assert.equal(result.coverage.isComplete,true);
  assert.equal(result.asOf,"2026-09-24T04:00:00.000Z");
  assert.equal(result.balance.endOpen,1);
});

test("overnight stale capture gives no selected-day cutoff or fabricated zero", () => {
  const api = activity();
  const d = detail(api,issue("P-1","Open")); d.activity.capturedAt = "2026-09-23T20:00:00Z";
  const result = report(api,[row(d)]);
  assert.equal(result.asOf,null);
  assert.equal(result.coverage.complete,0);
  assert.equal(result.coverage.incomplete,1);
  assert.equal(result.metrics.changed,null);
  assert.equal(result.balance.endOpen,null);
  assert.match(result.coverage.warnings.join(" "),/дня|срез/i);
});

test("common testing and waiting statuses stay open without guessing unknown names", () => {
  const api = activity();
  for (const name of ["Testing","Тестирование","Выдано","К выполнению"]) {
    const jira = issue("P-1",name,[],{fields:{status:{id:"4",name}}});
    const result = report(api,[row(detail(api,jira))]);
    assert.equal(result.coverage.isComplete,true,name);
    assert.equal(result.balance.endOpen,1,name);
  }
});

test("current status category follows its stable ID through earlier transitions", () => {
  const api = activity();
  const jira = issue("P-1","Verified",[
    history("a","2026-09-24T02:00:00Z","editor",[item("status","2","1","Verified","Open")]),
    history("b","2026-09-24T03:00:00Z","editor",[item("status","1","2","Open","Verified")]),
  ],{fields:{status:{id:"2",name:"Verified",statusCategory:{key:"done"}}}});
  const result = report(api,[row(detail(api,jira))]);
  assert.equal(result.metrics.reopened,1);
  assert.equal(result.metrics.completed,1);
  assert.equal(result.balance.startOpen,0);
});

test("unknown intermediate status makes otherwise open endpoints uncertifiable", () => {
  const api = activity();
  const jira = issue("P-1","Open",[
    history("a","2026-09-24T01:00:00Z","editor",[item("status","1","2","Open","Done")]),
    history("b","2026-09-24T02:00:00Z","editor",[item("status","2","1","Done","Open")]),
    history("c","2026-09-24T03:00:00Z","editor",[item("status","1","9","Open","Custom Gate")]),
    history("d","2026-09-24T04:00:00Z","editor",[item("status","9","1","Custom Gate","Open")])
  ]);
  const result = report(api,[row(detail(api,jira))]);
  assert.equal(result.coverage.isComplete,false);
  assert.equal(result.metrics.completed,null);
  assert.equal(result.metrics.reopened,null);
  assert.equal(result.balance.endOpen,null);
  assert.equal(result.groups[0].dayComplete,false);
  assert.equal(result.groups[0].management.completed.length,0);
  assert.equal(result.groups[0].management.reopened.length,0);
});

test("highlights use current done category on both sides of a transition", () => {
  const api = activity();
  const jira = issue("P-1","Verified",[
    history("a","2026-09-24T01:00:00Z","editor",[item("status","5","1","Verified","Open")]),
    history("b","2026-09-24T02:00:00Z","editor",[item("status","1","5","Open","Verified")])
  ],{fields:{status:{id:"5",name:"Verified",statusCategory:{key:"done"}}}});
  const result = report(api,[row(detail(api,jira))]);
  assert.equal(result.metrics.reopened,1);
  assert.equal(result.groups[0].dayHighlights.reopened,1);
  assert.equal(result.groups[0].dayHighlights.completed,1);
});

test("indeterminate current category prevents a name-only completion highlight", () => {
  const api = activity();
  const jira = issue("P-1","Принято",[
    history("a","2026-09-24T01:00:00Z","editor",[item("status","5","1","Принято","В работе")]),
    history("b","2026-09-24T02:00:00Z","editor",[item("status","1","5","В работе","Принято")])
  ],{fields:{status:{id:"5",name:"Принято",statusCategory:{key:"indeterminate"}}}});
  const result = report(api,[row(detail(api,jira))]);
  assert.equal(result.metrics.reopened,0);
  assert.equal(result.groups[0].dayHighlights.reopened,0);
  assert.equal(result.groups[0].dayHighlights.completed,0);
});

test("supported terminal aliases count completion while cancellation still does not", () => {
  const api = activity();
  for (const terminal of ["accepted","выполнен","принят","закрыт"]) {
    const jira = issue("P-1",terminal,[history("a","2026-09-24T01:00:00Z","editor",[item("status","1","2","Open",terminal)])],
      {fields:{status:{id:"2",name:terminal}}});
    const result = report(api,[row(detail(api,jira))]);
    assert.equal(result.coverage.isComplete,true,terminal);
    assert.equal(result.metrics.completed,1,terminal);
    assert.equal(result.groups[0].dayHighlights.completed,1,terminal);
  }
  const cancelled = issue("P-1","Cancelled",[history("a","2026-09-24T01:00:00Z","editor",[item("status","1","3","Open","Cancelled")])],
    {fields:{status:{id:"3",name:"Cancelled",statusCategory:{key:"done"}}}});
  assert.equal(report(api,[row(detail(api,cancelled))]).metrics.completed,0);
});

test("accepted between open states yields supported completion and reopening", () => {
  const api = activity();
  const jira = issue("P-1","Open",[
    history("a","2026-09-24T01:00:00Z","editor",[item("status","1","2","Open","Accepted")]),
    history("b","2026-09-24T02:00:00Z","editor",[item("status","2","1","Accepted","Open")])
  ]);
  const result = report(api,[row(detail(api,jira))]);
  assert.equal(result.coverage.isComplete,true);
  assert.equal(result.metrics.completed,1);
  assert.equal(result.metrics.reopened,1);
});

test("review and testing returns describe the actual source status", () => {
  const api = activity();
  assert.equal(api.eventText({kind:"status",from:"In Review",to:"In Progress"}),"Возвращена с проверки · На проверке → В работе");
  assert.equal(api.eventText({kind:"status",from:"На тестировании",to:"Выдано"}),"Возвращена с тестирования · На тестировании → Выдано");
  assert.equal(api.eventText({kind:"status",from:"Done",to:"In Progress"}),"Переоткрыта после завершения · Выполнено → В работе");
});

test("issuance from a new status does not claim work started", () => {
  const api = activity();
  assert.equal(api.eventText({kind:"status",from:"New",to:"Issued"}),"Изменён статус · Новое → Issued");
  assert.equal(api.eventText({kind:"status",from:"New",to:"Выдано"}),"Изменён статус · Новое → Выдано");
});

test("journal remark ID prefers mapped source number over local row ID", () => {
  const api = activity();
  const r = row(detail(api,issue("P-1","Open")));
  r.id = "Sheet:4"; r.sourceColumns = {"№":"42"};
  assert.equal(report(api,[r]).groups[0].remarkId,"42");
});

test("Jira-only remark ID uses numeric summary prefix or Jira key", () => {
  const api = activity();
  const prefixed = row(detail(api,issue("P-1","Open"))); prefixed.id = "internal:1"; prefixed.storyDetails.summary = "№42. Problem";
  const plain = row(detail(api,issue("P-2","Open"))); plain.id = "internal:2";
  const result = report(api,[prefixed,plain]);
  assert.equal(result.groups[0].remarkId,"42");
  assert.equal(result.groups[1].remarkId,"P-2");
});

test("Jira-only activity and registry reject dates and use the same Story prefix", () => {
  const api = activity();
  for (const [summary, expected] of [["2026.09.26 release","P-1"],["12.5 volts","P-1"],["2795.Линия","2795"]]) {
    const r = row(detail(api,issue("P-1","Open")));
    r.storyDetails.summary=summary;
    assert.equal(report(api,[r]).groups[0].remarkId,expected,summary);
  }
});

test("creation uses birth status and assignee before later changes", () => {
  const api = activity();
  const jira = issue("P-1","Done",[
    history("a","2026-09-24T03:00:00Z","editor",[item("assignee","old","owner","Old","Owner")]),
    history("b","2026-09-24T04:00:00Z","editor",[item("status","1","2","Open","Done")]),
  ],{fields:{created:"2026-09-24T01:00:00Z"}});
  const result = report(api,[row(detail(api,jira))]);
  assert.equal(result.events.find(e => e.kind === "created").assignee.label,"Old");
  assert.equal(result.metrics.completed,1);
  assert.equal(result.balance.startOpen,0);
  assert.equal(result.balance.endOpen,0);
});

test("uncreated and partial rows do not hide valid work or claim readiness", () => {
  const api = activity();
  const valid = row(detail(api,issue("P-1","Open")));
  const partial = row(detail(api,issue("P-2","Done"))); partial.status = "partial";
  const result = report(api,[{id:"sheet:1",summary:"Not created"},valid,partial]);
  assert.equal(result.coverage.uncreated,1);
  assert.equal(result.coverage.isComplete,false);
  assert.equal(result.metrics.completed,null);
  assert.equal(result.balance.endOpen,null);
});

test("partial coverage exposes evidenced changed and new lower bounds", () => {
  const api = activity();
  const jira = issue("P-1","Open",[history("h","2026-09-24T02:00:00Z","editor",[item("summary","old","new")])],{fields:{created:"2026-09-24T01:00:00Z"}});
  const r = row(detail(api,jira)); r.status = "partial";
  const result = report(api,[r]);
  assert.equal(result.metrics.changed,null);
  assert.equal(result.metrics.newRemarks,null);
  assert.deepEqual(JSON.parse(JSON.stringify(result.observed)),{changed:1,newRemarks:1,taskReturns:0,overdue:0});
});

test("uncreated source rows do not make observed Jira totals incomplete", () => {
  const api = activity();
  const result = report(api,[{id:"sheet:1",summary:"No Jira"},row(detail(api,issue("P-1","Open")))]);
  assert.equal(result.coverage.uncreated,1);
  assert.equal(result.coverage.isComplete,true);
  assert.equal(result.balance.endOpen,1);
});

test("duplicate history IDs retain one observed event", () => {
  const api = activity();
  const h = history("dup","2026-09-24T02:00:00Z","editor",[item("status","1","2","Open","Done")]);
  const jira = issue("P-1","Done",[h,{...h}]);
  const result = report(api,[row(detail(api,jira))]);
  assert.equal(result.coverage.isComplete,false);
  assert.equal(result.events.filter(e => e.kind === "status").length,1);
});

test("a shared child has one global event but appears under both parent groups", () => {
  const api = activity();
  const shared = detail(api, issue("P-9", "Done", [history("s", "2026-09-24T03:00:00Z", "editor", [item("status", "1", "2", "Open", "Done")])]));
  const a = detail(api, issue("P-1", "Open"));
  const b = detail(api, issue("P-2", "Open"));
  const result = report(api, [row(a,[shared]), row(b,[shared])]);
  assert.equal(result.events.filter(e => e.issueKey === "P-9").length, 1);
  assert.equal(result.groups.length, 2);
  assert.equal(result.groups[0].events.length, 1);
  assert.equal(result.groups[1].events.length, 1);
  assert.equal(result.metrics.changed, 2);
});

test("conflicting copies of one Jira issue lower coverage for both parents", () => {
  const api = activity();
  const shared = detail(api,issue("P-9","Done"));
  const altered = {...shared,activity:{...shared.activity,currentStatus:{id:"1",name:"Open",category:"new"}}};
  const result = report(api,[row(detail(api,issue("P-1","Open")),[shared]),row(detail(api,issue("P-2","Open")),[altered])]);
  assert.equal(result.coverage.isComplete,false);
  assert.equal(result.balance.endOpen,null);
  assert.match(result.coverage.warnings.join(" "),/P-9/);
});

test("created event credits Jira creator rather than current assignee", () => {
  const api = activity();
  const jira = issue("P-1","Open",[],{fields:{created:"2026-09-24T01:00:00Z",creator:person("maker","Maker")}});
  const event = report(api,[row(detail(api,jira))]).events.find(e => e.kind === "created");
  assert.equal(event.author.label,"Maker");
  assert.equal(event.assignee.label,"Owner");
});

test("team transfers resolve stable IDs and report unknown and ambiguous mapping", () => {
  const api = activity();
  const jira = issue("P-1", "Open", [history("move", "2026-09-24T03:00:00Z", "editor", [item("assignee", "old", "owner", "Same Name", "Same Name")])]);
  const list = teams.defaults();
  list[0].members = [{id:"old",label:"Same Name",identifiers:["old"]}];
  list[3].members = [{id:"owner",label:"Same Name",identifiers:["owner"]}];
  const result = api.summarize([row(detail(api,jira))],list,{date:"2026-09-24",now:"2026-09-24T12:00:00Z"});
  assert.equal(result.transfers.length, 1);
  assert.equal(result.transfers[0].from, "BE");
  assert.equal(result.transfers[0].to, "QA");
  assert.equal(result.events[0].fromAssignee.color,list[0].color);
  assert.equal(result.events[0].toAssignee.color,list[3].color);
  const unknown = report(api,[row(detail(api,jira))]);
  assert.equal(unknown.events[0].fromTeam, "Команда неизвестна");
  list[1].members = [{id:"owner",label:"Same Name",identifiers:["owner"]}];
  const ambiguous = api.summarize([row(detail(api,jira))],list,{date:"2026-09-24",now:"2026-09-24T12:00:00Z"});
  assert.equal(ambiguous.events[0].toTeam,"Неоднозначная команда");
});

test("endpoint balances rewind changes after now and ignore intermediate counts", () => {
  const api = activity();
  const jira = issue("P-1","Open",[
    history("a","2026-09-24T01:00:00Z","editor",[item("status","1","2","Open","Done")]),
    history("b","2026-09-24T18:00:00Z","editor",[item("status","2","1","Done","Open")]),
  ]);
  const result = report(api,[row(detail(api,jira))]);
  assert.equal(result.metrics.completed,1);
  assert.equal(result.metrics.reopened,0);
  assert.equal(result.balance.endOpen,0);
  assert.equal(result.events.filter(e => e.kind === "status").length,1);
});

test("unclassified status makes totals unknown without inventing done", () => {
  const api = activity();
  const jira = issue("P-1","Awaiting architecture review",[],{fields:{status:{id:"4",name:"Awaiting architecture review"}}});
  const result = report(api,[row(detail(api,jira))]);
  assert.equal(result.coverage.isComplete,false);
  assert.equal(result.metrics.completed,null);
  assert.equal(result.balance.endOpen,null);
});

test("future days do not invent results and stale captures report unknown totals", () => {
  const api = activity();
  const d = detail(api, issue("P-1", "Open"));
  d.activity.capturedAt = "2026-09-24T20:30:00Z";
  const future = api.summarize([row(d)],teams.defaults(),{date:"2026-09-25",now:"2026-09-24T12:00:00Z"});
  assert.equal(future.metrics.changed,null);
  assert.equal(future.events.length,0);
  const stale = report(api,[row(d)],{now:"2026-09-25T00:00:00Z"});
  assert.equal(stale.coverage.isComplete,false);
  assert.equal(stale.coverage.complete,0);
  assert.equal(stale.coverage.incomplete,1);
  assert.equal(stale.balance.endOpen,null);
});

test("same-day completion and reopening count both while balances use endpoints", () => {
  const api = activity();
  const jira = issue("P-1","Open",[
    history("a","2026-09-24T01:00:00Z","editor",[item("status","1","2","Open","Done")]),
    history("b","2026-09-24T02:00:00Z","editor",[item("status","2","1","Done","Open")]),
  ]);
  const result = report(api,[row(detail(api,jira))]);
  assert.equal(result.metrics.completed,1);
  assert.equal(result.metrics.reopened,1);
  assert.equal(result.balance.startOpen,1);
  assert.equal(result.balance.endOpen,1);
});

test("cancelled tasks never prove all-task completion", () => {
  const api = activity();
  const parent = detail(api,issue("P-1","Done",[history("p","2026-09-24T02:00:00Z","editor",[item("status","1","2","Open","Done")])]));
  const cancelled = issue("P-2","Cancelled",[],{fields:{status:{id:"3",name:"Cancelled",statusCategory:{key:"done"}}}});
  const result = report(api,[row(parent,[detail(api,cancelled)])]);
  assert.equal(result.metrics.completed,0);
  assert.equal(result.balance.endOpen,0);
});

test("HTML snapshot escapes Jira text and includes scope, coverage and team mapping", () => {
  const api = activity();
  const jira = issue("P-1", "Open", [], {fields:{summary:"<script>alert(1)</script>"}});
  const input = row(detail(api,jira)); input.summary = "<script>alert(1)</script>";
  const output = api.exportHtml(report(api,[input]),{projectKey:"<img src=x>",epicKey:"E-1",filters:{search:"<unsafe>"},sort:{column:"time",direction:"desc"}});
  assert.match(output,/&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(output,/&lt;img src=x&gt;/);
  assert.match(output,/Покрытие/);
  assert.match(output,/Команды на момент снимка/);
  assert.match(output,/Баланс/);
  assert.match(output,/Срез на/);
  assert.match(output,/&lt;unsafe&gt;/);
  assert.match(output,/&quot;direction&quot;:&quot;desc&quot;/);
  assert.match(output,/Текущие связи/);
  assert.doesNotMatch(output,/<script\b|<img\b/i);
});

test("link events describe additions and removals without Jira boilerplate", () => {
  const api = activity();
  assert.equal(api.eventText({field:"Link",to:"This issue is child of EVOSCADA-21507"}),"Добавлена связь: дочерняя задача для EVOSCADA-21507");
  assert.equal(api.eventText({field:"Link",from:"This issue clones EVOSCADA-21734"}),"Удалена связь: копия задачи EVOSCADA-21734");
  assert.equal(api.eventText({field:"Link",to:"This issue is cloned by EVOSCADA-21751"}),"Добавлена связь: скопирована в EVOSCADA-21751");
  assert.equal(api.eventText({field:"Link",to:"This issue is parent of EVOSCADA-21734"}),"Добавлена связь: родительская задача для EVOSCADA-21734");
  assert.equal(api.eventText({field:"Link",to:"This issue Порождает EVOSCADA-21732"}),"Добавлена связь: Порождает EVOSCADA-21732");
  assert.equal(api.eventText({field:"Link",from:"Custom relation P-1",to:"Custom relation P-2"}),"Изменена связь: Custom relation P-1 → Custom relation P-2");
});

test("HTML journal uses MSK time and shows author, assignees and teams", () => {
  const api = activity();
  const jira = issue("P-1","Open",[history("move","2026-09-24T01:00:00Z","Editor",[item("assignee","old","owner","Old","Owner")])]);
  const list = teams.defaults(); list[0].members=[{id:"old",label:"Old",identifiers:["old"]}]; list[3].members=[{id:"owner",label:"Owner",identifiers:["owner"]}];
  const result = api.summarize([row(detail(api,jira))],list,{date:"2026-09-24",now:"2026-09-24T12:00:00Z"});
  const html = api.exportHtml(result,{projectKey:"P"});
  assert.match(html,/24\.09\.2026 04:00 МСК/);
  assert.match(html,/Editor/);
  assert.match(html,/Old/);
  assert.match(html,/Owner/);
  assert.match(html,/BE/);
  assert.match(html,/QA/);
  assert.match(html,/P-1 summary/);
});
