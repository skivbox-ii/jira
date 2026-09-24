const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const load = require("./helpers/load-amd-module");
const dir = path.join(__dirname, "../ujg-excel-story-importer-modules");
const teams = load(path.join(dir, "teams.js"), {});
const remarkId = load(path.join(dir,"remark-id.js"),{});
const activity = () => load(path.join(dir, "activity.js"), {_ujgESI_teams: teams,_ujgESI_remarkId:remarkId});
const complete = histories => ({startAt: 0, total: histories.length, histories});
const person = (key, label) => ({key, displayName: label});
const item = (field, from, to, fromString = from, toString = to) => ({field, from, to, fromString, toString});
const history = (id, created, author, items) => ({id, created, author: person(author, author), items});
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
  assert.equal(api.capture(jira).complete, true);
  jira.fields.updated = "2026-09-24T08:59:59.000Z";
  assert.equal(api.capture(jira).complete, false, "A later second remains contradictory");
  jira.fields.updated = "2026-09-24T09:00:00.100Z";
  assert.equal(api.capture(jira).complete, false, "Nonzero milliseconds are authoritative");
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
  assert.equal(task.spentSeconds,3600);
  assert.equal(task.spentAsOf,parent.activity.capturedAt);
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
  assert.deepEqual(JSON.parse(JSON.stringify(result.metrics)), {changed: 1, newRemarks: 0, completed: 1, reopened: 0, events: 2});
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
  assert.deepEqual(JSON.parse(JSON.stringify(result.observed)),{changed:1,newRemarks:1});
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
