const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");
const jquery = require("jquery");
const root = path.join(__dirname, "../..");

function setup() {
  const dom = new JSDOM('<div class="ujg-excel-story-importer"></div>', { runScripts: "outside-only", url: "http://localhost" });
  const w = dom.window;
  w.scrollTo = () => {};
  const $ = jquery(w), modules = { jquery: $ };
  w.define = (name, deps, factory) => { modules[name] = factory(...deps.map(dep => modules[dep])); };
  for (const file of ["remark-id", "registry", "icons", "grid", "rendering"]) w.eval(fs.readFileSync(path.join(root, "ujg-excel-story-importer-modules/" + file + ".js"), "utf8"));
  const calls = [];
  const state = {
    projectKey: "P", projects: [{ key: "P", name: "Project" }], epics: [], baseUrl: "https://jira.example.test",
    sourceFileName: "remarks.xlsx", sheetNames: ["Sheet"], parseMeta: { sheetName: "Sheet", headerRowNumber: 2 },
    rows: [
      { id: "Sheet:3", excelRowNumber: 3, summary: "New remark", status: "ready", sourceColumns: { "№": "815" } },
      { id: "Sheet:4", excelRowNumber: 4, summary: "Existing remark", jiraKey: "P-10", alreadyLinked: true, sourceColumns: { "№": "744", "Ответственный": "Owner" },
        storyDetails: { key: "P-10", status: "Done", assignee: "Anna" }, childStatuses: [
          { key: "P-11", summary: "[BE] Work", role: "BE", status: "Open", assignee: "Bob" },
          { key: "P-12", summary: "[QA] Test", role: "QA", status: "Done", assignee: "Anna" }
        ] },
      { id: "Sheet:5", excelRowNumber: 5, summary: "Partially created", status: "partial", jiraKey: "P-20", createdKey: "P-20", sourceColumns: { "№": "820" }, errors: ["QA failed"] }
    ]
  };
  modules._ujgESI_rendering.init($(".ujg-excel-story-importer"), {
    onCreateRow: index => calls.push(["create", index]), onRowImproveRemark: index => calls.push(["correct", index]),
    onAddChildTasks: index => calls.push(["children", index]),
    onDialogAssigneeFocus: target => calls.push(["owner", target]),
    onViewModeChange: mode => calls.push(["mode", mode]), onLoadRegistry: () => calls.push(["load"])
  });
  modules._ujgESI_rendering.render(state);
  return { dom, $, state, calls, render: () => modules._ujgESI_rendering.render(state) };
}
function option($, text) { return $(".ujg-esi-filter-option").filter(function() { return $(this).text() === text; }).find("input"); }

test("new remarks offer creation, existing and partial rows never offer duplicate creation", t => {
  const { dom, $, calls } = setup(); t.after(() => dom.window.close());
  assert.equal($(".ujg-esi-create-row").length, 1);
  $(".ujg-esi-create-row").trigger("click");
  assert.deepEqual(calls, [["create", 0]]);
  $("tr[data-key='P-20'] .ujg-esi-row-ai").trigger("click");
  assert.deepEqual(calls[1], ["correct", 2]);
  assert.equal($(".ujg-esi-error-details").length, 1);
  const link = $("tr[data-key='P-11'] .ujg-esi-cell-key a");
  assert.equal(link.attr("href"), "https://jira.example.test/browse/P-11");
  assert.equal(link.attr("target"), "_blank");
  assert.match(link.attr("rel"), /noopener/);
});

test("header checklist applies to children, cancel preserves view and reset restores rows", t => {
  const { dom, $ } = setup(); t.after(() => dom.window.close());
  $("[data-filter='status']").trigger("click");
  $(".ujg-esi-filter-all input").prop("checked", false).trigger("change");
  option($, "Open").prop("checked", true).trigger("change");
  $(".ujg-esi-filter-actions button").last().trigger("click");
  assert.equal($(".ujg-esi-parent-row").length, 3);
  $("[data-filter='status']").trigger("click");
  $(".ujg-esi-filter-all input").prop("checked", false).trigger("change");
  option($, "Open").prop("checked", true).trigger("change");
  $(".ujg-esi-filter-apply").trigger("click");
  assert.equal($(".ujg-esi-parent-row").length, 1);
  assert.equal($("tr[data-key='P-10']").hasClass("is-context"), true);
  assert.equal($("tr[data-key='P-11']").length, 1);
  assert.equal($("tr[data-key='P-12']").length, 0);
  $("[aria-label='Сбросить все фильтры']").trigger("click");
  assert.equal($(".ujg-esi-parent-row").length, 3);
});

test("selected assignees remain removable while searching and Escape dismisses", t => {
  const { dom, $ } = setup(); t.after(() => dom.window.close());
  $("[data-filter='assignee']").trigger("click");
  $(".ujg-esi-filter-all input").prop("checked", false).trigger("change");
  option($, "Bob").prop("checked", true).trigger("change");
  $(".ujg-esi-filter-search").val("Anna").trigger("input");
  assert.equal(option($, "Bob").length, 1);
  assert.equal($(".ujg-esi-selected-chip").text(), "Bob");
  $(".ujg-esi-selected-chip").trigger("click");
  assert.equal(option($, "Bob").length, 0);
  $(".ujg-esi-filter-search").trigger($.Event("keydown", { key: "Escape" }));
  assert.equal($(".ujg-esi-grid-menu").length, 0);
});

