define("_ujgESI_api", ["jquery", "_ujgESI_config"], function($, config) {
  "use strict";

  function quoteJqlString(value) {
    return '"' + String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
  }

  function toJqlToken(value) {
    var token = String(value || "");
    return /^[A-Za-z0-9_-]+$/.test(token) ? token : quoteJqlString(token);
  }

  return {
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
    toJqlToken: toJqlToken,
  };
});
