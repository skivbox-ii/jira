// Работа с localStorage
define("_ujgSH_storage", ["_ujgSH_config"], function(config) {
    "use strict";

    var STORAGE_KEY = config.STORAGE_KEY;

    function loadSettings() { try { var s = localStorage.getItem(STORAGE_KEY); return s ? JSON.parse(s) : {}; } catch(e) { return {}; } }
    function saveSettings(s) { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch(e) {} }

    return {
        loadSettings: loadSettings,
        saveSettings: saveSettings
    };
});
