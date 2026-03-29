define("_ujgSB_api", ["jquery", "_ujgSB_config"], function($, config) {
    "use strict";

    var CONFIG = config;

    function quoteJqlString(value) {
        return '"' + String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
    }

    function buildProjectJql(projectKey) {
        var value = String(projectKey);
        if (/^[A-Za-z0-9_]+$/.test(value)) {
            return "project = " + value + " ORDER BY issuetype ASC, key ASC";
        }
        return "project = " + quoteJqlString(value) + " ORDER BY issuetype ASC, key ASC";
    }

    function projectEqualsClause(projectKey) {
        var value = String(projectKey);
        if (/^[A-Za-z0-9_]+$/.test(value)) {
            return "project = " + value;
        }
        return "project = " + quoteJqlString(value);
    }

    function buildLabelSearchJql(projectKey, query) {
        var clause = projectEqualsClause(projectKey);
        var q = String(query || "").trim();
        if (q) {
            return clause + " AND labels ~ " + quoteJqlString(q) + " ORDER BY updated DESC";
        }
        return clause + " ORDER BY updated DESC";
    }

    return {
        getProjects: function() {
            return $.ajax({
                url: CONFIG.baseUrl + "/rest/api/2/project",
                type: "GET"
            });
        },
        getProjectCreateMeta: function(projectKey) {
            return $.ajax({
                url: CONFIG.baseUrl + "/rest/api/2/issue/createmeta",
                type: "GET",
                dataType: "json",
                data: {
                    projectKeys: String(projectKey || ""),
                    expand: "projects.issuetypes.fields"
                }
            });
        },
        getProjectComponents: function(projectKey) {
            return $.ajax({
                url: CONFIG.baseUrl + "/rest/api/2/project/" + encodeURIComponent(projectKey) + "/components",
                type: "GET",
                dataType: "json"
            });
        },
        searchUsers: function(query) {
            return $.ajax({
                url: CONFIG.baseUrl + "/rest/api/2/user/picker",
                type: "GET",
                dataType: "json",
                data: {
                    query: String(query || ""),
                    maxResults: 10
                }
            });
        },
        searchLabels: function(projectKey, query) {
            return $.ajax({
                url: CONFIG.baseUrl + "/rest/api/2/search",
                type: "POST",
                contentType: "application/json",
                dataType: "json",
                data: JSON.stringify({
                    jql: buildLabelSearchJql(projectKey, query),
                    fields: ["labels"],
                    maxResults: 50
                })
            });
        },
        createIssue: function(payload) {
            return $.ajax({
                url: CONFIG.baseUrl + "/rest/api/2/issue",
                type: "POST",
                contentType: "application/json",
                dataType: "json",
                data: JSON.stringify(payload)
            });
        },
        getProjectIssues: function(projectKey, onProgress) {
            var d = $.Deferred();
            var all = [];

            function load(startAt) {
                $.ajax({
                    url: CONFIG.baseUrl + "/rest/api/2/search",
                    type: "POST",
                    contentType: "application/json",
                    data: JSON.stringify({
                        jql: buildProjectJql(projectKey),
                        fields: CONFIG.ISSUE_FIELDS.split(","),
                        expand: ["changelog"],
                        maxResults: 100,
                        startAt: startAt
                    })
                }).then(
                    function(data) {
                        var batch = data.issues || [];
                        all = all.concat(batch);
                        var total = typeof data.total === "number" ? data.total : all.length;
                        if (onProgress) {
                            onProgress(all.length, total, all.slice());
                        }
                        if (batch.length === 0) {
                            d.resolve(all);
                        } else if (all.length >= total) {
                            d.resolve(all);
                        } else {
                            load(startAt + batch.length);
                        }
                    },
                    function(err) {
                        if (all.length === 0) {
                            d.reject(err);
                        } else {
                            d.resolve(all);
                        }
                    }
                );
            }
            load(0);
            return d.promise();
        }
    };
});
