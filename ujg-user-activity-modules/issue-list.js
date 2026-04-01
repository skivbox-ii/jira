define("_ujgUA_issueList", ["jquery", "_ujgUA_config", "_ujgUA_utils"], function($, config, utils) {
    "use strict";

    var TYPE_ICONS = config.TYPE_ICONS;

    function create() {
        var expanded = {};

        var $el = $(
            '<div class="dashboard-card px-2 py-1">' +
                '<h3 class="text-[10px] font-semibold text-foreground mb-0.5 uppercase tracking-wider">Задачи</h3>' +
                '<div class="space-y-0 ujg-ua-issue-body"></div>' +
            '</div>'
        );
        var $body = $el.find(".ujg-ua-issue-body");

        function getTypeIconName(type) {
            return TYPE_ICONS[type] || 'checkCircle2';
        }

        function renderIssue(issue) {
            var iconName = getTypeIconName(issue.type);
            var hours = issue.hours != null ? (Math.round(issue.hours * 10) / 10) : 0;
            return '<div class="flex items-center gap-1.5 py-px px-1 rounded hover:bg-secondary/30 transition-colors text-[11px]">' +
                utils.icon(iconName, "w-3 h-3 text-muted-foreground shrink-0") +
                '<div class="min-w-0 flex-1 flex items-center gap-1.5">' +
                    utils.renderIssueLinkWithStatus(issue.key, issue.key, issue.status, {
                        class: "font-mono text-[10px] text-primary font-semibold shrink-0 ujg-ua-issue-key",
                        statusChangedAt: issue.statusChangedAt
                    }) +
                    utils.renderIssueSummaryText(issue.summary, issue.status, {
                        class: "block text-foreground min-w-0 flex-1",
                        statusChangedAt: issue.statusChangedAt
                    }) +
                '</div>' +
                utils.renderIssueStatusBadge(issue.status, issue.statusChangedAt, {
                    class: "font-medium"
                }) +
                '<span class="flex items-center gap-0.5 text-[10px] text-muted-foreground font-mono shrink-0">' +
                    utils.icon("clock", "w-2.5 h-2.5") + ' ' + hours + 'ч' +
                '</span>' +
            '</div>';
        }

        function render(projects) {
            var html = "";
            for (var i = 0; i < projects.length; i++) {
                var proj = projects[i];
                var isExp = !!expanded[proj.key];
                var chevron = isExp ? "chevronDown" : "chevronRight";
                var hours = proj.hours != null ? (Math.round(proj.hours * 10) / 10) : 0;

                html += '<div>' +
                    '<button class="w-full flex items-center gap-1.5 py-0.5 px-1 rounded hover:bg-secondary/50 transition-colors text-[11px] ujg-ua-proj-toggle" data-key="' + utils.escapeHtml(proj.key) + '">' +
                        utils.icon(chevron, "w-3 h-3 text-muted-foreground shrink-0") +
                        '<span class="font-semibold text-foreground">' + utils.escapeHtml(proj.key) + '</span>' +
                        '<span class="text-muted-foreground text-[10px]">' + proj.count + ' задач · ' + hours + 'ч</span>' +
                    '</button>';

                if (isExp && proj.issues) {
                    html += '<div class="ml-4 space-y-0 pb-0.5">';
                    for (var j = 0; j < proj.issues.length; j++) {
                        html += renderIssue(proj.issues[j]);
                    }
                    html += '</div>';
                }

                html += '</div>';
            }
            $body.html(html);
        }

        $body.on("click", ".ujg-ua-proj-toggle", function() {
            var key = $(this).attr("data-key");
            expanded[key] = !expanded[key];
            render($el.data("projects") || []);
        });

        function renderProjects(projects) {
            $el.data("projects", projects);
            render(projects);
        }

        renderProjects([]);

        return { $el: $el, render: renderProjects };
    }

    return { create: create };
});
