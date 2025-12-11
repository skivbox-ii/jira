/**
 * UJG Sprint Compare — Дашборд сравнения спринтов по командам
 * Отдельный entry: выбираем доску, загружаем все спринты, группируем по командам (первое слово имени спринта),
 * строим таблицу: столбцы — команды, строки — спринты (по дате начала), ячейки — мини-графики сгорания.
 */
define("_ujgSprintCompare", ["jquery"], function($) {
    "use strict";

    var baseUrl = (typeof AJS !== "undefined" && AJS.contextPath) ? AJS.contextPath() : "";

    var utils = {
        escapeHtml: function(t) { if (!t) return ""; var d = document.createElement("div"); d.textContent = String(t); return d.innerHTML; },
        parseDate: function(v) { if (!v) return null; var d = new Date(v); return isNaN(d.getTime()) ? null : d; },
        startOfDay: function(d) { if (!d) return null; var nd = new Date(d); nd.setHours(0,0,0,0); return nd; },
        getDayKey: function(d) { if (!d) return ""; return d.getFullYear() + "-" + (d.getMonth() < 9 ? "0" : "") + (d.getMonth() + 1) + "-" + (d.getDate() < 10 ? "0" : "") + d.getDate(); },
        formatDateShort: function(d) { if (!d) return "—"; return (d.getDate() < 10 ? "0" : "") + d.getDate() + "." + (d.getMonth() < 9 ? "0" : "") + (d.getMonth() + 1); },
        formatDateRange: function(start, end) {
            var s = utils.formatDateShort(start), e = utils.formatDateShort(end);
            return s && e ? s + " — " + e : (s || e || "—");
        },
        daysBetweenAll: function(start, end) { // включаем все дни
            var res = [];
            if (!start || !end) return res;
            var cur = new Date(start); cur.setHours(0,0,0,0);
            var ed = new Date(end); ed.setHours(0,0,0,0);
            while (cur <= ed) { res.push(new Date(cur)); cur.setDate(cur.getDate() + 1); }
            return res;
        }
    };

    function isIssueDone(st) {
        if (!st) return false;
        var n = (st.name || st).toString().toLowerCase();
        return ["done","closed","resolved","готово","закрыт","завершён","выполнено"].some(function(s) { return n.indexOf(s) >= 0; });
    }

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
                }, function() { d.resolve(all); });
            }
            load(0);
            return d.promise();
        },
        getSprintIssues: function(id) {
            return $.ajax({
                url: baseUrl + "/rest/agile/1.0/sprint/" + id + "/issue",
                data: { fields: "summary,status,resolutiondate,timeoriginalestimate,timetracking", maxResults: 500 }
            });
        }
    };

    function deriveTeamName(sprintName) {
        if (!sprintName) return "Команда";
        var first = sprintName.split(/[\s\-_]+/)[0] || "";
        var name = first.trim();
        if (!name) return "Команда";
        return name.charAt(0).toUpperCase() + name.slice(1);
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

    function buildBurnData(sprint) {
        var start = utils.startOfDay(utils.parseDate(sprint.startDate));
        var end = utils.startOfDay(utils.parseDate(sprint.endDate));
        if (!start || !end) return [];
        var days = utils.daysBetweenAll(start, end);
        var now = utils.getDayKey(utils.startOfDay(new Date()));

        var issues = (sprint._issues || []).map(function(iss) {
            var f = iss.fields || {};
            var estSec = (f.timetracking && f.timetracking.originalEstimateSeconds) || f.timeoriginalestimate || 0;
            var resolved = utils.startOfDay(utils.parseDate(f.resolutiondate));
            var done = isIssueDone(f.status);
            return { estSec: estSec, resolved: resolved, done: done };
        });

        var totalHours = issues.reduce(function(sum, i) { return sum + i.estSec / 3600; }, 0);
        var totalTasks = issues.length;

        var data = [];
        days.forEach(function(day, idx) {
            var dk = utils.getDayKey(day);
            var doneTasks = 0, doneHours = 0;
            issues.forEach(function(i) {
                if (i.done && i.resolved && utils.getDayKey(i.resolved) <= dk) {
                    doneTasks += 1;
                    doneHours += i.estSec / 3600;
                }
            });
            data.push({
                label: utils.formatDateShort(day),
                scopeTasks: totalTasks,
                scopeHours: totalHours,
                doneTasks: doneTasks,
                doneHours: doneHours,
                isToday: dk === now
            });
        });

        data.forEach(function(d, idx) {
            d.idealTasks = totalTasks > 0 ? totalTasks * (idx + 1) / data.length : 0;
            d.idealHours = totalHours > 0 ? totalHours * (idx + 1) / data.length : 0;
        });

        return data;
    }

    function renderMiniBurn(data) {
        if (!data || data.length === 0) return '<div class="ujg-sc-empty">Нет данных</div>';

        var maxScope = Math.max.apply(null, data.map(function(d) { return d.scopeHours || 0; }));
        var maxDone = Math.max.apply(null, data.map(function(d) { return d.doneHours || 0; }));
        var maxIdeal = Math.max.apply(null, data.map(function(d) { return d.idealHours || 0; }));
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
        function yPos(val) { return pad.top + plotH - (plotH * (val / maxVal)); }
        function fmt(val) { return Math.round(val) + "ч"; }
        function tip(d) {
            var left = Math.max((d.scopeHours || 0) - (d.doneHours || 0), 0);
            var parts = [];
            parts.push(d.label);
            parts.push("Объём: " + fmt(d.scopeHours || 0));
            parts.push("Реально: " + fmt(d.doneHours || 0));
            parts.push("Идеал: " + fmt(d.idealHours || 0));
            parts.push("Остаток: " + fmt(left));
            return parts.join("\n");
        }

        var idealPts = [], realPts = [], idealTips = [], realTips = [];
        data.forEach(function(d, idx) {
            var x = xPos(idx);
            var yIdeal = yPos(d.idealHours || 0);
            var yReal = yPos(d.doneHours || 0);
            idealPts.push(x + "," + yIdeal);
            realPts.push(x + "," + yReal);
            idealTips.push({ x: x, y: yIdeal, tip: tip(d) });
            realTips.push({ x: x, y: yReal, tip: tip(d) });
        });

        var todayIdx = data.findIndex(function(d) { return d.isToday; });

        var html = '<div class="ujg-sc-mini">';
        html += '<svg class="ujg-svg ujg-burn-svg" viewBox="0 0 ' + VIEW_W + ' ' + VIEW_H + '" preserveAspectRatio="xMidYMid meet">';

        yTicks.forEach(function(v) {
            var y = yPos(v);
            html += '<line class="ujg-burn-grid" x1="' + pad.left + '" y1="' + y + '" x2="' + (VIEW_W - pad.right) + '" y2="' + y + '"/>';
            html += '<text class="ujg-burn-label ujg-burn-y" x="' + (pad.left - 1.5) + '" y="' + (y + 1.2) + '">' + fmt(v) + '</text>';
        });
        var xStep = Math.max(1, Math.ceil(data.length / 8));
        data.forEach(function(d, idx) {
            var x = xPos(idx);
            html += '<line class="ujg-burn-grid" x1="' + x + '" y1="' + pad.top + '" x2="' + x + '" y2="' + (VIEW_H - pad.bottom) + '"/>';
            if (idx % xStep === 0 || idx === data.length - 1) {
                html += '<text class="ujg-burn-label ujg-burn-x" x="' + x + '" y="' + (VIEW_H - pad.bottom + 5) + '">' + utils.escapeHtml(d.label || "") + '</text>';
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

        idealTips.forEach(function(p) {
            html += '<circle class="ujg-burn-dot" cx="' + p.x + '" cy="' + p.y + '" r="1.6" fill="#0d8bff"><title>' + utils.escapeHtml(p.tip) + '</title></circle>';
        });
        realTips.forEach(function(p) {
            html += '<circle class="ujg-burn-dot" cx="' + p.x + '" cy="' + p.y + '" r="1.6" fill="#d93026"><title>' + utils.escapeHtml(p.tip) + '</title></circle>';
        });

        html += '</svg></div>';
        return html;
    }

    function SprintCompareGadget(API) {
        var state = {
            boards: [],
            sprints: [],
            selectedBoardId: null,
            teams: [],
            rows: [],
            loading: false
        };

        var $content = API.getGadgetContentEl();
        var $root = $content.find(".ujg-sprint-compare");
        if ($root.length === 0) { $root = $('<div class="ujg-sprint-compare"></div>'); $content.append($root); }

        function render() {
            var html = '<div class="ujg-sc-wrap">';
            html += '<div class="ujg-sc-panel">';
            html += '<select class="ujg-sel ujg-sc-board"><option value="">Доска</option>';
            state.boards.forEach(function(b) {
                var sel = state.selectedBoardId == b.id ? ' selected' : '';
                html += '<option value="' + b.id + '"' + sel + '>' + utils.escapeHtml(b.name) + '</option>';
            });
            html += '</select>';
            html += '<span class="ujg-sc-hint">Выберите доску, чтобы увидеть спринты по командам</span>';
            html += '</div>';

            if (state.loading) {
                html += '<div class="ujg-loading">Загрузка...</div></div>';
                $root.html(html);
                return;
            }

            if (!state.rows.length) {
                html += '<div class="ujg-loading">Нет спринтов</div></div>';
                $root.html(html);
                return;
            }

            html += '<div class="ujg-sc-table-wrap"><table class="ujg-sc-table"><thead><tr>';
            html += '<th class="ujg-sc-sprintcol">Спринт / период</th>';
            state.teams.forEach(function(t) { html += '<th>' + utils.escapeHtml(t) + '</th>'; });
            html += '</tr></thead><tbody>';

            state.rows.forEach(function(r) {
                html += '<tr>';
                html += '<td class="ujg-sc-sprintcell"><div class="ujg-sc-sname">' + utils.escapeHtml(r.sprint.name || ("#" + r.sprint.id)) + '</div>';
                html += '<div class="ujg-sc-range">' + utils.escapeHtml(utils.formatDateRange(utils.startOfDay(utils.parseDate(r.sprint.startDate)), utils.startOfDay(utils.parseDate(r.sprint.endDate)))) + '</div></td>';
                state.teams.forEach(function(team) {
                    if (r.team === team) {
                        html += '<td class="ujg-sc-cell">' + renderMiniBurn(r.burn) + '</td>';
                    } else {
                        html += '<td class="ujg-sc-cell ujg-sc-emptycell"></td>';
                    }
                });
                html += '</tr>';
            });

            html += '</tbody></table></div></div>';
            $root.html(html);
        }

        function computeRows() {
            var teamSet = {};
            state.sprints.forEach(function(sp) {
                sp.team = deriveTeamName(sp.name);
                teamSet[sp.team] = true;
            });
            state.teams = Object.keys(teamSet).sort();

            state.rows = state.sprints.slice().sort(function(a, b) {
                var da = utils.parseDate(a.startDate), db = utils.parseDate(b.startDate);
                return (da || 0) - (db || 0);
            }).map(function(sp) {
                return { sprint: sp, team: sp.team, burn: buildBurnData(sp) };
            });
        }

        function loadSprints(boardId) {
            state.loading = true;
            state.selectedBoardId = boardId;
            render();
            api.getAllSprints(boardId).then(function(res) {
                state.sprints = res || [];
                return loadIssuesForSprints(state.sprints);
            }).then(function() {
                computeRows();
                state.loading = false;
                render();
            }, function() {
                state.sprints = [];
                state.rows = [];
                state.loading = false;
                render();
            });
        }

        function loadIssuesForSprints(sprints) {
            var d = $.Deferred();
            if (!sprints || sprints.length === 0) { d.resolve(); return d.promise(); }
            var tasks = sprints.map(function(sp) {
                return api.getSprintIssues(sp.id).then(function(res) {
                    sp._issues = (res && res.issues) ? res.issues : [];
                }, function() { sp._issues = []; });
            });
            $.when.apply($, tasks).then(function() { d.resolve(); });
            return d.promise();
        }

        function loadBoards() {
            api.getBoards().then(function(res) {
                state.boards = (res && res.values) ? res.values : [];
                render();
            });
        }

        function bind() {
            $root.on("change", ".ujg-sc-board", function() {
                var val = $(this).val();
                if (val) loadSprints(val);
            });
        }

        function init() {
            bind();
            loadBoards();
        }

        init();
    }

    return SprintCompareGadget;
});

