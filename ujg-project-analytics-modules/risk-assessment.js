// Оценка рисков
define("_ujgPA_riskAssessment", ["_ujgPA_config", "_ujgPA_utils"], function(config, utils) {
    "use strict";
    
    var DEFAULT_THRESHOLDS = config.DEFAULT_THRESHOLDS;
    var DEFAULT_RISK_WEIGHTS = config.DEFAULT_RISK_WEIGHTS;
    
    function createRiskAssessor(state) {
        function calculateRiskScores(issues) {
            var thresholds = state.thresholds || DEFAULT_THRESHOLDS;
            var weights = state.riskWeights || DEFAULT_RISK_WEIGHTS;
            (issues || []).forEach(function(issue) {
                var analytics = issue.analytics || {};
                var factors = [];
                var created = utils.parseDateSafe(issue.fields && issue.fields.created);
                if (created && utils.daysSince(created) > (thresholds.ageRisk || 0)) {
                    factors.push({ type: "age", weight: weights.age || 0, message: "Старше " + thresholds.ageRisk + " дн." });
                }
                if (analytics.sprintChanges > (thresholds.sprintChangesRisk || 0)) {
                    factors.push({ type: "sprint_changes", weight: weights.sprintChanges || 0, message: "Смены спринтов: " + analytics.sprintChanges });
                }
                if (analytics.assigneeChanges > (thresholds.assigneeChangesRisk || 0)) {
                    factors.push({ type: "assignee_changes", weight: weights.assigneeChanges || 0, message: "Смены исполнителя: " + analytics.assigneeChanges });
                }
                if (analytics.lastActivity && utils.daysSince(analytics.lastActivity) > (thresholds.noProgressRisk || 0)) {
                    factors.push({ type: "no_progress", weight: weights.noProgress || 0, message: "Нет активности " + utils.daysSince(analytics.lastActivity) + " дн." });
                }
                if (analytics.reopenCount > 0) {
                    factors.push({ type: "reopens", weight: weights.reopens || 0, message: "Возвратов: " + analytics.reopenCount });
                }
                var categories = analytics.timeInStatuses && analytics.timeInStatuses.categories || {};
                if ((categories.review || 0) > (thresholds.longReviewRisk || 0) * 86400) {
                    factors.push({ type: "long_review", weight: weights.longReview || 0, message: "Долгое ревью" });
                }
                if ((categories.testing || 0) > (thresholds.longTestingRisk || 0) * 86400) {
                    factors.push({ type: "long_testing", weight: weights.longTesting || 0, message: "Долгое тестирование" });
                }
                if ((analytics.prIterations || 0) > (thresholds.prIterationsRisk || 0)) {
                    factors.push({ type: "pr_iterations", weight: weights.prIterations || 0, message: "PR итераций: " + analytics.prIterations });
                }
                var priority = issue.fields && issue.fields.priority && issue.fields.priority.name;
                if (priority && /critical|high|highest|крит/i.test(priority)) {
                    factors.push({ type: "priority", weight: 5, message: "Высокий приоритет" });
                }
                var score = 0;
                factors.forEach(function(f) { score += f.weight || 0; });
                if (score > 100) score = 100;
                analytics.risk = {
                    score: Math.round(score),
                    factors: factors
                };
                issue.analytics = analytics;
            });
        }
        
        return {
            calculateRiskScores: calculateRiskScores
        };
    }
    
    return {
        createRiskAssessor: createRiskAssessor
    };
});
