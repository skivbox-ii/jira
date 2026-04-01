define("_ujgUA_dataProcessor", ["_ujgUA_config", "_ujgUA_utils"], function(config, utils) {
    "use strict";

    function byTimestamp(a, b) {
        var ta = String(a.timestamp || "");
        var tb = String(b.timestamp || "");
        if (ta < tb) return -1;
        if (ta > tb) return 1;
        return 0;
    }

    function getWorkdaysInRange(startDate, endDate) {
        var keys = [];
        var d = new Date(startDate + "T00:00:00");
        var end = new Date(endDate + "T23:59:59");
        while (d.getTime() <= end.getTime()) {
            var dow = d.getDay();
            if (dow >= 1 && dow <= 5) {
                keys.push(utils.getDayKey(d));
            }
            d.setDate(d.getDate() + 1);
        }
        return keys;
    }

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
                var lagMeta = utils.getWorklogLagMeta(wl.started, wl.created, hours);

                var wlAuthor = {
                    name: author,
                    displayName: (wl.author && (wl.author.displayName || wl.author.name || wl.author.key)) || author
                };
                var wlEntry = {
                    issueKey: key,
                    date: dateStr,
                    started: wl.started,
                    created: wl.created || "",
                    loggedAt: lagMeta.loggedAt,
                    workedDayKey: lagMeta.workedDayKey,
                    isLate: lagMeta.isLate,
                    lagDurationHoursRaw: lagMeta.lagDurationHoursRaw,
                    lagScoreHours: lagMeta.lagScoreHours,
                    timestamp: started.toISOString(),
                    timeSpentHours: Math.round(hours * 100) / 100,
                    comment: comment,
                    author: wlAuthor
                };
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
                        created: history.created,
                        timestamp: created.toISOString(),
                        field: item.field || "",
                        fromString: item.fromString || "",
                        toString: item.toString || "",
                        author: {
                            name: authorName,
                            displayName: (history.author && (history.author.displayName || history.author.name || history.author.key)) || authorName
                        }
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

    function processMultiUserData(usersData, startDate, endDate) {
        var dayMap = {};
        var issueMap = {};
        var projectMap = {};
        var userStats = {};
        var userDayMaps = {};
        var totalHoursAll = 0;
        var startMs = new Date(startDate + "T00:00:00").getTime();
        var endMs = new Date(endDate + "T23:59:59").getTime();
        var today = new Date();
        var todayKey = utils.getDayKey(today);
        var workdayKeys = getWorkdaysInRange(startDate, endDate);

        function ensureMultiDay(dateStr) {
            if (!dayMap[dateStr]) {
                dayMap[dateStr] = {
                    users: {},
                    allWorklogs: [],
                    allChanges: [],
                    allComments: [],
                    totalHours: 0,
                    repoItems: []
                };
            }
            return dayMap[dateStr];
        }

        function ensureUserSlice(multiDay, username) {
            if (!multiDay.users[username]) {
                multiDay.users[username] = { worklogs: [], changes: [], comments: [], totalHours: 0 };
            }
            return multiDay.users[username];
        }

        function mergeIssueMaps(fromMap) {
            Object.keys(fromMap).forEach(function(key) {
                var src = fromMap[key];
                if (!issueMap[key]) {
                    issueMap[key] = {
                        key: src.key,
                        summary: src.summary,
                        status: src.status,
                        type: src.type,
                        project: src.project,
                        projectName: src.projectName,
                        totalTimeHours: 0,
                        worklogs: [],
                        changelogs: []
                    };
                }
                var tgt = issueMap[key];
                tgt.worklogs = tgt.worklogs.concat(src.worklogs || []);
                tgt.changelogs = tgt.changelogs.concat(src.changelogs || []);
                tgt.totalTimeHours += src.totalTimeHours || 0;
            });
        }

        function mergeProjectMaps(fromMap) {
            Object.keys(fromMap).forEach(function(pk) {
                var src = fromMap[pk];
                if (!projectMap[pk]) {
                    projectMap[pk] = {
                        key: src.key,
                        name: src.name,
                        totalHours: 0,
                        issueCount: 0,
                        issues: []
                    };
                }
                var tgt = projectMap[pk];
                tgt.totalHours += src.totalHours || 0;
                (src.issues || []).forEach(function(ik) {
                    if (tgt.issues.indexOf(ik) === -1) {
                        tgt.issues.push(ik);
                        tgt.issueCount++;
                    }
                });
            });
        }

        (usersData || []).forEach(function(userData) {
            var username = userData.username;
            if (!username) return;

            var displayName = userData.displayName || username;
            var rawData = userData.rawData || {};
            var processed = processData(rawData, username, startDate, endDate);
            userDayMaps[username] = processed.dayMap;
            var author = { name: username, displayName: displayName };

            mergeIssueMaps(processed.issueMap);
            mergeProjectMaps(processed.projectMap);

            totalHoursAll += processed.stats.totalHours;
            userStats[username] = {
                displayName: displayName,
                totalHours: processed.stats.totalHours,
                activeDays: processed.stats.activeDays,
                daysWithoutWorklogs: 0,
                lagScoreHours: 0
            };

            var userDayMap = processed.dayMap;
            Object.keys(userDayMap).forEach(function(dateStr) {
                var srcDay = userDayMap[dateStr];
                var multiDay = ensureMultiDay(dateStr);
                var userSlice = ensureUserSlice(multiDay, username);

                (srcDay.worklogs || []).forEach(function(w) {
                    var wlCopy = {
                        issueKey: w.issueKey,
                        date: w.date,
                        started: w.started,
                        created: w.created || "",
                        loggedAt: w.loggedAt || "",
                        workedDayKey: w.workedDayKey || "",
                        isLate: !!w.isLate,
                        lagDurationHoursRaw: w.lagDurationHoursRaw || 0,
                        lagScoreHours: w.lagScoreHours || 0,
                        timeSpentHours: w.timeSpentHours,
                        comment: w.comment,
                        author: w.author || author,
                        timestamp: w.timestamp || w.started || w.date
                    };
                    userSlice.worklogs.push(wlCopy);
                    multiDay.allWorklogs.push(wlCopy);
                    userStats[username].lagScoreHours += (w.lagScoreHours || 0);
                });

                (srcDay.changes || []).forEach(function(c) {
                    var chCopy = {
                        issueKey: c.issueKey,
                        date: c.date,
                        created: c.created,
                        field: c.field,
                        fromString: c.fromString,
                        toString: c.toString,
                        author: c.author || author,
                        timestamp: c.timestamp || c.created || c.date
                    };
                    userSlice.changes.push(chCopy);
                    multiDay.allChanges.push(chCopy);
                });

                userSlice.totalHours = srcDay.totalHours || 0;
            });

            var commentsByIssue = userData.comments || {};
            Object.keys(commentsByIssue).forEach(function(issueKey) {
                var list = commentsByIssue[issueKey] || [];
                list.forEach(function(comment) {
                    var authorName = (comment.author && comment.author.name) || "";
                    if (!authorName || authorName.toLowerCase() !== username.toLowerCase()) return;

                    var created = comment.created;
                    if (!created || created.length < 10) return;
                    var dateStr = created.substring(0, 10);
                    var createdDt = utils.parseDate(created);
                    if (!createdDt) return;
                    var ts = createdDt.getTime();
                    if (ts < startMs || ts > endMs) return;

                    var multiDay = ensureMultiDay(dateStr);
                    var userSlice = ensureUserSlice(multiDay, username);
                    var commentEntry = {
                        type: "comment",
                        issueKey: issueKey,
                        body: comment.body || "",
                        id: comment.id,
                        author: author,
                        timestamp: created
                    };
                    userSlice.comments.push(commentEntry);
                    multiDay.allComments.push(commentEntry);
                });
            });
        });

        Object.keys(issueMap).forEach(function(key) {
            issueMap[key].totalTimeHours = Math.round(issueMap[key].totalTimeHours * 100) / 100;
        });

        Object.keys(projectMap).forEach(function(pk) {
            projectMap[pk].totalHours = Math.round(projectMap[pk].totalHours * 100) / 100;
        });

        Object.keys(dayMap).forEach(function(dk) {
            var multiDay = dayMap[dk];
            var daySum = 0;
            Object.keys(multiDay.users).forEach(function(un) {
                daySum += multiDay.users[un].totalHours || 0;
            });
            multiDay.totalHours = Math.round(daySum * 100) / 100;

            multiDay.allWorklogs.sort(byTimestamp);
            multiDay.allChanges.sort(byTimestamp);
            multiDay.allComments.sort(byTimestamp);
            Object.keys(multiDay.users).forEach(function(un) {
                var u = multiDay.users[un];
                u.worklogs.sort(byTimestamp);
                u.changes.sort(byTimestamp);
                u.comments.sort(byTimestamp);
            });
        });

        Object.keys(userStats).forEach(function(un) {
            var udm = userDayMaps[un] || {};
            var missing = 0;
            workdayKeys.forEach(function(wd) {
                if (wd > todayKey) return;
                var day = udm[wd];
                var h = day ? day.totalHours : 0;
                if (h === 0) missing++;
            });
            userStats[un].daysWithoutWorklogs = missing;
            userStats[un].lagScoreHours = Math.round((userStats[un].lagScoreHours || 0) * 100) / 100;
        });

        return {
            dayMap: dayMap,
            issueMap: issueMap,
            projectMap: projectMap,
            stats: {
                totalHours: Math.round(totalHoursAll * 100) / 100,
                totalIssues: Object.keys(issueMap).length,
                userStats: userStats
            }
        };
    }

    return {
        processData: processData,
        processMultiUserData: processMultiUserData
    };
});
