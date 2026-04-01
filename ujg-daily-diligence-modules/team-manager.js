define("_ujgDD_teamManager", ["jquery", "_ujgShared_teamStore", "_ujgDD_config", "_ujgDD_utils"], function(
    $,
    sharedTeamStore,
    config,
    utils
) {
    "use strict";

    var store = sharedTeamStore.create({
        jiraBaseUrl: config.jiraBaseUrl,
        storageKey: config.STORAGE_KEY
    });
    var teams = [];
    var displayNameByKey = {};

    function trimSlash(s) {
        return String(s || "").replace(/\/+$/, "");
    }

    function apiUrl(path) {
        var base = trimSlash(config.jiraBaseUrl || "");
        if (!path) return base;
        if (path.charAt(0) !== "/") path = "/" + path;
        return base + path;
    }

    function normalizeTeams(list) {
        return sharedTeamStore.normalizeTeams(list);
    }

    function syncState() {
        teams = store.getTeams();
        displayNameByKey = store.getDisplayNameByKey();
        return teams;
    }

    function detectDashboardId() {
        return store.detectDashboardId();
    }

    function loadTeams() {
        var req = store.loadTeams();
        req.always(syncState);
        return req;
    }

    function saveTeams(teamsList) {
        var req = store.saveTeams(teamsList);
        syncState();
        req.always(syncState);
        return req;
    }

    function normalizeUserRow(u) {
        if (!u || typeof u !== "object") return null;
        var key = u.accountId || u.key || u.name || u.username || "";
        var displayName = u.displayName || u.name || key || "";
        return { key: String(key), displayName: String(displayName) };
    }

    function searchUsers(query) {
        var d = $.Deferred();
        var q = String(query || "").trim();
        $.ajax({
            url: apiUrl("/rest/api/2/user/search"),
            type: "GET",
            dataType: "json",
            data: { username: q, maxResults: 20 }
        })
            .done(function(raw) {
                var arr = Array.isArray(raw) ? raw : (raw && raw.users) || [];
                var out = [];
                for (var i = 0; i < arr.length; i++) {
                    var row = normalizeUserRow(arr[i]);
                    if (row && row.key) out.push(row);
                }
                d.resolve(out);
            })
            .fail(function(xhr, status, err) {
                d.reject(xhr, status, err);
            });
        return d.promise();
    }

    function getTeams() {
        syncState();
        return teams.slice();
    }

    function memberLabel(key) {
        if (displayNameByKey[key]) return displayNameByKey[key];
        return key;
    }

    function create($parent, onChange) {
        var editingTeamId = null;
        var showCreate = false;
        var searchTimer = null;
        var lastSearchQuery = "";

        var $overlay = $("<div/>").addClass(
            "ujg-dd-teams-overlay fixed inset-0 z-50 overflow-auto bg-background/95 transition-opacity duration-150"
        );
        var $shell = $("<div/>").addClass("min-h-screen bg-background");
        var $header = $("<header/>").addClass(
            "border-b border-border bg-card/80 backdrop-blur-sm sticky top-0 z-30"
        );
        var $headerInner = $("<div/>").addClass("px-4 py-3 flex items-center gap-3");
        var $close = $("<button type=\"button\"/>")
            .addClass(
                "ujg-dd-teams-close h-7 w-7 flex items-center justify-center rounded-md hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
            )
            .attr("title", "Закрыть")
            .html(utils.icon("arrowLeft", "w-4 h-4"));
        var $titleIcon = $("<span/>").html(utils.icon("users", "w-4 h-4 text-primary"));
        var $title = $("<h1/>")
            .addClass("text-sm font-bold text-foreground")
            .text("Управление командами");
        $headerInner.append($close, $titleIcon, $title);
        $header.append($headerInner);

        var $main = $("<main/>").addClass("max-w-4xl mx-auto px-4 py-6");
        var $grid = $("<div/>").addClass("grid grid-cols-1 lg:grid-cols-2 gap-6");
        var $colLeft = $("<div/>");
        var $colRight = $("<div/>");
        $grid.append($colLeft, $colRight);
        $main.append($grid);
        $shell.append($header, $main);
        $overlay.append($shell);
        $overlay.appendTo($parent);

        function notify() {
            if (typeof onChange === "function") onChange(getTeams());
        }

        function persist(next) {
            saveTeams(next).always(notify);
        }

        function render() {
            syncState();
            if (searchTimer) {
                clearTimeout(searchTimer);
                searchTimer = null;
            }
            teams = normalizeTeams(teams);
            $colLeft.empty();
            $colRight.empty();

            var $teamsHeader = $("<div/>").addClass("flex items-center justify-between mb-3");
            $teamsHeader.append(
                $("<h2/>")
                    .addClass("text-xs font-semibold text-muted-foreground uppercase tracking-wider")
                    .text("Команды")
            );
            var $newBtn = $("<button type=\"button\"/>")
                .addClass(
                    "ujg-dd-teams-new h-7 px-3 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors flex items-center gap-1"
                )
                .html(utils.icon("plus", "w-3 h-3") + " <span>Новая</span>");
            $teamsHeader.append($newBtn);
            $colLeft.append($teamsHeader);

            if (showCreate) {
                var $createRow = $("<div/>").addClass("mb-3 overflow-hidden transition-all duration-150");
                var $card = $("<div/>").addClass("dashboard-card p-3 flex items-center gap-2");
                var $nameInput = $("<input type=\"text\"/>")
                    .addClass(
                        "ujg-dd-teams-new-name flex-1 h-8 px-3 text-sm bg-muted/50 border border-border rounded-md text-foreground outline-none focus:ring-1 focus:ring-ring"
                    )
                    .attr("placeholder", "Название команды...");
                var $submitCreate = $("<button type=\"button\"/>")
                    .addClass(
                        "ujg-dd-teams-create-submit h-8 px-3 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90"
                    )
                    .text("Создать");
                var $cancelCreate = $("<button type=\"button\"/>")
                    .addClass(
                        "ujg-dd-teams-create-cancel h-8 w-8 flex items-center justify-center rounded-md hover:bg-muted text-muted-foreground"
                    )
                    .html(utils.icon("x", "w-4 h-4"));
                $card.append($nameInput, $submitCreate, $cancelCreate);
                $createRow.append($card);
                $colLeft.append($createRow);
            }

            var $list = $("<div/>").addClass("space-y-2");
            teams.forEach(function(team) {
                var active = editingTeamId === team.id;
                var $row = $("<div/>").addClass(
                    "ujg-dd-teams-row dashboard-card p-3 cursor-pointer transition-colors " +
                        (active ? "ring-2 ring-primary" : "hover:bg-surface-hover")
                );
                $row.attr("data-team-id", team.id);
                var $top = $("<div/>").addClass("flex items-center justify-between");
                var $meta = $("<div/>");
                $meta.append(
                    $("<div/>").addClass("text-sm font-semibold text-foreground").text(team.name)
                );
                var m = team.memberKeys.length;
                var suffix = utils.pluralize(m, "участник", "участника", "участников");
                $meta.append(
                    $("<div/>")
                        .addClass("text-xs text-muted-foreground mt-0.5")
                        .text(m + " " + suffix)
                );
                var $del = $("<button type=\"button\"/>")
                    .addClass(
                        "ujg-dd-teams-delete h-7 w-7 flex items-center justify-center rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                    )
                    .html(utils.icon("trash2", "w-3.5 h-3.5"))
                    .attr("data-team-id", team.id);
                $top.append($meta, $del);
                $row.append($top);
                if (team.memberKeys.length > 0) {
                    var $tags = $("<div/>").addClass("flex flex-wrap gap-1 mt-2");
                    team.memberKeys.forEach(function(k) {
                        $tags.append(
                            $("<span/>")
                                .addClass("text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium")
                                .text(memberLabel(k))
                        );
                    });
                    $row.append($tags);
                }
                $list.append($row);
            });
            if (teams.length === 0) {
                $list.append(
                    $("<div/>")
                        .addClass("text-center py-12 text-muted-foreground text-sm")
                        .text("Нет команд. Создайте первую!")
                );
            }
            $colLeft.append($list);

            var editTeam = null;
            if (editingTeamId) {
                for (var i = 0; i < teams.length; i++) {
                    if (teams[i].id === editingTeamId) {
                        editTeam = teams[i];
                        break;
                    }
                }
            }

            if (editTeam) {
                $colRight.append(
                    $("<h2/>")
                        .addClass("text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3")
                        .text("Участники — " + editTeam.name)
                );
                var $members = $("<div/>").addClass("space-y-1 mb-4");
                editTeam.memberKeys.forEach(function(key) {
                    var $mrow = $("<div/>").addClass("dashboard-card px-3 py-2 flex items-center justify-between");
                    var $left = $("<div/>").addClass("flex items-center gap-2");
                    var label = memberLabel(key);
                    $left.append(
                        $("<div/>")
                            .addClass(
                                "w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center text-primary text-xs font-bold"
                            )
                            .text(label ? label.charAt(0) : "?")
                    );
                    $left.append(
                        $("<span/>").addClass("text-sm font-medium text-foreground").text(label)
                    );
                    var $rm = $("<button type=\"button\"/>")
                        .addClass(
                            "ujg-dd-teams-remove-member h-6 w-6 flex items-center justify-center rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                        )
                        .html(utils.icon("x", "w-3.5 h-3.5"))
                        .attr("data-team-id", editTeam.id)
                        .attr("data-user-key", key);
                    $mrow.append($left, $rm);
                    $members.append($mrow);
                });
                if (editTeam.memberKeys.length === 0) {
                    $members.append(
                        $("<div/>")
                            .addClass("text-center py-6 text-muted-foreground text-xs")
                            .text("Добавьте участников из списка ниже")
                    );
                }
                $colRight.append($members);

                $colRight.append(
                    $("<h3/>")
                        .addClass("text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2")
                        .text("Доступные пользователи")
                );
                var $searchInput = $("<input type=\"text\"/>")
                    .addClass(
                        "ujg-dd-teams-user-search w-full h-8 px-3 text-sm bg-muted/50 border border-border rounded-md text-foreground outline-none focus:ring-1 focus:ring-ring mb-2"
                    )
                    .attr("placeholder", "Поиск пользователей...");
                var $results = $("<div/>").addClass("ujg-dd-teams-search-results space-y-1");
                $colRight.append($searchInput, $results);

                function renderResults(rows) {
                    $results.empty();
                    var keys = {};
                    editTeam.memberKeys.forEach(function(k) {
                        keys[k] = true;
                    });
                    rows.forEach(function(u) {
                        if (keys[u.key]) return;
                        var $btn = $("<button type=\"button\"/>")
                            .addClass(
                                "ujg-dd-teams-add-member w-full dashboard-card px-3 py-2 flex items-center gap-2 hover:bg-surface-hover transition-colors text-left"
                            )
                            .attr("data-team-id", editTeam.id)
                            .attr("data-user-key", u.key)
                            .attr("data-display-name", u.displayName);
                        $btn.html(
                            utils.icon("userPlus", "w-3.5 h-3.5 text-primary") +
                                '<div class="w-6 h-6 rounded-full bg-muted flex items-center justify-center text-muted-foreground text-xs font-bold">' +
                                utils.escapeHtml(u.displayName ? u.displayName.charAt(0) : "?") +
                                "</div>" +
                                '<span class="text-sm text-foreground">' +
                                utils.escapeHtml(u.displayName) +
                                "</span>"
                        );
                        $results.append($btn);
                    });
                }

                function runSearch() {
                    var q = String($searchInput.val() || "").trim();
                    lastSearchQuery = q;
                    if (!q) {
                        $results.empty();
                        return;
                    }
                    searchUsers(q).done(function(rows) {
                        if (String($searchInput.val() || "").trim() !== lastSearchQuery) return;
                        renderResults(rows);
                    });
                }

                $searchInput.on("input", function() {
                    if (searchTimer) clearTimeout(searchTimer);
                    searchTimer = setTimeout(runSearch, 300);
                });
            } else {
                var $empty = $("<div/>").addClass(
                    "flex flex-col items-center justify-center py-20 text-center"
                );
                $empty.append(utils.icon("users", "w-10 h-10 text-muted-foreground/30 mb-3"));
                $empty.append(
                    $("<p/>")
                        .addClass("text-sm text-muted-foreground")
                        .text("Выберите команду для редактирования")
                );
                $colRight.append($empty);
            }
        }

        var ctrl = {
            close: function() {
                if (searchTimer) clearTimeout(searchTimer);
                $overlay.remove();
            },
            destroy: function() {
                ctrl.close();
            }
        };

        $overlay.on("click", ".ujg-dd-teams-close", function() {
            ctrl.close();
        });

        $overlay.on("click", ".ujg-dd-teams-new", function() {
            showCreate = true;
            render();
        });

        $overlay.on("click", ".ujg-dd-teams-create-submit", function() {
            var name = String($overlay.find(".ujg-dd-teams-new-name").val() || "").trim();
            if (!name) return;
            var team = {
                id: "team-" + Date.now(),
                name: name,
                memberKeys: []
            };
            persist(teams.concat([team]));
            showCreate = false;
            editingTeamId = team.id;
            render();
        });

        $overlay.on("keydown", ".ujg-dd-teams-new-name", function(e) {
            if (e.key === "Enter") {
                $overlay.find(".ujg-dd-teams-create-submit").trigger("click");
            }
        });

        $overlay.on("click", ".ujg-dd-teams-create-cancel", function() {
            showCreate = false;
            render();
        });

        $overlay.on("click", ".ujg-dd-teams-delete", function(e) {
            e.stopPropagation();
            var id = $(this).attr("data-team-id");
            var next = teams.filter(function(t) {
                return t.id !== id;
            });
            if (editingTeamId === id) editingTeamId = null;
            persist(next);
            render();
        });

        $overlay.on("click", ".ujg-dd-teams-row", function(e) {
            if ($(e.target).closest(".ujg-dd-teams-delete").length) return;
            var id = $(this).attr("data-team-id");
            if (!id) return;
            editingTeamId = editingTeamId === id ? null : id;
            render();
        });

        $overlay.on("click", ".ujg-dd-teams-remove-member", function(e) {
            e.stopPropagation();
            var tid = $(this).attr("data-team-id");
            var key = $(this).attr("data-user-key");
            var next = teams.map(function(t) {
                if (t.id !== tid) return t;
                return {
                    id: t.id,
                    name: t.name,
                    memberKeys: t.memberKeys.filter(function(k) {
                        return k !== key;
                    })
                };
            });
            persist(next);
            render();
        });

        $overlay.on("click", ".ujg-dd-teams-add-member", function() {
            var tid = $(this).attr("data-team-id");
            var key = $(this).attr("data-user-key");
            var dn = $(this).attr("data-display-name");
            if (dn) {
                store.setDisplayName(key, dn);
                syncState();
            }
            var next = teams.map(function(t) {
                if (t.id !== tid) return t;
                if (t.memberKeys.indexOf(key) >= 0) return t;
                return {
                    id: t.id,
                    name: t.name,
                    memberKeys: t.memberKeys.concat([key])
                };
            });
            persist(next);
            render();
        });

        loadTeams().always(render);

        return ctrl;
    }

    return {
        detectDashboardId: detectDashboardId,
        loadTeams: loadTeams,
        saveTeams: saveTeams,
        searchUsers: searchUsers,
        create: create,
        getTeams: getTeams,
        memberLabel: memberLabel
    };
});
