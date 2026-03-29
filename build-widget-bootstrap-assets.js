"use strict";

const fs = require("node:fs");
const path = require("node:path");
const childProcess = require("node:child_process");

const REPO_ROOT = __dirname;

var WIDGETS = {
  sprintHealth: "ujg-sprint-health",
  projectAnalytics: "ujg-project-analytics",
  timesheet: "ujg-timesheet",
  timesheetV0: "ujg-timesheet.v0",
  userActivity: "ujg-user-activity",
  dailyDiligence: "ujg-daily-diligence"
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

function widgetBootstrapModuleSource(publicAmd, runtimeAmd, releaseRef, commonJsUrl, cssUrl, runtimeJsUrl) {
  var pa = escapeJsString(publicAmd);
  var ra = escapeJsString(runtimeAmd);
  var rs = escapeJsString(releaseRef);
  var cj = escapeJsString(commonJsUrl);
  var cs = escapeJsString(cssUrl);
  var rj = escapeJsString(runtimeJsUrl);
  return (
    'define("' +
    pa +
    '", [], function() {\n' +
    '  "use strict";\n' +
    '  var commonJs = "' +
    cj +
    '";\n' +
    '  var cssUrl = "' +
    cs +
    '";\n' +
    '  var runtimeJs = "' +
    rj +
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
    "  function instantiateWhenReady(api) {\n" +
    "    return loadScriptOnce(commonJs)\n" +
    "      .then(function() {\n" +
    "        return Promise.all([loadStyleOnce(cssUrl), loadScriptOnce(runtimeJs)]);\n" +
    "      })\n" +
    "      .then(function() {\n" +
    "        return new Promise(function(resolve, reject) {\n" +
    '          if (typeof require !== "function") {\n' +
    '            reject(new Error("require is not a function"));\n' +
    "            return;\n" +
    "          }\n" +
    "          require([runtimeAmd], function(RuntimeMod) {\n" +
    "            var Ctor = RuntimeMod && RuntimeMod.default ? RuntimeMod.default : RuntimeMod;\n" +
    "            resolve(new Ctor(api));\n" +
    "          }, function(err) {\n" +
    "            reject(err);\n" +
    "          });\n" +
    "        });\n" +
    "      });\n" +
    "  }\n" +
    "  return {\n" +
    "    releaseRef: releaseRef,\n" +
    "    commonJs: commonJs,\n" +
    "    css: cssUrl,\n" +
    "    runtimeJs: runtimeJs,\n" +
    "    runtimeAmd: runtimeAmd,\n" +
    "    loadScriptOnce: loadScriptOnce,\n" +
    "    loadStyleOnce: loadStyleOnce,\n" +
    "    instantiateWhenReady: instantiateWhenReady\n" +
    "  };\n" +
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
    var commonUrl = pinnedAssetUrl(assetBaseUrl, releaseRef, "_ujgCommon.js");
    var cssUrl = pinnedAssetUrl(assetBaseUrl, releaseRef, fk + ".css");
    var runtimeFile = fk + ".runtime.js";
    var runtimeUrl = pinnedAssetUrl(assetBaseUrl, releaseRef, runtimeFile);

    out[runtimeFile] = runtimeFromPublicRename(fk, spec.publicAmd, spec.runtimeAmd);
    out[fk + ".bootstrap.js"] = widgetBootstrapModuleSource(
      spec.publicAmd,
      spec.runtimeAmd,
      releaseRef,
      commonUrl,
      cssUrl,
      runtimeUrl
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
  var releaseRef = resolveBuildReleaseRef(opts);
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
  transformRuntimeAmdRename: transformRuntimeAmdRename,
  allWidgetIds: allWidgetIds,
  normalizeTextNewlines: normalizeTextNewlines
};
