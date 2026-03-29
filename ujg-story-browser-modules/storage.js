define("_ujgSB_storage", ["_ujgSB_config"], function(config) {
    "use strict";

    var STORAGE_KEY = config.STORAGE_KEY;

    var DEFAULT_STATE = {
        project: null,
        viewMode: "all",
        epicFilter: "",
        selectedEpicKeys: [],
        statusFilter: "",
        sprintFilter: ""
    };

    function normalizeSelectedEpicKeys(value, legacyEpicFilter) {
        var list = Array.isArray(value)
            ? value
            : legacyEpicFilter != null && String(legacyEpicFilter).trim() !== ""
              ? [legacyEpicFilter]
              : [];
        return list
            .map(function(item) {
                return item != null ? String(item) : "";
            })
            .filter(function(item) {
                return item !== "";
            });
    }

    function normalizeLoaded(raw) {
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
            return {
                project: DEFAULT_STATE.project,
                viewMode: DEFAULT_STATE.viewMode,
                epicFilter: DEFAULT_STATE.epicFilter,
                selectedEpicKeys: DEFAULT_STATE.selectedEpicKeys.slice(),
                statusFilter: DEFAULT_STATE.statusFilter,
                sprintFilter: DEFAULT_STATE.sprintFilter
            };
        }
        var epicFilter = raw.epicFilter != null ? raw.epicFilter : DEFAULT_STATE.epicFilter;
        return {
            project: raw.project != null ? raw.project : DEFAULT_STATE.project,
            viewMode: raw.viewMode != null ? raw.viewMode : DEFAULT_STATE.viewMode,
            epicFilter: epicFilter,
            selectedEpicKeys: normalizeSelectedEpicKeys(raw.selectedEpicKeys, epicFilter),
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
        var selectedEpicKeys = normalizeSelectedEpicKeys(
            state && state.selectedEpicKeys,
            state && state.epicFilter
        );
        var payload = {
            project: state && state.project != null ? state.project : null,
            viewMode: state && state.viewMode != null ? state.viewMode : DEFAULT_STATE.viewMode,
            epicFilter:
                state && state.epicFilter != null
                    ? state.epicFilter
                    : selectedEpicKeys[0] != null
                      ? selectedEpicKeys[0]
                      : "",
            selectedEpicKeys: selectedEpicKeys,
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
