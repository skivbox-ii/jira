const fs = require("node:fs");
const path = require("node:path");
const {execFileSync} = require("node:child_process");
const {performance} = require("node:perf_hooks");
const {JSDOM} = require("jsdom");
const jquery = require("jquery");
const load = require("../helpers/load-amd-module");
const root = path.join(__dirname,"../.."), dir = path.join(root,"ujg-excel-story-importer-modules");
const activity = load(path.join(dir,"activity.js"),{
  _ujgESI_teams:load(path.join(dir,"teams.js"),{}),
  _ujgESI_remarkId:load(path.join(dir,"remark-id.js"),{}),
  _ujgESI_deadlines:load(path.join(dir,"deadlines.js"),{_ujgESI_config:{}})
});
const dom = new JSDOM('<div id="root"></div>',{runScripts:"outside-only",url:"http://localhost"}), $ = jquery(dom.window);
const groups = Array.from({length:100},(_,index)=>{
  const issueKey="PERF-"+(index+1);
  const events=Array.from({length:6},(_,i)=>({id:issueKey+":"+i,issueKey,at:`2026-09-26T09:0${Math.floor(i/2)}:00Z`,kind:"status",field:"status",from:"Open",to:"In Progress",author:{label:"Тестовый автор",identifiers:["test"]},assignee:{label:"Исполнитель"},role:"BE"}));
  return {id:issueKey,key:issueKey,remarkId:String(index+1),summary:"Тестовое замечание для измерения журнала",events,linkedTaskCount:0,dayHighlights:{},components:[],screenForms:[]};
});
const report={date:"2026-09-26",coverage:{complete:100,total:100,isComplete:true},metrics:{events:600,changed:100},balance:{},groups,events:groups.flatMap(g=>g.events),transitions:[],transfers:[]};
let summarizeCalls=0;
const modules={jquery:$,_ujgESI_activity:{...activity,summarize(){summarizeCalls++;return report;}},_ujgESI_activityAiUi:{create:()=>({update(){},rebindAnchor(){},destroy(){}})}};
dom.window.define=(name,deps,factory)=>modules[name]=factory(...deps.map(dep=>modules[dep]));
for(const file of ["icons.js","activity-management-ui.js","activity-ui.js"]){
  const source=process.argv[2] && file==="activity-ui.js" ? execFileSync("git",["show",process.argv[2]+":ujg-excel-story-importer-modules/"+file],{cwd:root,encoding:"utf8"}) : fs.readFileSync(path.join(dir,file),"utf8");
  dom.window.eval(source);
}
const view=modules._ujgESI_activityUi.create(), start=performance.now();
view.render($("#root"),{rows:[],teams:[],projectKey:"PERF"},{});
const initialMs=performance.now()-start, beforeCalls=summarizeCalls, sibling=$(".ujg-esi-activity-event").last()[0], toggleStart=performance.now();
$(".ujg-esi-activity-group-toggle").first().trigger("click");
const toggleMs=performance.now()-toggleStart;
console.log(JSON.stringify({revision:process.argv[2]||"working",groups:groups.length,events:report.events.length,initialMs:Math.round(initialMs),toggleMs:Math.round(toggleMs),extraSummarizeCalls:summarizeCalls-beforeCalls,siblingPreserved:sibling===$(".ujg-esi-activity-event").last()[0]}));
view.destroy();dom.window.close();
