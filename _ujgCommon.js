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
            return day === 0 ? 6 : day - 1;
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

    // Загрузка данных за один день
    function loadDayData(day, jqlFilter) {
        var d = $.Deferred();
        var dayKey = utils.getDayKey(day);
        var nextDay = new Date(day);
        nextDay.setDate(nextDay.getDate() + 1);
        var nextDayKey = utils.getDayKey(nextDay);
        
        // JQL для поиска задач с worklog за этот день
        var jql = 'worklogDate >= "' + dayKey + '" AND worklogDate < "' + nextDayKey + '"';
        if (jqlFilter) jql += " AND (" + jqlFilter + ")";
        
        $.ajax({
            url: baseUrl + "/rest/api/2/search",
            type: "POST",
            contentType: "application/json",
            data: JSON.stringify({ 
                jql: jql, 
                fields: ["summary", "status", "timetracking", "timeoriginalestimate", "duedate"], 
                maxResults: 500 
            }),
            success: function(r) {
                var issues = (r && r.issues) ? r.issues : [];
                if (issues.length === 0) {
                    d.resolve({ dayKey: dayKey, issues: [] });
                    return;
                }
                
                // Загружаем worklogs для найденных задач
                var keys = issues.map(function(i) { return i.key; });
                var issueMap = {};
                issues.forEach(function(iss) {
                    var tt = iss.fields && iss.fields.timetracking;
                    var estimate = 0;
                    if (tt && tt.originalEstimateSeconds) estimate = tt.originalEstimateSeconds;
                    else if (iss.fields && iss.fields.timeoriginalestimate) estimate = iss.fields.timeoriginalestimate;
                    issueMap[iss.key] = {
                        key: iss.key,
                        summary: iss.fields && iss.fields.summary || "",
                        status: iss.fields && iss.fields.status && iss.fields.status.name || "",
                        estimate: estimate
                    };
                });
                
                loadWorklogsForDay(keys, dayKey).then(function(dayIssues) {
                    // Добавляем инфу из issueMap
                    dayIssues.forEach(function(di) {
                        var info = issueMap[di.key] || {};
                        di.summary = info.summary || "";
                        di.status = info.status || "";
                        di.estimate = info.estimate || 0;
                    });
                    d.resolve({ dayKey: dayKey, issues: dayIssues });
                }, function() {
                    d.resolve({ dayKey: dayKey, issues: [] });
                });
            },
            error: function() { d.resolve({ dayKey: dayKey, issues: [] }); }
        });
        return d.promise();
    }
    
    function loadWorklogsForDay(keys, dayKey) {
        var d = $.Deferred();
        if (!keys || keys.length === 0) { d.resolve([]); return d.promise(); }
        
        var result = [];
        var done = 0;
        
        keys.forEach(function(key) {
            $.ajax({
                url: baseUrl + "/rest/api/2/issue/" + key + "/worklog",
                type: "GET",
                success: function(r) {
                    var wls = (r && r.worklogs) ? r.worklogs : [];
                    var dayWls = wls.filter(function(w) {
                        var dt = utils.parseDate(w.started);
                        return dt && utils.getDayKey(dt) === dayKey;
                    });
                    
                    if (dayWls.length > 0) {
                        var seconds = 0;
                        var comments = [];
                        var authors = {};
                        dayWls.forEach(function(w) {
                            seconds += w.timeSpentSeconds || 0;
                            if (w.comment) comments.push(w.comment);
                            var uid = (w.author && (w.author.accountId || w.author.key || w.author.name)) || "unknown";
                            var uname = (w.author && (w.author.displayName || w.author.name)) || uid;
                            authors[uid] = uname;
                        });
                        result.push({ key: key, seconds: seconds, comments: comments, authors: authors });
                    }
                    done++;
                    if (done === keys.length) d.resolve(result);
                },
                error: function() {
                    done++;
                    if (done === keys.length) d.resolve(result);
                }
            });
        });
        return d.promise();
    }

    return {
        baseUrl: baseUrl,
        utils: utils,
        daysBetween: daysBetween,
        loadDayData: loadDayData
    };
});
