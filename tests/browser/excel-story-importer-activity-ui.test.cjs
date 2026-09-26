const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {JSDOM} = require("jsdom");
const jquery = require("jquery");
const load = require("../helpers/load-amd-module");
const activityDir = path.join(__dirname,"../../ujg-excel-story-importer-modules");
const config = load(path.join(activityDir,"config.js"),{});
const activity = load(path.join(activityDir,"activity.js"), {
  _ujgESI_teams:load(path.join(activityDir,"teams.js"),{}),
  _ujgESI_remarkId:load(path.join(activityDir,"remark-id.js"),{}),
  _ujgESI_deadlines:load(path.join(activityDir,"deadlines.js"),{_ujgESI_config:config})
});

function setup(report, configureWindow) {
  const dom = new JSDOM('<div id="root"><div class="parent-toolbar">Registry · Activity</div></div>', {runScripts:"outside-only", url:"http://localhost"});
  if (configureWindow) configureWindow(dom.window);
  const $ = jquery(dom.window), calls = {summarize:[], exports:[], refresh:0, aiOpen:0, aiUpdates:0}, modules = {jquery:$};
  modules._ujgESI_activity = {
    statusTone:activity.statusTone,
    returnKind:activity.returnKind,
    eventCategory:event => activity.eventCategory(event),
    summarize(rows, teams, options) { calls.summarize.push({rows,teams,options}); return Object.assign({}, report, {date:options.date}); },
    exportHtml(value, context) { calls.exports.push({value,context}); return '<!doctype html><title>Snapshot</title>'; },
    statusLabel(value) { return ({Testing:"Тестирование",Done:"Готово",Open:"Открыто"})[value] || value; },
    eventText(event) { return event.kind === "status" ? "Статус: " + this.statusLabel(event.from) + " → " + this.statusLabel(event.to) : event.kind === "assignee" ? "Исполнитель: " + event.from + " → " + event.to : "Создано"; }
  };
  modules._ujgESI_activityAiUi = {create:() => ({update(){calls.aiUpdates++;},open(){calls.aiOpen++;},dismiss(){return false;},rebindAnchor(){},suspend(){},destroy(){}})};
  dom.window.define = (name,deps,factory) => modules[name] = factory(...deps.map(dep => modules[dep]));
  for (const file of ["icons","activity-management-ui","activity-ui"]) dom.window.eval(fs.readFileSync(path.join(__dirname,"../../ujg-excel-story-importer-modules",file+".js"),"utf8"));
  const state = {rows:[{id:"row"}],teams:[],projectKey:"P",epicKey:"P-EPIC",viewMode:"jira",registryWarning:"Scope warning"};
  const services = {onLoadActivityHistory() { calls.refresh++; }};
  const ui = modules._ujgESI_activityUi.create();
  const render = () => ui.render($("#root"),state,services);
  render();
  return {dom,$,state,services,calls,render,modules,ui};
}
function selectFilter(x,key,values) {
  x.$(`[data-activity-filter='${key}']`).trigger("click");
  x.$(".ujg-esi-activity-filter-clear").trigger("click");
  values.forEach(value => {
    x.$(".ujg-esi-activity-filter-option").filter(function() { return x.$(this).text().trim()===value; }).find("input").prop("checked",true).trigger("change");
  });
  x.$(".ujg-esi-activity-filter-apply").trigger("click");
}
function fixture() {
  const events = [
    {id:"e1",at:"2026-09-24T12:00:00.000Z",kind:"status",issueKey:"P-2",role:"QA",from:"Testing",to:"Done",author:{label:"Ira",identifiers:["ira-id"]},assignee:{label:"Bob"}},
    {id:"e2",at:"2026-09-24T13:00:00.000Z",kind:"assignee",issueKey:"P-3",role:"BE",from:"Bob",to:"Ann",author:{label:"Ira",identifiers:["ira-id"]},assignee:{label:"Ann"},fromTeam:"BE",toTeam:"QA"}
  ];
  return {coverage:{complete:1,total:2,incomplete:1,warnings:["History incomplete"],isComplete:false},metrics:{changed:1,newRemarks:0,completed:null,reopened:null,events:2},balance:{startOpen:null,endOpen:null},transitions:[{from:"Testing",to:"Done",count:1}],transfers:[{from:"BE",to:"QA",count:1}],groups:[{id:"g1",remarkId:"744",key:"P-1",summary:"Remark",events}],events,teams:[]};
}
test("status matrix colors both axes and marks task return cells with their evidence", t => {
  const report=fixture(), event={...report.events[0],from:"Done",to:"In Progress",returnKind:"reopened"};
  report.events=[event]; report.groups[0].events=[event];
  report.transitions=[{from:"Done",to:"In Progress",count:1}];
  const x=setup(report); t.after(()=>x.dom.window.close());
  assert.equal(x.$(".ujg-esi-activity-status-matrix th .is-done").length,2);
  assert.equal(x.$(".ujg-esi-activity-status-matrix th .is-progress").length,2);
  assert.equal(x.$(".ujg-esi-activity-status-matrix td.is-return").length,1);
  const button=x.$(".ujg-esi-activity-status-matrix td.is-return button");
  assert.match(button.attr("aria-label"),/Возврат/);
  assert.equal(button.text(),"1");
  assert.equal(button.find("svg[data-icon='Undo2']").length,1);
  assert.equal(button.attr("title"),"Возврат задачи");
  assert.doesNotMatch(button.text(),/[‹›<>≤≥]/);
  button.trigger("click");
  assert.match(x.$(".ujg-esi-activity-event-popover").text(),/P-2/);
});
test("task return metric opens remarks with review rollbacks even when no whole remark reopened", t => {
  const report=fixture(), event={...report.events[0],from:"In Review",to:"In Progress",returnKind:"review"};
  report.events=[event]; report.groups[0].events=[event]; report.groups[0].taskReturns=[event];
  report.metrics.taskReturns=1; report.metrics.reopened=0;
  const x=setup(report); t.after(()=>x.dom.window.close());
  const button=x.$("[data-metric='taskReturns']");
  assert.match(button.attr("aria-label"),/Возвраты задач: 1/);
  button.trigger("click");
  assert.match(x.$(".ujg-esi-management-dialog").text(),/P-2/);
});
test("same-name transition evidence excludes unchanged status records", t => {
  const report=fixture(), changed={...report.events[0],from:"Done",to:"Done",fromId:"2",toId:"3",returnKind:"reopened"};
  const noop={...changed,id:"noop",fromId:"3",toId:"3",returnKind:null};
  report.events=[changed,noop]; report.groups[0].events=report.events;
  report.transitions=[{from:"Done",to:"Done",count:1}];
  const x=setup(report); t.after(()=>x.dom.window.close());
  x.$(".ujg-esi-activity-status-matrix td.has-transfer button").trigger("click");
  assert.equal(x.$(".ujg-esi-activity-popover-event").length,1);
});
test("compact Dynamics toolbar exposes the LLM report command without sending on render", t => {
  const x=setup(fixture()); t.after(()=>x.dom.window.close());
  const command=x.$(".ujg-esi-activity-ai-command");
  assert.equal(command.length,1);
  assert.equal(command.attr("aria-label"),"LLM-отчёт");
  assert.match(command.text(),/LLM-отчёт/);
  assert.equal(x.calls.aiOpen,0);
  command.trigger("click");
  assert.equal(x.calls.aiOpen,1);
  assert.equal(x.calls.aiUpdates,1);
});
function categoryFixture() {
  const report=fixture();
  report.events.push(
    {...report.events[0],id:"e3",from:"Open",to:"In Progress"},
    {...report.events[0],id:"e4",kind:"field",field:"description",from:"old",to:"new"},
    {...report.events[0],id:"e5",kind:"field",field:"description",from:"other",to:"text"},
    {...report.events[0],id:"e6",kind:"field",field:"timespent",from:"0",to:"3600"},
    {...report.events[0],id:"e7",kind:"field",field:"WorklogId",from:"123",to:""},
    {...report.events[0],id:"e8",kind:"field",field:"timeestimate",from:"7200",to:"3600"}
  );
  report.metrics.events=report.events.length;
  return report;
}
test("daily metric is keyboard actionable and opens an unfiltered management report", t => {
  const report=fixture();
  report.groups[0].management={changed:true,newRemark:false,completed:[],reopened:[],tasks:[],notes:[]};
  const x=setup(report); t.after(()=>x.dom.window.close());
  selectFilter(x,"role",["QA"]);
  const trigger=x.$("[data-metric='changed']");
  assert.equal(trigger[0].tagName,"BUTTON");
  trigger.trigger("click");
  const dialog=x.$(".ujg-esi-management-dialog[role='dialog']");
  assert.equal(dialog.length,1);
  assert.equal(dialog.attr("aria-modal"),"true");
  assert.match(dialog.text(),/Remark/);
  assert.equal(x.$(".ujg-esi-activity-event").length,1);
  dialog.trigger(x.$.Event("keydown",{key:"Escape"}));
  assert.equal(x.$(".ujg-esi-management-dialog").length,0);
  assert.equal(x.dom.window.document.activeElement,trigger[0]);
  assert.equal(x.$(".ujg-esi-activity-metric-preview").length,0);
});
test("metric hover opens a brief preview and click replaces it with the full report", async t => {
  const report=fixture();
  report.groups[0].management={changed:true,newRemark:false,completed:[],reopened:[],tasks:[],notes:[]};
  const x=setup(report); t.after(()=>x.dom.window.close());
  const trigger=x.$("[data-metric='changed']");
  trigger.trigger("mouseenter");
  await new Promise(resolve=>setTimeout(resolve,260));
  assert.equal(x.$(".ujg-esi-activity-metric-preview").length,1);
  assert.match(x.$(".ujg-esi-activity-metric-preview").text(),/Remark/);
  trigger.trigger("click");
  assert.equal(x.$(".ujg-esi-activity-metric-preview").length,0);
  assert.equal(x.$(".ujg-esi-management-dialog").length,1);
  assert.equal(x.ui.dismissPopover(),true);
  assert.equal(x.$(".ujg-esi-management-dialog").length,0);
});
test("metric preview uses ninety percent of the available viewport without overflowing", t => {
  const x=setup(fixture()); t.after(()=>x.dom.window.close());
  Object.defineProperty(x.dom.window.document.documentElement,"clientWidth",{configurable:true,value:1400});
  x.$("[data-metric='changed']").trigger("focus");
  const box=x.$(".ujg-esi-activity-metric-preview");
  assert.equal(parseFloat(box.css("width")),1260);
  assert.ok(parseFloat(box.css("left"))+parseFloat(box.css("width"))<=1400);
});
test("an open metric preview refits when the window becomes narrow", t => {
  const x=setup(fixture()); t.after(()=>x.dom.window.close());
  Object.defineProperty(x.dom.window.document.documentElement,"clientWidth",{configurable:true,value:1400});
  x.$("[data-metric='changed']").trigger("focus");
  Object.defineProperty(x.dom.window.document.documentElement,"clientWidth",{configurable:true,value:390});
  x.$(x.dom.window).trigger("resize");
  const box=x.$(".ujg-esi-activity-metric-preview");
  assert.equal(parseFloat(box.css("width")),351);
  assert.ok(parseFloat(box.css("left"))+parseFloat(box.css("width"))<=390);
});
test("a tall metric preview leaves its trigger clickable and limits its scrolling height", t => {
  const x=setup(fixture()); t.after(()=>x.dom.window.close());
  Object.defineProperty(x.dom.window.document.documentElement,"clientHeight",{configurable:true,value:1000});
  const original=x.$.fn.outerHeight;
  x.$.fn.outerHeight=function() { return this.hasClass("ujg-esi-activity-metric-preview") ? 800 : original.apply(this,arguments); };
  const trigger=x.$("[data-metric='changed']");
  trigger[0].getBoundingClientRect=()=>({left:100,right:300,top:200,bottom:250,width:200,height:50});
  trigger.trigger("focus");
  const box=x.$(".ujg-esi-activity-metric-preview");
  assert.ok(parseFloat(box.css("top"))>=254);
  assert.ok(parseFloat(box.css("top"))+parseFloat(box.css("max-height"))<=988);
  assert.ok(parseFloat(box.find(".ujg-esi-management-preview").css("max-height"))<=708);
});
test("deadline metric and badges use controller states and show coverage", t => {
  const report=fixture();
  report.metrics.overdue=null; report.observed={overdue:2};
  report.deadlineReferenceDate="2026-09-25";
  report.deadlineCoverage={known:3,missing:1,invalid:1,conflict:1,unknownState:2,total:6};
  report.groups[0].deadline={date:"2026-09-23",referenceDate:"2026-09-25",state:"overdue",daysOverdue:2};
  const x=setup(report); t.after(()=>x.dom.window.close());
  const metric=x.$("[data-metric='overdue']");
  assert.equal(x.$(".ujg-esi-activity-metric").length,6);
  assert.match(metric.text(),/^2.*Просроченные/);
  assert.match(metric.find("strong").attr("title"),/зафиксировано/i);
  assert.match(metric.find("strong").attr("title"),/На сегодня, 25\.09\.2026 МСК/);
  assert.match(x.$(".ujg-esi-activity-group-deadline").text(),/23\.09\.2026.*просрочено 2 д/);
  assert.ok(x.$(".ujg-esi-activity-group-deadline").hasClass("is-overdue"));
  assert.match(x.$(".ujg-esi-activity-deadline-coverage").text(),/3.*1.*1.*1.*2/);
  assert.match(x.$(".ujg-esi-activity-deadline-coverage").text(),/На сегодня, 25\.09\.2026 МСК/);
  assert.match(x.$(".ujg-esi-activity-group-deadline").attr("title"),/На сегодня, 25\.09\.2026 МСК/);
  x.$(".ujg-esi-activity-date").val("2026-09-22").trigger("change");
  assert.match(x.$(".ujg-esi-activity-deadline-coverage").text(),/На сегодня, 25\.09\.2026 МСК/);
  assert.doesNotMatch(x.$(".ujg-esi-activity-deadline-coverage").text(),/На выбранную дату|22\.09\.2026/);
  assert.equal(x.calls.summarize[0].options.journalRows,undefined);
  x.state.deadlineJournalRows=[{key:"P-1"}]; x.state.mappingSettings={columnMap:{deadline:"План"}}; x.render();
  assert.deepEqual(x.calls.summarize.at(-1).options.journalRows,x.state.deadlineJournalRows);
  assert.deepEqual(x.calls.summarize.at(-1).options.columnMap,{deadline:"План"});
});
test("deadline badges distinguish near dates and neutral states", t => {
  const report=fixture();
  const x=setup(report); t.after(()=>x.dom.window.close());
  for (const [state,date,phrase,klass] of [["today","2026-09-24","сегодня","is-near"],["tomorrow","2026-09-25","завтра","is-near"],["completed","2026-09-20","готово","is-neutral"],["missing",null,"Срок не указан","is-neutral"],["invalid",null,"Не удалось распознать срок","is-neutral"],["conflict",null,"Противоречивый срок","is-neutral"],["unknown","2026-09-20","состояние не подтверждено","is-neutral"]]) {
    report.groups[0].deadline={date,state}; x.render();
    const badge=x.$(".ujg-esi-activity-group-deadline");
    assert.match(badge.text(),new RegExp(phrase,"i"));
    assert.ok(badge.hasClass(klass),state);
    assert.equal(badge.hasClass("is-overdue"),false);
  }
});
test("deadline badge title exposes source field and invalid raw value as safe text", t => {
  const report=fixture();
  report.groups[0].deadline={date:null,state:"invalid",source:"jira-description",field:"Срок исполнения",raw:'<img src=x onerror="alert(1)">'};
  const x=setup(report); t.after(()=>x.dom.window.close());
  const badge=x.$(".ujg-esi-activity-group-deadline");
  assert.match(badge.attr("title"),/сохранённ.*Jira.*Срок исполнения.*<img/s);
  assert.equal(x.$("img").length,0);
  report.groups[0].deadline={date:null,state:"conflict",source:"excel",field:"План",raw:"25.09.2026; 26.09.2026"};
  x.render();
  assert.match(x.$(".ujg-esi-activity-group-deadline").attr("title"),/Excel.*План.*25\.09\.2026; 26\.09\.2026/s);
});
test("overdue metric opens every confirmed remark despite journal filtering", t => {
  const report=fixture();
  report.metrics.overdue=2;
  report.groups[0].deadline={date:"2026-09-23",state:"overdue",daysOverdue:1,pendingTasks:[]};
  report.groups.push({id:"quiet",key:"P-9",remarkId:"99",summary:"Quiet overdue",events:[],deadline:{date:"2026-09-20",state:"overdue",daysOverdue:4,pendingTasks:[]}});
  const x=setup(report); t.after(()=>x.dom.window.close());
  selectFilter(x,"role",["QA"]);
  assert.equal(x.$(".ujg-esi-activity-group").length,1);
  x.$("[data-metric='overdue']").trigger("focus");
  assert.equal(x.$(".ujg-esi-activity-metric-preview .ujg-esi-management-preview-item").length,2);
  x.$("[data-metric='overdue']").trigger("click");
  assert.equal(x.$(".ujg-esi-management-dialog .ujg-esi-management-remark").length,2);
  assert.match(x.$(".ujg-esi-management-dialog .ujg-esi-management-remark").first().text(),/P-9/);
});

