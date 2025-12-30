// Детекция узких мест
define("_ujgPA_bottlenecks", ["_ujgPA_config", "_ujgPA_utils", "_ujgPA_workflow", "_ujgPA_basicAnalytics"], function(config, utils, workflow, basicAnalytics) {
    "use strict";
    
    var DEFAULT_THRESHOLDS = config.DEFAULT_THRESHOLDS;
    
    function createBottleneckDetector(state) {
        var getInitialAssignee = basicAnalytics.createBasicAnalytics(state).getInitialAssignee;
        
        function detectBottlenecks(issues) {
            var thresholds = state.thresholds || DEFAULT_THRESHOLDS;
            var reviewLimit = (thresholds.longReviewRisk || 0) * 86400;
            var testingLimit = (thresholds.longTestingRisk || 0) * 86400;
            var staleDays = thresholds.noProgressRisk || 0;
            var travellerLimit = thresholds.sprintChangesRisk || 0;
            var wipLimit = thresholds.wipLimit || 5;
            
            var result = {
                longReview: [],
                longTesting: [],
                travellers: [],
                stale: [],
                wipOverload: [],
                reopens: []
            };
            
            var wipByAssignee = {};
            (issues || []).forEach(function(issue) {
                var analytics = issue.analytics || {};
                var categories = analytics.timeInStatuses && analytics.timeInStatuses.categories || {};
                if (reviewLimit > 0 && categories.review && categories.review > reviewLimit) {
                    result.longReview.push({ key: issue.key, seconds: categories.review });
                }
                if (testingLimit > 0 && categories.testing && categories.testing > testingLimit) {
                    result.longTesting.push({ key: issue.key, seconds: categories.testing });
                }
                if (travellerLimit > 0 && analytics.sprintChanges > travellerLimit) {
                    result.travellers.push({ key: issue.key, changes: analytics.sprintChanges });
                }
                if (analytics.lastActivity && staleDays > 0) {
                    var inactiveDays = utils.daysSince(analytics.lastActivity);
                    if (inactiveDays > staleDays && !workflow.statusHasCategory(issue.fields && issue.fields.status && issue.fields.status.name, "done", state.workflowConfig)) {
                        result.stale.push({ key: issue.key, days: inactiveDays });
                    }
                }
                if (analytics.reopenCount > 0) {
                    result.reopens.push({ key: issue.key, count: analytics.reopenCount });
                }
                var currentStatus = issue.fields && issue.fields.status && issue.fields.status.name;
                if (workflow.statusHasCategory(currentStatus, "work", state.workflowConfig)) {
                    var assignee = getInitialAssignee(issue);
                    wipByAssignee[assignee] = (wipByAssignee[assignee] || 0) + 1;
                }
            });
            
            Object.keys(wipByAssignee).forEach(function(name) {
                if (wipByAssignee[name] > wipLimit) {
                    result.wipOverload.push({ assignee: name, count: wipByAssignee[name] });
                }
            });
            
            state.bottlenecks = result;
        }
        
        return {
            detectBottlenecks: detectBottlenecks
        };
    }
    
    return {
        createBottleneckDetector: createBottleneckDetector
    };
});
