const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {JSDOM} = require("jsdom");
const jquery = require("jquery");
const load = require("../helpers/load-amd-module");
const moduleDir=path.join(__dirname,"../../ujg-excel-story-importer-modules");
const config=load(path.join(moduleDir,"config.js"),{});
const realActivity=load(path.join(moduleDir,"activity.js"),{
  _ujgESI_teams:load(path.join(moduleDir,"teams.js"),{}),
  _ujgESI_remarkId:load(path.join(moduleDir,"remark-id.js"),{}),
  _ujgESI_deadlines:load(path.join(moduleDir,"deadlines.js"),{_ujgESI_config:config})
});

function setup() {
  const dom = new JSDOM("<div id='root'></div>", {runScripts:"outside-only", url:"http://localhost"});
  const $ = jquery(dom.window);
  const modules = {jquery:$, _ujgESI_activity:realActivity, _ujgESI_icons:() => dom.window.document.createElement("svg")};
  dom.window.define = (name,deps,factory) => modules[name] = factory(...deps.map(dep => modules[dep]));
  dom.window.eval(fs.readFileSync(path.join(__dirname,"../../ujg-excel-story-importer-modules/activity-management-ui.js"),"utf8"));
  const services = {onOpen(){}, onClose(){}, renderDescription(body){ return $("<p/>").text("Отрисовано: " + body); }};
  const state = {baseUrl:"https://jira.example.test/base"};
  const report = {date:"2026-09-24",coverage:{isComplete:false},metrics:{changed:1,newRemarks:1,completed:null,reopened:null,events:2},events:[
    {id:"e2",at:"2026-09-24T11:00:00Z",kind:"status",issueKey:"P-2",summary:"QA: check",role:"QA",from:"Open",to:"Done",author:{label:"Ира"}},
    {id:"e1",at:"2026-09-24T08:00:00Z",kind:"status",issueKey:"P-3",summary:"BE: fix",role:"BE",from:"Open",to:"Done",author:{label:"Олег"}}
  ],groups:[
    {id:"g1",key:"P-1",remarkId:"11",summary:"Remark one",events:[{id:"e2"}],management:{changed:true,newRemark:true,completed:[{at:"2026-09-24T11:00:00Z",events:[{id:"e2",issueKey:"P-2",role:"QA",author:{label:"Ира"}}]}],reopened:[],tasks:[{key:"P-2",summary:"QA: check",role:"QA",created:"2026-09-23T08:00:00Z",status:"Done",completedAt:"2026-09-24T11:00:00Z",completedBy:{label:"Ира"},elapsedSeconds:97200,inProgressSeconds:7200,spentSeconds:3600,spentAsOf:"2026-09-24T12:00:00Z",worklogs:[{id:"w1",at:"2026-09-24T07:00:00Z",author:{label:"Борис"},seconds:3600,team:"BE",color:"#224466"}],worklogsComplete:false,comments:[{id:"c1",at:"2026-09-24T10:00:00Z",author:{label:"Анна"},body:"<script>reason</script>"}],commentsComplete:true,notes:[]}],notes:[]}},
    {id:"g2",key:"P-4",remarkId:"22",summary:"Remark two",events:[{id:"e1"}],management:{changed:false,newRemark:false,completed:[],reopened:[{at:"2026-09-24T08:00:00Z",events:[{id:"e1",issueKey:"P-3",role:"BE",author:{label:"Олег"}}]}],tasks:[],notes:[]}}
  ]};
  return {dom,$,ui:modules._ujgESI_activityManagementUi,report,state,services};
}