test("sorting does not remap source actions and loading a new workbook clears old filters", t => {
  const { dom, $, state, calls, render } = setup(); t.after(() => dom.window.close());
  $("[data-filter='remarkId']").trigger("click");
  $(".ujg-esi-menu-command").first().trigger("click");
  assert.equal($(".ujg-esi-parent-row").first().attr("data-key"), "P-10");
  $(".ujg-esi-create-row").trigger("click");
  assert.deepEqual(calls, [["create", 0]]);
  $("[data-filter='status']").trigger("click");
  $(".ujg-esi-filter-all input").prop("checked", false).trigger("change");
  $(".ujg-esi-filter-apply").trigger("click");
  assert.equal($(".ujg-esi-parent-row").length, 0);
  state.rows = state.rows.slice(); render();
  assert.equal($(".ujg-esi-parent-row").length, 3);
});

function applyFilter($, key, value) {
  $("[data-filter='" + key + "']").trigger("click");
  $(".ujg-esi-filter-all input").prop("checked", false).trigger("change");
  option($, value).prop("checked", true).trigger("change");
  $(".ujg-esi-filter-apply").trigger("click");
}

test("header buttons toggle sorting and priority filtering preserves matching child context", t => {
  const {dom,$,state,render} = setup(); t.after(() => dom.window.close());
  state.rows[0].sourceColumns["Приоритет"] = "Средний";
  state.rows[1].storyDetails.priority = "Низкий";
  state.rows[1].childStatuses[0].priority = "Высокий";
  state.rows[1].childStatuses[1].priority = "Низкий";
  state.rows[2].sourceColumns["Приоритет"] = "Высокий";
  render();
  assert.equal($("button[data-sort]").length, $("button[data-filter]").length);
  $("[data-sort='priority']").trigger("click");
  assert.equal($(".ujg-esi-parent-row").first().attr("data-key"), "P-20");
  assert.equal($("[data-sort='priority']").closest("th").attr("aria-sort"), "descending");
  assert.equal(dom.window.document.activeElement, $("[data-sort='priority']")[0]);
  $("[data-sort='priority']").trigger("click");
  assert.equal($(".ujg-esi-parent-row").first().attr("data-key"), "P-10");
  assert.equal($("[data-sort='priority']").closest("th").attr("aria-sort"), "ascending");
  applyFilter($, "priority", "Высокий");
  assert.equal($(".ujg-esi-parent-row").length, 2);
  assert.equal($("tr[data-key='P-10']").hasClass("is-context"), true);
  assert.equal($("tr[data-key='P-11']").length, 1);
  assert.equal($("tr[data-key='P-12']").length, 0);
});

test("keyboard users can enter Description with Tab and return with Escape", t => {
  const {dom,$} = setup(); t.after(() => dom.window.close());
  const anchor = $("tr[data-key='P-12'] .ujg-esi-issue-summary-text");
  anchor.trigger("focus");
  anchor.trigger($.Event("keydown", {key:"Tab"}));
  assert.equal(dom.window.document.activeElement, $(".ujg-esi-description-popover a")[0]);
  $(".ujg-esi-description-popover").trigger($.Event("keydown", {key:"Escape"}));
  assert.equal(dom.window.document.activeElement, anchor[0]);
  assert.equal($(".ujg-esi-description-popover").length, 0);
});

test("native selected chip click stays open until the removal is applied", t => {
  const {dom,$} = setup(); t.after(() => dom.window.close());
  applyFilter($,"assignee","Bob");
  $("[data-filter='assignee']").trigger("click");
  $(".ujg-esi-selected-chip")[0].click();
  assert.equal($(".ujg-esi-grid-menu").length,1);
  $(".ujg-esi-filter-apply").trigger("click");
  assert.equal($(".ujg-esi-parent-row").length,0);
});

test("unchanged OK in a narrowed value list preserves the independent filter", t => {
  const {dom,$} = setup(); t.after(() => dom.window.close());
  applyFilter($,"status","Open");
  applyFilter($,"assignee","Bob");
  $("[data-filter='assignee']").trigger("click");
  $(".ujg-esi-filter-apply").trigger("click");
  $("[data-filter='status']").trigger("click");
  $(".ujg-esi-menu-command").last().trigger("click");
  assert.equal($(".ujg-esi-parent-row").length,1);
  assert.equal($("tr[data-key='P-12']").length,0);
});