test("deadline issue count opens preview and full report for quiet groups regardless of journal filters", t => {
  const report=fixture();
  report.deadlineReferenceDate="2026-09-25";
  report.deadlineCoverage={known:0,missing:0,invalid:1,conflict:1,unknownState:0,total:2};
  report.metrics.overdue=null; report.observed={overdue:0};
  report.groups[0].deadline={problem:"invalid",state:"invalid",reasonCode:"ambiguous-format",reasonLabel:"Неоднозначный формат даты",source:"excel",field:"Срок",raw:"24/09/26",candidates:[{raw:"24/09/26",source:"excel",field:"Срок"}]};
  report.groups.push({id:"quiet",key:"P-9",remarkId:"99",summary:"Quiet conflict",events:[],deadline:{problem:"conflict",state:"conflict",reasonCode:"conflict",reasonLabel:"Противоречивые сроки",source:"jira-description",field:"Срок",raw:"25.09.2026",candidates:[{raw:"25.09.2026",source:"jira-description",field:"Срок"},{raw:'<img src=x onerror="alert(1)">',source:"jira-description",field:"Срок (колонка 2)"}]}});
  const x=setup(report); t.after(()=>x.dom.window.close());
  selectFilter(x,"role",["QA"]);
  const trigger=x.$(".ujg-esi-activity-deadline-issues");
  assert.equal(trigger.attr("data-metric"),"deadlineIssues");
  assert.equal(trigger.text(),"Не распознаны сроки: 2");
  assert.equal(x.$(".ujg-esi-activity-metric").length,6);
  trigger.trigger("focus");
  const preview=x.$(".ujg-esi-activity-metric-preview");
  assert.equal(preview.find(".ujg-esi-management-preview-item").length,2);
  assert.match(preview.text(),/24\/09\/26.*Quiet conflict.*25\.09\.2026.*<img/s);
  assert.equal(preview.find("img").length,0);
  trigger.trigger("click");
  const dialog=x.$(".ujg-esi-management-dialog");
  assert.equal(dialog.find(".ujg-esi-management-remark").length,2);
  assert.match(dialog.text(),/текущий журнал Excel.*сохранённое описание Jira/s);
  assert.match(dialog.text(),/Неоднозначный формат даты/);
  dialog.find(".ujg-esi-management-remark").last().trigger("click");
  assert.match(dialog.text(),/Срок \(колонка 2\).*<img/s);
  assert.equal(dialog.find("img").length,0);
  dialog.trigger(x.$.Event("keydown",{key:"Escape"}));
  assert.equal(x.dom.window.document.activeElement,trigger[0]);
});

test("overdue report includes deadline issue details without claiming an exact overdue total", t => {
  const report=fixture(); report.metrics.overdue=null; report.observed={overdue:0};
  report.deadlineCoverage={known:0,missing:0,invalid:1,conflict:0,unknownState:0,total:1};
  report.groups[0].deadline={problem:"invalid",state:"invalid",reasonCode:"invalid-calendar",reasonLabel:"Несуществующая календарная дата",source:"excel",field:"Срок",raw:"31.02.2026",candidates:[{raw:"31.02.2026",source:"excel",field:"Срок"}]};
  const x=setup(report); t.after(()=>x.dom.window.close());
  x.$("[data-metric='overdue']").trigger("focus");
  assert.match(x.$(".ujg-esi-activity-metric-preview").text(),/Не распознаны сроки: 1/);
  x.$("[data-metric='overdue']").trigger("click");
  assert.match(x.$(".ujg-esi-management-dialog").text(),/Подтверждено 0; итог может быть больше/);
  assert.equal(x.$(".ujg-esi-management-dialog .ujg-esi-management-deadline-issue").length,0);
  x.$(".ujg-esi-management-dialog .ujg-esi-management-deadline-open").trigger("click");
  assert.match(x.$(".ujg-esi-management-dialog").text(),/31\.02\.2026/);
  assert.equal(x.$(".ujg-esi-management-dialog").attr("aria-label"),"Не распознаны сроки");
});