test("metric lists use management flags and certified transitions", t => {
  const x=setup(); t.after(()=>x.dom.window.close());
  for (const [metric,expected] of [["changed","P-1"],["newRemarks","P-1"],["completed","P-1"],["reopened","P-4"]]) {
    const panel=x.ui.render(x.report,metric,x.state,x.services);
    assert.equal(panel.find(".ujg-esi-management-remark").length,1);
    assert.match(panel.find(".ujg-esi-management-remark").text(),new RegExp(expected));
  }
  const preview=x.ui.preview(x.report,"completed",x.state,x.services);
  assert.match(preview.text(),/История неполна/);
  assert.equal(preview.find(".ujg-esi-management-preview-open").length,1);
});
test("task return preview and full report show only returned tasks with author time and reason", t => {
  const x=setup(); t.after(()=>x.dom.window.close());
  const event={id:"return",kind:"status",at:"2026-09-24T05:23:00Z",issueKey:"P-3",role:"BE",from:"In Review",to:"In Progress",returnKind:"review",author:{label:"Роман"}};
  x.report.groups[0].taskReturns=[event];
  x.report.groups[0].events.push(event); x.report.events.push(event);
  for (const panel of [x.ui.preview(x.report,"taskReturns",x.state,x.services),x.ui.render(x.report,"taskReturns",x.state,x.services)]) {
    assert.equal(panel.find(".ujg-esi-management-return-events .ujg-esi-management-event").length,1);
    assert.match(panel.find(".ujg-esi-management-return-events").text(),/08:23.*P-3.*BE.*Возвращена с проверки.*Роман/s);
    assert.equal(panel.find(".ujg-esi-management-return-events a[href='https://jira.example.test/base/browse/P-3']").length,1);
    assert.doesNotMatch(panel.text(),/Полная готовность достигнута/);
  }
});
test("overdue preview and full report include quiet remarks ordered by overdue days", t => {
  const x=setup(); t.after(()=>x.dom.window.close());
  x.report.groups[0].deadline={date:"2026-09-22",state:"overdue",daysOverdue:2,owner:{label:"Мария"},pendingTasks:[{key:"P-2",role:"QA",summary:"Check",status:"Open",assignee:{label:"Света"},team:"QA"}]};
  x.report.groups[1].deadline={date:"2026-09-20",state:"overdue",daysOverdue:4,owner:{label:"Иван"},pendingTasks:[{key:"P-3",role:"BE",summary:"Fix",status:"Open",assignee:{label:"Олег"},team:"BE"}]};
  x.report.groups[1].events=[];
  const preview=x.ui.preview(x.report,"overdue",x.state,x.services);
  assert.equal(preview.find(".ujg-esi-management-preview-item").length,2);
  assert.match(preview.find(".ujg-esi-management-preview-item").first().text(),/P-4.*20\.09\.2026.*4 календарных дня.*Иван/s);
  assert.match(preview.text(),/P-3.*BE.*Олег.*P-2.*QA.*Света/s);
  const panel=x.ui.render(x.report,"overdue",x.state,x.services);
  assert.equal(panel.find(".ujg-esi-management-remark").length,2);
  assert.match(panel.find(".ujg-esi-management-remark").first().text(),/P-4/);
  assert.match(panel.find(".ujg-esi-management-detail").text(),/20\.09\.2026.*4 д.*Иван.*P-3.*BE.*Олег/s);
  assert.ok(panel.find("a[href='https://jira.example.test/base/browse/P-3']").length >= 1);
});
test("overdue hover leads with deadline facts and shows only pending children", t => {
  const x=setup(); t.after(()=>x.dom.window.close());
  x.report.groups[0].deadline={date:"2026-09-22",state:"overdue",daysOverdue:2,owner:{label:"Мария"},source:"jira-description",pendingTasks:[
    {key:"P-5",role:"QA",summary:"Check again",status:"Open",assignee:{label:"Света"},team:"QA"},
    {key:"P-6",role:"QA",summary:"Verify",status:"Testing",assignee:{label:"Ира"},team:"QA"}
  ]};
  const preview=x.ui.preview(x.report,"overdue",x.state,x.services);
  const row=preview.find(".ujg-esi-management-preview-item").first();
  assert.match(row.find(".ujg-esi-management-group-label").text(),/P-1.*11.*Remark one/s);
  assert.match(row.find(".ujg-esi-management-overdue-facts").text(),/Срок исполнения.*22\.09\.2026.*Просрочено.*2 календарных дня.*Мария.*сохранённое описание Jira/s);
  assert.match(row.find(".ujg-esi-management-pending-tasks").text(),/QA.*2.*P-5.*Света.*QA.*P-6.*Ира.*QA/s);
  assert.equal(row.find(".ujg-esi-management-pending-task").length,2);
  assert.equal(row.find("a[href='https://jira.example.test/base/browse/P-5']").length,1);
  assert.equal(row.find("a[href='https://jira.example.test/base/browse/P-6']").length,1);
  assert.doesNotMatch(row.text(),/P-2|С момента создания|Учтено на момент снимков|Работали по замечанию|Завершил/);
  assert.equal(row.find(".ujg-esi-management-preview-roles,.ujg-esi-management-preview-chronology").length,0);
  assert.match(x.ui.render(x.report,"overdue",x.state,x.services).find(".ujg-esi-management-detail").text(),/P-2/);
});
test("overdue hover uses the correct calendar-day label for one and five days", t => {
  const x=setup(); t.after(()=>x.dom.window.close());
  const group=x.report.groups[0];
  group.deadline={date:"2026-09-23",state:"overdue",daysOverdue:1,pendingTasks:[]};
  assert.match(x.ui.preview(x.report,"overdue",x.state,x.services).find(".ujg-esi-management-overdue-facts").text(),/1 календарный день/);
  group.deadline.daysOverdue=5;
  assert.match(x.ui.preview(x.report,"overdue",x.state,x.services).find(".ujg-esi-management-overdue-facts").text(),/5 календарных дней/);
});
test("overdue views show coverage and date basis for a confirmed lower bound", t => {
  const x=setup(); t.after(()=>x.dom.window.close());
  x.report.deadlineReferenceDate="2026-09-25";
  x.report.metrics.overdue=null; x.report.observed={overdue:1};
  x.report.deadlineCoverage={known:2,missing:1,invalid:1,conflict:1,unknownState:1,total:5};
  x.report.coverage.isComplete=true;
  x.report.groups[0].deadline={date:"2026-09-23",state:"overdue",daysOverdue:1,pendingTasks:[]};
  for (const view of [x.ui.preview(x.report,"overdue",x.state,x.services),x.ui.render(x.report,"overdue",x.state,x.services)]) {
    const note=view.find(".ujg-esi-management-deadline-coverage").text();
    assert.match(note,/Подтверждено.*1.*итог может быть больше/i);
    assert.match(note,/известны 2.*без срока 1.*ошибки 1.*конфликты 1.*состояние не подтверждено 1.*из 5/s);
    assert.match(note,/срок.*текущ.*журнал.*сохранённ.*описан.*история переносов.*не.*известна/is);
    assert.match(note,/На сегодня, 25\.09\.2026 МСК/i);
    assert.doesNotMatch(note,/выбранную дату|24\.09\.2026/i);
  }
  const overdue=x.ui.render(x.report,"overdue",x.state,x.services);
  assert.match(overdue.find(".ujg-esi-management-date").text(),/На сегодня, 25\.09\.2026 МСК/);
  assert.match(x.ui.render(x.report,"completed",x.state,x.services).find(".ujg-esi-management-date").text(),/24\.09\.2026.*МСК/);
});
test("overdue views use deadline coverage without a generic history warning", t => {
  const x=setup(); t.after(()=>x.dom.window.close());
  x.report.coverage.isComplete=false;
  x.report.metrics.overdue=1;
  x.report.deadlineReferenceDate="2026-09-25";
  x.report.deadlineCoverage={known:1,missing:1,invalid:0,conflict:0,unknownState:0,total:2};
  x.report.groups[0].deadline={date:"2026-09-23",state:"overdue",daysOverdue:2,pendingTasks:[]};
  for (const view of [x.ui.preview(x.report,"overdue",x.state,x.services),x.ui.render(x.report,"overdue",x.state,x.services)]) {
    assert.equal(view.find(".ujg-esi-management-warning").length,0);
    assert.match(view.find(".ujg-esi-management-deadline-coverage").text(),/Просроченных 1.*без срока 1/);
  }
  assert.equal(x.ui.preview(x.report,"completed",x.state,x.services).find(".ujg-esi-management-warning").length,1);
});
test("overdue full detail labels historical evidence after current work", t => {
  const x=setup(); t.after(()=>x.dom.window.close());
  x.report.deadlineReferenceDate="2026-09-25";
  x.report.groups[0].currentStatus="Open";
  x.report.groups[0].deadline={date:"2026-09-23",state:"overdue",daysOverdue:2,pendingTasks:[{key:"P-5",role:"QA",status:"Open",assignee:{label:"Света"},team:"QA"}]};
  const detail=x.ui.render(x.report,"overdue",x.state,x.services).find(".ujg-esi-management-detail");
  const history=detail.find(".ujg-esi-management-history-heading");
  assert.match(history.text(),/История за 24\.09\.2026 МСК/);
  assert.ok(detail.find(".ujg-esi-management-pending-tasks").index() < history.index());
  assert.ok(detail.children(".ujg-esi-management-muted").first().index() < history.index());
  assert.ok(history.index() < detail.find(".ujg-esi-management-chronology").index());
  assert.ok(history.index() < detail.find(".ujg-esi-management-task-table").parent().index());
  assert.match(detail.find(".ujg-esi-management-task-table").text(),/P-2/);
  assert.equal(x.ui.render(x.report,"completed",x.state,x.services).find(".ujg-esi-management-history-heading").length,0);
});
test("overdue empty states distinguish unknown totals, known zero, and missing deadlines", t => {
  const x=setup(); t.after(()=>x.dom.window.close());
  x.report.coverage.isComplete=true;
  x.report.groups.forEach(group => { group.deadline={date:null,state:"invalid"}; });
  for (const [coverage,metric,expected] of [
    [{known:0,missing:0,invalid:1,conflict:1,unknownState:0,total:2},null,/итог не определён/i],
    [{known:1,missing:1,invalid:0,conflict:0,unknownState:0,total:2},0,/Среди замечаний с известным сроком просроченных нет/i],
    [{known:0,missing:2,invalid:0,conflict:0,unknownState:0,total:2},0,/Среди замечаний с известным сроком просроченных нет/i]
  ]) {
    x.report.deadlineCoverage=coverage; x.report.metrics.overdue=metric; x.report.observed={overdue:0};
    for (const view of [x.ui.preview(x.report,"overdue",x.state,x.services),x.ui.render(x.report,"overdue",x.state,x.services)]) {
      assert.match(view.find(".ujg-esi-management-deadline-coverage").text(),/без срока|ошибки/);
      assert.match(view.find(".ujg-esi-management-empty").text(),expected);
      assert.doesNotMatch(view.find(".ujg-esi-management-empty").text(),/За выбранный день таких замечаний нет/);
    }
  }
});

