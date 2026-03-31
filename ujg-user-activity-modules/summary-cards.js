define("_ujgUA_summaryCards", ["jquery", "_ujgUA_config", "_ujgUA_utils"], function($, config, utils) {
    "use strict";

    var CARD_DEFS = [
        { icon: "clock",        label: "Всего часов",    key: "totalHours",   suffix: "ч" },
        { icon: "checkSquare",  label: "Задач",          key: "totalIssues",  suffix: "" },
        { icon: "folderOpen",   label: "Проектов",       key: "totalProjects",suffix: "" },
        { icon: "calendarDays", label: "Дней активн.",   key: "activeDays",   suffix: "" },
        { icon: "trendingUp",   label: "Ø часов/день",   key: "avgHoursPerDay",  suffix: "ч" }
    ];

    function formatHoursCell(hours) {
        var n = hours == null ? 0 : Number(hours);
        if (isNaN(n)) n = 0;
        return (Math.round(n * 10) / 10) + "ч";
    }

    function buildUserStatsTableHtml(userStats) {
        var keys = Object.keys(userStats).sort();
        var rows = "";
        for (var i = 0; i < keys.length; i++) {
            var u = userStats[keys[i]];
            var name = u && u.displayName != null ? String(u.displayName) : keys[i];
            var activeDays = u && u.activeDays != null ? Number(u.activeDays) : 0;
            var daysWithoutWorklogs = u && u.daysWithoutWorklogs != null ? Number(u.daysWithoutWorklogs) : 0;
            var rowClass = daysWithoutWorklogs > 0 ? ' class="ujg-ua-stat-warn"' : "";
            rows +=
                "<tr" + rowClass + ">" +
                "<td>" + utils.escapeHtml(name) + "</td>" +
                "<td>" + formatHoursCell(u && u.totalHours) + "</td>" +
                "<td>" + (isNaN(activeDays) ? 0 : activeDays) + "</td>" +
                "<td>" + (isNaN(daysWithoutWorklogs) ? 0 : daysWithoutWorklogs) + "</td>" +
                "</tr>";
        }
        return (
            '<div class="ujg-ua-user-stats-table">' +
            "<table>" +
            "<tr><th>Пользователь</th><th>Часы</th><th>Активных дней</th><th>Без трудозатрат</th></tr>" +
            rows +
            "</table>" +
            "</div>"
        );
    }

    function create() {
        var $wrap = $('<div class="flex flex-col gap-2"></div>');
        var $grid = $('<div class="grid grid-cols-5 gap-2"></div>');
        $wrap.append($grid);

        function render(data) {
            var html = "";
            for (var i = 0; i < CARD_DEFS.length; i++) {
                var c = CARD_DEFS[i];
                var val = data[c.key];
                if (val == null) val = 0;
                if (typeof val === "number" && val % 1 !== 0) val = Math.round(val * 10) / 10;
                html +=
                    '<div class="dashboard-card px-2.5 py-1.5 flex items-center gap-2">' +
                        utils.icon(c.icon, "w-3.5 h-3.5 text-muted-foreground shrink-0") +
                        '<span class="text-[10px] text-muted-foreground shrink-0">' + utils.escapeHtml(c.label) + '</span>' +
                        '<span class="text-sm font-bold text-foreground ml-auto">' +
                            val + '<span class="text-xs text-muted-foreground">' + c.suffix + '</span>' +
                        '</span>' +
                    '</div>';
            }
            $grid.html(html);

            $wrap.find(".ujg-ua-user-stats-table").remove();
            var us = data.userStats;
            var nUsers = us && typeof us === "object" ? Object.keys(us).length : 0;
            if (nUsers > 1) {
                $wrap.append(buildUserStatsTableHtml(us));
            }
        }

        render({ totalHours: 0, totalIssues: 0, totalProjects: 0, activeDays: 0, avgHoursPerDay: 0 });

        return { $el: $wrap, render: render };
    }

    return { create: create };
});
