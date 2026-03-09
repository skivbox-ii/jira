define("_ujgUA_dataProcessor", ["_ujgUA_config", "_ujgUA_utils"], function(config, utils) {
    "use strict";

    function processData(rawData, username, startDate, endDate) {
        var dayMap = {};
        var issueMap = {};
        var projectMap = {};
        var transitionCounts = {};
        var startMs = new Date(startDate + "T00:00:00").getTime();
        var endMs = new Date(endDate + "T23:59:59").getTime();

        function ensureDay(dateStr) {
            if (!dayMap[dateStr]) {
                dayMap[dateStr] = { date: dateStr, worklogs: [], changes: [], issues: [], totalHours: 0 };
            }
            return dayMap[dateStr];
        }

        function addIssueToDay(dateStr, issueKey) {
            var day = ensureDay(dateStr);
            if (day.issues.indexOf(issueKey) === -1) day.issues.push(issueKey);
        }

        var issues = rawData.issues || [];
        var details = rawData.details || {};

        issues.forEach(function(issue) {
            var key = issue.key;
            var f = issue.fields || {};
            var projectKey = (f.project && f.project.key) || utils.getProjectKey(key);
            var projectName = (f.project && f.project.name) || projectKey;
            var statusName = (f.status && f.status.name) || "";
            var typeName = (f.issuetype && f.issuetype.name) || "";
            var summary = f.summary || "";

            var issueEntry = {
                key: key,
                summary: summary,
                status: statusName,
                type: typeName,
                project: projectKey,
                projectName: projectName,
                totalTimeHours: 0,
                worklogs: [],
                changelogs: []
            };

            var det = details[key] || {};
            var worklogs = det.worklogs || [];
            var changelog = det.changelog || [];

            worklogs.forEach(function(wl) {
                var author = (wl.author && (wl.author.name || wl.author.key)) || "";
                if (author.toLowerCase() !== username.toLowerCase()) return;

                var started = utils.parseDate(wl.started);
                if (!started) return;
                var ts = started.getTime();
                if (ts < startMs || ts > endMs) return;

                var hours = (wl.timeSpentSeconds || 0) / 3600;
                var dateStr = utils.getDayKey(started);
                var comment = wl.comment || "";

                var wlEntry = { issueKey: key, date: dateStr, timeSpentHours: Math.round(hours * 100) / 100, comment: comment };
                issueEntry.worklogs.push(wlEntry);
                issueEntry.totalTimeHours += hours;

                var day = ensureDay(dateStr);
                day.worklogs.push(wlEntry);
                day.totalHours += hours;
                addIssueToDay(dateStr, key);
            });

            changelog.forEach(function(history) {
                var authorName = (history.author && (history.author.name || history.author.key)) || "";
                if (authorName.toLowerCase() !== username.toLowerCase()) return;

                var created = utils.parseDate(history.created);
                if (!created) return;
                var ts = created.getTime();
                if (ts < startMs || ts > endMs) return;

                var dateStr = utils.getDayKey(created);
                var items = history.items || [];

                items.forEach(function(item) {
                    var changeEntry = {
                        issueKey: key,
                        date: dateStr,
                        field: item.field || "",
                        fromString: item.fromString || "",
                        toString: item.toString || ""
                    };
                    issueEntry.changelogs.push(changeEntry);

                    var day = ensureDay(dateStr);
                    day.changes.push(changeEntry);
                    addIssueToDay(dateStr, key);

                    if (item.field === "status") {
                        var tKey = (item.fromString || "(none)") + " -> " + (item.toString || "(none)");
                        transitionCounts[tKey] = (transitionCounts[tKey] || 0) + 1;
                    }
                });
            });

            issueEntry.totalTimeHours = Math.round(issueEntry.totalTimeHours * 100) / 100;
            issueMap[key] = issueEntry;

            if (!projectMap[projectKey]) {
                projectMap[projectKey] = { key: projectKey, name: projectName, totalHours: 0, issueCount: 0, issues: [] };
            }
            var proj = projectMap[projectKey];
            if (proj.issues.indexOf(key) === -1) {
                proj.issues.push(key);
                proj.issueCount++;
            }
            proj.totalHours += issueEntry.totalTimeHours;
        });

        Object.keys(projectMap).forEach(function(pk) {
            projectMap[pk].totalHours = Math.round(projectMap[pk].totalHours * 100) / 100;
        });

        Object.keys(dayMap).forEach(function(dk) {
            dayMap[dk].totalHours = Math.round(dayMap[dk].totalHours * 100) / 100;
        });

        var totalHours = 0;
        var activeDaysSet = {};
        Object.keys(dayMap).forEach(function(dk) {
            totalHours += dayMap[dk].totalHours;
            if (dayMap[dk].totalHours > 0 || dayMap[dk].changes.length > 0) {
                activeDaysSet[dk] = true;
            }
        });

        var statusTransitions = Object.keys(transitionCounts).map(function(tKey) {
            var parts = tKey.split(" -> ");
            return { from: parts[0], to: parts[1], count: transitionCounts[tKey] };
        });

        var totalIssues = Object.keys(issueMap).length;
        var totalProjects = Object.keys(projectMap).length;
        var activeDays = Object.keys(activeDaysSet).length;

        return {
            dayMap: dayMap,
            issueMap: issueMap,
            projectMap: projectMap,
            stats: {
                totalHours: Math.round(totalHours * 100) / 100,
                totalIssues: totalIssues,
                totalProjects: totalProjects,
                activeDays: activeDays,
                avgHoursPerDay: activeDays > 0 ? Math.round((totalHours / activeDays) * 100) / 100 : 0
            },
            statusTransitions: statusTransitions
        };
    }

    return {
        processData: processData
    };
});