test("reopened preview and report define strict full-readiness reopening even at zero", t => {
  const x=setup(); t.after(()=>x.dom.window.close());
  x.report.groups[1].management.reopened=[];
  const definition=/Повторное открытие после полной готовности исходной истории и всех связанных задач\./;
  assert.match(x.ui.preview(x.report,"reopened",x.state,x.services).text(),definition);
  assert.match(x.ui.render(x.report,"reopened",x.state,x.services).find(".ujg-esi-management-header").text(),definition);
  assert.equal(x.ui.preview(x.report,"reopened",x.state,x.services).find(".ujg-esi-management-preview-item").length,0);
});

test("events opens chronological whole-day journal with group context", t => {
  const x=setup(); t.after(()=>x.dom.window.close());
  const panel=x.ui.render(x.report,"events",x.state,x.services);
  assert.match(panel.text(),/Все события/);
  assert.equal(panel.find(".ujg-esi-management-event").length,2);
  assert.match(panel.find(".ujg-esi-management-event").first().text(),/P-3/);
  assert.match(panel.find(".ujg-esi-management-event").first().text(),/P-4/);
});

test("management event wording translates status and effort without dumping description changes", t => {
  const x=setup(); t.after(()=>x.dom.window.close());
  x.report.events.push({id:"e3",kind:"field",field:"description",issueKey:"P-2",at:"2026-09-24T12:00:00Z",from:"private old long text",to:"private new long text",author:{label:"Ира"}});
  x.report.events.push({id:"e4",kind:"field",field:"timespent",issueKey:"P-2",at:"2026-09-24T12:01:00Z",from:"0",to:"3600",author:{label:"Ира"}});
  x.report.events.push({id:"e5",kind:"field",field:"Link",issueKey:"P-2",at:"2026-09-24T12:02:00Z",from:"",to:"This issue is child of P-100",author:{label:"Ира"}});
  const panel=x.ui.render(x.report,"events",x.state,x.services);
  assert.match(panel.text(),/Задача выполнена/);
  assert.match(panel.text(),/Изменено описание/);
  assert.match(panel.text(),/1 ч/);
  assert.doesNotMatch(panel.text(),/private old|private new|Open|Done|timespent/);
  assert.equal(panel.find("a[href='https://jira.example.test/base/browse/P-100']").length,1);
});

