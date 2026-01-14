// Анализ цикла разработки
define("_ujgPA_devCycle", ["_ujgPA_utils", "_ujgPA_workflow", "_ujgPA_basicAnalytics"], function(utils, workflow, basicAnalytics) {
    "use strict";
    
    function createDevCycleAnalyzer(state) {
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
        
        function extractReviewerName(reviewer) {
            if (!reviewer) return null;
            if (reviewer.user) {
                return reviewer.user.displayName || reviewer.user.name || reviewer.user.userName || reviewer.user.accountId;
            }
            return reviewer.displayName || reviewer.name || reviewer.userName || reviewer.accountId;
        }
        
        function calculatePRIterations(pr) {
            if (!pr || !pr.status || (pr.status !== "merged" && pr.status !== "completed")) return 0;
            var iterations = 1;
            if (pr.created && pr.updated && pr.updated > pr.created) {
                var updates = Math.floor((pr.updated - pr.created) / 86400000);
                if (updates > 0) iterations += Math.min(3, Math.floor(updates / 3));
            }
            if (pr.reviewers && pr.reviewers.length > 1) {
                iterations += Math.min(2, pr.reviewers.length - 1);
            }
            return Math.max(1, iterations);
        }
        
        function calculateAvgIterations(prs) {
            if (!prs || prs.length === 0) return 0;
            var merged = prs.filter(function(pr) {
                return pr.status === "merged" || pr.status === "completed";
            });
            if (merged.length === 0) return 0;
            var total = 0;
            merged.forEach(function(pr) {
                total += pr.iterations || 1;
            });
            return total / merged.length;
        }
        
        function determineFirstTimeApproval(pr) {
            if (!pr || (pr.status !== "merged" && pr.status !== "completed")) return false;
            if (!pr.created || !pr.merged) return false;
            var daysOpen = (pr.merged - pr.created) / 86400000;
            if (daysOpen > 5) return false;
            if (pr.reviewers && pr.reviewers.length > 2) return false;
            if (pr.created && pr.updated && pr.updated > pr.created) {
                var updateDays = (pr.updated - pr.created) / 86400000;
                if (updateDays > 3) return false;
            }
            return true;
        }
        
        function parseDevData(devStatus, bounds) {
            if (!devStatus || !devStatus.detail || !devStatus.detail.length) return null;
            var prCount = 0;
            var merged = 0;
            var open = 0;
            var declined = 0;
            var mergedCount = 0;
            var totalCycle = 0;
            var reviewers = {};
            var reviewerStats = {};
            var reviewerDecisionStats = {}; // {name:{approved,needsWork,reviewed}}
            var authorRework = {}; // {author:{needsWorkPrs,totalPrs}}
            var prs = [];
            var b = bounds || getPeriodBounds();

            function touchesPeriod(prInfo) {
                if (!prInfo) return false;
                // включаем PR, если любая из ключевых дат попадает в период
                var dates = [prInfo.created, prInfo.updated, prInfo.merged];
                for (var i = 0; i < dates.length; i++) {
                    var dt = dates[i];
                    if (dt && dt >= b.start && dt <= b.end) return true;
                }
                return false;
            }

            function getPullRequestsFromRepo(repo) {
                if (!repo) return [];
                // Atlassian может вернуть разные имена полей в зависимости от интеграции/версии
                return (repo.pullRequests && Array.isArray(repo.pullRequests) ? repo.pullRequests :
                    repo.pullrequests && Array.isArray(repo.pullrequests) ? repo.pullrequests :
                    repo.pullRequest && Array.isArray(repo.pullRequest) ? repo.pullRequest :
                    repo.pullrequest && Array.isArray(repo.pullrequest) ? repo.pullrequest :
                    []);
            }

            function getPullRequestsFromDetail(detail) {
                if (!detail) return [];
                return (detail.pullRequests && Array.isArray(detail.pullRequests) ? detail.pullRequests :
                    detail.pullrequests && Array.isArray(detail.pullrequests) ? detail.pullrequests :
                    []);
            }
            
            devStatus.detail.forEach(function(detail) {
                function getReviewerDecision(reviewer) {
                    if (!reviewer) return "unknown";
                    // разные интеграции: approved/status/approvalStatus
                    if (reviewer.approved === true) return "approved";
                    var st = (reviewer.status || reviewer.approvalStatus || "").toString().toUpperCase();
                    if (st.indexOf("APPROV") >= 0) return "approved";
                    if (st.indexOf("NEEDS") >= 0 || st.indexOf("WORK") >= 0 || st.indexOf("CHANGES") >= 0) return "needs_work";
                    if (reviewer.approvedDate) return "approved";
                    return st ? "reviewed" : "unknown";
                }

                function processPR(pr) {
                    prCount += 1;
                    var status = (pr.status || "").toLowerCase();
                    var authorName = extractAuthorName(pr.author);

                    var prInfo = {
                        id: pr.id || pr.key || "",
                        status: status,
                        author: authorName,
                        created: normalizeTimestamp(pr.createdDate),
                        updated: normalizeTimestamp(pr.updatedDate),
                        merged: normalizeTimestamp(pr.mergedDate || pr.completedDate || pr.closedDate),
                        reviewers: [],
                        iterations: 0,
                        firstTimeApproved: false,
                        needsWork: false
                    };

                    // Фильтрация по диапазону (по созданию/обновлению/мерджу).
                    // Если PR никак не затрагивал выбранный период — не учитываем его в статистике.
                    if (!touchesPeriod(prInfo)) return;

                    if (status === "open" || status === "new") {
                        open += 1;
                    } else if (status === "declined" || status === "rejected") {
                        declined += 1;
                    } else if (status === "merged" || status === "completed") {
                        merged += 1;
                        if (prInfo.created && prInfo.merged && prInfo.merged >= prInfo.created) {
                            totalCycle += (prInfo.merged - prInfo.created) / 1000;
                            mergedCount += 1;
                        }
                    }

                    if (!authorRework[authorName]) authorRework[authorName] = { needsWorkPrs: 0, totalPrs: 0 };
                    authorRework[authorName].totalPrs += 1;

                    (pr.reviewers || []).forEach(function(reviewer) {
                        var name = extractReviewerName(reviewer);
                        if (!name) return;
                        prInfo.reviewers.push(name);

                        if (!reviewers[name]) reviewers[name] = 0;
                        reviewers[name] += 1;

                        if (!reviewerStats[name]) {
                            reviewerStats[name] = {
                                reviews: 0,
                                totalTimeSeconds: 0,
                                reviewCount: 0
                            };
                        }
                        reviewerStats[name].reviews += 1;

                        if (!reviewerDecisionStats[name]) {
                            reviewerDecisionStats[name] = { approved: 0, needsWork: 0, reviewed: 0 };
                        }
                        var decision = getReviewerDecision(reviewer);
                        if (decision === "approved") reviewerDecisionStats[name].approved += 1;
                        else if (decision === "needs_work") reviewerDecisionStats[name].needsWork += 1;
                        else reviewerDecisionStats[name].reviewed += 1;

                        if (decision === "needs_work") {
                            prInfo.needsWork = true;
                        }

                        var reviewTime = normalizeTimestamp(reviewer.lastReviewedDate || reviewer.approvedDate);
                        if (reviewTime && prInfo.created && reviewTime >= prInfo.created) {
                            reviewerStats[name].totalTimeSeconds += (reviewTime - prInfo.created) / 1000;
                            reviewerStats[name].reviewCount += 1;
                        }
                    });

                    if (prInfo.needsWork) {
                        authorRework[authorName].needsWorkPrs += 1;
                    }

                    prs.push(prInfo);
                }

                // Иногда PR приходят напрямую на detail, без repositories
                getPullRequestsFromDetail(detail).forEach(processPR);

                (detail.repositories || []).forEach(function(repo) {
                    getPullRequestsFromRepo(repo).forEach(processPR);
                });
            });
            
            var firstTimeApproved = 0;
            prs.forEach(function(pr) {
                if (pr.status === "merged" || pr.status === "completed") {
                    pr.iterations = calculatePRIterations(pr);
                    var isFirstTime = determineFirstTimeApproval(pr);
                    pr.firstTimeApproved = isFirstTime;
                    if (isFirstTime) {
                        firstTimeApproved += 1;
                    }
                }
            });
            
            return {
                prCount: prCount,
                merged: merged,
                open: open,
                declined: declined,
                mergedCount: mergedCount,
                totalCycleSeconds: totalCycle,
                reviewers: reviewers,
                reviewerStats: reviewerStats,
                reviewerDecisionStats: reviewerDecisionStats,
                authorRework: authorRework,
                avgCycleSeconds: mergedCount ? totalCycle / mergedCount : 0,
                firstTimeApprovalRate: mergedCount ? firstTimeApproved / mergedCount : 0,
                avgIterations: calculateAvgIterations(prs),
                prs: prs
            };
        }
        
        function detectPingPongPattern(issue) {
            var statusEvents = extractFieldEventsInPeriod(issue, "status");
            if (!statusEvents || statusEvents.length === 0) {
                return { detected: false, iterations: 0 };
            }
            
            var reviewToWorkTransitions = 0;
            
            statusEvents.forEach(function(evt) {
                var fromCat = workflow.getCategoriesForStatus(evt.from || "", state.workflowConfig);
                var toCat = workflow.getCategoriesForStatus(evt.to || "", state.workflowConfig);
                
                var fromIsReview = fromCat.indexOf("review") >= 0;
                var toIsWork = toCat.indexOf("work") >= 0;
                
                if (fromIsReview && toIsWork) {
                    reviewToWorkTransitions += 1;
                }
            });
            
            return {
                detected: reviewToWorkTransitions > 2,
                iterations: reviewToWorkTransitions
            };
        }
        
        function calculateDevSummary(issues) {
            var summary = {
                prCount: 0,
                mergedCount: 0,
                openCount: 0,
                declinedCount: 0,
                avgCycleSeconds: 0,
                avgIterations: 0,
                firstTimeApprovalRate: 0,
                reviewers: {},
                reviewerStats: {},
                reviewerDecisionStats: {},
                authorRework: {},
                authorStats: {},
                pingPongIssues: []
            };
            var totalCycle = 0;
            var mergedCounter = 0;
            var totalIterations = 0;
            var firstTimeApproved = 0;
            
            (issues || []).forEach(function(issue) {
                var devInfo = parseDevData(issue.devStatus);
                if (!devInfo) return;
                
                summary.prCount += devInfo.prCount;
                summary.mergedCount += devInfo.merged;
                summary.openCount += devInfo.open || 0;
                summary.declinedCount += devInfo.declined || 0;
                totalCycle += devInfo.totalCycleSeconds;
                mergedCounter += devInfo.mergedCount;
                totalIterations += devInfo.avgIterations || 0;
                
                Object.keys(devInfo.reviewers || {}).forEach(function(name) {
                    if (!summary.reviewers[name]) summary.reviewers[name] = 0;
                    summary.reviewers[name] += devInfo.reviewers[name];
                });
                
                Object.keys(devInfo.reviewerStats || {}).forEach(function(name) {
                    if (!summary.reviewerStats[name]) {
                        summary.reviewerStats[name] = {
                            reviews: 0,
                            totalTimeSeconds: 0,
                            reviewCount: 0
                        };
                    }
                    var stats = devInfo.reviewerStats[name];
                    summary.reviewerStats[name].reviews += stats.reviews;
                    summary.reviewerStats[name].totalTimeSeconds += stats.totalTimeSeconds;
                    summary.reviewerStats[name].reviewCount += stats.reviewCount;
                });

                Object.keys(devInfo.reviewerDecisionStats || {}).forEach(function(name) {
                    if (!summary.reviewerDecisionStats[name]) {
                        summary.reviewerDecisionStats[name] = { approved: 0, needsWork: 0, reviewed: 0 };
                    }
                    var ds = devInfo.reviewerDecisionStats[name];
                    summary.reviewerDecisionStats[name].approved += ds.approved || 0;
                    summary.reviewerDecisionStats[name].needsWork += ds.needsWork || 0;
                    summary.reviewerDecisionStats[name].reviewed += ds.reviewed || 0;
                });

                Object.keys(devInfo.authorRework || {}).forEach(function(author) {
                    if (!summary.authorRework[author]) summary.authorRework[author] = { needsWorkPrs: 0, totalPrs: 0 };
                    summary.authorRework[author].needsWorkPrs += devInfo.authorRework[author].needsWorkPrs || 0;
                    summary.authorRework[author].totalPrs += devInfo.authorRework[author].totalPrs || 0;
                });
                
                (devInfo.prs || []).forEach(function(pr) {
                    if (pr.firstTimeApproved) firstTimeApproved += 1;
                    var author = pr.author;
                    if (author && author !== "Unknown") {
                        if (!summary.authorStats[author]) {
                            summary.authorStats[author] = {
                                prs: 0,
                                merged: 0,
                                firstTimeApproved: 0,
                                totalIterations: 0,
                                needsWorkPrs: 0
                            };
                        }
                        summary.authorStats[author].prs += 1;
                        if (pr.status === "merged" || pr.status === "completed") {
                            summary.authorStats[author].merged += 1;
                            summary.authorStats[author].totalIterations += pr.iterations || 1;
                            if (pr.firstTimeApproved) {
                                summary.authorStats[author].firstTimeApproved += 1;
                            }
                        }
                        if (pr.needsWork) {
                            summary.authorStats[author].needsWorkPrs += 1;
                        }
                    }
                });
                
                var pingPong = detectPingPongPattern(issue);
                if (pingPong.detected) {
                    summary.pingPongIssues.push({
                        key: issue.key,
                        iterations: pingPong.iterations,
                        author: devInfo.prs && devInfo.prs[0] ? devInfo.prs[0].author : "Unknown"
                    });
                }
                
                issue.analytics = issue.analytics || {};
                issue.analytics.dev = devInfo;
                issue.analytics.prIterations = devInfo.avgIterations || 0;
                if (pingPong.detected) {
                    issue.analytics.pingPong = pingPong;
                }
            });
            
            summary.avgCycleSeconds = mergedCounter ? totalCycle / mergedCounter : 0;
            summary.avgIterations = mergedCounter ? totalIterations / mergedCounter : 0;
            summary.firstTimeApprovalRate = mergedCounter ? firstTimeApproved / mergedCounter : 0;
            
            state.devSummary = summary;
        }
        
        return {
            calculateDevSummary: calculateDevSummary,
            parseDevData: parseDevData,
            detectPingPongPattern: detectPingPongPattern
        };
    }
    
    return {
        createDevCycleAnalyzer: createDevCycleAnalyzer
    };
});
