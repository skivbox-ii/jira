define("_ujgESI_remarkId", [], function() {
  "use strict";
  return function(row) {
    var columns = row && row.sourceColumns || {};
    var names = Object.keys(columns);
    var result = "";
    var mappedId = row && row.sourceColumnIndexes && Object.prototype.hasOwnProperty.call(row.sourceColumnIndexes, "ID");
    (mappedId ? ["id", "№", "номер замечания", "номер"] : ["№", "id", "номер замечания", "номер"]).some(function(wanted) {
      return names.some(function(name) {
        var value = columns[name];
        if (name.trim().toLowerCase() !== wanted || (typeof value !== "string" && typeof value !== "number")) return false;
        value = String(value).trim().replace(/^(?:№|#)\s*/, "");
        if (!value || value.length > 64 || (!/\d/.test(value) && !(mappedId && name === "ID")) || !/^[a-zа-яё0-9][a-zа-яё0-9._\/-]*$/i.test(value)) return false;
        result = value;
        return true;
      });
    });
    if (result) return result;
    var story = row && row.storyDetails;
    if (!story || !(row.jiraKey || row.createdKey || story.key)) return "";
    var prefix = /^\s*(?:№|#)?\s*(\d+)(?:\.(?!\d)|\s|$)/.exec(String(story.summary || ""));
    return prefix ? prefix[1] : "";
  };
});