test("shared task events retain every parent globally and the selected parent in a scoped report", t => {
  const x=setup(); t.after(()=>x.dom.window.close());
  x.report.groups[0].events.push({id:"e1"});
  const panel=x.ui.render(x.report,"events",x.state,x.services);
  const shared=panel.find(".ujg-esi-management-event").first();
  assert.match(shared.text(),/P-1/);
  assert.match(shared.text(),/P-4/);
  panel.find(".ujg-esi-management-event-scope").last().trigger("click");
  const scoped=panel.find(".ujg-esi-management-detail-host");
  assert.match(scoped.text(),/P-4/);
  assert.doesNotMatch(scoped.text(),/P-1/);
});

test("detail distinguishes elapsed, active and snapshot work; comments use safe renderer", t => {
  const x=setup(); t.after(()=>x.dom.window.close());
  const panel=x.ui.render(x.report,"completed",x.state,x.services);
  const text=panel.text();
  assert.match(text,/Ира/);
  assert.match(text,/14:00/);
  assert.match(text,/Календарное время/);
  assert.match(text,/Активная работа/);
  assert.match(text,/Учтено на момент снимка/);
  assert.match(text,/неполн/);
  assert.match(text,/Отрисовано: <script>reason<\/script>/);
  assert.equal(panel.find("script").length,0);
  assert.ok(panel.find("a[href='https://jira.example.test/base/browse/P-2']").length >= 1);
});

test("preview opens, close works, and selecting a remark replaces its detail", t => {
  const x=setup(); t.after(()=>x.dom.window.close());
  let opened=0, closed=0;
  x.services.onOpen=() => opened++;
  x.services.onClose=() => closed++;
  x.ui.preview(x.report,"events",x.state,x.services).find("button").trigger("click");
  const panel=x.ui.render(x.report,"events",x.state,x.services);
  panel.find(".ujg-esi-management-close").trigger("click");
  assert.equal(opened,1); assert.equal(closed,1);
  x.report.groups[1].management.changed=true;
  const changed=x.ui.render(x.report,"changed",x.state,x.services);
  changed.find(".ujg-esi-management-remark").last().trigger("click");
  assert.match(changed.find(".ujg-esi-management-detail").text(),/P-4/);
  assert.doesNotMatch(changed.find(".ujg-esi-management-detail").text(),/Remark one/);
});

test("aggregate work stays partial when any task has unknown spent time", t => {
  const x=setup(); t.after(()=>x.dom.window.close());
  x.report.groups[0].management.tasks.push({key:"P-5",summary:"FE: second task",role:"FE",spentSeconds:null,worklogs:[],comments:[],notes:[]});
  const panel=x.ui.render(x.report,"completed",x.state,x.services);
  assert.match(panel.find(".ujg-esi-management-total").text(),/частичн/i);
  assert.match(panel.find(".ujg-esi-management-total").text(),/1 ч/);
});

test("remark turnaround uses root creation and certified milestone", t => {
  const x=setup(); t.after(()=>x.dom.window.close());
  x.report.groups[0].management.tasks.unshift({key:"P-1",summary:"Remark one",role:"",created:"2026-09-22T11:00:00Z",spentSeconds:0,worklogs:[],comments:[]});
  const panel=x.ui.render(x.report,"completed",x.state,x.services);
  assert.match(panel.find(".ujg-esi-management-turnaround").text(),/От создания до полной готовности/);
  assert.match(panel.find(".ujg-esi-management-turnaround").text(),/2 д/);
});

test("completed preview and full report show root creation and the same group-completion milestone in Moscow time", t => {
  const x=setup(); t.after(()=>x.dom.window.close());
  const group=x.report.groups[0];
  group.management.tasks.unshift({key:"P-1",created:"2026-09-16T08:15:00Z",completedAt:"2026-09-20T07:00:00Z"});
  group.management.tasks[1].completedAt="2026-09-24T16:00:00Z";
  const preview=x.ui.preview(x.report,"completed",x.state,x.services);
  const panel=x.ui.render(x.report,"completed",x.state,x.services);
  const definition="В выбранный день достигнута полная готовность замечания: готовы исходная история и все связанные задачи.";
  assert.equal(preview.find(".ujg-esi-management-definition").text(),definition);
  assert.equal(panel.find(".ujg-esi-management-header .ujg-esi-management-definition").text(),definition);
  for (const view of [preview,panel]) {
    const chronology=view.find(".ujg-esi-management-chronology").first();
    assert.match(chronology.find(".ujg-esi-management-created").text(),/Создано в Jira.*16\.09\.2026 11:15 МСК/);
    assert.match(chronology.find(".ujg-esi-management-completed-at").text(),/Полная готовность.*24\.09\.2026 14:00 МСК/);
    assert.match(chronology.text(),/От создания до полной готовности.*8 д 2 ч 45 мин/);
    assert.doesNotMatch(chronology.text(),/20\.09|19:00/);
    assert.doesNotMatch(view.text(),/До завершения:|Завершено за день|Создание замечания →/);
  }
  assert.match(panel.find(".ujg-esi-management-transition > strong").text(),/Замечание полностью готово/);
  assert.match(panel.find(".ujg-esi-management-transition").text(),/Последние переходы задач.*P-2.*QA.*Автор перехода: Ира/);
  assert.doesNotMatch(preview.find(".ujg-esi-management-preview-outcome").text(),/Завершил:/);
});

test("completion outcome summaries use safe Jira links and role badges in preview and full report", t => {
  const x=setup(); t.after(()=>x.dom.window.close());
  x.report.groups[0].management.completed[0].events[0].author.label='Ира <img src=x onerror="alert(1)">';
  for (const summary of [
    x.ui.preview(x.report,"completed",x.state,x.services).find(".ujg-esi-management-preview-outcome"),
    x.ui.render(x.report,"completed",x.state,x.services).find(".ujg-esi-management-outcomes")
  ]) {
    assert.equal(summary.find("a[href='https://jira.example.test/base/browse/P-2']").length,1);
    assert.equal(summary.find(".ujg-esi-management-role.role-qa").length,1);
    assert.match(summary.text(),/Автор перехода: Ира <img/);
    assert.equal(summary.find("img,script").length,0);
  }
});