test("authoritative workflow category colors custom statuses and full render preserves scroll", t => {
  const {dom,$,state,render} = setup(); t.after(() => dom.window.close());
  state.rows[1].childStatuses[0].status = "Analysis";
  state.rows[1].childStatuses[0].statusState = "progress";
  state.rows[1].childStatuses[0].statusCategory = "indeterminate";
  render();
  assert.equal($("tr[data-key='P-11'] .ujg-esi-workflow-status").hasClass("is-progress"),true);
  $(".ujg-esi-registry-scroll").scrollTop(700).scrollLeft(100);
  render();
  assert.equal($(".ujg-esi-registry-scroll").scrollTop(),700);
  assert.equal($(".ujg-esi-registry-scroll").scrollLeft(),100);
});

test("large issue trees reveal remaining tasks without losing source cells or action indices", t => {
  const {dom,$,state,calls,render} = setup(); t.after(() => dom.window.close());
  state.rows[1].childStatuses = Array.from({length:23}, (_,i) => ({key:"P-" + (100+i),summary:"Child " + i,status:i === 22 ? "Review" : "Open",issueType:"Task",role:i % 2 ? "QA" : "BE"})).reverse();
  render();
  assert.equal($(".ujg-esi-child-row").length,5);
  assert.equal($(".ujg-esi-child-row").first().attr("data-key"),"P-100");
  assert.equal($(".ujg-esi-more-children").text(),"Ещё 18 связанных задач");
  assert.equal($("tr[data-key='P-10'] .ujg-esi-cell-remarkId").attr("rowspan"),"7");
  $(".ujg-esi-more-children").trigger("click");
  assert.equal($(".ujg-esi-child-row").length,23);
  assert.equal($("tr[data-key='P-10'] .ujg-esi-cell-remarkId").attr("rowspan"),"24");
  $("[aria-label='Свернуть замечание 744']").trigger("click");
  assert.equal($(".ujg-esi-child-row").length,0);
  $("[aria-label='Развернуть замечание 744']").trigger("click");
  assert.equal($(".ujg-esi-child-row").length,23);
  $("tr[data-key='P-10'] .ujg-esi-row-ai").trigger("click");
  assert.deepEqual(calls,[["correct",1]]);
  applyFilter($,"status","Review");
  assert.equal($(".ujg-esi-child-row").length,1);
  assert.equal($("tr[data-key='P-122']").length,1);
  assert.equal($(".ujg-esi-more-children").length,0);
});

test("tree branches sit beside Jira keys and compact icons preserve accessible meanings", t => {
  const {dom,$,state,render} = setup(); t.after(() => dom.window.close());
  state.rows[1].childStatuses[0].issueType = "Задача разработки";
  state.rows[1].childStatuses[0].priority = "Высокий";
  render();
  const row = $("tr[data-key='P-11']");
  assert.equal(row.find(".ujg-esi-cell-key .ujg-esi-tree-mark").length,1);
  assert.equal(row.find(".ujg-esi-cell-summary .ujg-esi-tree-mark").length,0);
  assert.equal(row.find(".ujg-esi-cell-type").text(),"");
  assert.equal(row.find(".ujg-esi-cell-type [aria-label='Задача разработки']").length,1);
  assert.equal(row.find(".ujg-esi-cell-priority [aria-label='Высокий']").length,1);
  $("[data-filter='type']").trigger("click");
  assert.equal(option($,"Задача разработки").length,1);
});

test("description preview exposes full content on focus, escapes HTML and closes on Escape", t => {
  const {dom,$,state,render} = setup(); t.after(() => dom.window.close());
  state.rows[1].childStatuses[1].description = "h2. Проверка качества\n* Открыть настройки\n* Проверить OV и NT\n<img src=x onerror=alert(1)>";
  state.rows[1].childStatuses[1].descriptionLoaded = true;
  render();
  $("tr[data-key='P-12'] .ujg-esi-issue-summary-text").trigger("focus");
  const popup = $(".ujg-esi-description-popover");
  assert.equal(popup.length, 1);
  assert.match(popup.text(), /Проверка качества/);
  assert.match(popup.text(), /Проверить OV и NT/);
  assert.equal(popup.find("img,script").length, 0);
  assert.equal(popup.find("h4").text(), "Проверка качества");
  popup.trigger($.Event("keydown", {key:"Escape"}));
  assert.equal($(".ujg-esi-description-popover").length, 0);
});

test("additional-task actions never invoke new Story creation and retain source indices", t => {
  const {dom,$,calls} = setup(); t.after(() => dom.window.close());
  assert.equal($(".ujg-esi-add-child").length, 2);
  $("tr[data-key='P-20'] .ujg-esi-add-child").trigger("click");
  assert.deepEqual(calls, [["children",2]]);
  assert.equal($(".ujg-esi-create-row").text(), "");
  assert.equal($(".ujg-esi-create-row").attr("aria-label"), "Создать");
  $("tr[data-key='P-10'] [data-owner-index]").trigger("click");
  assert.deepEqual(calls[1], ["owner","row-owner-1"]);
});

