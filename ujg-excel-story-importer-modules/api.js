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
    getIssuesByKeys: function(keys) {
      var list = uniqueIssueKeys(keys);
      var fields = ["summary", "status", "resolution", "assignee", "issuelinks"];
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
    searchIssueBySummary: function(projectKey, summaryText) {
      var text = summaryText != null ? String(summaryText).trim() : "";
      var fields = ["summary", "description", "status", "resolution", "assignee", "issuelinks", "issuetype"];
      if (config.SPRINT_FIELD && fields.indexOf(config.SPRINT_FIELD) < 0) fields.push(config.SPRINT_FIELD);
      if (fields.indexOf("customfield_10020") < 0) fields.push("customfield_10020");
      if (fields.indexOf("customfield_10007") < 0) fields.push("customfield_10007");
      if (!projectKey || !text) return Promise.resolve({ issues: [] });
      return $.ajax({
        url: config.baseUrl + "/rest/api/2/search",
        type: "POST",
        contentType: "application/json",
        dataType: "json",
        data: JSON.stringify({
          jql: "project = " + toJqlToken(projectKey) + " AND " + summaryTextJql(text) + " ORDER BY updated DESC",
          fields: fields,
          maxResults: 10,
        }),
      });
    },
    toJqlToken: toJqlToken,
    uniqueIssueKeys: uniqueIssueKeys,
  };
});
