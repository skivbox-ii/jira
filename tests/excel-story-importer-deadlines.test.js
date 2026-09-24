const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const load = require("./helpers/load-amd-module");
const dir = path.join(__dirname, "..", "ujg-excel-story-importer-modules");

function deadlines() { return load(path.join(dir, "deadlines.js"), {}); }

test("strict date parsing and missing values", () => {
  const resolve = deadlines().resolve;
  assert.deepEqual(JSON.parse(JSON.stringify(resolve({sourceColumns:{"Срок исполнения":"25.09.2026"}}))),
    {date:"2026-09-25",raw:"25.09.2026",source:"excel",field:"Срок исполнения",problem:null});
  assert.equal(resolve({sourceColumns:{"Срок исполнения":"31.02.2026"}}).problem,"invalid");
  assert.equal(resolve({sourceColumns:{"Срок исполнения":"09/10/2026"}}).problem,"invalid");
  assert.equal(resolve({sourceColumns:{"Дата фактического устранения":"25.09.2026"}}).problem,"missing");
});

test("default journal Срок wins; old aliases are fallback only when it is absent", () => {
  const resolve = deadlines().resolve;
  const columns = {"Срок":"2026-09-25","Срок исполнения":"2026-09-20"};
  const selected = resolve({sourceColumns:columns});
  assert.equal(selected.date,"2026-09-25");
  assert.equal(selected.field,"Срок");
  assert.equal(resolve({sourceColumns:{"Срок исполнения":"2026-09-20"}}).date,"2026-09-20");
  assert.equal(resolve({sourceColumns:{"Срок исполнения":"2026-09-20","Срок устранения":"2026-09-21"}}).problem,"conflict");
  assert.equal(resolve({sourceColumns:{},storyDetails:{duedate:"2026-09-20"}}).problem,"missing");
});

test("saved mapping to old Срок исполнения remains authoritative", () => {
  const resolve = deadlines().resolve;
  const selected = resolve({sourceColumns:{"Срок исполнения":"2026-09-25","Срок":"2026-09-26"}},
    {columnMap:{deadline:"Срок исполнения"}});
  assert.equal(selected.date,"2026-09-25");
  assert.equal(selected.field,"Срок исполнения");
});

test("populated duplicate Срок survives a blank first column before alias fallback", () => {
  const resolve=deadlines().resolve;
  for(const older of [{},{"Срок исполнения":"2026-09-20"}]) {
    const result=resolve({sourceColumns:{"Срок (колонка 3)":"2026-09-25",...older}});
    assert.equal(result.date,"2026-09-25");
    assert.equal(result.field,"Срок (колонка 3)");
  }
});

test("custom mapping selects its field and ignores unrelated deadline aliases", () => {
  const resolve = deadlines().resolve;
  const row = {sourceColumns:{"Мой срок":"2026-09-25","Срок":"2026-09-26"}};
  const selected = resolve(row,{columnMap:{deadline:"Мой срок"}});
  assert.equal(selected.date,"2026-09-25");
  assert.equal(selected.field,"Мой срок");
  assert.equal(selected.problem,null);
  assert.equal(resolve({sourceColumns:{"Срок":"2026-09-26"}},{columnMap:{deadline:"Мой срок"}}).problem,"missing");
  assert.equal(resolve({sourceColumns:{"Срок исполнения":"2026-09-25","Срок":"2026-09-26"}},
    {columnMap:{deadline:"Мой срок"}}).date,"2026-09-25");
});

test("duplicate chosen headers conflict while default mapping reports conflicting aliases", () => {
  const resolve = deadlines().resolve;
  const columns = {"Мой срок":"2026-09-25","Мой срок (колонка 4)":"2026-09-26","Срок":"2026-09-27"};
  assert.equal(resolve({sourceColumns:columns},{columnMap:{deadline:"Мой срок"}}).problem,"conflict");
  assert.equal(resolve({sourceColumns:{"Срок исполнения":"2026-09-25","Срок устранения":"2026-09-26"}},
    {columnMap:{deadline:"Срок"}}).problem,"conflict");
});

test("duplicate imported deadline columns cannot silently pick one date", () => {
  const resolve = deadlines().resolve;
  assert.equal(resolve({sourceColumns:{"Срок исполнения":"25.09.2026","Срок исполнения (колонка 4)":"26.09.2026"}}).problem,"conflict");
  const description = "Импортировано из журнала замечаний.\n\n||Поле||Значение||\n|Срок исполнения|25.09.2026|\n|Срок исполнения|26.09.2026|";
  assert.equal(resolve({storyDetails:{description}}).problem,"conflict");
});

test("Jira mode matches current journal by exact key and reports duplicate conflict", () => {
  const resolve = deadlines().resolve;
  const row = {jiraKey:"ABC-1",summary:"Same topic",storyDetails:{description:""}};
  const journalRows = [
    {jiraKey:"ABC-2",summary:"Same topic",sourceColumns:{"Срок исполнения":"2026-09-20"}},
    {jiraKey:"ABC-1",sourceColumns:{"Срок исполнения":"2026-09-25"}},
  ];
  assert.equal(resolve(row,{journalRows}).date,"2026-09-25");
  journalRows.push({jiraKey:"ABC-1",sourceColumns:{"Срок исполнения":"2026-09-26"}});
  assert.equal(resolve(row,{journalRows}).problem,"conflict");
});

test("enriched Excel row keeps its own journal deadline", () => {
  const resolve = deadlines().resolve;
  const row = {sheetName:"Журнал",jiraKey:"ABC-1",sourceColumns:{"Срок исполнения":"2026-09-25"},
    storyDetails:{description:"Импортировано из журнала замечаний.\n\n||Поле||Значение||\n|Срок исполнения|2026-09-20|"}};
  assert.equal(resolve(row).date,"2026-09-25");
});

test("Jira fallback reads only escaped imported ROOT table", () => {
  const resolve = deadlines().resolve;
  const description = "Импортировано из журнала замечаний.\n\n||Поле||Значение||\n|Срок исполнения|25.09.2026|\n|Заметка|a\\&#124;b|";
  assert.equal(resolve({jiraKey:"ABC-1",storyDetails:{description}}).date,"2026-09-25");
  assert.equal(resolve({jiraKey:"ABC-1",storyDetails:{description:"Исполнить до 25.09.2026"}}).problem,"missing");
  assert.equal(resolve({jiraKey:"ABC-1",storyDetails:{description:"|Срок исполнения|25.09.2026|"}}).problem,"missing");
});
