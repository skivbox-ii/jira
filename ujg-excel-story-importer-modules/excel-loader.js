define("_ujgESI_excel-loader", ["_ujgESI_config"], function(config) {
  "use strict";

  var loadPromise = null;

  function loadScript(url) {
    return new Promise(function(resolve, reject) {
      var s = document.createElement("script");
      s.src = url;
      s.onload = function() {
        resolve();
      };
      s.onerror = function() {
        reject(new Error("SheetJS load failed"));
      };
      document.head.appendChild(s);
    });
  }

  function ensureXlsx() {
    if (typeof XLSX !== "undefined") return Promise.resolve(XLSX);
    if (!loadPromise) {
      loadPromise = loadScript(config.DEFAULT_SHEETJS_URL).then(function() {
        if (typeof XLSX === "undefined") throw new Error("SheetJS is unavailable");
        return XLSX;
      });
    }
    return loadPromise;
  }

  function readWorkbook(file) {
    return ensureXlsx().then(function(xlsx) {
      return file.arrayBuffer().then(function(buffer) {
        return xlsx.read(buffer, { type: "array", cellDates: true });
      });
    });
  }

  return {
    ensureXlsx: ensureXlsx,
    readWorkbook: readWorkbook,
  };
});
