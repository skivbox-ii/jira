// Расчёт и разбор burndown/burnup
define("_ujgSH_burndown", ["_ujgSH_config", "_ujgSH_utils"], function(config, utils) {
    "use strict";

    var CONFIG = config.CONFIG;

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
                var dayCount = (re - rs) / (24 * 3600 * 1000);
                if (rate > 0) {
                    cur += perDay * dayCount;
                }
                pts.push({ x: re, y: Math.round(cur) });
            });
            guideline = pts;
        }

        return {
            scope: scopePts,
            completed: donePts,
            guideline: guideline,
            projection: null,
            markers: { scope: markersScope, done: markersDone },
            startTime: startTime,
            endTime: endTime,
            now: now,
            workRateData: resp.workRateData || null
        };
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

    return {
        isIssueDone: isIssueDone,
        buildBurndown: buildBurndown,
        parseScopeChangeBurndown: parseScopeChangeBurndown,
        extractJiraStepSeries: extractJiraStepSeries
    };
});
