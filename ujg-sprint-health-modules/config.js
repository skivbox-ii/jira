// Конфигурация и базовые константы
define("_ujgSH_config", [], function() {
    "use strict";

    var CONFIG = {
        version: "1.3.1",
        debug: true,
        maxHours: 16,
        capacityPerPerson: 40,
        hoursPerDay: 8,
        startDateField: "customfield_XXXXX",
        allowEditDates: true,
        sprintField: null
    };

    var STORAGE_KEY = "ujg_sprint_health_settings";
    var baseUrl = (typeof AJS !== "undefined" && AJS.contextPath) ? AJS.contextPath() : "";

    return {
        CONFIG: CONFIG,
        STORAGE_KEY: STORAGE_KEY,
        baseUrl: baseUrl
    };
});
