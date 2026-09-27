define("_ujgESI_sourceExportApi", ["jquery","_ujgESI_config"], function($,config) {
  "use strict";
  function quote(value) { return '"' + String(value).replace(/\\/g,"\\\\").replace(/"/g,'\\"') + '"'; }
  function create(scope) {
    if (!scope || !scope.projectKey) throw new Error("Не выбран проект Jira");
    var field = String(config.EPIC_LINK_FIELD || ""), match = /^customfield_(\d+)$/.exec(field);
    if (scope.epicKey && !field) throw new Error("Не настроено поле связи с эпиком");
    var jql = "project = " + quote(scope.projectKey) + " AND issuetype = Story";
    if (scope.epicKey) jql += " AND " + (match ? "cf[" + match[1] + "]" : quote(field)) + " = " + quote(scope.epicKey);
    jql += " ORDER BY key ASC";
    var base = String(config.baseUrl || "").replace(/\/$/,""), requests = [];
    function read(path,params) {
      var started = Date.now(), entry = {method:"GET",url:base+path,params:params,startedAt:new Date(started).toISOString()};
      requests.push(entry);
      return new Promise(function(resolve,reject) {
        function finish(status) {entry.status=status;entry.finishedAt=new Date().toISOString();entry.durationMs=Date.now()-started;}
        $.ajax({url:entry.url,type:"GET",dataType:"json",timeout:30000,data:params}).then(function(data,status,xhr) {
          finish(xhr && xhr.status || 200);entry.total=data && data.total != null ? data.total : null;resolve(data);
        },function(xhr) {
          var status=xhr && xhr.status || 0;finish(status);
          var e=new Error(status ? "HTTP " + status : "Не получен ответ Jira (сеть, тайм-аут или ограничение браузера)");e.status=status;reject(e);
        });
      });
    }
    function issuePath(key) {
      if (!/^[A-Z][A-Z0-9_]*-[1-9][0-9]*$/i.test(String(key))) throw new Error("Некорректный ключ Jira");
      return "/rest/api/2/issue/" + encodeURIComponent(key);
    }
    return {requests:requests,plan:[
      {method:"GET",url:base+"/rest/api/2/search",params:{jql:jql,fields:"key",maxResults:100,startAt:"0, 100, … до total"}},
      {method:"GET",url:base+"/rest/api/2/issue/{key}",params:{fields:"*all",expand:"changelog,names"},keys:"Все исходные истории и их связанные дочерние задачи; без фильтров таблицы"},
      {method:"GET",url:base+"/rest/api/2/issue/{key}/{comment|worklog|changelog}",params:{startAt:"0, … до total",maxResults:100},when:"Встроенная коллекция неполна или её total неизвестен. Недоступный changelog endpoint отмечается ошибкой, не заменяется догадкой."}
    ],readStories:function(start) {return read("/rest/api/2/search",{jql:jql,fields:"key",maxResults:100,startAt:start});},
    readIssue:function(key) {return read(issuePath(key),{fields:"*all",expand:"changelog,names"});},
    readPage:function(key,kind,start) {
      var routes={comments:"comment",worklogs:"worklog",histories:"changelog"};
      if (!Object.prototype.hasOwnProperty.call(routes,kind)) throw new Error("Неизвестная коллекция");
      return read(issuePath(key)+"/"+routes[kind],{startAt:start,maxResults:100});
    }};
  }
  return {create:create};
});