for (const created of [undefined,null,"","not-a-date","2026-02-30T08:15:00Z","2026-09-16T08:15:00"]) {
  test(`missing or invalid root creation stays unknown: ${String(created)}`, t => {
    const x=setup(); t.after(()=>x.dom.window.close());
    if (created !== undefined) x.report.groups[0].management.tasks.unshift({key:"P-1",created});
    for (const view of [x.ui.preview(x.report,"completed",x.state,x.services),x.ui.render(x.report,"completed",x.state,x.services)]) {
      const chronology=view.find(".ujg-esi-management-chronology").first();
      assert.match(chronology.find(".ujg-esi-management-created").text(),/Создано в Jira.*Нет данных/);
      assert.match(chronology.find(".ujg-esi-management-completed-at").text(),/24\.09\.2026 14:00 МСК/);
      assert.match(chronology.find(".ujg-esi-management-turnaround").text(),/От создания до полной готовности.*Нет данных/);
      assert.doesNotMatch(chronology.text(),/NaN|Invalid|1970|23\.09/);
    }
  });
}

test("repeated completions use the first valid milestone for dates and averages and keep subsequent transitions chronological", t => {
  const x=setup(); t.after(()=>x.dom.window.close());
  const group=x.report.groups[0];
  group.management.tasks.unshift({key:"P-1",created:"2026-09-22T11:00:00Z"});
  group.management.completed=[{at:"2026-09-24T15:00:00Z",events:[]},{at:"invalid",events:[]},group.management.completed[0],{at:"2026-09-24T13:00:00Z",events:[]}];
  group.management.reopened=[{at:"2026-09-24T16:00:00Z",events:[]},{at:"2026-09-24T12:00:00Z",events:[]},{at:"2026-09-24T14:00:00Z",events:[]}];
  const originalCompleted=JSON.stringify(group.management.completed), originalReopened=JSON.stringify(group.management.reopened);
  const preview=x.ui.preview(x.report,"completed",x.state,x.services);
  const panel=x.ui.render(x.report,"completed",x.state,x.services);
  for (const view of [preview,panel]) {
    const chronology=view.find(".ujg-esi-management-chronology").first();
    assert.match(chronology.find(".ujg-esi-management-completed-at").text(),/24\.09\.2026 14:00 МСК.*Первое достижение за выбранный день/);
    assert.match(chronology.find(".ujg-esi-management-turnaround").text(),/2 д 0 ч 0 мин/);
    assert.doesNotMatch(view.text(),/Invalid|Завершено за день|До завершения:/);
  }
  assert.match(preview.find(".ujg-esi-management-preview-average").text(),/2 д 0 ч 0 мин.*1 из 1/);
  const history=preview.find(".ujg-esi-management-completion-history").text();
  assert.match(history,/Возврат в работу.*15:00.*Повторная полная готовность.*16:00.*Возврат в работу.*17:00.*Повторная полная готовность.*18:00.*Возврат в работу.*19:00/);
  assert.deepEqual(panel.find(".ujg-esi-management-transition > time").map((i,node)=>x.$(node).text()).get(),[
    "24.09.2026 14:00 МСК","24.09.2026 15:00 МСК","24.09.2026 16:00 МСК","24.09.2026 17:00 МСК","24.09.2026 18:00 МСК","24.09.2026 19:00 МСК"
  ]);
  assert.equal(preview.find(".ujg-esi-management-preview-item.is-completed").length,0);
  assert.match(preview.find(".ujg-esi-management-preview-milestone").text(),/Полная готовность достигнута.*Позже возвращено в работу: 24\.09\.2026 19:00 МСК/);
  assert.equal(JSON.stringify(group.management.completed),originalCompleted);
  assert.equal(JSON.stringify(group.management.reopened),originalReopened);
});

test("invalid group completion never borrows a task completion date or turnaround", t => {
  const x=setup(); t.after(()=>x.dom.window.close());
  const group=x.report.groups[0];
  group.management.tasks.unshift({key:"P-1",created:"2026-09-22T11:00:00Z",completedAt:"2026-09-24T10:00:00Z"});
  group.management.completed=[{at:"2026-09-31T11:00:00Z",events:[]}];
  for (const view of [x.ui.preview(x.report,"completed",x.state,x.services),x.ui.render(x.report,"completed",x.state,x.services)]) {
    const chronology=view.find(".ujg-esi-management-chronology").first();
    assert.match(chronology.find(".ujg-esi-management-created").text(),/22\.09\.2026 14:00 МСК/);
    assert.match(chronology.find(".ujg-esi-management-completed-at").text(),/Полная готовность.*Нет данных/);
    assert.match(chronology.find(".ujg-esi-management-turnaround").text(),/Нет данных/);
    assert.equal(view.find(".ujg-esi-management-preview-item.is-completed").length,0);
  }
});

test("a completed linked task alone does not imply full remark readiness", t => {
  const x=setup(); t.after(()=>x.dom.window.close());
  x.report.groups[0].management.completed=[];
  assert.equal(x.ui.preview(x.report,"completed",x.state,x.services).find(".ujg-esi-management-preview-item").length,0);
  assert.equal(x.ui.preview(x.report,"changed",x.state,x.services).find(".ujg-esi-management-preview-milestone").length,0);
  assert.equal(x.ui.render(x.report,"changed",x.state,x.services).find(".ujg-esi-management-transition").length,0);
});