test("exclude completed hides finished siblings but retains an active child's context parent", t => {
  const {dom,$,state,render} = setup(); t.after(() => dom.window.close());
  state.rows[1].childStatuses[0].blocked = true;
  render();
  assert.equal($("tr[data-key='P-11'] [aria-label='Заблокирована']").length, 1);
  $("[data-filter='status']").trigger("click");
  $("input[aria-label='Исключить готовые']").prop("checked", true).trigger("change");
  $(".ujg-esi-filter-apply").trigger("click");
  assert.equal($("tr[data-key='P-12']").length, 0);
  assert.equal($("tr[data-key='P-11']").length, 1);
  assert.equal($("tr[data-key='P-10']").hasClass("is-context"), true);
  assert.equal($(".ujg-esi-create-row").length, 1);
  $("[aria-label='Сбросить все фильтры']").trigger("click");
  assert.equal($("tr[data-key='P-12']").length, 1);
});

test("Jira view can explicitly load with no workbook and never shows an Excel dropzone", t => {
  const {dom,$,state,calls,render} = setup(); t.after(() => dom.window.close());
  state.viewMode = "jira"; state.rows = []; state.parseMeta = null; render();
  assert.equal($(".ujg-esi-dropzone").length, 0);
  assert.equal($(".ujg-esi-download-excel").length, 0);
  $("[aria-label='Загрузить замечания из Jira']").trigger("click");
  assert.deepEqual(calls, [["load"]]);
  $("[aria-label='Режим Excel']").trigger("click");
  assert.deepEqual(calls[1], ["mode","excel"]);
});

test("additional-task dialog locks parent and requires explicit child selection", t => {
  const {dom,$,state,render} = setup(); t.after(() => dom.window.close());
  state.createDialog = {mode:"children",parentKey:"P-10",parentSummary:"Existing story",projectKey:"P",childTasks:[{role:"QA",enabled:false,summary:"New test",issueType:"Task"}]};
  render();
  assert.equal($(".ujg-esi-confirm-summary").length, 0);
  assert.match($(".ujg-esi-confirm-parent").text(), /P-10/);
  assert.equal($(".ujg-esi-confirm-create").prop("disabled"), true);
  state.createDialog.childTasks[0].enabled = true; render();
  assert.equal($(".ujg-esi-confirm-create").prop("disabled"), false);
});

test("an unavailable description stays distinct from a loaded empty description", t => {
  const {dom,$,state,render} = setup(); t.after(() => dom.window.close());
  state.rows[1].childStatuses[0].description = "";
  state.rows[1].childStatuses[0].descriptionLoaded = false; render();
  $("tr[data-key='P-11'] .ujg-esi-issue-summary-text").trigger("focus");
  assert.match($(".ujg-esi-description-popover").text(), /Описание не загружено/);
  state.rows[1].childStatuses[0].descriptionLoaded = true; render();
  $("tr[data-key='P-11'] .ujg-esi-issue-summary-text").trigger("focus");
  assert.match($(".ujg-esi-description-popover").text(), /Описание не заполнено/);
});

test("clearing a source owner does not restore an old Excel assignee", t => {
  const {dom,$,state,render} = setup(); t.after(() => dom.window.close());
  state.rows[0].sourceColumns = {"Ответственный":"", "Исполнитель":"Old owner"}; render();
  assert.doesNotMatch($(".ujg-esi-cell-owner").first().text(), /Old owner/);
});

test("failed child link is visibly distinguished from a successfully linked child", t => {
  const {dom,$,state,render} = setup(); t.after(() => dom.window.close());
  state.rows[1].childStatuses[0].linkedToParent = false;
  state.rows[1].childStatuses[0].linkError = "No link permission"; render();
  assert.equal($("tr[data-key='P-11'] [aria-label='Связь с основной задачей не создана']").length, 1);
});

test("Jira-only tree toggles use the real key when no source ID or Excel row exists", t => {
  const {dom,$,state,render} = setup(); t.after(() => dom.window.close());
  state.viewMode = "jira";
  state.rows = [state.rows[1]];
  state.rows[0].sourceColumns = {};
  delete state.rows[0].excelRowNumber; render();
  assert.equal($("[aria-label='Свернуть замечание P-10']").length, 1);
  assert.doesNotMatch($(".ujg-esi-cell-remark").text(), /undefined|Excel:/);
});

test("wiki tables keep escaped pipes, multiline cells and HTML inert", t => {
  const {dom,$,state,render} = setup(); t.after(() => dom.window.close());
  state.rows[1].childStatuses[0].description = "h2. Detail\n||Field||Value||\n|Name|A \\&#124; B|\n|Long|first\nsecond|\n<img src=x onerror=alert(1)>";
  render();
  $("tr[data-key='P-11'] .ujg-esi-issue-summary-text").trigger("focus");
  const table = $(".ujg-esi-description-body table");
  assert.equal(table.find("th").length, 2);
  assert.match(table.find("td").eq(1).text(), /A \| B/);
  assert.equal(table.find("td").last().find("br").length, 1);
  assert.match(table.find("td").last().text(), /firstsecond/);
  assert.equal($(".ujg-esi-description-body img").length, 0);
  assert.equal($(".ujg-esi-description-body h4").text(), "Detail");
});

