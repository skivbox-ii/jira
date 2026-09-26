const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {JSDOM} = require("jsdom");
const jquery = require("jquery");

test("component preview shows full replacement, selection, and independent table preferences", t => {
  const dom = new JSDOM('<button id="origin">Open</button><div id="host"></div>',{runScripts:"outside-only",url:"http://localhost"});
  t.after(() => dom.window.close());
  const $ = jquery(dom.window), modules={jquery:$};
  dom.window.define=(name,deps,factory)=>modules[name]=factory(...deps.map(dep=>modules[dep]));
  for(const file of ["icons","due-date-sync-ui"]) dom.window.eval(fs.readFileSync(path.join(__dirname,"../../ujg-excel-story-importer-modules",file+".js"),"utf8"));
  const calls={all:[],row:[],confirm:0,close:0};
  const services={onSelectAllComponentSync:v=>calls.all.push(v),onSelectComponentSyncRow:(id,v)=>calls.row.push([id,v]),
    onConfirmComponentSync:()=>calls.confirm++,onCloseComponentSync:()=>calls.close++};
  const state={baseUrl:"https://jira.example.test",preferencesStorageKey:"user-17",componentSync:{open:true,loading:false,running:false,error:null,
    rows:[{id:"1",key:"P-1",remarkId:"1",summary:"Story",sourceRaw:"Аварии",oldComponents:["Old","Other"],newComponents:["New"],eligible:true,selected:true,status:"ready",message:""}],completed:0,total:0}};
  const ui=modules._ujgESI_dueDateSyncUi.create({kind:"component"});
  dom.window.document.querySelector("#origin").focus();
  ui.render($("#host"),state,services);
  assert.match($(".ujg-esi-due-dialog").text(),/Old, Other/);
  assert.match($(".ujg-esi-due-dialog").text(),/New/);
  assert.ok(parseInt($(".ujg-esi-due-table").css("width"),10)<=1100);
  assert.match($(".ujg-esi-due-foot").text(),/полный набор заменится/);
  $(".ujg-esi-due-row-select").prop("checked",false).trigger("change");
  assert.deepEqual(calls.row,[["1",false]]);
  $(".ujg-esi-due-confirm").trigger("click");
  assert.equal(calls.confirm,1);
  $(".ujg-esi-due-columns-button").trigger("click");
  $('[data-due-visible="oldComponents"]').prop("checked",false).trigger("change");
  assert.ok(dom.window.localStorage.getItem("user-17:component-sync-ui"));
  assert.equal(dom.window.localStorage.getItem("user-17:due-date-sync-ui"),null);
  state.componentSync.open=false;ui.render($("#host"),state,services);
  assert.equal(dom.window.document.activeElement.id,"origin");
  ui.destroy();
});

test("known empty components have a label distinct from unknown and no replacement", t => {
  const dom=new JSDOM('<div id="host"></div>',{runScripts:"outside-only",url:"http://localhost"});
  t.after(()=>dom.window.close());
  const $=jquery(dom.window), modules={jquery:$};
  dom.window.define=(name,deps,factory)=>modules[name]=factory(...deps.map(dep=>modules[dep]));
  for(const file of ["icons","due-date-sync-ui"]) dom.window.eval(fs.readFileSync(path.join(__dirname,"../../ujg-excel-story-importer-modules",file+".js"),"utf8"));
  const ui=modules._ujgESI_dueDateSyncUi.create({kind:"component"});
  ui.render($("#host"),{preferencesStorageKey:"empty",componentSync:{open:true,loading:false,running:false,rows:[
    {id:"1",key:"P-1",oldComponents:[],newComponents:[],status:"skipped",eligible:false,selected:false},
    {id:"2",key:"P-2",oldComponents:null,newComponents:[],status:"skipped",eligible:false,selected:false}
  ]}},{});
  const cells=$(".ujg-esi-due-row");
  assert.equal(cells.eq(0).find("td").eq(4).text(),"Без компонентов");
  assert.equal(cells.eq(0).find("td").eq(5).text(),"—");
  assert.equal(cells.eq(1).find("td").eq(4).text(),"Неизвестно");
  ui.destroy();
});

test("destroying inactive due-date view retains component dialog document handlers", t => {
  const dom=new JSDOM('<div id="due"></div><div id="component"></div>',{runScripts:"outside-only",url:"http://localhost"});
  t.after(()=>dom.window.close());
  const $=jquery(dom.window), modules={jquery:$};
  dom.window.define=(name,deps,factory)=>modules[name]=factory(...deps.map(dep=>modules[dep]));
  for(const file of ["icons","due-date-sync-ui"]) dom.window.eval(fs.readFileSync(path.join(__dirname,"../../ujg-excel-story-importer-modules",file+".js"),"utf8"));
  const due=modules._ujgESI_dueDateSyncUi.create(), component=modules._ujgESI_dueDateSyncUi.create({kind:"component"});
  const calls={close:0}, state={preferencesStorageKey:"user",dueDateSync:{open:false,rows:[]},
    componentSync:{open:true,loading:false,running:false,rows:[]}};
  due.render($("#due"),state,{});
  component.render($("#component"),state,{onCloseComponentSync:()=>calls.close++});
  due.destroy();
  dom.window.document.dispatchEvent(new dom.window.KeyboardEvent("keydown",{key:"Escape",bubbles:true}));
  assert.equal(calls.close,1);
  component.destroy();
});

test("closing inactive component view retains due-date dialog document handlers", t => {
  const dom=new JSDOM('<div id="due"></div><div id="component"></div>',{runScripts:"outside-only",url:"http://localhost"});
  t.after(()=>dom.window.close());
  const $=jquery(dom.window), modules={jquery:$};
  dom.window.define=(name,deps,factory)=>modules[name]=factory(...deps.map(dep=>modules[dep]));
  for(const file of ["icons","due-date-sync-ui"]) dom.window.eval(fs.readFileSync(path.join(__dirname,"../../ujg-excel-story-importer-modules",file+".js"),"utf8"));
  const due=modules._ujgESI_dueDateSyncUi.create(), component=modules._ujgESI_dueDateSyncUi.create({kind:"component"});
  const calls={close:0}, state={preferencesStorageKey:"user",dueDateSync:{open:true,loading:false,running:false,rows:[]},
    componentSync:{open:true,loading:false,running:false,rows:[]}};
  component.render($("#component"),state,{onCloseComponentSync:()=>{}});
  state.componentSync.open=false;component.render($("#component"),state,{onCloseComponentSync:()=>{}});
  due.render($("#due"),state,{onCloseDueDateSync:()=>calls.close++});
  component.destroy();
  dom.window.document.dispatchEvent(new dom.window.KeyboardEvent("keydown",{key:"Escape",bubbles:true}));
  assert.equal(calls.close,1);
  due.destroy();
});
