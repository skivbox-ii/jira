define("_ujgSB_api", ["jquery", "_ujgSB_config"], function($, config) {
    "use strict";

    var CONFIG = config;
    var JQL_KEY_CHUNK_SIZE = 100;
    var STORY_SEARCH_MAX_RESULTS = 1000;

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

    function normalizeText(value) {
        return value != null ? String(value).trim().toLowerCase() : "";
    }

    function normalizeFieldConfig(fieldConfig) {
        return {
            epicLinkField:
                fieldConfig && fieldConfig.epicLinkField
                    ? String(fieldConfig.epicLinkField)
                    : String(CONFIG.EPIC_LINK_FIELD || ""),
            sprintField:
                fieldConfig && fieldConfig.sprintField
                    ? String(fieldConfig.sprintField)
                    : String(CONFIG.SPRINT_FIELD || "")
        };
    }

    function buildSearchFields(fieldConfig) {
        var resolved = normalizeFieldConfig(fieldConfig);
        var fields = String(CONFIG.ISSUE_FIELDS || "").split(",").filter(Boolean);
        if (resolved.epicLinkField && resolved.epicLinkField !== CONFIG.EPIC_LINK_FIELD) {
            fields = fields.filter(function(field) {
                return field !== CONFIG.EPIC_LINK_FIELD;
            });
        }
        if (resolved.sprintField && resolved.sprintField !== CONFIG.SPRINT_FIELD) {
            fields = fields.filter(function(field) {
                return field !== CONFIG.SPRINT_FIELD;
            });
        }
        if (resolved.epicLinkField && fields.indexOf(resolved.epicLinkField) < 0) {
            fields.push(resolved.epicLinkField);
        }
        if (resolved.sprintField && fields.indexOf(resolved.sprintField) < 0) {
            fields.push(resolved.sprintField);
        }
        return fields;
    }

    function buildProjectJql(projectKey) {
        return "project = " + toJqlToken(projectKey) + " ORDER BY issuetype ASC, key ASC";
    }

    function epicLinkJqlField(fieldConfig) {
        var epicLinkField = normalizeFieldConfig(fieldConfig).epicLinkField;
        var match = /customfield_(\d+)/.exec(epicLinkField);
        return match ? "cf[" + match[1] + "]" : quoteJqlString(epicLinkField);
    }

    function buildProjectEpicsJql(projectKey) {
        return "project = " + toJqlToken(projectKey) + " AND issuetype = " + CONFIG.EPIC_ISSUE_TYPE + " ORDER BY key DESC";
    }

    function buildStoriesForEpicKeysJql(projectKey, epicKeys, fieldConfig) {
        return (
            "project = " +
            toJqlToken(projectKey) +
            " AND issuetype = " +
            CONFIG.STORY_ISSUE_TYPE +
            " AND " +
            epicLinkJqlField(fieldConfig) +
            " in (" +
            (epicKeys || []).map(toJqlToken).join(", ") +
            ") ORDER BY key DESC"
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

    function searchChunked(values, buildJql, onProgress, fieldConfig, maxResults) {
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
            searchIssues(
                buildJql(chunks[index]),
                onProgress ? function(loaded, total, partial) {
                    onProgress(all.length + loaded, all.length + total, all.concat(partial));
                } : null,
                fieldConfig,
                maxResults
            ).then(
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

    function searchIssues(jql, onProgress, fieldConfig, maxResults) {
        var d = $.Deferred();
        var all = [];
        var fields = buildSearchFields(fieldConfig);
        var pageSize = Number(maxResults) > 0 ? Number(maxResults) : 100;

        function load(startAt) {
            $.ajax({
                url: CONFIG.baseUrl + "/rest/api/2/search",
                type: "POST",
                contentType: "application/json",
                data: JSON.stringify({
                    jql: jql,
                    fields: fields,
                    expand: ["changelog"],
                    maxResults: pageSize,
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

    function getFieldMetadata() {
        return $.ajax({
            url: CONFIG.baseUrl + "/rest/api/2/field",
            type: "GET"
        });
    }

    function detectFieldId(fields, fallbackId, schemaToken, nameTokens) {
        var list = Array.isArray(fields) ? fields : [];
        var normalizedFallback = normalizeText(fallbackId);
        var field;
        var i;
        var ti;

        for (i = 0; i < list.length; i += 1) {
            field = list[i];
            if (normalizeText(field && field.id) === normalizedFallback && field && field.id != null) {
                return String(field.id);
            }
        }
        for (i = 0; i < list.length; i += 1) {
            field = list[i];
            if (normalizeText(field && field.schema && field.schema.custom).indexOf(schemaToken) >= 0 && field && field.id != null) {
                return String(field.id);
            }
        }
        for (i = 0; i < list.length; i += 1) {
            field = list[i];
            var name = normalizeText(field && field.name);
            for (ti = 0; ti < (nameTokens || []).length; ti += 1) {
                if (name === nameTokens[ti] && field && field.id != null) {
                    return String(field.id);
                }
            }
        }
        for (i = 0; i < list.length; i += 1) {
            field = list[i];
            var hay = normalizeText(field && field.name);
            for (ti = 0; ti < (nameTokens || []).length; ti += 1) {
                if (hay.indexOf(nameTokens[ti]) >= 0 && field && field.id != null) {
                    return String(field.id);
                }
            }
        }
        return String(fallbackId || "");
    }

    function detectFieldConfig(fields) {
        return {
            epicLinkField: detectFieldId(
                fields,
                CONFIG.EPIC_LINK_FIELD,
                "gh-epic-link",
                ["epic link", "эпик"]
            ),
            sprintField: detectFieldId(
                fields,
                CONFIG.SPRINT_FIELD,
                "gh-sprint",
                ["sprint", "спринт"]
            )
        };
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
        getFieldMetadata: getFieldMetadata,
        detectFieldConfig: detectFieldConfig,
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
            return searchIssues(buildProjectJql(projectKey), onProgress);
        },
        getProjectEpics: function(projectKey, onProgress) {
            return searchIssues(buildProjectEpicsJql(projectKey), onProgress);
        },
        getStoriesForEpicKeys: function(projectKey, epicKeys, onProgress, fieldConfig) {
            if (!epicKeys || !epicKeys.length) {
                return resolvedPromise([]);
            }
            return searchChunked(epicKeys, function(keys) {
                return buildStoriesForEpicKeysJql(projectKey, keys, fieldConfig);
            }, onProgress, fieldConfig, STORY_SEARCH_MAX_RESULTS);
        },
        getIssuesByKeys: function(issueKeys, onProgress, fieldConfig) {
            if (!issueKeys || !issueKeys.length) {
                return resolvedPromise([]);
            }
            return searchChunked(issueKeys, buildKeysJql, onProgress, fieldConfig);
        }
    };
});
