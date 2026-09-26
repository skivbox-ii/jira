const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const load = require("./helpers/load-amd-module");
const dir = path.join(__dirname,"../ujg-excel-story-importer-modules");
const flush = () => new Promise(resolve => setTimeout(resolve,0));

test("Excel component command freezes project mapping and blocks context changes while running", async () => {
  const app={calls:[]}, config=load(path.join(dir,"config.js"),{});
  const componentState={open:false,loading:false,running:false,rows:[]};
  let changed;
  const controller={getState:()=>componentState,
    open:(rows,settings)=>{app.calls.push(["open",rows,settings]);componentState.open=true;changed(componentState);},
    close:()=>{if(componentState.running)return false;componentState.open=false;changed(componentState);return true;},
    select:(...args)=>app.calls.push(["select",...args]),selectAll:(...args)=>app.calls.push(["all",...args]),confirm:()=>app.calls.push(["confirm"])};
  const Gadget=load(path.join(dir,"main.js"),{
    jquery:()=>({length:0}),_ujgESI_config:config,
    _ujgESI_api:{getProjects:()=>Promise.resolve([]),getProjectEpics:()=>Promise.resolve({issues:[]}),getProjectCreateMeta:()=>Promise.resolve({projects:[]})},
    "_ujgESI_excel-loader":{readFileBuffer:()=>Promise.resolve(new ArrayBuffer(1)),readWorkbookFromBuffer:()=>Promise.resolve({SheetNames:["Sheet1"]})},
    _ujgESI_parser:{parseWorkbook:()=>({sheetName:"Sheet1",rows:[{id:"1",jiraKey:"TEST-1",sourceColumns:{"Модуль":"A"}}]})},
    _ujgESI_creator:{},_ujgESI_mappingStore:null,_ujgESI_xlsxPatcher:{},_ujgShared_llmClient:null,
    _ujgESI_teams:null,_ujgESI_activity:null,
    _ujgESI_rendering:{init:(_,callbacks)=>{app.callbacks=callbacks;},render:state=>{app.state=state;app.fullRenders=(app.fullRenders||0)+1;},renderDueDateSync:state=>{app.state=state;}},
    _ujgESI_dueDateSync:null,_ujgESI_componentSync:{create:options=>{changed=options.onChange;app.updated=options.onUpdated;return controller;}}
  });
  new Gadget({getGadgetContentEl:()=>({find:()=>({length:1})}),resize(){}});
  for(let i=0;i<10 && (!app.state || app.state.loading);i++) await flush();
  app.callbacks.onFileChange({name:"source.xlsx"});
  for(let i=0;i<10 && app.state.loading;i++) await flush();
  app.callbacks.onProjectChange("TEST");
  for(let i=0;i<10 && app.state.loading;i++) await flush();
  app.callbacks.onOpenComponentSync();
  assert.equal(app.calls[0] && app.calls[0][0],"open");
  assert.equal(app.calls[0][1][0].jiraKey,"TEST-1");
  assert.equal(app.calls[0][2].projectKey,"TEST");
  assert.equal(app.state.componentSync.open,true);
  app.callbacks.onSelectComponentSyncRow("1",false);
  app.callbacks.onSelectAllComponentSync(true);
  app.callbacks.onConfirmComponentSync();
  assert.deepEqual(app.calls.slice(1),[["select","1",false],["all",true],["confirm"]]);
  componentState.running=true;
  app.callbacks.onProjectChange("OTHER");app.callbacks.onFileChange({name:"other.xlsx"});
  app.callbacks.onViewModeChange("jira");app.callbacks.onOpenMappings();
  assert.equal(app.state.projectKey,"TEST");
  assert.equal(app.state.sourceFileName,"source.xlsx");
  assert.equal(app.state.viewMode,"excel");
  assert.equal(app.state.mappingEditorOpen,false);
  app.state.rows[0].storyDetails={components:[],componentsKnown:true};
  const renders=app.fullRenders;
  app.updated("TEST-1",{id:"1",name:"New"});
  app.updated("TEST-1",{id:"1",name:"New"});
  changed(componentState);
  assert.equal(app.fullRenders,renders);
  componentState.running=false;changed(componentState);
  assert.equal(app.fullRenders,renders+1);
  assert.deepEqual(JSON.parse(JSON.stringify(app.state.rows[0].storyDetails.components)),[{id:"1",name:"New"}]);
  app.callbacks.onProjectChange("OTHER");
  assert.equal(app.state.componentSync.open,false);
});