test("empty deadline issue report uses snapshot wording and remains safe with partial coverage", t => {
  const report=fixture(); report.deadlineCoverage={known:0,missing:0,invalid:0,conflict:0,unknownState:1,total:1};
  const x=setup(report); t.after(()=>x.dom.window.close());
  x.$("[data-metric='deadlineIssues']").trigger("focus");
  assert.match(x.$(".ujg-esi-activity-metric-preview").text(),/Сроков, которые не удалось распознать, в загруженных данных нет/);
  assert.doesNotMatch(x.$(".ujg-esi-activity-metric-preview").text(),/За выбранный день/);
  x.$("[data-metric='deadlineIssues']").trigger("click");
  assert.match(x.$(".ujg-esi-management-dialog").text(),/состояние не подтверждено|Снимок загруженных данных/i);
});

test("mixed candidate sources are both counted in the diagnostic summary", t => {
  const report=fixture(); report.deadlineCoverage={known:0,missing:0,invalid:0,conflict:1,unknownState:0,total:1};
  report.groups[0].deadline={problem:"conflict",state:"conflict",reasonCode:"conflict",source:"excel",candidates:[
    {raw:"25.09.2026",source:"excel",field:"Срок"},
    {raw:"26.09.2026",source:"jira-description",field:"Срок исполнения"}
  ]};
  const x=setup(report); t.after(()=>x.dom.window.close());
  x.$("[data-metric='deadlineIssues']").trigger("focus");
  assert.match(x.$(".ujg-esi-management-deadline-coverage").text(),/текущий журнал Excel: 1.*сохранённое описание Jira: 1/s);
  assert.match(x.$(".ujg-esi-activity-metric-preview").text(),/Срок исполнения.*26\.09\.2026/s);
});
test("change filter offers unique categories, not individual event descriptions", t => {
  const x=setup(categoryFixture()); t.after(()=>x.dom.window.close());
  x.$("[data-activity-filter='change']").trigger("click");
  const options=x.$(".ujg-esi-activity-filter-option").map(function() {return x.$(this).text().trim();}).get();
  assert.deepEqual(options.sort(),["Исполнитель","Описание","Оценка трудозатрат","Статус","Трудозатраты"].sort());
});
test("category multi-select filters all matching events while keeping details and totals", t => {
  const x=setup(categoryFixture()); t.after(()=>x.dom.window.close());
  selectFilter(x,"change",["Статус","Описание"]);
  assert.equal(x.$(".ujg-esi-activity-event").length,1);
  assert.equal(x.$(".ujg-esi-activity-event [data-event-id]").length,4);
  assert.match(x.$(".ujg-esi-activity-event").text(),/Статус: Тестирование → Готово/);
  assert.match(x.$(".ujg-esi-activity-event").text(),/Открыто → In Progress/);
  assert.equal(x.$("[data-metric='events'] strong").text(),"8");
  const saved=JSON.parse(x.dom.window.localStorage.getItem("ujg-esi-state:activity-layout"));
  assert.deepEqual(saved.filters.change,["Статус","Описание"]);
  const next=x.modules._ujgESI_activityUi.create(); next.render(x.$("#root"),x.state,{});
  assert.equal(x.$(".ujg-esi-activity-mount").last().find(".ujg-esi-activity-event").length,1);
  assert.equal(x.$(".ujg-esi-activity-mount").last().find(".ujg-esi-activity-event [data-event-id]").length,4);
});
test("worklog category groups records and spent time without including estimates", t => {
  const x=setup(categoryFixture()); t.after(()=>x.dom.window.close());
  selectFilter(x,"change",["Трудозатраты"]);
  assert.equal(x.$(".ujg-esi-activity-event").length,1);
  assert.equal(x.$(".ujg-esi-activity-event [data-event-id]").length,2);
  selectFilter(x,"change",["Оценка трудозатрат"]);
  assert.equal(x.$(".ujg-esi-activity-event").length,1);
});
test("migration clears obsolete change descriptions but preserves version-2 layout and other filters", t => {
  const x=setup(fixture(),window=>window.localStorage.setItem("ujg-esi-state:activity-layout",JSON.stringify({
    version:2,visible:["remark","change","role"],order:["change","role","remark","time","assignee","author"],
    widths:{change:345},sort:{key:"change",descending:true},filters:{change:["Статус: Testing → Done"],role:["QA"]}
  }))); t.after(()=>x.dom.window.close());
  assert.equal(x.$(".ujg-esi-activity-event").length,1);
  const saved=JSON.parse(x.dom.window.localStorage.getItem("ujg-esi-state:activity-layout"));
  assert.equal(saved.filters.change,undefined);
  assert.deepEqual(saved.filters.role,["QA"]);
  assert.ok(saved.visible.includes("remark"));
  assert.equal(saved.widths.change,345);
  assert.equal(saved.order[0],"change");
  assert.deepEqual(saved.sort,{key:"change",descending:true});
});
test("category export keeps all matching descriptions and category filter metadata", t => {
  const x=setup(categoryFixture()); t.after(()=>x.dom.window.close());
  x.dom.window.URL.createObjectURL=()=>"blob:category-test";
  x.dom.window.URL.revokeObjectURL=()=>{};
  x.dom.window.HTMLAnchorElement.prototype.click=function(){};
  selectFilter(x,"change",["Трудозатраты"]);
  x.$("[aria-label='Скачать HTML']").trigger("click");
  assert.deepEqual(Array.from(x.calls.exports[0].value.events,event=>event.field),["timespent","WorklogId"]);
  assert.deepEqual(Array.from(x.calls.exports[0].context.filters.change),["Трудозатраты"]);
  assert.equal(x.calls.exports[0].value.metrics.events,8);
});
test("empty change selection survives migration and current selections survive empty reports", t => {
  const report=categoryFixture();
  const x=setup(report,window=>window.localStorage.setItem("ujg-esi-state:activity-layout",JSON.stringify({version:2,filters:{change:[]}})));
  t.after(()=>x.dom.window.close());
  assert.equal(x.$(".ujg-esi-activity-event").length,0);
  selectFilter(x,"change",["Описание"]);
  assert.equal(x.$(".ujg-esi-activity-event").length,1);
  assert.equal(x.$(".ujg-esi-activity-event [data-event-id]").length,2);
  const groups=report.groups;
  report.groups=[]; x.render();
  x.$("[data-activity-filter='change']").trigger("click");
  assert.equal(x.$(".ujg-esi-activity-selected-chip").text(),"Описание");
  x.$(".ujg-esi-activity-filter-apply").trigger("click");
  report.groups=groups; x.render();
  assert.equal(x.$(".ujg-esi-activity-event").length,1);
  assert.equal(x.$(".ujg-esi-activity-event [data-event-id]").length,2);
});
test("renders daily totals, unknown balances, current scope and grouped journal", t => {
  const x=setup(fixture()); t.after(()=>x.dom.window.close());
  const text=x.$("#root").text();
  assert.match(text,/Срез на выбранный день не подтверждён/); assert.match(text,/Проверена история 1 из 2 задач/);
  assert.match(text,/Нет данных/); assert.match(text,/P-EPIC/); assert.match(text,/текущ/);
  assert.doesNotMatch(x.$(".ujg-esi-activity-scope").text(),/Scope warning/);
  assert.match(text,/P-1/); assert.match(text,/P-2/);
  assert.match(text,/Тестирование/); assert.match(text,/Готово/); assert.match(text,/Ira/);
  assert.equal(x.$(".ujg-esi-activity-event").length,2);
  assert.equal(x.calls.summarize[0].options.scopeWarning,"Scope warning");
});
test("new and legacy layouts hide duplicate remark once while retaining preferences and filters", t => {
  const x=setup(fixture(), window => window.localStorage.setItem("ujg-esi-state:activity-layout",JSON.stringify({
    order:["author","remark","time","role","change","assignee"],visible:["author","remark","time","role","change","assignee"],
    widths:{remark:180,role:280},sort:{key:"author",descending:true},filters:{remark:["744"]}
  }))); t.after(()=>x.dom.window.close());
  let saved=JSON.parse(x.dom.window.localStorage.getItem("ujg-esi-state:activity-layout"));
  assert.equal(x.$("th[data-column='remark']").length,0);
  assert.deepEqual(saved.visible.includes("remark"),false);
  assert.deepEqual(saved.filters.remark,["744"]);
  assert.deepEqual(saved.sort,{key:"author",descending:true});
  assert.equal(saved.widths.role,280);
  assert.equal(x.$("[data-activity-hidden-filter='remark']").length,1);
  x.$("[aria-label='Столбцы журнала']").trigger("click");
  x.$(".ujg-esi-activity-column-option").filter(function() { return x.$(this).text().includes("ID · Замечание"); }).find("input").prop("checked",true).trigger("change");
  x.$(".ujg-esi-activity-columns-apply").trigger("click");
  const next=x.modules._ujgESI_activityUi.create(); next.render(x.$("#root"),x.state,{});
  assert.equal(x.$(".ujg-esi-activity-mount").last().find("th[data-column='remark']").length,1);
  saved=JSON.parse(x.dom.window.localStorage.getItem("ujg-esi-state:activity-layout"));
  assert.equal(saved.visible.includes("remark"),true);
  x.$("[aria-label='Столбцы журнала']").last().trigger("click");
  x.$(".ujg-esi-activity-columns-reset").last().trigger("click");
  saved=JSON.parse(x.dom.window.localStorage.getItem("ujg-esi-state:activity-layout"));
  assert.equal(saved.visible.includes("remark"),false);
  assert.deepEqual(saved.filters.remark,["744"]);
  assert.deepEqual(saved.sort,{key:"author",descending:true});
});
test("legacy remark-only layout migrates to one usable non-remark column", t => {
  const x=setup(fixture(), window => window.localStorage.setItem("ujg-esi-state:activity-layout",JSON.stringify({visible:["remark"],filters:{remark:["744"]}}))); t.after(()=>x.dom.window.close());
  assert.equal(x.$("th[data-column='remark']").length,0);
  assert.ok(x.$(".ujg-esi-activity-table thead th").length>=1);
  const saved=JSON.parse(x.dom.window.localStorage.getItem("ujg-esi-state:activity-layout"));
  assert.ok(saved.visible.includes("time"));
  assert.deepEqual(saved.filters.remark,["744"]);
});
test("group context is unaffected by journal filters and keeps the full summary", t => {
  const report=fixture(); Object.assign(report.groups[0],{currentStatus:"Open",linkedTaskCount:2,dayComplete:false,
    dayHighlights:{completed:1,created:1,reopened:0},summary:"A long original story summary that must remain complete"});
  const x=setup(report); t.after(()=>x.dom.window.close());
  const heading=x.$(".ujg-esi-activity-group");
  assert.match(heading.text(),/Сейчас: Открыто/);
  assert.match(heading.text(),/Связанных задач: 2/);
  assert.match(heading.text(),/Завершено 1/);
  assert.match(heading.text(),/Создано 1/);
  assert.match(heading.find(".ujg-esi-activity-group-badge.is-created").attr("title"),/исходн.*истори.*связанн.*задач/);
  assert.match(heading.text(),/История неполна/);
  assert.match(heading.text(),/A long original story summary that must remain complete/);
  selectFilter(x,"role",["QA"]);
  assert.match(x.$(".ujg-esi-activity-group").text(),/Завершено 1/);
  assert.match(x.$(".ujg-esi-activity-group").text(),/Создано 1/);
});
test("group heading summarizes ordinary observed edits without implying completeness", t => {
  const report=fixture(); Object.assign(report.groups[0],{currentStatus:"Open",linkedTaskCount:1,dayComplete:false,
    dayHighlights:{completed:0,created:0,reopened:0},dayActivityCount:2});
  const x=setup(report); t.after(()=>x.dom.window.close());
  assert.match(x.$(".ujg-esi-activity-group").text(),/Изменено 2/);
  assert.match(x.$(".ujg-esi-activity-group").text(),/История неполна/);
});
test("group heading calls out a no-op-only selected day without claiming work", t => {
  const report=fixture(); Object.assign(report.groups[0],{currentStatus:"Open",linkedTaskCount:0,dayComplete:true,
    dayHighlights:{completed:0,created:0,reopened:0},dayActivityCount:0,dayNoopStatusCount:1});
  const x=setup(report); t.after(()=>x.dom.window.close());
  assert.match(x.$(".ujg-esi-activity-group").text(),/За день/);
  assert.match(x.$(".ujg-esi-activity-group").text(),/Статус без изменений/);
  assert.doesNotMatch(x.$(".ujg-esi-activity-group").text(),/Изменено/);
});
test("field-only no-op history says no change, not observed work", t => {
  const report=fixture(); Object.assign(report.groups[0],{currentStatus:"Open",linkedTaskCount:0,dayComplete:true,
    dayHighlights:{completed:0,created:0,reopened:0},dayActivityCount:0,dayNoopStatusCount:0});
  const x=setup(report); t.after(()=>x.dom.window.close());
  assert.match(x.$(".ujg-esi-activity-group").text(),/Без изменений/);
  assert.doesNotMatch(x.$(".ujg-esi-activity-group").text(),/Изменено 1/);
});
test("Excel source excludes a stale Jira registry warning", t => {
  const x=setup(fixture()); t.after(()=>x.dom.window.close());
  x.state.viewMode="excel"; x.render();
  assert.equal(x.calls.summarize.at(-1).options.scopeWarning,undefined);
  assert.doesNotMatch(x.$(".ujg-esi-activity-scope").text(),/Scope warning/);
  assert.equal(x.$(".ujg-esi-activity-warning").length,0);
});
test("as-of cutoff distinguishes current partial day from historical 24:00", t => {
  const report=fixture(); report.asOf="2026-09-24T06:15:00.000Z"; report.end=Date.parse("2026-09-24T21:00:00.000Z");
  const x=setup(report); t.after(()=>x.dom.window.close());
  assert.match(x.$(".ujg-esi-activity-zone").text(),/09:15/);
  report.asOf="2026-09-24T21:00:00.000Z"; x.render();
  assert.match(x.$(".ujg-esi-activity-zone").text(),/24:00/);
});
test("partial legacy metrics show plain observed counts and compact unknown values", t => {
  const report=fixture(); report.asOf="2026-09-24T06:15:00.000Z"; report.end=Date.parse("2026-09-24T21:00:00.000Z");
  report.metrics={changed:null,newRemarks:null,completed:null,reopened:null,events:47};
  report.observed={changed:18,newRemarks:6};
  const x=setup(report); t.after(()=>x.dom.window.close());
  assert.match(x.$(".ujg-esi-activity-summary h3").text(),/Итоги на 09:15/);
  assert.equal(x.$("[data-metric='changed'] strong").text(),"18");
  assert.equal(x.$("[data-metric='newRemarks'] strong").text(),"6");
  assert.equal(x.$("[data-metric='completed'] strong").text(),"—");
  assert.equal(x.$("[data-metric='taskReturns'] strong").text(),"—");
  assert.match(x.$("[data-metric='changed'] strong").attr("title"),/итог может быть больше/);
  assert.match(x.$("[data-metric='completed'] strong").attr("title"),/Недостаточно/);
});
test("confirmed metrics and balance remain visible with excluded remarks", t => {
  const report=fixture();
  report.asOf="2026-09-24T21:00:00.000Z"; report.end=Date.parse(report.asOf);
  report.confirmed={metrics:{changed:1,newRemarks:0,completed:1,reopened:0,taskReturns:0,events:2,overdue:1},balance:{startOpen:2,endOpen:1},remarks:1,totalRemarks:2,excluded:[{id:"bad",key:"P-9",summary:"<img src=x>",reasons:["История загружена частично"]}]};
  const x=setup(report); t.after(()=>x.dom.window.close()); x.state.baseUrl="https://jira.example.test/base"; x.render();
  assert.equal(x.$("[data-metric='completed'] strong").text(),"1");
  assert.equal(x.$("[data-metric='overdue'] strong").text(),"1");
  assert.match(x.$(".ujg-esi-activity-balance").text(),/2 на начало.*1 на конец дня/);
  assert.match(x.$(".ujg-esi-activity-confirmed-coverage").text(),/Подтверждено 1 из 2 замечаний/);
  const excluded=x.$(".ujg-esi-activity-excluded");
  assert.match(excluded.find("summary").text(),/Не вошло: 1/);
  assert.equal(excluded.find("a[href='https://jira.example.test/base/browse/P-9']").length,1);
  assert.equal(excluded.find("img").length,0);
  assert.match(excluded.text(),/История загружена частично/);
});
test("zero certified remarks leave history counts and balance unknown while events remain observed", t => {
  const report=fixture();
  report.confirmed={metrics:{changed:null,newRemarks:null,completed:null,reopened:null,taskReturns:null,events:2,overdue:0},balance:{startOpen:null,endOpen:null},remarks:0,totalRemarks:1,excluded:[]};
  const x=setup(report); t.after(()=>x.dom.window.close());
  assert.equal(x.$("[data-metric='changed'] strong").text(),"—");
  assert.equal(x.$("[data-metric='events'] strong").text(),"2");
  assert.equal(x.$("[data-metric='overdue'] strong").text(),"0");
  assert.match(x.$(".ujg-esi-activity-balance").text(),/Нет данных.*Нет данных/);
});
test("complete certified subset still discloses incomplete global scope", t => {
  const report=fixture(); report.confirmed={metrics:{changed:1,events:2},balance:{startOpen:1,endOpen:1},remarks:1,totalRemarks:1,excluded:[]};
  report.coverage={isComplete:false,complete:1,total:1,warnings:["Область Jira неполна"]};
  const x=setup(report); t.after(()=>x.dom.window.close());
  assert.match(x.$(".ujg-esi-activity-confirmed-coverage").text(),/Покрытие.*неполно/);
  assert.match(x.$(".ujg-esi-activity-warning-list").text(),/Область Jira неполна/);
});
test("missing cutoff never claims a full past day or end-day balance", t => {
  const report=fixture(); report.asOf=null; report.end=Date.parse("2026-09-24T21:00:00.000Z");
  const x=setup(report); t.after(()=>x.dom.window.close());
  assert.doesNotMatch(x.$(".ujg-esi-activity-summary h3").text(),/весь день|24:00/);
  assert.match(x.$(".ujg-esi-activity-summary h3").text(),/Срез.*не подтверждён/);
  assert.match(x.$(".ujg-esi-activity-balance").text(),/на момент загрузки/);
  assert.doesNotMatch(x.$(".ujg-esi-activity-zone").text(),/24:00/);
});
test("current partial-day balance says at load and time diagnostics stay inside technical details", t => {
  const report=fixture(); report.asOf="2026-09-24T06:15:00.000Z"; report.end=Date.parse("2026-09-24T21:00:00.000Z");
  report.coverage.diagnostics=["P-1: same-second timestamp"];
  const x=setup(report); t.after(()=>x.dom.window.close());
  assert.match(x.$(".ujg-esi-activity-balance").text(),/на момент загрузки/);
  assert.equal(x.$(".ujg-esi-activity-coverage > .ujg-esi-activity-diagnostic-details").length,0);
  assert.equal(x.$(".ujg-esi-activity-warning-details .ujg-esi-activity-diagnostic-details").length,1);
});
test("render preserves parent toolbar and reuses one private mount", t => {
  const x=setup(fixture()); t.after(()=>x.dom.window.close());
  x.render();
  assert.equal(x.$(".parent-toolbar").length,1);
  assert.equal(x.$(".ujg-esi-activity-mount").length,1);
  assert.equal(x.$(".ujg-esi-activity").length,1);
});
test("date navigation keeps instance date across renders and validates input", t => {
  const x=setup(fixture()); t.after(()=>x.dom.window.close());
  const changes=[]; x.services.onActivityDateChange=value=>changes.push(value);
  x.render(); assert.deepEqual(changes,[]);
  x.$(".ujg-esi-activity-date").val("2026-09-24").trigger("change");
  assert.deepEqual(changes,["2026-09-24"]);
  x.$(".ujg-esi-activity-date").val("2026-09-24").trigger("change");
  assert.deepEqual(changes,["2026-09-24"]);
  x.$("[aria-label='Предыдущий день']").trigger("click");
  assert.deepEqual(changes,["2026-09-24","2026-09-23"]);
  assert.equal(x.calls.summarize.at(-1).options.date,"2026-09-23");
  x.render(); assert.equal(x.$(".ujg-esi-activity-date").val(),"2026-09-23"); assert.equal(changes.length,2);
  x.$("[aria-label='Следующий день']").trigger("click");
  assert.deepEqual(changes,["2026-09-24","2026-09-23","2026-09-24"]);
  assert.equal(x.calls.summarize.at(-1).options.date,"2026-09-24");
  x.$(".ujg-esi-activity-date").val("2026-02-30").trigger("change");
  assert.equal(changes.length,3);
});
test("journal filter and sort leave totals intact, collapse survives render", t => {
  const x=setup(fixture()); t.after(()=>x.dom.window.close());
  selectFilter(x,"role",["QA"]);
  assert.equal(x.$(".ujg-esi-activity-event").length,1);
  assert.equal(x.$(".ujg-esi-activity-metric[data-metric='events'] strong").text(),"2");
  x.$("[data-activity-sort='time']").trigger("click");
  x.$(".ujg-esi-activity-group-toggle").trigger("click");
  assert.equal(x.$(".ujg-esi-activity-event").length,0);
  x.render(); assert.equal(x.$(".ujg-esi-activity-group-toggle").attr("aria-expanded"),"false");
});
test("journal combines one actor's changes on one issue in one Moscow minute and retains details", t => {
  const report=fixture();
  const first=report.events[0];
  const second={...first,id:"e1b",at:"2026-09-24T12:00:45.000Z",kind:"field",field:"description",from:"old",to:"new"};
  report.groups[0].events=[first,second]; report.events=[first,second]; report.metrics.events=2;
  const x=setup(report); t.after(()=>x.dom.window.close());
  assert.equal(x.$(".ujg-esi-activity-event").length,1);
  assert.match(x.$(".ujg-esi-activity-event").text(),/2 изменения/);
  assert.equal(x.$(".ujg-esi-activity-event [data-event-id]").length,2);
  assert.match(x.$(".ujg-esi-activity-event").text(),/Статус:.*Описание|Статус:.*Создано/s);
  assert.equal(x.$("[data-metric='events'] strong").text(),"2");
  assert.equal(x.calls.aiUpdates,1);
});
test("journal keeps issues, actors, calendar minutes and unknown actors separate", t => {
  const report=fixture(), base=report.events[0];
  const events=[base,
    {...base,id:"other-issue",issueKey:"P-7"},
    {...base,id:"other-actor",author:{label:"Nina",identifiers:["nina"]}},
    {...base,id:"same-name-different-id",author:{label:"Ira",identifiers:["other-ira-id"]}},
    {...base,id:"other-minute",at:"2026-09-24T12:01:00.000Z"},
    {...base,id:"unknown-a",author:{label:"Ira",identifiers:[]}},
    {...base,id:"unknown-b",author:{label:"Ira",identifiers:[]}}];
  report.groups[0].events=events; report.events=events; report.metrics.events=events.length;
  const x=setup(report); t.after(()=>x.dom.window.close());
  assert.equal(x.$(".ujg-esi-activity-event").length,7);
});
test("journal filters grouped events by category and export keeps each raw detail", t => {
  const report=fixture(), first=report.events[0];
  const second={...first,id:"description",kind:"field",field:"description",from:"old",to:"new"};
  report.groups[0].events=[first,second]; report.events=[first,second]; report.metrics.events=2;
  const x=setup(report); t.after(()=>x.dom.window.close());
  selectFilter(x,"change",[activity.eventCategory(second)]);
  assert.equal(x.$(".ujg-esi-activity-event").length,1);
  assert.equal(x.$(".ujg-esi-activity-event [data-event-id]").length,0);
  assert.equal(x.$("[data-metric='events'] strong").text(),"2");
  x.dom.window.URL.createObjectURL=()=>"blob:test";
  x.dom.window.URL.revokeObjectURL=()=>{};
  x.dom.window.HTMLAnchorElement.prototype.click=function(){};
  x.$("[aria-label='Скачать HTML']").trigger("click");
  assert.deepEqual(x.calls.exports[0].value.groups[0].events.map(event=>event.id),["description"]);
});
test("completed-task action stays green in a grouped journal row", t => {
  const report=fixture(), first=report.events[0];
  const second={...first,id:"field",kind:"field",field:"description",from:"old",to:"new"};
  report.groups[0].events=[first,second]; report.events=[first,second];
  const x=setup(report); t.after(()=>x.dom.window.close());
  assert.match(x.$(".ujg-esi-activity-event-details summary").text(),/Задача выполнена.*2 изменения/);
  assert.equal(x.$(".ujg-esi-activity-event [data-event-id='e1'] .is-done").length,1);
  assert.equal(x.$(".ujg-esi-activity-event [data-event-id='field'] .is-done").length,0);
});
test("unchanged Done status is neutral alone and in a grouped summary", t => {
  const report=fixture(), original=report.events[0];
  const noop={...original,id:"noop",from:"Done",to:"Done",fromId:"3",toId:"3"};
  report.groups[0].events=[noop]; report.events=[noop];
  const x=setup(report); t.after(()=>x.dom.window.close());
  assert.equal(x.$(".ujg-esi-activity-event .is-done").length,0);
  const detail={...noop,id:"detail",kind:"field",field:"description",from:"old",to:"new"};
  report.groups[0].events=[noop,detail]; report.events=[noop,detail]; x.render();
  assert.equal(x.$(".ujg-esi-activity-event-details summary").text(),"2 изменения");
  assert.equal(x.$(".ujg-esi-activity-event .is-done").length,0);
});
test("status IDs distinguish a real Done-to-Done transition from a no-op", t => {
  const report=fixture(), original=report.events[0];
  const changed={...original,from:"Done",to:"Done",fromId:"3",toId:"4"};
  report.groups[0].events=[changed]; report.events=[changed];
  const x=setup(report); t.after(()=>x.dom.window.close());
  assert.equal(x.$(".ujg-esi-activity-event td.is-done").length,1);
  const sameId={...changed,from:"Finished",to:"Done",fromId:"4",toId:"4"};
  report.groups[0].events=[sameId]; report.events=[sameId]; x.render();
  assert.equal(x.$(".ujg-esi-activity-event td.is-done").length,0);
});
test("grouped assignment changes identify mixed assignees and retain each assignment", t => {
  const report=fixture(), first=report.events[0];
  const second={...first,id:"reassign",kind:"assignee",from:"Bob",to:"Ann",assignee:{label:"Ann"},fromTeam:"BE",toTeam:"QA"};
  report.groups[0].events=[first,second]; report.events=[first,second];
  const x=setup(report); t.after(()=>x.dom.window.close());
  assert.equal(x.$(".ujg-esi-activity-event").length,1);
  assert.match(x.$(".ujg-esi-activity-event td").eq(3).text(),/Несколько исполнителей/);
  assert.match(x.$(".ujg-esi-activity-event [data-event-id='reassign']").text(),/Bob.*Ann.*BE.*QA/);
});
test("time sort orders remark groups by their first visible event", t => {
  const report=fixture();
  report.groups.push({id:"g2",remarkId:"1052",key:"P-4",summary:"Later",events:[{id:"e3",at:"2026-09-24T15:00:00.000Z",kind:"created",issueKey:"P-4",role:"История",author:{label:"Ira"}}]});
  const x=setup(report); t.after(()=>x.dom.window.close());
  x.$("[data-activity-sort='time']").trigger("click");
  assert.match(x.$(".ujg-esi-activity-group").first().text(),/1052/);
});
test("refresh, loading and errors remain visible for available history", t => {
  const x=setup(fixture()); t.after(()=>x.dom.window.close());
  x.$("[aria-label='Обновить историю']").trigger("click"); assert.equal(x.calls.refresh,1);
  x.state.activityLoading=true; x.render();
  assert.equal(x.$("[aria-label='Обновить историю']").prop("disabled"),true);
  x.state.activityLoading=false; x.state.activityError="Network error"; x.render();
  assert.match(x.$("#root").text(),/Network error/);
});
test("a complete current-day snapshot still offers explicit refresh", t => {
  const report=fixture(); report.coverage={isComplete:true,total:3,complete:3,incomplete:0,warnings:[]};
  const x=setup(report); t.after(()=>x.dom.window.close());
  assert.equal(x.$("[aria-label='Обновить историю']").length,1);
  x.$("[aria-label='Обновить историю']").trigger("click");
  assert.equal(x.calls.refresh,1);
});
test("coverage keeps long warnings in a compact scrollable disclosure", t => {
  const report=fixture(); report.coverage.warnings=["First warning","Second warning","Third warning"];
  const x=setup(report); t.after(()=>x.dom.window.close());
  assert.equal(x.$(".ujg-esi-activity-coverage > details").length,1);
  assert.match(x.$(".ujg-esi-activity-coverage summary").text(),/проблем.*3/);
  assert.doesNotMatch(x.$(".ujg-esi-activity-coverage summary").text(),/First warning/);
  assert.match(x.$(".ujg-esi-activity-warning-list").text(),/Third warning/);
});
test("loading shows registry phase or read progress and defers issue disclosures", t => {
  const report=fixture(); report.coverage.diagnostics=["P-1: same-second timestamp"];
  const x=setup(report); t.after(()=>x.dom.window.close());
  x.state.registryLoading=true; x.state.activityLoading=true; x.render();
  assert.match(x.$(".ujg-esi-activity-coverage").text(),/Загрузка реестра/);
  assert.equal(x.$(".ujg-esi-activity-coverage").next().hasClass("ujg-esi-activity-summary"),true,"Loading progress is above the report metrics");
  assert.equal(x.$(".ujg-esi-activity-warning-details").length,0);
  assert.equal(x.$(".ujg-esi-activity-ai-command").prop("disabled"),true);
  x.state.registryLoading=false; x.state.activityProgress={completed:7,total:12}; x.render();
  assert.match(x.$(".ujg-esi-activity-coverage").text(),/7 из 12/);
  x.state.activityLoading=false; x.render();
  assert.match(x.$(".ujg-esi-activity-warning-details summary").text(),/проблем/);
  assert.match(x.$(".ujg-esi-activity-diagnostic-details summary").text(),/расхождени/);
  assert.match(x.$(".ujg-esi-activity-diagnostic-list").text(),/P-1: same-second timestamp/);
});
test("journal shows colored initials and role tags without repeated team movement", t => {
  const report=fixture(); report.groups[0].events[0].author={label:"Ira S",color:"#774488"};
  report.groups[0].events[0].assignee={label:"Bob K",color:"#227766"};
  report.groups[0].events[0].roleColor="#9955aa";
  report.groups[0].events[0].fromTeam="BE"; report.groups[0].events[0].toTeam="BE";
  const x=setup(report); t.after(()=>x.dom.window.close());
  assert.match(x.$(".ujg-esi-activity-role").first().text(),/QA/);
  assert.equal(x.$(".ujg-esi-activity-avatar").length>=2,true);
  assert.match(x.$(".ujg-esi-activity-role").first().attr("class"),/role-qa/);
  assert.match(x.$(".ujg-esi-activity-avatar").first().attr("style"),/background-color/);
  assert.match(x.$(".ujg-esi-activity-event").first().text(),/Bob K/);
  assert.doesNotMatch(x.$(".ujg-esi-activity-event").first().text(),/BE → BE/);
});
test("flow counts and transfer matrix expose each direction", t => {
  const report=fixture(); report.transfers.push({from:"QA",to:"BE",count:2});
  const x=setup(report); t.after(()=>x.dom.window.close());
  assert.equal(x.$(".ujg-esi-activity-status-matrix").length,1);
  assert.equal(x.$(".ujg-esi-activity-transfer-matrix").length,1);
  assert.match(x.$(".ujg-esi-activity-transfer-matrix").text(),/BE.*QA/s);
  assert.match(x.$(".ujg-esi-activity-transfer-matrix").text(),/2/);
});
test("unknown team avatars stay neutral instead of borrowing a team color", t => {
  const report=fixture();
  report.groups[0].events[0].author={label:"No team",identifiers:["unknown"],color:""};
  const x=setup(report); t.after(()=>x.dom.window.close());
  const avatar=x.$(".ujg-esi-activity-event").first().children().last().find(".ujg-esi-activity-avatar");
  assert.equal(avatar.css("background-color"),"rgb(229, 233, 238)");
});
test("issue keys link only through an http(s) Jira base URL", t => {
  const x=setup(fixture()); t.after(()=>x.dom.window.close());
  x.state.baseUrl="https://jira.example.test/"; x.render();
  const parent=x.$(".ujg-esi-activity-group-key a"), child=x.$(".ujg-esi-activity-issue a").first();
  assert.equal(parent.attr("href"),"https://jira.example.test/browse/P-1");
  assert.equal(child.attr("href"),"https://jira.example.test/browse/P-2");
  assert.equal(child.attr("target"),"_blank"); assert.match(child.attr("rel"),/noopener/);
  x.state.baseUrl="javascript:alert(1)"; x.render();
  assert.equal(x.$(".ujg-esi-activity-issue a").length,0);
});
test("parent event role is History and partial empty flows describe observed history", t => {
  const report=fixture(); report.transitions=[]; report.transfers=[];
  report.groups[0].events[0].role="";
  const x=setup(report); t.after(()=>x.dom.window.close());
  assert.match(x.$(".ujg-esi-activity-role").first().text(),/История/);
  assert.match(x.$(".ujg-esi-activity-flows").text(),/Не зафиксировано в загруженной истории/);
  assert.doesNotMatch(x.$(".ujg-esi-activity-flows").text(),/Нет передач за день|Нет переходов за день/);
});
test("stale history warnings offer refresh even when snapshots are marked complete", t => {
  const report=fixture(); report.coverage={complete:2,total:2,incomplete:0,warnings:["Снимок истории устарел"],isComplete:false};
  const x=setup(report); t.after(()=>x.dom.window.close());
  assert.equal(x.$("[aria-label='Обновить историю']").length,1);
});
test("export receives filtered report and context without injecting Jira text", t => {
  const report=fixture(); report.groups[0].summary='<img src=x onerror=alert(1)>';
  report.groups.push({id:"quiet",key:"P-9",summary:"Quiet overdue",events:[],deadline:{date:"2026-09-20",state:"overdue",daysOverdue:4}});
  const x=setup(report); t.after(()=>x.dom.window.close());
  x.state.baseUrl="https://jira.example.test/base";
  let download;
  x.dom.window.URL.createObjectURL = blob => { download=blob; return "blob:activity-test"; };
  x.dom.window.URL.revokeObjectURL = () => {};
  x.dom.window.HTMLAnchorElement.prototype.click = function() { assert.equal(this.download,"activity-" + x.$(".ujg-esi-activity-date").val() + ".html"); };
  selectFilter(x,"role",["QA"]);
  x.$("[aria-label='Скачать HTML']").trigger("click");
  assert.equal(x.calls.exports.length,1);
  assert.equal(x.calls.exports[0].value.events.length,1);
  assert.equal(x.calls.exports[0].value.groups[0].events.length,1);
  assert.equal(x.calls.exports[0].value.deadlineGroups.length,2);
  assert.equal(x.calls.exports[0].value.deadlineGroups[1].key,"P-9");
  assert.equal(x.calls.exports[0].context.projectKey,"P");
  assert.equal(x.calls.exports[0].context.epicKey,"P-EPIC");
  assert.equal(x.calls.exports[0].context.baseUrl,"https://jira.example.test/base");
  assert.deepEqual(Array.from(x.calls.exports[0].context.filters.role),["QA"]);
  assert.equal(x.calls.exports[0].context.sort.key,"time");
  assert.equal(download.type,"text/html;charset=utf-8");
  assert.equal(x.$("img").length,0);
});
test("changing day clears journal filters that may be stale", t => {
  const x=setup(fixture()); t.after(()=>x.dom.window.close());
  selectFilter(x,"role",["QA"]);
  x.$("[aria-label='Следующий день']").trigger("click");
  assert.equal(x.$("[data-activity-filter='role']").hasClass("is-active"),false);
  assert.equal(x.$(".ujg-esi-activity-event").length,2);
  assert.equal(JSON.parse(x.dom.window.localStorage.getItem("ujg-esi-state:activity-layout")).filters.role,undefined);
});
test("export preserves the selected journal order as well as its sort metadata", t => {
  const x=setup(fixture()); t.after(()=>x.dom.window.close());
  x.dom.window.URL.createObjectURL=()=>"blob:test";
  x.dom.window.URL.revokeObjectURL=()=>{};
  x.dom.window.HTMLAnchorElement.prototype.click=function(){};
  x.$("[data-activity-sort='time']").trigger("click");
  const visibleTimes=x.$(".ujg-esi-activity-event").map(function(){return x.$(this).children().first().text();}).get();
  x.$("[aria-label='Скачать HTML']").trigger("click");
  const exportedTimes=x.calls.exports[0].value.groups[0].events.map(event=>new Date(Date.parse(event.at)+3*3600000).toISOString().slice(11,16));
  assert.deepEqual(exportedTimes,visibleTimes);
});
test("data refresh retains a selected value absent from the new report", t => {
  const report=fixture(), x=setup(report); t.after(()=>x.dom.window.close());
  selectFilter(x,"role",["QA"]);
  report.groups[0].events=report.groups[0].events.filter(event=>event.role!=="QA");
  x.render();
  assert.equal(x.$("[data-activity-filter='role']").hasClass("is-active"),true);
  assert.equal(x.$(".ujg-esi-activity-event").length,0);
  x.$("[data-activity-filter='role']").trigger("click");
  assert.equal(x.$(".ujg-esi-activity-selected-chip").text(),"QA");
});
test("absent persisted selection stays removable and Apply does not turn it into All", t => {
  const report=fixture(), x=setup(report); t.after(()=>x.dom.window.close());
  report.groups[0].events[0].author={label:"Alice"};
  x.render(); selectFilter(x,"author",["Alice"]);
  report.groups[0].events[0].author={label:"Bob"};
  report.groups[0].events[1].author={label:"Bob"};
  x.render();
  x.$("[data-activity-filter='author']").trigger("click");
  assert.equal(x.$(".ujg-esi-activity-selected-chip").text(),"Alice");
  assert.equal(x.$(".ujg-esi-filter-value-row:not([hidden]) .ujg-esi-activity-filter-option").text().trim(),"Bob");
  assert.equal(x.$(".ujg-esi-filter-value-row:not([hidden]) input").prop("checked"),false);
  assert.equal(x.$(".ujg-esi-activity-filter-menu .ujg-esi-filter-count").text(),"0 / 1");
  x.$(".ujg-esi-activity-filter-apply").trigger("click");
  assert.equal(x.$(".ujg-esi-activity-event").length,0);
  assert.deepEqual(Array.from(JSON.parse(x.dom.window.localStorage.getItem("ujg-esi-state:activity-layout")).filters.author),["Alice"]);
});
test("empty source offers guidance without invented balances", t => {
  const report=fixture(); report.groups=[]; report.events=[]; report.coverage={complete:0,total:0,incomplete:0,warnings:[],isComplete:true};
  report.metrics={changed:0,newRemarks:0,completed:0,reopened:0,events:0};
  const x=setup(report); t.after(()=>x.dom.window.close()); x.state.rows=[]; x.render();
  assert.match(x.$("#root").text(),/Загрузите/);
  assert.equal(x.$(".ujg-esi-activity-metric").length,0);
  assert.equal(x.$(".ujg-esi-activity-flow").length,0);
  assert.equal(x.$(".ujg-esi-activity-event").length,0);
});
test("header funnel applies multiple values with no native selects or duplicate chips", t => {
  const report=fixture(); report.groups[0].events.push({...report.groups[0].events[0],id:"e3",role:"FE"});
  const x=setup(report); t.after(()=>x.dom.window.close());
  assert.equal(x.$(".ujg-esi-activity-table thead tr").length,1);
  assert.equal(x.$(".ujg-esi-activity-table thead select").length,0);
  selectFilter(x,"role",["QA","FE"]);
  assert.equal(x.$(".ujg-esi-activity-event").length,1);
  assert.equal(x.$(".ujg-esi-activity-event [data-event-id]").length,2);
  assert.equal(x.$("[data-activity-filter='role']").hasClass("is-active"),true);
  x.$("[data-activity-filter='role']").trigger("click");
  assert.equal(x.$(".ujg-esi-activity-selected-chip").length,0);
  assert.equal(x.$(".ujg-esi-activity-filter-option.is-selected").length,2);
  x.$(".ujg-esi-activity-filter-search").val("BE").trigger("input");
  assert.equal(x.$(".ujg-esi-activity-filter-option input:checked").length,2);
  assert.equal(x.$(".ujg-esi-filter-value-row:not([hidden]) .ujg-esi-activity-filter-option").text(),"BE");
});
test("role and change checkboxes stay in place while narrowing the selection", t => {
  for (const key of ["role","change"]) {
    const x=setup(categoryFixture()); t.after(()=>x.dom.window.close());
    x.$(`[data-activity-filter='${key}']`)[0].click();
    const inputs=x.$(".ujg-esi-activity-filter-option input").toArray();
    inputs[0].focus(); inputs[0].click();
    assert.deepEqual(x.$(".ujg-esi-activity-filter-option input").toArray(),inputs);
    assert.equal(x.dom.window.document.activeElement,inputs[0]);
    assert.equal(x.$(".ujg-esi-activity-selected-chip").length,0);
    inputs[1].click();
    assert.equal(x.$(".ujg-esi-activity-filter-menu").length,1);
    assert.equal(x.$(".ujg-esi-activity-filter-option input:checked").length,inputs.length-2);
  }
});
test("native click on a selected person's cross removes only that value without closing the filter", t => {
  const x=setup(fixture()); t.after(()=>x.dom.window.close());
  selectFilter(x,"assignee",["Ann","Bob"]);
  x.$("[data-activity-filter='assignee']")[0].click();
  x.$(".ujg-esi-activity-selected-chip[title='Убрать: Ann'] svg")[0]
    .dispatchEvent(new x.dom.window.MouseEvent("click",{bubbles:true}));
  assert.equal(x.$(".ujg-esi-activity-filter-menu").length,1);
  assert.equal(x.$(".ujg-esi-activity-selected-chip").text(),"Bob");
  assert.equal(x.$(".ujg-esi-filter-value-row:not([hidden]) .ujg-esi-activity-filter-option").text(),"Ann");
  assert.equal(x.$(".ujg-esi-activity-event").length,2);
  x.$(".ujg-esi-activity-filter-apply")[0].click();
  assert.equal(x.$(".ujg-esi-activity-event").length,1);
  assert.match(x.$(".ujg-esi-activity-event").text(),/Bob/);
});
test("only-value command picks one role without manually unchecking all others", t => {
  const x=setup(fixture()); t.after(()=>x.dom.window.close());
  x.$("[data-activity-filter='role']")[0].click();
  const only=x.$("[aria-label='Выбрать только QA']");
  assert.equal(only.length,1);
  only[0].click();
  assert.equal(x.$(".ujg-esi-activity-filter-menu").length,1);
  assert.equal(x.$(".ujg-esi-activity-filter-option input:checked").closest("label").text(),"QA");
  x.$(".ujg-esi-activity-filter-apply")[0].click();
  assert.equal(x.$(".ujg-esi-activity-event").length,1);
  assert.match(x.$(".ujg-esi-activity-event").text(),/P-2/);
});
test("filter popup styles reach the mounted menu and retain an outer scroll fallback", t => {
  const x=setup(fixture()); t.after(()=>x.dom.window.close());
  x.$("<style/>").text(fs.readFileSync(path.join(__dirname,"../../ujg-excel-story-importer.css"),"utf8")).appendTo(x.dom.window.document.head);
  x.$("[data-activity-filter='role']")[0].click();
  const menu=x.$(".ujg-esi-activity-filter-menu")[0];
  assert.equal(x.dom.window.getComputedStyle(menu.querySelector(".ujg-esi-filter-only")).width,"26px");
  assert.equal(x.dom.window.getComputedStyle(menu).overflowY,"auto");
});
test("sort filter width and order persist per user-scoped activity layout", t => {
  const x=setup(fixture()); t.after(()=>x.dom.window.close());
  x.state.preferencesStorageKey="user-A"; x.render();
  selectFilter(x,"role",["QA"]);
  x.$("[data-activity-sort='author']").trigger("click");
  x.$(".ujg-esi-activity-table [data-column='role'] .ujg-esi-activity-column-resize").trigger(x.$.Event("pointerdown",{pageX:100}));
  x.$(x.dom.window.document).trigger(x.$.Event("pointermove",{pageX:140})).trigger(x.$.Event("pointerup",{pageX:140}));
  x.$(".ujg-esi-activity-table thead th[data-column='role']").trigger(x.$.Event("pointerdown",{pageX:100}));
  x.$(".ujg-esi-activity-table thead th[data-column='change']").trigger(x.$.Event("pointerup",{pageX:120}));
  const saved=JSON.parse(x.dom.window.localStorage.getItem("user-A:activity-layout"));
  assert.deepEqual(Array.from(saved.filters.role),["QA"]);
  assert.equal(saved.sort.key,"author");
  assert.ok(saved.widths.role>0);
  assert.ok(saved.order.indexOf("role")>saved.order.indexOf("change"));
  x.render();
  assert.equal(x.$(".ujg-esi-activity-table thead th[data-column='author']").attr("aria-sort"),"ascending");
  assert.equal(x.$(".ujg-esi-activity-table thead th").eq(1).attr("data-column"),"change");
});
test("transfer count opens every matching event with safe text and closes on Escape", t => {
  const report=fixture(), event=report.groups[0].events[1];
  event.summary="<img src=x onerror=alert(1)>";
  report.events=[event,{...event,id:"e4",at:"2026-09-24T14:00:00.000Z"}];
  report.transfers=[{from:"BE",to:"QA",count:2}];
  const x=setup(report); t.after(()=>x.dom.window.close());
  x.$(".ujg-esi-activity-transfer-matrix .has-transfer button").trigger("click");
  assert.equal(x.$(".ujg-esi-activity-event-popover [data-event-id]").length,2);
  assert.match(x.$(".ujg-esi-activity-event-popover").text(),/P-3/);
  assert.match(x.$(".ujg-esi-activity-event-popover").text(),/Ira/);
  assert.match(x.$(".ujg-esi-activity-event-popover").text(),/Bob.*Ann/);
  assert.equal(x.$(".ujg-esi-activity-event-popover img").length,0);
  x.$(".ujg-esi-activity-event-popover").trigger(x.$.Event("keydown",{key:"Escape"}));
  assert.equal(x.$(".ujg-esi-activity-event-popover").length,0);
});
test("column visibility and reset preserve at least one visible column", t => {
  const x=setup(fixture()); t.after(()=>x.dom.window.close());
  x.$("[aria-label='Столбцы журнала']").trigger("click");
  x.$(".ujg-esi-activity-column-option input").last().prop("checked",false).trigger("change");
  x.$(".ujg-esi-activity-columns-apply").trigger("click");
  assert.equal(x.$(".ujg-esi-activity-table thead th").length,4);
  x.$("[aria-label='Столбцы журнала']").trigger("click");
  x.$(".ujg-esi-activity-columns-reset").trigger("click");
  assert.equal(x.$(".ujg-esi-activity-table thead th").length,5);
});
test("resetting columns preserves applied filters and sort", t => {
  const x=setup(fixture()); t.after(()=>x.dom.window.close());
  selectFilter(x,"role",["QA"]);
  x.$("[data-activity-sort='time']").trigger("click");
  x.$("[aria-label='Столбцы журнала']").trigger("click");
  x.$(".ujg-esi-activity-columns-reset").trigger("click");
  const saved=JSON.parse(x.dom.window.localStorage.getItem("ujg-esi-state:activity-layout"));
  assert.deepEqual(saved.filters.role,["QA"]);
  assert.deepEqual(saved.sort,{key:"time",descending:true});
  assert.equal(x.$(".ujg-esi-activity-event").length,1);
  assert.equal(x.$(".ujg-esi-activity-table thead th").length,5);
});
test("empty Dynamics shows registry loading and error context", t => {
  const report=fixture(); report.groups=[]; report.events=[];
  const x=setup(report); t.after(()=>x.dom.window.close());
  x.state.rows=[]; x.state.registryLoading=true; x.render();
  assert.match(x.$(".ujg-esi-activity-empty").text(),/Загрузка.*Jira/);
  x.state.registryLoading=false; x.state.registryError="Jira недоступна"; x.render();
  assert.match(x.$(".ujg-esi-activity-empty").text(),/Jira недоступна/);
});
test("search retains selected values and Escape discards unfinished changes", t => {
  const x=setup(fixture()); t.after(()=>x.dom.window.close());
  selectFilter(x,"role",["QA"]);
  x.$("[data-activity-filter='role']").trigger("click");
  x.$(".ujg-esi-activity-filter-search").val("BE").trigger("input");
  assert.equal(x.$(".ujg-esi-activity-filter-option input:checked").closest("label").text(),"QA");
  x.$(".ujg-esi-filter-value-row:not([hidden]) input").prop("checked",true).trigger("change");
  x.$(".ujg-esi-activity-filter-menu").trigger(x.$.Event("keydown",{key:"Escape"}));
  assert.equal(x.$(".ujg-esi-activity-filter-menu").length,0);
  assert.equal(x.$(".ujg-esi-activity-event").length,1);
});
test("a new UI instance loads the saved activity layout for the same user", t => {
  const x=setup(fixture()); t.after(()=>x.dom.window.close());
  x.state.preferencesStorageKey="user-B"; x.render();
  selectFilter(x,"role",["QA"]);
  x.$("[data-activity-sort='author']").trigger("click");
  const second=x.modules._ujgESI_activityUi.create();
  second.render(x.$("#root"),x.state,{});
  assert.equal(x.$(".ujg-esi-activity-mount").last().find("[data-activity-filter='role']").hasClass("is-active"),true);
  assert.equal(x.$(".ujg-esi-activity-mount").last().find("th[data-column='author']").attr("aria-sort"),"ascending");
  x.state.preferencesStorageKey="user-C";
  second.render(x.$("#root"),x.state,{});
  assert.equal(x.$(".ujg-esi-activity-mount").last().find("[data-activity-filter='role']").hasClass("is-active"),false);
});
test("filter menu can remove an applied filter directly", t => {
  const x=setup(fixture()); t.after(()=>x.dom.window.close());
  selectFilter(x,"role",["QA"]);
  x.$("[data-activity-filter='role']").trigger("click");
  x.$(".ujg-esi-activity-filter-reset").trigger("click");
  assert.equal(x.$(".ujg-esi-activity-event").length,2);
  assert.equal(x.$("[data-activity-filter='role']").hasClass("is-active"),false);
});
test("redraw closes stale popovers and preserves journal horizontal scroll", t => {
  const x=setup(fixture()); t.after(()=>x.dom.window.close());
  x.$(".ujg-esi-activity-scroll").scrollLeft(120);
  x.$("[data-activity-filter='role']").trigger("click");
  assert.equal(x.$(".ujg-esi-activity-filter-menu").length,1);
  x.render();
  assert.equal(x.$(".ujg-esi-activity-filter-menu").length,0);
  assert.equal(x.$(".ujg-esi-activity-scroll").scrollLeft(),120);
  x.$("[data-activity-sort='author']").trigger("click");
  assert.equal(x.$(".ujg-esi-activity-scroll").scrollLeft(),120);
});
test("Clear and Apply stores an empty selection and shows zero journal events", t => {
  const x=setup(fixture()); t.after(()=>x.dom.window.close());
  x.$("[data-activity-filter='role']").trigger("click");
  x.$(".ujg-esi-activity-filter-clear").trigger("click");
  x.$(".ujg-esi-activity-filter-apply").trigger("click");
  assert.equal(x.$(".ujg-esi-activity-event").length,0);
  assert.equal(x.$("[data-activity-filter='role']").hasClass("is-active"),true);
  assert.deepEqual(Array.from(JSON.parse(x.dom.window.localStorage.getItem("ujg-esi-state:activity-layout")).filters.role),[]);
});
test("selected values survive an empty Jira load and apply when events arrive", t => {
  const report=fixture(), originalGroups=report.groups, x=setup(report); t.after(()=>x.dom.window.close());
  selectFilter(x,"role",["QA"]);
  report.groups=[]; report.events=[]; x.state.rows=[]; x.state.registryLoading=true;
  x.render();
  assert.equal(x.$("[data-activity-filter='role']").hasClass("is-active"),true);
  x.$("[data-activity-filter='role']").trigger("click");
  assert.equal(x.$(".ujg-esi-activity-selected-chip").text(),"QA");
  x.$(x.dom.window.document.body).trigger("click");
  report.groups=originalGroups; x.state.rows=[{id:"row"}]; x.state.registryLoading=false; x.render();
  assert.equal(x.$(".ujg-esi-activity-event").length,1);
});
test("Escape on focused count closes its popover without moving focus inside", t => {
  const x=setup(fixture()); t.after(()=>x.dom.window.close());
  const count=x.$(".ujg-esi-activity-transfer-matrix .has-transfer button");
  count.trigger("focus");
  assert.equal(x.$(".ujg-esi-activity-event-popover").length,1);
  x.$(x.dom.window.document).trigger(x.$.Event("keydown",{key:"Escape"}));
  assert.equal(x.$(".ujg-esi-activity-event-popover").length,0);
});
test("constructor and __proto__ are distinct filter candidate values", t => {
  const report=fixture(); report.groups[0].events[0].role="constructor"; report.groups[0].events[1].role="__proto__";
  const x=setup(report); t.after(()=>x.dom.window.close());
  x.$("[data-activity-filter='role']").trigger("click");
  const names=x.$(".ujg-esi-activity-filter-option").map(function() { return x.$(this).text().trim(); }).get();
  assert.deepEqual(names.sort(),["__proto__","constructor"]);
  selectFilter(x,"role",["__proto__"]);
  assert.equal(x.$(".ujg-esi-activity-event").length,1);
});
test("wide journal fills host and resize starts at rendered column width", t => {
  const x=setup(fixture()); t.after(()=>x.dom.window.close());
  x.$(".ujg-esi-activity-mount").css("width","1900px"); x.render();
  const table=x.$(".ujg-esi-activity-table");
  const role=x.$(".ujg-esi-activity-table col[data-column='role']");
  assert.equal(x.$(".ujg-esi-activity-table th[data-column='time'] .ujg-esi-activity-header-sort span").text(),"Время");
  assert.ok(parseFloat(x.$(".ujg-esi-activity-table col[data-column='time']").css("width"))>=100);
  assert.ok(parseFloat(table.css("width"))>=1900);
  const rendered=parseFloat(role.css("width"));
  assert.ok(rendered>240);
  x.$(".ujg-esi-activity-table thead th[data-column='role'] .ujg-esi-activity-column-resize").trigger(x.$.Event("pointerdown",{pageX:100}));
  x.$(x.dom.window.document).trigger(x.$.Event("pointermove",{pageX:140})).trigger(x.$.Event("pointerup",{pageX:140}));
  const stored=JSON.parse(x.dom.window.localStorage.getItem("ujg-esi-state:activity-layout"));
  assert.equal(stored.widths.role,Math.round(rendered+40));
});
test("popover stays inside document client width when a scrollbar is present", t => {
  const x=setup(fixture()); t.after(()=>x.dom.window.close());
  Object.defineProperty(x.dom.window.document.documentElement,"clientWidth",{configurable:true,value:1585});
  x.dom.window.innerWidth=1600;
  const anchor=x.$(".ujg-esi-activity-transfer-matrix .has-transfer button")[0];
  anchor.getBoundingClientRect=()=>({left:1500,right:1520,top:50,bottom:70,width:20,height:20});
  x.$(anchor).trigger("click");
  const box=x.$(".ujg-esi-activity-event-popover");
  assert.ok(parseFloat(box.css("left"))+parseFloat(box.css("width"))<=1585-12);
});
test("journal fits its mounted scroll viewport after a page scrollbar appears", t => {
  const x=setup(fixture()); t.after(()=>x.dom.window.close());
  Object.defineProperty(x.dom.window.HTMLElement.prototype,"clientWidth",{configurable:true,get() {
    return this.classList && this.classList.contains("ujg-esi-activity-scroll") ? 1557 : 0;
  }});
  x.$(".ujg-esi-activity-mount").css("width","1573px"); x.render();
  assert.ok(parseFloat(x.$(".ujg-esi-activity-table").css("width"))<=1557);
  x.state.preferencesStorageKey="custom-widths";
  x.dom.window.localStorage.setItem("custom-widths:activity-layout",JSON.stringify({widths:{time:100,remark:130,role:900,change:700,assignee:190,author:145}}));
  x.render();
  assert.ok(parseFloat(x.$(".ujg-esi-activity-table").css("width"))>1557);
});
test("status count drills into deduplicated human events with actual assignee", t => {
  const report=fixture(), status=report.groups[0].events[0];
  report.events=[status,{...status,id:status.id},report.groups[0].events[1]];
  const x=setup(report); t.after(()=>x.dom.window.close());
  x.$(".ujg-esi-activity-status-matrix .has-transfer button").trigger("click");
  const box=x.$(".ujg-esi-activity-event-popover");
  assert.equal(box.find("[data-event-id]").length,1);
  assert.match(box.text(),/Статус: Тестирование → Готово/);
  assert.match(box.text(),/Исполнитель: Bob/);
  assert.doesNotMatch(box.text(),/Исполнитель: Testing/);
});
test("hidden active filters remain accessible and reset-all preserves column layout", t => {
  const x=setup(fixture()); t.after(()=>x.dom.window.close());
  selectFilter(x,"role",["QA"]);
  x.$("[aria-label='Столбцы журнала']").trigger("click");
  x.$(".ujg-esi-activity-column-option").filter(function() { return x.$(this).text().includes("Тикет · Роль"); }).find("input").prop("checked",false).trigger("change");
  x.$(".ujg-esi-activity-columns-apply").trigger("click");
  assert.equal(x.$("th[data-column='role']").length,0);
  const hidden=x.$("[data-activity-hidden-filter='role']");
  assert.equal(hidden.length,1);
  assert.match(hidden.text(),/Тикет · Роль.*1/);
  hidden.trigger("click");
  assert.equal(x.$(".ujg-esi-activity-filter-menu").length,1);
  x.$(".ujg-esi-activity-filter-reset").trigger("click");
  assert.equal(x.$(".ujg-esi-activity-event").length,2);
  assert.equal(x.$("th[data-column='role']").length,0);
  selectFilter(x,"author",["Ira"]);
  assert.equal(x.$("[aria-label='Сбросить фильтры журнала']").length,1);
  x.$("[aria-label='Сбросить фильтры журнала']").trigger("click");
  assert.equal(x.$(".ujg-esi-activity-event").length,2);
  assert.equal(x.$("th[data-column='role']").length,0);
  assert.equal(x.$("[aria-label='Сбросить фильтры журнала']").length,0);
});
test("count keyboard opens actionable popup and Escape returns to anchor", t => {
  const x=setup(fixture()); t.after(()=>x.dom.window.close());
  const count=x.$(".ujg-esi-activity-transfer-matrix .has-transfer button");
  count.trigger("focus");
  assert.equal(x.dom.window.document.activeElement,count[0]);
  count.trigger(x.$.Event("keydown",{key:"Enter"}));
  assert.equal(x.dom.window.document.activeElement,x.$(".ujg-esi-activity-event-popover button").first()[0]);
  x.$(x.dom.window.document).trigger(x.$.Event("keydown",{key:"Escape"}));
  assert.equal(x.dom.window.document.activeElement,count[0]);
  count.trigger("blur").trigger("focus");
  count.trigger(x.$.Event("keydown",{key:"Tab"}));
  assert.equal(x.dom.window.document.activeElement,x.$(".ujg-esi-activity-event-popover button").first()[0]);
  x.$(x.dom.window.document).trigger(x.$.Event("keydown",{key:"Escape"}));
  count.trigger(x.$.Event("keydown",{key:" "}));
  assert.equal(x.dom.window.document.activeElement,x.$(".ujg-esi-activity-event-popover button").first()[0]);
  x.$(x.dom.window.document).trigger(x.$.Event("keydown",{key:"Escape"}));
  x.$(".ujg-esi-activity-date").trigger("focus");
  count.trigger("mouseenter");
  assert.equal(x.dom.window.document.activeElement,x.$(".ujg-esi-activity-date")[0]);
});
test("pointercancel discards pending column reorder", t => {
  const x=setup(fixture()); t.after(()=>x.dom.window.close());
  x.$("th[data-column='role']").trigger(x.$.Event("pointerdown",{pageX:100}));
  x.$(x.dom.window.document).trigger(x.$.Event("pointercancel",{pageX:120}));
  x.$("th[data-column='change']").trigger(x.$.Event("pointerup",{pageX:120}));
  const order=x.$(".ujg-esi-activity-table thead th[data-column]").map(function() { return x.$(this).attr("data-column"); }).get();
  assert.ok(order.indexOf("role")<order.indexOf("change"));
});
test("keyboard resize keeps focus on separator for successive arrows", t => {
  const x=setup(fixture()); t.after(()=>x.dom.window.close());
  const selector="th[data-column='role'] .ujg-esi-activity-column-resize";
  x.$(selector).trigger("focus").trigger(x.$.Event("keydown",{key:"ArrowRight"}));
  assert.equal(x.dom.window.document.activeElement,x.$(selector)[0]);
  x.$(selector).trigger(x.$.Event("keydown",{key:"ArrowRight"}));
  assert.equal(x.dom.window.document.activeElement,x.$(selector)[0]);
  assert.equal(JSON.parse(x.dom.window.localStorage.getItem("ujg-esi-state:activity-layout")).widths.role,260);
});
test("activity resize API and window resize fit in place without refreshing the report", t => {
  const x=setup(fixture()); t.after(()=>x.dom.window.close());
  let available=1580;
  Object.defineProperty(x.$(".ujg-esi-activity-scroll")[0],"clientWidth",{get:()=>available});
  const table=x.$(".ujg-esi-activity-table")[0], calls=x.calls.summarize.length;
  assert.equal(typeof x.ui.resize,"function");
  x.ui.resize(); assert.equal(parseFloat(x.$(table).css("width")),1580);
  available=1888; x.$(x.dom.window).trigger("resize");
  assert.equal(parseFloat(x.$(table).css("width")),1888);
  assert.equal(x.$(".ujg-esi-activity-table")[0],table);
  assert.equal(x.calls.summarize.length,calls);
  const width=parseFloat(x.$("col[data-column='role']").css("width"));
  x.$("th[data-column='role'] .ujg-esi-activity-column-resize").trigger(x.$.Event("keydown",{key:"ArrowRight"}));
  assert.equal(JSON.parse(x.dom.window.localStorage.getItem("ujg-esi-state:activity-layout")).widths.role,width+10);
});
test("activity observes current viewport size and replaces observation on redraw", t => {
  let observer;
  const x=setup(fixture(),window => {
    window.ResizeObserver=class {
      constructor(callback) { this.callback=callback; this.nodes=[]; observer=this; }
      observe(node) { this.nodes.push(node); }
      disconnect() { this.nodes=[]; }
    };
  }); t.after(()=>x.dom.window.close());
  assert.ok(observer);
  let available=1888;
  const scroll=x.$(".ujg-esi-activity-scroll")[0];
  Object.defineProperty(scroll,"clientWidth",{get:()=>available});
  assert.equal(observer.nodes[0],scroll);
  observer.callback([{target:scroll}]);
  assert.equal(parseFloat(x.$(".ujg-esi-activity-table").css("width")),1888);
  x.render();
  assert.equal(observer.nodes.length,1);
  assert.equal(observer.nodes[0],x.$(".ujg-esi-activity-scroll")[0]);
  assert.notEqual(observer.nodes[0],scroll);
});
