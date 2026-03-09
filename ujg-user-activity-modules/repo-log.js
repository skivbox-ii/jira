define("_ujgUA_repoLog", ["jquery", "_ujgUA_config", "_ujgUA_utils"], function($, config, utils) {
    "use strict";

    var TYPE_LABELS = {
        commit: "Commit",
        branch_commit: "Branch commit",
        branch_update: "Branch",
        pull_request_opened: "PR opened",
        pull_request_merged: "PR merged",
        pull_request_declined: "PR declined",
        pull_request_reviewed: "PR reviewed",
        pull_request_needs_work: "Needs work",
        repository_update: "Repository",
        unknown_dev_event: "Other"
    };
    var UI = {
        title: "Лог репозиторной активности",
        repo: "Репозиторий",
        branch: "Ветка",
        issue: "Задача",
        type: "Тип",
        text: "Текст",
        date: "Дата",
        time: "Время",
        description: "Описание",
        statusHash: "Статус/хеш",
        empty: "Нет событий для выбранных фильтров",
        show: "Открыть",
        hide: "Скрыть",
        author: "Автор",
        reviewers: "Ревьюеры",
        prId: "PR ID",
        prTitle: "PR заголовок",
        prStatus: "PR статус",
        raw: "Raw"
    };

    function escapeHtml(value) {
        return utils.escapeHtml ? utils.escapeHtml(value) : String(value || "");
    }

    function pad2(value) {
        return value < 10 ? "0" + value : String(value);
    }

    function formatTime(timestamp) {
        var date = new Date(timestamp || "");
        if (isNaN(date.getTime())) return "";
        return pad2(date.getHours()) + ":" + pad2(date.getMinutes());
    }

    function getTypeLabel(type) {
        return config.REPO_ACTIVITY_LABELS && config.REPO_ACTIVITY_LABELS[type] || TYPE_LABELS[type] || type || "";
    }

    function getTextHaystack(item) {
        return [
            item.repoName,
            item.branchName,
            item.issueKey,
            item.type,
            getTypeLabel(item.type),
            item.title,
            item.message,
            item.status,
            item.hash,
            item.author,
            (item.reviewers || []).join(" ")
        ].join(" ").toLowerCase();
    }

    function getDateScopedRows(items, selectedDate) {
        return (items || []).filter(function(item) {
            return !selectedDate || item.date === selectedDate;
        });
    }

    function getVisibleRows(state) {
        return getDateScopedRows(state.items, state.selectedDate).filter(function(item) {
            if (state.filters.repo && item.repoName !== state.filters.repo) return false;
            if (state.filters.branch && item.branchName !== state.filters.branch) return false;
            if (state.filters.issue && item.issueKey !== state.filters.issue) return false;
            if (state.filters.type && item.type !== state.filters.type) return false;
            if (state.filters.text && getTextHaystack(item).indexOf(state.filters.text) < 0) return false;
            return true;
        });
    }

    function getOptions(rows, field) {
        var map = {};
        rows.forEach(function(item) {
            var value = item[field];
            if (value) map[value] = true;
        });
        return Object.keys(map).sort();
    }

    function getTypeValueByLabel(rows, label) {
        var map = {};

        rows.forEach(function(item) {
            if (item && item.type) map[getTypeLabel(item.type)] = item.type;
        });

        return map[label] || label || "";
    }

    function renderSelect(label, field, value, options) {
        var html = '<label class="flex flex-col gap-0.5 text-[10px] text-muted-foreground">' + escapeHtml(label);
        html += '<select data-filter="' + field + '" class="h-7 min-w-[110px] rounded border border-border bg-background px-1.5 text-[11px] text-foreground">';
        html += '<option value="">Все</option>';
        options.forEach(function(option) {
            html += '<option value="' + escapeHtml(option) + '"' + (option === value ? ' selected="selected"' : "") + '>' +
                escapeHtml(option) + '</option>';
        });
        html += "</select></label>";
        return html;
    }

    function getDescription(item) {
        return item.message || item.title || item.type || "";
    }

    function getStatusHash(item) {
        if (item.status && item.hash) return item.status + " / " + item.hash;
        return item.status || item.hash || "";
    }

    function getPullRequestId(item) {
        return item.pullRequestId || item.raw && (item.raw.id || item.raw.key) || "";
    }

    function getPullRequestTitle(item) {
        return item.title || item.raw && (item.raw.title || item.raw.name) || "";
    }

    function getPullRequestStatus(item) {
        return item.status || item.raw && item.raw.status || "";
    }

    function buildDetails(item) {
        var raw = item.raw ? JSON.stringify(item.raw) : "";
        var pullRequestId = getPullRequestId(item);
        var pullRequestTitle = getPullRequestTitle(item);
        var pullRequestStatus = getPullRequestStatus(item);
        var details = '<tr class="bg-muted/20"><td colspan="9" class="px-3 py-2">';
        details += '<div class="grid gap-1 text-[11px]">';
        details += '<div><span class="text-muted-foreground">' + UI.repo + ':</span> <span class="font-semibold text-foreground">' + escapeHtml(item.repoName || "") + '</span></div>';
        details += '<div><span class="text-muted-foreground">' + UI.branch + ':</span> <span class="text-foreground">' + escapeHtml(item.branchName || "-") + '</span></div>';
        details += '<div><span class="text-muted-foreground">' + UI.issue + ':</span> <span class="font-mono text-foreground">' + escapeHtml(item.issueKey || "-") + '</span></div>';
        details += '<div><span class="text-muted-foreground">' + UI.author + ':</span> <span class="text-foreground">' + escapeHtml(item.author || "-") + '</span></div>';
        details += '<div><span class="text-muted-foreground">' + UI.reviewers + ':</span> <span class="text-foreground">' + escapeHtml((item.reviewers || []).join(", ") || "-") + '</span></div>';
        if (pullRequestId) {
            details += '<div><span class="text-muted-foreground">' + UI.prId + ':</span> <span class="font-mono text-foreground">' + escapeHtml(pullRequestId) + '</span></div>';
        }
        if (pullRequestTitle) {
            details += '<div><span class="text-muted-foreground">' + UI.prTitle + ':</span> <span class="text-foreground">' + escapeHtml(pullRequestTitle) + '</span></div>';
        }
        if (pullRequestStatus) {
            details += '<div><span class="text-muted-foreground">' + UI.prStatus + ':</span> <span class="text-foreground">' + escapeHtml(pullRequestStatus) + '</span></div>';
        }
        details += '<div><span class="text-muted-foreground">' + UI.description + ':</span> <span class="text-foreground break-all">' + escapeHtml(getDescription(item) || "-") + '</span></div>';
        details += '<div><span class="text-muted-foreground">' + UI.statusHash + ':</span> <span class="text-foreground break-all">' + escapeHtml(getStatusHash(item) || "-") + '</span></div>';
        if (raw) {
            details += '<div><span class="text-muted-foreground">' + UI.raw + ':</span> <span class="font-mono text-foreground break-all">' + escapeHtml(raw) + "</span></div>";
        }
        details += "</div></td></tr>";
        return details;
    }

    function renderHeaderFilter(label, field, value, options, isText) {
        var html = '<div class="flex flex-col gap-1">';
        html += '<span class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">' + escapeHtml(label) + '</span>';
        if (isText) {
            html += '<input data-filter="' + field + '" value="' + escapeHtml(value) + '" class="h-7 w-full rounded border border-border bg-background px-1.5 text-[11px] text-foreground" />';
        } else {
            html += '<select data-filter="' + field + '" class="h-7 w-full rounded border border-border bg-background px-1.5 text-[11px] text-foreground">';
            html += '<option value="">Все</option>';
            options.forEach(function(option) {
                html += '<option value="' + escapeHtml(option) + '"' + (option === value ? ' selected="selected"' : "") + '>' + escapeHtml(option) + '</option>';
            });
            html += "</select>";
        }
        html += "</div>";
        return html;
    }

    function buildRows(rows, expandedIndex) {
        var html = "";

        rows.forEach(function(item, index) {
            var time = formatTime(item.timestamp);
            var isExpanded = String(index) === expandedIndex;

            html += '<tr class="border-b border-border/50 hover:bg-muted/30 ujg-ua-repo-row">';
            html += '<td class="h-[20px] px-1.5 py-0 text-[11px] font-mono text-muted-foreground whitespace-nowrap">' + escapeHtml(item.date || "") + "</td>";
            html += '<td class="h-[20px] px-1.5 py-0 text-[11px] font-mono text-muted-foreground">' + escapeHtml(time) + "</td>";
            html += '<td class="h-[20px] px-1.5 py-0 text-[11px] font-semibold text-primary">' + escapeHtml(item.repoName || "") + "</td>";
            html += '<td class="h-[20px] px-1.5 py-0 text-[11px] text-foreground">' + escapeHtml(item.branchName || "") + "</td>";
            html += '<td class="h-[20px] px-1.5 py-0 text-[11px] font-mono text-foreground">' + escapeHtml(item.issueKey || "") + "</td>";
            html += '<td class="h-[20px] px-1.5 py-0"><span class="rounded px-1 py-0 text-[10px] font-semibold bg-accent text-accent-foreground">' + escapeHtml(getTypeLabel(item.type)) + "</span></td>";
            html += '<td class="h-[20px] px-1.5 py-0 text-[11px] text-foreground max-w-[280px] truncate">' + escapeHtml(getDescription(item)) + "</td>";
            html += '<td class="h-[20px] px-1.5 py-0 text-[11px] font-mono text-muted-foreground max-w-[160px] truncate">' + escapeHtml(getStatusHash(item)) + "</td>";
            html += '<td class="h-[20px] px-1.5 py-0 text-right"><button class="text-[10px] text-primary hover:underline ujg-ua-repo-row-expand" data-idx="' + index + '">' + (isExpanded ? UI.hide : UI.show) + "</button></td>";
            html += "</tr>";

            if (isExpanded) {
                html += buildDetails(item);
            }
        });

        if (!html) {
            html = '<tr><td colspan="9" class="px-3 py-6 text-center text-[11px] text-muted-foreground">' + UI.empty + '</td></tr>';
        }

        return html;
    }

    function buildHtml(state) {
        var dateScopedRows = getDateScopedRows(state.items, state.selectedDate);
        var rows = getVisibleRows(state);
        var headerSuffix = state.selectedDate ? " за " + state.selectedDate : "";
        var html = '<div class="dashboard-card overflow-hidden">';

        html += '<div class="px-2 py-1 border-b border-border flex items-center justify-between gap-2">';
        html += '<h3 class="text-[10px] font-semibold text-foreground uppercase tracking-wider">' + UI.title + escapeHtml(headerSuffix) + "</h3>";
        html += '<span class="text-[10px] font-mono text-muted-foreground">' + rows.length + "/" + state.items.length + "</span>";
        html += "</div>";

        html += '<div class="max-h-[600px] overflow-auto"><div class="relative w-full overflow-auto"><table class="w-full caption-bottom text-sm">';
        html += '<thead><tr class="hover:bg-transparent border-b border-border align-top">';
        html += '<th class="px-1.5 py-1 w-[84px] text-left text-muted-foreground"><div class="text-[10px] font-semibold uppercase tracking-wider">' + UI.date + '</div></th>';
        html += '<th class="px-1.5 py-1 w-[48px] text-left text-muted-foreground"><div class="text-[10px] font-semibold uppercase tracking-wider">' + UI.time + '</div></th>';
        html += '<th class="px-1.5 py-1 w-[140px] text-left text-muted-foreground">' + renderHeaderFilter(UI.repo, "repo", state.filters.repo, getOptions(dateScopedRows, "repoName")) + '</th>';
        html += '<th class="px-1.5 py-1 w-[140px] text-left text-muted-foreground">' + renderHeaderFilter(UI.branch, "branch", state.filters.branch, getOptions(dateScopedRows, "branchName")) + '</th>';
        html += '<th class="px-1.5 py-1 w-[100px] text-left text-muted-foreground">' + renderHeaderFilter(UI.issue, "issue", state.filters.issue, getOptions(dateScopedRows, "issueKey")) + '</th>';
        html += '<th class="px-1.5 py-1 w-[110px] text-left text-muted-foreground">' + renderHeaderFilter(UI.type, "type", state.filters.type ? getTypeLabel(state.filters.type) : "", getOptions(dateScopedRows, "type").map(getTypeLabel)) + '</th>';
        html += '<th class="px-1.5 py-1 text-left text-muted-foreground">' + renderHeaderFilter(UI.description, "text", state.filters.text, [], true) + '</th>';
        html += '<th class="px-1.5 py-1 w-[150px] text-left text-muted-foreground"><div class="text-[10px] font-semibold uppercase tracking-wider">' + UI.statusHash + '</div></th>';
        html += '<th class="px-1.5 py-1 w-[44px] text-right text-muted-foreground"><div class="text-[10px] font-semibold uppercase tracking-wider">+</div></th>';
        html += "</tr></thead><tbody>";
        html += buildRows(rows, state.expandedIndex);
        html += "</tbody></table></div></div></div>";

        return html;
    }

    function create() {
        var state = {
            items: [],
            selectedDate: null,
            expandedIndex: "",
            filters: {
                repo: "",
                branch: "",
                issue: "",
                type: "",
                text: ""
            }
        };
        var $el = $("<div></div>");

        function renderHtml() {
            $el.html(buildHtml(state));
        }

        $el.on("change", "select[data-filter]", function() {
            var field = $(this).attr("data-filter");
            var value = $(this).val();
            if (field === "type") {
                state.filters.type = getTypeValueByLabel(getDateScopedRows(state.items, state.selectedDate), value);
            } else if (Object.prototype.hasOwnProperty.call(state.filters, field)) {
                state.filters[field] = value || "";
            }
            state.expandedIndex = "";
            renderHtml();
        });

        $el.on("input", 'input[data-filter="text"]', function() {
            state.filters.text = ($(this).val() || "").toLowerCase();
            state.expandedIndex = "";
            renderHtml();
        });

        $el.on("click", ".ujg-ua-repo-row-expand", function() {
            var index = $(this).attr("data-idx") || "";
            state.expandedIndex = state.expandedIndex === index ? "" : index;
            renderHtml();
        });

        return {
            $el: $el,
            render: function(repoActivity, selectedDate) {
                state.items = (repoActivity && repoActivity.items || []).slice().sort(function(a, b) {
                    var left = String(a && a.timestamp || "");
                    var right = String(b && b.timestamp || "");
                    return left < right ? 1 : left > right ? -1 : 0;
                });
                state.selectedDate = selectedDate || null;
                state.expandedIndex = "";
                state.filters = {
                    repo: "",
                    branch: "",
                    issue: "",
                    type: "",
                    text: ""
                };
                renderHtml();
            }
        };
    }

    return {
        create: create
    };
});
