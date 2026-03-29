define("_ujgSB_storage", ["_ujgSB_config"], function(config) {
    "use strict";

    var STORAGE_KEY = config.STORAGE_KEY;

    var DEFAULT_STATE = {
        project: null,
        viewMode: "all",
        epicFilter: "",
        statusFilter: "",
        sprintFilter: ""
    };

    function normalizeLoaded(raw) {
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
            return {
                project: DEFAULT_STATE.project,
                viewMode: DEFAULT_STATE.viewMode,
                epicFilter: DEFAULT_STATE.epicFilter,
                statusFilter: DEFAULT_STATE.statusFilter,
                sprintFilter: DEFAULT_STATE.sprintFilter
            };
        }
        return {
            project: raw.project != null ? raw.project : DEFAULT_STATE.project,
            viewMode: raw.viewMode != null ? raw.viewMode : DEFAULT_STATE.viewMode,
            epicFilter: raw.epicFilter != null ? raw.epicFilter : DEFAULT_STATE.epicFilter,
            statusFilter: raw.statusFilter != null ? raw.statusFilter : DEFAULT_STATE.statusFilter,
            sprintFilter: raw.sprintFilter != null ? raw.sprintFilter : DEFAULT_STATE.sprintFilter
        };
    }

    function load() {
        try {
            if (typeof localStorage === "undefined") return normalizeLoaded(null);
            var s = localStorage.getItem(STORAGE_KEY);
            if (!s) return normalizeLoaded(null);
            var parsed = JSON.parse(s);
            return normalizeLoaded(parsed);
        } catch (e) {
            return normalizeLoaded(null);
        }
    }

    function save(state) {
        if (typeof localStorage === "undefined") return;
        var payload = {
            project: state && state.project != null ? state.project : null,
            viewMode: state && state.viewMode != null ? state.viewMode : DEFAULT_STATE.viewMode,
            epicFilter: state && state.epicFilter != null ? state.epicFilter : "",
            statusFilter: state && state.statusFilter != null ? state.statusFilter : "",
            sprintFilter: state && state.sprintFilter != null ? state.sprintFilter : ""
        };
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
        } catch (e) {}
    }

    return {
        save: save,
        load: load
    };
});
