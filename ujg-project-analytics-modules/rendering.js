// Функции рендеринга UI
define("_ujgPA_rendering", ["jquery", "_ujgCommon", "_ujgPA_utils", "_ujgPA_config", "_ujgPA_workflow"], function($, Common, utils, config, workflow) {
    "use strict";
    
    var baseUrl = Common.baseUrl || "";
    var STATUS_CATEGORIES = workflow.STATUS_CATEGORIES;
    var escapeHtml = utils.utils && utils.utils.escapeHtml ? utils.utils.escapeHtml : function(str) { return String(str || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;"); };
    
    function createRenderer(state) {
        function formatDuration(seconds) {
            if (!seconds || seconds <= 0) return "0ч";
            var hours = seconds / 3600;
            if (hours >= 24) {
                var days = hours / 24;
                return (Math.round(days * 10) / 10) + "д";
            }
            if (hours >= 1) {
                return (Math.round(hours * 10) / 10) + "ч";
            }
            return Math.round(seconds / 60) + "м";
        }
        
        function getDominantStatus(analytics) {
            var result = { name: "—", seconds: 0 };
            if (!analytics || !analytics.timeInStatuses) return result;
            Object.keys(analytics.timeInStatuses.statuses || {}).forEach(function(name) {
                var seconds = analytics.timeInStatuses.statuses[name].seconds || 0;
                if (seconds > result.seconds) {
                    result = { name: name, seconds: seconds };
                }
            });
            return result;
        }
        
        function renderCategoryHeatmap($parent) {
            var summary = state.analyticsSummary;
            if (!summary || !summary.categoryTotals) return;
            var categories = Object.keys(summary.categoryTotals);
            if (categories.length === 0) return;
            var maxValue = Math.max.apply(null, categories.map(function(cat) { return summary.categoryTotals[cat]; }));
            if (!maxValue) return;
            var $section = $('<div class="ujg-pa-section"><h3>Heatmap по категориям</h3></div>');
            categories.forEach(function(cat) {
                var value = summary.categoryTotals[cat] || 0;
                var percent = Math.round((value / maxValue) * 100);
                var label = (STATUS_CATEGORIES[cat] && STATUS_CATEGORIES[cat].name) || cat;
                var $row = $('<div class="ujg-pa-bar-row"></div>');
                $row.append('<span class="ujg-pa-bar-label">' + label + "</span>");
                var $track = $('<div class="ujg-pa-bar-track"><div class="ujg-pa-bar-fill"></div></div>');
                $track.find(".ujg-pa-bar-fill").css("width", percent + "%");
                $row.append($track);
                $row.append('<span class="ujg-pa-bar-value">' + formatDuration(value) + "</span>");
                $section.append($row);
            });
            $parent.append($section);
        }
        
        function renderRiskMatrixSection($parent) {
            var issues = (state.issues || []).filter(function(issue) {
                return issue.analytics && issue.analytics.risk;
            }).sort(function(a, b) {
                return b.analytics.risk.score - a.analytics.risk.score;
            }).slice(0, 8);
            if (issues.length === 0) return;
            var $section = $('<div class="ujg-pa-section"><h3>Risk Matrix</h3></div>');
            var $table = $('<table class="ujg-pa-table"><thead><tr><th>Key</th><th>Risk</th><th>Факторы</th></tr></thead><tbody></tbody></table>');
            issues.forEach(function(issue) {
                var risk = issue.analytics.risk;
                var factors = (risk.factors || []).map(function(f) { return f.message; }).join(", ");
                var $row = $("<tr></tr>");
                $row.append('<td><a href="' + baseUrl + "/browse/" + issue.key + '" target="_blank">' + issue.key + "</a></td>");
                $row.append("<td>" + risk.score + "%</td>");
                $row.append("<td>" + escapeHtml(factors || "—") + "</td>");
                $table.find("tbody").append($row);
            });
            $section.append($table);
            $parent.append($section);
        }
        
        function renderTeamMetricsSection($parent) {
            if (!state.teamMetrics || state.teamMetrics.length === 0) return;
            var $section = $('<div class="ujg-pa-section"><h3>Team Performance</h3></div>');
            var $table = $('<table class="ujg-pa-table"><thead><tr><th>Участник</th><th>Задачи</th><th>Закрыто</th><th>Avg Lead</th><th>Avg Cycle</th><th>Reopen %</th></tr></thead><tbody></tbody></table>');
            state.teamMetrics.forEach(function(member) {
                var $row = $("<tr></tr>");
                $row.append("<td>" + escapeHtml(member.name) + "</td>");
                $row.append("<td>" + member.issues + "</td>");
                $row.append("<td>" + member.closed + "</td>");
                $row.append("<td>" + formatDuration(member.avgLeadSeconds) + "</td>");
                $row.append("<td>" + formatDuration(member.avgCycleSeconds) + "</td>");
                $row.append("<td>" + Math.round((member.reopenRate || 0) * 100) + "%</td>");
                $table.find("tbody").append($row);
            });
            $section.append($table);
            $parent.append($section);
        }
        
        function renderVelocitySection($parent) {
            var velocity = state.velocity;
            var devSummary = state.devSummary;
            if (!velocity && !devSummary) return;
            var $section = $('<div class="ujg-pa-section"><h3>Velocity &amp; Dev Cycle</h3></div>');
            if (velocity) {
                var totalPoints = Number(velocity.totalPoints || 0);
                var avgPoints = Number(velocity.avgPointsPerIssue || 0);
                $section.append('<p>Закрыто задач: <strong>' + (velocity.closedIssues || 0) +
                    "</strong>, Story Points: <strong>" + totalPoints.toFixed(1) +
                    "</strong>, Avg SP: <strong>" + avgPoints.toFixed(1) + "</strong></p>");
            }
            if (devSummary) {
                $section.append('<p>Pull Requests: <strong>' + (devSummary.prCount || 0) + "</strong>, Merged: <strong>" + (devSummary.mergedCount || 0) +
                    "</strong>, Open: <strong>" + (devSummary.openCount || 0) + "</strong>, Declined: <strong>" + (devSummary.declinedCount || 0) + "</strong></p>");
                $section.append('<p>Avg PR Cycle Time: <strong>' + formatDuration(devSummary.avgCycleSeconds) + 
                    "</strong>, Avg Iterations: <strong>" + (devSummary.avgIterations || 0).toFixed(1) + "</strong></p>");
            }
            $parent.append($section);
        }
        
        function renderDevCycleSection($parent) {
            var devSummary = state.devSummary;
            if (!devSummary || devSummary.prCount === 0) return;
            
            var $section = $('<div class="ujg-pa-section"><h3>Анализ цикла разработки</h3></div>');
            
            var $overview = $('<div class="ujg-pa-dev-overview"></div>');
            $overview.append('<p><strong>Обзор PR за период:</strong></p>');
            $overview.append('<p>Всего PR: <strong>' + devSummary.prCount + 
                "</strong> | Merged: <strong>" + devSummary.mergedCount + 
                "</strong> | Open: <strong>" + (devSummary.openCount || 0) + 
                "</strong> | Declined: <strong>" + (devSummary.declinedCount || 0) + "</strong></p>");
            $overview.append('<p>Avg PR Cycle Time: <strong>' + formatDuration(devSummary.avgCycleSeconds) + 
                "</strong> | Avg Iterations: <strong>" + (devSummary.avgIterations || 0).toFixed(1) + "</strong></p>");
            $section.append($overview);
            
            if (devSummary.reviewerStats && Object.keys(devSummary.reviewerStats).length > 0) {
                var $reviewers = $('<div class="ujg-pa-reviewers-section"><h4>Нагрузка на ревьюеров</h4></div>');
                var reviewers = Object.keys(devSummary.reviewerStats).map(function(name) {
                    var stats = devSummary.reviewerStats[name];
                    return {
                        name: name,
                        reviews: stats.reviews || 0,
                        avgTime: stats.reviewCount ? stats.totalTimeSeconds / stats.reviewCount : 0
                    };
                }).sort(function(a, b) { return b.reviews - a.reviews; });
                
                var maxReviews = Math.max.apply(null, reviewers.map(function(r) { return r.reviews; }));
                reviewers.forEach(function(reviewer) {
                    var percent = maxReviews ? Math.round((reviewer.reviews / maxReviews) * 100) : 0;
                    var $row = $('<div class="ujg-pa-bar-row"></div>');
                    $row.append('<span class="ujg-pa-bar-label">' + escapeHtml(reviewer.name) + "</span>");
                    var $track = $('<div class="ujg-pa-bar-track"><div class="ujg-pa-bar-fill"></div></div>');
                    $track.find(".ujg-pa-bar-fill").css("width", percent + "%");
                    $row.append($track);
                    $row.append('<span class="ujg-pa-bar-value">' + reviewer.reviews + " reviews (avg " + formatDuration(reviewer.avgTime) + ")</span>");
                    $reviewers.append($row);
                });
                $section.append($reviewers);
            }
            
            if (devSummary.authorStats && Object.keys(devSummary.authorStats).length > 0) {
                var $authors = $('<div class="ujg-pa-authors-section"><h4>Качество по разработчикам (First-time Approval Rate)</h4></div>');
                var authors = Object.keys(devSummary.authorStats).map(function(name) {
                    var stats = devSummary.authorStats[name];
                    var rate = stats.merged ? stats.firstTimeApproved / stats.merged : 0;
                    return {
                        name: name,
                        merged: stats.merged,
                        firstTimeApproved: stats.firstTimeApproved,
                        rate: rate,
                        avgIterations: stats.merged ? stats.totalIterations / stats.merged : 0
                    };
                }).sort(function(a, b) { return b.rate - a.rate; });
                
                var maxRate = 1;
                authors.forEach(function(author) {
                    var percent = Math.round(author.rate * 100);
                    var $row = $('<div class="ujg-pa-bar-row"></div>');
                    var statusIcon = percent >= 85 ? "[OK]" : percent >= 60 ? "[!]" : "[X]";
                    var statusText = percent >= 85 ? "Отлично" : percent >= 60 ? "Внимание" : "Проблема";
                    $row.append('<span class="ujg-pa-bar-label">' + escapeHtml(author.name) + " " + statusIcon + "</span>");
                    var $track = $('<div class="ujg-pa-bar-track"><div class="ujg-pa-bar-fill"></div></div>');
                    $track.find(".ujg-pa-bar-fill").css("width", percent + "%");
                    $row.append($track);
                    $row.append('<span class="ujg-pa-bar-value">' + percent + "% " + statusText + "</span>");
                    $authors.append($row);
                });
                $section.append($authors);
            }
            
            if (devSummary.pingPongIssues && devSummary.pingPongIssues.length > 0) {
                var $pingPong = $('<div class="ujg-pa-pingpong-section"><h4>Задачи с множественными возвратами (>2 iterations)</h4></div>');
                var $table = $('<table class="ujg-pa-table"><thead><tr><th>Задача</th><th>PR</th><th>Iterations</th><th>Автор</th></tr></thead><tbody></tbody></table>');
                devSummary.pingPongIssues.slice(0, 10).forEach(function(item) {
                    var $row = $("<tr></tr>");
                    $row.append('<td><a href="' + baseUrl + "/browse/" + item.key + '" target="_blank">' + item.key + "</a></td>");
                    $row.append("<td>—</td>");
                    $row.append("<td>" + item.iterations + "</td>");
                    $row.append("<td>" + escapeHtml(item.author) + "</td>");
                    $table.find("tbody").append($row);
                });
                $pingPong.append($table);
                $section.append($pingPong);
            }
            
            $parent.append($section);
        }
        
        function renderBottlenecksSection($parent) {
            if (!state.bottlenecks) return;
            var $section = $('<div class="ujg-pa-section"><h3>Узкие места</h3></div>');
            function listItems(label, items, formatter) {
                if (!items || items.length === 0) return;
                var $block = $('<div class="ujg-pa-bottleneck-block"><strong>' + label + ":</strong></div>");
                var $list = $("<ul></ul>");
                items.slice(0, 5).forEach(function(item) {
                    var text = formatter(item);
                    $list.append("<li>" + escapeHtml(text) + "</li>");
                });
                $block.append($list);
                $section.append($block);
            }
            listItems("Долгое ревью", state.bottlenecks.longReview, function(item) {
                return item.key + " (" + formatDuration(item.seconds) + ")";
            });
            listItems("Долгое тестирование", state.bottlenecks.longTesting, function(item) {
                return item.key + " (" + formatDuration(item.seconds) + ")";
            });
            listItems("Путешествующие задачи", state.bottlenecks.travellers, function(item) {
                return item.key + " (" + item.changes + " спринтов)";
            });
            listItems("Старые задачи", state.bottlenecks.stale, function(item) {
                return item.key + " (" + item.days + " дн. без активности)";
            });
            listItems("WIP перегруз", state.bottlenecks.wipOverload, function(item) {
                return item.assignee + ": " + item.count + " задач";
            });
            $parent.append($section);
        }
        
        function renderTrendPlaceholder($parent) {
            var $section = $('<div class="ujg-pa-section ujg-pa-placeholder"></div>');
            $section.append("<h3>Тренды</h3>");
            $section.append("<p>Исторические данные появятся после нескольких запусков виджета. Они будут сохранены локально для расчёта графиков.</p>");
            $parent.append($section);
        }
        
        function renderAnalyticsTable($resultsContainer) {
            if (!$resultsContainer) {
                utils.log("WARNING: $resultsContainer not initialized");
                return;
            }
            $resultsContainer.empty();
            if (!state.issues || state.issues.length === 0) {
                $resultsContainer.append('<div class="ujg-pa-empty">Данные не загружены. Укажите JQL фильтр и нажмите "Загрузить".</div>');
                return;
            }
            if (state.analyticsSummary) {
                var summary = state.analyticsSummary;
                var avgLead = summary.totalLeadSeconds / summary.issueCount;
                var avgCycle = summary.totalCycleSeconds / summary.issueCount;
                var avgWait = summary.totalWaitSeconds / summary.issueCount;
                var $summary = $('<div class="ujg-pa-summary"></div>');
                $summary.append('<div class="ujg-pa-summary-item"><span>Avg Lead Time</span><strong>' + formatDuration(avgLead) + '</strong></div>');
                $summary.append('<div class="ujg-pa-summary-item"><span>Avg Cycle Time</span><strong>' + formatDuration(avgCycle) + '</strong></div>');
                $summary.append('<div class="ujg-pa-summary-item"><span>Avg Wait Time</span><strong>' + formatDuration(avgWait) + '</strong></div>');
                $resultsContainer.append($summary);
            }
            
            var $table = $('<table class="ujg-pa-table"><thead><tr><th>Key</th><th>Summary</th><th>Lead</th><th>Cycle</th><th>Top Status</th><th>Risk</th></tr></thead><tbody></tbody></table>');
            var maxRows = Math.min(50, state.issues.length);
            for (var i = 0; i < maxRows; i++) {
                var issue = state.issues[i];
                var analytics = issue.analytics || {};
                var dominant = getDominantStatus(analytics);
                var $row = $("<tr></tr>");
                var issueUrl = baseUrl + "/browse/" + issue.key;
                $row.append('<td><a href="' + issueUrl + '" target="_blank">' + issue.key + "</a></td>");
                var summary = issue.fields && issue.fields.summary ? issue.fields.summary : "";
                $row.append('<td>' + escapeHtml(summary) + "</td>");
                $row.append('<td>' + formatDuration(analytics.leadTimeSeconds) + "</td>");
                $row.append('<td>' + formatDuration(analytics.cycleTimeSeconds) + "</td>");
                $row.append('<td>' + dominant.name + "</td>");
                var riskScore = analytics.risk ? analytics.risk.score + "%" : "—";
                $row.append("<td>" + riskScore + "</td>");
                $table.find("tbody").append($row);
            }
            if (state.issues.length > maxRows) {
                $resultsContainer.append('<div class="ujg-pa-note">Показаны первые ' + maxRows + " из " + state.issues.length + " задач</div>");
            }
            $resultsContainer.append($table);
            renderCategoryHeatmap($resultsContainer);
            renderRiskMatrixSection($resultsContainer);
            renderTeamMetricsSection($resultsContainer);
            renderVelocitySection($resultsContainer);
            renderDevCycleSection($resultsContainer);
            renderBottlenecksSection($resultsContainer);
            renderTrendPlaceholder($resultsContainer);
        }
        
        return {
            renderAnalyticsTable: renderAnalyticsTable,
            formatDuration: formatDuration
        };
    }
    
    return {
        createRenderer: createRenderer
    };
});
