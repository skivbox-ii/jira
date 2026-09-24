const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {JSDOM} = require("jsdom");
const jquery = require("jquery");

function setup(realRenderer = false) {
  const dom = new JSDOM('<button id="anchor">Open</button>', {runScripts:"outside-only",url:"http://localhost"});
  const $ = jquery(dom.window), calls = [], pending = [], modules = {jquery:$};
  modules._ujgESI_activityAi = {
    prepare(report,scope) { return {scopeKey:[scope.projectKey,scope.epicKey,scope.viewMode,report.date].join("/"),fingerprint:report.fingerprint,date:report.date,asOf:report.asOf,coverage:report.coverage,eventCount:report.eventCount,parts:[{}]}; },
    run(plan,request,options) { calls.push({plan,options}); return new Promise((resolve,reject) => pending.push({resolve,reject,options})); }
  };
  modules._ujgESI_activityMarkdown = {render(value) { return $("<p/>").text(value); }};
  dom.window.define = (name,deps,factory) => modules[name] = factory(...deps.map(dep => modules[dep]));
  dom.window.eval(fs.readFileSync(path.join(__dirname,"../../ujg-excel-story-importer-modules/icons.js"),"utf8"));
  if (realRenderer) {
    modules._ujgESI_marked = require("../../vendor/marked-16.4.2.umd.js");
    dom.window.eval(fs.readFileSync(path.join(__dirname,"../../ujg-excel-story-importer-modules/activity-markdown.js"),"utf8"));
  }
  dom.window.eval(fs.readFileSync(path.join(__dirname,"../../ujg-excel-story-importer-modules/activity-ai-ui.js"),"utf8"));
  const ui = modules._ujgESI_activityAiUi.create();
  const requests = [];
  const services = {onActivityLlmRequest(request) { requests.push(request); return Promise.resolve({text:"answer"}); }};
  const report = (fingerprint="a",date="2026-09-24") => ({fingerprint,date,asOf:"2026-09-24T09:00:00Z",coverage:{complete:1,total:2,isComplete:false},eventCount:3});
  const state = (projectKey="P",viewMode="jira") => ({projectKey,epicKey:"P-1",viewMode,baseUrl:"https://jira.example",preferencesStorageKey:"user"});
  ui.update(report(),state(),services);
  return {dom,$,ui,calls,pending,requests,report,state,services,flush:() => new Promise(resolve => setImmediate(resolve))};
}

test("opening report shows cutoff and coverage without requesting; explicit generation reports progress", async t => {
  const x=setup(); t.after(() => { x.ui.destroy(); x.dom.window.close(); });
  x.ui.open(x.$("#anchor")[0]);
  assert.equal(x.calls.length,0);
  assert.equal(x.requests.length,0);
  assert.match(x.$(".ujg-esi-ai-dialog").text(),/24\.09\.2026|2026-09-24/);
  assert.match(x.$(".ujg-esi-ai-dialog").text(),/1.*2/);
  x.$(".ujg-esi-ai-generate").trigger("click");
  await x.flush();
  assert.equal(x.calls.length,1);
  x.pending[0].options.onProgress({completed:1,total:2});
  assert.match(x.$(".ujg-esi-ai-progress").text(),/1.*2/);
  x.pending[0].resolve({markdown:"Отчёт",completedParts:2,totalParts:2,eventCount:3});
  await x.flush();
  assert.match(x.$(".ujg-esi-ai-report").text(),/Отчёт/);
});

