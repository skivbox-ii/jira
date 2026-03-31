define("_ujgUA_multiUserPicker", ["jquery", "_ujgUA_config", "_ujgUA_api"], function($, _config, api) {
    "use strict";

    var nextPickerId = 1;

    function create($container, onChange) {
        var pickerId = nextPickerId++;
        var selectedUsers = [];
        var searchResults = [];
        var searchTimer = null;
        var panelOpen = false;

        var $root = $(
            '<div class="ujg-ua-multi-picker">' +
                '<button type="button" class="aui-button ujg-ua-picker-trigger">0 пользователей</button>' +
                '<div class="ujg-ua-picker-panel" style="display:none">' +
                    '<input type="search" class="ujg-ua-picker-search" placeholder="Поиск пользователей...">' +
                    '<div class="ujg-ua-picker-selected"></div>' +
                    '<div class="ujg-ua-picker-actions">' +
                        '<button type="button" class="aui-button aui-button-link">Сбросить</button>' +
                    '</div>' +
                    '<div class="ujg-ua-picker-results"></div>' +
                '</div>' +
            '</div>'
        );

        if ($container && $container.length) {
            $container.append($root);
        }

        var $trigger = $root.find(".ujg-ua-picker-trigger");
        var $panel = $root.find(".ujg-ua-picker-panel");
        var $search = $root.find(".ujg-ua-picker-search");
        var $chipsWrap = $root.find(".ujg-ua-picker-selected");
        var $results = $root.find(".ujg-ua-picker-results");
        var $btnReset = $root.find(".ujg-ua-picker-actions button");

        function normalizeUser(u) {
            var name = (u && (u.name || u.key)) || "";
            return {
                name: name,
                displayName: (u && u.displayName) || name,
                key: (u && u.key) || name
            };
        }

        function selectedIndexByName(name) {
            for (var i = 0; i < selectedUsers.length; i++) {
                if (selectedUsers[i].name === name) return i;
            }
            return -1;
        }

        function isSelected(name) {
            return selectedIndexByName(name) >= 0;
        }

        function updateTriggerText() {
            var n = selectedUsers.length;
            if (n === 0) {
                $trigger.text("0 пользователей");
            } else if (n === 1) {
                $trigger.text(selectedUsers[0].displayName || selectedUsers[0].name);
            } else {
                $trigger.text(n + " выбрано");
            }
        }

        function renderChips() {
            $chipsWrap.empty();
            for (var i = 0; i < selectedUsers.length; i++) {
                var u = selectedUsers[i];
                var $chip = $('<span class="ujg-ua-user-chip"></span>');
                $chip.append($("<span></span>").text(u.displayName || u.name));
                var $remove = $('<button type="button" class="ujg-ua-chip-remove" aria-label="Удалить"></button>');
                $remove.text("\u00d7");
                $remove.attr("data-name", u.name);
                $chip.append($remove);
                $chipsWrap.append($chip);
            }
            updateTriggerText();
        }

        function notifyChange(options) {
            if (onChange) {
                onChange(selectedUsers, {
                    source: (options && options.source) || "manual"
                });
            }
        }

        function setSelectedUsers(nextUsers, options) {
            selectedUsers = (nextUsers || []).map(normalizeUser);
            renderChips();
            if (panelOpen) renderResults();
            notifyChange(options);
        }

        function clearSelection(options) {
            selectedUsers = [];
            renderChips();
            if (panelOpen) renderResults();
            notifyChange(options);
        }

        function renderResults() {
            $results.empty();
            if (!searchResults.length) {
                $results.append('<div class="ujg-ua-picker-empty">Не найдено</div>');
                return;
            }
            for (var i = 0; i < searchResults.length; i++) {
                var nu = normalizeUser(searchResults[i]);
                var cbId = "ujg-ua-mup-" + pickerId + "-" + i;
                var $label = $("<label></label>").attr("for", cbId);
                var $cb = $("<input type=\"checkbox\">")
                    .attr("id", cbId)
                    .attr("data-name", nu.name)
                    .prop("checked", isSelected(nu.name));
                $label.append($cb);
                $label.append($("<span></span>").text(nu.displayName + " (" + nu.name + ")"));
                $results.append($label);
            }
        }

        function doSearch(query) {
            api.searchUsers(query || "").then(
                function(result) {
                    searchResults = result || [];
                    renderResults();
                },
                function() {
                    searchResults = [];
                    renderResults();
                }
            );
        }

        function onDocMouseDown(e) {
            if (!$root[0].contains(e.target)) {
                closePanel();
            }
        }

        function openPanel() {
            if (panelOpen) return;
            panelOpen = true;
            $panel.show();
            $(document).on("mousedown.ujgUAMultiPicker" + pickerId, onDocMouseDown);
            setTimeout(function() {
                $search.focus();
            }, 50);
            doSearch($search.val() || "");
        }

        function closePanel() {
            if (!panelOpen) return;
            panelOpen = false;
            $panel.hide();
            $(document).off("mousedown.ujgUAMultiPicker" + pickerId, onDocMouseDown);
        }

        function togglePanel() {
            if (panelOpen) closePanel();
            else openPanel();
        }

        $trigger.on("click", function(e) {
            e.stopPropagation();
            togglePanel();
        });

        $panel.on("click", function(e) {
            e.stopPropagation();
        });

        $search.on("input", function() {
            var q = $(this).val();
            clearTimeout(searchTimer);
            searchTimer = setTimeout(function() {
                doSearch(q);
            }, 300);
        });

        $results.on("change", "input[type=checkbox]", function() {
            var name = $(this).attr("data-name");
            var checked = $(this).prop("checked");
            var user = null;
            for (var i = 0; i < searchResults.length; i++) {
                var nu = normalizeUser(searchResults[i]);
                if (nu.name === name) {
                    user = nu;
                    break;
                }
            }
            if (!user) return;
            var idx = selectedIndexByName(name);
            if (checked && idx < 0) {
                selectedUsers.push(user);
            } else if (!checked && idx >= 0) {
                selectedUsers.splice(idx, 1);
            }
            renderChips();
            notifyChange();
        });

        $chipsWrap.on("click", ".ujg-ua-chip-remove", function(e) {
            e.stopPropagation();
            var name = $(this).attr("data-name");
            var idx = selectedIndexByName(name);
            if (idx >= 0) {
                selectedUsers.splice(idx, 1);
                renderChips();
                renderResults();
                notifyChange();
            }
        });

        $btnReset.on("click", function(e) {
            e.stopPropagation();
            selectedUsers = [];
            renderChips();
            renderResults();
            notifyChange();
        });

        function setFromUrl(urlParams) {
            if (!urlParams || urlParams.users == null || urlParams.users === "") return;
            var names = String(urlParams.users)
                .split(",")
                .map(function(s) {
                    return s.trim();
                })
                .filter(Boolean);
            if (!names.length) return;

            var promises = names.map(function(name) {
                return api.searchUsers(name).then(
                    function(users) {
                        var list = users || [];
                        var match = null;
                        for (var j = 0; j < list.length; j++) {
                            var u = normalizeUser(list[j]);
                            if (u.name === name || u.key === name) {
                                match = u;
                                break;
                            }
                        }
                        if (!match && list.length) match = normalizeUser(list[0]);
                        return match;
                    },
                    function() {
                        return null;
                    }
                );
            });

            $.when.apply($, promises).done(function() {
                var next = [];
                for (var i = 0; i < arguments.length; i++) {
                    var m = arguments[i];
                    if (!m) continue;
                    var dup = false;
                    for (var j = 0; j < next.length; j++) {
                        if (next[j].name === m.name) {
                            dup = true;
                            break;
                        }
                    }
                    if (!dup) next.push(m);
                }
                selectedUsers = next;
                renderChips();
                renderResults();
                notifyChange();
            });
        }

        updateTriggerText();

        return {
            $el: $root,
            getSelectedUsers: function() {
                return selectedUsers;
            },
            setSelectedUsers: setSelectedUsers,
            clearSelection: clearSelection,
            setFromUrl: setFromUrl
        };
    }

    return { create: create };
});
