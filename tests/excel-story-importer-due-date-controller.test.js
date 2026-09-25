const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const load = require("./helpers/load-amd-module");
const dir = path.join(__dirname, "../ujg-excel-story-importer-modules");
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

async function setup() {
  const app = {modalRenders:0, fullRenders:0, calls:[]};
  const config = load(path.join(dir, "config.js"), {});
  const dueState = {open:false,loading:false,running:false,rows:[]};
  let changed;
  const controller = {
    getState: () => dueState,
    open: (rows, options) => { app.calls.push(["open", rows, options]); dueState.open=true; changed(dueState); },
    close: () => { if(dueState.running) return false; dueState.open=false; changed(dueState); return true; },
    select: (...args) => app.calls.push(["select", ...args]),
    selectAll: (...args) => app.calls.push(["all", ...args]),
    confirm: () => app.calls.push(["confirm"])
  };
  const Gadget = load(path.join(dir,"main.js"), {
    jquery: () => ({length:0}), _ujgESI_config:config,
    _ujgESI_api:{getProjects:()=>Promise.resolve([]),getProjectEpics:()=>Promise.resolve({issues:[]}),getProjectCreateMeta:()=>Promise.resolve({projects:[]})},
    "_ujgESI_excel-loader": {readFileBuffer:()=>Promise.resolve(new ArrayBuffer(1)),readWorkbookFromBuffer:()=>Promise.resolve({SheetNames:["Sheet1"]})},
    _ujgESI_parser:{parseWorkbook:()=>({sheetName:"Sheet1",rows:[{id:"1",jiraKey:"TEST-1",sourceColumns:{"Срок":"2026-09-30"}}]})},
    _ujgESI_creator:{}, _ujgESI_mappingStore:null, _ujgESI_xlsxPatcher:{},
    _ujgShared_llmClient:null, _ujgESI_teams:null, _ujgESI_activity:null,
    _ujgESI_rendering:{init:(_,callbacks)=>{app.callbacks=callbacks;},render:state=>{app.state=state;app.fullRenders++;},renderDueDateSync:state=>{app.state=state;app.modalRenders++;}},
    _ujgESI_dueDateSync:{create:options=>{changed=options.onChange;return controller;}}
  });
  new Gadget({getGadgetContentEl:()=>({find:()=>({length:1})}),resize(){}});
  await flush(); app.callbacks.onFileChange({name:"source.xlsx"}); await flush(); await flush();
  return {...app, controller, dueState, changed, ref:app};
}

test("due sync opens a frozen Excel plan and renders progress without remounting the registry", async () => {
  const app=await setup(), cb=app.callbacks;
  assert.equal(typeof cb.onOpenDueDateSync, "function");
  cb.onOpenDueDateSync();
  assert.equal(app.calls[0][0], "open");
  assert.equal(app.calls[0][1][0].jiraKey, "TEST-1");
  const renders=app.ref.fullRenders;
  app.changed(app.dueState);
  assert.equal(app.ref.fullRenders,renders);
  assert.ok(app.ref.modalRenders>0);
  cb.onSelectDueDateSyncRow("1",false); cb.onSelectAllDueDateSync(true); cb.onConfirmDueDateSync();
  assert.deepEqual(app.calls.slice(1),[["select","1",false],["all",true],["confirm"]]);
  cb.onOpenDueDateSync(); assert.equal(app.calls.filter(c=>c[0]==="open").length,1);
  cb.onCloseDueDateSync(); assert.equal(app.dueState.open,false);
  app.state.viewMode="jira"; cb.onOpenDueDateSync(); assert.equal(app.dueState.open,false);
});

test("source changes close previews, while a running due-date queue blocks context changes", async () => {
  const app=await setup(), cb=app.callbacks;
  assert.equal(typeof cb.onOpenDueDateSync, "function");
  cb.onOpenDueDateSync(); cb.onProjectChange("OTHER"); assert.equal(app.dueState.open,false);
  await flush();
  cb.onOpenDueDateSync(); cb.onMappingColumnChange("deadline","Срок"); assert.equal(app.dueState.open,false);
  cb.onOpenDueDateSync(); app.dueState.running=true;
  const original={project:app.state.projectKey,epic:app.state.epicKey,file:app.state.sourceFileName,view:app.state.viewMode,map:JSON.stringify(app.state.mappingSettings)};
  cb.onProjectChange("BLOCKED"); cb.onEpicSelect("BLOCKED-1"); cb.onFileChange({name:"blocked.xlsx"});
  cb.onViewModeChange("jira"); cb.onReportViewChange("activity"); cb.onMappingColumnChange("deadline","Other");
  cb.onOpenMappings(); cb.onCloseDueDateSync();
  assert.equal(app.state.projectKey,original.project); assert.equal(app.state.epicKey,original.epic);
  assert.equal(app.state.sourceFileName,original.file); assert.equal(app.state.viewMode,original.view);
  assert.equal(JSON.stringify(app.state.mappingSettings),original.map); assert.equal(app.state.reportView,"registry");
  assert.equal(app.state.mappingEditorOpen,false); assert.equal(app.dueState.open,true);
});
