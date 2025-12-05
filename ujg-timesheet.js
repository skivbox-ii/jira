define("_ujgTimesheet", ["jquery", "_ujgCommon"], function($, Common) {

    var utils = Common.utils;
    var baseUrl = Common.baseUrl;

    var CONFIG = {
        version: "1.2.0",
        jqlFilter: "",
        debug: true
    };

    var WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

    function MyGadget(API) {
        var state = {
            showComments: false,
            isFullscreen: false,
            selectedUser: "",
            rangeData: null,
            rangeStart: "",
            rangeEnd: "",
            lastError: "",
            lastIssuesCount: 0
        };

        var $content = API.getGadgetContentEl();
        var $cont = $content.find(".ujg-timesheet");
        if ($cont.length === 0) {
            $cont = $('<div class="ujg-timesheet"></div>');
            $content.append($cont);
        }

        var $fsBtn, $userSelect, $rangeStart, $rangeEnd, $debugBox, $debugText;

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

        function updateUserList(users) {
            var currentVal = $userSelect.val();
            $userSelect.empty();
            $userSelect.append('<option value="">Все (' + users.length + ')</option>');
            users.forEach(function(u) {
                $userSelect.append('<option value="' + utils.escapeHtml(u.id) + '">' + utils.escapeHtml(u.name) + '</option>');
            });
            if (currentVal && users.some(function(u) { return u.id === currentVal; })) {
                $userSelect.val(currentVal);
            } else {
                state.selectedUser = "";
                $userSelect.val("");
            }
        }

        function renderCalendar(data) {
            $cont.empty();
            if (!data || !data.days || data.days.length === 0) {
                $cont.html('<div class="ujg-message ujg-message-info">Укажите диапазон дат и нажмите "Загрузить"</div>');
                API.resize();
                return;
            }

            var calendarData = data.calendarData || {};
            var selectedUser = state.selectedUser;
            
            // Группируем дни по неделям для отображения календарём
            var weeks = [];
            var currentWeek = null;
            var firstDay = data.days[0];
            var startDow = utils.getDayOfWeek(firstDay);
            
            // Добавляем пустые ячейки в начале первой недели
            if (startDow > 0) {
                currentWeek = [];
                for (var i = 0; i < startDow; i++) {
                    currentWeek.push(null);
                }
            }
            
            data.days.forEach(function(day) {
                var dow = utils.getDayOfWeek(day);
                if (dow === 0 || !currentWeek) {
                    if (currentWeek) weeks.push(currentWeek);
                    currentWeek = [];
                }
                currentWeek.push(day);
            });
            
            // Добавляем пустые ячейки в конце последней недели
            if (currentWeek) {
                while (currentWeek.length < 7) {
                    currentWeek.push(null);
                }
                weeks.push(currentWeek);
            }

            var html = '<div class="ujg-calendar">';
            
            // Заголовок с днями недели
            html += '<div class="ujg-calendar-header">';
            WEEKDAYS.forEach(function(wd, idx) {
                var cls = idx >= 5 ? "ujg-weekend" : "";
                html += '<div class="ujg-calendar-header-cell ' + cls + '">' + wd + '</div>';
            });
            html += '</div>';
            
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
                    var dayData = calendarData[dayKey] || {};
                    var issueKeys = Object.keys(dayData);
                    
                    // Фильтруем по пользователю если выбран
                    if (selectedUser) {
                        issueKeys = issueKeys.filter(function(k) {
                            return dayData[k].authors && dayData[k].authors[selectedUser];
                        });
                    }
                    
                    var dayTotal = 0;
                    issueKeys.forEach(function(k) { dayTotal += dayData[k].seconds || 0; });
                    
                    var cellClass = "ujg-calendar-cell";
                    if (isWeekend) cellClass += " ujg-weekend";
                    if (issueKeys.length > 0) cellClass += " ujg-has-data";
                    
                    html += '<div class="' + cellClass + '">';
                    html += '<div class="ujg-cell-header">';
                    html += '<span class="ujg-cell-date">' + day.getDate() + '</span>';
                    if (dayTotal > 0) {
                        html += '<span class="ujg-cell-total">' + utils.formatTime(dayTotal) + '</span>';
                    }
                    html += '</div>';
                    
                    if (issueKeys.length > 0) {
                        html += '<div class="ujg-cell-issues">';
                        issueKeys.forEach(function(issueKey) {
                            var item = dayData[issueKey];
                            html += '<div class="ujg-cell-issue">';
                            html += '<a href="' + baseUrl + '/browse/' + issueKey + '" target="_blank" class="ujg-issue-link">' + issueKey + '</a>';
                            html += '<span class="ujg-issue-time">' + (utils.formatTime(item.seconds) || "") + '</span>';
                            if (item.estimate) {
                                html += '<span class="ujg-issue-est" title="Estimate">[' + utils.formatTime(item.estimate) + ']</span>';
                            }
                            if (state.showComments && item.comments && item.comments.length > 0) {
                                html += '<div class="ujg-issue-comment">' + utils.escapeHtml(item.comments[0].substring(0, 50)) + (item.comments[0].length > 50 ? "..." : "") + '</div>';
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
            
            // Итого
            var totalAll = data.totalSeconds || 0;
            html += '<div class="ujg-calendar-footer">Всего залогировано: <strong>' + (utils.formatTime(totalAll) || "0") + '</strong></div>';

            $cont.html(html);
            API.resize();
        }

        function loadRangeData(startStr, endStr) {
            var s = new Date(startStr), e = new Date(endStr);
            if (isNaN(s.getTime()) || isNaN(e.getTime())) {
                $cont.html('<div class="ujg-message ujg-message-info">Укажите корректные даты</div>');
                API.resize();
                return;
            }
            if (s > e) { var t = s; s = e; e = t; }
            state.lastError = "";
            log("Загрузка: " + startStr + " - " + endStr);
            $cont.html('<div class="ujg-message ujg-message-loading">Загрузка...</div>');
            updateDebug();
            
            Common.buildRangeData({ start: s, end: e, jqlFilter: CONFIG.jqlFilter }).then(function(data) {
                log("Данные получены. Пользователей: " + (data.users ? data.users.length : 0) + ", дней: " + (data.days ? data.days.length : 0));
                state.rangeData = data;
                state.lastIssuesCount = Object.keys(data.issueMap || {}).length;
                updateDebug();
                updateUserList(data.users || []);
                renderCalendar(data);
            }, function(err) {
                state.lastError = "Ошибка: " + (err && err.statusText ? err.statusText : JSON.stringify(err));
                log(state.lastError);
                updateDebug();
                $cont.html('<div class="ujg-message ujg-message-info">Не удалось загрузить данные</div>');
                API.resize();
            });
        }

        function updateDebug() {
            if (!CONFIG.debug || !$debugText) return;
            var parts = [];
            parts.push("<b>v" + CONFIG.version + "</b>");
            parts.push("JQL: " + (CONFIG.jqlFilter || "(все)"));
            if (state.rangeStart && state.rangeEnd) parts.push(state.rangeStart + " — " + state.rangeEnd);
            if (state.selectedUser) parts.push("Фильтр: " + state.selectedUser);
            if (state.lastIssuesCount) parts.push("Задач: " + state.lastIssuesCount);
            if (state.lastError) parts.push("<span style='color:red'>" + state.lastError + "</span>");
            $debugText.html(parts.join(" | "));
        }

        function initPanel() {
            var $p = $('<div class="ujg-control-panel"></div>');

            // JQL
            var $jqlRow = $('<div class="ujg-jql-filter"></div>');
            var $jqlInput = $('<input type="text" class="ujg-jql-input" placeholder="project = SDKU">');
            $jqlInput.val(CONFIG.jqlFilter);
            var $jqlBtn = $('<button class="aui-button">Применить</button>');
            $jqlBtn.on("click", function() {
                CONFIG.jqlFilter = $jqlInput.val().trim();
                updateDebug();
                if (state.rangeStart && state.rangeEnd) loadRangeData(state.rangeStart, state.rangeEnd);
            });
            $jqlRow.append($('<label>JQL: </label>'), $jqlInput, $jqlBtn);
            $p.append($jqlRow);

            // Даты
            var $rangeRow = $('<div class="ujg-range-filter"></div>');
            $rangeStart = $('<input type="date" class="ujg-range-input">');
            $rangeEnd = $('<input type="date" class="ujg-range-input">');
            var $rangeBtn = $('<button class="aui-button aui-button-primary">Загрузить</button>');
            $rangeBtn.on("click", function() {
                state.rangeStart = $rangeStart.val();
                state.rangeEnd = $rangeEnd.val();
                updateDebug();
                loadRangeData(state.rangeStart, state.rangeEnd);
            });
            $rangeRow.append($('<label>С: </label>'), $rangeStart, $('<label> По: </label>'), $rangeEnd, $rangeBtn);
            $p.append($rangeRow);

            // Контролы
            var $row2 = $('<div class="ujg-controls-row"></div>');
            
            var $userFilter = $('<div class="ujg-user-filter"><label>Кто: </label></div>');
            $userSelect = $('<select class="ujg-user-select"><option value="">Все</option></select>');
            $userSelect.on("change", function() {
                state.selectedUser = $(this).val();
                updateDebug();
                if (state.rangeData) renderCalendar(state.rangeData);
            });
            $userFilter.append($userSelect);
            $row2.append($userFilter);

            var $cmt = $('<label class="ujg-control-checkbox"><input type="checkbox"><span>Комментарии</span></label>');
            $cmt.find("input").on("change", function() { 
                state.showComments = $(this).is(":checked"); 
                if (state.rangeData) renderCalendar(state.rangeData); 
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
        $cont.html('<div class="ujg-message ujg-message-info">Укажите диапазон дат и нажмите "Загрузить"</div>');
    }

    return MyGadget;
});
