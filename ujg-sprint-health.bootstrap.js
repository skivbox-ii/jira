define("_ujgSprintHealth", [], function() {
  "use strict";
  var assetBaseUrl = "https://cdn.jsdelivr.net/gh/skivbox-ii/jira";
  var widgetCssFile = "ujg-sprint-health.css";
  var widgetRuntimeFile = "ujg-sprint-health.runtime.js";
  var runtimeAmd = "_ujgSprintHealthRuntime";
  var releaseRef = "dc7ec5b";
  var w = typeof window !== "undefined" && window ? window : (typeof globalThis !== "undefined" ? globalThis : {});
  w.__UJG_BOOTSTRAP__ = w.__UJG_BOOTSTRAP__ || { scriptPromises: {}, stylePromises: {} };
  var cache = w.__UJG_BOOTSTRAP__;
  if (typeof cache.scriptPromises !== "object" || cache.scriptPromises === null) cache.scriptPromises = {};
  if (typeof cache.stylePromises !== "object" || cache.stylePromises === null) cache.stylePromises = {};
  if (cache.runtimeReleaseRef != null && cache.runtimeReleaseRef !== "") {
    cache.runtimeReleaseRef = String(cache.runtimeReleaseRef);
  } else {
    cache.runtimeReleaseRef = null;
  }
  if (cache.runtimeReleaseRefPromise && typeof cache.runtimeReleaseRefPromise.then !== "function") {
    cache.runtimeReleaseRefPromise = null;
  }
  if (cache.refreshPromise && typeof cache.refreshPromise.then !== "function") {
    cache.refreshPromise = null;
  }
  if (typeof cache.commitMetadataByRef !== "object" || cache.commitMetadataByRef === null) {
    cache.commitMetadataByRef = {};
  }
  if (typeof cache.commitMetadataPromises !== "object" || cache.commitMetadataPromises === null) {
    cache.commitMetadataPromises = {};
  }
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
  var ujgDashboardReleaseRefKey = "ujg.dashboardReleaseRef";
  var ujgGithubMainCommitUrl = "https://api.github.com/repos/skivbox-ii/jira/commits/main";
  function detectDashboardId() {
    if (typeof window === "undefined" || !window) {
      return null;
    }
    var loc = window.location || {};
    var search = String(loc.search || "");
    var m = /[?&]selectPageId=(\d+)/.exec(search);
    if (m) {
      return m[1];
    }
    if (window.AJS && window.AJS.params) {
      var p = window.AJS.params;
      if (p.selectPageId != null && String(p.selectPageId).length) {
        return String(p.selectPageId);
      }
      if (p.pageId != null && String(p.pageId).length) {
        return String(p.pageId);
      }
    }
    return null;
  }
  function jiraDashboardPropertyRestUrl(dashboardId) {
    var origin = "";
    if (typeof window !== "undefined" && window && window.location && window.location.origin) {
      origin = String(window.location.origin);
    }
    return (
      origin +
      "/rest/api/2/dashboard/" +
      encodeURIComponent(String(dashboardId)) +
      "/properties/" +
      encodeURIComponent(ujgDashboardReleaseRefKey)
    );
  }
  function loadDashboardReleaseRef(api) {
    if (api && typeof api.getDashboardProperty === "function") {
      return Promise.resolve(api.getDashboardProperty(ujgDashboardReleaseRefKey)).then(function(v) {
        if (v == null || v === "") {
          return null;
        }
        return String(v);
      });
    }
    var dashboardId = detectDashboardId();
    if (!dashboardId) {
      return Promise.resolve(null);
    }
    return fetch(jiraDashboardPropertyRestUrl(dashboardId), {
      credentials: "same-origin"
    })
      .then(function(r) {
        if (r.status === 404) {
          return null;
        }
        if (!r.ok) {
          return r.text().then(function(t) {
            throw new Error("Jira dashboard property GET " + r.status + ": " + t);
          });
        }
        return r.json();
      })
      .then(function(data) {
        if (data == null || data.value == null || data.value === "") {
          return null;
        }
        return String(data.value);
      });
  }
  function normalizeDashboardReleaseRefForSave(releaseRef) {
    if (releaseRef == null) {
      throw new Error("releaseRef must be a non-empty string");
    }
    var normalized = String(releaseRef).trim();
    if (!normalized) {
      throw new Error("releaseRef must be a non-empty string");
    }
    return normalized;
  }
  function saveDashboardReleaseRef(api, releaseRef) {
    return Promise.resolve().then(function() {
      var normalizedReleaseRef = normalizeDashboardReleaseRefForSave(releaseRef);
      if (api && typeof api.setDashboardProperty === "function") {
        return api.setDashboardProperty(ujgDashboardReleaseRefKey, normalizedReleaseRef);
      }
      var id = detectDashboardId();
      if (!id) {
        return Promise.reject(new Error("dashboard id not found for Jira REST save"));
      }
      return fetch(jiraDashboardPropertyRestUrl(id), {
        method: "PUT",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          "X-Atlassian-Token": "no-check"
        },
        body: JSON.stringify({ value: normalizedReleaseRef })
      }).then(function(r) {
        if (!r.ok) {
          return r.text().then(function(t) {
            throw new Error("Jira dashboard property PUT " + r.status + ": " + t);
          });
        }
      });
    });
  }
  function fetchLatestGithubReleaseRef() {
    return fetch(ujgGithubMainCommitUrl, {
      headers: { Accept: "application/vnd.github+json" }
    })
      .then(function(r) {
        if (!r.ok) {
          return r.text().then(function(t) {
            throw new Error("GitHub main commit API " + r.status + ": " + t);
          });
        }
        return r.json();
      })
      .then(function(data) {
        if (!data || !data.sha) {
          throw new Error("GitHub main commit API: missing sha");
        }
        return String(data.sha);
      });
  }
  function ujgGithubCommitsApiUrl(ref) {
    return "https://api.github.com/repos/skivbox-ii/jira/commits/" + encodeURIComponent(String(ref));
  }
  function formatCommitDateTime(iso) {
    var d = new Date(String(iso || ""));
    if (isNaN(d.getTime())) {
      return "";
    }
    function z(n) {
      return (n < 10 ? "0" : "") + n;
    }
    return (
      d.getUTCFullYear() +
      "-" +
      z(d.getUTCMonth() + 1) +
      "-" +
      z(d.getUTCDate()) +
      " " +
      z(d.getUTCHours()) +
      ":" +
      z(d.getUTCMinutes())
    );
  }
  function fetchGithubCommitMetadata(ref) {
    return fetch(ujgGithubCommitsApiUrl(ref), {
      headers: { Accept: "application/vnd.github+json" }
    })
      .then(function(r) {
        if (!r.ok) {
          return r.text().then(function(t) {
            throw new Error("GitHub commit API " + r.status + ": " + t);
          });
        }
        return r.json();
      })
      .then(function(data) {
        if (!data || !data.sha) {
          throw new Error("GitHub commit API: missing sha");
        }
        var iso = "";
        if (data.commit) {
          if (data.commit.committer && data.commit.committer.date) {
            iso = data.commit.committer.date;
          } else if (data.commit.author && data.commit.author.date) {
            iso = data.commit.author.date;
          }
        }
        return {
          sha: String(data.sha),
          formattedTime: formatCommitDateTime(iso)
        };
      });
  }
  function loadCommitMetadataForRef(ref) {
    var key = String(ref || "");
    if (!key) {
      return Promise.resolve(null);
    }
    if (cache.commitMetadataByRef[key]) {
      return Promise.resolve(cache.commitMetadataByRef[key]);
    }
    if (cache.commitMetadataPromises[key]) {
      return cache.commitMetadataPromises[key];
    }
    var p = fetchGithubCommitMetadata(key).then(
      function(meta) {
        delete cache.commitMetadataPromises[key];
        if (meta && meta.formattedTime) {
          cache.commitMetadataByRef[key] = meta;
        }
        return meta;
      },
      function() {
        delete cache.commitMetadataPromises[key];
        return null;
      }
    );
    cache.commitMetadataPromises[key] = p;
    return p;
  }
  function buildPinnedAssetUrl(activeRef, fileName) {
    var base = String(assetBaseUrl).replace(/\/+$/, "");
    return base + "@" + encodeURIComponent(String(activeRef)) + "/" + fileName;
  }
  function applyAssetUrls(target, normalizedRef) {
    if (!target) return;
    target.releaseRef = normalizedRef;
    target.commonJs = buildPinnedAssetUrl(normalizedRef, "_ujgCommon.js");
    target.css = buildPinnedAssetUrl(normalizedRef, widgetCssFile);
    target.runtimeJs = buildPinnedAssetUrl(normalizedRef, widgetRuntimeFile);
  }
  function syncExportedAssetUrls(activeRef, gadgetInstance) {
    var normalizedRef = String(activeRef);
    applyAssetUrls(UjgWidgetGadget, normalizedRef);
    applyAssetUrls(gadgetInstance, normalizedRef);
    return normalizedRef;
  }
  function resolveRuntimeReleaseRefForAssets(api, gadgetInstance) {
    if (cache.runtimeReleaseRef != null && cache.runtimeReleaseRef !== "") {
      return Promise.resolve(syncExportedAssetUrls(cache.runtimeReleaseRef, gadgetInstance));
    }
    if (cache.runtimeReleaseRefPromise) {
      return cache.runtimeReleaseRefPromise.then(function(activeRef) {
        return syncExportedAssetUrls(activeRef, gadgetInstance);
      });
    }
    cache.runtimeReleaseRefPromise = loadDashboardReleaseRef(api || {})
      .then(
        function(existing) {
          if (existing != null && existing !== "") {
            return String(existing);
          }
          return fetchLatestGithubReleaseRef().then(
            function(sha) {
              return saveDashboardReleaseRef(api || {}, sha).then(
                function() {
                  return sha;
                },
                function() {
                  return sha;
                }
              );
            },
            function() {
              return releaseRef;
            }
          );
        },
        function() {
          return releaseRef;
        }
      )
      .then(function(activeRef) {
        var normalizedRef = syncExportedAssetUrls(activeRef, gadgetInstance);
        cache.runtimeReleaseRef = normalizedRef;
        return normalizedRef;
      });
    return cache.runtimeReleaseRefPromise.then(
      function(activeRef) {
        return syncExportedAssetUrls(activeRef, gadgetInstance);
      },
      function(err) {
        cache.runtimeReleaseRefPromise = null;
        throw err;
      }
    );
  }
  function instantiateWhenReady(api, gadgetInstance) {
    return resolveRuntimeReleaseRefForAssets(api, gadgetInstance).then(function(activeRef) {
      var commonJsU = buildPinnedAssetUrl(activeRef, "_ujgCommon.js");
      var cssU = buildPinnedAssetUrl(activeRef, widgetCssFile);
      var runtimeU = buildPinnedAssetUrl(activeRef, widgetRuntimeFile);
      syncExportedAssetUrls(activeRef, gadgetInstance);
      return loadScriptOnce(commonJsU)
        .then(function() {
          return Promise.all([loadStyleOnce(cssU), loadScriptOnce(runtimeU)]);
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
    }).then(function(runtimeInst) {
      try {
        mountBootstrapUpdateControls(api, gadgetInstance);
      } catch (eRemount) {}
      tryRefreshToolbarVersionForApi(api);
      return runtimeInst;
    });
  }
  function shortRefForToolbar(ref) {
    var s = String(ref || "");
    return s.length > 14 ? s.slice(0, 14) + "\u2026" : s;
  }
  function updateToolbarVersionDisplay(toolbarRoot, ref) {
    if (!toolbarRoot || !toolbarRoot.querySelector) return;
    var span = toolbarRoot.querySelector(".ujg-bootstrap-version");
    if (!span) return;
    var base = shortRefForToolbar(ref) || "";
    span.textContent = base;
    if (!base) return;
    var refKey = String(ref);
    toolbarRoot.__ujgBootstrapVersionRef = refKey;
    loadCommitMetadataForRef(refKey).then(function(meta) {
      if (toolbarRoot.__ujgBootstrapVersionRef !== refKey) return;
      if (!meta || !meta.formattedTime) return;
      var cur = toolbarRoot.querySelector(".ujg-bootstrap-version");
      if (cur !== span) return;
      span.textContent = base + " \u2022 " + meta.formattedTime;
    });
  }
  function normalizeBootstrapBodyNode(body) {
    if (!body) return null;
    if (typeof body.appendChild === "function") return body;
    if (body[0] && typeof body[0].appendChild === "function") return body[0];
    if (typeof body.get === "function") {
      var first = body.get(0);
      if (first && typeof first.appendChild === "function") return first;
    }
    return null;
  }
  function getBootstrapGadgetBody(api) {
    if (!api || typeof api.getGadget !== "function") return null;
    var gadget = api.getGadget();
    if (!gadget || typeof gadget.getBody !== "function") return null;
    return normalizeBootstrapBodyNode(gadget.getBody());
  }
  function tryRefreshToolbarVersionForApi(api) {
    try {
      var body = getBootstrapGadgetBody(api);
      var toolbar = body && typeof body.querySelector === "function" ? body.querySelector(".ujg-bootstrap-toolbar") : null;
      if (toolbar) updateToolbarVersionDisplay(toolbar, cache.runtimeReleaseRef || releaseRef);
    } catch (eTb) {}
  }
  function requestPageReload() {
    if (typeof window === "undefined" || !window || !window.location) {
      return;
    }
    if (typeof window.location.reload === "function") {
      window.location.reload();
    }
  }
  function handleBootstrapRefreshClick(api, toolbarRoot, gadgetInstance) {
    if (cache.refreshPromise) {
      return cache.refreshPromise;
    }
    cache.refreshPromise = resolveRuntimeReleaseRefForAssets(api, gadgetInstance)
      .then(function(cur) {
        return fetchLatestGithubReleaseRef().then(function(sha) {
          var next = String(sha).trim();
          if (cur != null && cur !== "" && String(cur).trim() === next) {
            updateToolbarVersionDisplay(toolbarRoot, cur);
            return null;
          }
          return saveDashboardReleaseRef(api, next).then(function() {
            applyAssetUrls(gadgetInstance, next);
            updateToolbarVersionDisplay(toolbarRoot, next);
            requestPageReload();
            return null;
          });
        });
      })
      .catch(function(errRf) {
        if (typeof console !== "undefined" && console.error) {
          console.error("UJG bootstrap: refresh failed", errRf);
        }
      });
    return cache.refreshPromise.then(function(result) {
      cache.refreshPromise = null;
      return result;
    }, function(err) {
      cache.refreshPromise = null;
      throw err;
    });
  }
  function mountBootstrapUpdateControls(api, gadgetInstance) {
    var body = getBootstrapGadgetBody(api);
    if (!body) return;
    var toolbar = typeof body.querySelector === "function" ? body.querySelector(".ujg-bootstrap-toolbar") : null;
    if (!toolbar) {
      toolbar = document.createElement("div");
      toolbar.className = "ujg-bootstrap-toolbar";
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "ujg-bootstrap-refresh";
      btn.textContent = "\u041e\u0431\u043d\u043e\u0432\u0438\u0442\u044c \u0432\u0435\u0440\u0441\u0438\u044e";
      var ver = document.createElement("span");
      ver.className = "ujg-bootstrap-version";
      toolbar.appendChild(btn);
      toolbar.appendChild(ver);
      if (typeof body.insertBefore === "function") {
        body.insertBefore(toolbar, body.firstChild || null);
      } else {
        body.appendChild(toolbar);
      }
    }
    updateToolbarVersionDisplay(toolbar, cache.runtimeReleaseRef || releaseRef);
    var btnEl = toolbar.querySelector ? toolbar.querySelector(".ujg-bootstrap-refresh") : null;
    if (btnEl && !btnEl.__ujgBootstrapRefreshBound) {
      btnEl.__ujgBootstrapRefreshBound = true;
      btnEl.onclick = function(evRf) {
        if (evRf && evRf.preventDefault) evRf.preventDefault();
        handleBootstrapRefreshClick(api, toolbar, gadgetInstance);
      };
    }
  }
  function UjgWidgetGadget(api) {
    this._api = api;
    syncExportedAssetUrls(cache.runtimeReleaseRef != null && cache.runtimeReleaseRef !== "" ? cache.runtimeReleaseRef : releaseRef, this);
    try {
      mountBootstrapUpdateControls(api, this);
    } catch (eGadgetMount) {}
    if (!api || api.__ujgBootstrapSkipAutoLoad !== true) {
      this.readyPromise = instantiateWhenReady(api, this);
    } else {
      this.readyPromise = Promise.resolve(null);
    }
  }
  UjgWidgetGadget.prototype.loadScriptOnce = loadScriptOnce;
  UjgWidgetGadget.prototype.loadStyleOnce = loadStyleOnce;
  UjgWidgetGadget.prototype.instantiateWhenReady = function(targetApi) {
    var callApi = targetApi !== undefined ? targetApi : this._api;
    return instantiateWhenReady(callApi, this);
  };
  UjgWidgetGadget.prototype.loadDashboardReleaseRef = function(targetApi) {
    return loadDashboardReleaseRef(targetApi !== undefined ? targetApi : this._api);
  };
  UjgWidgetGadget.prototype.saveDashboardReleaseRef = function(targetApi, releaseRefVal) {
    return saveDashboardReleaseRef(targetApi, releaseRefVal);
  };
  UjgWidgetGadget.prototype.fetchLatestGithubReleaseRef = fetchLatestGithubReleaseRef;
  UjgWidgetGadget.prototype.loadCommitMetadataForRef = loadCommitMetadataForRef;
  syncExportedAssetUrls(cache.runtimeReleaseRef != null && cache.runtimeReleaseRef !== "" ? cache.runtimeReleaseRef : releaseRef);
  UjgWidgetGadget.runtimeAmd = runtimeAmd;
  UjgWidgetGadget.loadScriptOnce = loadScriptOnce;
  UjgWidgetGadget.loadStyleOnce = loadStyleOnce;
  UjgWidgetGadget.instantiateWhenReady = instantiateWhenReady;
  UjgWidgetGadget.loadDashboardReleaseRef = loadDashboardReleaseRef;
  UjgWidgetGadget.saveDashboardReleaseRef = saveDashboardReleaseRef;
  UjgWidgetGadget.fetchLatestGithubReleaseRef = fetchLatestGithubReleaseRef;
  UjgWidgetGadget.loadCommitMetadataForRef = loadCommitMetadataForRef;
  UjgWidgetGadget.updateToolbarVersionDisplay = updateToolbarVersionDisplay;
  return UjgWidgetGadget;
});
