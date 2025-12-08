define("_ujgTimesheet", ["jquery", "_ujgCommon"], function($, Common) {

    var utils = Common.utils;
    var baseUrl = Common.baseUrl;
    
    var STORAGE_KEY = "ujg_timesheet_settings";
    var STORAGE_KEY_GROUPS = "ujg_timesheet_groups";
    
    var CONFIG = {
        version: "1.5.1",
        jqlFilter: "",
        debug: true
    };

    var WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
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
            lastError: ""
        };

        var $content = API.getGadgetContentEl();
        var $cont = $content.find(".ujg-timesheet");
        if ($cont.length === 0) {
            $cont = $('<div class="ujg-timesheet"></div>');
            $content.append($cont);
        }

        var $fsBtn, $userSelect, $rangeStart, $rangeEnd, $debugBox, $debugText, $progress;
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

        function updateUserList() {
            var userList = Object.keys(state.users).map(function(id) {
                return { id: id, name: state.users[id] };
            }).sort(function(a, b) { return a.name.localeCompare(b.name); });
            
            $userSelect.empty();
            userList.forEach(function(u) {
                var isSelected = state.selectedUsers.indexOf(u.id) >= 0;
                $userSelect.append('<option value="' + utils.escapeHtml(u.id) + '"' + (isSelected ? ' selected' : '') + '>' + utils.escapeHtml(u.name) + '</option>');
            });
            
            updateUserSelectLabel();
        }
        
        function updateUserSelectLabel() {
            var count = state.selectedUsers.length;
            var total = Object.keys(state.users).length;
            var label = count === 0 ? "Все (" + total + ")" : "Выбрано: " + count;
            $userSelect.prev("label").text("Кто: " + label + " ");
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

        // Фильтрует данные дня по списку пользователей
        function filterDayDataByUsers(dayData, userIds) {
            if (!userIds || userIds.length === 0) return dayData;
            return dayData.filter(function(item) {
                if (!item.authors) return false;
                var authorIds = Object.keys(item.authors);
                return authorIds.some(function(aid) { return userIds.indexOf(aid) >= 0; });
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
            
            // Проверяем, есть ли данные за выходные (Сб=5, Вс=6)
            var hasWeekendData = weekdayTotals[5] > 0 || weekdayTotals[6] > 0;

            var html = '<div class="ujg-calendar' + (hasWeekendData ? '' : ' ujg-hide-weekends') + '" data-calendar-id="' + calendarId + '">';
            
            // Заголовок календаря (имя пользователя)
            if (userId) {
                html += '<div class="ujg-calendar-title">' + utils.escapeHtml(state.users[userId] || userId) + '</div>';
            }
            
            // Шапка с днями недели
            html += '<div class="ujg-calendar-header">';
            WEEKDAYS.forEach(function(wd, idx) {
                var wdTotal = weekdayTotals[idx];
                var isWeekend = idx >= 5;
                var cls = isWeekend ? "ujg-weekend" : "";
                // Скрываем выходные без данных
                if (isWeekend && !hasWeekendData) cls += " ujg-hidden";
                html += '<div class="ujg-calendar-header-cell ' + cls + '" data-weekday="' + idx + '">';
                html += '<div class="ujg-header-day">' + wd + '</div>';
                if (wdTotal > 0) {
                    html += '<div class="ujg-header-total">' + utils.formatTime(wdTotal) + '</div>';
                }
                html += '</div>';
            });
            html += '</div>';
            
            var totalAll = 0;
            
            // Строки недель
            weeks.forEach(function(week) {
                html += '<div class="ujg-calendar-week">';
                week.forEach(function(day, idx) {
                    var isWeekend = idx >= 5;
                    
                    // Скрываем выходные без данных
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
                    
                    html += '<div class="' + cellClass + '" data-day="' + dayKey + '">';
                    html += '<div class="ujg-cell-header">';
                    html += '<span class="ujg-cell-date">' + day.getDate() + '</span>';
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
                            // Только ключ перечёркиваем и делаем серым если задача закрыта
                            html += '<a href="' + baseUrl + '/browse/' + item.key + '" target="_blank" class="ujg-issue-link' + (isDone ? ' ujg-link-done' : '') + '">' + item.key + '</a>';
                            html += '<span class="ujg-issue-time">' + (utils.formatTime(item.seconds) || "") + '</span>';
                            // Статус в овале (max 5 символов)
                            if (item.status) {
                                var statusClass = isDone ? "ujg-status-done" : "ujg-status-open";
                                html += '<span class="ujg-issue-status ' + statusClass + '">' + utils.escapeHtml(shortStatus(item.status)) + '</span>';
                            }
                            if (item.estimate) html += '<span class="ujg-issue-est">[' + utils.formatTime(item.estimate) + ']</span>';
                            html += '</div>';
                            // Summary и comment НЕ перечёркиваем
                            if (item.summary) html += '<div class="ujg-issue-summary">' + utils.escapeHtml(item.summary) + '</div>';
                            if (showAuthors && item.authors) {
                                var names = Object.keys(item.authors).map(function(k) { return item.authors[k]; });
                                if (names.length > 0) html += '<div class="ujg-issue-author">' + utils.escapeHtml(names.join(", ")) + '</div>';
                            }
                            if (state.showComments && item.comments && item.comments.length > 0) {
                                html += '<div class="ujg-issue-comment">' + utils.escapeHtml(item.comments[0].substring(0, 80)) + '</div>';
                            }
                            html += '</div>';
                        });
                        html += '</div>';
                    }
                    
                    html += '</div>';
                });
                html += '</div>';
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
            
            var html = '';
            
            // Режим отдельных календарей для каждого пользователя
            if (state.separateCalendars && state.selectedUsers.length > 0) {
                html += '<div class="ujg-calendars-container">';
                state.selectedUsers.forEach(function(userId, idx) {
                    html += renderSingleCalendar(userId, 'cal-' + idx);
                });
                html += '</div>';
            } else {
                // Один общий календарь (с фильтром по выбранным пользователям)
                html = renderSingleCalendar(null, 'cal-main');
            }

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
            
            // Мультиселект пользователей
            var $userFilter = $('<div class="ujg-user-filter"></div>');
            var $userLabel = $('<label>Кто: Все </label>');
            $userSelect = $('<select class="ujg-user-select" multiple size="4"></select>');
            $userSelect.on("change", function() {
                state.selectedUsers = [];
                $(this).find("option:selected").each(function() {
                    state.selectedUsers.push($(this).val());
                });
                updateUrlState();
                updateDebug();
                updateUserSelectLabel();
                renderCalendar();
            });
            $userFilter.append($userLabel, $userSelect);
            
            // Кнопка сброса выбора
            var $clearUsersBtn = $('<button class="aui-button ujg-btn-small" title="Сбросить выбор">✕</button>');
            $clearUsersBtn.on("click", function() {
                state.selectedUsers = [];
                $userSelect.find("option").prop("selected", false);
                updateUrlState();
                updateDebug();
                updateUserSelectLabel();
                renderCalendar();
            });
            $userFilter.append($clearUsersBtn);
            
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
            
            // Галочка "Отдельные календари"
            $separateCheck = $('<label class="ujg-control-checkbox"><input type="checkbox"><span>Отдельные календари</span></label>');
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
    
    return MyGadget;
});
