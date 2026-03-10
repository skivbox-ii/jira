define("_ujgUA_rendering", ["jquery", "_ujgUA_config", "_ujgUA_utils"], function($, config, utils) {
    "use strict";

    var $container = null;
    var mods = null;
    var $contentArea = null;
    var currentUser = null;
    var currentPeriod = null;
    var isFullscreen = false;
    var activeRequestId = 0;

    var summaryInst = null;
    var projBreakInst = null;
    var issueListInst = null;
    var activityLogInst = null;
    var detailInst = null;

    function init($el, modules) {
        $container = $el;
        mods = modules;
        renderShell();
    }

    function renderShell() {
        $container.empty().addClass("bg-background");

        var $header = $(
            '<header class="border-b border-border bg-card/80 backdrop-blur-sm sticky top-0 z-30">' +
                '<div class="m-0.5 flex items-center gap-2 flex-wrap">' +
                    '<div class="flex items-center gap-1.5">' +
                        utils.icon("activity", "w-3.5 h-3.5 text-primary") +
                        '<h1 class="text-[11px] font-bold text-foreground tracking-tight">User Activity</h1>' +
                    '</div>' +
                    '<div class="ujg-ua-slot-user"></div>' +
                    '<div class="ujg-ua-slot-daterange"></div>' +
                    '<button class="ujg-ua-btn-load h-6 px-2.5 rounded bg-primary text-primary-foreground text-[11px] font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center gap-1">' +
                        utils.icon("download", "w-3 h-3") + ' Загрузить' +
                    '</button>' +
                    '<button class="ujg-ua-btn-fullscreen ml-auto h-6 w-6 flex items-center justify-center rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground">' +
                        utils.icon("maximize2", "w-3.5 h-3.5") +
                    '</button>' +
                '</div>' +
            '</header>'
        );
        $container.append($header);

        var userPicker = mods.userPicker.create($container, function(user) {
            currentUser = user;
            if (user) {
                var period = currentPeriod || utils.getDefaultPeriod();
                loadData(user.name, period, user);
            } else {
                activeRequestId += 1;
                renderEmptyState();
            }
        });
        $header.find(".ujg-ua-slot-user").append(userPicker.$el);

        var datePicker = mods.dateRangePicker.create(function(period) { currentPeriod = period; });
        $header.find(".ujg-ua-slot-daterange").append(datePicker.$el);
        currentPeriod = datePicker.getPeriod();

        $header.find(".ujg-ua-btn-load").on("click", function() {
            if (!currentUser) return;
            var period = currentPeriod || utils.getDefaultPeriod();
            loadData(currentUser.name, period, currentUser);
        });

        $header.find(".ujg-ua-btn-fullscreen").on("click", function() {
            if (!document.fullscreenElement) {
                document.documentElement.requestFullscreen().catch(function() {});
            } else {
                document.exitFullscreen().catch(function() {});
            }
        });
        $(document).off("fullscreenchange.ujgUA_rendering").on("fullscreenchange.ujgUA_rendering", function() {
            isFullscreen = !!document.fullscreenElement;
            $header.find(".ujg-ua-btn-fullscreen").html(
                utils.icon(isFullscreen ? "minimize2" : "maximize2", "w-3.5 h-3.5")
            );
        });

        $contentArea = $('<main class="w-full px-3 py-2 space-y-2"></main>');
        $container.append($contentArea);

        userPicker.setFromUrl();
        currentUser = userPicker.getSelected();

        if (currentUser) {
            var period = currentPeriod || utils.getDefaultPeriod();
            loadData(currentUser.name, period, currentUser);
        } else {
            renderEmptyState();
        }
    }

    function renderEmptyState() {
        $contentArea.empty().html(
            '<div class="flex flex-col items-center justify-center py-32 text-center">' +
                '<div class="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">' +
                    utils.icon("activity", "w-8 h-8 text-primary") +
                '</div>' +
                '<h2 class="text-xl font-bold text-foreground mb-2">User Activity Dashboard</h2>' +
                '<p class="text-sm text-muted-foreground max-w-md">Выберите пользователя и период, чтобы увидеть полную статистику активности: залогированное время, задачи, переходы статусов.</p>' +
            '</div>'
        );
    }

    function loadData(username, period, user) {
        var requestId = ++activeRequestId;
        var requestUser = Object.assign({}, user || currentUser || { name: username });
        $contentArea.empty();

        var loader = mods.progressLoader.create();
        loader.show();
        $contentArea.append(loader.$el);

        mods.api.fetchAllData(username, period.start, period.end, function(progress) {
            loader.update(progress);
        }).done(function(rawData) {
            if (requestId !== activeRequestId) return;
            var processed = mods.dataProcessor.processData(rawData, username, period.start, period.end);
            var startDate = new Date(period.start + "T00:00:00");
            var endDate = new Date(period.end + "T23:59:59");
            if (requestId !== activeRequestId) return;
            mods.repoApi.fetchRepoActivityForIssues(rawData.issues, function(progress) {
                loader.update(progress);
            }).done(function(repoData) {
                if (requestId !== activeRequestId) return;
                var repoActivity = mods.repoDataProcessor.processRepoActivity(
                    processed.issueMap,
                    repoData && repoData.issueDevStatusMap,
                    requestUser,
                    period.start,
                    period.end
                );
                if (requestId !== activeRequestId) return;
                renderDashboard(processed, startDate, endDate, username, { activity: repoActivity });
            }).fail(function(err) {
                if (requestId !== activeRequestId) return;
                renderDashboard(processed, startDate, endDate, username, { error: err });
            });
        }).fail(function(err) {
            if (requestId !== activeRequestId) return;
            $contentArea.empty().html(
                '<div class="dashboard-card p-8 text-center">' +
                    '<div class="text-destructive font-medium mb-2">Ошибка загрузки</div>' +
                    '<div class="text-sm text-muted-foreground">' + utils.escapeHtml(String(err)) + '</div>' +
                '</div>'
            );
        });
    }

    function renderRepoStateCard(title, message) {
        return $(
            '<div class="dashboard-card p-4">' +
                '<div class="text-sm font-semibold text-foreground mb-1">' + utils.escapeHtml(title) + '</div>' +
                '<div class="text-sm text-muted-foreground">' + utils.escapeHtml(message) + '</div>' +
            '</div>'
        );
    }

    function renderDashboard(data, startDate, endDate, username, repoState) {
        $contentArea.empty();
        repoState = repoState || {};
        var repoActivity = repoState.activity || null;

        summaryInst = mods.summaryCards.create();
        summaryInst.render(data.stats);
        $contentArea.append(summaryInst.$el);

        var heatmap = mods.calendarHeatmap.render(data.dayMap, data.issueMap, startDate, endDate);
        $contentArea.append(heatmap.$el);

        var repoCalendarInst = null;
        var repoLogInst = null;

        if (repoActivity) {
            repoCalendarInst = mods.repoCalendar.render(repoActivity.dayMap, startDate, endDate);
            $contentArea.append(repoCalendarInst.$el);
        } else if (repoState.error) {
            $contentArea.append(renderRepoStateCard(
                "Репозиторная активность",
                "Не удалось загрузить данные репозиториев."
            ));
        }

        detailInst = mods.dailyDetail.create();
        $contentArea.append(detailInst.$el);

        heatmap.onSelectDate(function(dateStr) {
            if (!dateStr) { detailInst.hide(); return; }
            var dayData = data.dayMap[dateStr] || { worklogs: [], changes: [], issues: [], totalHours: 0 };
            detailInst.show(dateStr, dayData, data.issueMap);
        });

        if (repoCalendarInst) {
            repoCalendarInst.onSelectDate(function(selectedDate) {
                if (repoLogInst) repoLogInst.render(repoActivity, selectedDate || null);
            });
        }

        projBreakInst = mods.projectBreakdown.create();
        var projects = Object.values(data.projectMap).sort(function(a, b) { return b.totalHours - a.totalHours; });
        var projList = projects.map(function(p) {
            return { key: p.key, hours: p.totalHours, count: p.issueCount };
        });
        projBreakInst.render({ projects: projList, transitions: data.statusTransitions });
        $contentArea.append(projBreakInst.$el);

        issueListInst = mods.issueList.create();
        var issueProjects = projects.map(function(p) {
            var issues = p.issues.map(function(k) {
                var iss = data.issueMap[k];
                if (!iss) return null;
                return { key: iss.key, summary: iss.summary, type: iss.type, status: iss.status, hours: iss.totalTimeHours };
            }).filter(Boolean).sort(function(a, b) { return b.hours - a.hours; });
            return { key: p.key, count: p.issueCount, hours: p.totalHours, issues: issues };
        });
        issueListInst.render(issueProjects);
        $contentArea.append(issueListInst.$el);

        activityLogInst = mods.activityLog.create();
        activityLogInst.render(data, username, utils.getDayKey(startDate), utils.getDayKey(endDate));
        $contentArea.append(activityLogInst.$el);

        if (repoActivity) {
            repoLogInst = mods.repoLog.create();
            repoLogInst.render(repoActivity, null);
            $contentArea.append(repoLogInst.$el);
        } else if (repoState.error) {
            $contentArea.append(renderRepoStateCard(
                "Лог репозиторной активности",
                "Данные репозиториев недоступны для выбранного периода."
            ));
        }
    }

    return { init: init };
});
