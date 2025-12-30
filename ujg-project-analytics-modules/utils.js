// Утилиты
define("_ujgPA_utils", ["_ujgPA_config", "_ujgCommon"], function(config, Common) {
    "use strict";
    
    var utils = Common.utils;
    var CONFIG = config.CONFIG;
    
    function log() {
        if (!CONFIG.debug) return;
        var args = Array.prototype.slice.call(arguments);
        args.unshift("[UJG-ProjectAnalytics]");
        window.console && console.log.apply(console, args);
    }
    
    function parseDateSafe(value) {
        if (!value) return null;
        var d = utils.parseDate ? utils.parseDate(value) : new Date(value);
        if (!d || isNaN(d.getTime())) return null;
        return d;
    }
    
    function mergeWithDefaults(defaults, overrides) {
        var result = {};
        Object.keys(defaults).forEach(function(key) {
            result[key] = overrides && overrides[key] !== undefined ? overrides[key] : defaults[key];
        });
        if (overrides) {
            Object.keys(overrides).forEach(function(key) {
                if (result[key] === undefined) result[key] = overrides[key];
            });
        }
        return result;
    }
    
    function normalizeStatusName(name) {
        return (name || "").trim();
    }
    
    function uniqueList(list) {
        var seen = {};
        var result = [];
        (list || []).forEach(function(item) {
            var name = normalizeStatusName(item);
            if (!name || seen[name]) return;
            seen[name] = true;
            result.push(name);
        });
        return result;
    }
    
    function getDefaultPeriod() {
        var now = new Date();
        var end = utils.getDayKey(now);
        var startDate = new Date(now);
        startDate.setDate(startDate.getDate() - Math.min(CONFIG.maxPeriodDays - 1, 29));
        var start = utils.getDayKey(startDate);
        return { start: start, end: end };
    }
    
    function clampPeriod(start, end) {
        if (!start || !end) return getDefaultPeriod();
        var startDate = new Date(start);
        var endDate = new Date(end);
        if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) return getDefaultPeriod();
        if (startDate > endDate) {
            var tmp = startDate;
            startDate = endDate;
            endDate = tmp;
        }
        var diffDays = Math.floor((endDate - startDate) / 86400000) + 1;
        if (diffDays > CONFIG.maxPeriodDays) {
            startDate = new Date(endDate);
            startDate.setDate(endDate.getDate() - (CONFIG.maxPeriodDays - 1));
        }
        return {
            start: utils.getDayKey(startDate),
            end: utils.getDayKey(endDate)
        };
    }
    
    function formatDuration(seconds) {
        if (!seconds || seconds < 0) return "0с";
        var days = Math.floor(seconds / 86400);
        var hours = Math.floor((seconds % 86400) / 3600);
        var minutes = Math.floor((seconds % 3600) / 60);
        var secs = Math.floor(seconds % 60);
        if (days > 0) return days + "д " + hours + "ч";
        if (hours > 0) return hours + "ч " + minutes + "м";
        if (minutes > 0) return minutes + "м " + secs + "с";
        return secs + "с";
    }
    
    function normalizeTimestamp(value) {
        if (!value) return null;
        var d = parseDateSafe(value);
        return d ? d.getTime() : null;
    }
    
    function daysSince(date) {
        if (!date) return null;
        var now = new Date();
        var diff = now.getTime() - (date.getTime ? date.getTime() : date);
        return Math.floor(diff / 86400000);
    }
    
    return {
        log: log,
        parseDateSafe: parseDateSafe,
        mergeWithDefaults: mergeWithDefaults,
        normalizeStatusName: normalizeStatusName,
        uniqueList: uniqueList,
        getDefaultPeriod: getDefaultPeriod,
        clampPeriod: clampPeriod,
        formatDuration: formatDuration,
        normalizeTimestamp: normalizeTimestamp,
        daysSince: daysSince,
        utils: utils
    };
});
