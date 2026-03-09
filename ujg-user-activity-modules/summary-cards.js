define("_ujgUA_summaryCards", ["jquery", "_ujgUA_config", "_ujgUA_utils"], function($, config, utils) {
    "use strict";

    var CARD_DEFS = [
        { icon: "clock",        label: "Всего часов",    key: "totalHours",   suffix: "ч" },
        { icon: "checkSquare",  label: "Задач",          key: "totalIssues",  suffix: "" },
        { icon: "folderOpen",   label: "Проектов",       key: "totalProjects",suffix: "" },
        { icon: "calendarDays", label: "Дней активн.",   key: "activeDays",   suffix: "" },
        { icon: "trendingUp",   label: "Ø часов/день",   key: "avgHoursPerDay",  suffix: "ч" }
    ];

    function create() {
        var $el = $('<div class="grid grid-cols-5 gap-2"></div>');

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
            $el.html(html);
        }

        render({ totalHours: 0, totalIssues: 0, totalProjects: 0, activeDays: 0, avgHoursDay: 0 });

        return { $el: $el, render: render };
    }

    return { create: create };
});
