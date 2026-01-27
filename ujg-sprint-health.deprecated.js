/**
 * UJG Sprint Health — Виджет оценки качества планирования спринта
 * Версия: 1.2.0
 */
define("_ujgSprintHealth", ["jquery"], function($) {
    "use strict";

    var CONFIG = { version: "1.3.1", debug: true, maxHours: 16, capacityPerPerson: 40, hoursPerDay: 8, startDateField: "customfield_XXXXX", allowEditDates: true, sprintField: null };
    var STORAGE_KEY = "ujg_sprint_health_settings";
    var baseUrl = (typeof AJS !== "undefined" && AJS.contextPath) ? AJS.contextPath() : "";

    var utils = {
        escapeHtml: function(t) { if (!t) return ""; var d = document.createElement("div"); d.textContent = String(t); return d.innerHTML; },
        formatHours: function(s) { if (!s || s <= 0) return "—"; var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return h > 0 ? h + "ч" + (m > 0 ? m + "м" : "") : m + "м"; },
        formatHoursShort: function(s) { return s > 0 ? Math.round(s / 3600) + "ч" : "0"; },
        parseHoursToSeconds: function(t) {
            if (!t) return null;
            var str = String(t).trim();
            if (!str) return null;
            str = str.replace(",", ".");
            var numOnly = str.match(/^\d+(\.\d+)?$/);
            if (numOnly) return Math.round(parseFloat(str) * 3600);
            var re = /(\d+(?:\.\d+)?)(h|ч|m|м)/gi, match, totalH = 0, found = false;
            while ((match = re.exec(str)) !== null) {
                found = true;
                var val = parseFloat(match[1]);
                var unit = match[2].toLowerCase();
                if (unit === "m" || unit === "м") totalH += val / 60;
                else totalH += val;
            }
            if (!found) return null;
            return Math.round(totalH * 3600);
        },
        clamp: function(v, min, max) { return Math.max(min, Math.min(max, v)); },
        parseDate: function(v) { if (!v) return null; var d = new Date(v); return isNaN(d.getTime()) ? null : d; },
        formatDateShort: function(d) { if (!d) return "—"; return (d.getDate() < 10 ? "0" : "") + d.getDate() + "." + (d.getMonth() < 9 ? "0" : "") + (d.getMonth() + 1); },
        formatDateFull: function(d) { if (!d) return "—"; return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" }); },
        getDayKey: function(d) { if (!d) return ""; return d.getFullYear() + "-" + (d.getMonth() < 9 ? "0" : "") + (d.getMonth() + 1) + "-" + (d.getDate() < 10 ? "0" : "") + d.getDate(); },
        formatDateJira: function(d) { if (!d) return ""; var dd = utils.startOfDay(d); return dd ? utils.getDayKey(dd) : ""; },
        parseSprintNames: function(list) {
            if (!list || !Array.isArray(list)) return [];
            return list.map(function(s) {
                if (!s) return "";
                if (typeof s === "string") {
                    var m = s.match(/name=([^,}]+)/);
                    return m ? m[1] : s;
                }
                if (s.name) return s.name;
                return String(s);
            }).filter(Boolean);
        },
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
        getHealthLabel: function(p) { return p >= 90 ? "Отлично" : p >= 70 ? "Хорошо" : p >= 50 ? "Внимание" : "Критично"; },
        // Проверяет, является ли задача подзадачей
        isSubtask: function(issue) {
            if (!issue) return false;
            var f = issue.fields || {};
            var issueType = f.issuetype || {};
            // Проверка по флагу (самый надежный способ)
            if (issueType.subtask === true) return true;
            // Проверка по имени типа задачи
            var typeName = (issueType.name || "").toLowerCase();
            return typeName.indexOf("subtask") !== -1 || typeName.indexOf("подзадача") !== -1;
        },
        // Проверяет, находится ли задача СЕЙЧАС в спринте с указанным ID (не по имени!)
        isIssueInSprintById: function(issue, sprintId) {
            if (!issue || !sprintId) return false;
            var f = issue.fields || {};
            var sprintFieldVal = f[CONFIG.sprintField || "customfield_10020"] || [];
            if (!Array.isArray(sprintFieldVal)) return false;
            var sid = String(sprintId);
            return sprintFieldVal.some(function(s) {
                if (!s) return false;
                // Объект с id (новый формат Jira Cloud)
                if (s.id) return String(s.id) === sid;
                // Строка формата "com.atlassian.greenhopper...id=123,name=..." (Jira Server/DC)
                // id= всегда идёт в начале значения или после [, а после числа идёт , или ]
                if (typeof s === "string") {
                    // Формат: [id=123,rapidViewId=... или ...id=123]
                    return s.indexOf("[id=" + sid + ",") !== -1 || 
                           s.indexOf(",id=" + sid + ",") !== -1 ||
                           s.indexOf("[id=" + sid + "]") !== -1 ||
                           s.indexOf(",id=" + sid + "]") !== -1;
                }
                return false;
            });
        }
    };

    function loadSettings() { try { var s = localStorage.getItem(STORAGE_KEY); return s ? JSON.parse(s) : {}; } catch(e) { return {}; } }
    function saveSettings(s) { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch(e) {} }

    var api = {
        getBoards: function() {
            var d = $.Deferred(), all = [];
            function load(startAt) {
                $.ajax({
                    url: baseUrl + "/rest/agile/1.0/board",
                    data: { maxResults: 100, startAt: startAt }
                }).then(function(data) {
                    all = all.concat(data.values || []);
                    if (data.isLast === false && data.values && data.values.length > 0) {
                        load(startAt + data.values.length);
                    } else {
                        d.resolve({ values: all });
                    }
                }, function(err) { d.resolve({ values: all }); });
            }
            load(0);
            return d.promise();
        },
        getFields: function() { return $.ajax({ url: baseUrl + "/rest/api/2/field" }); },
        getUser: function(userId) {
            // Jira Server/DC: чаще всего работает ?key=JIRAUSER12345 или ?username=...
            // Jira Cloud: ?accountId=...
            function tryReq(params) {
                return $.ajax({ url: baseUrl + "/rest/api/2/user", data: params });
            }
            var id = userId;
            if (!id) return $.Deferred().reject().promise();
            // Пробуем по очереди (на разных инстансах разные параметры)
            return tryReq({ key: id }).then(function(r) { return r; }, function() {
                return tryReq({ username: id }).then(function(r) { return r; }, function() {
                    return tryReq({ accountId: id });
                });
            });
        },
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
        getSprintIssues: function(id, onProgress) {
            var d = $.Deferred(), all = [];
            var maxTotal = 2000;
            var fields = "summary,status,assignee,priority,issuetype,timeoriginalestimate,timetracking,duedate,created,updated,description,resolutiondate," + (CONFIG.sprintField || "customfield_10020");
            function load(startAt) {
                $.ajax({
                    url: baseUrl + "/rest/agile/1.0/sprint/" + id + "/issue",
                    data: { fields: fields, expand: "changelog", maxResults: 100, startAt: startAt }
                }).then(function(data) {
                    all = all.concat(data.issues || []);
                    var total = data.total || all.length;
                    if (onProgress) onProgress(all.length, total);
                    if (all.length < total && all.length < maxTotal && data.issues && data.issues.length > 0) {
                        load(startAt + data.issues.length);
                    } else {
                        d.resolve({ issues: all, total: total });
                    }
                }, function(err) { d.resolve({ issues: all, total: all.length }); });
            }
            load(0);
            return d.promise();
        },
        getIssue: function(key) {
            return $.ajax({
                url: baseUrl + "/rest/api/2/issue/" + key,
                data: { fields: "summary,status,assignee,reporter,creator,priority,issuetype,timeoriginalestimate,timetracking,timespent,duedate,created,updated,description,resolutiondate,comment,changelog,worklog," + (CONFIG.sprintField || "customfield_10020") + "," + CONFIG.startDateField, expand: "changelog" }
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
        updateIssueEstimate: function(key, seconds) {
            return $.ajax({
                url: baseUrl + "/rest/api/2/issue/" + key,
                type: "PUT",
                contentType: "application/json",
                data: JSON.stringify({
                    fields: {
                        timetracking: { originalEstimateSeconds: seconds },
                        timeoriginalestimate: seconds
                    }
                })
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
        },

        // Jira Software Server/DC (GreenHopper) rapid charts — для 1-в-1 как в Jira Sprint Report
        getRapidSprintReport: function(rapidViewId, sprintId) {
            return $.ajax({
                url: baseUrl + "/rest/greenhopper/1.0/rapid/charts/sprintreport",
                data: { rapidViewId: rapidViewId, sprintId: sprintId }
            });
        },
        getRapidScopeChangeBurndown: function(rapidViewId, sprintId, statisticFieldId) {
            // Jira иногда чувствителен к типам параметров/кэшу — делаем максимально близко к вызову из UI Jira
            var rv = Number(rapidViewId);
            var sid = Number(sprintId);
            return $.ajax({
                url: baseUrl + "/rest/greenhopper/1.0/rapid/charts/scopechangeburndownchart",
                cache: false, // добавит _=timestamp как в Jira UI
                data: {
                    rapidViewId: isNaN(rv) ? rapidViewId : rv,
                    sprintId: isNaN(sid) ? sprintId : sid,
                    statisticFieldId: statisticFieldId || "issueCount"
                }
            });
        }
    };

    function SprintHealthGadget(API) {
        var state = {
            boards: [], filteredBoards: [], sprints: [], filteredSprints: [],
            selectedBoardId: null, selectedSprintId: null,
            sprint: null, issues: [], viewIssues: [], extraIssues: [],
            loading: false, isFullscreen: false,
            viewMode: "health", // health | compare
            chartMode: "tasks", // tasks или hours
            burnView: "jira", // jira | burndown
            metrics: {}, burnupData: [], byAssignee: [], problems: [], issueMap: {},
            teams: {}, teamKey: "", teamMembers: [],
            teamMemberNames: {}, // { userId: displayName } для отображения даже без задач
            worklogDebugPerAuthor: {},
            compare: { boardId: null, allSprints: [], displayed: [], rows: [], teams: [], limit: 10, burnCache: {} },
            jiraScope: { sprintId: null, mode: "tasks", loading: false, error: false, series: null }
        };

        var $content = API.getGadgetContentEl();
        var $cont = $content.find(".ujg-sprint-health");
        if ($cont.length === 0) { $cont = $('<div class="ujg-sprint-health"></div>'); $content.append($cont); }

        var $boardInput, $boardDropdown, $sprintInput, $sprintDropdown, $refreshBtn, $fsBtn, $compareBtn;

        function log(msg) { if (CONFIG.debug) console.log("[UJG]", msg); }

        function getSprintCapacity() {
            var sp = state.sprint;
            if (!sp || !sp.startDate || !sp.endDate) return { workDays: 0, capSec: 0 };
            var start = utils.startOfDay(utils.parseDate(sp.startDate));
            var end = utils.startOfDay(utils.parseDate(sp.endDate));
            if (!start || !end) return { workDays: 0, capSec: 0 };

            var dayMs = 24 * 3600 * 1000;
            var hoursPerDay = (CONFIG.hoursPerDay && CONFIG.hoursPerDay > 0) ? CONFIG.hoursPerDay : 8;

            // Если есть workRateData (из Jira scopechangeburndownchart), считаем рабочие дни по нему (учтёт праздники/выходные из Jira)
            var js = state.jiraScope && state.jiraScope.series ? state.jiraScope.series : null;
            if (js && js.workRateData && Array.isArray(js.workRateData.rates) && js.workRateData.rates.length) {
                var st = Number(js.startTime || js.start || (start && start.getTime())) || (start && start.getTime());
                var en = Number(js.endTime || js.end || (end && end.getTime())) || (end && end.getTime());
                var wd = 0;
                js.workRateData.rates.forEach(function(r) {
                    var rs = Math.max(Number(r.start) || 0, st);
                    var re = Math.min(Number(r.end) || 0, en);
                    var rate = Number(r.rate);
                    if (!isFinite(rs) || !isFinite(re) || re <= rs) return;
                    if (!isFinite(rate) || rate <= 0) return;
                    wd += (re - rs) / dayMs;
                });
                var capSec = wd * hoursPerDay * 3600;
                return { workDays: wd, capSec: capSec };
            }

            // Фоллбек: рабочие дни = будни (без суб/вс)
            var workDays = utils.daysBetween(start, end).length;
            return { workDays: workDays, capSec: workDays * hoursPerDay * 3600 };
        }

        function getBurndownNowMetrics() {
            // Возвращает значения "как в Jira burndown": scope/done на текущий момент (или на конец, если спринт завершён)
            // Используем jiraScope.series (scopechangeburndownchart), фоллбек — локальный burnupData.
            var m = state.metrics || {};
            var res = { scope: null, done: null, pct: null, guidePct: null, isActive: false, isFinished: false };

            var sp = state.sprint;
            var spStart = sp && sp.startDate ? utils.startOfDay(utils.parseDate(sp.startDate)) : null;
            var spEnd = sp && sp.endDate ? utils.startOfDay(utils.parseDate(sp.endDate)) : null;
            var today = utils.startOfDay(new Date());
            if (spStart && spEnd && today) {
                res.isActive = today >= spStart && today <= spEnd;
                res.isFinished = today > spEnd;
            }

            var nowTs = Date.now();
            if (spStart && spEnd) {
                var st = spStart.getTime(), en = spEnd.getTime();
                if (nowTs < st) nowTs = st;
                if (nowTs > en) nowTs = en;
            }

            function yAtOrBefore(pts, x) {
                if (!pts || !pts.length) return null;
                var sorted = pts.slice().sort(function(a, b) { return a.x - b.x; });
                var y = sorted[0].y;
                for (var i = 0; i < sorted.length; i++) {
                    if (sorted[i].x <= x) y = sorted[i].y;
                    else break;
                }
                return y;
            }

            var js = state.jiraScope && state.jiraScope.series ? state.jiraScope.series : null;
            if (js && js.scope && js.completed) {
                var s = yAtOrBefore(js.scope, Number(js.now) || nowTs);
                var d = yAtOrBefore(js.completed, Number(js.now) || nowTs);
                if (s != null && d != null && isFinite(s) && isFinite(d)) {
                    res.scope = s;
                    res.done = d;
                }
            }

            if (res.scope == null || res.done == null) {
                var bd = state.burnupData || [];
                if (bd.length) {
                    var cur = bd.find(function(x) { return x.isToday; }) || bd[bd.length - 1];
                    res.scope = cur ? (cur.scopeTasks != null ? cur.scopeTasks : null) : null;
                    res.done = cur ? (cur.doneTasks != null ? cur.doneTasks : null) : null;
                }
            }

            if (res.scope != null && res.scope > 0 && res.done != null) {
                res.pct = Math.round((res.done / res.scope) * 100);
            }

            // Руководство = ожидаемый % по времени (рабочие дни), рисуем если спринт ещё идёт
            if (m.workDays && m.workDays > 0 && m.workDaysPassed != null) {
                var g = Math.round((m.workDaysPassed / m.workDays) * 100);
                res.guidePct = Math.max(0, Math.min(100, g));
            }
            return res;
        }

        function pct(partSec, totalSec) {
            if (!totalSec || totalSec <= 0) return 0;
            return Math.round((partSec || 0) / totalSec * 100);
        }

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
                state.filteredBoards = state.boards.slice();
                updateBoardDropdown();
                var saved = loadSettings();
                if (saved.boardId) {
                    var board = state.boards.find(function(b) { return b.id == saved.boardId; });
                    if (board) {
                        $boardInput.val(board.name);
                        state.selectedBoardId = saved.boardId;
                        loadSprints(saved.boardId);
                    }
                }
            });
        }

        function loadSprints(boardId) {
            if (!boardId) return;
            state.selectedBoardId = boardId;
            $sprintInput.val("Загрузка спринтов...");
            
            loadTeams(boardId);
            api.getAllSprints(boardId).then(function(sprints) {
                // Сортировка по дате старта (новые сверху)
                sprints.sort(function(a, b) {
                    var ad = utils.parseDate(a.startDate), bd = utils.parseDate(b.startDate);
                    var av = ad ? ad.getTime() : 0;
                    var bv = bd ? bd.getTime() : 0;
                    if (av === bv) return b.id - a.id;
                    return bv - av;
                });
                state.sprints = sprints;
                state.filteredSprints = sprints.slice();
                state.compare.boardId = boardId;
                state.compare.allSprints = sprints.slice();
                state.compare.burnCache = {};
                state.compare.limit = 10;
                rebuildCompareMatrix();
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

        var sprintFieldPromise = null;
        function resolveSprintField() {
            if (CONFIG.sprintField) return $.Deferred().resolve(CONFIG.sprintField).promise();
            if (sprintFieldPromise) return sprintFieldPromise;
            sprintFieldPromise = api.getFields().then(function(list) {
                var field = (list || []).find(function(f) { return f && f.name === "Sprint" && f.schema && f.schema.customId; });
                if (field && field.id) {
                    CONFIG.sprintField = field.id;
                    log("Sprint field resolved: " + field.id);
                    return field.id;
                }
                // fallback
                CONFIG.sprintField = "customfield_10020";
                return CONFIG.sprintField;
            }, function() {
                CONFIG.sprintField = "customfield_10020";
                return CONFIG.sprintField;
            });
            return sprintFieldPromise;
        }

        function loadSprintData(id) {
            state.loading = true;
            saveSettings({ boardId: state.selectedBoardId, sprintId: id });
            $cont.html('<div class="ujg-loading"><div class="ujg-load-icon">⏳</div><div class="ujg-load-text">Загрузка данных спринта...</div><div class="ujg-load-progress"></div></div>');
            
            function updateProgress(text) {
                $cont.find(".ujg-load-text").text(text);
            }
            function updateSubProgress(text) {
                $cont.find(".ujg-load-progress").text(text);
            }
            
            resolveSprintField().then(function() {
                updateProgress("Загрузка задач спринта...");
                return $.when(
                    api.getSprint(id),
                    api.getSprintIssues(id, function(loaded, total) {
                        updateSubProgress("Получено " + loaded + " из " + total + " задач");
                    })
                );
            }).then(function(sprintResp, issuesResp) {
                state.sprint = sprintResp[0] || sprintResp;
                var allLoadedIssues = (issuesResp[0] || issuesResp).issues || [];
                var sprintId = state.sprint ? state.sprint.id : id;
                // ВАЖНО: Jira API возвращает ВСЕ задачи, которые когда-либо были в спринте.
                // Фильтруем, оставляя только те, которые СЕЙЧАС в этом спринте (по ID, не по имени!)
                // И исключаем подзадачи
                state.issues = allLoadedIssues.filter(function(iss) {
                    // Исключаем подзадачи
                    if (utils.isSubtask(iss)) return false;
                    // Проверяем, что задача в текущем спринте
                    return utils.isIssueInSprintById(iss, sprintId);
                });
                var filtered = allLoadedIssues.length - state.issues.length;
                if (filtered > 0) {
                    log("Отфильтровано задач (не в текущем спринте или подзадачи): " + filtered + " из " + allLoadedIssues.length);
                }
                state.viewIssues = state.issues.slice();
                state.extraIssues = [];
                updateTeamKey();
                ensureJiraScopeChangeForSprint();
                
                updateProgress("Загрузка worklogs и changelog...");
                updateSubProgress("0 из " + state.issues.length + " задач");
                
                var enriched = 0;
                enrichIssues(state.issues, function() {
                    enriched++;
                    updateSubProgress(enriched + " из " + state.issues.length + " задач");
                }).always(function() {
                    calculate();
                    groupByAssignee();
                    
                    updateProgress("Загрузка задач вне спринта...");
                    updateSubProgress("");
                    
                    loadExtraWorklogIssues().always(function() {
                        groupByAssignee();
                        render();
                        state.loading = false;
                    });
                });
            });
        }

        function enrichIssues(issues, onProgress) {
            if (!issues || issues.length === 0) return $.Deferred().resolve().promise();
            var tasks = [];
            issues.forEach(function(iss) {
                var task = $.Deferred();
                $.when(
                    api.getIssueWorklog(iss.key).then(function(res) {
                        iss._worklog = res && res.worklogs ? res.worklogs : [];
                    }, function() { iss._worklog = []; }),
                    api.getIssueChangelog(iss.key).then(function(res) {
                        iss._changelog = res && res.changelog ? res.changelog : {};
                    }, function() { iss._changelog = {}; })
                ).always(function() {
                    if (onProgress) onProgress();
                    task.resolve();
                });
                tasks.push(task.promise());
            });
            return $.when.apply($, tasks);
        }

        function calculate() {
            var issues = state.issues, m = state.metrics = {};
            m.total = issues.length;
            m.totalHours = m.estimated = m.withDates = m.assigned = m.done = 0;
            m.statusCounts = {};
            var cap = getSprintCapacity();
            m.workDays = cap.workDays || 0;
            m.capacitySec = cap.capSec || 0;
            // сколько рабочих дней уже прошло в спринте (для логических уведомлений)
            m.workDaysPassed = 0;
            if (state.sprint && state.sprint.startDate && state.sprint.endDate) {
                var spS = utils.startOfDay(utils.parseDate(state.sprint.startDate));
                var spE = utils.startOfDay(utils.parseDate(state.sprint.endDate));
                var today = utils.startOfDay(new Date());
                if (spS && spE && today) {
                    var till = today < spE ? today : spE;
                    if (till >= spS) m.workDaysPassed = utils.daysBetween(spS, till).length;
                }
            }
            
            state.problems = [];
            var now = new Date();
            
            issues.forEach(function(iss) {
                var f = iss.fields || {};
                var estRaw = (f.timetracking && f.timetracking.originalEstimateSeconds) || f.timeoriginalestimate || 0;
                // Ограничиваем оценку одной задачи ёмкостью спринта (человек физически не сделает больше ёмкости за спринт)
                var est = (m.capacitySec && m.capacitySec > 0) ? Math.min(estRaw, m.capacitySec) : estRaw;
                var isDone = isIssueDone(f.status);
                // Worklog в пределах спринта (сек)
                var loggedInSprint = 0;
                if (iss._worklog && Array.isArray(iss._worklog) && state.sprint && state.sprint.startDate && state.sprint.endDate) {
                    var spStart = utils.startOfDay(utils.parseDate(state.sprint.startDate));
                    var spEnd = utils.startOfDay(utils.parseDate(state.sprint.endDate));
                    iss._worklog.forEach(function(wl) {
                        var wd = utils.startOfDay(utils.parseDate(wl.started));
                        if (!wd || wd < spStart || wd > spEnd) return;
                        loggedInSprint += (wl.timeSpentSeconds || 0);
                    });
                }
                
                if (est > 0) { m.estimated++; m.totalHours += est; }
                if (f.duedate) m.withDates++;
                if (f.assignee) m.assigned++;
                if (isDone) m.done++;

                // Статусы (для блока "Статусы")
                var stName = (f.status && f.status.name) ? String(f.status.name) : "—";
                // ВАЖНО: показываем именно статусы (без объединения в "Выполнено")
                m.statusCounts[stName] = (m.statusCounts[stName] || 0) + 1;
                
                // Проблемы
                var sprints = f[CONFIG.sprintField] || f.customfield_10020 || []; // Sprint field
                var sprintCount = Array.isArray(sprints) ? sprints.length : 0;
                var statusTime = utils.daysDiff(utils.parseDate(f.updated), now);

                // В текущем спринте? (проверка по ID, не по имени)
                var inCurrentSprint = state.sprint ? utils.isIssueInSprintById(iss, state.sprint.id) : false;
                
                var prob = null;
                if (!est && !isDone) prob = { type: "noest", label: "Без оценки" };
                else if (!f.assignee && !isDone) prob = { type: "noasgn", label: "Без исполнителя" };
                else if (inCurrentSprint && estRaw > (40 * 3600)) prob = { type: "big", label: "План > 5 дн." };
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
                        estimate: est, // уже ограничено ёмкостью
                        estimateRaw: estRaw,
                        loggedInSprint: loggedInSprint,
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
            // Health теперь строим по burndown: выполнено/объём (как Jira)
            var bd = getBurndownNowMetrics();
            m.health = (bd && bd.pct != null) ? bd.pct : Math.round((m.estPct + m.datesPct + m.asgnPct) / 3);
            
            calculateBurnup();
            groupByAssignee();
        }

        function isIssueDone(st) {
            if (!st) return false;
            // Jira отдаёт признак "закрывает ли статус задачу" через statusCategory.key === "done"
            if (st.statusCategory && st.statusCategory.key) {
                var k = String(st.statusCategory.key).toLowerCase();
                if (k === "done") return true;
            }
            var n = (st.name || "").toLowerCase();
            // "Тестирование/Testing/QA" считаем как выполнено
            if (n.indexOf("тест") >= 0 || n.indexOf("testing") >= 0 || n.indexOf("qa") >= 0) return true;
            return ["done","closed","resolved","готово","закрыт","завершён","выполнено"].some(function(s) { return n.indexOf(s) >= 0; });
        }

        function buildBurndown(params) {
            var sp = params && params.sprint;
            var issues = (params && params.issues) || [];
            var mode = (params && params.mode) || "tasks";
            if (!sp || !sp.startDate || !sp.endDate) { return { data: [], mode: mode }; }
            var start = utils.startOfDay(utils.parseDate(sp.startDate));
            var end = utils.startOfDay(utils.parseDate(sp.endDate));
            if (!start || !end) { return { data: [], mode: mode }; }
            var days = utils.daysBetween(start, end);
            var now = utils.startOfDay(new Date());
            var sprintId = sp.id;
            var capSec = days.length * ((CONFIG.hoursPerDay && CONFIG.hoursPerDay > 0) ? CONFIG.hoursPerDay : 8) * 3600;
            function isDoneStatusName(name) {
                var n = (name || "").toLowerCase();
                if (!n) return false;
                if (n.indexOf("тест") >= 0 || n.indexOf("testing") >= 0 || n.indexOf("qa") >= 0) return true;
                return ["done","closed","resolved","готово","закрыт","завершён","выполнено"].some(function(s) { return n.indexOf(s) >= 0; });
            }

            var issuesInfo = issues.map(function(iss) {
                var f = iss.fields || {};
                var estRaw = (f.timetracking && f.timetracking.originalEstimateSeconds) || f.timeoriginalestimate || 0;
                var estSec = (capSec && capSec > 0) ? Math.min(estRaw, capSec) : estRaw;
                var resolved = utils.startOfDay(utils.parseDate(f.resolutiondate));
                var done = isIssueDone(f.status);
                // Дата, когда задача стала "выполненной" (done/тестирование) — берём из changelog status, если resolutiondate нет
                var doneDate = resolved;
                var addDate = start, removeDate = null;
                var ch = iss.changelog || iss._changelog || {};
                (ch.histories || []).forEach(function(h) {
                    var hd = utils.startOfDay(utils.parseDate(h.created));
                    (h.items || []).forEach(function(it) {
                        if ((it.field || "").toLowerCase() === "sprint") {
                            var fromHas = it.from && it.from.indexOf && it.from.indexOf(sprintId) >= 0;
                            var toHas = it.to && it.to.indexOf && it.to.indexOf(sprintId) >= 0;
                            var fromStr = it.fromString || "";
                            var toStr = it.toString || "";
                            if (!fromHas && !toHas) {
                                fromHas = fromStr.indexOf(String(sprintId)) >= 0;
                                toHas = toStr.indexOf(String(sprintId)) >= 0;
                            }
                            if (toHas && !fromHas) { addDate = hd || addDate; }
                            if (fromHas && !toHas) { removeDate = hd || removeDate; }
                        }
                        if ((it.field || "").toLowerCase() === "status") {
                            // it.toString — новое имя статуса
                            var toName = it.toString || it.toString === "" ? it.toString : it.tostring;
                            if (!doneDate && hd && isDoneStatusName(String(toName || ""))) {
                                doneDate = hd;
                            }
                        }
                    });
                });
                if (addDate < start) addDate = start;
                if (removeDate && removeDate < addDate) removeDate = null;

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
                    estRaw: estRaw,
                    resolved: resolved,
                    doneDate: doneDate,
                    isDone: done,
                    addDate: addDate,
                    removeDate: removeDate,
                    wlByDay: wlByDay
                };
            });

            var data = [];
            var finalScopeTasks = 0, finalScopeHours = 0;
            var cumLoggedCache = {};

            days.forEach(function(day, idx) {
                var dk = utils.getDayKey(day);
                var scopeTasks = 0, scopeHours = 0;
                var doneTasks = 0, doneHoursSec = 0;

                issuesInfo.forEach(function(info) {
                    var inScope = day >= info.addDate && (!info.removeDate || day <= info.removeDate);
                    if (!inScope) return;

                    scopeTasks += 1;
                    scopeHours += info.estSec / 3600;

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

                    // Реальная линия (tasks): выполненные задачи по дате перехода в done/тестирование
                    if (info.isDone && info.doneDate && info.doneDate <= day) {
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

            data.forEach(function(d, idx) {
                d.idealTasks = Math.round(finalScopeTasks * (idx + 1) / Math.max(data.length, 1));
                d.idealHours = Math.round(finalScopeHours * (idx + 1) / Math.max(data.length, 1));
            });

            return { data: data, mode: mode };
        }

        function calculateBurnup() {
            var res = buildBurndown({ sprint: state.sprint, issues: state.issues, mode: state.chartMode });
            state.burnupData = res.data || [];
        }

        function rebuildCompareMatrix() {
            var cmp = state.compare;
            if (!cmp) return;
            var limit = cmp.limit || 10;
            var list = (cmp.allSprints || []).slice(0, limit);
            cmp.displayed = list;

            function periodKey(sp) {
                var sd = utils.formatDateJira(utils.parseDate(sp.startDate));
                var ed = utils.formatDateJira(utils.parseDate(sp.endDate));
                if (!sd || !ed) return null;
                return sd + "|" + ed;
            }

            var periods = [];
            var periodMap = {};
            var teamsSet = {};

            list.forEach(function(sp) {
                var key = periodKey(sp);
                if (key && !periodMap[key]) {
                    var sd = utils.formatDateShort(utils.parseDate(sp.startDate));
                    var ed = utils.formatDateShort(utils.parseDate(sp.endDate));
                    periodMap[key] = { key: key, label: (sd || "—") + " – " + (ed || "—"), byTeam: {} };
                    periods.push(key);
                }
                var team = getTeamKeyBySprintName(sp.name) || "Без команды";
                teamsSet[team] = true;
            });

            // Сортировка периодов по дате начала убыв.
            periods.sort(function(a, b) {
                var asd = a.split("|")[0];
                var bsd = b.split("|")[0];
                return bsd.localeCompare(asd);
            });

            // Заполняем матрицу: для каждой команды ищем спринт с тем же периодом.
            var sprintsByTeam = {};
            list.forEach(function(sp) {
                var key = periodKey(sp);
                if (!key) return;
                var team = getTeamKeyBySprintName(sp.name) || "Без команды";
                if (!sprintsByTeam[team]) sprintsByTeam[team] = {};
                // если несколько, берём первый в отсортированном списке (уже по дате)
                if (!sprintsByTeam[team][key]) sprintsByTeam[team][key] = sp;
            });

            periods.forEach(function(pk) {
                var row = periodMap[pk];
                Object.keys(teamsSet).forEach(function(team) {
                    var sp = sprintsByTeam[team] && sprintsByTeam[team][pk];
                    if (sp) row.byTeam[team] = sp;
                });
            });

            cmp.rows = periods.map(function(k) { return periodMap[k]; });
            cmp.teams = Object.keys(teamsSet).sort(function(a, b) { return a.localeCompare(b); });
        }

        function addMoreCompareSprints(step) {
            var cmp = state.compare;
            if (!cmp || !cmp.allSprints) return;
            cmp.limit = Math.min((cmp.limit || 10) + (step || 1), cmp.allSprints.length);
            rebuildCompareMatrix();
            render();
        }

        function ensureCompareBurndown(sp) {
            var cmp = state.compare;
            if (!cmp || !sp || !sp.id) return;
            var cache = cmp.burnCache[sp.id];
            if (cache && (cache.jiraSeries || cache.data)) return;
            if (cache && cache.loading) return;
            cmp.burnCache[sp.id] = { loading: true };
            // Пытаемся получить ровно те же точки, что Jira рисует в Sprint Report
            var rapidViewId = state.compare && state.compare.boardId ? state.compare.boardId : state.selectedBoardId;
            function fallbackLocal() {
                api.getSprintIssues(sp.id).then(function(res) {
                    var allIssues = (res && res.issues) ? res.issues : (res && res[0] && res[0].issues) ? res[0].issues : [];
                    // Фильтруем по ID спринта и исключаем подзадачи (аналогично основной загрузке)
                    var issues = allIssues.filter(function(iss) {
                        // Исключаем подзадачи
                        if (utils.isSubtask(iss)) return false;
                        // Проверяем, что задача в текущем спринте
                        return utils.isIssueInSprintById(iss, sp.id);
                    });
                    var bd = buildBurndown({ sprint: sp, issues: issues, mode: state.chartMode });
                    cmp.burnCache[sp.id] = { data: bd.data, sprint: sp };
                    render();
                }, function() {
                    cmp.burnCache[sp.id] = { error: true };
                    render();
                });
            }

            fetchRapidScopeChangeSeries(rapidViewId, sp.id).then(function(resp) {
                var series = parseScopeChangeBurndown(resp);
                if (CONFIG.debug) console.log("[UJG] scopechangeburndownchart resp", resp);
                if (series && (series.scope || series.completed || series.guideline)) {
                    cmp.burnCache[sp.id] = { jiraSeries: series, jiraSource: "scopechangeburndownchart", sprint: sp };
                    render();
                    return;
                }
                // fallback: sprintreport
                return api.getRapidSprintReport(rapidViewId, sp.id).then(function(resp2) {
                    if (CONFIG.debug) console.log("[UJG] sprintreport resp", resp2);
                    var series2 = extractJiraStepSeries(resp2);
                    if (series2 && (series2.scope || series2.completed || series2.guideline)) {
                        cmp.burnCache[sp.id] = { jiraSeries: series2, jiraSource: "sprintreport", sprint: sp };
                    } else {
                        fallbackLocal();
                        return;
                    }
                    render();
                }, function() {
                    fallbackLocal();
                });
            }, function() {
                // Фоллбэк: локальный расчёт по задачам (может отличаться от Jira)
                fallbackLocal();
            });
        }

        function fetchRapidScopeChangeSeries(rapidViewId, sprintId) {
            // На вашем инстансе Jira корректно работает только этот параметр:
            // statisticFieldId=issueCount_
            return api.getRapidScopeChangeBurndown(rapidViewId, sprintId, "issueCount_");
        }

        function parseScopeChangeBurndown(resp) {
            // Jira Server/DC: /rest/greenhopper/1.0/rapid/charts/scopechangeburndownchart
            // resp.changes: { "<ts>": [ {key, added?, removed?, column:{done?, notDone?, newStatus?}, ...}, ... ] }
            if (!resp || !resp.changes) return null;
            var changes = resp.changes || {};
            var startTime = Number(resp.startTime) || null;
            var endTime = Number(resp.endTime) || null;
            var now = Number(resp.now) || null;

            var times = Object.keys(changes).map(function(k) { return Number(k); }).filter(function(v) { return !isNaN(v); }).sort(function(a, b) { return a - b; });
            function flagTrue(v) { return v === true || v === "true" || v === 1 || v === "1"; }
            function flagFalse(v) { return v === false || v === "false" || v === 0 || v === "0"; }

            // Для issueCount_ Jira строит график по "присутствию задач" (1 задача = 1),
            // стартовый scope = задачи, которые были в спринте на старте, а не "все текущие".
            // Берём финальный набор из issueToSummary и вычитаем те, которые были added:true в/после старта.
            var finalKeys = resp.issueToSummary ? Object.keys(resp.issueToSummary) : [];
            var addedAfterStart = {};
            times.forEach(function(ts) {
                if (startTime != null && ts < startTime) return;
                var evs = changes[String(ts)] || changes[ts] || [];
                (evs || []).forEach(function(ev) {
                    if (ev && ev.key && flagTrue(ev.added)) addedAfterStart[ev.key] = true;
                });
            });

            var inScope = {};
            finalKeys.forEach(function(k) {
                if (!k) return;
                if (addedAfterStart[k]) return;
                inScope[k] = true;
            });
            var done = {};
            var scopeVal = Object.keys(inScope).length;
            var doneVal = 0;
            var markersScope = [];
            var markersDone = [];
            var issueToSummary = resp.issueToSummary && typeof resp.issueToSummary === "object" ? resp.issueToSummary : {};

            function setInScope(k, flag) {
                if (!k) return;
                if (flag) {
                    if (!inScope[k]) { inScope[k] = true; scopeVal += 1; }
                } else {
                    if (inScope[k]) {
                        delete inScope[k];
                        scopeVal -= 1;
                        if (done[k]) { delete done[k]; doneVal -= 1; }
                    }
                }
            }
            function setDone(k, flag) {
                if (!k) return;
                if (!inScope[k]) setInScope(k, true);
                if (flag) {
                    if (!done[k]) { done[k] = true; doneVal += 1; }
                } else {
                    if (done[k]) { delete done[k]; doneVal -= 1; }
                }
            }
            function applyEventsAt(ts, collectMarkers) {
                var evs = changes[String(ts)] || changes[ts] || [];
                (evs || []).forEach(function(ev) {
                    if (!ev || !ev.key) return;
                    var k = ev.key;
                    var prevScope = scopeVal;
                    var prevDone = doneVal;
                    var beforeIn = !!inScope[k];
                    var beforeDone = !!done[k];
                    if (flagTrue(ev.removed) || flagTrue(ev.deleted)) setInScope(k, false);
                    if (flagTrue(ev.added)) setInScope(k, true);
                    if (ev.column) {
                        var isDone = flagTrue(ev.column.done) || flagFalse(ev.column.notDone) || flagTrue(ev.done);
                        setDone(k, isDone);
                    }
                    if (flagTrue(ev.done)) setDone(k, true);
                    if (flagTrue(ev.notDone)) setDone(k, false);

                    if (collectMarkers) {
                        // маркер только если реально изменилась линия
                        if (scopeVal !== prevScope) {
                            markersScope.push({
                                ts: ts,
                                key: k,
                                y: scopeVal,
                                from: prevScope,
                                to: scopeVal,
                                op: ev.added ? "added" : (ev.removed || ev.deleted) ? "removed" : "scope",
                                summary: issueToSummary[k] || "",
                                beforeIn: beforeIn,
                                afterIn: !!inScope[k]
                            });
                        }
                        if (doneVal !== prevDone) {
                            markersDone.push({
                                ts: ts,
                                key: k,
                                y: doneVal,
                                from: prevDone,
                                to: doneVal,
                                op: (beforeDone ? "undone" : "done"),
                                statusId: ev.column && ev.column.newStatus ? String(ev.column.newStatus) : (ev.column && ev.column.newstatus ? String(ev.column.newstatus) : ""),
                                summary: issueToSummary[k] || "",
                                beforeDone: beforeDone,
                                afterDone: !!done[k]
                            });
                        }
                    }
                });
            }

            // применяем события ДО старта, чтобы учесть закрытые до старта/удалённые до старта
            // ВАЖНО: используем < (не <=), чтобы события точно в момент startTime создавали маркеры
            if (startTime != null) times.filter(function(t) { return t < startTime; }).forEach(function(t){ applyEventsAt(t, false); });

            var scopePts = [];
            var donePts = [];
            if (startTime != null) {
                scopePts.push({ x: startTime, y: scopeVal });
                donePts.push({ x: startTime, y: doneVal });
            }
            times.filter(function(t) { return startTime == null ? true : t >= startTime; }).forEach(function(ts) {
                // маркеры собираем только в пределах спринта
                var inSprint = (!startTime || ts >= startTime) && (!endTime || ts <= endTime);
                applyEventsAt(ts, inSprint);
                scopePts.push({ x: ts, y: scopeVal });
                donePts.push({ x: ts, y: doneVal });
            });

            if (!startTime && scopePts.length) startTime = scopePts[0].x;
            if (!endTime && scopePts.length) endTime = scopePts[scopePts.length - 1].x;

            // гарантируем точку на старте
            if (startTime != null && scopePts.length && scopePts[0].x > startTime) {
                scopePts.unshift({ x: startTime, y: scopePts[0].y });
                donePts.unshift({ x: startTime, y: donePts[0].y });
            }

            // гарантируем точку на конце
            if (endTime != null && scopePts.length) {
                var lastScope = scopePts[scopePts.length - 1].y;
                var lastDone = donePts[donePts.length - 1].y;
                if (scopePts[scopePts.length - 1].x !== endTime) {
                    scopePts.push({ x: endTime, y: lastScope });
                    donePts.push({ x: endTime, y: lastDone });
                }
            }

            // Guideline как в Jira: линейная кривая к финальному scope, но с плато на нерабочих днях
            var guideline = null;
            if (startTime != null && endTime != null && resp.workRateData && resp.workRateData.rates && resp.workRateData.rates.length) {
                var rates = resp.workRateData.rates.slice().sort(function(a, b) { return (a.start || 0) - (b.start || 0); });
                var workDays = 0;
                rates.forEach(function(r) {
                    var rs = Math.max(Number(r.start) || 0, startTime);
                    var re = Math.min(Number(r.end) || 0, endTime);
                    var rate = Number(r.rate) || 0;
                    if (re <= rs) return;
                    if (rate > 0) workDays += (re - rs) / (24 * 3600 * 1000);
                });
                var finalScope = scopePts.length ? scopePts[scopePts.length - 1].y : 0;
                var perDay = workDays > 0 ? (finalScope / workDays) : 0;
                var pts = [{ x: startTime, y: 0 }];
                var cur = 0;
                rates.forEach(function(r) {
                    var rs = Math.max(Number(r.start) || 0, startTime);
                    var re = Math.min(Number(r.end) || 0, endTime);
                    var rate = Number(r.rate) || 0;
                    if (re <= rs) return;
                    if (pts[pts.length - 1].x !== rs) pts.push({ x: rs, y: cur });
                    if (rate > 0) {
                        var days = (re - rs) / (24 * 3600 * 1000);
                        cur += perDay * days;
                    }
                    pts.push({ x: re, y: cur });
                });
                guideline = pts;
            } else if (startTime != null && endTime != null && scopePts.length) {
                var finalScope = scopePts[scopePts.length - 1].y;
                guideline = [{ x: startTime, y: 0 }, { x: endTime, y: finalScope }];
            }

            // Projection объёма: после "сегодня" (now) держим текущий scope до конца (как красный пунктир в Jira)
            var projection = null;
            if (now && endTime && scopePts.length) {
                // текущий scope на now
                var curScope = scopePts[scopePts.length - 1].y;
                for (var i = 0; i < scopePts.length; i++) {
                    if (scopePts[i].x <= now) curScope = scopePts[i].y;
                    else break;
                }
                projection = [{ x: now, y: curScope }, { x: endTime, y: curScope }];
            }

            return {
                scope: scopePts,
                completed: donePts,
                guideline: guideline,
                projection: projection,
                now: now,
                startTime: startTime,
                endTime: endTime,
                workRateData: resp.workRateData || null,
                markers: { scope: markersScope, done: markersDone }
            };
        }

        function ensureJiraScopeChangeForSprint() {
            if (!state.selectedSprintId || !state.selectedBoardId || !state.sprint) return;
            if (!state.jiraScope) state.jiraScope = { sprintId: null, mode: "tasks", loading: false, error: false, series: null };
            var js = state.jiraScope;
            var sid = state.selectedSprintId;
            var mode = state.chartMode || "tasks";
            if (js.loading) return;
            if (js.sprintId === sid && js.mode === mode && (js.series || js.error)) return;
            js.sprintId = sid;
            js.mode = mode;
            js.loading = true;
            js.error = false;
            js.series = null;

            fetchRapidScopeChangeSeries(state.selectedBoardId, sid).then(function(resp) {
                if (CONFIG.debug) console.log("[UJG] main scopechangeburndownchart resp", resp);
                var series = parseScopeChangeBurndown(resp);
                if (series && (series.scope || series.completed || series.guideline)) {
                    js.series = series;
                    js.loading = false;
                    render();
                    return;
                }
                js.error = true;
                js.loading = false;
                render();
            }, function(err) {
                if (CONFIG.debug) console.log("[UJG] main scopechangeburndownchart error", err, err && err.responseText);
                js.error = true;
                js.loading = false;
                render();
            });
        }

        function extractJiraStepSeries(resp) {
            // Пытаемся «вытащить» 3 ключевые серии из разных версий Jira
            // Возвращаем { scope: [{x,y}], completed: [{x,y}], guideline: [{x,y}], projection?: [{x,y}] }
            function isNum(v) { return typeof v === "number" && !isNaN(v); }
            function toPoints(raw) {
                if (!raw) return null;
                // array of numbers
                if (Array.isArray(raw) && raw.length && isNum(raw[0])) {
                    return raw.map(function(y, i) { return { x: i, y: y }; });
                }
                // array of pairs
                if (Array.isArray(raw) && raw.length && Array.isArray(raw[0]) && raw[0].length >= 2) {
                    return raw.map(function(p) { return { x: isNum(p[0]) ? p[0] : Number(p[0]) || 0, y: isNum(p[1]) ? p[1] : Number(p[1]) || 0 }; });
                }
                // array of objects {x,y} or {time,value}
                if (Array.isArray(raw) && raw.length && typeof raw[0] === "object") {
                    var keys = Object.keys(raw[0] || {});
                    if (keys.indexOf("x") >= 0 && keys.indexOf("y") >= 0) {
                        return raw.map(function(p) { return { x: Number(p.x) || 0, y: Number(p.y) || 0 }; });
                    }
                    if (keys.indexOf("time") >= 0 && (keys.indexOf("value") >= 0 || keys.indexOf("y") >= 0)) {
                        return raw.map(function(p) { return { x: Number(p.time) || 0, y: Number(p.value != null ? p.value : p.y) || 0 }; });
                    }
                }
                // object map {ts:val}
                if (typeof raw === "object") {
                    var pts = [];
                    Object.keys(raw).forEach(function(k) {
                        var x = Number(k);
                        var y = Number(raw[k]);
                        if (!isNaN(x) && !isNaN(y)) pts.push({ x: x, y: y });
                    });
                    if (pts.length) {
                        pts.sort(function(a, b) { return a.x - b.x; });
                        return pts;
                    }
                }
                return null;
            }

            function findCandidates(obj, path, out) {
                if (!obj || typeof obj !== "object") return;
                if (out.length > 200) return; // safety
                Object.keys(obj).forEach(function(k) {
                    var v = obj[k];
                    var p = path ? (path + "." + k) : k;
                    // candidate series by key
                    if (v && (Array.isArray(v) || typeof v === "object")) {
                        if (/(scope|totalScope|allIssues|allIssuesEstimate)/i.test(k) ||
                            /(completed|done|work|workCompleted|doneIssues|completedIssues)/i.test(k) ||
                            /(guideline|guide|ideal|baseline)/i.test(k) ||
                            /(projection|forecast|predict)/i.test(k)) {
                            var pts = toPoints(v);
                            if (pts && pts.length) out.push({ key: k, path: p, pts: pts });
                        }
                    }
                    // recurse
                    if (v && typeof v === "object" && !Array.isArray(v)) findCandidates(v, p, out);
                });
            }

            var cands = [];
            findCandidates(resp, "", cands);

            function pick(re) {
                var hit = cands.find(function(c) { return re.test(c.key) || re.test(c.path); });
                return hit ? hit.pts : null;
            }

            var scope = pick(/scope|allIssues|total/i);
            var completed = pick(/completed|done|work/i);
            var guideline = pick(/guideline|ideal|baseline/i);
            var projection = pick(/projection|forecast|predict/i);

            // если не нашли по ключам — пробуем по размерам (самая «верхняя» серия = scope)
            if (!scope && cands.length) {
                var byMax = cands.slice().sort(function(a, b) {
                    var am = Math.max.apply(null, a.pts.map(function(p) { return p.y; }));
                    var bm = Math.max.apply(null, b.pts.map(function(p) { return p.y; }));
                    return bm - am;
                });
                scope = byMax[0] ? byMax[0].pts : null;
            }

            // нормализация: если x — индексы, приводим x в общий диапазон
            function ensureX(pts) {
                if (!pts || !pts.length) return pts;
                var uniq = {};
                pts.forEach(function(p) { uniq[p.x] = true; });
                var keys = Object.keys(uniq);
                if (keys.length <= 1) {
                    return pts.map(function(p, i) { return { x: i, y: p.y }; });
                }
                return pts;
            }

            return {
                scope: ensureX(scope),
                completed: ensureX(completed),
                guideline: ensureX(guideline),
                projection: ensureX(projection)
            };
        }

        function renderMiniJiraStepChart(series) {
            if (!series) return '<div class="ujg-compare-loading">Нет данных</div>';
            var sScope = series.scope || [];
            var sComp = series.completed || [];
            var sGuide = series.guideline || [];
            var sProj = series.projection || [];
            var all = []
                .concat(sScope || [])
                .concat(sComp || [])
                .concat(sGuide || [])
                .concat(sProj || []);
            if (!all.length) return '<div class="ujg-compare-loading">Нет данных</div>';

            var minX = Math.min.apply(null, all.map(function(p) { return p.x; }));
            var maxX = Math.max.apply(null, all.map(function(p) { return p.x; }));
            if (!isFinite(minX) || !isFinite(maxX) || minX === maxX) { minX = 0; maxX = Math.max(all.length - 1, 1); }
            var maxY = Math.max.apply(null, all.map(function(p) { return p.y; })) || 1;

            function niceTicks(maxVal, count) {
                if (maxVal <= 0) return [0, 1];
                var rough = maxVal / Math.max(count, 1);
                var pow10 = Math.pow(10, Math.floor(Math.log10(rough)));
                var step = pow10;
                var err = rough / pow10;
                if (err >= 7.5) step = pow10 * 10;
                else if (err >= 3.5) step = pow10 * 5;
                else if (err >= 1.5) step = pow10 * 2;
                var ticks = [];
                for (var v = 0; v <= maxVal + step * 0.4; v += step) ticks.push(v);
                if (ticks[ticks.length - 1] < maxVal) ticks.push(maxVal);
                return ticks;
            }

            var yTicks = niceTicks(maxY, 5);
            maxY = yTicks[yTicks.length - 1] || 1;

            var VIEW_W = 110, VIEW_H = 80;
            var pad = { top: 8, right: 4, bottom: 10, left: 8 };
            var plotW = VIEW_W - pad.left - pad.right;
            var plotH = VIEW_H - pad.top - pad.bottom;

            function xPos(x) {
                var t = (x - minX) / Math.max((maxX - minX), 1);
                return pad.left + plotW * t;
            }
            function yPos(y) {
                return pad.top + plotH - (plotH * (y / maxY));
            }

            function stepPath(pts) {
                if (!pts || pts.length === 0) return "";
                var sorted = pts.slice().sort(function(a, b) { return a.x - b.x; });
                var d = "M " + xPos(sorted[0].x) + " " + yPos(sorted[0].y);
                for (var i = 1; i < sorted.length; i++) {
                    var prev = sorted[i - 1];
                    var cur = sorted[i];
                    var x = xPos(cur.x);
                    d += " L " + x + " " + yPos(prev.y);
                    d += " L " + x + " " + yPos(cur.y);
                }
                return d;
            }

            function dots(pts, cls) {
                if (!pts || !pts.length) return "";
                var sorted = pts.slice().sort(function(a, b) { return a.x - b.x; });
                return sorted.map(function(p) {
                    return '<circle class="' + cls + '" cx="' + xPos(p.x) + '" cy="' + yPos(p.y) + '" r="1.4"/>';
                }).join("");
            }

            var html = '<div class="ujg-mini-burn ujg-mini-jira">';
            html += '<svg class="ujg-svg ujg-burn-svg" viewBox="0 0 ' + VIEW_W + ' ' + VIEW_H + '" preserveAspectRatio="xMidYMid meet">';

            yTicks.forEach(function(v) {
                var y = yPos(v);
                html += '<line class="ujg-burn-grid" x1="' + pad.left + '" y1="' + y + '" x2="' + (VIEW_W - pad.right) + '" y2="' + y + '"/>';
            });
            html += '<line class="ujg-burn-axis" x1="' + pad.left + '" y1="' + (VIEW_H - pad.bottom) + '" x2="' + (VIEW_W - pad.right) + '" y2="' + (VIEW_H - pad.bottom) + '"/>';
            html += '<line class="ujg-burn-axis" x1="' + pad.left + '" y1="' + pad.top + '" x2="' + pad.left + '" y2="' + (VIEW_H - pad.bottom) + '"/>';

            if (sGuide && sGuide.length) html += '<path class="ujg-jira-guide" d="' + stepPath(sGuide) + '"/>' + dots(sGuide, "ujg-jira-guide-dot");
            if (sProj && sProj.length) html += '<path class="ujg-jira-proj" d="' + stepPath(sProj) + '"/>' + dots(sProj, "ujg-jira-proj-dot");
            if (sScope && sScope.length) html += '<path class="ujg-jira-scope" d="' + stepPath(sScope) + '"/>' + dots(sScope, "ujg-jira-scope-dot");
            if (sComp && sComp.length) html += '<path class="ujg-jira-done" d="' + stepPath(sComp) + '"/>' + dots(sComp, "ujg-jira-done-dot");

            html += '</svg></div>';
            return html;
        }

        function buildJiraScopeSvg(series, opts) {
            opts = opts || {};
            if (!series) return { svg: '<div class="ujg-compare-loading">Нет данных</div>' };
            var VIEW_W = opts.viewW || 882;
            var VIEW_H = opts.viewH || 500;
            var pad = opts.pad || { top: 20, right: 20, bottom: 50, left: 60 };
            var sScopeRaw = series.scope || [];
            var sCompRaw = series.completed || [];
            var sGuideRaw = series.guideline || [];
            var sProjRaw = series.projection || [];
            var all = []
                .concat(sScopeRaw || [])
                .concat(sCompRaw || [])
                .concat(sGuideRaw || [])
                .concat(sProjRaw || []);
            if (!all.length) return { svg: '<div class="ujg-compare-loading">Нет данных</div>' };
            // Ось X строго по границам спринта (не выходим за диапазон)
            var minX = series.startTime != null ? series.startTime : Math.min.apply(null, all.map(function(p) { return p.x; }));
            var maxX = series.endTime != null ? series.endTime : Math.max.apply(null, all.map(function(p) { return p.x; }));
            if (!isFinite(minX) || !isFinite(maxX) || minX === maxX) { minX = 0; maxX = Math.max(all.length - 1, 1); }
            var maxY = Math.max.apply(null, all.map(function(p) { return p.y; })) || 1;
            function niceTicks(maxVal, count) {
                if (maxVal <= 0) return [0, 1];
                var rough = maxVal / Math.max(count, 1);
                var pow10 = Math.pow(10, Math.floor(Math.log10(rough)));
                var step = pow10;
                var err = rough / pow10;
                if (err >= 7.5) step = pow10 * 10;
                else if (err >= 3.5) step = pow10 * 5;
                else if (err >= 1.5) step = pow10 * 2;
                var ticks = [];
                for (var v = 0; v <= maxVal + step * 0.4; v += step) ticks.push(v);
                if (ticks[ticks.length - 1] < maxVal) ticks.push(maxVal);
                return ticks;
            }
            var yTicks = niceTicks(maxY, 6);
            maxY = yTicks[yTicks.length - 1] || 1;
            var plotW = VIEW_W - pad.left - pad.right;
            var plotH = VIEW_H - pad.top - pad.bottom;
            function xPos(x) {
                var t = (x - minX) / Math.max((maxX - minX), 1);
                return pad.left + plotW * t;
            }
            function yPos(y) {
                return pad.top + plotH - (plotH * (y / maxY));
            }
            function yAtOrBefore(pts, x) {
                if (!pts || !pts.length) return 0;
                var sorted = pts.slice().sort(function(a, b) { return a.x - b.x; });
                var val = sorted[0].y;
                for (var i = 0; i < sorted.length; i++) {
                    if (sorted[i].x <= x) val = sorted[i].y;
                    else break;
                }
                return val;
            }
            function clipToSprint(pts, startTs, endTs, opts) {
                if (!pts || !pts.length) return [];
                opts = opts || {};
                var noPrependStart = !!opts.noPrependStart;
                var sorted = pts.slice().sort(function(a, b) { return a.x - b.x; });
                if (!(isFinite(startTs) && isFinite(endTs)) || endTs <= startTs) return sorted;
                // стартовое значение берём из последней точки <= startTs (может быть "вне спринта")
                var yStart = yAtOrBefore(sorted, startTs);
                var out = noPrependStart ? [] : [{ x: startTs, y: yStart }];
                sorted.forEach(function(p) {
                    if (p.x > startTs && p.x <= endTs) out.push({ x: p.x, y: p.y });
                });
                // гарантируем конец в endTs (без выхода за спринт)
                var yEnd = yAtOrBefore(sorted, endTs);
                if (out[out.length - 1].x !== endTs) out.push({ x: endTs, y: yEnd });
                return out;
            }
            function clipToNow(pts, nowTs) {
                if (!pts || !pts.length) return [];
                var sorted = pts.slice().sort(function(a, b) { return a.x - b.x; });
                if (!(nowTs && isFinite(nowTs))) return sorted;
                if (nowTs < sorted[0].x) return [{ x: nowTs, y: sorted[0].y }];
                var out = sorted.filter(function(p) { return p.x <= nowTs; });
                // добавим точку на now, чтобы линия упиралась в Today
                var yNow = yAtOrBefore(sorted, nowTs);
                if (!out.length || out[out.length - 1].x !== nowTs) out.push({ x: nowTs, y: yNow });
                return out;
            }
            function stepPoints(pts) {
                if (!pts || pts.length === 0) return [];
                var sorted = pts.slice().sort(function(a, b) { return a.x - b.x; });
                var out = [{ x: sorted[0].x, y: sorted[0].y }];
                for (var i = 1; i < sorted.length; i++) {
                    var prev = sorted[i - 1];
                    var cur = sorted[i];
                    out.push({ x: cur.x, y: prev.y });
                    out.push({ x: cur.x, y: cur.y });
                }
                return out;
            }
            function pathFromPoints(pts) {
                if (!pts || pts.length === 0) return "";
                var d = "M " + xPos(pts[0].x) + " " + yPos(pts[0].y);
                for (var i = 1; i < pts.length; i++) d += " L " + xPos(pts[i].x) + " " + yPos(pts[i].y);
                return d;
            }
            function linePath(pts) {
                if (!pts || pts.length === 0) return "";
                var sorted = pts.slice().sort(function(a, b) { return a.x - b.x; });
                return pathFromPoints(sorted);
            }
            function eventDots(markers, cls, label, opts) {
                markers = markers || [];
                opts = opts || {};
                var excludeX = opts.excludeX;
                var skipFirstIfZero = !!opts.skipFirstIfZero;
                var filtered = markers.slice().sort(function(a, b) { return a.ts - b.ts; });
                if (excludeX != null) filtered = filtered.filter(function(m) { return m.ts !== excludeX; });
                if (skipFirstIfZero && filtered.length && filtered[0].y === 0) filtered = filtered.slice(1);
                return filtered.map(function(m) {
                    var tip = "Дата: " + fmtX(m.ts) + "\n" + label + ": " + m.y + "\n" + (m.key || "");
                    var summary = m.summary ? ("\n" + m.summary) : "";
                    return '<circle class="ujg-jira-mk ' + cls + '" cx="' + xPos(m.ts) + '" cy="' + yPos(m.y) + '" r="4"' +
                        ' data-key="' + utils.escapeHtml(m.key || "") + '"' +
                        ' data-ts="' + m.ts + '"' +
                        ' data-kind="' + utils.escapeHtml(label) + '"' +
                        ' data-from="' + m.from + '"' +
                        ' data-to="' + m.to + '"' +
                        ' data-op="' + utils.escapeHtml(m.op || "") + '"' +
                        ' data-summary="' + utils.escapeHtml(m.summary || "") + '"' +
                        '><title>' + utils.escapeHtml(tip + summary) + '</title></circle>';
                }).join("");
            }
            function dottedProjection(projPts) {
                if (!projPts || projPts.length < 2) return "";
                var p0 = projPts[0], p1 = projPts[projPts.length - 1];
                var y = yPos(p0.y);
                var x0 = xPos(p0.x);
                var x1 = xPos(p1.x);
                var step = 10; // как "точки" в Jira
                var html = "";
                for (var x = x0; x <= x1 + 0.1; x += step) {
                    html += '<circle class="ujg-jira-proj-dotline" cx="' + x + '" cy="' + y + '" r="2.1"></circle>';
                }
                return html;
            }
            function fmtX(ts) {
                try {
                    var d = new Date(ts);
                    var m = d.toLocaleDateString("ru-RU", { month: "short" }).replace(".", "");
                    return m + " " + d.getDate();
                } catch (e) { return ""; }
            }
            // Сначала клипуем все серии в границы спринта (X строго внутри спринта)
            var spStart = series.startTime != null ? series.startTime : minX;
            var spEnd = series.endTime != null ? series.endTime : maxX;
            var sScopeBase = clipToSprint(sScopeRaw, spStart, spEnd);
            var sCompBase = clipToSprint(sCompRaw, spStart, spEnd);
            var sGuide = clipToSprint(sGuideRaw, spStart, spEnd);

            // Обрезаем "факт" по линии сегодня (как в Jira): после Today зелёный не рисуем, красный "факт" не рисуем
            var nowInSprint = series.now && series.startTime && series.endTime && series.now >= series.startTime && series.now <= series.endTime;
            var sScope = nowInSprint ? clipToNow(sScopeBase, series.now) : sScopeBase;
            var sComp = nowInSprint ? clipToNow(sCompBase, series.now) : sCompBase;
            // Прогноз должен начинаться строго с линии "Сегодня", без "дотягивания" от старта спринта
            var projStart = nowInSprint ? series.now : spStart;
            var sProj = clipToSprint(sProjRaw, projStart, spEnd, { noPrependStart: true });

            var out = '<svg class="ujg-svg ujg-burn-svg" width="' + VIEW_W + '" height="' + VIEW_H + '" viewBox="0 0 ' + VIEW_W + ' ' + VIEW_H + '" preserveAspectRatio="xMidYMid meet">';

            // Нерабочие дни (серые полосы) как в Jira
            if (series.workRateData && series.workRateData.rates && Array.isArray(series.workRateData.rates)) {
                series.workRateData.rates.forEach(function(r) {
                    var rs = Number(r.start), re = Number(r.end), rate = Number(r.rate);
                    if (!isFinite(rs) || !isFinite(re) || re <= rs) return;
                    if (!isFinite(rate) || rate !== 0) return;
                    var x1 = xPos(rs);
                    var x2 = xPos(re);
                    out += '<rect class="non-working-days" x="' + x1 + '" y="' + pad.top + '" width="' + Math.max(0, x2 - x1) + '" height="' + plotH + '"/>';
                });
            }

            yTicks.forEach(function(v) {
                var y = yPos(v);
                out += '<line class="ujg-burn-grid" x1="' + pad.left + '" y1="' + y + '" x2="' + (VIEW_W - pad.right) + '" y2="' + y + '"/>';
                out += '<text class="ujg-burn-label ujg-burn-y" x="' + (pad.left - 2) + '" y="' + (y + 1.2) + '">' + v + '</text>';
            });
            out += '<line class="ujg-burn-axis" x1="' + pad.left + '" y1="' + (VIEW_H - pad.bottom) + '" x2="' + (VIEW_W - pad.right) + '" y2="' + (VIEW_H - pad.bottom) + '"/>';
            out += '<line class="ujg-burn-axis" x1="' + pad.left + '" y1="' + pad.top + '" x2="' + pad.left + '" y2="' + (VIEW_H - pad.bottom) + '"/>';
            // x ticks как Jira (примерно раз в 2 дня)
            var dayMs = 24 * 3600 * 1000;
            var startDay = utils.startOfDay(new Date(minX)).getTime();
            var endDay = utils.startOfDay(new Date(maxX)).getTime();
            for (var t = startDay; t <= endDay + 1; t += 2 * dayMs) {
                var x = xPos(t);
                out += '<line class="ujg-burn-grid" x1="' + x + '" y1="' + pad.top + '" x2="' + x + '" y2="' + (VIEW_H - pad.bottom) + '"/>';
                out += '<text class="ujg-burn-label ujg-burn-x" x="' + x + '" y="' + (VIEW_H - pad.bottom + 16) + '">' + utils.escapeHtml(fmtX(t)) + '</text>';
            }

            // Линии/маркеры как в Jira:
            // - guideline: только линия, без кружков
            // - projection: рисуем точками (без линии)
            // - scope/work: ступеньки + кружки только когда значение менялось
            if (sGuide && sGuide.length) out += '<path class="ujg-jira-guide" d="' + linePath(sGuide) + '"/>';
            if (sProj && sProj.length) out += dottedProjection(sProj);
            if (sScope && sScope.length) out += '<path class="ujg-jira-scope" d="' + pathFromPoints(stepPoints(sScope)) + '"/>' +
                eventDots((series.markers && series.markers.scope) ? series.markers.scope : [], "ujg-jira-scope-dot", "Объём работ", { excludeX: (nowInSprint ? series.now : null) });
            if (sComp && sComp.length) out += '<path class="ujg-jira-done" d="' + pathFromPoints(stepPoints(sComp)) + '"/>' +
                eventDots((series.markers && series.markers.done) ? series.markers.done : [], "ujg-jira-done-dot", "Завершенная работа", { excludeX: (nowInSprint ? series.now : null), skipFirstIfZero: true });

            // Today line — только если "сегодня" попадает в период спринта
            if (nowInSprint) {
                var tx = xPos(series.now);
                out += '<line class="ujg-burn-today" x1="' + tx + '" y1="' + pad.top + '" x2="' + tx + '" y2="' + (VIEW_H - pad.bottom) + '"/>';
                out += '<text class="ujg-burn-label ujg-burn-x" x="' + tx + '" y="' + (pad.top - 2) + '" fill="#d7a000">Сегодня</text>';
            }

            // Axis labels как в Jira
            out += '<text class="axis-label" text-anchor="middle" transform="translate(' + ((pad.left + (VIEW_W - pad.right)) / 2) + ',' + (VIEW_H - 8) + ') rotate(0,0,0)">ВРЕМЯ</text>';
            out += '<text class="axis-label" text-anchor="middle" transform="translate(16,' + ((pad.top + (VIEW_H - pad.bottom)) / 2) + ') rotate(270,0,0)">КОЛИЧЕСТВО ПРОБЛЕМ</text>';
            out += '</svg>';
            return {
                svg: out,
                layout: {
                    viewW: VIEW_W,
                    viewH: VIEW_H,
                    pad: pad,
                    minX: minX,
                    maxX: maxX,
                    maxY: maxY,
                    plotW: plotW,
                    plotH: plotH,
                    xPos: xPos,
                    yPos: yPos
                }
            };
        }

        function renderJiraScopeChangeChart() {
            var js = state.jiraScope || {};
            if (!state.sprint || !state.sprint.id) return '';
            var html = '<div class="ujg-chart-wrap">';
            html += '<div class="ujg-chart-hdr">';
            html += '<span class="ujg-chart-title">Диаграма сгорания</span>';
            html += '<div class="ujg-burn-tabs"><span class="ujg-burn-tab on" data-burnview="jira">Jira</span><span class="ujg-burn-tab" data-burnview="burndown">Burndown</span></div>';
            html += '<div class="ujg-chart-actions">';
            html += '<button class="ujg-btn ujg-btn-chart-fs" title="Показать на весь экран">Показать на весь экран</button>';
            html += '<div class="ujg-legend">';
            html += '<span class="ujg-leg"><i style="background:#de350b"></i>Объём работ</span>';
            html += '<span class="ujg-leg"><i style="background:#ff5630"></i>Прогноз объёма</span>';
            html += '<span class="ujg-leg"><i style="background:#36b37e"></i>Завершенная работа</span>';
            html += '<span class="ujg-leg"><i style="background:#b3bac5"></i>Руководство</span>';
            html += '</div></div></div>';

            html += '<div class="ujg-chart-body ujg-chart-burn ujg-jira-main">';
            if (js.loading) {
                html += '<div class="ujg-loading">⏳ Загрузка Jira Sprint Report...</div>';
            } else if (js.error) {
                html += '<div class="ujg-loading">Не удалось загрузить Jira Sprint Report</div>';
            } else if (js.series && (js.series.scope || js.series.completed || js.series.guideline)) {
                // Увеличенный step-chart (по timestamp x)
                var svgRes = buildJiraScopeSvg(js.series, { viewW: 882, viewH: 500, pad: { top: 20, right: 20, bottom: 50, left: 60 } });
                html += svgRes.svg;
            } else {
                html += '<div class="ujg-loading">Нет данных Jira Sprint Report</div>';
            }
            html += '</div></div>';
            return html;
        }

        function renderMiniBurn(data, mode) {
            mode = mode || "tasks";
            if (!data || data.length === 0) return '<div class="ujg-compare-loading">Нет данных</div>';

            function getVal(d, keyHours, keyTasks) {
                return mode === "hours" ? (d[keyHours] == null ? null : d[keyHours]) : (d[keyTasks] == null ? null : d[keyTasks]);
            }

            function niceTicks(maxVal, count) {
                if (maxVal <= 0) return [0, 1];
                var rough = maxVal / Math.max(count, 1);
                var pow10 = Math.pow(10, Math.floor(Math.log10(rough)));
                var step = pow10;
                var err = rough / pow10;
                if (err >= 7.5) step = pow10 * 10;
                else if (err >= 3.5) step = pow10 * 5;
                else if (err >= 1.5) step = pow10 * 2;
                var ticks = [];
                for (var v = 0; v <= maxVal + step * 0.4; v += step) ticks.push(v);
                if (ticks[ticks.length - 1] < maxVal) ticks.push(maxVal);
                return ticks;
            }

            var maxScope = Math.max.apply(null, data.map(function(d) { return getVal(d, "scopeHours", "scopeTasks") || 0; }));
            var maxDone = Math.max.apply(null, data.map(function(d) { return getVal(d, "doneHours", "doneTasks") || 0; }));
            var maxIdeal = Math.max.apply(null, data.map(function(d) { return getVal(d, "idealHours", "idealTasks") || 0; }));
            var maxValRaw = Math.max(maxScope, maxDone, maxIdeal, 1);
            var yTicks = niceTicks(maxValRaw, 5);
            var maxVal = yTicks[yTicks.length - 1] || 1;

            var VIEW_W = 110, VIEW_H = 80;
            var pad = { top: 8, right: 4, bottom: 12, left: 10 };
            var plotW = VIEW_W - pad.left - pad.right;
            var plotH = VIEW_H - pad.top - pad.bottom;

            function xPos(idx) {
                var n = Math.max(data.length - 1, 1);
                return pad.left + (plotW * idx / n);
            }
            function yPos(val) {
                return pad.top + plotH - (plotH * (val / maxVal));
            }

            var idealPts = [], realPts = [];
            data.forEach(function(d, idx) {
                var x = xPos(idx);
                var idealVal = getVal(d, "idealHours", "idealTasks");
                var realVal = getVal(d, "doneHours", "doneTasks");
                if (idealVal != null) idealPts.push(x + "," + yPos(idealVal));
                if (realVal != null) realPts.push(x + "," + yPos(realVal));
            });

            var todayIdx = data.findIndex(function(d) { return d.isToday; });

            var html = '<div class="ujg-mini-burn">';
            html += '<svg class="ujg-svg ujg-burn-svg" viewBox="0 0 ' + VIEW_W + ' ' + VIEW_H + '" preserveAspectRatio="xMidYMid meet">';

            yTicks.forEach(function(v) {
                var y = yPos(v);
                html += '<line class="ujg-burn-grid" x1="' + pad.left + '" y1="' + y + '" x2="' + (VIEW_W - pad.right) + '" y2="' + y + '"/>';
            });
            var xStep = Math.max(1, Math.ceil(data.length / 6));
            data.forEach(function(d, idx) {
                var x = xPos(idx);
                html += '<line class="ujg-burn-grid" x1="' + x + '" y1="' + pad.top + '" x2="' + x + '" y2="' + (VIEW_H - pad.bottom) + '"/>';
                if (idx % xStep === 0 || idx === data.length - 1) {
                    html += '<text class="ujg-burn-label ujg-burn-x" x="' + x + '" y="' + (VIEW_H - pad.bottom + 4) + '">' + utils.escapeHtml(d.label || "") + '</text>';
                }
            });
            html += '<line class="ujg-burn-axis" x1="' + pad.left + '" y1="' + (VIEW_H - pad.bottom) + '" x2="' + (VIEW_W - pad.right) + '" y2="' + (VIEW_H - pad.bottom) + '"/>';
            html += '<line class="ujg-burn-axis" x1="' + pad.left + '" y1="' + pad.top + '" x2="' + pad.left + '" y2="' + (VIEW_H - pad.bottom) + '"/>';

            if (todayIdx >= 0) {
                var todayX = xPos(todayIdx);
                html += '<line class="ujg-burn-today" x1="' + todayX + '" y1="' + pad.top + '" x2="' + todayX + '" y2="' + (VIEW_H - pad.bottom) + '"/>';
            }

            if (idealPts.length > 0) html += '<polyline class="ujg-burn-ideal" points="' + idealPts.join(" ") + '"/>';
            if (realPts.length > 0) html += '<polyline class="ujg-burn-real" points="' + realPts.join(" ") + '"/>';

            html += '</svg></div>';
            return html;
        }

        function groupByAssignee() {
            var map = {}, issueMap = {}, outside = { id: "__outside__", name: "Вне команды", issues: [], hours: 0 };
            var sprintStart = state.sprint ? utils.startOfDay(utils.parseDate(state.sprint.startDate)) : null;
            var sprintEnd = state.sprint ? utils.startOfDay(utils.parseDate(state.sprint.endDate)) : null;
            var teamMembers = state.teamMembers || [];
            var srcIssues = state.viewIssues && state.viewIssues.length ? state.viewIssues : state.issues;
            var totalLoggedInSprintSec = 0;
            var totalLoggedOutSprintSec = 0;
            var cap = getSprintCapacity();
            var capSec = cap.capSec || 0;

            function sumWorklogByDaySec(wlByDay) {
                if (!wlByDay) return 0;
                var sum = 0;
                Object.keys(wlByDay).forEach(function(k) {
                    var v = wlByDay[k];
                    if (v && v.sec) sum += (v.sec || 0);
                });
                return sum;
            }

            function matchAuthorSeconds(workAuthors, user) {
                if (!workAuthors || !workAuthors.length || !user) return 0;
                var uid = user.id || "";
                var uname = (user.name || "").toLowerCase();
                var ulogin = (user.login || "").toLowerCase();
                for (var i = 0; i < workAuthors.length; i++) {
                    var wa = workAuthors[i] || {};
                    if (uid && wa.id && wa.id === uid) return wa.seconds || 0;
                }
                for (var j = 0; j < workAuthors.length; j++) {
                    var wa2 = workAuthors[j] || {};
                    if (ulogin && wa2.id && String(wa2.id).toLowerCase() === ulogin) return wa2.seconds || 0;
                    if (uname && wa2.name && String(wa2.name).toLowerCase() === uname) return wa2.seconds || 0;
                }
                return 0;
            }

            function ensureGroupStats(g) {
                if (!g) return g;
                if (g.plannedSec == null) g.plannedSec = 0;
                if (g.spentInSprintSec == null) g.spentInSprintSec = 0;
                if (g.spentOutSprintSec == null) g.spentOutSprintSec = 0;
                if (g.tasksInSprint == null) g.tasksInSprint = 0;
                if (g.doneInSprint == null) g.doneInSprint = 0;
                if (g.estimatedInSprint == null) g.estimatedInSprint = 0;
                if (g.alertNoEstCount == null) g.alertNoEstCount = 0;
                if (!g.alertNoEstKeys) g.alertNoEstKeys = [];
                if (g.wipCount == null) g.wipCount = 0;
                if (!g.wipKeys) g.wipKeys = [];
                if (g.lastLogDate == null) g.lastLogDate = null; // последний день списаний В СПРИНТЕ
                if (g.alertNoWip == null) g.alertNoWip = false; // нет задач "в работе"
                if (g.alertAllDone == null) g.alertAllDone = false; // все задачи спринта выполнены
                if (g.alertNoLogs3d == null) g.alertNoLogs3d = false; // нет списаний >=3 раб.дн (только текущий спринт)
                if (g.alertUnderLogFinished == null) g.alertUnderLogFinished = false; // спринт закрыт, списаний мало
                if (g.noLogDays == null) g.noLogDays = 0;
                return g;
            }

            function matchAuthorLastDay(wlByAuthor, user) {
                if (!wlByAuthor || !user) return null;
                var uid = (user.id || "").toLowerCase();
                var uname = (user.name || "").toLowerCase();
                var ulogin = (user.login || "").toLowerCase();
                var best = null;
                Object.keys(wlByAuthor).forEach(function(aid) {
                    var aidL = String(aid || "").toLowerCase();
                    var ok = false;
                    if (uid && aidL === uid) ok = true;
                    if (!ok && ulogin && aidL === ulogin) ok = true;
                    if (!ok && uname && aidL === uname) ok = true;
                    if (!ok) return;
                    var byDay = wlByAuthor[aid] || {};
                    Object.keys(byDay).forEach(function(dk) {
                        var d = utils.startOfDay(utils.parseDate(dk));
                        if (!d) return;
                        if (!best || d > best) best = d;
                    });
                });
                return best;
            }

            // ВАЖНО: добавляем всех участников команды заранее, даже если у них нет задач в спринте.
            // Это нужно, чтобы loadExtraWorklogIssues() мог запросить "вне спринта" по каждому.
            teamMembers.forEach(function(uid) {
                if (!uid) return;
                if (!map[uid]) {
                    var nm = (state.teamMemberNames && state.teamMemberNames[uid]) ? state.teamMemberNames[uid] : uid;
                    map[uid] = { id: uid, name: nm, login: uid, issues: [], hours: 0 };
                    ensureGroupStats(map[uid]);
                }
            });

            srcIssues.forEach(function(iss) {
                var f = iss.fields || {};
                var estRaw = (f.timetracking && f.timetracking.originalEstimateSeconds) || f.timeoriginalestimate || 0;
                var est = (capSec && capSec > 0) ? Math.min(estRaw, capSec) : estRaw;
                var due = utils.startOfDay(utils.parseDate(f.duedate) || (state.sprint ? utils.parseDate(state.sprint.endDate) : null));
                var durationDays = utils.getWorkDurationDays(est, CONFIG.hoursPerDay);
                var start = due ? utils.shiftWorkDays(due, -(durationDays - 1)) :
                    (state.sprint ? utils.startOfDay(utils.parseDate(state.sprint.startDate)) : null) ||
                    utils.startOfDay(utils.parseDate(f.created));
                var workAuthors = [];
                var pastAssignees = [];
                var wlByDay = {};
                var wlByAuthor = {};
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
                        var dk = utils.getDayKey(wd);
                        if (!wlByDay[dk]) wlByDay[dk] = { sec: 0, comments: [], entries: [] };
                        var spent = wl.timeSpentSeconds || 0;
                        wlByDay[dk].sec += spent;
                        if (wl.comment) wlByDay[dk].comments.push(String(wl.comment));
                        wlByDay[dk].entries.push({ sec: spent, comment: wl.comment ? String(wl.comment) : "" });

                        if (!wlByAuthor[aid]) wlByAuthor[aid] = {};
                        if (!wlByAuthor[aid][dk]) wlByAuthor[aid][dk] = { sec: 0, comments: [], entries: [] };
                        wlByAuthor[aid][dk].sec += spent;
                        if (wl.comment) wlByAuthor[aid][dk].comments.push(String(wl.comment));
                        wlByAuthor[aid][dk].entries.push({ sec: spent, comment: wl.comment ? String(wl.comment) : "" });
                    });
                    workAuthors = Object.values(wlMap).sort(function(a, b) { return b.seconds - a.seconds; });
                }
                // История ассайнов в пределах спринта.
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
                var assigneeId = f.assignee ? (f.assignee.accountId || f.assignee.key) : null;
                var assigneeName = f.assignee ? (f.assignee.displayName || assigneeId) : null;
                var assigneeLogin = f.assignee ? (f.assignee.name || f.assignee.key || f.assignee.accountId) : null;
                var sprintFieldVal = f[CONFIG.sprintField || "customfield_10020"] || [];
                var sprintNames = utils.parseSprintNames(sprintFieldVal);
                // Проверка по ID спринта, не по имени
                var inCurrentSprint = state.sprint ? utils.isIssueInSprintById(iss, state.sprint.id) : false;

                var item = {
                    key: iss.key,
                    summary: f.summary,
                    status: f.status ? f.status.name : "",
                    statusCat: f.status && f.status.statusCategory ? f.status.statusCategory.key : "",
                    est: est, // ограничено ёмкостью спринта
                    estRaw: estRaw,
                    start: start,
                    due: due,
                    created: utils.parseDate(f.created),
                    hasDates: !!f.duedate,
                    isDone: isIssueDone(f.status),
                    workAuthors: workAuthors,
                    pastAssignees: pastAssignees,
                    assignee: assigneeId ? { id: assigneeId, name: assigneeName, login: assigneeLogin } : null,
                    worklogs: wlByDay,
                    worklogsByAuthor: wlByAuthor,
                    sprints: sprintNames,
                    isOutsideSprint: state.sprint ? !inCurrentSprint : false,
                    outsideUser: null
                };
                issueMap[item.key] = item;

                // Агрегаты списаний (всего по графикам)
                var loggedSec = sumWorklogByDaySec(item.worklogs);
                if (item.isOutsideSprint) totalLoggedOutSprintSec += loggedSec;
                else totalLoggedInSprintSec += loggedSec;
                
                var displayUser = null;
                var fallbackUser = assigneeId ? { id: assigneeId, name: assigneeName } : (workAuthors[0] ? { id: workAuthors[0].id, name: workAuthors[0].name } : null);

                // Если это extra-задача, найденная по конкретному автору worklog — используем его как первичный displayUser.
                // Это покрывает кейс: "нет задач в спринте, но есть списания вне спринта".
                if (iss && iss._ujgExtraFor && iss._ujgExtraFor.id && teamMembers.indexOf(iss._ujgExtraFor.id) >= 0) {
                    var exId = iss._ujgExtraFor.id;
                    var exName = iss._ujgExtraFor.name || (state.teamMemberNames && state.teamMemberNames[exId]) || exId;
                    var exLogin = iss._ujgExtraFor.login || exId;
                    displayUser = { id: exId, name: exName, login: exLogin };
                }
                // 1) текущий ассайн в команде
                if (assigneeId && teamMembers.indexOf(assigneeId) >= 0) {
                    displayUser = { id: assigneeId, name: assigneeName, login: assigneeLogin };
                }
                // 2) worklog автор из команды
                if (!displayUser) {
                    var teamAuthor = workAuthors.find(function(w) { return w.id && teamMembers.indexOf(w.id) >= 0; });
                    if (teamAuthor) displayUser = { id: teamAuthor.id, name: teamAuthor.name, login: teamAuthor.id };
                }
                // 3) assignee из истории в команде
                if (!displayUser && historyAssignees.length > 0) {
                    var histMember = historyAssignees.find(function(hid) { return teamMembers.indexOf(hid) >= 0; });
                    if (histMember) displayUser = { id: histMember, name: histMember, login: histMember };
                }
                item.outsideUser = fallbackUser;
                if (displayUser && displayUser.id) {
                    if (!map[displayUser.id]) map[displayUser.id] = { id: displayUser.id, name: displayUser.name || displayUser.id, login: displayUser.login || displayUser.id, issues: [], hours: 0 };
                    map[displayUser.id].issues.push(item);
                    map[displayUser.id].hours += est;
                    ensureGroupStats(map[displayUser.id]);
                    // Планируем только задачи спринта, "вне спринта" считаем как неплан
                    if (!item.isOutsideSprint) {
                        map[displayUser.id].plannedSec += est;
                        map[displayUser.id].tasksInSprint += 1;
                        if (item.isDone) map[displayUser.id].doneInSprint += 1;
                        if (est > 0) map[displayUser.id].estimatedInSprint += 1;
                        // Логическое предупреждение: спринт уже идёт, а задача в работе без оценки
                        var passed = state.metrics && state.metrics.workDaysPassed ? state.metrics.workDaysPassed : 0;
                        if (passed >= 3 && !item.isDone && (item.estRaw || 0) <= 0) {
                            map[displayUser.id].alertNoEstCount += 1;
                            map[displayUser.id].alertNoEstKeys.push(item.key);
                        }
                        // WIP: задачи "в работе" (по названию статуса) — для подсветки (особенно Казарбов)
                        var stn = (item.status || "").toLowerCase();
                        var isWip = (!item.isDone) && (stn.indexOf("в работе") >= 0 || stn.indexOf("in progress") >= 0 || stn.indexOf("разработ") >= 0 || stn.indexOf("doing") >= 0);
                        if (isWip) { map[displayUser.id].wipCount += 1; map[displayUser.id].wipKeys.push(item.key); }
                    }
                    // Списания по пользователю: берём worklog именно этого автора
                    var userSpent = matchAuthorSeconds(workAuthors, displayUser);
                    if (item.isOutsideSprint) map[displayUser.id].spentOutSprintSec += userSpent;
                    else {
                        map[displayUser.id].spentInSprintSec += userSpent;
                        // Последний день списаний в спринте (для "нет списаний 3 дня")
                        var lastD = matchAuthorLastDay(item.worklogsByAuthor, displayUser);
                        if (lastD && (!map[displayUser.id].lastLogDate || lastD > map[displayUser.id].lastLogDate)) {
                            map[displayUser.id].lastLogDate = lastD;
                        }
                    }
                } else {
                    outside.issues.push(item);
                    outside.hours += est;
                    ensureGroupStats(outside);
                    if (!item.isOutsideSprint) {
                        outside.plannedSec += est;
                        outside.tasksInSprint += 1;
                        if (item.isDone) outside.doneInSprint += 1;
                        if (est > 0) outside.estimatedInSprint += 1;
                        var passed2 = state.metrics && state.metrics.workDaysPassed ? state.metrics.workDaysPassed : 0;
                        if (passed2 >= 3 && !item.isDone && (item.estRaw || 0) <= 0) {
                            outside.alertNoEstCount += 1;
                            outside.alertNoEstKeys.push(item.key);
                        }
                        var stn2 = (item.status || "").toLowerCase();
                        var isWip2 = (!item.isDone) && (stn2.indexOf("в работе") >= 0 || stn2.indexOf("in progress") >= 0 || stn2.indexOf("разработ") >= 0 || stn2.indexOf("doing") >= 0);
                        if (isWip2) { outside.wipCount += 1; outside.wipKeys.push(item.key); }
                    }
                    // Для "Вне команды" показываем списания как сумму по всем авторам (по сути уже total по задаче)
                    if (item.isOutsideSprint) outside.spentOutSprintSec += loggedSec;
                    else outside.spentInSprintSec += loggedSec;
                }
            });
            var arr = Object.values(map).sort(function(a, b) { return a.name.localeCompare(b.name); });
            if (outside.issues.length > 0) arr.push(outside);
            state.byAssignee = arr;
            state.issueMap = issueMap;

            // Логические флаги уведомлений по каждому участнику
            var m = state.metrics || {};
            var wdPassed = m.workDaysPassed || 0;
            var wdTotal = m.workDays || 0;
            var today2 = utils.startOfDay(new Date());
            var spS2 = state.sprint && state.sprint.startDate ? utils.startOfDay(utils.parseDate(state.sprint.startDate)) : null;
            var spE2 = state.sprint && state.sprint.endDate ? utils.startOfDay(utils.parseDate(state.sprint.endDate)) : null;
            var isCurrentSprint = !!(spS2 && spE2 && today2 && today2 >= spS2 && today2 <= spE2);
            var isClosed = (state.sprint && state.sprint.state && String(state.sprint.state).toLowerCase() === "closed") || (!!(spE2 && today2 && today2 > spE2));
            arr.forEach(function(g) {
                if (!g || g.id === "__outside__") return;
                ensureGroupStats(g);
                var tIn = g.tasksInSprint || 0;
                var dIn = g.doneInSprint || 0;
                var wip = g.wipCount || 0;
                // "Все выполнены" не показываем для завершённого спринта (не нужен шум в истории)
                g.alertAllDone = (!isClosed && tIn > 0 && dIn === tIn);
                // 1) нет задач в работе (только если есть задачи спринта И не все выполнены)
                g.alertNoWip = (tIn > 0 && !g.alertAllDone && wip === 0);
                // 3) нет трудозатрат/списаний > 3 раб.дн. (только текущий спринт)
                g.alertNoLogs3d = false;
                g.noLogDays = 0;
                if (isCurrentSprint && wdPassed >= 3) {
                    if (!g.lastLogDate || (g.spentInSprintSec || 0) <= 0) {
                        g.noLogDays = wdPassed;
                        g.alertNoLogs3d = (wdPassed >= 3);
                    } else if (today2 && g.lastLogDate) {
                        var nextWork = utils.shiftWorkDays(g.lastLogDate, 1);
                        var days = (nextWork && today2 && today2 >= nextWork) ? utils.daysBetween(nextWork, today2).length : 0;
                        g.noLogDays = days;
                        g.alertNoLogs3d = (days >= 3);
                    }
                }
                // 4) если спринт закончен — списаний меньше чем кол-во раб.дней (условно < 1ч/день)
                g.alertUnderLogFinished = false;
                if (isClosed && wdTotal > 0) {
                    var minSec = wdTotal * 3600;
                    g.alertUnderLogFinished = (g.spentInSprintSec || 0) < minSec;
                }
            });

            // Пишем агрегаты в метрики (важно: groupByAssignee вызывается ещё раз после загрузки extra-issues)
            if (!state.metrics) state.metrics = {};
            state.metrics.loggedInSprintSec = totalLoggedInSprintSec;
            state.metrics.loggedOutSprintSec = totalLoggedOutSprintSec;
        }

        function updateBoardDropdown() {
            var html = '';
            state.filteredBoards.slice(0, 50).forEach(function(b) {
                var cls = state.selectedBoardId == b.id ? "ujg-active" : "";
                var projectInfo = '';
                if (b.location && (b.location.projectKey || b.location.projectName)) {
                    projectInfo = ' [' + utils.escapeHtml(b.location.projectKey || b.location.projectName) + ']';
                }
                var typeInfo = b.type ? ' <span class="ujg-dd-type">' + utils.escapeHtml(b.type) + '</span>' : '';
                html += '<div class="ujg-dd-item ' + cls + '" data-id="' + b.id + '">' + 
                    utils.escapeHtml(b.name) + projectInfo + typeInfo + 
                    ' <span class="ujg-dd-id">#' + b.id + '</span></div>';
            });
            if (state.filteredBoards.length > 50) html += '<div class="ujg-dd-more">...ещё ' + (state.filteredBoards.length - 50) + '</div>';
            $boardDropdown.html(html || '<div class="ujg-dd-empty">Не найдено</div>');
        }

        function filterBoards(q) {
            q = q.toLowerCase();
            state.filteredBoards = state.boards.filter(function(b) {
                // Поиск по названию
                if (b.name && b.name.toLowerCase().indexOf(q) >= 0) return true;
                // Поиск по ID
                if (String(b.id).indexOf(q) >= 0) return true;
                // Поиск по типу (scrum, kanban)
                if (b.type && b.type.toLowerCase().indexOf(q) >= 0) return true;
                // Поиск по проекту (projectName, projectKey)
                if (b.location) {
                    if (b.location.projectName && b.location.projectName.toLowerCase().indexOf(q) >= 0) return true;
                    if (b.location.projectKey && b.location.projectKey.toLowerCase().indexOf(q) >= 0) return true;
                    if (b.location.displayName && b.location.displayName.toLowerCase().indexOf(q) >= 0) return true;
                }
                return false;
            });
            updateBoardDropdown();
        }

        function showBoardDropdown() { $boardDropdown.addClass("ujg-show"); }
        function hideBoardDropdown() { $boardDropdown.removeClass("ujg-show"); }

        function selectBoard(id) {
            var board = state.boards.find(function(b) { return b.id == id; });
            if (!board) return;
            state.selectedBoardId = id;
            $boardInput.val(board.name);
            hideBoardDropdown();
            loadSprints(id);
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
            if (state.viewMode === "compare") {
                $cont.html(renderCompare());
                ensureFullWidth();
                bindCompareEvents();
                API.resize();
                return;
            }
            if (state.issues.length === 0) { $cont.html('<div class="ujg-loading">Нет задач в спринте</div>'); API.resize(); return; }
            
            var html = '';
            html += renderHealth();
            html += renderMetrics();
            // Диаграмма сгорания (переключаемая: Jira-like <-> Burndown Chart)
            html += (state.burnView === "burndown") ? renderBurnup() : renderJiraScopeChangeChart();
            html += renderAssigneeAlerts();
            html += renderProblems();
            html += renderAssignees();
            html += renderTable();
            // тултип для кликов по точкам графика
            html += '<div class="ujg-tooltip" id="ujgChartTooltip"></div>';
            
            $cont.html(html);
            ensureFullWidth();
            bindEvents();
            bindJiraChartPointEvents();
            API.resize();
        }

        function renderHealth() {
            var m = state.metrics, c = utils.getHealthColor(m.health);
            var label = utils.getHealthLabel(m.health);
            var bd = getBurndownNowMetrics();
            var scopeTxt = (bd && bd.scope != null) ? String(bd.scope) : "—";
            var pctTxt = (bd && bd.pct != null) ? String(bd.pct) : String(m.health);
            // мягкий градиент как в примере
            var grad = "linear-gradient(90deg, " + c + ", #ffab00)";
            return '' +
                '<div class="ujg-card ujg-health-card">' +
                    '<div class="ujg-health-strip">' +
                        '<div class="ujg-health-strip-fill" style="width:' + pctTxt + '%;background:' + grad + '"></div>' +
                        (bd && bd.guidePct != null && bd.isActive && !bd.isFinished ? ('<div class="ujg-health-guide" style="left:' + bd.guidePct + '%"></div>') : '') +
                    '</div>' +
                    '<div class="ujg-health-meta">Объём: <b>' + utils.escapeHtml(scopeTxt) + '</b> · Выполнено: <b>' + utils.escapeHtml(pctTxt) + '%</b> <span class="ujg-health-meta2">(' + utils.escapeHtml(label) + ')</span>' +
                        (bd && bd.guidePct != null && bd.isActive && !bd.isFinished ? (' <span class="ujg-health-meta2">· Руководство: ' + bd.guidePct + '%</span>') : '') +
                    '</div>' +
                '</div>';
        }

        function renderMetrics() {
            var m = state.metrics;
            var loggedIn = m.loggedInSprintSec || 0;
            var loggedOut = m.loggedOutSprintSec || 0;
            var capSec = m.capacitySec || 0;
            var teamSize = (state.teamMembers && state.teamMembers.length) ? state.teamMembers.length : 0;
            var teamCapSec = (capSec && teamSize) ? (capSec * teamSize) : 0;
            var passed = m.workDaysPassed || 0;
            var totalWd = m.workDays || 0;
            var timePct = (totalWd > 0) ? Math.round(passed / totalWd * 100) : 0;

            var planSec = m.totalHours || 0; // сумма оценок задач спринта (с капом на задачу)
            var planPct = teamCapSec > 0 ? Math.round(planSec / teamCapSec * 100) : 0;
            var spentTotal = (loggedIn || 0) + (loggedOut || 0);
            var spentPct = teamCapSec > 0 ? Math.round(spentTotal / teamCapSec * 100) : 0;

            // "Должны были" по времени (простая линейная модель): ожидаемая доля выполнения по прошедшим рабочим дням
            var expectedDoneTasks = (m.total > 0 && totalWd > 0) ? Math.round(m.total * passed / totalWd) : 0;
            var deltaTasks = (m.done || 0) - expectedDoneTasks;
            var expectedSpentByNow = teamCapSec > 0 ? Math.round(teamCapSec * timePct / 100) : 0;
            var deltaSpent = spentTotal - expectedSpentByNow;

            // Почему в "сгорании" может быть больше задач:
            // верхний блок = текущие задачи в спринте (agile sprint issues),
            // диаграмма = scope по истории (scopechangeburndownchart), там учитываются добавленные/убранные.
            // Покажем явно "текущее" и "scope сейчас/пик".
            var scopeNow = null, scopePeak = null;
            (function computeScopeInfo() {
                var js = state.jiraScope && state.jiraScope.series ? state.jiraScope.series : null;
                if (js && js.scope && js.scope.length) {
                    var pts = js.scope.slice().sort(function(a, b) { return a.x - b.x; });
                    var startTs = Number(js.startTime) || pts[0].x;
                    var endTs = Number(js.endTime) || pts[pts.length - 1].x;
                    var nowTs = Number(js.now) || Date.now();
                    if (isFinite(startTs) && isFinite(endTs)) {
                        if (nowTs < startTs) nowTs = startTs;
                        if (nowTs > endTs) nowTs = endTs;
                    }
                    var y = pts[0].y;
                    for (var i = 0; i < pts.length; i++) {
                        if (pts[i].x <= nowTs) y = pts[i].y;
                        else break;
                    }
                    scopeNow = y;
                    scopePeak = Math.max.apply(null, pts.map(function(p){ return p.y; }));
                    return;
                }
                // fallback: из локального buildBurndown (scopeTasks)
                var bd = state.burnupData || [];
                if (!bd.length) return;
                var maxS = 0;
                bd.forEach(function(d) { if ((d.scopeTasks || 0) > maxS) maxS = d.scopeTasks || 0; });
                scopePeak = maxS;
                var today = bd.find(function(d){ return d.isToday; });
                scopeNow = today ? today.scopeTasks : bd[bd.length - 1].scopeTasks;
            })();

            function badgeColor(p) {
                if (p >= 120) return "ujg-bad";
                if (p >= 100) return "ujg-warn";
                return "ujg-okc";
            }

            var capLabel = utils.formatHours(teamCapSec || capSec);
            var planColor = badgeColor(planPct);
            var deltaSpentLabel = (deltaSpent >= 0 ? "+" : "-") + utils.formatHours(Math.abs(deltaSpent));
            var deltaTasksLabel = (deltaTasks >= 0 ? "+" : "−") + Math.abs(deltaTasks);

            var html = '<div class="ujg-mgrid">';
            // Ёмкость
            var totalWdDisp = (totalWd != null && totalWd !== 0) ? Math.round(totalWd) : "—";
            html += '' +
                '<div class="ujg-card ujg-kcard ujg-kcard-cap">' +
                    '<div class="ujg-kcard-top">' +
                        '<div class="ujg-ic ujg-ic-blue">📊</div>' +
                        '<div class="ujg-kcard-title">' + utils.escapeHtml(capLabel) + '</div>' +
                    '</div>' +
                    '<div class="ujg-kcard-sub">Ёмкость команды</div>' +
                    '<div class="ujg-kcard-mini">' +
                        '<div><b>' + (teamSize || "—") + '</b> <span>чел.</span></div>' +
                        '<div><b>' + totalWdDisp + '</b> <span>раб.дн.</span></div>' +
                        '<div class="span2"><b>' + passed + '</b> <span>прошло (' + timePct + '%)</span></div>' +
                    '</div>' +
                '</div>';

            // План
            html += '' +
                '<div class="ujg-card ujg-kcard ujg-kcard-plan">' +
                    '<div class="ujg-khead">ПЛАН</div>' +
                    '<div class="ujg-kbig">' + utils.escapeHtml(utils.formatHours(planSec)) + '<span class="ujg-kpct ' + planColor + '">(' + planPct + '%)</span></div>' +
                    '<div class="ujg-kmuted">от ёмкости</div>' +
                    '<div class="ujg-kline">Задач: <b>' + m.total + '</b><span class="ujg-kmuted"> (готово ' + m.done + ')</span>' +
                        (scopeNow != null ? (' <span class="ujg-kmuted">· scope</span> <b>' + scopeNow + '</b>' + (scopePeak != null && scopePeak !== scopeNow ? (' <span class="ujg-kmuted">(пик ' + scopePeak + ')</span>') : '')) : '') +
                    '</div>' +
                '</div>';

            // Факт
            var loggedInPct = teamCapSec > 0 ? Math.round(loggedIn / teamCapSec * 100) : 0;
            var loggedOutPct = teamCapSec > 0 ? Math.round(loggedOut / teamCapSec * 100) : 0;
            html += '' +
                '<div class="ujg-card ujg-kcard ujg-kcard-fact">' +
                    '<div class="ujg-khead">ФАКТ</div>' +
                    '<div class="ujg-kbig">' + utils.escapeHtml(utils.formatHours(spentTotal)) + '<span class="ujg-kpct">(' + spentPct + '%)</span></div>' +
                    '<div class="ujg-kmuted">всего списано</div>' +
                    '<div class="ujg-kline"><span class="ujg-kmuted">В спринте:</span> <b>' + utils.escapeHtml(utils.formatHours(loggedIn)) + '</b> <span class="ujg-kmuted">(' + loggedInPct + '%)</span></div>' +
                    '<div class="ujg-kline"><span class="ujg-kmuted">Вне спринта:</span> <b>' + utils.escapeHtml(utils.formatHours(loggedOut)) + '</b> <span class="ujg-kmuted">(' + loggedOutPct + '%)</span></div>' +
                    '<div class="ujg-kline">Темп: <b>' + utils.escapeHtml(utils.formatHours(expectedSpentByNow)) + '</b> <span class="ujg-kmuted">→</span> <b>' + utils.escapeHtml(utils.formatHours(spentTotal)) + '</b> <span class="ujg-kdelta ' + (deltaSpent >= 0 ? "ok" : "bad") + '">(' + utils.escapeHtml(deltaSpentLabel) + ')</span></div>' +
                '</div>';

            // Объединённый блок: Оценки + Сроки + Исполн. (убрали отдельную карточку "Оценки", чтобы не дублировалось)
            html += '' +
                '<div class="ujg-card ujg-kcard ujg-kcard-meta">' +
                    '<div class="ujg-khead">КОНТРОЛЬ</div>' +
                    '<div class="ujg-meta-line"><span class="ujg-meta-name">Оценки</span><span class="ujg-meta-val"><b>' + m.estPct + '%</b> <span class="ujg-kmuted">' + m.estimated + '/' + m.total + '</span></span></div>' +
                    '<div class="ujg-meta-line"><span class="ujg-meta-name">Сроки</span><span class="ujg-meta-val"><b>' + m.datesPct + '%</b> <span class="ujg-kmuted">' + m.withDates + '/' + m.total + '</span></span></div>' +
                    '<div class="ujg-meta-line"><span class="ujg-meta-name">Исполн.</span><span class="ujg-meta-val"><b>' + m.asgnPct + '%</b> <span class="ujg-kmuted">' + m.assigned + '/' + m.total + '</span></span></div>' +
                '</div>';

            // Статусы (компактно, в том же стиле/отступах что "Контроль")
            var statusArr = Object.keys(m.statusCounts || {}).map(function(k) {
                return { name: k, n: m.statusCounts[k] || 0 };
            }).sort(function(a, b) { return b.n - a.n; });
            html += '' +
                '<div class="ujg-card ujg-kcard ujg-kcard-status">' +
                    '<div class="ujg-khead">СТАТУСЫ</div>' +
                    statusArr.slice(0, 6).map(function(s) {
                        var pp = m.total > 0 ? Math.round(s.n / m.total * 100) : 0;
                        return '<div class="ujg-meta-line ujg-status-line">' +
                            '<span class="ujg-meta-name">' + utils.escapeHtml(s.name) + '</span>' +
                            '<span class="ujg-meta-val"><b>' + s.n + '</b> <span class="ujg-kmuted">(' + pp + '%)</span></span>' +
                        '</div>';
                    }).join('') +
                '</div>';

            html += '</div>';
            return html;
        }

        function renderBurnup() {
            var data = state.burnupData;
            if (!data || data.length === 0) return '';

            var isHours = state.chartMode === "hours";

            function getVal(d, keyHours, keyTasks) {
                return isHours ? (d[keyHours] == null ? null : d[keyHours]) : (d[keyTasks] == null ? null : d[keyTasks]);
            }

            function niceTicks(maxVal, count) {
                if (maxVal <= 0) return [0, 1];
                var rough = maxVal / Math.max(count, 1);
                var pow10 = Math.pow(10, Math.floor(Math.log10(rough)));
                var step = pow10;
                var err = rough / pow10;
                if (err >= 7.5) step = pow10 * 10;
                else if (err >= 3.5) step = pow10 * 5;
                else if (err >= 1.5) step = pow10 * 2;
                var ticks = [];
                for (var v = 0; v <= maxVal + step * 0.4; v += step) ticks.push(v);
                if (ticks[ticks.length - 1] < maxVal) ticks.push(maxVal);
                return ticks;
            }

            var maxScope = Math.max.apply(null, data.map(function(d) { return getVal(d, "scopeHours", "scopeTasks") || 0; }));
            var maxDone = Math.max.apply(null, data.map(function(d) { return getVal(d, "doneHours", "doneTasks") || 0; }));
            var maxIdeal = Math.max.apply(null, data.map(function(d) { return getVal(d, "idealHours", "idealTasks") || 0; }));
            var maxValRaw = Math.max(maxScope, maxDone, maxIdeal, 1);
            var yTicks = niceTicks(maxValRaw, 6);
            var maxVal = yTicks[yTicks.length - 1] || 1;

            var VIEW_W = 120, VIEW_H = 90;
            var pad = { top: 10, right: 6, bottom: 14, left: 12 };
            var plotW = VIEW_W - pad.left - pad.right;
            var plotH = VIEW_H - pad.top - pad.bottom;

            function xPos(idx) {
                var n = Math.max(data.length - 1, 1);
                return pad.left + (plotW * idx / n);
            }
            function yPos(val) {
                return pad.top + plotH - (plotH * (val / maxVal));
            }
            function fmt(val) {
                return isHours ? utils.formatHoursShort((val || 0) * 3600) : val;
            }
            function tip(d) {
                var scope = getVal(d, "scopeHours", "scopeTasks");
                var done = getVal(d, "doneHours", "doneTasks");
                var ideal = getVal(d, "idealHours", "idealTasks");
                var left = (scope != null && done != null) ? Math.max(scope - done, 0) : null;
                var parts = [];
                if (d.label) parts.push(d.label);
                if (scope != null) parts.push("Объём: " + fmt(scope));
                if (done != null) parts.push("Реально: " + fmt(done));
                if (ideal != null) parts.push("Идеал: " + fmt(ideal));
                if (left != null) parts.push("Остаток: " + fmt(left));
                return parts.join("\n");
            }

            var idealPts = [], realPts = [], idealTips = [], realTips = [];
            data.forEach(function(d, idx) {
                var x = xPos(idx);
                var idealVal = getVal(d, "idealHours", "idealTasks");
                var realVal = getVal(d, "doneHours", "doneTasks");
                if (idealVal != null) {
                    idealPts.push(x + "," + yPos(idealVal));
                    idealTips.push({ x: x, y: yPos(idealVal), tip: tip(d) });
                }
                if (realVal != null) {
                    realPts.push(x + "," + yPos(realVal));
                    realTips.push({ x: x, y: yPos(realVal), tip: tip(d) });
                }
            });

            var todayIdx = data.findIndex(function(d) { return d.isToday; });

            var html = '<div class="ujg-chart-wrap">';
            html += '<div class="ujg-chart-hdr">';
            html += '<span class="ujg-chart-title">Burndown Chart</span>';
            html += '<div class="ujg-burn-tabs"><span class="ujg-burn-tab" data-burnview="jira">Jira</span><span class="ujg-burn-tab on" data-burnview="burndown">Burndown</span></div>';
            html += '<div class="ujg-toggle"><span class="ujg-tog ' + (!isHours ? "on" : "") + '" data-mode="tasks">Задачи</span><span class="ujg-tog ' + (isHours ? "on" : "") + '" data-mode="hours">Часы</span></div>';
            html += '<div class="ujg-legend">';
            html += '<span class="ujg-leg"><i style="background:#0d8bff"></i>Идеальная линия</span>';
            html += '<span class="ujg-leg"><i style="background:#d93026"></i>Реальная линия</span>';
            html += '<span class="ujg-leg"><i style="background:#f4b400"></i>Текущий день</span>';
            html += '</div></div>';

            html += '<div class="ujg-chart-body ujg-chart-burn">';
            html += '<svg class="ujg-svg ujg-burn-svg" viewBox="0 0 ' + VIEW_W + ' ' + VIEW_H + '" preserveAspectRatio="xMidYMid meet">';

            // Grid & axes
            yTicks.forEach(function(v) {
                var y = yPos(v);
                html += '<line class="ujg-burn-grid" x1="' + pad.left + '" y1="' + y + '" x2="' + (VIEW_W - pad.right) + '" y2="' + y + '"/>';
                html += '<text class="ujg-burn-label ujg-burn-y" x="' + (pad.left - 1.5) + '" y="' + (y + 1.2) + '">' + fmt(v) + '</text>';
            });
            var xStep = Math.max(1, Math.ceil(data.length / 12));
            data.forEach(function(d, idx) {
                var x = xPos(idx);
                html += '<line class="ujg-burn-grid" x1="' + x + '" y1="' + pad.top + '" x2="' + x + '" y2="' + (VIEW_H - pad.bottom) + '"/>';
                if (idx % xStep === 0 || idx === data.length - 1) {
                    html += '<text class="ujg-burn-label ujg-burn-x" x="' + x + '" y="' + (VIEW_H - pad.bottom + 5) + '">' + utils.escapeHtml(d.label || "") + '</text>';
                }
            });
            html += '<line class="ujg-burn-axis" x1="' + pad.left + '" y1="' + (VIEW_H - pad.bottom) + '" x2="' + (VIEW_W - pad.right) + '" y2="' + (VIEW_H - pad.bottom) + '"/>';
            html += '<line class="ujg-burn-axis" x1="' + pad.left + '" y1="' + pad.top + '" x2="' + pad.left + '" y2="' + (VIEW_H - pad.bottom) + '"/>';

            // Today line
            if (todayIdx >= 0) {
                var todayX = xPos(todayIdx);
                html += '<line class="ujg-burn-today" x1="' + todayX + '" y1="' + pad.top + '" x2="' + todayX + '" y2="' + (VIEW_H - pad.bottom) + '"/>';
                html += '<text class="ujg-burn-label ujg-burn-x" x="' + todayX + '" y="' + (pad.top - 2) + '" fill="#d7a000">Сегодня</text>';
            }

            // Lines
            if (idealPts.length > 0) html += '<polyline class="ujg-burn-ideal" points="' + idealPts.join(" ") + '"/>';
            if (realPts.length > 0) html += '<polyline class="ujg-burn-real" points="' + realPts.join(" ") + '"/>';

            // Dots with native titles
            idealTips.forEach(function(p) {
                html += '<circle class="ujg-burn-dot" cx="' + p.x + '" cy="' + p.y + '" r="1.6" fill="#0d8bff"><title>' + utils.escapeHtml(p.tip) + '</title></circle>';
            });
            realTips.forEach(function(p) {
                html += '<circle class="ujg-burn-dot" cx="' + p.x + '" cy="' + p.y + '" r="1.6" fill="#d93026"><title>' + utils.escapeHtml(p.tip) + '</title></circle>';
            });

            html += '</svg>';
            html += '</div></div>';
            return html;
        }

        function renderProblems() {
            var probs = state.problems;
            if (probs.length === 0) return '<div class="ujg-ok">✅ Проблем не обнаружено</div>';
            
            var html = '<div class="ujg-probs">';
            html += '<div class="ujg-section-title">⚠️ Проблемы (' + probs.length + ')</div>';
            html += '<table class="ujg-prob-tbl"><thead><tr><th>Ключ</th><th>Тема</th><th>Исполнитель</th><th>Статус</th><th>Срок</th><th>В статусе</th><th>Трудозатраты</th><th>Спринты</th><th>Проблема</th></tr></thead><tbody>';
            
            probs.forEach(function(p) {
                var statusCls = "ujg-st-" + p.statusCategory;
                html += '<tr class="ujg-prob-row" data-key="' + p.key + '">';
                html += '<td><a href="' + baseUrl + '/browse/' + p.key + '" target="_blank">' + p.key + '</a></td>';
                html += '<td class="ujg-prob-sum" title="' + utils.escapeHtml(p.summary || "") + '">' + utils.escapeHtml(p.summary || "") + '</td>';
                html += '<td>' + utils.escapeHtml(p.assignee || "—") + '</td>';
                html += '<td><span class="ujg-st ' + statusCls + '">' + utils.escapeHtml(p.status) + '</span></td>';
                html += '<td>' + utils.formatDateShort(p.dueDate) + '</td>';
                html += '<td>' + p.statusTime + ' дн.</td>';
                html += '<td>' + utils.escapeHtml('план ' + utils.formatHours(p.estimate || 0) + ', списано ' + utils.formatHours(p.loggedInSprint || 0)) + '</td>';
                html += '<td>' + (p.sprintCount > 1 ? '<span class="ujg-rollover">' + p.sprintCount + '</span>' : '1') + '</td>';
                html += '<td><span class="ujg-prob-type ujg-prob-' + p.probType + '">' + p.probLabel + '</span></td>';
                html += '</tr>';
            });
            
            html += '</tbody></table>';
            html += '<div class="ujg-tooltip" id="ujgTooltip"></div>';
            html += '</div>';
            return html;
        }

        function renderAssigneeAlerts() {
            var data = state.byAssignee || [];
            var passed = state.metrics && state.metrics.workDaysPassed ? state.metrics.workDaysPassed : 0;
            if (!data.length || passed <= 0) return '';
            var offenders = data.filter(function(a) {
                return a && a.id !== "__outside__" && (
                    (a.alertNoEstCount > 0) ||
                    a.alertNoWip ||
                    a.alertAllDone ||
                    a.alertNoLogs3d ||
                    a.alertUnderLogFinished
                );
            });
            if (!offenders.length) return '';

            var html = '<div class="ujg-probs ujg-alerts">';
            html += '<div class="ujg-section-title">🔔 Уведомления</div>';
            html += '<div class="ujg-alert-note">Авто-проверки по людям: WIP, завершение, списания и оценки. Спринт идёт уже <b>' + passed + '</b> раб. дн.</div>';
            html += '<ul class="ujg-alert-list">';
            offenders.forEach(function(a) {
                var parts = [];
                if (a.alertNoWip) parts.push('<span class="ujg-badge-warn">🟧</span> нет задач <b>в работе</b> (WIP=0)');
                if (a.alertAllDone) parts.push('<span class="ujg-badge-ok">🟩</span> все задачи спринта <b>выполнены</b>');
                if (a.alertNoLogs3d) parts.push('<span class="ujg-badge-warn">⚠</span> нет списаний уже <b>' + (a.noLogDays || 3) + '</b> раб.дн.');
                if (a.alertUnderLogFinished) {
                    var wd = (state.metrics && state.metrics.workDays) ? state.metrics.workDays : 0;
                    parts.push('<span class="ujg-badge-warn">⚠</span> спринт завершён: списано <b>' + utils.escapeHtml(utils.formatHours(a.spentInSprintSec || 0)) + '</b> (меньше чем <b>' + wd + 'ч</b>)');
                }
                if (a.alertNoEstCount > 0) {
                    var keys = (a.alertNoEstKeys || []).slice(0, 6);
                    var more = (a.alertNoEstKeys || []).length - keys.length;
                    parts.push('<span class="ujg-badge-warn">⚠</span> ' + a.alertNoEstCount + ' задач без оценки в спринте: ' +
                        keys.map(function(k) { return '<a href="' + baseUrl + '/browse/' + utils.escapeHtml(k) + '" target="_blank">' + utils.escapeHtml(k) + '</a>'; }).join(', ') +
                        (more > 0 ? (' и ещё ' + more) : ''));
                }
                html += '<li><b>' + utils.escapeHtml(a.name) + '</b>: ' + parts.join(' · ') + '</li>';
            });
            html += '</ul></div>';
            return html;
        }

        function renderAssignees() {
            var data = state.byAssignee;
            if (!data || data.length === 0) return '';
            var maxH = Math.max.apply(null, data.map(function(a) { return a.hours; })) || 1;
            var cap = getSprintCapacity();
            var capSec = cap.capSec || 0;
            
            var html = '<div class="ujg-asgn-wrap"><div class="ujg-section-title">👥 Распределение (' + data.length + ')</div><div class="ujg-asgn-list">';
            data.forEach(function(a) {
                var barPct = Math.round(a.hours / maxH * 100);
                var plan = a.plannedSec || 0;
                var inSp = a.spentInSprintSec || 0;
                var outSp = a.spentOutSprintSec || 0;
                var tIn = a.tasksInSprint || 0;
                var dIn = a.doneInSprint || 0;
                function v(sec) { return '<span class="ujg-stat-val">' + utils.escapeHtml(utils.formatHours(sec || 0)) + '</span>'; }
                function p(sec) { return '<span class="ujg-stat-val">' + pct(sec, capSec) + '%</span>'; }
                var warn = a && a.alertNoEstCount ? (' <span class="ujg-badge-warn" title="Есть задачи в спринте без оценки">⚠ ' + a.alertNoEstCount + '</span>') : '';
                var wip = a && a.wipCount != null ? a.wipCount : 0;
                var isKazarbov = a && a.name && String(a.name).toLowerCase().indexOf("казарбов") >= 0;
                var wipBad = isKazarbov ? (wip === 0 || wip >= 3) : (wip >= 4);
                var wipWarn = isKazarbov ? (wip === 0 || wip >= 2) : (wip >= 3);
                var wipBadge = (wipWarn || wipBad) ? (' <span class="' + (wipBad ? 'ujg-badge-bad' : 'ujg-badge-warn') + '" title="Задачи в работе">' + (wipBad ? '🟥' : '🟧') + ' WIP ' + wip + '</span>') : '';
                html += '<div class="ujg-asgn ' + (wipBad ? 'ujg-asgn-bad' : '') + '"><span class="ujg-asgn-name">' + utils.escapeHtml(a.name) + '</span>' + warn + wipBadge +
                    '<div class="ujg-asgn-bar"><div class="ujg-asgn-fill" style="width:' + barPct + '%"></div></div>' +
                    '<span class="ujg-asgn-val">' +
                        '<span class="ujg-stat-txt">План:</span> ' + v(plan) + ' <span class="ujg-stat-txt">(' + p(plan) + ')</span>' +
                        '<span class="ujg-stat-txt"> | Спринт:</span> ' + v(inSp) + ' <span class="ujg-stat-txt">(' + p(inSp) + ')</span>' +
                        '<span class="ujg-stat-txt"> | Вне:</span> ' + v(outSp) + ' <span class="ujg-stat-txt">(' + p(outSp) + ')</span>' +
                        '<span class="ujg-stat-txt"> | </span><span class="ujg-stat-val">' + tIn + '</span><span class="ujg-stat-txt"> задач (готово </span><span class="ujg-stat-val">' + dIn + '</span><span class="ujg-stat-txt">)</span>' +
                    '</span></div>';
            });
            return html + '</div></div>';
        }

        function renderCompare() {
            var cmp = state.compare || {};
            var teams = cmp.teams || [];
            var rows = cmp.rows || [];
            if (!cmp.displayed || cmp.displayed.length === 0) return '<div class="ujg-loading">Нет спринтов для сравнения</div>';

            var isHours = state.chartMode === "hours";
            var html = '<div class="ujg-compare">';
            html += '<div class="ujg-compare-bar"><span class="ujg-chart-title">Сравнение спринтов</span><div class="ujg-toggle ujg-toggle-compare"><span class="ujg-tog ' + (!isHours ? "on" : "") + '" data-mode="tasks">Задачи</span><span class="ujg-tog ' + (isHours ? "on" : "") + '" data-mode="hours">Часы</span></div></div>';

            html += '<div class="ujg-compare-grid" style="grid-template-columns: 140px repeat(' + teams.length + ', 1fr);">';
            html += '<div class="ujg-compare-head">Период</div>';
            teams.forEach(function(t) { html += '<div class="ujg-compare-head">' + utils.escapeHtml(t) + '</div>'; });

            rows.forEach(function(row) {
                html += '<div class="ujg-compare-period">' + utils.escapeHtml(row.label) + '</div>';
                teams.forEach(function(team) {
                    var sp = row.byTeam[team];
                    if (!sp) {
                        html += '<div class="ujg-compare-cell ujg-empty">—</div>';
                        return;
                    }
                    var cache = cmp.burnCache[sp.id];
                    var cellBody = '';
                    if (cache && cache.jiraSeries && (cache.jiraSeries.scope || cache.jiraSeries.completed || cache.jiraSeries.guideline)) {
                        cellBody = renderMiniJiraStepChart(cache.jiraSeries);
                    } else if (cache && cache.data && cache.data.length) {
                        cellBody = renderMiniBurn(cache.data, state.chartMode);
                    } else if (cache && cache.loading) {
                        cellBody = '<div class="ujg-compare-loading">⏳ Загрузка...</div>';
                    } else if (cache && cache.error) {
                        cellBody = '<div class="ujg-compare-loading">Ошибка загрузки</div>';
                    } else {
                        cellBody = '<div class="ujg-compare-loading">Загрузка...</div>';
                        ensureCompareBurndown(sp);
                    }
                    html += '<div class="ujg-compare-cell" data-sid="' + sp.id + '" title="' + utils.escapeHtml(sp.name || "") + '">';
                    html += '<div class="ujg-compare-sname">' + utils.escapeHtml(sp.name || "") + '</div>';
                    html += cellBody;
                    html += '</div>';
                });
            });
            html += '</div>';

            if (cmp.limit < (cmp.allSprints ? cmp.allSprints.length : 0)) {
                html += '<div class="ujg-compare-actions"><button class="ujg-btn ujg-btn-more" data-more="5">Добавить спринт</button></div>';
            }

            html += '</div>';
            return html;
        }

        function renderTable() {
            var data = state.byAssignee;
            if (!data || data.length === 0) return '';
            var sprintStart = state.sprint ? utils.parseDate(state.sprint.startDate) : null;
            var sprintEnd = state.sprint ? utils.parseDate(state.sprint.endDate) : null;
            var days = sprintStart && sprintEnd ? utils.daysBetween(sprintStart, sprintEnd) : [];
            var gHead = renderGanttHeader(days);
            var cap = getSprintCapacity();
            var capSec = cap.capSec || 0;
            
            var html = '<div class="ujg-tbl-wrap"><table class="ujg-tbl"><thead><tr><th>Ключ</th><th>Задача</th><th>Ч</th><th>Start</th><th>End</th><th>Статус</th><th class="ujg-th-gantt">Gantt ' + gHead + '</th></tr></thead><tbody>';
            
            data.forEach(function(a) {
                var isOutside = a.id === "__outside__";
                var inTeam = !isOutside && state.teamMembers && state.teamMembers.indexOf(a.id) >= 0;
                var tog = isOutside ? '' : '<span class="ujg-tm-toggle ' + (inTeam ? 'on' : '') + '" data-uid="' + utils.escapeHtml(a.id) + '" data-uname="' + utils.escapeHtml(a.name) + '" title="' + (inTeam ? 'В команде' : 'Добавить в команду') + '">◎</span>';
                var title = isOutside ? 'Вне команды' : utils.escapeHtml(a.name);
                var tasksIn = a.tasksInSprint || 0;
                var doneIn = a.doneInSprint || 0;
                var plannedSec = a.plannedSec || 0;
                var spentIn = a.spentInSprintSec || 0;
                var spentOut = a.spentOutSprintSec || 0;
                var stat = 'план ' + utils.formatHours(plannedSec) + ' (' + pct(plannedSec, capSec) + '%)' +
                    ', ' + tasksIn + ' задач (готово ' + doneIn + ')' +
                    ', списано ' + utils.formatHours(spentIn) + ' (' + pct(spentIn, capSec) + '%)' +
                    ' и ' + utils.formatHours(spentOut) + ' вне (' + pct(spentOut, capSec) + '%)';
                html += '<tr class="ujg-grp" data-aid="' + a.id + '"><td colspan="7"><b>' + title + '</b> ' + tog + ' <span>(' + utils.escapeHtml(stat) + ')</span></td></tr>';
                var dbgSec = 0;
                var dbgTasks = {};
                var apiDbgSec = 0;
                var apiDbgKeys = [];
                var dbgIdMap = state.worklogDebugPerAuthor && (state.worklogDebugPerAuthor[a.id] || state.worklogDebugPerAuthor[a.name]);
                function collectApiDbg(authorId, authorName) {
                    if (!dbgIdMap) return;
                    if (dbgIdMap.byAuthorId && authorId && dbgIdMap.byAuthorId[authorId]) {
                        apiDbgSec += dbgIdMap.byAuthorId[authorId].sec || 0;
                        apiDbgKeys = apiDbgKeys.concat(Object.keys(dbgIdMap.byAuthorId[authorId].keys || {}));
                    }
                    var lname = (authorName || "").toLowerCase();
                    if (dbgIdMap.byAuthorName && lname && dbgIdMap.byAuthorName[lname]) {
                        apiDbgSec += dbgIdMap.byAuthorName[lname].sec || 0;
                        apiDbgKeys = apiDbgKeys.concat(Object.keys(dbgIdMap.byAuthorName[lname].keys || {}));
                    }
                }
                function samePerson(wa) {
                    var waId = wa.id || "";
                    var waName = (wa.name || "").toLowerCase();
                    if (a.id && waId && a.id === waId) return true;
                    if (a.name && waName && a.name.toLowerCase() === waName) return true;
                    return false;
                }
                a.issues.forEach(function(iss) {
                    var meta = buildIssueMeta(iss, days, a);
                    html += '<tr class="ujg-row" data-aid="' + a.id + '">';
                    html += '<td><a href="' + baseUrl + '/browse/' + iss.key + '" target="_blank" class="' + (iss.isDone ? "ujg-done" : "") + '">' + iss.key + '</a></td>';
                    var assigneeNote = meta.assigneeNote ? '<span class="ujg-asgn-note">' + utils.escapeHtml(meta.assigneeNote) + '</span>' : '';
                    var outside = iss.isOutsideSprint ? '<span class="ujg-outside-pill">вне спринта</span>' : '';
                    html += '<td title="' + utils.escapeHtml(meta.title) + '">' + utils.escapeHtml(iss.summary || "") + assigneeNote + outside + '</td>';
                    html += '<td class="ujg-est" data-key="' + iss.key + '" data-est="' + (iss.est || 0) + '">' + (iss.est > 0 ? utils.formatHoursShort(iss.est) : "—") + '</td>';
                    html += '<td>' + utils.formatDateShort(iss.start) + '</td>';
                    html += '<td>' + utils.formatDateShort(iss.due) + '</td>';
                    html += '<td><span class="ujg-st ujg-st-' + iss.statusCat + '">' + utils.escapeHtml((iss.status || "").substring(0, 8)) + '</span></td>';
                    html += '<td>' + renderGantt(iss, days, sprintStart, sprintEnd) + '</td></tr>';
                    if (iss.workAuthors && Array.isArray(iss.workAuthors)) {
                        iss.workAuthors.forEach(function(wa) {
                            if (samePerson(wa)) {
                                dbgSec += wa.seconds || 0;
                                dbgTasks[iss.key] = true;
                            }
                        });
                    }
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
                        html += '<td></td><td></td><td></td>';
                        html += '<td>' + renderWorklogCellsForAuthor(iss, days, wa.id) + '</td></tr>';
                    });
                    // Прошлые ассайны без worklog
                    iss.pastAssignees.filter(function(n) { return !usedNames[n]; }).forEach(function(n) {
                        html += '<tr class="ujg-row ujg-sub ujg-sub-old" data-aid="' + a.id + '">';
                        html += '<td></td>';
                        html += '<td class="ujg-sub-name ujg-sub-strike" title="Прошлый ассайн в спринте">' + utils.escapeHtml(n) + '</td>';
                        html += '<td>—</td><td></td><td></td><td></td><td></td></tr>';
                    });
                });
                collectApiDbg(a.id, a.name);

            });
            return html + '</tbody></table></div>';
        }

        function buildWlTitle(wl) {
            if (!wl || !wl.sec) return "";
            var parts = [];
            var entries = wl.entries || [];
            if (entries.length) {
                parts.push("Логи: " + utils.formatHours(wl.sec) + " (" + entries.length + " зап.)");
                entries.forEach(function(e, idx) {
                    var line = (idx + 1) + ") " + utils.formatHoursShort(e.sec);
                    if (e.comment) line += " — " + e.comment;
                    parts.push(line);
                });
            } else {
                parts.push("Логи: " + utils.formatHours(wl.sec));
                if (wl.comments && wl.comments.length) parts = parts.concat(wl.comments);
            }
            return parts.join("\\n");
        }

        function renderGantt(iss, days, sprintStart, sprintEnd) {
            if (!days.length) return '';
            var start = iss.start || sprintStart || (iss.created || days[0]);
            var end = iss.due || sprintEnd || days[days.length - 1];
            var todayKey = utils.getDayKey(utils.startOfDay(new Date()));
            var wlMap = iss.worklogs || {};
            var html = '<div class="ujg-gantt" title="Start: ' + utils.formatDateFull(start) + ' | End: ' + utils.formatDateFull(end) + '">';
            days.forEach(function(d) {
                var cls = "ujg-gc";
                var dk = utils.getDayKey(d);
                var wl = wlMap[dk] || null;
                var loggedSec = wl && wl.sec ? wl.sec : 0;
                var comments = wl && wl.comments ? wl.comments : [];
                var inRange = d >= start && d <= end;
                var showTextInsteadOfOverlay = loggedSec > 0 && inRange;
                if (inRange) {
                    if (!iss.due && !iss.start) cls += " ujg-gx"; // пунктир если нет дат
                    cls += iss.isDone ? " ujg-gd" : (iss.statusCat === "indeterminate" ? " ujg-gp" : " ujg-gt");
                }
                if (loggedSec > 0 && !inRange) {
                    // есть worklog вне диапазона оценки — подсветим темнее, как базовый гант
                    cls += " ujg-gt";
                }
                if (utils.getDayKey(d) === todayKey) cls += " ujg-gc-today";
                
                if (loggedSec > 0 && !showTextInsteadOfOverlay) cls += " ujg-gc-log";
                var title = buildWlTitle(wl);
                var txt = loggedSec > 0 ? utils.formatHoursShort(loggedSec) : '';
                html += '<div class="' + cls + '" data-day="' + dk + '" data-key="' + iss.key + '" title="' + utils.escapeHtml(title) + '">' + txt + '</div>';
            });
            return html + '</div>';
        }

        function loadExtraWorklogIssues() {
            var d = $.Deferred();
            var sp = state.sprint;
            if (!sp || !sp.startDate || !sp.endDate || !state.byAssignee || state.byAssignee.length === 0) { d.resolve([]); return d.promise(); }
            var start = utils.getDayKey(utils.parseDate(sp.startDate));
            var end = utils.getDayKey(utils.parseDate(sp.endDate));
            if (!start || !end) { d.resolve([]); return d.promise(); }

            var groups = state.byAssignee.slice(); // уже построены
            var extraAll = [];
            var extraByKey = {};
            state.worklogDebugPerAuthor = {};

            function authorCandidates(g) {
                var set = {};
                function add(val) {
                    if (!val) return;
                    set[val] = true;
                }
                add(g.login);
                add(g.name);
                add(g.id);
                // g.id часто accountId вида JIRAUSER..., игнорируем
                return Object.keys(set).filter(Boolean);
            }

            function fetchForGroup(idx) {
                if (idx >= groups.length) {
                    // после всех запросов — обогащаем extra
                    if (extraAll.length === 0) { d.resolve([]); return; }
                    enrichIssues(extraAll).always(function() {
                        state.extraIssues = extraAll;
                        state.viewIssues = (state.issues || []).concat(extraAll);
                        d.resolve(extraAll);
                    });
                    return;
                }
                var grp = groups[idx];
                if (grp.id === "__outside__") { fetchForGroup(idx + 1); return; }
                var authors = authorCandidates(grp);
                if (authors.length === 0) {
                    // fallback: используем имя группы без фильтра, если всё вырезали
                    if (grp.name) authors = [grp.name];
                    else { fetchForGroup(idx + 1); return; }
                }
                var authorJql = authors.map(function(id) { return '"' + id + '"'; }).join(",");
                // Исключаем подзадачи на уровне JQL запроса (стандартное название в Jira - "Sub-task")
                // Дополнительная фильтрация будет после загрузки для надежности
                var jql = 'worklogAuthor in (' + authorJql + ') AND worklogDate >= "' + start + '" AND worklogDate <= "' + end + '" AND issuetype != Sub-task';

                $.ajax({
                    url: baseUrl + "/rest/api/2/search",
                    type: "POST",
                    contentType: "application/json",
                    data: JSON.stringify({
                        jql: jql,
                        fields: ["summary","status","assignee","priority","issuetype","timeoriginalestimate","timetracking","duedate","created","updated","description","resolutiondate","customfield_10020"],
                    // sprint field тоже нужно, если оно не customfield_10020 — но остальные 3rd-party кейсы пока не покрываем в extra
                        expand: ["changelog","worklog"],
                        maxResults: 500
                    })
                }).then(function(res) {
                    var allIssues = (res && res.issues) ? res.issues : [];
                    // Дополнительная фильтрация подзадач (на случай если JQL фильтр не сработал)
                    var issues = allIssues.filter(function(iss) {
                        return !utils.isSubtask(iss);
                    });
                    var dbg = { jql: jql, keys: issues.map(function(i){return i.key;}), byAuthorId: {}, byAuthorName: {} };
                    issues.forEach(function(iss) {
                        var wl = iss.fields && iss.fields.worklog && iss.fields.worklog.worklogs ? iss.fields.worklog.worklogs : [];
                        wl.forEach(function(w) {
                            var aid = (w.author && (w.author.accountId || w.author.key || w.author.name)) || "";
                            var aname = (w.author && w.author.displayName || "").toLowerCase();
                            var sec = w.timeSpentSeconds || 0;
                            if (aid) {
                                if (!dbg.byAuthorId[aid]) dbg.byAuthorId[aid] = { sec: 0, keys: {} };
                                dbg.byAuthorId[aid].sec += sec;
                                dbg.byAuthorId[aid].keys[iss.key] = true;
                            }
                            if (aname) {
                                if (!dbg.byAuthorName[aname]) dbg.byAuthorName[aname] = { sec: 0, keys: {} };
                                dbg.byAuthorName[aname].sec += sec;
                                dbg.byAuthorName[aname].keys[iss.key] = true;
                            }
                        });
                    });
                    state.worklogDebugPerAuthor[grp.id || grp.name || ("grp_" + idx)] = dbg;

                    var existingKeys = {};
                    (state.issues || []).forEach(function(i) { existingKeys[i.key] = true; });
                    issues.forEach(function(i) {
                        if (!existingKeys[i.key]) {
                            i.isOutsideSprint = true;
                            // помечаем, для кого нашли эту задачу (чтобы гарантированно отрендерить пользователя даже без задач в спринте)
                            i._ujgExtraFor = { id: grp.id, name: grp.name, login: grp.login };
                            if (extraByKey[i.key]) {
                                // уже добавляли — просто дополним метку (оставим первую как основную)
                            } else {
                                extraByKey[i.key] = i;
                            }
                            extraAll.push(i);
                            existingKeys[i.key] = true;
                        }
                    });
                    fetchForGroup(idx + 1);
                }, function() { fetchForGroup(idx + 1); });
            }

            fetchForGroup(0);
            return d.promise();
        }

        function buildIssueMeta(iss, days, group) {
            var today = utils.startOfDay(new Date());
            var titleParts = [iss.summary || ""];

            // Нагрузка: сколько дней прошло от старта спринта
            var loadPct = null;
            if (state.sprint && state.sprint.startDate && state.sprint.endDate && days.length > 0) {
                var start = utils.startOfDay(utils.parseDate(state.sprint.startDate));
                var end = utils.startOfDay(utils.parseDate(state.sprint.endDate));
                if (start && end) {
                    var total = days.length;
                    var passed = 0;
                    days.forEach(function(d) { if (d <= today) passed++; });
                    passed = utils.clamp(passed, 0, total);
                    loadPct = total > 0 ? Math.round(passed / total * 100) : null;
                }
            }
            if (loadPct !== null) titleParts.push("Нагрузка спринта: " + loadPct + "%");

            // Проблемы
            var problems = [];
            if (iss.due && today > iss.due && !iss.isDone) problems.push("Просрочена");

            // Переработка по worklog команды
            var teamWlSec = 0;
            if (iss.workAuthors && Array.isArray(iss.workAuthors) && state.teamMembers) {
                iss.workAuthors.forEach(function(wa) {
                    if (wa.id && state.teamMembers.indexOf(wa.id) >= 0) teamWlSec += wa.seconds || 0;
                });
            }
            if (iss.est > 0 && teamWlSec > iss.est) {
                var delta = teamWlSec - iss.est;
                problems.push("Перерасход " + utils.formatHours(delta));
            }
            if (problems.length === 0) problems.push("Проблем нет");
            titleParts.push("Проблемы: " + problems.join("; "));

            var sprintInfo = (iss.sprints && iss.sprints.length) ? iss.sprints.join(", ") : "—";
            titleParts.push("Спринты: " + sprintInfo);
            if (iss.isOutsideSprint) titleParts.push("OutsideSprint: true");

            function sameAssignee(a, g) {
                if (!a || !g) return false;
                var aId = (a.id || "").toLowerCase();
                var aLogin = (a.login || "").toLowerCase();
                var aName = (a.name || "").toLowerCase();
                var gId = (g.id || "").toLowerCase();
                var gLogin = (g.login || "").toLowerCase();
                var gName = (g.name || "").toLowerCase();
                return (aId && gId && aId === gId) ||
                       (aLogin && gLogin && aLogin === gLogin) ||
                       (aName && gName && aName === gName);
            }

            var assigneeNote = "";
            if (iss.assignee && iss.assignee.id) {
                if (!sameAssignee(iss.assignee, group)) {
                    assigneeNote = "(назначено: " + (iss.assignee.name || iss.assignee.id) + ")";
                    problems.push("Назначено на " + (iss.assignee.name || iss.assignee.id));
                }
            }

            return {
                assigneeNote: assigneeNote,
                title: titleParts.join(" | ")
            };
        }

        function renderWorklogCellsForAuthor(iss, days, authorId) {
            if (!days.length) return '';
            var map = (iss.worklogsByAuthor && iss.worklogsByAuthor[authorId]) || {};
            var html = '<div class="ujg-gantt ujg-gantt-wl">';
            days.forEach(function(d) {
                var dk = utils.getDayKey(d);
                var cell = map[dk] || null;
                var loggedSec = cell && cell.sec ? cell.sec : 0;
                var comments = cell && cell.comments ? cell.comments : [];
                var cls = "ujg-gc";
                if (loggedSec > 0) { cls += " ujg-gc-log ujg-wl"; }
                var title = buildWlTitle(cell);
                var txt = loggedSec > 0 ? utils.formatHoursShort(loggedSec) : '';
                html += '<div class="' + cls + '" data-day="' + dk + '" data-key="' + iss.key + '" title="' + utils.escapeHtml(title) + '">' + txt + '</div>';
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

        function ensureTeamMemberNames() {
            var ids = state.teamMembers || [];
            if (!ids.length) return $.Deferred().resolve().promise();
            if (!state.teamMemberNames) state.teamMemberNames = {};
            var tasks = [];
            ids.forEach(function(uid) {
                if (!uid) return;
                if (state.teamMemberNames[uid]) return;
                var p = api.getUser(uid).then(function(u) {
                    var dn = u && (u.displayName || u.name || u.key || u.accountId) ? (u.displayName || u.name || u.key || u.accountId) : uid;
                    state.teamMemberNames[uid] = dn;
                    return dn;
                }, function() {
                    state.teamMemberNames[uid] = uid;
                    return uid;
                });
                tasks.push(p);
            });
            if (!tasks.length) return $.Deferred().resolve().promise();
            return $.when.apply($, tasks).always(function() {
                // перерисуем, чтобы заголовки групп и "пустые" участники получили ФИО
                groupByAssignee();
                render();
            });
        }

        function updateTeamKey() {
            if (!state.sprint) return;
            state.teamKey = getTeamKeyBySprintName(state.sprint.name);
            var savedTeam = (state.teams && state.teamKey && state.teams[state.teamKey]) ? state.teams[state.teamKey] : [];
            
            // Если команда не настроена — считаем всех assignee из задач членами команды
            if (savedTeam.length === 0 && state.issues && state.issues.length > 0) {
                var allAssignees = {};
                state.issues.forEach(function(iss) {
                    var f = iss.fields || {};
                    if (f.assignee) {
                        var aid = f.assignee.accountId || f.assignee.key || f.assignee.name;
                        if (aid) {
                            allAssignees[aid] = f.assignee.displayName || aid;
                        }
                    }
                });
                state.teamMembers = Object.keys(allAssignees);
                // Сохраняем имена для отображения
                if (!state.teamMemberNames) state.teamMemberNames = {};
                Object.keys(allAssignees).forEach(function(uid) {
                    state.teamMemberNames[uid] = allAssignees[uid];
                });
            } else {
                state.teamMembers = savedTeam;
            }
            ensureTeamMemberNames();
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
            if (uid && uname) {
                if (!state.teamMemberNames) state.teamMemberNames = {};
                state.teamMemberNames[uid] = uname;
            }
            ensureTeamMemberNames();
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

        function ensureChartTooltipEl() {
            var $tip = $("#ujgChartTooltip");
            if ($tip.length) return $tip;
            $tip = $('<div class="ujg-tooltip" id="ujgChartTooltip"></div>');
            $("body").append($tip);
            return $tip;
        }

        function hideChartTooltip() { $("#ujgChartTooltip").removeClass("ujg-show"); }

        function showChartTooltipAt(x, y, html) {
            var $tip = ensureChartTooltipEl();
            $tip.html(html).addClass("ujg-show");
            $tip.css({ top: y + 10, left: x + 10 });
        }

        function buildIssueTooltipHtml(issue, worklog, marker) {
            var f = issue && issue.fields ? issue.fields : {};
            var key = issue ? issue.key : (marker && marker.key) || "";
            var summary = f.summary || (marker && marker.summary) || "";
            var status = f.status ? f.status.name : "";
            var assignee = f.assignee ? f.assignee.displayName : "—";
            var reporter = f.reporter ? f.reporter.displayName : (f.creator ? f.creator.displayName : "—");
            var prio = f.priority ? f.priority.name : "—";
            var type = f.issuetype ? f.issuetype.name : "—";
            var orig = (f.timetracking && f.timetracking.originalEstimateSeconds) || f.timeoriginalestimate || 0;
            var spent = f.timespent || 0;
            var rem = (f.timetracking && f.timetracking.remainingEstimateSeconds) || 0;

            var link = key ? ('<a href="' + baseUrl + '/browse/' + utils.escapeHtml(key) + '" target="_blank">' + utils.escapeHtml(key) + '</a>') : utils.escapeHtml(key);
            var html = '<div class="ujg-tip-hdr"><b>' + link + '</b>: ' + utils.escapeHtml(summary) + '</div>';
            html += '<div class="ujg-tip-row"><b>Статус:</b> ' + utils.escapeHtml(status || "—") + '</div>';
            html += '<div class="ujg-tip-row"><b>Тип:</b> ' + utils.escapeHtml(type) + ' | <b>Приоритет:</b> ' + utils.escapeHtml(prio) + '</div>';
            html += '<div class="ujg-tip-row"><b>Исполнитель:</b> ' + utils.escapeHtml(assignee) + '</div>';
            html += '<div class="ujg-tip-row"><b>Автор:</b> ' + utils.escapeHtml(reporter) + '</div>';
            html += '<div class="ujg-tip-row"><b>Оценка:</b> ' + utils.formatHours(orig) + ' | <b>Затрачено:</b> ' + utils.formatHours(spent) + (rem ? (' | <b>Осталось:</b> ' + utils.formatHours(rem)) : '') + '</div>';

            if (marker) {
                var dt = marker.ts ? (new Date(Number(marker.ts))).toLocaleString("ru-RU") : "";
                html += '<div class="ujg-tip-row"><b>Событие:</b> ' + utils.escapeHtml(marker.kind || "") + ' ' + utils.escapeHtml(marker.from + " → " + marker.to) + (dt ? (' | ' + utils.escapeHtml(dt)) : '') + '</div>';
            }

            // Worklog summary
            if (worklog && worklog.worklogs && Array.isArray(worklog.worklogs)) {
                var by = {};
                worklog.worklogs.forEach(function(w) {
                    var name = (w.author && w.author.displayName) ? w.author.displayName : "—";
                    by[name] = (by[name] || 0) + (w.timeSpentSeconds || 0);
                });
                var top = Object.keys(by).map(function(n){ return { n: n, s: by[n] }; }).sort(function(a,b){ return b.s-a.s; }).slice(0, 5);
                if (top.length) {
                    html += '<div class="ujg-tip-desc"><b>Трудозатраты по авторам:</b><br>' +
                        top.map(function(t){ return utils.escapeHtml(t.n) + ': ' + utils.formatHours(t.s); }).join('<br>') +
                        '</div>';
                }

                // Последние worklog записи В ПЕРИОД СПРИНТА
                var spStart = state && state.sprint ? utils.startOfDay(utils.parseDate(state.sprint.startDate)) : null;
                var spEnd = state && state.sprint ? utils.startOfDay(utils.parseDate(state.sprint.endDate)) : null;
                var entries = worklog.worklogs.slice();
                if (spStart && spEnd) {
                    entries = entries.filter(function(w) {
                        var d = utils.startOfDay(utils.parseDate(w.started));
                        return d && d >= spStart && d <= spEnd;
                    });
                }
                entries.sort(function(a, b) {
                    var ad = utils.parseDate(a.started), bd = utils.parseDate(b.started);
                    var av = ad ? ad.getTime() : 0;
                    var bv = bd ? bd.getTime() : 0;
                    return bv - av;
                });
                entries = entries.slice(0, 8);
                if (entries.length) {
                    html += '<div class="ujg-tip-desc"><b>Последние worklog в спринте:</b><br>' +
                        entries.map(function(w) {
                            var name = (w.author && w.author.displayName) ? w.author.displayName : "—";
                            var d = utils.parseDate(w.started);
                            var when = d ? d.toLocaleString("ru-RU") : "";
                            var line = utils.escapeHtml(when) + ' — ' + utils.escapeHtml(name) + ': ' + utils.formatHours(w.timeSpentSeconds || 0);
                            var c = (w.comment || "").trim();
                            if (c) line += ' — ' + utils.escapeHtml(c);
                            return line;
                        }).join('<br>') +
                        '</div>';
                }
            }

            return html;
        }

        function truncateText(txt, maxLen) {
            if (!txt) return "";
            var s = String(txt);
            if (!maxLen || s.length <= maxLen) return s;
            return s.substring(0, Math.max(0, maxLen - 3)) + "...";
        }

        function getMarkerOpLabel(op) {
            if (!op) return "";
            var map = { added: "Добавлено", removed: "Убрано", deleted: "Удалено", done: "Завершено", undone: "Возврат" };
            return map[op] || op;
        }

        function buildMarkerLabelData(marker) {
            var item = marker && marker.key ? state.issueMap[marker.key] : null;
            var summary = item ? item.summary : (marker ? marker.summary : "");
            var estSec = item ? (item.estRaw || item.est || 0) : 0;
            var delta = (marker && isFinite(marker.from) && isFinite(marker.to)) ? (marker.from + " → " + marker.to) : "";
            var opLabel = getMarkerOpLabel(marker && marker.op);
            return {
                key: marker && marker.key ? String(marker.key) : "",
                summary: truncateText(summary || "", 48),
                kind: marker && marker.kind ? String(marker.kind) : "",
                delta: delta,
                est: estSec > 0 ? utils.formatHoursShort(estSec) : "",
                op: opLabel
            };
        }

/* Canvas Burnup Chart Implementation */

        function drawBurnupCanvas(canvas, series, opts) {
            if (!canvas || !series) return;
            var ctx = canvas.getContext("2d");
            var dpr = window.devicePixelRatio || 1;
            var rect = canvas.getBoundingClientRect();
            
            // Adjust for HighDPI
            canvas.width = rect.width * dpr;
            canvas.height = rect.height * dpr;
            ctx.scale(dpr, dpr);
            
            var width = rect.width;
            var height = rect.height;
            var pad = { top: 40, right: 260, bottom: 60, left: 60 };
            
            // Clear
            ctx.clearRect(0, 0, width, height);
            
            // Data Prep
            var sScope = series.scope || [];
            var sComp = series.completed || [];
            var sGuide = series.guideline || [];
            var sProj = series.projection || [];
            var all = [].concat(sScope, sComp, sGuide, sProj);
            
            if (!all.length) {
                ctx.font = "14px -apple-system, sans-serif";
                ctx.fillStyle = "#6b778c";
                ctx.textAlign = "center";
                ctx.fillText("Нет данных", width / 2, height / 2);
                return;
            }

            var minX = series.startTime != null ? series.startTime : Math.min.apply(null, all.map(function(p) { return p.x; }));
            var maxX = series.endTime != null ? series.endTime : Math.max.apply(null, all.map(function(p) { return p.x; }));
            if (!isFinite(minX) || !isFinite(maxX) || minX === maxX) { minX = 0; maxX = Math.max(all.length - 1, 1); }
            var maxY = Math.max.apply(null, all.map(function(p) { return p.y; })) || 1;
            
            // Ticks
            function niceTicks(maxVal, count) {
                if (maxVal <= 0) return [0, 1];
                var rough = maxVal / Math.max(count, 1);
                var pow10 = Math.pow(10, Math.floor(Math.log10(rough)));
                var step = pow10;
                var err = rough / pow10;
                if (err >= 7.5) step = pow10 * 10;
                else if (err >= 3.5) step = pow10 * 5;
                else if (err >= 1.5) step = pow10 * 2;
                var ticks = [];
                for (var v = 0; v <= maxVal + step * 0.4; v += step) ticks.push(v);
                if (ticks[ticks.length - 1] < maxVal) ticks.push(maxVal);
                return ticks;
            }
            var yTicks = niceTicks(maxY, 8);
            maxY = yTicks[yTicks.length - 1] || 1;
            
            var plotW = width - pad.left - pad.right;
            var plotH = height - pad.top - pad.bottom;
            
            function xPos(x) {
                var t = (x - minX) / Math.max((maxX - minX), 1);
                return pad.left + plotW * t;
            }
            function yPos(y) {
                return pad.top + plotH - (plotH * (y / maxY));
            }
            
            // Draw Non-working days
            if (series.workRateData && series.workRateData.rates && Array.isArray(series.workRateData.rates)) {
                ctx.fillStyle = "rgba(9, 30, 66, 0.04)";
                series.workRateData.rates.forEach(function(r) {
                    var rs = Number(r.start), re = Number(r.end), rate = Number(r.rate);
                    if (!isFinite(rs) || !isFinite(re) || re <= rs) return;
                    if (!isFinite(rate) || rate !== 0) return;
                    var x1 = xPos(rs);
                    var x2 = xPos(re);
                    ctx.fillRect(x1, pad.top, Math.max(0, x2 - x1), plotH);
                });
            }

            // Grid & Axes
            ctx.beginPath();
            ctx.strokeStyle = "#e6eaf0";
            ctx.lineWidth = 1;
            // Y Grid
            ctx.textAlign = "right";
            ctx.textBaseline = "middle";
            ctx.fillStyle = "#5e6c84";
            ctx.font = "11px -apple-system, sans-serif";
            yTicks.forEach(function(v) {
                var y = Math.round(yPos(v)) + 0.5;
                ctx.moveTo(pad.left, y);
                ctx.lineTo(width - pad.right, y);
                ctx.fillText(v, pad.left - 8, y);
            });
            // X Grid
            var dayMs = 24 * 3600 * 1000;
            var startDay = utils.startOfDay(new Date(minX)).getTime();
            var endDay = utils.startOfDay(new Date(maxX)).getTime();
            ctx.textAlign = "center";
            ctx.textBaseline = "top";
            
            var xTickStep = Math.ceil((endDay - startDay) / dayMs / 12) * dayMs; 
            for (var t = startDay; t <= endDay + dayMs; t += xTickStep) {
                if (t > maxX) break;
                var x = Math.round(xPos(t)) + 0.5;
                ctx.moveTo(x, pad.top);
                ctx.lineTo(x, height - pad.bottom);
                try {
                    var d = new Date(t);
                    var txt = d.toLocaleDateString("ru-RU", { month: "short", day: "numeric" }).replace(".", "");
                    ctx.fillText(txt, x, height - pad.bottom + 8);
                } catch(e){}
            }
            ctx.stroke();
            
            // Axes
            ctx.beginPath();
            ctx.strokeStyle = "#d0d4da";
            ctx.lineWidth = 1;
            ctx.moveTo(pad.left, pad.top);
            ctx.lineTo(pad.left, height - pad.bottom);
            ctx.lineTo(width - pad.right, height - pad.bottom);
            ctx.stroke();
            
            // Helper: Clip
            ctx.save();
            ctx.beginPath();
            ctx.rect(pad.left, pad.top, plotW, plotH);
            ctx.clip();
            
            // Helper: Draw Line
            function drawLine(pts, color, width, dash) {
                if (!pts || !pts.length) return;
                ctx.beginPath();
                ctx.strokeStyle = color;
                ctx.lineWidth = width;
                if (dash) ctx.setLineDash(dash);
                else ctx.setLineDash([]);
                
                var sorted = pts.slice().sort(function(a,b){ return a.x - b.x; });
                ctx.moveTo(xPos(sorted[0].x), yPos(sorted[0].y));
                for(var i=1; i<sorted.length; i++) {
                    ctx.lineTo(xPos(sorted[i].x), yPos(sorted[i].y));
                }
                ctx.stroke();
                ctx.setLineDash([]);
            }
            
            // Helper: Draw Step Line
            function drawStepLine(pts, color, width) {
                if (!pts || !pts.length) return;
                ctx.beginPath();
                ctx.strokeStyle = color;
                ctx.lineWidth = width;
                var sorted = pts.slice().sort(function(a,b){ return a.x - b.x; });
                var curX = xPos(sorted[0].x);
                var curY = yPos(sorted[0].y);
                ctx.moveTo(curX, curY);
                
                for(var i=1; i<sorted.length; i++) {
                    var nextX = xPos(sorted[i].x);
                    var nextY = yPos(sorted[i].y);
                    ctx.lineTo(nextX, curY);
                    ctx.lineTo(nextX, nextY);
                    curX = nextX;
                    curY = nextY;
                }
                ctx.stroke();
            }

            // Guideline
            drawLine(sGuide, "#b3bac5", 2);
            
            // Projection
            if (sProj && sProj.length) {
                drawLine(sProj, "#ff8b00", 2, [5, 3]);
                // Proj Dots
                ctx.fillStyle = "#fff";
                ctx.strokeStyle = "#ff8b00";
                ctx.lineWidth = 1.5;
                sProj.forEach(function(p) {
                    ctx.beginPath();
                    ctx.arc(xPos(p.x), yPos(p.y), 3, 0, Math.PI*2);
                    ctx.fill();
                    ctx.stroke();
                });
            }

            // Scope & Done (clipped to now if needed)
            var nowInSprint = series.now && series.now >= minX && series.now <= maxX;
            
            // Draw Scope
            drawStepLine(sScope, "#de350b", 2.5);
            
            // Draw Done
            drawStepLine(sComp, "#36b37e", 2.5);
            
            ctx.restore(); // End clip
            
            // Markers & Labels
            var markers = [];
            function collectMarkers(list, kind, color) {
                if (!list) return;
                list.forEach(function(m) {
                    if (nowInSprint && m.ts > series.now) return; 
                    markers.push({
                        x: xPos(m.ts),
                        y: yPos(m.y),
                        ts: m.ts,
                        val: m.y,
                        key: m.key,
                        summary: m.summary,
                        from: m.from,
                        to: m.to,
                        op: m.op,
                        kind: kind,
                        color: color
                    });
                });
            }
            collectMarkers(series.markers && series.markers.scope, "Объём работ", "#de350b");
            collectMarkers(series.markers && series.markers.done, "Завершенная работа", "#36b37e");
            
            // Draw Marker Dots
            markers.forEach(function(m) {
                ctx.beginPath();
                ctx.fillStyle = "#fff";
                ctx.strokeStyle = m.color;
                ctx.lineWidth = 2;
                ctx.arc(m.x, m.y, 4, 0, Math.PI*2);
                ctx.fill();
                ctx.stroke();
            });
            
            // Smart Labels
            drawSmartLabels(ctx, markers, {
                width: width,
                height: height,
                pad: pad
            });
        }
        
        function drawSmartLabels(ctx, markers, layout) {
            // Sort by Y to process top-down (or by importance)
            markers.sort(function(a,b) { return a.y - b.y; });
            
            var labels = markers.map(function(m) {
                var data = buildMarkerLabelData(m);
                var lines = [
                    data.key, 
                    data.summary, 
                    (data.kind && data.delta) ? (data.kind + ": " + data.delta) : "", 
                    data.est ? ("Оценка: " + data.est) : "", 
                    data.op
                ].filter(Boolean);
                
                return {
                    m: m,
                    lines: lines,
                    h: Math.max(20, lines.length * 14 + 10),
                    w: 160,
                    x: layout.width - layout.pad.right + 20, // Right lane
                    y: m.y // Initial Y
                };
            });
            
            // Collision Avoidance (Simple greedy)
            // Adjust Y positions to avoid overlap
            var gap = 4;
            var minY = layout.pad.top;
            var maxY = layout.height - layout.pad.bottom;
            
            // Multiple passes to relax positions
            for(var iter=0; iter<5; iter++) {
                // Sort by current Y
                labels.sort(function(a,b){ return a.y - b.y; });
                
                for(var i=0; i<labels.length-1; i++) {
                    var curr = labels[i];
                    var next = labels[i+1];
                    var bottom = curr.y + curr.h/2;
                    var top = next.y - next.h/2;
                    
                    if (bottom + gap > top) {
                        var overlap = (bottom + gap) - top;
                        // Move apart
                        curr.y -= overlap / 2;
                        next.y += overlap / 2;
                    }
                }
                
                // Clamp
                labels.forEach(function(l) {
                    var half = l.h/2;
                    if (l.y - half < minY) l.y = minY + half;
                    if (l.y + half > maxY) l.y = maxY - half;
                });
            }
            
            // Draw
            ctx.font = "10px -apple-system, sans-serif";
            ctx.textBaseline = "top";
            
            labels.forEach(function(l) {
                var half = l.h/2;
                var left = l.x;
                var top = l.y - half;
                
                // Connector line
                ctx.beginPath();
                ctx.strokeStyle = "#b3bac5";
                ctx.lineWidth = 1;
                ctx.setLineDash([2, 2]);
                ctx.moveTo(l.m.x + 6, l.m.y); // from dot
                ctx.lineTo(left - 10, l.m.y); // horizontal
                ctx.lineTo(left - 5, l.y);    // to label
                ctx.stroke();
                ctx.setLineDash([]);
                
                // Bubble background
                ctx.fillStyle = "#fff";
                ctx.strokeStyle = "#dfe1e6";
                ctx.lineWidth = 1;
                // Round rect
                var r = 4;
                ctx.beginPath();
                ctx.moveTo(left + r, top);
                ctx.lineTo(left + l.w - r, top);
                ctx.quadraticCurveTo(left + l.w, top, left + l.w, top + r);
                ctx.lineTo(left + l.w, top + l.h - r);
                ctx.quadraticCurveTo(left + l.w, top + l.h, left + l.w - r, top + l.h);
                ctx.lineTo(left + r, top + l.h);
                ctx.quadraticCurveTo(left, top + l.h, left, top + l.h - r);
                ctx.lineTo(left, top + r);
                ctx.quadraticCurveTo(left, top, left + r, top);
                ctx.closePath();
                ctx.fill();
                ctx.stroke();
                
                // Text
                var curY = top + 6;
                var padX = left + 8;
                l.lines.forEach(function(line, idx) {
                    if (idx === 0) { // Key
                        ctx.fillStyle = "#172b4d";
                        ctx.font = "bold 10px -apple-system, sans-serif";
                    } else if (idx === 1) { // Summary
                        ctx.fillStyle = "#5e6c84";
                        ctx.font = "10px -apple-system, sans-serif";
                    } else if (line.indexOf(":") > 0) { // Delta / Est
                         ctx.fillStyle = "#172b4d";
                         ctx.font = "10px -apple-system, sans-serif";
                         // Simple bolding of value part is hard in canvas, just draw normal
                    } else { // Op
                        ctx.fillStyle = "#172b4d";
                        ctx.font = "italic 10px -apple-system, sans-serif";
                    }
                    ctx.fillText(line, padX, curY);
                    curY += 14;
                });
            });
        }

        function closeChartFullscreen() {
            $("#ujgChartFullscreen").remove();
            $(window).off("resize.ujgChartFs");
            $(document).off("keydown.ujgChartFs");
        }

        function openChartFullscreen() {
            if (!state.jiraScope || !state.jiraScope.series) return;
            closeChartFullscreen();
            var $ov = $('<div class="ujg-chart-fullscreen-overlay" id="ujgChartFullscreen"></div>');
            var $bar = $('<div class="ujg-chart-fullscreen-bar"></div>');
            $bar.append('<div class="ujg-chart-fullscreen-title">Диаграма сгорания</div>');
            var $close = $('<button class="ujg-btn ujg-chart-fullscreen-close" title="Закрыть">✕</button>');
            $close.on("click", closeChartFullscreen);
            $bar.append($close);

            var $body = $('<div class="ujg-chart-fullscreen-body"></div>');
            // Using Canvas
            var $canvas = $('<canvas class="ujg-chart-fullscreen-canvas" style="width:100%;height:100%;display:block;"></canvas>');
            var $chart = $('<div class="ujg-chart-fullscreen-chart" style="width:100%;height:100%;overflow:hidden;"></div>');
            $chart.append($canvas);
            $body.append($chart);
            $ov.append($bar).append($body);
            $("body").append($ov);

            // Wait for layout
            setTimeout(function() {
                var cvs = $canvas[0];
                drawBurnupCanvas(cvs, state.jiraScope.series);
            }, 50);

            $(window).on("resize.ujgChartFs", function() {
                drawBurnupCanvas($canvas[0], state.jiraScope.series);
            });
            $(document).on("keydown.ujgChartFs", function(e) {
                if (e.key === "Escape") closeChartFullscreen();
            });
        }

        function bindJiraChartPointEvents() {
            // закрытие по клику вне тултипа
            $(document).off("click.ujgChartTip").on("click.ujgChartTip", function(e) {
                if (!$(e.target).closest("#ujgChartTooltip").length && !$(e.target).closest(".ujg-jira-mk").length) hideChartTooltip();
            });

            $cont.find(".ujg-jira-mk").off("click.ujgChart").on("click.ujgChart", function(ev) {
                ev.preventDefault();
                ev.stopPropagation();
                // Tooltip у нас position:fixed, поэтому координаты берём из clientX/clientY (а не pageX/pageY)
                var cx = (ev.clientX != null ? ev.clientX : ev.pageX) || 0;
                var cy = (ev.clientY != null ? ev.clientY : ev.pageY) || 0;
                var $c = $(this);
                var key = $c.data("key");
                var ts = Number($c.data("ts")) || 0;
                var kind = $c.data("kind") || "";
                var from = Number($c.data("from"));
                var to = Number($c.data("to"));
                var summary = $c.data("summary") || "";
                var marker = { key: key, ts: ts, kind: kind, from: from, to: to, summary: summary };

                showChartTooltipAt(cx, cy, "Загрузка...");
                if (!key) return;

                $.when(api.getIssue(key), api.getIssueWorklog(key)).then(function(issueResp, wlResp) {
                    var issue = issueResp && issueResp[0] ? issueResp[0] : issueResp;
                    var wl = wlResp && wlResp[0] ? wlResp[0] : wlResp;
                    var html = buildIssueTooltipHtml(issue, wl, marker);
                    showChartTooltipAt(cx, cy, html);
                }, function() {
                    showChartTooltipAt(cx, cy, '<div class="ujg-tip-hdr"><b>' + utils.escapeHtml(key) + '</b></div><div class="ujg-tip-row">Не удалось загрузить детали задачи</div>');
                });
            });
        }

        function bindCompareEvents() {
            $cont.find(".ujg-toggle-compare .ujg-tog").on("click", function() {
                var mode = $(this).data("mode");
                if (mode && mode !== state.chartMode) { state.chartMode = mode; render(); }
            });
            $cont.find(".ujg-btn-more").on("click", function() {
                var step = Number($(this).data("more")) || 1;
                addMoreCompareSprints(step);
            });
            $cont.find(".ujg-compare-cell").on("click", function() {
                var sid = $(this).data("sid");
                if (sid) {
                    selectSprint(sid);
                    state.viewMode = "health";
                    render();
                }
            });
        }

        function bindEvents() {
            $cont.find(".ujg-tog").on("click", function() {
                var mode = $(this).data("mode");
                if (mode !== state.chartMode) { state.chartMode = mode; ensureJiraScopeChangeForSprint(); render(); }
            });
            $cont.find(".ujg-burn-tab").on("click", function() {
                var v = $(this).data("burnview");
                if (!v || v === state.burnView) return;
                state.burnView = v;
                render();
            });
            $cont.find(".ujg-btn-chart-fs").on("click", function(e) {
                e.preventDefault();
                openChartFullscreen();
            });
            $cont.find(".ujg-grp").on("click", function() {
                var aid = $(this).data("aid");
                $cont.find('.ujg-row[data-aid="' + aid + '"]').toggle();
            });
            
            var editingCell = null;
            function endEdit(cancel) {
                if (!editingCell) return;
                var $cell = editingCell.$cell;
                var origSec = editingCell.origSec;
                $cell.removeClass("ujg-est-edit ujg-est-err");
                var text = origSec > 0 ? utils.formatHoursShort(origSec) : "—";
                $cell.data("est", origSec).attr("data-est", origSec).text(text);
                editingCell = null;
            }

            function saveEdit($cell, key, newSec) {
                $cell.addClass("ujg-busy");
                api.updateIssueEstimate(key, newSec).then(function() {
                    var issue = state.issues.find(function(it) { return it.key === key; });
                    if (issue) issue.fields.timeoriginalestimate = newSec;
                    if (issue) issue.est = newSec;
                    calculate();
                    render();
                }, function(err) {
                    alert("Не удалось обновить эстимейт: " + (err && err.statusText ? err.statusText : "ошибка"));
                    endEdit(true);
                }).always(function() { $cell.removeClass("ujg-busy"); });
            }

            $cont.find(".ujg-est").on("click", function(e) {
                var $cell = $(this);
                if ($cell.hasClass("ujg-est-edit")) return;
                if (editingCell) endEdit(true);
                var origSec = Number($cell.data("est")) || 0;
                var hours = origSec > 0 ? Math.round(origSec / 360) / 10 : "";
                var $input = $('<input type="text" class="ujg-est-input">').val(hours);
                $cell.addClass("ujg-est-edit").empty().append($input);
                editingCell = { $cell: $cell, origSec: origSec };
                $input.focus().select();

                function trySave() {
                    var val = $input.val();
                    var sec = utils.parseHoursToSeconds(val);
                    if (sec === null) {
                        $cell.addClass("ujg-est-err");
                        return;
                    }
                    if (sec === origSec) {
                        endEdit(true);
                        return;
                    }
                    saveEdit($cell, $cell.data("key"), sec);
                }

                $input.on("keydown", function(ev) {
                    if (ev.key === "Enter") { ev.preventDefault(); trySave(); }
                    if (ev.key === "Escape") { ev.preventDefault(); endEdit(true); }
                });
                $input.on("blur", function() { if (editingCell) trySave(); });
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
            
            // Доска с поиском
            var $boardWrap = $('<div class="ujg-dd-wrap"></div>');
            $boardInput = $('<input type="text" class="ujg-input" placeholder="Поиск доски...">');
            $boardDropdown = $('<div class="ujg-dd"></div>');
            
            $boardInput.on("focus", showBoardDropdown).on("input", function() { filterBoards($(this).val()); showBoardDropdown(); });
            $boardInput.on("keydown", function(e) {
                if (e.key === "Escape") { hideBoardDropdown(); $(this).blur(); }
                if (e.key === "Enter" && state.filteredBoards[0]) selectBoard(state.filteredBoards[0].id);
            });
            $boardDropdown.on("click", ".ujg-dd-item", function() { selectBoard($(this).data("id")); });
            
            $boardWrap.append($boardInput, $boardDropdown);
            
            // Спринт с поиском
            var $sprintWrap = $('<div class="ujg-dd-wrap"></div>');
            $sprintInput = $('<input type="text" class="ujg-input" placeholder="Поиск спринта...">');
            $sprintDropdown = $('<div class="ujg-dd"></div>');
            
            $sprintInput.on("focus", showSprintDropdown).on("input", function() { filterSprints($(this).val()); showSprintDropdown(); });
            $sprintInput.on("keydown", function(e) {
                if (e.key === "Escape") { hideSprintDropdown(); $(this).blur(); }
                if (e.key === "Enter" && state.filteredSprints[0]) selectSprint(state.filteredSprints[0].id);
            });
            $sprintDropdown.on("click", ".ujg-dd-item", function() { selectSprint($(this).data("id")); });
            
            // Закрытие dropdown при клике вне
            $(document).on("click", function(e) {
                if (!$(e.target).closest(".ujg-dd-wrap").length) {
                    hideBoardDropdown();
                    hideSprintDropdown();
                }
            });
            
            $sprintWrap.append($sprintInput, $sprintDropdown);
            
            $compareBtn = $('<button class="ujg-btn" title="Сравнение спринтов">⇄</button>');
            $compareBtn.on("click", function() {
                state.viewMode = state.viewMode === "compare" ? "health" : "compare";
                render();
            });

            $refreshBtn = $('<button class="ujg-btn" title="Обновить">🔄</button>');
            $refreshBtn.on("click", function() { if (state.selectedSprintId) loadSprintData(state.selectedSprintId); });
            
            $fsBtn = $('<button class="ujg-btn ujg-btn-fs" title="На весь экран">⛶</button>');
            $fsBtn.on("click", toggleFullscreen);
            
            // topbar layout (как на 1-м скрине: слева селекты, справа иконки)
            var $left = $('<div class="ujg-top-left"></div>');
            var $right = $('<div class="ujg-top-right"></div>');
            $left.append($boardWrap, $sprintWrap);
            $right.append($compareBtn, $refreshBtn, $fsBtn);
            $panel.append($left, $right);

            // Page wrapper (shadcn-like layout without Tailwind)
            var $existingPage = $content.find(".ujg-page");
            if ($existingPage.length === 0) {
                // максимально компактно: без внешних паддингов/отступов
                var $page = $('<div class="ujg-page min-h-screen bg-background"></div>');
                var $inner = $('<div class="ujg-page-inner mx-auto max-w-7xl"></div>');
                $page.append($inner);
                // Вставляем обёртку и переносим внутрь панель + контент
                $content.append($page);
                $inner.append($panel, $cont);
            } else {
                // fallback: если уже есть (например, при горячей перезагрузке)
                $existingPage.find(".ujg-page-inner").append($panel);
            }
            
            $(document).on("keydown.ujgSh", function(e) { if (e.key === "Escape" && state.isFullscreen) toggleFullscreen(); });
            
            loadBoards();
        }

        initPanel();
    }

    return SprintHealthGadget;
});
