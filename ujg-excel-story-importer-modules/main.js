define("_ujgESI_main", [
  "jquery",
  "_ujgESI_api",
  "_ujgESI_excel-loader",
  "_ujgESI_parser",
  "_ujgESI_creator",
  "_ujgESI_rendering",
], function($, api, excelLoader, parser, creator, rendering) {
  "use strict";

  function ExcelStoryImporterGadget(API) {
    var $content = API && API.getGadgetContentEl ? API.getGadgetContentEl() : $();
    var state = { rows: [], error: "" };
    rendering.init($content, {
      api: api,
      excelLoader: excelLoader,
      parser: parser,
      creator: creator,
    });
    rendering.render(state);
  }

  return ExcelStoryImporterGadget;
});
