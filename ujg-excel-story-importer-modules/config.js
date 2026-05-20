define("_ujgESI_config", [], function() {
  "use strict";

  var EPIC_LINK_FIELD = "customfield_10109";
  var STORAGE_KEY = "ujg-esi-state";
  var MAPPING_STORAGE_KEY = "ujg-esi-mapping-settings";
  var SUMMARY_COLUMN = "Замечание";
  var SUMMARY_MAX_LENGTH = 250;
  var JIRA_COLUMN = "Jira";
  var SPRINT_FIELD = "customfield_10020";
  var STORY_ISSUE_TYPE = "Story";
  var CHILD_LINK_TYPE_NAME = "Child";
  var BLOCKS_LINK_TYPE_NAME = "Blocks";
  var DEFAULT_SHEETJS_URL = "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js";
  var DEFAULT_JSZIP_URL = "https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js";
  var LLM_CONFIG_STORAGE_KEY = "ujg-shared-llm-config";

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
    { role: "SE", issueType: "Задача разработки", summary: "Анализ и описание функционала", originalEstimate: "4h", remainingEstimate: "4h" },
    { role: "FE", issueType: "Задача разработки", summary: "Вёрстка / UI", originalEstimate: "6h", remainingEstimate: "6h" },
    { role: "BE", issueType: "Задача разработки", summary: "Реализация логики", originalEstimate: "8h", remainingEstimate: "8h" },
    { role: "QA", issueType: "Задача разработки", summary: "Тестирование", originalEstimate: "4h", remainingEstimate: "4h" },
    { role: "DevOps", issueType: "Задача разработки", summary: "Подготовка окружения / деплой", originalEstimate: "4h", remainingEstimate: "4h" },
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

  var COLUMN_MAP = {
    summary: "Замечание",
    jira: "Jira",
    module: "Модуль",
    priority: "Приоритет",
    statusInJira: "Статус в Jira",
    assigneeInJira: "Исполнитель в Jira",
    sprintInJira: "Спринт",
  };

  var TABLE_START = {
    headerMarker: "Замечание",
  };

  var LLM_SUMMARY_PROMPTS = {
    story: [
      "Ты помогаешь заводить Jira Story из строки Excel-журнала замечаний приемки.",
      "Сократи и переформулируй исходное замечание в понятный Jira Summary.",
      "Сохрани смысл, объект и важные условия. Не добавляй фактов, которых нет во входном тексте.",
      "Не добавляй префиксы ролей вроде [SE], [FE], [BE], [QA], [DevOps].",
      "Верни только один заголовок без кавычек, markdown и пояснений. Максимум 250 символов."
    ].join("\n"),
    SE: [
      "Ты системный аналитик. Сформулируй Jira Summary для задачи SE внутри истории по замечанию приемки.",
      "Название должно начинаться с [SE]. Опиши анализ, уточнение требований или постановку решения.",
      "Сохрани предмет замечания, не добавляй новых фактов. Верни только заголовок, максимум 250 символов."
    ].join("\n"),
    FE: [
      "Ты frontend-разработчик. Сформулируй Jira Summary для задачи FE внутри истории по замечанию приемки.",
      "Название должно начинаться с [FE]. Опиши UI, экран, форму, отображение или клиентское поведение, если это применимо.",
      "Сохрани предмет замечания, не добавляй новых фактов. Верни только заголовок, максимум 250 символов."
    ].join("\n"),
    BE: [
      "Ты backend-разработчик. Сформулируй Jira Summary для задачи BE внутри истории по замечанию приемки.",
      "Название должно начинаться с [BE]. Опиши серверную логику, данные, API или интеграцию, если это применимо.",
      "Сохрани предмет замечания, не добавляй новых фактов. Верни только заголовок, максимум 250 символов."
    ].join("\n"),
    QA: [
      "Ты QA-инженер. Сформулируй Jira Summary для задачи QA внутри истории по замечанию приемки.",
      "Название должно начинаться с [QA]. Опиши проверку исправления, регрессию или тест-кейс по замечанию.",
      "Сохрани предмет замечания, не добавляй новых фактов. Верни только заголовок, максимум 250 символов."
    ].join("\n"),
    DevOps: [
      "Ты DevOps-инженер. Сформулируй Jira Summary для задачи DevOps внутри истории по замечанию приемки.",
      "Название должно начинаться с [DevOps]. Опиши окружение, конфигурацию, сборку, деплой или pipeline, если это применимо.",
      "Сохрани предмет замечания, не добавляй новых фактов. Верни только заголовок, максимум 250 символов."
    ].join("\n")
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
    MAPPING_STORAGE_KEY: MAPPING_STORAGE_KEY,
    SUMMARY_COLUMN: SUMMARY_COLUMN,
    SUMMARY_MAX_LENGTH: SUMMARY_MAX_LENGTH,
    JIRA_COLUMN: JIRA_COLUMN,
    SPRINT_FIELD: SPRINT_FIELD,
    STORY_ISSUE_TYPE: STORY_ISSUE_TYPE,
    CHILD_LINK_TYPE_NAME: CHILD_LINK_TYPE_NAME,
    BLOCKS_LINK_TYPE_NAME: BLOCKS_LINK_TYPE_NAME,
    DEFAULT_SHEETJS_URL: DEFAULT_SHEETJS_URL,
    DEFAULT_JSZIP_URL: DEFAULT_JSZIP_URL,
    LLM_CONFIG_STORAGE_KEY: LLM_CONFIG_STORAGE_KEY,
    LLM_SUMMARY_PROMPTS: LLM_SUMMARY_PROMPTS,
    KNOWN_COLUMNS: KNOWN_COLUMNS,
    CREATE_TEMPLATE_ROLES: CREATE_TEMPLATE_ROLES,
    MODULE_COMPONENT_MAP: MODULE_COMPONENT_MAP,
    PRIORITY_MAP: PRIORITY_MAP,
    COLUMN_MAP: COLUMN_MAP,
    TABLE_START: TABLE_START,
  };
});
