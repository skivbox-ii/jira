/**
 * UJG Sprint Health — Виджет оценки качества планирования спринта
 * Версия: 1.1.0
 * Автономный модуль без внешних зависимостей (кроме jQuery)
 */
define("_ujgSprintHealth", ["jquery"], function($) {
    "use strict";

    var CONFIG = {
        version: "1.1.0",
        debug: true,
        maxHours: 16,
        capacityPerPerson: 40,
        workHoursPerDay: 8
    };

    var STORAGE_KEY = "ujg_sprint_health_settings";
    var baseUrl = (typeof AJS !== "undefined" && AJS.contextPath) ? AJS.contextPath() : "";

    // ==================== УТИЛИТЫ ====================
    var utils = {
        escapeHtml: function(t) {
            if (!t) return "";
            var d = document.createElement("div");
            d.textContent = String(t);
            return d.innerHTML;
        },
        formatHours: function(seconds) {
            if (!seconds || seconds <= 0) return "—";
            var h = Math.floor(seconds / 3600);
            var m = Math.floor((seconds % 3600) / 60);
            if (h > 0 && m > 0) return h + "ч" + m + "м";
            return h > 0 ? h + "ч" : (m > 0 ? m + "м" : "—");
        },
        formatHoursShort: function(seconds) {
            if (!seconds || seconds <= 0) return "0";
            return Math.round(seconds / 3600) + "ч";
        },
        parseDate: function(v) {
            if (!v) return null;
            if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
            if (typeof v === "number") { var d = new Date(v); return isNaN(d.getTime()) ? null : d; }
            if (typeof v === "string") { var d = new Date(v); if (!isNaN(d.getTime())) return d; }
            return null;
        },
        formatDateShort: function(d) {
            if (!d || !(d instanceof Date) || isNaN(d.getTime())) return "—";
            var dd = d.getDate(), mm = d.getMonth() + 1;
            return (dd < 10 ? "0" : "") + dd + "." + (mm < 10 ? "0" : "") + mm;
        },
        getDayKey: function(d) {
            if (!d || !(d instanceof Date) || isNaN(d.getTime())) return "";
            var yyyy = d.getFullYear(), mm = d.getMonth() + 1, dd = d.getDate();
            return yyyy + "-" + (mm < 10 ? "0" : "") + mm + "-" + (dd < 10 ? "0" : "") + dd;
        },
        daysBetween: function(start, end) {
            var res = [];
            if (!start || !end) return res;
            var cur = new Date(start); cur.setHours(0, 0, 0, 0);
            var ed = new Date(end); ed.setHours(0, 0, 0, 0);
            while (cur <= ed) {
                var dow = cur.getDay();
                if (dow !== 0 && dow !== 6) res.push(new Date(cur));
                cur.setDate(cur.getDate() + 1);
            }
            return res;
        },
        getHealthColor: function(percent) {
            if (percent >= 90) return "#36b37e";
            if (percent >= 70) return "#ffab00";
            if (percent >= 50) return "#ff8b00";
            return "#de350b";
        },
        getHealthLabel: function(percent) {
            if (percent >= 90) return "Отлично";
            if (percent >= 70) return "Хорошо";
            if (percent >= 50) return "Внимание";
            return "Критично";
        }
    };

    function loadSettings() {
        try { var s = localStorage.getItem(STORAGE_KEY); if (s) return JSON.parse(s); } catch (e) {}
        return {};
    }
    function saveSettings(settings) {
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); } catch (e) {}
    }

    // ==================== API ====================
    var api = {
        getBoards: function() {
            return $.ajax({ url: baseUrl + "/rest/agile/1.0/board", type: "GET", data: { maxResults: 100 } });
        },
        getSprints: function(boardId) {
            return $.ajax({ url: baseUrl + "/rest/agile/1.0/board/" + boardId + "/sprint", type: "GET", data: { state: "active,future,closed", maxResults: 100 } });
        },
        getSprint: function(sprintId) {
            return $.ajax({ url: baseUrl + "/rest/agile/1.0/sprint/" + sprintId, type: "GET" });
        },
        getSprintIssues: function(sprintId) {
            return $.ajax({
                url: baseUrl + "/rest/agile/1.0/sprint/" + sprintId + "/issue",
                type: "GET",
                data: { fields: "summary,status,assignee,priority,issuetype,timeoriginalestimate,timetracking,duedate,created,description,resolutiondate", maxResults: 500 }
            });
        }
    };

    // ==================== ВИДЖЕТ ====================
    function SprintHealthGadget(API) {
        var state = {
            boards: [], sprints: [], filteredSprints: [],
            selectedBoardId: null, selectedSprintId: null,
            sprint: null, issues: [], loading: false, isFullscreen: false,
            burndownMode: "hours",
            metrics: { totalIssues: 0, totalHours: 0, estimatedCount: 0, estimatedPercent: 0, withDatesCount: 0, withDatesPercent: 0, assignedCount: 0, assignedPercent: 0, overallHealth: 0 },
            burndownData: [], burnupData: [], byAssignee: {}
        };

        var $content = API.getGadgetContentEl();
        var $cont = $content.find(".ujg-sprint-health");
        if ($cont.length === 0) { $cont = $('<div class="ujg-sprint-health"></div>'); $content.append($cont); }

        var $boardSelect, $sprintInput, $sprintDropdown, $refreshBtn, $fsBtn;

        function log(msg) { if (CONFIG.debug) console.log("[UJG-SprintHealth]", msg); }

        // ==================== FULLSCREEN ====================
        function toggleFullscreen() {
            var $el = $content.closest(".dashboard-item-content, .gadget, .ujg-gadget-wrapper");
            if ($el.length === 0) $el = $content;
            state.isFullscreen = !state.isFullscreen;
            if (state.isFullscreen) {
                $el.data("ujg-style", $el.attr("style") || "");
                $el.addClass("ujg-fullscreen");
                $fsBtn.text("✕");
            } else {
                $el.removeClass("ujg-fullscreen").attr("style", $el.data("ujg-style"));
                $fsBtn.text("⛶");
            }
            API.resize();
        }

        // ==================== ЗАГРУЗКА ====================
        function loadBoards() {
            api.getBoards().then(function(data) {
                state.boards = (data && data.values) || [];
                updateBoardSelect();
                var saved = loadSettings();
                if (saved.boardId && state.boards.some(function(b) { return b.id == saved.boardId; })) {
                    $boardSelect.val(saved.boardId);
                    state.selectedBoardId = saved.boardId;
                    loadSprints(saved.boardId);
                }
            }, function(err) {
                $cont.html('<div class="ujg-msg ujg-error">Ошибка загрузки досок</div>');
            });
        }

        function loadSprints(boardId) {
            if (!boardId) return;
            state.selectedBoardId = boardId;
            api.getSprints(boardId).then(function(data) {
                state.sprints = (data && data.values) || [];
                // Сортировка по ID убывание (новые сверху)
                state.sprints.sort(function(a, b) { return b.id - a.id; });
                state.filteredSprints = state.sprints.slice();
                updateSprintDropdown();
                
                var saved = loadSettings();
                var activeSprint = state.sprints.find(function(s) { return s.state === "active"; });
                
                if (saved.sprintId && state.sprints.some(function(s) { return s.id == saved.sprintId; })) {
                    selectSprint(saved.sprintId);
                } else if (activeSprint) {
                    selectSprint(activeSprint.id);
                } else if (state.sprints.length > 0) {
                    selectSprint(state.sprints[0].id);
                }
            });
        }

        function selectSprint(sprintId) {
            var sprint = state.sprints.find(function(s) { return s.id == sprintId; });
            if (!sprint) return;
            state.selectedSprintId = sprintId;
            $sprintInput.val(sprint.name);
            hideSprintDropdown();
            loadSprintData(sprintId);
        }

        function loadSprintData(sprintId) {
            if (!sprintId) return;
            state.selectedSprintId = sprintId;
            state.loading = true;
            saveSettings({ boardId: state.selectedBoardId, sprintId: sprintId });
            showLoading();
            
            $.when(api.getSprint(sprintId), api.getSprintIssues(sprintId)).then(function(sprintResp, issuesResp) {
                state.sprint = sprintResp[0] || sprintResp;
                var issuesData = issuesResp[0] || issuesResp;
                state.issues = (issuesData && issuesData.issues) || [];
                calculateMetrics();
                calculateBurndown();
                groupByAssignee();
                render();
                state.loading = false;
            }, function() {
                state.loading = false;
                $cont.html('<div class="ujg-msg ujg-error">Ошибка загрузки спринта</div>');
            });
        }

        // ==================== МЕТРИКИ ====================
        function calculateMetrics() {
            var issues = state.issues, m = state.metrics;
            m.totalIssues = issues.length;
            m.totalHours = m.estimatedCount = m.withDatesCount = m.assignedCount = m.withDescriptionCount = m.doneCount = m.bigTasksCount = m.overdueCount = 0;
            var now = new Date();
            
            issues.forEach(function(issue) {
                var f = issue.fields || {};
                var estimate = (f.timetracking && f.timetracking.originalEstimateSeconds) || f.timeoriginalestimate || 0;
                if (estimate > 0) {
                    m.estimatedCount++;
                    m.totalHours += estimate;
                    if (estimate > CONFIG.maxHours * 3600) m.bigTasksCount++;
                }
                if (f.duedate) {
                    m.withDatesCount++;
                    var dueDate = utils.parseDate(f.duedate);
                    if (dueDate && dueDate < now && !isIssueDone(f.status)) m.overdueCount++;
                }
                if (f.assignee) m.assignedCount++;
                if (f.description && f.description.trim()) m.withDescriptionCount++;
                if (isIssueDone(f.status)) m.doneCount++;
            });
            
            m.estimatedPercent = m.totalIssues > 0 ? Math.round((m.estimatedCount / m.totalIssues) * 100) : 0;
            m.withDatesPercent = m.totalIssues > 0 ? Math.round((m.withDatesCount / m.totalIssues) * 100) : 0;
            m.assignedPercent = m.totalIssues > 0 ? Math.round((m.assignedCount / m.totalIssues) * 100) : 0;
            m.withDescriptionPercent = m.totalIssues > 0 ? Math.round((m.withDescriptionCount / m.totalIssues) * 100) : 0;
            m.donePercent = m.totalIssues > 0 ? Math.round((m.doneCount / m.totalIssues) * 100) : 0;
            m.overallHealth = Math.round((m.estimatedPercent + m.withDatesPercent + m.assignedPercent + m.withDescriptionPercent) / 4);
        }
        
        function isIssueDone(status) {
            if (!status) return false;
            var name = (status.name || "").toLowerCase();
            return ["done", "closed", "resolved", "готово", "закрыт", "завершён", "выполнено"].some(function(s) { return name.indexOf(s) >= 0; });
        }

        // ==================== BURNDOWN ====================
        function calculateBurndown() {
            var sprint = state.sprint;
            if (!sprint || !sprint.startDate || !sprint.endDate) { state.burndownData = []; state.burnupData = []; return; }
            
            var startDate = utils.parseDate(sprint.startDate), endDate = utils.parseDate(sprint.endDate);
            if (!startDate || !endDate) return;
            
            var days = utils.daysBetween(startDate, endDate);
            var totalHours = state.metrics.totalHours, totalTasks = state.metrics.totalIssues;
            var hoursPerDay = totalHours / (days.length || 1), tasksPerDay = totalTasks / (days.length || 1);
            var burndownData = [], burnupData = [], now = new Date();
            
            days.forEach(function(day, idx) {
                var dayKey = utils.getDayKey(day), isPast = day <= now;
                var idealHoursRemaining = totalHours - (hoursPerDay * (idx + 1));
                var idealTasksRemaining = totalTasks - (tasksPerDay * (idx + 1));
                var actualHoursDone = 0, actualTasksDone = 0;
                
                if (isPast) {
                    state.issues.forEach(function(issue) {
                        var f = issue.fields || {};
                        var resDate = utils.parseDate(f.resolutiondate);
                        if (resDate && resDate <= day && isIssueDone(f.status)) {
                            actualTasksDone++;
                            actualHoursDone += (f.timetracking && f.timetracking.originalEstimateSeconds) || f.timeoriginalestimate || 0;
                        }
                    });
                }
                
                burndownData.push({
                    date: day, label: utils.formatDateShort(day),
                    idealHours: Math.max(0, idealHoursRemaining), idealTasks: Math.max(0, Math.round(idealTasksRemaining)),
                    actualHours: isPast ? (totalHours - actualHoursDone) : null, actualTasks: isPast ? (totalTasks - actualTasksDone) : null
                });
                burnupData.push({
                    date: day, label: utils.formatDateShort(day),
                    scope: totalHours, scopeTasks: totalTasks,
                    doneHours: isPast ? actualHoursDone : null, doneTasks: isPast ? actualTasksDone : null
                });
            });
            state.burndownData = burndownData;
            state.burnupData = burnupData;
        }

        // ==================== ГРУППИРОВКА ====================
        function groupByAssignee() {
            var byAssignee = {};
            var unassigned = { id: "__unassigned__", name: "Не назначено", issues: [], totalHours: 0 };
            
            state.issues.forEach(function(issue) {
                var f = issue.fields || {};
                var estimate = (f.timetracking && f.timetracking.originalEstimateSeconds) || f.timeoriginalestimate || 0;
                var issueData = {
                    key: issue.key, summary: f.summary || "", status: f.status ? f.status.name : "",
                    statusCategory: f.status && f.status.statusCategory ? f.status.statusCategory.key : "",
                    priority: f.priority ? f.priority.name : "", type: f.issuetype ? f.issuetype.name : "",
                    estimate: estimate, dueDate: utils.parseDate(f.duedate), startDate: null, created: utils.parseDate(f.created),
                    isDone: isIssueDone(f.status)
                };
                
                if (f.assignee) {
                    var aid = f.assignee.accountId || f.assignee.key || f.assignee.name;
                    if (!byAssignee[aid]) byAssignee[aid] = { id: aid, name: f.assignee.displayName || f.assignee.name || aid, issues: [], totalHours: 0 };
                    byAssignee[aid].issues.push(issueData);
                    byAssignee[aid].totalHours += estimate;
                } else {
                    unassigned.issues.push(issueData);
                    unassigned.totalHours += estimate;
                }
            });
            
            var sorted = Object.values(byAssignee).sort(function(a, b) { return a.name.localeCompare(b.name); });
            if (unassigned.issues.length > 0) sorted.push(unassigned);
            state.byAssignee = sorted;
        }

        // ==================== РЕНДЕРИНГ ====================
        function showLoading() { $cont.html('<div class="ujg-msg">⏳ Загрузка...</div>'); }
        
        function updateBoardSelect() {
            $boardSelect.empty().append('<option value="">— Доска —</option>');
            state.boards.forEach(function(b) { $boardSelect.append('<option value="' + b.id + '">' + utils.escapeHtml(b.name) + '</option>'); });
        }

        function updateSprintDropdown() {
            var html = '';
            state.filteredSprints.forEach(function(s) {
                var icon = s.state === "active" ? "●" : (s.state === "future" ? "○" : "✓");
                var cls = s.state === "active" ? "ujg-sprint-active" : "";
                html += '<div class="ujg-sprint-option ' + cls + '" data-id="' + s.id + '">' + icon + ' ' + utils.escapeHtml(s.name) + '</div>';
            });
            $sprintDropdown.html(html || '<div class="ujg-sprint-empty">Спринты не найдены</div>');
        }

        function filterSprints(query) {
            var q = query.toLowerCase();
            state.filteredSprints = state.sprints.filter(function(s) {
                return s.name.toLowerCase().indexOf(q) >= 0;
            });
            updateSprintDropdown();
        }

        function showSprintDropdown() { $sprintDropdown.addClass("ujg-show"); }
        function hideSprintDropdown() { $sprintDropdown.removeClass("ujg-show"); }

        function render() {
            if (state.issues.length === 0) {
                $cont.html('<div class="ujg-msg">В спринте нет задач</div>');
                API.resize();
                return;
            }
            var html = renderHealthScore() + renderMetrics() + renderCharts() + renderProblems() + renderAssignees() + renderTable();
            $cont.html(html);
            bindEvents();
            API.resize();
        }

        function renderHealthScore() {
            var m = state.metrics, color = utils.getHealthColor(m.overallHealth);
            return '<div class="ujg-health"><div class="ujg-health-bar"><div class="ujg-health-fill" style="width:' + m.overallHealth + '%;background:' + color + '"></div></div>' +
                '<span class="ujg-health-pct" style="color:' + color + '">' + m.overallHealth + '%</span><span class="ujg-health-lbl">' + utils.getHealthLabel(m.overallHealth) + '</span></div>';
        }

        function renderMetrics() {
            var m = state.metrics;
            return '<div class="ujg-metrics">' +
                renderMetricCard("📊", "Объём", utils.formatHours(m.totalHours), m.totalIssues + " зад.", null) +
                renderMetricCard("📝", "Оценки", m.estimatedPercent + "%", m.estimatedCount + "/" + m.totalIssues, utils.getHealthColor(m.estimatedPercent)) +
                renderMetricCard("📅", "Сроки", m.withDatesPercent + "%", m.withDatesCount + "/" + m.totalIssues, utils.getHealthColor(m.withDatesPercent)) +
                renderMetricCard("👤", "Исполн.", m.assignedPercent + "%", m.assignedCount + "/" + m.totalIssues, utils.getHealthColor(m.assignedPercent)) +
                renderMetricCard("✅", "Готово", m.donePercent + "%", m.doneCount + "/" + m.totalIssues, utils.getHealthColor(m.donePercent)) +
            '</div>';
        }

        function renderMetricCard(icon, title, value, sub, color) {
            return '<div class="ujg-metric" style="border-color:' + (color || "#dfe1e6") + '">' +
                '<div class="ujg-metric-icon">' + icon + '</div>' +
                '<div class="ujg-metric-body"><div class="ujg-metric-title">' + title + '</div>' +
                '<div class="ujg-metric-val">' + value + '</div><div class="ujg-metric-sub">' + sub + '</div></div></div>';
        }

        function renderCharts() {
            var bd = state.burndownData, bu = state.burnupData;
            if (!bd || bd.length === 0) return '';
            
            var isHours = state.burndownMode === "hours";
            var maxVal = isHours ? state.metrics.totalHours : state.metrics.totalIssues;
            var h = 120, w = Math.max(bd.length * 35, 300);
            
            var html = '<div class="ujg-charts">';
            
            // Burndown
            html += '<div class="ujg-chart"><div class="ujg-chart-hdr"><span>Burndown</span><div class="ujg-toggle">' +
                '<span class="ujg-tog ' + (isHours ? "on" : "") + '" data-mode="hours">Ч</span>' +
                '<span class="ujg-tog ' + (!isHours ? "on" : "") + '" data-mode="tasks">З</span></div></div>';
            html += '<div class="ujg-chart-body"><svg width="' + w + '" height="' + h + '">';
            
            var cw = w - 30, ch = h - 25, sx = 25;
            var idealPts = [], actualPts = [];
            bd.forEach(function(d, i) {
                var x = sx + i * (cw / (bd.length - 1 || 1));
                var idealV = isHours ? d.idealHours : d.idealTasks;
                var actualV = isHours ? d.actualHours : d.actualTasks;
                var yI = 5 + ch * (1 - idealV / maxVal);
                idealPts.push(x + "," + yI);
                if (actualV !== null) {
                    var yA = 5 + ch * (1 - actualV / maxVal);
                    actualPts.push(x + "," + yA);
                }
            });
            html += '<polyline points="' + idealPts.join(" ") + '" fill="none" stroke="#8993a4" stroke-width="1.5" stroke-dasharray="4,3"/>';
            if (actualPts.length > 0) {
                html += '<polyline points="' + actualPts.join(" ") + '" fill="none" stroke="#0052cc" stroke-width="2"/>';
                actualPts.forEach(function(p) { var c = p.split(","); html += '<circle cx="' + c[0] + '" cy="' + c[1] + '" r="3" fill="#0052cc"/>'; });
            }
            bd.forEach(function(d, i) {
                if (i % 2 === 0 || bd.length < 8) {
                    var x = sx + i * (cw / (bd.length - 1 || 1));
                    html += '<text x="' + x + '" y="' + (h - 3) + '" text-anchor="middle" font-size="9" fill="#6b778c">' + d.label + '</text>';
                }
            });
            html += '</svg></div></div>';
            
            // Burnup
            html += '<div class="ujg-chart"><div class="ujg-chart-hdr"><span>Burnup</span></div>';
            html += '<div class="ujg-chart-body"><svg width="' + w + '" height="' + h + '">';
            html += '<line x1="' + sx + '" y1="5" x2="' + (w - 5) + '" y2="5" stroke="#36b37e" stroke-width="2"/>';
            var donePts = [];
            bu.forEach(function(d, i) {
                var x = sx + i * (cw / (bu.length - 1 || 1));
                var doneV = isHours ? d.doneHours : d.doneTasks;
                if (doneV !== null) {
                    var y = 5 + ch * (1 - doneV / maxVal);
                    donePts.push(x + "," + y);
                }
            });
            if (donePts.length > 0) {
                html += '<polyline points="' + donePts.join(" ") + '" fill="none" stroke="#0052cc" stroke-width="2"/>';
                donePts.forEach(function(p) { var c = p.split(","); html += '<circle cx="' + c[0] + '" cy="' + c[1] + '" r="3" fill="#0052cc"/>'; });
            }
            bu.forEach(function(d, i) {
                if (i % 2 === 0 || bu.length < 8) {
                    var x = sx + i * (cw / (bu.length - 1 || 1));
                    html += '<text x="' + x + '" y="' + (h - 3) + '" text-anchor="middle" font-size="9" fill="#6b778c">' + d.label + '</text>';
                }
            });
            html += '</svg></div></div>';
            
            html += '</div>';
            return html;
        }

        function renderProblems() {
            var problems = [], m = state.metrics;
            
            state.issues.forEach(function(i) {
                var f = i.fields || {};
                var est = (f.timetracking && f.timetracking.originalEstimateSeconds) || f.timeoriginalestimate || 0;
                if (!est) problems.push({ t: "w", txt: i.key + ": нет оценки", k: i.key });
                if (!f.assignee) problems.push({ t: "w", txt: i.key + ": нет исполнителя", k: i.key });
                if (est > CONFIG.maxHours * 3600) problems.push({ t: "e", txt: i.key + ": " + utils.formatHours(est) + " (большая)", k: i.key });
                if (f.duedate) {
                    var due = utils.parseDate(f.duedate);
                    if (due && due < new Date() && !isIssueDone(f.status)) problems.push({ t: "e", txt: i.key + ": просрочено", k: i.key });
                }
            });
            
            if (problems.length === 0) return '<div class="ujg-ok">✅ Проблем нет</div>';
            
            var html = '<div class="ujg-problems"><div class="ujg-section-title">⚠️ Проблемы (' + Math.min(problems.length, 10) + ')</div>';
            problems.slice(0, 10).forEach(function(p) {
                html += '<a href="' + baseUrl + '/browse/' + p.k + '" target="_blank" class="ujg-prob ujg-prob-' + p.t + '">' + utils.escapeHtml(p.txt) + '</a>';
            });
            return html + '</div>';
        }

        function renderAssignees() {
            var data = state.byAssignee;
            if (!data || data.length === 0) return '';
            var maxH = Math.max.apply(null, data.map(function(a) { return a.totalHours; })) || 1;
            
            var html = '<div class="ujg-assignees"><div class="ujg-section-title">👥 Распределение</div>';
            data.forEach(function(a) {
                var pct = Math.round((a.totalHours / maxH) * 100);
                var over = a.totalHours > CONFIG.capacityPerPerson * 3600;
                html += '<div class="ujg-asgn-row"><span class="ujg-asgn-name">' + utils.escapeHtml(a.name) + '</span>' +
                    '<div class="ujg-asgn-bar"><div class="ujg-asgn-fill' + (over ? " ujg-over" : "") + '" style="width:' + pct + '%"></div></div>' +
                    '<span class="ujg-asgn-val">' + utils.formatHours(a.totalHours) + '</span></div>';
            });
            return html + '</div>';
        }

        function renderTable() {
            var data = state.byAssignee;
            if (!data || data.length === 0) return '';
            var sprint = state.sprint || {};
            var days = sprint.startDate && sprint.endDate ? utils.daysBetween(utils.parseDate(sprint.startDate), utils.parseDate(sprint.endDate)) : [];
            
            var html = '<div class="ujg-tbl-wrap"><table class="ujg-tbl"><thead><tr>' +
                '<th>Ключ</th><th>Задача</th><th>Ч</th><th>Срок</th><th>Статус</th><th>Gantt</th></tr></thead><tbody>';
            
            data.forEach(function(a) {
                html += '<tr class="ujg-tbl-grp" data-aid="' + a.id + '"><td colspan="6"><b>' + utils.escapeHtml(a.name) + '</b> <span class="ujg-tbl-grp-info">(' + utils.formatHours(a.totalHours) + ', ' + a.issues.length + ')</span></td></tr>';
                a.issues.forEach(function(iss) {
                    html += '<tr class="ujg-tbl-row" data-aid="' + a.id + '">';
                    html += '<td><a href="' + baseUrl + '/browse/' + iss.key + '" target="_blank" class="' + (iss.isDone ? "ujg-done" : "") + '">' + iss.key + '</a></td>';
                    html += '<td title="' + utils.escapeHtml(iss.summary) + '">' + utils.escapeHtml(iss.summary.substring(0, 40)) + (iss.summary.length > 40 ? "…" : "") + '</td>';
                    html += '<td>' + (iss.estimate > 0 ? utils.formatHoursShort(iss.estimate) : "—") + '</td>';
                    html += '<td>' + (iss.dueDate ? utils.formatDateShort(iss.dueDate) : "—") + '</td>';
                    html += '<td><span class="ujg-st ujg-st-' + iss.statusCategory + '">' + utils.escapeHtml(iss.status.substring(0, 8)) + '</span></td>';
                    html += '<td>' + renderGantt(iss, days) + '</td>';
                    html += '</tr>';
                });
            });
            return html + '</tbody></table></div>';
        }

        function renderGantt(issue, days) {
            if (days.length === 0) return '';
            var html = '<div class="ujg-gantt">';
            var start = issue.startDate || issue.created, end = issue.dueDate;
            days.forEach(function(d) {
                var inRange = false;
                if (start && end) inRange = d >= start && d <= end;
                else if (start) inRange = d >= start;
                else if (end) inRange = d <= end;
                var cls = "ujg-g-cell";
                if (inRange) {
                    if (issue.isDone) cls += " ujg-g-done";
                    else if (issue.statusCategory === "indeterminate") cls += " ujg-g-prog";
                    else cls += " ujg-g-todo";
                }
                html += '<div class="' + cls + '"></div>';
            });
            return html + '</div>';
        }

        function bindEvents() {
            $cont.find(".ujg-tog").on("click", function() {
                var mode = $(this).data("mode");
                if (mode !== state.burndownMode) { state.burndownMode = mode; render(); }
            });
            $cont.find(".ujg-tbl-grp").on("click", function() {
                var aid = $(this).data("aid");
                $cont.find('.ujg-tbl-row[data-aid="' + aid + '"]').toggle();
            });
        }

        // ==================== ИНИЦИАЛИЗАЦИЯ ====================
        function initPanel() {
            var $panel = $('<div class="ujg-panel"></div>');
            
            $boardSelect = $('<select class="ujg-sel"><option value="">Доска</option></select>');
            $boardSelect.on("change", function() { var id = $(this).val(); if (id) loadSprints(id); });
            
            var $sprintWrap = $('<div class="ujg-sprint-wrap"></div>');
            $sprintInput = $('<input type="text" class="ujg-sprint-input" placeholder="Поиск спринта...">');
            $sprintDropdown = $('<div class="ujg-sprint-dd"></div>');
            
            $sprintInput.on("focus", function() { showSprintDropdown(); });
            $sprintInput.on("input", function() { filterSprints($(this).val()); showSprintDropdown(); });
            $sprintInput.on("keydown", function(e) {
                if (e.key === "Escape") { hideSprintDropdown(); $(this).blur(); }
                if (e.key === "Enter") {
                    var first = state.filteredSprints[0];
                    if (first) selectSprint(first.id);
                }
            });
            
            $sprintDropdown.on("click", ".ujg-sprint-option", function() {
                var id = $(this).data("id");
                selectSprint(id);
            });
            
            $(document).on("click", function(e) {
                if (!$(e.target).closest(".ujg-sprint-wrap").length) hideSprintDropdown();
            });
            
            $sprintWrap.append($sprintInput, $sprintDropdown);
            
            $refreshBtn = $('<button class="ujg-btn">🔄</button>');
            $refreshBtn.on("click", function() { if (state.selectedSprintId) loadSprintData(state.selectedSprintId); });
            
            $fsBtn = $('<button class="ujg-btn ujg-btn-fs">⛶</button>');
            $fsBtn.on("click", toggleFullscreen);
            
            $panel.append($boardSelect, $sprintWrap, $refreshBtn, $fsBtn);
            $cont.before($panel);
            
            $(document).on("keydown.ujgSh", function(e) { if (e.key === "Escape" && state.isFullscreen) toggleFullscreen(); });
            
            loadBoards();
        }

        initPanel();
    }

    return SprintHealthGadget;
});
