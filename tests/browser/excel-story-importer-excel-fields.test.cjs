const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
let JSDOM, jquery;
try { ({JSDOM} = require("jsdom")); jquery = require("jquery"); } catch (ignore) { /* Browser test dependencies are optional locally. */ }
const dir = path.join(__dirname, "../../ujg-excel-story-importer-modules");

function setup(layout) {
  const dom = new JSDOM("<main></main>", {runScripts:"outside-only",url:"http://localhost"});
  const w = dom.window, $ = jquery(w), modules = {jquery:$};
  w.define = (name,deps,factory) => { modules[name] = factory(...deps.map(dep => modules[dep])); };
  for (const file of ["remark-id","deadlines","registry"]) w.eval(fs.readFileSync(path.join(dir,file + ".js"),"utf8"));
  modules._ujgESI_icons = name => $("<i/>").text(name);
  modules._ujgESI_teams = {forUser:()=>[],forRole:()=>[],colors:[],currentWork:()=>({groups:[],warnings:[]})};
  w.eval(fs.readFileSync(path.join(dir,"grid.js"),"utf8"));
  if (layout) w.localStorage.setItem("excel-fields-test",JSON.stringify({gridLayout:layout}));
  const state = {preferencesStorageKey:"excel-fields-test",rows:[
    {id:"1",summary:"First",sourceColumns:{"Модуль":"Отдел АСУТП","Мой срок":"2026-10-02"},storyDetails:{key:"P-1",components:[{name:"Другой",id:"8"}]}},
    {id:"2",summary:"Second",sourceColumns:{"Мой срок":"2026-09-25"}}
  ],mappingSettings:{columnMap:{deadline:"Мой срок"},moduleComponentMap:{"Отдел АСУТП":"АСУТП"}},componentOptions:[{name:"АСУТП",id:"7"}]};
  const grid = modules._ujgESI_grid.create();
  grid.mount($("main"),state,{appendActions(){}});
  return {dom,$,grid,state};
}

test("grid shows selected Excel deadline and distinct mapped and actual components", {skip:!JSDOM || !jquery}, t => {
  const {dom,$} = setup(); t.after(() => dom.window.close());
  assert.equal($("th[data-column='deadline']").length,1);
  assert.match($("tr[data-source-index='0'] .ujg-esi-cell-deadline").text(),/02\.10\.2026/);
  assert.match($("tr[data-source-index='0'] .ujg-esi-cell-jiraComponent").text(),/Другой/);
  assert.match($("tr[data-source-index='0'] .ujg-esi-cell-jiraComponent").attr("title"),/АСУТП.*не совпадает/i);
  assert.equal($("th[data-column='mappedComponent']").length,0);
  assert.equal($("th[data-column='componentReason']").length,0);
});

test("old saved layout gains visible deadline while retaining prior hidden columns", {skip:!JSDOM || !jquery}, t => {
  const {dom,$} = setup({order:["remark","module"],visible:["remark"],widths:{remark:320}}); t.after(() => dom.window.close());
  assert.equal($("th[data-column='deadline']").length,1);
  assert.equal($("th[data-column='jiraComponent']").length,1);
  assert.equal($("th[data-column='module']").length,0);
  assert.equal($("th[data-column='remark']").length,1);
});

test("deadline sorting and applied filter survive a new grid instance", {skip:!JSDOM || !jquery}, t => {
  const {dom,$,state} = setup(); t.after(() => dom.window.close());
  $("button[data-sort='deadline']").trigger("click");
  $("button[data-filter='deadline']").trigger("click");
  $(".ujg-esi-filter-option").filter(function() { return $(this).text() === "2026-10-02"; }).find("input").prop("checked",false).trigger("change");
  $(".ujg-esi-filter-apply").trigger("click");
  const stored = JSON.parse(dom.window.localStorage.getItem(state.preferencesStorageKey)).gridLayout;
  assert.deepEqual(stored.sort,{column:"deadline",direction:"asc"});
  assert.deepEqual(stored.filters.deadline,["2026-09-25"]);
  const second = setup(stored); t.after(() => second.dom.window.close());
  assert.equal(second.$("th[data-column='deadline']").attr("aria-sort"),"ascending");
  assert.equal(second.$("tr.ujg-esi-parent-row").length,1);
});
