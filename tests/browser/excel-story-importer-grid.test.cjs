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
