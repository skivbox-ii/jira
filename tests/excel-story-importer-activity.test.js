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