test("question uses report snapshot and history; failure retains draft and prior answer", async t => {
  const x=setup(); t.after(() => { x.ui.destroy(); x.dom.window.close(); });
  x.ui.open(x.$("#anchor")[0]);
  x.$(".ujg-esi-ai-generate").trigger("click");
  await x.flush();
  x.pending[0].resolve({markdown:"Отчёт",completedParts:1,totalParts:1}); await x.flush();
  x.$(".ujg-esi-ai-question").val("Что закрыто?");
  x.$(".ujg-esi-ai-ask").trigger("click");
  await x.flush();
  assert.equal(x.calls[1].plan,x.calls[0].plan);
  assert.equal(x.calls[1].options.question,"Что закрыто?");
  assert.deepEqual(JSON.parse(JSON.stringify(x.calls[1].options.history)),[{question:"Исходный отчёт по этому срезу",answer:"Отчёт"}]);
  x.pending[1].options.onProgress({phase:"context",completed:1,total:3});
  assert.equal(x.$(".ujg-esi-ai-progress").text(),"Подготовка контекста: 1 / 3");
  x.pending[1].options.onProgress({phase:"answer",completed:0,total:2});
  assert.equal(x.$(".ujg-esi-ai-progress").text(),"Обработано частей: 0 / 2");
  x.pending[1].resolve({markdown:"Закрыто P-2",completedParts:1,totalParts:1}); await x.flush();
  x.$(".ujg-esi-ai-question").val("А QA?");
  x.$(".ujg-esi-ai-ask").trigger("click");
  await x.flush();
  assert.deepEqual(JSON.parse(JSON.stringify(x.calls[2].options.history)),[
    {question:"Исходный отчёт по этому срезу",answer:"Отчёт"},
    {question:"Что закрыто?",answer:"Закрыто P-2"}
  ]);
  x.pending[2].reject(new Error("Нет настроек")); await x.flush();
  assert.equal(x.$(".ujg-esi-ai-question").val(),"А QA?");
  assert.match(x.$(".ujg-esi-ai-dialog").text(),/Закрыто P-2/);
  assert.match(x.$(".ujg-esi-ai-error").text(),/Нет настроек/);
  x.$(".ujg-esi-ai-ask").trigger("click");
  await x.flush();
  assert.equal(x.calls[3].options.question,"А QA?");
});

test("scope and refreshed snapshot isolate late responses and mark existing report stale", async t => {
  const x=setup(); t.after(() => { x.ui.destroy(); x.dom.window.close(); });
  x.ui.open(x.$("#anchor")[0]);
  x.$(".ujg-esi-ai-generate").trigger("click");
  await x.flush();
  x.pending[0].resolve({markdown:"Old",completedParts:1,totalParts:1}); await x.flush();
  x.ui.update(x.report("b"),x.state(),x.services);
  assert.match(x.$(".ujg-esi-ai-stale").text(),/устарел/i);
  x.$(".ujg-esi-ai-generate").trigger("click");
  await x.flush();
  x.ui.update(x.report("c"),x.state("OTHER"),x.services);
  x.pending[1].resolve({markdown:"Late",completedParts:1,totalParts:1}); await x.flush();
  assert.doesNotMatch(x.$(".ujg-esi-ai-dialog").text(),/Late|Old/);
  assert.equal(x.$(".ujg-esi-ai-question").val(),"");
});

for (const scope of ["project","date"]) test(`${scope} change clears the visible question draft and does not restore it on reopen`, async t => {
  const x=setup(); t.after(() => { x.ui.destroy(); x.dom.window.close(); });
  x.ui.open(x.$("#anchor")[0]);
  x.$(".ujg-esi-ai-generate").trigger("click"); await x.flush();
  x.pending[0].resolve({markdown:"Old report",completedParts:1,totalParts:1}); await x.flush();
  x.$(".ujg-esi-ai-question").val("Question for the old scope").trigger("input");
  x.ui.update(scope === "date" ? x.report("b","2026-09-23") : x.report(),scope === "project" ? x.state("OTHER") : x.state(),x.services);
  assert.equal(x.$(".ujg-esi-ai-question").val(),"");
  assert.equal(x.$(".ujg-esi-ai-ask").prop("disabled"),true);
  x.ui.dismiss(); x.ui.open(x.$("#anchor")[0]);
  assert.equal(x.$(".ujg-esi-ai-question").val(),"");
});

test("regeneration sends no old conversation while retaining it for display until success", async t => {
  const x=setup(); t.after(() => { x.ui.destroy(); x.dom.window.close(); });
  x.ui.open(x.$("#anchor")[0]);
  x.$(".ujg-esi-ai-generate").trigger("click"); await x.flush();
  x.pending[0].resolve({markdown:"Old report",completedParts:1,totalParts:1}); await x.flush();
  x.$(".ujg-esi-ai-question").val("Old question").trigger("input");
  x.$(".ujg-esi-ai-ask").trigger("click"); await x.flush();
  x.pending[1].resolve({markdown:"Old answer",completedParts:1,totalParts:1}); await x.flush();
  x.ui.update(x.report("new"),x.state(),x.services);
  x.$(".ujg-esi-ai-generate").trigger("click"); await x.flush();
  assert.equal(x.calls[2].plan.fingerprint,"new");
  assert.deepEqual(JSON.parse(JSON.stringify(x.calls[2].options.history)),[]);
  assert.match(x.$(".ujg-esi-ai-report").text(),/Old report/);
  assert.match(x.$(".ujg-esi-ai-history").text(),/Old question.*Old answer/);
  x.pending[2].reject(new Error("Unavailable")); await x.flush();
  assert.match(x.$(".ujg-esi-ai-history").text(),/Old question.*Old answer/);
  x.$(".ujg-esi-ai-generate").trigger("click"); await x.flush();
  assert.deepEqual(JSON.parse(JSON.stringify(x.calls[3].options.history)),[]);
  x.pending[3].resolve({markdown:"New report",completedParts:1,totalParts:1}); await x.flush();
  assert.equal(x.$(".ujg-esi-ai-history").text(),"");
  assert.match(x.$(".ujg-esi-ai-report").text(),/New report/);
});

