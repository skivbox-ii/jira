define("_ujgUA_api", ["jquery", "_ujgCommon", "_ujgUA_config", "_ujgUA_utils"], function($, Common, config, utils) {
    "use strict";

    var baseUrl = Common.baseUrl || "";
    var CONFIG = config.CONFIG;

    function searchIssues(jql, fields, expand, maxResults) {
        var d = $.Deferred();
        var all = [];
        var pageSize = maxResults || CONFIG.maxResults;

        function fetchPage(startAt) {
            var body = {
                jql: jql,
                startAt: startAt,
                maxResults: pageSize,
                fields: fields || ["summary","status","issuetype","assignee","project","timeoriginalestimate","timespent","created","updated","comment"]
            };
            if (expand) body.expand = expand;

            $.ajax({
                url: baseUrl + "/rest/api/2/search",
                type: "POST",
                contentType: "application/json",
                data: JSON.stringify(body),
                dataType: "json"
            }).done(function(resp) {
                all = all.concat(resp.issues || []);
                if (all.length < resp.total && resp.issues && resp.issues.length > 0) {
                    fetchPage(startAt + resp.issues.length);
                } else {
                    d.resolve(all);
                }
            }).fail(function(xhr, status) {
                d.reject(status === "abort" ? "cancelled" : "JQL search failed: " + (xhr.responseJSON && xhr.responseJSON.errorMessages || []).join(", "));
            });
        }

        fetchPage(0);
        return d.promise();
    }

    function fetchWorklogIssues(username, startDate, endDate) {
        var jql = 'worklogAuthor = "' + username + '" AND worklogDate >= "' + startDate + '" AND worklogDate <= "' + endDate + '"';
        return searchIssues(jql, ["summary","status","issuetype","project","timespent","timeoriginalestimate","assignee","created","updated","comment"]);
    }

    function fetchActivityIssues(username, startDate, endDate) {
        var jql = '(assignee was "' + username + '" OR reporter = "' + username + '") AND updated >= "' + startDate + '" AND updated <= "' + endDate + '"';
        return searchIssues(jql, ["summary","status","issuetype","project","timespent","timeoriginalestimate","assignee","created","updated","comment"]);
    }

    function fetchIssueChangelog(issueKey) {
        var d = $.Deferred();
        var allHistories = [];

        function fetchPage(startAt) {
            $.ajax({
                url: baseUrl + "/rest/api/2/issue/" + issueKey + "?expand=changelog&fields=summary",
                type: "GET",
                dataType: "json",
                data: { startAt: startAt, maxResults: 100 }
            }).done(function(resp) {
                var cl = resp.changelog || {};
                allHistories = allHistories.concat(cl.histories || []);
                if (allHistories.length < (cl.total || 0) && (cl.histories || []).length > 0) {
                    fetchPage(startAt + cl.histories.length);
                } else {
                    d.resolve(allHistories);
                }
            }).fail(function(xhr, status) {
                d.reject(status === "abort" ? "cancelled" : "changelog failed");
            });
        }

        fetchPage(0);
        return d.promise();
    }

    function fetchIssueWorklogs(issueKey) {
        return $.ajax({
            url: baseUrl + "/rest/api/2/issue/" + issueKey + "/worklog",
            type: "GET",
            dataType: "json"
        }).then(function(resp) {
            return resp.worklogs || [];
        });
    }

    function fetchIssueDetails(issueKey) {
        var d = $.Deferred();
        $.when(
            fetchIssueChangelog(issueKey),
            fetchIssueWorklogs(issueKey)
        ).done(function(changelog, worklogs) {
            d.resolve({ changelog: changelog, worklogs: worklogs });
        }).fail(function(err) {
            d.resolve({ changelog: [], worklogs: [], error: err });
        });
        return d.promise();
    }

    function fetchAllData(username, startDate, endDate, onProgress) {
        var d = $.Deferred();
        var progress = { phase: "search", loaded: 0, total: 0 };

        if (onProgress) onProgress(progress);

        $.when(
            fetchWorklogIssues(username, startDate, endDate),
            fetchActivityIssues(username, startDate, endDate)
        ).done(function(worklogIssues, activityIssues) {
            var issueMap = {};
            (worklogIssues || []).concat(activityIssues || []).forEach(function(issue) {
                issueMap[issue.key] = issue;
            });
            var keys = Object.keys(issueMap);
            var issues = keys.map(function(k) { return issueMap[k]; });

            progress.phase = "details";
            progress.total = keys.length;
            progress.loaded = 0;
            if (onProgress) onProgress(progress);

            if (keys.length === 0) {
                d.resolve({ issues: [], details: {} });
                return;
            }

            var queue = keys.slice();
            var details = {};
            var running = 0;

            function processNext() {
                while (running < CONFIG.maxConcurrent && queue.length > 0) {
                    var key = queue.shift();
                    running++;
                    fetchIssueDetails(key).done(function(k) {
                        return function(det) {
                            details[k] = det;
                            running--;
                            progress.loaded++;
                            if (onProgress) onProgress(progress);
                            if (queue.length === 0 && running === 0) {
                                d.resolve({ issues: issues, details: details });
                            } else {
                                processNext();
                            }
                        };
                    }(key)).fail(function() {
                        running--;
                        progress.loaded++;
                        if (onProgress) onProgress(progress);
                        processNext();
                    });
                }
            }

            processNext();

        }).fail(function(err) {
            d.reject(err);
        });

        return d.promise();
    }

    function fetchIssueComments(issueKeys, onProgress) {
        var results = {};
        var completed = 0;
        var d = $.Deferred();

        if (!issueKeys || issueKeys.length === 0) {
            d.resolve(results);
            return d.promise();
        }

        var queue = issueKeys.slice();
        var maxConcurrent = CONFIG.maxConcurrent;
        var running = 0;

        function processNext() {
            while (running < maxConcurrent && queue.length > 0) {
                var key = queue.shift();
                running++;
                (function(issueKey) {
                    $.ajax({
                        url: baseUrl + "/rest/api/2/issue/" + issueKey + "/comment",
                        type: "GET",
                        dataType: "json"
                    }).done(function(data) {
                        results[issueKey] = (data.comments || []).map(function(c) {
                            return {
                                id: c.id,
                                author: {
                                    name: c.author && (c.author.name || c.author.key || ""),
                                    displayName: c.author && (c.author.displayName || c.author.name || "")
                                },
                                body: c.body || "",
                                created: c.created,
                                updated: c.updated
                            };
                        });
                    }).fail(function() {
                        results[issueKey] = [];
                    }).always(function() {
                        running--;
                        completed++;
                        if (onProgress) {
                            onProgress(completed, issueKeys.length);
                        }
                        if (queue.length > 0) {
                            processNext();
                        } else if (running === 0) {
                            d.resolve(results);
                        }
                    });
                })(key);
            }
        }

        processNext();
        return d.promise();
    }

    function searchUsers(query) {
        return $.ajax({
            url: baseUrl + "/rest/api/2/user/picker",
            type: "GET",
            data: { query: query, maxResults: 10 },
            dataType: "json"
        }).then(function(resp) {
            return (resp.users || resp || []).map(function(u) {
                return { name: u.name || u.key, displayName: u.displayName, avatarUrl: u.avatarUrls && u.avatarUrls["24x24"] };
            });
        });
    }

    return {
        fetchAllData: fetchAllData,
        fetchIssueComments: fetchIssueComments,
        searchUsers: searchUsers
    };
});
