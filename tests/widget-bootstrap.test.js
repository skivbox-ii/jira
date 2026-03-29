const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const MOD_PATH = path.join(__dirname, "..", "build-widget-bootstrap-assets.js");

function releaseRefFromBootstrapSource(bootstrapSource) {
  var m = String(bootstrapSource).match(
    /var releaseRef = "((?:[^"\\]|\\.)*)";/
  );
  if (!m) {
    throw new Error("expected var releaseRef = \"...\" in bootstrap source");
  }
  return JSON.parse('"' + m[1] + '"');
}

test("re-running bootstrap generator produces the committed assets byte-for-byte", function() {
  var mod = require(MOD_PATH);
  var root = path.join(__dirname, "..");
  var canonicalPath = path.join(root, "ujg-daily-diligence.bootstrap.js");
  var pinnedRef = releaseRefFromBootstrapSource(
    fs.readFileSync(canonicalPath, "utf8")
  );
  var baseUrl = "https://cdn.jsdelivr.net/gh/skivbox-ii/jira";
  var generated = mod.buildAssets({
    releaseRef: pinnedRef,
    assetBaseUrl: baseUrl,
    widgets: mod.allWidgetIds()
  });
  var names = Object.keys(generated).sort();
  names.forEach(function(name) {
    var committed = mod.normalizeTextNewlines(
      fs.readFileSync(path.join(root, name), "utf8")
    );
    var fresh = mod.normalizeTextNewlines(generated[name]);
    assert.equal(
      fresh,
      committed,
      name +
        " is out of sync with source bundles; re-run: node build-widget-bootstrap-assets.js"
    );
  });
});