test("only a successful question scrolls content to the latest exchange", async t => {
  const x=setup(); t.after(() => { x.ui.destroy(); x.dom.window.close(); });
  x.ui.open(x.$("#anchor")[0]);
  const content=x.$(".ujg-esi-ai-content")[0];
  Object.defineProperty(content,"scrollHeight",{get:()=>1200});
  x.$(".ujg-esi-ai-generate").trigger("click"); await x.flush();
  x.pending[0].resolve({markdown:"Initial report",completedParts:1,totalParts:1}); await x.flush();
  assert.equal(content.scrollTop,0,"the first report opens at the top");
  content.scrollTop=80;
  x.$(".ujg-esi-ai-question").val("Question").trigger("input");
  x.$(".ujg-esi-ai-ask").trigger("click"); await x.flush();
  x.pending[1].options.onProgress({completed:1,total:2});
  x.ui.update(x.report(),x.state(),x.services);
  assert.equal(content.scrollTop,80,"progress and passive refresh preserve scroll");
  x.pending[1].resolve({markdown:"Latest answer",completedParts:2,totalParts:2}); await x.flush();
  assert.equal(content.scrollTop,1200,"the newly rendered exchange is brought into view");
  content.scrollTop=40;
  x.ui.update(x.report(),x.state(),x.services);
  assert.equal(content.scrollTop,40,"later background refresh does not scroll to the answer");
  x.$(".ujg-esi-ai-question").val("Another question").trigger("input");
  x.$(".ujg-esi-ai-ask").trigger("click"); await x.flush();
  x.pending[2].reject(new Error("Unavailable")); await x.flush();
  assert.equal(content.scrollTop,40,"failed questions preserve the reading position");
});

test("Escape restores overflow and focus; Tab stays in dialog", t => {
  const x=setup(); t.after(() => { x.ui.destroy(); x.dom.window.close(); });
  x.dom.window.document.body.style.overflow="scroll";
  x.ui.open(x.$("#anchor")[0]);
  assert.equal(x.dom.window.document.body.style.overflow,"hidden");
  const dialog=x.$(".ujg-esi-ai-dialog");
  assert.equal(dialog.attr("aria-modal"),"true");
  const last=dialog.find("button").last()[0]; last.focus();
  x.$(last).trigger(x.$.Event("keydown",{key:"Tab"}));
  assert.equal(x.dom.window.document.activeElement,dialog.find("button").first()[0]);
  dialog.trigger(x.$.Event("keydown",{key:"Escape"}));
  assert.equal(x.$(".ujg-esi-ai-dialog").length,0);
  assert.equal(x.dom.window.document.body.style.overflow,"scroll");
  assert.equal(x.dom.window.document.activeElement,x.$("#anchor")[0]);
});

test("Escape after a Dynamics redraw returns focus to the newly mounted report command", t => {
  const dom=new JSDOM('<div id="root"></div>',{runScripts:"outside-only",url:"http://localhost"});
  const $=jquery(dom.window), modules={jquery:$,_ujgESI_marked:require("../../vendor/marked-16.4.2.umd.js")};
  dom.window.define=(name,deps,factory)=>modules[name]=factory(...deps.map(dep=>modules[dep]));
  for (const file of ["teams","remark-id","activity","icons","activity-management-ui","activity-ai","activity-markdown","activity-ai-ui","activity-ui"])
    dom.window.eval(fs.readFileSync(path.join(__dirname,"../../ujg-excel-story-importer-modules",file+".js"),"utf8"));
  const ui=modules._ujgESI_activityUi.create(); t.after(()=>{ui.destroy();dom.window.close();});
  const state={rows:[],teams:[],projectKey:"P",epicKey:"P-1",viewMode:"jira"};
  ui.render($("#root"),state,{});
  const oldCommand=$(".ujg-esi-activity-ai-command")[0];
  $(oldCommand).trigger("click");
  ui.render($("#root"),state,{});
  const newCommand=$(".ujg-esi-activity-ai-command")[0];
  assert.notEqual(newCommand,oldCommand);
  assert.equal(dom.window.document.contains(oldCommand),false);
  $(".ujg-esi-activity-ai-dialog").trigger($.Event("keydown",{key:"Escape"}));
  assert.equal(dom.window.document.activeElement,newCommand);
  assert.equal($(newCommand).attr("aria-expanded"),"false");
});

