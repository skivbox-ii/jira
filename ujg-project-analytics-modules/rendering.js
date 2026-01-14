// Функции рендеринга UI
define("_ujgPA_rendering", ["jquery", "_ujgCommon", "_ujgPA_utils", "_ujgPA_config", "_ujgPA_workflow"], function($, Common, utils, config, workflow) {
    "use strict";
    
    var baseUrl = Common.baseUrl || "";
    var STATUS_CATEGORIES = workflow.STATUS_CATEGORIES;
    var escapeHtml = utils.utils && utils.utils.escapeHtml ? utils.utils.escapeHtml : function(str) { return String(str || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;"); };
    
    function createRenderer(state) {
        var issueIndex = null; // { KEY: { summary, statusName, primaryCat } }
        var issueIndexRef = null;

        function getPrimaryCategoryForStatus(statusName) {
            if (!statusName) return "";
            var cats = workflow.getCategoriesForStatus(statusName, state.workflowConfig) || [];
            // стабильный порядок важен для читаемости и единых цветов
            var order = ["queue", "work", "review", "testing", "waiting", "done"];
            for (var i = 0; i < order.length; i++) {
                if (cats.indexOf(order[i]) >= 0) return order[i];
            }
            return "";
        }

        function ensureIssueIndex() {
            // state.issues пересоздаётся при каждой загрузке — используем ссылку как версию
            if (issueIndex && issueIndexRef === state.issues) return;
            issueIndexRef = state.issues;
            issueIndex = {};
            (state.issues || []).forEach(function(issue) {
                if (!issue || !issue.key) return;
                var summary = issue.fields && issue.fields.summary ? String(issue.fields.summary) : "";
                var statusName = issue.fields && issue.fields.status && issue.fields.status.name ? String(issue.fields.status.name) : "";
                var primaryCat = getPrimaryCategoryForStatus(statusName);
                issueIndex[issue.key] = { summary: summary, statusName: statusName, primaryCat: primaryCat };
            });
        }

        function formatIssueLabel(issueKey) {
            var key = issueKey ? String(issueKey) : "";
            if (!key) return "—";
            ensureIssueIndex();
            var summary = issueIndex[key] && issueIndex[key].summary ? String(issueIndex[key].summary) : "";
            return summary ? (key + " — " + summary) : key;
        }

        function renderIssueLink(issueKey) {
            var key = issueKey ? String(issueKey) : "";
            if (!key) return "—";
            ensureIssueIndex();
            var cat = issueIndex[key] && issueIndex[key].primaryCat ? issueIndex[key].primaryCat : "";
            var summary = issueIndex[key] && issueIndex[key].summary ? String(issueIndex[key].summary) : "";
            var issueUrl = baseUrl + "/browse/" + encodeURIComponent(key);
            var pillCls = "ujg-pa-pill ujg-pa-issue-key";
            if (cat) pillCls += " ujg-pa-cat-" + cat;
            var title = formatIssueLabel(key);
            var html = '<a class="ujg-pa-issue-link" href="' + issueUrl + '" target="_blank" title="' + escapeHtml(title) + '">';
            html += '<span class="' + pillCls + '">' + escapeHtml(key) + "</span>";
            if (summary) {
                html += '<span class="ujg-pa-issue-summary"> — ' + escapeHtml(summary) + "</span>";
            }
            html += "</a>";
            return html;
        }

        function renderStatusPill(statusName) {
            var name = (statusName || "").toString();
            if (!name) return '<span class="ujg-pa-pill ujg-pa-status-pill">—</span>';
            var cat = getPrimaryCategoryForStatus(name);
            var cls = "ujg-pa-pill ujg-pa-status-pill";
            if (cat) cls += " ujg-pa-cat-" + cat;
            return '<span class="' + cls + '">' + escapeHtml(name) + "</span>";
        }

        function renderStatusChain(path) {
            var p = (path || "").toString();
            if (!p) return "—";
            var parts = p.split("→").map(function(x) { return (x || "").trim(); }).filter(function(x) { return x.length > 0; });
            if (parts.length === 0) return escapeHtml(p);
            var out = [];
            parts.forEach(function(token, idx) {
                if (idx > 0) out.push('<span class="ujg-pa-chain-arrow">→</span>');
                if (token === "…") out.push('<span class="ujg-pa-chain-ellipsis">…</span>');
                else out.push(renderStatusPill(token));
            });
            return out.join(" ");
        }

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

        function formatDays(days) {
            if (days === null || days === undefined || isNaN(days)) return "—";
            return (Math.round(days * 10) / 10) + " дн.";
        }
        
        function formatRatio(r) {
            if (r === null || r === undefined || isNaN(r)) return "—";
            return (Math.round(r * 10) / 10).toFixed(1) + "x";
        }

        function renderDeveloperAnalyticsSection($parent) {
            var devsMap = state.developerAnalytics;
            if (!devsMap) return;

            var devs = Object.keys(devsMap).map(function(name) { return devsMap[name]; });
            // По спеку: показываем только разработчиков, у кого были коммиты за период
            devs = devs.filter(function(d) { return (d.totalCommits || 0) > 0; });
            if (devs.length === 0) return;

            devs.sort(function(a, b) { return (b.totalCommits || 0) - (a.totalCommits || 0); });

            var $section = $('<div class="ujg-pa-section"><h3>👨‍💻 Аналитика по разработчикам</h3></div>');
            $section.append('<div class="ujg-pa-note">Фильтр: показаны только разработчики, которые делали коммиты за период</div>');

            // Итоговая таблица (одной таблицей): ФИО, Коммиты, PR, Мержи, Задачи, Показатели, Качество
            var $summaryTable = $('<table class="ujg-pa-table"><thead><tr>' +
                '<th>ФИО</th>' +
                '<th>Коммитов</th>' +
                '<th>PR</th>' +
                '<th>Мержей</th>' +
                '<th>Задач</th>' +
                '<th>Закрыл</th>' +
                '<th>Часы (WL)</th>' +
                '<th>Взял→Коммит</th>' +
                '<th>Коммит/задачу</th>' +
                '<th>Коммит→Закрытие</th>' +
                '<th>Стабильно</th>' +
                '<th>Возврат</th>' +
                '<th>Коммит→Done</th>' +
                '<th>Коммит→Work</th>' +
                '</tr></thead><tbody></tbody></table>');

            devs.forEach(function(dev) {
                var s = dev.summary || {};
                var tasks = (s.issuesWithCommits !== undefined ? s.issuesWithCommits : s.totalIssues) || 0;
                var $row = $("<tr></tr>");
                $row.append("<td>" + escapeHtml(dev.name || "—") + "</td>");
                $row.append("<td>" + (dev.totalCommits || 0) + "</td>");
                $row.append("<td>" + (dev.totalPRs || 0) + "</td>");
                $row.append("<td>" + (dev.totalMerged || 0) + "</td>");
                $row.append("<td>" + tasks + "</td>");
                $row.append("<td>" + (s.closedIssuesInPeriod || 0) + "</td>");
                $row.append("<td>" + formatDuration(s.totalWorklogSeconds || 0) + "</td>");
                $row.append("<td>" + formatDays(s.avgDaysToFirstCommit) + "</td>");
                $row.append("<td>" + (s.avgCommitsPerIssue ? (Math.round(s.avgCommitsPerIssue * 10) / 10).toFixed(1) : "0.0") + "</td>");
                $row.append("<td>" + formatDays(s.avgDaysToClose) + "</td>");
                $row.append("<td>" + (s.stableClosed || 0) + "</td>");
                $row.append("<td>" + (s.returnedToWork || 0) + "</td>");
                $row.append("<td>" + (s.wentToDone || 0) + "</td>");
                $row.append("<td>" + (s.wentToWorkAfterCommit || 0) + "</td>");
                $summaryTable.find("tbody").append($row);
            });
            $section.append('<div style="margin:8px 0;"><strong>Итоги по разработчикам</strong></div>');
            $section.append($summaryTable);

            devs.forEach(function(dev) {
                var summary = dev.summary || {};
                var $card = $('<div class="ujg-pa-dev-card" style="border:1px solid #dfe1e6;border-radius:3px;padding:12px;margin:12px 0;background:#fff;"></div>');
                $card.append('<h4 style="margin:0 0 8px 0;">' + escapeHtml(dev.name || "—") + "</h4>");

                var totalIssuesInDev = summary.issuesWithCommits !== undefined ? summary.issuesWithCommits : (summary.totalIssues || 0);

                var $stats = $('<div class="ujg-pa-dev-stats"></div>');
                $stats.append('<p><strong>📊 Общая статистика:</strong> ' +
                    'Коммитов: <strong>' + (dev.totalCommits || 0) + '</strong> | ' +
                    'Pull Requests: <strong>' + (dev.totalPRs || 0) + '</strong> | ' +
                    'Мержей: <strong>' + (dev.totalMerged || 0) + '</strong> | ' +
                    'Закрыл (в периоде): <strong>' + (summary.closedIssuesInPeriod || 0) + '</strong> | ' +
                    'Списано (WL): <strong>' + formatDuration(summary.totalWorklogSeconds || 0) + '</strong> | ' +
                    'Задач со списанием: <strong>' + (summary.issuesWithWorklogs || 0) + '</strong> | ' +
                    'Задач в работе: <strong>' + (summary.tasksInWork || 0) + '</strong>' +
                    '</p>');

                $stats.append('<p><strong>⏱️ Средние показатели:</strong> ' +
                    'Взял → первый коммит: <strong>' + formatDays(summary.avgDaysToFirstCommit) + '</strong> | ' +
                    'Коммитов на задачу: <strong>' + (summary.avgCommitsPerIssue ? (Math.round(summary.avgCommitsPerIssue * 10) / 10).toFixed(1) : "0.0") + '</strong> | ' +
                    'Последний коммит → закрытие: <strong>' + formatDays(summary.avgDaysToClose) + '</strong>' +
                    '</p>');
                
                if ((summary.workAheadCount || 0) > 0) {
                    $stats.append('<p><strong>⚠️ Процесс:</strong> ' +
                        'Коммит до взятия задачи: <strong>' + (summary.workAheadCount || 0) + '</strong> ' +
                        '(в среднем <strong>' + formatDays(summary.avgWorkAheadDays) + '</strong>)</p>');
                }

                $stats.append('<p><strong>✅ Качество:</strong> ' +
                    'Стабильно закрыто: <strong>' + (summary.stableClosed || 0) + '</strong> | ' +
                    'Вернулось на доработку: <strong>' + (summary.returnedToWork || 0) + '</strong> | ' +
                    'После коммита → done: <strong>' + (summary.wentToDone || 0) + '</strong> | ' +
                    'После коммита → work: <strong>' + (summary.wentToWorkAfterCommit || 0) + '</strong>' +
                    '</p>');
                
                var good = summary.goodStories || {};
                var bad = summary.badStories || {};
                if (good || bad) {
                    $stats.append('<p><strong>📗 Хорошие истории:</strong> ' +
                        'В срок: <strong>' + (good.onTime || 0) + '</strong> | ' +
                        'Точная оценка: <strong>' + (good.accurateEstimate || 0) + '</strong> | ' +
                        'Чистое закрытие: <strong>' + (good.cleanClose || 0) + '</strong> | ' +
                        'В одном спринте: <strong>' + (good.oneSprint || 0) + '</strong>' +
                        '</p>');
                    $stats.append('<p><strong>📕 Проблемные:</strong> ' +
                        'Просрочено: <strong>' + (bad.overdue || 0) + '</strong> | ' +
                        'Переносы спринтов: <strong>' + (bad.sprintMoved || 0) + '</strong> | ' +
                        'Перерасход: <strong>' + (bad.overspent || 0) + '</strong> | ' +
                        'Зависшие: <strong>' + (bad.stale || 0) + '</strong> | ' +
                        'Ping-pong: <strong>' + (bad.pingPong || 0) + '</strong>' +
                        '</p>');
                }

                $card.append($stats);

                // Детали по задачам (только задачи с коммитами)
                var issues = Object.keys(dev.issues || {}).map(function(k) { return dev.issues[k]; })
                    .filter(function(issueData) { return issueData && issueData.commits && issueData.commits.length > 0; });

                if (issues.length > 0) {
                    issues.sort(function(a, b) {
                        var ad = a.metrics && a.metrics.daysToFirstCommit !== null ? a.metrics.daysToFirstCommit : 999999;
                        var bd = b.metrics && b.metrics.daysToFirstCommit !== null ? b.metrics.daysToFirstCommit : 999999;
                        return ad - bd;
                    });

                    var $table = $('<table class="ujg-pa-table"><thead><tr>' +
                        '<th>Задача</th>' +
                        '<th>Взял → Коммит</th>' +
                        '<th>Вперёд</th>' +
                        '<th>Комм</th>' +
                        '<th>WL</th>' +
                        '<th>Комм/день</th>' +
                        '<th>Закрыто</th>' +
                        '<th>Возврат</th>' +
                        '<th>Срок</th>' +
                        '<th>Спринты</th>' +
                        '<th>Оценка</th>' +
                        '<th>Stale</th>' +
                        '<th>PingPong</th>' +
                        '</tr></thead><tbody></tbody></table>');

                    issues.forEach(function(issueData) {
                        var m = issueData.metrics || {};
                        var issueKey = issueData.key || "—";
                        var $row = $("<tr></tr>");
                        $row.append("<td>" + renderIssueLink(issueKey) + "</td>");
                        $row.append("<td>" + (m.daysToFirstCommit !== null ? formatDays(m.daysToFirstCommit) : "—") + "</td>");
                        $row.append("<td>" + (m.workAheadDays ? formatDays(m.workAheadDays) : "—") + "</td>");
                        $row.append("<td>" + (m.commitCount || 0) + "</td>");
                        $row.append("<td>" + (m.worklogSeconds ? formatDuration(m.worklogSeconds) : "—") + "</td>");
                        $row.append("<td>" + (m.commitsPerDay ? "✓" : "—") + "</td>");
                        $row.append("<td>" + (m.resolvedInPeriod ? "✓" : "—") + "</td>");
                        $row.append("<td>" + ((m.returnedToWork || m.wentToWorkAfterCommit) ? "✓" : "—") + "</td>");
                        $row.append("<td>" + (m.dueDate ? (m.isOverdue ? ("⚠ " + (m.overdueDays || 0) + "д") : "✓") : "—") + "</td>");
                        $row.append("<td>" + (m.sprintChanges ? m.sprintChanges : "—") + "</td>");
                        $row.append("<td>" + (m.estimateAccuracy !== null ? formatRatio(m.estimateAccuracy) : "—") + "</td>");
                        $row.append("<td>" + (m.isStale ? "✓" : "—") + "</td>");
                        $row.append("<td>" + (m.isPingPong ? (m.returnCount || "✓") : "—") + "</td>");
                        $table.find("tbody").append($row);
                    });

                    $card.append('<div style="margin-top:8px;"><strong>📋 Детали по задачам:</strong></div>');
                    $card.append($table);
                } else {
                    $card.append('<div class="ujg-pa-note">Нет задач с коммитами за выбранный период.</div>');
                }

                $section.append($card);
            });

            $parent.append($section);
        }

        function renderTesterAnalyticsSection($parent) {
            var map = state.testerAnalytics;
            if (!map) return;
            var testers = Object.keys(map).map(function(k) { return map[k]; });
            if (!testers.length) return;

            testers.sort(function(a, b) {
                return (b.tested || 0) - (a.tested || 0);
            });

            var $section = $('<div class="ujg-pa-section"><h3>🧪 Аналитика по тестировщикам</h3></div>');
            $section.append('<div class="ujg-pa-note">Считается по переходам из категории testing (changelog.author). Учитываются только задачи с коммитами за период.</div>');

            var $table = $('<table class="ujg-pa-table"><thead><tr>' +
                '<th>QA</th>' +
                '<th>Задач</th>' +
                '<th>Пройдено</th>' +
                '<th>Возврат</th>' +
                '<th>Pass %</th>' +
                '<th>Avg время теста</th>' +
                '<th>Пропущено</th>' +
                '</tr></thead><tbody></tbody></table>');

            testers.forEach(function(t) {
                var passPct = t.tested ? Math.round((t.passed || 0) / t.tested * 100) : 0;
                var $row = $("<tr></tr>");
                $row.append("<td>" + escapeHtml(t.name || "—") + "</td>");
                $row.append("<td>" + (t.tested || 0) + "</td>");
                $row.append("<td>" + (t.passed || 0) + "</td>");
                $row.append("<td>" + (t.returned || 0) + "</td>");
                $row.append("<td>" + passPct + "%</td>");
                $row.append("<td>" + formatDuration(t.avgTestSeconds || 0) + "</td>");
                $row.append("<td>" + (t.escapedBugs || 0) + "</td>");
                $table.find("tbody").append($row);
            });

            $section.append($table);

            // Детали по топ QA
            testers.slice(0, 6).forEach(function(t) {
                var $card = $('<div class="ujg-pa-dev-card" style="border:1px solid #dfe1e6;border-radius:3px;padding:12px;margin:12px 0;background:#fff;"></div>');
                $card.append('<h4 style="margin:0 0 8px 0;">' + escapeHtml(t.name || "—") + "</h4>");
                var passPct = t.tested ? Math.round((t.passed || 0) / t.tested * 100) : 0;
                $card.append('<p style="margin:6px 0;">' +
                    'Задач: <strong>' + (t.tested || 0) + '</strong> | ' +
                    'Пройдено: <strong>' + (t.passed || 0) + '</strong> | ' +
                    'Возврат: <strong>' + (t.returned || 0) + '</strong> | ' +
                    'Pass: <strong>' + passPct + '%</strong> | ' +
                    'Avg тест: <strong>' + formatDuration(t.avgTestSeconds || 0) + '</strong> | ' +
                    'Пропущено: <strong>' + (t.escapedBugs || 0) + '</strong>' +
                    '</p>');

                // кому чаще возвращает
                var devs = Object.keys(t.byDeveloper || {}).map(function(name) {
                    var st = t.byDeveloper[name] || {};
                    return { name: name, tested: st.tested || 0, returned: st.returned || 0 };
                }).sort(function(a, b) { return b.returned - a.returned; });
                if (devs.length) {
                    var top = devs.slice(0, 5).map(function(d) {
                        return escapeHtml(d.name) + ": " + d.returned + "/" + d.tested;
                    }).join(", ");
                    $card.append('<div class="ujg-pa-note">Кому возвращает чаще: ' + top + "</div>");
                }

                var details = (t.issues || []).slice(0, 12);
                if (details.length) {
                    var $dt = $('<table class="ujg-pa-table"><thead><tr>' +
                        '<th>Задача</th><th>Из</th><th>В</th><th>Время</th><th>Dev</th>' +
                        '</tr></thead><tbody></tbody></table>');
                    details.forEach(function(it) {
                        var $r = $("<tr></tr>");
                        $r.append("<td>" + renderIssueLink(it.key) + "</td>");
                        $r.append("<td>" + renderStatusPill(it.from) + "</td>");
                        $r.append("<td>" + renderStatusPill(it.to) + "</td>");
                        $r.append("<td>" + formatDuration(it.testSeconds || 0) + "</td>");
                        $r.append("<td>" + escapeHtml(it.developer || "—") + "</td>");
                        $dt.find("tbody").append($r);
                    });
                    $card.append($dt);
                }

                $section.append($card);
            });

            $parent.append($section);
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
            var $table = $('<table class="ujg-pa-table"><thead><tr><th>Задача</th><th>Risk</th><th>Факторы</th></tr></thead><tbody></tbody></table>');
            issues.forEach(function(issue) {
                var risk = issue.analytics.risk;
                var factors = (risk.factors || []).map(function(f) { return f.message; }).join(", ");
                var $row = $("<tr></tr>");
                $row.append("<td>" + renderIssueLink(issue.key) + "</td>");
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

            // Статистика ревью: кто сколько аппрувил / кто сколько раз отправлял на доработку
            if (devSummary.reviewerDecisionStats && Object.keys(devSummary.reviewerDecisionStats).length > 0) {
                var $reviewTableWrap = $('<div class="ujg-pa-reviewers-section"><h4>Результаты ревью (Approve / Needs work)</h4></div>');
                var rows = Object.keys(devSummary.reviewerDecisionStats).map(function(name) {
                    var st = devSummary.reviewerDecisionStats[name] || {};
                    return {
                        name: name,
                        approved: st.approved || 0,
                        needsWork: st.needsWork || 0,
                        reviewed: st.reviewed || 0
                    };
                }).sort(function(a, b) {
                    return (b.approved + b.needsWork + b.reviewed) - (a.approved + a.needsWork + a.reviewed);
                });
                var $tbl = $('<table class="ujg-pa-table"><thead><tr><th>Ревьюер</th><th>Approve</th><th>Needs work</th><th>Other</th></tr></thead><tbody></tbody></table>');
                rows.forEach(function(r) {
                    var $row = $("<tr></tr>");
                    $row.append("<td>" + escapeHtml(r.name) + "</td>");
                    $row.append("<td>" + r.approved + "</td>");
                    $row.append("<td>" + r.needsWork + "</td>");
                    $row.append("<td>" + r.reviewed + "</td>");
                    $tbl.find("tbody").append($row);
                });
                $reviewTableWrap.append($tbl);
                $section.append($reviewTableWrap);
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

            // Кому отправляли на доработку (по авторам PR)
            if (devSummary.authorRework && Object.keys(devSummary.authorRework).length > 0) {
                var $rework = $('<div class="ujg-pa-authors-section"><h4>Отправлено на доработку (Needs work) по авторам PR</h4></div>');
                var authors = Object.keys(devSummary.authorRework).map(function(name) {
                    var st = devSummary.authorRework[name] || { needsWorkPrs: 0, totalPrs: 0 };
                    var rate = st.totalPrs ? st.needsWorkPrs / st.totalPrs : 0;
                    return { name: name, needsWork: st.needsWorkPrs || 0, total: st.totalPrs || 0, rate: rate };
                }).sort(function(a, b) { return b.needsWork - a.needsWork; });
                var $tbl = $('<table class="ujg-pa-table"><thead><tr><th>Автор</th><th>Needs work</th><th>Всего PR</th><th>%</th></tr></thead><tbody></tbody></table>');
                authors.forEach(function(a) {
                    var $row = $("<tr></tr>");
                    $row.append("<td>" + escapeHtml(a.name) + "</td>");
                    $row.append("<td>" + a.needsWork + "</td>");
                    $row.append("<td>" + a.total + "</td>");
                    $row.append("<td>" + Math.round(a.rate * 100) + "%</td>");
                    $tbl.find("tbody").append($row);
                });
                $rework.append($tbl);
                $section.append($rework);
            }
            
            if (devSummary.pingPongIssues && devSummary.pingPongIssues.length > 0) {
                var $pingPong = $('<div class="ujg-pa-pingpong-section"><h4>Задачи с множественными возвратами (>2 iterations)</h4></div>');
                var $table = $('<table class="ujg-pa-table"><thead><tr><th>Задача</th><th>PR</th><th>Iterations</th><th>Автор</th></tr></thead><tbody></tbody></table>');
                devSummary.pingPongIssues.slice(0, 10).forEach(function(item) {
                    var $row = $("<tr></tr>");
                    $row.append("<td>" + renderIssueLink(item.key) + "</td>");
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
            function listItemsHtml(label, items, formatter) {
                if (!items || items.length === 0) return;
                var $block = $('<div class="ujg-pa-bottleneck-block"><strong>' + label + ":</strong></div>");
                var $list = $("<ul></ul>");
                items.slice(0, 5).forEach(function(item) {
                    var html = formatter(item);
                    $list.append("<li>" + html + "</li>");
                });
                $block.append($list);
                $section.append($block);
            }
            listItemsHtml("Долгое ревью", state.bottlenecks.longReview, function(item) {
                return renderIssueLink(item.key) + " (" + escapeHtml(formatDuration(item.seconds)) + ")";
            });
            listItemsHtml("Долгое тестирование", state.bottlenecks.longTesting, function(item) {
                return renderIssueLink(item.key) + " (" + escapeHtml(formatDuration(item.seconds)) + ")";
            });
            listItemsHtml("Путешествующие задачи", state.bottlenecks.travellers, function(item) {
                return renderIssueLink(item.key) + " (" + escapeHtml(String(item.changes || 0)) + " спринтов)";
            });
            listItemsHtml("Старые задачи", state.bottlenecks.stale, function(item) {
                return renderIssueLink(item.key) + " (" + escapeHtml(String(item.days || 0)) + " дн. без активности)";
            });
            listItemsHtml("WIP перегруз", state.bottlenecks.wipOverload, function(item) {
                return escapeHtml(item.assignee) + ": " + escapeHtml(String(item.count || 0)) + " задач";
            });
            $parent.append($section);
        }
        
        function renderTrendPlaceholder($parent) {
            var $section = $('<div class="ujg-pa-section ujg-pa-placeholder"></div>');
            $section.append("<h3>Тренды</h3>");
            $section.append("<p>Исторические данные появятся после нескольких запусков виджета. Они будут сохранены локально для расчёта графиков.</p>");
            $parent.append($section);
        }

        function renderStatusTransitionMatrix($parent) {
            var summary = state.analyticsSummary;
            if (!summary || !summary.transitionsSummary) return;
            var ts = summary.transitionsSummary;
            if (!ts.transitions) return;

            var statuses = ts.statuses || [];
            if (statuses.length === 0) return;

            // Ограничим размеры таблицы, чтобы UI не умер
            var MAX = 18;
            if (statuses.length > MAX) {
                statuses = statuses.slice(0, MAX);
            }

            var $section = $('<div class="ujg-pa-section"><h3>Переходы статусов (из → в)</h3></div>');
            $section.append('<div class="ujg-pa-note">Счётчики переходов взяты из changelog задач за выбранный период (возможны ограничения Jira по истории).</div>');

            var $table = $('<table class="ujg-pa-table"><thead><tr><th>Из \\ В</th></tr></thead><tbody></tbody></table>');
            statuses.forEach(function(to) {
                $table.find("thead tr").append("<th>" + renderStatusPill(to) + "</th>");
            });

            statuses.forEach(function(from) {
                var $row = $("<tr></tr>");
                $row.append("<td><strong>" + renderStatusPill(from) + "</strong></td>");
                statuses.forEach(function(to) {
                    var cnt = (ts.transitions[from] && ts.transitions[from][to]) ? ts.transitions[from][to] : 0;
                    $row.append("<td>" + (cnt ? cnt : "—") + "</td>");
                });
                $table.find("tbody").append($row);
            });

            $section.append($table);
            $parent.append($section);
        }

        function renderTopTransitionPaths($parent) {
            var summary = state.analyticsSummary;
            if (!summary || !summary.transitionsSummary) return;
            var ts = summary.transitionsSummary;
            var top = ts.topPaths || [];
            // По просьбе: показываем только цепочки по исходным статусам Jira

            var $section = $('<div class="ujg-pa-section"><h3>Типовые цепочки переходов</h3></div>');
            $section.append('<div class="ujg-pa-note">Показаны цепочки по исходным статусам Jira (без вычисленных категорий). Повторы подряд сжимаются.</div>');

            var topS = ts.topStatusPaths || [];
            if (!topS || topS.length === 0) return;

            var topStatus = topS.slice(0, 12);
            var totalStatus = 0;
            topStatus.forEach(function(item) { totalStatus += (item.count || 0); });
            if (!totalStatus) totalStatus = 0;
            var $tableS = $('<table class="ujg-pa-table"><thead><tr><th>Цепочка</th><th>Кол-во задач</th><th>%</th><th>Пример</th></tr></thead><tbody></tbody></table>');
            topStatus.forEach(function(item) {
                var $row = $("<tr></tr>");
                $row.append("<td>" + renderStatusChain(item.path) + "</td>");
                $row.append("<td>" + (item.count || 0) + "</td>");
                var pctS = totalStatus ? (((item.count || 0) / totalStatus) * 100) : 0;
                $row.append("<td>" + (Math.round(pctS * 10) / 10).toFixed(1) + "%</td>");
                if (item.example) {
                    $row.append("<td>" + renderIssueLink(item.example) + "</td>");
                } else {
                    $row.append("<td>—</td>");
                }
                $tableS.find("tbody").append($row);
            });
            $section.append($tableS);
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

            // По просьбе: общий список задач (таблица Key/Summary/Lead/Cycle/...) не выводим
            renderCategoryHeatmap($resultsContainer);
            renderRiskMatrixSection($resultsContainer);
            renderTeamMetricsSection($resultsContainer);
            renderVelocitySection($resultsContainer);
            renderDevCycleSection($resultsContainer);
            renderDeveloperAnalyticsSection($resultsContainer);
            renderTesterAnalyticsSection($resultsContainer);
            renderBottlenecksSection($resultsContainer);
            renderTopTransitionPaths($resultsContainer);
            renderStatusTransitionMatrix($resultsContainer);
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
