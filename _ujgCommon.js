define("_ujgCommon", ["jquery"], function($) {
    var baseUrl = (typeof AJS !== "undefined" && AJS.contextPath) ? AJS.contextPath() : "";

    var utils = {
        parseDate: function(v) {
            if (!v) return null;
            if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
            if (typeof v === "number") { var d = new Date(v); return isNaN(d.getTime()) ? null : d; }
            if (typeof v === "string") {
                var d = new Date(v);
                if (!isNaN(d.getTime())) return d;
                var m = v.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{3})([+-])(\d{2})(\d{2})$/);
                if (m) { d = new Date(m[1] + "-" + m[2] + "-" + m[3] + "T" + m[4] + ":" + m[5] + ":" + m[6] + "." + m[7] + m[8] + m[9] + ":" + m[10]); if (!isNaN(d.getTime())) return d; }
            }
            return null;
        },
        formatDate: function(d, loc) {
            if (!d || !(d instanceof Date) || isNaN(d.getTime())) return "";
            try { return d.toLocaleDateString(loc || "ru-RU", { day: "numeric", month: "short", year: "numeric" }); }
            catch (e) { return d.getDate() + "." + (d.getMonth() + 1) + "." + d.getFullYear(); }
        },
        formatDayShort: function(d, loc) {
            if (!d || !(d instanceof Date) || isNaN(d.getTime())) return "";
            try { return d.toLocaleDateString(loc || "en-GB", { day: "2-digit", month: "short" }); }
            catch (e) { return (d.getDate() < 10 ? "0" : "") + d.getDate() + " " + ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][d.getMonth()]; }
        },
        formatTime: function(s) {
            if (!s || s <= 0) return "";
            var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
            if (h > 0 && m > 0) return h + "h " + m + "m";
            return h > 0 ? h + "h" : (m > 0 ? m + "m" : "0m");
        },
        escapeHtml: function(t) { if (!t) return ""; var d = document.createElement("div"); d.textContent = String(t); return d.innerHTML; },
        unique: function(arr, key) {
            var seen = {}, res = [];
            if (!arr) return res;
            arr.forEach(function(i) { var v = key ? i[key] : i; if (v && !seen[v]) { seen[v] = true; res.push(v); } });
            return res;
        }
    };

    function parseSprint(raw) {
        if (!raw) return null;
        if (typeof raw === "object") {
            return {
                id: raw.id || raw.sprintId || null,
                name: raw.name || "",
                start: utils.parseDate(raw.startDate),
                end: utils.parseDate(raw.endDate),
                state: raw.state || ""
            };
        }
        if (typeof raw === "string") {
            var id = null, name = "", state = "", start = null, end = null;
            var mId = raw.match(/id=(\d+)/); if (mId) id = mId[1];
            var mName = raw.match(/name=([^,\]]+)/); if (mName) name = mName[1];
            var mState = raw.match(/state=([^,\]]+)/); if (mState) state = mState[1];
            var mStart = raw.match(/startDate=([^\],]+)/); if (mStart) start = utils.parseDate(mStart[1]);
            var mEnd = raw.match(/endDate=([^\],]+)/); if (mEnd) end = utils.parseDate(mEnd[1]);
            return { id: id, name: name, start: start, end: end, state: state };
        }
        return null;
    }

    function extractSprintsFromIssue(issue) {
        var result = [];
        if (!issue || !issue.fields) return result;
        var sf = issue.fields.sprint || issue.fields.customfield_10020;
        if (Array.isArray(sf)) {
            sf.forEach(function(s) { var parsed = parseSprint(s); if (parsed) result.push(parsed); });
        } else if (sf) {
            var parsed = parseSprint(sf);
            if (parsed) result.push(parsed);
        }
        return result;
    }

    function listActiveSprints(opts) {
        var options = opts || {};
        var jql = "sprint in openSprints()";
        if (options.jqlFilter) jql += " AND (" + options.jqlFilter + ")";
        var d = $.Deferred();
        $.ajax({
            url: baseUrl + "/rest/api/2/search",
            type: "POST",
            contentType: "application/json",
            data: JSON.stringify({ jql: jql, fields: ["sprint", "customfield_10020"], maxResults: 500 }),
            success: function(r) {
                var map = {};
                if (r && r.issues) {
                    r.issues.forEach(function(iss) {
                        extractSprintsFromIssue(iss).forEach(function(s) {
                            if (s.id && !map[s.id]) map[s.id] = s;
                        });
                    });
                }
                var list = Object.keys(map).map(function(id) { return map[id]; }).sort(function(a, b) {
                    if (a.start && b.start) return a.start - b.start;
                    return (a.name || "").localeCompare(b.name || "");
                });
                d.resolve(list);
            },
            error: function(e) { d.reject(e); }
        });
        return d.promise();
    }

    function getSprintIssues(sprintId, opts) {
        var options = opts || {};
        var jql = "sprint = " + sprintId;
        if (options.jqlFilter) jql += " AND (" + options.jqlFilter + ")";
        var d = $.Deferred();
        $.ajax({
            url: baseUrl + "/rest/api/2/search",
            type: "POST",
            contentType: "application/json",
            data: JSON.stringify({ jql: jql, fields: ["summary", "status", "assignee", "sprint", "customfield_10020"], maxResults: 1000 }),
            success: function(r) { d.resolve((r && r.issues) ? r.issues : []); },
            error: function(e) { d.reject(e); }
        });
        return d.promise();
    }

    function fetchWorklogsForIssue(issueKey) {
        var d = $.Deferred();
        $.ajax({
            url: baseUrl + "/rest/api/2/issue/" + issueKey + "/worklog",
            type: "GET",
            success: function(r) { d.resolve(r && r.worklogs ? r.worklogs : []); },
            error: function(e) { d.reject(e); }
        });
        return d.promise();
    }

    function loadWorklogsForIssues(keys) {
        var d = $.Deferred();
        if (!keys || keys.length === 0) { d.resolve({}); return d.promise(); }
        var res = {};
        var done = 0, total = keys.length, failed = false;
        keys.forEach(function(k) {
            fetchWorklogsForIssue(k).then(function(wl) {
                res[k] = wl;
                done++; if (done === total) d.resolve(res);
            }, function() {
                res[k] = [];
                done++; if (done === total) d.resolve(res);
            });
        });
        return d.promise();
    }

    function daysBetween(start, end) {
        var res = [];
        if (!start || !end) return res;
        var cur = new Date(start); cur.setHours(0,0,0,0);
        var ed = new Date(end); ed.setHours(0,0,0,0);
        while (cur <= ed) { res.push(new Date(cur)); cur.setDate(cur.getDate() + 1); }
        return res;
    }

    function buildSprintData(options) {
        var sprintId = options.sprintId;
        var filter = options.jqlFilter;
        var d = $.Deferred();
        getSprintIssues(sprintId, { jqlFilter: filter }).then(function(issues) {
            var keys = issues.map(function(i) { return i.key; });
            loadWorklogsForIssues(keys).then(function(worklogsByIssue) {
                var sprintInfo = null;
                // попытка взять данные спринта из первого подходящего поля
                for (var i = 0; i < issues.length; i++) {
                    var spArr = extractSprintsFromIssue(issues[i]).filter(function(s) { return s.id == sprintId; });
                    if (spArr.length > 0) { sprintInfo = spArr[0]; break; }
                }
                var start = sprintInfo && sprintInfo.start;
                var end = sprintInfo && sprintInfo.end;
                // fallback: вычислить по датам ворклогов
                if (!start || !end) {
                    var minDt = null, maxDt = null;
                    Object.keys(worklogsByIssue).forEach(function(k) {
                        worklogsByIssue[k].forEach(function(w) {
                            var dt = utils.parseDate(w.started);
                            if (!dt || isNaN(dt.getTime())) return;
                            if (!minDt || dt < minDt) minDt = dt;
                            if (!maxDt || dt > maxDt) maxDt = dt;
                        });
                    });
                    if (minDt && maxDt) {
                        start = new Date(minDt); start.setHours(0,0,0,0);
                        end = new Date(maxDt); end.setHours(0,0,0,0);
                    }
                }
                if (!start || !end) {
                    d.resolve({ sprint: { id: sprintId, name: "" }, days: [], users: [], totalSeconds: 0 });
                    return;
                }
                var days = daysBetween(start, end);
                var usersMap = {};
                var totalSeconds = 0;

                issues.forEach(function(issue) {
                    var wls = worklogsByIssue[issue.key] || [];
                    wls.forEach(function(w) {
                        var dt = utils.parseDate(w.started);
                        if (!dt || isNaN(dt.getTime())) return;
                        var dKey = dt.toISOString().slice(0,10);
                        var sprintStartKey = days.length > 0 ? days[0].toISOString().slice(0,10) : null;
                        var sprintEndKey = days.length > 0 ? days[days.length - 1].toISOString().slice(0,10) : null;
                        if (sprintStartKey && sprintEndKey && (dKey < sprintStartKey || dKey > sprintEndKey)) return;
                        var uid = (w.author && (w.author.accountId || w.author.key || w.author.name)) || "unknown";
                        var uname = (w.author && (w.author.displayName || w.author.name)) || uid;
                        if (!usersMap[uid]) usersMap[uid] = { id: uid, name: uname, issues: {}, totalSeconds: 0 };
                        var u = usersMap[uid];
                        if (!u.issues[issue.key]) {
                            u.issues[issue.key] = {
                                key: issue.key,
                                summary: issue.fields && issue.fields.summary || "",
                                status: issue.fields && issue.fields.status && issue.fields.status.name || "",
                                perDay: {},
                                totalSeconds: 0
                            };
                        }
                        var perIssue = u.issues[issue.key];
                        if (!perIssue.perDay[dKey]) perIssue.perDay[dKey] = { seconds: 0, comments: [] };
                        perIssue.perDay[dKey].seconds += w.timeSpentSeconds || 0;
                        if (w.comment) perIssue.perDay[dKey].comments.push(w.comment);
                        perIssue.totalSeconds += w.timeSpentSeconds || 0;
                        u.totalSeconds += w.timeSpentSeconds || 0;
                        totalSeconds += w.timeSpentSeconds || 0;
                    });
                });

                var users = Object.keys(usersMap).map(function(id) {
                    var u = usersMap[id];
                    u.issueList = Object.keys(u.issues).map(function(k) { return u.issues[k]; }).sort(function(a, b) {
                        return (a.key || "").localeCompare(b.key || "");
                    });
                    return u;
                }).sort(function(a, b) { return a.name.localeCompare(b.name); });

                d.resolve({
                    sprint: sprintInfo || { id: sprintId, name: "" },
                    days: days,
                    users: users,
                    totalSeconds: totalSeconds
                });
            }, d.reject);
        }, d.reject);
        return d.promise();
    }

    return {
        baseUrl: baseUrl,
        utils: utils,
        listActiveSprints: listActiveSprints,
        buildSprintData: buildSprintData
    };
});

