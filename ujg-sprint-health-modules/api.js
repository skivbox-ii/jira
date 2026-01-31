// API Jira
define("_ujgSH_api", ["jquery", "_ujgSH_config"], function($, config) {
    "use strict";

    var CONFIG = config.CONFIG;
    var baseUrl = config.baseUrl;

    var api = {
        getBoards: function() {
            var d = $.Deferred(), all = [];
            function load(startAt) {
                $.ajax({
                    url: baseUrl + "/rest/agile/1.0/board",
                    data: { maxResults: 100, startAt: startAt }
                }).then(function(data) {
                    all = all.concat(data.values || []);
                    if (data.isLast === false && data.values && data.values.length > 0) {
                        load(startAt + data.values.length);
                    } else {
                        d.resolve({ values: all });
                    }
                }, function(err) { d.resolve({ values: all }); });
            }
            load(0);
            return d.promise();
        },
        getFields: function() { return $.ajax({ url: baseUrl + "/rest/api/2/field" }); },
        getUser: function(userId) {
            // Jira Server/DC: чаще всего работает ?key=JIRAUSER12345 или ?username=...
            // Jira Cloud: ?accountId=...
            function tryReq(params) {
                return $.ajax({ url: baseUrl + "/rest/api/2/user", data: params });
            }
            var id = userId;
            if (!id) return $.Deferred().reject().promise();
            // Пробуем по очереди (на разных инстансах разные параметры)
            return tryReq({ key: id }).then(function(r) { return r; }, function() {
                return tryReq({ username: id }).then(function(r) { return r; }, function() {
                    return tryReq({ accountId: id });
                });
            });
        },
        searchUsers: function(query, maxResults) {
            var q = (query || "").trim();
            var max = Number(maxResults) || 10;
            if (!q) return $.Deferred().resolve([]).promise();

            function pickAvatar(u) {
                if (!u) return "";
                // user/picker может вернуть avatarUrl (string|object), user/search — avatarUrls (object)
                if (u.avatarUrl) {
                    if (typeof u.avatarUrl === "string") return u.avatarUrl;
                    if (u.avatarUrl["48x48"]) return u.avatarUrl["48x48"];
                    if (u.avatarUrl["24x24"]) return u.avatarUrl["24x24"];
                    if (u.avatarUrl["16x16"]) return u.avatarUrl["16x16"];
                }
                if (u.avatarUrls) {
                    return u.avatarUrls["24x24"] || u.avatarUrls["16x16"] || u.avatarUrls["48x48"] || "";
                }
                return "";
            }

            function normalizeUser(u) {
                if (!u) return null;
                var id = u.accountId || u.key || u.name || u.username || u.userKey || "";
                if (!id) return null;
                return {
                    id: id,
                    name: u.name || u.username || u.key || "",
                    displayName: u.displayName || u.name || u.key || u.accountId || id,
                    avatarUrl: pickAvatar(u)
                };
            }

            function normalizeFromPicker(resp) {
                var users = (resp && resp.users && Array.isArray(resp.users)) ? resp.users : [];
                var out = [];
                users.forEach(function(u) {
                    // Jira Server: { name, key, displayName, avatarUrl, ... }
                    // Jira Cloud: иногда { accountId, displayName, avatarUrl, ... }
                    var nu = normalizeUser(u);
                    if (nu) out.push(nu);
                });
                return out;
            }

            // 1) user/picker — максимально “как в Jira”
            return $.ajax({
                url: baseUrl + "/rest/api/2/user/picker",
                data: { query: q, maxResults: max }
            }).then(function(resp) {
                return normalizeFromPicker(resp);
            }, function() {
                // 2) fallback: user/search
                return $.ajax({
                    url: baseUrl + "/rest/api/2/user/search",
                    data: { username: q, query: q, maxResults: max }
                }).then(function(resp) {
                    var arr = Array.isArray(resp) ? resp : [];
                    return arr.map(normalizeUser).filter(Boolean);
                }, function() {
                    return [];
                });
            });
        },
        getAllSprints: function(boardId) {
            var d = $.Deferred(), all = [];
            function load(startAt) {
                $.ajax({
                    url: baseUrl + "/rest/agile/1.0/board/" + boardId + "/sprint",
                    data: { state: "active,future,closed", maxResults: 100, startAt: startAt }
                }).then(function(data) {
                    all = all.concat(data.values || []);
                    if (data.isLast === false && data.values && data.values.length > 0) {
                        load(startAt + data.values.length);
                    } else {
                        d.resolve(all);
                    }
                }, function(err) { d.resolve(all); });
            }
            load(0);
            return d.promise();
        },
        getSprint: function(id) { return $.ajax({ url: baseUrl + "/rest/agile/1.0/sprint/" + id }); },
        getSprintIssues: function(id, onProgress) {
            var d = $.Deferred(), all = [];
            var maxTotal = 2000;
            var fields = "summary,status,assignee,priority,issuetype,timeoriginalestimate,timetracking,duedate,created,updated,description,resolutiondate," + (CONFIG.sprintField || "customfield_10020");
            function load(startAt) {
                $.ajax({
                    url: baseUrl + "/rest/agile/1.0/sprint/" + id + "/issue",
                    data: { fields: fields, expand: "changelog", maxResults: 100, startAt: startAt }
                }).then(function(data) {
                    all = all.concat(data.issues || []);
                    var total = data.total || all.length;
                    if (onProgress) onProgress(all.length, total);
                    if (all.length < total && all.length < maxTotal && data.issues && data.issues.length > 0) {
                        load(startAt + data.issues.length);
                    } else {
                        d.resolve({ issues: all, total: total });
                    }
                }, function(err) { d.resolve({ issues: all, total: all.length }); });
            }
            load(0);
            return d.promise();
        },
        getIssue: function(key) {
            return $.ajax({
                url: baseUrl + "/rest/api/2/issue/" + key,
                data: { fields: "summary,status,assignee,reporter,creator,priority,issuetype,timeoriginalestimate,timetracking,timespent,duedate,created,updated,description,resolutiondate,comment,changelog,worklog," + (CONFIG.sprintField || "customfield_10020") + "," + CONFIG.startDateField, expand: "changelog" }
            });
        },
        getIssueChangelog: function(key) {
            return $.ajax({
                url: baseUrl + "/rest/api/2/issue/" + key,
                data: { fields: "assignee", expand: "changelog" }
            });
        },
        getIssueWorklog: function(key) {
            return $.ajax({
                url: baseUrl + "/rest/api/2/issue/" + key + "/worklog",
                data: { maxResults: 1000, startAt: 0 }
            });
        },
        updateIssueEstimate: function(key, seconds) {
            return $.ajax({
                url: baseUrl + "/rest/api/2/issue/" + key,
                type: "PUT",
                contentType: "application/json",
                data: JSON.stringify({
                    fields: {
                        timetracking: { originalEstimateSeconds: seconds },
                        timeoriginalestimate: seconds
                    }
                })
            });
        },
        getBoardTeams: function(boardId) {
            return $.ajax({
                url: baseUrl + "/rest/agile/1.0/board/" + boardId + "/properties/ujgTeams"
            });
        },
        setBoardTeams: function(boardId, payload) {
            return $.ajax({
                url: baseUrl + "/rest/agile/1.0/board/" + boardId + "/properties/ujgTeams",
                type: "PUT",
                contentType: "application/json",
                data: JSON.stringify(payload)
            });
        },
        updateIssueDue: function(key, dueDateStr) {
            return $.ajax({
                url: baseUrl + "/rest/api/2/issue/" + key,
                type: "PUT",
                contentType: "application/json",
                data: JSON.stringify({ fields: { duedate: dueDateStr } })
            });
        },

        // Jira Software Server/DC (GreenHopper) rapid charts — для 1-в-1 как в Jira Sprint Report
        getRapidSprintReport: function(rapidViewId, sprintId) {
            return $.ajax({
                url: baseUrl + "/rest/greenhopper/1.0/rapid/charts/sprintreport",
                data: { rapidViewId: rapidViewId, sprintId: sprintId }
            });
        },
        getRapidScopeChangeBurndown: function(rapidViewId, sprintId, statisticFieldId) {
            // Jira иногда чувствителен к типам параметров/кэшу — делаем максимально близко к вызову из UI Jira
            var rv = Number(rapidViewId);
            var sid = Number(sprintId);
            return $.ajax({
                url: baseUrl + "/rest/greenhopper/1.0/rapid/charts/scopechangeburndownchart",
                cache: false, // добавит _=timestamp как в Jira UI
                data: {
                    rapidViewId: rv,
                    sprintId: sid,
                    statisticFieldId: statisticFieldId
                }
            });
        }
    };

    return api;
});
