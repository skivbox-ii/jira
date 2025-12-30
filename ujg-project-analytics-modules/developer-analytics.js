// Аналитика по разработчикам
define("_ujgPA_developerAnalytics", ["_ujgPA_utils", "_ujgPA_workflow", "_ujgPA_basicAnalytics", "_ujgPA_devCycle"], function(utils, workflow, basicAnalytics, devCycle) {
    "use strict";
    
    function createDeveloperAnalytics(state) {
        var extractFieldEvents = basicAnalytics.createBasicAnalytics(state).extractFieldEvents;
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
                commitCount: issueData.commits.length,
                commitsPerDay: false,
                lastCommit: null,
                closedAfterCommit: null,
                daysToClose: null,
                stableClose: false,
                returnedToWork: false,
                wentToDone: false,
                wentToWorkAfterCommit: false
            };
            
            if (issueData.worklogs.length > 0) {
                metrics.firstWorklog = issueData.worklogs[0].date;
            }
            
            if (issueData.commits.length > 0) {
                issueData.commits.sort(function(a, b) { return a.date - b.date; });
                metrics.firstCommit = issueData.commits[0].date;
                metrics.lastCommit = issueData.commits[issueData.commits.length - 1].date;
                
                if (metrics.firstWorklog && metrics.firstCommit) {
                    metrics.daysToFirstCommit = (metrics.firstCommit - metrics.firstWorklog) / 86400000;
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
                var workAfterCommit = false;
                var stableClose = true;
                var lastDoneTime = null;
                
                statusEvents.forEach(function(evt) {
                    var evtTime = evt.at;
                    if (evtTime < lastCommitTime) return;
                    
                    var toIsDone = workflow.statusHasCategory(evt.to, "done", state.workflowConfig);
                    var toIsWork = workflow.statusHasCategory(evt.to, "work", state.workflowConfig);
                    var fromIsDone = workflow.statusHasCategory(evt.from, "done", state.workflowConfig);
                    var fromIsTesting = workflow.statusHasCategory(evt.from, "testing", state.workflowConfig);
                    
                    if (toIsDone && !doneAfterCommit) {
                        doneAfterCommit = true;
                        metrics.wentToDone = true;
                        lastDoneTime = evtTime;
                        metrics.daysToClose = (evtTime - lastCommitTime) / 86400000;
                    }
                    
                    if (fromIsTesting && toIsWork) {
                        metrics.returnedToWork = true;
                    }
                    
                    if (toIsWork && evtTime > lastCommitTime) {
                        workAfterCommit = true;
                        metrics.wentToWorkAfterCommit = true;
                    }
                    
                    if (fromIsDone && !toIsDone) {
                        stableClose = false;
                    }
                });
                
                metrics.stableClose = doneAfterCommit && stableClose;
                metrics.closedAfterCommit = doneAfterCommit;
            }
            
            return metrics;
        }
        
        function calculateDeveloperSummary(dev) {
            var issues = Object.keys(dev.issues);
            var totalIssues = issues.length;
            var totalDaysToFirstCommit = 0;
            var totalCommitsPerIssue = 0;
            var totalDaysToClose = 0;
            var stableClosed = 0;
            var returnedToWork = 0;
            var wentToDone = 0;
            var wentToWorkAfterCommit = 0;
            var commitsPerDayCount = 0;
            
            issues.forEach(function(issueKey) {
                var issueData = dev.issues[issueKey];
                var metrics = issueData.metrics || {};
                
                if (metrics.daysToFirstCommit !== null) {
                    totalDaysToFirstCommit += metrics.daysToFirstCommit;
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
            });
            
            return {
                totalIssues: totalIssues,
                avgDaysToFirstCommit: totalIssues > 0 ? totalDaysToFirstCommit / totalIssues : 0,
                avgCommitsPerIssue: totalIssues > 0 ? totalCommitsPerIssue / totalIssues : 0,
                avgDaysToClose: wentToDone > 0 ? totalDaysToClose / wentToDone : 0,
                stableClosed: stableClosed,
                returnedToWork: returnedToWork,
                wentToDone: wentToDone,
                wentToWorkAfterCommit: wentToWorkAfterCommit,
                commitsPerDayIssues: commitsPerDayCount
            };
        }
        
        function calculateDeveloperAnalytics(issues) {
            var bounds = getPeriodBounds();
            var developers = {};
            
            (issues || []).forEach(function(issue) {
                var devInfo = parseDevData(issue.devStatus);
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
                    
                    issueData.worklogs = extractWorklogsForDeveloper(issue, author, bounds);
                    issueData.statusEvents = extractFieldEvents(issue, "status");
                    
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
