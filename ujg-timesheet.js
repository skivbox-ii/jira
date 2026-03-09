define("_ujgTimesheet", ["jquery", "_ujgCommon"], function($, Common) {

    var utils = Common.utils;
    var baseUrl = Common.baseUrl;
    
    var STORAGE_KEY = "ujg_timesheet_settings";
    var STORAGE_KEY_GROUPS = "ujg_timesheet_groups";
    
    var CONFIG = {
        version: "1.6.0",
        jqlFilter: "",
        debug: true
    };

    var WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
    var MONTH_NAMES = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
    var DONE_STATUSES = ["done", "closed", "resolved", "готово", "закрыт", "закрыта", "завершен", "завершена", "выполнено"];
    
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
            var transitions = changelogData[key];
            if (!transitions || transitions.length === 0) return;
            var weekChanges = [];
            transitions.forEach(function(t) {
                var tDate = new Date(t.date);
                if (tDate.getTime() >= startMs && tDate.getTime() < endMs) {
                    weekChanges.push(t.from + " → " + t.to);
                }
            });
            if (weekChanges.length > 0) {
                result.push({ key: key, changes: weekChanges });
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
        };

        var $content = API.getGadgetContentEl();
        var $cont = $content.find(".ujg-timesheet");
        if ($cont.length === 0) {
            $cont = $('<div class="ujg-timesheet"></div>');
            $content.append($cont);
        }

        var $fsBtn, $userBtn, $userPanel, $userSearch, $userList, $rangeStart, $rangeEnd, $debugBox, $debugText, $progress;
        var $groupSelect, $groupSaveBtn, $separateCheck;

        function log(msg) {
            if (CONFIG.debug) console.log("[UJG-Timesheet]", msg);
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
            var userIds = getCalendarUserIds(state.users, []);
            $userList.empty();
            userIds.forEach(function(id) {
                var name = state.users[id];
                if (query && name.toLowerCase().indexOf(query) < 0) return;
                var checked = state.selectedUsers.indexOf(id) >= 0;
                var $item = $('<label class="ujg-user-dd-item"></label>');
                var $check = $('<input type="checkbox">').prop("checked", checked);
                $check.on("change", function() {
                    if ($(this).is(":checked")) {
                        if (state.selectedUsers.indexOf(id) < 0) state.selectedUsers.push(id);
                    } else {
                        state.selectedUsers = state.selectedUsers.filter(function(selectedId) { return selectedId !== id; });
                    }
                    applyUserSelection();
                });
                $item.append($check, $('<span></span>').text(name));
                $userList.append($item);
            });
            if ($userList.children().length === 0) $userList.append('<div class="ujg-user-dd-empty">Ничего не найдено</div>');
            updateUserSelectLabel();
        }
        
        function updateUserSelectLabel() {
            var count = state.selectedUsers.length;
            var total = Object.keys(state.users).length;
            var label = count === 0 ? "Все (" + total + ")" : count + " из " + total;
            if ($userBtn) $userBtn.text(label);
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
        
        function renderWeekSummaryCell(summary, transitions, groupSummary) {
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
                    html += '<div class="ujg-sum-tr">';
                    html += '<a href="' + baseUrl + '/browse/' + t.key + '" target="_blank" class="ujg-sum-tr-key">' + t.key + '</a> ';
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
                            html += '<div class="ujg-cell-issue">';
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
                html += renderWeekSummaryCell(wSummary, transitions, groupSummaryMode);

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

        function loadDaySequentially(index) {
            if (index >= state.days.length) {
                state.loading = false;
                $progress.hide();
                updateDebug();
                API.resize();
                return;
            }
            
            var day = state.days[index];
            var dayKey = utils.getDayKey(day);
            
            state.loadedDays = index + 1;
            $progress.text("Загрузка: " + state.loadedDays + "/" + state.totalDays);
            updateDebug();
            
            Common.loadDayData(day, CONFIG.jqlFilter, null).then(function(result) {
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
                loadDaySequentially(index + 1);
            }, function() {
                loadDaySequentially(index + 1);
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
                            state.changelogData[keys[idx]] = transitions;
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
            state.calendarData = {};
            state.users = {};
            state.totalDays = state.days.length;
            state.loadedDays = 0;
            state.loading = true;
            state.lastError = "";
            
            log("Начало загрузки: " + state.rangeStart + " - " + state.rangeEnd + " (" + state.totalDays + " дней)");
            
            // Сразу показываем пустой календарь
            renderCalendar();
            $progress.text("Загрузка: 0/" + state.totalDays).show();
            updateDebug();
            
            // Начинаем последовательную загрузку
            loadDaySequentially(0);
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
            
            // JQL: URL > localStorage
            if (urlParams.jql) {
                CONFIG.jqlFilter = urlParams.jql;
            } else if (saved.jql) {
                CONFIG.jqlFilter = saved.jql;
            }
            
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
            $jqlInput.val(CONFIG.jqlFilter);
            var $jqlBtn = $('<button class="aui-button">Применить</button>');
            $jqlBtn.on("click", function() {
                CONFIG.jqlFilter = $jqlInput.val().trim();
                saveSettings({ jql: CONFIG.jqlFilter });
                updateUrlState();
                updateDebug();
            });
            $jqlRow.append($('<label>JQL: </label>'), $jqlInput, $jqlBtn);
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
            $userPanel.append($userSearch, $userActions, $userList);
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
            updateGroupSelect();
            updateDebug();
        }

        initPanel();
        startLoading();
    }

    MyGadget.__test = {
        filterDayDataByUsers: filterDayDataByUsers,
        getCalendarUserIds: getCalendarUserIds,
        countWorkDays: countWorkDays,
        computeUserReport: computeUserReport,
        computeWeekSummary: computeWeekSummary,
        computeMonthSummary: computeMonthSummary,
        getWeekTransitions: getWeekTransitions,
        formatSummaryHeadline: formatSummaryHeadline
    };
    
    return MyGadget;
});
