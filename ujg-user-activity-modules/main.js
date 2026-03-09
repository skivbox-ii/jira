define("_ujgUA_main", [
    "jquery", "_ujgCommon", "_ujgUA_config", "_ujgUA_utils",
    "_ujgUA_api", "_ujgUA_dataProcessor", "_ujgUA_progressLoader",
    "_ujgUA_userPicker", "_ujgUA_dateRangePicker", "_ujgUA_summaryCards",
    "_ujgUA_calendarHeatmap", "_ujgUA_dailyDetail",
    "_ujgUA_projectBreakdown", "_ujgUA_issueList",
    "_ujgUA_activityLog", "_ujgUA_rendering"
], function($, Common, config, utils, api, dataProcessor, progressLoader,
            userPicker, dateRangePicker, summaryCards, calendarHeatmap, dailyDetail,
            projectBreakdown, issueList, activityLog, rendering) {
    "use strict";

    function MyGadget(API) {
        if (!API) { console.error("[UJG-UserActivity] API object is missing!"); return; }
        var $content = API.getGadgetContentEl();
        if (!$content || $content.length === 0) { console.error("[UJG-UserActivity] No content element"); return; }

        var $container = $("<div></div>");
        $content.append($container);

        rendering.init($container, {
            config: config, utils: utils, api: api,
            dataProcessor: dataProcessor, progressLoader: progressLoader,
            userPicker: userPicker, dateRangePicker: dateRangePicker,
            summaryCards: summaryCards, calendarHeatmap: calendarHeatmap,
            dailyDetail: dailyDetail, projectBreakdown: projectBreakdown,
            issueList: issueList, activityLog: activityLog
        });
    }

    return MyGadget;
});
