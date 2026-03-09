define("_ujgUA_userPicker", ["jquery", "_ujgUA_api", "_ujgUA_config", "_ujgUA_utils"], function($, api, config, utils) {
    "use strict";

    function create($pageContainer, onChange) {
        var selectedUser = null;
        var isOpen = false;
        var searchTimer = null;
        var users = [];

        var $el = $('<div class="relative"></div>');

        var $trigger = $(
            '<div class="flex items-center gap-2 bg-card border border-border rounded-lg px-3 py-2 min-w-[220px]">' +
                utils.icon("user", "w-4 h-4 text-muted-foreground shrink-0") +
                '<input type="text" placeholder="Выберите пользователя..." class="ujg-ua-picker-input bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none flex-1 min-w-0" />' +
                '<button type="button" class="ujg-ua-picker-selected text-sm font-medium text-foreground truncate text-left flex-1 min-w-0" style="display:none"></button>' +
                utils.icon("search", "w-3.5 h-3.5 text-muted-foreground") +
            '</div>'
        );
        $el.append($trigger);

        var $input = $trigger.find(".ujg-ua-picker-input");
        var $selectedLabel = $trigger.find(".ujg-ua-picker-selected");

        var $backdrop = $('<div class="fixed inset-0 z-40" style="display:none"></div>');
        $el.append($backdrop);

        var $panel = $(
            '<div class="absolute z-50 top-full left-0 mt-1 w-full bg-card border border-border rounded-lg shadow-lg overflow-hidden" style="display:none">' +
                '<div class="p-2 border-b border-border">' +
                    '<input type="text" placeholder="Поиск..." class="ujg-ua-search-input w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none" />' +
                '</div>' +
                '<div class="max-h-48 overflow-y-auto ujg-ua-user-list"></div>' +
            '</div>'
        );
        $el.append($panel);

        var $searchInput = $panel.find(".ujg-ua-search-input");
        var $userList = $panel.find(".ujg-ua-user-list");

        function open() {
            if (isOpen) return;
            isOpen = true;
            $backdrop.show();
            $panel.show();
            setTimeout(function() { $searchInput.val("").focus(); }, 50);
            doSearch("");
        }

        function close() {
            if (!isOpen) return;
            isOpen = false;
            $backdrop.hide();
            $panel.hide();
        }

        function renderUsers(list) {
            users = list;
            var html = "";
            for (var i = 0; i < list.length; i++) {
                var u = list[i];
                var displayName = utils.escapeHtml(u.displayName || u.name);
                var initial = displayName.charAt(0).toUpperCase();
                var key = utils.escapeHtml(u.name);
                html +=
                    '<button class="w-full text-left px-3 py-2 text-sm hover:bg-surface-hover transition-colors flex items-center gap-2" data-idx="' + i + '">' +
                        '<div class="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-primary text-xs font-bold">' + initial + '</div>' +
                        '<div>' +
                            '<div class="text-foreground font-medium">' + displayName + '</div>' +
                            '<div class="text-xs text-muted-foreground">' + key + '</div>' +
                        '</div>' +
                    '</button>';
            }
            $userList.html(html || '<div class="px-3 py-2 text-sm text-muted-foreground">Не найдено</div>');
        }

        function doSearch(query) {
            api.searchUsers(query || "").then(function(result) {
                renderUsers(result);
            }, function() {
                renderUsers([]);
            });
        }

        function selectUser(user) {
            selectedUser = user;
            var displayName = user.displayName || user.name;
            $selectedLabel.text(displayName).show();
            $input.hide();
            close();
            if (onChange) onChange(user);
        }

        $trigger.on("click", function(e) {
            if (selectedUser) return;
            if (!isOpen) open();
        });

        $input.on("focus", function() {
            if (!isOpen) open();
        });

        $selectedLabel.on("click", function(e) {
            e.stopPropagation();
            $selectedLabel.hide();
            $input.show().val("");
            selectedUser = null;
            open();
        });

        $backdrop.on("click", function() { close(); });

        $searchInput.on("input", function() {
            var q = $(this).val();
            clearTimeout(searchTimer);
            searchTimer = setTimeout(function() { doSearch(q); }, 300);
        });

        $userList.on("click", "button[data-idx]", function(e) {
            e.stopPropagation();
            var idx = parseInt($(this).attr("data-idx"), 10);
            if (users[idx]) selectUser(users[idx]);
        });

        function setFromUrl() {
            var params = new URLSearchParams(window.location.search);
            var name = params.get("user");
            if (name) selectUser({ name: name, displayName: name });
        }

        return {
            $el: $el,
            getSelected: function() { return selectedUser; },
            setFromUrl: setFromUrl,
            selectUser: selectUser
        };
    }

    return { create: create };
});
