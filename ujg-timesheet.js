define("_ujgTimesheet", ["jquery", "_ujgCommon"], function($, Common) {

    var utils = Common.utils;
    var baseUrl = Common.baseUrl;
    
    var STORAGE_KEY = "ujg_timesheet_settings";
    
    var CONFIG = {
        version: "1.3.0",
        jqlFilter: "",
        debug: true
    };

    var WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
    var DONE_STATUSES = ["done", "closed", "resolved", "готово", "закрыт", "закрыта", "завершен", "завершена", "выполнено"];
    
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
            selectedUser: "",
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
            var currentVal = $userSelect.val();
            var userList = Object.keys(state.users).map(function(id) {
                return { id: id, name: state.users[id] };
            }).sort(function(a, b) { return a.name.localeCompare(b.name); });
            
            $userSelect.empty();
            $userSelect.append('<option value="">Все (' + userList.length + ')</option>');
            userList.forEach(function(u) {
                $userSelect.append('<option value="' + utils.escapeHtml(u.id) + '">' + utils.escapeHtml(u.name) + '</option>');
            });
            if (currentVal && state.users[currentVal]) {
                $userSelect.val(currentVal);
            } else {
                state.selectedUser = "";
                $userSelect.val("");
            }
        }

        function renderCalendar() {
            var days = state.days;
            if (!days || days.length === 0) {
                $cont.html('<div class="ujg-message ujg-message-info">Укажите диапазон дат и нажмите "Загрузить"</div>');
                API.resize();
                return;
            }

            var calendarData = state.calendarData;
            var selectedUser = state.selectedUser;
            
            // Группируем дни по неделям
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

            var html = '<div class="ujg-calendar">';
            
            // Заголовок
            html += '<div class="ujg-calendar-header">';
            WEEKDAYS.forEach(function(wd, idx) {
                html += '<div class="ujg-calendar-header-cell ' + (idx >= 5 ? "ujg-weekend" : "") + '">' + wd + '</div>';
            });
            html += '</div>';
            
            var totalAll = 0;
            
            // Строки недель
            weeks.forEach(function(week) {
                html += '<div class="ujg-calendar-week">';
                week.forEach(function(day, idx) {
                    var isWeekend = idx >= 5;
                    if (!day) {
                        html += '<div class="ujg-calendar-cell ujg-calendar-empty ' + (isWeekend ? "ujg-weekend" : "") + '"></div>';
                        return;
                    }
                    
                    var dayKey = utils.getDayKey(day);
                    var dayData = calendarData[dayKey] || [];
                    
                    // Фильтруем по пользователю
                    var filteredData = dayData;
                    if (selectedUser) {
                        filteredData = dayData.filter(function(item) {
                            return item.authors && item.authors[selectedUser];
                        });
                    }
                    
                    var dayTotal = 0;
                    filteredData.forEach(function(item) { dayTotal += item.seconds || 0; });
                    totalAll += dayTotal;
                    
                    var cellClass = "ujg-calendar-cell";
                    if (isWeekend) cellClass += " ujg-weekend";
                    if (filteredData.length > 0) cellClass += " ujg-has-data";
                    
                    html += '<div class="' + cellClass + '" data-day="' + dayKey + '">';
                    html += '<div class="ujg-cell-header">';
                    html += '<span class="ujg-cell-date">' + day.getDate() + '</span>';
                    if (dayTotal > 0) {
                        html += '<span class="ujg-cell-total">' + utils.formatTime(dayTotal) + '</span>';
                    }
                    html += '</div>';
                    
                    if (filteredData.length > 0) {
                        html += '<div class="ujg-cell-issues">';
                        filteredData.forEach(function(item) {
                            var isDone = item.status && DONE_STATUSES.indexOf(item.status.toLowerCase()) >= 0;
                            html += '<div class="ujg-cell-issue' + (isDone ? " ujg-issue-done" : "") + '">';
                            html += '<div class="ujg-issue-header">';
                            html += '<a href="' + baseUrl + '/browse/' + item.key + '" target="_blank" class="ujg-issue-link">' + item.key + '</a>';
                            html += '<span class="ujg-issue-time">' + (utils.formatTime(item.seconds) || "") + '</span>';
                            if (item.estimate) html += '<span class="ujg-issue-est">[' + utils.formatTime(item.estimate) + ']</span>';
                            html += '</div>';
                            if (item.summary) html += '<div class="ujg-issue-summary">' + utils.escapeHtml(item.summary) + '</div>';
                            if (!selectedUser && item.authors) {
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

            $cont.html(html);
            API.resize();
        }
        
        function updateCellContent(dayKey) {
            var $cell = $cont.find('[data-day="' + dayKey + '"]');
            if ($cell.length === 0) return;
            
            var dayData = state.calendarData[dayKey] || [];
            var selectedUser = state.selectedUser;
            
            var filteredData = dayData;
            if (selectedUser) {
                filteredData = dayData.filter(function(item) {
                    return item.authors && item.authors[selectedUser];
                });
            }
            
            var dayTotal = 0;
            filteredData.forEach(function(item) { dayTotal += item.seconds || 0; });
            
            // Обновляем header
            var $header = $cell.find('.ujg-cell-header');
            var dateNum = $header.find('.ujg-cell-date').text();
            $header.html('<span class="ujg-cell-date">' + dateNum + '</span>');
            if (dayTotal > 0) {
                $header.append('<span class="ujg-cell-total">' + utils.formatTime(dayTotal) + '</span>');
                $cell.addClass('ujg-has-data');
            }
            
            // Обновляем issues
            $cell.find('.ujg-cell-issues').remove();
            if (filteredData.length > 0) {
                var html = '<div class="ujg-cell-issues">';
                filteredData.forEach(function(item) {
                    var isDone = item.status && DONE_STATUSES.indexOf(item.status.toLowerCase()) >= 0;
                    html += '<div class="ujg-cell-issue' + (isDone ? " ujg-issue-done" : "") + '">';
                    html += '<div class="ujg-issue-header">';
                    html += '<a href="' + baseUrl + '/browse/' + item.key + '" target="_blank" class="ujg-issue-link">' + item.key + '</a>';
                    html += '<span class="ujg-issue-time">' + (utils.formatTime(item.seconds) || "") + '</span>';
                    if (item.estimate) html += '<span class="ujg-issue-est">[' + utils.formatTime(item.estimate) + ']</span>';
                    html += '</div>';
                    if (item.summary) html += '<div class="ujg-issue-summary">' + utils.escapeHtml(item.summary) + '</div>';
                    if (!selectedUser && item.authors) {
                        var names = Object.keys(item.authors).map(function(k) { return item.authors[k]; });
                        if (names.length > 0) html += '<div class="ujg-issue-author">' + utils.escapeHtml(names.join(", ")) + '</div>';
                    }
                    html += '</div>';
                });
                html += '</div>';
                $cell.append(html);
            }
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
            
            Common.loadDayData(day, CONFIG.jqlFilter).then(function(result) {
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
            if (state.selectedUser) parts.push("Фильтр: " + state.users[state.selectedUser] || state.selectedUser);
            if (state.lastError) parts.push("<span style='color:red'>" + state.lastError + "</span>");
            $debugText.html(parts.join(" | "));
        }

        function initPanel() {
            var $p = $('<div class="ujg-control-panel"></div>');
            
            var saved = loadSettings();
            if (saved.jql) CONFIG.jqlFilter = saved.jql;
            var defaultDates = getDefaultDates();

            // JQL
            var $jqlRow = $('<div class="ujg-jql-filter"></div>');
            var $jqlInput = $('<input type="text" class="ujg-jql-input" placeholder="project = SDKU">');
            $jqlInput.val(CONFIG.jqlFilter);
            var $jqlBtn = $('<button class="aui-button">Применить</button>');
            $jqlBtn.on("click", function() {
                CONFIG.jqlFilter = $jqlInput.val().trim();
                saveSettings({ jql: CONFIG.jqlFilter });
                updateDebug();
            });
            $jqlRow.append($('<label>JQL: </label>'), $jqlInput, $jqlBtn);
            $p.append($jqlRow);

            // Даты
            var $rangeRow = $('<div class="ujg-range-filter"></div>');
            $rangeStart = $('<input type="date" class="ujg-range-input">');
            $rangeEnd = $('<input type="date" class="ujg-range-input">');
            $rangeStart.val(defaultDates.start);
            $rangeEnd.val(defaultDates.end);
            state.rangeStart = defaultDates.start;
            state.rangeEnd = defaultDates.end;
            
            var $rangeBtn = $('<button class="aui-button aui-button-primary">Загрузить</button>');
            $rangeBtn.on("click", function() {
                if (state.loading) return;
                state.rangeStart = $rangeStart.val();
                state.rangeEnd = $rangeEnd.val();
                startLoading();
            });
            
            $progress = $('<span class="ujg-progress"></span>').hide();
            $rangeRow.append($('<label>С: </label>'), $rangeStart, $('<label> По: </label>'), $rangeEnd, $rangeBtn, $progress);
            $p.append($rangeRow);

            // Контролы
            var $row2 = $('<div class="ujg-controls-row"></div>');
            
            var $userFilter = $('<div class="ujg-user-filter"><label>Кто: </label></div>');
            $userSelect = $('<select class="ujg-user-select"><option value="">Все</option></select>');
            $userSelect.on("change", function() {
                state.selectedUser = $(this).val();
                renderCalendar();
                updateDebug();
            });
            $userFilter.append($userSelect);
            $row2.append($userFilter);

            var $cmt = $('<label class="ujg-control-checkbox"><input type="checkbox"><span>Комментарии</span></label>');
            $cmt.find("input").on("change", function() { 
                state.showComments = $(this).is(":checked"); 
                renderCalendar();
            });
            $row2.append($cmt);

            $fsBtn = $('<button class="aui-button ujg-fullscreen-btn">Fullscreen</button>');
            $fsBtn.on("click", toggleFs);
            $row2.append($fsBtn);

            $p.append($row2);

            // Debug
            $debugBox = $('<div class="ujg-debug-box"></div>');
            $debugText = $('<span class="ujg-debug-text"></span>');
            $debugBox.append($debugText);
            if (!CONFIG.debug) $debugBox.hide();
            $p.append($debugBox);

            $cont.before($p);
            $(document).on("keydown.ujgTs", function(e) { if (e.key === "Escape" && state.isFullscreen) toggleFs(); });
            updateDebug();
        }

        initPanel();
        startLoading();
    }

    return MyGadget;
});
