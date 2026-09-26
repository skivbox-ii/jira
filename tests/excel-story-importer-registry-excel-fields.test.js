const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const load = require("./helpers/load-amd-module");
const dir = path.join(__dirname, "../ujg-excel-story-importer-modules");
const deadlines = load(path.join(dir, "deadlines.js"), {});
const remarkId = load(path.join(dir, "remark-id.js"), {});
const registry = load(path.join(dir, "registry.js"), {
  _ujgESI_remarkId: remarkId, _ujgESI_deadlines: deadlines
});
const config = load(path.join(dir, "config.js"), {});
const parser = load(path.join(dir, "parser.js"), {_ujgESI_config:config});

test("exact Компонент header supplies module only when default Модуль is absent", () => {
  const parse = headers => parser.parseWorkbook({SheetNames:["S"],Sheets:{S:{__rows:[headers,headers.map(h => h === "Замечание" ? "Remark" : h === "Тип" ? "Bug" : h === "Модуль" ? "PARA" : "АСУТП")]}}}).rows[0].sourceColumns;
  assert.equal(parse(["Замечание","Компонент"])["Модуль"],"АСУТП");
  assert.equal(parse(["Замечание","Модуль","Компонент"])["Модуль"],"PARA");
  assert.equal(parse(["Замечание","Тип"])["Модуль"],undefined);
});

test("registry resolves the configured Excel deadline and sorts calendar dates with blanks last", () => {
  const rows = [
    {id:"1",sourceColumns:{"Срок исполнения":"2026-10-10","Мой срок":"2026-10-02"},storyDetails:{key:"P-1"}},
    {id:"2",sourceColumns:{"Мой срок":"2026-09-25"}},
    {id:"3",sourceColumns:{"Мой срок":"31.02.2026"}}
  ];
  const entries = registry.buildRows(rows, null, {mappingSettings:{columnMap:{deadline:"Мой срок"}}});
  assert.equal(entries[0].deadline, "2026-10-02");
  assert.equal(entries[0].deadlineSource, "Мой срок");
  assert.equal(entries[2].deadline, "");
  assert.match(entries[2].deadlineReason, /Несуществующая/);
  const asc = registry.selectGroups(entries, {}, {column:"deadline",direction:"asc"});
  const desc = registry.selectGroups(entries, {}, {column:"deadline",direction:"desc"});
  assert.deepEqual(Array.from(asc, g => g.parent.groupId), ["2","1","3"]);
  assert.deepEqual(Array.from(desc, g => g.parent.groupId), ["1","2","3"]);
});

test("registry maps only the canonical module and compares it with actual Jira components", () => {
  const context = {mappingSettings:{moduleComponentMap:{"Отдел АСУТП":"АСУТП"}},componentOptions:[{id:"7",name:"АСУТП"},{id:"8",name:"Другой"}]};
  const rows = [
    {id:"1",sourceColumns:{"Модуль":"Отдел АСУТП"},storyDetails:{components:[{id:"7",name:"АСУТП"}]}},
    {id:"2",sourceColumns:{"Модуль":"Отдел АСУТП"},storyDetails:{components:[{id:"8",name:"Другой"}]}},
    {id:"3",sourceColumns:{"Тип":"Отдел АСУТП"}},
    {id:"4",sourceColumns:{"Модуль":"Неизвестный"}}
  ];
  const entries = registry.buildRows(rows, null, context);
  assert.equal(entries[0].module, "Отдел АСУТП");
  assert.equal(entries[0].mappedComponent, "АСУТП");
  assert.equal(entries[0].jiraComponent, "АСУТП");
  assert.equal(entries[0].componentReason, "");
  assert.match(entries[1].componentReason, /не совпадает/i);
  assert.equal(entries[2].module, "");
  assert.equal(entries[2].mappedComponent, "");
  assert.match(entries[3].componentReason, /не сопоставлен/i);
});

test("component catalog validation waits for a loaded catalog", () => {
  const rows = [{id:"1",sourceColumns:{"Модуль":"М"}}];
  const base = {mappingSettings:{moduleComponentMap:{"М":"Компонент"}},componentOptions:[]};
  assert.equal(registry.buildRows(rows,null,{...base,componentsLoaded:false})[0].componentReason, "");
  assert.match(registry.buildRows(rows,null,{...base,componentsLoaded:true})[0].componentReason,/не найден/i);
});

test("mapped component uses the catalog's canonical display name", () => {
  const row = {id:"1",sourceColumns:{"Модуль":"М"}};
  const entry = registry.buildRows([row],null,{mappingSettings:{moduleComponentMap:{"М":"компонент"}},componentsLoaded:true,componentOptions:[{id:"1",name:"Компонент"}]})[0];
  assert.equal(entry.mappedComponent,"Компонент");
  assert.match(entry.componentReason,/регистр|точное имя/i);
});

test("child Jira component comes from child details and is never copied from the story", () => {
  const row = {id:"1",sourceColumns:{"Модуль":"М"},storyDetails:{key:"P-1",components:[{name:"Story component"}]},childStatuses:[
    {key:"P-2",components:[{name:"Child component"}]},{key:"P-3"}
  ]};
  const entries = registry.buildRows([row],null,{mappingSettings:{moduleComponentMap:{"М":"Story component"}}});
  assert.equal(entries[0].jiraComponent,"Story component");
  assert.equal(entries[1].jiraComponent,"Child component");
  assert.match(entries[1].componentReason,/не совпадает/i);
  assert.equal(entries[2].jiraComponent,"");
  assert.equal(entries[2].componentReason,"");
});

test("actual Jira component mismatch takes precedence over mapping name case", () => {
  const row = {id:"1",sourceColumns:{"Модуль":"М"},storyDetails:{key:"P-1",components:[{name:"Bar"}]}};
  const entry = registry.buildRows([row],null,{mappingSettings:{moduleComponentMap:{"М":"foo"}},componentsLoaded:true,componentOptions:[{name:"Foo"},{name:"Bar"}]})[0];
  assert.match(entry.componentReason,/не совпадает/i);
});
