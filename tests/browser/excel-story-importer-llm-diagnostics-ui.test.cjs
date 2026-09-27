const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path");
const {JSDOM}=require("jsdom"),jquery=require("jquery");
function setup() {
  const dom=new JSDOM('<section id="report"><button id="parent">Parent</button></section>',{runScripts:"outside-only",url:"http://localhost"});
  const $=jquery(dom.window),modules={jquery:$};
  modules._ujgESI_icons=name=>$("<span/>").text(name);
  dom.window.define=(name,deps,factory)=>modules[name]=factory(...deps.map(dep=>modules[dep]));
  dom.window.eval(fs.readFileSync(path.join(__dirname,"../../ujg-excel-story-importer-modules/llm-diagnostics-ui.js"),"utf8"));
  const view=modules._ujgESI_llmDiagnosticsUi.create($("#report"));
  $("#report").append(view.button());
  return {dom,$,view};
}
function trace(overrides={}) {return {id:"a",startedAt:"2026-09-27T10:00:00Z",endedAt:null,durationMs:17,outcome:"error",phase:"json",summary:"Invalid JSON",request:{url:"https://llm.test/v1",method:"POST",model:"model-x",headers:{"content-type":"application/json"},credentials:"redacted",body:'{"prompt":"hello"}',bodyBytes:18,systemBytes:3,userBytes:5,bodyTruncated:false},response:{status:502,statusText:"Bad Gateway",url:"https://llm.test/v1",type:"basic",redirected:false,headers:{},body:"bad",bodyBytes:3,bodyTruncated:false,format:"text",jsonShape:null,finishReason:null,usage:{inputTokens:12,outputTokens:4,totalTokens:16,source:"provider"}},stages:[{name:"prepare",startedMs:0,durationMs:2,status:"ok"},{name:"json",startedMs:10,durationMs:7,status:"error"}],network:null,limitations:["usage unavailable for other attempts"],...overrides};}
test("trace shows stage, JSON state, usage and unknown fields as text",t=>{
  const x=setup();t.after(()=>x.dom.window.close());x.view.record(trace());x.view.open();
  const panel=x.$(".ujg-esi-llm-diagnostic-panel");
  assert.match(panel.text(),/JSON|json/);assert.match(panel.text(),/502/);assert.match(panel.text(),/12/);
  assert.match(panel.text(),/Данные провайдера/);
  assert.match(panel.text(),/неизвестно|нет данных/i);assert.equal(panel.find("img,iframe,script").length,0);
  assert.equal(panel.find("pre").filter((_,el)=>el.textContent.includes('"prompt"')).length,1);
});
test("panel closes on Escape without closing its report and restores focus",t=>{
  const x=setup();t.after(()=>x.dom.window.close());x.view.record(trace());x.view.open();
  x.$(".ujg-esi-llm-diagnostic-panel").trigger(x.$.Event("keydown",{key:"Escape"}));
  assert.equal(x.$("#report").length,1);assert.equal(x.$(".ujg-esi-llm-diagnostic-panel:visible").length,0);
  assert.equal(x.dom.window.document.activeElement,x.view.button()[0]);
});
test("bounded traces report omitted count and clear on new run",t=>{
  const x=setup();t.after(()=>x.dom.window.close());for(let i=0;i<12;i++)x.view.record(trace({id:String(i)}));x.view.open();
  assert.match(x.$(".ujg-esi-llm-diagnostic-panel").text(),/2.*пропущ|пропущ.*2/i);
  assert.equal(x.$(".ujg-esi-llm-diagnostic-attempt").length,10);
  x.view.clear();assert.equal(x.view.button().prop("hidden"),true);
});
test("JSON export uses current sanitized snapshot and warning",t=>{
  const x=setup();t.after(()=>x.dom.window.close());x.view.record(trace());x.view.open();
  assert.match(x.$(".ujg-esi-llm-diagnostic-panel").text(),/данные Jira|исходные данные/i);
  assert.equal(typeof x.view.exportJson,"function");
  const data=JSON.parse(x.view.exportJson());assert.equal(data.traces[0].request.model,"model-x");assert.equal(data.omitted,0);
});
test("HTTP failure shows sanitized exception and observed network timings",t=>{
  const x=setup();t.after(()=>x.dom.window.close());
  x.view.record(trace({phase:"http",error:{name:"TypeError",message:"Fetch failed"},network:{available:true,source:"PerformanceResourceTiming",dnsMs:1,connectMs:3,tlsMs:2,ttfbMs:8,downloadMs:4,protocol:"h2"}}));x.view.open();
  assert.match(x.$(".ujg-esi-llm-diagnostic-panel").text(),/HTTP/);
  assert.match(x.$(".ujg-esi-llm-diagnostic-panel").text(),/Fetch failed/);
  assert.match(x.$(".ujg-esi-llm-diagnostic-panel").text(),/DNS|dns/i);
  assert.match(x.$(".ujg-esi-llm-diagnostic-panel").text(),/PerformanceResourceTiming/);
});
test("download command creates a JSON file from the current snapshots",t=>{
  const x=setup();t.after(()=>x.dom.window.close());let blob,clicked=false;
  x.dom.window.URL.createObjectURL=value=>{blob=value;return "blob:test";};
  x.dom.window.URL.revokeObjectURL=()=>{};
  const original=x.dom.window.HTMLAnchorElement.prototype.click;
  x.dom.window.HTMLAnchorElement.prototype.click=function(){clicked=true;assert.equal(this.download,"llm-diagnostics.json");};
  t.after(()=>{x.dom.window.HTMLAnchorElement.prototype.click=original;});
  x.view.record(trace());x.view.open();x.$('[aria-label="Скачать JSON"]').trigger("click");
  assert.equal(clicked,true);assert.equal(blob.type,"application/json;charset=utf-8");
});
test("metadata distinguishes observed values from unknowns",t=>{
  const x=setup();t.after(()=>x.dom.window.close());
  x.view.record(trace({response:{status:200,body:"",bodyBytes:0,bodyTruncated:false,jsonShape:'{"type":"object"}',usage:{inputTokens:null,outputTokens:null,totalTokens:null,source:"unavailable"}},request:{body:"",bodyBytes:0,bodyTruncated:false},network:{available:false,reason:"Нет Resource Timing"},stages:[{name:"body",startedMs:9,durationMs:12,status:"ok"}]}));x.view.open();
  const panel=x.$(".ujg-esi-llm-diagnostic-panel").text();
  assert.match(panel,/Сетевые замеры доступныНет/);
  assert.match(panel,/Провайдер не сообщил/);
  assert.match(panel,/Запрос сокращёнНет/);
  assert.match(panel,/27\.09\.2026.*13:00:00.*МСК/);
  assert.match(panel,/начало \+9 мс; длительность 12 мс/);
  assert.match(panel,/Структура JSON\{"type":"object"\}/);
  assert.doesNotMatch(panel,/\\"type\\"/);
  assert.match(panel,/Попытка 1.*a/);
  assert.match(panel,/пустое тело/i);
});
test("live trace update keeps expanded body and reading position",t=>{
  const x=setup();t.after(()=>x.dom.window.close());x.view.record(trace({outcome:"running"}));x.view.open();
  const details=x.$(".ujg-esi-llm-diagnostic-disclosure").eq(1).prop("open",true);
  x.$(".ujg-esi-llm-diagnostic-body")[0].scrollTop=80;
  details.find("pre")[0].scrollTop=35;
  x.view.record(trace({outcome:"success",summary:"Finished"}));
  assert.equal(x.$(".ujg-esi-llm-diagnostic-disclosure").eq(1).prop("open"),true);
  assert.equal(x.$(".ujg-esi-llm-diagnostic-body")[0].scrollTop,80);
  assert.equal(x.$(".ujg-esi-llm-diagnostic-disclosure").eq(1).find("pre")[0].scrollTop,35);
});
test("Tab inside panel does not reach parent report handler",t=>{
  const x=setup();t.after(()=>x.dom.window.close());let parentTabs=0;
  x.$("#report").on("keydown",event=>{if(event.key==="Tab")parentTabs++;});
  x.view.record(trace());x.view.open();x.$(".ujg-esi-llm-diagnostic-panel").trigger(x.$.Event("keydown",{key:"Tab"}));
  assert.equal(parentTabs,0);
});
test("request and response JSON display is readable without changing raw export or creating HTML",t=>{
  const x=setup();t.after(()=>x.dom.window.close());
  const sent='{"prompt":"<script>bad()</script>","nested":{"count":2}}';
  const received='{"choices":[{"text":"<img src=x onerror=bad()>"}]}';
  x.view.record(trace({request:{body:sent,bodyBytes:sent.length},response:{body:received,bodyBytes:received.length,format:"json"}}));x.view.open();
  const pres=x.$(".ujg-esi-llm-diagnostic-disclosure pre");
  assert.deepEqual(JSON.parse(pres.eq(1).text()),JSON.parse(sent));
  assert.deepEqual(JSON.parse(pres.eq(3).text()),JSON.parse(received));
  assert.match(pres.eq(1).text(),/\n  "prompt"/);
  assert.match(pres.eq(3).text(),/\n  "choices"/);
  assert.equal(x.$(".ujg-esi-llm-diagnostic-panel script,img").length,0);
  const exported=JSON.parse(x.view.exportJson());
  assert.equal(exported.traces[0].request.body,sent);
  assert.equal(exported.traces[0].response.body,received);
});
test("non-JSON text remains literal and long lines use wrapping styles",t=>{
  const x=setup();t.after(()=>x.dom.window.close());
  const raw='<html><img src=x onerror=bad()></html>';
  x.view.record(trace({response:{body:raw,bodyBytes:raw.length,format:"html/xml"}}));x.view.open();
  assert.equal(x.$(".ujg-esi-llm-diagnostic-disclosure pre").eq(3).text(),raw);
  assert.equal(x.$(".ujg-esi-llm-diagnostic-panel img").length,0);
  const css=fs.readFileSync(path.join(__dirname,"../../ujg-excel-story-importer.css"),"utf8");
  const rule=css.match(/\.ujg-esi-llm-diagnostic-disclosure pre\s*\{([^}]*)\}/)[1];
  assert.match(rule,/white-space:\s*pre-wrap/);
  assert.match(rule,/overflow-wrap:\s*anywhere/);
});
test("send state describes what was observed without claiming server receipt",t=>{
  const cases=[
    [false,"не начиналась"],
    [null,"вызван fetch; приём сервером неизвестен"],
    [true,"получен HTTP-ответ"]
  ];
  for(const [sent,expected] of cases) {
    const x=setup();t.after(()=>x.dom.window.close());
    x.view.record(trace({request:{sent,headers:{},credentials:null,body:"",bodyBytes:0}}));x.view.open();
    const label=x.$(".ujg-esi-llm-diagnostic-meta dt").filter((_,el)=>el.textContent==="Отправка");
    assert.equal(label.length,1);
    assert.equal(label.next("dd").text(),expected);
    assert.equal(JSON.parse(x.view.exportJson()).traces[0].request.sent,sent);
  }
});
