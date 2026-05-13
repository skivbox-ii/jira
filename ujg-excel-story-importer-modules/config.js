define("_ujgESI_config", [], function() {
  "use strict";

  var EPIC_LINK_FIELD = "customfield_10014";
  var STORAGE_KEY = "ujg-esi-state";
  var SUMMARY_COLUMN = "Замечание";
  var JIRA_COLUMN = "Jira";
  var STORY_ISSUE_TYPE = "Story";
  var CHILD_LINK_TYPE_NAME = "Child";
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
    { role: "SE", issueType: "System Engineer", summary: "Анализ и описание функционала", originalEstimate: "4h", remainingEstimate: "4h" },
    { role: "FE", issueType: "Frontend Task", summary: "Вёрстка / UI", originalEstimate: "6h", remainingEstimate: "6h" },
    { role: "BE", issueType: "Backend Task", summary: "Реализация логики", originalEstimate: "8h", remainingEstimate: "8h" },
    { role: "QA", issueType: "QA", summary: "Тестирование", originalEstimate: "4h", remainingEstimate: "4h" },
    { role: "DevOps", issueType: "DevOps", summary: "Подготовка окружения / деплой", originalEstimate: "4h", remainingEstimate: "4h" },
  ];

  var MODULE_COMPONENT_MAP = {
    "Алармы": "Алармы",
    "АСУТП": "АСУТП",
    "Отдел АСУТП": "АСУТП",
    "PARA": "PARA",
    "PNGI": "PNGI",
    "Multimedia2": "Multimedia2",
    "Мультимедиа": "Multimedia2",
    "Эвоскада замечания": "Эвоскада замечания",
  };

  var PRIORITY_MAP = {
    "Критичный": "Highest",
    "Критический": "Highest",
    "Блокер": "Highest",
    "Высокий": "High",
    "Средний": "Medium",
    "Обычный": "Medium",
    "Низкий": "Low",
    "Самый низкий": "Lowest",
    "Highest": "Highest",
    "High": "High",
    "Medium": "Medium",
    "Low": "Low",
    "Lowest": "Lowest",
  };

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
    CHILD_LINK_TYPE_NAME: CHILD_LINK_TYPE_NAME,
    DEFAULT_SHEETJS_URL: DEFAULT_SHEETJS_URL,
    KNOWN_COLUMNS: KNOWN_COLUMNS,
    CREATE_TEMPLATE_ROLES: CREATE_TEMPLATE_ROLES,
    MODULE_COMPONENT_MAP: MODULE_COMPONENT_MAP,
    PRIORITY_MAP: PRIORITY_MAP,
  };
});