test("bootstrap generator emits daily diligence runtime and bootstrap outputs", function() {
  var releaseRef = 'abc"1234\\z';
  var mod = require(MOD_PATH);
  var baseUrl = "https://cdn.jsdelivr.net/gh/skivbox-ii/jira";
  var out = mod.buildAssets({
    releaseRef: releaseRef,
    assetBaseUrl: baseUrl,
    widgets: [mod.WIDGETS.dailyDiligence]
  });
  var runtime = out["ujg-daily-diligence.runtime.js"];
  var bootstrap = out["ujg-daily-diligence.bootstrap.js"];

  assert.match(
    runtime,
    /define\("_ujgDailyDiligenceRuntime", \["_ujgDD_main"\], function\(MyGadget\) {\s+"use strict";\s+return MyGadget;/
  );
  assert.match(bootstrap, /define\("_ujgDailyDiligence"/);
  assert.match(bootstrap, /var releaseRef = "abc\\"1234\\\\z"/);
  assert.match(bootstrap, /_ujgCommon\.js"/);
  assert.match(bootstrap, /ujg-daily-diligence\.css"/);
  assert.match(bootstrap, /ujg-daily-diligence\.runtime\.js"/);
  assert.doesNotMatch(bootstrap, /@main\//);
});

test("generated bootstrap assets are present in the repository", function() {
  var root = path.join(__dirname, "..");
  var expectedAssets = [
    ["ujg-daily-diligence.bootstrap.js", /_ujgDailyDiligence/],
    ["ujg-daily-diligence.runtime.js", /_ujgDailyDiligenceRuntime/],
    ["ujg-project-analytics.bootstrap.js", /_ujgProjectAnalytics/],
    ["ujg-project-analytics.runtime.js", /_ujgProjectAnalyticsRuntime/],
    ["ujg-sprint-health.bootstrap.js", /_ujgSprintHealth/],
    ["ujg-sprint-health.runtime.js", /_ujgSprintHealthRuntime/],
    ["ujg-timesheet.bootstrap.js", /_ujgTimesheet/],
    ["ujg-timesheet.runtime.js", /_ujgTimesheetRuntime/],
    ["ujg-timesheet.v0.bootstrap.js", /_ujgTimesheet/],
    ["ujg-timesheet.v0.runtime.js", /_ujgTimesheetV0Runtime/],
    ["ujg-user-activity.bootstrap.js", /_ujgUserActivity/],
    ["ujg-user-activity.runtime.js", /_ujgUserActivityRuntime/]
  ];

  expectedAssets.forEach(function(entry) {
    assert.match(fs.readFileSync(path.join(root, entry[0]), "utf8"), entry[1]);
  });
});

test("timesheet runtime rewrites the public AMD name to a dedicated runtime name", function() {
  var mod = require(MOD_PATH);
  var out = mod.buildAssets({
    releaseRef: "unused",
    assetBaseUrl: "https://cdn.jsdelivr.net/gh/skivbox-ii/jira",
    widgets: [mod.WIDGETS.timesheet]
  });

  assert.match(out["ujg-timesheet.runtime.js"], /define\("_ujgTimesheetRuntime"/);
  assert.match(out["ujg-timesheet.bootstrap.js"], /define\("_ujgTimesheet"/);
  assert.match(out["ujg-timesheet.bootstrap.js"], /ujg-timesheet\.runtime\.js"/);
});

test("timesheet v0 runtime uses a distinct runtime AMD name from timesheet", function() {
  var mod = require(MOD_PATH);
  var out = mod.buildAssets({
    releaseRef: "v0ref",
    assetBaseUrl: "https://cdn.jsdelivr.net/gh/skivbox-ii/jira",
    widgets: [mod.WIDGETS.timesheetV0]
  });
  assert.match(out["ujg-timesheet.v0.runtime.js"], /define\("_ujgTimesheetV0Runtime"/);
  assert.match(out["ujg-timesheet.v0.bootstrap.js"], /define\("_ujgTimesheet"/);
});

test("resolveReleaseRef prefers explicit option over env and git", function() {
  var mod = require(MOD_PATH);
  assert.equal(
    mod.resolveReleaseRef({
      releaseRef: "explicit-sha",
      env: { UJG_RELEASE_REF: "from-env" },
      execSync: function() {
        throw new Error("git should not run");
      }
    }),
    "explicit-sha"
  );
});

test("resolveReleaseRef falls back to process.env.UJG_RELEASE_REF when not overridden", function(t) {
  var mod = require(MOD_PATH);
  t.after(function() {
    delete process.env.UJG_RELEASE_REF;
  });
  process.env.UJG_RELEASE_REF = "env-release-xyz";
  assert.equal(
    mod.resolveReleaseRef({
      execSync: function() {
        throw new Error("git should not run when env is set");
      }
    }),
    "env-release-xyz"
  );
});

test("resolveReleaseRef falls back to git rev-parse --short HEAD", function() {
  var mod = require(MOD_PATH);
  assert.equal(
    mod.resolveReleaseRef({
      env: {},
      execSync: function(cmd, opts) {
        assert.match(cmd, /rev-parse/);
        assert.match(cmd, /--short/);
        return Buffer.from("a1b2c3d\n");
      }
    }),
    "a1b2c3d"
  );
});

test("buildAssets uses resolveReleaseRef when releaseRef omitted", function() {
  var mod = require(MOD_PATH);
  var out = mod.buildAssets({
    env: {},
    execSync: function() {
      return Buffer.from("pinned99\n");
    },
    assetBaseUrl: "https://cdn.jsdelivr.net/gh/skivbox-ii/jira",
    widgets: [mod.WIDGETS.sprintHealth]
  });
  assert.match(
    out["ujg-sprint-health.bootstrap.js"],
    /var releaseRef = "pinned99"/
  );
  assert.match(
    out["ujg-sprint-health.bootstrap.js"],
    /@pinned99\/_ujgCommon\.js/
  );
});

test("unsupported widget source throws a descriptive error", function() {
  var mod = require(MOD_PATH);
  assert.throws(
    function() {
      mod.buildAssets({
        releaseRef: "x",
        widgets: ["not-a-known-widget-id"]
      });
    },
    function(err) {
      assert.ok(/not-a-known-widget-id/i.test(err.message));
      assert.ok(/unsupported|unknown|expected/i.test(err.message));
      return true;
    }
  );
});

test("runtime rewrite rejects ambiguous public AMD matches", function() {
  var mod = require(MOD_PATH);
  var readFileSync = fs.readFileSync;

  fs.readFileSync = function(filePath) {
    if (path.basename(filePath) === "ujg-timesheet.js") {
      return [
        'define("_ujgTimesheet", [], function() { return "first"; });',
        'define("_ujgTimesheet", [], function() { return "second"; });'
      ].join("\n");
    }

    return readFileSync.apply(this, arguments);
  };

  try {
    assert.throws(function() {
      mod.buildAssets({
        releaseRef: "unused",
        widgets: [mod.WIDGETS.timesheet]
      });
    }, /exactly one AMD define/i);
  } finally {
    fs.readFileSync = readFileSync;
  }
});

test("bootstrap dedupes CSS and JS loads and instantiates the runtime gadget", async function() {
  var mod = require(MOD_PATH);
  var runtimeAmd = "_ujgDailyDiligenceRuntime";
  var out = mod.buildAssets({
    releaseRef: "pin1",
    assetBaseUrl: "https://cdn.jsdelivr.net/gh/skivbox-ii/jira",
    widgets: [mod.WIDGETS.dailyDiligence]
  });
  var bootstrapSrc = out["ujg-daily-diligence.bootstrap.js"];

  var appendedScripts = [];
  var appendedLinks = [];
  var amdRegistry = {};
  var defineCapture = null;

  function defineShim(name, deps, factory) {
    if (typeof deps === "function") {
      factory = deps;
      deps = [];
    }
    defineCapture = { name: name, factory: factory };
  }

  function requireShim(deps, onSuccess, onFailure) {
    queueMicrotask(function() {
      try {
        var resolved = deps.map(function(d) {
          if (!Object.prototype.hasOwnProperty.call(amdRegistry, d)) {
            throw new Error("missing AMD module: " + d);
          }
          return amdRegistry[d];
        });
        onSuccess.apply(null, resolved);
      } catch (err) {
        if (typeof onFailure === "function") {
          onFailure(err);
        }
      }
    });
  }

  function GadgetCtor(api) {
    this.api = api;
  }

  var head = {
    appendChild: function(node) {
      if (node.tagName === "SCRIPT") {
        appendedScripts.push(node);
      } else if (node.tagName === "LINK") {
        appendedLinks.push(node);
      }
    }
  };

  var documentShim = {
    head: head,
    createElement: function(tag) {
      var el = {
        tagName: String(tag).toUpperCase(),
        rel: "",
        onload: null,
        onerror: null,
        setAttribute: function(name, value) {
          if (name === "src") {
            el.src = value;
          }
          if (name === "href") {
            el.href = value;
          }
          if (name === "rel") {
            el.rel = value;
          }
        }
      };
      return el;
    }
  };

  var sandboxWindow = { __UJG_BOOTSTRAP__: undefined };
  var consoleErrors = [];
  var ctx = vm.createContext({
    define: defineShim,
    require: requireShim,
    document: documentShim,
    window: sandboxWindow,
    globalThis: sandboxWindow,
    console: {
      error: function() {
        consoleErrors.push(Array.prototype.slice.call(arguments));
      }
    },
    queueMicrotask: queueMicrotask,
    Promise: Promise
  });

  vm.runInContext(bootstrapSrc, ctx);
  assert.ok(defineCapture && typeof defineCapture.factory === "function");
  ctx.__bootstrapFactory = defineCapture.factory;
  vm.runInContext("__ujgGadget = __bootstrapFactory()", ctx);
  var gadget = ctx.__ujgGadget;
  assert.equal(typeof gadget.loadScriptOnce, "function");
  assert.equal(typeof gadget.loadStyleOnce, "function");
  assert.equal(typeof gadget.instantiateWhenReady, "function");

  var commonUrl = gadget.commonJs;
  var runtimeUrl = gadget.runtimeJs;
  var cssUrl = gadget.css;

  function countUrl(list, url) {
    return list.filter(function(n) {
      return n.src === url || n.href === url;
    }).length;
  }

  vm.runInContext(
    '__ujgP1 = __ujgGadget.instantiateWhenReady({ id: "a" }); __ujgP2 = __ujgGadget.instantiateWhenReady({ id: "b" });',
    ctx
  );
  var p1 = ctx.__ujgP1;
  var p2 = ctx.__ujgP2;

  assert.equal(countUrl(appendedScripts, commonUrl), 1);
  assert.equal(countUrl(appendedScripts, runtimeUrl), 0);
  assert.equal(countUrl(appendedLinks, cssUrl), 0);

  appendedScripts
    .filter(function(node) {
      return node.src === commonUrl;
    })
    .forEach(function(node) {
      if (typeof node.onload === "function") {
        node.onload();
      }
    });

  await new Promise(function(resolve) {
    queueMicrotask(resolve);
  });

  assert.equal(countUrl(appendedScripts, commonUrl), 1);
  assert.equal(countUrl(appendedScripts, runtimeUrl), 1);
  assert.equal(countUrl(appendedLinks, cssUrl), 1);

  appendedScripts.forEach(function(node) {
    if (node.src === runtimeUrl) {
      amdRegistry[runtimeAmd] = GadgetCtor;
    }
  });
  appendedLinks.forEach(function(node) {
    if (typeof node.onload === "function") {
      node.onload();
    }
  });
  appendedScripts.forEach(function(node) {
    if (node.src === runtimeUrl && typeof node.onload === "function") {
      node.onload();
    }
  });

  var instances = await Promise.all([p1, p2]);
  assert.equal(instances[0].api.id, "a");
  assert.equal(instances[1].api.id, "b");

  var beforeSecondWave = appendedScripts.length + appendedLinks.length;
  vm.runInContext('__ujgP3 = __ujgGadget.instantiateWhenReady({ id: "c" });', ctx);
  await ctx.__ujgP3;
  assert.equal(appendedScripts.length + appendedLinks.length, beforeSecondWave);

  var badUrl = "https://example.test/ujg-bootstrap-missing.js";
  vm.runInContext(
    '__ujgBadP = __ujgGadget.loadScriptOnce(' + JSON.stringify(badUrl) + ");",
    ctx
  );
  var badPromise = ctx.__ujgBadP;
  var badScript = appendedScripts.find(function(s) {
    return s.src === badUrl;
  });
  assert.ok(badScript);
  if (typeof badScript.onerror === "function") {
    badScript.onerror();
  }
  await assert.rejects(badPromise);
  assert.ok(
    consoleErrors.some(function(args) {
      return String(args[0]).indexOf("ujg-bootstrap-missing.js") !== -1;
    })
  );
});