test("Mermaid uses existing library and leaves source on failure or closed popup", async t => {
  const {dom,$,state,render} = setup(); t.after(() => dom.window.close());
  const calls = [];
  dom.window.mermaid = {initialize: config => calls.push(config), render: async () => ({svg: '<svg xmlns="http://www.w3.org/2000/svg"><text>Graph</text></svg>'})};
  state.rows[1].childStatuses[0].description = "```mermaid\ngraph TD\nA-->B\n```"; render();
  $("tr[data-key='P-11'] .ujg-esi-issue-summary-text").trigger("focus");
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal($(".ujg-esi-description-body svg text").text(), "Graph");
  assert.equal(calls[0].securityLevel, "strict");
  assert.equal(calls[0].startOnLoad, false);
  assert.equal(calls[0].htmlLabels, false);
  assert.equal(calls[0].flowchart.htmlLabels, false);
  assert.ok(calls[0].secure.includes("htmlLabels"));
  assert.ok(calls[0].secure.includes("flowchart"));
  dom.window.mermaid.render = async () => { throw Error("bad diagram"); };
  $(".ujg-esi-description-popover [aria-label='Закрыть описание']").trigger("click");
  $("tr[data-key='P-11'] .ujg-esi-issue-summary-text").trigger("focus");
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.match($(".ujg-esi-description-body").text(), /graph TD/);
});

test("column layout persists under the user key and aligns a mixed more row", t => {
  const {dom,$,state,render} = setup(); t.after(() => dom.window.close());
  state.preferencesStorageKey = "ujg-esi-state:user:key:alice";
  dom.window.localStorage.setItem(state.preferencesStorageKey, JSON.stringify({projectKey:"P",epicsByProject:{P:"P-1"}}));
  state.rows[1].childStatuses = Array.from({length:7}, (_,i) => ({key:"P-"+(100+i),summary:"Child",status:"Open"}));
  render();
  $("[aria-label='Столбцы']").trigger("click");
  $(".ujg-esi-filter-option input").first().prop("checked",false).trigger("change");
  $(".ujg-esi-filter-apply").trigger("click");
  assert.equal($("th[data-column='remarkId']").length,0);
  $("th[data-column='owner']").trigger($.Event("pointerdown", {pageX:200,pointerId:1}));
  $("th[data-column='key']").trigger($.Event("pointerup", {pageX:400,pointerId:1}));
  assert.equal($("th[data-column='owner']").index() > $("th[data-column='key']").index(),true);
  const saved = JSON.parse(dom.window.localStorage.getItem(state.preferencesStorageKey));
  assert.equal(saved.projectKey,"P"); assert.equal(saved.epicsByProject.P,"P-1");
  assert.ok(saved.gridLayout);
  const headCount = $("thead th").length;
  const occupied = $(".ujg-esi-parent-row").filter("[data-key='P-10']").find("td").toArray().reduce((n,cell) => n + Number(cell.colSpan || 1),0);
  assert.equal(occupied,headCount);
  const more = $(".ujg-esi-more-row").first();
  assert.equal(more.find("td").toArray().reduce((n,cell) => n + Number(cell.colSpan || 1),0),headCount - $(".ujg-esi-source-cell").filter("[rowspan]").first().closest("tr").find(".ujg-esi-source-cell").length - 2);
});

test("resize does not sort and fullscreen survives render then exits on Escape", t => {
  const {dom,$,state,render} = setup(); t.after(() => dom.window.close());
  const head = $("th[data-column='summary']");
  head.find(".ujg-esi-column-resize").trigger($.Event("pointerdown", {pageX:100,pointerId:1}));
  $(dom.window.document).trigger($.Event("pointermove", {pageX:150,pointerId:1}));
  $(dom.window.document).trigger($.Event("pointerup", {pageX:150,pointerId:1}));
  assert.equal($("th[data-column='summary']").attr("aria-sort"),"none");
  assert.equal($("col[data-column='summary']").attr("width"),"326");
  const host = $(".ujg-excel-story-importer"); host.attr("style","color: red");
  $("[aria-label='На весь экран']").trigger("click");
  assert.equal(host.hasClass("ujg-esi-fullscreen"),true);
  render();
  assert.equal($("[aria-label='Выйти из полноэкранного режима']").length,1);
  $(dom.window.document).trigger($.Event("keydown", {key:"Escape"}));
  assert.equal(host.hasClass("ujg-esi-fullscreen"),false);
  assert.equal(host.attr("style"),"color: red");
  state.rows=[]; render();
  assert.equal($("[aria-label='На весь экран']").length,1);
});

test("confirmation shows a selected Epic absent from fetched options", t => {
  const {dom,$,state,render} = setup(); t.after(() => dom.window.close());
  state.createDialog = { projectKey:"P", epicKey:"P-999", epicText:"P-999 - Hidden epic", summary:"New story", issueType:"Story" };
  state.epics = [{key:"P-1", summary:"Fetched epic"}]; render();
  assert.equal($(".ujg-esi-confirm-epic").val(),"P-999");
  assert.match($(".ujg-esi-confirm-epic option:selected").text(),/P-999/);
});

