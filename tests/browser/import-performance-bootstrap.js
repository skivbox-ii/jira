(function() {
  "use strict";
  var stats={startedAt:new Date().toISOString(),snapshotAt:window.fixtureNow,dates:window.fixtureDates,
    timings:{},api:{},report:null,inputs:[],mutationCalls:0,llmCalls:0};
  window.importPerformance=stats;
  var panel=document.createElement("details");
  panel.id="import-performance-panel";
  panel.open=true;
  panel.style.cssText="margin:6px 12px;padding:5px 8px;border:1px solid #cbd5e1;background:#f8fafc;color:#18212d;font:12px/1.4 Arial,sans-serif;max-height:210px;overflow:auto";
  var heading=document.createElement("summary");heading.textContent="Performance fixture · 250 remarks / 1000 issues";
  var output=document.createElement("pre");output.style.cssText="margin:4px 0 0;white-space:pre-wrap;font:11px/1.4 ui-monospace,monospace";
  panel.appendChild(heading);panel.appendChild(output);
  var slow=document.createElement("input"); slow.type="checkbox";
  var slowLabel=document.createElement("label");slowLabel.append(slow," Медленные ответы истории (60 мс)");panel.appendChild(slowLabel);
  var fail=document.createElement("input");fail.type="checkbox";
  var failLabel=document.createElement("label");failLabel.append(fail," Ошибка EVOSCADA-50000");panel.appendChild(failLabel);
  document.querySelector("#root").before(panel);
  var updateQueued=false;
  function updatePanel() {
    updateQueued=false;
    stats.mutationCalls=window.mutationCalls;
    output.textContent="Snapshot "+stats.snapshotAt+" | dates "+stats.dates.join(", ")+"\n"+
      "Last calculation "+(stats.report ? stats.report.date+": "+stats.report.events+" / expected "+stats.report.expected+" | complete "+stats.report.complete+"/1000" : "pending")+"\n"+
      "Shown "+(document.querySelector(".ujg-esi-activity-date") || {}).value+" | "+(document.querySelector(".ujg-esi-activity-journal-heading") || {}).textContent+"\n"+
      "API "+JSON.stringify(stats.api)+" | writes "+stats.mutationCalls+" | LLM "+stats.llmCalls+"\n"+
      Object.keys(stats.timings).map(function(name) {var x=stats.timings[name];return name+" "+x.last.toFixed(1)+"ms @ "+x.lastAt+" ("+x.count+" calls, "+x.total.toFixed(1)+"ms total, max "+x.max.toFixed(1)+"ms)";}).join(" · ")+"\n"+
      (stats.inputs.length ? "performance.capture "+stats.inputs.slice(-4).map(function(x){return x.name+" "+x.ms.toFixed(1)+"ms";}).join(" · ") : "performance.capture pending");
  }
  function schedulePanel() {if(!updateQueued){updateQueued=true;setTimeout(updatePanel,0);}}
  function timed(object,name,label,after) {
    var original=object[name];
    if(typeof original!=="function")return;
    object[name]=function() {
      var start=performance.now(), result;
      try {result=original.apply(this,arguments);return result;}
      finally {
        var elapsed=performance.now()-start;
        var entry=stats.timings[label] || (stats.timings[label]={count:0,total:0,last:0,lastAt:"",max:0});
        entry.max=Math.max(entry.max,elapsed);
        entry.count++;entry.total+=elapsed;entry.last=elapsed;entry.lastAt=new Date().toISOString();
        if(after)after(result,arguments);
        schedulePanel();
      }
    };
  }
  var readHistory=window.offlineApi.getIssueWithHistory;
  window.offlineApi.getIssueWithHistory=function(key) {
    var timer, rejectRead, cancelled=false;
    var request=new Promise(function(resolve,reject) {
      rejectRead=reject;
      timer=setTimeout(function() {
        if(cancelled)return;
        if(fail.checked && key==="EVOSCADA-50000") {reject(new Error("Тестовая ошибка чтения"));return;}
        Promise.resolve(readHistory(key)).then(resolve,reject);
      },slow.checked?60:0);
    });
    request.abort=function(){cancelled=true;clearTimeout(timer);rejectRead(new Error("aborted"));};
    return request;
  };
  ["getProjectIssues","getIssuesByKeys","getIssueWithHistory","getProjects","getProjectEpics","getProjectComponents","getIssueDueDate","getIssueComponents","searchUsers"].forEach(function(name){
    var original=window.offlineApi[name];
    window.offlineApi[name]=function(){stats.api[name]=(stats.api[name]||0)+1;schedulePanel();return original.apply(this,arguments);};
  });
  var activity=modules._ujgESI_activity, originalCapture=activity.capture, originalToday=activity.today;
  activity.capture=function(){var result=originalCapture.apply(this,arguments);result.capturedAt=window.fixtureNow;return result;};
  activity.today=function(now){return originalToday(now==null?window.fixtureNow:now);};
  timed(activity,"capture","activity.capture");
  var summarize=activity.summarize;
  activity.summarize=function(rows,teams,options){return summarize.call(this,rows,teams,Object.assign({},options,{now:window.fixtureNow}));};
  timed(activity,"summarize","activity.summarize",function(report){
    if(report)stats.report={date:report.date,events:report.events.length,expected:window.fixtureExpected[report.date]&&window.fixtureExpected[report.date].count,
      complete:report.coverage.complete,isComplete:report.coverage.isComplete};
  });
  timed(modules._ujgESI_activityAi,"prepare","activityAi.prepare");
  var activityUi=modules._ujgESI_activityUi, create=activityUi.create;
  activityUi.create=function(){var instance=create.apply(this,arguments);timed(instance,"render","activityUi.render");return instance;};
  var rendering=modules._ujgESI_rendering, init=rendering.init, callbacks;
  rendering.init=function(container,services){
    callbacks=services;
    services.onActivityLlmRequest=function(){stats.llmCalls++;schedulePanel();return Promise.resolve({text:"Local performance fixture: LLM disabled."});};
    return init.call(this,container,services);
  };
  var currentState;
  timed(rendering,"render","main.render",function(_,args){currentState=args[0];});
  timed(rendering,"renderActivityProgress","progress.render");
  function captureInput(event) {
    var target=event.target;
    if(!target.closest || !target.closest("#root"))return;
    var name=target.getAttribute("aria-label") || target.getAttribute("data-activity-sort") || target.textContent.trim().slice(0,35) || target.tagName;
    var start=performance.now();
    requestAnimationFrame(function(){stats.inputs.push({name:name,ms:performance.now()-start,at:new Date().toISOString()});schedulePanel();});
  }
  document.addEventListener("click",captureInput,true);
  document.addEventListener("change",captureInput,true);
  document.addEventListener("input",captureInput,true);
  new modules._ujgExcelStoryImporter({getGadgetContentEl:function(){return jQuery("#root");},resize:function(){}});
  callbacks.onProjectChange("EVOSCADA");
  // The project callback loads the normal defaults; fixture teams are explicit local scope.
  if(currentState)currentState.teams=window.fixtureTeams;
  callbacks.onReportViewChange("activity");
  schedulePanel();
})();
