// Работа с workflow конфигурацией
define("_ujgPA_workflow", ["_ujgPA_config", "_ujgPA_utils", "_ujgPA_storage"], function(config, utils, storage) {
    "use strict";
    
    var STATUS_CATEGORIES = config.STATUS_CATEGORIES;
    
    function buildCategoryIndexFromStatus(statusCategories) {
        var categoryMap = {};
        Object.keys(STATUS_CATEGORIES).forEach(function(key) {
            categoryMap[key] = [];
        });
        Object.keys(statusCategories || {}).forEach(function(statusName) {
            (statusCategories[statusName] || []).forEach(function(cat) {
                if (!categoryMap[cat]) categoryMap[cat] = [];
                if (categoryMap[cat].indexOf(statusName) === -1) {
                    categoryMap[cat].push(statusName);
                }
            });
        });
        return categoryMap;
    }
    
    function buildStatusIndexFromCategory(categoryStatuses) {
        var statusMap = {};
        Object.keys(categoryStatuses || {}).forEach(function(cat) {
            (categoryStatuses[cat] || []).forEach(function(statusName) {
                var name = utils.normalizeStatusName(statusName);
                if (!name) return;
                if (!statusMap[name]) statusMap[name] = [];
                if (statusMap[name].indexOf(cat) === -1) statusMap[name].push(cat);
            });
        });
        return statusMap;
    }
    
    function getCategoriesForStatus(statusName, workflowConfig) {
        if (!workflowConfig || !workflowConfig.statusCategories) return [];
        var normalized = utils.normalizeStatusName(statusName);
        return workflowConfig.statusCategories[normalized] || workflowConfig.statusCategories[statusName] || [];
    }
    
    function statusHasCategory(statusName, category, workflowConfig) {
        if (!category) return false;
        var categories = getCategoriesForStatus(statusName, workflowConfig);
        return categories.indexOf(category) >= 0;
    }
    
    return {
        buildCategoryIndexFromStatus: buildCategoryIndexFromStatus,
        buildStatusIndexFromCategory: buildStatusIndexFromCategory,
        getCategoriesForStatus: getCategoriesForStatus,
        statusHasCategory: statusHasCategory,
        STATUS_CATEGORIES: STATUS_CATEGORIES
    };
});
