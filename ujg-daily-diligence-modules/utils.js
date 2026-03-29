define("_ujgDD_utils", ["_ujgDD_config"], function(config) {
    "use strict";

    var ICONS = config.ICONS;

    function log() {
        if (config.debug && typeof console !== "undefined" && console.log) {
            var a = Array.prototype.slice.call(arguments);
            a.unshift("[UJG-DD]");
            console.log.apply(console, a);
        }
    }

    function fmtReaction(min) {
        if (min < 60) return min + "м";
        var h = Math.floor(min / 60);
        var r = min % 60;
        return r > 0 ? h + "ч" + r + "м" : h + "ч";
    }

    function reactionColor(min) {
        var m = Number(min);
        if (!isFinite(m)) return "text-destructive";
        if (m <= 30) return "text-success";
        if (m <= 120) return "text-warning";
        return "text-destructive";
    }

    function getDefaultRange() {
        var end = new Date();
        var start = new Date();
        start.setDate(start.getDate() - 7);
        return [start.toISOString().slice(0, 10), end.toISOString().slice(0, 10)];
    }

    function getPresets() {
        var today = new Date();
        var fmt = function(d) {
            return d.toISOString().slice(0, 10);
        };
        var oneWeekAgo = new Date(today);
        oneWeekAgo.setDate(today.getDate() - 7);
        var twoWeeksAgo = new Date(today);
        twoWeeksAgo.setDate(today.getDate() - 14);
        var startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
        return [
            { label: "Текущая неделя", from: fmt(oneWeekAgo), to: fmt(today) },
            { label: "Последние 2 недели", from: fmt(twoWeeksAgo), to: fmt(today) },
            { label: "Текущий месяц", from: fmt(startOfMonth), to: fmt(today) }
        ];
    }

    function getDatesInRange(start, end) {
        var dates = [];
        var d = new Date(start);
        var e = new Date(end);
        while (d <= e) {
            dates.push(d.toISOString().slice(0, 10));
            d.setDate(d.getDate() + 1);
        }
        return dates;
    }

    function escapeHtml(t) {
        if (!t) return "";
        return String(t)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    function icon(name, cls) {
        var svg = ICONS[name] || "";
        if (!svg) return "";
        if (cls) {
            return svg.replace("<svg ", '<svg class="' + escapeHtml(cls) + '" ');
        }
        return svg;
    }

    function pluralize(n, one, few, many) {
        var x = Math.abs(Math.floor(Number(n))) % 100;
        var x1 = x % 10;
        if (x > 10 && x < 20) return many;
        if (x1 > 1 && x1 < 5) return few;
        if (x1 === 1) return one;
        return many;
    }

    return {
        fmtReaction: fmtReaction,
        reactionColor: reactionColor,
        getDefaultRange: getDefaultRange,
        getPresets: getPresets,
        getDatesInRange: getDatesInRange,
        escapeHtml: escapeHtml,
        icon: icon,
        pluralize: pluralize,
        log: log
    };
});
