define("_ujgESI_epicScope", [], function() {
  "use strict";
  function keys(value) {
    if (value && !Array.isArray(value) && typeof value === "object") value = Array.isArray(value.epicKeys) ? value.epicKeys : value.epicKey;
    var values = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
    return values.filter(function(key) { return typeof key === "string"; }).map(function(key) { return key.trim().toUpperCase(); })
      .filter(function(key, index, all) { return !!key && all.indexOf(key) === index; }).sort();
  }
  function scalar(value) { var selected = keys(value); return selected.length === 1 ? selected[0] : ""; }
  function key(value) { return JSON.stringify(keys(value)); }
  function label(value) { return keys(value).join(", ") || "Все истории проекта"; }
  function apply(state, value) { state.epicKeys = keys(value); state.epicKey = scalar(state.epicKeys); }
  return {keys:keys,scalar:scalar,key:key,label:label,apply:apply};
});
