define("_ujgUA_projectBreakdown", ["jquery", "_ujgUA_config", "_ujgUA_utils"], function($, config, utils) {
    "use strict";

    var CHART_TEXT = config.CHART_TEXT_COLORS;
    var CHART_BG = config.CHART_COLORS;

    function create() {
        var $el = $('<div class="grid grid-cols-1 lg:grid-cols-2 gap-2"></div>');

        function render(data) {
            var projects = data.projects || [];
            var transitions = data.transitions || [];
            var totalHours = 0;
            for (var i = 0; i < projects.length; i++) totalHours += (projects[i].hours || 0);

            var projHtml =
                '<div class="dashboard-card px-3 py-2">' +
                    '<h3 class="text-[10px] font-semibold text-foreground mb-1.5 uppercase tracking-wider">Проекты</h3>' +
                    '<div class="space-y-1">';

            for (var p = 0; p < projects.length; p++) {
                var proj = projects[p];
                var colorIdx = p % CHART_TEXT.length;
                var pct = totalHours > 0 ? Math.round((proj.hours / totalHours) * 100) : 0;
                projHtml +=
                    '<div class="space-y-0.5">' +
                        '<div class="flex justify-between text-[11px]">' +
                            '<span class="font-semibold ' + CHART_TEXT[colorIdx] + '">' + utils.escapeHtml(proj.key) + '</span>' +
                            '<span class="text-muted-foreground font-mono text-[10px]">' +
                                (Math.round(proj.hours * 10) / 10) + 'ч · ' + proj.count + ' задач' +
                            '</span>' +
                        '</div>' +
                        '<div class="h-1.5 rounded-full bg-secondary overflow-hidden">' +
                            '<div class="h-full rounded-full bg-' + CHART_BG[colorIdx] + '" style="width:' + pct + '%"></div>' +
                        '</div>' +
                    '</div>';
            }

            projHtml += '</div></div>';

            var transHtml =
                '<div class="dashboard-card px-3 py-2">' +
                    '<h3 class="text-[10px] font-semibold text-foreground mb-1.5 uppercase tracking-wider">Переходы статусов</h3>' +
                    '<div class="space-y-0.5">';

            var slice = transitions.slice(0, 8);
            for (var t = 0; t < slice.length; t++) {
                var tr = slice[t];
                transHtml +=
                    '<div class="flex items-center justify-between py-0.5 px-1.5 rounded bg-secondary/30 text-[11px]">' +
                        '<div class="flex items-center gap-1.5">' +
                            '<span class="text-warning text-[10px] font-medium">' + utils.escapeHtml(tr.from) + '</span>' +
                            utils.icon("arrowRight", "w-2.5 h-2.5 text-muted-foreground") +
                            '<span class="text-success text-[10px] font-medium">' + utils.escapeHtml(tr.to) + '</span>' +
                        '</div>' +
                        '<span class="font-mono text-[10px] font-bold text-foreground">' + tr.count + '</span>' +
                    '</div>';
            }

            transHtml += '</div></div>';

            $el.html(projHtml + transHtml);
        }

        render({ projects: [], transitions: [] });

        return { $el: $el, render: render };
    }

    return { create: create };
});
