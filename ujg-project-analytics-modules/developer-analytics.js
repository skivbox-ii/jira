// Аналитика по разработчикам
define("_ujgPA_developerAnalytics", ["_ujgPA_utils", "_ujgPA_workflow", "_ujgPA_basicAnalytics", "_ujgPA_devCycle"], function(utils, workflow, basicAnalytics, devCycle) {
    "use strict";
    
    function createDeveloperAnalytics(state) {
        var extractFieldEventsInPeriod = basicAnalytics.createBasicAnalytics(state).extractFieldEventsInPeriod;
        var parseDevData = devCycle.createDevCycleAnalyzer(state).parseDevData;
        
        function getPeriodBounds() {
            var start = utils.parseDateSafe(state.period.start + "T00:00:00");
            var end = utils.parseDateSafe(state.period.end + "T23:59:59");
            if (!start || !end || end < start) {
                var fallback = utils.getDefaultPeriod();
                start = utils.parseDateSafe(fallback.start + "T00:00:00");
                end = utils.parseDateSafe(fallback.end + "T23:59:59");
            }
            return { start: start, end: end };
        }
        
        function normalizeTimestamp(value) {
            if (value === undefined || value === null) return null;
            if (value instanceof Date) return value;
            if (typeof value === "number") {
                if (value > 1e12) return new Date(value);
                return new Date(value * 1000);
            }
            return utils.parseDateSafe(value);
        }

        function daysBetween(a, b) {
            if (!a || !b) return null;
            return (b.getTime() - a.getTime()) / 86400000;
        }

        function safeNumber(v) {
            if (v === null || v === undefined) return null;
            if (typeof v === "number") return isNaN(v) ? null : v;
            var n = parseFloat(v);
            return isNaN(n) ? null : n;
        }

        function parseDueDate(issue) {
            var raw = issue && issue.fields && issue.fields.duedate;
            if (!raw) return null;
            // Jira duedate обычно в формате YYYY-MM-DD (без времени)
            return utils.parseDateSafe(String(raw) + "T23:59:59");
        }

        function parseResolutionDate(issue) {
            return utils.parseDateSafe(issue && issue.fields && issue.fields.resolutiondate);
        }

        function normalizeSprintValue(v) {
            if (!v) return "";
            if (Array.isArray(v)) {
                if (v.length === 0) return "";
                // берём последний спринт как "текущий/последний"
                return normalizeSprintValue(v[v.length - 1]);
            }
            if (typeof v === "object") {
                return (v.name || v.id || "").toString();
            }
            var s = String(v);
            // иногда toString содержит структуру с name=..., id=...
            var mName = s.match(/name=([^,}\]]+)/i);
            if (mName && mName[1]) return mName[1].trim();
            var mId = s.match(/id=(\d+)/i);
            if (mId && mId[1]) return "id:" + mId[1];
            // fallback: короткая строка
            return s.trim();
        }
        
        function extractAuthorName(author) {
            if (!author) return "Unknown";
            return author.displayName || author.name || author.userName || author.accountId || "Unknown";
        }
        
        function extractCommits(devStatus, bounds) {
            if (!devStatus || !devStatus.detail || !devStatus.detail.length) return [];
            var commits = [];
            
            devStatus.detail.forEach(function(detail) {
                (detail.repositories || []).forEach(function(repo) {
                    if (repo.commits && Array.isArray(repo.commits)) {
                        repo.commits.forEach(function(commit) {
                            var commitDate = normalizeTimestamp(commit.authorTimestamp || commit.commitTimestamp || commit.date);
                            if (!commitDate) return;
                            if (commitDate < bounds.start || commitDate > bounds.end) return;
                            
                            var author = extractAuthorName(commit.author);
                            commits.push({
                                author: author,
                                date: commitDate,
                                message: commit.message || "",
                                hash: commit.id || commit.hash || commit.commitId || ""
                            });
                        });
                    }
                    if (repo.branches && Array.isArray(repo.branches)) {
                        repo.branches.forEach(function(branch) {
                            if (branch.commits && Array.isArray(branch.commits)) {
                                branch.commits.forEach(function(commit) {
                                    var commitDate = normalizeTimestamp(commit.authorTimestamp || commit.commitTimestamp || commit.date);
                                    if (!commitDate) return;
                                    if (commitDate < bounds.start || commitDate > bounds.end) return;
                                    
                                    var author = extractAuthorName(commit.author);
                                    commits.push({
                                        author: author,
                                        date: commitDate,
                                        message: commit.message || "",
                                        hash: commit.id || commit.hash || commit.commitId || ""
                                    });
                                });
                            }
                        });
                    }
                });
            });
            
            return commits;
        }
        
        function extractWorklogsForDeveloper(issue, developerName, bounds) {
            if (!issue.worklogs || !issue.worklogs.length) return [];
            var worklogs = [];
            
            issue.worklogs.forEach(function(wl) {
                var author = wl.author;
                var authorName = author ? (author.displayName || author.name || author.accountId) : "";
                if (authorName !== developerName) return;
                
                var started = utils.parseDateSafe(wl.started);
                if (!started) return;
                if (started < bounds.start || started > bounds.end) return;
                
                worklogs.push({
                    date: started,
                    timeSpent: wl.timeSpentSeconds || 0,
                    comment: wl.comment || ""
                });
            });
            
            worklogs.sort(function(a, b) { return a.date - b.date; });
            return worklogs;
        }
        
        function findIssueByKey(issues, key) {
            for (var i = 0; i < issues.length; i++) {
                if (issues[i].key === key) return issues[i];
            }
            return null;
        }
        
        function calculateDeveloperIssueMetrics(issueData, issue, bounds) {
            var metrics = {
                firstWorklog: null,
                firstCommit: null,
                daysToFirstCommit: null,
                workAheadDays: 0,
                commitCount: issueData.commits.length,
                worklogSeconds: 0,
                hasWorklogs: false,
                commitsPerDay: false,
                lastCommit: null,
                closedAfterCommit: null,
                daysToClose: null,
                stableClose: false,
                returnedToWork: false,
                returnCount: 0,
                wentToDone: false,
                wentToWorkAfterCommit: false,
                resolvedInPeriod: false,

                // сроки
                dueDate: null,
                isOverdue: false,
                overdueDays: 0,
                sprintChanges: 0,
                closedInOriginalSprint: null,

                // оценки
                originalEstimateSeconds: null,
                timeSpentSeconds: null,
                estimateAccuracy: null,
                isOverspent: false,

                // качество
                isStale: false,
                isPingPong: false,
                isCleanClose: false
            };
            
            if (issueData.worklogs.length > 0) {
                metrics.firstWorklog = issueData.worklogs[0].date;
                issueData.worklogs.forEach(function(wl) {
                    metrics.worklogSeconds += wl.timeSpent || 0;
                });
                metrics.hasWorklogs = metrics.worklogSeconds > 0;
            }

            // Закрытие в периоде (по resolutiondate)
            if (bounds) {
                var resolvedAt0 = parseResolutionDate(issue);
                if (resolvedAt0 && resolvedAt0 >= bounds.start && resolvedAt0 <= bounds.end) {
                    metrics.resolvedInPeriod = true;
                }
            }
            
            if (issueData.commits.length > 0) {
                issueData.commits.sort(function(a, b) { return a.date - b.date; });
                metrics.firstCommit = issueData.commits[0].date;
                metrics.lastCommit = issueData.commits[issueData.commits.length - 1].date;

                // "Взял задачу" — сначала worklog, если нет, fallback:
                // 1) первое назначение на этого разработчика (assignee) по changelog
                // 2) первый переход в категорию work по changelog
                var tookAt = metrics.firstWorklog;
                if (!tookAt && issueData.assigneeEvents && issueData.assigneeEvents.length > 0) {
                    tookAt = issueData.assigneeEvents[0].at;
                }
                if (!tookAt && issueData.firstWorkTransitionAt) {
                    tookAt = issueData.firstWorkTransitionAt;
                }
                if (tookAt && metrics.firstCommit) {
                    var d = (metrics.firstCommit - tookAt) / 86400000;
                    if (d < 0) {
                        metrics.workAheadDays = Math.abs(d);
                        metrics.daysToFirstCommit = 0;
                    } else {
                        metrics.daysToFirstCommit = d;
                    }
                }
                
                var commitDays = {};
                issueData.commits.forEach(function(c) {
                    var dayKey = new Date(c.date).toDateString();
                    commitDays[dayKey] = true;
                });
                metrics.commitsPerDay = Object.keys(commitDays).length === issueData.commits.length && issueData.commits.length > 1;
            }
            
            var statusEvents = issueData.statusEvents;
            if (statusEvents.length > 0 && metrics.lastCommit) {
                var lastCommitTime = metrics.lastCommit;
                var doneAfterCommit = false;
                var stableClose = true;
                
                // Возвраты и стабильность считаем по категориям workflow из настроек.
                // Fallback по названию используем только если статус не размечен ни в одну категорию.
                function hasAnyCategory(statusName) {
                    if (!statusName) return false;
                    var cats = workflow.getCategoriesForStatus(statusName, state.workflowConfig) || [];
                    return cats.length > 0;
                }
                function fallbackMatch(statusName, kind) {
                    if (!statusName) return false;
                    var s = String(statusName).toLowerCase();
                    if (kind === "done") {
                        return s.indexOf("done") >= 0 || s.indexOf("closed") >= 0 || s.indexOf("resolved") >= 0 || s.indexOf("complete") >= 0 ||
                            s.indexOf("закры") >= 0 || s.indexOf("готов") >= 0 || s.indexOf("снят") >= 0 || s.indexOf("отмен") >= 0;
                    }
                    if (kind === "work") {
                        return s.indexOf("in progress") >= 0 || s.indexOf("в работе") >= 0 || s.indexOf("разработ") >= 0 ||
                            s.indexOf("реализац") >= 0 || s.indexOf("исправ") >= 0 || s.indexOf("доработ") >= 0 || s.indexOf("work") >= 0;
                    }
                    if (kind === "testing") {
                        return s.indexOf("test") >= 0 || s.indexOf("qa") >= 0 || s.indexOf("тест") >= 0 || s.indexOf("провер") >= 0 ||
                            s.indexOf("accept") >= 0 || s.indexOf("подтверж") >= 0;
                    }
                    if (kind === "review") {
                        return s.indexOf("review") >= 0 || s.indexOf("code review") >= 0 || s.indexOf("ревью") >= 0 || s.indexOf("на ревью") >= 0;
                    }
                    if (kind === "waiting") {
                        return s.indexOf("blocked") >= 0 || s.indexOf("hold") >= 0 || s.indexOf("waiting") >= 0 || s.indexOf("ожидан") >= 0 || s.indexOf("запрос") >= 0;
                    }
                    if (kind === "queue") {
                        return s.indexOf("open") >= 0 || s.indexOf("new") >= 0 || s.indexOf("to do") >= 0 || s.indexOf("todo") >= 0 ||
                            s.indexOf("очеред") >= 0 || s.indexOf("принят") >= 0 || s.indexOf("выдан") >= 0;
                    }
                    return false;
                }
                function isCat(statusName, categoryKey) {
                    if (!statusName) return false;
                    if (workflow.statusHasCategory(statusName, categoryKey, state.workflowConfig)) return true;
                    // только если вообще не размечено — подстрахуемся
                    if (!hasAnyCategory(statusName)) return fallbackMatch(statusName, categoryKey);
                    return false;
                }

                statusEvents.forEach(function(evt) {
                    var evtTime = evt.at;
                    if (evtTime < lastCommitTime) return;
                    
                    var toIsDone = isCat(evt.to, "done");
                    var toIsWork = isCat(evt.to, "work");
                    var toIsQueue = isCat(evt.to, "queue");
                    var fromIsDone = isCat(evt.from, "done");
                    var fromIsWork = isCat(evt.from, "work");
                    var fromIsTesting = isCat(evt.from, "testing");
                    var fromIsReview = isCat(evt.from, "review");
                    var fromIsWaiting = isCat(evt.from, "waiting");
                    
                    if (toIsDone && !doneAfterCommit) {
                        doneAfterCommit = true;
                        metrics.wentToDone = true;
                        metrics.daysToClose = (evtTime - lastCommitTime) / 86400000;
                    }
                    
                    // Переход "после коммита -> work" (любой возврат/продолжение работы)
                    if (toIsWork && !fromIsWork) {
                        metrics.wentToWorkAfterCommit = true;
                    }
                    
                    // Возврат (строго по категориям): из testing/review/done/waiting -> work ИЛИ queue
                    if ((toIsWork || toIsQueue) && !fromIsWork) {
                        if (fromIsDone || fromIsTesting || fromIsReview || fromIsWaiting) {
                            metrics.returnedToWork = true;
                            metrics.returnCount += 1;
                        }
                    }
                    
                    if (fromIsDone && !toIsDone) {
                        stableClose = false;
                    }
                });
                
                metrics.stableClose = doneAfterCommit && stableClose;
                metrics.closedAfterCommit = doneAfterCommit;
            }

            // --- сроки / спринты ---
            var due = parseDueDate(issue);
            var resolvedAt = parseResolutionDate(issue);
            metrics.dueDate = due;
            if (due) {
                var ref = resolvedAt || (bounds && bounds.end) || null;
                if (ref && ref > due) {
                    metrics.isOverdue = true;
                    metrics.overdueDays = Math.max(0, Math.ceil(daysBetween(due, ref)));
                }
            }
            var sprintEvents = extractFieldEventsInPeriod(issue, "sprint", bounds) || [];
            metrics.sprintChanges = sprintEvents.length;
            // "закрыто в исходном спринте" считаем только если задача закрыта (есть resolutiondate)
            if (resolvedAt) {
                var initialSprint = "";
                var finalSprint = "";
                if (sprintEvents.length > 0) {
                    initialSprint = normalizeSprintValue(sprintEvents[0].from || sprintEvents[0].to);
                    finalSprint = normalizeSprintValue(sprintEvents[sprintEvents.length - 1].to || sprintEvents[sprintEvents.length - 1].from);
                }
                // fallback: берём текущее значение спринта из поля, если оно есть (кастомное поле sprint)
                if (!finalSprint) {
                    var sprintFieldId = state.customFields && state.customFields.sprint;
                    if (sprintFieldId && issue && issue.fields) {
                        finalSprint = normalizeSprintValue(issue.fields[sprintFieldId]);
                    }
                }
                if (!initialSprint) initialSprint = finalSprint;
                metrics.closedInOriginalSprint = (initialSprint && finalSprint) ? (String(initialSprint) === String(finalSprint)) : null;
            }

            // --- оценки ---
            var orig = safeNumber(issue && issue.fields && issue.fields.timeoriginalestimate);
            var spent = safeNumber(issue && issue.fields && issue.fields.timespent);
            metrics.originalEstimateSeconds = orig;
            metrics.timeSpentSeconds = spent;
            if (orig && orig > 0 && spent !== null) {
                metrics.estimateAccuracy = spent / orig;
                metrics.isOverspent = metrics.estimateAccuracy > 1.2;
            }

            // --- качество ---
            // ping-pong: много возвратов (например, review/testing -> work/queue)
            metrics.isPingPong = metrics.returnCount > 2;
            // stale: задача в работе и давно не было обновлений (берём updated как прокси)
            var staleDays = state.thresholds && state.thresholds.noProgressRisk ? (state.thresholds.noProgressRisk || 0) : 0;
            var updatedAt = utils.parseDateSafe(issue && issue.fields && issue.fields.updated);
            if (staleDays > 0 && issueData.currentStatusIsWork && updatedAt && bounds && bounds.end) {
                var idleDays = daysBetween(updatedAt, bounds.end);
                if (idleDays !== null && idleDays > staleDays) {
                    metrics.isStale = true;
                }
            }
            metrics.isCleanClose = !!(metrics.wentToDone && !metrics.returnedToWork && !metrics.isOverdue);
            
            return metrics;
        }
        
        function calculateDeveloperSummary(dev) {
            var issues = Object.keys(dev.issues);
            var totalIssues = issues.length;
            var issuesWithCommits = 0;
            var issuesWithWorklogs = 0;
            var issuesWithFirstCommit = 0;
            var totalDaysToFirstCommit = 0;
            var workAheadCount = 0;
            var totalWorkAheadDays = 0;
            var totalCommitsPerIssue = 0;
            var totalWorklogSeconds = 0;
            var closedIssuesInPeriod = 0;
            var totalDaysToClose = 0;
            var stableClosed = 0;
            var returnedToWork = 0;
            var wentToDone = 0;
            var wentToWorkAfterCommit = 0;
            var commitsPerDayCount = 0;
            var tasksInWork = 0;
            
            // "Хорошие/Плохие истории"
            var good = { onTime: 0, accurateEstimate: 0, cleanClose: 0, oneSprint: 0 };
            var bad = { overdue: 0, sprintMoved: 0, overspent: 0, stale: 0, pingPong: 0 };
            
            issues.forEach(function(issueKey) {
                var issueData = dev.issues[issueKey];
                var metrics = issueData.metrics || {};

                if ((issueData.commits || []).length > 0) {
                    issuesWithCommits += 1;
                }
                if (metrics.hasWorklogs) {
                    issuesWithWorklogs += 1;
                    totalWorklogSeconds += metrics.worklogSeconds || 0;
                }
                
                if (metrics.daysToFirstCommit !== null) {
                    totalDaysToFirstCommit += metrics.daysToFirstCommit;
                    issuesWithFirstCommit += 1;
                }
                if (metrics.workAheadDays && metrics.workAheadDays > 0) {
                    workAheadCount += 1;
                    totalWorkAheadDays += metrics.workAheadDays;
                }
                totalCommitsPerIssue += metrics.commitCount || 0;
                if (metrics.daysToClose !== null) {
                    totalDaysToClose += metrics.daysToClose;
                }
                if (metrics.stableClose) stableClosed += 1;
                if (metrics.returnedToWork) returnedToWork += 1;
                if (metrics.wentToDone) wentToDone += 1;
                if (metrics.wentToWorkAfterCommit) wentToWorkAfterCommit += 1;
                if (metrics.commitsPerDay) commitsPerDayCount += 1;

                if (issueData.currentStatusIsWork) {
                    tasksInWork += 1;
                }
                
                // "Закрыл" — задача закрыта в периоде, при этом разработчик по ней участвовал
                // (есть коммиты или ворклоги за период).
                if (metrics.resolvedInPeriod && ((metrics.commitCount || 0) > 0 || metrics.hasWorklogs)) {
                    closedIssuesInPeriod += 1;
                }

                // good/bad
                if (metrics.isOverdue) bad.overdue += 1;
                if (metrics.sprintChanges && metrics.sprintChanges > 0) bad.sprintMoved += 1;
                if (metrics.isOverspent) bad.overspent += 1;
                if (metrics.isStale) bad.stale += 1;
                if (metrics.isPingPong) bad.pingPong += 1;

                // Хорошие считаем по закрытым задачам (wentToDone)
                if (metrics.wentToDone) {
                    if (metrics.dueDate && !metrics.isOverdue) good.onTime += 1;
                    if (metrics.estimateAccuracy !== null && metrics.estimateAccuracy >= 0.8 && metrics.estimateAccuracy <= 1.2) good.accurateEstimate += 1;
                    if (metrics.isCleanClose) good.cleanClose += 1;
                    if (metrics.closedInOriginalSprint === true) good.oneSprint += 1;
                }
            });
            
            return {
                totalIssues: totalIssues,
                issuesWithCommits: issuesWithCommits,
                issuesWithWorklogs: issuesWithWorklogs,
                totalWorklogSeconds: totalWorklogSeconds,
                avgWorklogSecondsPerIssue: issuesWithWorklogs ? (totalWorklogSeconds / issuesWithWorklogs) : 0,
                closedIssuesInPeriod: closedIssuesInPeriod,
                tasksInWork: tasksInWork,
                avgDaysToFirstCommit: issuesWithFirstCommit > 0 ? totalDaysToFirstCommit / issuesWithFirstCommit : 0,
                workAheadCount: workAheadCount,
                avgWorkAheadDays: workAheadCount > 0 ? totalWorkAheadDays / workAheadCount : 0,
                avgCommitsPerIssue: issuesWithCommits > 0 ? totalCommitsPerIssue / issuesWithCommits : 0,
                avgDaysToClose: wentToDone > 0 ? totalDaysToClose / wentToDone : 0,
                stableClosed: stableClosed,
                returnedToWork: returnedToWork,
                wentToDone: wentToDone,
                wentToWorkAfterCommit: wentToWorkAfterCommit,
                commitsPerDayIssues: commitsPerDayCount,
                goodStories: good,
                badStories: bad
            };
        }
        
        function calculateDeveloperAnalytics(issues) {
            var bounds = getPeriodBounds();
            var developers = {};
            
            (issues || []).forEach(function(issue) {
                var devInfo = parseDevData(issue.devStatus, bounds);
                if (!devInfo) return;
                
                var commits = extractCommits(issue.devStatus, bounds);
                commits.forEach(function(commit) {
                    var author = commit.author;
                    if (!author || author === "Unknown") return;
                    
                    if (!developers[author]) {
                        developers[author] = {
                            name: author,
                            commits: [],
                            prs: [],
                            issues: {},
                            totalCommits: 0,
                            totalPRs: 0,
                            totalMerged: 0
                        };
                    }
                    
                    developers[author].commits.push({
                        issueKey: issue.key,
                        date: commit.date,
                        message: commit.message
                    });
                    developers[author].totalCommits += 1;
                    
                    if (!developers[author].issues[issue.key]) {
                        developers[author].issues[issue.key] = {
                            key: issue.key,
                            commits: [],
                            prs: [],
                            worklogs: [],
                            statusEvents: []
                        };
                    }
                    developers[author].issues[issue.key].commits.push(commit);
                });
                
                (devInfo.prs || []).forEach(function(pr) {
                    var author = pr.author;
                    if (!author || author === "Unknown") return;
                    
                    if (!developers[author]) {
                        developers[author] = {
                            name: author,
                            commits: [],
                            prs: [],
                            issues: {},
                            totalCommits: 0,
                            totalPRs: 0,
                            totalMerged: 0
                        };
                    }
                    
                    developers[author].prs.push({
                        issueKey: issue.key,
                        pr: pr
                    });
                    developers[author].totalPRs += 1;
                    if (pr.status === "merged" || pr.status === "completed") {
                        developers[author].totalMerged += 1;
                    }
                    
                    if (!developers[author].issues[issue.key]) {
                        developers[author].issues[issue.key] = {
                            key: issue.key,
                            commits: [],
                            prs: [],
                            worklogs: [],
                            statusEvents: []
                        };
                    }
                    developers[author].issues[issue.key].prs.push(pr);
                });
            });
            
            Object.keys(developers).forEach(function(author) {
                var dev = developers[author];
                Object.keys(dev.issues).forEach(function(issueKey) {
                    var issue = findIssueByKey(issues, issueKey);
                    if (!issue) return;
                    
                    var issueData = dev.issues[issueKey];
                    var currentStatusName = issue && issue.fields && issue.fields.status && issue.fields.status.name ? issue.fields.status.name : "";
                    issueData.currentStatusName = currentStatusName;
                    issueData.currentStatusIsWork = currentStatusName ? workflow.statusHasCategory(currentStatusName, "work", state.workflowConfig) : false;
                    
                    issueData.worklogs = extractWorklogsForDeveloper(issue, author, bounds);
                    issueData.statusEvents = extractFieldEventsInPeriod(issue, "status", bounds);
                    // события назначения на разработчика (fallback для "Взял")
                    issueData.assigneeEvents = (extractFieldEventsInPeriod(issue, "assignee", bounds) || []).filter(function(e) {
                        return e && e.to && String(e.to) === String(author);
                    }).map(function(e) {
                        return { at: e.at, from: e.from, to: e.to };
                    });
                    if (issueData.assigneeEvents.length > 0) {
                        issueData.assigneeEvents.sort(function(a, b) { return a.at - b.at; });
                    }
                    // первый переход в work
                    issueData.firstWorkTransitionAt = null;
                    (issueData.statusEvents || []).forEach(function(e) {
                        if (issueData.firstWorkTransitionAt) return;
                        if (e && e.at && workflow.statusHasCategory(e.to, "work", state.workflowConfig)) {
                            issueData.firstWorkTransitionAt = e.at;
                        }
                    });
                    
                    var metrics = calculateDeveloperIssueMetrics(issueData, issue, bounds);
                    issueData.metrics = metrics;
                });
                
                var summary = calculateDeveloperSummary(dev);
                dev.summary = summary;
            });
            
            state.developerAnalytics = developers;
        }
        
        return {
            calculateDeveloperAnalytics: calculateDeveloperAnalytics
        };
    }
    
    return {
        createDeveloperAnalytics: createDeveloperAnalytics
    };
});
