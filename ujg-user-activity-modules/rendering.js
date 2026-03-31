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

    var currentTeamIds = [];
    var currentTeams = [];
    var teamPickerInst = null;
    var teamStoreRef = null;
    var teamManagerCtrl = null;
    var pendingUrlTeamIds = null;
    var $popupHost = null;

    var stylesInjected = false;

    function getUsersFromTeams(teams, selectedTeamIds, resolveUser) {
        var seen = Object.create(null);
        var users = [];
        var idSet = Object.create(null);
        (selectedTeamIds || []).forEach(function(id) {
            idSet[String(id)] = true;
        });
        (teams || []).forEach(function(team) {
            if (!team || !idSet[String(team.id)]) return;
            (team.memberKeys || []).forEach(function(memberKey) {
                if (!memberKey || seen[memberKey]) return;
                seen[memberKey] = true;
                users.push(resolveUser(memberKey));
            });
        });
        return users;
    }

    function userSetSignature(users) {
        return (users || [])
            .map(function(u) {
                return u && u.name ? String(u.name) : "";
            })
            .filter(Boolean)
            .sort()
            .join("\0");
    }

    function usersMatchTeamUnion(users, teams, teamIds, resolveUser) {
        var union = getUsersFromTeams(teams, teamIds, resolveUser);
        return userSetSignature(users) === userSetSignature(union);
    }

    function makeResolveUser(store) {
        return function(memberKey) {
            var map = store && store.getDisplayNameByKey ? store.getDisplayNameByKey() : {};
            var dn = (map && map[memberKey]) || memberKey;
            return { name: memberKey, displayName: dn, key: memberKey };
        };
    }

    function parseCommaIds(raw) {
        return String(raw || "")
            .split(",")
            .map(function(s) {
                return s.trim();
            })
            .filter(Boolean);
    }

    function serializeUsers(users) {
        if (!users || !users.length) return "";
        return users
            .map(function(u) {
                return u && u.name ? String(u.name) : "";
            })
            .filter(Boolean)
            .join(",");
    }

    function serializeTeams(teamIds) {
        if (!teamIds || !teamIds.length) return "";
        return teamIds.map(String).join(",");
    }

    function planUrlSerialization(users, teamIds, teams, resolveUser) {
        var teamsStr = "";
        var usersStr = "";
        if (teamIds && teamIds.length && usersMatchTeamUnion(users, teams, teamIds, resolveUser)) {
            teamsStr = serializeTeams(teamIds);
        } else if (users && users.length) {
            usersStr = serializeUsers(users);
        }
        return { teams: teamsStr, users: usersStr };
    }

    /** Разбор URL-параметров users/teams без window (для тестов и зеркало логики инициализации). */
    function applyStateFromUrlParams(params, teams, store) {
        var usersStr = params && params.users != null ? String(params.users).trim() : "";
        var teamsStr = params && params.teams != null ? String(params.teams).trim() : "";
        var resolveUser = makeResolveUser(store || { getDisplayNameByKey: function() { return {}; } });
        if (usersStr) {
            return {
                mode: "users",
                usersParam: usersStr,
                teamIdsForReconcile: teamsStr ? parseCommaIds(teamsStr) : null
            };
        }
        if (teamsStr) {
            var ids = parseCommaIds(teamsStr);
            return {
                mode: "teams",
                teamIds: ids,
                users: getUsersFromTeams(teams, ids, resolveUser)
            };
        }
        return { mode: "empty" };
    }

    function applyUrlQueryFromState() {
        if (typeof window === "undefined" || !window.location || !window.history || !window.history.replaceState) return;
        if (!teamStoreRef || !mods || !mods.multiUserPicker) return;
        var resolveUser = makeResolveUser(teamStoreRef);
        var plan = planUrlSerialization(currentUsers, currentTeamIds, currentTeams, resolveUser);
        var p = new URLSearchParams(window.location.search);
        p.delete("users");
        p.delete("teams");
        if (plan.teams) p.set("teams", plan.teams);
        else if (plan.users) p.set("users", plan.users);
        var q = p.toString();
        var url = window.location.pathname + (q ? "?" + q : "") + (window.location.hash || "");
        window.history.replaceState(null, "", url);
    }

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

    function teamPickerEnabled() {
        return !!(mods && mods.teamStore && mods.teamPicker && typeof mods.teamPicker.create === "function");
    }

    function teamSyncEnabled() {
        return !!(teamPickerEnabled() && mods.multiUserPicker);
    }

    function teamManagerEnabled() {
        return !!(mods && mods.teamManager && typeof mods.teamManager.create === "function");
    }

    function syncUsersFromTeams(options) {
        if (!teamSyncEnabled() || !pickerInstance || !pickerInstance.setSelectedUsers || !teamStoreRef) return;
        var resolveUser = makeResolveUser(teamStoreRef);
        var users = getUsersFromTeams(currentTeams, currentTeamIds, resolveUser);
        pickerInstance.setSelectedUsers(users, {
            source: (options && options.source) || "team-sync"
        });
    }

    function onPickerChange(users, meta) {
        if (Array.isArray(users)) {
            currentUsers = users;
        } else if (users) {
            currentUsers = [users];
        } else {
            currentUsers = [];
        }

        if (teamSyncEnabled() && teamStoreRef) {
            var resolveUser = makeResolveUser(teamStoreRef);
            if (pendingUrlTeamIds && meta && meta.source === "url") {
                if (usersMatchTeamUnion(currentUsers, currentTeams, pendingUrlTeamIds, resolveUser)) {
                    currentTeamIds = pendingUrlTeamIds.slice();
                    if (teamPickerInst) teamPickerInst.setSelectedTeamIds(currentTeamIds, { silent: true });
                }
                pendingUrlTeamIds = null;
            }
            if (meta && meta.source === "manual") {
                if (!usersMatchTeamUnion(currentUsers, currentTeams, currentTeamIds, resolveUser)) {
                    currentTeamIds = [];
                    if (teamPickerInst) teamPickerInst.setSelectedTeamIds([], { silent: true });
                }
            }
            applyUrlQueryFromState();
        }

        if (currentUsers.length === 0) {
            activeRequestId += 1;
            renderEmptyState();
            return;
        }
        if (!mods.multiUserPicker) {
            loadData(currentUsers, currentPeriod || utils.getDefaultPeriod());
        }
    }

    function finishInitialLoad() {
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

    function asJqueryPromise(maybePromise) {
        if (maybePromise && typeof maybePromise.always === "function") return maybePromise;
        var d = $.Deferred();
        d.resolve();
        return d.promise();
    }

    function applyStateFromUrl($header) {
        if (!pickerInstance || !pickerInstance.setFromUrl) return $.when();
        if (!teamSyncEnabled()) {
            return asJqueryPromise(pickerInstance.setFromUrl());
        }
        if (typeof window === "undefined" || !window.location) {
            return asJqueryPromise(pickerInstance.setFromUrl());
        }
        var params = new URLSearchParams(window.location.search);
        var usersStr = params.get("users");
        var teamsStr = params.get("teams");
        pendingUrlTeamIds = null;

        if (usersStr) {
            if (teamsStr) pendingUrlTeamIds = parseCommaIds(teamsStr);
            currentTeamIds = [];
            if (teamPickerInst) teamPickerInst.setSelectedTeamIds([], { silent: true });
            return pickerInstance.setFromUrl({ users: usersStr });
        }
        if (teamsStr) {
            currentTeamIds = parseCommaIds(teamsStr);
            syncUsersFromTeams({ source: "url" });
            if (teamPickerInst) teamPickerInst.setSelectedTeamIds(currentTeamIds.slice(), { silent: true });
            applyUrlQueryFromState();
            return $.when();
        }
        return pickerInstance.setFromUrl();
    }

    function setupTeamPicker($header) {
        if (!teamPickerEnabled()) return;
        if (teamPickerInst && teamPickerInst.destroy) {
            teamPickerInst.destroy();
            teamPickerInst = null;
        }
        currentTeams = mods.teamStore.getTeams() || [];
        teamPickerInst = mods.teamPicker.create({
            mode: "multi",
            teams: currentTeams,
            selectedTeamIds: currentTeamIds.slice(),
            emptyMultiLabel: "Выбор команд",
            onChange: function(nextTeamIds) {
                currentTeamIds = (nextTeamIds || []).map(String);
                syncUsersFromTeams({ source: "team-sync" });
                applyUrlQueryFromState();
            }
        });
        $header.find(".ujg-ua-slot-team").empty().append(teamPickerInst.$el);
    }

    function closeTeamManager() {
        if (teamManagerCtrl && typeof teamManagerCtrl.close === "function") {
            teamManagerCtrl.close();
        } else if (teamManagerCtrl && typeof teamManagerCtrl.destroy === "function") {
            teamManagerCtrl.destroy();
        }
        teamManagerCtrl = null;
    }

    function refreshTeamsAfterManagerChange($header) {
        function applyTeams() {
            var previousTeamIds = currentTeamIds.slice();
            var validTeamIds = Object.create(null);
            currentTeams = teamStoreRef && teamStoreRef.getTeams ? (teamStoreRef.getTeams() || []) : currentTeams;
            currentTeams.forEach(function(team) {
                if (team && team.id != null) validTeamIds[String(team.id)] = true;
            });
            currentTeamIds = currentTeamIds.filter(function(id) {
                return validTeamIds[String(id)];
            });
            setupTeamPicker($header);
            if (previousTeamIds.length) {
                syncUsersFromTeams({ source: "team-sync" });
                applyUrlQueryFromState();
            }
        }

        if (teamStoreRef && typeof teamStoreRef.loadTeams === "function") {
            attachAsync(teamStoreRef.loadTeams(), applyTeams, applyTeams);
            return;
        }
        applyTeams();
    }

    function openTeamManager($header) {
        if (!teamManagerEnabled()) return;
        if (!$popupHost) return;
        closeTeamManager();
        teamManagerCtrl = mods.teamManager.create($popupHost, function() {
            refreshTeamsAfterManagerChange($header);
        });
    }

    function renderShell() {
        if (teamPickerInst && teamPickerInst.destroy) {
            teamPickerInst.destroy();
            teamPickerInst = null;
        }
        closeTeamManager();
        pendingUrlTeamIds = null;
        teamStoreRef = null;
        $popupHost = null;

        $container.empty().addClass("bg-background");

        var canManageTeams = teamManagerEnabled();
        var teamsButtonHtml = canManageTeams
            ? '<button class="ujg-ua-teams-btn ml-auto h-5 px-1.5 rounded border border-border text-[9px] font-medium text-foreground hover:bg-muted flex items-center gap-0.5">' +
                  utils.icon("settings", "w-2.5 h-2.5") +
                  "<span> Команды</span>" +
              "</button>"
            : "";
        var fullscreenBtnClasses =
            "ujg-ua-btn-fullscreen " +
            (canManageTeams ? "" : "ml-auto ") +
            "h-6 w-6 flex items-center justify-center rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground";

        var $header = $(
            '<header class="border-b border-border bg-card/80 backdrop-blur-sm sticky top-0 z-30">' +
                '<div class="m-0.5 flex items-center gap-2 flex-wrap">' +
                    '<div class="flex items-center gap-1.5">' +
                        utils.icon("activity", "w-3.5 h-3.5 text-primary") +
                        '<h1 class="text-[11px] font-bold text-foreground tracking-tight">User Activity</h1>' +
                    "</div>" +
                    '<div class="ujg-ua-slot-team"></div>' +
                    '<div class="ujg-ua-slot-user"></div>' +
                    '<div class="ujg-ua-slot-daterange"></div>' +
                    '<button class="ujg-ua-btn-load h-6 px-2.5 rounded bg-primary text-primary-foreground text-[11px] font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center gap-1">' +
                        utils.icon("download", "w-3 h-3") +
                        " Загрузить" +
                    "</button>" +
                    teamsButtonHtml +
                    '<button class="' + fullscreenBtnClasses + '">' +
                        utils.icon("maximize2", "w-3.5 h-3.5") +
                    "</button>" +
                "</div>" +
            "</header>"
        );
        $container.append($header);

        var pickerMod = mods.multiUserPicker || mods.userPicker;
        pickerInstance = pickerMod.create($container, onPickerChange);
        $header.find(".ujg-ua-slot-user").append(pickerInstance.$el);

        var datePicker = mods.dateRangePicker.create(function(period) {
            currentPeriod = period;
        });
        $header.find(".ujg-ua-slot-daterange").append(datePicker.$el);
        currentPeriod = datePicker.getPeriod();

        $header.find(".ujg-ua-btn-load").on("click", function() {
            if (currentUsers.length === 0) return;
            var period = currentPeriod || utils.getDefaultPeriod();
            loadData(currentUsers, period);
        });

        if (canManageTeams) {
            $header.find(".ujg-ua-teams-btn").on("click", function() {
                openTeamManager($header);
            });
        }

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
        $popupHost = $('<div class="ujg-ua-popup-host"></div>');
        $container.append($popupHost);

        if (teamPickerEnabled()) {
            teamStoreRef = mods.teamStore;
            mods.teamStore.loadTeams().always(function() {
                setupTeamPicker($header);
                var p = applyStateFromUrl($header);
                if (p && typeof p.done === "function") {
                    p.done(finishInitialLoad);
                    if (typeof p.fail === "function") p.fail(finishInitialLoad);
                } else {
                    finishInitialLoad();
                }
            });
        } else {
            var initP = pickerInstance.setFromUrl ? asJqueryPromise(pickerInstance.setFromUrl()) : $.when();
            if (initP && typeof initP.done === "function") {
                initP.done(finishInitialLoad);
                if (typeof initP.fail === "function") initP.fail(finishInitialLoad);
            } else {
                finishInitialLoad();
            }
        }
    }

    function renderEmptyState() {
        $contentArea.empty().html(
            '<div class="flex flex-col items-center justify-center py-32 text-center">' +
                '<div class="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">' +
                utils.icon("activity", "w-8 h-8 text-primary") +
                "</div>" +
                '<h2 class="text-xl font-bold text-foreground mb-2">User Activity Dashboard</h2>' +
                '<p class="text-sm text-muted-foreground max-w-md">Выберите пользователя и период, чтобы увидеть полную статистику активности: залогированное время, задачи, переходы статусов. Для сравнения можно добавить нескольких пользователей.</p>' +
            "</div>"
        );
    }

    function cloneUsers(selectedUsers) {
        var list = Array.isArray(selectedUsers) ? selectedUsers : selectedUsers ? [selectedUsers] : [];
        return list.map(function(user) {
            return Object.assign({}, user);
        });
    }

    function getDetailSelectedUsers(selectedUsers) {
        return cloneUsers(currentUsers.length ? currentUsers : selectedUsers);
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
            function(commentsMap) {
                callback(commentsMap || {});
            },
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
                    '<div class="text-sm text-muted-foreground">' +
                    utils.escapeHtml(String(err)) +
                    "</div>" +
                "</div>"
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
                    processed = mods.dataProcessor.processData(
                        singleUser.rawData,
                        singleUser.username,
                        period.start,
                        period.end
                    );
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

                var requestUserFilter =
                    requestUsers.length === 1
                        ? Object.assign({}, requestUsers[0])
                        : requestUsers.map(function(user) {
                              return Object.assign({}, user);
                          });

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
                                if (!processed.dayMap[dateKey]) {
                                    processed.dayMap[dateKey] = {
                                        users: {},
                                        allWorklogs: [],
                                        allChanges: [],
                                        allComments: [],
                                        totalHours: 0,
                                        repoItems: []
                                    };
                                }
                                processed.dayMap[dateKey].repoItems = (repoActivity.dayMap[dateKey].items || []).slice();
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
            attachAsync(
                mods.api.fetchAllData(user.name, period.start, period.end, function(progress) {
                    loader.update(progress);
                }),
                function(rawData) {
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
                },
                failLoad
            );
        });
    }

    function renderRepoStateCard(title, message) {
        return $(
            '<div class="dashboard-card p-4">' +
                '<div class="text-sm font-semibold text-foreground mb-1">' +
                utils.escapeHtml(title) +
                "</div>" +
                '<div class="text-sm text-muted-foreground">' +
                utils.escapeHtml(message) +
                "</div>" +
            "</div>"
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
            $contentArea.append(
                renderRepoStateCard("Репозиторная активность", "Не удалось загрузить данные репозиториев.")
            );
        }

        detailInst = mods.dailyDetail.create();
        $contentArea.append(detailInst.$el);

        calendar.onSelectDate(function(dateStr) {
            if (!dateStr) {
                detailInst.hide();
                return;
            }
            var dayData = data.dayMap[dateStr] || {
                worklogs: [],
                changes: [],
                issues: [],
                totalHours: 0,
                allWorklogs: [],
                allChanges: [],
                allComments: [],
                repoItems: [],
                users: {}
            };
            detailInst.show(dateStr, dayData, data.issueMap, getDetailSelectedUsers(selectedUsers));
        });

        projBreakInst = mods.projectBreakdown.create();
        var projects = Object.values(data.projectMap).sort(function(a, b) {
            return b.totalHours - a.totalHours;
        });
        var projList = projects.map(function(p) {
            return { key: p.key, hours: p.totalHours, count: p.issueCount };
        });
        projBreakInst.render({ projects: projList, transitions: data.statusTransitions });
        $contentArea.append(projBreakInst.$el);

        issueListInst = mods.issueList.create();
        var issueProjects = projects.map(function(p) {
            var issues = p.issues
                .map(function(k) {
                    var iss = data.issueMap[k];
                    if (!iss) return null;
                    return {
                        key: iss.key,
                        summary: iss.summary,
                        type: iss.type,
                        status: iss.status,
                        hours: iss.totalTimeHours
                    };
                })
                .filter(Boolean)
                .sort(function(a, b) {
                    return b.hours - a.hours;
                });
            return { key: p.key, count: p.issueCount, hours: p.totalHours, issues: issues };
        });
        issueListInst.render(issueProjects);
        $contentArea.append(issueListInst.$el);

        activityLogInst = mods.activityLog.create();
        var usernameStr = Array.isArray(selectedUsers)
            ? selectedUsers
                  .map(function(u) {
                      return u.name;
                  })
                  .join(",")
            : selectedUsers;
        activityLogInst.render(data, usernameStr, utils.getDayKey(startDate), utils.getDayKey(endDate));
        $contentArea.append(activityLogInst.$el);

        if (repoActivity) {
            repoLogInst = mods.repoLog.create();
            repoLogInst.render(repoActivity, null);
            $contentArea.append(repoLogInst.$el);
        } else if (repoState.error) {
            $contentArea.append(
                renderRepoStateCard(
                    "Лог репозиторной активности",
                    "Данные репозиториев недоступны для выбранного периода."
                )
            );
        }
    }

    return {
        init: init,
        getUsersFromTeams: getUsersFromTeams,
        usersMatchTeamUnion: usersMatchTeamUnion,
        serializeUsers: serializeUsers,
        serializeTeams: serializeTeams,
        planUrlSerialization: planUrlSerialization,
        applyStateFromUrlParams: applyStateFromUrlParams
    };
});
