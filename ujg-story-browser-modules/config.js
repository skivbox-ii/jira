define("_ujgSB_config", [], function() {
    "use strict";

    var SVG = ' xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';

    var ICONS = {
        folder: "<svg" + SVG + '><path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v1"/></svg>'
    };

    var TYPE_BADGES = {
        Epic: "E",
        Story: "S",
        Bug: "B",
        Task: "T",
        "Sub-task": "ST",
        "Подзадача": "ST",
        "Frontend Task": "FE",
        "Backend Task": "BE",
        "System Engineer": "SE",
        DevOps: "DO",
        QA: "QA"
    };

    var TYPE_COLORS = {
        Epic: "ujg-sb-type-epic",
        Story: "ujg-sb-type-story",
        Bug: "ujg-sb-type-bug",
        Task: "ujg-sb-type-task",
        "Sub-task": "ujg-sb-type-subtask",
        "Подзадача": "ujg-sb-type-subtask",
        "Frontend Task": "ujg-sb-type-frontend",
        "Backend Task": "ujg-sb-type-backend",
        "System Engineer": "ujg-sb-type-se",
        DevOps: "ujg-sb-type-devops",
        QA: "ujg-sb-type-qa"
    };

    var STATUS_COLORS = {
        Done: "ujg-sb-status-done",
        Closed: "ujg-sb-status-done",
        Resolved: "ujg-sb-status-done",
        "Готово": "ujg-sb-status-done",
        "Закрыт": "ujg-sb-status-done",
        "Закрыта": "ujg-sb-status-done",
        "Завершен": "ujg-sb-status-done",
        "Завершён": "ujg-sb-status-done",
        "Завершена": "ujg-sb-status-done",
        "Выполнено": "ujg-sb-status-done",
        Open: "ujg-sb-status-open",
        "Открыт": "ujg-sb-status-open",
        "In Progress": "ujg-sb-status-progress",
        "В работе": "ujg-sb-status-progress",
        "To Do": "ujg-sb-status-todo",
        "К выполнению": "ujg-sb-status-todo"
    };

    var STATUS_DONE = new Set([
        "Done",
        "Closed",
        "Resolved",
        "Готово",
        "Закрыт",
        "Закрыта",
        "Завершен",
        "Завершён",
        "Завершена",
        "Выполнено"
    ]);

    var PRIORITY_COLORS = {
        Highest: "ujg-sb-priority-highest",
        High: "ujg-sb-priority-high",
        Medium: "ujg-sb-priority-medium",
        Low: "ujg-sb-priority-low",
        Lowest: "ujg-sb-priority-lowest"
    };

    var ISSUE_FIELDS = "summary,status,assignee,issuetype,priority,timeoriginalestimate,timetracking,timespent,components,labels,fixVersions,parent,created,updated,customfield_10014,customfield_10020";

    var EPIC_LINK_FIELD = "customfield_10014";
    var SPRINT_FIELD = "customfield_10020";
    var STORAGE_KEY = "ujg-sb-state";

    var CREATE_TEMPLATE_ROLES = [
        { role: "SE", issueType: "System Engineer", summary: "Анализ и описание функционала" },
        { role: "FE", issueType: "Frontend Task", summary: "Вёрстка / UI" },
        { role: "BE", issueType: "Backend Task", summary: "Реализация логики" },
        { role: "QA", issueType: "QA", summary: "Тестирование" },
        { role: "DO", issueType: "DevOps", summary: "Подготовка окружения / деплой" }
    ];

    function trimSlash(s) {
        return s.replace(/\/+$/, "");
    }

    function resolveJiraBaseUrl() {
        var origin = "";
        var protocol = "https:";
        if (typeof window !== "undefined") {
            origin = trimSlash(window.location.origin || "");
            protocol = window.location.protocol || protocol;
            if (window.AJS && window.AJS.params && window.AJS.params.baseURL != null) {
                var b = trimSlash(String(window.AJS.params.baseURL).trim());
                if (!b) return origin;
                if (/^[a-z]+:\/\//i.test(b)) return b;
                if (b.indexOf("//") === 0) return trimSlash(protocol + b);
                if (b.charAt(0) === "/") return trimSlash(origin + b);
                if (/^[^\/]+\.[^\/]+/.test(b) || /^[^\/]+:\d+(\/|$)/.test(b)) {
                    return trimSlash(protocol + "//" + b.replace(/^\/+/, ""));
                }
                return trimSlash(origin + "/" + b.replace(/^\/+/, ""));
            }
        }
        return origin;
    }

    var baseUrl = resolveJiraBaseUrl();

    return {
        baseUrl: baseUrl,
        ICONS: ICONS,
        TYPE_BADGES: TYPE_BADGES,
        TYPE_COLORS: TYPE_COLORS,
        STATUS_COLORS: STATUS_COLORS,
        STATUS_DONE: STATUS_DONE,
        PRIORITY_COLORS: PRIORITY_COLORS,
        ISSUE_FIELDS: ISSUE_FIELDS,
        EPIC_LINK_FIELD: EPIC_LINK_FIELD,
        SPRINT_FIELD: SPRINT_FIELD,
        STORAGE_KEY: STORAGE_KEY,
        CREATE_TEMPLATE_ROLES: CREATE_TEMPLATE_ROLES
    };
});
