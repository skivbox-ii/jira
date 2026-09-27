const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path");
const {JSDOM}=require("jsdom"),jquery=require("jquery");
const dir=path.join(__dirname,"../../ujg-excel-story-importer-modules");
function setup() {
  const dom=new JSDOM('<button id="a">AI</button>',{runScripts:"outside-only",url:"http://localhost"}),$=jquery(dom.window),calls=[],pending=[],loads=[];
  const modules={jquery:$,_ujgESI_marked:require("../../vendor/marked-16.4.2.umd.js")};
  const plan={key:"PR-1",remarkId:"52",title:"Исходное замечание",asOf:"2026-09-27T12:35:00Z",
    coverage:{totalTasks:3,completeTasks:3,totalComments:5,commentsComplete:5,eventCount:24,isComplete:true},canGenerate:true,blockers:[],warnings:[],
    meta:{userBytes:12000,userLimit:18000,systemBytes:1400,systemLimit:4000},request:{systemPrompt:"Rules",userPrompt:"Полные комментарии"}};
  modules._ujgESI_remarkReport={prepare:(row,teams,options)=>{calls.push({prepare:options,row});return row.blocked?{...plan,canGenerate:false,blockers:["Комментарии неполны"]}:plan;},run:async(p,request,options)=>{calls.push({run:p,options});const result=await request(p.request);return {markdown:result.text};}};
  dom.window.define=(name,deps,factory)=>modules[name]=factory(...deps.map(dep=>modules[dep]));
  for(const file of ["icons","activity-markdown","llm-diagnostics-ui","remark-report-ui"])dom.window.eval(fs.readFileSync(path.join(dir,file+".js"),"utf8"));
  const ui=modules._ujgESI_remarkReportUi.create(),state={baseUrl:"https://jira.test",projectKey:"PR",epicKey:"PR-99",viewMode:"jira",teams:[]};
  const services={onLoadRemarkReport:(key,options)=>{loads.push({key,options});return new Promise((resolve,reject)=>pending.push({resolve,reject}));},onActivityLlmRequest:request=>{calls.push({request});return Promise.resolve({text:"# Итог\n[QA] PR-2 проверена. <script>bad()</script>\n[bad](javascript:alert(1))"});}};
  const open=()=>ui.open({key:"PR-1",remarkId:"52",summary:"Замечание"},state,services,$("#a")[0]);
  return {dom,$,ui,services,state,calls,pending,loads,open,flush:()=>new Promise(resolve=>setImmediate(resolve))};
}
test("opening prepares whole remark without LLM and explicit generation is single and safe",async t=>{
  const x=setup();t.after(()=>{x.ui.destroy();x.dom.window.close();});x.open();await x.flush();
  assert.equal(x.loads.length,1);assert.equal(x.calls.length,0);
  assert.match(x.$(".ujg-esi-remark-report-dialog").text(),/52/);
  assert.equal(x.$(".ujg-esi-remark-generate").prop("disabled"),true);
  x.pending[0].resolve({row:{},asOf:"2026-09-27T12:35:00Z",sourceWarnings:[]});await x.flush();
  assert.match(x.$(".ujg-esi-remark-coverage").text(),/3.*3/);
  assert.match(x.$(".ujg-esi-remark-coverage").text(),/5/);
  assert.match(x.$(".ujg-esi-remark-context").text(),/Полные комментарии/);
  assert.match(x.$(".ujg-esi-remark-meta").text(),/15:35.*МСК/);
  assert.match(x.$(".ujg-esi-remark-meta").text(),/27\.09\.2026/);
  x.$(".ujg-esi-remark-generate").trigger("click");x.$(".ujg-esi-remark-generate").trigger("click");await x.flush();
  assert.equal(x.calls.filter(c=>c.request).length,1);
  assert.equal(x.$(".ujg-esi-remark-answer a[href='https://jira.test/browse/PR-2']").length,1);
  assert.equal(x.$(".ujg-esi-remark-answer script").length,0);
  assert.equal(x.$(".ujg-esi-remark-answer a[href^='javascript']").length,0);
});
test("partial data block report without silent generation",async t=>{
  const x=setup();t.after(()=>{x.ui.destroy();x.dom.window.close();});x.open();await x.flush();
  x.pending[0].resolve({row:{blocked:true},asOf:"2026-09-27T12:35:00Z"});await x.flush();
  assert.match(x.$(".ujg-esi-remark-errors").text(),/неполны/);
  x.$(".ujg-esi-remark-generate").trigger("click");await x.flush();assert.equal(x.calls.filter(c=>c.request).length,0);
});
test("close cancels loading and late old result cannot replace another remark",async t=>{
  const x=setup();t.after(()=>{x.ui.destroy();x.dom.window.close();});x.open();await x.flush();
  x.$(".ujg-esi-remark-close").trigger("click");assert.equal(x.loads[0].options.isCancelled(),true);
  assert.equal(x.$(".ujg-esi-remark-report-dialog").length,0);assert.equal(x.dom.window.document.activeElement.id,"a");
  x.open();await x.flush();x.pending[0].resolve({row:{},asOf:"2026-09-27T12:35:00Z"});await x.flush();
  assert.equal(x.calls.length,0);assert.equal(x.$(".ujg-esi-remark-generate").prop("disabled"),true);
});
test("scope change cancels outstanding response; date change does not narrow full lifecycle",async t=>{
  const x=setup();t.after(()=>{x.ui.destroy();x.dom.window.close();});x.open();await x.flush();
  x.ui.updateScope({...x.state,activityDate:"2026-09-20"});assert.equal(x.$(".ujg-esi-remark-report-dialog").length,1);
  x.ui.updateScope({...x.state,projectKey:"OTHER"});assert.equal(x.$(".ujg-esi-remark-report-dialog").length,0);
  assert.equal(x.loads[0].options.isCancelled(),true);
});
test("failure permits only manual reread and error is retained until then",async t=>{
  const x=setup();t.after(()=>{x.ui.destroy();x.dom.window.close();});x.open();await x.flush();
  x.pending[0].reject(new Error("Недоступно"));await x.flush();
  assert.match(x.$(".ujg-esi-remark-errors").text(),/Недоступно/);assert.equal(x.loads.length,1);
  x.$(".ujg-esi-remark-refresh").trigger("click");await x.flush();assert.equal(x.loads.length,2);
});
test("late LLM completion cannot re-open dismissed dialog or contaminate new preview",async t=>{
  const x=setup();t.after(()=>{x.ui.destroy();x.dom.window.close();});let finish;
  x.services.onActivityLlmRequest=()=>new Promise(resolve=>finish=resolve);
  x.open();await x.flush();x.pending[0].resolve({row:{},asOf:"2026-09-27T12:35:00Z"});await x.flush();
  x.$(".ujg-esi-remark-generate").trigger("click");await x.flush();x.ui.dismiss();x.open();await x.flush();
  finish({text:"Old reply"});await x.flush();assert.equal(x.$(".ujg-esi-remark-answer").text(),"");
});
test("same-scope dataset replacement invalidates a prepared snapshot",async t=>{
  const x=setup();t.after(()=>{x.ui.destroy();x.dom.window.close();});x.state.rows=[];x.open();await x.flush();
  x.pending[0].resolve({row:{},asOf:"2026-09-27T12:35:00Z"});await x.flush();
  x.ui.updateScope({...x.state,rows:[]});
  assert.equal(x.$(".ujg-esi-remark-report-dialog").length,0);
  assert.equal(x.calls.filter(c=>c.request).length,0);
});
test("background redraw returns focus to replacement group action",async t=>{
  const x=setup();t.after(()=>{x.ui.destroy();x.dom.window.close();});x.open();await x.flush();
  x.$("#a").remove();const fresh=x.$('<button data-remark-key="PR-1">AI</button>').appendTo(x.dom.window.document.body)[0];
  assert.equal(typeof x.ui.rebindAnchor,"function");x.ui.rebindAnchor([fresh]);
  x.ui.dismiss();assert.equal(x.dom.window.document.activeElement,fresh);
  assert.equal(x.$(fresh).attr("aria-expanded"),"false");
});
test("failed LLM trace remains available and opening diagnostics sends no request",async t=>{
  const x=setup();t.after(()=>{x.ui.destroy();x.dom.window.close();});
  x.services.onActivityLlmRequest=(part,options)=>{x.calls.push({request:part});options.onTrace({id:"remark",outcome:"error",phase:"headers",summary:"HTTP 502",request:{url:"https://llm.test",model:"m",body:"payload"},response:{status:502},stages:[{name:"headers",status:"error",durationMs:2}]});return Promise.reject(new Error("Ошибка заголовков"));};
  x.open();await x.flush();x.pending[0].resolve({row:{},asOf:"2026-09-27T12:35:00Z"});await x.flush();
  x.$(".ujg-esi-remark-generate").trigger("click");await x.flush();
  assert.match(x.$(".ujg-esi-remark-errors").text(),/Ошибка заголовков/);
  assert.equal(x.$(".ujg-esi-llm-diagnostic-open").prop("hidden"),false);
  x.$(".ujg-esi-llm-diagnostic-open").trigger("click");
  assert.match(x.$(".ujg-esi-llm-diagnostic-panel").text(),/502/);
  assert.equal(x.calls.filter(c=>c.request).length,1);
});
