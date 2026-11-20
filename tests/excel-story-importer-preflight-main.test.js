const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const load = require("./helpers/load-amd-module");
const dir = path.join(__dirname, "../ujg-excel-story-importer-modules");
const flush = () => new Promise(resolve => setTimeout(resolve, 0));
function setup(loader, options = {}) {
  let state, callbacks;
  const saved = [], parsed = [];
  const config = load(path.join(dir, "config.js"), {});
  const mapping = load(path.join(dir, "mapping-store.js"), {jquery:{},"_ujgESI_config":config});
  const parser = options.parser === "real" ? load(path.join(dir,"parser.js"), {"_ujgESI_config":config,_ujgESI_sheetjs:require("./helpers/importer-vendor-deps").sheetjs}) : options.parser || {
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
    "_ujgESI_parser":parser,"_ujgESI_creator":{},"_ujgESI_mappingStore":{...mapping,create:()=>({load:()=>Promise.resolve(mapping.normalizeSettings(options.settings)),save:s=>{saved.push(s);return Promise.resolve(s);}})},
    "_ujgESI_xlsxPatcher":null,"_ujgESI_rendering":{init:(_,svc)=>{callbacks=svc;},render:s=>{state=s;}},
    "_ujgShared_llmClient":null,"_ujgESI_teams":null,_ujgESI_sourceExport:null,_ujgESI_sourceExportApi:null,_ujgESI_remarkReportLoader:null, _ujgESI_activityLoader: require("./helpers/import-activity-loader"), "_ujgESI_activity":null,"_ujgESI_dueDateSync":null,"_ujgESI_componentSync":null,
    _ujgESI_deadlines:load(path.join(dir,"deadlines.js"),{})});
  new Gadget({getGadgetContentEl:()=>({find:()=>({length:1})})});
  return {get state(){return state;},get callbacks(){return callbacks;},saved,parsed,parser};
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

function book(headers, sheet = "Sheet", row = 1) {
  return {SheetNames:[sheet],Sheets:{[sheet]:{__rows:[...Array.from({length:row-1},()=>["cover"]),headers,headers.map((_,i)=>String(i+1))]}}};
}
const canonicalHeaders = ["ID","Замечание","Jira","Ответственный","Модуль","Приоритет","Статус в Jira","Исполнитель в Jira","Спринт","Срок"];
test("recognized real parser files always stage without turning automatic matches into global bindings", async () => {
  const x=setup(()=>Promise.resolve(book(canonicalHeaders,"Detected")),{parser:"real"});await flush();
  for (const name of ["first.xlsx","second.xlsx"]) {
    x.callbacks.onFileChange({name});await flush();
    assert.ok(x.state.pendingImport, "recognized file still requires confirmation");
    assert.equal(x.saved.length,name === "first.xlsx" ? 0 : 1);
    x.callbacks.onConfirmColumnImport();await flush();
    assert.equal(x.state.pendingImport,null);
    assert.equal(x.state.sourceFileName,name);
  }
  assert.equal(x.saved[0].sheetName,"Detected");
  assert.deepEqual(JSON.parse(JSON.stringify(x.saved[0].columnBindings)),{});
  assert.equal(x.state.sourceColumnSettings.columnBindings.owner.header,"Ответственный");
  x.callbacks.onFileChange({name:"cancel.xlsx"});await flush();
  x.callbacks.onCancelColumnImport();x.callbacks.onConfirmColumnImport();await flush();
  assert.equal(x.saved.length,2);assert.equal(x.state.sourceFileName,"second.xlsx");
});
test("missing inspection never parses or persists", async () => {
  let parses=0;
  const x=setup(undefined,{parser:{parseWorkbook(){parses++;return {rows:[]};}}});await flush();
  x.callbacks.onFileChange({name:"new.xlsx"});await flush();
  assert.equal(parses,0);assert.ok(x.state.pendingImport);assert.match(x.state.pendingImport.error,/проверить колонки/);
  x.callbacks.onConfirmColumnImport();assert.equal(parses,0);assert.equal(x.saved.length,0);
});
test("stale remembered sheet falls back to real parser detection", async () => {
  const x=setup(()=>Promise.resolve(book(canonicalHeaders,"Actual")),{parser:"real",settings:{sheetName:"Deleted"}});await flush();
  x.callbacks.onFileChange({name:"new.xlsx"});await flush();
  assert.equal(x.state.pendingImport.report.sheetName,"Actual");
  assert.ok(x.state.pendingImport.report.columns.length);
});
test("clearing numeric row and changing sheet reset manual row to auto", async () => {
  const x=setup();await flush();x.callbacks.onFileChange({name:"new"});await flush();
  x.callbacks.onImportHeaderChange(9);assert.equal(x.state.pendingImport.settings.headerRowNumber,9);
  x.callbacks.onImportHeaderChange("");assert.equal(x.state.pendingImport.settings.headerRowNumber,undefined);
  x.callbacks.onImportHeaderChange(8);x.state.pendingImport.workbook.SheetNames.push("Other");
  x.callbacks.onImportSheetChange("Other");assert.equal(x.state.pendingImport.settings.headerRowNumber,undefined);
});
test("manual header memory is scoped, re-detects moved rows, and survives two imports", async () => {
  let current=book(canonicalHeaders,"Sheet",5);
  const x=setup(()=>Promise.resolve(current),{parser:"real"});await flush();
  x.callbacks.onFileChange({name:"one"});await flush();x.callbacks.onImportHeaderChange(5);
  x.callbacks.onConfirmColumnImport();await flush();
  assert.equal(x.saved[0].headerSelection.headerRowNumber,5);
  current=book(canonicalHeaders,"Sheet",8);
  x.callbacks.onFileChange({name:"two"});await flush();
  assert.equal(x.state.pendingImport.report.headerRowNumber,8);
  x.callbacks.onConfirmColumnImport();await flush();
  assert.equal(x.saved[1].headerSelection.headerRowNumber,8);
  current=book(["Unrelated"],"Other",5);
  x.callbacks.onFileChange({name:"unrelated"});await flush();
  assert.equal(x.state.pendingImport.settings.headerRowNumber,undefined);
  x.callbacks.onCancelColumnImport();assert.equal(x.saved.length,2);
});

