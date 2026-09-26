const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const load = require("./helpers/load-amd-module");
const registry = () => load(path.join(__dirname, "../ujg-excel-story-importer-modules/registry.js"), {
  _ujgESI_remarkId: load(path.join(__dirname, "../ujg-excel-story-importer-modules/remark-id.js"), {}),
  _ujgESI_deadlines: load(path.join(__dirname, "../ujg-excel-story-importer-modules/deadlines.js"), {})
});
const source = () => [
  { id: "Sheet:3", excelRowNumber: 3, summary: "Original remark", jiraKey: "P-10", sourceColumns: { "№": "744", "Исполнитель": "Owner", "Статус": "Source only" },
    storyDetails: { key: "P-10", summary: "Story", status: "Done", assignee: "Anna" },
    childStatuses: [{ key: "P-11", summary: "[BE] Work", role: "BE", status: "Open", assignee: "Bob" }, { key: "P-12", summary: "[QA] Test", role: "QA", status: "Done", assignee: "Anna" }] },
  { id: "Sheet:4", excelRowNumber: 4, summary: "New remark", status: "ready", sourceColumns: { "№": "20", "Статус": "Ready in Excel" } }
];

test("registry keeps actual source ID and leaves uncreated Jira fields empty", () => {
  const rows = registry().buildRows(source());
  assert.equal(rows[0].remarkId, "744");
  assert.equal(rows[0].owner, "Owner");
  assert.equal(rows[1].owner, "Owner");
  assert.equal(rows[3].key, "");
  assert.equal(rows[3].status, "");
  assert.equal(rows[3].assignee, "");
  assert.equal(rows[3].age, "");
  assert.equal(rows[3].rowIndex, 1);
});

test("owner team identity comes only from selected Jira identity or the Jira registry source", () => {
  const input=source(); input[0].storyDetails.assignee="Owner";
  input[0].storyDetails.assigneeIdentifiers=["jira-owner"];
  assert.deepEqual(Array.from(registry().buildRows(input)[0].ownerIdentifiers),[]);
  input[0].ownerIdentifiers=["jira-owner"];
  assert.deepEqual(Array.from(registry().buildRows(input)[0].ownerIdentifiers),["jira-owner"]);
});

test("blank Excel owner is not replaced by the Jira assignee", () => {
  const input = source();
  input[0].sourceColumns["Ответственный"] = "";
  input[0].sourceColumns["Исполнитель в Jira"] = "Old Jira assignee";
  input[0].storyDetails.assignee = "Current Jira assignee";
  const row = registry().buildRows(input)[0];
  assert.equal(row.owner, "");
  assert.equal(row.assignee, "Current Jira assignee");
});

test("child-only filter retains context parent and excludes unrelated siblings", () => {
  const r = registry();
  const groups = r.selectGroups(r.buildRows(source()), { status: ["Open"] });
  assert.equal(groups.length, 1);
  assert.equal(groups[0].parent.key, "P-10");
  assert.equal(groups[0].contextOnly, true);
  assert.deepEqual(Array.from(groups[0].children, x => x.key), ["P-11"]);
});

test("combined filters must match the same task, not different siblings", () => {
  const r = registry();
  assert.equal(r.selectGroups(r.buildRows(source()), { status: ["Open"], assignee: ["Anna"] }).length, 0);
  assert.equal(r.selectGroups(r.buildRows(source()), { owner: ["Owner"], assignee: ["Bob"] }).length, 1);
});

test("empty selection means no rows, blank filter selects missing values", () => {
  const r = registry();
  const rows = r.buildRows(source());
  assert.equal(r.selectGroups(rows, { status: [] }).length, 0);
  assert.equal(r.selectGroups(rows, { status: [""] })[0].parent.remarkId, "20");
});

test("natural ID sorting is independent of the original source row index", () => {
  const r = registry();
  const groups = r.selectGroups(r.buildRows(source()), {}, { column: "remarkId", direction: "asc" });
  assert.deepEqual(Array.from(groups, x => x.parent.remarkId), ["20", "744"]);
  assert.equal(groups[0].parent.rowIndex, 1);
});

test("filter values respect other filters and do not remove currently filtered values", () => {
  const r = registry();
  const values = r.values(r.buildRows(source()), "status", { owner: ["Owner"], status: ["Open"] });
  assert.deepEqual(Array.from(values), ["Done", "Open"]);
});

test("completed child and completed story flags independently select groups", () => {
  const r = registry();
  const input = source();
  input.push({ id: "all-done", jiraKey: "P-30", storyDetails: {key:"P-30",status:"Open"}, childStatuses:[{key:"P-31",status:"Done"}] });
  input.push({ id: "done-empty", jiraKey: "P-40", storyDetails: {key:"P-40",status:"Done"} });
  const rows = r.buildRows(input);
  const shape = filters => Array.from(r.selectGroups(rows, filters), g => [g.parent.key, g.contextOnly, Array.from(g.children, c => c.key)]);
  assert.deepEqual(shape({}), [
    ["P-10",false,["P-11","P-12"]],["",false,[]],["P-30",false,["P-31"]],["P-40",false,[]]
  ]);
  assert.deepEqual(shape({excludeDone:true}), [
    ["P-10",false,["P-11"]],["",false,[]],["P-30",false,[]],["P-40",false,[]]
  ]);
  assert.deepEqual(shape({excludeDoneStories:true}), [
    ["",false,[]],["P-30",false,["P-31"]]
  ]);
  assert.deepEqual(shape({excludeDone:true,excludeDoneStories:true}), [
    ["",false,[]],["P-30",false,[]]
  ]);
});

