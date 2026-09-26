const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const load = require("./helpers/load-amd-module");
const dir = path.join(__dirname, "../ujg-excel-story-importer-modules");
const flush = () => new Promise(resolve => setTimeout(resolve, 0));
function setup(loader) {
  let state, callbacks;
  const saved = [], parsed = [];
  const config = load(path.join(dir, "config.js"), {});
  const mapping = load(path.join(dir, "mapping-store.js"), {jquery:{},"_ujgESI_config":config});
  const parser = {
    inspectWorkbook(book, settings) {
      const chosen = settings.columnBindings && settings.columnBindings.owner;
      return {sheetName:settings.sheetName || "Sheet",headerRowNumber:settings.headerRowNumber || 1,sheetNames:["Sheet","Other"],
        columns:[{index:0,header:"New owner",letter:"A",occurrence:0,examples:["Ann"]}],
        fields:[{key:"owner",label:"Ответственный",selectedIndex:chosen ? 0 : null,status:chosen ? "matched":"missing"}],
        counts:{total:1,visible:1,hidden:0},canApply:!!chosen,needsReview:!chosen};
    },
    parseWorkbook(book, settings) {
      if (book.fail) throw new Error("bad parse");
      parsed.push(settings);
      return {sheetName:"Sheet",headerRowNumber:1,headerColumns:{},rows:[{id:book.id,summary:book.id}]};
    }
  };
  const Gadget=load(path.join(dir,"main.js"),{jquery:()=>({length:1}),"_ujgESI_config":config,
    "_ujgESI_api":{getProjects:()=>Promise.resolve([])},"_ujgESI_excel-loader":{readWorkbook:loader || (file=>Promise.resolve({id:file.name,SheetNames:["Sheet"]}))},
    "_ujgESI_parser":parser,"_ujgESI_creator":{},"_ujgESI_mappingStore":{...mapping,create:()=>({load:()=>Promise.resolve(mapping.defaultSettings()),save:s=>{saved.push(s);return Promise.resolve(s);}})},
    "_ujgESI_xlsxPatcher":null,"_ujgESI_rendering":{init:(_,svc)=>{callbacks=svc;},render:s=>{state=s;}},
    "_ujgShared_llmClient":null,"_ujgESI_teams":null,"_ujgESI_activity":null,"_ujgESI_dueDateSync":null,"_ujgESI_componentSync":null});
  new Gadget({getGadgetContentEl:()=>({find:()=>({length:1})})});
  return {get state(){return state;},get callbacks(){return callbacks;},saved,parsed};
}
test("preflight stages new workbook and cancel preserves old rows, file and settings", async () => {
  const x=setup(); await flush();
  x.state.rows=[{id:"old"}];x.state.sourceWorkbook={id:"old"};x.state.sourceFileName="old.xlsx";
  x.callbacks.onFileChange({name:"new.xlsx"});await flush();
  assert.equal(x.state.rows[0].id,"old");
  assert.equal(x.state.sourceFileName,"old.xlsx");
  assert.equal(x.state.pendingImport.fileName,"new.xlsx");
  assert.equal(x.parsed.length,0);
  x.callbacks.onCancelColumnImport();
  assert.equal(x.state.pendingImport,null);assert.equal(x.state.sourceWorkbook.id,"old");assert.equal(x.saved.length,0);
});
test("confirmed choice commits once and remember false does not persist mappings", async () => {
  const x=setup();await flush();
  const old=x.state.mappingSettings.columnMap.owner;
  x.callbacks.onFileChange({name:"new.xlsx"});await flush();
  x.callbacks.onImportColumnChoice("owner",0);
  x.callbacks.onImportRememberChange(false);
  x.callbacks.onConfirmColumnImport();await flush();
  assert.equal(x.state.rows[0].id,"new.xlsx");assert.equal(x.state.pendingImport,null);
  assert.equal(x.state.mappingSettings.columnMap.owner,old);assert.equal(x.saved.length,0);
  assert.equal(x.parsed[0].columnBindings.owner.header,"New owner");
  x.callbacks.onConfirmColumnImport();assert.equal(x.parsed.length,1);
});
test("remembered mapping persists only after valid confirmation", async () => {
  const x=setup();await flush();x.callbacks.onFileChange({name:"new.xlsx"});await flush();
  x.callbacks.onConfirmColumnImport();assert.equal(x.saved.length,0);assert.equal(x.parsed.length,0);
  x.callbacks.onImportColumnChoice("owner",0);x.callbacks.onConfirmColumnImport();await flush();
  assert.equal(x.saved.length,1);assert.equal(x.saved[0].columnBindings.owner.header,"New owner");
  assert.equal(x.saved[0].headerRowNumber,undefined);
});
test("parse failure keeps the previous workbook and the editable review", async () => {
  const x=setup(()=>Promise.resolve({id:"bad",fail:true,SheetNames:["Sheet"]}));await flush();
  x.state.rows=[{id:"old"}];x.state.sourceWorkbook={id:"old"};
  x.callbacks.onFileChange({name:"bad"});await flush();
  x.callbacks.onImportColumnChoice("owner",0);x.callbacks.onConfirmColumnImport();
  assert.equal(x.state.rows[0].id,"old");assert.equal(x.state.sourceWorkbook.id,"old");
  assert.match(x.state.pendingImport.error,/bad parse/);assert.equal(x.saved.length,0);
});
test("late file reads cannot replace the latest review", async () => {
  const resolves={};const x=setup(f=>new Promise(resolve=>{resolves[f.name]=resolve;}));await flush();
  x.callbacks.onFileChange({name:"a"});x.callbacks.onFileChange({name:"b"});
  resolves.b({id:"b",SheetNames:["Sheet"]});await flush();
  resolves.a({id:"a",SheetNames:["Sheet"]});await flush();
  assert.equal(x.state.pendingImport.fileName,"b");assert.equal(x.parsed.length,0);
});
