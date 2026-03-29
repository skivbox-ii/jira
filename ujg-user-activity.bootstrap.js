define("_ujgUserActivity", [], function() {
  "use strict";
  var commonJs = "https://cdn.jsdelivr.net/gh/skivbox-ii/jira@a0a76ae/_ujgCommon.js";
  var cssUrl = "https://cdn.jsdelivr.net/gh/skivbox-ii/jira@a0a76ae/ujg-user-activity.css";
  var runtimeJs = "https://cdn.jsdelivr.net/gh/skivbox-ii/jira@a0a76ae/ujg-user-activity.runtime.js";
  var runtimeAmd = "_ujgUserActivityRuntime";
  var releaseRef = "a0a76ae";
  var w = typeof window !== "undefined" && window ? window : (typeof globalThis !== "undefined" ? globalThis : {});
  w.__UJG_BOOTSTRAP__ = w.__UJG_BOOTSTRAP__ || { scriptPromises: {}, stylePromises: {} };
  var cache = w.__UJG_BOOTSTRAP__;
  if (typeof cache.scriptPromises !== "object" || cache.scriptPromises === null) cache.scriptPromises = {};
  if (typeof cache.stylePromises !== "object" || cache.stylePromises === null) cache.stylePromises = {};
  function loadScriptOnce(url) {
    if (cache.scriptPromises[url]) return cache.scriptPromises[url];
    cache.scriptPromises[url] = new Promise(function(resolve, reject) {
      var s = document.createElement("script");
      s.src = url;
      s.onload = function() { resolve(); };
      s.onerror = function() {
        if (typeof console !== "undefined" && console.error) {
          console.error("UJG bootstrap: failed to load script " + url);
        }
        reject(new Error("failed to load script"));
      };
      document.head.appendChild(s);
    });
    return cache.scriptPromises[url];
  }
  function loadStyleOnce(url) {
    if (cache.stylePromises[url]) return cache.stylePromises[url];
    cache.stylePromises[url] = new Promise(function(resolve, reject) {
      var l = document.createElement("link");
      l.rel = "stylesheet";
      l.href = url;
      l.onload = function() { resolve(); };
      l.onerror = function() {
        if (typeof console !== "undefined" && console.error) {
          console.error("UJG bootstrap: failed to load stylesheet " + url);
        }
        reject(new Error("failed to load stylesheet"));
      };
      document.head.appendChild(l);
    });
    return cache.stylePromises[url];
  }
  function instantiateWhenReady(api) {
    return loadScriptOnce(commonJs)
      .then(function() {
        return Promise.all([loadStyleOnce(cssUrl), loadScriptOnce(runtimeJs)]);
      })
      .then(function() {
        return new Promise(function(resolve, reject) {
          if (typeof require !== "function") {
            reject(new Error("require is not a function"));
            return;
          }
          require([runtimeAmd], function(RuntimeMod) {
            var Ctor = RuntimeMod && RuntimeMod.default ? RuntimeMod.default : RuntimeMod;
            resolve(new Ctor(api));
          }, function(err) {
            reject(err);
          });
        });
      });
  }
  return {
    releaseRef: releaseRef,
    commonJs: commonJs,
    css: cssUrl,
    runtimeJs: runtimeJs,
    runtimeAmd: runtimeAmd,
    loadScriptOnce: loadScriptOnce,
    loadStyleOnce: loadStyleOnce,
    instantiateWhenReady: instantiateWhenReady
  };
});
