define("_ujgUA_main", [
    "jquery", "_ujgCommon", "_ujgUA_config", "_ujgUA_utils",
    "_ujgUA_api", "_ujgUA_repoApi", "_ujgUA_dataProcessor", "_ujgUA_repoDataProcessor", "_ujgUA_progressLoader",
    "_ujgUA_userPicker", "_ujgUA_dateRangePicker", "_ujgUA_summaryCards",
    "_ujgUA_calendarHeatmap", "_ujgUA_repoCalendar", "_ujgUA_dailyDetail",
    "_ujgUA_projectBreakdown", "_ujgUA_issueList",
    "_ujgUA_activityLog", "_ujgUA_repoLog", "_ujgUA_rendering"
], function($, Common, config, utils, api, repoApi, dataProcessor, repoDataProcessor, progressLoader,
            userPicker, dateRangePicker, summaryCards, calendarHeatmap, repoCalendar, dailyDetail,
            projectBreakdown, issueList, activityLog, repoLog, rendering) {
    "use strict";

    function MyGadget(API) {
        if (!API) { console.error("[UJG-UserActivity] API object is missing!"); return; }
        var $content = API.getGadgetContentEl();
        if (!$content || $content.length === 0) { console.error("[UJG-UserActivity] No content element"); return; }

        $content.addClass("ujg-user-activity");
        var $parent = $content.parent();
        if ($parent.length) {
            $parent.css({ position: "relative", height: "100%", minHeight: 0 });
            $content.css({
                position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
                display: "flex", flexDirection: "column", overflow: "hidden"
            });
        }

        var $container = $("<div></div>").css({ flex: 1, minHeight: 0, overflow: "auto" });
        $content.append($container);

        rendering.init($container, {
            config: config, utils: utils, api: api,
            repoApi: repoApi, dataProcessor: dataProcessor, repoDataProcessor: repoDataProcessor, progressLoader: progressLoader,
            userPicker: userPicker, dateRangePicker: dateRangePicker,
            summaryCards: summaryCards, calendarHeatmap: calendarHeatmap, repoCalendar: repoCalendar,
            dailyDetail: dailyDetail, projectBreakdown: projectBreakdown,
            issueList: issueList, activityLog: activityLog, repoLog: repoLog
        });

        if (typeof API.resize === "function") API.resize();
    }

    return MyGadget;
});
