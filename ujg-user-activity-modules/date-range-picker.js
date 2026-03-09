define("_ujgUA_dateRangePicker", ["jquery", "_ujgUA_config", "_ujgUA_utils"], function($, config, utils) {
    "use strict";

    function create(onChange) {
        var showPresets = false;
        var period = utils.getDefaultPeriod();

        var $el = $('<div class="flex items-center gap-1 relative"></div>');

        var $presetBtn = $(
            '<button class="h-6 w-6 flex items-center justify-center rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground" title="Пресеты дат">' +
                utils.icon("calendarRange", "w-3.5 h-3.5") +
            '</button>'
        );
        $el.append($presetBtn);

        var $presetsDropdown = $('<div class="absolute top-full left-0 mt-1 z-50 bg-card border border-border rounded shadow-lg min-w-[160px]" style="display:none"></div>');
        var presets = config.DATE_PRESETS;
        for (var i = 0; i < presets.length; i++) {
            $presetsDropdown.append(
                '<button class="w-full text-left px-2.5 py-1.5 text-[11px] text-foreground hover:bg-muted/60 transition-colors first:rounded-t last:rounded-b" data-preset="' + presets[i].id + '">' +
                    utils.escapeHtml(presets[i].label) +
                '</button>'
            );
        }
        $el.append($presetsDropdown);

        var $startInput = $('<input type="date" class="h-6 px-1 text-[11px] bg-card border border-border rounded text-foreground outline-none focus:ring-1 focus:ring-ring" />');
        var $sep = $('<span class="text-muted-foreground text-[10px]">—</span>');
        var $endInput = $('<input type="date" class="h-6 px-1 text-[11px] bg-card border border-border rounded text-foreground outline-none focus:ring-1 focus:ring-ring" />');

        $el.append($startInput, $sep, $endInput);

        $startInput.val(period.start);
        $endInput.val(period.end);

        function togglePresets() {
            showPresets = !showPresets;
            $presetsDropdown.toggle(showPresets);
        }

        function closePresets() {
            showPresets = false;
            $presetsDropdown.hide();
        }

        function notify() {
            period = { start: $startInput.val(), end: $endInput.val() };
            if (onChange) onChange(period);
        }

        $presetBtn.on("click", function(e) {
            e.stopPropagation();
            togglePresets();
        });

        $presetsDropdown.on("click", "button[data-preset]", function() {
            var id = $(this).attr("data-preset");
            var dates = utils.computePresetDates(id);
            $startInput.val(dates.start);
            $endInput.val(dates.end);
            closePresets();
            notify();
        });

        $startInput.on("change", function() { closePresets(); notify(); });
        $endInput.on("change", function() { closePresets(); notify(); });

        $(document).on("click", function(e) {
            if (!$(e.target).closest($el).length) closePresets();
        });

        return {
            $el: $el,
            getPeriod: function() { return { start: $startInput.val(), end: $endInput.val() }; }
        };
    }

    return { create: create };
});
