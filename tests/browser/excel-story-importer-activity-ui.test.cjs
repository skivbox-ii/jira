const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {JSDOM} = require("jsdom");
const jquery = require("jquery");

function setup(report) {
  const dom = new JSDOM('<div id="root"><div class="parent-toolbar">Registry · Activity</div></div>', {runScripts:"outside-only", url:"http://localhost"});
  const $ = jquery(dom.window), calls = {summarize:[], exports:[], refresh:0}, modules = {jquery:$};
  modules._ujgESI_activity = {
    summarize(rows, teams, options) { calls.summarize.push({rows,teams,options}); return Object.assign({}, report, {date:options.date}); },
    exportHtml(value, context) { calls.exports.push({value,context}); return '<!doctype html><title>Snapshot</title>'; }
  };
  dom.window.define = (name,deps,factory) => modules[name] = factory(...deps.map(dep => modules[dep]));
  for (const file of ["icons","activity-ui"]) dom.window.eval(fs.readFileSync(path.join(__dirname,"../../ujg-excel-story-importer-modules",file+".js"),"utf8"));
  const state = {rows:[{id:"row"}],teams:[],projectKey:"P",epicKey:"P-EPIC",viewMode:"jira",registryWarning:"Scope warning"};
  const services = {onLoadActivityHistory() { calls.refresh++; }};
  const ui = modules._ujgESI_activityUi.create();
  const render = () => ui.render($("#root"),state,services);
  render();
  return {dom,$,state,calls,render};
}
function fixture() {
  const events = [
    {id:"e1",at:"2026-09-24T12:00:00.000Z",kind:"status",issueKey:"P-2",role:"QA",from:"Testing",to:"Done",author:{label:"Ira"},assignee:{label:"Bob"}},
    {id:"e2",at:"2026-09-24T13:00:00.000Z",kind:"assignee",issueKey:"P-3",role:"BE",from:"Bob",to:"Ann",author:{label:"Ira"},assignee:{label:"Ann"},fromTeam:"BE",toTeam:"QA"}
  ];
  return {coverage:{complete:1,total:2,incomplete:1,warnings:["History incomplete"],isComplete:false},metrics:{changed:1,newRemarks:0,completed:null,reopened:null,events:2},balance:{startOpen:null,endOpen:null},transitions:[{from:"Testing",to:"Done",count:1}],transfers:[{from:"BE",to:"QA",count:1}],groups:[{id:"g1",remarkId:"744",key:"P-1",summary:"Remark",events}],events,teams:[]};
}
test("renders daily totals, unknown balances, current scope and grouped journal", t => {
  const x=setup(fixture()); t.after(()=>x.dom.window.close());
  const text=x.$("#root").text();
  assert.match(text,/Итоги за весь день/); assert.match(text,/История: 1 из 2/);
  assert.match(text,/Нет данных/); assert.match(text,/P-EPIC/); assert.match(text,/текущ/);
  assert.match(text,/Scope warning/); assert.match(text,/P-1/); assert.match(text,/P-2/);
  assert.match(text,/Testing/); assert.match(text,/Done/); assert.match(text,/Ira/);
  assert.equal(x.$(".ujg-esi-activity-event").length,2);
  assert.equal(x.calls.summarize[0].options.scopeWarning,"Scope warning");
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
  x.$("[data-activity-filter='role']").val("QA").trigger("change");
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
  assert.equal(x.$(".ujg-esi-activity-flow-arrow").length,1);
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
  x.$("[data-activity-filter='role']").val("QA").trigger("change");
  x.$("[aria-label='Скачать HTML']").trigger("click");
  assert.equal(x.calls.exports.length,1);
  assert.equal(x.calls.exports[0].value.events.length,1);
  assert.equal(x.calls.exports[0].value.groups[0].events.length,1);
  assert.equal(x.calls.exports[0].context.projectKey,"P");
  assert.equal(x.calls.exports[0].context.epicKey,"P-EPIC");
  assert.equal(x.calls.exports[0].context.filters.role,"QA");
  assert.equal(x.calls.exports[0].context.sort.key,"time");
  assert.equal(download.type,"text/html;charset=utf-8");
  assert.equal(x.$("img").length,0);
});
test("changing day clears journal filters that may be stale", t => {
  const x=setup(fixture()); t.after(()=>x.dom.window.close());
  x.$("[data-activity-filter='role']").val("QA").trigger("change");
  x.$("[aria-label='Следующий день']").trigger("click");
  assert.equal(x.$("[data-activity-filter='role']").val(),"");
  assert.equal(x.$(".ujg-esi-activity-event").length,2);
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
test("data refresh clears a filter value absent from the new report", t => {
  const report=fixture(), x=setup(report); t.after(()=>x.dom.window.close());
  x.$("[data-activity-filter='role']").val("QA").trigger("change");
  report.groups[0].events=report.groups[0].events.filter(event=>event.role!=="QA");
  x.render();
  assert.equal(x.$("[data-activity-filter='role']").val(),"");
  assert.equal(x.$(".ujg-esi-activity-event").length,1);
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