test("status selection keeps context behavior while story exclusion removes whole group", () => {
  const r = registry(), rows = r.buildRows(source());
  assert.deepEqual(Array.from(r.selectGroups(rows,{status:["Open"],excludeDone:true}), g => [g.parent.key,g.contextOnly,Array.from(g.children,c => c.key)]), [["P-10",true,["P-11"]]]);
  assert.equal(r.selectGroups(rows,{status:["Open"],excludeDoneStories:true}).length,0);
  assert.deepEqual(Array.from(r.selectGroups(rows,{status:["Done"],excludeDone:true}), g => [g.parent.key,Array.from(g.children,c => c.key)]), [["P-10",[]]]);
});

test("status facets ignore both flags and other facets omit hidden story values", () => {
  const r = registry(), rows = r.buildRows(source());
  assert.deepEqual(Array.from(r.values(rows,"status",{excludeDone:true,excludeDoneStories:true})),["","Done","Open"]);
  assert.deepEqual(Array.from(r.values(rows,"assignee",{excludeDoneStories:true})),[""]);
  assert.deepEqual(Array.from(r.values(rows,"assignee",{excludeDone:true})),["","Anna","Bob"]);
});

test("workflow done category controls exclusions while exact status values stay selectable", () => {
  const r = registry();
  const input = [{id:"custom",jiraKey:"P-60",storyDetails:{key:"P-60",status:"Released",statusCategory:"done"},childStatuses:[
    {key:"P-61",status:"Accepted",statusCategory:"done"},
    {key:"P-62",status:"In review",statusCategory:"indeterminate"}
  ]}];
  const rows = r.buildRows(input);
  assert.deepEqual(Array.from(r.values(rows,"status",{excludeDone:true,excludeDoneStories:true})),["Accepted","In review","Released"]);
  const childOnly = r.selectGroups(rows,{status:["In review"],excludeDone:true});
  assert.equal(childOnly.length,1);
  assert.equal(childOnly[0].contextOnly,true);
  assert.deepEqual(Array.from(childOnly[0].children,c => c.key),["P-62"]);
  assert.equal(r.selectGroups(rows,{status:["In review"],excludeDoneStories:true}).length,0);
});

test("uncreated remark with a done source status is not a completed Jira Story", () => {
  const r = registry();
  const rows = r.buildRows([{id:"new",summary:"New remark",sourceColumns:{"Статус в Jira":"Готово"}}]);
  assert.equal(rows[0].key,"");
  assert.equal(rows[0].done,true);
  assert.equal(r.selectGroups(rows,{excludeDoneStories:true}).length,1);
  assert.deepEqual(Array.from(r.values(rows,"summary",{excludeDoneStories:true})),["New remark"]);
});

test("status age uses only a verified statusSince, never updated", () => {
  const r = registry();
  const input = source();
  input[0].storyDetails.updated = "2026-09-20T00:00:00Z";
  input[0].childStatuses[0].statusSince = "2026-09-20T01:00:00Z";
  const rows = r.buildRows(input, Date.parse("2026-09-22T03:00:00Z"));
  assert.equal(rows[0].age, "");
  assert.equal(rows[1].age, "2 д 2 ч");
});

test("missing child metadata stays blank and explicit unassignment does not reuse Excel assignee", () => {
  const r = registry();
  const input = source();
  input[0].sourceColumns["Исполнитель в Jira"] = "Old assignee";
  input[0].storyDetails.assignee = "";
  input[0].childStatuses = [{ key: "P-11" }];
  const rows = r.buildRows(input);
  assert.equal(rows[0].assignee, "");
  input[0].sourceColumns["Приоритет"] = "Excel priority";
  assert.equal(r.buildRows(input)[0].priority, "");
  assert.equal(rows[1].type, "");
  for (const field of ["status", "assignee", "priority", "summary"]) assert.equal(rows[1][field], "", field);
});

test("ID aliases and numeric zero identify the same remark regardless of column casing", () => {
  const r = registry();
  for (const cols of [{id:"42"}, {" ID ":"42"}, {"Номер замечания":"42"}, {"№":0}]) {
    assert.equal(r.remarkId({sourceColumns:cols}), Object.values(cols)[0].toString());
  }
});

test("priority sorting follows severity, retains the tree, and leaves missing values last", () => {
  const r = registry();
  const input = ["Низкий", "Высокий", "Средний", "Критический", "", "Особый", "Блокер"].map((priority, index) => ({
    id: String(index), jiraKey: "P-" + index, storyDetails: { priority },
    childStatuses: [{ key: "C-1", priority: "Low" }, { key: "C-2", priority: "High" }]
  }));
  const rows = r.buildRows(input);
  const desc = r.selectGroups(rows, {}, { column: "priority", direction: "desc" });
  assert.deepEqual(Array.from(desc, group => group.parent.priority), ["Блокер", "Критический", "Высокий", "Средний", "Низкий", "Особый", ""]);
  assert.deepEqual(Array.from(desc[0].children, child => child.priority), ["High", "Low"]);
  const asc = r.selectGroups(rows, {}, { column: "priority", direction: "asc" });
  assert.deepEqual(Array.from(asc, group => group.parent.priority), ["Низкий", "Средний", "Высокий", "Критический", "Блокер", "Особый", ""]);
});
