define("_ujgESI_activityStore", [], function() {
  "use strict";
  function create() {
    var entries = new Map();
    return {
      clear:function() { entries.clear(); },
      get:function(key, calculate) {
        if (entries.has(key)) {
          var value = entries.get(key);
          entries.delete(key); entries.set(key,value);
          return value;
        }
        var report = calculate();
        entries.set(key,report);
        if (entries.size > 6) entries.delete(entries.keys().next().value);
        return report;
      }
    };
  }
  return {create:create};
});