test("restored layouts validate IDs and widths and remain scoped to the active user", t => {
  const {dom,$,state,render} = setup(); t.after(() => dom.window.close());
  const a = "ujg-esi-state:user:key:a", b = "ujg-esi-state:user:key:b";
  dom.window.localStorage.setItem(a, JSON.stringify({gridLayout:{order:["summary","summary","invented","remark"],visible:["summary","remark"],widths:{summary:9000,remark:-4}},projectKey:"P"}));
  state.preferencesStorageKey = a; render();
  assert.deepEqual($("thead th[data-column]").toArray().map(th => th.dataset.column),["summary","remark"]);
  assert.equal($("col[data-column='summary']").attr("width"),"600");
  assert.equal($("col[data-column='remark']").attr("width"),"50");
  state.preferencesStorageKey = b; render();
  assert.equal($("thead th[data-column='remarkId']").length,1);
  assert.equal($("col[data-column='summary']").attr("width"),"276");
  state.preferencesStorageKey = a; render();
  assert.deepEqual($("thead th[data-column]").toArray().map(th => th.dataset.column),["summary","remark"]);
  state.preferencesStorageKey = b; render();
  dom.window.localStorage.setItem(b,"not json"); render();
  assert.equal($("thead th[data-column='remarkId']").length,1);
});

test("column reset restores default visibility and width while preserving other preferences", t => {
  const {dom,$,state,render} = setup(); t.after(() => dom.window.close());
  state.preferencesStorageKey = "ujg-esi-state:user:key:reset";
  dom.window.localStorage.setItem(state.preferencesStorageKey,JSON.stringify({projectKey:"P",epicsByProject:{P:"P-1"},gridLayout:{visible:["summary"],order:["summary"],widths:{summary:410}}}));
  render();
  $("[aria-label='Столбцы']").trigger("click");
  $("[aria-label='Сбросить расположение столбцов']").trigger("click");
  assert.equal($("thead th[data-column='remarkId']").length,1);
  assert.equal($("col[data-column='summary']").attr("width"),"276");
  const saved = JSON.parse(dom.window.localStorage.getItem(state.preferencesStorageKey));
  assert.equal(saved.projectKey,"P"); assert.equal(saved.epicsByProject.P,"P-1");
});

test("Jira Mermaid blocks render and closed popups ignore late completion", async t => {
  const {dom,$,state,render} = setup(); t.after(() => dom.window.close());
  let complete;
  dom.window.mermaid = {initialize: () => {},render: () => new Promise(resolve => { complete = resolve; })};
  state.rows[1].childStatuses[0].description = "{code:mermaid}\ngraph TD\nA-->B\n{code}"; render();
  $("tr[data-key='P-11'] .ujg-esi-issue-summary-text").trigger("focus");
  await new Promise(resolve => setTimeout(resolve,0));
  $(".ujg-esi-description-popover [aria-label='Закрыть описание']").trigger("click");
  complete({svg:'<svg xmlns="http://www.w3.org/2000/svg"><text>Late</text></svg>'});
  await new Promise(resolve => setTimeout(resolve,0));
  assert.equal($(".ujg-esi-description-popover").length,0);
  state.rows[1].childStatuses[0].description = "{mermaid}\ngraph TD\nB-->C\n{mermaid}"; render();
  dom.window.mermaid.render = async () => ({svg:'<svg xmlns="http://www.w3.org/2000/svg"><text>Jira block</text></svg>'});
  $("tr[data-key='P-11'] .ujg-esi-issue-summary-text").trigger("focus");
  await new Promise(resolve => setTimeout(resolve,0));
  assert.equal($(".ujg-esi-mermaid-diagram svg text").text(),"Jira block");
});

test("Escape closes description first while fullscreen remains active", t => {
  const {dom,$} = setup(); t.after(() => dom.window.close());
  $("[aria-label='На весь экран']").trigger("click");
  $("tr[data-key='P-11'] .ujg-esi-issue-summary-text").trigger("focus");
  $(".ujg-esi-description-popover").trigger($.Event("keydown",{key:"Escape"}));
  assert.equal($(".ujg-esi-description-popover").length,0);
  assert.equal($(".ujg-excel-story-importer").hasClass("ujg-esi-fullscreen"),true);
});

test("backward column drag reaches first position and later sorting still works", async t => {
  const {dom,$} = setup(); t.after(() => dom.window.close());
  $("th[data-column='key']").trigger($.Event("pointerdown",{pageX:200}));
  $("th[data-column='remarkId']").trigger($.Event("pointerup",{pageX:100}));
  assert.equal($("thead th[data-column]").first().attr("data-column"),"key");
  await new Promise(resolve => setTimeout(resolve,0));
  $("[data-sort='key']").trigger("click");
  assert.equal($("th[data-column='key']").attr("aria-sort"),"ascending");
});