test("real activity report waits for the root and all linked tasks before displaying group completion", t => {
  const x=setup(); t.after(()=>x.dom.window.close());
  function task(key,role,created,finished,author) {
    const snapshot=realActivity.capture({key,fields:{created,updated:"2026-09-24T12:00:00Z",status:{id:"2",name:"Done",statusCategory:{key:"done"}}},
      changelog:{startAt:0,total:1,histories:[{id:key,created:finished,author:{displayName:author},items:[{field:"status",from:"1",to:"2",fromString:"Open",toString:"Done"}]}]}});
    snapshot.capturedAt="2026-09-24T12:00:00Z";
    return {key,role,summary:key,status:"Done",statusCategory:"done",activity:snapshot};
  }
  const root=task("P-1","","2026-09-16T08:15:00Z","2026-09-24T11:00:00Z","Root closer");
  const qa=task("P-2","QA","2026-09-17T08:00:00Z","2026-09-24T09:00:00Z","QA closer");
  const be=task("P-3","BE","2026-09-17T08:00:00Z","2026-09-24T10:00:00Z","BE closer");
  const rows=[{jiraKey:root.key,summary:"Remark",storyDetails:root,childStatuses:[qa,be]}];
  const early=realActivity.summarize(rows,[],{date:"2026-09-24",now:"2026-09-24T09:30:00Z"});
  assert.equal(x.ui.preview(early,"completed",x.state,x.services).find(".ujg-esi-management-preview-item").length,0);
  const report=realActivity.summarize(rows,[],{date:"2026-09-24",now:"2026-09-24T12:00:00Z"});
  assert.equal(report.metrics.completed,1);
  const preview=x.ui.preview(report,"completed",x.state,x.services);
  assert.match(preview.find(".ujg-esi-management-created").text(),/16\.09\.2026 11:15 МСК/);
  assert.match(preview.find(".ujg-esi-management-completed-at").text(),/24\.09\.2026 14:00 МСК/);
  assert.match(preview.find(".ujg-esi-management-turnaround").text(),/8 д 2 ч 45 мин/);
  assert.match(preview.find(".ujg-esi-management-preview-outcome").text(),/P-1.*Автор перехода: Root closer/);
  assert.doesNotMatch(preview.find(".ujg-esi-management-preview-outcome").text(),/QA closer/);
});

test("preview carries certified outcomes and shows every remark", t => {
  const x=setup(); t.after(()=>x.dom.window.close());
  for (let i=0;i<4;i++) x.report.groups.push({...x.report.groups[0],id:"extra"+i,key:"P-"+(10+i)});
  const preview=x.ui.preview(x.report,"completed",x.state,x.services);
  assert.equal(preview.find(".ujg-esi-management-preview-item").length,5);
  assert.doesNotMatch(preview.text(),/Ещё 1/);
  assert.match(preview.text(),/QA/);
  assert.match(preview.text(),/Ира/);
  assert.match(preview.text(),/14:00/);
});

test("preview counts child roles and separates work authors from completion authors", t => {
  const x=setup(); t.after(()=>x.dom.window.close());
  const group=x.report.groups[0];
  group.management.tasks.unshift({key:"P-1",role:"FE",created:"2026-09-22T11:00:00Z",spentSeconds:3600,worklogs:[{author:{label:"Мария"},seconds:3600}],worklogsComplete:true});
  group.management.tasks.push(
    {key:"P-5",role:"FE",spentSeconds:7200,spentAsOf:"2026-09-24T12:00:00Z",completedBy:{label:"Никита"},worklogs:[{author:{label:"Анна"},seconds:7200}],worklogsComplete:true},
    {key:"P-6",role:"FE",spentSeconds:null,worklogs:[],worklogsComplete:false},
    {key:"P-7",role:"BE",spentSeconds:3600,worklogs:[{author:{label:"Борис"},seconds:3600}],worklogsComplete:true}
  );
  const preview=x.ui.preview(x.report,"completed",x.state,x.services);
  const row=preview.find(".ujg-esi-management-preview-item").first();
  assert.match(row.find(".ujg-esi-management-preview-roles").text(),/FE\s*2/);
  assert.match(row.find(".ujg-esi-management-preview-roles").text(),/BE\s*1/);
  assert.match(row.find(".ujg-esi-management-preview-roles").text(),/QA\s*1/);
  assert.equal(row.find(".ujg-esi-management-preview-roles .role-fe").length,1);
  assert.equal(row.find("a[href='https://jira.example.test/base/browse/P-5']").length,1);
  const fe=row.find(".ujg-esi-management-preview-role-group[data-role='FE']");
  assert.match(fe.find(".ujg-esi-management-preview-role-tasks").text(),/P-5.*P-6/);
  assert.match(fe.find(".ujg-esi-management-preview-role-workers").text(),/Анна/);
  assert.doesNotMatch(fe.find(".ujg-esi-management-preview-role-workers").text(),/Никита|Мария/);
  assert.match(fe.find(".ujg-esi-management-preview-role-completers").text(),/Завершил: Никита/);
  assert.doesNotMatch(fe.find(".ujg-esi-management-preview-role-completers").text(),/Анна/);
  assert.match(row.find(".ujg-esi-management-preview-role-group[data-role='BE'] .ujg-esi-management-preview-role-workers").text(),/Борис/);
  assert.match(row.find(".ujg-esi-management-preview-workers").text(),/Борис.*Анна|Анна.*Борис/);
  assert.match(row.find(".ujg-esi-management-preview-workers").text(),/Мария/);
  assert.doesNotMatch(row.find(".ujg-esi-management-preview-workers").text(),/Ира/);
  assert.match(row.find(".ujg-esi-management-preview-outcome").text(),/Автор перехода: Ира/);
  assert.match(row.find(".ujg-esi-management-preview-effort").text(),/5 ч.*частичн/i);
  assert.match(row.find(".ujg-esi-management-preview-elapsed").text(),/2 д/);
  assert.match(preview.find(".ujg-esi-management-preview-average").text(),/1 из 1/);
});