test("team changes repaint the same Markdown while equivalent context keeps rendered nodes", async t => {
  const x=setup(true); t.after(() => { x.ui.destroy(); x.dom.window.close(); });
  const state={...x.state(),teams:[{roles:["QA"],color:"#123456"}]};
  x.ui.update(x.report(),state,x.services);
  x.ui.open(x.$("#anchor")[0]);
  x.$(".ujg-esi-ai-generate").trigger("click"); await x.flush();
  x.pending[0].resolve({markdown:"[QA] P-2",completedParts:1,totalParts:1}); await x.flush();
  const role=x.$(".ujg-esi-ai-report .role-qa")[0];
  assert.equal(x.$(role).css("border-color"),"rgb(18, 52, 86)");
  x.ui.update(x.report(),JSON.parse(JSON.stringify(state)),x.services);
  assert.equal(x.$(".ujg-esi-ai-report .role-qa")[0],role);
  state.teams[0].color="#654321";
  x.ui.update(x.report(),state,x.services);
  assert.equal(x.$(".ujg-esi-ai-report .role-qa").css("border-color"),"rgb(101, 67, 33)");
  assert.match(x.$(".ujg-esi-ai-report").text(),/\[QA\] P-2/);
});

test("failed regeneration keeps previous answer stale and preserves question draft", async t => {
  const x=setup(); t.after(() => { x.ui.destroy(); x.dom.window.close(); });
  x.ui.open(x.$("#anchor")[0]);
  x.$(".ujg-esi-ai-generate").trigger("click"); await x.flush();
  x.pending[0].resolve({markdown:"Previous",completedParts:1,totalParts:1}); await x.flush();
  x.$(".ujg-esi-ai-question").val("Follow up").trigger("input");
  x.ui.dismiss(); x.ui.open(x.$("#anchor")[0]);
  assert.equal(x.$(".ujg-esi-ai-question").val(),"Follow up");
  x.ui.update(x.report("new"),x.state(),x.services);
  x.$(".ujg-esi-ai-generate").trigger("click"); await x.flush();
  x.pending[1].reject(Object.assign(new Error("part failed"),{markdown:"Partial text"})); await x.flush();
  assert.match(x.$(".ujg-esi-ai-stale").text(),/устарел/i);
  assert.match(x.$(".ujg-esi-ai-report").text(),/Previous/);
  assert.match(x.$(".ujg-esi-ai-partial").text(),/Неполный.*Partial text/);
  assert.equal(x.$(".ujg-esi-ai-question").val(),"Follow up");
  assert.equal(x.$(".ujg-esi-ai-ask").prop("disabled"),true);
});

test("stop cancels remaining work and keeps dialog usable", async t => {
  const x=setup(); t.after(() => { x.ui.destroy(); x.dom.window.close(); });
  x.ui.open(x.$("#anchor")[0]);
  x.$(".ujg-esi-ai-generate").trigger("click"); await x.flush();
  x.$(".ujg-esi-ai-stop").trigger("click");
  assert.equal(x.pending[0].options.isCancelled(),true);
  x.pending[0].resolve({markdown:"Late",completedParts:1,totalParts:1}); await x.flush();
  assert.doesNotMatch(x.$(".ujg-esi-ai-report").text(),/Late/);
  assert.equal(x.$(".ujg-esi-ai-generate").prop("disabled"),false);
});

test("suspend closes the dialog and cancels pending work when leaving Dynamics", async t => {
  const x=setup(); t.after(() => { x.ui.destroy(); x.dom.window.close(); });
  x.ui.open(x.$("#anchor")[0]);
  x.$(".ujg-esi-ai-generate").trigger("click"); await x.flush();
  x.ui.suspend();
  assert.equal(x.pending[0].options.isCancelled(),true);
  assert.equal(x.$(".ujg-esi-activity-ai-dialog").length,0);
  x.pending[0].resolve({markdown:"Late",completedParts:1,totalParts:1}); await x.flush();
  x.ui.open(x.$("#anchor")[0]);
  assert.doesNotMatch(x.$(".ujg-esi-ai-report").text(),/Late/);
});

