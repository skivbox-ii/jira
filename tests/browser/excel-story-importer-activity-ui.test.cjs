const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {JSDOM} = require("jsdom");
const jquery = require("jquery");
const load = require("../helpers/load-amd-module");
const activityDir = path.join(__dirname,"../../ujg-excel-story-importer-modules");
const activity = load(path.join(activityDir,"activity.js"), {
  _ujgESI_teams:load(path.join(activityDir,"teams.js"),{}),
  _ujgESI_remarkId:load(path.join(activityDir,"remark-id.js"),{})
});

function setup(report, configureWindow) {
  const dom = new JSDOM('<div id="root"><div class="parent-toolbar">Registry · Activity</div></div>', {runScripts:"outside-only", url:"http://localhost"});
  if (configureWindow) configureWindow(dom.window);
  const $ = jquery(dom.window), calls = {summarize:[], exports:[], refresh:0}, modules = {jquery:$};
  modules._ujgESI_activity = {
    eventCategory:event => activity.eventCategory(event),
    summarize(rows, teams, options) { calls.summarize.push({rows,teams,options}); return Object.assign({}, report, {date:options.date}); },
    exportHtml(value, context) { calls.exports.push({value,context}); return '<!doctype html><title>Snapshot</title>'; },
    statusLabel(value) { return ({Testing:"Тестирование",Done:"Готово",Open:"Открыто"})[value] || value; },
    eventText(event) { return event.kind === "status" ? "Статус: " + this.statusLabel(event.from) + " → " + this.statusLabel(event.to) : event.kind === "assignee" ? "Исполнитель: " + event.from + " → " + event.to : "Создано"; }
  };
  dom.window.define = (name,deps,factory) => modules[name] = factory(...deps.map(dep => modules[dep]));
  for (const file of ["icons","activity-management-ui","activity-ui"]) dom.window.eval(fs.readFileSync(path.join(__dirname,"../../ujg-excel-story-importer-modules",file+".js"),"utf8"));
  const state = {rows:[{id:"row"}],teams:[],projectKey:"P",epicKey:"P-EPIC",viewMode:"jira",registryWarning:"Scope warning"};
  const services = {onLoadActivityHistory() { calls.refresh++; }};
  const ui = modules._ujgESI_activityUi.create();
  const render = () => ui.render($("#root"),state,services);
  render();
  return {dom,$,state,calls,render,modules,ui};
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
    {id:"e1",at:"2026-09-24T12:00:00.000Z",kind:"status",issueKey:"P-2",role:"QA",from:"Testing",to:"Done",author:{label:"Ira"},assignee:{label:"Bob"}},
    {id:"e2",at:"2026-09-24T13:00:00.000Z",kind:"assignee",issueKey:"P-3",role:"BE",from:"Bob",to:"Ann",author:{label:"Ira"},assignee:{label:"Ann"},fromTeam:"BE",toTeam:"QA"}
  ];
  return {coverage:{complete:1,total:2,incomplete:1,warnings:["History incomplete"],isComplete:false},metrics:{changed:1,newRemarks:0,completed:null,reopened:null,events:2},balance:{startOpen:null,endOpen:null},transitions:[{from:"Testing",to:"Done",count:1}],transfers:[{from:"BE",to:"QA",count:1}],groups:[{id:"g1",remarkId:"744",key:"P-1",summary:"Remark",events}],events,teams:[]};
}
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
test("change filter offers unique categories, not individual event descriptions", t => {
  const x=setup(categoryFixture()); t.after(()=>x.dom.window.close());
  x.$("[data-activity-filter='change']").trigger("click");
  const options=x.$(".ujg-esi-activity-filter-option").map(function() {return x.$(this).text().trim();}).get();
  assert.deepEqual(options.sort(),["Исполнитель","Описание","Оценка трудозатрат","Статус","Трудозатраты"].sort());
});
test("category multi-select filters all matching events while keeping details and totals", t => {
  const x=setup(categoryFixture()); t.after(()=>x.dom.window.close());
  selectFilter(x,"change",["Статус","Описание"]);
  assert.equal(x.$(".ujg-esi-activity-event").length,4);
  assert.match(x.$(".ujg-esi-activity-event").text(),/Статус: Тестирование → Готово/);
  assert.match(x.$(".ujg-esi-activity-event").text(),/Открыто → In Progress/);
  assert.equal(x.$("[data-metric='events'] strong").text(),"8");
  const saved=JSON.parse(x.dom.window.localStorage.getItem("ujg-esi-state:activity-layout"));
  assert.deepEqual(saved.filters.change,["Статус","Описание"]);
  const next=x.modules._ujgESI_activityUi.create(); next.render(x.$("#root"),x.state,{});
  assert.equal(x.$(".ujg-esi-activity-mount").last().find(".ujg-esi-activity-event").length,4);
});
test("worklog category groups records and spent time without including estimates", t => {
  const x=setup(categoryFixture()); t.after(()=>x.dom.window.close());
  selectFilter(x,"change",["Трудозатраты"]);
  assert.equal(x.$(".ujg-esi-activity-event").length,2);
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
  assert.equal(x.$(".ujg-esi-activity-event").length,2);
  const groups=report.groups;
  report.groups=[]; x.render();
  x.$("[data-activity-filter='change']").trigger("click");
  assert.equal(x.$(".ujg-esi-activity-selected-chip").text(),"Описание");
  x.$(".ujg-esi-activity-filter-apply").trigger("click");
  report.groups=groups; x.render();
  assert.equal(x.$(".ujg-esi-activity-event").length,2);
});
test("renders daily totals, unknown balances, current scope and grouped journal", t => {
  const x=setup(fixture()); t.after(()=>x.dom.window.close());
  const text=x.$("#root").text();
  assert.match(text,/Итоги за весь день/); assert.match(text,/История: 1 из 2/);
  assert.match(text,/Нет данных/); assert.match(text,/P-EPIC/); assert.match(text,/текущ/);
  assert.match(text,/Scope warning/); assert.match(text,/P-1/); assert.match(text,/P-2/);
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
test("partial daily metrics show observed lower bounds and compact unknown values", t => {
  const report=fixture(); report.asOf="2026-09-24T06:15:00.000Z"; report.end=Date.parse("2026-09-24T21:00:00.000Z");
  report.metrics={changed:null,newRemarks:null,completed:null,reopened:null,events:47};
  report.observed={changed:18,newRemarks:6};
  const x=setup(report); t.after(()=>x.dom.window.close());
  assert.match(x.$(".ujg-esi-activity-summary h3").text(),/Итоги на 09:15/);
  assert.equal(x.$("[data-metric='changed'] strong").text(),"≥18");
  assert.equal(x.$("[data-metric='newRemarks'] strong").text(),"≥6");
  assert.equal(x.$("[data-metric='completed'] strong").text(),"—");
  assert.equal(x.$("[data-metric='reopened'] strong").text(),"—");
  assert.match(x.$("[data-metric='changed'] strong").attr("title"),/итог может быть больше/);
  assert.match(x.$("[data-metric='completed'] strong").attr("title"),/Недостаточно/);
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
  x.$(".ujg-esi-activity-date").val("2026-09-24").trigger("change");
  x.$("[aria-label='Предыдущий день']").trigger("click");
  assert.equal(x.calls.summarize.at(-1).options.date,"2026-09-23");
  x.render(); assert.equal(x.$(".ujg-esi-activity-date").val(),"2026-09-23");
  x.$("[aria-label='Следующий день']").trigger("click");
  assert.equal(x.calls.summarize.at(-1).options.date,"2026-09-24");
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
  assert.equal(x.$(".ujg-esi-activity-coverage details").length,1);
  assert.match(x.$(".ujg-esi-activity-coverage summary").text(),/3 предупреждения/);
  assert.match(x.$(".ujg-esi-activity-warning-list").text(),/Third warning/);
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
  const x=setup(report); t.after(()=>x.dom.window.close());
  let download;
  x.dom.window.URL.createObjectURL = blob => { download=blob; return "blob:activity-test"; };
  x.dom.window.URL.revokeObjectURL = () => {};
  x.dom.window.HTMLAnchorElement.prototype.click = function() { assert.equal(this.download,"activity-" + x.$(".ujg-esi-activity-date").val() + ".html"); };
  selectFilter(x,"role",["QA"]);
  x.$("[aria-label='Скачать HTML']").trigger("click");
  assert.equal(x.calls.exports.length,1);
  assert.equal(x.calls.exports[0].value.events.length,1);
  assert.equal(x.calls.exports[0].value.groups[0].events.length,1);
  assert.equal(x.calls.exports[0].context.projectKey,"P");
  assert.equal(x.calls.exports[0].context.epicKey,"P-EPIC");
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
  assert.equal(x.$(".ujg-esi-activity-filter-option").text().trim(),"Bob");
  assert.equal(x.$(".ujg-esi-activity-filter-option input").prop("checked"),false);
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
  assert.equal(x.$(".ujg-esi-activity-event").length,2);
  assert.equal(x.$("[data-activity-filter='role']").hasClass("is-active"),true);
  x.$("[data-activity-filter='role']").trigger("click");
  assert.equal(x.$(".ujg-esi-activity-selected-chip").length,2);
  assert.equal(x.$(".ujg-esi-activity-filter-option.is-selected").length,0);
  x.$(".ujg-esi-activity-filter-search").val("BE").trigger("input");
  assert.equal(x.$(".ujg-esi-activity-selected-chip").length,2);
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
  assert.equal(x.$(".ujg-esi-activity-selected-chip").length,1);
  x.$(".ujg-esi-activity-filter-option input").prop("checked",true).trigger("change");
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
