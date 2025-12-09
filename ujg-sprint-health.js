/**
 * UJG Sprint Health — Виджет оценки качества планирования спринта
 * Версия: 1.2.0
 */
define("_ujgSprintHealth", ["jquery"], function($) {
    "use strict";

    var CONFIG = { version: "1.3.0", debug: true, maxHours: 16, capacityPerPerson: 40, hoursPerDay: 8, startDateField: "customfield_XXXXX", allowEditDates: true };
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
        formatDateJira: function(d) { if (!d) return ""; var dd = utils.startOfDay(d); return dd ? utils.getDayKey(dd) : ""; },
        daysBetween: function(start, end) {
            var res = [], cur = new Date(start); cur.setHours(0,0,0,0);
            var ed = new Date(end); ed.setHours(0,0,0,0);
            while (cur <= ed) { if (cur.getDay() !== 0 && cur.getDay() !== 6) res.push(new Date(cur)); cur.setDate(cur.getDate() + 1); }
            return res;
        },
        daysDiff: function(d1, d2) { if (!d1 || !d2) return 0; return Math.floor((d2 - d1) / (1000 * 60 * 60 * 24)); },
        startOfDay: function(d) { if (!d) return null; var nd = new Date(d); nd.setHours(0,0,0,0); return nd; },
        shiftWorkDays: function(date, delta) {
            if (!date) return null;
            var d = utils.startOfDay(date);
            var step = delta >= 0 ? 1 : -1;
            var remain = Math.abs(delta);
            while (remain > 0) {
                d.setDate(d.getDate() + step);
                if (d.getDay() !== 0 && d.getDay() !== 6) remain--;
            }
            return d;
        },
        getWorkDurationDays: function(seconds, hoursPerDay) {
            if (!seconds || seconds <= 0) return 1;
            var hpd = hoursPerDay && hoursPerDay > 0 ? hoursPerDay : 8;
            return Math.max(1, Math.ceil(seconds / (hpd * 3600)));
        },
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
                data: { fields: "summary,status,assignee,priority,issuetype,timeoriginalestimate,timetracking,duedate,created,updated,description,resolutiondate,customfield_10020", expand: "changelog", maxResults: 500 }
            });
        },
        getIssue: function(key) {
            return $.ajax({
                url: baseUrl + "/rest/api/2/issue/" + key,
                data: { fields: "summary,status,assignee,priority,issuetype,timeoriginalestimate,timetracking,timespent,duedate,created,updated,description,resolutiondate,comment,changelog,worklog,customfield_10020," + CONFIG.startDateField, expand: "changelog" }
            });
        },
        getIssueChangelog: function(key) {
            return $.ajax({
                url: baseUrl + "/rest/api/2/issue/" + key,
                data: { fields: "assignee", expand: "changelog" }
            });
        },
        getIssueWorklog: function(key) {
            return $.ajax({
                url: baseUrl + "/rest/api/2/issue/" + key + "/worklog",
                data: { maxResults: 1000, startAt: 0 }
            });
        },
        getBoardTeams: function(boardId) {
            return $.ajax({
                url: baseUrl + "/rest/agile/1.0/board/" + boardId + "/properties/ujgTeams"
            });
        },
        setBoardTeams: function(boardId, payload) {
            return $.ajax({
                url: baseUrl + "/rest/agile/1.0/board/" + boardId + "/properties/ujgTeams",
                type: "PUT",
                contentType: "application/json",
                data: JSON.stringify(payload)
            });
        },
        updateIssueDue: function(key, dueDateStr) {
            return $.ajax({
                url: baseUrl + "/rest/api/2/issue/" + key,
                type: "PUT",
                contentType: "application/json",
                data: JSON.stringify({ fields: { duedate: dueDateStr } })
            });
        }
    };

    function SprintHealthGadget(API) {
        var state = {
            boards: [], sprints: [], filteredSprints: [],
            selectedBoardId: null, selectedSprintId: null,
            sprint: null, issues: [], loading: false, isFullscreen: false,
            chartMode: "tasks", // tasks или hours
            metrics: {}, burnupData: [], byAssignee: [], problems: [], issueMap: {},
            teams: {}, teamKey: "", teamMembers: []
        };

        var $content = API.getGadgetContentEl();
        var $cont = $content.find(".ujg-sprint-health");
        if ($cont.length === 0) { $cont = $('<div class="ujg-sprint-health"></div>'); $content.append($cont); }

        var $boardSelect, $sprintInput, $sprintDropdown, $refreshBtn, $fsBtn;

        function log(msg) { if (CONFIG.debug) console.log("[UJG]", msg); }

        function ensureFullWidth() {
            var $wrap = $content.closest(".dashboard-item-content, .gadget, .ajs-gadget, .aui-page-panel, .dashboard-item");
            var $targets = $wrap.add($content).add($cont);
            $targets.css({ width: "100%", maxWidth: "none", flex: "1 1 auto" });
            if ($wrap.length) $wrap.addClass("ujg-wide-container");
        }

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
            
            loadTeams(boardId);
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
                updateTeamKey();
                enrichIssues(state.issues).always(function() {
                    calculate();
                    render();
                    state.loading = false;
                });
            });
        }

        function enrichIssues(issues) {
            if (!issues || issues.length === 0) return $.Deferred().resolve().promise();
            var tasks = [];
            issues.forEach(function(iss) {
                var w = api.getIssueWorklog(iss.key).then(function(res) {
                    iss._worklog = res && res.worklogs ? res.worklogs : [];
                }, function() { iss._worklog = []; });
                var c = api.getIssueChangelog(iss.key).then(function(res) {
                    iss._changelog = res && res.changelog ? res.changelog : {};
                }, function() { iss._changelog = {}; });
                tasks.push($.when(w, c));
            });
            return $.when.apply($, tasks);
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
            var start = utils.startOfDay(utils.parseDate(sp.startDate));
            var end = utils.startOfDay(utils.parseDate(sp.endDate));
            if (!start || !end) { state.burnupData = []; return; }
            var days = utils.daysBetween(start, end);
            var now = utils.startOfDay(new Date());
            var sprintId = sp.id;
            
            // Подготовка данных по задачам
            var issuesInfo = state.issues.map(function(iss) {
                var f = iss.fields || {};
                var estSec = (f.timetracking && f.timetracking.originalEstimateSeconds) || f.timeoriginalestimate || 0;
                var resolved = utils.startOfDay(utils.parseDate(f.resolutiondate));
                var isDone = isIssueDone(f.status);
                
                // Дата входа/выхода в спринт по changelog (по полю Sprint)
                var addDate = start, removeDate = null;
                var ch = iss.changelog || iss._changelog || {};
                (ch.histories || []).forEach(function(h) {
                    var hd = utils.startOfDay(utils.parseDate(h.created));
                    (h.items || []).forEach(function(it) {
                        if ((it.field || "").toLowerCase() === "sprint") {
                            var fromHas = it.from && it.from.indexOf && it.from.indexOf(sprintId) >= 0;
                            var toHas = it.to && it.to.indexOf && it.to.indexOf(sprintId) >= 0;
                            // Jira cloud often stores ids in to/from as string with sprint ids like "123,456"
                            var fromStr = it.fromString || "";
                            var toStr = it.toString || "";
                            if (!fromHas && !toHas) {
                                fromHas = fromStr.indexOf(String(sprintId)) >= 0;
                                toHas = toStr.indexOf(String(sprintId)) >= 0;
                            }
                            if (toHas && !fromHas) { addDate = hd || addDate; }
                            if (fromHas && !toHas) { removeDate = hd || removeDate; }
                        }
                    });
                });
                if (addDate < start) addDate = start;
                if (removeDate && removeDate < addDate) removeDate = null;
                
                // Worklog по дням (в секундах)
                var wlByDay = {};
                if (iss._worklog && Array.isArray(iss._worklog)) {
                    iss._worklog.forEach(function(wl) {
                        var wd = utils.startOfDay(utils.parseDate(wl.started));
                        if (!wd) return;
                        if (wd < start || wd > end) return;
                        var dk = utils.getDayKey(wd);
                        wlByDay[dk] = (wlByDay[dk] || 0) + (wl.timeSpentSeconds || 0);
                    });
                }
                
                return {
                    key: iss.key,
                    estSec: estSec,
                    resolved: resolved,
                    isDone: isDone,
                    addDate: addDate,
                    removeDate: removeDate,
                    wlByDay: wlByDay
                };
            });
            
            var data = [];
            var finalScopeTasks = 0, finalScopeHours = 0;
            var cumLoggedCache = {}; // key -> {dk:cumSec}
            
            days.forEach(function(day, idx) {
                var dk = utils.getDayKey(day);
                var scopeTasks = 0, scopeHours = 0;
                var doneTasks = 0, doneHoursSec = 0;
                
                issuesInfo.forEach(function(info) {
                    var inScope = day >= info.addDate && (!info.removeDate || day <= info.removeDate);
                    if (!inScope) return;
                    
                    scopeTasks += 1;
                    scopeHours += info.estSec / 3600; // в часах
                    
                    // logged cumulative до дня включительно
                    if (!cumLoggedCache[info.key]) cumLoggedCache[info.key] = {};
                    var cumLog = cumLoggedCache[info.key][dk];
                    if (cumLog === undefined) {
                        var keys = Object.keys(info.wlByDay).sort();
                        var sum = 0;
                        keys.forEach(function(k) {
                            if (k <= dk) sum += info.wlByDay[k];
                        });
                        cumLog = sum;
                        cumLoggedCache[info.key][dk] = cumLog;
                    }
                    doneHoursSec += cumLog;
                    
                    if (info.isDone && info.resolved && info.resolved <= day) {
                        doneTasks += 1;
                    }
                });
                
                if (scopeTasks > finalScopeTasks) finalScopeTasks = scopeTasks;
                if (scopeHours > finalScopeHours) finalScopeHours = scopeHours;
                
                data.push({
                    date: day,
                    label: utils.formatDateShort(day),
                    scopeTasks: scopeTasks,
                    scopeHours: scopeHours,
                    doneTasks: doneTasks,
                    doneHours: doneHoursSec / 3600,
                    isToday: utils.getDayKey(day) === utils.getDayKey(now)
                });
            });
            
            // Идеальные линии
            data.forEach(function(d, idx) {
                d.idealTasks = Math.round(finalScopeTasks * (idx + 1) / data.length);
                d.idealHours = Math.round(finalScopeHours * (idx + 1) / data.length);
            });
            
            state.burnupData = data;
        }

        function groupByAssignee() {
            var map = {}, issueMap = {}, outside = { id: "__outside__", name: "Вне команды", issues: [], hours: 0 };
            var sprintStart = state.sprint ? utils.startOfDay(utils.parseDate(state.sprint.startDate)) : null;
            var sprintEnd = state.sprint ? utils.startOfDay(utils.parseDate(state.sprint.endDate)) : null;
            var teamMembers = state.teamMembers || [];
            state.issues.forEach(function(iss) {
                var f = iss.fields || {};
                var est = (f.timetracking && f.timetracking.originalEstimateSeconds) || f.timeoriginalestimate || 0;
                var due = utils.startOfDay(utils.parseDate(f.duedate) || (state.sprint ? utils.parseDate(state.sprint.endDate) : null));
                var durationDays = utils.getWorkDurationDays(est, CONFIG.hoursPerDay);
                var start = due ? utils.shiftWorkDays(due, -(durationDays - 1)) :
                    (state.sprint ? utils.startOfDay(utils.parseDate(state.sprint.startDate)) : null) ||
                    utils.startOfDay(utils.parseDate(f.created));
                var workAuthors = [];
                var pastAssignees = [];
                // Worklogs за период спринта
                if (iss._worklog && Array.isArray(iss._worklog)) {
                    var wlMap = {};
                    iss._worklog.forEach(function(wl) {
                        var wd = utils.startOfDay(utils.parseDate(wl.started));
                        if (sprintStart && sprintEnd) {
                            if (!wd || wd < sprintStart || wd > sprintEnd) return;
                        }
                        var author = wl.author || {};
                        var aid = author.accountId || author.key || (author.displayName || "unknown");
                        if (!wlMap[aid]) wlMap[aid] = { id: aid, name: author.displayName || aid, seconds: 0 };
                        wlMap[aid].seconds += wl.timeSpentSeconds || 0;
                    });
                    workAuthors = Object.values(wlMap).sort(function(a, b) { return b.seconds - a.seconds; });
                }
                // История ассайнов в пределах спринта
                var historyAssignees = [];
                if (iss._changelog && Array.isArray(iss._changelog.histories)) {
                    var seen = {};
                    iss._changelog.histories.forEach(function(h) {
                        var hd = utils.startOfDay(utils.parseDate(h.created));
                        if (sprintStart && sprintEnd) {
                            if (!hd || hd < sprintStart || hd > sprintEnd) return;
                        }
                        (h.items || []).forEach(function(it) {
                            if (it.field && it.field.toLowerCase() === "assignee") {
                                if (it.from && !seen[it.from]) { historyAssignees.push(it.from); seen[it.from] = true; }
                                if (it.to && !seen[it.to]) { historyAssignees.push(it.to); seen[it.to] = true; }
                            }
                        });
                    });
                }
                var item = {
                    key: iss.key,
                    summary: f.summary,
                    status: f.status ? f.status.name : "",
                    statusCat: f.status && f.status.statusCategory ? f.status.statusCategory.key : "",
                    est: est,
                    start: start,
                    due: due,
                    created: utils.parseDate(f.created),
                    hasDates: !!f.duedate,
                    isDone: isIssueDone(f.status),
                    workAuthors: workAuthors,
                    pastAssignees: pastAssignees,
                    assignee: assigneeId ? { id: assigneeId, name: assigneeName } : null,
                    outsideUser: null
                };
                issueMap[item.key] = item;
                
                var assigneeId = f.assignee ? (f.assignee.accountId || f.assignee.key) : null;
                var assigneeName = f.assignee ? (f.assignee.displayName || assigneeId) : null;
                var displayUser = null;
                var fallbackUser = assigneeId ? { id: assigneeId, name: assigneeName } : (workAuthors[0] ? { id: workAuthors[0].id, name: workAuthors[0].name } : null);
                // 1) текущий ассайн в команде
                if (assigneeId && teamMembers.indexOf(assigneeId) >= 0) {
                    displayUser = { id: assigneeId, name: assigneeName };
                }
                // 2) worklog автор из команды
                if (!displayUser) {
                    var teamAuthor = workAuthors.find(function(w) { return w.id && teamMembers.indexOf(w.id) >= 0; });
                    if (teamAuthor) displayUser = { id: teamAuthor.id, name: teamAuthor.name };
                }
                // 3) assignee из истории в команде
                if (!displayUser && historyAssignees.length > 0) {
                    var histMember = historyAssignees.find(function(hid) { return teamMembers.indexOf(hid) >= 0; });
                    if (histMember) displayUser = { id: histMember, name: histMember };
                }
                item.outsideUser = fallbackUser;
                if (displayUser && displayUser.id) {
                    if (!map[displayUser.id]) map[displayUser.id] = { id: displayUser.id, name: displayUser.name || displayUser.id, issues: [], hours: 0 };
                    map[displayUser.id].issues.push(item);
                    map[displayUser.id].hours += est;
                } else {
                    outside.issues.push(item);
                    outside.hours += est;
                }
            });
            var arr = Object.values(map).sort(function(a, b) { return a.name.localeCompare(b.name); });
            if (outside.issues.length > 0) arr.push(outside);
            state.byAssignee = arr;
            state.issueMap = issueMap;
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
            ensureFullWidth();
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
            var maxDone = Math.max.apply(null, data.map(function(d) { return isHours ? (d.doneHours || 0) : (d.doneTasks || 0); }));
            var maxIdeal = Math.max.apply(null, data.map(function(d) { return isHours ? (d.idealHours || 0) : (d.idealTasks || 0); }));
            var maxVal = Math.max(maxScope, maxDone, maxIdeal, 1);
            
            var h = 300, padding = 50;
            
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
            for (var i = 0; i <= 5; i++) {
                var y = padding + (h - padding * 2) * i / 5;
                html += '<line x1="0" y1="' + y + '" x2="100" y2="' + y + '" stroke="#e0e0e0" stroke-width="0.3"/>';
            }
            
            // Находим индекс "сегодня"
            var todayIdx = data.findIndex(function(d) { return d.isToday; });
            if (todayIdx >= 0) {
                var todayX = (todayIdx + 0.5) / data.length * 100;
                html += '<line x1="' + todayX + '" y1="' + padding + '" x2="' + todayX + '" y2="' + (h - padding) + '" stroke="#9e9e9e" stroke-width="0.6" stroke-dasharray="1.2,1.2"/>';
                html += '<text x="' + todayX + '" y="' + (padding - 6) + '" text-anchor="middle" font-size="3.5" fill="#666">Сегодня</text>';
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
            html += '<polyline points="' + idealPts.join(" ") + '" fill="none" stroke="#bdbdbd" stroke-width="0.8"/>';
            
            // Scope (красная)
            if (scopePts.length > 0) {
                html += '<polyline points="' + scopePts.join(" ") + '" fill="none" stroke="#ef5350" stroke-width="1.4"/>';
                scopePts.forEach(function(p) { var c = p.split(","); html += '<circle cx="' + c[0] + '" cy="' + c[1] + '" r="1.2" fill="#ef5350"/>'; });
            }
            
            // Done (зелёная)
            if (donePts.length > 0) {
                html += '<polyline points="' + donePts.join(" ") + '" fill="none" stroke="#66bb6a" stroke-width="1.4"/>';
                donePts.forEach(function(p) { var c = p.split(","); html += '<circle cx="' + c[0] + '" cy="' + c[1] + '" r="1.2" fill="#66bb6a"/>'; });
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
            for (var i = 0; i <= 5; i++) {
                var val = Math.round(maxVal * (5 - i) / 5);
                html += '<span style="top:' + (i * 20) + '%">' + (isHours ? utils.formatHoursShort(val * 3600) : val) + '</span>';
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
            var sprintStart = state.sprint ? utils.parseDate(state.sprint.startDate) : null;
            var sprintEnd = state.sprint ? utils.parseDate(state.sprint.endDate) : null;
            var days = sprintStart && sprintEnd ? utils.daysBetween(sprintStart, sprintEnd) : [];
            var gHead = renderGanttHeader(days);
            
            var html = '<div class="ujg-tbl-wrap"><table class="ujg-tbl"><thead><tr><th>Ключ</th><th>Задача</th><th>Ч</th><th>Start</th><th>End</th><th>Статус</th><th class="ujg-th-gantt">Gantt ' + gHead + '</th></tr></thead><tbody>';
            
            data.forEach(function(a) {
                var isOutside = a.id === "__outside__";
                var inTeam = !isOutside && state.teamMembers && state.teamMembers.indexOf(a.id) >= 0;
                var tog = isOutside ? '' : '<span class="ujg-tm-toggle ' + (inTeam ? 'on' : '') + '" data-uid="' + utils.escapeHtml(a.id) + '" data-uname="' + utils.escapeHtml(a.name) + '" title="' + (inTeam ? 'В команде' : 'Добавить в команду') + '">◎</span>';
                var title = isOutside ? 'Вне команды' : utils.escapeHtml(a.name);
                html += '<tr class="ujg-grp" data-aid="' + a.id + '"><td colspan="7"><b>' + title + '</b> ' + tog + ' <span>(' + utils.formatHours(a.hours) + ', ' + a.issues.length + ')</span></td></tr>';
                a.issues.forEach(function(iss) {
                    html += '<tr class="ujg-row" data-aid="' + a.id + '">';
                    html += '<td><a href="' + baseUrl + '/browse/' + iss.key + '" target="_blank" class="' + (iss.isDone ? "ujg-done" : "") + '">' + iss.key + '</a></td>';
                    html += '<td title="' + utils.escapeHtml(iss.summary) + '">' + utils.escapeHtml((iss.summary || "").substring(0, 35)) + '</td>';
                    html += '<td>' + (iss.est > 0 ? utils.formatHoursShort(iss.est) : "—") + '</td>';
                    html += '<td>' + utils.formatDateShort(iss.start) + '</td>';
                    html += '<td>' + utils.formatDateShort(iss.due) + '</td>';
                    html += '<td><span class="ujg-st ujg-st-' + iss.statusCat + '">' + utils.escapeHtml((iss.status || "").substring(0, 8)) + '</span></td>';
                    html += '<td>' + renderGantt(iss, days, sprintStart, sprintEnd) + '</td></tr>';
                    // Для вне команды: показать назначение/кандидата с тогглом
                    if (isOutside && iss.outsideUser) {
                        var ou = iss.outsideUser;
                        var inTeamFlag = state.teamMembers && state.teamMembers.indexOf(ou.id) >= 0;
                        var togOu = ou.id ? '<span class="ujg-tm-toggle ' + (inTeamFlag ? 'on' : '') + '" data-uid="' + utils.escapeHtml(ou.id) + '" data-uname="' + utils.escapeHtml(ou.name) + '" title="' + (inTeamFlag ? 'В команде' : 'Добавить в команду') + '">◎</span>' : '';
                        html += '<tr class="ujg-row ujg-sub" data-aid="' + a.id + '">';
                        html += '<td></td>';
                        html += '<td class="ujg-sub-name" title="Назначено/кандидат">' + utils.escapeHtml(ou.name || "—") + ' ' + togOu + '</td>';
                        html += '<td></td><td></td><td></td><td></td><td></td></tr>';
                    }
                    // Подстроки по worklog авторам
                    var usedNames = {};
                    iss.workAuthors.forEach(function(wa) {
                        usedNames[wa.name] = true;
                        var waInTeam = state.teamMembers && state.teamMembers.indexOf(wa.id) >= 0;
                        var togWa = wa.id ? '<span class="ujg-tm-toggle ' + (waInTeam ? 'on' : '') + '" data-uid="' + utils.escapeHtml(wa.id) + '" data-uname="' + utils.escapeHtml(wa.name) + '" title="' + (waInTeam ? 'В команде' : 'Добавить в команду') + '">◎</span>' : '';
                        html += '<tr class="ujg-row ujg-sub" data-aid="' + a.id + '">';
                        html += '<td></td>';
                        html += '<td class="ujg-sub-name" title="Worklog автора">' + utils.escapeHtml(wa.name) + ' ' + togWa + '</td>';
                        html += '<td>' + (wa.seconds > 0 ? utils.formatHours(wa.seconds) : "—") + '</td>';
                        html += '<td></td><td></td><td></td><td></td></tr>';
                    });
                    // Прошлые ассайны без worklog
                    iss.pastAssignees.filter(function(n) { return !usedNames[n]; }).forEach(function(n) {
                        html += '<tr class="ujg-row ujg-sub ujg-sub-old" data-aid="' + a.id + '">';
                        html += '<td></td>';
                        html += '<td class="ujg-sub-name ujg-sub-strike" title="Прошлый ассайн в спринте">' + utils.escapeHtml(n) + '</td>';
                        html += '<td>—</td><td></td><td></td><td></td><td></td></tr>';
                    });
                });
            });
            return html + '</tbody></table></div>';
        }

        function renderGantt(iss, days, sprintStart, sprintEnd) {
            if (!days.length) return '';
            var start = iss.start || sprintStart || (iss.created || days[0]);
            var end = iss.due || sprintEnd || days[days.length - 1];
            var todayKey = utils.getDayKey(utils.startOfDay(new Date()));
            var html = '<div class="ujg-gantt" title="Start: ' + utils.formatDateFull(start) + ' | End: ' + utils.formatDateFull(end) + '">';
            days.forEach(function(d) {
                var cls = "ujg-gc";
                if (d >= start && d <= end) {
                    if (!iss.due && !iss.start) cls += " ujg-gx"; // пунктир если нет дат
                    cls += iss.isDone ? " ujg-gd" : (iss.statusCat === "indeterminate" ? " ujg-gp" : " ujg-gt");
                }
                if (utils.getDayKey(d) === todayKey) cls += " ujg-gc-today";
                html += '<div class="' + cls + '" data-day="' + utils.getDayKey(d) + '" data-key="' + iss.key + '"></div>';
            });
            return html + '</div>';
        }

        function renderGanttHeader(days) {
            if (!days.length) return '';
            var todayKey = utils.getDayKey(utils.startOfDay(new Date()));
            var html = '<div class="ujg-ghead">';
            days.forEach(function(d) {
                var dk = utils.getDayKey(d);
                var cls = "ujg-gh-cell" + (dk === todayKey ? " ujg-gh-today" : "");
                html += '<div class="' + cls + '" data-day="' + dk + '"><span>' + utils.formatDateShort(d) + '</span></div>';
            });
            return html + '</div>';
        }

        function clearGanttPreview() { $cont.find(".ujg-gc").removeClass("ujg-gc-preview"); }

        function previewIssueRange(key, dueDayStr) {
            if (!key || !dueDayStr) return;
            var item = state.issueMap[key];
            if (!item) return;
            var due = utils.startOfDay(utils.parseDate(dueDayStr));
            if (!due) return;
            var duration = utils.getWorkDurationDays(item.est, CONFIG.hoursPerDay);
            var start = utils.shiftWorkDays(due, -(duration - 1));
            clearGanttPreview();
            $cont.find('.ujg-gc[data-key="' + key + '"]').each(function() {
                var cellDay = utils.startOfDay(utils.parseDate($(this).data("day")));
                if (cellDay && cellDay >= start && cellDay <= due) $(this).addClass("ujg-gc-preview");
            });
        }

        function getTeamKeyBySprintName(name) {
            if (!name) return "";
            var parts = name.trim().split(/\s+/);
            return parts.length > 0 ? parts[0] : "";
        }

        function loadTeams(boardId) {
            if (!boardId) return;
            api.getBoardTeams(boardId).then(function(res) {
                state.teams = (res && res.value && res.value.teams) ? res.value.teams : {};
                updateTeamKey();
            }, function() {
                state.teams = {};
            });
        }

        function updateTeamKey() {
            if (!state.sprint) return;
            state.teamKey = getTeamKeyBySprintName(state.sprint.name);
            state.teamMembers = (state.teams && state.teamKey && state.teams[state.teamKey]) ? state.teams[state.teamKey] : [];
        }

        function toggleTeamMember(uid, uname) {
            var key = state.teamKey;
            if (!key || !state.selectedBoardId) return;
            if (!state.teams[key]) state.teams[key] = [];
            var list = state.teams[key];
            var idx = list.indexOf(uid);
            if (idx >= 0) list.splice(idx, 1);
            else list.push(uid);
            state.teamMembers = list.slice();
            saveTeams(state.selectedBoardId, state.teams).always(function() { render(); });
        }

        function saveTeams(boardId, teams) {
            return api.setBoardTeams(boardId, { teams: teams }).fail(function(err) {
                alert("Не удалось сохранить состав команды: " + (err && err.statusText ? err.statusText : "ошибка"));
            });
        }

        function saveIssueDue(key, dayStr) {
            var dueDate = utils.startOfDay(utils.parseDate(dayStr));
            if (!key || !dueDate) return;
            var newVal = utils.formatDateJira(dueDate);
            var current = state.issueMap[key] && state.issueMap[key].due ? utils.formatDateJira(state.issueMap[key].due) : null;
            if (current === newVal) return;
            $cont.addClass("ujg-busy");
            return api.updateIssueDue(key, newVal).then(function() {
                log("Due updated for " + key + ": " + newVal);
                loadSprintData(state.selectedSprintId);
            }, function(err) {
                console.error(err);
                alert("Не удалось сохранить срок: " + (err && err.statusText ? err.statusText : "ошибка сети"));
            }).always(function() {
                $cont.removeClass("ujg-busy");
                clearGanttPreview();
            });
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

            var dragCtx = null;
            $(document).off(".ujgDrag");
            $cont.find(".ujg-gc").off(".ujgDrag");

            $cont.find(".ujg-gc").on("mousedown.ujgDrag", function(e) {
                if (!CONFIG.allowEditDates || e.button !== 0) return;
                var key = $(this).data("key");
                var day = $(this).data("day");
                if (!key || !day) return;
                dragCtx = { key: key, candidate: day };
                previewIssueRange(key, day);
                $cont.addClass("ujg-dragging");
                e.preventDefault();
            }).on("mouseenter.ujgDrag", function() {
                if (!dragCtx) return;
                var day = $(this).data("day");
                dragCtx.candidate = day;
                previewIssueRange(dragCtx.key, day);
            }).on("dblclick.ujgDrag", function(e) {
                if (!CONFIG.allowEditDates) return;
                var key = $(this).data("key");
                var day = $(this).data("day");
                if (!key || !day) return;
                var item = state.issueMap[key];
                if (item && item.due) return; // ставим только если срока нет
                saveIssueDue(key, day);
                e.preventDefault();
            });

            $(document).on("mouseup.ujgDrag", function() {
                if (!dragCtx) return;
                var ctx = dragCtx;
                dragCtx = null;
                $cont.removeClass("ujg-dragging");
                if (ctx.candidate) {
                    saveIssueDue(ctx.key, ctx.candidate);
                } else {
                    clearGanttPreview();
                }
            });

            // Team toggle
            $cont.find(".ujg-tm-toggle").on("click", function(e) {
                e.stopPropagation();
                var uid = $(this).data("uid");
                var uname = $(this).data("uname");
                if (!uid) return;
                toggleTeamMember(uid, uname);
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