test("preview marks effort partial when root Story snapshot is unknown", t => {
  const x=setup(); t.after(()=>x.dom.window.close());
  x.report.groups[0].management.tasks.unshift({key:"P-1",created:"2026-09-22T11:00:00Z",spentSeconds:null,worklogs:[],worklogsComplete:false});
  const row=x.ui.preview(x.report,"completed",x.state,x.services).find(".ujg-esi-management-preview-item").first();
  assert.match(row.find(".ujg-esi-management-preview-effort").text(),/1 ч.*частичн/i);
  assert.match(row.find(".ujg-esi-management-preview-workers").text(),/частичн/i);
  assert.equal(row.find(".ujg-esi-management-preview-roles .ujg-esi-management-preview-role-group").length,1);
});
test("missing root is partial even when every present child has known effort", t => {
  const x=setup(); t.after(()=>x.dom.window.close());
  const row=x.ui.preview(x.report,"changed",x.state,x.services).find(".ujg-esi-management-preview-item").first();
  assert.match(row.find(".ujg-esi-management-preview-effort").text(),/1 ч.*частичн/i);
});
test("a reopened task retains its day completion author without claiming they did the work", t => {
  const x=setup(); t.after(()=>x.dom.window.close());
  Object.assign(x.report.groups[0].management.tasks[0],{completedBy:null,status:"Open",dayCompletions:[{at:"2026-09-24T11:00:00Z",author:{label:"Ира"}}]});
  const row=x.ui.preview(x.report,"changed",x.state,x.services).find(".ujg-esi-management-preview-item").first();
  assert.match(row.find(".ujg-esi-management-preview-role-completers").text(),/Ира/);
  assert.doesNotMatch(row.find(".ujg-esi-management-preview-role-workers").text(),/Ира/);
});
test("confirmed unassigned differs from missing assignment evidence", t => {
  const x=setup(); t.after(()=>x.dom.window.close());
  x.report.groups[0].management.tasks[0].assignee={label:"",identifiers:[]};
  const people=x.ui.preview(x.report,"changed",x.state,x.services).find(".ujg-esi-management-preview-role-assignees");
  assert.match(people.text(),/Не назначен/);
  assert.doesNotMatch(people.text(),/Нет данных|частичн/);
});

test("role assignees at cutoff are distinct from worklog authors and closers", t => {
  const x=setup(); t.after(()=>x.dom.window.close());
  x.report.groups[0].management.tasks[0].assignee={label:"Света"};
  x.report.groups[0].management.tasks.push({key:"P-5",role:"QA",assignee:{label:"Света"},completedBy:{label:"Ира"},worklogs:[],worklogsComplete:true,spentSeconds:0});
  const qa=x.ui.preview(x.report,"completed",x.state,x.services).find(".ujg-esi-management-preview-role-group[data-role='QA']");
  assert.match(qa.find(".ujg-esi-management-preview-role-assignees").text(),/Исполнители на срезе: Света/);
  assert.equal((qa.find(".ujg-esi-management-preview-role-assignees").text().match(/Света/g) || []).length,1);
  assert.doesNotMatch(qa.find(".ujg-esi-management-preview-role-workers").text(),/Света|Ира/);
  assert.match(qa.find(".ujg-esi-management-preview-role-completers").text(),/Ира/);
});

test("unfinished preview uses valid report cutoff for calendar age", t => {
  const x=setup(); t.after(()=>x.dom.window.close());
  x.report.asOf="2026-09-24T11:00:00Z";
  x.report.groups[1].management.tasks.push({key:"P-4",created:"2026-09-22T11:00:00Z",spentSeconds:0,worklogs:[],worklogsComplete:true});
  let row=x.ui.preview(x.report,"reopened",x.state,x.services).find(".ujg-esi-management-preview-item").first();
  assert.match(row.find(".ujg-esi-management-preview-elapsed").text(),/С момента создания: 2 д/);
  x.report.asOf="2026-09-21T11:00:00Z";
  row=x.ui.preview(x.report,"reopened",x.state,x.services).find(".ujg-esi-management-preview-item").first();
  assert.match(row.find(".ujg-esi-management-preview-elapsed").text(),/С момента создания: Нет данных/);
});

test("completion average uses one milestone per remark and excludes unknown turnaround", t => {
  const x=setup(); t.after(()=>x.dom.window.close());
  const first=x.report.groups[0];
  first.management.tasks.unshift({key:"P-1",created:"2026-09-22T11:00:00Z"});
  first.management.completed.push({at:"2026-09-24T12:00:00Z",events:[]});
  const second={...first,id:"g3",key:"P-8",management:{...first.management,tasks:[{key:"P-8",created:"2026-09-21T11:00:00Z"}],completed:[{at:"2026-09-24T11:00:00Z",events:[]}]}};
  const unknown={...first,id:"g4",key:"P-9",management:{...first.management,tasks:[],completed:[{at:"2026-09-24T11:00:00Z",events:[]}]}};
  x.report.groups.push(second,unknown);
  const preview=x.ui.preview(x.report,"completed",x.state,x.services);
  assert.match(preview.find(".ujg-esi-management-preview-average").text(),/2 д 12 ч/);
  assert.match(preview.find(".ujg-esi-management-preview-average").text(),/2 из 3/);
  assert.match(preview.find(".ujg-esi-management-preview-item").last().find(".ujg-esi-management-preview-elapsed").text(),/Нет данных/);
  assert.equal(preview.find(".ujg-esi-management-preview-item.is-completed").length,3);
});

test("later reopening does not make a completed-day preview look currently ready", t => {
  const x=setup(); t.after(()=>x.dom.window.close());
  x.report.groups[0].management.reopened.push({at:"2026-09-24T12:00:00Z",events:[]});
  const row=x.ui.preview(x.report,"completed",x.state,x.services).find(".ujg-esi-management-preview-item").first();
  assert.equal(row.hasClass("is-completed"),false);
  assert.match(row.find(".ujg-esi-management-preview-milestone").text(),/Полная готовность достигнута.*Позже возвращено в работу: 24\.09\.2026 15:00 МСК/);
});

