define("_ujgSB_rendering", ["jquery", "_ujgSB_config", "_ujgSB_utils"], function($, config, utils) {
    "use strict";

    var $container;
    var services;
    var $headerHost;
    var $viewHost;
    var $progressHost;
    var currentViewMode = "table";

    function typeLabel(node) {
        if (node && node.type != null && node.type !== "") {
            return String(node.type);
        }
        var t = node && node.issuetype;
        if (typeof t === "string") return t;
        return t && t.name != null ? String(t.name) : "";
    }

    function isEpicNode(node) {
        return typeLabel(node) === "Epic";
    }

    function isOrphanBucket(node) {
        return !!(node && node.key === "__orphans__");
    }

    function isExpandableNode(node) {
        var kids = node && node.children && node.children.length;
        return !!(kids && (isEpicNode(node) || isOrphanBucket(node)));
    }

    function displayKey(node) {
        if (isOrphanBucket(node)) {
            return "Без эпика";
        }
        return node && node.key != null ? String(node.key) : "";
    }

    function displaySummary(node) {
        if (isOrphanBucket(node)) {
            return "";
        }
        return node && node.summary != null ? String(node.summary) : "";
    }

    function labelsText(node) {
        var labels = node.labels;
        if (!labels || !labels.length) return "";
        return labels
            .map(function(l) {
                return typeof l === "string" ? l : (l && l.name) || "";
            })
            .filter(Boolean)
            .join(", ");
    }

    function componentsText(node) {
        var components = node.components;
        if (!components || !components.length) return "";
        return components
            .map(function(item) {
                return typeof item === "string" ? item : (item && item.name) || "";
            })
            .filter(Boolean)
            .join(", ");
    }

    function classificationText(node) {
        if (!node) return "—";
        if (node.classification != null && String(node.classification).trim() !== "") {
            return String(node.classification);
        }
        if (isEpicNode(node)) return "EPIC";
        if (typeLabel(node) === "Story") return "STORY";
        return "—";
    }

    function classificationClass(node) {
        return node && node.classificationMissing
            ? "ujg-sb-classification-badge ujg-sb-classification-missing"
            : "ujg-sb-classification-badge";
    }

    function keyContent(node, extraClass) {
        var className = extraClass ? String(extraClass) : "";
        var keyText = displayKey(node);
        if (!node || isOrphanBucket(node) || !node.browseUrl) {
            return $("<span/>").addClass(className).text(keyText || "—");
        }
        return $("<a/>")
            .addClass((className ? className + " " : "") + "ujg-sb-key-link")
            .attr("href", node.browseUrl)
            .attr("target", "_blank")
            .attr("rel", "noreferrer noopener")
            .text(keyText);
    }

    function displayMetaValue(text) {
        return text && String(text).trim() !== "" ? String(text) : "—";
    }

    function currentState() {
        return services && services.state ? services.state : {};
    }

    function epicOptionLabel(epic) {
        if (!epic) return "";
        var key = epic.key != null ? String(epic.key) : "";
        var summary = epic.summary != null ? String(epic.summary) : "";
        return key && summary && summary !== key ? key + " - " + summary : key || summary;
    }

    function assigneeText(node) {
        var a = node.assignee;
        if (typeof a === "string") return a || "—";
        if (!a) return "—";
        return a.displayName != null ? String(a.displayName) : "—";
    }

    function estimateText(node) {
        if (node.storyPoints != null) return utils.formatSP(node.storyPoints);
        if (node.estimate != null) return utils.formatSP(node.estimate);
        return utils.formatSP(null);
    }

    function statusForUtils(node) {
        if (typeof node.status === "string") return { name: node.status };
        return node.status;
    }

    function priorityForUtils(node) {
        if (typeof node.priority === "string") return { name: node.priority };
        return node.priority;
    }

    // Keep blocker/problem summaries compact and consistent everywhere they appear.
    function problemSummaryText(items) {
        if (!items || !items.length) return "";
        return items
            .map(function(p) {
                if (typeof p === "string") return p;
                if (!p) return "";
                var badge =
                    p.badge != null
                        ? String(p.badge)
                        : p.typeBadge != null
                          ? String(p.typeBadge)
                          : utils.getTypeBadge(p.issuetype || p.type || "");
                var key = p.key != null ? String(p.key) : "";
                var summary =
                    p.text != null ? String(p.text) : p.summary != null ? String(p.summary) : "";
                return [badge, key, summary].filter(Boolean).join(" ");
            })
            .join(" · ");
    }

    function appendProblemSummaryBlock($parent, items, className, paddingLeft) {
        var text = problemSummaryText(items);
        var $line;
        if (!text) return;
        $line = $("<div/>").addClass(className || "");
        if (paddingLeft != null) {
            $line.css("paddingLeft", String(paddingLeft) + "px");
        }
        $line.text(text);
        $parent.append($line);
    }

    function normalizeProgressPercent(value) {
        var n = Number(value);
        if (!isFinite(n)) return null;
        // Accept either fractions (0..1) or already-percent values (0..100).
        if (n >= 0 && n <= 1) {
            n = n * 100;
        }
        if (n < 0) n = 0;
        if (n > 100) n = 100;
        return Math.round(n);
    }

    function progressPercent(node) {
        var fromProgress = normalizeProgressPercent(node.progress);
        if (fromProgress != null) {
            return fromProgress;
        }
        var td = Number(node.totalDone);
        var tc = Number(node.totalCount);
        if (isFinite(td) && isFinite(tc) && tc > 0) {
            return normalizeProgressPercent(td / tc);
        }
        return null;
    }

    function appendProgressCell($tr, node) {
        var pct = progressPercent(node);
        var td = node.totalDone;
        var tc = node.totalCount;
        var label = "";
        if (td != null && tc != null && isFinite(Number(td)) && isFinite(Number(tc))) {
            label = String(td) + " / " + String(tc);
        }
        var $td = $("<td/>").addClass("ujg-sb-col-progress");
        if (pct == null) {
            $td.addClass("text-[10px] text-muted-foreground").text(label || "—");
        } else {
            var $wrap = $("<div/>").addClass("flex flex-col gap-0.5 min-w-[72px]");
            if (label) {
                $wrap.append($("<span/>").addClass("text-[9px] text-muted-foreground font-mono").text(label));
            }
            var $bar = $("<div/>").addClass("h-1.5 w-full rounded bg-muted overflow-hidden");
            $bar.append($("<div/>").addClass("h-full bg-primary transition-all").css("width", pct + "%"));
            $wrap.append($bar, $("<span/>").addClass("text-[9px] font-mono").text(pct + "%"));
            $td.append($wrap);
        }
        $tr.append($td);
    }

    function appendTableDataRow($tbody, node, depth, expanded) {
        var typeStr = typeLabel(node);
        var typeColorCls = utils.getTypeColor(typeStr);
        var badge = node.badge != null ? String(node.badge) : utils.getTypeBadge(node.issuetype || typeStr);
        var epic = isEpicNode(node);
        var orphanBucket = isOrphanBucket(node);
        var kids = node.children && node.children.length;
        var expandable = isExpandableNode(node);
        var isOpen = expandable ? !!expanded[node.key] : true;
        var rowKind = epic || orphanBucket ? "epic" : "story";
        var pad = 8 + depth * 14;
        var $tr = $("<tr/>")
            .addClass("ujg-sb-tr ujg-sb-table-row-" + rowKind + " ujg-sb-depth-" + depth)
            .attr("data-key", node.key);
        var $keyTd = $("<td/>").addClass("ujg-sb-col-key font-mono text-[10px]").css("paddingLeft", pad + "px");
        if (expandable) {
            $keyTd.append(
                $("<button type=\"button\"/>")
                    .addClass("ujg-sb-epic-toggle mr-1 text-[10px] p-0 border-0 bg-transparent cursor-pointer")
                    .attr("data-epic-key", node.key)
                    .text(isOpen ? "▾" : "▸")
            );
        }
        $tr.append(
            $("<td/>")
                .addClass("ujg-sb-col-classification text-[10px]")
                .append($("<span/>").addClass(classificationClass(node)).text(classificationText(node)))
        );
        $keyTd.append(
            $("<span/>")
                .addClass("inline-flex items-center gap-1")
                .append(
                    $("<span/>").addClass("text-[9px] font-bold rounded px-1 py-px " + typeColorCls).text(badge),
                    keyContent(node, "font-semibold")
                )
        );
        $tr.append($keyTd);
        $tr.append($("<td/>").addClass("ujg-sb-col-summary text-[11px]").text(displaySummary(node)));
        var st = statusForUtils(node);
        var statusName = utils.getStatusName(st);
        $tr.append(
            $("<td/>")
                .addClass("ujg-sb-col-status text-[10px]")
                .append(
                    $("<span/>")
                        .addClass("rounded px-1 py-px " + utils.getStatusClass(st))
                        .text(statusName || "—")
                )
        );
        $tr.append(
            $("<td/>").addClass("ujg-sb-col-sprint text-[10px]").text(utils.getSprintName(node.sprint))
        );
        $tr.append($("<td/>").addClass("ujg-sb-col-labels text-[10px]").text(displayMetaValue(labelsText(node))));
        $tr.append($("<td/>").addClass("ujg-sb-col-components text-[10px]").text(displayMetaValue(componentsText(node))));
        $tbody.append($tr);
        if ((epic || orphanBucket) && node.problemItems && node.problemItems.length && isOpen) {
            var $prob = $("<tr/>").addClass("ujg-sb-problem-row text-[10px]");
            $prob.append(
                $("<td/>")
                    .addClass("ujg-sb-problem-cell py-1 px-2")
                    .attr("colspan", "7")
                    .text(problemSummaryText(node.problemItems))
            );
            $tbody.append($prob);
        }
        if (kids && isOpen) {
            renderTableBodyDom(node.children, depth + 1, expanded, $tbody);
        }
    }

    function renderTableBodyDom(nodes, depth, expanded, $tbody) {
        var i;
        for (i = 0; i < (nodes || []).length; i++) {
            appendTableDataRow($tbody, nodes[i], depth, expanded);
        }
    }

    function renderTable(tree, expanded) {
        var headers = [
            "Классификация",
            "Ключ",
            "Название",
            "Статус",
            "Спринт",
            "Метки",
            "Компоненты"
        ];
        var $wrap = $("<div/>").addClass("ujg-sb-table-wrap overflow-auto");
        var $table = $("<table/>").addClass("ujg-sb-table w-full border-collapse text-foreground");
        var $thead = $("<thead/>");
        var $trh = $("<tr/>");
        var hi;
        for (hi = 0; hi < headers.length; hi++) {
            $trh.append(
                $("<th/>").addClass("text-left text-[10px] font-semibold p-1 border-b border-border").text(headers[hi])
            );
        }
        $thead.append($trh);
        var $tbody = $("<tbody/>");
        renderTableBodyDom(tree || [], 0, expanded || {}, $tbody);
        $table.append($thead, $tbody);
        $wrap.append($table);
        return $wrap;
    }

    function metricsLine(node) {
        var parts = [];
        var pct = progressPercent(node);
        if (pct != null) parts.push(pct + "%");
        var tc = Number(node.totalCount);
        if (isFinite(tc) && tc > 0) parts.push(String(node.totalDone || 0) + "/" + String(tc));
        return parts.join(" · ");
    }

    function renderAccordionHead(node) {
        var typeStr = typeLabel(node);
        var badge = node.badge != null ? String(node.badge) : utils.getTypeBadge(node.issuetype || typeStr);
        var typeColorCls = utils.getTypeColor(typeStr);
        var $head = $("<div/>").addClass("ujg-sb-accordion-head flex items-center gap-2 p-2 text-[11px] cursor-pointer bg-secondary/20");
        $head.attr("data-acc-key", node.key);
        $head.append(
            $("<span/>").addClass("text-[9px] font-bold rounded px-1 py-px " + typeColorCls).text(badge),
            $("<span/>").addClass(classificationClass(node)).text(classificationText(node)),
            keyContent(node, "font-mono font-semibold"),
            $("<span/>").addClass("flex-1 truncate").text(displaySummary(node)),
            $("<span/>").addClass("text-[9px] text-muted-foreground shrink-0").text(metricsLine(node))
        );
        return $head;
    }

    function renderAccordionChildren(nodes, depth, expanded, $parent) {
        var i;
        for (i = 0; i < (nodes || []).length; i++) {
            var node = nodes[i];
            var kids = node.children && node.children.length;
            var expandable = isExpandableNode(node);
            var isOpen = expandable ? !!expanded[node.key] : true;
            var pad = 8 + depth * 12;
            var typeStr = typeLabel(node);
            var badge = node.badge != null ? String(node.badge) : utils.getTypeBadge(node.issuetype || typeStr);
            var typeColorCls = utils.getTypeColor(typeStr);
            var st = statusForUtils(node);
            var statusName = utils.getStatusName(st) || "—";
            var $line = $("<div/>").addClass(
                "ujg-sb-acc-line flex flex-wrap items-center gap-2 py-1 text-[10px] border-b border-border/40"
            );
            $line.css("paddingLeft", 4 + depth * 10 + "px");
            $line.append(
                expandable
                    ? $("<button type=\"button\"/>")
                          .addClass("ujg-sb-acc-toggle mr-1 text-[10px] p-0 border-0 bg-transparent cursor-pointer")
                          .attr("data-epic-key", node.key)
                          .text(isOpen ? "▾" : "▸")
                    : null,
                $("<span/>").addClass("text-[9px] font-bold rounded px-1 py-px " + typeColorCls).text(badge),
                $("<span/>").addClass(classificationClass(node)).text(classificationText(node)),
                keyContent(node, "font-mono font-semibold"),
                $("<span/>").addClass("flex-1 truncate").text(displaySummary(node)),
                $("<span/>").addClass("rounded px-1 py-px text-[9px] " + utils.getStatusClass(st)).text(statusName),
                $("<span/>").addClass("text-[9px] text-muted-foreground").text(utils.getSprintName(node.sprint)),
                $("<span/>").addClass("text-[9px] text-muted-foreground").text(displayMetaValue(labelsText(node))),
                $("<span/>").addClass("text-[9px] text-muted-foreground").text(displayMetaValue(componentsText(node)))
            );
            $parent.append($line);
            if (kids && isOpen) {
                renderAccordionChildren(node.children, depth + 1, expanded, $parent);
            }
        }
    }

    function renderAccordionRootSection(node, expanded, $root) {
        var kids = node.children && node.children.length;
        var isOpen = !!expanded[node.key];
        var $section = $("<div/>").addClass("ujg-sb-accordion-item border border-border rounded mb-1");
        var $head = renderAccordionHead(node);
        var $body = $("<div/>").addClass("ujg-sb-accordion-body pl-3 pb-2 text-[10px]");
        if (!isOpen || !kids) {
            $body.css("display", "none");
        }
        if (kids && isOpen) {
            appendProblemSummaryBlock(
                $body,
                node.problemItems,
                "mb-2 rounded bg-destructive/10 px-2 py-1 text-[10px] text-destructive"
            );
            renderAccordionChildren(node.children, 1, expanded, $body);
        }
        $section.append($head, $body);
        $root.append($section);
        $head.on("click", function() {
            if (services.onToggleExpandedKey) {
                services.onToggleExpandedKey(node.key);
            }
        });
    }

    function renderAccordion(tree, expanded) {
        var exp = expanded || {};
        var $root = $("<div/>").addClass("ujg-sb-accordion-root space-y-1");
        var i;
        for (i = 0; i < (tree || []).length; i++) {
            renderAccordionRootSection(tree[i], exp, $root);
        }
        return $root;
    }

    function renderRowsNodes(nodes, depth, expanded, $parent) {
        var i;
        for (i = 0; i < (nodes || []).length; i++) {
            var node = nodes[i];
            var kids = node.children && node.children.length;
            var expandable = isExpandableNode(node);
            var isOpen = expandable ? !!expanded[node.key] : true;
            var pad = 8 + depth * 12;
            var typeStr = typeLabel(node);
            var badge = node.badge != null ? String(node.badge) : utils.getTypeBadge(node.issuetype || typeStr);
            var typeColorCls = utils.getTypeColor(typeStr);
            var st = statusForUtils(node);
            var statusName = utils.getStatusName(st) || "—";
            var sprint = utils.getSprintName(node.sprint) || "—";
            var $row = $("<div/>").addClass(
                "ujg-sb-row-item ujg-sb-row-card ujg-sb-depth-" +
                    depth +
                    " flex flex-wrap items-baseline gap-x-2 gap-y-0.5 py-1 px-2 border-b border-border/50 text-[10px]"
            );
            $row.css("paddingLeft", pad + "px");
            $row.append(
                expandable
                    ? $("<button type=\"button\"/>")
                          .addClass("ujg-sb-row-toggle mr-1 text-[10px] p-0 border-0 bg-transparent cursor-pointer")
                          .attr("data-epic-key", node.key)
                          .text(isOpen ? "▾" : "▸")
                    : null,
                $("<span/>").addClass(classificationClass(node)).text(classificationText(node)),
                keyContent(node, "font-mono font-semibold"),
                $("<span/>").addClass("text-[9px] font-bold rounded px-1 py-px " + typeColorCls).text(badge),
                $("<span/>").addClass("flex-1 min-w-[120px]").text(displaySummary(node)),
                $("<span/>").addClass("rounded px-1 py-px text-[9px] " + utils.getStatusClass(st)).text(statusName),
                $("<span/>").addClass("text-muted-foreground").text(sprint),
                $("<span/>").addClass("text-muted-foreground").text(displayMetaValue(labelsText(node))),
                $("<span/>").addClass("text-muted-foreground").text(displayMetaValue(componentsText(node)))
            );
            $parent.append($row);
            if ((isEpicNode(node) || isOrphanBucket(node)) && node.problemItems && node.problemItems.length && isOpen) {
                appendProblemSummaryBlock(
                    $parent,
                    node.problemItems,
                    "ujg-sb-row-problem border-b border-border/40 bg-destructive/10 py-1 pr-2 text-[10px] text-destructive",
                    pad + 14
                );
            }
            if (kids && isOpen) {
                renderRowsNodes(node.children, depth + 1, expanded, $parent);
            }
        }
    }

    function renderRows(tree, expanded) {
        var $root = $("<div/>").addClass("ujg-sb-rows-root ujg-sb-rows-wrap");
        renderRowsNodes(tree || [], 0, expanded || {}, $root);
        return $root;
    }

    function syncViewButtons() {
        if (!$headerHost || !$headerHost.length) return;
        $headerHost.find(".ujg-sb-view-table").removeClass("ujg-sb-view-active");
        $headerHost.find(".ujg-sb-view-accordion").removeClass("ujg-sb-view-active");
        $headerHost.find(".ujg-sb-view-rows").removeClass("ujg-sb-view-active");
        $headerHost.find(".ujg-sb-view-" + currentViewMode).addClass("ujg-sb-view-active");
    }

    function closeAllPickers() {
        if (!$headerHost || !$headerHost.length) return;
        $headerHost.find(".ujg-sb-picker-popover").each(function() {
            this.style.display = "none";
        });
    }

    function singlePickerOptions(kind) {
        var state = currentState();
        if (kind === "project") {
            return (state.projects || []).map(function(project) {
                var key = project && project.key != null ? String(project.key) : "";
                return {
                    value: key,
                    label: project && project.name != null ? String(project.name) : key
                };
            });
        }
        if (kind === "status") {
            return [{ value: "", label: "Все статусы" }].concat(
                (state.filterOptions && state.filterOptions.statuses || []).map(function(status) {
                    return { value: String(status), label: String(status) };
                })
            );
        }
        if (kind === "sprint") {
            return [{ value: "", label: "Все спринты" }].concat(
                (state.filterOptions && state.filterOptions.sprints || []).map(function(sprint) {
                    return { value: String(sprint), label: String(sprint) };
                })
            );
        }
        return [];
    }

    function epicPickerOptions() {
        var state = currentState();
        return [{ value: "", label: "Все эпики" }].concat(
            (state.filterOptions && state.filterOptions.epics || []).map(function(epic) {
                return {
                    value: epic && epic.key != null ? String(epic.key) : "",
                    label: epicOptionLabel(epic)
                };
            })
        );
    }

    function selectedEpicKeys() {
        var state = currentState();
        if (Array.isArray(state.selectedEpicKeys)) {
            return state.selectedEpicKeys.map(String);
        }
        if (state.filters && state.filters.epic) {
            return [String(state.filters.epic)];
        }
        return [];
    }

    function triggerText(kind, options) {
        var state = currentState();
        var i;
        if (kind === "project") {
            for (i = 0; i < options.length; i += 1) {
                if (String(options[i].value) === String(state.project || "")) {
                    return options[i].label;
                }
            }
            return "Проект";
        }
        if (kind === "status") {
            for (i = 0; i < options.length; i += 1) {
                if (String(options[i].value) === String(state.filters && state.filters.status || "")) {
                    return options[i].label;
                }
            }
            return "Все статусы";
        }
        if (kind === "sprint") {
            for (i = 0; i < options.length; i += 1) {
                if (String(options[i].value) === String(state.filters && state.filters.sprint || "")) {
                    return options[i].label;
                }
            }
            return "Все спринты";
        }
        if (kind === "epic") {
            var selected = selectedEpicKeys();
            if (!selected.length) return "Все эпики";
            if (selected.length === 1) return selected[0];
            return "Выбрано: " + String(selected.length);
        }
        return "";
    }

    function renderPicker(labelText, kind, nativeClass, options, multi) {
        var $field = $("<label/>").addClass("ujg-sb-picker-field");
        var $picker = $("<div/>").addClass("ujg-sb-picker ujg-sb-picker-" + kind);
        var $native = $("<select/>").addClass("ujg-sb-native-control " + nativeClass);
        var selected = multi ? selectedEpicKeys() : [];
        var selectedMap = {};
        selected.forEach(function(value) {
            selectedMap[String(value)] = true;
        });
        if (multi) {
            $native.attr("multiple", "multiple");
        }
        options.forEach(function(option) {
            $native.append($("<option/>").attr("value", option.value).text(option.label));
        });
        var $chips = $("<div/>").addClass("ujg-sb-picker-chips");
        if (multi) {
            selected.forEach(function(value) {
                $chips.append(
                    $("<button type=\"button\"/>")
                        .addClass("ujg-sb-picker-chip")
                        .attr("data-picker-kind", kind)
                        .attr("data-value", value)
                        .text(value)
                );
            });
        }
        var $trigger = $("<button type=\"button\"/>")
            .addClass("ujg-sb-picker-trigger")
            .attr("data-picker-kind", kind)
            .text(triggerText(kind, options));
        var $popover = $("<div/>")
            .addClass("ujg-sb-picker-popover")
            .attr("data-picker-kind", kind)
            .css("display", "none");
        var $search = $("<input/>")
            .attr("type", "text")
            .addClass("ujg-sb-picker-search-input")
            .attr("placeholder", "Поиск...");
        var $options = $("<div/>").addClass("ujg-sb-picker-options");
        options.forEach(function(option) {
            var $button = $("<button type=\"button\"/>")
                .addClass("ujg-sb-picker-option")
                .attr("data-picker-kind", kind)
                .attr("data-value", option.value)
                .text(option.label);
            if (!multi && String(option.value) === String($native.val() || "")) {
                $button.addClass("ujg-sb-picker-option-selected");
            }
            if (multi && selectedMap[String(option.value)]) {
                $button.addClass("ujg-sb-picker-option-selected");
            }
            $options.append($button);
        });
        $popover.append($search, $options);
        $picker.append($native, $chips, $trigger, $popover);
        $field.append($("<span/>").text(labelText), $picker);
        return $field;
    }

    function bindHeaderInteractions() {
        if (!$headerHost || !$headerHost.length) return;
        $headerHost.find(".ujg-sb-project-select").on("change", function() {
            if (services.onProjectChange) services.onProjectChange($(this).val());
        });
        $headerHost.find(".ujg-sb-status-select").on("change", function() {
            if (services.onStatusChange) services.onStatusChange($(this).val());
        });
        $headerHost.find(".ujg-sb-epic-select").on("change", function() {
            if (services.onEpicChange) services.onEpicChange($(this).val());
        });
        $headerHost.find(".ujg-sb-sprint-select").on("change", function() {
            if (services.onSprintChange) services.onSprintChange($(this).val());
        });
        $headerHost.find(".ujg-sb-search").on("input", function() {
            if (services.onSearchInput) services.onSearchInput($(this).val());
        });
        $headerHost.find(".ujg-sb-picker-trigger").on("click", function(ev) {
            ev.preventDefault();
            var picker = this.parentNode;
            var popover = picker ? $(picker).find(".ujg-sb-picker-popover")[0] : null;
            var isOpen = !!(popover && popover.style.display !== "none");
            closeAllPickers();
            if (popover) {
                popover.style.display = isOpen ? "none" : "block";
            }
        });
        $headerHost.find(".ujg-sb-picker-search-input").on("input", function() {
            var picker = this.parentNode && this.parentNode.parentNode ? this.parentNode.parentNode : null;
            var query = String(this.value || "").toLowerCase();
            if (!picker) return;
            $(picker)
                .find(".ujg-sb-picker-option")
                .each(function() {
                    var text = String($(this).text() || "").toLowerCase();
                    this.style.display = !query || text.indexOf(query) >= 0 ? "" : "none";
                });
        });
        $headerHost.find(".ujg-sb-picker-option").on("click", function(ev) {
            ev.preventDefault();
            var kind = $(this).attr("data-picker-kind");
            var value = $(this).attr("data-value") || "";
            if (kind === "project" && services.onProjectChange) {
                services.onProjectChange(value);
                renderHeader();
                return;
            }
            if (kind === "status" && services.onStatusChange) {
                services.onStatusChange(value);
                renderHeader();
                return;
            }
            if (kind === "sprint" && services.onSprintChange) {
                services.onSprintChange(value);
                renderHeader();
                return;
            }
            if (kind === "epic" && services.onEpicChange) {
                var next = selectedEpicKeys().slice();
                var index = next.indexOf(value);
                if (!value) {
                    next = [];
                } else if (index >= 0) {
                    next.splice(index, 1);
                } else {
                    next.push(value);
                }
                services.onEpicChange(next);
                renderHeader();
            }
        });
        $headerHost.find(".ujg-sb-picker-chip").on("click", function(ev) {
            ev.preventDefault();
            if (!services.onEpicChange) return;
            var removeValue = $(this).attr("data-value") || "";
            var next = selectedEpicKeys().filter(function(value) {
                return String(value) !== String(removeValue);
            });
            services.onEpicChange(next);
            renderHeader();
        });
        function notifyViewMode(mode) {
            if (services.onViewMode) services.onViewMode(mode);
            else if (services.onViewModeChange) services.onViewModeChange(mode);
        }
        $headerHost.find(".ujg-sb-view-table").on("click", function() {
            currentViewMode = "table";
            syncViewButtons();
            notifyViewMode("table");
        });
        $headerHost.find(".ujg-sb-view-accordion").on("click", function() {
            currentViewMode = "accordion";
            syncViewButtons();
            notifyViewMode("accordion");
        });
        $headerHost.find(".ujg-sb-view-rows").on("click", function() {
            currentViewMode = "rows";
            syncViewButtons();
            notifyViewMode("rows");
        });
        $headerHost.find(".ujg-sb-expand-all").on("click", function() {
            if (services.onExpandAll) services.onExpandAll();
        });
        $headerHost.find(".ujg-sb-collapse-all").on("click", function() {
            if (services.onCollapseAll) services.onCollapseAll();
        });
    }

    function renderHeader() {
        if (!$headerHost) return;
        $headerHost.empty();
        closeAllPickers();
        var state = currentState();
        var $inner = $("<div/>").addClass("ujg-sb-header-inner");
        $inner.append($("<h1/>").addClass("ujg-sb-title text-sm font-bold w-full shrink-0").text("Stories Dashboard"));
        var $filters = $("<div/>").addClass("ujg-sb-controls");
        $filters.append(
            renderPicker("Проект", "project", "ujg-sb-project-select", singlePickerOptions("project"), false),
            renderPicker("Статус", "status", "ujg-sb-status-select", singlePickerOptions("status"), false),
            renderPicker("Эпик", "epic", "ujg-sb-epic-select", epicPickerOptions(), true),
            renderPicker("Спринт", "sprint", "ujg-sb-sprint-select", singlePickerOptions("sprint"), false),
            $("<label/>")
                .addClass("flex flex-col gap-0.5 text-[10px] text-muted-foreground")
                .append(
                    $("<span/>").text("Поиск"),
                    $("<input/>")
                        .attr("type", "text")
                        .addClass("ujg-sb-search h-7 rounded border border-border px-1 text-[11px] min-w-[140px]")
                        .attr("placeholder", "Поиск...")
                        .attr("value", state.filters && state.filters.search ? state.filters.search : "")
                )
        );
        var $views = $("<div/>").addClass("ujg-sb-view-buttons");
        $views.append(
            $("<button type=\"button\"/>")
                .addClass("ujg-sb-view-btn ujg-sb-view-table rounded border border-border px-2 py-1 text-[10px]")
                .text("Таблица"),
            $("<button type=\"button\"/>")
                .addClass("ujg-sb-view-btn ujg-sb-view-accordion rounded border border-border px-2 py-1 text-[10px]")
                .text("Аккордеон"),
            $("<button type=\"button\"/>")
                .addClass("ujg-sb-view-btn ujg-sb-view-rows rounded border border-border px-2 py-1 text-[10px]")
                .text("Строки")
        );
        var $actions = $("<div/>").addClass("ujg-sb-action-buttons");
        $actions.append(
            $("<button type=\"button\"/>").addClass("ujg-sb-expand-all rounded border border-border px-2 py-1 text-[10px]").text("Развернуть"),
            $("<button type=\"button\"/>").addClass("ujg-sb-collapse-all rounded border border-border px-2 py-1 text-[10px]").text("Свернуть")
        );
        $inner.append($filters, $views, $actions);
        $headerHost.append($inner);
        syncViewButtons();
        bindHeaderInteractions();
    }

    function bindTreeInteractions() {
        function bindToggle(selector) {
            $viewHost.find(selector).on("click", function(ev) {
                ev.stopPropagation();
                var key = $(this).attr("data-epic-key");
                if (key && services.onToggleExpandedKey) {
                    services.onToggleExpandedKey(key);
                }
            });
        }
        if (!$viewHost || !$viewHost.length) return;
        bindToggle(".ujg-sb-epic-toggle");
        bindToggle(".ujg-sb-acc-toggle");
        bindToggle(".ujg-sb-row-toggle");
    }

    function renderTree(tree, viewMode, expanded) {
        if (viewMode) {
            currentViewMode = viewMode;
            syncViewButtons();
        }
        if (!$viewHost) return;
        $viewHost.empty();
        var mode = currentViewMode || "table";
        if (mode === "table") {
            $viewHost.empty().append(renderTable(tree, expanded));
        } else if (mode === "accordion") {
            $viewHost.append(renderAccordion(tree, expanded));
        } else {
            $viewHost.append(renderRows(tree, expanded));
        }
        bindTreeInteractions();
    }

    function renderProgress(loaded, total) {
        if (!$progressHost || !$progressHost.length) return;
        $progressHost.empty();
        $progressHost.removeClass("ujg-sb-progress");
        var ld = Number(loaded);
        var tt = Number(total);
        if (!isFinite(ld)) ld = 0;
        if (ld <= 0 && (!isFinite(tt) || tt <= 0)) {
            return;
        }
        $progressHost.addClass("ujg-sb-progress");
        if (!isFinite(tt) || tt <= 0) {
            $progressHost.append($("<span/>").addClass("ujg-sb-progress-label").text(ld ? String(ld) : ""));
            return;
        }
        var pct = Math.min(100, Math.round((ld / tt) * 100));
        $progressHost.append(
            $("<span/>").addClass("ujg-sb-progress-label font-mono").text(String(ld) + " / " + String(tt)),
            $("<div/>")
                    .addClass("ujg-sb-progress-bar")
                    .append($("<div/>").addClass("ujg-sb-progress-fill").css("width", pct + "%"))
        );
    }

    function init($c, svc) {
        $container = $c;
        services = svc || {};
        currentViewMode = "table";
        $c.empty();
        var $root = $("<div/>").addClass("ujg-sb-root");
        $headerHost = $("<header/>").addClass("ujg-sb-header");
        $progressHost = $("<div/>").addClass("ujg-sb-progress-host");
        $viewHost = $("<div/>").addClass("ujg-sb-view-host");
        $root.append($headerHost, $progressHost, $viewHost);
        $c.append($root);
    }

    return {
        init: init,
        renderHeader: renderHeader,
        renderTree: renderTree,
        renderProgress: renderProgress
    };
});
