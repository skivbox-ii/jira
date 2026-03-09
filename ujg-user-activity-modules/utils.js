define("_ujgUA_utils", ["_ujgUA_config"], function(config) {
    "use strict";

    var ICONS = config.ICONS;
    var CONFIG = config.CONFIG;

    var WEEKDAYS_RU = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
    var MONTHS_RU = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'];
    var MONTHS_FULL_RU = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
    var PROJECT_COLORS = ["#3B82F6", "#06B6D4", "#F59E0B", "#EC4899", "#8B5CF6", "#10B981", "#F97316", "#6366F1"];

    function log() {
        if (CONFIG.debug && window.console) {
            var args = Array.prototype.slice.call(arguments);
            args.unshift("[UJG-UA]");
            console.log.apply(console, args);
        }
    }

    function pad2(n) {
        return n < 10 ? "0" + n : "" + n;
    }

    function getDayKey(d) {
        return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
    }

    function parseDate(v) {
        if (!v) return null;
        if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
        var d = new Date(v);
        return isNaN(d.getTime()) ? null : d;
    }

    function formatHours(seconds) {
        if (!seconds || seconds <= 0) return "0h";
        var h = Math.round(seconds / 3600);
        return h + "h";
    }

    function formatHoursFromHours(hours) {
        if (!hours || hours <= 0) return "0ч";
        return (Math.round(hours * 10) / 10) + "ч";
    }

    function formatDateTime(d) {
        var dt = parseDate(d);
        if (!dt) return "";
        return dt.getFullYear() + "-" + pad2(dt.getMonth() + 1) + "-" + pad2(dt.getDate()) + " " + pad2(dt.getHours()) + ":" + pad2(dt.getMinutes());
    }

    function formatDateShort(d) {
        var dt = parseDate(d);
        if (!dt) return "";
        var dow = dt.getDay();
        var dayIdx = dow === 0 ? 6 : dow - 1;
        return WEEKDAYS_RU[dayIdx] + ", " + dt.getDate() + " " + MONTHS_RU[dt.getMonth()];
    }

    function escapeHtml(t) {
        if (!t) return "";
        return String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
    }

    function getProjectKey(issueKey) {
        if (!issueKey) return "";
        var idx = issueKey.indexOf("-");
        return idx > 0 ? issueKey.substring(0, idx) : issueKey;
    }

    function getProjectColor(projectKey, colorMap) {
        if (colorMap[projectKey]) return colorMap[projectKey];
        var idx = Object.keys(colorMap).length % PROJECT_COLORS.length;
        colorMap[projectKey] = PROJECT_COLORS[idx];
        return colorMap[projectKey];
    }

    function getDefaultPeriod() {
        var end = new Date();
        var start = new Date();
        start.setDate(start.getDate() - CONFIG.defaultPeriodDays);
        return { start: getDayKey(start), end: getDayKey(end) };
    }

    function computePresetDates(presetId) {
        var now = new Date();
        var start, end;

        switch (presetId) {
            case "this_week":
                start = new Date(now);
                var dow = start.getDay();
                var diff = dow === 0 ? 6 : dow - 1;
                start.setDate(start.getDate() - diff);
                end = new Date(now);
                break;
            case "last_2_weeks":
                end = new Date(now);
                start = new Date(now);
                start.setDate(start.getDate() - 13);
                break;
            case "this_month":
                start = new Date(now.getFullYear(), now.getMonth(), 1);
                end = new Date(now);
                break;
            case "last_month":
                start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
                end = new Date(now.getFullYear(), now.getMonth(), 0);
                break;
            case "last_3_months":
                end = new Date(now);
                start = new Date(now);
                start.setMonth(start.getMonth() - 3);
                break;
            default:
                return getDefaultPeriod();
        }

        return { start: getDayKey(start), end: getDayKey(end) };
    }

    function getHeatBg(hours) {
        if (!hours || hours <= 0) return "bg-heat-0";
        if (hours < 2) return "bg-heat-1";
        if (hours < 5) return "bg-heat-2";
        if (hours < 8) return "bg-heat-3";
        return "bg-heat-4";
    }

    function icon(name, cls) {
        var svg = ICONS[name] || "";
        if (!svg) return "";
        if (cls) {
            return svg.replace("<svg ", '<svg class="' + escapeHtml(cls) + '" ');
        }
        return svg;
    }

    return {
        WEEKDAYS_RU: WEEKDAYS_RU,
        MONTHS_RU: MONTHS_RU,
        MONTHS_FULL_RU: MONTHS_FULL_RU,
        PROJECT_COLORS: PROJECT_COLORS,
        log: log,
        pad2: pad2,
        getDayKey: getDayKey,
        parseDate: parseDate,
        formatHours: formatHours,
        formatHoursFromHours: formatHoursFromHours,
        formatDateTime: formatDateTime,
        formatDateShort: formatDateShort,
        escapeHtml: escapeHtml,
        getProjectKey: getProjectKey,
        getProjectColor: getProjectColor,
        getDefaultPeriod: getDefaultPeriod,
        computePresetDates: computePresetDates,
        getHeatBg: getHeatBg,
        icon: icon
    };
});
