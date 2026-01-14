// Аналитика по тестировщикам
define("_ujgPA_testerAnalytics", ["_ujgPA_utils", "_ujgPA_workflow", "_ujgPA_basicAnalytics"], function(utils, workflow, basicAnalytics) {
    "use strict";
    
    function createTesterAnalytics(state) {
        var extractFieldEventsInPeriod = basicAnalytics.createBasicAnalytics(state).extractFieldEventsInPeriod;
        
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
        
        function extractStatusTransitionsWithAuthor(issue, bounds) {
            var b = bounds || getPeriodBounds();
            var out = [];
            var histories = (issue && issue.changelog && issue.changelog.histories) || [];
            histories.forEach(function(history) {
                var at = utils.parseDateSafe(history.created);
                if (!at) return;
                if (at < b.start || at > b.end) return;
                var author = extractAuthorName(history.author);
                (history.items || []).forEach(function(item) {
                    if (!item || !item.field) return;
                    if (String(item.field).toLowerCase() !== "status") return;
                    out.push({
                        from: item.fromString || "",
                        to: item.toString || "",
                        at: at,
                        author: author
                    });
                });
            });
            out.sort(function(a, b2) { return a.at - b2.at; });
            return out;
        }
        
        function extractCommitAuthors(devStatus, bounds) {
            var b = bounds || getPeriodBounds();
            if (!devStatus || !devStatus.detail || !devStatus.detail.length) return {};
            var counts = {}; // author -> commits
            
            devStatus.detail.forEach(function(detail) {
                (detail.repositories || []).forEach(function(repo) {
                    function addCommit(commit) {
                        var dt = normalizeTimestamp(commit && (commit.authorTimestamp || commit.commitTimestamp || commit.date));
                        if (!dt) return;
                        if (dt < b.start || dt > b.end) return;
                        var author = extractAuthorName(commit.author);
                        if (!author || author === "Unknown") return;
                        counts[author] = (counts[author] || 0) + 1;
                    }
                    (repo.commits || []).forEach(addCommit);
                    (repo.branches || []).forEach(function(branch) {
                        (branch.commits || []).forEach(addCommit);
                    });
                });
            });
            return counts;
        }
        
        function pickPrimaryDev(commitCounts) {
            var best = "";
            var bestCnt = 0;
            Object.keys(commitCounts || {}).forEach(function(name) {
                var c = commitCounts[name] || 0;
                if (c > bestCnt) {
                    bestCnt = c;
                    best = name;
                }
            });
            return best;
        }
        
        function getTestingEntryTime(issue, exitAt, bounds) {
            // Ищем последнюю точку входа в testing до exitAt (в полном changelog, не только в периоде)
            // Это позволяет корректно оценить длительность теста.
            var b = bounds || getPeriodBounds();
            var histories = (issue && issue.changelog && issue.changelog.histories) || [];
            var all = [];
            histories.forEach(function(history) {
                var at = utils.parseDateSafe(history.created);
                if (!at) return;
                (history.items || []).forEach(function(item) {
                    if (!item || !item.field) return;
                    if (String(item.field).toLowerCase() !== "status") return;
                    all.push({ from: item.fromString || "", to: item.toString || "", at: at });
                });
            });
            all.sort(function(a, b2) { return a.at - b2.at; });
            
            var lastEntered = null;
            for (var i = 0; i < all.length; i++) {
                var e = all[i];
                if (!e || !e.at || e.at > exitAt) break;
                if (workflow.statusHasCategory(e.to, "testing", state.workflowConfig)) {
                    lastEntered = e.at;
                }
            }
            // Если нет явного входа, но задача могла стартовать в testing — используем created
            if (!lastEntered) {
                var created = utils.parseDateSafe(issue && issue.fields && issue.fields.created);
                lastEntered = created || b.start;
            }
            // не раньше начала периода (чтобы не раздувать)
            if (lastEntered < b.start) lastEntered = b.start;
            return lastEntered;
        }
        
        function calculateTesterAnalytics(issues) {
            var bounds = getPeriodBounds();
            var testers = {}; // name -> stats
            
            (issues || []).forEach(function(issue) {
                // Условие: считаем только задачи, по которым были коммиты
                var commitCounts = extractCommitAuthors(issue && issue.devStatus, bounds);
                var totalCommits = 0;
                Object.keys(commitCounts).forEach(function(k) { totalCommits += (commitCounts[k] || 0); });
                if (!totalCommits) return;
                
                var primaryDev = pickPrimaryDev(commitCounts);
                var transitions = extractStatusTransitionsWithAuthor(issue, bounds);
                if (!transitions.length) return;
                
                // найдём "переходы из testing" (exit transitions)
                transitions.forEach(function(tr) {
                    if (!workflow.statusHasCategory(tr.from, "testing", state.workflowConfig)) return;
                    var tester = tr.author || "Unknown";
                    if (!testers[tester]) {
                        testers[tester] = {
                            name: tester,
                            tested: 0,
                            passed: 0,
                            returned: 0,
                            totalTestSeconds: 0,
                            escapedBugs: 0,
                            byDeveloper: {}, // dev -> {tested, returned}
                            issues: [] // details
                        };
                    }
                    var t = testers[tester];
                    t.tested += 1;
                    
                    var toIsDone = workflow.statusHasCategory(tr.to, "done", state.workflowConfig);
                    var toIsWork = workflow.statusHasCategory(tr.to, "work", state.workflowConfig);
                    var toIsQueue = workflow.statusHasCategory(tr.to, "queue", state.workflowConfig);
                    var returned = !!(toIsWork || toIsQueue);
                    if (toIsDone) t.passed += 1;
                    if (returned) t.returned += 1;
                    
                    var entryAt = getTestingEntryTime(issue, tr.at, bounds);
                    var testSeconds = entryAt && tr.at && tr.at >= entryAt ? Math.max(0, (tr.at - entryAt) / 1000) : 0;
                    t.totalTestSeconds += testSeconds;
                    
                    if (primaryDev) {
                        if (!t.byDeveloper[primaryDev]) t.byDeveloper[primaryDev] = { tested: 0, returned: 0 };
                        t.byDeveloper[primaryDev].tested += 1;
                        if (returned) t.byDeveloper[primaryDev].returned += 1;
                    }
                    
                    // Escaped bugs: если QA отправил в done, а потом был выход из done после этого момента
                    if (toIsDone) {
                        var laterStatus = (extractFieldEventsInPeriod(issue, "status", bounds) || []).filter(function(e) {
                            return e && e.at && e.at > tr.at;
                        });
                        var escaped = false;
                        laterStatus.forEach(function(e) {
                            if (escaped) return;
                            var fromDone = workflow.statusHasCategory(e.from, "done", state.workflowConfig);
                            var toDone = workflow.statusHasCategory(e.to, "done", state.workflowConfig);
                            if (fromDone && !toDone) escaped = true;
                        });
                        if (escaped) t.escapedBugs += 1;
                    }
                    
                    t.issues.push({
                        key: issue.key,
                        at: tr.at,
                        from: tr.from,
                        to: tr.to,
                        testSeconds: testSeconds,
                        result: toIsDone ? "passed" : (returned ? "returned" : "moved"),
                        developer: primaryDev || ""
                    });
                });
            });
            
            // финализация
            Object.keys(testers).forEach(function(name) {
                var t = testers[name];
                t.passRate = t.tested ? (t.passed / t.tested) : 0;
                t.avgTestSeconds = t.tested ? (t.totalTestSeconds / t.tested) : 0;
                // сортируем детали: сначала возвраты, потом по времени теста
                (t.issues || []).sort(function(a, b) {
                    var ar = a.result === "returned" ? 0 : 1;
                    var br = b.result === "returned" ? 0 : 1;
                    if (ar !== br) return ar - br;
                    return (b.testSeconds || 0) - (a.testSeconds || 0);
                });
            });
            
            state.testerAnalytics = testers;
        }
        
        return {
            calculateTesterAnalytics: calculateTesterAnalytics
        };
    }
    
    return {
        createTesterAnalytics: createTesterAnalytics
    };
});

