(function() {
  "use strict";
  // Local-only transport: unlike the original preview, obey requested fields/expand.
  var oldAjax = jQuery.ajax;
  var control = window.progressiveFixture = Object.assign({baseDelay:15,historyDelay:25,
    failKeys:{},timeoutOffset:null,timeoutUsed:false,ignoreAbort:false,requests:[],active:0,maxActive:0},
    window.progressiveFixtureConfig || {});
  var delayParameter=new URLSearchParams(location.search).get("historyDelay");
  if (delayParameter != null && /^\d+$/.test(delayParameter)) control.historyDelay=Math.min(3000,Number(delayParameter));
  Object.keys(window.usabilityRealApi).filter(function(name) { return /History/.test(name); }).forEach(function(name) {
    offlineApi[name] = window.usabilityRealApi[name];
  });
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function projected(issue, payload) {
    var fields = payload.fields;
    if (typeof fields === "string") fields = fields.split(",");
    var result = {key:issue.key,fields:{}};
    if (!fields || fields.indexOf("*all") >= 0) fields = Object.keys(issue.fields);
    fields.forEach(function(name) {
      if (Object.prototype.hasOwnProperty.call(issue.fields,name)) result.fields[name] = clone(issue.fields[name]);
    });
    (result.fields.issuelinks || []).forEach(function(link) {
      ["inwardIssue","outwardIssue"].forEach(function(direction) {
        var linked=link[direction];
        if (linked && linked.fields) linked.fields={summary:linked.fields.summary,status:linked.fields.status,issuetype:linked.fields.issuetype};
      });
    });
    if (String(payload.expand || "").split(",").indexOf("changelog") >= 0) result.changelog=clone(issue.changelog);
    return result;
  }
  jQuery.ajax = function(options) {
    var url = new URL(options.url,location.origin), payload=typeof options.data === "string" ? JSON.parse(options.data) : options.data || {};
    var issueMatch=/\/rest\/api\/2\/issue\/([^/]+)$/.exec(url.pathname);
    var isSearch=url.pathname === "/rest/api/2/search";
    if (!isSearch && !(issueMatch && (options.type || "GET") === "GET")) return oldAjax(options);
    var deferred=jQuery.Deferred(), stopped=false;
    var record={url:url.pathname,payload:clone(payload),started:performance.now(),state:"running",heavy:!!issueMatch};
    control.requests.push(record);control.active++;control.maxActive=Math.max(control.maxActive,control.active);
    var timer=setTimeout(function() {
      try {
        if (isSearch) {
          var offset=Number(payload.startAt)||0;
          if (!control.timeoutUsed && control.timeoutOffset === offset) {
            control.timeoutUsed=true;throw {status:0,statusText:"timeout"};
          }
          var keys=/key in\s*\(([^)]+)\)/i.exec(payload.jql || "");
          var all=keys ? keys[1].split(",").map(function(key) { return fixtureIssues[key.trim().replace(/^"|"$/g,"")]; }).filter(Boolean)
            : Object.values(fixtureIssues).filter(function(issue) { return issue.fields.issuetype.name === "История"; });
          if (typeof control.selectIssues === "function") all=control.selectIssues(payload,all);
          var count=Math.min(Number(payload.maxResults)||50,control.cap || 50);
          deferred.resolve({startAt:offset,total:all.length,maxResults:count,issues:all.slice(offset,offset+count).map(function(issue) { return projected(issue,payload); })});
        } else {
          var key=issueMatch[1];
          if (control.failKeys[key]) throw {status:503,statusText:"Synthetic history failure"};
          if (!fixtureIssues[key]) throw {status:404,statusText:"Not Found"};
          deferred.resolve(projected(fixtureIssues[key],payload));
        }
        record.state="completed";
      } catch(error) { record.state="error";record.error=error.statusText || String(error);deferred.reject(error); }
      finish();
    },issueMatch ? control.historyDelay : control.baseDelay);
    function finish() { if (!stopped) {stopped=true;control.active--;record.finished=performance.now();} }
    var promise=deferred.promise();
    promise.abort=function() {
      record.aborted=true;
      if (control.ignoreAbort || deferred.state() !== "pending") return;
      clearTimeout(timer);record.state="cancelled";finish();deferred.reject({status:0,statusText:"abort"});
    };
    return promise;
  };
})();
