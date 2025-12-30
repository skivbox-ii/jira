// Работа с localStorage
define("_ujgPA_storage", ["_ujgPA_config", "_ujgPA_utils"], function(config, utils) {
    "use strict";
    
    var STORAGE_KEY = config.STORAGE_KEY;
    var WORKFLOW_STORAGE_KEY = config.WORKFLOW_STORAGE_KEY;
    var DEFAULT_THRESHOLDS = config.DEFAULT_THRESHOLDS;
    var DEFAULT_RISK_WEIGHTS = config.DEFAULT_RISK_WEIGHTS;
    var DEFAULT_CUSTOM_FIELDS = config.DEFAULT_CUSTOM_FIELDS;
    
    function loadSettings() {
        try {
            var stored = localStorage.getItem(STORAGE_KEY);
            if (stored) return JSON.parse(stored);
        } catch (e) {
            utils.log("Failed to load settings", e);
        }
        return {};
    }
    
    function saveSettings(settings) {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(settings || {}));
        } catch (e) {
            utils.log("Failed to save settings", e);
        }
    }
    
    function loadWorkflowConfig() {
        try {
            var raw = localStorage.getItem(WORKFLOW_STORAGE_KEY);
            if (raw) {
                var parsed = JSON.parse(raw);
                parsed.allStatuses = parsed.allStatuses || [];
                parsed.statusCategories = parsed.statusCategories || {};
                return parsed;
            }
        } catch (e) {
            utils.log("Failed to load workflow config", e);
        }
        return {
            projectKey: "default",
            lastUpdated: null,
            allStatuses: [],
            statusCategories: {},
            categoryStatuses: {},
            isManuallyConfigured: false
        };
    }
    
    function saveWorkflowConfig(config) {
        try {
            localStorage.setItem(WORKFLOW_STORAGE_KEY, JSON.stringify(config || {}));
        } catch (e) {
            utils.log("Failed to save workflow config", e);
        }
    }
    
    function getThresholds(settings) {
        settings.thresholds = settings.thresholds || {};
        return utils.mergeWithDefaults(DEFAULT_THRESHOLDS, settings.thresholds);
    }
    
    function saveThresholds(settings, thresholds) {
        settings.thresholds = thresholds;
        saveSettings(settings);
    }
    
    function getRiskWeights(settings) {
        settings.riskWeights = settings.riskWeights || {};
        return utils.mergeWithDefaults(DEFAULT_RISK_WEIGHTS, settings.riskWeights);
    }
    
    function saveRiskWeights(settings, weights) {
        settings.riskWeights = weights;
        saveSettings(settings);
    }
    
    function getCustomFields(settings) {
        settings.customFields = settings.customFields || {};
        return utils.mergeWithDefaults(DEFAULT_CUSTOM_FIELDS, settings.customFields);
    }
    
    function saveCustomFields(settings, fields) {
        settings.customFields = fields;
        saveSettings(settings);
    }
    
    return {
        loadSettings: loadSettings,
        saveSettings: saveSettings,
        loadWorkflowConfig: loadWorkflowConfig,
        saveWorkflowConfig: saveWorkflowConfig,
        getThresholds: getThresholds,
        saveThresholds: saveThresholds,
        getRiskWeights: getRiskWeights,
        saveRiskWeights: saveRiskWeights,
        getCustomFields: getCustomFields,
        saveCustomFields: saveCustomFields
    };
});
