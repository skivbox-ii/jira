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

  function getGlobalXlsx() {
    if (typeof window !== "undefined" && window.XLSX) return window.XLSX;
    if (typeof globalThis !== "undefined" && globalThis.XLSX) return globalThis.XLSX;
    if (typeof XLSX !== "undefined") return XLSX;
    return null;
  }

  function isUsableXlsx(xlsx) {
    return !!(
      xlsx &&
      typeof xlsx.read === "function" &&
      xlsx.utils &&
      typeof xlsx.utils.sheet_to_json === "function"
    );
  }

  function getAmdRequire() {
    if (typeof require === "function") return require;
    if (typeof window !== "undefined" && typeof window.require === "function") return window.require;
    return null;
  }

  function loadAmdXlsx() {
    var req = getAmdRequire();
    if (!req) return Promise.resolve(null);
    return new Promise(function(resolve) {
      try {
        req(
          ["xlsx"],
          function(xlsx) {
            resolve(isUsableXlsx(xlsx) ? xlsx : null);
          },
          function() {
            resolve(null);
          }
        );
      } catch (_err) {
        resolve(null);
      }
    });
  }

  function ensureXlsx() {
    var existing = getGlobalXlsx();
    if (isUsableXlsx(existing)) return Promise.resolve(existing);
    if (!loadPromise) {
      loadPromise = loadScript(config.DEFAULT_SHEETJS_URL).then(function() {
        var loaded = getGlobalXlsx();
        if (isUsableXlsx(loaded)) return loaded;
        return loadAmdXlsx().then(function(amdXlsx) {
          if (isUsableXlsx(amdXlsx)) return amdXlsx;
          loaded = getGlobalXlsx();
          if (isUsableXlsx(loaded)) return loaded;
          throw new Error("SheetJS is unavailable");
        });
      });
    }
    return loadPromise;
  }

  function readFileBuffer(file) {
    return file.arrayBuffer();
  }

  function readWorkbookFromBuffer(buffer) {
    return ensureXlsx().then(function(xlsx) {
      return xlsx.read(buffer, { type: "array", cellDates: true });
    });
  }

  function readWorkbook(file) {
    return readFileBuffer(file).then(readWorkbookFromBuffer);
  }

  return {
    ensureXlsx: ensureXlsx,
    readFileBuffer: readFileBuffer,
    readWorkbookFromBuffer: readWorkbookFromBuffer,
    readWorkbook: readWorkbook,
  };
});
