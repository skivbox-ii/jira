define("_ujgTimesheet", ["jquery", "_ujgCommon"], function($, Common) {

    var utils = Common.utils;
    var baseUrl = Common.baseUrl;

    var CONFIG = {
        // Версия виджета
        version: "1.0.3",
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
            selectedSprintId: "",
            sprintList: [],
            sprintData: null,
            mode: "sprint", // "sprint" | "range"
            rangeStart: "",
            rangeEnd: "",
            lastError: "",
            lastJql: "",
            lastIssuesCount: 0
        };

        var $content = API.getGadgetContentEl();
        var $cont = $content.find(".ujg-timesheet");
        if ($cont.length === 0) {
            $cont = $('<div class="ujg-timesheet"></div>');
            $content.append($cont);
        }

        var $fsBtn, $userSelect, $sprintSelect, $sprintFilter, $rangeFilter, $rangeStart, $rangeEnd, $debugBox, $debugText;

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

        function updateModeUI() {
            if (state.mode === "sprint") {
                $sprintFilter.show();
                $rangeFilter.hide();
            } else {
                $sprintFilter.hide();
                $rangeFilter.show();
            }
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
                $cont.html('<div class="ujg-message ujg-message-info">Нет данных (дни не определены)</div>');
                API.resize();
                return;
            }

            var users = data.users || [];
            if (state.selectedUser) {
                users = users.filter(function(u) { return u.id === state.selectedUser; });
            }
            if (users.length === 0) {
                $cont.html('<div class="ujg-message ujg-message-info">Нет данных для выбранного пользователя</div>');
                API.resize();
                return;
            }

            var dayKeys = data.days.map(function(d) { return d.toISOString().slice(0,10); });
            var html = '<table class="ujg-extended-table"><thead><tr>';
            html += '<th>Задача</th><th>Статус</th><th>Итого</th>';
            data.days.forEach(function(d) { html += '<th class="ujg-date-cell">' + utils.formatDayShort(d) + '</th>'; });
            html += '</tr></thead><tbody>';

            var totalAll = 0;

            users.forEach(function(u) {
                html += '<tr class="ujg-user-group"><td colspan="' + (3 + dayKeys.length) + '"><strong>' + utils.escapeHtml(u.name) + '</strong> · ' + (utils.formatTime(u.totalSeconds) || '0m') + '</td></tr>';
                u.issueList.forEach(function(issue) {
                    totalAll += issue.totalSeconds || 0;
                    html += '<tr>';
                    html += '<td class="ujg-issue-cell"><a href="' + baseUrl + '/browse/' + issue.key + '" class="ujg-issue-key" target="_blank">' + utils.escapeHtml(issue.key) + '</a><div class="ujg-issue-summary">' + utils.escapeHtml(issue.summary) + '</div></td>';
                    html += '<td>' + utils.escapeHtml(issue.status || "") + '</td>';
                    html += '<td class="ujg-time-cell">' + (utils.formatTime(issue.totalSeconds) || "0m") + '</td>';
                    dayKeys.forEach(function(dk) {
                        var cell = issue.perDay[dk];
                        if (cell) {
                            var txt = utils.formatTime(cell.seconds) || "0m";
                            if (state.showComments && cell.comments && cell.comments.length > 0) {
                                txt += '<div class="ujg-worklog-comment">' + utils.escapeHtml(cell.comments.join(" | ")) + '</div>';
                            }
                            html += '<td>' + txt + '</td>';
                        } else {
                            html += '<td>&nbsp;</td>';
                        }
                    });
                    html += '</tr>';
                });
            });

            html += '<tr class="ujg-total-row"><td colspan="2"><strong>ИТОГО</strong></td><td class="ujg-time-cell"><strong>' + (utils.formatTime(totalAll) || "0m") + '</strong></td>';
            for (var i = 0; i < dayKeys.length; i++) html += '<td></td>';
            html += '</tr>';
            html += '</tbody></table>';

            $cont.html(html);
            API.resize();
        }

        function loadSprintData(sprintId) {
            state.selectedSprintId = sprintId;
            state.lastError = "";
            log("Загрузка данных спринта: " + sprintId);
            $cont.html('<div class="ujg-message ujg-message-loading">Загрузка спринта...</div>');
            updateDebug();
            
            Common.buildSprintData({ sprintId: sprintId, jqlFilter: CONFIG.jqlFilter }).then(function(data) {
                log("Данные спринта получены. Пользователей: " + (data.users ? data.users.length : 0) + ", дней: " + (data.days ? data.days.length : 0));
                state.sprintData = data;
                state.lastIssuesCount = data.users ? data.users.reduce(function(acc, u) { return acc + (u.issueList ? u.issueList.length : 0); }, 0) : 0;
                updateDebug();
                updateUserList(data.users || []);
                renderMatrix(data);
            }, function(err) {
                state.lastError = "Ошибка загрузки данных спринта: " + (err && err.statusText ? err.statusText : JSON.stringify(err));
                log(state.lastError);
                updateDebug();
                $cont.html('<div class="ujg-message ujg-message-info">Не удалось загрузить данные спринта</div>');
                API.resize();
            });
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
            state.lastJql = CONFIG.jqlFilter || "(все задачи)";
            log("Загрузка диапазона: " + startStr + " - " + endStr + ", JQL: " + state.lastJql);
            $cont.html('<div class="ujg-message ujg-message-loading">Загрузка диапазона...</div>');
            updateDebug();
            
            Common.buildRangeData({ start: s, end: e, jqlFilter: CONFIG.jqlFilter }).then(function(data) {
                log("Данные диапазона получены. Пользователей: " + (data.users ? data.users.length : 0) + ", дней: " + (data.days ? data.days.length : 0));
                state.sprintData = data;
                state.lastIssuesCount = data.users ? data.users.reduce(function(acc, u) { return acc + (u.issueList ? u.issueList.length : 0); }, 0) : 0;
                updateDebug();
                updateUserList(data.users || []);
                renderMatrix(data);
            }, function(err) {
                state.lastError = "Ошибка загрузки диапазона: " + (err && err.statusText ? err.statusText : JSON.stringify(err));
                log(state.lastError);
                updateDebug();
                $cont.html('<div class="ujg-message ujg-message-info">Не удалось загрузить данные по диапазону</div>');
                API.resize();
            });
        }

        function populateSprints(list) {
            state.sprintList = list || [];
            $sprintSelect.empty();
            if (state.sprintList.length === 0) {
                $sprintSelect.append('<option value="">Нет активных спринтов</option>');
                state.lastError = "Спринты не найдены. JQL: sprint in openSprints()" + (CONFIG.jqlFilter ? " AND (" + CONFIG.jqlFilter + ")" : "");
                log(state.lastError);
                updateDebug();
                $cont.html('<div class="ujg-message ujg-message-info">Нет активных спринтов. Попробуйте режим "Диапазон дат".</div>');
                API.resize();
                return;
            }
            state.sprintList.forEach(function(s) {
                var lbl = (s.name || ("Sprint " + s.id));
                if (s.start) lbl += " (" + utils.formatDayShort(s.start) + (s.end ? " - " + utils.formatDayShort(s.end) : "") + ")";
                $sprintSelect.append('<option value="' + s.id + '">' + utils.escapeHtml(lbl) + '</option>');
            });
            var initial = state.selectedSprintId && state.sprintList.some(function(s) { return String(s.id) === String(state.selectedSprintId); }) ? state.selectedSprintId : state.sprintList[state.sprintList.length - 1].id;
            state.selectedSprintId = initial;
            $sprintSelect.val(initial);
            loadSprintData(initial);
        }

        function loadSprints() {
            state.lastError = "";
            state.lastJql = "sprint in openSprints()" + (CONFIG.jqlFilter ? " AND (" + CONFIG.jqlFilter + ")" : "");
            log("Загрузка списка спринтов. JQL: " + state.lastJql);
            $cont.html('<div class="ujg-message ujg-message-loading">Загрузка активных спринтов...</div>');
            updateDebug();
            
            Common.listActiveSprints({ jqlFilter: CONFIG.jqlFilter }).then(function(list) {
                log("Спринтов найдено: " + list.length);
                populateSprints(list);
            }, function(err) {
                state.lastError = "Ошибка загрузки спринтов: " + (err && err.statusText ? err.statusText : JSON.stringify(err));
                log(state.lastError);
                updateDebug();
                $cont.html('<div class="ujg-message ujg-message-info">Не удалось загрузить список активных спринтов. Попробуйте режим "Диапазон дат".</div>');
                API.resize();
            });
        }

        function updateDebug() {
            if (!CONFIG.debug || !$debugText) return;
            var parts = [];
            parts.push("<b>Версия: " + CONFIG.version + "</b>");
            parts.push("JQL filter: " + (CONFIG.jqlFilter || "(пусто - все проекты)"));
            parts.push("Режим: " + (state.mode === "sprint" ? "спринт" : "диапазон"));
            if (state.mode === "sprint") {
                parts.push("Спринтов: " + (state.sprintList ? state.sprintList.length : 0));
                if (state.selectedSprintId) parts.push("Выбран: " + state.selectedSprintId);
            } else {
                parts.push("Диапазон: " + (state.rangeStart || "?") + " - " + (state.rangeEnd || "?"));
            }
            if (state.lastIssuesCount) parts.push("Задач с worklogs: " + state.lastIssuesCount);
            if (state.lastError) parts.push("ОШИБКА: " + state.lastError);
            $debugText.html(parts.join("<br>"));
        }

        function initPanel() {
            var $p = $('<div class="ujg-control-panel"></div>');

            // Переключатель режимов
            var $mode = $('<div class="ujg-mode-toggle"></div>');
            var $modeSprint = $('<label class="ujg-control-checkbox"><input type="radio" name="ujg-mode" value="sprint" checked><span>Спринт</span></label>');
            var $modeRange = $('<label class="ujg-control-checkbox"><input type="radio" name="ujg-mode" value="range"><span>Диапазон дат</span></label>');
            $mode.append($modeSprint, $modeRange);
            
            // Сначала добавляем в DOM, потом вешаем обработчик
            $p.append($mode);
            
            // Теперь вешаем обработчик
            $mode.on("change", "input[name='ujg-mode']", function() {
                state.mode = $(this).val();
                log("Переключение режима: " + state.mode);
                updateModeUI();
                if (state.mode === "sprint") {
                    loadSprints();
                } else {
                    $cont.html('<div class="ujg-message ujg-message-info">Укажите даты и нажмите "Загрузить"</div>');
                    API.resize();
                }
                updateDebug();
            });

            // Фильтр спринта
            $sprintFilter = $('<div class="ujg-sprint-filter"><label>Спринт: </label></div>');
            $sprintSelect = $('<select class="ujg-sprint-select"></select>');
            $sprintSelect.on("change", function() { var v = $(this).val(); if (v) loadSprintData(v); });
            $sprintFilter.append($sprintSelect);
            $p.append($sprintFilter);

            // Фильтр диапазона дат
            $rangeFilter = $('<div class="ujg-range-filter"><label>С: </label></div>');
            $rangeStart = $('<input type="date" class="ujg-range-input">');
            $rangeEnd = $('<input type="date" class="ujg-range-input">');
            var $rangeBtn = $('<button class="aui-button">Загрузить</button>');
            $rangeBtn.on("click", function() {
                state.rangeStart = $rangeStart.val();
                state.rangeEnd = $rangeEnd.val();
                log("Нажата кнопка Загрузить: " + state.rangeStart + " - " + state.rangeEnd);
                updateDebug();
                loadRangeData(state.rangeStart, state.rangeEnd);
            });
            $rangeFilter.append($rangeStart, $('<label> По: </label>'), $rangeEnd, $rangeBtn);
            $p.append($rangeFilter);

            // Фильтр пользователя
            var $userFilter = $('<div class="ujg-user-filter"><label>Пользователь: </label></div>');
            $userSelect = $('<select class="ujg-user-select"><option value="">Все</option></select>');
            $userSelect.on("change", function() {
                state.selectedUser = $(this).val();
                if (state.sprintData) renderMatrix(state.sprintData);
            });
            $userFilter.append($userSelect);
            $p.append($userFilter);

            // Чекбокс комментариев
            var $cmt = $('<label class="ujg-control-checkbox"><input type="checkbox" ' + (state.showComments ? "checked" : "") + '><span>Комментарии</span></label>');
            $cmt.find("input").on("change", function() { state.showComments = $(this).is(":checked"); if (state.sprintData) renderMatrix(state.sprintData); });
            $p.append($cmt);

            // Fullscreen
            $fsBtn = $('<button class="aui-button ujg-fullscreen-btn">Fullscreen</button>');
            $fsBtn.on("click", function() { toggleFs(); });
            $p.append($fsBtn);

            // Debug box
            $debugBox = $('<div class="ujg-debug-box"></div>');
            $debugBox.append('<div class="ujg-debug-title">Debug Info</div>');
            $debugText = $('<div class="ujg-debug-text"></div>');
            $debugBox.append($debugText);
            if (!CONFIG.debug) $debugBox.hide();
            $p.append($debugBox);

            $cont.before($p);

            $(document).on("keydown.ujgTs", function(e) { if (e.key === "Escape" && state.isFullscreen) toggleFs(); });
            
            // Инициализация UI
            updateModeUI();
            updateDebug();
        }

        initPanel();
        loadSprints();
    }

    return MyGadget;
});
