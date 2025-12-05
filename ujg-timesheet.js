define("_ujgTimesheet", ["jquery", "_ujgCommon"], function($, Common) {

    var utils = Common.utils;
    var baseUrl = Common.baseUrl;

    var CONFIG = {
        // Ограничение выборки: укажи JQL, например "project = SDKU" или фильтр доски
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
            lastError: ""
        };

        var $content = API.getGadgetContentEl();
        var $cont = $content.find(".ujg-timesheet");
        if ($cont.length === 0) {
            $cont = $('<div class="ujg-timesheet"></div>');
            $content.append($cont);
        }

        var $fsBtn, $userSelect, $sprintSelect, $modeSprint, $modeRange, $rangeStart, $rangeEnd, $debugBox, $debugText;

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
                $cont.html('<div class="ujg-message ujg-message-info">Нет данных по выбранному спринту</div>');
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

            html += '<tr class="ujg-total-row"><td colspan="' + (2 + dayKeys.length) + '"><strong>ИТОГО</strong></td><td class="ujg-time-cell"><strong>' + (utils.formatTime(totalAll) || "0m") + '</strong></td></tr>';
            html += '</tbody></table>';

            $cont.html(html);
            API.resize();
        }

        function loadSprintData(sprintId) {
            state.selectedSprintId = sprintId;
            $cont.html('<div class="ujg-message ujg-message-loading">Загрузка спринта...</div>');
            Common.buildSprintData({ sprintId: sprintId, jqlFilter: CONFIG.jqlFilter }).then(function(data) {
                state.sprintData = data;
                updateUserList(data.users || []);
                renderMatrix(data);
            }, function() {
                state.lastError = "Ошибка загрузки данных спринта";
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
            $cont.html('<div class="ujg-message ujg-message-loading">Загрузка диапазона...</div>');
            Common.buildRangeData({ start: s, end: e, jqlFilter: CONFIG.jqlFilter }).then(function(data) {
                state.sprintData = data;
                updateUserList(data.users || []);
                renderMatrix(data);
            }, function(err) {
                state.lastError = "Ошибка загрузки диапазона: " + (err && err.statusText ? err.statusText : "");
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
                state.lastError = "Спринты не найдены. Проверь CONFIG.jqlFilter.";
                updateDebug();
                $cont.html('<div class="ujg-message ujg-message-info">Нет активных спринтов</div>');
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
            $cont.html('<div class="ujg-message ujg-message-loading">Загрузка активных спринтов...</div>');
            Common.listActiveSprints({ jqlFilter: CONFIG.jqlFilter }).then(function(list) {
                populateSprints(list);
            }, function(err) {
                state.lastError = "Ошибка загрузки спринтов: " + (err && err.statusText ? err.statusText : "");
                updateDebug();
                $cont.html('<div class="ujg-message ujg-message-info">Не удалось загрузить список активных спринтов</div>');
                API.resize();
            });
        }

        function updateDebug() {
            if (!CONFIG.debug || !$debugText) return;
            var parts = [];
            if (CONFIG.jqlFilter) parts.push("JQL: " + CONFIG.jqlFilter);
            if (state.mode === "sprint") {
                parts.push("Режим: спринт");
                parts.push("Спринтов найдено: " + (state.sprintList ? state.sprintList.length : 0));
                if (state.selectedSprintId) parts.push("Выбран спринт: " + state.selectedSprintId);
            } else {
                parts.push("Режим: диапазон");
                parts.push("Диапазон: " + state.rangeStart + " - " + state.rangeEnd);
            }
            if (state.lastError) parts.push("Ошибка: " + state.lastError);
            $debugText.text(parts.join(" | "));
        }

        function initPanel() {
            var $p = $('<div class="ujg-control-panel"></div>');

            var $mode = $('<div class="ujg-mode-toggle"></div>');
            $modeSprint = $('<label class="ujg-control-checkbox"><input type="radio" name="ujg-mode" value="sprint" checked><span>Спринт</span></label>');
            $modeRange = $('<label class="ujg-control-checkbox"><input type="radio" name="ujg-mode" value="range"><span>Диапазон дат</span></label>');
            $mode.find("input").on("change", function() {
                state.mode = $(this).val();
                if (state.mode === "sprint") {
                    loadSprints();
                } else {
                    $cont.html('<div class="ujg-message ujg-message-info">Укажите даты и нажмите Загрузить</div>');
                    API.resize();
                }
                updateDebug();
            });
            $mode.append($modeSprint, $modeRange);

            var $sprintFilter = $('<div class="ujg-sprint-filter"><label>Спринт: </label></div>');
            $sprintSelect = $('<select class="ujg-sprint-select"></select>');
            $sprintSelect.on("change", function() { var v = $(this).val(); if (v) loadSprintData(v); });
            $sprintFilter.append($sprintSelect);

            var $rangeFilter = $('<div class="ujg-range-filter"><label>Диапазон: </label></div>');
            $rangeStart = $('<input type="date" class="ujg-range-input">');
            $rangeEnd = $('<input type="date" class="ujg-range-input">');
            var $rangeBtn = $('<button class="aui-button">Загрузить</button>');
            $rangeBtn.on("click", function() {
                state.rangeStart = $rangeStart.val();
                state.rangeEnd = $rangeEnd.val();
                updateDebug();
                loadRangeData(state.rangeStart, state.rangeEnd);
            });
            $rangeFilter.append($rangeStart, $rangeEnd, $rangeBtn);

            var $userFilter = $('<div class="ujg-user-filter"><label>Пользователь: </label></div>');
            $userSelect = $('<select class="ujg-user-select"><option value="">Все</option></select>');
            $userSelect.on("change", function() {
                state.selectedUser = $(this).val();
                if (state.sprintData) renderMatrix(state.sprintData);
            });
            $userFilter.append($userSelect);

            var $cmt = $('<label class="ujg-control-checkbox"><input type="checkbox" ' + (state.showComments ? "checked" : "") + '><span>Комментарии</span></label>');
            $cmt.find("input").on("change", function() { state.showComments = $(this).is(":checked"); if (state.sprintData) renderMatrix(state.sprintData); });

            $fsBtn = $('<button class="aui-button ujg-fullscreen-btn">Fullscreen</button>');
            $fsBtn.on("click", function() { toggleFs(); });

            $debugBox = $('<div class="ujg-debug-box" style="display:' + (CONFIG.debug ? 'block' : 'none') + ';"><div class="ujg-debug-title">Debug</div><div class="ujg-debug-text"></div></div>');
            $debugText = $debugBox.find(".ujg-debug-text");

            $p.append($mode, $sprintFilter, $rangeFilter, $userFilter, $cmt, $fsBtn, $debugBox);
            $cont.before($p);

            $(document).on("keydown.ujgTs", function(e) { if (e.key === "Escape" && state.isFullscreen) toggleFs(); });
            updateDebug();
        }

        initPanel();
        loadSprints();
    }

    return MyGadget;
});