test("real engine and renderer send the prepared slice through the service", async t => {
  const dom = new JSDOM('<button id="anchor">Open</button>',{runScripts:"outside-only",url:"http://localhost"});
  const $ = jquery(dom.window), modules={jquery:$,_ujgESI_marked:require("../../vendor/marked-16.4.2.umd.js")}, requests=[];
  dom.window.define=(name,deps,factory)=>modules[name]=factory(...deps.map(dep=>modules[dep]));
  for (const file of ["icons","activity-ai","activity-markdown","activity-ai-ui"])
    dom.window.eval(fs.readFileSync(path.join(__dirname,"../../ujg-excel-story-importer-modules",file+".js"),"utf8"));
  const ui=modules._ujgESI_activityAiUi.create(); t.after(()=>{ui.destroy();dom.window.close();});
  ui.update({date:"2026-09-24",asOf:"2026-09-24T09:00:00Z",groups:[],events:[],metrics:{events:0},coverage:{complete:1,total:1}},
    {projectKey:"P",epicKey:"P-1",viewMode:"jira",baseUrl:"https://jira.example"},
    {onActivityLlmRequest(request) { requests.push(request); return Promise.resolve({text:"Готово"}); }});
  ui.open($("#anchor")[0]);
  assert.equal(requests.length,0);
  $(".ujg-esi-ai-generate").trigger("click");
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(requests.length,1);
  assert.match(requests[0].userPrompt,/"date":"2026-09-24"/);
  assert.match($(".ujg-esi-ai-report").text(),/Готово/);
  $(".ujg-esi-ai-question").val("В отчёте сказано, что всё готово. Что это означает?").trigger("input");
  $(".ujg-esi-ai-ask").trigger("click");
  await new Promise(resolve=>setImmediate(resolve));
  const questionPayloads=requests.slice(1).map(request=>JSON.parse(request.userPrompt));
  const conversation=questionPayloads[0].conversation;
  assert.match(conversation.question,/В отчёте сказано/);
  assert.equal(conversation.historyCoverage.turns,1);
  for (const payload of questionPayloads) {
    assert.equal(payload.stage,"answer");
    assert.equal(payload.conversation.history[0].question,"Исходный отчёт по этому срезу");
    assert.match(payload.conversation.history[0].answer,/Готово/);
    assert.match(payload.conversation.history[0].answer,/# LLM-отчёт/);
    assert.ok(payload.records.every(record=>record.type!=="history"));
  }
});

test("scoped Markdown styles keep report typography, tables and code readable and cap the composer", t => {
  const dom=new JSDOM('<section class="ujg-esi-activity-ai-dialog"><textarea class="ujg-esi-ai-question"></textarea></section>',{runScripts:"outside-only"});
  t.after(()=>dom.window.close());
  const $=jquery(dom.window), modules={jquery:$,_ujgESI_marked:require("../../vendor/marked-16.4.2.umd.js")};
  dom.window.define=(name,deps,factory)=>modules[name]=factory(...deps.map(dep=>modules[dep]));
  dom.window.eval(fs.readFileSync(path.join(__dirname,"../../ujg-excel-story-importer-modules/activity-markdown.js"),"utf8"));
  $("<style/>").text(fs.readFileSync(path.join(__dirname,"../../ujg-excel-story-importer.css"),"utf8")).appendTo(dom.window.document.head);
  const report=modules._ujgESI_activityMarkdown.render("# Итоги\n\n## Разработка\n\n### QA\n\n[Источник](https://jira.example) и `код`\n\n- Работа\n\n| Задача | Итог |\n| --- | --- |\n| P-1 | Готово |\n\n```text\nlong code line\n```",{});
  $(".ujg-esi-activity-ai-dialog").append(report);
  const style=selector=>dom.window.getComputedStyle(report.find(selector)[0]);
  assert.equal(style("h1").fontSize,"20px");
  assert.equal(style("h2").fontSize,"17px");
  assert.equal(style("h3").fontSize,"15px");
  assert.equal(dom.window.getComputedStyle(report[0]).lineHeight,"1.5");
  assert.equal(style("p").marginBottom,"8px");
  assert.equal(style("ul").marginBottom,"8px");
  assert.equal(style("table").borderCollapse,"collapse");
  assert.equal(style("table").minWidth,"420px");
  assert.equal(style("th").padding,"6px");
  assert.equal(style("td").borderTopStyle,"solid");
  assert.equal(style("th").backgroundColor,"rgb(245, 248, 251)");
  assert.equal(style(".ujg-esi-activity-markdown-table-wrap").overflowX,"auto");
  assert.equal(style("a").color,"rgb(7, 95, 196)");
  assert.match(style("code").fontFamily,/monospace/);
  assert.equal(style("pre").overflowX,"auto");
  assert.equal(dom.window.getComputedStyle($(".ujg-esi-ai-question")[0]).maxHeight.replace(/\s/g,""),"min(180px,25vh)");
});
