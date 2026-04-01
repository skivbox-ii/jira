(function(moduleId) {
    function hasDefinedModule(loader) {
        var contexts;
        var contextName;
        if (!loader) return false;
        if (typeof loader.defined === "function") {
            try {
                if (loader.defined(moduleId)) return true;
            } catch (e) {}
        }
        if (loader._defined && Object.prototype.hasOwnProperty.call(loader._defined, moduleId)) {
            return true;
        }
        contexts = loader.s && loader.s.contexts;
        if (!contexts) return false;
        for (contextName in contexts) {
            if (
                Object.prototype.hasOwnProperty.call(contexts, contextName) &&
                contexts[contextName] &&
                contexts[contextName].defined &&
                Object.prototype.hasOwnProperty.call(contexts[contextName].defined, moduleId)
            ) {
                return true;
            }
        }
        return false;
    }

    if (hasDefinedModule(typeof requirejs !== "undefined" ? requirejs : null)) return;
    if (hasDefinedModule(typeof require !== "undefined" ? require : null)) return;

define(moduleId, ["jquery"], function($) {
    "use strict";

    var nextPickerId = 1;
    var stylesInjected = false;
    var TEAM_PICKER_STYLES = [
        ".ujg-st-team-picker { position: relative; display: inline-block; vertical-align: middle; }",
        ".ujg-st-team-picker-trigger { min-width: 120px; max-width: 220px; text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }",
        ".ujg-st-team-picker-panel { position: absolute; top: calc(100% + 4px); left: 0; z-index: 1000; background: #fff; border: 1px solid #dfe1e6; border-radius: 6px; box-shadow: 0 8px 24px rgba(9,30,66,.16); min-width: 280px; max-width: 360px; padding: 8px; }",
        ".ujg-st-team-picker-selected { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 6px; min-height: 20px; }",
        ".ujg-st-team-picker-chip { display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; margin: 1px 0; background: #deebff; color: #0747a6; border-radius: 999px; font-size: 12px; line-height: 1.4; }",
        ".ujg-st-team-picker-chip-remove { border: none; background: none; cursor: pointer; font-size: 14px; color: #42526e; padding: 0 2px; line-height: 1; }",
        ".ujg-st-team-picker-chip-remove:hover { color: #de350b; }",
        ".ujg-st-team-picker-actions { display: flex; justify-content: flex-end; margin-bottom: 6px; }",
        ".ujg-st-team-picker-list { max-height: 260px; overflow: auto; }",
        ".ujg-st-team-picker-row { display: flex; align-items: center; gap: 6px; padding: 4px 2px; border-radius: 4px; }",
        ".ujg-st-team-picker-row:hover { background: #f4f5f7; }"
    ].join("\n");

    function injectStyles() {
        if (stylesInjected) return;
        stylesInjected = true;
        if (typeof document === "undefined" || !document || !document.createElement || !document.head || !document.head.appendChild) {
            return;
        }
        var styleEl = document.createElement("style");
        styleEl.type = "text/css";
        styleEl.appendChild(document.createTextNode(TEAM_PICKER_STYLES));
        document.head.appendChild(styleEl);
    }

    function teamById(teams, id) {
        for (var i = 0; i < teams.length; i++) {
            if (teams[i].id === id) return teams[i];
        }
        return null;
    }

    function create(options) {
        injectStyles();

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
        var emptySingleLabel = String(options.emptySingleLabel || "Команда");
        var emptyMultiLabel = String(options.emptyMultiLabel || "0 команд");
        var pickerId = nextPickerId++;
        var panelOpen = false;
        var destroyed = false;

        var $root = $("<div/>").addClass("ujg-st-team-picker");
        var $trigger = $("<button type=\"button\"/>")
            .addClass("aui-button ujg-st-team-picker-trigger");
        var $panel = $("<div/>").addClass("ujg-st-team-picker-panel");
        $panel.hide();
        var $selected = $("<div/>").addClass("ujg-st-team-picker-selected");
        var $actions = $("<div/>").addClass("ujg-st-team-picker-actions");
        var $btnReset = $("<button type=\"button\"/>")
            .addClass("aui-button aui-button-link ujg-st-team-picker-reset")
            .text("Сбросить");
        var $list = $("<div/>").addClass("ujg-st-team-picker-list");
        $actions.append($btnReset);
        $panel.append($selected, $actions, $list);
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
                    $trigger.text(emptySingleLabel);
                } else {
                    var t = teamById(teams, selected[0]);
                    $trigger.text(formatTeamLabel(t || { id: selected[0] }, "trigger"));
                }
            } else {
                if (n === 0) {
                    $trigger.text(emptyMultiLabel);
                } else if (n === 1) {
                    var one = teamById(teams, selected[0]);
                    $trigger.text(formatTeamLabel(one || { id: selected[0] }, "trigger"));
                } else {
                    $trigger.text(n + " выбрано");
                }
            }
        }

        function notify() {
            onChange(selected.slice());
        }

        function readNodeAttr($node, node, name) {
            var value = $node && typeof $node.attr === "function" ? $node.attr(name) : undefined;
            if ((value == null || value === "") && node && typeof node.getAttribute === "function") {
                value = node.getAttribute(name);
            }
            if ((value == null || value === "") && node && node._attrs) {
                value = node._attrs[name];
            }
            return value == null ? "" : String(value);
        }

        function renderSelectedChips() {
            $selected.empty();
            if (mode === "single") {
                $selected.hide();
                return;
            }
            for (var i = 0; i < selected.length; i++) {
                var id = selected[i];
                var team = teamById(teams, id) || { id: id };
                var $chip = $("<span/>").addClass("ujg-st-team-picker-chip");
                $chip.append($("<span/>").text(formatTeamLabel(team, "selected")));
                var $remove = $("<button type=\"button\"/>")
                    .addClass("ujg-st-team-picker-chip-remove")
                    .attr("data-team-id", id)
                    .attr("aria-label", "Удалить команду")
                    .text("\u00d7");
                (function(teamId) {
                    $remove.on("click", function(e) {
                        e.stopPropagation();
                        var idx = selected.indexOf(teamId);
                        if (idx < 0) return;
                        selected.splice(idx, 1);
                        renderList();
                        notify();
                    });
                }(id));
                $chip.append($remove);
                $selected.append($chip);
            }
            if (selected.length) $selected.show();
            else $selected.hide();
        }

        function renderList() {
            $list.empty();
            renderSelectedChips();
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
            var tid = readNodeAttr($(this), this, "data-team-id");
            var on = $(this).prop("checked");
            var idx = selected.indexOf(tid);
            if (on && idx < 0) {
                selected.push(tid);
            } else if (!on && idx >= 0) {
                selected.splice(idx, 1);
            }
            renderSelectedChips();
            updateTriggerText();
            notify();
        });

        $root.on("change", ".ujg-st-team-picker-radio", function() {
            var tid = readNodeAttr($(this), this, "data-team-id");
            if ($(this).prop("checked")) {
                selected = tid ? [tid] : [];
                renderSelectedChips();
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
            $selected.remove();
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
}("_ujgShared_teamPicker"));
