// Метрики команды
define("_ujgPA_teamMetrics", ["_ujgPA_workflow", "_ujgPA_basicAnalytics"], function(workflow, basicAnalytics) {
    "use strict";
    
    function createTeamMetricsCalculator(state) {
        var getInitialAssignee = basicAnalytics.createBasicAnalytics(state).getInitialAssignee;
        
        function calculateTeamMetrics(issues) {
            var metrics = {};
            (issues || []).forEach(function(issue) {
                var analytics = issue.analytics || {};
                var assignee = getInitialAssignee(issue);
                if (!metrics[assignee]) {
                    metrics[assignee] = {
                        name: assignee,
                        issues: 0,
                        closed: 0,
                        totalLead: 0,
                        totalCycle: 0,
                        reopenCount: 0
                    };
                }
                var entry = metrics[assignee];
                entry.issues += 1;
                entry.totalLead += analytics.leadTimeSeconds || 0;
                entry.totalCycle += analytics.cycleTimeSeconds || 0;
                entry.reopenCount += analytics.reopenCount || 0;
                var currentStatus = issue.fields && issue.fields.status && issue.fields.status.name;
                if (workflow.statusHasCategory(currentStatus, "done", state.workflowConfig)) entry.closed += 1;
            });
            state.teamMetrics = Object.keys(metrics).map(function(name) {
                var m = metrics[name];
                return {
                    name: name,
                    issues: m.issues,
                    closed: m.closed,
                    reopenRate: m.issues ? m.reopenCount / m.issues : 0,
                    avgLeadSeconds: m.issues ? m.totalLead / m.issues : 0,
                    avgCycleSeconds: m.issues ? m.totalCycle / m.issues : 0
                };
            }).sort(function(a, b) {
                return (b.closed || 0) - (a.closed || 0);
            });
        }
        
        return {
            calculateTeamMetrics: calculateTeamMetrics
        };
    }
    
    return {
        createTeamMetricsCalculator: createTeamMetricsCalculator
    };
});
