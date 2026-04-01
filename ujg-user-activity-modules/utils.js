define("_ujgUA_utils", ["_ujgUA_config"], function(config) {
    "use strict";

    var ICONS = config.ICONS;
    var CONFIG = config.CONFIG;

    var WEEKDAYS_RU = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
    var MONTHS_RU = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'];
    var MONTHS_FULL_RU = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
    var PROJECT_COLORS = ["#3B82F6", "#06B6D4", "#F59E0B", "#EC4899", "#8B5CF6", "#10B981", "#F97316", "#6366F1"];
    var DONE_STATUSES = [
        "done",
        "closed",
        "resolved",
        "готово",
        "закрыт",
        "закрыта",
        "завершен",
        "завершён",
        "завершена",
        "выполнено"
    ];

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

    function getJiraBaseUrl() {
        if (typeof window === "undefined") return "";
        var fromAjs = window.AJS && window.AJS.params && String(window.AJS.params.baseURL || "").trim();
        if (fromAjs) return fromAjs.replace(/\/$/, "");
        var origin = window.location && String(window.location.origin || "").trim();
        return origin ? origin.replace(/\/$/, "") : "";
    }

    function buildIssueUrl(issueKey) {
        var key = String(issueKey || "").trim();
        if (!key) return "";
        return getJiraBaseUrl().replace(/\/$/, "") + "/browse/" + encodeURIComponent(key);
    }

    function normalizeLinkAttrs(extraAttrs) {
        if (extraAttrs == null) return "";
        if (typeof extraAttrs === "string") return String(extraAttrs).trim();
        if (typeof extraAttrs !== "object") return String(extraAttrs).trim();

        return Object.keys(extraAttrs).map(function(name) {
            if (!Object.prototype.hasOwnProperty.call(extraAttrs, name)) return "";
            if (!/^[a-zA-Z_:][-a-zA-Z0-9_:.]*$/.test(name)) return "";
            var value = extraAttrs[name];
            if (value == null || value === false) return "";
            if (value === true) return name;
            return name + '="' + escapeHtml(String(value)) + '"';
        }).filter(Boolean).join(" ");
    }

    function renderIssueLink(issueKey, label, extraAttrs) {
        var url = buildIssueUrl(issueKey);
        var text = label != null ? String(label) : String(issueKey || "");
        var attrs = normalizeLinkAttrs(extraAttrs);
        if (!url) return escapeHtml(text);
        return '<a href="' + escapeHtml(url) + '" target="_blank" rel="noopener noreferrer"' +
            (attrs ? " " + attrs : "") + ">" + escapeHtml(text) + "</a>";
    }

    function renderExternalLink(url, label, extraAttrs) {
        var href = String(url || "").trim();
        var text = label != null ? String(label) : href;
        var attrs = normalizeLinkAttrs(extraAttrs);
        if (!href) return escapeHtml(text);
        return '<a href="' + escapeHtml(href) + '" target="_blank" rel="noopener noreferrer"' +
            (attrs ? " " + attrs : "") + ">" + escapeHtml(text) + "</a>";
    }

    function joinClassNames() {
        var seen = {};
        var out = [];
        for (var i = 0; i < arguments.length; i++) {
            String(arguments[i] || "").split(/\s+/).forEach(function(token) {
                if (!token || seen[token]) return;
                seen[token] = true;
                out.push(token);
            });
        }
        return out.join(" ");
    }

    function getStatusName(status) {
        if (!status) return "";
        if (typeof status === "string") return String(status).trim();
        if (status.name != null) return String(status.name).trim();
        if (status.statusCategory && status.statusCategory.name != null) {
            return String(status.statusCategory.name).trim();
        }
        return "";
    }

    function isDoneStatus(status) {
        var name = getStatusName(status);
        if (!name) return false;
        return DONE_STATUSES.indexOf(String(name).toLowerCase()) >= 0;
    }

    function getIssueStatusTitle(status) {
        var name = getStatusName(status);
        return name ? "Текущий статус: " + name : "";
    }

    function renderIssueLinkWithStatus(issueKey, label, status, extraAttrs) {
        if (extraAttrs != null && typeof extraAttrs !== "object") {
            return renderIssueLink(issueKey, label, extraAttrs);
        }
        var attrs = Object.assign({}, extraAttrs || {});
        var title = attrs.title || getIssueStatusTitle(status);
        attrs.class = joinClassNames(attrs.class, isDoneStatus(status) ? "ujg-ua-issue-done" : "");
        if (title) attrs.title = title;
        else delete attrs.title;
        return renderIssueLink(issueKey, label, attrs);
    }

    function renderIssueSummaryText(summary, status, extraAttrs) {
        var text = summary != null ? String(summary) : "";
        if (!text) return "";
        if (extraAttrs != null && typeof extraAttrs !== "object") {
            var rawAttrs = normalizeLinkAttrs(extraAttrs);
            return '<span' + (rawAttrs ? " " + rawAttrs : "") + ">" + escapeHtml(text) + "</span>";
        }
        var attrs = Object.assign({}, extraAttrs || {});
        var title = attrs.title || getIssueStatusTitle(status);
        if (title) attrs.title = title;
        else delete attrs.title;
        var attrString = normalizeLinkAttrs(attrs);
        return '<span' + (attrString ? " " + attrString : "") + ">" + escapeHtml(text) + "</span>";
    }

    function renderIssueRef(issueKey, summary, status, options) {
        options = options || {};
        var title = options.title || getIssueStatusTitle(status);
        var parts = [];
        if (issueKey) {
            parts.push(renderIssueLinkWithStatus(issueKey, options.keyLabel || issueKey, status, {
                class: joinClassNames("ujg-ua-issue-key", options.keyClass),
                title: title
            }));
        }
        if (summary) {
            parts.push(renderIssueSummaryText(summary, status, {
                class: joinClassNames("ujg-ua-issue-summary", options.summaryClass),
                title: title
            }));
        }
        if (!parts.length && options.emptyLabel) {
            parts.push(escapeHtml(options.emptyLabel));
        }
        return parts.join(options.separator != null ? options.separator : " ");
    }

    function pickFirstUrl() {
        for (var i = 0; i < arguments.length; i++) {
            var value = arguments[i];
            if (value && typeof value === "object") {
                if (Array.isArray(value)) {
                    if (!value.length) continue;
                    value = value[0];
                } else if (value.href) {
                    value = value.href;
                } else if (value.url) {
                    value = value.url;
                } else if (Array.isArray(value.self) && value.self.length) {
                    value = value.self[0];
                } else {
                    continue;
                }
            }
            var url = String(value || "").trim();
            if (url) return url;
        }
        return "";
    }

    function buildBitbucketCommitUrl(repoUrl, commitId, explicitUrl) {
        var direct = pickFirstUrl(
            explicitUrl,
            explicitUrl && explicitUrl.href,
            explicitUrl && explicitUrl.self,
            explicitUrl && explicitUrl.self && explicitUrl.self[0] && explicitUrl.self[0].href
        );
        if (direct) return direct;
        var base = String(repoUrl || "").trim().replace(/\/$/, "");
        var hash = String(commitId || "").trim();
        if (!base || !hash) return "";
        return base + "/commits/" + encodeURIComponent(hash);
    }

    function buildBitbucketPullRequestUrl(repoUrl, pullRequestId, explicitUrl) {
        var direct = pickFirstUrl(
            explicitUrl,
            explicitUrl && explicitUrl.href,
            explicitUrl && explicitUrl.self,
            explicitUrl && explicitUrl.self && explicitUrl.self[0] && explicitUrl.self[0].href
        );
        if (direct) return direct;
        var base = String(repoUrl || "").trim().replace(/\/$/, "");
        var id = String(pullRequestId || "").trim();
        if (!base || !id) return "";
        return base + "/pull-requests/" + encodeURIComponent(id);
    }

    function shortHash(value, maxLen) {
        var text = String(value || "").trim();
        var len = Number(maxLen || 10);
        if (!text) return "";
        if (!isFinite(len) || len <= 0) len = 10;
        return text.length <= len ? text : text.substring(0, len);
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

    function formatTime(isoString) {
        if (!isoString) return "";
        var d = new Date(isoString);
        if (isNaN(d.getTime())) return "";
        var h = d.getHours();
        var m = d.getMinutes();
        return (h < 10 ? "0" : "") + h + ":" + (m < 10 ? "0" : "") + m;
    }

    function isWeekendDay(dateKey) {
        var d = new Date(dateKey);
        var dow = d.getDay();
        return dow === 0 || dow === 6;
    }

    function truncate(str, maxLen) {
        if (!str || str.length <= maxLen) return str || "";
        return str.substring(0, maxLen) + "…";
    }

    var IDENTITY_FIELDS = ["accountId", "key", "name", "userName", "displayName"];

    function collectIdentityTokens(obj) {
        if (!obj || typeof obj !== "object") return [];
        var seen = {};
        for (var i = 0; i < IDENTITY_FIELDS.length; i++) {
            var k = IDENTITY_FIELDS[i];
            var v = obj[k];
            if (v == null) continue;
            var s = String(v).trim().toLowerCase();
            if (s) seen[s] = true;
        }
        return Object.keys(seen);
    }

    function matchesSelectedUsers(userLike, selectedUsers) {
        if (!selectedUsers || !selectedUsers.length) return false;
        var a = collectIdentityTokens(userLike);
        if (!a.length) return false;
        var set = {};
        for (var i = 0; i < a.length; i++) set[a[i]] = true;
        for (var u = 0; u < selectedUsers.length; u++) {
            var b = collectIdentityTokens(selectedUsers[u]);
            for (var j = 0; j < b.length; j++) {
                if (set[b[j]]) return true;
            }
        }
        return false;
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
        getJiraBaseUrl: getJiraBaseUrl,
        buildIssueUrl: buildIssueUrl,
        renderIssueLink: renderIssueLink,
        renderExternalLink: renderExternalLink,
        getStatusName: getStatusName,
        isDoneStatus: isDoneStatus,
        getIssueStatusTitle: getIssueStatusTitle,
        renderIssueLinkWithStatus: renderIssueLinkWithStatus,
        renderIssueSummaryText: renderIssueSummaryText,
        renderIssueRef: renderIssueRef,
        buildBitbucketCommitUrl: buildBitbucketCommitUrl,
        buildBitbucketPullRequestUrl: buildBitbucketPullRequestUrl,
        shortHash: shortHash,
        getProjectKey: getProjectKey,
        getProjectColor: getProjectColor,
        getDefaultPeriod: getDefaultPeriod,
        computePresetDates: computePresetDates,
        getHeatBg: getHeatBg,
        icon: icon,
        formatTime: formatTime,
        isWeekendDay: isWeekendDay,
        truncate: truncate,
        matchesSelectedUsers: matchesSelectedUsers
    };
});
