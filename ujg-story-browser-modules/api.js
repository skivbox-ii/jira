define("_ujgSB_api", ["jquery", "_ujgSB_config"], function($, config) {
    "use strict";

    var CONFIG = config;
    var JQL_KEY_CHUNK_SIZE = 100;

    function resolvedPromise(value) {
        var d = $.Deferred();
        d.resolve(value);
        return d.promise();
    }

    function quoteJqlString(value) {
        return '"' + String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
    }

    function toJqlToken(value) {
        var token = String(value);
        if (/^[A-Za-z0-9_-]+$/.test(token)) {
            return token;
        }
        return quoteJqlString(token);
    }

    function buildProjectJql(projectKey) {
        return "project = " + toJqlToken(projectKey) + " ORDER BY issuetype ASC, key ASC";
    }

    function epicLinkJqlField() {
        var match = /customfield_(\d+)/.exec(String(CONFIG.EPIC_LINK_FIELD || ""));
        return match ? "cf[" + match[1] + "]" : quoteJqlString(CONFIG.EPIC_LINK_FIELD);
    }

    function buildProjectEpicsJql(projectKey) {
        return "project = " + toJqlToken(projectKey) + " AND issuetype = " + CONFIG.EPIC_ISSUE_TYPE + " ORDER BY key ASC";
    }

    function buildStoriesForEpicKeysJql(projectKey, epicKeys) {
        return (
            "project = " +
            toJqlToken(projectKey) +
            " AND issuetype = " +
            CONFIG.STORY_ISSUE_TYPE +
            " AND " +
            epicLinkJqlField() +
            " in (" +
            (epicKeys || []).map(toJqlToken).join(", ") +
            ") ORDER BY key ASC"
        );
    }

    function buildKeysJql(issueKeys) {
        return "key in (" + (issueKeys || []).map(toJqlToken).join(", ") + ") ORDER BY key ASC";
    }

    function normalizeKeyList(values) {
        return (values || []).map(function(value) {
            return value != null ? String(value) : "";
        }).filter(Boolean);
    }

    function chunkValues(values, chunkSize) {
        var chunks = [];
        var index = 0;
        while (index < values.length) {
            chunks.push(values.slice(index, index + chunkSize));
            index += chunkSize;
        }
        return chunks;
    }

    function searchChunked(values, buildJql, onProgress) {
        var safeValues = normalizeKeyList(values);
        var chunks = chunkValues(safeValues, JQL_KEY_CHUNK_SIZE);
        var d = $.Deferred();
        var all = [];

        if (!chunks.length) {
            return resolvedPromise([]);
        }

        function loadChunk(index) {
            if (index >= chunks.length) {
                d.resolve(all);
                return;
            }
            searchIssues(buildJql(chunks[index]), onProgress ? function(loaded, total, partial) {
                onProgress(all.length + loaded, all.length + total, all.concat(partial));
            } : null).then(
                function(batch) {
                    all = all.concat(batch || []);
                    loadChunk(index + 1);
                },
                function(err) {
                    if (all.length) {
                        d.resolve(all);
                    } else {
                        d.reject(err);
                    }
                }
            );
        }

        loadChunk(0);
        return d.promise();
    }

    function searchIssues(jql, onProgress) {
        var d = $.Deferred();
        var all = [];

        function load(startAt) {
            $.ajax({
                url: CONFIG.baseUrl + "/rest/api/2/search",
                type: "POST",
                contentType: "application/json",
                data: JSON.stringify({
                    jql: jql,
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

    return {
        getProjects: function() {
            return $.ajax({
                url: CONFIG.baseUrl + "/rest/api/2/project",
                type: "GET"
            });
        },
        getProjectIssues: function(projectKey, onProgress) {
            return searchIssues(buildProjectJql(projectKey), onProgress);
        },
        getProjectEpics: function(projectKey, onProgress) {
            return searchIssues(buildProjectEpicsJql(projectKey), onProgress);
        },
        getStoriesForEpicKeys: function(projectKey, epicKeys, onProgress) {
            if (!epicKeys || !epicKeys.length) {
                return resolvedPromise([]);
            }
            return searchChunked(epicKeys, function(keys) {
                return buildStoriesForEpicKeysJql(projectKey, keys);
            }, onProgress);
        },
        getIssuesByKeys: function(issueKeys, onProgress) {
            if (!issueKeys || !issueKeys.length) {
                return resolvedPromise([]);
            }
            return searchChunked(issueKeys, buildKeysJql, onProgress);
        }
    };
});
