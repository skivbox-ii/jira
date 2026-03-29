"use strict";

const fs = require("node:fs");
const path = require("node:path");
const childProcess = require("node:child_process");

const REPO_ROOT = __dirname;

/** Dashboard entity property key for shared CDN/Git SHA (whole dashboard). */
var UJG_DASHBOARD_RELEASE_REF_PROPERTY_KEY = "ujg.dashboardReleaseRef";

/** GitHub REST endpoint for the latest commit on main for skivbox-ii/jira. */
var UJG_GITHUB_MAIN_COMMIT_URL =
  "https://api.github.com/repos/skivbox-ii/jira/commits/main";
var UJG_GITHUB_COMMITS_MAIN_URL = UJG_GITHUB_MAIN_COMMIT_URL;
/** Prefix for GET /repos/skivbox-ii/jira/commits/{ref} (append encodeURIComponent(ref)). */
var UJG_GITHUB_COMMITS_REF_URL_PREFIX =
  "https://api.github.com/repos/skivbox-ii/jira/commits/";

var WIDGETS = {
  sprintHealth: "ujg-sprint-health",
  projectAnalytics: "ujg-project-analytics",
  timesheet: "ujg-timesheet",
  timesheetV0: "ujg-timesheet.v0",
  userActivity: "ujg-user-activity",
  dailyDiligence: "ujg-daily-diligence",
  storyBrowser: "ujg-story-browser"
};

var WIDGET_SPECS = {
  "ujg-sprint-health": {
    fileKey: "ujg-sprint-health",
    publicAmd: "_ujgSprintHealth",
    runtimeAmd: "_ujgSprintHealthRuntime"
  },
  "ujg-project-analytics": {
    fileKey: "ujg-project-analytics",
    publicAmd: "_ujgProjectAnalytics",
    runtimeAmd: "_ujgProjectAnalyticsRuntime"
  },
  "ujg-timesheet": {
    fileKey: "ujg-timesheet",
    publicAmd: "_ujgTimesheet",
    runtimeAmd: "_ujgTimesheetRuntime"
  },
  "ujg-timesheet.v0": {
    fileKey: "ujg-timesheet.v0",
    publicAmd: "_ujgTimesheet",
    runtimeAmd: "_ujgTimesheetV0Runtime"
  },
  "ujg-user-activity": {
    fileKey: "ujg-user-activity",
    publicAmd: "_ujgUserActivity",
    runtimeAmd: "_ujgUserActivityRuntime"
  },
  "ujg-daily-diligence": {
    fileKey: "ujg-daily-diligence",
    publicAmd: "_ujgDailyDiligence",
    runtimeAmd: "_ujgDailyDiligenceRuntime"
  },
  "ujg-story-browser": {
    fileKey: "ujg-story-browser",
    publicAmd: "_ujgStoryBrowser",
    runtimeAmd: "_ujgStoryBrowserRuntime"
  }
};

