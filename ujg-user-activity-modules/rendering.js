define("_ujgUA_rendering", ["jquery", "_ujgUA_config", "_ujgUA_utils"], function($, config, utils) {
    "use strict";

    var $container = null;
    var mods = null;
    var $contentArea = null;
    var currentUsers = [];
    var currentPeriod = null;
    var isFullscreen = false;
    var activeRequestId = 0;

    var summaryInst = null;
    var projBreakInst = null;
    var issueListInst = null;
    var activityLogInst = null;
    var detailInst = null;
    var pickerInstance = null;

    var stylesInjected = false;

    function injectStyles() {
        if (stylesInjected) return;
        stylesInjected = true;
        var styles = config.STYLES;
        if (styles) {
            var $style = $('<style type="text/css"></style>').text(styles);
            $("head").append($style);
        }
    }

    function init($el, modules) {
        $container = $el;
        mods = modules;
        injectStyles();
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

        var pickerMod = mods.multiUserPicker || mods.userPicker;
        pickerInstance = pickerMod.create($container, function(users) {
            if (Array.isArray(users)) {
                currentUsers = users;
            } else if (users) {
                currentUsers = [users];
            } else {
                currentUsers = [];
            }
            if (currentUsers.length === 0) {
                activeRequestId += 1;
                renderEmptyState();
                return;
            }
            if (!mods.multiUserPicker) {
                loadData(currentUsers, currentPeriod || utils.getDefaultPeriod());
            }
        });
        $header.find(".ujg-ua-slot-user").append(pickerInstance.$el);

        var datePicker = mods.dateRangePicker.create(function(period) { currentPeriod = period; });
        $header.find(".ujg-ua-slot-daterange").append(datePicker.$el);
        currentPeriod = datePicker.getPeriod();

        $header.find(".ujg-ua-btn-load").on("click", function() {
            if (currentUsers.length === 0) return;
            var period = currentPeriod || utils.getDefaultPeriod();
            loadData(currentUsers, period);
        });

        $header.find(".ujg-ua-btn-fullscreen").on("click", function() {
            var $el = $container.closest(".dashboard-item-content, .gadget, .ujg-gadget-wrapper");
            if ($el.length === 0) $el = $container;
            isFullscreen = !isFullscreen;
            if (isFullscreen) {
                $el.data("ujg-style", $el.attr("style") || "");
                $el.addClass("ujg-fullscreen");
            } else {
                $el.removeClass("ujg-fullscreen").attr("style", $el.data("ujg-style"));
            }
            $header.find(".ujg-ua-btn-fullscreen").html(
                utils.icon(isFullscreen ? "minimize2" : "maximize2", "w-3.5 h-3.5")
            );
            if (mods.resize) mods.resize();
        });
        $(document).off("keydown.ujgUA_rendering").on("keydown.ujgUA_rendering", function(e) {
            if (e.key === "Escape" && isFullscreen) {
                $header.find(".ujg-ua-btn-fullscreen").trigger("click");
            }
        });

        $contentArea = $('<main class="w-full px-3 py-2 space-y-2"></main>');
        $container.append($contentArea);

        if (pickerInstance.setFromUrl) {
            pickerInstance.setFromUrl();
        }
        if (pickerInstance.getSelectedUsers) {
            currentUsers = pickerInstance.getSelectedUsers() || [];
        } else if (pickerInstance.getSelected) {
            var sel = pickerInstance.getSelected();
            currentUsers = sel ? [sel] : [];
        }

        if (currentUsers.length > 0) {
            var period = currentPeriod || utils.getDefaultPeriod();
            loadData(currentUsers, period);
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
                '<p class="text-sm text-muted-foreground max-w-md">Выберите пользователя и период, чтобы увидеть полную статистику активности: залогированное время, задачи, переходы статусов. Для сравнения можно добавить нескольких пользователей.</p>' +
            '</div>'
        );
    }

    function cloneUsers(selectedUsers) {
        var list = Array.isArray(selectedUsers) ? selectedUsers : (selectedUsers ? [selectedUsers] : []);
        return list.map(function(user) {
            return Object.assign({}, user);
        });
    }

    function attachAsync(promiseLike, onDone, onFail) {
        if (promiseLike && typeof promiseLike.done === "function") {
            promiseLike.done(onDone);
            if (onFail && typeof promiseLike.fail === "function") promiseLike.fail(onFail);
            return;
        }
        if (promiseLike && typeof promiseLike.then === "function") {
            promiseLike.then(onDone, onFail);
            return;
        }
        onDone(promiseLike);
    }

    function loadComments(issueKeys, loader, callback, onFail) {
        if (!mods.api.fetchIssueComments) {
            callback({});
            return;
        }
        attachAsync(
            mods.api.fetchIssueComments(issueKeys, function(done, total) {
                loader.update({ phase: "comments", done: done, total: total });
            }),
            function(commentsMap) { callback(commentsMap || {}); },
            onFail
        );
    }

    function loadData(selectedUsers, period) {
        var requestId = ++activeRequestId;
        var requestUsers = cloneUsers(selectedUsers);
        $contentArea.empty();

        var loader = mods.progressLoader.create();
        loader.show();
        $contentArea.append(loader.$el);

        if (requestUsers.length === 0) {
            renderEmptyState();
            return;
        }

        var usersData = new Array(requestUsers.length);
        var pendingUsers = requestUsers.length;
        var hasFailed = false;

        function failLoad(err) {
            if (hasFailed || requestId !== activeRequestId) return;
            hasFailed = true;
            $contentArea.empty().html(
                '<div class="dashboard-card p-8 text-center">' +
                    '<div class="text-destructive font-medium mb-2">Ошибка загрузки</div>' +
                    '<div class="text-sm text-muted-foreground">' + utils.escapeHtml(String(err)) + '</div>' +
                '</div>'
            );
        }

        function continueWithUsers() {
            if (requestId !== activeRequestId) return;

            var allIssueKeys = [];
            var seenKeys = {};
            usersData.forEach(function(ud) {
                (ud.rawData.issues || []).forEach(function(issue) {
                    if (!seenKeys[issue.key]) {
                        seenKeys[issue.key] = true;
                        allIssueKeys.push(issue.key);
                    }
                });
            });

            loadComments(allIssueKeys, loader, function(commentsMap) {
                if (requestId !== activeRequestId) return;

                usersData.forEach(function(ud) {
                    ud.comments = commentsMap || {};
                });

                var processed;
                if (mods.dataProcessor.processMultiUserData) {
                    processed = mods.dataProcessor.processMultiUserData(usersData, period.start, period.end);
                } else {
                    var singleUser = usersData[0];
                    processed = mods.dataProcessor.processData(singleUser.rawData, singleUser.username, period.start, period.end);
                }

                var startDate = new Date(period.start + "T00:00:00");
                var endDate = new Date(period.end + "T23:59:59");
                var allIssues = [];
                var issueSeen = {};
                usersData.forEach(function(ud) {
                    (ud.rawData.issues || []).forEach(function(issue) {
                        if (!issueSeen[issue.key]) {
                            issueSeen[issue.key] = true;
                            allIssues.push(issue);
                        }
                    });
                });

                var requestUserFilter = requestUsers.length === 1
                    ? Object.assign({}, requestUsers[0])
                    : requestUsers.map(function(user) { return user.name; });

                attachAsync(
                    mods.repoApi.fetchRepoActivityForIssues(allIssues, function(progress) {
                        loader.update(progress);
                    }),
                    function(repoData) {
                        if (requestId !== activeRequestId) return;
                        var repoActivity = mods.repoDataProcessor.processRepoActivity(
                            processed.issueMap,
                            repoData && repoData.issueDevStatusMap,
                            requestUserFilter,
                            period.start,
                            period.end
                        );

                        if (repoActivity && repoActivity.dayMap) {
                            Object.keys(repoActivity.dayMap).forEach(function(dateKey) {
                                if (processed.dayMap[dateKey]) {
                                    processed.dayMap[dateKey].repoItems = repoActivity.dayMap[dateKey].items || [];
                                }
                            });
                        }

                        if (requestId !== activeRequestId) return;
                        renderDashboard(processed, startDate, endDate, requestUsers, { activity: repoActivity });
                    },
                    function(err) {
                        if (requestId !== activeRequestId) return;
                        renderDashboard(processed, startDate, endDate, requestUsers, { error: err });
                    }
                );
            }, failLoad);
        }

        requestUsers.forEach(function(user, index) {
            attachAsync(mods.api.fetchAllData(user.name, period.start, period.end, function(progress) {
                loader.update(progress);
            }), function(rawData) {
                if (hasFailed || requestId !== activeRequestId) return;
                usersData[index] = {
                    username: user.name,
                    displayName: user.displayName || user.name,
                    rawData: rawData
                };
                pendingUsers -= 1;
                if (pendingUsers === 0) {
                    continueWithUsers();
                }
            }, failLoad);
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

    function renderDashboard(data, startDate, endDate, selectedUsers, repoState) {
        $contentArea.empty();
        repoState = repoState || {};
        var repoActivity = repoState.activity || null;

        summaryInst = mods.summaryCards.create();
        summaryInst.render(data.stats);
        $contentArea.append(summaryInst.$el);

        var calendarMod = mods.unifiedCalendar || mods.calendarHeatmap;
        var calendar;
        if (mods.unifiedCalendar) {
            calendar = calendarMod.render(data.dayMap, data.issueMap, selectedUsers, startDate, endDate);
        } else {
            calendar = calendarMod.render(data.dayMap, data.issueMap, startDate, endDate);
        }
        $contentArea.append(calendar.$el);

        var repoLogInst = null;

        if (!mods.unifiedCalendar && repoActivity) {
            if (mods.repoCalendar) {
                var repoCalendarInst = mods.repoCalendar.render(repoActivity.dayMap, startDate, endDate);
                $contentArea.append(repoCalendarInst.$el);
                repoCalendarInst.onSelectDate(function(selectedDate) {
                    if (repoLogInst) repoLogInst.render(repoActivity, selectedDate || null);
                });
            }
        } else if (!mods.unifiedCalendar && repoState.error) {
            $contentArea.append(renderRepoStateCard(
                "Репозиторная активность",
                "Не удалось загрузить данные репозиториев."
            ));
        }

        detailInst = mods.dailyDetail.create();
        $contentArea.append(detailInst.$el);

        calendar.onSelectDate(function(dateStr) {
            if (!dateStr) { detailInst.hide(); return; }
            var dayData = data.dayMap[dateStr] || { worklogs: [], changes: [], issues: [], totalHours: 0, allWorklogs: [], allChanges: [], allComments: [], repoItems: [], users: {} };
            detailInst.show(dateStr, dayData, data.issueMap);
        });

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
        var usernameStr = Array.isArray(selectedUsers) ? selectedUsers.map(function(u) { return u.name; }).join(",") : selectedUsers;
        activityLogInst.render(data, usernameStr, utils.getDayKey(startDate), utils.getDayKey(endDate));
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
