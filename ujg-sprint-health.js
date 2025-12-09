/**
 * UJG Sprint Health — Виджет оценки качества планирования спринта
 * Версия: 1.2.0
 */
define("_ujgSprintHealth", ["jquery"], function($) {
    "use strict";

    var CONFIG = { version: "1.2.0", debug: true, maxHours: 16, capacityPerPerson: 40 };
    var STORAGE_KEY = "ujg_sprint_health_settings";
    var baseUrl = (typeof AJS !== "undefined" && AJS.contextPath) ? AJS.contextPath() : "";

    var utils = {
        escapeHtml: function(t) { if (!t) return ""; var d = document.createElement("div"); d.textContent = String(t); return d.innerHTML; },
        formatHours: function(s) { if (!s || s <= 0) return "—"; var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return h > 0 ? h + "ч" + (m > 0 ? m + "м" : "") : m + "м"; },
        formatHoursShort: function(s) { return s > 0 ? Math.round(s / 3600) + "ч" : "0"; },
        parseDate: function(v) { if (!v) return null; var d = new Date(v); return isNaN(d.getTime()) ? null : d; },
        formatDateShort: function(d) { if (!d) return "—"; return (d.getDate() < 10 ? "0" : "") + d.getDate() + "." + (d.getMonth() < 9 ? "0" : "") + (d.getMonth() + 1); },
        formatDateFull: function(d) { if (!d) return "—"; return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" }); },
        getDayKey: function(d) { if (!d) return ""; return d.getFullYear() + "-" + (d.getMonth() < 9 ? "0" : "") + (d.getMonth() + 1) + "-" + (d.getDate() < 10 ? "0" : "") + d.getDate(); },
        daysBetween: function(start, end) {
            var res = [], cur = new Date(start); cur.setHours(0,0,0,0);
            var ed = new Date(end); ed.setHours(0,0,0,0);
            while (cur <= ed) { if (cur.getDay() !== 0 && cur.getDay() !== 6) res.push(new Date(cur)); cur.setDate(cur.getDate() + 1); }
            return res;
        },
        daysDiff: function(d1, d2) { if (!d1 || !d2) return 0; return Math.floor((d2 - d1) / (1000 * 60 * 60 * 24)); },
        getHealthColor: function(p) { return p >= 90 ? "#36b37e" : p >= 70 ? "#ffab00" : p >= 50 ? "#ff8b00" : "#de350b"; },
        getHealthLabel: function(p) { return p >= 90 ? "Отлично" : p >= 70 ? "Хорошо" : p >= 50 ? "Внимание" : "Критично"; }
    };

    function loadSettings() { try { var s = localStorage.getItem(STORAGE_KEY); return s ? JSON.parse(s) : {}; } catch(e) { return {}; } }
    function saveSettings(s) { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch(e) {} }

    var api = {
        getBoards: function() { return $.ajax({ url: baseUrl + "/rest/agile/1.0/board", data: { maxResults: 100 } }); },
        getAllSprints: function(boardId) {
            var d = $.Deferred(), all = [];
            function load(startAt) {
                $.ajax({
                    url: baseUrl + "/rest/agile/1.0/board/" + boardId + "/sprint",
                    data: { state: "active,future,closed", maxResults: 100, startAt: startAt }
                }).then(function(data) {
                    all = all.concat(data.values || []);
                    if (data.isLast === false && data.values && data.values.length > 0) {
                        load(startAt + data.values.length);
                    } else {
                        d.resolve(all);
                    }
                }, function(err) { d.resolve(all); });
            }
            load(0);
            return d.promise();
        },
        getSprint: function(id) { return $.ajax({ url: baseUrl + "/rest/agile/1.0/sprint/" + id }); },
        getSprintIssues: function(id) {
            return $.ajax({
                url: baseUrl + "/rest/agile/1.0/sprint/" + id + "/issue",
                data: { fields: "summary,status,assignee,priority,issuetype,timeoriginalestimate,timetracking,duedate,created,updated,description,resolutiondate,customfield_10020", maxResults: 500 }
            });
        },
        getIssue: function(key) {
            return $.ajax({
                url: baseUrl + "/rest/api/2/issue/" + key,
                data: { fields: "summary,status,assignee,priority,issuetype,timeoriginalestimate,timetracking,timespent,duedate,created,updated,description,resolutiondate,comment,changelog,customfield_10020", expand: "changelog" }
            });
        }
    };

    function SprintHealthGadget(API) {
        var state = {
            boards: [], sprints: [], filteredSprints: [],
            selectedBoardId: null, selectedSprintId: null,
            sprint: null, issues: [], loading: false, isFullscreen: false,
            chartMode: "tasks", // tasks или hours
            metrics: {}, burnupData: [], byAssignee: [], problems: []
        };

        var $content = API.getGadgetContentEl();
        var $cont = $content.find(".ujg-sprint-health");
        if ($cont.length === 0) { $cont = $('<div class="ujg-sprint-health"></div>'); $content.append($cont); }

        var $boardSelect, $sprintInput, $sprintDropdown, $refreshBtn, $fsBtn;

        function log(msg) { if (CONFIG.debug) console.log("[UJG]", msg); }

        function toggleFullscreen() {
            var $el = $content.closest(".dashboard-item-content, .gadget, .ujg-gadget-wrapper");
            if ($el.length === 0) $el = $content;
            state.isFullscreen = !state.isFullscreen;
            $el.toggleClass("ujg-fullscreen", state.isFullscreen);
            $fsBtn.text(state.isFullscreen ? "✕" : "⛶");
            API.resize();
        }

        function loadBoards() {
            api.getBoards().then(function(data) {
                state.boards = data.values || [];
                updateBoardSelect();
                var saved = loadSettings();
                if (saved.boardId) { $boardSelect.val(saved.boardId); state.selectedBoardId = saved.boardId; loadSprints(saved.boardId); }
            });
        }

        function loadSprints(boardId) {
            if (!boardId) return;
            state.selectedBoardId = boardId;
            $sprintInput.val("Загрузка спринтов...");
            
            api.getAllSprints(boardId).then(function(sprints) {
                // Сортировка по ID убывание (новые сверху)
                sprints.sort(function(a, b) { return b.id - a.id; });
                state.sprints = sprints;
                state.filteredSprints = sprints.slice();
                $sprintInput.val("");
                updateSprintDropdown();
                
                var saved = loadSettings();
                var active = sprints.find(function(s) { return s.state === "active"; });
                
                if (saved.sprintId && sprints.some(function(s) { return s.id == saved.sprintId; })) {
                    selectSprint(saved.sprintId);
                } else if (active) {
                    selectSprint(active.id);
                } else if (sprints.length > 0) {
                    selectSprint(sprints[0].id);
                }
                
                log("Загружено спринтов: " + sprints.length);
            });
        }

        function selectSprint(id) {
            var sprint = state.sprints.find(function(s) { return s.id == id; });
            if (!sprint) return;
            state.selectedSprintId = id;
            $sprintInput.val(sprint.name);
            hideSprintDropdown();
            loadSprintData(id);
        }

        function loadSprintData(id) {
            state.loading = true;
            saveSettings({ boardId: state.selectedBoardId, sprintId: id });
            $cont.html('<div class="ujg-loading">⏳ Загрузка данных спринта...</div>');
            
            $.when(api.getSprint(id), api.getSprintIssues(id)).then(function(sprintResp, issuesResp) {
                state.sprint = sprintResp[0] || sprintResp;
                state.issues = (issuesResp[0] || issuesResp).issues || [];
                calculate();
                render();
                state.loading = false;
            });
        }

        function calculate() {
            var issues = state.issues, m = state.metrics = {};
            m.total = issues.length;
            m.totalHours = m.estimated = m.withDates = m.assigned = m.done = 0;
            
            state.problems = [];
            var now = new Date();
            
            issues.forEach(function(iss) {
                var f = iss.fields || {};
                var est = (f.timetracking && f.timetracking.originalEstimateSeconds) || f.timeoriginalestimate || 0;
                var isDone = isIssueDone(f.status);
                
                if (est > 0) { m.estimated++; m.totalHours += est; }
                if (f.duedate) m.withDates++;
                if (f.assignee) m.assigned++;
                if (isDone) m.done++;
                
                // Проблемы
                var sprints = f.customfield_10020 || []; // Sprint field
                var sprintCount = Array.isArray(sprints) ? sprints.length : 0;
                var statusTime = utils.daysDiff(utils.parseDate(f.updated), now);
                
                var prob = null;
                if (!est && !isDone) prob = { type: "noest", label: "Без оценки" };
                else if (!f.assignee && !isDone) prob = { type: "noasgn", label: "Без исполнителя" };
                else if (est > CONFIG.maxHours * 3600) prob = { type: "big", label: "Большая задача" };
                else if (f.duedate && utils.parseDate(f.duedate) < now && !isDone) prob = { type: "overdue", label: "Просрочено" };
                else if (sprintCount > 2) prob = { type: "rollover", label: "Переносы: " + sprintCount };
                
                if (prob) {
                    state.problems.push({
                        key: iss.key,
                        summary: f.summary || "",
                        status: f.status ? f.status.name : "",
                        statusCategory: f.status && f.status.statusCategory ? f.status.statusCategory.key : "",
                        statusTime: statusTime,
                        sprintCount: sprintCount,
                        estimate: est,
                        assignee: f.assignee ? f.assignee.displayName : null,
                        priority: f.priority ? f.priority.name : "",
                        type: f.issuetype ? f.issuetype.name : "",
                        created: utils.parseDate(f.created),
                        updated: utils.parseDate(f.updated),
                        dueDate: utils.parseDate(f.duedate),
                        probType: prob.type,
                        probLabel: prob.label
                    });
                }
            });
            
            m.estPct = m.total > 0 ? Math.round(m.estimated / m.total * 100) : 0;
            m.datesPct = m.total > 0 ? Math.round(m.withDates / m.total * 100) : 0;
            m.asgnPct = m.total > 0 ? Math.round(m.assigned / m.total * 100) : 0;
            m.donePct = m.total > 0 ? Math.round(m.done / m.total * 100) : 0;
            m.health = Math.round((m.estPct + m.datesPct + m.asgnPct) / 3);
            
            calculateBurnup();
            groupByAssignee();
        }

        function isIssueDone(st) {
            if (!st) return false;
            var n = (st.name || "").toLowerCase();
            return ["done","closed","resolved","готово","закрыт","завершён","выполнено"].some(function(s) { return n.indexOf(s) >= 0; });
        }

        function calculateBurnup() {
            var sp = state.sprint;
            if (!sp || !sp.startDate || !sp.endDate) { state.burnupData = []; return; }
            
            var start = utils.parseDate(sp.startDate), end = utils.parseDate(sp.endDate);
            var days = utils.daysBetween(start, end);
            var now = new Date();
            
            var data = [], scopeByDay = {}, doneByDay = {};
            var totalTasks = state.metrics.total, totalHours = state.metrics.totalHours;
            
            // Собираем данные по дням
            state.issues.forEach(function(iss) {
                var f = iss.fields || {};
                var created = utils.parseDate(f.created);
                var resolved = utils.parseDate(f.resolutiondate);
                var est = (f.timetracking && f.timetracking.originalEstimateSeconds) || f.timeoriginalestimate || 0;
                
                days.forEach(function(day) {
                    var dk = utils.getDayKey(day);
                    if (!scopeByDay[dk]) scopeByDay[dk] = { tasks: 0, hours: 0 };
                    if (!doneByDay[dk]) doneByDay[dk] = { tasks: 0, hours: 0 };
                    
                    // Scope: задача создана до этого дня или в этот день
                    if (created && created <= day) {
                        scopeByDay[dk].tasks++;
                        scopeByDay[dk].hours += est;
                    }
                    
                    // Done: задача закрыта до этого дня или в этот день
                    if (resolved && resolved <= day && isIssueDone(f.status)) {
                        doneByDay[dk].tasks++;
                        doneByDay[dk].hours += est;
                    }
                });
            });
            
            days.forEach(function(day, idx) {
                var dk = utils.getDayKey(day);
                var isPast = day <= now;
                var idealTasks = Math.round(totalTasks * (idx + 1) / days.length);
                var idealHours = Math.round(totalHours * (idx + 1) / days.length);
                
                data.push({
                    date: day,
                    label: utils.formatDateShort(day),
                    scopeTasks: isPast ? (scopeByDay[dk] ? scopeByDay[dk].tasks : totalTasks) : null,
                    scopeHours: isPast ? (scopeByDay[dk] ? scopeByDay[dk].hours : totalHours) : null,
                    doneTasks: isPast ? (doneByDay[dk] ? doneByDay[dk].tasks : 0) : null,
                    doneHours: isPast ? (doneByDay[dk] ? doneByDay[dk].hours : 0) : null,
                    idealTasks: idealTasks,
                    idealHours: idealHours,
                    isToday: utils.getDayKey(day) === utils.getDayKey(now)
                });
            });
            
            state.burnupData = data;
        }

        function groupByAssignee() {
            var map = {}, unassigned = { id: "__none__", name: "Не назначено", issues: [], hours: 0 };
            state.issues.forEach(function(iss) {
                var f = iss.fields || {};
                var est = (f.timetracking && f.timetracking.originalEstimateSeconds) || f.timeoriginalestimate || 0;
                var item = { key: iss.key, summary: f.summary, status: f.status ? f.status.name : "", statusCat: f.status && f.status.statusCategory ? f.status.statusCategory.key : "", est: est, due: utils.parseDate(f.duedate), isDone: isIssueDone(f.status) };
                
                if (f.assignee) {
                    var aid = f.assignee.accountId || f.assignee.key;
                    if (!map[aid]) map[aid] = { id: aid, name: f.assignee.displayName || aid, issues: [], hours: 0 };
                    map[aid].issues.push(item);
                    map[aid].hours += est;
                } else {
                    unassigned.issues.push(item);
                    unassigned.hours += est;
                }
            });
            var arr = Object.values(map).sort(function(a, b) { return a.name.localeCompare(b.name); });
            if (unassigned.issues.length > 0) arr.push(unassigned);
            state.byAssignee = arr;
        }

        function updateBoardSelect() {
            $boardSelect.empty().append('<option value="">Доска</option>');
            state.boards.forEach(function(b) { $boardSelect.append('<option value="' + b.id + '">' + utils.escapeHtml(b.name) + '</option>'); });
        }

        function updateSprintDropdown() {
            var html = '';
            state.filteredSprints.slice(0, 50).forEach(function(s) {
                var icon = s.state === "active" ? "●" : s.state === "future" ? "○" : "✓";
                var cls = s.state === "active" ? "ujg-active" : "";
                html += '<div class="ujg-dd-item ' + cls + '" data-id="' + s.id + '">' + icon + ' ' + utils.escapeHtml(s.name) + '</div>';
            });
            if (state.filteredSprints.length > 50) html += '<div class="ujg-dd-more">...ещё ' + (state.filteredSprints.length - 50) + '</div>';
            $sprintDropdown.html(html || '<div class="ujg-dd-empty">Не найдено</div>');
        }

        function filterSprints(q) {
            q = q.toLowerCase();
            state.filteredSprints = state.sprints.filter(function(s) { return s.name.toLowerCase().indexOf(q) >= 0; });
            updateSprintDropdown();
        }

        function showSprintDropdown() { $sprintDropdown.addClass("ujg-show"); }
        function hideSprintDropdown() { $sprintDropdown.removeClass("ujg-show"); }

        function render() {
            if (state.issues.length === 0) { $cont.html('<div class="ujg-loading">Нет задач в спринте</div>'); API.resize(); return; }
            
            var html = '';
            html += renderHealth();
            html += renderMetrics();
            html += renderBurnup();
            html += renderProblems();
            html += renderAssignees();
            html += renderTable();
            
            $cont.html(html);
            bindEvents();
            API.resize();
        }

        function renderHealth() {
            var m = state.metrics, c = utils.getHealthColor(m.health);
            return '<div class="ujg-health"><div class="ujg-hbar"><div class="ujg-hfill" style="width:' + m.health + '%;background:' + c + '"></div></div>' +
                '<span class="ujg-hpct" style="color:' + c + '">' + m.health + '%</span><span class="ujg-hlbl">' + utils.getHealthLabel(m.health) + '</span></div>';
        }

        function renderMetrics() {
            var m = state.metrics;
            return '<div class="ujg-mrow">' +
                '<div class="ujg-m"><span class="ujg-mi">📊</span><span class="ujg-mv">' + utils.formatHours(m.totalHours) + '</span><span class="ujg-ml">' + m.total + ' задач</span></div>' +
                '<div class="ujg-m" style="border-color:' + utils.getHealthColor(m.estPct) + '"><span class="ujg-mi">📝</span><span class="ujg-mv">' + m.estPct + '%</span><span class="ujg-ml">Оценки ' + m.estimated + '/' + m.total + '</span></div>' +
                '<div class="ujg-m" style="border-color:' + utils.getHealthColor(m.datesPct) + '"><span class="ujg-mi">📅</span><span class="ujg-mv">' + m.datesPct + '%</span><span class="ujg-ml">Сроки ' + m.withDates + '/' + m.total + '</span></div>' +
                '<div class="ujg-m" style="border-color:' + utils.getHealthColor(m.asgnPct) + '"><span class="ujg-mi">👤</span><span class="ujg-mv">' + m.asgnPct + '%</span><span class="ujg-ml">Исполн. ' + m.assigned + '/' + m.total + '</span></div>' +
                '<div class="ujg-m" style="border-color:' + utils.getHealthColor(m.donePct) + '"><span class="ujg-mi">✅</span><span class="ujg-mv">' + m.donePct + '%</span><span class="ujg-ml">Готово ' + m.done + '/' + m.total + '</span></div>' +
            '</div>';
        }

        function renderBurnup() {
            var data = state.burnupData;
            if (!data || data.length === 0) return '';
            
            var isHours = state.chartMode === "hours";
            var maxScope = Math.max.apply(null, data.map(function(d) { return isHours ? (d.scopeHours || 0) : (d.scopeTasks || 0); }));
            var maxVal = Math.max(maxScope, isHours ? state.metrics.totalHours : state.metrics.total) || 1;
            
            var h = 180, padding = 40;
            
            var html = '<div class="ujg-chart-wrap">';
            html += '<div class="ujg-chart-hdr">';
            html += '<span class="ujg-chart-title">Burnup Chart</span>';
            html += '<div class="ujg-toggle"><span class="ujg-tog ' + (!isHours ? "on" : "") + '" data-mode="tasks">Задачи</span><span class="ujg-tog ' + (isHours ? "on" : "") + '" data-mode="hours">Часы</span></div>';
            html += '<div class="ujg-legend">';
            html += '<span class="ujg-leg"><i style="background:#ef5350"></i>Объём</span>';
            html += '<span class="ujg-leg"><i style="background:#66bb6a"></i>Выполнено</span>';
            html += '<span class="ujg-leg"><i style="background:#bdbdbd"></i>План</span>';
            html += '</div></div>';
            
            html += '<div class="ujg-chart-body">';
            html += '<svg class="ujg-svg" viewBox="0 0 100 ' + h + '" preserveAspectRatio="none">';
            
            // Сетка
            for (var i = 0; i <= 4; i++) {
                var y = padding + (h - padding * 2) * i / 4;
                html += '<line x1="0" y1="' + y + '" x2="100" y2="' + y + '" stroke="#e0e0e0" stroke-width="0.2"/>';
            }
            
            // Находим индекс "сегодня"
            var todayIdx = data.findIndex(function(d) { return d.isToday; });
            if (todayIdx >= 0) {
                var todayX = (todayIdx + 0.5) / data.length * 100;
                html += '<line x1="' + todayX + '" y1="' + padding + '" x2="' + todayX + '" y2="' + (h - padding) + '" stroke="#9e9e9e" stroke-width="0.3" stroke-dasharray="1,1"/>';
                html += '<text x="' + todayX + '" y="' + (padding - 5) + '" text-anchor="middle" font-size="3" fill="#666">Сегодня</text>';
            }
            
            var scopePts = [], donePts = [], idealPts = [];
            
            data.forEach(function(d, idx) {
                var x = (idx + 0.5) / data.length * 100;
                var scopeV = isHours ? d.scopeHours : d.scopeTasks;
                var doneV = isHours ? d.doneHours : d.doneTasks;
                var idealV = isHours ? d.idealHours : d.idealTasks;
                
                if (scopeV !== null) {
                    var yS = padding + (h - padding * 2) * (1 - scopeV / maxVal);
                    scopePts.push(x + "," + yS);
                }
                if (doneV !== null) {
                    var yD = padding + (h - padding * 2) * (1 - doneV / maxVal);
                    donePts.push(x + "," + yD);
                }
                var yI = padding + (h - padding * 2) * (1 - idealV / maxVal);
                idealPts.push(x + "," + yI);
            });
            
            // Идеальная линия (серая)
            html += '<polyline points="' + idealPts.join(" ") + '" fill="none" stroke="#bdbdbd" stroke-width="0.5"/>';
            
            // Scope (красная)
            if (scopePts.length > 0) {
                html += '<polyline points="' + scopePts.join(" ") + '" fill="none" stroke="#ef5350" stroke-width="0.7"/>';
                scopePts.forEach(function(p) { var c = p.split(","); html += '<circle cx="' + c[0] + '" cy="' + c[1] + '" r="0.8" fill="#ef5350"/>'; });
            }
            
            // Done (зелёная)
            if (donePts.length > 0) {
                html += '<polyline points="' + donePts.join(" ") + '" fill="none" stroke="#66bb6a" stroke-width="0.7"/>';
                donePts.forEach(function(p) { var c = p.split(","); html += '<circle cx="' + c[0] + '" cy="' + c[1] + '" r="0.8" fill="#66bb6a"/>'; });
            }
            
            html += '</svg>';
            
            // Ось X - даты
            html += '<div class="ujg-xaxis">';
            data.forEach(function(d, idx) {
                if (idx % Math.ceil(data.length / 10) === 0 || idx === data.length - 1) {
                    html += '<span style="left:' + ((idx + 0.5) / data.length * 100) + '%">' + d.label + '</span>';
                }
            });
            html += '</div>';
            
            // Ось Y
            html += '<div class="ujg-yaxis">';
            for (var i = 0; i <= 4; i++) {
                var val = Math.round(maxVal * (4 - i) / 4);
                html += '<span style="top:' + (i * 25) + '%">' + (isHours ? utils.formatHoursShort(val * 3600) : val) + '</span>';
            }
            html += '</div>';
            
            html += '</div></div>';
            return html;
        }

        function renderProblems() {
            var probs = state.problems;
            if (probs.length === 0) return '<div class="ujg-ok">✅ Проблем не обнаружено</div>';
            
            var html = '<div class="ujg-probs">';
            html += '<div class="ujg-section-title">⚠️ Проблемы (' + probs.length + ')</div>';
            html += '<table class="ujg-prob-tbl"><thead><tr><th>Ключ</th><th>Тема</th><th>Статус</th><th>В статусе</th><th>Спринты</th><th>Проблема</th></tr></thead><tbody>';
            
            probs.forEach(function(p) {
                var statusCls = "ujg-st-" + p.statusCategory;
                html += '<tr class="ujg-prob-row" data-key="' + p.key + '">';
                html += '<td><a href="' + baseUrl + '/browse/' + p.key + '" target="_blank">' + p.key + '</a></td>';
                html += '<td class="ujg-prob-sum" title="' + utils.escapeHtml(p.summary) + '">' + utils.escapeHtml(p.summary.substring(0, 40)) + (p.summary.length > 40 ? "…" : "") + '</td>';
                html += '<td><span class="ujg-st ' + statusCls + '">' + utils.escapeHtml(p.status) + '</span></td>';
                html += '<td>' + p.statusTime + ' дн.</td>';
                html += '<td>' + (p.sprintCount > 1 ? '<span class="ujg-rollover">' + p.sprintCount + '</span>' : '1') + '</td>';
                html += '<td><span class="ujg-prob-type ujg-prob-' + p.probType + '">' + p.probLabel + '</span></td>';
                html += '</tr>';
            });
            
            html += '</tbody></table>';
            html += '<div class="ujg-tooltip" id="ujgTooltip"></div>';
            html += '</div>';
            return html;
        }

        function renderAssignees() {
            var data = state.byAssignee;
            if (!data || data.length === 0) return '';
            var maxH = Math.max.apply(null, data.map(function(a) { return a.hours; })) || 1;
            
            var html = '<div class="ujg-asgn-wrap"><div class="ujg-section-title">👥 Распределение (' + data.length + ')</div><div class="ujg-asgn-list">';
            data.forEach(function(a) {
                var pct = Math.round(a.hours / maxH * 100);
                html += '<div class="ujg-asgn"><span class="ujg-asgn-name">' + utils.escapeHtml(a.name) + '</span>' +
                    '<div class="ujg-asgn-bar"><div class="ujg-asgn-fill" style="width:' + pct + '%"></div></div>' +
                    '<span class="ujg-asgn-val">' + utils.formatHours(a.hours) + ' (' + a.issues.length + ')</span></div>';
            });
            return html + '</div></div>';
        }

        function renderTable() {
            var data = state.byAssignee;
            if (!data || data.length === 0) return '';
            var days = state.sprint ? utils.daysBetween(utils.parseDate(state.sprint.startDate), utils.parseDate(state.sprint.endDate)) : [];
            
            var html = '<div class="ujg-tbl-wrap"><table class="ujg-tbl"><thead><tr><th>Ключ</th><th>Задача</th><th>Ч</th><th>Срок</th><th>Статус</th><th>Gantt</th></tr></thead><tbody>';
            
            data.forEach(function(a) {
                html += '<tr class="ujg-grp" data-aid="' + a.id + '"><td colspan="6"><b>' + utils.escapeHtml(a.name) + '</b> <span>(' + utils.formatHours(a.hours) + ', ' + a.issues.length + ')</span></td></tr>';
                a.issues.forEach(function(iss) {
                    html += '<tr class="ujg-row" data-aid="' + a.id + '">';
                    html += '<td><a href="' + baseUrl + '/browse/' + iss.key + '" target="_blank" class="' + (iss.isDone ? "ujg-done" : "") + '">' + iss.key + '</a></td>';
                    html += '<td title="' + utils.escapeHtml(iss.summary) + '">' + utils.escapeHtml((iss.summary || "").substring(0, 35)) + '</td>';
                    html += '<td>' + (iss.est > 0 ? utils.formatHoursShort(iss.est) : "—") + '</td>';
                    html += '<td>' + utils.formatDateShort(iss.due) + '</td>';
                    html += '<td><span class="ujg-st ujg-st-' + iss.statusCat + '">' + utils.escapeHtml((iss.status || "").substring(0, 8)) + '</span></td>';
                    html += '<td>' + renderGantt(iss, days) + '</td></tr>';
                });
            });
            return html + '</tbody></table></div>';
        }

        function renderGantt(iss, days) {
            if (!days.length) return '';
            var html = '<div class="ujg-gantt">';
            days.forEach(function(d) {
                var cls = "ujg-gc";
                if (iss.due && d <= iss.due) {
                    cls += iss.isDone ? " ujg-gd" : (iss.statusCat === "indeterminate" ? " ujg-gp" : " ujg-gt");
                }
                html += '<div class="' + cls + '"></div>';
            });
            return html + '</div>';
        }

        function showTooltip($row, issueKey) {
            var $tip = $("#ujgTooltip");
            $tip.html("Загрузка...").addClass("ujg-show");
            
            var offset = $row.offset();
            $tip.css({ top: offset.top + $row.height() + 5, left: offset.left });
            
            api.getIssue(issueKey).then(function(data) {
                var f = data.fields || {};
                var html = '<div class="ujg-tip-hdr"><b>' + data.key + '</b>: ' + utils.escapeHtml(f.summary) + '</div>';
                html += '<div class="ujg-tip-row"><b>Тип:</b> ' + (f.issuetype ? f.issuetype.name : "—") + ' | <b>Приоритет:</b> ' + (f.priority ? f.priority.name : "—") + '</div>';
                html += '<div class="ujg-tip-row"><b>Статус:</b> ' + (f.status ? f.status.name : "—") + '</div>';
                html += '<div class="ujg-tip-row"><b>Исполнитель:</b> ' + (f.assignee ? f.assignee.displayName : "—") + '</div>';
                html += '<div class="ujg-tip-row"><b>Оценка:</b> ' + utils.formatHours((f.timetracking && f.timetracking.originalEstimateSeconds) || f.timeoriginalestimate || 0) + ' | <b>Затрачено:</b> ' + utils.formatHours(f.timespent || 0) + '</div>';
                html += '<div class="ujg-tip-row"><b>Создано:</b> ' + utils.formatDateFull(utils.parseDate(f.created)) + ' | <b>Обновлено:</b> ' + utils.formatDateFull(utils.parseDate(f.updated)) + '</div>';
                if (f.duedate) html += '<div class="ujg-tip-row"><b>Срок:</b> ' + utils.formatDateFull(utils.parseDate(f.duedate)) + '</div>';
                if (f.description) html += '<div class="ujg-tip-desc">' + utils.escapeHtml(f.description.substring(0, 200)) + (f.description.length > 200 ? "..." : "") + '</div>';
                
                $tip.html(html);
            });
        }

        function hideTooltip() { $("#ujgTooltip").removeClass("ujg-show"); }

        function bindEvents() {
            $cont.find(".ujg-tog").on("click", function() {
                var mode = $(this).data("mode");
                if (mode !== state.chartMode) { state.chartMode = mode; render(); }
            });
            $cont.find(".ujg-grp").on("click", function() {
                var aid = $(this).data("aid");
                $cont.find('.ujg-row[data-aid="' + aid + '"]').toggle();
            });
            
            var hoverTimer;
            $cont.find(".ujg-prob-row").on("mouseenter", function() {
                var $row = $(this), key = $row.data("key");
                hoverTimer = setTimeout(function() { showTooltip($row, key); }, 500);
            }).on("mouseleave", function() {
                clearTimeout(hoverTimer);
                hideTooltip();
            });
        }

        function initPanel() {
            var $panel = $('<div class="ujg-panel"></div>');
            
            $boardSelect = $('<select class="ujg-sel"><option value="">Доска</option></select>');
            $boardSelect.on("change", function() { if ($(this).val()) loadSprints($(this).val()); });
            
            var $sprintWrap = $('<div class="ujg-dd-wrap"></div>');
            $sprintInput = $('<input type="text" class="ujg-input" placeholder="Поиск спринта...">');
            $sprintDropdown = $('<div class="ujg-dd"></div>');
            
            $sprintInput.on("focus", showSprintDropdown).on("input", function() { filterSprints($(this).val()); showSprintDropdown(); });
            $sprintInput.on("keydown", function(e) {
                if (e.key === "Escape") { hideSprintDropdown(); $(this).blur(); }
                if (e.key === "Enter" && state.filteredSprints[0]) selectSprint(state.filteredSprints[0].id);
            });
            $sprintDropdown.on("click", ".ujg-dd-item", function() { selectSprint($(this).data("id")); });
            $(document).on("click", function(e) { if (!$(e.target).closest(".ujg-dd-wrap").length) hideSprintDropdown(); });
            
            $sprintWrap.append($sprintInput, $sprintDropdown);
            
            $refreshBtn = $('<button class="ujg-btn" title="Обновить">🔄</button>');
            $refreshBtn.on("click", function() { if (state.selectedSprintId) loadSprintData(state.selectedSprintId); });
            
            $fsBtn = $('<button class="ujg-btn ujg-btn-fs" title="На весь экран">⛶</button>');
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
