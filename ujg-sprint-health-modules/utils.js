// Утилиты
define("_ujgSH_utils", ["_ujgSH_config"], function(config) {
    "use strict";

    var CONFIG = config.CONFIG;

    var utils = {
        escapeHtml: function(t) { if (!t) return ""; var d = document.createElement("div"); d.textContent = String(t); return d.innerHTML; },
        formatHours: function(s) { if (!s || s <= 0) return "—"; var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return h > 0 ? h + "ч" + (m > 0 ? m + "м" : "") : m + "м"; },
        formatHoursShort: function(s) { return s > 0 ? Math.round(s / 3600) + "ч" : "0"; },
        parseHoursToSeconds: function(t) {
            if (!t) return null;
            var str = String(t).trim();
            if (!str) return null;
            str = str.replace(",", ".");
            var numOnly = str.match(/^\d+(\.\d+)?$/);
            if (numOnly) return Math.round(parseFloat(str) * 3600);
            var re = /(\d+(?:\.\d+)?)(h|ч|m|м)/gi, match, totalH = 0, found = false;
            while ((match = re.exec(str)) !== null) {
                found = true;
                var val = parseFloat(match[1]);
                var unit = match[2].toLowerCase();
                if (unit === "m" || unit === "м") totalH += val / 60;
                else totalH += val;
            }
            if (!found) return null;
            return Math.round(totalH * 3600);
        },
        clamp: function(v, min, max) { return Math.max(min, Math.min(max, v)); },
        parseDate: function(v) { if (!v) return null; var d = new Date(v); return isNaN(d.getTime()) ? null : d; },
        formatDateShort: function(d) { if (!d) return "—"; return (d.getDate() < 10 ? "0" : "") + d.getDate() + "." + (d.getMonth() < 9 ? "0" : "") + (d.getMonth() + 1); },
        formatDateFull: function(d) { if (!d) return "—"; return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" }); },
        getDayKey: function(d) { if (!d) return ""; return d.getFullYear() + "-" + (d.getMonth() < 9 ? "0" : "") + (d.getMonth() + 1) + "-" + (d.getDate() < 10 ? "0" : "") + d.getDate(); },
        formatDateJira: function(d) { if (!d) return ""; var dd = utils.startOfDay(d); return dd ? utils.getDayKey(dd) : ""; },
        parseSprintNames: function(list) {
            if (!list || !Array.isArray(list)) return [];
            return list.map(function(s) {
                if (!s) return "";
                if (typeof s === "string") {
                    var m = s.match(/name=([^,}]+)/);
                    return m ? m[1] : s;
                }
                if (s.name) return s.name;
                return String(s);
            }).filter(Boolean);
        },
        daysBetween: function(start, end) {
            var res = [], cur = new Date(start); cur.setHours(0,0,0,0);
            var ed = new Date(end); ed.setHours(0,0,0,0);
            while (cur <= ed) { if (cur.getDay() !== 0 && cur.getDay() !== 6) res.push(new Date(cur)); cur.setDate(cur.getDate() + 1); }
            return res;
        },
        daysDiff: function(d1, d2) { if (!d1 || !d2) return 0; return Math.floor((d2 - d1) / (1000 * 60 * 60 * 24)); },
        startOfDay: function(d) { if (!d) return null; var nd = new Date(d); nd.setHours(0,0,0,0); return nd; },
        shiftWorkDays: function(date, delta) {
            if (!date) return null;
            var d = utils.startOfDay(date);
            var step = delta >= 0 ? 1 : -1;
            var remain = Math.abs(delta);
            while (remain > 0) {
                d.setDate(d.getDate() + step);
                if (d.getDay() !== 0 && d.getDay() !== 6) remain--;
            }
            return d;
        },
        getWorkDurationDays: function(seconds, hoursPerDay) {
            if (!seconds || seconds <= 0) return 1;
            var hpd = hoursPerDay && hoursPerDay > 0 ? hoursPerDay : 8;
            return Math.max(1, Math.ceil(seconds / (hpd * 3600)));
        },
        getHealthColor: function(p) { return p >= 90 ? "#36b37e" : p >= 70 ? "#ffab00" : p >= 50 ? "#ff8b00" : "#de350b"; },
        getHealthLabel: function(p) { return p >= 90 ? "Отлично" : p >= 70 ? "Хорошо" : p >= 50 ? "Внимание" : "Критично"; },
        // Проверяет, является ли задача подзадачей
        isSubtask: function(issue) {
            if (!issue) return false;
            var f = issue.fields || {};
            var issueType = f.issuetype || {};
            // Проверка по флагу (самый надежный способ)
            if (issueType.subtask === true) return true;
            // Проверка по имени типа задачи
            var typeName = (issueType.name || "").toLowerCase();
            return typeName.indexOf("subtask") !== -1 || typeName.indexOf("подзадача") !== -1;
        },
        // Проверяет, находится ли задача СЕЙЧАС в спринте с указанным ID (не по имени!)
        isIssueInSprintById: function(issue, sprintId) {
            if (!issue || !sprintId) return false;
            var f = issue.fields || {};
            var sprintFieldVal = f[CONFIG.sprintField || "customfield_10020"] || [];
            if (!Array.isArray(sprintFieldVal)) return false;
            var sid = String(sprintId);
            return sprintFieldVal.some(function(s) {
                if (!s) return false;
                // Объект с id (новый формат Jira Cloud)
                if (s.id) return String(s.id) === sid;
                // Строка формата "com.atlassian.greenhopper...id=123,name=..." (Jira Server/DC)
                // id= всегда идёт в начале значения или после [, а после числа идёт , или ]
                if (typeof s === "string") {
                    // Формат: [id=123,rapidViewId=... или ...id=123]
                    return s.indexOf("[id=" + sid + ",") !== -1 || 
                           s.indexOf(",id=" + sid + ",") !== -1 ||
                           s.indexOf("[id=" + sid + "]") !== -1 ||
                           s.indexOf(",id=" + sid + "]") !== -1;
                }
                return false;
            });
        }
    };

    return utils;
});