test("automatic ID alias changes across two imports without remembered binding pollution", async () => {
  let current=book(["ID"]);
  const x=setup(()=>Promise.resolve(current),{parser:"real"});await flush();
  const originalMap=JSON.stringify(x.state.mappingSettings.columnMap);
  x.callbacks.onFileChange({name:"first"});await flush();x.callbacks.onConfirmColumnImport();await flush();
  assert.equal(x.state.pendingImport,null);
  assert.deepEqual(JSON.parse(JSON.stringify(x.saved[0].columnBindings)),{});
  current=book(["№"]);
  x.callbacks.onFileChange({name:"second"});await flush();
  assert.equal(x.state.pendingImport.report.fields.find(f=>f.key==="remarkId").selectedIndex,0);
  x.callbacks.onConfirmColumnImport();await flush();
  assert.equal(x.state.pendingImport,null);assert.equal(x.state.rows[0].sourceColumns.ID,"1");
  assert.equal(JSON.stringify(x.state.mappingSettings.columnMap),originalMap);
  assert.deepEqual(JSON.parse(JSON.stringify(x.saved[1].columnBindings)),{});
});
test("missing manual columns and explicit skips survive sparse files and return on later import", async () => {
  let current=book(["ID"]);
  const x=setup(()=>Promise.resolve(current),{parser:"real",settings:{columnBindings:{owner:{header:"Custom owner",occurrence:0},summary:null}}});await flush();
  x.callbacks.onFileChange({name:"sparse"});await flush();x.callbacks.onConfirmColumnImport();await flush();
  assert.equal(x.state.pendingImport,null);
  assert.deepEqual(JSON.parse(JSON.stringify(x.saved[0].columnBindings)),{owner:{header:"Custom owner",occurrence:0},summary:null});
  assert.equal(x.state.sourceColumnSettings.columnBindings.owner,null);
  current=book(["ID","Custom owner"]);
  x.callbacks.onFileChange({name:"restored"});await flush();
  assert.equal(x.state.pendingImport.report.fields.find(f=>f.key==="owner").selectedIndex,1);
  x.callbacks.onConfirmColumnImport();await flush();
  assert.equal(x.state.sourceColumnSettings.columnBindings.owner.header,"Custom owner");
  assert.equal(x.saved[1].columnBindings.summary,null);
});
test("manual row pins actual sheet and wins over an earlier identical header", async () => {
  const current=book(canonicalHeaders,"Detected",1);
  current.Sheets.Detected.__rows.push([],canonicalHeaders,canonicalHeaders.map((_,i)=>String(i+11)));
  current.SheetNames.unshift("Cover");current.Sheets.Cover={__rows:[["cover"],["ID"],["wrong"]]};
  const x=setup(()=>Promise.resolve(current),{parser:"real",settings:{sheetName:"Detected"}});await flush();
  x.callbacks.onFileChange({name:"first"});await flush();
  // The user sees Detected even when sheet selection is in automatic mode.
  x.state.pendingImport.settings.sheetName="";
  x.callbacks.onImportHeaderChange(4);
  assert.equal(x.state.pendingImport.settings.sheetName,"Detected");
  assert.equal(x.state.pendingImport.report.headerRowNumber,4);
  x.callbacks.onConfirmColumnImport();await flush();
  x.callbacks.onFileChange({name:"second"});await flush();
  assert.equal(x.state.pendingImport.report.sheetName,"Detected");
  assert.equal(x.state.pendingImport.report.headerRowNumber,4);
  assert.equal(x.state.pendingImport.settings.headerRowNumber,4);
});

