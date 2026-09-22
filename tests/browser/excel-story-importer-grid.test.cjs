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
  modules._ujgESI_rendering.init($(".ujg-excel-story-importer"), { onCreateRow: index => calls.push(["create", index]), onRowImproveRemark: index => calls.push(["correct", index]) });
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
