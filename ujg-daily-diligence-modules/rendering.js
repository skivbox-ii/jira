define("_ujgDD_rendering", [
    "jquery",
    "_ujgDD_config",
    "_ujgDD_utils",
    "_ujgDD_apiJira",
    "_ujgDD_apiBitbucket",
    "_ujgDD_apiConfluence",
    "_ujgDD_dataProcessor",
    "_ujgDD_teamManager"
], function($, config, utils) {
    "use strict";

    function normalizePrStateLabel(stateValue) {
        var value = String(stateValue || "").toLowerCase();
        if (value === "merged") return "merged";
        if (value === "declined") return "declined";
        return "open";
    }

    function formatCommitSummary(totalCommits) {
        if (totalCommits === 1) return "1 коммит";
        if (totalCommits < 5) return totalCommits + " коммита";
        return totalCommits + " коммитов";
    }

    function dayHasActivity(day) {
        if (!day) return false;
        return Number(day.totalHours || 0) > 0 ||
            ((day.worklogs && day.worklogs.length) || 0) > 0 ||
            ((day.changes && day.changes.length) || 0) > 0 ||
            ((day.commits && day.commits.length) || 0) > 0 ||
            ((day.confluence && day.confluence.length) || 0) > 0 ||
            ((day.pullRequests && day.pullRequests.length) || 0) > 0;
    }

    function extractErrorMessage(argsLike) {
        var args = Array.prototype.slice.call(argsLike || []);
        var i;
        var candidate;
        for (i = 0; i < args.length; i++) {
            candidate = args[i];
            if (!candidate) continue;
            if (candidate.message) return String(candidate.message);
            if (candidate.responseText) return String(candidate.responseText);
        }
        for (i = args.length - 1; i >= 0; i--) {
            candidate = args[i];
            if (typeof candidate !== "string") continue;
            if (candidate && candidate !== "error" && candidate !== "timeout" && candidate !== "abort" && candidate !== "parsererror") {
                return candidate;
            }
        }
        return "Не удалось загрузить данные";
    }

    function isNodeWithin(node, parentNode) {
        var cur = node;
        while (cur) {
            if (cur === parentNode) return true;
            cur = cur.parentNode;
        }
        return false;
    }

    function emptyJiraData() {
        return { issues: [] };
    }

    function emptyBitbucketData() {
        return { commits: [], pullRequests: [] };
    }

    function emptyConfluenceData() {
        return [];
    }

    function callApi(fn, args, fallbackValue) {
        var deferred;
        if (typeof fn === "function") return fn.apply(null, args || []);
        deferred = $.Deferred();
        deferred.resolve(typeof fallbackValue === "function" ? fallbackValue() : (fallbackValue || {}));
        return deferred.promise();
    }

    function attachPromise(promise, done, fail) {
        if (!promise || typeof promise.done !== "function") {
            done({});
            return;
        }
        promise.done(function(value) {
            done(value);
        });
        if (typeof promise.fail === "function") {
            promise.fail(function() {
                fail.apply(null, arguments);
            });
        }
    }

    function joinRequests(jiraPromise, bitbucketPromise, confluencePromise) {
        var deferred = $.Deferred();
        var failed = false;
        var remaining = 3;
        var results = [emptyJiraData(), emptyBitbucketData(), emptyConfluenceData()];

        function resolveAt(index) {
            return function(value) {
                if (failed) return;
                results[index] = value;
                remaining -= 1;
                if (remaining === 0) {
                    deferred.resolve(results[0], results[1], results[2]);
                }
            };
        }

        function reject() {
            if (failed) return;
            failed = true;
            deferred.reject.apply(deferred, arguments);
        }

        function resolveFallback(index, label, factory) {
            return function() {
                if (failed) return;
                if (utils && typeof utils.log === "function") {
                    utils.log(label, extractErrorMessage(arguments));
                }
                resolveAt(index)(factory());
            };
        }

        attachPromise(jiraPromise, resolveAt(0), reject);
        attachPromise(bitbucketPromise, resolveAt(1), resolveFallback(1, "Bitbucket load failed", emptyBitbucketData));
        attachPromise(confluencePromise, resolveAt(2), resolveFallback(2, "Confluence load failed", emptyConfluenceData));

        return deferred.promise();
    }

    function init($el, modules) {
        var node = $el && $el[0];
        if (node && node.__ujgDDController && typeof node.__ujgDDController.destroy === "function") {
            node.__ujgDDController.destroy();
        }
        var controller = createController($el, modules || {});
        if (node) node.__ujgDDController = controller;
        controller.init();
        return controller;
    }

    function createController($container, mods) {
        var defaultRange = utils.getDefaultRange();
        var popupCtrl = null;
        var activeRequestId = 0;
        var destroyed = false;
        var documentHandler = null;
        var dateControlsNode = null;
        var $renderHost = null;
        var $popupHost = null;
        var state = {
            teams: [],
            selectedTeamId: "",
            startDate: defaultRange[0],
            endDate: defaultRange[1],
            showPresets: false,
            isTeamsLoaded: false,
            loading: false,
            error: "",
            teamData: null
        };

        function normalizeId(value) {
            return value == null ? "" : String(value);
        }

        function normalizeTeams(list) {
            var out = [];
            var i;
            var src;
            var memberKeys;
            if (!Array.isArray(list)) return out;
            for (i = 0; i < list.length; i++) {
                src = list[i] && typeof list[i] === "object" ? list[i] : {};
                memberKeys = Array.isArray(src.memberKeys) ? src.memberKeys.filter(function(key) {
                    return key != null && key !== "";
                }).map(function(key) {
                    return String(key);
                }) : [];
                out.push({
                    id: normalizeId(src.id),
                    name: src.name != null ? String(src.name) : "",
                    memberKeys: memberKeys
                });
            }
            return out;
        }

        function syncSelectedTeam() {
            var selectedId = normalizeId(state.selectedTeamId);
            var i;
            var exists = false;
            for (i = 0; i < state.teams.length; i++) {
                if (state.teams[i].id === selectedId) {
                    exists = true;
                    break;
                }
            }
            state.selectedTeamId = exists ? selectedId : (state.teams[0] ? state.teams[0].id : "");
        }

        function getSelectedTeam() {
            var selectedId = normalizeId(state.selectedTeamId);
            var i;
            for (i = 0; i < state.teams.length; i++) {
                if (state.teams[i].id === selectedId) return state.teams[i];
            }
            return null;
        }

        function closePopup() {
            if (popupCtrl && typeof popupCtrl.close === "function") {
                popupCtrl.close();
            }
            popupCtrl = null;
        }

        function ensureHosts() {
            if (
                $renderHost && $renderHost[0] &&
                $popupHost && $popupHost[0] &&
                $renderHost[0].parentNode === $container[0] &&
                $popupHost[0].parentNode === $container[0]
            ) {
                return;
            }

            $renderHost = $("<div/>").addClass("ujg-dd-render-host");
            $popupHost = $("<div/>").addClass("ujg-dd-popup-host");
            $container.empty().append($renderHost, $popupHost);
        }

        function destroy() {
            destroyed = true;
            activeRequestId += 1;
            closePopup();
            dateControlsNode = null;
            $renderHost = null;
            $popupHost = null;
            if (documentHandler && typeof document !== "undefined" && typeof document.removeEventListener === "function") {
                document.removeEventListener("mousedown", documentHandler);
            }
            documentHandler = null;
            if ($container && $container[0] && $container[0].__ujgDDController === api) {
                delete $container[0].__ujgDDController;
            }
        }

        function bindDocumentEvents() {
            if (documentHandler || typeof document === "undefined" || typeof document.addEventListener !== "function") return;
            documentHandler = function(e) {
                if (destroyed || !state.showPresets) return;
                if (dateControlsNode && isNodeWithin(e && e.target, dateControlsNode)) return;
                state.showPresets = false;
                render();
            };
            document.addEventListener("mousedown", documentHandler);
        }

        function clearLoadedRangeState() {
            activeRequestId += 1;
            state.loading = false;
            state.error = "";
            state.teamData = null;
        }

        function setRange(nextStartDate, nextEndDate, closePresets) {
            var nextStart = String(nextStartDate || "");
            var nextEnd = String(nextEndDate || "");
            var changed = nextStart !== state.startDate || nextEnd !== state.endDate;
            state.startDate = nextStart;
            state.endDate = nextEnd;
            if (closePresets) {
                state.showPresets = false;
            }
            if (changed) {
                clearLoadedRangeState();
            }
            render();
        }

        function loadTeams() {
            var loader = mods.teamManager && mods.teamManager.loadTeams;
            if (typeof loader !== "function") {
                state.isTeamsLoaded = true;
                render();
                return;
            }
            loader()
                .done(function(teams) {
                    if (destroyed) return;
                    state.teams = normalizeTeams(teams);
                    syncSelectedTeam();
                    state.isTeamsLoaded = true;
                    state.loading = false;
                    state.error = "";
                    render();
                    autoLoadSelectedTeam();
                })
                .fail(function() {
                    if (destroyed) return;
                    activeRequestId += 1;
                    state.teams = [];
                    state.selectedTeamId = "";
                    state.teamData = null;
                    state.loading = false;
                    state.isTeamsLoaded = true;
                    state.error = extractErrorMessage(arguments);
                    render();
                });
        }

        function autoLoadSelectedTeam() {
            var team = getSelectedTeam();
            if (!team || !team.memberKeys.length) return;
            loadCurrentTeam();
        }

        function loadCurrentTeam() {
            var team = getSelectedTeam();
            var requestId;
            var memberKeys;
            var startDate;
            var endDate;
            if (!team || !team.memberKeys.length) {
                state.loading = false;
                state.error = "";
                state.teamData = null;
                render();
                return;
            }

            requestId = ++activeRequestId;
            memberKeys = team.memberKeys.slice();
            startDate = state.startDate;
            endDate = state.endDate;
            state.loading = true;
            state.error = "";
            state.teamData = null;
            render();

            joinRequests(
                callApi(mods.apiJira && mods.apiJira.fetchTeamData, [memberKeys, startDate, endDate, function() {}], emptyJiraData),
                callApi(mods.apiBitbucket && mods.apiBitbucket.fetchTeamActivity, [memberKeys, startDate, endDate, function() {}], emptyBitbucketData),
                callApi(mods.apiConfluence && mods.apiConfluence.fetchTeamActivity, [memberKeys, startDate, endDate, function() {}], emptyConfluenceData)
            )
                .done(function(jiraData, bitbucketData, confluenceData) {
                    var processed;
                    if (destroyed || requestId !== activeRequestId) return;
                    try {
                        processed = mods.dataProcessor && typeof mods.dataProcessor.processTeamData === "function"
                            ? mods.dataProcessor.processTeamData(
                                jiraData,
                                bitbucketData,
                                confluenceData,
                                memberKeys,
                                startDate,
                                endDate
                            )
                            : null;
                    } catch (err) {
                        if (destroyed || requestId !== activeRequestId) return;
                        state.loading = false;
                        state.teamData = null;
                        state.error = extractErrorMessage([err]);
                        render();
                        return;
                    }
                    if (destroyed || requestId !== activeRequestId) return;
                    state.loading = false;
                    state.error = "";
                    state.teamData = processed || {};
                    render();
                })
                .fail(function() {
                    if (destroyed || requestId !== activeRequestId) return;
                    state.loading = false;
                    state.teamData = null;
                    state.error = extractErrorMessage(arguments);
                    render();
                });
        }

        function onTeamsChanged(nextTeams) {
            if (destroyed) return;
            state.teams = normalizeTeams(nextTeams);
            syncSelectedTeam();
            clearLoadedRangeState();
            render();
            autoLoadSelectedTeam();
        }

        function openTeamManager() {
            if (!mods.teamManager || typeof mods.teamManager.create !== "function") return;
            ensureHosts();
            closePopup();
            popupCtrl = mods.teamManager.create($popupHost, onTeamsChanged);
        }

        function render() {
            var selectedTeam = getSelectedTeam();
            var presets = typeof utils.getPresets === "function" ? utils.getPresets() : [];
            var $dateControls;
            var $headerInner;
            var $main;
            if (destroyed) return;

            ensureHosts();
            $container.addClass("min-h-screen bg-background w-full");
            $renderHost.empty();
            $headerInner = $("<div/>").addClass("px-1 py-1 flex items-center gap-1.5 flex-wrap");
            $dateControls = buildDateControls(presets);
            dateControlsNode = $dateControls[0] || null;
            $headerInner.append(
                $("<span/>").html(utils.icon("activity", "w-3 h-3 text-primary")),
                $("<span/>").addClass("text-[9px] font-bold text-foreground").text("Team Dashboard"),
                buildTeamSelect(),
                $dateControls,
                buildLoadButton(),
                buildLegend(),
                buildTeamsButton()
            );
            $renderHost.append(
                $("<header/>")
                    .addClass("border-b border-border bg-card/80 backdrop-blur-sm sticky top-0 z-30")
                    .append($headerInner)
            );

            $main = $("<main/>").addClass("w-full");
            if (!state.isTeamsLoaded) {
                $main.append($("<div/>").addClass("flex items-center justify-center py-20"));
            } else if (state.loading) {
                $main.append(renderLoadingState());
            } else if (state.error) {
                $main.append(renderErrorState());
            } else if (!selectedTeam || !selectedTeam.memberKeys.length) {
                $main.append(renderEmptyState());
            } else if (state.teamData) {
                $main.append(renderDataState(selectedTeam));
            }
            $renderHost.append($main);

            if (typeof mods.resize === "function") {
                mods.resize();
            }
        }

        function buildTeamSelect() {
            var $select = $("<select/>")
                .addClass("ujg-dd-team-select h-5 px-1 pr-4 text-[9px] bg-card border border-border rounded text-foreground outline-none focus:ring-1 focus:ring-ring appearance-none cursor-pointer")
                .val(state.selectedTeamId);

            state.teams.forEach(function(team) {
                $select.append($("<option/>").attr("value", team.id).text(team.name + " (" + team.memberKeys.length + ")"));
            });

            $select.val(state.selectedTeamId);
            $select.on("change", function() {
                state.selectedTeamId = normalizeId($select.val());
                clearLoadedRangeState();
                render();
                autoLoadSelectedTeam();
            });

            return $("<div/>")
                .addClass("relative")
                .append($select)
                .append(
                    $("<span/>")
                        .addClass("pointer-events-none absolute right-0.5 top-1/2 -translate-y-1/2")
                        .html(utils.icon("chevronDown", "w-2.5 h-2.5 text-muted-foreground"))
                );
        }
        function buildDateControls(presets) {
            var $wrap = $("<div/>").addClass("ujg-dd-date-controls flex items-center gap-0.5 relative");
            var $dropdown = $("<div/>")
                .addClass("ujg-dd-presets absolute top-full left-0 mt-0.5 z-50 bg-card border border-border rounded shadow-lg min-w-[130px]");
            var $start = $("<input type=\"date\"/>")
                .addClass("ujg-dd-start-date h-5 px-0.5 text-[9px] bg-card border border-border rounded text-foreground outline-none focus:ring-1 focus:ring-ring")
                .val(state.startDate);
            var $end = $("<input type=\"date\"/>")
                .addClass("ujg-dd-end-date h-5 px-0.5 text-[9px] bg-card border border-border rounded text-foreground outline-none focus:ring-1 focus:ring-ring")
                .val(state.endDate);

            if (!state.showPresets) $dropdown.attr("hidden", "hidden");

            presets.forEach(function(preset) {
                $dropdown.append(
                    $("<button type=\"button\"/>")
                        .addClass("w-full text-left px-1.5 py-0.5 text-[9px] text-foreground hover:bg-muted/60 first:rounded-t last:rounded-b")
                        .text(preset.label)
                        .on("click", function() {
                            setRange(preset.from, preset.to, true);
                        })
                );
            });

            $start.on("change", function() {
                setRange($start.val(), state.endDate, false);
            });
            $end.on("change", function() {
                setRange(state.startDate, $end.val(), false);
            });

            return $wrap
                .append(
                    $("<button type=\"button\"/>")
                        .addClass("ujg-dd-presets-toggle h-5 w-5 flex items-center justify-center rounded hover:bg-muted text-muted-foreground hover:text-foreground")
                        .html(utils.icon("calendarRange", "w-2.5 h-2.5"))
                        .on("click", function() {
                            state.showPresets = !state.showPresets;
                            render();
                        })
                )
                .append($dropdown)
                .append($start)
                .append($("<span/>").addClass("text-muted-foreground text-[8px]").text("—"))
                .append($end);
        }

        function buildLoadButton() {
            var team = getSelectedTeam();
            return $("<button type=\"button\"/>")
                .addClass("ujg-dd-load-btn h-5 px-1.5 rounded bg-primary text-primary-foreground text-[9px] font-medium hover:bg-primary/90 disabled:opacity-50 flex items-center gap-0.5")
                .prop("disabled", !team || state.loading)
                .html(utils.icon("download", "w-2.5 h-2.5"))
                .append($("<span/>").text(" Загрузить"))
                .on("click", function() {
                    loadCurrentTeam();
                });
        }

        function buildLegend() {
            return $("<div/>")
                .addClass("flex items-center gap-2 ml-2 text-[8px] text-muted-foreground")
                .append(legendItem("fileText", "Jira"))
                .append(legendItem("bookOpen", "Confluence"))
                .append(legendItem("gitCommit", "Git + PR"));
        }

        function legendItem(iconName, text) {
            return $("<span/>")
                .addClass("flex items-center gap-0.5")
                .append($("<span/>").html(utils.icon(iconName, "w-2.5 h-2.5")))
                .append($("<span/>").text(text));
        }

        function buildTeamsButton() {
            return $("<button type=\"button\"/>")
                .addClass("ujg-dd-teams-btn ml-auto h-5 px-1.5 rounded border border-border text-[9px] font-medium text-foreground hover:bg-muted flex items-center gap-0.5")
                .append($("<span/>").html(utils.icon("settings", "w-2.5 h-2.5")))
                .append($("<span/>").text(" Команды"))
                .on("click", function() {
                    openTeamManager();
                });
        }

        function renderEmptyState() {
            return $("<div/>")
                .addClass("ujg-dd-empty flex flex-col items-center justify-center py-32 text-center")
                .append($("<span/>").html(utils.icon("users", "w-10 h-10 text-muted-foreground/30 mb-3")))
                .append(
                    $("<p/>")
                        .addClass("text-[9px] text-muted-foreground mb-3")
                        .text(state.teams.length === 0 ? "Создайте команду" : "Добавьте участников")
                )
                .append(
                    $("<button type=\"button\"/>")
                        .addClass("ujg-dd-configure-btn h-5 px-2 rounded bg-primary text-primary-foreground text-[9px] font-medium hover:bg-primary/90 inline-flex items-center gap-0.5")
                        .append($("<span/>").html(utils.icon("settings", "w-3 h-3")))
                        .append($("<span/>").text(" Настроить"))
                        .on("click", function() {
                            openTeamManager();
                        })
                );
        }

        function renderLoadingState() {
            return $("<div/>")
                .addClass("flex items-center justify-center py-20")
                .append($("<div/>").addClass("ujg-dd-loading text-[9px] text-muted-foreground font-mono animate-pulse").text("Загрузка..."));
        }

        function renderErrorState() {
            return $("<div/>")
                .addClass("ujg-dd-error p-3")
                .append(
                    $("<div/>")
                        .addClass("rounded border border-destructive/30 bg-destructive/5 px-3 py-2")
                        .append($("<div/>").addClass("text-[9px] font-semibold text-destructive").text("Ошибка загрузки"))
                        .append($("<div/>").addClass("text-[8px] text-muted-foreground mt-1").text(state.error))
                );
        }

        function renderDataState(team) {
            var $wrap = $("<div/>").addClass("ujg-dd-data");
            getVisibleDates().forEach(function(date) {
                if (!teamDateHasActivity(team, date)) return;
                $wrap.append(renderDateGroup(team, date));
            });
            return $wrap;
        }

        function getVisibleDates() {
            return utils.getDatesInRange(state.startDate, state.endDate).filter(function(date) {
                var day = new Date(date).getDay();
                return day !== 0 && day !== 6;
            }).reverse();
        }

        function teamDateHasActivity(team, date) {
            var i;
            var userData;
            var day;
            for (i = 0; i < team.memberKeys.length; i++) {
                userData = state.teamData && state.teamData[team.memberKeys[i]];
                day = userData && userData.dayMap && userData.dayMap[date];
                if (dayHasActivity(day)) return true;
            }
            return false;
        }

        function renderDateGroup(team, date) {
            var dt = new Date(date);
            var label = config.WEEKDAYS_RU[dt.getDay()] + ", " + dt.getDate() + " " + config.MONTHS_RU[dt.getMonth()];
            var $group = $("<div/>").addClass("ujg-dd-day-group");
            $group.append(
                $("<div/>")
                    .addClass("ujg-dd-date-sticker sticky top-[28px] z-20 bg-muted/90 backdrop-blur-sm border-b border-border px-1 py-[1px]")
                    .append($("<span/>").addClass("text-[9px] font-bold text-foreground").text(label))
            );
            team.memberKeys.forEach(function(userKey) {
                var userData = state.teamData && state.teamData[userKey];
                var day = userData && userData.dayMap && userData.dayMap[date];
                if (!dayHasActivity(day)) return;
                $group.append(renderUserRow(userKey, userData || { issueMap: {} }, day));
            });
            return $group;
        }
        function renderUserRow(userKey, userData, day) {
            return $("<div/>")
                .addClass("ujg-dd-user-row border-b border-border flex text-[9px]")
                .append(renderNameColumn(userKey, day))
                .append(renderJiraColumn(userData, day))
                .append(renderConfluenceColumn(day))
                .append(renderGitColumn(day));
        }

        function renderNameColumn(userKey, day) {
            var name = String(userKey || "");
            var $metrics = $("<div/>").addClass("flex items-center gap-1 pl-3.5 flex-wrap");
            var $col = $("<div/>").addClass("w-[100px] shrink-0 px-1 py-[1px] border-r border-border bg-card/50 flex flex-col gap-0");

            if (Number(day.totalHours || 0) > 0) {
                $metrics.append($("<span/>").addClass("text-[8px] font-bold text-muted-foreground").text(day.totalHours + "ч"));
            }
            if (day.worklogLoggedLate) {
                $metrics.append(
                    $("<span/>")
                        .addClass("text-[7px] text-destructive flex items-center gap-0.5")
                        .append($("<span/>").html(utils.icon("alertTriangle", "w-2 h-2")))
                        .append($("<span/>").text("поздн"))
                );
            }
            if (day.hasEveningCommit) {
                $metrics.append(
                    $("<span/>")
                        .addClass("text-[7px] text-success flex items-center gap-0.5")
                        .append($("<span/>").html(utils.icon("checkCircle", "w-2 h-2")))
                        .append($("<span/>").text("вечер"))
                );
            }

            $col.append(
                $("<div/>")
                    .addClass("flex items-center gap-0.5")
                    .append(
                        $("<div/>")
                            .addClass("w-3 h-3 rounded-full bg-primary/10 flex items-center justify-center text-primary text-[7px] font-bold shrink-0")
                            .text(name ? name.charAt(0).toUpperCase() : "?")
                    )
                    .append($("<span/>").addClass("font-medium text-foreground truncate text-[8px]").text(name))
            );
            $col.append($metrics);
            if (day.lastCommitTime) {
                $col.append($("<span/>").addClass("text-[7px] text-muted-foreground pl-3.5").text("последн.коммит " + day.lastCommitTime));
            }
            return $col;
        }

        function renderJiraColumn(userData, day) {
            var $col = $("<div/>").addClass("flex-1 min-w-0 border-r border-border");
            var issueMap = (userData && userData.issueMap) || {};
            var hasRows = false;
            (day.worklogs || []).forEach(function(worklog) {
                var isLate = worklog.loggedAt >= "20:00";
                var issue = issueMap[worklog.issueKey] || {};
                hasRows = true;
                $col.append(
                    $("<div/>")
                        .addClass("flex items-baseline gap-1 px-1 py-[0px] border-b border-border last:border-b-0 hover:bg-muted/20" + (isLate ? " bg-destructive/5" : ""))
                        .append($("<span/>").addClass("font-mono text-[7px] shrink-0 " + (isLate ? "text-destructive" : "text-muted-foreground")).text(worklog.loggedAt || ""))
                        .append($("<span/>").html(utils.icon("clock", "w-2 h-2 text-muted-foreground shrink-0 relative top-[1px]")))
                        .append($("<span/>").addClass("font-mono text-[8px] text-primary shrink-0").text(worklog.issueKey || ""))
                        .append($("<span/>").addClass("text-foreground truncate flex-1 text-[8px]").text(issue.summary || ""))
                        .append($("<span/>").addClass("font-bold text-foreground shrink-0 text-[8px]").text((worklog.timeSpentHours || 0) + "ч"))
                        .append(
                            worklog.comment
                                ? $("<span/>").addClass("text-muted-foreground text-[7px] shrink-0 max-w-[80px] truncate").text(worklog.comment)
                                : $("<span/>")
                        )
                );
            });
            (day.changes || []).forEach(function(change) {
                hasRows = true;
                $col.append(
                    $("<div/>")
                        .addClass("flex items-center gap-1 px-1 py-[0px] border-b border-border last:border-b-0 hover:bg-muted/20")
                        .append($("<span/>").html(utils.icon("arrowRight", "w-2 h-2 text-muted-foreground shrink-0")))
                        .append($("<span/>").addClass("font-mono text-[8px] text-primary shrink-0").text(change.issueKey || ""))
                        .append($("<span/>").addClass("text-[8px] text-warning").text(change.fromString || ""))
                        .append($("<span/>").html(utils.icon("arrowRight", "w-1.5 h-1.5 text-muted-foreground")))
                        .append($("<span/>").addClass("text-[8px] text-success").text(change.toString || ""))
                );
            });
            if (!hasRows) {
                $col.append($("<div/>").addClass("px-1 py-[0px] text-[7px] text-muted-foreground/30").text("—"));
            }
            return $col;
        }

        function renderConfluenceColumn(day) {
            var $col = $("<div/>").addClass("flex-1 min-w-0 border-r border-border max-w-[20%]");
            var rows = day.confluence || [];
            if (!rows.length) {
                return $col.append($("<div/>").addClass("px-1 py-[0px] text-[7px] text-muted-foreground/30").text("—"));
            }
            rows.forEach(function(entry) {
                $col.append(
                    $("<div/>")
                        .addClass("flex items-center gap-1 px-1 py-[0px] border-b border-border last:border-b-0 hover:bg-muted/20")
                        .append($("<span/>").html(utils.icon("bookOpen", "w-2 h-2 text-muted-foreground shrink-0")))
                        .append($("<span/>").addClass("text-[8px] text-accent-foreground font-medium shrink-0").text(config.CONFLUENCE_ACTION_LABELS[entry.action] || entry.action || ""))
                        .append($("<span/>").addClass("font-mono text-[7px] text-muted-foreground shrink-0").text(entry.space || ""))
                        .append($("<span/>").addClass("text-foreground truncate flex-1 text-[8px]").text(entry.pageTitle || ""))
                );
            });
            return $col;
        }

        function renderGitColumn(day) {
            var $col = $("<div/>").addClass("flex-1 min-w-0");
            var commits = day.commits || [];
            var pullRequests = day.pullRequests || [];
            var repoMap = {};
            var totalAdded = 0;
            var totalRemoved = 0;

            commits.forEach(function(commit) {
                totalAdded += Number(commit.linesAdded || 0);
                totalRemoved += Number(commit.linesRemoved || 0);
                if (!repoMap[commit.repo]) repoMap[commit.repo] = 0;
                repoMap[commit.repo] += 1;
            });
            if (commits.length) {
                var $summary = $("<div/>").addClass("flex items-center gap-1 px-1 py-[0px] border-b border-border bg-muted/10");
                $summary.append($("<span/>").html(utils.icon("gitCommit", "w-2 h-2 text-muted-foreground shrink-0")));
                $summary.append($("<span/>").addClass("text-[8px] font-bold text-foreground").text(formatCommitSummary(commits.length)));
                $summary.append($("<span/>").addClass("text-success text-[8px] font-mono").text("+" + totalAdded));
                $summary.append($("<span/>").addClass("text-destructive text-[8px] font-mono").text("−" + totalRemoved));
                Object.keys(repoMap).forEach(function(repo) {
                    $summary.append($("<span/>").addClass("text-[7px] text-muted-foreground ml-0.5").text(repo + ":" + repoMap[repo]));
                });
                $col.append($summary);
            }

            commits.forEach(function(commit) {
                $col.append(
                    $("<div/>")
                        .addClass("flex items-center gap-1 px-1 py-[0px] border-b border-border last:border-b-0 hover:bg-muted/20")
                        .append($("<span/>").addClass("font-mono text-[7px] text-muted-foreground shrink-0").text(commit.time || ""))
                        .append($("<span/>").addClass("font-mono text-[7px] text-primary shrink-0").text(commit.repo || ""))
                        .append($("<span/>").addClass("text-foreground truncate flex-1 text-[8px]").text(commit.message || ""))
                        .append($("<span/>").addClass("text-success text-[7px] shrink-0").text("+" + Number(commit.linesAdded || 0)))
                        .append($("<span/>").addClass("text-destructive text-[7px] shrink-0").text("−" + Number(commit.linesRemoved || 0)))
                );
            });

            pullRequests.forEach(function(pr) {
                var normalizedState = normalizePrStateLabel(pr.state);
                var statusClass = normalizedState === "merged" ? "text-success" : (normalizedState === "declined" ? "text-destructive" : "text-warning");
                var reaction = pr.reactionMinutes != null ? "⏱" + utils.fmtReaction(pr.reactionMinutes) : "";
                $col.append(
                    $("<div/>")
                        .addClass("flex items-center gap-1 px-1 py-[0px] border-b border-border last:border-b-0 hover:bg-muted/20 bg-accent/5")
                        .append($("<span/>").html(utils.icon("gitPullRequest", "w-2 h-2 text-muted-foreground shrink-0")))
                        .append($("<span/>").addClass("text-[7px] font-medium shrink-0 " + statusClass).text(normalizedState))
                        .append($("<span/>").addClass("font-mono text-[7px] text-primary shrink-0").text(pr.repo || ""))
                        .append($("<span/>").addClass("text-foreground truncate flex-1 text-[8px]").text(pr.title || ""))
                        .append(
                            reaction
                                ? $("<span/>").addClass("text-[7px] font-bold shrink-0 " + utils.reactionColor(pr.reactionMinutes)).text(reaction)
                                : $("<span/>")
                        )
                );
            });

            if (!commits.length && !pullRequests.length) {
                $col.append($("<div/>").addClass("px-1 py-[0px] text-[7px] text-muted-foreground/30").text("—"));
            }
            return $col;
        }

        var api = {
            init: function() {
                bindDocumentEvents();
                render();
                loadTeams();
                return api;
            },
            destroy: destroy
        };

        return api;
    }

    return { init: init };
});
