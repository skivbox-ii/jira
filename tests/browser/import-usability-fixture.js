(function() {
  "use strict";
  if (!window.usabilityRealApi) throw new Error("Usability fixture requires the real API module");
  var control = window.usabilityFixture = {delay:window.fixtureExpected ? 5 : 700, cap:25,
    failNext:false, failKeys:{}, failReadback:false, ignoreAbort:false, commentPages:{},
    failTransition:false, uncertainTransition:false, uncertainStatus:0, requests:[], writes:[], aborts:0};
  var rendering = modules._ujgESI_rendering, render = rendering.render, init = rendering.init;
  rendering.init = function(root, callbacks) { window.usabilityCallbacks = callbacks; return init.apply(this,arguments); };
  rendering.render = function(state) { window.usabilityState = state; return render.apply(this,arguments); };
  var real = window.usabilityRealApi;
  ["getProjectIssues","getIssuesByKeys","getIssueWithHistory","getIssueComments","getIssueTransitions","transitionIssue"].forEach(function(name) {
    if (typeof real[name] === "function") offlineApi[name] = real[name];
  });
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function transitions() {
    return {transitions:[
      {id:"21", name:"Взять в работу", to:{id:"2",name:"В работе",description:"Исполнитель начал работу"}, fields:{}},
      {id:"31", name:"Передать на тестирование", to:{id:"4",name:"Тестирование",description:"Ожидает проверки QA"}, fields:{}},
      {id:"41", name:"Завершить", to:{id:"3",name:"Готово"}, fields:{resolution:{name:"Решение",required:true}}}
    ]};
  }
  jQuery.ajax = function(options) {
    var deferred = jQuery.Deferred(), request = {url:options.url, method:options.type || "GET",
      started:Date.now(), state:"running"};
    var requestData=typeof options.data === "string" ? JSON.parse(options.data) : options.data || {};
    request.requested=requestData.maxResults == null ? null : Number(requestData.maxResults);
    request.page=requestData.startAt == null ? null : Number(requestData.startAt);
    control.requests.push(request);
    var timer = setTimeout(function() {
      try {
        if (control.failNext) { control.failNext=false; throw {status:503,statusText:"Service Unavailable"}; }
        var url = new URL(options.url,location.origin), payload = typeof options.data === "string" ? JSON.parse(options.data) : options.data || {};
        if (url.pathname === "/rest/api/2/search") {
          var keys = /key in\s*\(([^)]+)\)/i.exec(payload.jql || ""), all;
          if (keys) all = keys[1].split(",").map(function(key) { return fixtureIssues[key.trim().replace(/^"|"$/g,"")]; }).filter(Boolean);
          else all = Object.values(fixtureIssues).filter(function(issue) { return issue.fields.issuetype.name === "История"; });
          var start=Number(payload.startAt)||0, count=Math.min(Number(payload.maxResults)||100,control.cap);
          request.page=start; request.count=Math.min(count,all.length-start);
          deferred.resolve({issues:clone(all.slice(start,start+count)),startAt:start,total:all.length,maxResults:count});
        } else {
          var match=/\/rest\/api\/2\/issue\/([^/]+)(?:\/(transitions|comment))?$/.exec(url.pathname);
          if (!match || !fixtureIssues[match[1]]) throw {status:404,statusText:"Not Found"};
          if (control.failKeys[match[1]]) throw {status:503,statusText:"Synthetic read failure"};
          var issue=fixtureIssues[match[1]];
          if (match[2] === "transitions" && request.method === "GET") deferred.resolve(transitions());
          else if (match[2] === "transitions" && request.method === "POST") {
            if (control.failTransition) throw {status:400,responseJSON:{errorMessages:["Проверка workflow не пройдена"]}};
            var selected=transitions().transitions.find(function(item) { return item.id === payload.transition.id; });
            if (!selected || Object.keys(selected.fields).length) throw {status:400,statusText:"Invalid transition"};
            var from=clone(issue.fields.status), at=new Date().toISOString();
            issue.fields.status={id:selected.to.id,name:selected.to.name,statusCategory:{key:"indeterminate"}};
            issue.fields.updated=at; issue.fields.resolution=null;
            issue.changelog.histories.push({id:"fixture-transition-"+control.writes.length,created:at,
              author:{name:"ivanov",displayName:"Иванов И."},items:[{field:"status",from:from.id,fromString:from.name,to:selected.to.id,toString:selected.to.name}]});
            issue.changelog.total=issue.changelog.histories.length;
            control.writes.push({key:issue.key,payload:clone(payload)}); window.mutationCalls++;
            if (control.uncertainTransition) throw {status:control.uncertainStatus,statusText:"timeout"};
            deferred.resolve();
          } else if (match[2] === "comment") {
            var comments=control.commentPages[issue.key] || (issue.fields.comment || {}).comments || [];
            var commentStart=Number(payload.startAt || url.searchParams.get("startAt")) || 0;
            var commentCount=Math.min(Number(payload.maxResults || url.searchParams.get("maxResults")) || 100,control.cap);
            request.page=commentStart; request.count=Math.min(commentCount,Math.max(0,comments.length-commentStart));
            deferred.resolve({startAt:commentStart,total:comments.length,maxResults:commentCount,
              comments:clone(comments.slice(commentStart,commentStart+commentCount))});
          }
          else {
            if (control.failReadback && control.writes.length) throw {status:503,statusText:"Readback unavailable"};
            deferred.resolve(clone(issue));
          }
        }
        request.state="complete";
      } catch (error) { request.state="error"; deferred.reject(error); }
      request.finished=Date.now();
    },control.delay);
    var promise=deferred.promise();
    promise.abort=function() {
      if (deferred.state() !== "pending") return;
      if (control.ignoreAbort) { control.aborts++; return; }
      clearTimeout(timer); control.aborts++; request.state="cancelled"; request.finished=Date.now();
      deferred.reject({status:0,statusText:"abort"});
    };
    return promise;
  };
})();
