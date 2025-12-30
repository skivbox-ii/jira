// Velocity и throughput
define("_ujgPA_velocity", ["_ujgPA_utils", "_ujgPA_workflow", "_ujgPA_basicAnalytics"], function(utils, workflow, basicAnalytics) {
    "use strict";
    
    function createVelocityCalculator(state) {
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
        
        function getStoryPoints(issue) {
            var fieldId = state.customFields && state.customFields.storyPoints;
            if (!fieldId) return 0;
            var value = issue.fields ? issue.fields[fieldId] : null;
            if (typeof value === "number") return value;
            var parsed = parseFloat(value);
            return isNaN(parsed) ? 0 : parsed;
        }
        
        function calculateVelocity(issues) {
            var summary = {
                closedIssues: 0,
                totalPoints: 0,
                avgPointsPerIssue: 0
            };
            var bounds = getPeriodBounds();
            (issues || []).forEach(function(issue) {
                var currentStatus = issue.fields && issue.fields.status && issue.fields.status.name;
                if (!workflow.statusHasCategory(currentStatus, "done", state.workflowConfig)) return;
                var resolutionDate = utils.parseDateSafe(issue.fields && issue.fields.resolutiondate);
                if (resolutionDate && (resolutionDate < bounds.start || resolutionDate > bounds.end)) return;
                summary.closedIssues += 1;
                summary.totalPoints += getStoryPoints(issue);
            });
            summary.avgPointsPerIssue = summary.closedIssues ? summary.totalPoints / summary.closedIssues : 0;
            state.velocity = summary;
        }
        
        return {
            calculateVelocity: calculateVelocity
        };
    }
    
    return {
        createVelocityCalculator: createVelocityCalculator
    };
});