test("a filter pointer gesture does not reorder columns and denied storage does not block layout", t => {
  const {dom,$,state,render} = setup(); t.after(() => dom.window.close());
  const first = $("thead th[data-column]").first().attr("data-column");
  $("[data-filter='remarkId']").trigger($.Event("pointerdown",{pageX:100}));
  $("th[data-column='summary']").trigger($.Event("pointerup",{pageX:300}));
  assert.equal($("thead th[data-column]").first().attr("data-column"),first);
  Object.defineProperty(dom.window,"localStorage",{configurable:true,get() { throw Error("denied"); }});
  state.preferencesStorageKey = "denied";
  assert.doesNotThrow(render);
  $("[aria-label='Столбцы']").trigger("click");
  assert.doesNotThrow(() => $(".ujg-esi-filter-apply").trigger("click"));
});

test("resize starts from measured header width and keeps table width in sync", t => {
  const {dom,$} = setup(); t.after(() => dom.window.close());
  const th = $("th[data-column='summary']")[0];
  th.getBoundingClientRect = () => ({width:420});
  $(th).find(".ujg-esi-column-resize").trigger($.Event("pointerdown",{pageX:100}));
  $(dom.window.document).trigger($.Event("pointermove",{pageX:130}));
  $(dom.window.document).trigger($.Event("pointerup",{pageX:130}));
  assert.equal($("col[data-column='summary']").attr("width"),"450");
  assert.equal($(".ujg-esi-registry-table").css("width"),$(".ujg-esi-registry-table").css("min-width"));
});

test("interleaved More button occupies the widest task run", t => {
  const {dom,$,state,render} = setup(); t.after(() => dom.window.close());
  state.rows[1].childStatuses = Array.from({length:7},(_,i) => ({key:"P-"+(100+i),summary:"Child",status:"Open"}));
  state.preferencesStorageKey = "wide-more";
  dom.window.localStorage.setItem("wide-more",JSON.stringify({gridLayout:{order:["type","owner","summary"],visible:["type","owner","summary"],widths:{type:50,summary:310}}}));
  render();
  const cells = $(".ujg-esi-more-row").first().find("td");
  assert.equal(cells.length,2);
  assert.equal(cells.eq(0).find(".ujg-esi-more-children").length,0);
  assert.equal(cells.eq(1).find(".ujg-esi-more-children").length,1);
});

test("Mermaid resource syntax stays readable without entering the library", async t => {
  const {dom,$,state,render} = setup(); t.after(() => dom.window.close());
  const sources = [
    'flowchart TD\nA@{ "img": "//collector.invalid/probe", label: "Safe" }',
    'flowchart TD\nA @ { "img": "../probe", label: "Safe" }',
    'flowchart TD\nA@{ img: "/probe" }',
    'flowchart TD\nA-->B\nstyle A fill:url(//collector.invalid/probe)',
    'flowchart TD\nA-->B\nclassDef unsafe fill:url(../probe)',
    'flowchart TD\nA-->B\n@import "/probe"',
    'flowchart TD\nA["<img src=../probe>"]',
    'flowchart TD\nA["![asset](../probe)"]'
  ];
  const calls = [];
  dom.window.mermaid = {initialize: () => calls.push("initialize"),render: async () => { calls.push("render"); return {svg:'<svg xmlns="http://www.w3.org/2000/svg"/>'}; }};
  for (const source of sources) {
    state.rows[1].childStatuses[0].description = "```mermaid\n" + source + "\n```"; render();
    $("tr[data-key='P-11'] .ujg-esi-issue-summary-text").trigger("focus");
    await new Promise(resolve => setTimeout(resolve,0));
    assert.equal(calls.length,0,source);
    assert.equal($(".ujg-esi-mermaid-diagram pre").text(),source);
  }
});

