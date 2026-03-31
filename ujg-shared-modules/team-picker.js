define("_ujgShared_teamPicker", ["jquery"], function($) {
    "use strict";

    var nextPickerId = 1;

    function teamById(teams, id) {
        for (var i = 0; i < teams.length; i++) {
            if (teams[i].id === id) return teams[i];
        }
        return null;
    }

    function teamsCountLabel(n) {
        var z = n % 100;
        var m = n % 10;
        if (n === 0) return "0 команд";
        if (z >= 11 && z <= 14) return n + " команд";
        if (m === 1) return n === 1 ? "1 команда" : n + " команда";
        if (m >= 2 && m <= 4) return n + " команды";
        return n + " команд";
    }

    function create(options) {
        function normalizeTeamsInput(list) {
            if (!Array.isArray(list)) return [];
            return list.slice();
        }

        function normalizeIds(ids, m) {
            var out = [];
            if (!Array.isArray(ids)) return out;
            for (var i = 0; i < ids.length; i++) {
                if (ids[i] == null || ids[i] === "") continue;
                if (m === "single") return [String(ids[i])];
                out.push(String(ids[i]));
            }
            return m === "single" ? out.slice(0, 1) : out;
        }

        var mode = options.mode === "single" ? "single" : "multi";
        var teams = normalizeTeamsInput(options.teams);
        var selected = normalizeIds(options.selectedTeamIds, mode);
        var onChange = typeof options.onChange === "function" ? options.onChange : function() {};
        var getTeamLabel = typeof options.getTeamLabel === "function" ? options.getTeamLabel : null;
        var pickerId = nextPickerId++;
        var panelOpen = false;
        var destroyed = false;

        var $root = $("<div/>").addClass("ujg-st-team-picker");
        var $trigger = $("<button type=\"button\"/>")
            .addClass("aui-button ujg-st-team-picker-trigger");
        var $panel = $("<div/>").addClass("ujg-st-team-picker-panel");
        $panel.hide();
        var $actions = $("<div/>").addClass("ujg-st-team-picker-actions");
        var $btnReset = $("<button type=\"button\"/>")
            .addClass("aui-button aui-button-link ujg-st-team-picker-reset")
            .text("Сбросить");
        var $list = $("<div/>").addClass("ujg-st-team-picker-list");
        $actions.append($btnReset);
        $panel.append($actions, $list);
        $root.append($trigger, $panel);

        if (options.$container && options.$container.length) {
            options.$container.append($root);
        }

        function defaultTeamLabel(team) {
            var id = team && team.id != null ? String(team.id) : "";
            return team && team.name ? team.name : id;
        }

        function formatTeamLabel(team, context) {
            var meta = {
                context: context,
                mode: mode,
                selectedTeamIds: selected.slice(),
                selectedCount: selected.length
            };
            var fallback = defaultTeamLabel(team);
            var label;
            if (!getTeamLabel) return fallback;
            label = getTeamLabel(team || {}, meta);
            return label == null || label === "" ? fallback : String(label);
        }

        function updateTriggerText() {
            var n = selected.length;
            if (mode === "single") {
                if (n === 0) {
                    $trigger.text("Команда");
                } else {
                    var t = teamById(teams, selected[0]);
                    $trigger.text(formatTeamLabel(t || { id: selected[0] }, "trigger"));
                }
            } else {
                if (n === 0) {
                    $trigger.text("0 команд");
                } else if (n === 1) {
                    var one = teamById(teams, selected[0]);
                    $trigger.text(formatTeamLabel(one || { id: selected[0] }, "trigger"));
                } else {
                    $trigger.text(teamsCountLabel(n));
                }
            }
        }

        function notify() {
            onChange(selected.slice());
        }

        function renderList() {
            $list.empty();
            var name = "ujg-st-tp-" + pickerId;
            for (var i = 0; i < teams.length; i++) {
                var t = teams[i];
                var id = String(t.id);
                var $row = $("<label/>").addClass("ujg-st-team-picker-row");
                var checked = selected.indexOf(id) >= 0;
                if (mode === "single") {
                    var rid = name + "-" + i;
                    var $rb = $("<input/>")
                        .addClass("ujg-st-team-picker-radio")
                        .attr("type", "radio")
                        .attr("name", name)
                        .attr("id", rid)
                        .attr("data-team-id", id)
                        .prop("checked", checked);
                    $row.append($rb);
                    $row.append($("<span/>").text(formatTeamLabel(t, "list")));
                } else {
                    var cid = name + "-c-" + i;
                    var $cb = $("<input/>")
                        .addClass("ujg-st-team-picker-cb")
                        .attr("type", "checkbox")
                        .attr("id", cid)
                        .attr("data-team-id", id)
                        .prop("checked", checked);
                    $row.append($cb);
                    $row.append($("<span/>").text(formatTeamLabel(t, "list")));
                }
                $list.append($row);
            }
            updateTriggerText();
        }

        function nodeContains(ancestor, node) {
            while (node) {
                if (node === ancestor) return true;
                node = node.parentNode;
            }
            return false;
        }

        function onDocMouseDown(e) {
            var t = e.target;
            if (!nodeContains($root[0], t)) {
                closePanel();
            }
        }

        function openPanel() {
            if (destroyed) return;
            if (panelOpen) return;
            panelOpen = true;
            $panel.show();
            $(document).on("mousedown.ujgSTTeamPicker" + pickerId, onDocMouseDown);
            renderList();
        }

        function closePanel() {
            if (!panelOpen) return;
            panelOpen = false;
            $panel.hide();
            $(document).off("mousedown.ujgSTTeamPicker" + pickerId, onDocMouseDown);
        }

        function togglePanel() {
            if (destroyed) return;
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

        $root.on("change", ".ujg-st-team-picker-cb", function() {
            var tid = $(this).attr("data-team-id");
            var on = $(this).prop("checked");
            var idx = selected.indexOf(tid);
            if (on && idx < 0) {
                selected.push(tid);
            } else if (!on && idx >= 0) {
                selected.splice(idx, 1);
            }
            updateTriggerText();
            notify();
        });

        $root.on("change", ".ujg-st-team-picker-radio", function() {
            var tid = $(this).attr("data-team-id");
            if ($(this).prop("checked")) {
                selected = tid ? [tid] : [];
                updateTriggerText();
                notify();
            }
        });

        $btnReset.on("click", function(e) {
            e.stopPropagation();
            selected = [];
            renderList();
            notify();
        });

        if (mode === "single") {
            $btnReset.remove();
        }

        updateTriggerText();

        return {
            $el: $root,
            getSelectedTeamIds: function() {
                return selected.slice();
            },
            setSelectedTeamIds: function(ids, options) {
                if (destroyed) return;
                selected = normalizeIds(ids, mode);
                if (panelOpen) renderList();
                else updateTriggerText();
                if (!options || !options.silent) notify();
            },
            openPanel: openPanel,
            closePanel: closePanel,
            destroy: function() {
                if (destroyed) return;
                closePanel();
                destroyed = true;
                $root.remove();
            }
        };
    }

    return { create: create };
});
