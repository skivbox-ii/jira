define("_ujgTimesheet", ["jquery", "_ujgCommon"], function($, Common) {

    var utils = Common.utils;
    var baseUrl = Common.baseUrl;

    var CONFIG = {
        // Версия виджета
        version: "1.1.0",
        // Ограничение выборки: укажи JQL, например "project = SDKU" или фильтр доски
        // Оставь пустым для поиска по всем доступным проектам
        jqlFilter: "",
        // Включить отладочный блок
        debug: true
    };

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
            if (CONFIG.debug) {
                console.log("[UJG-Timesheet]", msg);
            }
        }

        function toggleFs() {
            var $el = $content.closest(".dashboard-item-content, .gadget, .ujg-gadget-wrapper");
            if ($el.length === 0) $el = $content;
            state.isFullscreen = !state.isFullscreen;
            if (state.isFullscreen) {
                $el.data("ujg-style", $el.attr("style") || "");
                $el.addClass("ujg-fullscreen");
                $fsBtn.text("Exit Fullscreen");
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

        function renderMatrix(data) {
            $cont.empty();
            if (!data || !data.days || data.days.length === 0) {
                $cont.html('<div class="ujg-message ujg-message-info">Нет данных (укажите диапазон дат)</div>');
                API.resize();
                return;
            }

            var users = data.users || [];
            var singleUser = false;
            if (state.selectedUser) {
                users = users.filter(function(u) { return u.id === state.selectedUser; });
                singleUser = true;
            }
            if (users.length === 0) {
                $cont.html('<div class="ujg-message ujg-message-info">Нет данных для выбранного пользователя</div>');
                API.resize();
                return;
            }

            // Если выбран один пользователь - группируем по неделям, иначе по дням
            var useWeeks = singleUser && data.weeks && data.weeks.length > 0;
            var periodKeys, periodHeaders;

            if (useWeeks) {
                periodKeys = data.weeks;
                periodHeaders = data.weeks.map(function(wk) { return utils.getWeekLabel(wk); });
            } else {
                periodKeys = data.days.map(function(d) { return d.toISOString().slice(0,10); });
                periodHeaders = data.days.map(function(d) { return utils.formatDayShort(d); });
            }

            var html = '<table class="ujg-extended-table"><thead><tr>';
            html += '<th>Задача</th><th>Статус</th><th>Estimate</th><th>Due Date</th><th>Залогировано</th>';
            periodHeaders.forEach(function(h) { html += '<th class="ujg-date-cell">' + h + '</th>'; });
            html += '</tr></thead><tbody>';

            var totalAll = 0;

            users.forEach(function(u) {
                html += '<tr class="ujg-user-group"><td colspan="' + (5 + periodKeys.length) + '"><strong>' + utils.escapeHtml(u.name) + '</strong> · ' + (utils.formatTime(u.totalSeconds) || '0m') + '</td></tr>';
                u.issueList.forEach(function(issue) {
                    totalAll += issue.totalSeconds || 0;
                    html += '<tr>';
                    html += '<td class="ujg-issue-cell"><a href="' + baseUrl + '/browse/' + issue.key + '" class="ujg-issue-key" target="_blank">' + utils.escapeHtml(issue.key) + '</a><div class="ujg-issue-summary">' + utils.escapeHtml(issue.summary) + '</div></td>';
                    html += '<td>' + utils.escapeHtml(issue.status || "") + '</td>';
                    html += '<td class="ujg-time-cell">' + (utils.formatTime(issue.estimate) || "-") + '</td>';
                    html += '<td class="ujg-date-cell">' + (issue.dueDate ? utils.formatDateShort(issue.dueDate) : "-") + '</td>';
                    html += '<td class="ujg-time-cell">' + (utils.formatTime(issue.totalSeconds) || "0m") + '</td>';
                    
                    periodKeys.forEach(function(pk) {
                        var cell = useWeeks ? issue.perWeek[pk] : issue.perDay[pk];
                        if (cell && cell.seconds > 0) {
                            var txt = utils.formatTime(cell.seconds) || "0m";
                            if (state.showComments && cell.comments && cell.comments.length > 0) {
                                txt += '<div class="ujg-worklog-comment">' + utils.escapeHtml(cell.comments.join(" | ")) + '</div>';
                            }
                            html += '<td class="ujg-time-cell">' + txt + '</td>';
                        } else {
                            html += '<td>&nbsp;</td>';
                        }
                    });
                    html += '</tr>';
                });
            });

            html += '<tr class="ujg-total-row"><td colspan="4"><strong>ИТОГО</strong></td><td class="ujg-time-cell"><strong>' + (utils.formatTime(totalAll) || "0m") + '</strong></td>';
            for (var i = 0; i < periodKeys.length; i++) html += '<td></td>';
            html += '</tr>';
            html += '</tbody></table>';

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
            log("Загрузка диапазона: " + startStr + " - " + endStr + ", JQL: " + (CONFIG.jqlFilter || "(все)"));
            $cont.html('<div class="ujg-message ujg-message-loading">Загрузка данных...</div>');
            updateDebug();
            
            Common.buildRangeData({ start: s, end: e, jqlFilter: CONFIG.jqlFilter }).then(function(data) {
                log("Данные получены. Пользователей: " + (data.users ? data.users.length : 0) + ", дней: " + (data.days ? data.days.length : 0));
                state.rangeData = data;
                state.lastIssuesCount = data.users ? data.users.reduce(function(acc, u) { return acc + (u.issueList ? u.issueList.length : 0); }, 0) : 0;
                updateDebug();
                updateUserList(data.users || []);
                renderMatrix(data);
            }, function(err) {
                state.lastError = "Ошибка загрузки: " + (err && err.statusText ? err.statusText : JSON.stringify(err));
                log(state.lastError);
                updateDebug();
                $cont.html('<div class="ujg-message ujg-message-info">Не удалось загрузить данные</div>');
                API.resize();
            });
        }

        function updateDebug() {
            if (!CONFIG.debug || !$debugText) return;
            var parts = [];
            parts.push("<b>Версия: " + CONFIG.version + "</b>");
            parts.push("JQL: " + (CONFIG.jqlFilter || "(все проекты)"));
            parts.push("Диапазон: " + (state.rangeStart || "?") + " - " + (state.rangeEnd || "?"));
            if (state.selectedUser) parts.push("Пользователь: " + state.selectedUser + " (по неделям)");
            if (state.lastIssuesCount) parts.push("Задач: " + state.lastIssuesCount);
            if (state.lastError) parts.push("ОШИБКА: " + state.lastError);
            $debugText.html(parts.join("<br>"));
        }

        function initPanel() {
            var $p = $('<div class="ujg-control-panel"></div>');

            // JQL фильтр (редактируемый)
            var $jqlRow = $('<div class="ujg-jql-filter"></div>');
            var $jqlInput = $('<input type="text" class="ujg-jql-input" placeholder="project = SDKU или оставьте пустым">');
            $jqlInput.val(CONFIG.jqlFilter);
            var $jqlBtn = $('<button class="aui-button">Применить</button>');
            $jqlBtn.on("click", function() {
                CONFIG.jqlFilter = $jqlInput.val().trim();
                log("JQL изменён: " + CONFIG.jqlFilter);
                updateDebug();
                if (state.rangeStart && state.rangeEnd) {
                    loadRangeData(state.rangeStart, state.rangeEnd);
                }
            });
            $jqlRow.append($('<label>JQL: </label>'), $jqlInput, $jqlBtn);
            $p.append($jqlRow);

            // Фильтр диапазона дат
            var $rangeRow = $('<div class="ujg-range-filter"></div>');
            $rangeStart = $('<input type="date" class="ujg-range-input">');
            $rangeEnd = $('<input type="date" class="ujg-range-input">');
            var $rangeBtn = $('<button class="aui-button aui-button-primary">Загрузить</button>');
            $rangeBtn.on("click", function() {
                state.rangeStart = $rangeStart.val();
                state.rangeEnd = $rangeEnd.val();
                log("Загрузка: " + state.rangeStart + " - " + state.rangeEnd);
                updateDebug();
                loadRangeData(state.rangeStart, state.rangeEnd);
            });
            $rangeRow.append($('<label>С: </label>'), $rangeStart, $('<label> По: </label>'), $rangeEnd, $rangeBtn);
            $p.append($rangeRow);

            // Вторая строка контролов
            var $row2 = $('<div class="ujg-controls-row"></div>');

            // Фильтр пользователя
            var $userFilter = $('<div class="ujg-user-filter"><label>Пользователь: </label></div>');
            $userSelect = $('<select class="ujg-user-select"><option value="">Все (по дням)</option></select>');
            $userSelect.on("change", function() {
                state.selectedUser = $(this).val();
                updateDebug();
                if (state.rangeData) renderMatrix(state.rangeData);
            });
            $userFilter.append($userSelect);
            $row2.append($userFilter);

            // Чекбокс комментариев
            var $cmt = $('<label class="ujg-control-checkbox"><input type="checkbox" ' + (state.showComments ? "checked" : "") + '><span>Комментарии</span></label>');
            $cmt.find("input").on("change", function() { state.showComments = $(this).is(":checked"); if (state.rangeData) renderMatrix(state.rangeData); });
            $row2.append($cmt);

            // Fullscreen
            $fsBtn = $('<button class="aui-button ujg-fullscreen-btn">Fullscreen</button>');
            $fsBtn.on("click", function() { toggleFs(); });
            $row2.append($fsBtn);

            $p.append($row2);

            // Debug box
            $debugBox = $('<div class="ujg-debug-box"></div>');
            $debugBox.append('<div class="ujg-debug-title">Debug</div>');
            $debugText = $('<div class="ujg-debug-text"></div>');
            $debugBox.append($debugText);
            if (!CONFIG.debug) $debugBox.hide();
            $p.append($debugBox);

            $cont.before($p);

            $(document).on("keydown.ujgTs", function(e) { if (e.key === "Escape" && state.isFullscreen) toggleFs(); });
            
            updateDebug();
        }

        initPanel();
        // Показываем инструкцию
        $cont.html('<div class="ujg-message ujg-message-info">Укажите диапазон дат и нажмите "Загрузить"</div>');
    }

    return MyGadget;
});
