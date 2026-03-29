define("_ujgDD_main", [
    "jquery", "_ujgCommon",
    "_ujgDD_config", "_ujgDD_utils",
    "_ujgDD_apiJira", "_ujgDD_apiBitbucket", "_ujgDD_apiConfluence",
    "_ujgDD_dataProcessor", "_ujgDD_teamManager", "_ujgDD_rendering"
], function($, Common, config, utils, apiJira, apiBitbucket, apiConfluence, dataProcessor, teamManager, rendering) {
    "use strict";

    function MyGadget(API) {
        if (!API) {
            console.error("[UJG-DailyDiligence] API object is missing!");
            return;
        }
        var $content = API.getGadgetContentEl();
        if (!$content || $content.length === 0) {
            console.error("[UJG-DailyDiligence] No content element");
            return;
        }

        var $container = $content.find(".ujg-daily-diligence");
        if ($container.length === 0) {
            if (typeof $content.hasClass === "function" && $content.hasClass("ujg-daily-diligence")) {
                $container = $content;
            } else {
                $container = $('<div class="ujg-daily-diligence"></div>');
                $content.append($container);
            }
        }
        $container.removeAttr("style");

        rendering.init($container, {
            config: config,
            utils: utils,
            apiJira: apiJira,
            apiBitbucket: apiBitbucket,
            apiConfluence: apiConfluence,
            dataProcessor: dataProcessor,
            teamManager: teamManager,
            common: Common,
            resize: function() {
                if (typeof API.resize === "function") {
                    API.resize();
                }
            }
        });
    }

    return MyGadget;
});
