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

    function dayBoundsMs(startDate, endDate) {
        return {
            start: new Date(String(startDate) + "T00:00:00.000Z").getTime(),
            end: new Date(String(endDate) + "T23:59:59.999Z").getTime()
        };
    }

    function firstDefined() {
        var i;
        for (i = 0; i < arguments.length; i++) {
            if (arguments[i] != null && arguments[i] !== "") return String(arguments[i]);
        }
        return "";
    }

    function xmlFirstText(block, tag) {
        var re = new RegExp("<" + tag + "(?:\\s[^>]*)?>([\\s\\S]*?)</" + tag + ">", "i");
        var m = block.match(re);
        if (!m) return "";
        return String(m[1]).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, "$1").replace(/<[^>]+>/g, "").trim();
    }

    function publishedDayAndTime(published) {
        var s = String(published || "").trim();
        var m = s.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
        if (m) return { date: m[1], time: m[2] };
        var dt = utils.parseDate(s);
        if (!dt) return null;
        return { date: utils.getDayKey(dt), time: dt.toISOString().slice(11, 16) };
    }

    function parseTitleForActivity(rawTitle) {
        var title = String(rawTitle || "").trim();
        var m = title.match(/\s+(\w+)\s+on\s+([A-Z][A-Z0-9_]*-\d+)\s*$/i);
        if (!m) return null;
        return { verb: String(m[1]).toLowerCase(), issueKey: m[2] };
    }

    function extractAtomNextHref(xmlText) {
        var t = String(xmlText || "");
        var m =
            t.match(/<link([^>]+)>/gi) ||
            [];
        var i;
        for (i = 0; i < m.length; i++) {
            var tag = m[i];
            if (!/rel\s*=\s*["']next["']/i.test(tag)) continue;
            var hm = tag.match(/href\s*=\s*["']([^"']+)["']/i);
            if (hm) return hm[1].replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
        }
        return "";
    }

    function resolveActivityUrl(base, href) {
        var h = String(href || "");
        if (!h) return "";
        if (/^https?:\/\//i.test(h)) return h;
        if (h.indexOf("/") === 0) return trimBase(base) + h;
        return trimBase(base) + "/" + h;
    }

    function fetchUserRecord(base, params) {
        return $.ajax({
            url: base + "/rest/api/2/user",
            type: "GET",
            dataType: "json",
            data: params
        });
    }

    function resolveActivityUsername(base, memberKey, cache) {
        var d = $.Deferred();
        var cacheKey = String(memberKey || "");
        if (!cacheKey) {
            d.resolve("");
            return d.promise();
        }
        if (Object.prototype.hasOwnProperty.call(cache, cacheKey)) {
            d.resolve(cache[cacheKey]);
            return d.promise();
        }
        fetchUserRecord(base, { key: cacheKey })
            .done(function(user) {
                var username = firstDefined(user && user.name, user && user.username);
                cache[cacheKey] = username;
                d.resolve(username);
            })
            .fail(function() {
                fetchUserRecord(base, { username: cacheKey })
                    .done(function(user) {
                        var username = firstDefined(user && user.name, user && user.username);
                        cache[cacheKey] = username;
                        d.resolve(username);
                    })
                    .fail(function() {
                        cache[cacheKey] = "";
                        d.resolve("");
                    });
            });
        return d.promise();
    }

    function normalizeAtomEntry(entryXml, userKey, startStr, endStr) {
        var rawTitle = xmlFirstText(entryXml, "title");
        var published = xmlFirstText(entryXml, "published");
        var issueSummary = xmlFirstText(entryXml, "summary");
        var categoryTerm = "";
        var cat = entryXml.match(/<category([^>]*)\/?>/i);
        if (cat && cat[1]) {
            var tm = cat[1].match(/term\s*=\s*["']([^"']*)["']/i);
            if (tm) categoryTerm = String(tm[1]).trim().toLowerCase();
        }
        var pt = publishedDayAndTime(published);
        if (!pt || pt.date < startStr || pt.date > endStr) return null;
        var fromTitle = parseTitleForActivity(rawTitle);
        var eventType;
        var text;
        var issueKey;
        if (fromTitle) {
            eventType = fromTitle.verb;
            text = fromTitle.verb;
            issueKey = fromTitle.issueKey;
        } else if (categoryTerm) {
            eventType = categoryTerm;
            text = categoryTerm;
            issueKey = "";
        } else {
            return null;
        }
        return {
            userKey: userKey,
            date: pt.date,
            time: pt.time,
            issueKey: issueKey,
            issueSummary: issueSummary,
            eventType: eventType,
            text: text,
            rawTitle: rawTitle
        };
    }

    function splitAtomEntries(xmlText) {
        var t = String(xmlText || "");
        var out = [];
        var re = /<entry\b[^>]*>([\s\S]*?)<\/entry>/gi;
        var m;
        while ((m = re.exec(t)) !== null) {
            out.push(m[0]);
        }
        return out;
    }

    function fetchActivityFeedForUser(base, userKey, username, startStr, endStr) {
        var d = $.Deferred();
        var bounds = dayBoundsMs(startStr, endStr);
        var collected = [];

        function runPage(requestUrl, ajaxOpts) {
            var opts =
                ajaxOpts ||
                {
                    url: base + "/activity",
                    type: "GET",
                    dataType: "text",
                    data: {
                        streams: [
                            "user+IS+" + username,
                            "update-date+BETWEEN+" + bounds.start + "+" + bounds.end
                        ],
                        maxResults: maxResults
                    },
                    traditional: true
                };
            $.ajax(opts)
                .done(function(xmlText) {
                    var i;
                    var blocks = splitAtomEntries(xmlText);
                    for (i = 0; i < blocks.length; i++) {
                        var ev = normalizeAtomEntry(blocks[i], userKey, startStr, endStr);
                        if (ev) collected.push(ev);
                    }
                    var nextHref = extractAtomNextHref(xmlText);
                    if (nextHref) {
                        runPage(null, {
                            url: resolveActivityUrl(base, nextHref),
                            type: "GET",
                            dataType: "text",
                            traditional: true
                        });
                    } else {
                        d.resolve(collected);
                    }
                })
                .fail(function() {
                    d.resolve([]);
                });
        }

        runPage(null, null);
        return d.promise();
    }

    function fetchProfileEvents(base, userKeys, startStr, endStr) {
        var d = $.Deferred();
        var keys = (userKeys || []).filter(Boolean);
        var cache = {};
        var merged = [];
        var idx = 0;

        function nextUser() {
            if (idx >= keys.length) {
                d.resolve(merged);
                return;
            }
            var memberKey = keys[idx++];
            resolveActivityUsername(base, memberKey, cache).done(function(username) {
                if (!username) {
                    nextUser();
                    return;
                }
                fetchActivityFeedForUser(base, memberKey, username, startStr, endStr).done(function(events) {
                    merged = merged.concat(events || []);
                    nextUser();
                });
            });
        }

        nextUser();
        return d.promise();
    }

    function fetchTeamData(userKeys, startDate, endDate, onProgress) {
        var d = $.Deferred();
        var keys = (userKeys || []).filter(Boolean);
        if (keys.length === 0) {
            if (onProgress) onProgress({ loaded: 0, total: 0, phase: "jira" });
            d.resolve({ issues: [], profileEvents: [] });
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
                        fetchProfileEvents(base, keys, startDate, endDate).done(function(profileEvents) {
                            d.resolve({
                                issues: allIssues,
                                profileEvents: profileEvents || []
                            });
                        });
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
