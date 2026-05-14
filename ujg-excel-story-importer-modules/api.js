define("_ujgESI_api", ["jquery", "_ujgESI_config"], function($, config) {
  "use strict";

  function quoteJqlString(value) {
    return '"' + String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
  }

  function toJqlToken(value) {
    var token = String(value || "");
    return /^[A-Za-z0-9_-]+$/.test(token) ? token : quoteJqlString(token);
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

  return {
    baseUrl: config.baseUrl,
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
    getIssuesByKeys: function(keys) {
      var list = uniqueIssueKeys(keys);
      var fields = ["summary", "status", "assignee"];
      if (config.SPRINT_FIELD && fields.indexOf(config.SPRINT_FIELD) < 0) fields.push(config.SPRINT_FIELD);
      if (fields.indexOf("customfield_10020") < 0) fields.push("customfield_10020");
      if (fields.indexOf("customfield_10007") < 0) fields.push("customfield_10007");
      if (!list.length) return Promise.resolve({ issues: [] });
      return $.ajax({
        url: config.baseUrl + "/rest/api/2/search",
        type: "POST",
        contentType: "application/json",
        dataType: "json",
        data: JSON.stringify({
          jql: "key in (" + list.map(toJqlToken).join(", ") + ")",
          fields: fields,
          maxResults: list.length,
        }),
      });
    },
    toJqlToken: toJqlToken,
    uniqueIssueKeys: uniqueIssueKeys,
  };
});