function readWidgetJs(fileKey) {
  var p = path.join(REPO_ROOT, fileKey + ".js");
  return fs.readFileSync(p, "utf8");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeJsString(value) {
  return JSON.stringify(String(value)).slice(1, -1);
}

function transformRuntimeAmdRename(src, publicName, runtimeName) {
  var pattern = new RegExp(
    '(^|[\\r\\n])([\\t ]*)define\\(\\s*"' + escapeRegExp(publicName) + '"\\s*,',
    "g"
  );
  var matchCount = 0;
  var out = src.replace(pattern, function(match, lineStart, indentation) {
    matchCount += 1;
    return lineStart + indentation + 'define("' + runtimeName + '",';
  });

  if (matchCount !== 1) {
    throw new Error(
      'Expected exactly one AMD define for "' + publicName + '", found ' + matchCount
    );
  }

  return out;
}

function runtimeFromPublicRename(fileKey, publicName, runtimeName) {
  return transformRuntimeAmdRename(readWidgetJs(fileKey), publicName, runtimeName);
}

function pinnedAssetUrl(assetBaseUrl, releaseRef, fileName) {
  var base = String(assetBaseUrl).replace(/\/+$/, "");
  return base + "@" + encodeURIComponent(String(releaseRef)) + "/" + fileName;
}

function emittedDashboardReleaseRefHelpers() {
  var keyLit = escapeJsString(UJG_DASHBOARD_RELEASE_REF_PROPERTY_KEY);
  var urlLit = escapeJsString(UJG_GITHUB_MAIN_COMMIT_URL);
  return (
    '  var ujgDashboardReleaseRefKey = "' +
    keyLit +
    '";\n' +
    '  var ujgGithubMainCommitUrl = "' +
    urlLit +
    '";\n' +
    "  function detectDashboardId() {\n" +
    '    if (typeof window === "undefined" || !window) {\n' +
    "      return null;\n" +
    "    }\n" +
    "    var loc = window.location || {};\n" +
    '    var search = String(loc.search || "");\n' +
    "    var m = /[?&]selectPageId=(\\d+)/.exec(search);\n" +
    "    if (m) {\n" +
    "      return m[1];\n" +
    "    }\n" +
    "    if (window.AJS && window.AJS.params) {\n" +
    "      var p = window.AJS.params;\n" +
    "      if (p.selectPageId != null && String(p.selectPageId).length) {\n" +
    "        return String(p.selectPageId);\n" +
    "      }\n" +
    "      if (p.pageId != null && String(p.pageId).length) {\n" +
    "        return String(p.pageId);\n" +
    "      }\n" +
    "    }\n" +
    "    return null;\n" +
    "  }\n" +
    "  function jiraDashboardPropertyRestUrl(dashboardId) {\n" +
    '    var origin = "";\n' +
    "    if (typeof window !== \"undefined\" && window && window.location && window.location.origin) {\n" +
    "      origin = String(window.location.origin);\n" +
    "    }\n" +
    "    return (\n" +
    "      origin +\n" +
    '      "/rest/api/2/dashboard/" +\n' +
    "      encodeURIComponent(String(dashboardId)) +\n" +
    '      "/properties/" +\n' +
    "      encodeURIComponent(ujgDashboardReleaseRefKey)\n" +
    "    );\n" +
    "  }\n" +
    "  function loadDashboardReleaseRef(api) {\n" +
    "    if (api && typeof api.getDashboardProperty === \"function\") {\n" +
    "      return Promise.resolve(api.getDashboardProperty(ujgDashboardReleaseRefKey)).then(function(v) {\n" +
    '        if (v == null || v === "") {\n' +
    "          return null;\n" +
    "        }\n" +
    "        return String(v);\n" +
    "      });\n" +
    "    }\n" +
    "    var dashboardId = detectDashboardId();\n" +
    "    if (!dashboardId) {\n" +
    "      return Promise.resolve(null);\n" +
    "    }\n" +
    "    return fetch(jiraDashboardPropertyRestUrl(dashboardId), {\n" +
    '      credentials: "same-origin"\n' +
    "    })\n" +
    "      .then(function(r) {\n" +
    "        if (r.status === 404) {\n" +
    "          return null;\n" +
    "        }\n" +
    "        if (!r.ok) {\n" +
    "          return r.text().then(function(t) {\n" +
    '            throw new Error("Jira dashboard property GET " + r.status + ": " + t);\n' +
    "          });\n" +
    "        }\n" +
    "        return r.json();\n" +
    "      })\n" +
    "      .then(function(data) {\n" +
    "        if (data == null || data.value == null || data.value === \"\") {\n" +
    "          return null;\n" +
    "        }\n" +
    "        return String(data.value);\n" +
    "      });\n" +
    "  }\n" +
    '  function normalizeDashboardReleaseRefForSave(releaseRef) {\n' +
    '    if (releaseRef == null) {\n' +
    '      throw new Error("releaseRef must be a non-empty string");\n' +
    "    }\n" +
    "    var normalized = String(releaseRef).trim();\n" +
    '    if (!normalized) {\n' +
    '      throw new Error("releaseRef must be a non-empty string");\n' +
    "    }\n" +
    "    return normalized;\n" +
    "  }\n" +
    "  function saveDashboardReleaseRef(api, releaseRef) {\n" +
    "    return Promise.resolve().then(function() {\n" +
    "      var normalizedReleaseRef = normalizeDashboardReleaseRefForSave(releaseRef);\n" +
    '      if (api && typeof api.setDashboardProperty === "function") {\n' +
    "        return api.setDashboardProperty(ujgDashboardReleaseRefKey, normalizedReleaseRef);\n" +
    "      }\n" +
    "      var id = detectDashboardId();\n" +
    "      if (!id) {\n" +
    '        return Promise.reject(new Error("dashboard id not found for Jira REST save"));\n' +
    "      }\n" +
    "      return fetch(jiraDashboardPropertyRestUrl(id), {\n" +
    '        method: "PUT",\n' +
    '        credentials: "same-origin",\n' +
    "        headers: {\n" +
    '          "Content-Type": "application/json",\n' +
    '          "X-Atlassian-Token": "no-check"\n' +
    "        },\n" +
    '        body: JSON.stringify({ value: normalizedReleaseRef })\n' +
    "      }).then(function(r) {\n" +
    "        if (!r.ok) {\n" +
    "          return r.text().then(function(t) {\n" +
    '            throw new Error("Jira dashboard property PUT " + r.status + ": " + t);\n' +
    "          });\n" +
    "        }\n" +
    "      });\n" +
    "    });\n" +
    "  }\n" +
    '  function fetchLatestGithubReleaseRef() {\n' +
    "    return fetch(ujgGithubMainCommitUrl, {\n" +
    '      headers: { Accept: "application/vnd.github+json" }\n' +
    "    })\n" +
    "      .then(function(r) {\n" +
    "        if (!r.ok) {\n" +
    "          return r.text().then(function(t) {\n" +
    '            throw new Error("GitHub main commit API " + r.status + ": " + t);\n' +
    "          });\n" +
    "        }\n" +
    "        return r.json();\n" +
    "      })\n" +
    "      .then(function(data) {\n" +
    "        if (!data || !data.sha) {\n" +
    '          throw new Error("GitHub main commit API: missing sha");\n' +
    "        }\n" +
    "        return String(data.sha);\n" +
    "      });\n" +
    "  }\n"
  );
}

function emittedCommitMetadataHelpers() {
  return (
    "  function ujgGithubCommitsApiUrl(ref) {\n" +
    '    return "https://api.github.com/repos/skivbox-ii/jira/commits/" + encodeURIComponent(String(ref));\n' +
    "  }\n" +
    "  function formatCommitDateTime(iso) {\n" +
    "    var d = new Date(String(iso || \"\"));\n" +
    "    if (isNaN(d.getTime())) {\n" +
    '      return "";\n' +
    "    }\n" +
    "    function z(n) {\n" +
    '      return (n < 10 ? "0" : "") + n;\n' +
    "    }\n" +
    "    return (\n" +
    "      d.getUTCFullYear() +\n" +
    '      "-" +\n' +
    "      z(d.getUTCMonth() + 1) +\n" +
    '      "-" +\n' +
    "      z(d.getUTCDate()) +\n" +
    '      " " +\n' +
    "      z(d.getUTCHours()) +\n" +
    '      ":" +\n' +
    "      z(d.getUTCMinutes())\n" +
    "    );\n" +
    "  }\n" +
    "  function fetchGithubCommitMetadata(ref) {\n" +
    "    return fetch(ujgGithubCommitsApiUrl(ref), {\n" +
    '      headers: { Accept: "application/vnd.github+json" }\n' +
    "    })\n" +
    "      .then(function(r) {\n" +
    "        if (!r.ok) {\n" +
    "          return r.text().then(function(t) {\n" +
    '            throw new Error("GitHub commit API " + r.status + ": " + t);\n' +
    "          });\n" +
    "        }\n" +
    "        return r.json();\n" +
    "      })\n" +
    "      .then(function(data) {\n" +
    "        if (!data || !data.sha) {\n" +
    '          throw new Error("GitHub commit API: missing sha");\n' +
    "        }\n" +
    "        var iso = \"\";\n" +
    "        if (data.commit) {\n" +
    "          if (data.commit.committer && data.commit.committer.date) {\n" +
    "            iso = data.commit.committer.date;\n" +
    "          } else if (data.commit.author && data.commit.author.date) {\n" +
    "            iso = data.commit.author.date;\n" +
    "          }\n" +
    "        }\n" +
    "        return {\n" +
    "          sha: String(data.sha),\n" +
    "          formattedTime: formatCommitDateTime(iso)\n" +
    "        };\n" +
    "      });\n" +
    "  }\n" +
    "  function loadCommitMetadataForRef(ref) {\n" +
    "    var key = String(ref || \"\");\n" +
    "    if (!key) {\n" +
    "      return Promise.resolve(null);\n" +
    "    }\n" +
    "    if (cache.commitMetadataByRef[key]) {\n" +
    "      return Promise.resolve(cache.commitMetadataByRef[key]);\n" +
    "    }\n" +
    "    if (cache.commitMetadataPromises[key]) {\n" +
    "      return cache.commitMetadataPromises[key];\n" +
    "    }\n" +
    "    var p = fetchGithubCommitMetadata(key).then(\n" +
    "      function(meta) {\n" +
    "        delete cache.commitMetadataPromises[key];\n" +
    "        if (meta && meta.formattedTime) {\n" +
    "          cache.commitMetadataByRef[key] = meta;\n" +
    "        }\n" +
    "        return meta;\n" +
    "      },\n" +
    "      function() {\n" +
    "        delete cache.commitMetadataPromises[key];\n" +
    "        return null;\n" +
    "      }\n" +
    "    );\n" +
    "    cache.commitMetadataPromises[key] = p;\n" +
    "    return p;\n" +
    "  }\n"
  );
}

function widgetBootstrapModuleSource(publicAmd, runtimeAmd, releaseRef, assetBaseUrl, fk) {
  var pa = escapeJsString(publicAmd);
  var ra = escapeJsString(runtimeAmd);
  var rs = escapeJsString(releaseRef);
  var ab = escapeJsString(String(assetBaseUrl).replace(/\/+$/, ""));
  var wcf = escapeJsString(fk + ".css");
  var wrf = escapeJsString(fk + ".runtime.js");
  return (
    'define("' +
    pa +
    '", [], function() {\n' +
    '  "use strict";\n' +
    '  var assetBaseUrl = "' +
    ab +
    '";\n' +
    '  var widgetCssFile = "' +
    wcf +
    '";\n' +
    '  var widgetRuntimeFile = "' +
    wrf +
    '";\n' +
    '  var runtimeAmd = "' +
    ra +
    '";\n' +
    '  var releaseRef = "' +
    rs +
    '";\n' +
    "  var w = typeof window !== \"undefined\" && window ? window : (typeof globalThis !== \"undefined\" ? globalThis : {});\n" +
    "  w.__UJG_BOOTSTRAP__ = w.__UJG_BOOTSTRAP__ || { scriptPromises: {}, stylePromises: {} };\n" +
    "  var cache = w.__UJG_BOOTSTRAP__;\n" +
    "  if (typeof cache.scriptPromises !== \"object\" || cache.scriptPromises === null) cache.scriptPromises = {};\n" +
    "  if (typeof cache.stylePromises !== \"object\" || cache.stylePromises === null) cache.stylePromises = {};\n" +
    "  if (cache.runtimeReleaseRef != null && cache.runtimeReleaseRef !== \"\") {\n" +
    "    cache.runtimeReleaseRef = String(cache.runtimeReleaseRef);\n" +
    "  } else {\n" +
    "    cache.runtimeReleaseRef = null;\n" +
    "  }\n" +
    "  if (cache.runtimeReleaseRefPromise && typeof cache.runtimeReleaseRefPromise.then !== \"function\") {\n" +
    "    cache.runtimeReleaseRefPromise = null;\n" +
    "  }\n" +
    "  if (cache.refreshPromise && typeof cache.refreshPromise.then !== \"function\") {\n" +
    "    cache.refreshPromise = null;\n" +
    "  }\n" +
    "  if (typeof cache.commitMetadataByRef !== \"object\" || cache.commitMetadataByRef === null) {\n" +
    "    cache.commitMetadataByRef = {};\n" +
    "  }\n" +
    "  if (typeof cache.commitMetadataPromises !== \"object\" || cache.commitMetadataPromises === null) {\n" +
    "    cache.commitMetadataPromises = {};\n" +
    "  }\n" +
    "  function loadScriptOnce(url) {\n" +
    "    if (cache.scriptPromises[url]) return cache.scriptPromises[url];\n" +
    "    cache.scriptPromises[url] = new Promise(function(resolve, reject) {\n" +
    "      var s = document.createElement(\"script\");\n" +
    "      s.src = url;\n" +
    "      s.onload = function() { resolve(); };\n" +
    "      s.onerror = function() {\n" +
    "        if (typeof console !== \"undefined\" && console.error) {\n" +
    '          console.error("UJG bootstrap: failed to load script " + url);\n' +
    "        }\n" +
    "        reject(new Error(\"failed to load script\"));\n" +
    "      };\n" +
    "      document.head.appendChild(s);\n" +
    "    });\n" +
    "    return cache.scriptPromises[url];\n" +
    "  }\n" +
    "  function loadStyleOnce(url) {\n" +
    "    if (cache.stylePromises[url]) return cache.stylePromises[url];\n" +
    "    cache.stylePromises[url] = new Promise(function(resolve, reject) {\n" +
    "      var l = document.createElement(\"link\");\n" +
    '      l.rel = "stylesheet";\n' +
    "      l.href = url;\n" +
    "      l.onload = function() { resolve(); };\n" +
    "      l.onerror = function() {\n" +
    "        if (typeof console !== \"undefined\" && console.error) {\n" +
    '          console.error("UJG bootstrap: failed to load stylesheet " + url);\n' +
    "        }\n" +
    "        reject(new Error(\"failed to load stylesheet\"));\n" +
    "      };\n" +
    "      document.head.appendChild(l);\n" +
    "    });\n" +
    "    return cache.stylePromises[url];\n" +
    "  }\n" +
    emittedDashboardReleaseRefHelpers() +
    emittedCommitMetadataHelpers() +
    "  function buildPinnedAssetUrl(activeRef, fileName) {\n" +
    "    var base = String(assetBaseUrl).replace(/\\/+$/, \"\");\n" +
    '    return base + "@" + encodeURIComponent(String(activeRef)) + "/" + fileName;\n' +
    "  }\n" +
    "  function applyAssetUrls(target, normalizedRef) {\n" +
    "    if (!target) return;\n" +
    "    target.releaseRef = normalizedRef;\n" +
    "    target.commonJs = buildPinnedAssetUrl(normalizedRef, \"_ujgCommon.js\");\n" +
    "    target.css = buildPinnedAssetUrl(normalizedRef, widgetCssFile);\n" +
    "    target.runtimeJs = buildPinnedAssetUrl(normalizedRef, widgetRuntimeFile);\n" +
    "  }\n" +
    "  function syncExportedAssetUrls(activeRef, gadgetInstance) {\n" +
    "    var normalizedRef = String(activeRef);\n" +
    "    applyAssetUrls(UjgWidgetGadget, normalizedRef);\n" +
    "    applyAssetUrls(gadgetInstance, normalizedRef);\n" +
    "    return normalizedRef;\n" +
    "  }\n" +
    "  function resolveRuntimeReleaseRefForAssets(api, gadgetInstance) {\n" +
    "    if (cache.runtimeReleaseRef != null && cache.runtimeReleaseRef !== \"\") {\n" +
    "      return Promise.resolve(syncExportedAssetUrls(cache.runtimeReleaseRef, gadgetInstance));\n" +
    "    }\n" +
    "    if (cache.runtimeReleaseRefPromise) {\n" +
    "      return cache.runtimeReleaseRefPromise.then(function(activeRef) {\n" +
    "        return syncExportedAssetUrls(activeRef, gadgetInstance);\n" +
    "      });\n" +
    "    }\n" +
    "    cache.runtimeReleaseRefPromise = loadDashboardReleaseRef(api || {})\n" +
    "      .then(\n" +
    "        function(existing) {\n" +
    "          if (existing != null && existing !== \"\") {\n" +
    "            return String(existing);\n" +
    "          }\n" +
    "          return fetchLatestGithubReleaseRef().then(\n" +
    "            function(sha) {\n" +
    "              return saveDashboardReleaseRef(api || {}, sha).then(\n" +
    "                function() {\n" +
    "                  return sha;\n" +
    "                },\n" +
    "                function() {\n" +
    "                  return sha;\n" +
    "                }\n" +
    "              );\n" +
    "            },\n" +
    "            function() {\n" +
    "              return releaseRef;\n" +
    "            }\n" +
    "          );\n" +
    "        },\n" +
    "        function() {\n" +
    "          return releaseRef;\n" +
    "        }\n" +
    "      )\n" +
    "      .then(function(activeRef) {\n" +
    "        var normalizedRef = syncExportedAssetUrls(activeRef, gadgetInstance);\n" +
    "        cache.runtimeReleaseRef = normalizedRef;\n" +
    "        return normalizedRef;\n" +
    "      });\n" +
    "    return cache.runtimeReleaseRefPromise.then(\n" +
    "      function(activeRef) {\n" +
    "        return syncExportedAssetUrls(activeRef, gadgetInstance);\n" +
    "      },\n" +
    "      function(err) {\n" +
    "        cache.runtimeReleaseRefPromise = null;\n" +
    "        throw err;\n" +
    "      }\n" +
    "    );\n" +
    "  }\n" +
    "  function instantiateWhenReady(api, gadgetInstance) {\n" +
    "    return resolveRuntimeReleaseRefForAssets(api, gadgetInstance).then(function(activeRef) {\n" +
    "      var commonJsU = buildPinnedAssetUrl(activeRef, \"_ujgCommon.js\");\n" +
    "      var cssU = buildPinnedAssetUrl(activeRef, widgetCssFile);\n" +
    "      var runtimeU = buildPinnedAssetUrl(activeRef, widgetRuntimeFile);\n" +
    "      syncExportedAssetUrls(activeRef, gadgetInstance);\n" +
    "      return loadScriptOnce(commonJsU)\n" +
    "        .then(function() {\n" +
    "          return Promise.all([loadStyleOnce(cssU), loadScriptOnce(runtimeU)]);\n" +
    "        })\n" +
    "        .then(function() {\n" +
    "          return new Promise(function(resolve, reject) {\n" +
    '            if (typeof require !== "function") {\n' +
    '              reject(new Error("require is not a function"));\n' +
    "              return;\n" +
    "            }\n" +
    "            require([runtimeAmd], function(RuntimeMod) {\n" +
    "              var Ctor = RuntimeMod && RuntimeMod.default ? RuntimeMod.default : RuntimeMod;\n" +
    "              resolve(new Ctor(api));\n" +
    "            }, function(err) {\n" +
    "              reject(err);\n" +
    "            });\n" +
    "          });\n" +
    "        });\n" +
    "    }).then(function(runtimeInst) {\n" +
    "      try {\n" +
    "        mountBootstrapUpdateControls(api, gadgetInstance);\n" +
    "      } catch (eRemount) {}\n" +
    "      tryRefreshToolbarVersionForApi(api);\n" +
    "      return runtimeInst;\n" +
    "    });\n" +
    "  }\n" +
    "  function shortRefForToolbar(ref) {\n" +
    "    var s = String(ref || \"\");\n" +
    '    return s.length > 14 ? s.slice(0, 14) + "\\u2026" : s;\n' +
    "  }\n" +
    "  function updateToolbarVersionDisplay(toolbarRoot, ref) {\n" +
    "    if (!toolbarRoot || !toolbarRoot.querySelector) return;\n" +
    "    var span = toolbarRoot.querySelector(\".ujg-bootstrap-version\");\n" +
    "    if (!span) return;\n" +
    "    var base = shortRefForToolbar(ref) || \"\";\n" +
    "    span.textContent = base;\n" +
    "    if (!base) return;\n" +
    "    var refKey = String(ref);\n" +
    "    toolbarRoot.__ujgBootstrapVersionRef = refKey;\n" +
    "    loadCommitMetadataForRef(refKey).then(function(meta) {\n" +
    "      if (toolbarRoot.__ujgBootstrapVersionRef !== refKey) return;\n" +
    "      if (!meta || !meta.formattedTime) return;\n" +
    "      var cur = toolbarRoot.querySelector(\".ujg-bootstrap-version\");\n" +
    "      if (cur !== span) return;\n" +
    '      span.textContent = base + " \\u2022 " + meta.formattedTime;\n' +
    "    });\n" +
    "  }\n" +
    "  function normalizeBootstrapBodyNode(body) {\n" +
    "    if (!body) return null;\n" +
    "    if (typeof body.appendChild === \"function\") return body;\n" +
    "    if (body[0] && typeof body[0].appendChild === \"function\") return body[0];\n" +
    "    if (typeof body.get === \"function\") {\n" +
    "      var first = body.get(0);\n" +
    "      if (first && typeof first.appendChild === \"function\") return first;\n" +
    "    }\n" +
    "    return null;\n" +
    "  }\n" +
    "  function getBootstrapGadgetBody(api) {\n" +
    "    if (!api || typeof api.getGadget !== \"function\") return null;\n" +
    "    var gadget = api.getGadget();\n" +
    "    if (!gadget || typeof gadget.getBody !== \"function\") return null;\n" +
    "    return normalizeBootstrapBodyNode(gadget.getBody());\n" +
    "  }\n" +
    "  function tryRefreshToolbarVersionForApi(api) {\n" +
    "    try {\n" +
    "      var body = getBootstrapGadgetBody(api);\n" +
    "      var toolbar = body && typeof body.querySelector === \"function\" ? body.querySelector(\".ujg-bootstrap-toolbar\") : null;\n" +
    "      if (toolbar) updateToolbarVersionDisplay(toolbar, cache.runtimeReleaseRef || releaseRef);\n" +
    "    } catch (eTb) {}\n" +
    "  }\n" +
    "  function requestPageReload() {\n" +
    "    if (typeof window === \"undefined\" || !window || !window.location) {\n" +
    "      return;\n" +
    "    }\n" +
    "    if (typeof window.location.reload === \"function\") {\n" +
    "      window.location.reload();\n" +
    "    }\n" +
    "  }\n" +
    "  function handleBootstrapRefreshClick(api, toolbarRoot, gadgetInstance) {\n" +
    "    if (cache.refreshPromise) {\n" +
    "      return cache.refreshPromise;\n" +
    "    }\n" +
    "    cache.refreshPromise = resolveRuntimeReleaseRefForAssets(api, gadgetInstance)\n" +
    "      .then(function(cur) {\n" +
    "        return fetchLatestGithubReleaseRef().then(function(sha) {\n" +
    "          var next = String(sha).trim();\n" +
    '          if (cur != null && cur !== "" && String(cur).trim() === next) {\n' +
    "            updateToolbarVersionDisplay(toolbarRoot, cur);\n" +
    "            return null;\n" +
    "          }\n" +
    "          return saveDashboardReleaseRef(api, next).then(function() {\n" +
    "            applyAssetUrls(gadgetInstance, next);\n" +
    "            updateToolbarVersionDisplay(toolbarRoot, next);\n" +
    "            requestPageReload();\n" +
    "            return null;\n" +
    "          });\n" +
    "        });\n" +
    "      })\n" +
    "      .catch(function(errRf) {\n" +
    '        if (typeof console !== "undefined" && console.error) {\n' +
    '          console.error("UJG bootstrap: refresh failed", errRf);\n' +
    "        }\n" +
    "      });\n" +
    "    return cache.refreshPromise.then(function(result) {\n" +
    "      cache.refreshPromise = null;\n" +
    "      return result;\n" +
    "    }, function(err) {\n" +
    "      cache.refreshPromise = null;\n" +
    "      throw err;\n" +
    "    });\n" +
    "  }\n" +
    "  function mountBootstrapUpdateControls(api, gadgetInstance) {\n" +
    "    var body = getBootstrapGadgetBody(api);\n" +
    "    if (!body) return;\n" +
    "    var toolbar = typeof body.querySelector === \"function\" ? body.querySelector(\".ujg-bootstrap-toolbar\") : null;\n" +
    "    if (!toolbar) {\n" +
    '      toolbar = document.createElement("div");\n' +
    '      toolbar.className = "ujg-bootstrap-toolbar";\n' +
    '      var btn = document.createElement("button");\n' +
    '      btn.type = "button";\n' +
    '      btn.className = "ujg-bootstrap-refresh";\n' +
    '      btn.textContent = "\\u041e\\u0431\\u043d\\u043e\\u0432\\u0438\\u0442\\u044c \\u0432\\u0435\\u0440\\u0441\\u0438\\u044e";\n' +
    '      var ver = document.createElement("span");\n' +
    '      ver.className = "ujg-bootstrap-version";\n' +
    "      toolbar.appendChild(btn);\n" +
    "      toolbar.appendChild(ver);\n" +
    '      if (typeof body.insertBefore === "function") {\n' +
    "        body.insertBefore(toolbar, body.firstChild || null);\n" +
    "      } else {\n" +
    "        body.appendChild(toolbar);\n" +
    "      }\n" +
    "    }\n" +
    "    updateToolbarVersionDisplay(toolbar, cache.runtimeReleaseRef || releaseRef);\n" +
    "    var btnEl = toolbar.querySelector ? toolbar.querySelector(\".ujg-bootstrap-refresh\") : null;\n" +
    "    if (btnEl && !btnEl.__ujgBootstrapRefreshBound) {\n" +
    "      btnEl.__ujgBootstrapRefreshBound = true;\n" +
    "      btnEl.onclick = function(evRf) {\n" +
    "        if (evRf && evRf.preventDefault) evRf.preventDefault();\n" +
    "        handleBootstrapRefreshClick(api, toolbar, gadgetInstance);\n" +
    "      };\n" +
    "    }\n" +
    "  }\n" +
    "  function UjgWidgetGadget(api) {\n" +
    "    this._api = api;\n" +
    "    syncExportedAssetUrls(cache.runtimeReleaseRef != null && cache.runtimeReleaseRef !== \"\" ? cache.runtimeReleaseRef : releaseRef, this);\n" +
    "    try {\n" +
    "      mountBootstrapUpdateControls(api, this);\n" +
    "    } catch (eGadgetMount) {}\n" +
    "    if (!api || api.__ujgBootstrapSkipAutoLoad !== true) {\n" +
    "      this.readyPromise = instantiateWhenReady(api, this);\n" +
    "    } else {\n" +
    "      this.readyPromise = Promise.resolve(null);\n" +
    "    }\n" +
    "  }\n" +
    "  UjgWidgetGadget.prototype.loadScriptOnce = loadScriptOnce;\n" +
    "  UjgWidgetGadget.prototype.loadStyleOnce = loadStyleOnce;\n" +
    "  UjgWidgetGadget.prototype.instantiateWhenReady = function(targetApi) {\n" +
    "    var callApi = targetApi !== undefined ? targetApi : this._api;\n" +
    "    return instantiateWhenReady(callApi, this);\n" +
    "  };\n" +
    "  UjgWidgetGadget.prototype.loadDashboardReleaseRef = function(targetApi) {\n" +
    "    return loadDashboardReleaseRef(targetApi !== undefined ? targetApi : this._api);\n" +
    "  };\n" +
    "  UjgWidgetGadget.prototype.saveDashboardReleaseRef = function(targetApi, releaseRefVal) {\n" +
    "    return saveDashboardReleaseRef(targetApi, releaseRefVal);\n" +
    "  };\n" +
    "  UjgWidgetGadget.prototype.fetchLatestGithubReleaseRef = fetchLatestGithubReleaseRef;\n" +
    "  UjgWidgetGadget.prototype.loadCommitMetadataForRef = loadCommitMetadataForRef;\n" +
    "  syncExportedAssetUrls(cache.runtimeReleaseRef != null && cache.runtimeReleaseRef !== \"\" ? cache.runtimeReleaseRef : releaseRef);\n" +
    "  UjgWidgetGadget.runtimeAmd = runtimeAmd;\n" +
    "  UjgWidgetGadget.loadScriptOnce = loadScriptOnce;\n" +
    "  UjgWidgetGadget.loadStyleOnce = loadStyleOnce;\n" +
    "  UjgWidgetGadget.instantiateWhenReady = instantiateWhenReady;\n" +
    "  UjgWidgetGadget.loadDashboardReleaseRef = loadDashboardReleaseRef;\n" +
    "  UjgWidgetGadget.saveDashboardReleaseRef = saveDashboardReleaseRef;\n" +
    "  UjgWidgetGadget.fetchLatestGithubReleaseRef = fetchLatestGithubReleaseRef;\n" +
    "  UjgWidgetGadget.loadCommitMetadataForRef = loadCommitMetadataForRef;\n" +
    "  UjgWidgetGadget.updateToolbarVersionDisplay = updateToolbarVersionDisplay;\n" +
    "  return UjgWidgetGadget;\n" +
    "});\n"
  );
}

function resolveReleaseRef(overrides) {
  var o = overrides || {};
  if (o.releaseRef != null && o.releaseRef !== "") {
    return String(o.releaseRef);
  }
  var env = o.env !== undefined ? o.env : process.env;
  var fromEnv = env && env.UJG_RELEASE_REF;
  if (fromEnv != null && String(fromEnv).trim() !== "") {
    return String(fromEnv).trim();
  }
  var execSync = o.execSync || childProcess.execSync;
  var cwd = o.cwd !== undefined ? o.cwd : REPO_ROOT;
  var out = execSync("git rev-parse --short HEAD", { encoding: "utf8", cwd: cwd });
  if (Buffer.isBuffer(out)) {
    return out.toString("utf8").trim();
  }
  return String(out).trim();
}

function resolveBuildReleaseRef(options) {
  var opts = options || {};
  if (opts.releaseRef != null && opts.releaseRef !== "") {
    return String(opts.releaseRef);
  }
  return resolveReleaseRef({
    env: opts.env,
    execSync: opts.execSync,
    cwd: opts.cwd
  });
}

function isGeneratedBootstrapRuntimeAsset(relPath) {
  var base = path.basename(String(relPath));
  return /\.bootstrap\.js$/.test(base) || /\.runtime\.js$/.test(base);
}

function gitHeadCommitChangesOnlyBootstrapRuntimeAssets(options) {
  var opts = options || {};
  var execSync = opts.execSync || childProcess.execSync;
  var cwd = opts.cwd !== undefined ? opts.cwd : REPO_ROOT;
  try {
    execSync("git rev-parse --verify HEAD^", {
      encoding: "utf8",
      cwd: cwd,
      stdio: ["ignore", "pipe", "pipe"]
    });
  } catch (e) {
    return false;
  }
  var out = execSync("git diff --name-only HEAD^ HEAD", {
    encoding: "utf8",
    cwd: cwd
  });
  var raw = Buffer.isBuffer(out) ? out.toString("utf8") : String(out);
  var names = raw
    .split(/\n/)
    .map(function(s) {
      return s.replace(/\r$/, "").trim();
    })
    .filter(Boolean);
  if (names.length === 0) {
    return false;
  }
  return names.every(isGeneratedBootstrapRuntimeAsset);
}

function resolveCliWriteReleaseRef(options) {
  var opts = options || {};
  if (opts.releaseRef != null && opts.releaseRef !== "") {
    return String(opts.releaseRef);
  }
  var env = opts.env !== undefined ? opts.env : process.env;
  var fromEnv = env && env.UJG_RELEASE_REF;
  if (fromEnv != null && String(fromEnv).trim() !== "") {
    return String(fromEnv).trim();
  }
  if (gitHeadCommitChangesOnlyBootstrapRuntimeAssets(opts)) {
    var execSync = opts.execSync || childProcess.execSync;
    var cwd = opts.cwd !== undefined ? opts.cwd : REPO_ROOT;
    var parent = execSync("git rev-parse --short HEAD^", {
      encoding: "utf8",
      cwd: cwd
    });
    return Buffer.isBuffer(parent) ? parent.toString("utf8").trim() : String(parent).trim();
  }
  return resolveReleaseRef({
    env: opts.env,
    execSync: opts.execSync,
    cwd: opts.cwd
  });
}

function defaultAssetBaseUrl(options) {
  var opts = options || {};
  if (opts.assetBaseUrl != null && opts.assetBaseUrl !== "") {
    return String(opts.assetBaseUrl).replace(/\/+$/, "");
  }
  return "https://cdn.jsdelivr.net/gh/skivbox-ii/jira";
}

function buildAssets(options) {
  var opts = options || {};
  var releaseRef = resolveBuildReleaseRef(opts);
  var assetBaseUrl = defaultAssetBaseUrl(opts);
  var widgets = opts.widgets || [];
  var out = {};

  widgets.forEach(function(widgetId) {
    var spec = WIDGET_SPECS[widgetId];
    if (!spec) {
      throw new Error(
        'Unsupported widget source "' +
          widgetId +
          '". Expected one of: ' +
          Object.keys(WIDGET_SPECS)
            .sort()
            .join(", ")
      );
    }
    var fk = spec.fileKey;
    var runtimeFile = fk + ".runtime.js";

    out[runtimeFile] = runtimeFromPublicRename(fk, spec.publicAmd, spec.runtimeAmd);
    out[fk + ".bootstrap.js"] = widgetBootstrapModuleSource(
      spec.publicAmd,
      spec.runtimeAmd,
      releaseRef,
      assetBaseUrl,
      fk
    );
  });

  return out;
}

function allWidgetIds() {
  return Object.keys(WIDGET_SPECS).sort();
}

function normalizeTextNewlines(value) {
  return String(value).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function writeBootstrapArtifactsToDisk(options) {
  var opts = options || {};
  var widgets = opts.widgets !== undefined ? opts.widgets : allWidgetIds();
  var releaseRef = resolveCliWriteReleaseRef(opts);
  var assets = buildAssets(
    Object.assign({}, opts, { widgets: widgets, releaseRef: releaseRef })
  );
  var files = Object.keys(assets).sort();
  files.forEach(function(name) {
    fs.writeFileSync(path.join(REPO_ROOT, name), assets[name], "utf8");
  });
  return { releaseRef: releaseRef, files: files };
}

if (require.main === module) {
  var result = writeBootstrapArtifactsToDisk();
  console.log("releaseRef:", result.releaseRef);
  console.log("files:");
  result.files.forEach(function(f) {
    console.log(" ", f);
  });
}

module.exports = {
  WIDGETS: WIDGETS,
  buildAssets: buildAssets,
  resolveReleaseRef: resolveReleaseRef,
  resolveCliWriteReleaseRef: resolveCliWriteReleaseRef,
  transformRuntimeAmdRename: transformRuntimeAmdRename,
  allWidgetIds: allWidgetIds,
  normalizeTextNewlines: normalizeTextNewlines,
  UJG_DASHBOARD_RELEASE_REF_PROPERTY_KEY: UJG_DASHBOARD_RELEASE_REF_PROPERTY_KEY,
  UJG_GITHUB_MAIN_COMMIT_URL: UJG_GITHUB_MAIN_COMMIT_URL,
  UJG_GITHUB_COMMITS_MAIN_URL: UJG_GITHUB_COMMITS_MAIN_URL,
  UJG_GITHUB_COMMITS_REF_URL_PREFIX: UJG_GITHUB_COMMITS_REF_URL_PREFIX
};
