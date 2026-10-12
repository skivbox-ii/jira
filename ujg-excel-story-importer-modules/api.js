define("_ujgESI_api", ["jquery", "_ujgESI_config"], function($, config) {
  "use strict";

  function quoteJqlString(value) {
    return '"' + String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
  }

  function toJqlToken(value) {
    var token = String(value || "");
    return /^[A-Za-z0-9_-]+$/.test(token) ? token : quoteJqlString(token);
  }

  function epicLinkJqlField(value) {
    var field = String(value || "").trim();
    var match = /^customfield_(\d+)$/i.exec(field) || /^cf\[(\d+)\]$/i.exec(field);
    return match ? "cf[" + match[1] + "]" : quoteJqlString(field);
  }

  function uniqueIssueKeys(keys) {
    var seen = {};
    var out = [];
    (keys || []).forEach(function(key) {
      var value = key != null ? String(key).trim().toUpperCase() : "";
      if (!value || seen[value]) return;
      seen[value] = true;
      out.push(value);
    });
    return out;
  }

  function textSearchTokens(value) {
    return String(value || "")
      .replace(/[\r\n\t]+/g, " ")
      .replace(/[^\w\u0400-\u04FF-]+/g, " ")
      .split(/\s+/)
      .map(function(word) { return String(word || "").trim(); })
      .filter(function(word) { return word.length >= 3; })
      .slice(0, 6);
  }

  function summaryTextJql(text) {
    var tokens = textSearchTokens(text);
    if (!tokens.length) return "summary ~ " + quoteJqlString(text);
    return tokens.map(function(token) {
      return "(summary ~ " + quoteJqlString(token) + " OR description ~ " + quoteJqlString(token) + ")";
    }).join(" AND ");
  }

  function issueFields() {
    var fields = ["summary", "description", "status", "resolution", "resolutiondate", "duedate", "assignee", "creator", "issuelinks", "priority", "components", "issuetype", "updated", "created", "timespent", "worklog", "comment"];
    [config.SPRINT_FIELD, "customfield_10020", "customfield_10007"].forEach(function(field) {
      if (field && fields.indexOf(field) < 0) fields.push(field);
    });
    return fields;
  }

  function dueDateKey(key) {
    var value = typeof key === "string" ? key.trim() : "";
    return /^[A-Za-z][A-Za-z0-9_]*-[1-9][0-9]*$/.test(value) ? value : null;
  }

  function calendarDate(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    var date = new Date(value + "T00:00:00Z");
    return isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }

  var requestSequence = 0;
  function paginatedSearch(queries, options, limit) {
    var opts = options || {}, issues = [], cancelled = false, settled = false, request, row, rejectRun, seen=Object.create(null);
    function emit(state, error) {
      if (!row) return;
      row.state = state;
      if (state !== "running") row.finishedAt = Date.now();
      if (error) row.error = String(error.message || error.statusText || error);
      if (opts.onRequest) opts.onRequest(Object.assign({}, row));
    }
    function abortError() { var error = new Error("Загрузка отменена"); error.name = "AbortError"; return error; }
    var promise = new Promise(function(resolve, reject) {
      rejectRun = reject;
      var queryIndex = 0, totalAll = 0;
      function page(startAt, expectedTotal) {
        if (cancelled) return;
        var query = queries[queryIndex], requested = Math.min(query.size || 200, limit - issues.length);
        row = {id:"search-" + (++requestSequence),stage:opts.stage || "stories",batch:queryIndex + 1,
          startAt:startAt,requested:requested,state:"running",startedAt:Date.now()};
        emit("running");
        try {
          request = $.ajax({url:config.baseUrl + "/rest/api/2/search",type:"POST",timeout:30000,
            contentType:"application/json",dataType:"json",
            data:JSON.stringify({jql:query.jql || query,fields:issueFields(),expand:opts.expand === "changelog" ? ["changelog"] : undefined,
              startAt:startAt,maxResults:requested})});
        } catch (error) { fail(error); return; }
        Promise.resolve(request).then(function(data) {
          if (cancelled) return;
          var batch = data && data.issues, total = data && data.total == null && Array.isArray(batch) ? startAt + batch.length : Number(data && data.total);
          if (!Array.isArray(batch) || !Number.isInteger(total) || total < 0 ||
              data.startAt != null && data.startAt !== startAt || expectedTotal != null && total !== expectedTotal ||
              batch.length > requested || startAt + batch.length > total || !batch.length && startAt < total) {
            throw new Error("Некорректная или неполная страница Jira");
          }
          batch.forEach(function(issue) {
            var key=String(issue && issue.key || "").toUpperCase();
            if (!key || seen[key]) throw new Error("Некорректная страница Jira: повторный или пустой ключ");
            seen[key]=true;
          });
          row.received = batch.length; row.total = total; emit("completed");
          issues = issues.concat(batch);
          var next = startAt + batch.length;
          if (next < total && issues.length < limit) return page(next,total);
          totalAll += total;
          if (issues.length < limit && ++queryIndex < queries.length) return page(0,null);
          settled = true;
          resolve({issues:issues,total:totalAll,truncated:next < total});
        }).catch(fail);
      }
      function fail(error) { if (cancelled || settled) return; settled = true; emit("error",error); reject(error); }
      if (!queries.length) { settled = true; resolve({issues:[]}); } else page(0,null);
    });
    promise.abort = function() {
      if (settled || cancelled) return;
      cancelled = true; emit("cancelled"); rejectRun(abortError());
      if (request && typeof request.abort === "function") { try { request.abort(); } catch (ignore) {} }
    };
    return promise;
  }

  return {
    baseUrl: config.baseUrl,
    getIssueTransitions: function(key) {
      var issueKey = dueDateKey(key);
      if (!issueKey) return Promise.reject(new Error("Invalid Jira issue key"));
      return $.ajax({url:config.baseUrl + "/rest/api/2/issue/" + encodeURIComponent(issueKey) + "/transitions",
        type:"GET",timeout:30000,dataType:"json",data:{expand:"transitions.fields"}});
    },
    transitionIssue: function(key, id) {
      var issueKey = dueDateKey(key);
      if (!issueKey || typeof id !== "string" || !/^[1-9][0-9]*$/.test(id)) return Promise.reject(new Error("Invalid Jira issue key or transition ID"));
      return $.ajax({url:config.baseUrl + "/rest/api/2/issue/" + encodeURIComponent(issueKey) + "/transitions",
        type:"POST",timeout:30000,contentType:"application/json",data:JSON.stringify({transition:{id:id}})});
    },
    getIssueDueDate: function(key) {
      var issueKey = dueDateKey(key);
      if (!issueKey) return Promise.reject(new Error("Invalid Jira issue key"));
      return $.ajax({
        url: config.baseUrl + "/rest/api/2/issue/" + encodeURIComponent(issueKey),
        type: "GET",
        timeout: 30000,
        dataType: "json",
        data: {fields:"duedate,summary"},
      });
    },
    getIssueComponents: function(key) {
      var issueKey = dueDateKey(key);
      if (!issueKey) return Promise.reject(new Error("Invalid Jira issue key"));
      return $.ajax({url:config.baseUrl + "/rest/api/2/issue/" + encodeURIComponent(issueKey),
        type:"GET",timeout:30000,dataType:"json",data:{fields:"components,summary,project,issuetype"}});
    },
    updateIssueComponents: function(key, ids) {
      var issueKey = dueDateKey(key);
      if (!issueKey || !Array.isArray(ids) || ids.length !== 1 ||
          !ids.every(function(id) { return typeof id === "string" && /^[1-9][0-9]*$/.test(id); })) {
        return Promise.reject(new Error("Invalid Jira issue key or component IDs"));
      }
      return $.ajax({url:config.baseUrl + "/rest/api/2/issue/" + encodeURIComponent(issueKey),
        type:"PUT",timeout:30000,contentType:"application/json",
        data:JSON.stringify({fields:{components:ids.map(function(id) { return {id:id}; })}})});
    },
    updateIssueDueDate: function(key, date) {
      var issueKey = dueDateKey(key);
      if (!issueKey || !calendarDate(date)) return Promise.reject(new Error("Invalid Jira issue key or due date"));
      return $.ajax({
        url: config.baseUrl + "/rest/api/2/issue/" + encodeURIComponent(issueKey),
        type: "PUT",
        timeout: 30000,
        contentType: "application/json",
        data: JSON.stringify({fields:{duedate:date}}),
      });
    },
    getProjects: function() {
      return $.ajax({
        url: config.baseUrl + "/rest/api/2/project",
        type: "GET",
      });
    },
    getProjectEpics: function(projectKey) {
      return $.ajax({
        url: config.baseUrl + "/rest/api/2/search",
        type: "POST",
        contentType: "application/json",
        dataType: "json",
        data: JSON.stringify({
          jql: "project = " + toJqlToken(projectKey) + " AND issuetype = Epic ORDER BY key DESC",
          fields: ["summary", "status"],
          maxResults: 100,
        }),
      });
    },
    getProjectComponents: function(projectKey) {
      return $.ajax({
        url: config.baseUrl + "/rest/api/2/project/" + encodeURIComponent(String(projectKey || "")) + "/components",
        type: "GET",
        timeout: 30000,
        dataType: "json",
      });
    },
    getProjectCreateMeta: function(projectKey) {
      return $.ajax({
        url: config.baseUrl + "/rest/api/2/issue/createmeta",
        type: "GET",
        dataType: "json",
        data: {
          projectKeys: String(projectKey || ""),
          expand: "projects.issuetypes.fields",
        },
      });
    },
    createIssue: function(payload) {
      return $.ajax({
        url: config.baseUrl + "/rest/api/2/issue",
        type: "POST",
        contentType: "application/json",
        dataType: "json",
        data: JSON.stringify(payload),
      });
    },
    createIssueLink: function(payload) {
      return $.ajax({
        url: config.baseUrl + "/rest/api/2/issueLink",
        type: "POST",
        contentType: "application/json",
        dataType: "json",
        data: JSON.stringify(payload),
      });
    },
    getIssueLinkTypes: function() {
      return $.ajax({
        url: config.baseUrl + "/rest/api/2/issueLinkType",
        type: "GET",
        dataType: "json",
      });
    },
    searchUsers: function(query) {
      return $.ajax({
        url: config.baseUrl + "/rest/api/2/user/picker",
        type: "GET",
        dataType: "json",
        data: {
          query: String(query || ""),
          maxResults: 20,
        },
      });
    },
    getIssuesByKeys: function(keys, options) {
      var list = uniqueIssueKeys(keys);
      var queries = [];
      for (var offset = 0; offset < list.length; offset += 100) {
        var batch=list.slice(offset,offset+100);
        queries.push({jql:"key in (" + batch.map(toJqlToken).join(", ") + ") ORDER BY key ASC",size:batch.length});
      }
      return paginatedSearch(queries,Object.assign({stage:"linked"},options),Infinity);
    },
    getIssueWithHistory: function(key) {
      var issueKey = dueDateKey(key);
      if (!issueKey) return Promise.reject(new Error("Invalid Jira issue key"));
      return $.ajax({
        url: config.baseUrl + "/rest/api/2/issue/" + encodeURIComponent(issueKey),
        type: "GET",
        timeout: 30000,
        dataType: "json",
        data: { fields: issueFields().join(","), expand: "changelog" },
      });
    },
    getIssueComments: function(key, startAt) {
      return $.ajax({url:config.baseUrl + "/rest/api/2/issue/" + encodeURIComponent(String(key || "").trim()) + "/comment",
        type:"GET",timeout:30000,dataType:"json",data:{startAt:startAt || 0,maxResults:100}});
    },
    getIssueWorklogs: function(key, startAt) {
      return $.ajax({url:config.baseUrl + "/rest/api/2/issue/" + encodeURIComponent(String(key || "").trim()) + "/worklog",
        type:"GET",dataType:"json",data:{startAt:startAt || 0,maxResults:100}});
    },
    getProjectIssues: function(projectKey, epicKey, options) {
      var project = projectKey != null ? String(projectKey).trim() : "";
      var epic = epicKey != null ? String(epicKey).trim() : "";
      var jql;
      if (!project) return Promise.resolve({ issues: [] });
      jql = "project = " + toJqlToken(project) + " AND issuetype = Story";
      if (epic && config.EPIC_LINK_FIELD) jql += " AND " + epicLinkJqlField(config.EPIC_LINK_FIELD) + " = " + toJqlToken(epic);
      jql += " ORDER BY key DESC";
      return paginatedSearch([jql],Object.assign({stage:"stories",expand:"changelog"},options),1000);
    },
    searchIssueBySummary: function(projectKey, summaryText, options) {
      var text = summaryText != null ? String(summaryText).trim() : "";
      var fields = ["summary", "description", "status", "resolution", "resolutiondate", "assignee", "issuelinks", "issuetype"];
      if (config.SPRINT_FIELD && fields.indexOf(config.SPRINT_FIELD) < 0) fields.push(config.SPRINT_FIELD);
      if (fields.indexOf("customfield_10020") < 0) fields.push("customfield_10020");
      if (fields.indexOf("customfield_10007") < 0) fields.push("customfield_10007");
      if (!projectKey || !text) return Promise.resolve({ issues: [] });
      return paginatedSearch(["project = " + toJqlToken(projectKey) + " AND " + summaryTextJql(text) + " ORDER BY updated DESC"],
        Object.assign({stage:"summary"},options),10);
    },
    toJqlToken: toJqlToken,
    uniqueIssueKeys: uniqueIssueKeys,
  };
});
