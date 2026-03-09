define("_ujgUA_dailyDetail", ["jquery", "_ujgUA_config", "_ujgUA_utils"], function($, config, utils) {
    "use strict";

    var MONTHS_FULL_RU = utils.MONTHS_FULL_RU;
    var ICONS = config.ICONS;

    function formatFullDate(dateStr) {
        var d = new Date(dateStr + "T00:00:00");
        return d.getDate() + " " + MONTHS_FULL_RU[d.getMonth()] + " " + d.getFullYear();
    }

    function create() {
        var $el = $('<div class="dashboard-card overflow-hidden" style="display:none"></div>');

        function renderContent(date, dayData, issueMap) {
            var html = '<div class="p-5">' +
                '<div class="flex items-center justify-between mb-4">' +
                    '<h3 class="text-sm font-semibold text-foreground">\uD83D\uDCC5 ' + utils.escapeHtml(formatFullDate(date)) + '</h3>' +
                    '<button class="ujg-ua-detail-close text-muted-foreground hover:text-foreground transition-colors">' +
                        '<span class="w-4 h-4">' + ICONS.x + '</span>' +
                    '</button>' +
                '</div>' +
                '<div class="space-y-2">';

            var issueEntries = {};
            var issueKeys = [];

            if (dayData && dayData.worklogs) {
                for (var i = 0; i < dayData.worklogs.length; i++) {
                    var wl = dayData.worklogs[i];
                    if (!issueEntries[wl.issueKey]) {
                        issueEntries[wl.issueKey] = { hours: 0, changes: [] };
                        issueKeys.push(wl.issueKey);
                    }
                    issueEntries[wl.issueKey].hours += wl.timeSpentHours;
                }
            }

            if (dayData && dayData.changes) {
                for (var c = 0; c < dayData.changes.length; c++) {
                    var ch = dayData.changes[c];
                    if (!issueEntries[ch.issueKey]) {
                        issueEntries[ch.issueKey] = { hours: 0, changes: [] };
                        issueKeys.push(ch.issueKey);
                    }
                    if (ch.field === "status") {
                        issueEntries[ch.issueKey].changes.push({ from: ch.fromString, to: ch.toString });
                    }
                }
            }

            for (var k = 0; k < issueKeys.length; k++) {
                var key = issueKeys[k];
                var entry = issueEntries[key];
                var issue = issueMap[key];
                var summary = (issue && issue.summary) || "";
                var hours = Math.round(entry.hours * 100) / 100;

                html += '<div class="flex items-start gap-3 p-2.5 rounded-lg bg-secondary/50 text-sm">' +
                    '<span class="font-mono text-xs font-semibold text-primary shrink-0 mt-0.5">' + utils.escapeHtml(key) + '</span>' +
                    '<div class="flex-1 min-w-0">' +
                        '<div class="text-foreground font-medium truncate">' + utils.escapeHtml(summary) + '</div>' +
                        '<div class="flex flex-wrap gap-2 mt-1">';

                if (hours > 0) {
                    html += '<span class="inline-flex items-center gap-1 text-xs text-muted-foreground">' +
                        '<span class="w-3 h-3">' + ICONS.clock + '</span> ' + hours + 'ч</span>';
                }

                for (var ci = 0; ci < entry.changes.length; ci++) {
                    var change = entry.changes[ci];
                    html += '<span class="inline-flex items-center gap-1 text-xs text-muted-foreground">' +
                        '<span class="text-warning">' + utils.escapeHtml(change.from) + '</span>' +
                        '<span class="w-3 h-3">' + ICONS.arrowRight + '</span>' +
                        '<span class="text-success">' + utils.escapeHtml(change.to) + '</span></span>';
                }

                html += '</div></div></div>';
            }

            if (issueKeys.length === 0) {
                html += '<div class="text-sm text-muted-foreground text-center py-4">Нет активности за этот день</div>';
            }

            html += '</div></div>';
            return html;
        }

        function show(date, dayData, issueMap) {
            $el.html(renderContent(date, dayData, issueMap)).slideDown(200);
            $el.find(".ujg-ua-detail-close").on("click", function() { hide(); });
        }

        function hide() {
            $el.slideUp(200);
        }

        return { $el: $el, show: show, hide: hide };
    }

    return { create: create };
});
