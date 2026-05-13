define("_ujgESI_config", [], function() {
  "use strict";

  var EPIC_LINK_FIELD = "customfield_10014";
  var STORAGE_KEY = "ujg-esi-state";
  var SUMMARY_COLUMN = "Замечание";
  var JIRA_COLUMN = "Jira";
  var STORY_ISSUE_TYPE = "Story";
  var DEFAULT_SHEETJS_URL = "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js";

  var KNOWN_COLUMNS = [
    "№",
    "Замечание",
    "Статус",
    "Модуль",
    "Приоритет",
    "Автор",
    "Дата",
    "Исполнитель",
    "Спринт",
    "Комментарий",
    "Jira",
    "Пункт НД",
    "Тип",
    "Скрин",
    "Статус в Jira",
    "Исполнитель в Jira",
    "Подтверждено заказчиком",
  ];

  var CREATE_TEMPLATE_ROLES = [
    { role: "SE", issueType: "System Engineer", summary: "Анализ и описание функционала" },
    { role: "FE", issueType: "Frontend Task", summary: "Вёрстка / UI" },
    { role: "BE", issueType: "Backend Task", summary: "Реализация логики" },
    { role: "QA", issueType: "QA", summary: "Тестирование" },
    { role: "DevOps", issueType: "DevOps", summary: "Подготовка окружения / деплой" },
  ];

  function trimSlash(s) {
    return String(s || "").replace(/\/+$/, "");
  }

  function resolveJiraBaseUrl() {
    var origin = "";
    var protocol = "https:";
    if (typeof window !== "undefined") {
      origin = trimSlash(window.location.origin || "");
      protocol = window.location.protocol || protocol;
      if (window.AJS && window.AJS.params && window.AJS.params.baseURL != null) {
        var baseUrl = trimSlash(String(window.AJS.params.baseURL).trim());
        if (!baseUrl) return origin;
        if (/^[a-z]+:\/\//i.test(baseUrl)) return baseUrl;
        if (baseUrl.indexOf("//") === 0) return trimSlash(protocol + baseUrl);
        if (baseUrl.charAt(0) === "/") return trimSlash(origin + baseUrl);
        return trimSlash(origin + "/" + baseUrl.replace(/^\/+/, ""));
      }
    }
    return origin;
  }

  return {
    baseUrl: resolveJiraBaseUrl(),
    EPIC_LINK_FIELD: EPIC_LINK_FIELD,
    STORAGE_KEY: STORAGE_KEY,
    SUMMARY_COLUMN: SUMMARY_COLUMN,
    JIRA_COLUMN: JIRA_COLUMN,
    STORY_ISSUE_TYPE: STORY_ISSUE_TYPE,
    DEFAULT_SHEETJS_URL: DEFAULT_SHEETJS_URL,
    KNOWN_COLUMNS: KNOWN_COLUMNS,
    CREATE_TEMPLATE_ROLES: CREATE_TEMPLATE_ROLES,
  };
});