test("Mermaid failure suppresses error graphics and cleans only its own temporary nodes", async t => {
  const {dom,$,state,render} = setup(); t.after(() => dom.window.close());
  const unrelated = dom.window.document.createElement("div"); unrelated.id = "dother-widget";
  dom.window.document.body.appendChild(unrelated);
  let renderId, configuration;
  dom.window.mermaid = {
    initialize: config => { configuration = config; },
    render: async id => {
      renderId = id;
      const wrapper = dom.window.document.createElement("div"); wrapper.id = "d" + id;
      const svg = dom.window.document.createElementNS("http://www.w3.org/2000/svg","svg"); svg.id = id;
      wrapper.appendChild(svg); dom.window.document.body.appendChild(wrapper);
      throw Error("malformed diagram");
    }
  };
  state.rows[1].childStatuses[0].description = "```mermaid\nflowchart TD\nA[\n```"; render();
  $("tr[data-key='P-11'] .ujg-esi-issue-summary-text").trigger("focus");
  await new Promise(resolve => setTimeout(resolve,0));
  assert.equal(dom.window.document.getElementById("d" + renderId),null);
  assert.equal(dom.window.document.getElementById(renderId),null);
  assert.equal(dom.window.document.getElementById("dother-widget"),unrelated);
  assert.equal(configuration.suppressErrorRendering,true);
  assert.ok(configuration.secure.includes("suppressErrorRendering"));
  assert.match($(".ujg-esi-mermaid-diagram pre").text(),/A\[/);
});

test("Mermaid cleans successful and stale renders and skips a popup closed before rendering", async t => {
  const {dom,$,state,render} = setup(); t.after(() => dom.window.close());
  let complete, renderId, calls = 0;
  dom.window.mermaid = {initialize: () => {},render: id => {
    calls++; renderId = id;
    const wrapper = dom.window.document.createElement("div"); wrapper.id = "d" + id;
    dom.window.document.body.appendChild(wrapper);
    return new Promise(resolve => { complete = resolve; });
  }};
  state.rows[1].childStatuses[0].description = "```mermaid\nflowchart TD\nA-->B\n```"; render();
  const anchor = $("tr[data-key='P-11'] .ujg-esi-issue-summary-text");
  anchor.trigger("click");
  $(".ujg-esi-description-popover [aria-label='Закрыть описание']").trigger("click");
  await new Promise(resolve => setTimeout(resolve,0));
  assert.equal(calls,0);
  for (const closeBeforeCompletion of [false,true]) {
    anchor.trigger("click");
    await new Promise(resolve => setTimeout(resolve,0));
    if (closeBeforeCompletion) $(".ujg-esi-description-popover [aria-label='Закрыть описание']").trigger("click");
    complete({svg:'<svg xmlns="http://www.w3.org/2000/svg" id="' + renderId + '"><text>Success</text></svg>'});
    await new Promise(resolve => setTimeout(resolve,0));
    assert.equal(dom.window.document.getElementById("d" + renderId),null);
    assert.equal($(".ujg-esi-mermaid-diagram svg text").text(),closeBeforeCompletion ? "" : "Success");
  }
});

test("second Escape from a returned summary focus exits fullscreen", t => {
  const {dom,$} = setup(); t.after(() => dom.window.close());
  $("[aria-label='На весь экран']").trigger("click");
  const anchor = $("tr[data-key='P-11'] .ujg-esi-issue-summary-text");
  anchor.trigger("focus");
  $(".ujg-esi-description-popover").trigger($.Event("keydown",{key:"Escape"}));
  assert.equal(dom.window.document.activeElement,anchor[0]);
  assert.equal($(".ujg-excel-story-importer").hasClass("ujg-esi-fullscreen"),true);
  anchor.trigger($.Event("keydown",{key:"Escape"}));
  assert.equal($(".ujg-excel-story-importer").hasClass("ujg-esi-fullscreen"),false);
});

test("mouse-opened Columns menu takes focus and Escape closes it before fullscreen", t => {
  const {dom,$} = setup(); t.after(() => dom.window.close());
  $("[aria-label='На весь экран']").trigger("click");
  const trigger = $("[aria-label='Столбцы']"); trigger[0].focus(); trigger[0].click();
  assert.equal($(".ujg-esi-grid-menu")[0].contains(dom.window.document.activeElement),true);
  $(dom.window.document.activeElement).trigger($.Event("keydown",{key:"Escape"}));
  assert.equal($(".ujg-esi-grid-menu").length,0);
  assert.equal($(".ujg-excel-story-importer").hasClass("ujg-esi-fullscreen"),true);
  assert.equal(dom.window.document.activeElement,trigger[0]);
  trigger.trigger($.Event("keydown",{key:"Escape"}));
  assert.equal($(".ujg-excel-story-importer").hasClass("ujg-esi-fullscreen"),false);
});

test("anchor-focused Columns menu still consumes only its closing Escape", t => {
  const {dom,$} = setup(); t.after(() => dom.window.close());
  $("[aria-label='На весь экран']").trigger("click");
  const trigger = $("[aria-label='Столбцы']"); trigger[0].click(); trigger[0].focus();
  trigger.trigger($.Event("keydown",{key:"Escape"}));
  assert.equal($(".ujg-esi-grid-menu").length,0);
  assert.equal($(".ujg-excel-story-importer").hasClass("ujg-esi-fullscreen"),true);
  trigger.trigger($.Event("keydown",{key:"Escape"}));
  assert.equal($(".ujg-excel-story-importer").hasClass("ujg-esi-fullscreen"),false);
});

test("wiki table delimiters respect odd and even backslash escapes across lines", t => {
  const {dom,$,state,render} = setup(); t.after(() => dom.window.close());
  for (const count of [1,3,2,4]) {
    const slashes = "\\".repeat(count), odd = count % 2 === 1;
    const row = odd ? "|Label|left " + slashes + "|\nright|" : "|Label|left " + slashes + "|tail|";
    state.rows[1].childStatuses[0].description = row + "\n|Next|done|"; render();
    $("tr[data-key='P-11'] .ujg-esi-issue-summary-text").trigger("focus");
    const rows = $(".ujg-esi-wiki-table tr"), cells = rows.first().find("td");
    assert.equal(rows.length,2,"row count for " + count + " backslashes");
    assert.equal(cells.length,odd ? 2 : 3);
    assert.equal(cells.eq(1).text(),"left " + "\\".repeat(Math.floor(count / 2)) + (odd ? "|right" : ""));
    assert.equal(cells.eq(1).find("br").length,odd ? 1 : 0);
  }
});