test("same sheet name with a different layout cannot inherit remembered manual row", async () => {
  let current=book(canonicalHeaders,"Sheet",5);
  const x=setup(()=>Promise.resolve(current),{parser:"real"});await flush();
  x.callbacks.onFileChange({name:"original"});await flush();x.callbacks.onImportHeaderChange(5);
  x.callbacks.onImportColumnChoice("owner",null);
  x.callbacks.onConfirmColumnImport();await flush();
  assert.equal(x.saved[0].columnBindings.owner,null);
  current=book(["ID","Different"],"Sheet",2);
  x.callbacks.onFileChange({name:"unrelated-layout"});await flush();
  assert.equal(x.state.pendingImport.settings.headerRowNumber,undefined);
  assert.equal(x.state.pendingImport.report.headerRowNumber,2);
  assert.equal(x.state.pendingImport.settings.columnBindings.owner,null);
  x.callbacks.onCancelColumnImport();x.callbacks.onConfirmColumnImport();await flush();
  assert.equal(x.saved.length,1);assert.equal(x.state.sourceFileName,"original");
});
test("explicit numeric zero returns manual row to automatic detection", async () => {
  const x=setup();await flush();x.callbacks.onFileChange({name:"new"});await flush();
  x.callbacks.onImportHeaderChange(9);x.callbacks.onImportHeaderChange(0);
  assert.equal(x.state.pendingImport.settings.headerRowNumber,undefined);
  assert.equal(x.state.pendingImport.settings.headerSelection,null);
});

test("editing one binding and confirming use the displayed location without remembering a manual row", async () => {
  const x=setup(()=>Promise.resolve(book(canonicalHeaders,"Detected",3)),{parser:"real"});await flush();
  x.callbacks.onFileChange({name:"edit"});await flush();
  const shown=x.state.pendingImport.report;
  const inspect=x.parser.inspectWorkbook, inspections=[];
  x.parser.inspectWorkbook=(workbook,settings)=>{inspections.push({...settings});return inspect(workbook,settings);};
  assert.equal(x.state.pendingImport.settings.sheetName,"");
  x.callbacks.onImportColumnChoice("owner",3);
  assert.equal(inspections[0].sheetName,shown.sheetName);
  assert.equal(inspections[0].headerRowNumber,shown.headerRowNumber);
  assert.equal(x.state.pendingImport.settings.sheetName,"");
  assert.equal(x.state.pendingImport.settings.headerRowNumber,undefined);
  assert.equal(x.state.pendingImport.report.sheetName,shown.sheetName);
  assert.equal(x.state.pendingImport.report.headerRowNumber,shown.headerRowNumber);
  x.callbacks.onConfirmColumnImport();await flush();
  assert.equal(inspections[1].sheetName,shown.sheetName);
  assert.equal(inspections[1].headerRowNumber,shown.headerRowNumber);
  assert.equal(x.saved[0].headerSelection,null);
});

test("automatic start bypasses a remembered empty sheet while explicit sheet clicks keep it", async () => {
  for (const emptyRows of [[],[canonicalHeaders]]) {
    const workbook=book(canonicalHeaders,"Working",2);
    workbook.SheetNames.unshift("Empty");workbook.Sheets.Empty={__rows:emptyRows};
    const x=setup(()=>Promise.resolve(workbook),{parser:"real",settings:{sheetName:"Empty",
      headerSelection:{sheetName:"Empty",headerRowNumber:1,signature:JSON.stringify(canonicalHeaders.map((h,i)=>[i,h,0]))}}});await flush();
    x.callbacks.onFileChange({name:"new"});await flush();
    assert.equal(x.state.pendingImport.report.sheetName,"Working");
    assert.equal(x.state.pendingImport.settings.headerRowNumber,undefined);
    x.callbacks.onImportSheetChange("Empty");
    assert.equal(x.state.pendingImport.settings.sheetName,"Empty");
    assert.equal(x.state.pendingImport.report.sheetName,"Empty");
    assert.equal(x.state.pendingImport.report.canApply,false);
    x.callbacks.onConfirmColumnImport();assert.ok(x.state.pendingImport);assert.equal(x.saved.length,0);
    x.callbacks.onImportSheetChange("Working");x.callbacks.onConfirmColumnImport();await flush();
    assert.equal(x.state.sourceFileName,"new");
  }
});
