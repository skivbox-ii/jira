define("_ujgTimesheet", ["jquery", "_ujgCommon", "_ujgShared_llmClient"], function($, Common, LlmClient) {

    var utils = Common.utils;
    var baseUrl = Common.baseUrl;
    
    var STORAGE_KEY = "ujg_timesheet_settings";
    var STORAGE_KEY_GROUPS = "ujg_timesheet_groups";
    var STORAGE_KEY_JQL_PRESETS = "ujg_timesheet_jql_presets";
    var LLM_CONFIG_STORAGE_KEY = "ujg-shared-llm-config";
    var LEGACY_LLM_CONFIG_STORAGE_KEYS = ["ujg-ua-ai-report-config"];
    
    var CONFIG = {
        version: "1.6.0",
        jqlFilter: "",
        debug: true
    };

    var WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
    var MONTH_NAMES = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
    var DONE_STATUSES = ["done", "closed", "resolved", "готово", "закрыт", "закрыта", "завершен", "завершена", "выполнено"];
    var DEFAULT_MASS_WORKLOG_SECONDS = 8 * 3600;
    
    // Загрузка/сохранение групп пользователей
    function loadGroups() {
        try {
            var saved = localStorage.getItem(STORAGE_KEY_GROUPS);
            if (saved) return JSON.parse(saved);
        } catch(e) {}
        return {};
    }
    
    function saveGroups(groups) {
        try {
            localStorage.setItem(STORAGE_KEY_GROUPS, JSON.stringify(groups));
        } catch(e) {}
    }
    
    function loadSettings() {
        try {
            var saved = localStorage.getItem(STORAGE_KEY);
            if (saved) return JSON.parse(saved);
        } catch(e) {}
        return {};
    }
    
    function saveSettings(settings) {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
        } catch(e) {}
    }

    function normalizeJqlText(value) {
        return String(value == null ? "" : value).trim();
    }

    function makeJqlPresetId() {
        return "jql-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
    }

    function makeDefaultJqlName(index, jql) {
        var text = normalizeJqlText(jql);
        if (!text) return "Все задачи";
        if (/project\s*=/i.test(text)) {
            var m = /project\s*=\s*"?([A-Z][A-Z0-9_]+)"?/i.exec(text);
            if (m && m[1]) return m[1].toUpperCase();
        }
        return "JQL " + (index + 1);
    }

    function normalizeJqlPresets(input, fallbackJql) {
        var rawItems = input && Array.isArray(input.items) ? input.items : [];
        var items = [];
        var seen = {};
        rawItems.forEach(function(item, idx) {
            var jql = normalizeJqlText(item && item.jql);
            var id = normalizeJqlText(item && item.id) || ("jql-" + (idx + 1));
            if (seen[id]) id = id + "-" + (idx + 1);
            seen[id] = true;
            items.push({
                id: id,
                name: normalizeJqlText(item && item.name) || makeDefaultJqlName(idx, jql),
                jql: jql
            });
        });
        if (items.length === 0) {
            items.push({
                id: "jql-default",
                name: makeDefaultJqlName(0, fallbackJql),
                jql: normalizeJqlText(fallbackJql)
            });
        }
        var activeId = normalizeJqlText(input && input.activeId);
        if (!items.some(function(item) { return item.id === activeId; })) {
            activeId = items[0].id;
        }
        var active = items.filter(function(item) { return item.id === activeId; })[0] || items[0];
        return {
            activeId: activeId,
            currentJql: active ? active.jql : "",
            items: items
        };
    }

    function selectJqlPreset(presets, presetId) {
        var normalized = normalizeJqlPresets(presets, "");
        var item = normalized.items.filter(function(candidate) {
            return candidate.id === presetId;
        })[0];
        if (!item) return normalized;
        normalized.activeId = item.id;
        normalized.currentJql = item.jql;
        return normalized;
    }

    function applyJqlPreset(presets, jql) {
        var normalized = normalizeJqlPresets(presets, "");
        var activeId = normalized.activeId;
        var currentJql = normalizeJqlText(jql);
        normalized.items = normalized.items.map(function(item, idx) {
            if (item.id !== activeId) return item;
            return {
                id: item.id,
                name: item.name || makeDefaultJqlName(idx, currentJql),
                jql: currentJql
            };
        });
        normalized.currentJql = currentJql;
        return normalized;
    }

    function saveAsJqlPreset(presets, name, jql) {
        var normalized = normalizeJqlPresets(presets, "");
        var currentJql = normalizeJqlText(jql);
        var id = makeJqlPresetId();
        normalized.items.push({
            id: id,
            name: normalizeJqlText(name) || makeDefaultJqlName(normalized.items.length, currentJql),
            jql: currentJql
        });
        normalized.activeId = id;
        normalized.currentJql = currentJql;
        return normalized;
    }

    function planJqlPresetAction(presets, action, options) {
        var opts = options || {};
        var nextPresets;
        if (action === "select") {
            nextPresets = selectJqlPreset(presets, opts.presetId);
        } else if (action === "saveAs") {
            nextPresets = saveAsJqlPreset(presets, opts.name, opts.jql);
        } else if (action === "apply") {
            nextPresets = applyJqlPreset(presets, opts.jql);
        } else {
            nextPresets = normalizeJqlPresets(presets, "");
        }
        return {
            presets: nextPresets,
            currentJql: nextPresets.currentJql,
            appliedJql: action === "apply" ? nextPresets.currentJql : null,
            shouldReload: action === "apply"
        };
    }

    function deleteJqlPreset(presets, presetId) {
        var normalized = normalizeJqlPresets(presets, "");
        if (normalized.items.length <= 1) {
            normalized.items[0].jql = "";
            normalized.items[0].name = "Все задачи";
            normalized.activeId = normalized.items[0].id;
            normalized.currentJql = "";
            return normalized;
        }
        normalized.items = normalized.items.filter(function(item) {
            return item.id !== presetId;
        });
        if (!normalized.items.some(function(item) { return item.id === normalized.activeId; })) {
            normalized.activeId = normalized.items[0].id;
        }
        normalized.currentJql = (normalized.items.filter(function(item) {
            return item.id === normalized.activeId;
        })[0] || normalized.items[0]).jql;
        return normalized;
    }

    function readJqlPresets(fallbackJql) {
        try {
            return normalizeJqlPresets(JSON.parse(localStorage.getItem(STORAGE_KEY_JQL_PRESETS) || "null"), fallbackJql);
        } catch(e) {
            return normalizeJqlPresets(null, fallbackJql);
        }
    }

    function writeJqlPresets(presets) {
        var normalized = normalizeJqlPresets(presets, "");
        try {
            localStorage.setItem(STORAGE_KEY_JQL_PRESETS, JSON.stringify({
                activeId: normalized.activeId,
                items: normalized.items
            }));
        } catch(e) {}
        return normalized;
    }

    function resolveInitialJqlState(options) {
        var opts = options || {};
        var fallbackJql = opts.hasUrlJql
            ? normalizeJqlText(opts.urlJql)
            : (opts.hasSavedJql ? normalizeJqlText(opts.savedJql) : "");
        var presets = normalizeJqlPresets(opts.storedPresets, fallbackJql);
        var appliedJql;
        if (opts.hasUrlJql) {
            appliedJql = normalizeJqlText(opts.urlJql);
        } else if (opts.hasSavedJql) {
            appliedJql = normalizeJqlText(opts.savedJql);
        } else {
            appliedJql = presets.currentJql;
        }
        return {
            appliedJql: appliedJql,
            inputJql: opts.hasUrlJql ? appliedJql : presets.currentJql,
            presets: presets
        };
    }

    function cleanGeneratedJql(value) {
        var text = normalizeJqlText(value);
        text = text.replace(/^```(?:jql)?\s*/i, "").replace(/```$/i, "").trim();
        text = text.replace(/^JQL\s*:\s*/i, "").trim();
        return text;
    }

    function collectProjectKeys(calendarData) {
        var projects = {};
        Object.keys(calendarData || {}).forEach(function(dayKey) {
            (calendarData[dayKey] || []).forEach(function(item) {
                var key = item && item.key ? String(item.key) : "";
                var m = /^([A-Z][A-Z0-9_]+)-\d+/.exec(key);
                if (m && m[1]) projects[m[1]] = true;
            });
        });
        return Object.keys(projects).sort();
    }

    function normalizeProjectKeys(projects) {
        var seen = {};
        var list = Array.isArray(projects) ? projects : [];
        list.forEach(function(project) {
            var key = normalizeJqlText(project && typeof project === "object" ? project.key : project).toUpperCase();
            if (key) seen[key] = true;
        });
        return Object.keys(seen).sort();
    }

    function mergeProjectKeys(first, second) {
        return normalizeProjectKeys((first || []).concat(second || []));
    }

    function fetchAvailableProjectKeys(ajaxFn, url, fallbackProjects) {
        var fallback = normalizeProjectKeys(fallbackProjects);
        var request;
        if (typeof ajaxFn !== "function") return Promise.resolve(fallback);
        try {
            request = ajaxFn({
                url: url,
                type: "GET"
            });
        } catch(e) {
            return Promise.resolve(fallback);
        }
        return Promise.resolve(request).then(function(projects) {
            return mergeProjectKeys(fallback, normalizeProjectKeys(projects));
        }, function() {
            return fallback;
        });
    }

    function readTimesheetLlmConfig(storage, client) {
        if (!client || typeof client.readStoredConfig !== "function") return null;
        var config = client.readStoredConfig(storage, LLM_CONFIG_STORAGE_KEY);
        if (config) return config;
        for (var i = 0; i < LEGACY_LLM_CONFIG_STORAGE_KEYS.length; i++) {
            config = client.readStoredConfig(storage, LEGACY_LLM_CONFIG_STORAGE_KEYS[i]);
            if (!config) continue;
            if (typeof client.writeStoredConfig === "function") {
                client.writeStoredConfig(storage, config, LLM_CONFIG_STORAGE_KEY);
            }
            return config;
        }
        return null;
    }

    function beginTimesheetLoad(state, days, jqlFilter) {
        state.loadRevision = (parseInt(state.loadRevision, 10) || 0) + 1;
        return {
            revision: state.loadRevision,
            days: (days || []).slice(),
            jqlFilter: normalizeJqlText(jqlFilter)
        };
    }

    function isTimesheetLoadCurrent(state, loadContext) {
        return !!loadContext && state.loadRevision === loadContext.revision;
    }

    function buildJqlLlmRequest(options) {
        var opts = options || {};
        var projects = opts.projects && opts.projects.length ? opts.projects.join(", ") : "(нет загруженного списка)";
        var systemPrompt = normalizeJqlText(opts.systemPrompt) || "Ты помогаешь составить Jira JQL. Верни только JQL без markdown и пояснений.";
        var userPrompt = [
            "Текущий JQL:",
            normalizeJqlText(opts.currentJql) || "(пусто)",
            "",
            "Доступные проекты:",
            projects,
            "",
            "Задача пользователя:",
            normalizeJqlText(opts.userPrompt)
        ].join("\n");
        return {
            systemPrompt: systemPrompt,
            userPrompt: userPrompt,
            temperature: 0.1
        };
    }
    
    // URL hash params
    function getUrlParams() {
        var params = {};
        try {
            var hash = window.location.hash.replace(/^#/, "");
            if (!hash) return params;
            hash.split("&").forEach(function(part) {
                var kv = part.split("=");
                if (kv.length === 2) {
                    params[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1]);
                }
            });
        } catch(e) {}
        return params;
    }
    
    function setUrlParams(params) {
        try {
            var parts = [];
            Object.keys(params).forEach(function(k) {
                if (params[k] !== undefined && params[k] !== "") {
                    parts.push(encodeURIComponent(k) + "=" + encodeURIComponent(params[k]));
                }
            });
            var newHash = parts.length > 0 ? "#" + parts.join("&") : "";
            if (window.history && window.history.replaceState) {
                window.history.replaceState(null, "", window.location.pathname + window.location.search + newHash);
            } else {
                window.location.hash = newHash;
            }
        } catch(e) {}
    }
    
    function getDefaultDates() {
        var now = new Date();
        var start = new Date(now.getFullYear(), now.getMonth(), 1);
        var end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        return {
            start: start.toISOString().slice(0, 10),
            end: end.toISOString().slice(0, 10)
        };
    }

    function filterDayDataByUsers(dayData, userIds) {
        if (!userIds || userIds.length === 0) return dayData;
        return (dayData || []).map(function(item) {
            var worklogs = (item.worklogs || []).filter(function(w) {
                return userIds.indexOf(w.authorId) >= 0;
            });
            if (!item.worklogs || item.worklogs.length === 0) {
                if (!item.authors) return null;
                return Object.keys(item.authors).some(function(aid) {
                    return userIds.indexOf(aid) >= 0;
                }) ? item : null;
            }
            if (worklogs.length === 0) return null;
            var projected = {};
            var seconds = 0;
            var comments = [];
            var authors = {};
            Object.keys(item).forEach(function(key) { projected[key] = item[key]; });
            worklogs.forEach(function(w) {
                seconds += w.seconds || 0;
                if (w.comment) comments.push(w.comment);
                authors[w.authorId] = w.authorName;
            });
            projected.seconds = seconds;
            projected.comments = comments;
            projected.authors = authors;
            projected.worklogs = worklogs;
            return projected;
        }).filter(Boolean);
    }

    function getCalendarUserIds(users, selectedUsers) {
        var allUsers = users || {};
        var ids = selectedUsers && selectedUsers.length > 0
            ? selectedUsers.filter(function(id) { return !!allUsers[id]; })
            : Object.keys(allUsers);
        return ids.slice().sort(function(a, b) {
            return (allUsers[a] || a).localeCompare(allUsers[b] || b);
        });
    }

    function getUserDropdownEntries(users, selectedUsers, query) {
        var allUsers = users || {};
        var selected = selectedUsers || [];
        var selectedMap = {};
        selected.forEach(function(id) {
            if (allUsers[id]) selectedMap[id] = true;
        });
        var q = (query || "").trim().toLowerCase();
        var entries = Object.keys(allUsers).map(function(id) {
            return {
                id: id,
                name: allUsers[id] || id,
                selected: !!selectedMap[id]
            };
        }).filter(function(entry) {
            if (entry.selected) return true;
            return !q || entry.name.toLowerCase().indexOf(q) >= 0 || entry.id.toLowerCase().indexOf(q) >= 0;
        });
        return entries.sort(function(a, b) {
            if (a.selected !== b.selected) return a.selected ? -1 : 1;
            return a.name.localeCompare(b.name);
        });
    }

    function countWorkDays(days) {
        var count = 0;
        (days || []).forEach(function(day) {
            if (day && utils.getDayOfWeek(day) < 5) count++;
        });
        return count;
    }

    function collectActiveUserIds(items, activeUserIds, userFilter) {
        (items || []).forEach(function(item) {
            var allowedUsers = userFilter && userFilter.length > 0 ? userFilter : null;
            var worklogs = item.worklogs || [];
            if (worklogs.length > 0) {
                worklogs.forEach(function(wl) {
                    if (!wl.authorId) return;
                    if (allowedUsers && allowedUsers.indexOf(wl.authorId) < 0) return;
                    activeUserIds[wl.authorId] = true;
                });
                return;
            }
            Object.keys(item.authors || {}).forEach(function(authorId) {
                if (allowedUsers && allowedUsers.indexOf(authorId) < 0) return;
                activeUserIds[authorId] = true;
            });
        });
    }

    function formatUserCountRu(count) {
        var mod10 = count % 10;
        var mod100 = count % 100;
        if (mod10 === 1 && mod100 !== 11) return count + " пользователь";
        if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return count + " пользователя";
        return count + " пользователей";
    }

    function formatSummaryHeadline(summary, groupSummary) {
        var hours = utils.formatTime(summary.totalSeconds) || "0";
        if (!groupSummary) {
            var expected = utils.formatTime(summary.expectedSeconds) || "0";
            var text = hours + " / " + expected;
            if (summary.expectedSeconds > 0) {
                if (summary.totalSeconds >= summary.expectedSeconds) text += " ✓";
                else if (summary.deficit > 0) text += " −" + utils.formatTime(summary.deficit);
            }
            return text;
        }
        return formatUserCountRu(summary.activeUserCount || 0) + " · " + hours + " (" + (summary.utilization || 0) + "%)";
    }

    function computeUserReport(userId, days, calendarData) {
        var workDays = countWorkDays(days);
        var expectedSeconds = workDays * 8 * 3600;
        var totalSeconds = 0;
        var daysWithEntries = 0;
        var taskKeys = {};

        (days || []).forEach(function(day) {
            var dayKey = utils.getDayKey(day);
            var items = calendarData[dayKey] || [];
            var daySeconds = 0;
            items.forEach(function(item) {
                var wls = item.worklogs || [];
                wls.forEach(function(wl) {
                    if (wl.authorId === userId) {
                        daySeconds += wl.seconds || 0;
                        if (item.key) taskKeys[item.key] = true;
                    }
                });
                if ((!wls || wls.length === 0) && item.authors && item.authors[userId]) {
                    daySeconds += item.seconds || 0;
                    if (item.key) taskKeys[item.key] = true;
                }
            });
            if (daySeconds > 0) daysWithEntries++;
            totalSeconds += daySeconds;
        });

        var deficit = expectedSeconds - totalSeconds;
        return {
            totalSeconds: totalSeconds,
            expectedSeconds: expectedSeconds,
            deficit: deficit > 0 ? deficit : 0,
            daysWorked: daysWithEntries,
            workDays: workDays,
            taskCount: Object.keys(taskKeys).length
        };
    }

    function computeWeekSummary(weekDays, userFilter, calendarData, options) {
        var totalSeconds = 0;
        var projects = {};
        var issueTypeKeys = {};
        var taskKeys = {};
        var daysWorked = 0;
        var workDays = 0;
        var groupSummary = !!(options && options.groupSummary);
        var activeUserIds = {};

        (weekDays || []).forEach(function(day) {
            if (!day) return;
            if (utils.getDayOfWeek(day) < 5) workDays++;

            var dayKey = utils.getDayKey(day);
            var dayData = filterDayDataByUsers(calendarData[dayKey] || [], userFilter);
            var daySeconds = 0;

            if (groupSummary) collectActiveUserIds(dayData, activeUserIds, userFilter);

            dayData.forEach(function(item) {
                var secs = item.seconds || 0;
                daySeconds += secs;
                totalSeconds += secs;
                if (item.key) {
                    taskKeys[item.key] = true;
                    var proj = item.key.split("-")[0];
                    projects[proj] = (projects[proj] || 0) + secs;
                    if (item.issueType) {
                        if (!issueTypeKeys[item.issueType]) issueTypeKeys[item.issueType] = {};
                        issueTypeKeys[item.issueType][item.key] = true;
                    }
                }
            });
            if (daySeconds > 0) daysWorked++;
        });

        var activeUserCount = groupSummary ? Object.keys(activeUserIds).length : 0;
        var expectedSeconds = workDays * 8 * 3600 * (groupSummary ? activeUserCount : 1);
        var issueTypes = {};
        Object.keys(issueTypeKeys).forEach(function(type) {
            issueTypes[type] = Object.keys(issueTypeKeys[type]).length;
        });
        var utilization = expectedSeconds > 0
            ? Math.round(totalSeconds / expectedSeconds * 1000) / 10
            : 0;

        return {
            totalSeconds: totalSeconds,
            expectedSeconds: expectedSeconds,
            deficit: Math.max(0, expectedSeconds - totalSeconds),
            projects: projects,
            issueTypes: issueTypes,
            tasks: taskKeys,
            taskCount: Object.keys(taskKeys).length,
            daysWorked: daysWorked,
            workDays: workDays,
            activeUserCount: activeUserCount,
            utilization: utilization
        };
    }

    function computeMonthSummary(monthDays, userFilter, calendarData, options) {
        var result = computeWeekSummary(monthDays, userFilter, calendarData, options);
        result.projectPcts = {};
        if (result.totalSeconds > 0) {
            Object.keys(result.projects).forEach(function(proj) {
                result.projectPcts[proj] = Math.round(result.projects[proj] / result.totalSeconds * 1000) / 10;
            });
        }
        return result;
    }

    function getFirstWorkdayKey(weekDays) {
        var selected = null;
        (weekDays || []).forEach(function(day) {
            if (!day || utils.getDayOfWeek(day) >= 5) return;
            if (!selected || day < selected) selected = day;
        });
        if (!selected) {
            (weekDays || []).forEach(function(day) {
                if (!day) return;
                if (!selected || day < selected) selected = day;
            });
        }
        return selected ? utils.getDayKey(selected) : "";
    }

    function buildTransitionMassWorklogTemplate(transition, weekDays) {
        transition = transition || {};
        return {
            issueKey: transition.key || "",
            dayKey: getFirstWorkdayKey(weekDays),
            seconds: DEFAULT_MASS_WORKLOG_SECONDS,
            summary: transition.summary || ""
        };
    }

    function getWeekTransitions(weekDays, taskKeysObj, changelogData) {
        if (!changelogData || Object.keys(changelogData).length === 0) return [];
        var weekStart = null, weekEnd = null;
        weekDays.forEach(function(day) {
            if (!day) return;
            if (!weekStart || day < weekStart) weekStart = day;
            if (!weekEnd || day > weekEnd) weekEnd = day;
        });
        if (!weekStart || !weekEnd) return [];
        var startMs = weekStart.getTime();
        var endMs = weekEnd.getTime() + 24 * 3600 * 1000;

        var result = [];
        Object.keys(taskKeysObj).forEach(function(key) {
            var changelogEntry = changelogData[key];
            var transitions = Array.isArray(changelogEntry) ? changelogEntry : (changelogEntry && changelogEntry.transitions);
            var summary = Array.isArray(changelogEntry) ? "" : (changelogEntry && changelogEntry.summary || "");
            if (!transitions || transitions.length === 0) return;
            var weekChanges = [];
            transitions.forEach(function(t) {
                var tDate = new Date(t.date);
                if (tDate.getTime() >= startMs && tDate.getTime() < endMs) {
                    weekChanges.push(t.from + " → " + t.to);
                }
            });
            if (weekChanges.length > 0) {
                result.push({ key: key, summary: summary, changes: weekChanges });
            }
        });
        return result;
    }

    function parseDateOnly(value) {
        if (!value) return null;
        var parts = String(value).split("-");
        if (parts.length !== 3) return null;
        var year = parseInt(parts[0], 10);
        var month = parseInt(parts[1], 10);
        var day = parseInt(parts[2], 10);
        if (!year || !month || !day) return null;
        var date = new Date(year, month - 1, day);
        if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
        return date;
    }

    function pad2(value) {
        return value < 10 ? "0" + value : String(value);
    }

    function formatTimezoneOffset(date) {
        var minutes = -date.getTimezoneOffset();
        var sign = minutes >= 0 ? "+" : "-";
        var abs = Math.abs(minutes);
        return sign + pad2(Math.floor(abs / 60)) + pad2(abs % 60);
    }

    function formatJiraStarted(dayKey) {
        var date = parseDateOnly(dayKey);
        if (!date) return "";
        date.setHours(9, 0, 0, 0);
        return utils.getDayKey(date) + "T09:00:00.000" + formatTimezoneOffset(date);
    }

    function normalizeWorklogComment(comment) {
        return comment == null ? "" : String(comment);
    }

    function parseWorklogSeconds(value) {
        if (value == null) return 0;
        var text = String(value).trim().toLowerCase().replace(",", ".");
        if (!text) return 0;
        if (/^\d+(?:\.\d+)?$/.test(text)) {
            return Math.round(parseFloat(text) * 3600);
        }
        var seconds = 0;
        var hours = text.match(/(\d+(?:\.\d+)?)\s*(h|ч|час|часа|часов)\b/);
        var minutes = text.match(/(\d+(?:\.\d+)?)\s*(m|м|мин|минут|минуты)\b/);
        if (hours) seconds += Math.round(parseFloat(hours[1]) * 3600);
        if (minutes) seconds += Math.round(parseFloat(minutes[1]) * 60);
        return seconds;
    }

    function buildWorklogPayload(dayKey, seconds, comment, started) {
        return {
            started: started || formatJiraStarted(dayKey),
            timeSpentSeconds: seconds,
            comment: normalizeWorklogComment(comment)
        };
    }

    function findSelfWorklogOnDay(calendarData, issueKey, dayKey, currentUserId, seconds) {
        var items = (calendarData && calendarData[dayKey]) || [];
        for (var i = 0; i < items.length; i++) {
            var item = items[i];
            if (String(item.key || "") !== String(issueKey || "")) continue;
            var worklogs = item.worklogs || [];
            var fallback = null;
            for (var w = 0; w < worklogs.length; w++) {
                var wl = worklogs[w];
                if (currentUserId && wl.authorId !== currentUserId) continue;
                if (!fallback) fallback = wl;
                if ((wl.seconds || 0) === seconds) return { exists: true, matching: wl };
            }
            if (fallback) return { exists: true, matching: null };
            if (currentUserId && item.authors && item.authors[currentUserId]) return { exists: true, matching: null };
            if (!currentUserId && (worklogs.length > 0 || item.seconds)) return { exists: true, matching: null };
            return { exists: false, matching: null };
        }
        return { exists: false, matching: null };
    }

    function issueHasSelfWorklogOnDay(calendarData, issueKey, dayKey, currentUserId) {
        return findSelfWorklogOnDay(calendarData, issueKey, dayKey, currentUserId, null).exists;
    }

    function buildMassWorklogPlan(options) {
        options = options || {};
        var start = parseDateOnly(options.startDate);
        var end = parseDateOnly(options.endDate);
        var result = {
            issueKey: options.issueKey || "",
            seconds: options.seconds || 0,
            startDate: start ? utils.getDayKey(start) : "",
            endDate: end ? utils.getDayKey(end) : "",
            dates: [],
            updateWorklogs: [],
            skipDates: []
        };
        if (!start || !end || !result.issueKey || result.seconds <= 0) return result;
        if (start > end) {
            var t = start;
            start = end;
            end = t;
            result.startDate = utils.getDayKey(start);
            result.endDate = utils.getDayKey(end);
        }
        Common.daysBetween(start, end).forEach(function(day) {
            if (utils.getDayOfWeek(day) >= 5) return;
            var dayKey = utils.getDayKey(day);
            var existing = findSelfWorklogOnDay(options.calendarData || {}, result.issueKey, dayKey, options.currentUserId, result.seconds);
            if (!existing.exists) {
                result.dates.push(dayKey);
                return;
            }
            if (existing.matching && existing.matching.id) {
                if (normalizeWorklogComment(existing.matching.comment) !== normalizeWorklogComment(options.comment)) {
                    result.updateWorklogs.push({
                        dayKey: dayKey,
                        worklogId: String(existing.matching.id),
                        started: existing.matching.started || "",
                        seconds: existing.matching.seconds || result.seconds,
                        existingComment: normalizeWorklogComment(existing.matching.comment)
                    });
                    return;
                }
                result.skipDates.push(dayKey);
            } else {
                result.skipDates.push(dayKey);
            }
        });
        return result;
    }

    function MyGadget(API) {
        var state = {
            showComments: false,
            isFullscreen: false,
            selectedUsers: [],       // Массив выбранных пользователей
            separateCalendars: false, // Рисовать отдельные календари для каждого
            days: [],
            calendarData: {},
            users: {},
            rangeStart: "",
            rangeEnd: "",
            loading: false,
            loadedDays: 0,
            totalDays: 0,
            lastError: "",
            showDetails: false,
            changelogData: {},
            changelogLoading: false,
            currentUser: null,
            currentUserLoading: false,
            currentUserPromise: null,
            jqlPresets: normalizeJqlPresets(null, ""),
            loadRevision: 0,
            availableProjectKeys: null,
            availableProjectKeysPromise: null
        };

        var $content = API.getGadgetContentEl();
        var $cont = $content.find(".ujg-timesheet");
        if ($cont.length === 0) {
            $cont = $('<div class="ujg-timesheet"></div>');
            $content.append($cont);
        }

        var $fsBtn, $userBtn, $userPanel, $userSearch, $userSelected, $userList, $rangeStart, $rangeEnd, $debugBox, $debugText, $progress;
        var $groupSelect, $groupSaveBtn, $separateCheck;

        function log(msg) {
            if (CONFIG.debug) console.log("[UJG-Timesheet]", msg);
        }

        function escapeAttr(value) {
            return utils.escapeHtml(value == null ? "" : String(value)).replace(/"/g, "&quot;");
        }

        function currentUserId() {
            var user = state.currentUser || {};
            return user.accountId || user.key || user.name || "";
        }

        function loadCurrentUser() {
            if (state.currentUser) return null;
            if (state.currentUserLoading) return state.currentUserPromise;
            state.currentUserLoading = true;
            state.currentUserPromise = $.ajax({
                url: baseUrl + "/rest/api/2/myself",
                type: "GET"
            }).then(function(user) {
                state.currentUser = user || null;
                state.currentUserLoading = false;
                return state.currentUser;
            }, function() {
                state.currentUser = null;
                state.currentUserLoading = false;
                return null;
            });
            return state.currentUserPromise;
        }

        function findIssueInDay(dayKey, issueKey) {
            var items = state.calendarData[dayKey] || [];
            for (var i = 0; i < items.length; i++) {
                if (String(items[i].key || "") === String(issueKey || "")) return items[i];
            }
            return null;
        }

        function createWorklog(issueKey, dayKey, seconds, comment) {
            return $.ajax({
                url: baseUrl + "/rest/api/2/issue/" + encodeURIComponent(issueKey) + "/worklog",
                type: "POST",
                contentType: "application/json",
                data: JSON.stringify(buildWorklogPayload(dayKey, seconds, comment))
            });
        }

        function updateWorklog(issueKey, worklogId, dayKey, seconds, comment, started) {
            return $.ajax({
                url: baseUrl + "/rest/api/2/issue/" + encodeURIComponent(issueKey) + "/worklog/" + encodeURIComponent(worklogId),
                type: "PUT",
                contentType: "application/json",
                data: JSON.stringify(buildWorklogPayload(dayKey, seconds, comment, started))
            });
        }

        function toggleFs() {
            var $el = $content.closest(".dashboard-item-content, .gadget, .ujg-gadget-wrapper");
            if ($el.length === 0) $el = $content;
            state.isFullscreen = !state.isFullscreen;
            if (state.isFullscreen) {
                $el.data("ujg-style", $el.attr("style") || "");
                $el.addClass("ujg-fullscreen");
                $fsBtn.text("Exit");
            } else {
                $el.removeClass("ujg-fullscreen").attr("style", $el.data("ujg-style"));
                $fsBtn.text("Fullscreen");
            }
            API.resize();
        }

        function applyUserSelection() {
            updateUserList();
            updateUrlState();
            updateDebug();
            renderCalendar();
        }

        function updateUserList() {
            if (!$userList) return;
            var query = ($userSearch && $userSearch.val() || "").trim().toLowerCase();
            var entries = getUserDropdownEntries(state.users, state.selectedUsers, query);
            if ($userSelected) {
                $userSelected.empty();
                var selectedEntries = getUserDropdownEntries(state.users, state.selectedUsers, "").filter(function(entry) {
                    return entry.selected;
                });
                if (selectedEntries.length > 0) {
                    $userSelected.append('<div class="ujg-user-dd-selected-title">Выбрано</div>');
                    selectedEntries.forEach(function(entry) {
                        var $chip = $('<button type="button" class="ujg-user-dd-chip" title="Снять выбор"></button>');
                        $chip.text(entry.name + " ×");
                        $chip.on("click", function(e) {
                            e.stopPropagation();
                            state.selectedUsers = state.selectedUsers.filter(function(selectedId) { return selectedId !== entry.id; });
                            applyUserSelection();
                        });
                        $userSelected.append($chip);
                    });
                    $userSelected.show();
                } else {
                    $userSelected.hide();
                }
            }
            $userList.empty();
            entries.forEach(function(entry) {
                var $item = $('<label class="ujg-user-dd-item"></label>');
                if (entry.selected) $item.addClass("ujg-user-dd-item-selected");
                var checked = entry.selected;
                var $check = $('<input type="checkbox">').prop("checked", checked);
                $check.on("change", function() {
                    if ($(this).is(":checked")) {
                        if (state.selectedUsers.indexOf(entry.id) < 0) state.selectedUsers.push(entry.id);
                    } else {
                        state.selectedUsers = state.selectedUsers.filter(function(selectedId) { return selectedId !== entry.id; });
                    }
                    applyUserSelection();
                });
                $item.append($check, $('<span></span>').text(entry.name));
                $userList.append($item);
            });
            if ($userList.children().length === 0) $userList.append('<div class="ujg-user-dd-empty">Ничего не найдено</div>');
            updateUserSelectLabel();
        }
        
        function updateUserSelectLabel() {
            var count = state.selectedUsers.length;
            var total = Object.keys(state.users).length;
            var label = count === 0 ? "Все (" + total + ")" : count + " из " + total;
            if ($userBtn) {
                $userBtn.text(label);
                var names = state.selectedUsers.map(function(id) { return state.users[id] || id; }).filter(Boolean);
                $userBtn.attr("title", names.length ? names.join(", ") : "Все пользователи");
            }
        }
        
        function updateGroupSelect() {
            var groups = loadGroups();
            var names = Object.keys(groups).sort();
            
            $groupSelect.empty();
            $groupSelect.append('<option value="">-- Группы --</option>');
            names.forEach(function(name) {
                $groupSelect.append('<option value="' + utils.escapeHtml(name) + '">' + utils.escapeHtml(name) + ' (' + groups[name].length + ')</option>');
            });
        }

        // Группирует недели из дней
        function groupWeeks(days) {
            var weeks = [];
            var currentWeek = null;
            var firstDay = days[0];
            var startDow = utils.getDayOfWeek(firstDay);
            
            if (startDow > 0) {
                currentWeek = [];
                for (var i = 0; i < startDow; i++) currentWeek.push(null);
            }
            
            days.forEach(function(day) {
                var dow = utils.getDayOfWeek(day);
                if (dow === 0 || !currentWeek) {
                    if (currentWeek) weeks.push(currentWeek);
                    currentWeek = [];
                }
                currentWeek.push(day);
            });
            
            if (currentWeek) {
                while (currentWeek.length < 7) currentWeek.push(null);
                weeks.push(currentWeek);
            }
            
            return weeks;
        }
        
        // Сокращает статус до 5 символов
        function shortStatus(status) {
            if (!status) return "";
            var s = status.trim();
            if (s.length <= 5) return s;
            return s.substring(0, 5);
        }

        function closeMassWorklogDialog() {
            $content.find(".ujg-mass-worklog-overlay").remove();
        }

        function renderMassWorklogPreview($dialog, template) {
            var seconds = parseWorklogSeconds($dialog.find(".ujg-mass-seconds").val());
            var plan = buildMassWorklogPlan({
                issueKey: template.issueKey,
                seconds: seconds,
                currentUserId: currentUserId(),
                startDate: $dialog.find(".ujg-mass-start").val(),
                endDate: $dialog.find(".ujg-mass-end").val(),
                comment: $dialog.find(".ujg-mass-comment").val(),
                calendarData: state.calendarData
            });
            var $preview = $dialog.find(".ujg-mass-preview");
            var actionCount = plan.dates.length + plan.updateWorklogs.length;
            var totalHours = utils.formatTime(plan.dates.length * plan.seconds) || "0";
            var html = '<div class="ujg-mass-summary">Будет создано: <strong>' + plan.dates.length + '</strong> дн. × ' +
                (utils.formatTime(plan.seconds) || "0") + ' = <strong>' + totalHours + '</strong></div>';

            if (!currentUserId()) {
                html += '<div class="ujg-mass-warning">Не удалось определить текущего пользователя. Списание будет создано от вашей Jira-сессии, но существующие записи могут быть распознаны не полностью.</div>';
            }
            if (seconds <= 0) {
                html += '<div class="ujg-mass-warning">Укажите часы списания.</div>';
            }

            if (plan.dates.length > 0) {
                html += '<div class="ujg-mass-days">';
                plan.dates.forEach(function(dayKey) {
                    html += '<label class="ujg-mass-day"><input type="checkbox" checked data-day="' + escapeAttr(dayKey) + '"> ' + escapeAttr(dayKey) + '</label>';
                });
                html += '</div>';
            } else {
                html += '<div class="ujg-mass-empty">Нет рабочих дней для списания</div>';
            }

            if (plan.updateWorklogs.length > 0) {
                html += '<div class="ujg-mass-update-title">Обновить комментарий в существующих списаниях:</div>';
                html += '<div class="ujg-mass-days">';
                plan.updateWorklogs.forEach(function(item) {
                    html += '<label class="ujg-mass-day"><input type="checkbox" checked data-action="update" data-day="' + escapeAttr(item.dayKey) +
                        '" data-worklog-id="' + escapeAttr(item.worklogId) + '" data-started="' + escapeAttr(item.started) +
                        '" data-seconds="' + escapeAttr(item.seconds) + '"> ' + escapeAttr(item.dayKey) + '</label>';
                });
                html += '</div>';
            }

            if (plan.skipDates.length > 0) {
                html += '<div class="ujg-mass-skips">Без изменений: ' + plan.skipDates.map(escapeAttr).join(", ") + '</div>';
            }

            $preview.html(html);
            $dialog.data("massPlan", plan);
            $dialog.find(".ujg-mass-submit").prop("disabled", actionCount === 0 || plan.seconds <= 0);
        }

        function runMassWorklog($dialog, template) {
            var plan = $dialog.data("massPlan") || {};
            var comment = $dialog.find(".ujg-mass-comment").val();
            var operations = [];
            $dialog.find(".ujg-mass-day input:checked").each(function() {
                var $input = $(this);
                if ($input.data("action") === "update") {
                    operations.push({
                        type: "update",
                        dayKey: String($input.attr("data-day") || ""),
                        worklogId: String($input.attr("data-worklog-id") || ""),
                        started: String($input.attr("data-started") || ""),
                        seconds: parseInt($input.attr("data-seconds"), 10) || plan.seconds
                    });
                } else {
                    operations.push({
                        type: "create",
                        dayKey: String($input.attr("data-day") || ""),
                        seconds: plan.seconds
                    });
                }
            });
            if (operations.length === 0) {
                alert("Выберите хотя бы один день");
                return;
            }

            $dialog.find("input, textarea, button").prop("disabled", true);
            var $bar = $dialog.find(".ujg-mass-progress-bar");
            var $text = $dialog.find(".ujg-mass-progress-text");
            var created = 0;
            var failed = 0;

            function updateProgress(done) {
                var pct = operations.length ? Math.round(done / operations.length * 100) : 0;
                $bar.css("width", pct + "%");
                $text.text("Списание: " + done + "/" + operations.length);
                $progress.text("Списание: " + done + "/" + operations.length).show();
            }

            function finish() {
                $progress.text("Списание завершено: " + created + "/" + operations.length + (failed ? ", ошибок: " + failed : ""));
                closeMassWorklogDialog();
                startLoading();
            }

            function next(idx) {
                if (idx >= operations.length) {
                    finish();
                    return;
                }
                var op = operations[idx];
                var request = op.type === "update"
                    ? updateWorklog(template.issueKey, op.worklogId, op.dayKey, op.seconds, comment, op.started)
                    : createWorklog(template.issueKey, op.dayKey, op.seconds, comment);
                request.then(function() {
                    created++;
                    updateProgress(idx + 1);
                    next(idx + 1);
                }, function() {
                    failed++;
                    updateProgress(idx + 1);
                    next(idx + 1);
                });
            }

            updateProgress(0);
            next(0);
        }

        function openMassWorklogDialog(template) {
            closeMassWorklogDialog();
            var currentUserRequest = loadCurrentUser();

            var issue = findIssueInDay(template.dayKey, template.issueKey) || {};
            if (!issue.summary && template.summary) issue.summary = template.summary;
            var $overlay = $('<div class="ujg-mass-worklog-overlay"></div>');
            var $dialog = $('<div class="ujg-mass-worklog-dialog" role="dialog" aria-modal="true"></div>');
            var issueUrl = baseUrl + "/browse/" + encodeURIComponent(template.issueKey);
            var initialSeconds = template.seconds || DEFAULT_MASS_WORKLOG_SECONDS;

            $dialog.append(
                '<div class="ujg-mass-head">' +
                    '<div><div class="ujg-mass-title">Массовое списание</div>' +
                    '<div class="ujg-mass-subtitle"><a href="' + issueUrl + '" target="_blank">' + escapeAttr(template.issueKey) + '</a> · ' +
                    (utils.formatTime(initialSeconds) || "0") + '</div></div>' +
                    '<button type="button" class="aui-button aui-button-link ujg-mass-close" title="Закрыть">×</button>' +
                '</div>'
            );
            if (issue.summary) {
                $dialog.append('<div class="ujg-mass-issue-summary">' + utils.escapeHtml(issue.summary) + '</div>');
            }
            $dialog.append(
                '<div class="ujg-mass-fields">' +
                    '<label>С <input type="date" class="ujg-range-input ujg-mass-start" value="' + escapeAttr(template.dayKey) + '"></label>' +
                    '<label>По <input type="date" class="ujg-range-input ujg-mass-end" value="' + escapeAttr(template.dayKey) + '"></label>' +
                    '<label>Часы <input type="text" class="ujg-range-input ujg-mass-seconds" value="' + escapeAttr(utils.formatTime(initialSeconds) || "8h") + '"></label>' +
                '</div>' +
                '<div class="ujg-mass-comment-row">' +
                    '<label>Комментарий</label>' +
                    '<textarea class="ujg-mass-comment" rows="3" placeholder="Можно оставить пустым"></textarea>' +
                '</div>' +
                '<div class="ujg-mass-preview"></div>' +
                '<div class="ujg-mass-progress"><div class="ujg-mass-progress-bar"></div></div>' +
                '<div class="ujg-mass-progress-text"></div>' +
                '<div class="ujg-mass-actions">' +
                    '<button type="button" class="aui-button ujg-mass-cancel">Отмена</button>' +
                    '<button type="button" class="aui-button aui-button-primary ujg-mass-submit">Списать</button>' +
                '</div>'
            );

            $overlay.append($dialog);
            $content.append($overlay);

            function refresh() {
                renderMassWorklogPreview($dialog, template);
                API.resize();
            }

            $dialog.find(".ujg-mass-close, .ujg-mass-cancel").on("click", closeMassWorklogDialog);
            $dialog.find(".ujg-mass-start, .ujg-mass-end, .ujg-mass-seconds, .ujg-mass-comment").on("change input", refresh);
            $dialog.find(".ujg-mass-submit").on("click", function() {
                runMassWorklog($dialog, template);
            });
            $overlay.on("click", function(e) {
                if (e.target === $overlay[0]) closeMassWorklogDialog();
            });

            refresh();
            if (currentUserRequest && typeof currentUserRequest.then === "function") {
                currentUserRequest.then(refresh, refresh);
            }
        }
        
        function renderWeekSummaryCell(summary, transitions, groupSummary, weekDays) {
            var isOk = groupSummary ? (summary.utilization >= 100) : (summary.totalSeconds >= summary.expectedSeconds);
            var cls = isOk ? "ujg-sum-ok" : "ujg-sum-deficit";

            var html = '<div class="ujg-summary-cell">';
            if (summary.totalSeconds === 0 && (!groupSummary ? summary.expectedSeconds === 0 : (summary.activeUserCount || 0) === 0)) {
                html += '</div>';
                return html;
            }

            html += '<div class="ujg-sum-hours ' + cls + '">';
            html += formatSummaryHeadline(summary, groupSummary);
            html += '</div>';

            var projKeys = Object.keys(summary.projects).sort(function(a, b) {
                return summary.projects[b] - summary.projects[a];
            });
            if (projKeys.length > 0) {
                html += '<div class="ujg-sum-section">';
                projKeys.forEach(function(proj) {
                    html += '<div class="ujg-sum-proj"><span class="ujg-sum-proj-name">' + utils.escapeHtml(proj) + '</span> <span class="ujg-sum-proj-time">' + utils.formatTime(summary.projects[proj]) + '</span></div>';
                });
                html += '</div>';
            }

            var types = Object.keys(summary.issueTypes).sort(function(a, b) {
                return summary.issueTypes[b] - summary.issueTypes[a];
            });
            if (types.length > 0) {
                html += '<div class="ujg-sum-section ujg-sum-types-wrap">';
                types.forEach(function(type) {
                    html += '<span class="ujg-sum-type-badge">' + utils.escapeHtml(type) + '&nbsp;&times;' + summary.issueTypes[type] + '</span>';
                });
                html += '</div>';
            }

            if (transitions && transitions.length > 0) {
                html += '<div class="ujg-sum-section ujg-sum-transitions">';
                transitions.forEach(function(t) {
                    var template = buildTransitionMassWorklogTemplate(t, weekDays);
                    var linkTitle = t.key + (t.summary ? ": " + t.summary : "");
                    html += '<div class="ujg-sum-tr">';
                    html += '<a href="' + baseUrl + '/browse/' + t.key + '" target="_blank" class="ujg-sum-tr-key ujg-transition-worklog-template" title="' + escapeAttr(linkTitle) +
                        '" data-issue-key="' + escapeAttr(template.issueKey) + '" data-day="' + escapeAttr(template.dayKey) +
                        '" data-seconds="' + escapeAttr(template.seconds) + '" data-summary="' + escapeAttr(template.summary) + '">' + utils.escapeHtml(t.key) + '</a> ';
                    html += '<span class="ujg-sum-tr-changes">' + utils.escapeHtml(t.changes.join(', ')) + '</span>';
                    html += '</div>';
                });
                html += '</div>';
            }

            html += '</div>';
            return html;
        }

        function renderMonthSummaryRow(month, year, summary, groupSummary) {
            var title = MONTH_NAMES[month] + ' ' + year;
            var pct = summary.utilization || 0;
            var isOk = groupSummary ? pct >= 100 : summary.totalSeconds >= summary.expectedSeconds;

            var html = '<div class="ujg-month-summary" style="grid-column:1/-1">';
            html += '<div class="ujg-ms-header">';
            html += '<span class="ujg-ms-title">' + title + '</span>';
            html += '<span class="ujg-ms-hours ' + (isOk ? 'ujg-sum-ok' : 'ujg-sum-deficit') + '">' + formatSummaryHeadline(summary, groupSummary) + '</span>';
            html += '</div>';

            html += '<div class="ujg-ms-body">';

            var projKeys = Object.keys(summary.projects).sort(function(a, b) {
                return summary.projects[b] - summary.projects[a];
            });
            if (projKeys.length > 0) {
                html += '<div class="ujg-ms-section">';
                projKeys.forEach(function(proj) {
                    var ppct = (summary.projectPcts && summary.projectPcts[proj]) || 0;
                    html += '<span class="ujg-ms-proj">' + utils.escapeHtml(proj) + ' ' + utils.formatTime(summary.projects[proj]) + ' (' + ppct + '%)</span>';
                });
                html += '</div>';
            }

            var types = Object.keys(summary.issueTypes).sort(function(a, b) {
                return summary.issueTypes[b] - summary.issueTypes[a];
            });
            if (types.length > 0) {
                html += '<div class="ujg-ms-section">';
                types.forEach(function(type) {
                    html += '<span class="ujg-sum-type-badge">' + utils.escapeHtml(type) + '&nbsp;&times;' + summary.issueTypes[type] + '</span>';
                });
                html += '</div>';
            }

            html += '<div class="ujg-ms-meta">Задач: ' + summary.taskCount + ' &middot; Дней: ' + summary.daysWorked + '/' + summary.workDays + '</div>';
            html += '</div></div>';
            return html;
        }

        // Рендер одного календаря (userId = null для всех)
        function renderSingleCalendar(userId, calendarId) {
            var days = state.days;
            var calendarData = state.calendarData;
            var weeks = groupWeeks(days);
            var userFilter = userId ? [userId] : state.selectedUsers;
            var showAuthors = !userId && state.selectedUsers.length !== 1;
            
            // Суммы по дням недели
            var weekdayTotals = [0, 0, 0, 0, 0, 0, 0];
            days.forEach(function(day) {
                var dayKey = utils.getDayKey(day);
                var dayData = filterDayDataByUsers(calendarData[dayKey] || [], userFilter);
                var dow = utils.getDayOfWeek(day);
                dayData.forEach(function(item) {
                    weekdayTotals[dow] += item.seconds || 0;
                });
            });
            
            var hasWeekendData = weekdayTotals[5] > 0 || weekdayTotals[6] > 0;

            // Collect days per month + detect last week for each month
            var monthMap = {};
            days.forEach(function(day) {
                var mk = day.getFullYear() + "-" + day.getMonth();
                if (!monthMap[mk]) monthMap[mk] = { days: [], year: day.getFullYear(), month: day.getMonth() };
                monthMap[mk].days.push(day);
            });
            var monthLastWeek = {};
            weeks.forEach(function(week, wi) {
                week.forEach(function(day) {
                    if (day) monthLastWeek[day.getFullYear() + "-" + day.getMonth()] = wi;
                });
            });

            var html = '<div class="ujg-calendar' + (hasWeekendData ? '' : ' ujg-hide-weekends') + '" data-calendar-id="' + calendarId + '">';
            
            if (userId) {
                html += '<div class="ujg-calendar-title">' + utils.escapeHtml(state.users[userId] || userId) + '</div>';
            }
            
            // Шапка с днями недели + Σ
            html += '<div class="ujg-calendar-header">';
            WEEKDAYS.forEach(function(wd, idx) {
                var wdTotal = weekdayTotals[idx];
                var isWeekend = idx >= 5;
                var cls = isWeekend ? "ujg-weekend" : "";
                if (isWeekend && !hasWeekendData) cls += " ujg-hidden";
                html += '<div class="ujg-calendar-header-cell ' + cls + '" data-weekday="' + idx + '">';
                html += '<div class="ujg-header-day">' + wd + '</div>';
                if (wdTotal > 0) {
                    html += '<div class="ujg-header-total">' + utils.formatTime(wdTotal) + '</div>';
                }
                html += '</div>';
            });
            html += '<div class="ujg-calendar-header-cell ujg-summary-header-cell">Σ</div>';
            html += '</div>';
            
            var totalAll = 0;
            
            // Строки недель
            weeks.forEach(function(week, weekIdx) {
                html += '<div class="ujg-calendar-week">';
                week.forEach(function(day, idx) {
                    var isWeekend = idx >= 5;
                    var hiddenClass = (isWeekend && !hasWeekendData) ? " ujg-hidden" : "";
                    
                    if (!day) {
                        html += '<div class="ujg-calendar-cell ujg-calendar-empty ' + (isWeekend ? "ujg-weekend" : "") + hiddenClass + '"></div>';
                        return;
                    }
                    
                    var dayKey = utils.getDayKey(day);
                    var dayData = filterDayDataByUsers(calendarData[dayKey] || [], userFilter);
                    
                    var dayTotal = 0;
                    dayData.forEach(function(item) { dayTotal += item.seconds || 0; });
                    totalAll += dayTotal;
                    
                    var cellClass = "ujg-calendar-cell";
                    if (isWeekend) cellClass += " ujg-weekend";
                    if (dayData.length > 0) cellClass += " ujg-has-data";
                    cellClass += hiddenClass;
                    
                    html += '<div class="' + cellClass + '" data-day="' + dayKey + '" title="' + utils.escapeHtml(utils.formatDate(day)) + '">';
                    html += '<div class="ujg-cell-header">';
                    html += '<span class="ujg-cell-date">' + utils.formatDateShort(day) + '</span>';
                    if (dayTotal > 0) {
                        html += '<span class="ujg-cell-total">' + utils.formatTime(dayTotal) + '</span>';
                    }
                    html += '</div>';
                    
                    if (dayData.length > 0) {
                        html += '<div class="ujg-cell-issues">';
                        dayData.forEach(function(item) {
                            var isDone = item.status && DONE_STATUSES.indexOf(item.status.toLowerCase()) >= 0;
                            html += '<div class="ujg-cell-issue ujg-worklog-template" data-issue-key="' + escapeAttr(item.key) + '" data-day="' + escapeAttr(dayKey) + '" data-seconds="' + escapeAttr(item.seconds || 0) + '" title="Правая кнопка: массовое списание по шаблону">';
                            html += '<div class="ujg-issue-header">';
                            html += '<a href="' + baseUrl + '/browse/' + item.key + '" target="_blank" class="ujg-issue-link' + (isDone ? ' ujg-link-done' : '') + '">' + item.key + '</a>';
                            html += '<span class="ujg-issue-time">' + (utils.formatTime(item.seconds) || "") + '</span>';
                            if (item.status) {
                                var statusClass = isDone ? "ujg-status-done" : "ujg-status-open";
                                html += '<span class="ujg-issue-status ' + statusClass + '">' + utils.escapeHtml(shortStatus(item.status)) + '</span>';
                            }
                            if (item.estimate) html += '<span class="ujg-issue-est">[' + utils.formatTime(item.estimate) + ']</span>';
                            html += '</div>';
                            if (item.summary) html += '<div class="ujg-issue-summary">' + utils.escapeHtml(item.summary) + '</div>';
                            if (item.worklogs && item.worklogs.length > 1) {
                                html += '<div class="ujg-worklogs">';
                                item.worklogs.forEach(function(wl) {
                                    html += '<div class="ujg-worklog-entry">';
                                    html += '<span class="ujg-wl-author">' + utils.escapeHtml(wl.authorName || wl.authorId || "") + '</span>';
                                    html += '<span class="ujg-wl-time">' + (utils.formatTime(wl.seconds) || "") + '</span>';
                                    if (state.showComments && wl.comment) {
                                        html += '<span class="ujg-wl-comment">' + utils.escapeHtml(wl.comment.substring(0, 60)) + '</span>';
                                    }
                                    html += '</div>';
                                });
                                html += '</div>';
                            } else if (showAuthors && item.authors) {
                                var names = Object.keys(item.authors).map(function(k) { return item.authors[k]; });
                                if (names.length > 0) html += '<div class="ujg-issue-author">' + utils.escapeHtml(names.join(", ")) + '</div>';
                            }
                            if ((!item.worklogs || item.worklogs.length <= 1) && state.showComments && item.comments && item.comments.length > 0) {
                                html += '<div class="ujg-issue-comment">' + utils.escapeHtml(item.comments[0].substring(0, 80)) + '</div>';
                            }
                            html += '</div>';
                        });
                        html += '</div>';
                    }
                    
                    html += '</div>';
                });

                // Summary cell for this week
                var groupSummaryMode = !userId;
                var wSummary = computeWeekSummary(week, userFilter, calendarData, { groupSummary: groupSummaryMode });
                var transitions = state.showDetails ? getWeekTransitions(week, wSummary.tasks, state.changelogData) : null;
                html += renderWeekSummaryCell(wSummary, transitions, groupSummaryMode, week);

                html += '</div>';

                // Month summary after last week of each month
                Object.keys(monthLastWeek).forEach(function(mk) {
                    if (monthLastWeek[mk] === weekIdx) {
                        var mData = monthMap[mk];
                        if (mData && mData.days.length > 0) {
                            var mSummary = computeMonthSummary(mData.days, userFilter, calendarData, { groupSummary: groupSummaryMode });
                            html += renderMonthSummaryRow(mData.month, mData.year, mSummary, groupSummaryMode);
                        }
                    }
                });
            });
            
            html += '</div>';
            html += '<div class="ujg-calendar-footer">Всего: <strong>' + (utils.formatTime(totalAll) || "0") + '</strong></div>';
            
            return html;
        }

        function renderCalendar() {
            var days = state.days;
            if (!days || days.length === 0) {
                $cont.html('<div class="ujg-message ujg-message-info">Укажите диапазон дат и нажмите "Загрузить"</div>');
                API.resize();
                return;
            }
            
            var calHtml = '';
            
            if (state.separateCalendars) {
                var calendarUsers = getCalendarUserIds(state.users, state.selectedUsers);
                if (calendarUsers.length > 0) {
                    calHtml += '<div class="ujg-calendars-container">';
                    calendarUsers.forEach(function(userId, idx) {
                        calHtml += renderSingleCalendar(userId, 'cal-' + idx);
                    });
                    calHtml += '</div>';
                } else {
                    calHtml = renderSingleCalendar(null, 'cal-main');
                }
            } else {
                calHtml = renderSingleCalendar(null, 'cal-main');
            }

            var html = calHtml;

            $cont.html(html);
            $cont.find(".ujg-worklog-template").on("contextmenu", function(e) {
                e.preventDefault();
                var $issue = $(this);
                openMassWorklogDialog({
                    issueKey: String($issue.data("issue-key") || ""),
                    dayKey: String($issue.data("day") || ""),
                    seconds: parseInt($issue.data("seconds"), 10) || 0
                });
            });
            $cont.find(".ujg-transition-worklog-template").on("contextmenu", function(e) {
                e.preventDefault();
                var $issue = $(this);
                openMassWorklogDialog({
                    issueKey: String($issue.attr("data-issue-key") || ""),
                    dayKey: String($issue.attr("data-day") || ""),
                    seconds: parseInt($issue.attr("data-seconds"), 10) || DEFAULT_MASS_WORKLOG_SECONDS,
                    summary: String($issue.attr("data-summary") || "")
                });
            });

            API.resize();
        }
        
        function updateCellContent(dayKey) {
            // При прогрессивной загрузке просто перерисуем весь календарь
            // (для множественных календарей проще так)
            renderCalendar();
        }
        
        function updateHeaderTotals() {
            // Вызывается при изменении данных - перерисовываем
            renderCalendar();
        }

        function loadDaySequentially(index, loadContext) {
            if (!isTimesheetLoadCurrent(state, loadContext)) return;
            if (index >= loadContext.days.length) {
                state.loading = false;
                $progress.hide();
                updateDebug();
                API.resize();
                return;
            }
            
            var day = loadContext.days[index];
            var dayKey = utils.getDayKey(day);
            
            state.loadedDays = index + 1;
            $progress.text("Загрузка: " + state.loadedDays + "/" + state.totalDays);
            updateDebug();
            
            Common.loadDayData(day, loadContext.jqlFilter, null).then(function(result) {
                if (!isTimesheetLoadCurrent(state, loadContext)) return;
                if (result.issues && result.issues.length > 0) {
                    state.calendarData[dayKey] = result.issues;
                    // Собираем пользователей
                    result.issues.forEach(function(item) {
                        if (item.authors) {
                            Object.keys(item.authors).forEach(function(uid) {
                                if (!state.users[uid]) state.users[uid] = item.authors[uid];
                            });
                        }
                    });
                    updateCellContent(dayKey);
                    updateUserList();
                }
                // Загружаем следующий день
                loadDaySequentially(index + 1, loadContext);
            }, function() {
                if (isTimesheetLoadCurrent(state, loadContext)) {
                    loadDaySequentially(index + 1, loadContext);
                }
            });
        }

        function fetchChangelogs() {
            var allKeys = {};
            Object.keys(state.calendarData).forEach(function(dayKey) {
                (state.calendarData[dayKey] || []).forEach(function(item) {
                    if (item.key) allKeys[item.key] = true;
                });
            });
            var keys = Object.keys(allKeys);
            if (keys.length === 0) return;

            state.changelogLoading = true;
            state.changelogData = {};
            var done = 0;
            var total = keys.length;

            function fetchNext(idx) {
                if (idx >= keys.length) {
                    state.changelogLoading = false;
                    $progress.hide();
                    renderCalendar();
                    return;
                }
                $.ajax({
                    url: baseUrl + "/rest/api/2/issue/" + keys[idx] + "?expand=changelog&fields=summary",
                    type: "GET",
                    success: function(r) {
                        if (r && r.changelog && r.changelog.histories) {
                            var transitions = [];
                            r.changelog.histories.forEach(function(h) {
                                (h.items || []).forEach(function(item) {
                                    if (item.field === "status") {
                                        transitions.push({
                                            date: h.created,
                                            from: item.fromString || "",
                                            to: item.toString || "",
                                            author: h.author && h.author.displayName || ""
                                        });
                                    }
                                });
                            });
                            state.changelogData[keys[idx]] = {
                                summary: r.fields && r.fields.summary || "",
                                transitions: transitions
                            };
                        }
                        done++;
                        $progress.text("Changelog: " + done + "/" + total).show();
                        fetchNext(idx + 1);
                    },
                    error: function() {
                        done++;
                        fetchNext(idx + 1);
                    }
                });
            }

            $progress.text("Changelog: 0/" + total).show();
            fetchNext(0);
        }

        function startLoading() {
            var s = new Date(state.rangeStart), e = new Date(state.rangeEnd);
            if (isNaN(s.getTime()) || isNaN(e.getTime())) {
                $cont.html('<div class="ujg-message ujg-message-info">Укажите корректные даты</div>');
                return;
            }
            if (s > e) { var t = s; s = e; e = t; }
            
            state.days = Common.daysBetween(s, e);
            var loadContext = beginTimesheetLoad(state, state.days, CONFIG.jqlFilter);
            state.calendarData = {};
            state.users = {};
            state.totalDays = loadContext.days.length;
            state.loadedDays = 0;
            state.loading = true;
            state.lastError = "";
            
            log("Начало загрузки: " + state.rangeStart + " - " + state.rangeEnd + " (" + state.totalDays + " дней)");
            
            // Сразу показываем пустой календарь
            renderCalendar();
            $progress.text("Загрузка: 0/" + state.totalDays).show();
            updateDebug();
            
            // Начинаем последовательную загрузку
            loadDaySequentially(0, loadContext);
        }

        function llmConfig() {
            return readTimesheetLlmConfig(localStorage, LlmClient);
        }

        function loadAvailableProjectKeys() {
            var fallbackProjects = collectProjectKeys(state.calendarData);
            if (state.availableProjectKeys) {
                return Promise.resolve(mergeProjectKeys(state.availableProjectKeys, fallbackProjects));
            }
            if (state.availableProjectKeysPromise) return state.availableProjectKeysPromise;
            state.availableProjectKeysPromise = fetchAvailableProjectKeys(
                function(options) { return $.ajax(options); },
                baseUrl + "/rest/api/2/project",
                fallbackProjects
            ).then(function(projects) {
                state.availableProjectKeys = projects;
                state.availableProjectKeysPromise = null;
                return projects;
            });
            return state.availableProjectKeysPromise;
        }

        function openLlmSettingsDialog(onSaved) {
            var existing = llmConfig() || {};
            var $overlay = $('<div class="ujg-llm-overlay"></div>');
            var $dialog = $('<div class="ujg-llm-dialog"></div>');
            var $apiBase = $('<input type="text" class="ujg-llm-input" placeholder="https://host/v1">').val(existing.apiBase || "");
            var $model = $('<input type="text" class="ujg-llm-input" placeholder="model">').val(existing.model || "");
            var $apiKey = $('<input type="password" class="ujg-llm-input" placeholder="API key">').val(existing.apiKey || "");
            var $basePrompt = $('<textarea class="ujg-llm-textarea" rows="3" placeholder="Общий системный контекст"></textarea>').val(existing.basePrompt || "");
            var $legacy = $('<label class="ujg-llm-check"><input type="checkbox"><span>Legacy /completions</span></label>');
            var $error = $('<div class="ujg-llm-error"></div>').hide();
            $legacy.find("input").prop("checked", !!existing.useLegacyCompletionsEndpoint);
            $dialog.append(
                $('<div class="ujg-llm-head"><div><div class="ujg-llm-title">Настройки LLM</div><div class="ujg-llm-subtitle">Настройки общие для всех дашбордов</div></div></div>'),
                $('<label class="ujg-llm-field"><span>API base</span></label>').append($apiBase),
                $('<label class="ujg-llm-field"><span>Модель</span></label>').append($model),
                $('<label class="ujg-llm-field"><span>API key</span></label>').append($apiKey),
                $('<label class="ujg-llm-field"><span>Базовый промпт</span></label>').append($basePrompt),
                $legacy,
                $error
            );
            var $actions = $('<div class="ujg-llm-actions"></div>');
            var $cancel = $('<button type="button" class="aui-button">Отмена</button>');
            var $save = $('<button type="button" class="aui-button aui-button-primary">Сохранить</button>');
            $cancel.on("click", function() { $overlay.remove(); });
            $save.on("click", function() {
                if (!LlmClient || typeof LlmClient.writeStoredConfig !== "function") {
                    $error.text("LLM-клиент не загружен").show();
                    return;
                }
                var cfg = LlmClient.writeStoredConfig(localStorage, {
                    apiBase: $apiBase.val(),
                    model: $model.val(),
                    apiKey: $apiKey.val(),
                    basePrompt: $basePrompt.val(),
                    useLegacyCompletionsEndpoint: $legacy.find("input").is(":checked")
                }, LLM_CONFIG_STORAGE_KEY);
                if (!cfg) {
                    $error.text("Заполните API base, модель и ключ").show();
                    return;
                }
                $overlay.remove();
                if (typeof onSaved === "function") onSaved(cfg);
            });
            $actions.append($cancel, $save);
            $dialog.append($actions);
            $overlay.append($dialog);
            $("body").append($overlay);
            $apiBase.trigger("focus");
        }

        function openJqlLlmDialog($jqlInput, config) {
            var cfg = config || llmConfig();
            if (!cfg) {
                openLlmSettingsDialog(function(savedCfg) {
                    openJqlLlmDialog($jqlInput, savedCfg);
                });
                return;
            }
            var projects = collectProjectKeys(state.calendarData);
            var projectsLoading = true;
            var $overlay = $('<div class="ujg-llm-overlay"></div>');
            var $dialog = $('<div class="ujg-llm-dialog ujg-llm-dialog-wide"></div>');
            var $current = $('<textarea class="ujg-llm-textarea ujg-llm-jql-current" rows="3"></textarea>').val($jqlInput.val());
            var $system = $('<textarea class="ujg-llm-textarea" rows="4"></textarea>').val((cfg.basePrompt ? cfg.basePrompt + "\n\n" : "") + "Ты помогаешь составить Jira JQL. Верни только JQL без markdown и пояснений.");
            var $prompt = $('<textarea class="ujg-llm-textarea" rows="5" placeholder="Например: покажи задачи EVOSCADA без закрытых за последние 30 дней"></textarea>');
            var $result = $('<textarea class="ujg-llm-textarea ujg-llm-result" rows="4" placeholder="Здесь появится JQL"></textarea>');
            var $error = $('<div class="ujg-llm-error"></div>').hide();
            var $projects = $('<div class="ujg-llm-projects"></div>').text("Проекты: загрузка...");
            $dialog.append(
                $('<div class="ujg-llm-head"><div><div class="ujg-llm-title">JQL через LLM</div><div class="ujg-llm-subtitle">Результат будет вставлен в строку. Загрузка начнется только после Применить.</div></div></div>'),
                $projects,
                $('<label class="ujg-llm-field"><span>Текущий JQL</span></label>').append($current),
                $('<label class="ujg-llm-field"><span>Системный промпт</span></label>').append($system),
                $('<label class="ujg-llm-field"><span>Что изменить</span></label>').append($prompt),
                $('<label class="ujg-llm-field"><span>Результат</span></label>').append($result),
                $error
            );
            var $actions = $('<div class="ujg-llm-actions"></div>');
            var $settings = $('<button type="button" class="aui-button">Настройки</button>');
            var $cancel = $('<button type="button" class="aui-button">Отмена</button>');
            var $generate = $('<button type="button" class="aui-button">Сгенерировать</button>');
            var $use = $('<button type="button" class="aui-button aui-button-primary">Вставить</button>');
            $generate.prop("disabled", true);
            $settings.on("click", function() {
                openLlmSettingsDialog(function(savedCfg) {
                    cfg = savedCfg;
                });
            });
            $cancel.on("click", function() { $overlay.remove(); });
            $generate.on("click", function() {
                if (projectsLoading) return;
                if (!LlmClient || typeof LlmClient.requestText !== "function") {
                    $error.text("LLM-клиент не загружен").show();
                    return;
                }
                $error.hide();
                $generate.prop("disabled", true).text("Генерация...");
                LlmClient.requestText(cfg, buildJqlLlmRequest({
                    currentJql: $current.val(),
                    systemPrompt: $system.val(),
                    userPrompt: $prompt.val(),
                    projects: projects
                })).then(function(result) {
                    $result.val(cleanGeneratedJql(result && result.text || ""));
                }, function(err) {
                    $error.text(err && err.message ? err.message : "Ошибка LLM").show();
                }).then(function() {
                    $generate.prop("disabled", false).text("Сгенерировать");
                });
            });
            $use.on("click", function() {
                var next = cleanGeneratedJql($result.val());
                if (!next) {
                    $error.text("Нет JQL для вставки").show();
                    return;
                }
                $jqlInput.val(next).trigger("focus");
                $overlay.remove();
            });
            $actions.append($settings, $cancel, $generate, $use);
            $dialog.append($actions);
            $overlay.append($dialog);
            $("body").append($overlay);
            $prompt.trigger("focus");
            loadAvailableProjectKeys().then(function(availableProjects) {
                projects = availableProjects;
                projectsLoading = false;
                $projects.text("Проекты: " + (projects.length ? projects.join(", ") : "нет доступных проектов"));
                $generate.prop("disabled", false);
            });
        }

        function updateDebug() {
            if (!CONFIG.debug || !$debugText) return;
            var parts = [];
            parts.push("<b>v" + CONFIG.version + "</b>");
            parts.push("JQL: " + (CONFIG.jqlFilter || "(все)"));
            if (state.rangeStart && state.rangeEnd) parts.push(state.rangeStart + " — " + state.rangeEnd);
            if (state.loading) parts.push("Загрузка " + state.loadedDays + "/" + state.totalDays);
            if (state.selectedUsers.length > 0) {
                var names = state.selectedUsers.map(function(id) { return state.users[id] || id; });
                parts.push("Фильтр: " + names.join(", "));
            }
            if (state.separateCalendars) parts.push("[Отдельные]");
            if (state.lastError) parts.push("<span style='color:red'>" + state.lastError + "</span>");
            $debugText.html(parts.join(" | "));
        }
        
        function updateUrlState() {
            setUrlParams({
                jql: CONFIG.jqlFilter,
                from: state.rangeStart,
                to: state.rangeEnd,
                users: state.selectedUsers.join(","),
                sep: state.separateCalendars ? "1" : ""
            });
        }

        function initPanel() {
            var $p = $('<div class="ujg-control-panel"></div>');
            
            // Приоритет: URL > localStorage > defaults
            var urlParams = getUrlParams();
            var saved = loadSettings();
            var defaultDates = getDefaultDates();
            
            // JQL: URL > last applied value; the active preset remains an unapplied draft.
            var hasUrlJql = Object.prototype.hasOwnProperty.call(urlParams, "jql");
            var hasSavedJql = Object.prototype.hasOwnProperty.call(saved, "jql");
            var initialJql = resolveInitialJqlState({
                urlJql: urlParams.jql,
                hasUrlJql: hasUrlJql,
                savedJql: saved.jql,
                hasSavedJql: hasSavedJql,
                storedPresets: readJqlPresets(hasUrlJql ? urlParams.jql : saved.jql)
            });
            CONFIG.jqlFilter = initialJql.appliedJql;
            state.jqlPresets = initialJql.presets;
            
            // Даты: URL > defaults
            var initStart = urlParams.from || defaultDates.start;
            var initEnd = urlParams.to || defaultDates.end;
            
            // Users: URL (массив через запятую)
            var initUsers = [];
            if (urlParams.users) {
                initUsers = urlParams.users.split(",").filter(function(u) { return u; });
            }
            var initSeparate = urlParams.sep === "1";

            // JQL
            var $jqlRow = $('<div class="ujg-jql-filter"></div>');
            var $jqlInput = $('<input type="text" class="ujg-jql-input" placeholder="project = SDKU">');
            $jqlInput.val(initialJql.inputJql);
            var $jqlPicker = $('<div class="ujg-jql-picker"></div>');
            var $jqlPickBtn = $('<button type="button" class="aui-button ujg-jql-pick-btn" title="Выбрать сохраненный JQL"><span></span><b>▾</b></button>');
            var $jqlMenu = $('<div class="ujg-jql-menu"></div>').hide();
            var $jqlSaveAsBtn = $('<button type="button" class="aui-button ujg-jql-icon-btn" title="Сохранить как новый JQL">+</button>');
            var $jqlLlmBtn = $('<button type="button" class="aui-button ujg-jql-icon-btn" title="JQL через LLM">μ</button>');
            var $jqlBtn = $('<button type="button" class="aui-button aui-button-primary">Применить</button>');

            function activeJqlPresetName() {
                var item = state.jqlPresets.items.filter(function(candidate) {
                    return candidate.id === state.jqlPresets.activeId;
                })[0];
                return item ? item.name : "JQL";
            }

            function renderJqlMenu() {
                $jqlPickBtn.find("span").text(activeJqlPresetName());
                $jqlMenu.empty();
                state.jqlPresets.items.forEach(function(item) {
                    var $row = $('<div class="ujg-jql-menu-item"></div>');
                    if (item.id === state.jqlPresets.activeId) $row.addClass("ujg-jql-menu-item-active");
                    var $text = $('<div class="ujg-jql-menu-text"></div>');
                    $text.append($('<div class="ujg-jql-menu-name"></div>').text(item.name));
                    $text.append($('<div class="ujg-jql-menu-query"></div>').text(item.jql || "(все задачи)"));
                    var $del = $('<button type="button" class="ujg-jql-menu-delete" title="Удалить">×</button>');
                    $row.on("click", function() {
                        var action = planJqlPresetAction(state.jqlPresets, "select", { presetId: item.id });
                        state.jqlPresets = writeJqlPresets(action.presets);
                        $jqlInput.val(action.currentJql);
                        renderJqlMenu();
                        $jqlMenu.hide();
                    });
                    $del.on("click", function(e) {
                        e.preventDefault();
                        e.stopPropagation();
                        state.jqlPresets = writeJqlPresets(deleteJqlPreset(state.jqlPresets, item.id));
                        $jqlInput.val(state.jqlPresets.currentJql);
                        renderJqlMenu();
                    });
                    $row.append($text, $del);
                    $jqlMenu.append($row);
                });
            }

            $jqlPickBtn.on("click", function(e) {
                e.preventDefault();
                e.stopPropagation();
                renderJqlMenu();
                $jqlMenu.toggle();
            });
            $jqlMenu.on("click", function(e) { e.stopPropagation(); });
            $jqlSaveAsBtn.on("click", function() {
                var name = prompt("Название JQL:", makeDefaultJqlName(state.jqlPresets.items.length, $jqlInput.val()));
                if (name == null) return;
                var action = planJqlPresetAction(state.jqlPresets, "saveAs", {
                    name: name,
                    jql: $jqlInput.val()
                });
                state.jqlPresets = writeJqlPresets(action.presets);
                $jqlInput.val(action.currentJql);
                renderJqlMenu();
            });
            $jqlLlmBtn.on("click", function() {
                openJqlLlmDialog($jqlInput);
            });
            $jqlBtn.on("click", function() {
                var action = planJqlPresetAction(state.jqlPresets, "apply", {
                    jql: $jqlInput.val()
                });
                CONFIG.jqlFilter = action.appliedJql;
                state.jqlPresets = writeJqlPresets(action.presets);
                saveSettings({ jql: CONFIG.jqlFilter });
                renderJqlMenu();
                updateUrlState();
                updateDebug();
                if (action.shouldReload) startLoading();
            });
            $jqlPicker.append($jqlPickBtn, $jqlMenu);
            renderJqlMenu();
            $jqlRow.append($('<label>JQL: </label>'), $jqlPicker, $jqlInput, $jqlSaveAsBtn, $jqlLlmBtn, $jqlBtn);
            $p.append($jqlRow);

            // Даты
            var $rangeRow = $('<div class="ujg-range-filter"></div>');
            $rangeStart = $('<input type="date" class="ujg-range-input">');
            $rangeEnd = $('<input type="date" class="ujg-range-input">');
            $rangeStart.val(initStart);
            $rangeEnd.val(initEnd);
            state.rangeStart = initStart;
            state.rangeEnd = initEnd;
            state.selectedUsers = initUsers;
            state.separateCalendars = initSeparate;
            
            var $rangeBtn = $('<button class="aui-button aui-button-primary">Загрузить</button>');
            $rangeBtn.on("click", function() {
                if (state.loading) return;
                state.rangeStart = $rangeStart.val();
                state.rangeEnd = $rangeEnd.val();
                updateUrlState();
                startLoading();
            });
            
            // Кнопка "Копировать ссылку"
            var $copyBtn = $('<button class="aui-button ujg-copy-link" title="Копировать ссылку с фильтрами">🔗</button>');
            $copyBtn.on("click", function() {
                updateUrlState();
                var url = window.location.href;
                if (navigator.clipboard) {
                    navigator.clipboard.writeText(url).then(function() {
                        $copyBtn.text("✓");
                        setTimeout(function() { $copyBtn.text("🔗"); }, 1500);
                    });
                } else {
                    prompt("Скопируйте ссылку:", url);
                }
            });
            
            $progress = $('<span class="ujg-progress"></span>').hide();
            $rangeRow.append($('<label>С: </label>'), $rangeStart, $('<label> По: </label>'), $rangeEnd, $rangeBtn, $copyBtn, $progress);
            $p.append($rangeRow);

            // Контролы - пользователи
            var $row2 = $('<div class="ujg-controls-row"></div>');
            
            // Фильтр пользователей с поиском
            var $userFilter = $('<div class="ujg-user-filter"></div>');
            var $userLabel = $('<label>Кто:</label>');
            $userBtn = $('<button type="button" class="aui-button ujg-user-dd-btn"></button>');
            $userPanel = $('<div class="ujg-user-dd-panel"></div>').hide();
            $userSelected = $('<div class="ujg-user-dd-selected"></div>').hide();
            $userSearch = $('<input type="search" class="ujg-user-dd-search" placeholder="Поиск пользователя">');
            $userList = $('<div class="ujg-user-dd-list"></div>');
            var $userActions = $('<div class="ujg-user-dd-actions"></div>');
            var $allUsersBtn = $('<button type="button" class="aui-button ujg-btn-small">Все</button>');
            var $clearUsersBtn = $('<button type="button" class="aui-button ujg-btn-small" title="Сбросить выбор">Сбросить</button>');
            $userBtn.on("click", function(e) {
                e.stopPropagation();
                $userPanel.toggle();
                if ($userPanel.is(":visible")) $userSearch.trigger("focus");
            });
            $userPanel.on("click", function(e) {
                e.stopPropagation();
            });
            $userSearch.on("input", updateUserList);
            $allUsersBtn.on("click", function() {
                state.selectedUsers = getCalendarUserIds(state.users, []);
                applyUserSelection();
            });
            $clearUsersBtn.on("click", function() {
                state.selectedUsers = [];
                applyUserSelection();
            });
            $userActions.append($allUsersBtn, $clearUsersBtn);
            $userPanel.append($userSelected, $userSearch, $userActions, $userList);
            $userFilter.append($userLabel, $userBtn, $userPanel);
            $(document).on("click.ujgUserDd", function() {
                $userPanel.hide();
            });
            updateUserList();
            
            $row2.append($userFilter);
            
            // Группы пользователей
            var $groupFilter = $('<div class="ujg-group-filter"></div>');
            $groupSelect = $('<select class="ujg-group-select"><option value="">-- Группы --</option></select>');
            $groupSelect.on("change", function() {
                var name = $(this).val();
                if (!name) return;
                var groups = loadGroups();
                if (groups[name]) {
                    state.selectedUsers = groups[name].slice();
                    updateUserList();
                    updateUrlState();
                    updateDebug();
                    renderCalendar();
                }
                $(this).val(""); // Сбрасываем select
            });
            
            // Кнопка сохранения группы
            $groupSaveBtn = $('<button class="aui-button ujg-btn-small" title="Сохранить выбранных как группу">💾</button>');
            $groupSaveBtn.on("click", function() {
                if (state.selectedUsers.length === 0) {
                    alert("Сначала выберите пользователей");
                    return;
                }
                var name = prompt("Название группы:", "");
                if (!name || !name.trim()) return;
                name = name.trim();
                var groups = loadGroups();
                groups[name] = state.selectedUsers.slice();
                saveGroups(groups);
                updateGroupSelect();
                alert("Группа '" + name + "' сохранена (" + state.selectedUsers.length + " чел.)");
            });
            
            // Кнопка удаления группы
            var $groupDelBtn = $('<button class="aui-button ujg-btn-small ujg-btn-danger" title="Удалить группу">🗑</button>');
            $groupDelBtn.on("click", function() {
                var groups = loadGroups();
                var names = Object.keys(groups);
                if (names.length === 0) {
                    alert("Нет сохранённых групп");
                    return;
                }
                var name = prompt("Введите имя группы для удаления:\n" + names.join(", "));
                if (!name || !groups[name]) return;
                if (confirm("Удалить группу '" + name + "'?")) {
                    delete groups[name];
                    saveGroups(groups);
                    updateGroupSelect();
                }
            });
            
            $groupFilter.append($groupSelect, $groupSaveBtn, $groupDelBtn);
            $row2.append($groupFilter);

            $p.append($row2);
            
            // Контролы - чекбоксы
            var $row3 = $('<div class="ujg-controls-row"></div>');
            
            // Галочка "По разработчикам"
            $separateCheck = $('<label class="ujg-control-checkbox"><input type="checkbox"><span>По разработчикам</span></label>');
            $separateCheck.find("input").prop("checked", initSeparate).on("change", function() { 
                state.separateCalendars = $(this).is(":checked"); 
                updateUrlState();
                updateDebug();
                renderCalendar();
            });
            $row3.append($separateCheck);

            var $cmt = $('<label class="ujg-control-checkbox"><input type="checkbox"><span>Комментарии</span></label>');
            $cmt.find("input").on("change", function() { 
                state.showComments = $(this).is(":checked"); 
                renderCalendar();
            });
            $row3.append($cmt);

            var $detailCheck = $('<label class="ujg-control-checkbox"><input type="checkbox"><span>Подробно</span></label>');
            $detailCheck.find("input").on("change", function() {
                state.showDetails = $(this).is(":checked");
                if (state.showDetails && Object.keys(state.changelogData).length === 0 && !state.changelogLoading) {
                    fetchChangelogs();
                } else {
                    renderCalendar();
                }
            });
            $row3.append($detailCheck);

            $fsBtn = $('<button class="aui-button ujg-fullscreen-btn">Fullscreen</button>');
            $fsBtn.on("click", toggleFs);
            $row3.append($fsBtn);

            $p.append($row3);

            // Debug
            $debugBox = $('<div class="ujg-debug-box"></div>');
            $debugText = $('<span class="ujg-debug-text"></span>');
            $debugBox.append($debugText);
            if (!CONFIG.debug) $debugBox.hide();
            $p.append($debugBox);

            $cont.before($p);
            $(document).on("keydown.ujgTs", function(e) { if (e.key === "Escape" && state.isFullscreen) toggleFs(); });
            $(document).on("click.ujgJqlMenu", function() {
                $jqlMenu.hide();
            });
            updateGroupSelect();
            updateDebug();
        }

        initPanel();
        loadCurrentUser();
        startLoading();
    }

    MyGadget.__test = {
        filterDayDataByUsers: filterDayDataByUsers,
        getCalendarUserIds: getCalendarUserIds,
        getUserDropdownEntries: getUserDropdownEntries,
        countWorkDays: countWorkDays,
        computeUserReport: computeUserReport,
        computeWeekSummary: computeWeekSummary,
        computeMonthSummary: computeMonthSummary,
        getWeekTransitions: getWeekTransitions,
        formatSummaryHeadline: formatSummaryHeadline,
        buildMassWorklogPlan: buildMassWorklogPlan,
        formatJiraStarted: formatJiraStarted,
        parseWorklogSeconds: parseWorklogSeconds,
        buildWorklogPayload: buildWorklogPayload,
        buildTransitionMassWorklogTemplate: buildTransitionMassWorklogTemplate,
        issueHasSelfWorklogOnDay: issueHasSelfWorklogOnDay,
        normalizeJqlPresets: normalizeJqlPresets,
        selectJqlPreset: selectJqlPreset,
        applyJqlPreset: applyJqlPreset,
        saveAsJqlPreset: saveAsJqlPreset,
        planJqlPresetAction: planJqlPresetAction,
        deleteJqlPreset: deleteJqlPreset,
        resolveInitialJqlState: resolveInitialJqlState,
        collectProjectKeys: collectProjectKeys,
        fetchAvailableProjectKeys: fetchAvailableProjectKeys,
        readTimesheetLlmConfig: readTimesheetLlmConfig,
        beginTimesheetLoad: beginTimesheetLoad,
        isTimesheetLoadCurrent: isTimesheetLoadCurrent,
        buildJqlLlmRequest: buildJqlLlmRequest,
        cleanGeneratedJql: cleanGeneratedJql
    };
    
    return MyGadget;
});
