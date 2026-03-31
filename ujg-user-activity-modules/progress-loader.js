define("_ujgUA_progressLoader", ["jquery", "_ujgUA_utils"], function($, utils) {
    "use strict";

    function create() {
        var $el = $(
            '<div class="flex flex-col items-center justify-center py-20 gap-4" style="display:none">' +
                '<div class="w-64">' +
                    '<div class="h-2 rounded-full bg-secondary overflow-hidden">' +
                        '<div class="h-full rounded-full bg-primary ujg-ua-progress-bar" style="width:0%;transition:width 0.3s"></div>' +
                    '</div>' +
                '</div>' +
                '<p class="text-sm text-muted-foreground font-mono ujg-ua-progress-text">Загрузка...</p>' +
            '</div>'
        );

        var $bar = $el.find(".ujg-ua-progress-bar");
        var $text = $el.find(".ujg-ua-progress-text");

        function show() {
            $bar.css("width", "0%");
            $text.text("Загрузка...");
            $el.show();
        }

        function hide() {
            $el.hide();
        }

        function update(progress) {
            if (!progress) return;
            var pct = 0;
            var line = "";
            if (progress.phase === "day") {
                var totalDays = progress.totalDays | 0;
                var completedDays = progress.completedDays != null ? progress.completedDays | 0 : 0;
                if (totalDays > 0) {
                    pct = Math.round((completedDays / totalDays) * 100);
                    if (pct > 100) pct = 100;
                }
                var currentDay = progress.currentDay != null
                    ? progress.currentDay | 0
                    : (totalDays ? Math.min(completedDays + 1, totalDays) : completedDays + 1);
                line = "День " + currentDay + " / " + totalDays;
                if (progress.dayKey) line += " (" + progress.dayKey + ")";
                if (progress.userDisplayName) line += " — " + progress.userDisplayName;
            } else {
                if (progress.total > 0) pct = Math.round((progress.loaded / progress.total) * 100);
                line = "Загружено " + progress.loaded + "/" + progress.total + " задач...";
            }
            $bar.css("width", pct + "%");
            $text.text(line);
        }

        return { $el: $el, show: show, hide: hide, update: update };
    }

    return { create: create };
});
