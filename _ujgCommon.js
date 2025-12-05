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
        formatDateShort: function(d) {
            if (!d || !(d instanceof Date) || isNaN(d.getTime())) return "";
            var dd = d.getDate(), mm = d.getMonth() + 1;
            return (dd < 10 ? "0" : "") + dd + "." + (mm < 10 ? "0" : "") + mm;
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
            return h > 0 ? h + "h" : (m > 0 ? m + "m" : "");
        },
        escapeHtml: function(t) { if (!t) return ""; var d = document.createElement("div"); d.textContent = String(t); return d.innerHTML; },
        getDayKey: function(d) {
            if (!d || !(d instanceof Date) || isNaN(d.getTime())) return "";
            return d.toISOString().slice(0, 10);
        },
        getDayOfWeek: function(d) {
            if (!d || !(d instanceof Date) || isNaN(d.getTime())) return 0;
            var day = d.getDay();
            return day === 0 ? 6 : day - 1; // Пн=0, Вс=6
        }
    };

    function daysBetween(start, end) {
        var res = [];
        if (!start || !end) return res;
        var cur = new Date(start); cur.setHours(0,0,0,0);
        var ed = new Date(end); ed.setHours(0,0,0,0);
        while (cur <= ed) { res.push(new Date(cur)); cur.setDate(cur.getDate() + 1); }
        return res;
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
        var done = 0, total = keys.length;
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

    function buildRangeData(options) {
        var start = options.start;
        var end = options.end;
        var filter = options.jqlFilter;
        var d = $.Deferred();
        if (!start || !end) { d.resolve({ days: [], users: [], calendarData: {}, totalSeconds: 0 }); return d.promise(); }
        var jql = filter ? filter : "";
        $.ajax({
            url: baseUrl + "/rest/api/2/search",
            type: "POST",
            contentType: "application/json",
            data: JSON.stringify({ 
                jql: jql, 
                fields: ["summary", "status", "timetracking", "timeoriginalestimate", "duedate", "assignee"], 
                maxResults: 1000 
            }),
            success: function(r) {
                var issues = (r && r.issues) ? r.issues : [];
                var issueMap = {};
                issues.forEach(function(iss) {
                    var tt = iss.fields && iss.fields.timetracking;
                    var estimate = 0;
                    if (tt && tt.originalEstimateSeconds) {
                        estimate = tt.originalEstimateSeconds;
                    } else if (iss.fields && iss.fields.timeoriginalestimate) {
                        estimate = iss.fields.timeoriginalestimate;
                    }
                    issueMap[iss.key] = {
                        key: iss.key,
                        summary: iss.fields && iss.fields.summary || "",
                        status: iss.fields && iss.fields.status && iss.fields.status.name || "",
                        estimate: estimate,
                        dueDate: iss.fields && iss.fields.duedate ? utils.parseDate(iss.fields.duedate) : null
                    };
                });
                var keys = issues.map(function(i) { return i.key; });
                loadWorklogsForIssues(keys).then(function(worklogsByIssue) {
                    var days = daysBetween(start, end);
                    var dayStart = days.length > 0 ? utils.getDayKey(days[0]) : null;
                    var dayEnd = days.length > 0 ? utils.getDayKey(days[days.length-1]) : null;
                    
                    var usersMap = {};
                    var totalSeconds = 0;
                    // calendarData[dayKey][issueKey] = { seconds, comments[], issueInfo }
                    var calendarData = {};
                    
                    days.forEach(function(day) {
                        calendarData[utils.getDayKey(day)] = {};
                    });
                    
                    issues.forEach(function(issue) {
                        var wls = worklogsByIssue[issue.key] || [];
                        wls.forEach(function(w) {
                            var dt = utils.parseDate(w.started);
                            if (!dt || isNaN(dt.getTime())) return;
                            var dKey = utils.getDayKey(dt);
                            if (dayStart && dayEnd && (dKey < dayStart || dKey > dayEnd)) return;
                            
                            var uid = (w.author && (w.author.accountId || w.author.key || w.author.name)) || "unknown";
                            var uname = (w.author && (w.author.displayName || w.author.name)) || uid;
                            if (!usersMap[uid]) usersMap[uid] = { id: uid, name: uname, totalSeconds: 0 };
                            
                            // Calendar data
                            if (!calendarData[dKey]) calendarData[dKey] = {};
                            if (!calendarData[dKey][issue.key]) {
                                var info = issueMap[issue.key] || {};
                                calendarData[dKey][issue.key] = {
                                    key: issue.key,
                                    summary: info.summary || "",
                                    status: info.status || "",
                                    estimate: info.estimate || 0,
                                    dueDate: info.dueDate || null,
                                    seconds: 0,
                                    comments: [],
                                    authors: {}
                                };
                            }
                            calendarData[dKey][issue.key].seconds += w.timeSpentSeconds || 0;
                            if (w.comment) calendarData[dKey][issue.key].comments.push(w.comment);
                            calendarData[dKey][issue.key].authors[uid] = uname;
                            
                            usersMap[uid].totalSeconds += w.timeSpentSeconds || 0;
                            totalSeconds += w.timeSpentSeconds || 0;
                        });
                    });
                    
                    var users = Object.keys(usersMap).map(function(id) {
                        return usersMap[id];
                    }).sort(function(a, b) { return a.name.localeCompare(b.name); });

                    d.resolve({
                        days: days,
                        users: users,
                        calendarData: calendarData,
                        issueMap: issueMap,
                        totalSeconds: totalSeconds
                    });
                }, d.reject);
            },
            error: function(e) { d.reject(e); }
        });
        return d.promise();
    }

    return {
        baseUrl: baseUrl,
        utils: utils,
        buildRangeData: buildRangeData
    };
});
