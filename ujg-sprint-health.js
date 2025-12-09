/**
 * UJG Sprint Health — Виджет оценки качества планирования спринта
 * Версия: 1.0.0
 * Автономный модуль без внешних зависимостей (кроме jQuery)
 */
define("_ujgSprintHealth", ["jquery"], function($) {
    "use strict";

    // ==================== КОНФИГУРАЦИЯ ====================
    var CONFIG = {
        version: "1.0.0",
        debug: true,
        maxHours: 16,           // Порог "слишком большой задачи" (часы)
        capacityPerPerson: 40,  // Часов на человека в спринте по умолчанию
        workHoursPerDay: 8      // Рабочих часов в день
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
            if (h > 0 && m > 0) return h + "ч " + m + "м";
            return h > 0 ? h + "ч" : (m > 0 ? m + "м" : "—");
        },
        
        formatHoursShort: function(seconds) {
            if (!seconds || seconds <= 0) return "0";
            return Math.round(seconds / 3600) + "ч";
        },
        
        parseDate: function(v) {
            if (!v) return null;
            if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
            if (typeof v === "number") {
                var d = new Date(v);
                return isNaN(d.getTime()) ? null : d;
            }
            if (typeof v === "string") {
                var d = new Date(v);
                if (!isNaN(d.getTime())) return d;
            }
            return null;
        },
        
        formatDateShort: function(d) {
            if (!d || !(d instanceof Date) || isNaN(d.getTime())) return "—";
            var dd = d.getDate(), mm = d.getMonth() + 1;
            return (dd < 10 ? "0" : "") + dd + "." + (mm < 10 ? "0" : "") + mm;
        },
        
        getDayKey: function(d) {
            if (!d || !(d instanceof Date) || isNaN(d.getTime())) return "";
            var yyyy = d.getFullYear();
            var mm = d.getMonth() + 1;
            var dd = d.getDate();
            return yyyy + "-" + (mm < 10 ? "0" : "") + mm + "-" + (dd < 10 ? "0" : "") + dd;
        },
        
        daysBetween: function(start, end) {
            var res = [];
            if (!start || !end) return res;
            var cur = new Date(start);
            cur.setHours(0, 0, 0, 0);
            var ed = new Date(end);
            ed.setHours(0, 0, 0, 0);
            while (cur <= ed) {
                // Пропускаем выходные
                var dow = cur.getDay();
                if (dow !== 0 && dow !== 6) {
                    res.push(new Date(cur));
                }
                cur.setDate(cur.getDate() + 1);
            }
            return res;
        },
        
        isWeekend: function(d) {
            if (!d) return false;
            var dow = d.getDay();
            return dow === 0 || dow === 6;
        },
        
        // Цвет по проценту
        getHealthColor: function(percent) {
            if (percent >= 90) return "#36b37e"; // зелёный
            if (percent >= 70) return "#ffab00"; // жёлтый
            if (percent >= 50) return "#ff8b00"; // оранжевый
            return "#de350b"; // красный
        },
        
        getHealthLabel: function(percent) {
            if (percent >= 90) return "Отлично";
            if (percent >= 70) return "Хорошо";
            if (percent >= 50) return "Внимание";
            return "Критично";
        }
    };

    // ==================== ЛОКАЛЬНОЕ ХРАНИЛИЩЕ ====================
    function loadSettings() {
        try {
            var saved = localStorage.getItem(STORAGE_KEY);
            if (saved) return JSON.parse(saved);
        } catch (e) {}
        return {};
    }

    function saveSettings(settings) {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
        } catch (e) {}
    }

    // ==================== API JIRA ====================
    var api = {
        // Получить все доски
        getBoards: function() {
            return $.ajax({
                url: baseUrl + "/rest/agile/1.0/board",
                type: "GET",
                data: { maxResults: 100 }
            });
        },
        
        // Получить спринты доски
        getSprints: function(boardId) {
            return $.ajax({
                url: baseUrl + "/rest/agile/1.0/board/" + boardId + "/sprint",
                type: "GET",
                data: { state: "active,future,closed", maxResults: 50 }
            });
        },
        
        // Получить информацию о спринте
        getSprint: function(sprintId) {
            return $.ajax({
                url: baseUrl + "/rest/agile/1.0/sprint/" + sprintId,
                type: "GET"
            });
        },
        
        // Получить задачи спринта
        getSprintIssues: function(sprintId) {
            return $.ajax({
                url: baseUrl + "/rest/agile/1.0/sprint/" + sprintId + "/issue",
                type: "GET",
                data: {
                    fields: "summary,status,assignee,priority,issuetype,timeoriginalestimate,timetracking,duedate,created,description,resolutiondate",
                    maxResults: 500
                }
            });
        }
    };

    // ==================== ОСНОВНОЙ ВИДЖЕТ ====================
    function SprintHealthGadget(API) {
        var self = this;
        
        // Состояние
        var state = {
            boards: [],
            sprints: [],
            selectedBoardId: null,
            selectedSprintId: null,
            sprint: null,
            issues: [],
            loading: false,
            isFullscreen: false,
            burndownMode: "hours", // "hours" или "tasks"
            // Вычисленные метрики
            metrics: {
                totalIssues: 0,
                totalHours: 0,
                estimatedCount: 0,
                estimatedPercent: 0,
                withDatesCount: 0,
                withDatesPercent: 0,
                assignedCount: 0,
                assignedPercent: 0,
                overallHealth: 0
            },
            // Данные для графиков
            burndownData: [],
            burnupData: [],
            // Группировка по исполнителям
            byAssignee: {}
        };

        var $content = API.getGadgetContentEl();
        var $cont = $content.find(".ujg-sprint-health");
        if ($cont.length === 0) {
            $cont = $('<div class="ujg-sprint-health"></div>');
            $content.append($cont);
        }

        // UI элементы
        var $boardSelect, $sprintSelect, $refreshBtn, $fsBtn;
        var $metricsPanel, $chartsPanel, $issuesPanel, $problemsPanel;

        function log(msg) {
            if (CONFIG.debug) console.log("[UJG-SprintHealth]", msg);
        }

        // ==================== FULLSCREEN ====================
        function toggleFullscreen() {
            var $el = $content.closest(".dashboard-item-content, .gadget, .ujg-gadget-wrapper");
            if ($el.length === 0) $el = $content;
            state.isFullscreen = !state.isFullscreen;
            if (state.isFullscreen) {
                $el.data("ujg-style", $el.attr("style") || "");
                $el.addClass("ujg-fullscreen");
                $fsBtn.text("✕ Выйти");
            } else {
                $el.removeClass("ujg-fullscreen").attr("style", $el.data("ujg-style"));
                $fsBtn.text("⛶ На весь экран");
            }
            API.resize();
        }

        // ==================== ЗАГРУЗКА ДАННЫХ ====================
        function loadBoards() {
            log("Загрузка досок...");
            api.getBoards().then(function(data) {
                state.boards = (data && data.values) || [];
                updateBoardSelect();
                
                // Восстанавливаем выбранную доску
                var saved = loadSettings();
                if (saved.boardId && state.boards.some(function(b) { return b.id == saved.boardId; })) {
                    $boardSelect.val(saved.boardId);
                    state.selectedBoardId = saved.boardId;
                    loadSprints(saved.boardId);
                }
            }, function(err) {
                log("Ошибка загрузки досок: " + (err.statusText || err));
                $cont.html('<div class="ujg-message ujg-error">Ошибка загрузки досок. Проверьте права доступа.</div>');
            });
        }

        function loadSprints(boardId) {
            if (!boardId) return;
            log("Загрузка спринтов для доски " + boardId);
            state.selectedBoardId = boardId;
            
            api.getSprints(boardId).then(function(data) {
                state.sprints = (data && data.values) || [];
                // Сортируем: активные первыми, потом future, потом closed
                state.sprints.sort(function(a, b) {
                    var order = { active: 0, future: 1, closed: 2 };
                    return (order[a.state] || 3) - (order[b.state] || 3);
                });
                updateSprintSelect();
                
                // Восстанавливаем или выбираем активный спринт
                var saved = loadSettings();
                var activeSprint = state.sprints.find(function(s) { return s.state === "active"; });
                
                if (saved.sprintId && state.sprints.some(function(s) { return s.id == saved.sprintId; })) {
                    $sprintSelect.val(saved.sprintId);
                    loadSprintData(saved.sprintId);
                } else if (activeSprint) {
                    $sprintSelect.val(activeSprint.id);
                    loadSprintData(activeSprint.id);
                }
            }, function(err) {
                log("Ошибка загрузки спринтов: " + (err.statusText || err));
            });
        }

        function loadSprintData(sprintId) {
            if (!sprintId) return;
            state.selectedSprintId = sprintId;
            state.loading = true;
            
            saveSettings({
                boardId: state.selectedBoardId,
                sprintId: sprintId
            });
            
            log("Загрузка данных спринта " + sprintId);
            showLoading();
            
            // Загружаем информацию о спринте и задачи параллельно
            $.when(
                api.getSprint(sprintId),
                api.getSprintIssues(sprintId)
            ).then(function(sprintResp, issuesResp) {
                state.sprint = sprintResp[0] || sprintResp;
                var issuesData = issuesResp[0] || issuesResp;
                state.issues = (issuesData && issuesData.issues) || [];
                
                log("Загружено задач: " + state.issues.length);
                
                calculateMetrics();
                calculateBurndown();
                groupByAssignee();
                render();
                
                state.loading = false;
            }, function(err) {
                log("Ошибка загрузки спринта: " + (err.statusText || err));
                state.loading = false;
                $cont.html('<div class="ujg-message ujg-error">Ошибка загрузки данных спринта</div>');
            });
        }

        // ==================== ВЫЧИСЛЕНИЕ МЕТРИК ====================
        function calculateMetrics() {
            var issues = state.issues;
            var m = state.metrics;
            
            m.totalIssues = issues.length;
            m.totalHours = 0;
            m.estimatedCount = 0;
            m.withDatesCount = 0;
            m.assignedCount = 0;
            m.withDescriptionCount = 0;
            m.doneCount = 0;
            m.bigTasksCount = 0;
            m.overdueCount = 0;
            
            var now = new Date();
            
            issues.forEach(function(issue) {
                var f = issue.fields || {};
                
                // Оценка в часах
                var estimate = 0;
                if (f.timetracking && f.timetracking.originalEstimateSeconds) {
                    estimate = f.timetracking.originalEstimateSeconds;
                } else if (f.timeoriginalestimate) {
                    estimate = f.timeoriginalestimate;
                }
                
                if (estimate > 0) {
                    m.estimatedCount++;
                    m.totalHours += estimate;
                    
                    // Проверка на "слишком большую" задачу
                    if (estimate > CONFIG.maxHours * 3600) {
                        m.bigTasksCount++;
                    }
                }
                
                // Даты
                if (f.duedate) {
                    m.withDatesCount++;
                    
                    // Проверка просрочки
                    var dueDate = utils.parseDate(f.duedate);
                    if (dueDate && dueDate < now && !isIssueDone(f.status)) {
                        m.overdueCount++;
                    }
                }
                
                // Исполнитель
                if (f.assignee) {
                    m.assignedCount++;
                }
                
                // Описание
                if (f.description && f.description.trim()) {
                    m.withDescriptionCount++;
                }
                
                // Статус Done
                if (isIssueDone(f.status)) {
                    m.doneCount++;
                }
            });
            
            // Проценты
            m.estimatedPercent = m.totalIssues > 0 ? Math.round((m.estimatedCount / m.totalIssues) * 100) : 0;
            m.withDatesPercent = m.totalIssues > 0 ? Math.round((m.withDatesCount / m.totalIssues) * 100) : 0;
            m.assignedPercent = m.totalIssues > 0 ? Math.round((m.assignedCount / m.totalIssues) * 100) : 0;
            m.withDescriptionPercent = m.totalIssues > 0 ? Math.round((m.withDescriptionCount / m.totalIssues) * 100) : 0;
            m.donePercent = m.totalIssues > 0 ? Math.round((m.doneCount / m.totalIssues) * 100) : 0;
            
            // Общая оценка здоровья спринта (среднее)
            m.overallHealth = Math.round((m.estimatedPercent + m.withDatesPercent + m.assignedPercent + m.withDescriptionPercent) / 4);
            
            log("Метрики рассчитаны: " + JSON.stringify(m));
        }
        
        function isIssueDone(status) {
            if (!status) return false;
            var name = (status.name || "").toLowerCase();
            var doneStatuses = ["done", "closed", "resolved", "готово", "закрыт", "закрыта", "завершён", "выполнено"];
            return doneStatuses.some(function(s) { return name.indexOf(s) >= 0; });
        }

        // ==================== BURNDOWN / BURNUP ====================
        function calculateBurndown() {
            var sprint = state.sprint;
            if (!sprint || !sprint.startDate || !sprint.endDate) {
                state.burndownData = [];
                state.burnupData = [];
                return;
            }
            
            var startDate = utils.parseDate(sprint.startDate);
            var endDate = utils.parseDate(sprint.endDate);
            if (!startDate || !endDate) return;
            
            var days = utils.daysBetween(startDate, endDate);
            var totalHours = state.metrics.totalHours;
            var totalTasks = state.metrics.totalIssues;
            
            // Идеальная линия
            var hoursPerDay = totalHours / days.length;
            var tasksPerDay = totalTasks / days.length;
            
            var burndownData = [];
            var burnupData = [];
            var now = new Date();
            
            days.forEach(function(day, idx) {
                var dayKey = utils.getDayKey(day);
                var isPast = day <= now;
                
                // Идеальные значения
                var idealHoursRemaining = totalHours - (hoursPerDay * (idx + 1));
                var idealTasksRemaining = totalTasks - (tasksPerDay * (idx + 1));
                
                // Фактические значения (считаем по resolutiondate)
                var actualHoursDone = 0;
                var actualTasksDone = 0;
                
                if (isPast) {
                    state.issues.forEach(function(issue) {
                        var f = issue.fields || {};
                        var resDate = utils.parseDate(f.resolutiondate);
                        
                        if (resDate && resDate <= day && isIssueDone(f.status)) {
                            actualTasksDone++;
                            
                            var est = 0;
                            if (f.timetracking && f.timetracking.originalEstimateSeconds) {
                                est = f.timetracking.originalEstimateSeconds;
                            } else if (f.timeoriginalestimate) {
                                est = f.timeoriginalestimate;
                            }
                            actualHoursDone += est;
                        }
                    });
                }
                
                var actualHoursRemaining = isPast ? (totalHours - actualHoursDone) : null;
                var actualTasksRemaining = isPast ? (totalTasks - actualTasksDone) : null;
                
                burndownData.push({
                    date: day,
                    dayKey: dayKey,
                    label: utils.formatDateShort(day),
                    idealHours: Math.max(0, idealHoursRemaining),
                    idealTasks: Math.max(0, Math.round(idealTasksRemaining)),
                    actualHours: actualHoursRemaining,
                    actualTasks: actualTasksRemaining
                });
                
                burnupData.push({
                    date: day,
                    dayKey: dayKey,
                    label: utils.formatDateShort(day),
                    scope: totalHours,
                    scopeTasks: totalTasks,
                    doneHours: isPast ? actualHoursDone : null,
                    doneTasks: isPast ? actualTasksDone : null
                });
            });
            
            state.burndownData = burndownData;
            state.burnupData = burnupData;
        }

        // ==================== ГРУППИРОВКА ПО ИСПОЛНИТЕЛЯМ ====================
        function groupByAssignee() {
            var byAssignee = {};
            var unassigned = { id: "__unassigned__", name: "Не назначено", issues: [], totalHours: 0 };
            
            state.issues.forEach(function(issue) {
                var f = issue.fields || {};
                var assignee = f.assignee;
                
                var estimate = 0;
                if (f.timetracking && f.timetracking.originalEstimateSeconds) {
                    estimate = f.timetracking.originalEstimateSeconds;
                } else if (f.timeoriginalestimate) {
                    estimate = f.timeoriginalestimate;
                }
                
                var issueData = {
                    key: issue.key,
                    summary: f.summary || "",
                    status: f.status ? f.status.name : "",
                    statusCategory: f.status && f.status.statusCategory ? f.status.statusCategory.key : "",
                    priority: f.priority ? f.priority.name : "",
                    type: f.issuetype ? f.issuetype.name : "",
                    estimate: estimate,
                    dueDate: utils.parseDate(f.duedate),
                    startDate: null, // TODO: customfield для start date
                    created: utils.parseDate(f.created),
                    isDone: isIssueDone(f.status)
                };
                
                if (assignee) {
                    var aid = assignee.accountId || assignee.key || assignee.name;
                    if (!byAssignee[aid]) {
                        byAssignee[aid] = {
                            id: aid,
                            name: assignee.displayName || assignee.name || aid,
                            avatar: assignee.avatarUrls ? assignee.avatarUrls["24x24"] : null,
                            issues: [],
                            totalHours: 0
                        };
                    }
                    byAssignee[aid].issues.push(issueData);
                    byAssignee[aid].totalHours += estimate;
                } else {
                    unassigned.issues.push(issueData);
                    unassigned.totalHours += estimate;
                }
            });
            
            // Сортируем по имени
            var sorted = Object.values(byAssignee).sort(function(a, b) {
                return a.name.localeCompare(b.name);
            });
            
            // Добавляем неназначенные в конец
            if (unassigned.issues.length > 0) {
                sorted.push(unassigned);
            }
            
            state.byAssignee = sorted;
        }

        // ==================== РЕНДЕРИНГ ====================
        function showLoading() {
            $cont.html('<div class="ujg-message ujg-loading">⏳ Загрузка данных спринта...</div>');
        }

        function updateBoardSelect() {
            $boardSelect.empty();
            $boardSelect.append('<option value="">— Выберите доску —</option>');
            state.boards.forEach(function(board) {
                $boardSelect.append('<option value="' + board.id + '">' + utils.escapeHtml(board.name) + '</option>');
            });
        }

        function updateSprintSelect() {
            $sprintSelect.empty();
            $sprintSelect.append('<option value="">— Выберите спринт —</option>');
            state.sprints.forEach(function(sprint) {
                var label = sprint.name;
                if (sprint.state === "active") label = "● " + label;
                else if (sprint.state === "future") label = "○ " + label;
                else label = "✓ " + label;
                $sprintSelect.append('<option value="' + sprint.id + '">' + utils.escapeHtml(label) + '</option>');
            });
        }

        function render() {
            if (state.issues.length === 0) {
                $cont.html('<div class="ujg-message ujg-info">В спринте нет задач или спринт не выбран</div>');
                API.resize();
                return;
            }
            
            var html = '';
            
            // Общая оценка здоровья
            html += renderHealthScore();
            
            // Метрики (карточки)
            html += renderMetricsCards();
            
            // Графики
            html += renderCharts();
            
            // Проблемы
            html += renderProblems();
            
            // Распределение по исполнителям
            html += renderAssigneeDistribution();
            
            // Таблица задач с Gantt
            html += renderIssuesTable();
            
            $cont.html(html);
            
            // Привязываем события после рендера
            bindChartEvents();
            bindTableEvents();
            
            API.resize();
        }

        function renderHealthScore() {
            var m = state.metrics;
            var color = utils.getHealthColor(m.overallHealth);
            var label = utils.getHealthLabel(m.overallHealth);
            
            return '<div class="ujg-health-score">' +
                '<div class="ujg-health-bar">' +
                    '<div class="ujg-health-fill" style="width:' + m.overallHealth + '%;background:' + color + '"></div>' +
                '</div>' +
                '<div class="ujg-health-info">' +
                    '<span class="ujg-health-percent" style="color:' + color + '">' + m.overallHealth + '%</span>' +
                    '<span class="ujg-health-label">' + label + '</span>' +
                '</div>' +
            '</div>';
        }

        function renderMetricsCards() {
            var m = state.metrics;
            var sprint = state.sprint || {};
            
            var html = '<div class="ujg-metrics-grid">';
            
            // Capacity
            html += renderMetricCard("📊", "Объём", 
                utils.formatHours(m.totalHours), 
                m.totalIssues + " задач",
                null);
            
            // Оценки
            html += renderMetricCard("📝", "Оценки",
                m.estimatedPercent + "%",
                m.estimatedCount + " из " + m.totalIssues,
                utils.getHealthColor(m.estimatedPercent));
            
            // Сроки
            html += renderMetricCard("📅", "Сроки",
                m.withDatesPercent + "%",
                m.withDatesCount + " из " + m.totalIssues,
                utils.getHealthColor(m.withDatesPercent));
            
            // Исполнители
            html += renderMetricCard("👤", "Исполнители",
                m.assignedPercent + "%",
                m.assignedCount + " из " + m.totalIssues,
                utils.getHealthColor(m.assignedPercent));
            
            // Прогресс
            html += renderMetricCard("✅", "Выполнено",
                m.donePercent + "%",
                m.doneCount + " из " + m.totalIssues,
                utils.getHealthColor(m.donePercent));
            
            html += '</div>';
            return html;
        }

        function renderMetricCard(icon, title, value, subtitle, color) {
            var borderColor = color || "#dfe1e6";
            return '<div class="ujg-metric-card" style="border-left-color:' + borderColor + '">' +
                '<div class="ujg-metric-icon">' + icon + '</div>' +
                '<div class="ujg-metric-content">' +
                    '<div class="ujg-metric-title">' + title + '</div>' +
                    '<div class="ujg-metric-value">' + value + '</div>' +
                    '<div class="ujg-metric-subtitle">' + subtitle + '</div>' +
                '</div>' +
            '</div>';
        }

        function renderCharts() {
            var html = '<div class="ujg-charts-section">';
            
            // Burndown Chart
            html += '<div class="ujg-chart-container">';
            html += '<div class="ujg-chart-header">';
            html += '<span class="ujg-chart-title">Burndown Chart</span>';
            html += '<div class="ujg-chart-toggle">';
            html += '<label class="ujg-toggle-option ' + (state.burndownMode === "hours" ? "active" : "") + '" data-mode="hours">Часы</label>';
            html += '<label class="ujg-toggle-option ' + (state.burndownMode === "tasks" ? "active" : "") + '" data-mode="tasks">Задачи</label>';
            html += '</div>';
            html += '</div>';
            html += renderBurndownChart();
            html += '</div>';
            
            // Burnup Chart
            html += '<div class="ujg-chart-container">';
            html += '<div class="ujg-chart-header">';
            html += '<span class="ujg-chart-title">Burnup Chart</span>';
            html += '</div>';
            html += renderBurnupChart();
            html += '</div>';
            
            html += '</div>';
            return html;
        }

        function renderBurndownChart() {
            var data = state.burndownData;
            if (!data || data.length === 0) {
                return '<div class="ujg-chart-empty">Нет данных для графика</div>';
            }
            
            var isHours = state.burndownMode === "hours";
            var maxValue = isHours ? state.metrics.totalHours : state.metrics.totalIssues;
            var height = 200;
            var width = Math.max(data.length * 50, 400);
            
            var html = '<div class="ujg-chart-canvas" style="height:' + height + 'px;width:100%;overflow-x:auto">';
            html += '<svg width="' + width + '" height="' + height + '" class="ujg-burndown-svg">';
            
            // Оси
            html += '<line x1="40" y1="10" x2="40" y2="' + (height - 30) + '" stroke="#dfe1e6" />';
            html += '<line x1="40" y1="' + (height - 30) + '" x2="' + (width - 10) + '" y2="' + (height - 30) + '" stroke="#dfe1e6" />';
            
            // Масштаб
            var chartWidth = width - 60;
            var chartHeight = height - 50;
            var stepX = chartWidth / (data.length - 1 || 1);
            
            // Идеальная линия
            var idealPoints = [];
            var actualPoints = [];
            
            data.forEach(function(d, i) {
                var x = 50 + i * stepX;
                var idealVal = isHours ? d.idealHours : d.idealTasks;
                var actualVal = isHours ? d.actualHours : d.actualTasks;
                
                var yIdeal = 15 + chartHeight * (1 - idealVal / maxValue);
                idealPoints.push(x + "," + yIdeal);
                
                if (actualVal !== null) {
                    var yActual = 15 + chartHeight * (1 - actualVal / maxValue);
                    actualPoints.push(x + "," + yActual);
                }
            });
            
            // Идеальная линия (пунктир)
            html += '<polyline points="' + idealPoints.join(" ") + '" fill="none" stroke="#8993a4" stroke-width="2" stroke-dasharray="5,5" />';
            
            // Фактическая линия
            if (actualPoints.length > 0) {
                html += '<polyline points="' + actualPoints.join(" ") + '" fill="none" stroke="#0052cc" stroke-width="2" />';
                
                // Точки
                actualPoints.forEach(function(p) {
                    var coords = p.split(",");
                    html += '<circle cx="' + coords[0] + '" cy="' + coords[1] + '" r="4" fill="#0052cc" />';
                });
            }
            
            // Подписи дней
            data.forEach(function(d, i) {
                var x = 50 + i * stepX;
                html += '<text x="' + x + '" y="' + (height - 10) + '" text-anchor="middle" font-size="10" fill="#6b778c">' + d.label + '</text>';
            });
            
            // Легенда
            html += '<text x="50" y="' + (height - 5) + '" font-size="9" fill="#8993a4">─ ─ идеал</text>';
            html += '<text x="120" y="' + (height - 5) + '" font-size="9" fill="#0052cc">── факт</text>';
            
            html += '</svg></div>';
            return html;
        }

        function renderBurnupChart() {
            var data = state.burnupData;
            if (!data || data.length === 0) {
                return '<div class="ujg-chart-empty">Нет данных для графика</div>';
            }
            
            var isHours = state.burndownMode === "hours";
            var maxValue = isHours ? state.metrics.totalHours : state.metrics.totalIssues;
            var height = 200;
            var width = Math.max(data.length * 50, 400);
            
            var html = '<div class="ujg-chart-canvas" style="height:' + height + 'px;width:100%;overflow-x:auto">';
            html += '<svg width="' + width + '" height="' + height + '" class="ujg-burnup-svg">';
            
            // Оси
            html += '<line x1="40" y1="10" x2="40" y2="' + (height - 30) + '" stroke="#dfe1e6" />';
            html += '<line x1="40" y1="' + (height - 30) + '" x2="' + (width - 10) + '" y2="' + (height - 30) + '" stroke="#dfe1e6" />';
            
            var chartWidth = width - 60;
            var chartHeight = height - 50;
            var stepX = chartWidth / (data.length - 1 || 1);
            
            // Scope линия (верхняя)
            var scopeY = 15;
            html += '<line x1="50" y1="' + scopeY + '" x2="' + (width - 20) + '" y2="' + scopeY + '" stroke="#36b37e" stroke-width="2" />';
            
            // Done линия
            var donePoints = [];
            data.forEach(function(d, i) {
                var x = 50 + i * stepX;
                var doneVal = isHours ? d.doneHours : d.doneTasks;
                
                if (doneVal !== null) {
                    var yDone = 15 + chartHeight * (1 - doneVal / maxValue);
                    donePoints.push(x + "," + yDone);
                }
            });
            
            if (donePoints.length > 0) {
                html += '<polyline points="' + donePoints.join(" ") + '" fill="none" stroke="#0052cc" stroke-width="2" />';
                
                donePoints.forEach(function(p) {
                    var coords = p.split(",");
                    html += '<circle cx="' + coords[0] + '" cy="' + coords[1] + '" r="4" fill="#0052cc" />';
                });
            }
            
            // Подписи дней
            data.forEach(function(d, i) {
                var x = 50 + i * stepX;
                html += '<text x="' + x + '" y="' + (height - 10) + '" text-anchor="middle" font-size="10" fill="#6b778c">' + d.label + '</text>';
            });
            
            // Легенда
            html += '<text x="50" y="' + (height - 5) + '" font-size="9" fill="#36b37e">── scope</text>';
            html += '<text x="110" y="' + (height - 5) + '" font-size="9" fill="#0052cc">── done</text>';
            
            html += '</svg></div>';
            return html;
        }

        function renderProblems() {
            var problems = [];
            var m = state.metrics;
            
            // Задачи без оценки
            if (m.totalIssues - m.estimatedCount > 0) {
                var noEstimate = state.issues.filter(function(i) {
                    var f = i.fields || {};
                    var est = (f.timetracking && f.timetracking.originalEstimateSeconds) || f.timeoriginalestimate;
                    return !est || est <= 0;
                });
                noEstimate.slice(0, 5).forEach(function(i) {
                    problems.push({ type: "warning", text: i.key + ": Нет оценки", key: i.key });
                });
            }
            
            // Задачи без исполнителя
            var noAssignee = state.issues.filter(function(i) {
                return !(i.fields && i.fields.assignee);
            });
            noAssignee.slice(0, 5).forEach(function(i) {
                problems.push({ type: "warning", text: i.key + ": Нет исполнителя", key: i.key });
            });
            
            // Слишком большие задачи
            var bigTasks = state.issues.filter(function(i) {
                var f = i.fields || {};
                var est = (f.timetracking && f.timetracking.originalEstimateSeconds) || f.timeoriginalestimate || 0;
                return est > CONFIG.maxHours * 3600;
            });
            bigTasks.forEach(function(i) {
                var f = i.fields || {};
                var est = (f.timetracking && f.timetracking.originalEstimateSeconds) || f.timeoriginalestimate || 0;
                problems.push({ type: "error", text: i.key + ": Слишком большая задача (" + utils.formatHours(est) + ")", key: i.key });
            });
            
            // Просроченные
            if (m.overdueCount > 0) {
                var now = new Date();
                state.issues.filter(function(i) {
                    var f = i.fields || {};
                    var due = utils.parseDate(f.duedate);
                    return due && due < now && !isIssueDone(f.status);
                }).slice(0, 5).forEach(function(i) {
                    problems.push({ type: "error", text: i.key + ": Просрочено (" + utils.formatDateShort(utils.parseDate(i.fields.duedate)) + ")", key: i.key });
                });
            }
            
            if (problems.length === 0) {
                return '<div class="ujg-problems-section"><div class="ujg-no-problems">✅ Проблем не обнаружено</div></div>';
            }
            
            var html = '<div class="ujg-problems-section">';
            html += '<div class="ujg-section-title">⚠️ Проблемы (' + problems.length + ')</div>';
            html += '<div class="ujg-problems-list">';
            
            problems.forEach(function(p) {
                var cls = p.type === "error" ? "ujg-problem-error" : "ujg-problem-warning";
                html += '<div class="ujg-problem-item ' + cls + '">';
                html += '<a href="' + baseUrl + '/browse/' + p.key + '" target="_blank">' + utils.escapeHtml(p.text) + '</a>';
                html += '</div>';
            });
            
            html += '</div></div>';
            return html;
        }

        function renderAssigneeDistribution() {
            var data = state.byAssignee;
            if (!data || data.length === 0) return '';
            
            var maxHours = Math.max.apply(null, data.map(function(a) { return a.totalHours; })) || 1;
            
            var html = '<div class="ujg-assignee-section">';
            html += '<div class="ujg-section-title">👥 Распределение по исполнителям</div>';
            html += '<div class="ujg-assignee-list">';
            
            data.forEach(function(a) {
                var percent = Math.round((a.totalHours / maxHours) * 100);
                var isOverload = a.totalHours > CONFIG.capacityPerPerson * 3600;
                
                html += '<div class="ujg-assignee-row">';
                html += '<div class="ujg-assignee-name">' + utils.escapeHtml(a.name) + '</div>';
                html += '<div class="ujg-assignee-bar">';
                html += '<div class="ujg-assignee-fill' + (isOverload ? ' ujg-overload' : '') + '" style="width:' + percent + '%"></div>';
                html += '</div>';
                html += '<div class="ujg-assignee-value">' + utils.formatHours(a.totalHours) + ' (' + a.issues.length + ')</div>';
                if (isOverload) html += '<span class="ujg-overload-badge">⚠️</span>';
                html += '</div>';
            });
            
            html += '</div></div>';
            return html;
        }

        function renderIssuesTable() {
            var data = state.byAssignee;
            if (!data || data.length === 0) return '';
            
            var sprint = state.sprint || {};
            var startDate = utils.parseDate(sprint.startDate);
            var endDate = utils.parseDate(sprint.endDate);
            var sprintDays = startDate && endDate ? utils.daysBetween(startDate, endDate) : [];
            
            var html = '<div class="ujg-issues-section">';
            html += '<div class="ujg-section-title">📋 Все задачи спринта (' + state.issues.length + ')</div>';
            html += '<div class="ujg-issues-table-wrapper">';
            html += '<table class="ujg-issues-table">';
            
            // Заголовок
            html += '<thead><tr>';
            html += '<th class="ujg-col-key">Ключ</th>';
            html += '<th class="ujg-col-summary">Задача</th>';
            html += '<th class="ujg-col-hours">Часы</th>';
            html += '<th class="ujg-col-start">Начало</th>';
            html += '<th class="ujg-col-end">Конец</th>';
            html += '<th class="ujg-col-status">Статус</th>';
            html += '<th class="ujg-col-gantt">Gantt</th>';
            html += '</tr></thead>';
            
            html += '<tbody>';
            
            data.forEach(function(assignee) {
                // Заголовок группы (исполнитель)
                html += '<tr class="ujg-assignee-header" data-assignee="' + assignee.id + '">';
                html += '<td colspan="7">';
                html += '<span class="ujg-collapse-icon">▼</span> ';
                html += '<strong>' + utils.escapeHtml(assignee.name) + '</strong>';
                html += ' <span class="ujg-assignee-summary">(' + utils.formatHours(assignee.totalHours) + ', ' + assignee.issues.length + ' задач)</span>';
                html += '</td></tr>';
                
                // Задачи исполнителя
                assignee.issues.forEach(function(issue) {
                    html += '<tr class="ujg-issue-row" data-assignee="' + assignee.id + '">';
                    html += '<td class="ujg-col-key"><a href="' + baseUrl + '/browse/' + issue.key + '" target="_blank" class="' + (issue.isDone ? 'ujg-done' : '') + '">' + issue.key + '</a></td>';
                    html += '<td class="ujg-col-summary" title="' + utils.escapeHtml(issue.summary) + '">' + utils.escapeHtml(issue.summary.substring(0, 50)) + (issue.summary.length > 50 ? '...' : '') + '</td>';
                    html += '<td class="ujg-col-hours">' + (issue.estimate > 0 ? utils.formatHoursShort(issue.estimate) : '—') + '</td>';
                    html += '<td class="ujg-col-start">' + (issue.startDate ? utils.formatDateShort(issue.startDate) : '—') + '</td>';
                    html += '<td class="ujg-col-end">' + (issue.dueDate ? utils.formatDateShort(issue.dueDate) : '—') + '</td>';
                    html += '<td class="ujg-col-status"><span class="ujg-status-badge ujg-status-' + issue.statusCategory + '">' + utils.escapeHtml(issue.status.substring(0, 10)) + '</span></td>';
                    html += '<td class="ujg-col-gantt">' + renderGanttBar(issue, sprintDays) + '</td>';
                    html += '</tr>';
                });
            });
            
            html += '</tbody></table></div></div>';
            return html;
        }

        function renderGanttBar(issue, sprintDays) {
            if (sprintDays.length === 0) return '';
            
            var html = '<div class="ujg-gantt-row">';
            
            var startDate = issue.startDate || issue.created;
            var endDate = issue.dueDate;
            
            sprintDays.forEach(function(day) {
                var dayKey = utils.getDayKey(day);
                var inRange = false;
                
                if (startDate && endDate) {
                    inRange = day >= startDate && day <= endDate;
                } else if (startDate && !endDate) {
                    inRange = day >= startDate;
                } else if (!startDate && endDate) {
                    inRange = day <= endDate;
                }
                
                var cls = "ujg-gantt-cell";
                if (inRange) {
                    if (issue.isDone) cls += " ujg-gantt-done";
                    else if (issue.statusCategory === "indeterminate") cls += " ujg-gantt-inprogress";
                    else cls += " ujg-gantt-todo";
                }
                
                html += '<div class="' + cls + '" data-day="' + dayKey + '"></div>';
            });
            
            html += '</div>';
            return html;
        }

        // ==================== СОБЫТИЯ ====================
        function bindChartEvents() {
            $cont.find(".ujg-toggle-option").on("click", function() {
                var mode = $(this).data("mode");
                if (mode !== state.burndownMode) {
                    state.burndownMode = mode;
                    render();
                }
            });
        }

        function bindTableEvents() {
            $cont.find(".ujg-assignee-header").on("click", function() {
                var assigneeId = $(this).data("assignee");
                var $rows = $cont.find('.ujg-issue-row[data-assignee="' + assigneeId + '"]');
                var $icon = $(this).find(".ujg-collapse-icon");
                
                $rows.toggle();
                $icon.text($rows.is(":visible") ? "▼" : "▶");
            });
        }

        // ==================== ИНИЦИАЛИЗАЦИЯ ====================
        function initPanel() {
            var $panel = $('<div class="ujg-control-panel"></div>');
            
            // Первый ряд: выбор доски и спринта
            var $row1 = $('<div class="ujg-panel-row"></div>');
            
            $boardSelect = $('<select class="ujg-select ujg-board-select"><option value="">— Доска —</option></select>');
            $boardSelect.on("change", function() {
                var boardId = $(this).val();
                if (boardId) loadSprints(boardId);
            });
            
            $sprintSelect = $('<select class="ujg-select ujg-sprint-select"><option value="">— Спринт —</option></select>');
            $sprintSelect.on("change", function() {
                var sprintId = $(this).val();
                if (sprintId) loadSprintData(sprintId);
            });
            
            $refreshBtn = $('<button class="ujg-btn ujg-btn-primary">🔄 Обновить</button>');
            $refreshBtn.on("click", function() {
                if (state.selectedSprintId) {
                    loadSprintData(state.selectedSprintId);
                }
            });
            
            $fsBtn = $('<button class="ujg-btn ujg-btn-fs">⛶ На весь экран</button>');
            $fsBtn.on("click", toggleFullscreen);
            
            $row1.append(
                $('<label class="ujg-label">Доска:</label>'), $boardSelect,
                $('<label class="ujg-label">Спринт:</label>'), $sprintSelect,
                $refreshBtn,
                $fsBtn
            );
            
            $panel.append($row1);
            $cont.before($panel);
            
            // Esc для выхода из fullscreen
            $(document).on("keydown.ujgSh", function(e) {
                if (e.key === "Escape" && state.isFullscreen) toggleFullscreen();
            });
            
            // Загружаем доски
            loadBoards();
        }

        // Запуск
        initPanel();
    }

    return SprintHealthGadget;
});