test("preview keeps unknown child evidence explicit and refuses unsafe task links", t => {
  const x=setup(); t.after(()=>x.dom.window.close());
  x.report.groups[0].management.tasks.push({key:"P-5",summary:"Unclassified task",spentSeconds:null,worklogs:[],worklogsComplete:false});
  x.state.baseUrl="javascript:alert(1)";
  const row=x.ui.preview(x.report,"completed",x.state,x.services).find(".ujg-esi-management-preview-item").first();
  assert.match(row.find(".ujg-esi-management-preview-roles").text(),/Нет данных\s*1/);
  assert.match(row.find(".ujg-esi-management-preview-workers").text(),/частичн/i);
  assert.match(row.find(".ujg-esi-management-preview-effort").text(),/частичн/i);
  assert.equal(row.find("a").length,0);
  assert.match(row.find(".ujg-esi-management-preview-role-tasks").text(),/P-5/);
});

test("events report starts on all events and scope narrows the right-hand report", t => {
  const x=setup(); t.after(()=>x.dom.window.close());
  const panel=x.ui.render(x.report,"events",x.state,x.services);
  assert.equal(panel.find(".ujg-esi-management-event").length,2);
  assert.equal(panel.find(".ujg-esi-management-event-scope").length,3);
  assert.match(panel.find(".ujg-esi-management-event").first().text(),/Олег/);
  panel.find(".ujg-esi-management-event-scope").last().trigger("click");
  assert.equal(panel.find(".ujg-esi-management-event").length,1);
  assert.match(panel.find(".ujg-esi-management-event").text(),/P-4/);
});

test("remark selection uses valid controls and known empty collections say no records", t => {
  const x=setup(); t.after(()=>x.dom.window.close());
  const panel=x.ui.render(x.report,"completed",x.state,x.services);
  assert.equal(panel.find("button a").length,0);
  x.report.groups[0].management.tasks[0].worklogs=[];
  x.report.groups[0].management.tasks[0].worklogsComplete=true;
  x.report.groups[0].management.tasks[0].comments=[];
  x.report.groups[0].management.tasks[0].commentsComplete=true;
  const empty=x.ui.render(x.report,"completed",x.state,x.services);
  assert.match(empty.text(),/Нет записей/);
  assert.doesNotMatch(empty.find(".ujg-esi-management-worklogs > .ujg-esi-management-muted").text(),/Нет данных/);
});

test("work totals use task snapshots and comments avoid an unsupported cause", t => {
  const x=setup(); t.after(()=>x.dom.window.close());
  x.report.generatedAt="2026-09-30T12:00:00Z";
  x.report.asOf="2026-09-24T21:00:00Z";
  x.report.groups[0].management.tasks[0].comments[0].updatedAt="2026-09-25T12:00:00Z";
  x.report.groups[1].management.tasks.push({key:"P-3",summary:"BE task",comments:[{id:"c2",at:"2026-09-20T10:00:00Z",body:"Earlier",author:{label:"Олег"}}],worklogs:[]});
  const panel=x.ui.render(x.report,"reopened",x.state,x.services);
  assert.doesNotMatch(panel.text(),/рядом с возобновлением/);
  assert.match(panel.text(),/причина возврата не подтверждена/);
  const completed=x.ui.render(x.report,"completed",x.state,x.services);
  assert.match(completed.find(".ujg-esi-management-total").text(),/снимк/);
  assert.doesNotMatch(completed.find(".ujg-esi-management-total").text(),/30.09|2026-09-30/);
  assert.match(completed.text(),/редактировался после/);
});

test("unusual team names do not corrupt worklog team totals", t => {
  const x=setup(); t.after(()=>x.dom.window.close());
  x.report.groups[0].management.tasks[0].worklogs[0].team="__proto__";
  const panel=x.ui.render(x.report,"completed",x.state,x.services);
  assert.match(panel.find(".ujg-esi-management-team-total").text(),/__proto__: 1 ч/);
});

test("detail leads with outcomes and a compact task table with expandable evidence", t => {
  const x=setup(); t.after(()=>x.dom.window.close());
  const panel=x.ui.render(x.report,"completed",x.state,x.services);
  assert.match(panel.find(".ujg-esi-management-outcomes").text(),/Полная готовность достигнута/);
  assert.equal(panel.find(".ujg-esi-management-task-table tbody tr").length,1);
  assert.match(panel.find(".ujg-esi-management-task-table").text(),/Ира/);
  assert.equal(panel.find("details.ujg-esi-management-task").length,1);
  assert.equal(panel.find("details.ujg-esi-management-task").prop("open"),false);
});

test("changed preview describes observed roles and day outcomes", t => {
  const x=setup(); t.after(()=>x.dom.window.close());
  x.report.groups[0].dayHighlights={completed:1,created:1,reopened:0};
  const preview=x.ui.preview(x.report,"changed",x.state,x.services);
  assert.match(preview.text(),/Завершено задач: 1/);
  assert.match(preview.text(),/Создано задач: 1/);
  assert.match(preview.text(),/QA/);
});

test("missing payload stays unknown and unsafe Jira base does not make links", t => {
  const x=setup(); t.after(()=>x.dom.window.close());
  x.report.groups[0].management.tasks[0].spentSeconds=null;
  x.report.groups[0].management.tasks[0].elapsedSeconds=null;
  x.state.baseUrl="javascript:alert(1)";
  const panel=x.ui.render(x.report,"completed",x.state,x.services);
  assert.match(panel.text(),/Нет данных/);
  assert.doesNotMatch(panel.text(),/0 ч|затрачено до закрытия/);
  assert.equal(panel.find("a[href^='javascript:']").length,0);
});
