define("_ujgUA_activityLog", ["jquery", "_ujgUA_config", "_ujgUA_utils"], function($, config, utils) {
    "use strict";

    function buildRows(data) {
        var rows = [];
        var issueMap = data.issueMap || {};
        var keys = Object.keys(issueMap);

        for (var i = 0; i < keys.length; i++) {
            var issueKey = keys[i];
            var issue = issueMap[issueKey];
            var summary = issue.summary || "";
            var project = issue.project || utils.getProjectKey(issueKey);

            var worklogs = issue.worklogs || [];
            for (var w = 0; w < worklogs.length; w++) {
                var wl = worklogs[w];
                var hrs = wl.timeSpentHours || 0;
                var comment = wl.comment || "";
                var wlRawTs = wl.timestamp || wl.started || wl.date;
                var wlTime = utils.formatTime(wlRawTs) || "";
                var wlAuthor = wl.author && (wl.author.displayName || wl.author.name) || "";
                rows.push({
                    timestamp: wlRawTs || wl.date || "",
                    date: wl.date,
                    time: wlTime,
                    author: wlAuthor,
                    issueKey: issueKey,
                    project: project,
                    summary: summary,
                    action: "Worklog",
                    detail: hrs + "ч" + (comment ? " — " + comment : ""),
                    hours: hrs
                });
            }

            var changelogs = issue.changelogs || [];
            for (var c = 0; c < changelogs.length; c++) {
                var ch = changelogs[c];
                var field = ch.field || "";
                var fromStr = ch.fromString || "";
                var toStr = ch.toString || "";
                var chRawTs = ch.timestamp || ch.created || ch.date;
                var chTime = utils.formatTime(chRawTs) || "";
                var chAuthor = ch.author && (ch.author.displayName || ch.author.name) || "";
                rows.push({
                    timestamp: chRawTs || ch.date || "",
                    date: ch.date,
                    time: chTime,
                    author: chAuthor,
                    issueKey: issueKey,
                    project: project,
                    summary: summary,
                    action: field === "status" ? "Status" : field,
                    detail: fromStr && toStr ? fromStr + " → " + toStr : toStr || "",
                    hours: null
                });
            }
        }

        rows.sort(function(a, b) { return b.timestamp < a.timestamp ? -1 : b.timestamp > a.timestamp ? 1 : 0; });
        return rows;
    }

    function ColumnFilter($th, label, allValues, onFilter) {
        var selected = {};
        for (var i = 0; i < allValues.length; i++) selected[allValues[i]] = true;
        var isOpen = false;

        var $wrap = $('<div class="relative inline-flex"></div>');
        var $btn = $('<button class="inline-flex items-center gap-0.5 hover:text-foreground transition-colors">' +
            utils.escapeHtml(label) + ' ' + utils.icon("chevronDown", "w-2.5 h-2.5") + '</button>');
        $wrap.append($btn);

        var $drop = $('<div class="absolute top-full left-0 mt-1 z-50 bg-card border border-border rounded shadow-lg min-w-[140px] max-h-[240px] flex flex-col" style="display:none"></div>');
        var $searchWrap = $('<div class="p-1 border-b border-border"></div>');
        var $searchInp = $('<input placeholder="Поиск..." class="w-full h-6 px-1.5 text-[10px] bg-muted/50 border border-border rounded text-foreground outline-none" />');
        $searchWrap.append($searchInp);
        $drop.append($searchWrap);

        var $list = $('<div class="overflow-y-auto flex-1 p-1"></div>');
        $drop.append($list);

        var $resetWrap = $('<div class="p-1 border-t border-border" style="display:none"></div>');
        var $resetBtn = $('<button class="text-[10px] text-primary hover:underline flex items-center gap-0.5">' +
            utils.icon("x", "w-2.5 h-2.5") + ' Сбросить</button>');
        $resetWrap.append($resetBtn);
        $drop.append($resetWrap);

        $wrap.append($drop);
        $th.empty().append($wrap);

        function renderOptions(filter) {
            var fq = (filter || "").toLowerCase();
            var html = '<label class="flex items-center gap-1.5 px-1 py-0.5 text-[10px] text-muted-foreground hover:bg-muted/50 rounded cursor-pointer">' +
                '<input type="checkbox" class="w-3 h-3 ujg-ua-cf-all" ' + (isAllSelected() ? "checked" : "") + ' /> (Все)</label>';
            for (var i = 0; i < allValues.length; i++) {
                var v = allValues[i];
                if (fq && v.toLowerCase().indexOf(fq) === -1) continue;
                html += '<label class="flex items-center gap-1.5 px-1 py-0.5 text-[10px] text-foreground hover:bg-muted/50 rounded cursor-pointer">' +
                    '<input type="checkbox" class="w-3 h-3 ujg-ua-cf-cb" data-val="' + utils.escapeHtml(v) + '"' + (selected[v] ? ' checked' : '') + ' /> ' +
                    utils.escapeHtml(v) + '</label>';
            }
            $list.html(html);
            $resetWrap.toggle(!isAllSelected());
            $btn.html(utils.escapeHtml(label) + ' ' + (isAllSelected() ? utils.icon("chevronDown", "w-2.5 h-2.5") : utils.icon("filter", "w-2.5 h-2.5")));
            if (!isAllSelected()) $btn.addClass("text-primary"); else $btn.removeClass("text-primary");
        }

        function isAllSelected() {
            for (var i = 0; i < allValues.length; i++) if (!selected[allValues[i]]) return false;
            return true;
        }

        $btn.on("click", function(e) {
            e.stopPropagation();
            isOpen = !isOpen;
            if (isOpen) { renderOptions(); $drop.show(); $searchInp.focus(); } else { $drop.hide(); }
        });

        $list.on("change", ".ujg-ua-cf-cb", function() {
            var val = $(this).attr("data-val");
            selected[val] = $(this).prop("checked");
            renderOptions($searchInp.val());
            onFilter(selected);
        });

        $list.on("change", ".ujg-ua-cf-all", function() {
            var checked = $(this).prop("checked");
            for (var i = 0; i < allValues.length; i++) selected[allValues[i]] = checked;
            renderOptions($searchInp.val());
            onFilter(selected);
        });

        $searchInp.on("input", function() { renderOptions($(this).val()); });

        $resetBtn.on("click", function() {
            for (var i = 0; i < allValues.length; i++) selected[allValues[i]] = true;
            renderOptions();
            onFilter(selected);
        });

        $(document).on("click", function(e) {
            if (isOpen && !$(e.target).closest($wrap).length) { isOpen = false; $drop.hide(); }
        });

        return { getSelected: function() { return selected; } };
    }

    function TextFilter($th, label, onFilter) {
        var $wrap = $('<div class="relative inline-flex"></div>');
        var textVal = "";
        var isOpen = false;

        var $btn = $('<button class="inline-flex items-center gap-0.5 hover:text-foreground transition-colors">' +
            utils.escapeHtml(label) + ' ' + utils.icon("chevronDown", "w-2.5 h-2.5") + '</button>');
        $wrap.append($btn);

        var $drop = $('<div class="absolute top-full left-0 mt-1 z-50 bg-card border border-border rounded shadow-lg min-w-[180px] p-1" style="display:none"></div>');
        var $input = $('<input placeholder="Поиск по описанию..." class="w-full h-6 px-1.5 text-[10px] bg-muted/50 border border-border rounded text-foreground outline-none" />');
        $drop.append($input);
        var $reset = $('<button class="mt-1 text-[10px] text-primary hover:underline flex items-center gap-0.5" style="display:none">' +
            utils.icon("x", "w-2.5 h-2.5") + ' Сбросить</button>');
        $drop.append($reset);
        $wrap.append($drop);
        $th.empty().append($wrap);

        $btn.on("click", function(e) {
            e.stopPropagation();
            isOpen = !isOpen;
            if (isOpen) { $drop.show(); $input.focus(); } else { $drop.hide(); }
        });

        $input.on("input", function() {
            textVal = $(this).val();
            $reset.toggle(!!textVal);
            if (textVal) $btn.addClass("text-primary"); else $btn.removeClass("text-primary");
            $btn.html(utils.escapeHtml(label) + ' ' + (textVal ? utils.icon("filter", "w-2.5 h-2.5") : utils.icon("chevronDown", "w-2.5 h-2.5")));
            onFilter(textVal.toLowerCase());
        });

        $reset.on("click", function() {
            textVal = "";
            $input.val("");
            $reset.hide();
            $btn.removeClass("text-primary").html(utils.escapeHtml(label) + ' ' + utils.icon("chevronDown", "w-2.5 h-2.5"));
            onFilter("");
        });

        $(document).on("click", function(e) {
            if (isOpen && !$(e.target).closest($wrap).length) { isOpen = false; $drop.hide(); }
        });

        return { getQuery: function() { return textVal; } };
    }

    function create() {
        var allRows = [];
        var filters = { project: null, issue: null, action: null, text: "" };
        var expandedRow = null;

        var $el = $(
            '<div class="dashboard-card overflow-hidden">' +
                '<div class="px-2 py-1 border-b border-border flex items-center justify-between">' +
                    '<h3 class="text-[10px] font-semibold text-foreground uppercase tracking-wider">Лог действий</h3>' +
                    '<span class="text-[10px] font-mono text-muted-foreground ujg-ua-log-count"></span>' +
                '</div>' +
                '<div class="max-h-[600px] overflow-auto">' +
                    '<div class="relative w-full overflow-auto">' +
                    '<table class="w-full caption-bottom text-sm">' +
                        '<thead><tr class="hover:bg-transparent border-b border-border">' +
                            '<th class="h-5 px-1.5 text-[10px] font-semibold uppercase tracking-wider w-[68px] text-left text-muted-foreground">Дата</th>' +
                            '<th class="h-5 px-1.5 text-[10px] font-semibold uppercase tracking-wider w-[40px] text-left text-muted-foreground">Время</th>' +
                            '<th class="h-5 px-1.5 text-[10px] font-semibold uppercase tracking-wider min-w-[72px] max-w-[140px] text-left text-muted-foreground">Автор</th>' +
                            '<th class="h-5 px-1.5 text-[10px] font-semibold uppercase tracking-wider w-[48px] text-left text-muted-foreground ujg-ua-th-project"></th>' +
                            '<th class="h-5 px-1.5 text-[10px] font-semibold uppercase tracking-wider w-[84px] text-left text-muted-foreground ujg-ua-th-issue"></th>' +
                            '<th class="h-5 px-1.5 text-[10px] font-semibold uppercase tracking-wider text-left text-muted-foreground ujg-ua-th-desc"></th>' +
                            '<th class="h-5 px-1.5 text-[10px] font-semibold uppercase tracking-wider w-[60px] text-left text-muted-foreground ujg-ua-th-type"></th>' +
                            '<th class="h-5 px-1.5 text-[10px] font-semibold uppercase tracking-wider text-left text-muted-foreground">Детали</th>' +
                            '<th class="h-5 px-1.5 text-[10px] font-semibold uppercase tracking-wider w-[36px] text-right text-muted-foreground">Часы</th>' +
                            '<th class="h-5 px-1.5 text-[10px] font-semibold uppercase tracking-wider w-[24px]"></th>' +
                        '</tr></thead>' +
                        '<tbody class="ujg-ua-log-tbody"></tbody>' +
                    '</table>' +
                    '</div>' +
                '</div>' +
            '</div>'
        );

        var $tbody = $el.find(".ujg-ua-log-tbody");
        var $count = $el.find(".ujg-ua-log-count");

        function uniqueVals(field) {
            var map = {};
            for (var i = 0; i < allRows.length; i++) { var v = allRows[i][field]; if (v) map[v] = true; }
            return Object.keys(map).sort();
        }

        function getFilteredRows() {
            var result = [];
            for (var i = 0; i < allRows.length; i++) {
                var r = allRows[i];
                if (filters.project && !filters.project[r.project]) continue;
                if (filters.issue && !filters.issue[r.issueKey]) continue;
                if (filters.action && !filters.action[r.action]) continue;
                if (filters.text && r.summary.toLowerCase().indexOf(filters.text) === -1) continue;
                result.push(r);
            }
            return result;
        }

        function renderRows() {
            var filtered = getFilteredRows();
            $count.text(filtered.length + "/" + allRows.length);

            var html = "";
            for (var i = 0; i < filtered.length; i++) {
                var r = filtered[i];
                var isExp = expandedRow === i;
                var hrs = r.hours != null ? (Math.round(r.hours * 100) / 100).toFixed(1) : "";
                var actionCls = r.action === "Worklog" ? "bg-primary/10 text-primary" : "bg-accent text-accent-foreground";

                html +=
                    '<tr class="border-b border-border/50 hover:bg-muted/30">' +
                        '<td class="h-[20px] px-1.5 py-0 text-[11px] font-mono text-muted-foreground whitespace-nowrap">' + r.date + '</td>' +
                        '<td class="h-[20px] px-1.5 py-0 text-[11px] font-mono text-muted-foreground">' + r.time + '</td>' +
                        '<td class="h-[20px] px-1.5 py-0 text-[11px] text-foreground max-w-[140px] min-w-0 whitespace-normal break-words" title="' + utils.escapeHtml(r.author || "") + '">' + utils.escapeHtml(r.author || "") + '</td>' +
                        '<td class="h-[20px] px-1.5 py-0"><span class="text-[10px] font-semibold text-primary">' + utils.escapeHtml(r.project) + '</span></td>' +
                        '<td class="h-[20px] px-1.5 py-0 text-[11px] font-mono font-medium text-foreground">' +
                            (r.issueKey ? utils.renderIssueLink(r.issueKey, r.issueKey, {
                                class: "text-[11px] font-mono font-medium text-foreground ujg-ua-issue-key"
                            }) : "") +
                            "</td>" +
                        '<td class="h-[20px] px-1.5 py-0 text-[11px] text-foreground max-w-[200px] min-w-0 whitespace-normal break-words">' + utils.escapeHtml(r.summary) + '</td>' +
                        '<td class="h-[20px] px-1.5 py-0"><span class="text-[10px] font-semibold px-1 py-0 rounded ' + actionCls + '">' + utils.escapeHtml(r.action) + '</span></td>' +
                        '<td class="h-[20px] px-1.5 py-0 text-[11px] text-muted-foreground max-w-[180px] min-w-0 whitespace-normal break-words">' + utils.escapeHtml(r.detail) + '</td>' +
                        '<td class="h-[20px] px-1.5 py-0 text-[11px] font-mono text-right font-medium text-foreground">' + hrs + '</td>' +
                        '<td class="h-[20px] px-1.5 py-0"><button class="text-[9px] text-primary hover:underline ujg-ua-row-expand" data-idx="' + i + '">' + (isExp ? '&#9650;' : '&#9654;') + '</button></td>' +
                    '</tr>';

                if (isExp) {
                    html +=
                        '<tr class="bg-muted/20"><td colspan="10" class="px-3 py-2"><div class="text-[11px] space-y-1">' +
                            '<div class="flex gap-4 flex-wrap"><span class="text-muted-foreground">Задача:</span>' +
                            (r.issueKey ? utils.renderIssueLink(r.issueKey, r.issueKey, {
                                class: "font-mono font-semibold text-primary ujg-ua-issue-key"
                            }) : '<span class="font-mono font-semibold text-primary">-</span>') +
                            '<span class="text-foreground">' + utils.escapeHtml(r.summary) + '</span></div>' +
                            '<div class="flex gap-4 flex-wrap"><span class="text-muted-foreground">Проект:</span><span class="font-semibold text-foreground">' + utils.escapeHtml(r.project) + '</span></div>' +
                            '<div class="flex gap-4 flex-wrap"><span class="text-muted-foreground">Тип:</span><span class="font-semibold text-foreground">' + utils.escapeHtml(r.action) + '</span></div>' +
                            (r.author ? '<div class="flex gap-4 flex-wrap"><span class="text-muted-foreground">Автор:</span><span class="text-foreground">' + utils.escapeHtml(r.author) + '</span></div>' : '') +
                            '<div class="flex gap-4 flex-wrap"><span class="text-muted-foreground">Дата/Время:</span><span class="font-mono text-foreground">' + r.date + ' ' + r.time + '</span></div>' +
                            '<div class="flex gap-4 flex-wrap"><span class="text-muted-foreground">Детали:</span><span class="text-foreground break-all">' + utils.escapeHtml(r.detail) + '</span></div>' +
                            (r.hours != null ? '<div class="flex gap-4 flex-wrap"><span class="text-muted-foreground">Часы:</span><span class="font-bold text-foreground">' + r.hours + 'ч</span></div>' : '') +
                        '</div></td></tr>';
                }
            }
            $tbody.html(html);
        }

        $tbody.on("click", ".ujg-ua-row-expand", function() {
            var idx = parseInt($(this).attr("data-idx"), 10);
            expandedRow = expandedRow === idx ? null : idx;
            renderRows();
        });

        function render(data) {
            allRows = buildRows(data);
            filters = { project: null, issue: null, action: null, text: "" };
            expandedRow = null;

            var projects = uniqueVals("project");
            var issues = uniqueVals("issueKey");
            var actions = uniqueVals("action");

            ColumnFilter($el.find(".ujg-ua-th-project"), "Проект", projects, function(sel) { filters.project = sel; renderRows(); });
            ColumnFilter($el.find(".ujg-ua-th-issue"), "Задача", issues, function(sel) { filters.issue = sel; renderRows(); });
            ColumnFilter($el.find(".ujg-ua-th-type"), "Тип", actions, function(sel) { filters.action = sel; renderRows(); });
            TextFilter($el.find(".ujg-ua-th-desc"), "Описание", function(q) { filters.text = q; renderRows(); });

            renderRows();
        }

        return { $el: $el, render: render };
    }

    return { create: create };
});
