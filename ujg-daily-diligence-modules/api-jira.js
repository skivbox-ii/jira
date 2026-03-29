define("_ujgDD_apiJira", ["jquery", "_ujgCommon", "_ujgDD_config"], function($, Common, config) {
    "use strict";

    var utils = Common.utils;
    var maxResults = 200;

    function trimBase(u) {
        return String(u || "").replace(/\/+$/, "");
    }

    function buildKeySet(userKeys) {
        var set = {};
        (userKeys || []).forEach(function(k) {
            if (k) set[String(k)] = true;
        });
        return set;
    }

    function jqlQuoteKeys(userKeys) {
        return (userKeys || []).filter(Boolean).map(function(k) {
            return "\"" + String(k).replace(/\\/g, "\\\\").replace(/"/g, "\\\"") + "\"";
        }).join(", ");
    }

    function worklogMatches(w, keySet, startStr, endStr) {
        var uid = w.author && (w.author.accountId || w.author.key || w.author.name);
        if (!uid || !keySet[uid]) return false;
        var dt = utils.parseDate(w.started);
        if (!dt) return false;
        var day = utils.getDayKey(dt);
        return day >= startStr && day <= endStr;
    }

    function formatAjaxError(xhr, status, fallback) {
        var msgs = xhr && xhr.responseJSON && xhr.responseJSON.errorMessages;
        return status === "abort" ? "cancelled" : (msgs && msgs.join(", ")) || (xhr && xhr.statusText) || fallback;
    }

    function isWorklogTruncated(wl) {
        return !!(wl && wl.worklogs && typeof wl.total === "number" && wl.total > wl.worklogs.length);
    }

    function filterFieldsWorklog(wl, keySet, startStr, endStr, worklogs) {
        if (!wl && !worklogs) return wl;
        var source = worklogs || (wl && wl.worklogs) || [];
        var filtered = source.filter(function(w) {
            return worklogMatches(w, keySet, startStr, endStr);
        });
        return {
            startAt: 0,
            maxResults: source.length,
            total: filtered.length,
            worklogs: filtered
        };
    }

    function filterChangelog(cl, startStr, endStr) {
        if (!cl || !cl.histories) return { histories: [] };
        var histories = [];
        cl.histories.forEach(function(h) {
            var dt = utils.parseDate(h.created);
            if (!dt) return;
            var day = utils.getDayKey(dt);
            if (day < startStr || day > endStr) return;
            var items = (h.items || []).filter(function(it) {
                return it.field === "status";
            });
            if (items.length === 0) return;
            histories.push({
                id: h.id,
                author: h.author,
                created: h.created,
                items: items
            });
        });
        return { histories: histories };
    }

    function sliceIssue(issue, keySet, startStr, endStr) {
        if (issue.fields && issue.fields.worklog && !isWorklogTruncated(issue.fields.worklog)) {
            issue.fields.worklog = filterFieldsWorklog(issue.fields.worklog, keySet, startStr, endStr);
        }
        if (issue.changelog) {
            issue.changelog = filterChangelog(issue.changelog, startStr, endStr);
        }
    }

    function fetchIssueWorklogs(base, issueKey) {
        var d = $.Deferred();
        var all = [];

        function fetchPage(startAt) {
            $.ajax({
                url: base + "/rest/api/2/issue/" + issueKey + "/worklog",
                type: "GET",
                dataType: "json",
                data: {
                    startAt: startAt,
                    maxResults: maxResults
                }
            }).done(function(resp) {
                var batch = resp.worklogs || [];
                all = all.concat(batch);
                if (all.length < (resp.total || 0) && batch.length > 0) {
                    fetchPage(startAt + batch.length);
                } else {
                    d.resolve(all);
                }
            }).fail(function(xhr, status) {
                d.reject(formatAjaxError(xhr, status, "worklog failed"));
            });
        }

        fetchPage(0);
        return d.promise();
    }

    function backfillTruncatedWorklogs(base, issues, keySet, startStr, endStr) {
        var d = $.Deferred();
        var pending = (issues || []).filter(function(issue) {
            return issue && issue.fields && isWorklogTruncated(issue.fields.worklog);
        });
        var index = 0;

        function next() {
            var issue = pending[index++];
            if (!issue) {
                d.resolve();
                return;
            }
            fetchIssueWorklogs(base, issue.key).done(function(worklogs) {
                issue.fields.worklog = filterFieldsWorklog(issue.fields.worklog, keySet, startStr, endStr, worklogs);
                next();
            }).fail(function(err) {
                d.reject(err);
            });
        }

        next();
        return d.promise();
    }

    function fetchTeamData(userKeys, startDate, endDate, onProgress) {
        var d = $.Deferred();
        var keys = (userKeys || []).filter(Boolean);
        if (keys.length === 0) {
            if (onProgress) onProgress({ loaded: 0, total: 0, phase: "jira" });
            d.resolve({ issues: [] });
            return d.promise();
        }

        var keySet = buildKeySet(keys);
        var jql = "worklogAuthor in (" + jqlQuoteKeys(keys) + ") AND worklogDate >= \"" + startDate + "\" AND worklogDate <= \"" + endDate + "\"";
        var base = trimBase(config.jiraBaseUrl);
        var allIssues = [];
        var totalKnown = 0;

        function fetchPage(startAt) {
            $.ajax({
                url: base + "/rest/api/2/search",
                type: "GET",
                dataType: "json",
                data: {
                    jql: jql,
                    startAt: startAt,
                    maxResults: maxResults,
                    fields: "worklog,summary,status,issuetype,project",
                    expand: "changelog"
                }
            }).done(function(resp) {
                var batch = resp.issues || [];
                if (totalKnown === 0 && typeof resp.total === "number") totalKnown = resp.total;

                batch.forEach(function(issue) {
                    sliceIssue(issue, keySet, startDate, endDate);
                    allIssues.push(issue);
                });

                if (onProgress) {
                    onProgress({
                        loaded: allIssues.length,
                        total: totalKnown || allIssues.length,
                        phase: "jira"
                    });
                }

                var hasMore = allIssues.length < (resp.total || 0) && batch.length > 0;
                if (hasMore) {
                    fetchPage(startAt + batch.length);
                } else {
                    backfillTruncatedWorklogs(base, allIssues, keySet, startDate, endDate).done(function() {
                        d.resolve({ issues: allIssues });
                    }).fail(function(err) {
                        d.reject(err);
                    });
                }
            }).fail(function(xhr, status) {
                d.reject(formatAjaxError(xhr, status, "search failed"));
            });
        }

        if (onProgress) onProgress({ loaded: 0, total: 0, phase: "jira" });
        fetchPage(0);
        return d.promise();
    }

    return {
        fetchTeamData: fetchTeamData
    };
});
