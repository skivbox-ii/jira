// Базовая аналитика
define("_ujgPA_basicAnalytics", ["_ujgPA_utils", "_ujgPA_workflow"], function(utils, workflow) {
    "use strict";
    
    function createBasicAnalytics(state) {
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
        
        function getInitialStatus(issue) {
            var fields = issue && issue.fields;
            if (fields && fields.status && fields.status.name) return fields.status.name;
            return "Unknown";
        }
        
        function getInitialAssignee(issue) {
            var assignee = issue && issue.fields && issue.fields.assignee;
            if (!assignee) return "Unassigned";
            return assignee.displayName || assignee.name || assignee.accountId || "Unassigned";
        }
        
        function extractFieldEvents(issue, fieldName) {
            var events = [];
            var histories = (issue && issue.changelog && issue.changelog.histories) || [];
            histories.forEach(function(history) {
                var changeTime = utils.parseDateSafe(history.created);
                if (!changeTime) return;
                (history.items || []).forEach(function(item) {
                    if (!item.field) return;
                    if (item.field.toLowerCase() !== fieldName) return;
                    events.push({
                        from: item.fromString || "",
                        to: item.toString || "",
                        at: changeTime
                    });
                });
            });
            events.sort(function(a, b) { return a.at - b.at; });
            return events;
        }
        
        function buildTimelineSegments(issue, fieldName, initialValue) {
            var events = extractFieldEvents(issue, fieldName);
            var segments = [];
            var currentValue = initialValue;
            if (!currentValue && events.length > 0) {
                currentValue = events[0].from || events[0].to || "";
            }
            var currentStart = utils.parseDateSafe(issue.fields && issue.fields.created);
            if (!currentStart && events.length > 0) currentStart = events[0].at;
            events.forEach(function(evt) {
                if (currentStart && evt.at) {
                    segments.push({
                        value: currentValue,
                        start: currentStart,
                        end: evt.at
                    });
                }
                currentValue = evt.to || currentValue;
                currentStart = evt.at;
            });
            var finalEnd = utils.parseDateSafe(issue.fields && (issue.fields.resolutiondate || issue.fields.updated)) || new Date();
            if (currentStart && finalEnd && finalEnd >= currentStart) {
                segments.push({
                    value: currentValue,
                    start: currentStart,
                    end: finalEnd
                });
            }
            return segments;
        }
        
        function calculateOverlapSeconds(segmentStart, segmentEnd, bounds) {
            if (!segmentStart || !segmentEnd) return 0;
            var start = segmentStart < bounds.start ? bounds.start : segmentStart;
            var end = segmentEnd > bounds.end ? bounds.end : segmentEnd;
            if (end <= start) return 0;
            return (end - start) / 1000;
        }
        
        function computeTimeInStatuses(issue) {
            var initialStatus = getInitialStatus(issue);
            var segments = buildTimelineSegments(issue, "status", initialStatus);
            var bounds = getPeriodBounds();
            var statusTotals = {};
            var categoryTotals = {};
            var entries = [];
            
            segments.forEach(function(segment) {
                if (!segment.start || !segment.end) return;
                var seconds = calculateOverlapSeconds(segment.start, segment.end, bounds);
                if (seconds <= 0) return;
                var statusName = segment.value || "Unknown";
                if (!statusTotals[statusName]) {
                    statusTotals[statusName] = { seconds: 0, categories: workflow.getCategoriesForStatus(statusName, state.workflowConfig) };
                }
                statusTotals[statusName].seconds += seconds;
                var categories = statusTotals[statusName].categories || workflow.getCategoriesForStatus(statusName, state.workflowConfig) || [];
                categories.forEach(function(cat) {
                    if (!categoryTotals[cat]) categoryTotals[cat] = 0;
                    categoryTotals[cat] += seconds;
                });
                entries.push({
                    status: statusName,
                    start: segment.start,
                    end: segment.end,
                    seconds: seconds,
                    categories: categories
                });
            });
            
            return {
                statuses: statusTotals,
                categories: categoryTotals,
                entries: entries
            };
        }
        
        function computeTimeOnAssignees(issue) {
            var initialAssignee = getInitialAssignee(issue);
            var segments = buildTimelineSegments(issue, "assignee", initialAssignee);
            var bounds = getPeriodBounds();
            var totals = {};
            var entries = [];
            
            segments.forEach(function(segment) {
                if (!segment.start || !segment.end) return;
                var seconds = calculateOverlapSeconds(segment.start, segment.end, bounds);
                if (seconds <= 0) return;
                var assignee = segment.value || "Unassigned";
                if (!totals[assignee]) totals[assignee] = 0;
                totals[assignee] += seconds;
                entries.push({
                    assignee: assignee,
                    start: segment.start,
                    end: segment.end,
                    seconds: seconds
                });
            });
            
            return {
                totals: totals,
                entries: entries
            };
        }
        
        function computeLeadCycleTime(issue) {
            var created = utils.parseDateSafe(issue.fields && issue.fields.created);
            if (!created) return { leadSeconds: 0, cycleSeconds: 0, waitSeconds: 0 };
            var segments = buildTimelineSegments(issue, "status", getInitialStatus(issue));
            var doneTime = null;
            var workStart = null;
            segments.forEach(function(segment) {
                if (!segment.start) return;
                if (!workStart && workflow.statusHasCategory(segment.value, "work", state.workflowConfig)) {
                    workStart = segment.start;
                }
                if (!doneTime && workflow.statusHasCategory(segment.value, "done", state.workflowConfig)) {
                    doneTime = segment.start;
                }
            });
            var defaultEnd = utils.parseDateSafe(issue.fields && (issue.fields.resolutiondate || issue.fields.updated)) || new Date();
            if (!doneTime) doneTime = defaultEnd;
            var leadSeconds = Math.max(0, (doneTime - created) / 1000);
            var cycleSeconds = workStart ? Math.max(0, (doneTime - workStart) / 1000) : 0;
            if (cycleSeconds > leadSeconds) cycleSeconds = leadSeconds;
            var waitSeconds = Math.max(0, leadSeconds - cycleSeconds);
            return {
                leadSeconds: leadSeconds,
                cycleSeconds: cycleSeconds,
                waitSeconds: waitSeconds
            };
        }
        
        function countReopens(statusEvents) {
            var count = 0;
            (statusEvents || []).forEach(function(evt) {
                if (!evt || !evt.from) return;
                if (workflow.statusHasCategory(evt.from, "done", state.workflowConfig) && !workflow.statusHasCategory(evt.to, "done", state.workflowConfig)) {
                    count += 1;
                }
            });
            return count;
        }
        
        function getLastActivityDate(issue) {
            var last = utils.parseDateSafe(issue.fields && issue.fields.updated);
            var histories = (issue.changelog && issue.changelog.histories) || [];
            histories.forEach(function(history) {
                var dt = utils.parseDateSafe(history.created);
                if (dt && (!last || dt > last)) last = dt;
            });
            (issue.worklogs || []).forEach(function(wl) {
                var dt = utils.parseDateSafe(wl.started);
                if (dt && (!last || dt > last)) last = dt;
            });
            return last;
        }
        
        function accumulateStatusTotals(summary, metrics) {
            Object.keys(metrics.statuses || {}).forEach(function(status) {
                if (!summary.statusTotals[status]) summary.statusTotals[status] = 0;
                summary.statusTotals[status] += metrics.statuses[status].seconds;
            });
            Object.keys(metrics.categories || {}).forEach(function(cat) {
                if (!summary.categoryTotals[cat]) summary.categoryTotals[cat] = 0;
                summary.categoryTotals[cat] += metrics.categories[cat];
            });
        }
        
        function accumulateAssigneeTotals(summary, metrics) {
            Object.keys(metrics.totals || {}).forEach(function(name) {
                if (!summary.assigneeTotals[name]) summary.assigneeTotals[name] = 0;
                summary.assigneeTotals[name] += metrics.totals[name];
            });
        }
        
        function calculateAnalytics(issues) {
            if (!issues || issues.length === 0) {
                state.analyticsSummary = null;
                return;
            }
            var summary = {
                issueCount: issues.length,
                statusTotals: {},
                categoryTotals: {},
                assigneeTotals: {},
                totalLeadSeconds: 0,
                totalCycleSeconds: 0,
                totalWaitSeconds: 0
            };
            issues.forEach(function(issue) {
                var analytics = issue.analytics || {};
                var statusMetrics = computeTimeInStatuses(issue);
                analytics.timeInStatuses = statusMetrics;
                accumulateStatusTotals(summary, statusMetrics);
                
                var assigneeMetrics = computeTimeOnAssignees(issue);
                analytics.timeOnAssignees = assigneeMetrics;
                accumulateAssigneeTotals(summary, assigneeMetrics);
                
                var timing = computeLeadCycleTime(issue);
                analytics.leadTimeSeconds = timing.leadSeconds;
                analytics.cycleTimeSeconds = timing.cycleSeconds;
                analytics.waitTimeSeconds = timing.waitSeconds;
                
                var statusEvents = extractFieldEvents(issue, "status");
                analytics.reopenCount = countReopens(statusEvents);
                analytics.sprintChanges = extractFieldEvents(issue, "sprint").length;
                analytics.assigneeChanges = extractFieldEvents(issue, "assignee").length;
                analytics.lastActivity = getLastActivityDate(issue);
                
                summary.totalLeadSeconds += timing.leadSeconds;
                summary.totalCycleSeconds += timing.cycleSeconds;
                summary.totalWaitSeconds += timing.waitSeconds;
                
                issue.analytics = analytics;
            });
            state.analyticsSummary = summary;
        }
        
        return {
            calculateAnalytics: calculateAnalytics,
            extractFieldEvents: extractFieldEvents,
            getInitialStatus: getInitialStatus,
            getInitialAssignee: getInitialAssignee
        };
    }
    
    return {
        createBasicAnalytics: createBasicAnalytics
    };
});
