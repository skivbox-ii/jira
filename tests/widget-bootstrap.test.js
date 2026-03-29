const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const MOD_PATH = path.join(__dirname, "..", "build-widget-bootstrap-assets.js");

function escapeForRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function pinnedAssetUrlForTest(assetBaseUrl, releaseRef, fileName) {
  var base = String(assetBaseUrl).replace(/\/+$/, "");
  return base + "@" + encodeURIComponent(String(releaseRef)) + "/" + fileName;
}

function releaseRefFromBootstrapSource(bootstrapSource) {
  var m = String(bootstrapSource).match(
    /var releaseRef = "((?:[^"\\]|\\.)*)";/
  );
  if (!m) {
    throw new Error("expected var releaseRef = \"...\" in bootstrap source");
  }
  return JSON.parse('"' + m[1] + '"');
}

/** DOM element factory for bootstrap VM tests (buttons, links, scripts). */
function bootstrapTestCreateElement(tag) {
  var el = {
    tagName: String(tag).toUpperCase(),
    className: "",
    type: "",
    textContent: "",
    rel: "",
    src: "",
    href: "",
    onload: null,
    onerror: null,
    onclick: null,
    childNodes: [],
    parentElement: null,
    classList: {
      contains: function(c) {
        return (" " + el.className + " ").indexOf(" " + c + " ") !== -1;
      },
      add: function(c) {
        if (!el.classList.contains(c)) {
          el.className = (el.className + " " + c).trim();
        }
      }
    },
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
    },
    appendChild: function(child) {
      el.childNodes.push(child);
      child.parentElement = el;
    },
    insertBefore: function() {},
    matches: function(sel) {
      if (sel.indexOf(".") === 0) {
        return el.classList.contains(sel.slice(1));
      }
      return false;
    },
    querySelector: function(sel) {
      for (var i = 0; i < el.childNodes.length; i++) {
        var c = el.childNodes[i];
        if (c.matches && c.matches(sel)) {
          return c;
        }
      }
      return null;
    },
    click: function() {
      if (typeof el.onclick === "function") {
        el.onclick.call(el, { type: "click", preventDefault: function() {} });
      }
    }
  };
  return el;
}

function createMockGadgetBody() {
  var body = {
    firstChild: null,
    _nodes: [],
    appendChild: function(node) {
      body._nodes.push(node);
    },
    insertBefore: function(node, ref) {
      body._nodes.unshift(node);
      if (!body.firstChild) {
        body.firstChild = node;
      }
    },
    querySelector: function(sel) {
      for (var i = 0; i < body._nodes.length; i++) {
        var n = body._nodes[i];
        if (n && n.matches && n.matches(sel)) {
          return n;
        }
        if (n && n.querySelector) {
          var inner = n.querySelector(sel);
          if (inner) {
            return inner;
          }
        }
      }
      return null;
    }
  };
  return body;
}

function gadgetApiWithBody(body, extras) {
  var base = {
    getGadget: function() {
      return {
        getBody: function() {
          return body;
        }
      };
    }
  };
  return Object.assign(base, extras || {});
}

function wrapGadgetBodyAsJquery(body) {
  return {
    0: body,
    length: 1,
    jquery: "3.7.1",
    get: function(idx) {
      return idx === 0 ? body : undefined;
    }
  };
}

function createSharedContentCollectionForBody(body, className) {
  var classes = String(className || "").split(/\s+/).filter(Boolean);
  return {
    0: body,
    length: 1,
    hasClass: function(name) {
      return classes.indexOf(String(name)) !== -1;
    },
    removeAttr: function() {},
    empty: function() {
      body._nodes = [];
      body.firstChild = null;
      return this;
    },
    append: function(node) {
      if (Array.isArray(node)) {
        node.forEach(function(item) {
          body.appendChild(item);
        });
      } else {
        body.appendChild(node);
      }
      return this;
    },
    find: function() {
      return {
        length: 0,
        hasClass: function() { return false; },
        removeAttr: function() {},
        append: function() {},
        find: function() { return this; }
      };
    }
  };
}

function createDeferred() {
  var resolve;
  var reject;
  var promise = new Promise(function(res, rej) {
    resolve = res;
    reject = rej;
  });
  return { promise: promise, resolve: resolve, reject: reject };
}

/** VM + AMD shim: returns gadget instance from generated daily-diligence bootstrap. */
function instantiateDailyDiligenceGadget(mod, contextExtras) {
  var out = mod.buildAssets({
    releaseRef: "pin-release",
    assetBaseUrl: "https://cdn.jsdelivr.net/gh/skivbox-ii/jira",
    widgets: [mod.WIDGETS.dailyDiligence]
  });
  var bootstrapSrc = out["ujg-daily-diligence.bootstrap.js"];
  var defineCapture = null;
  function defineShim(name, deps, factory) {
    if (typeof deps === "function") {
      factory = deps;
      deps = [];
    }
    defineCapture = { name: name, factory: factory };
  }
  var head = {
    appendChild: function() {}
  };
  var baseCtx = {
    define: defineShim,
    require: function() {},
    document: {
      head: head,
      createElement: bootstrapTestCreateElement
    },
    window: {},
    globalThis: null,
    queueMicrotask: queueMicrotask,
    Promise: Promise
  };
  if (contextExtras && typeof contextExtras === "object") {
    Object.keys(contextExtras).forEach(function(k) {
      baseCtx[k] = contextExtras[k];
    });
  }
  baseCtx.globalThis = baseCtx.window;
  var ctx = vm.createContext(baseCtx);
  vm.runInContext(bootstrapSrc, ctx);
  assert.ok(defineCapture && typeof defineCapture.factory === "function");
  ctx.__bootstrapFactory = defineCapture.factory;
  var body = createMockGadgetBody();
  ctx.__ujgBody = body;
  vm.runInContext(
    "__ujgCtor = __bootstrapFactory(); __ujgGadget = new __ujgCtor({ __ujgBootstrapSkipAutoLoad: true, getGadget: function() { return { getBody: function() { return __ujgBody; } }; } });",
    ctx
  );
  return ctx.__ujgGadget;
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
  assert.match(bootstrap, /var assetBaseUrl = "https:\/\/cdn\.jsdelivr\.net\/gh\/skivbox-ii\/jira"/);
  assert.match(bootstrap, /function buildPinnedAssetUrl\(/);
  assert.match(bootstrap, /ujg-daily-diligence\.css"/);
  assert.match(bootstrap, /ujg-daily-diligence\.runtime\.js"/);
  assert.doesNotMatch(
    bootstrap,
    new RegExp(
      escapeForRegExp(pinnedAssetUrlForTest(baseUrl, releaseRef, "_ujgCommon.js"))
    )
  );
  assert.doesNotMatch(bootstrap, /@main\//);
});

test("bootstrap generator emits story browser runtime and bootstrap outputs", function() {
  var releaseRef = 'story"5678\\ref';
  var mod = require(MOD_PATH);
  var baseUrl = "https://cdn.jsdelivr.net/gh/skivbox-ii/jira";
  var out = mod.buildAssets({
    releaseRef: releaseRef,
    assetBaseUrl: baseUrl,
    widgets: [mod.WIDGETS.storyBrowser]
  });
  var runtime = out["ujg-story-browser.runtime.js"];
  var bootstrap = out["ujg-story-browser.bootstrap.js"];

  assert.match(
    runtime,
    /define\("_ujgStoryBrowserRuntime", \["_ujgSB_main"\], function\(G\) {\s+"use strict";\s+return G;/
  );
  assert.match(bootstrap, /define\("_ujgStoryBrowser"/);
  assert.match(bootstrap, /var releaseRef = "story\\"5678\\\\ref"/);
  assert.match(bootstrap, /_ujgCommon\.js"/);
  assert.match(bootstrap, /ujg-story-browser\.css"/);
  assert.match(bootstrap, /ujg-story-browser\.runtime\.js"/);
  assert.doesNotMatch(bootstrap, /@main\//);
});

test("generated bootstrap assets are present in the repository", function() {
  var root = path.join(__dirname, "..");
  var expectedAssets = [
    ["ujg-daily-diligence.bootstrap.js", /_ujgDailyDiligence/],
    ["ujg-daily-diligence.runtime.js", /_ujgDailyDiligenceRuntime/],
    ["ujg-story-browser.bootstrap.js", /_ujgStoryBrowser/],
    ["ujg-story-browser.runtime.js", /_ujgStoryBrowserRuntime/],
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

test("resolveCliWriteReleaseRef pins to HEAD^ when HEAD only changes bootstrap/runtime assets", function() {
  var mod = require(MOD_PATH);
  assert.equal(
    mod.resolveCliWriteReleaseRef({
      env: {},
      execSync: function(cmd) {
        var c = String(cmd);
        if (/rev-parse --verify HEAD\^/.test(c)) {
          return "";
        }
        if (/diff --name-only HEAD\^ HEAD/.test(c)) {
          return (
            "ujg-daily-diligence.bootstrap.js\n" +
            "ujg-daily-diligence.runtime.js\n"
          );
        }
        if (/rev-parse --short HEAD\^/.test(c)) {
          return Buffer.from("parentab\n");
        }
        if (/rev-parse --short HEAD/.test(c)) {
          throw new Error("unexpected HEAD (not HEAD^) rev-parse: " + c);
        }
        throw new Error("unexpected git command: " + c);
      }
    }),
    "parentab"
  );
});

test("resolveCliWriteReleaseRef uses HEAD when HEAD changes non-bootstrap files", function() {
  var mod = require(MOD_PATH);
  assert.equal(
    mod.resolveCliWriteReleaseRef({
      env: {},
      execSync: function(cmd) {
        var c = String(cmd);
        if (/rev-parse --verify HEAD\^/.test(c)) {
          return "";
        }
        if (/diff --name-only HEAD\^ HEAD/.test(c)) {
          return "ujg-sprint-health.js\nujg-sprint-health.bootstrap.js\n";
        }
        if (/rev-parse --short HEAD/.test(c) && !/HEAD\^/.test(c)) {
          return Buffer.from("currentz\n");
        }
        throw new Error("unexpected git command: " + c);
      }
    }),
    "currentz"
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
  var bootstrap = out["ujg-sprint-health.bootstrap.js"];
  assert.match(bootstrap, /var releaseRef = "pinned99"/);
  assert.match(bootstrap, /var assetBaseUrl = "https:\/\/cdn\.jsdelivr\.net\/gh\/skivbox-ii\/jira"/);
  assert.doesNotMatch(
    bootstrap,
    new RegExp(
      escapeForRegExp(
        pinnedAssetUrlForTest(
          "https://cdn.jsdelivr.net/gh/skivbox-ii/jira",
          "pinned99",
          "_ujgCommon.js"
        )
      )
    )
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
  var key = mod.UJG_DASHBOARD_RELEASE_REF_PROPERTY_KEY;
  var runtimeAmd = "_ujgDailyDiligenceRuntime";
  var baseUrl = "https://cdn.jsdelivr.net/gh/skivbox-ii/jira";
  var out = mod.buildAssets({
    releaseRef: "pin1",
    assetBaseUrl: baseUrl,
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
    createElement: bootstrapTestCreateElement
  };

  var sandboxWindow = { __UJG_BOOTSTRAP__: undefined };
  var consoleErrors = [];
  var commonUrl = pinnedAssetUrlForTest(baseUrl, "pin1", "_ujgCommon.js");
  var runtimeUrl = pinnedAssetUrlForTest(baseUrl, "pin1", "ujg-daily-diligence.runtime.js");
  var cssUrl = pinnedAssetUrlForTest(baseUrl, "pin1", "ujg-daily-diligence.css");
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

  ctx.__ujgBodyA = createMockGadgetBody();
  ctx.__ujgBodyB = createMockGadgetBody();
  vm.runInContext(bootstrapSrc, ctx);
  assert.ok(defineCapture && typeof defineCapture.factory === "function");
  ctx.__bootstrapFactory = defineCapture.factory;
  ctx.__ujgKey = key;
  vm.runInContext(
    "__ujgCtor = __bootstrapFactory();" +
      '__ujgApi = { id: "a", getDashboardProperty: function(k) { ' +
      'if (k !== __ujgKey) return Promise.reject(new Error("bad key")); ' +
      'return Promise.resolve("pin1"); }, ' +
      "getGadget: function() { return { getBody: function() { return __ujgBodyA; } }; } };" +
      "__ujgApiB = Object.assign({}, __ujgApi, { id: \"b\", getGadget: function() { return { getBody: function() { return __ujgBodyB; } }; } });" +
      "__ujgG1 = new __ujgCtor(__ujgApi);" +
      "__ujgG2 = new __ujgCtor(__ujgApiB);" +
      "__ujgP1 = __ujgG1.readyPromise;" +
      "__ujgP2 = __ujgG2.readyPromise;",
    ctx
  );
  var gadget = ctx.__ujgG1;
  assert.equal(typeof gadget.loadScriptOnce, "function");
  assert.equal(typeof gadget.loadStyleOnce, "function");
  assert.equal(typeof gadget.instantiateWhenReady, "function");

  function countUrl(list, url) {
    return list.filter(function(n) {
      return n.src === url || n.href === url;
    }).length;
  }

  var p1 = ctx.__ujgP1;
  var p2 = ctx.__ujgP2;

  for (var flush = 0; flush < 20 && countUrl(appendedScripts, commonUrl) === 0; flush++) {
    await new Promise(function(resolve) {
      queueMicrotask(resolve);
    });
  }

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
  vm.runInContext(
    '__ujgP3 = __ujgG1.instantiateWhenReady(Object.assign({}, __ujgApi, { id: "c" }));',
    ctx
  );
  await ctx.__ujgP3;
  assert.equal(appendedScripts.length + appendedLinks.length, beforeSecondWave);

  var badUrl = "https://example.test/ujg-bootstrap-missing.js";
  vm.runInContext(
    '__ujgBadP = __ujgG1.loadScriptOnce(' + JSON.stringify(badUrl) + ");",
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

test("loadDashboardReleaseRef reads releaseRef from dashboard property", async function() {
  var mod = require(MOD_PATH);
  var key = mod.UJG_DASHBOARD_RELEASE_REF_PROPERTY_KEY;
  var gadget = instantiateDailyDiligenceGadget(mod);
  var api = {
    getDashboardProperty: function(k) {
      assert.equal(k, key);
      return Promise.resolve("sha-from-property");
    }
  };
  assert.equal(await gadget.loadDashboardReleaseRef(api), "sha-from-property");
});

test("loadDashboardReleaseRef returns null when dashboard property is missing", async function() {
  var mod = require(MOD_PATH);
  var key = mod.UJG_DASHBOARD_RELEASE_REF_PROPERTY_KEY;
  var gadget = instantiateDailyDiligenceGadget(mod);
  var api = {
    getDashboardProperty: function(k) {
      assert.equal(k, key);
      return Promise.resolve(null);
    }
  };
  assert.equal(await gadget.loadDashboardReleaseRef(api), null);
});

test("fetchLatestGithubReleaseRef fetches latest main SHA from GitHub API", async function() {
  var mod = require(MOD_PATH);
  var url = mod.UJG_GITHUB_MAIN_COMMIT_URL || mod.UJG_GITHUB_COMMITS_MAIN_URL;
  var sha = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  var gadget = instantiateDailyDiligenceGadget(mod, {
    fetch: function(input) {
      assert.equal(String(input), url);
      return Promise.resolve({
        ok: true,
        json: function() {
          return Promise.resolve({ sha: sha });
        },
        text: function() {
          return Promise.resolve("");
        }
      });
    }
  });
  assert.equal(await gadget.fetchLatestGithubReleaseRef(), sha);
});

test("active releaseRef loads commit metadata via GitHub commits API and version span shows short hash and formatted time", async function() {
  var mod = require(MOD_PATH);
  var key = mod.UJG_DASHBOARD_RELEASE_REF_PROPERTY_KEY;
  var commitsPrefix = mod.UJG_GITHUB_COMMITS_REF_URL_PREFIX;
  assert.equal(
    commitsPrefix,
    "https://api.github.com/repos/skivbox-ii/jira/commits/"
  );
  var activeRef = "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
  var commitApiUrl = commitsPrefix + encodeURIComponent(activeRef);
  var iso = "2024-06-12T15:05:30Z";
  var baseUrl = "https://cdn.jsdelivr.net/gh/skivbox-ii/jira";
  var out = mod.buildAssets({
    releaseRef: activeRef,
    assetBaseUrl: baseUrl,
    widgets: [mod.WIDGETS.dailyDiligence]
  });
  var bootstrapSrc = out["ujg-daily-diligence.bootstrap.js"];
  var appendedScripts = [];
  var appendedLinks = [];
  var amdRegistry = {};
  var defineCapture = null;
  var commitFetchCount = 0;

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
  var head = {
    appendChild: function(node) {
      if (node.tagName === "SCRIPT") {
        appendedScripts.push(node);
      } else if (node.tagName === "LINK") {
        appendedLinks.push(node);
      }
    }
  };
  var sandboxWindow = {};
  var ctx = vm.createContext({
    define: defineShim,
    require: requireShim,
    document: {
      head: head,
      createElement: bootstrapTestCreateElement
    },
    window: sandboxWindow,
    globalThis: sandboxWindow,
    fetch: function(input) {
      var u = String(input);
      if (u === commitApiUrl) {
        commitFetchCount += 1;
        return Promise.resolve({
          ok: true,
          json: function() {
            return Promise.resolve({
              sha: activeRef,
              commit: { committer: { date: iso } }
            });
          },
          text: function() {
            return Promise.resolve("");
          }
        });
      }
      return Promise.reject(new Error("unexpected fetch URL: " + u));
    },
    queueMicrotask: queueMicrotask,
    Promise: Promise
  });
  ctx.__ujgBody = createMockGadgetBody();
  vm.runInContext(bootstrapSrc, ctx);
  ctx.__bootstrapFactory = defineCapture.factory;
  ctx.__ujgKey = key;
  vm.runInContext(
    "__ujgCtor = __bootstrapFactory();" +
      '__ujgApi = { getDashboardProperty: function(k) { ' +
      "if (k !== __ujgKey) return Promise.reject(new Error(\"bad key\")); " +
      "return Promise.resolve(" +
      JSON.stringify(activeRef) +
      "); }, getGadget: function() { return { getBody: function() { return __ujgBody; } }; } };" +
      "__ujgG = new __ujgCtor(__ujgApi);" +
      "__ujgP = __ujgG.readyPromise;",
    ctx
  );

  var expectedCommon = pinnedAssetUrlForTest(baseUrl, activeRef, "_ujgCommon.js");
  for (var w = 0; w < 40; w++) {
    await new Promise(function(r) {
      queueMicrotask(r);
    });
    if (appendedScripts.some(function(n) { return n.src === expectedCommon; })) {
      break;
    }
  }
  appendedScripts
    .filter(function(n) {
      return n.src === expectedCommon;
    })
    .forEach(function(n) {
      if (typeof n.onload === "function") {
        n.onload();
      }
    });
  await new Promise(function(r) {
    queueMicrotask(r);
  });
  appendedLinks.forEach(function(n) {
    if (typeof n.onload === "function") {
      n.onload();
    }
  });
  appendedScripts.forEach(function(n) {
    if (
      n.src === pinnedAssetUrlForTest(baseUrl, activeRef, "ujg-daily-diligence.runtime.js") &&
      typeof n.onload === "function"
    ) {
      amdRegistry["_ujgDailyDiligenceRuntime"] = function Gadget(api) {
        this.api = api;
      };
      n.onload();
    }
  });
  await ctx.__ujgP;

  var ver = ctx.__ujgBody.querySelector(".ujg-bootstrap-version");
  assert.ok(ver);
  for (var t = 0; t < 40 && String(ver.textContent || "").indexOf("2024-06-12 15:05") === -1; t++) {
    await new Promise(function(r) {
      queueMicrotask(r);
    });
  }
  var text = String(ver.textContent || "");
  assert.match(text, /deadbeefdeadbe/);
  assert.match(text, /2024-06-12 15:05/);
  assert.ok(sandboxWindow.__UJG_BOOTSTRAP__);
  assert.equal(
    sandboxWindow.__UJG_BOOTSTRAP__.commitMetadataByRef[activeRef].formattedTime,
    "2024-06-12 15:05"
  );
  assert.equal(commitFetchCount, 1);
});

test("fetchLatestGithubReleaseRef rejects when GitHub main commit API is non-OK", async function() {
  var mod = require(MOD_PATH);
  var url = mod.UJG_GITHUB_MAIN_COMMIT_URL || mod.UJG_GITHUB_COMMITS_MAIN_URL;
  var gadget = instantiateDailyDiligenceGadget(mod, {
    fetch: function(input) {
      assert.equal(String(input), url);
      return Promise.resolve({
        ok: false,
        status: 503,
        json: function() {
          return Promise.resolve({});
        },
        text: function() {
          return Promise.resolve("rate limited");
        }
      });
    }
  });
  await assert.rejects(
    gadget.fetchLatestGithubReleaseRef(),
    /GitHub main commit API 503: rate limited/
  );
});

test("fetchLatestGithubReleaseRef rejects when GitHub main commit payload is missing sha", async function() {
  var mod = require(MOD_PATH);
  var url = mod.UJG_GITHUB_MAIN_COMMIT_URL || mod.UJG_GITHUB_COMMITS_MAIN_URL;
  var gadget = instantiateDailyDiligenceGadget(mod, {
    fetch: function(input) {
      assert.equal(String(input), url);
      return Promise.resolve({
        ok: true,
        json: function() {
          return Promise.resolve({ commit: { message: "missing sha" } });
        },
        text: function() {
          return Promise.resolve("");
        }
      });
    }
  });
  await assert.rejects(
    gadget.fetchLatestGithubReleaseRef(),
    /GitHub main commit API: missing sha/
  );
});

test("saveDashboardReleaseRef trims and saves releaseRef to dashboard property", async function() {
  var mod = require(MOD_PATH);
  var key = mod.UJG_DASHBOARD_RELEASE_REF_PROPERTY_KEY;
  var gadget = instantiateDailyDiligenceGadget(mod);
  var saved = { key: null, value: null };
  var api = {
    setDashboardProperty: function(k, v) {
      saved.key = k;
      saved.value = v;
      return Promise.resolve();
    }
  };
  await gadget.saveDashboardReleaseRef(api, "  new-sha-value  ");
  assert.equal(saved.key, key);
  assert.equal(saved.value, "new-sha-value");
});

test("saveDashboardReleaseRef rejects nullish or blank releaseRef values", async function() {
  var mod = require(MOD_PATH);
  var gadget = instantiateDailyDiligenceGadget(mod);
  var saveCalls = 0;
  var api = {
    setDashboardProperty: function() {
      saveCalls += 1;
      return Promise.resolve();
    }
  };

  await assert.rejects(
    gadget.saveDashboardReleaseRef(api, undefined),
    /releaseRef must be a non-empty string/
  );
  await assert.rejects(
    gadget.saveDashboardReleaseRef(api, null),
    /releaseRef must be a non-empty string/
  );
  await assert.rejects(
    gadget.saveDashboardReleaseRef(api, ""),
    /releaseRef must be a non-empty string/
  );
  await assert.rejects(
    gadget.saveDashboardReleaseRef(api, "   "),
    /releaseRef must be a non-empty string/
  );
  assert.equal(saveCalls, 0);
});

test("when releaseRef missing, fetch then save persists GitHub main SHA", async function() {
  var mod = require(MOD_PATH);
  var key = mod.UJG_DASHBOARD_RELEASE_REF_PROPERTY_KEY;
  var url = mod.UJG_GITHUB_MAIN_COMMIT_URL || mod.UJG_GITHUB_COMMITS_MAIN_URL;
  var sha = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  var gadget = instantiateDailyDiligenceGadget(mod, {
    fetch: function(input) {
      assert.equal(String(input), url);
      return Promise.resolve({
        ok: true,
        json: function() {
          return Promise.resolve({ sha: sha });
        },
        text: function() {
          return Promise.resolve("");
        }
      });
    }
  });
  var saved = { key: null, value: null };
  var api = {
    getDashboardProperty: function(k) {
      assert.equal(k, key);
      return Promise.resolve(null);
    },
    setDashboardProperty: function(k, v) {
      saved.key = k;
      saved.value = v;
      return Promise.resolve();
    }
  };
  var existing = await gadget.loadDashboardReleaseRef(api);
  assert.equal(existing, null);
  var latest = await gadget.fetchLatestGithubReleaseRef();
  assert.equal(latest, sha);
  await gadget.saveDashboardReleaseRef(api, latest);
  assert.equal(saved.key, key);
  assert.equal(saved.value, sha);
});

test("instantiateWhenReady loads assets using dashboard releaseRef, not build-time releaseRef", async function() {
  var mod = require(MOD_PATH);
  var key = mod.UJG_DASHBOARD_RELEASE_REF_PROPERTY_KEY;
  var baseUrl = "https://cdn.jsdelivr.net/gh/skivbox-ii/jira";
  var buildRef = "BUILDTIMESHA";
  var runtimeRef = "RUNTIMEREF99";
  var out = mod.buildAssets({
    releaseRef: buildRef,
    assetBaseUrl: baseUrl,
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
    createElement: bootstrapTestCreateElement
  };
  var sandboxWindow = {};
  var ctx = vm.createContext({
    define: defineShim,
    require: requireShim,
    document: documentShim,
    window: sandboxWindow,
    globalThis: sandboxWindow,
    queueMicrotask: queueMicrotask,
    Promise: Promise
  });
  ctx.__ujgBody = createMockGadgetBody();
  vm.runInContext(bootstrapSrc, ctx);
  ctx.__bootstrapFactory = defineCapture.factory;
  ctx.__ujgKey = key;
  vm.runInContext(
    "__ujgCtor = __bootstrapFactory();" +
      '__ujgApi = { getDashboardProperty: function(k) { ' +
      "if (k !== __ujgKey) return Promise.reject(new Error(\"bad key\")); " +
      "return Promise.resolve(" +
      JSON.stringify(runtimeRef) +
      "); }, getGadget: function() { return { getBody: function() { return __ujgBody; } }; } };" +
      "__ujgG = new __ujgCtor(__ujgApi);" +
      "__ujgP = __ujgG.readyPromise;",
    ctx
  );
  var gadget = ctx.__ujgG;
  var buildPinnedCommon = pinnedAssetUrlForTest(baseUrl, buildRef, "_ujgCommon.js");
  var expectedCommon = pinnedAssetUrlForTest(baseUrl, runtimeRef, "_ujgCommon.js");
  for (var flushR = 0; flushR < 20; flushR++) {
    await new Promise(function(r) {
      queueMicrotask(r);
    });
    if (appendedScripts.some(function(n) { return n.src === expectedCommon; })) {
      break;
    }
  }
  assert.ok(
    appendedScripts.every(function(n) {
      return n.src !== buildPinnedCommon;
    }),
    "must not load common JS using build-time releaseRef URL"
  );
  assert.ok(
    appendedScripts.some(function(n) {
      return n.src === expectedCommon;
    })
  );
  appendedScripts
    .filter(function(n) {
      return n.src === expectedCommon;
    })
    .forEach(function(n) {
      if (typeof n.onload === "function") {
        n.onload();
      }
    });
  await new Promise(function(r) {
    queueMicrotask(r);
  });
  appendedLinks.forEach(function(n) {
    if (typeof n.onload === "function") {
      n.onload();
    }
  });
  appendedScripts.forEach(function(n) {
    if (
      n.src === pinnedAssetUrlForTest(baseUrl, runtimeRef, "ujg-daily-diligence.runtime.js") &&
      typeof n.onload === "function"
    ) {
      amdRegistry["_ujgDailyDiligenceRuntime"] = function Gadget(api) {
        this.api = api;
      };
      n.onload();
    }
  });
  await ctx.__ujgP;
  assert.equal(
    gadget.commonJs,
    expectedCommon,
    "exported commonJs should match runtime-resolved URL after load planning"
  );
  assert.equal(gadget.releaseRef, runtimeRef);
  assert.equal(
    gadget.css,
    pinnedAssetUrlForTest(baseUrl, runtimeRef, "ujg-daily-diligence.css")
  );
  assert.equal(
    gadget.runtimeJs,
    pinnedAssetUrlForTest(baseUrl, runtimeRef, "ujg-daily-diligence.runtime.js")
  );
});

test("when dashboard property missing, instantiateWhenReady fetches GitHub SHA, saves it, and uses it for asset URLs", async function() {
  var mod = require(MOD_PATH);
  var key = mod.UJG_DASHBOARD_RELEASE_REF_PROPERTY_KEY;
  var ghUrl = mod.UJG_GITHUB_MAIN_COMMIT_URL || mod.UJG_GITHUB_COMMITS_MAIN_URL;
  var baseUrl = "https://cdn.jsdelivr.net/gh/skivbox-ii/jira";
  var buildRef = "onlybuild";
  var fetchedSha = "cccccccccccccccccccccccccccccccccccccccc";
  var out = mod.buildAssets({
    releaseRef: buildRef,
    assetBaseUrl: baseUrl,
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
  var head = {
    appendChild: function(node) {
      if (node.tagName === "SCRIPT") {
        appendedScripts.push(node);
      } else if (node.tagName === "LINK") {
        appendedLinks.push(node);
      }
    }
  };
  var ctx = vm.createContext({
    define: defineShim,
    require: requireShim,
    document: {
      head: head,
      createElement: bootstrapTestCreateElement
    },
    window: {},
    globalThis: null,
    fetch: function(input) {
      var u = String(input);
      if (u === ghUrl) {
        return Promise.resolve({
          ok: true,
          json: function() {
            return Promise.resolve({ sha: fetchedSha });
          },
          text: function() {
            return Promise.resolve("");
          }
        });
      }
      return Promise.reject(new Error("unexpected fetch URL: " + u));
    },
    queueMicrotask: queueMicrotask,
    Promise: Promise
  });
  ctx.globalThis = ctx.window;
  ctx.__ujgBody = createMockGadgetBody();
  vm.runInContext(bootstrapSrc, ctx);
  ctx.__bootstrapFactory = defineCapture.factory;
  ctx.__ujgKey = key;
  vm.runInContext(
    "__ujgCtor = __bootstrapFactory();" +
      '__ujgApi = { ' +
      "getDashboardProperty: function(k) { if (k !== __ujgKey) return Promise.reject(new Error(\"bad key\")); return Promise.resolve(null); }, " +
      "setDashboardProperty: function(k, v) { " +
      "if (k !== __ujgKey) return Promise.reject(new Error(\"bad key\")); " +
      "__ujgSavedKey = k; __ujgSavedVal = v; return Promise.resolve(); }, " +
      "getGadget: function() { return { getBody: function() { return __ujgBody; } }; } }; " +
      "__ujgG = new __ujgCtor(__ujgApi);" +
      "__ujgP = __ujgG.readyPromise;",
    ctx
  );
  for (var waitI = 0; waitI < 30 && ctx.__ujgSavedKey == null; waitI++) {
    await new Promise(function(r) {
      queueMicrotask(r);
    });
  }
  assert.equal(ctx.__ujgSavedKey, key);
  assert.equal(ctx.__ujgSavedVal, fetchedSha);
  var expectedCommon = pinnedAssetUrlForTest(baseUrl, fetchedSha, "_ujgCommon.js");
  for (var waitS = 0; waitS < 30; waitS++) {
    if (appendedScripts.some(function(n) { return n.src === expectedCommon; })) {
      break;
    }
    await new Promise(function(r) {
      queueMicrotask(r);
    });
  }
  assert.ok(appendedScripts.some(function(n) { return n.src === expectedCommon; }));
  appendedScripts
    .filter(function(n) {
      return n.src === expectedCommon;
    })
    .forEach(function(n) {
      if (typeof n.onload === "function") {
        n.onload();
      }
    });
  await new Promise(function(r) {
    queueMicrotask(r);
  });
  appendedLinks.forEach(function(n) {
    if (typeof n.onload === "function") {
      n.onload();
    }
  });
  appendedScripts.forEach(function(n) {
    if (
      n.src === pinnedAssetUrlForTest(baseUrl, fetchedSha, "ujg-daily-diligence.runtime.js") &&
      typeof n.onload === "function"
    ) {
      amdRegistry["_ujgDailyDiligenceRuntime"] = function() {};
      n.onload();
    }
  });
  await ctx.__ujgP;
  assert.equal(ctx.__ujgG.releaseRef, fetchedSha);
  assert.equal(ctx.__ujgG.commonJs, expectedCommon);
});

test("property read errors fall back to build-time releaseRef without fetching GitHub", async function() {
  var mod = require(MOD_PATH);
  var key = mod.UJG_DASHBOARD_RELEASE_REF_PROPERTY_KEY;
  var ghUrl = mod.UJG_GITHUB_MAIN_COMMIT_URL || mod.UJG_GITHUB_COMMITS_MAIN_URL;
  var baseUrl = "https://cdn.jsdelivr.net/gh/skivbox-ii/jira";
  var buildRef = "buildfallback";
  var out = mod.buildAssets({
    releaseRef: buildRef,
    assetBaseUrl: baseUrl,
    widgets: [mod.WIDGETS.dailyDiligence]
  });
  var bootstrapSrc = out["ujg-daily-diligence.bootstrap.js"];
  var appendedScripts = [];
  var appendedLinks = [];
  var amdRegistry = {};
  var defineCapture = null;
  var githubFetchCount = 0;
  var saveCount = 0;

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

  var head = {
    appendChild: function(node) {
      if (node.tagName === "SCRIPT") {
        appendedScripts.push(node);
      } else if (node.tagName === "LINK") {
        appendedLinks.push(node);
      }
    }
  };

  var ctx = vm.createContext({
    define: defineShim,
    require: requireShim,
    document: {
      head: head,
      createElement: bootstrapTestCreateElement
    },
    window: {},
    globalThis: null,
    fetch: function(input) {
      if (String(input) === ghUrl) {
        githubFetchCount += 1;
      }
      return Promise.reject(new Error("unexpected fetch: " + input));
    },
    queueMicrotask: queueMicrotask,
    Promise: Promise
  });
  ctx.globalThis = ctx.window;
  ctx.__ujgReadCount = 0;
  ctx.__ujgSaveCount = 0;
  ctx.__ujgBody = createMockGadgetBody();

  vm.runInContext(bootstrapSrc, ctx);
  ctx.__bootstrapFactory = defineCapture.factory;
  ctx.__ujgKey = key;
  vm.runInContext(
    "__ujgCtor = __bootstrapFactory();" +
      '__ujgApi = {' +
      '  getDashboardProperty: function(k) {' +
      '    if (k !== __ujgKey) return Promise.reject(new Error("bad key"));' +
      '    return Promise.reject(new Error("jira property read failed"));' +
      "  }," +
      '  setDashboardProperty: function() {' +
      "    __ujgSaveCount = (__ujgSaveCount || 0) + 1;" +
      "    return Promise.resolve();" +
      "  }," +
      "  getGadget: function() { return { getBody: function() { return __ujgBody; } }; }" +
      "};" +
      "__ujgG = new __ujgCtor(__ujgApi);" +
      "__ujgP = __ujgG.readyPromise;",
    ctx
  );

  var expectedCommon = pinnedAssetUrlForTest(baseUrl, buildRef, "_ujgCommon.js");
  for (var i = 0; i < 20; i++) {
    await new Promise(function(resolve) {
      queueMicrotask(resolve);
    });
    if (appendedScripts.some(function(node) { return node.src === expectedCommon; })) {
      break;
    }
  }

  assert.equal(githubFetchCount, 0);
  saveCount = ctx.__ujgSaveCount || 0;
  assert.equal(saveCount, 0);
  assert.equal(ctx.__ujgG.releaseRef, buildRef);
  assert.ok(
    appendedScripts.some(function(node) {
      return node.src === expectedCommon;
    })
  );

  appendedScripts.forEach(function(node) {
    if (node.src === expectedCommon && typeof node.onload === "function") {
      node.onload();
    }
  });
  await new Promise(function(resolve) {
    queueMicrotask(resolve);
  });
  appendedLinks.forEach(function(node) {
    if (typeof node.onload === "function") {
      node.onload();
    }
  });
  appendedScripts.forEach(function(node) {
    if (
      node.src === pinnedAssetUrlForTest(baseUrl, buildRef, "ujg-daily-diligence.runtime.js") &&
      typeof node.onload === "function"
    ) {
      amdRegistry["_ujgDailyDiligenceRuntime"] = function() {};
      node.onload();
    }
  });
  await ctx.__ujgP;
});

test("concurrent missing-property resolution fetches and saves GitHub SHA once", async function() {
  var mod = require(MOD_PATH);
  var key = mod.UJG_DASHBOARD_RELEASE_REF_PROPERTY_KEY;
  var ghUrl = mod.UJG_GITHUB_MAIN_COMMIT_URL || mod.UJG_GITHUB_COMMITS_MAIN_URL;
  var baseUrl = "https://cdn.jsdelivr.net/gh/skivbox-ii/jira";
  var buildRef = "build-single-flight";
  var fetchedSha = "dddddddddddddddddddddddddddddddddddddddd";
  var out = mod.buildAssets({
    releaseRef: buildRef,
    assetBaseUrl: baseUrl,
    widgets: [mod.WIDGETS.dailyDiligence]
  });
  var bootstrapSrc = out["ujg-daily-diligence.bootstrap.js"];
  var appendedScripts = [];
  var appendedLinks = [];
  var amdRegistry = {};
  var defineCapture = null;
  var githubFetchCount = 0;

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

  var head = {
    appendChild: function(node) {
      if (node.tagName === "SCRIPT") {
        appendedScripts.push(node);
      } else if (node.tagName === "LINK") {
        appendedLinks.push(node);
      }
    }
  };

  var ctx = vm.createContext({
    define: defineShim,
    require: requireShim,
    document: {
      head: head,
      createElement: bootstrapTestCreateElement
    },
    window: {},
    globalThis: null,
    fetch: function(input) {
      if (String(input) === ghUrl) {
        githubFetchCount += 1;
        return Promise.resolve({
          ok: true,
          json: function() {
            return Promise.resolve({ sha: fetchedSha });
          },
          text: function() {
            return Promise.resolve("");
          }
        });
      }
      return Promise.reject(new Error("unexpected fetch URL: " + input));
    },
    queueMicrotask: queueMicrotask,
    Promise: Promise
  });
  ctx.globalThis = ctx.window;
  ctx.__ujgReadCount = 0;
  ctx.__ujgSaveCount = 0;
  ctx.__ujgBodyA = createMockGadgetBody();
  ctx.__ujgBodyB = createMockGadgetBody();

  vm.runInContext(bootstrapSrc, ctx);
  ctx.__bootstrapFactory = defineCapture.factory;
  ctx.__ujgKey = key;
  vm.runInContext(
    "__ujgCtor = __bootstrapFactory();" +
      '__ujgApi = {' +
      '  getDashboardProperty: function(k) {' +
      '    if (k !== __ujgKey) return Promise.reject(new Error("bad key"));' +
      "    __ujgReadCount = (__ujgReadCount || 0) + 1;" +
      "    return Promise.resolve(null);" +
      "  }," +
      '  setDashboardProperty: function(k, v) {' +
      '    if (k !== __ujgKey) return Promise.reject(new Error("bad key"));' +
      "    __ujgSaveCount = (__ujgSaveCount || 0) + 1;" +
      "    __ujgSavedVal = v;" +
      "    return Promise.resolve();" +
      "  }," +
      "  getGadget: function() { return { getBody: function() { return __ujgBodyA; } }; }" +
      "};" +
      "__ujgApiB = Object.assign({}, __ujgApi, { id: \"b\", getGadget: function() { return { getBody: function() { return __ujgBodyB; } }; } });" +
      "__ujgG1 = new __ujgCtor(__ujgApi);" +
      "__ujgG2 = new __ujgCtor(__ujgApiB);" +
      "__ujgP1 = __ujgG1.readyPromise;" +
      "__ujgP2 = __ujgG2.readyPromise;",
    ctx
  );

  var expectedCommon = pinnedAssetUrlForTest(baseUrl, fetchedSha, "_ujgCommon.js");
  for (var j = 0; j < 30; j++) {
    await new Promise(function(resolve) {
      queueMicrotask(resolve);
    });
    if (appendedScripts.some(function(node) { return node.src === expectedCommon; })) {
      break;
    }
  }

  assert.equal(ctx.__ujgReadCount, 1);
  assert.equal(githubFetchCount, 1);
  assert.equal(ctx.__ujgSaveCount, 1);
  assert.equal(ctx.__ujgSavedVal, fetchedSha);
  assert.equal(ctx.__ujgG1.releaseRef, fetchedSha);

  appendedScripts.forEach(function(node) {
    if (node.src === expectedCommon && typeof node.onload === "function") {
      node.onload();
    }
  });
  await new Promise(function(resolve) {
    queueMicrotask(resolve);
  });
  appendedLinks.forEach(function(node) {
    if (typeof node.onload === "function") {
      node.onload();
    }
  });
  appendedScripts.forEach(function(node) {
    if (
      node.src === pinnedAssetUrlForTest(baseUrl, fetchedSha, "ujg-daily-diligence.runtime.js") &&
      typeof node.onload === "function"
    ) {
      amdRegistry["_ujgDailyDiligenceRuntime"] = function Gadget(api) {
        this.api = api;
      };
      node.onload();
    }
  });

  await Promise.all([ctx.__ujgP1, ctx.__ujgP2]);
});

test("when property is missing and GitHub fetch is non-OK, instantiateWhenReady falls back to build-time releaseRef", async function() {
  var mod = require(MOD_PATH);
  var key = mod.UJG_DASHBOARD_RELEASE_REF_PROPERTY_KEY;
  var ghUrl = mod.UJG_GITHUB_MAIN_COMMIT_URL || mod.UJG_GITHUB_COMMITS_MAIN_URL;
  var baseUrl = "https://cdn.jsdelivr.net/gh/skivbox-ii/jira";
  var buildRef = "build-from-gh-fallback";
  var out = mod.buildAssets({
    releaseRef: buildRef,
    assetBaseUrl: baseUrl,
    widgets: [mod.WIDGETS.dailyDiligence]
  });
  var bootstrapSrc = out["ujg-daily-diligence.bootstrap.js"];
  var appendedScripts = [];
  var appendedLinks = [];
  var amdRegistry = {};
  var defineCapture = null;
  var githubFetchCount = 0;

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

  var head = {
    appendChild: function(node) {
      if (node.tagName === "SCRIPT") {
        appendedScripts.push(node);
      } else if (node.tagName === "LINK") {
        appendedLinks.push(node);
      }
    }
  };

  var ctx = vm.createContext({
    define: defineShim,
    require: requireShim,
    document: {
      head: head,
      createElement: bootstrapTestCreateElement
    },
    window: {},
    globalThis: null,
    fetch: function(input) {
      if (String(input) === ghUrl) {
        githubFetchCount += 1;
        return Promise.resolve({
          ok: false,
          status: 503,
          json: function() {
            return Promise.resolve({});
          },
          text: function() {
            return Promise.resolve("rate limited");
          }
        });
      }
      return Promise.reject(new Error("unexpected fetch URL: " + input));
    },
    queueMicrotask: queueMicrotask,
    Promise: Promise
  });
  ctx.globalThis = ctx.window;
  ctx.__ujgBody = createMockGadgetBody();

  vm.runInContext(bootstrapSrc, ctx);
  ctx.__bootstrapFactory = defineCapture.factory;
  ctx.__ujgKey = key;
  vm.runInContext(
    "__ujgCtor = __bootstrapFactory();" +
      '__ujgApi = {' +
      '  getDashboardProperty: function(k) {' +
      '    if (k !== __ujgKey) return Promise.reject(new Error("bad key"));' +
      "    return Promise.resolve(null);" +
      "  }," +
      '  setDashboardProperty: function() {' +
      "    __ujgSaveCount = (__ujgSaveCount || 0) + 1;" +
      "    return Promise.resolve();" +
      "  }," +
      "  getGadget: function() { return { getBody: function() { return __ujgBody; } }; }" +
      "};" +
      "__ujgG = new __ujgCtor(__ujgApi);" +
      "__ujgP = __ujgG.readyPromise;",
    ctx
  );

  var expectedCommon = pinnedAssetUrlForTest(baseUrl, buildRef, "_ujgCommon.js");
  for (var k = 0; k < 30; k++) {
    await new Promise(function(resolve) {
      queueMicrotask(resolve);
    });
    if (appendedScripts.some(function(node) { return node.src === expectedCommon; })) {
      break;
    }
  }

  assert.equal(githubFetchCount, 1);
  assert.equal(ctx.__ujgSaveCount || 0, 0);
  assert.equal(ctx.__ujgG.releaseRef, buildRef);
  assert.ok(
    appendedScripts.some(function(node) {
      return node.src === expectedCommon;
    })
  );

  appendedScripts.forEach(function(node) {
    if (node.src === expectedCommon && typeof node.onload === "function") {
      node.onload();
    }
  });
  await new Promise(function(resolve) {
    queueMicrotask(resolve);
  });
  appendedLinks.forEach(function(node) {
    if (typeof node.onload === "function") {
      node.onload();
    }
  });
  appendedScripts.forEach(function(node) {
    if (
      node.src === pinnedAssetUrlForTest(baseUrl, buildRef, "ujg-daily-diligence.runtime.js") &&
      typeof node.onload === "function"
    ) {
      amdRegistry["_ujgDailyDiligenceRuntime"] = function() {};
      node.onload();
    }
  });
  await ctx.__ujgP;
});

test("loadDashboardReleaseRef falls back to Jira REST when gadget API methods are absent", async function() {
  var mod = require(MOD_PATH);
  var key = mod.UJG_DASHBOARD_RELEASE_REF_PROPERTY_KEY;
  var gadget = instantiateDailyDiligenceGadget(mod, {
    fetch: function(input) {
      assert.match(String(input), /\/rest\/api\/2\/dashboard\/42\/properties\//);
      assert.ok(String(input).indexOf(encodeURIComponent(key)) !== -1);
      return Promise.resolve({
        ok: true,
        json: function() {
          return Promise.resolve({ value: "rest-prop-sha" });
        },
        text: function() {
          return Promise.resolve("");
        }
      });
    },
    window: {
      location: { search: "?selectPageId=42", origin: "https://jira.example.test" }
    }
  });
  assert.equal(await gadget.loadDashboardReleaseRef({}), "rest-prop-sha");
});

test("saveDashboardReleaseRef falls back to Jira REST PUT when gadget API methods are absent", async function() {
  var mod = require(MOD_PATH);
  var key = mod.UJG_DASHBOARD_RELEASE_REF_PROPERTY_KEY;
  var seenPut = null;
  var gadget = instantiateDailyDiligenceGadget(mod, {
    fetch: function(input, init) {
      var u = String(input);
      if (init && init.method === "PUT") {
        seenPut = { url: u, body: init.body, headers: init.headers };
        return Promise.resolve({ ok: true, text: function() { return Promise.resolve(""); } });
      }
      return Promise.reject(new Error("expected PUT"));
    },
    window: {
      location: { search: "?selectPageId=7", origin: "https://jira.example.test" }
    }
  });
  await gadget.saveDashboardReleaseRef({}, "to-save-sha");
  assert.ok(seenPut);
  assert.match(seenPut.url, /\/rest\/api\/2\/dashboard\/7\/properties\//);
  assert.ok(seenPut.url.indexOf(encodeURIComponent(key)) !== -1);
  assert.equal(seenPut.body, JSON.stringify({ value: "to-save-sha" }));
  assert.equal(seenPut.headers["X-Atlassian-Token"], "no-check");
});

test("bootstrap AMD factory returns a constructible gadget constructor", function() {
  var mod = require(MOD_PATH);
  var out = mod.buildAssets({
    releaseRef: "ctor-pin",
    assetBaseUrl: "https://cdn.jsdelivr.net/gh/skivbox-ii/jira",
    widgets: [mod.WIDGETS.dailyDiligence]
  });
  var bootstrapSrc = out["ujg-daily-diligence.bootstrap.js"];
  var defineCapture = null;
  function defineShim(name, deps, factory) {
    if (typeof deps === "function") {
      factory = deps;
      deps = [];
    }
    defineCapture = { name: name, factory: factory };
  }
  var ctx = vm.createContext({
    define: defineShim,
    require: function() {},
    document: {
      head: { appendChild: function() {} },
      createElement: bootstrapTestCreateElement
    },
    window: {},
    globalThis: null,
    queueMicrotask: queueMicrotask,
    Promise: Promise
  });
  ctx.globalThis = ctx.window;
  vm.runInContext(bootstrapSrc, ctx);
  var Ctor = defineCapture.factory();
  assert.equal(typeof Ctor, "function");
  ctx.__ujgBody = createMockGadgetBody();
  ctx.__ujgCtor = Ctor;
  vm.runInContext(
    "__ujgInst = new __ujgCtor({ __ujgBootstrapSkipAutoLoad: true, getGadget: function() { return { getBody: function() { return __ujgBody; } }; } });",
    ctx
  );
  assert.ok(ctx.__ujgInst instanceof Ctor);
});

test("gadget instance asset metadata is stored on own writable fields", function() {
  var mod = require(MOD_PATH);
  var gadget = instantiateDailyDiligenceGadget(mod);
  var desc = Object.getOwnPropertyDescriptor(gadget, "releaseRef");

  assert.equal(gadget.releaseRef, "pin-release");
  assert.ok(desc, "expected own releaseRef field on gadget instance");
  assert.equal(desc.get, undefined);
  assert.equal(desc.set, undefined);
  assert.equal(desc.writable, true);
});

test("gadget constructor renders shared version refresh control in gadget body", function() {
  var mod = require(MOD_PATH);
  var body = createMockGadgetBody();
  var out = mod.buildAssets({
    releaseRef: "ui-pin",
    assetBaseUrl: "https://cdn.jsdelivr.net/gh/skivbox-ii/jira",
    widgets: [mod.WIDGETS.dailyDiligence]
  });
  var defineCapture = null;
  function defineShim(name, deps, factory) {
    if (typeof deps === "function") {
      factory = deps;
      deps = [];
    }
    defineCapture = { name: name, factory: factory };
  }
  var ctx = vm.createContext({
    define: defineShim,
    require: function() {},
    document: {
      head: { appendChild: function() {} },
      createElement: bootstrapTestCreateElement
    },
    window: {},
    globalThis: null,
    queueMicrotask: queueMicrotask,
    Promise: Promise
  });
  ctx.globalThis = ctx.window;
  ctx.__ujgBody = body;
  vm.runInContext(out["ujg-daily-diligence.bootstrap.js"], ctx);
  var Ctor = defineCapture.factory();
  ctx.__ujgCtor = Ctor;
  vm.runInContext(
    "new __ujgCtor({ __ujgBootstrapSkipAutoLoad: true, getGadget: function() { return { getBody: function() { return __ujgBody; } }; } });",
    ctx
  );
  var btn = body.querySelector(".ujg-bootstrap-refresh");
  assert.ok(btn, "expected refresh button in gadget body");
  assert.match(String(btn.textContent || ""), /Обновить версию/);
  assert.ok(body.querySelector(".ujg-bootstrap-version"));
});

test("gadget constructor renders refresh control when getBody returns jQuery-like wrapper", function() {
  var mod = require(MOD_PATH);
  var body = createMockGadgetBody();
  var wrappedBody = wrapGadgetBodyAsJquery(body);
  var out = mod.buildAssets({
    releaseRef: "ui-pin",
    assetBaseUrl: "https://cdn.jsdelivr.net/gh/skivbox-ii/jira",
    widgets: [mod.WIDGETS.dailyDiligence]
  });
  var defineCapture = null;
  function defineShim(name, deps, factory) {
    if (typeof deps === "function") {
      factory = deps;
      deps = [];
    }
    defineCapture = { name: name, factory: factory };
  }
  var ctx = vm.createContext({
    define: defineShim,
    require: function() {},
    document: {
      head: { appendChild: function() {} },
      createElement: bootstrapTestCreateElement
    },
    window: {},
    globalThis: null,
    queueMicrotask: queueMicrotask,
    Promise: Promise
  });
  ctx.globalThis = ctx.window;
  ctx.__ujgBody = wrappedBody;
  vm.runInContext(out["ujg-daily-diligence.bootstrap.js"], ctx);
  var Ctor = defineCapture.factory();
  ctx.__ujgCtor = Ctor;
  vm.runInContext(
    "new __ujgCtor({ __ujgBootstrapSkipAutoLoad: true, getGadget: function() { return { getBody: function() { return __ujgBody; } }; } });",
    ctx
  );
  var btn = body.querySelector(".ujg-bootstrap-refresh");
  assert.ok(btn, "expected refresh button even with jQuery-like body wrapper");
  assert.ok(body.querySelector(".ujg-bootstrap-version"));
});

test("bootstrap restores refresh control after runtime clears a shared root content node", async function() {
  var mod = require(MOD_PATH);
  var baseUrl = "https://cdn.jsdelivr.net/gh/skivbox-ii/jira";
  var runtimeRef = "sharedrootref";
  var out = mod.buildAssets({
    releaseRef: "build-not-used",
    assetBaseUrl: baseUrl,
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
  var head = {
    appendChild: function(node) {
      if (node.tagName === "SCRIPT") {
        appendedScripts.push(node);
      } else if (node.tagName === "LINK") {
        appendedLinks.push(node);
      }
    }
  };
  var body = createMockGadgetBody();
  var content = createSharedContentCollectionForBody(body, "ujg-daily-diligence");
  var ctx = vm.createContext({
    define: defineShim,
    require: requireShim,
    document: { head: head, createElement: bootstrapTestCreateElement },
    window: {},
    globalThis: null,
    queueMicrotask: queueMicrotask,
    Promise: Promise
  });
  ctx.globalThis = ctx.window;
  ctx.__ujgBody = body;
  ctx.__ujgContent = content;
  vm.runInContext(bootstrapSrc, ctx);
  var Ctor = defineCapture.factory();
  ctx.__ujgCtor = Ctor;
  vm.runInContext(
    "__ujgApi = {" +
      "getDashboardProperty: function() { return Promise.resolve(" +
      JSON.stringify(runtimeRef) +
      "); }," +
      "getGadget: function() { return { getBody: function() { return __ujgBody; } }; }," +
      "getGadgetContentEl: function() { return __ujgContent; }" +
      "};" +
      "__ujgG = new __ujgCtor(__ujgApi);" +
      "__ujgReady = __ujgG.readyPromise;",
    ctx
  );

  var commonUrl = pinnedAssetUrlForTest(baseUrl, runtimeRef, "_ujgCommon.js");
  for (var waitCommon = 0; waitCommon < 40; waitCommon++) {
    await new Promise(function(r) {
      queueMicrotask(r);
    });
    if (appendedScripts.some(function(n) { return n.src === commonUrl; })) {
      break;
    }
  }
  appendedScripts.forEach(function(n) {
    if (n.src === commonUrl && typeof n.onload === "function") {
      n.onload();
    }
  });
  await new Promise(function(r) {
    queueMicrotask(r);
  });
  appendedLinks.forEach(function(n) {
    if (typeof n.onload === "function") {
      n.onload();
    }
  });
  var runtimeUrl = pinnedAssetUrlForTest(baseUrl, runtimeRef, "ujg-daily-diligence.runtime.js");
  appendedScripts.forEach(function(n) {
    if (n.src === runtimeUrl && typeof n.onload === "function") {
      amdRegistry["_ujgDailyDiligenceRuntime"] = function RuntimeGadget(api) {
        var sharedContent = api.getGadgetContentEl();
        if (sharedContent && typeof sharedContent.empty === "function") {
          sharedContent.empty();
        }
      };
      n.onload();
    }
  });
  await ctx.__ujgReady;

  assert.ok(
    body.querySelector(".ujg-bootstrap-refresh"),
    "expected refresh button to survive runtime clearing of shared root content"
  );
  assert.ok(body.querySelector(".ujg-bootstrap-version"));
});

test("version refresh with new SHA saves dashboard property and triggers page reload", async function() {
  var mod = require(MOD_PATH);
  var key = mod.UJG_DASHBOARD_RELEASE_REF_PROPERTY_KEY;
  var ghUrl = mod.UJG_GITHUB_MAIN_COMMIT_URL || mod.UJG_GITHUB_COMMITS_MAIN_URL;
  var baseUrl = "https://cdn.jsdelivr.net/gh/skivbox-ii/jira";
  var pinRef = "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
  var newSha = "ffffffffffffffffffffffffffffffffffffffff";
  var out = mod.buildAssets({
    releaseRef: "build-not-used",
    assetBaseUrl: baseUrl,
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
  var head = {
    appendChild: function(node) {
      if (node.tagName === "SCRIPT") {
        appendedScripts.push(node);
      } else if (node.tagName === "LINK") {
        appendedLinks.push(node);
      }
    }
  };
  var saveLog = [];
  var reloadCount = 0;
  var windowShim = {
    location: {
      reload: function() {
        reloadCount += 1;
      }
    }
  };
  var ctx = vm.createContext({
    define: defineShim,
    require: requireShim,
    document: { head: head, createElement: bootstrapTestCreateElement },
    window: windowShim,
    globalThis: null,
    fetch: function(input) {
      if (String(input) === ghUrl) {
        return Promise.resolve({
          ok: true,
          json: function() {
            return Promise.resolve({ sha: newSha });
          },
          text: function() {
            return Promise.resolve("");
          }
        });
      }
      return Promise.reject(new Error("unexpected fetch: " + input));
    },
    queueMicrotask: queueMicrotask,
    Promise: Promise
  });
  ctx.globalThis = ctx.window;
  ctx.__ujgBody = createMockGadgetBody();
  ctx.__ujgKey = key;
  ctx.__ujgSaveLog = saveLog;
  vm.runInContext(bootstrapSrc, ctx);
  var Ctor = defineCapture.factory();
  ctx.__ujgCtor = Ctor;
  vm.runInContext(
    "__ujgApi = {" +
      "getDashboardProperty: function(k) { if (k !== __ujgKey) return Promise.reject(new Error(\"bad key\")); return Promise.resolve(" +
      JSON.stringify(pinRef) +
      "); }," +
      "setDashboardProperty: function(k, v) { if (k !== __ujgKey) return Promise.reject(new Error(\"bad key\")); __ujgSaveLog.push({ k: k, v: v }); return Promise.resolve(); }," +
      "getGadget: function() { return { getBody: function() { return __ujgBody; } }; }" +
      "};" +
      "__ujgG = new __ujgCtor(__ujgApi);" +
      "__ujgReady = __ujgG.readyPromise;",
    ctx
  );

  function flushCommonOnload() {
    var commonUrl = pinnedAssetUrlForTest(baseUrl, pinRef, "_ujgCommon.js");
    appendedScripts
      .filter(function(n) {
        return n.src === commonUrl;
      })
      .forEach(function(n) {
        if (typeof n.onload === "function") {
          n.onload();
        }
      });
  }

  for (var w = 0; w < 40; w++) {
    await new Promise(function(r) {
      queueMicrotask(r);
    });
    if (appendedScripts.some(function(n) { return n.src.indexOf(encodeURIComponent(pinRef)) !== -1; })) {
      break;
    }
  }
  flushCommonOnload();
  await new Promise(function(r) {
    queueMicrotask(r);
  });
  appendedLinks.forEach(function(n) {
    if (typeof n.onload === "function") {
      n.onload();
    }
  });
  var rtPin = pinnedAssetUrlForTest(baseUrl, pinRef, "ujg-daily-diligence.runtime.js");
  appendedScripts.forEach(function(n) {
    if (n.src === rtPin && typeof n.onload === "function") {
      amdRegistry["_ujgDailyDiligenceRuntime"] = function Gadget(api) {
        this.api = api;
      };
      n.onload();
    }
  });
  await ctx.__ujgReady;

  var btn = ctx.__ujgBody.querySelector(".ujg-bootstrap-refresh");
  assert.ok(btn);
  var scriptsBeforeRefresh = appendedScripts.length;
  var linksBeforeRefresh = appendedLinks.length;
  btn.click();
  for (var r = 0; r < 60 && (saveLog.length === 0 || reloadCount === 0); r++) {
    await new Promise(function(x) {
      queueMicrotask(x);
    });
  }
  assert.equal(saveLog.length, 1);
  assert.equal(saveLog[0].k, key);
  assert.equal(saveLog[0].v, newSha);
  assert.equal(reloadCount, 1, "expected page reload after saving new SHA");
  assert.equal(appendedScripts.length, scriptsBeforeRefresh);
  assert.equal(appendedLinks.length, linksBeforeRefresh);
});

test("version refresh with new SHA does not reload when dashboard property save fails", async function() {
  var mod = require(MOD_PATH);
  var key = mod.UJG_DASHBOARD_RELEASE_REF_PROPERTY_KEY;
  var ghUrl = mod.UJG_GITHUB_MAIN_COMMIT_URL || mod.UJG_GITHUB_COMMITS_MAIN_URL;
  var baseUrl = "https://cdn.jsdelivr.net/gh/skivbox-ii/jira";
  var pinRef = "1212121212121212121212121212121212121212";
  var newSha = "3434343434343434343434343434343434343434";
  var out = mod.buildAssets({
    releaseRef: "build-not-used",
    assetBaseUrl: baseUrl,
    widgets: [mod.WIDGETS.dailyDiligence]
  });
  var bootstrapSrc = out["ujg-daily-diligence.bootstrap.js"];
  var appendedScripts = [];
  var appendedLinks = [];
  var amdRegistry = {};
  var defineCapture = null;
  var saveAttempts = 0;
  var reloadCount = 0;

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

  var head = {
    appendChild: function(node) {
      if (node.tagName === "SCRIPT") {
        appendedScripts.push(node);
      } else if (node.tagName === "LINK") {
        appendedLinks.push(node);
      }
    }
  };

  var consoleErrors = [];
  var ctx = vm.createContext({
    define: defineShim,
    require: requireShim,
    document: { head: head, createElement: bootstrapTestCreateElement },
    window: {
      location: {
        reload: function() {
          reloadCount += 1;
        }
      }
    },
    globalThis: null,
    console: {
      error: function() {
        consoleErrors.push(Array.prototype.slice.call(arguments));
      }
    },
    fetch: function(input) {
      if (String(input) === ghUrl) {
        return Promise.resolve({
          ok: true,
          json: function() {
            return Promise.resolve({ sha: newSha });
          },
          text: function() {
            return Promise.resolve("");
          }
        });
      }
      return Promise.reject(new Error("unexpected fetch: " + input));
    },
    queueMicrotask: queueMicrotask,
    Promise: Promise
  });
  ctx.globalThis = ctx.window;
  ctx.__ujgBody = createMockGadgetBody();
  ctx.__ujgKey = key;
  ctx.__ujgSaveAttempts = 0;
  vm.runInContext(bootstrapSrc, ctx);
  var Ctor = defineCapture.factory();
  ctx.__ujgCtor = Ctor;
  vm.runInContext(
    "__ujgApi = {" +
      "getDashboardProperty: function(k) { if (k !== __ujgKey) return Promise.reject(new Error(\"bad key\")); return Promise.resolve(" +
      JSON.stringify(pinRef) +
      "); }," +
      "setDashboardProperty: function(k, v) { if (k !== __ujgKey) return Promise.reject(new Error(\"bad key\")); __ujgSaveAttempts += 1; return Promise.reject(new Error(\"save failed\")); }," +
      "getGadget: function() { return { getBody: function() { return __ujgBody; } }; }" +
      "};" +
      "__ujgG = new __ujgCtor(__ujgApi);" +
      "__ujgReady = __ujgG.readyPromise;",
    ctx
  );

  for (var warm = 0; warm < 40; warm++) {
    await new Promise(function(resolve) {
      queueMicrotask(resolve);
    });
    if (appendedScripts.some(function(n) { return n.src.indexOf(encodeURIComponent(pinRef)) !== -1; })) {
      break;
    }
  }
  appendedScripts.forEach(function(n) {
    if (
      n.src === pinnedAssetUrlForTest(baseUrl, pinRef, "_ujgCommon.js") &&
      typeof n.onload === "function"
    ) {
      n.onload();
    }
  });
  await new Promise(function(resolve) {
    queueMicrotask(resolve);
  });
  appendedLinks.forEach(function(n) {
    if (typeof n.onload === "function") {
      n.onload();
    }
  });
  appendedScripts.forEach(function(n) {
    if (
      n.src === pinnedAssetUrlForTest(baseUrl, pinRef, "ujg-daily-diligence.runtime.js") &&
      typeof n.onload === "function"
    ) {
      amdRegistry["_ujgDailyDiligenceRuntime"] = function() {};
      n.onload();
    }
  });
  await ctx.__ujgReady;

  var btn = ctx.__ujgBody.querySelector(".ujg-bootstrap-refresh");
  assert.ok(btn);
  btn.click();
  for (var i = 0; i < 40; i++) {
    await new Promise(function(resolve) {
      queueMicrotask(resolve);
    });
  }

  saveAttempts = ctx.__ujgSaveAttempts || 0;
  assert.equal(saveAttempts, 1, "refresh should still attempt to save new SHA");
  assert.equal(reloadCount, 0, "page reload must not run when dashboard property save fails");
  assert.ok(
    consoleErrors.some(function(args) {
      return String(args[0]).indexOf("UJG bootstrap: refresh failed") !== -1;
    }),
    "save failure should be logged"
  );
});

test("version refresh when GitHub SHA matches current ref does not save or reload", async function() {
  var mod = require(MOD_PATH);
  var key = mod.UJG_DASHBOARD_RELEASE_REF_PROPERTY_KEY;
  var ghUrl = mod.UJG_GITHUB_MAIN_COMMIT_URL || mod.UJG_GITHUB_COMMITS_MAIN_URL;
  var baseUrl = "https://cdn.jsdelivr.net/gh/skivbox-ii/jira";
  var sameSha = "9999999999999999999999999999999999999999";
  var out = mod.buildAssets({
    releaseRef: "ignored",
    assetBaseUrl: baseUrl,
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
  var head = {
    appendChild: function(node) {
      if (node.tagName === "SCRIPT") {
        appendedScripts.push(node);
      } else if (node.tagName === "LINK") {
        appendedLinks.push(node);
      }
    }
  };
  var saveLog = [];
  var reloadCount = 0;
  var windowShim = {
    location: {
      reload: function() {
        reloadCount += 1;
      }
    }
  };
  var ctx = vm.createContext({
    define: defineShim,
    require: requireShim,
    document: { head: head, createElement: bootstrapTestCreateElement },
    window: windowShim,
    globalThis: null,
    fetch: function(input) {
      if (String(input) === ghUrl) {
        return Promise.resolve({
          ok: true,
          json: function() {
            return Promise.resolve({ sha: sameSha });
          },
          text: function() {
            return Promise.resolve("");
          }
        });
      }
      return Promise.reject(new Error("unexpected fetch: " + input));
    },
    queueMicrotask: queueMicrotask,
    Promise: Promise
  });
  ctx.globalThis = ctx.window;
  ctx.__ujgBody = createMockGadgetBody();
  ctx.__ujgKey = key;
  ctx.__ujgSaveLog = saveLog;
  vm.runInContext(bootstrapSrc, ctx);
  var Ctor = defineCapture.factory();
  ctx.__ujgCtor = Ctor;
  vm.runInContext(
    "__ujgApi = {" +
      "getDashboardProperty: function(k) { if (k !== __ujgKey) return Promise.reject(new Error(\"bad key\")); return Promise.resolve(" +
      JSON.stringify(sameSha) +
      "); }," +
      "setDashboardProperty: function(k, v) { if (k !== __ujgKey) return Promise.reject(new Error(\"bad key\")); __ujgSaveLog.push({ k: k, v: v }); return Promise.resolve(); }," +
      "getGadget: function() { return { getBody: function() { return __ujgBody; } }; }" +
      "};" +
      "__ujgG = new __ujgCtor(__ujgApi);" +
      "__ujgReady = __ujgG.readyPromise;",
    ctx
  );

  var commonUrl = pinnedAssetUrlForTest(baseUrl, sameSha, "_ujgCommon.js");
  for (var w = 0; w < 40; w++) {
    await new Promise(function(r) {
      queueMicrotask(r);
    });
    if (appendedScripts.some(function(n) { return n.src === commonUrl; })) {
      break;
    }
  }
  appendedScripts
    .filter(function(n) {
      return n.src === commonUrl;
    })
    .forEach(function(n) {
      if (typeof n.onload === "function") {
        n.onload();
      }
    });
  await new Promise(function(r) {
    queueMicrotask(r);
  });
  appendedLinks.forEach(function(n) {
    if (typeof n.onload === "function") {
      n.onload();
    }
  });
  var rtUrl = pinnedAssetUrlForTest(baseUrl, sameSha, "ujg-daily-diligence.runtime.js");
  appendedScripts.forEach(function(n) {
    if (n.src === rtUrl && typeof n.onload === "function") {
      amdRegistry["_ujgDailyDiligenceRuntime"] = function() {};
      n.onload();
    }
  });
  await ctx.__ujgReady;

  var scriptsBefore = appendedScripts.length;
  var linksBefore = appendedLinks.length;
  var btn = ctx.__ujgBody.querySelector(".ujg-bootstrap-refresh");
  assert.ok(btn);
  btn.click();
  for (var i = 0; i < 40; i++) {
    await new Promise(function(x) {
      queueMicrotask(x);
    });
  }
  assert.equal(saveLog.length, 0, "setDashboardProperty must not run when SHA unchanged");
  assert.equal(reloadCount, 0, "page reload must not run when SHA is unchanged");
  assert.equal(appendedScripts.length, scriptsBefore);
  assert.equal(appendedLinks.length, linksBefore);
});

test("early refresh click waits for startup releaseRef resolution before deciding no-op", async function(t) {
  var mod = require(MOD_PATH);
  var key = mod.UJG_DASHBOARD_RELEASE_REF_PROPERTY_KEY;
  var ghUrl = mod.UJG_GITHUB_MAIN_COMMIT_URL || mod.UJG_GITHUB_COMMITS_MAIN_URL;
  var baseUrl = "https://cdn.jsdelivr.net/gh/skivbox-ii/jira";
  var buildRef = "build-stale-ref";
  var currentRef = "abababababababababababababababababababab";
  var out = mod.buildAssets({
    releaseRef: buildRef,
    assetBaseUrl: baseUrl,
    widgets: [mod.WIDGETS.dailyDiligence]
  });
  var bootstrapSrc = out["ujg-daily-diligence.bootstrap.js"];
  var appendedScripts = [];
  var appendedLinks = [];
  var amdRegistry = {};
  var defineCapture = null;
  var propertyDeferred = createDeferred();
  var saveLog = [];
  var reloadCount = 0;
  t.after(function() {
    propertyDeferred.resolve(currentRef);
  });

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

  var head = {
    appendChild: function(node) {
      if (node.tagName === "SCRIPT") {
        appendedScripts.push(node);
      } else if (node.tagName === "LINK") {
        appendedLinks.push(node);
      }
    }
  };

  var ctx = vm.createContext({
    define: defineShim,
    require: requireShim,
    document: { head: head, createElement: bootstrapTestCreateElement },
    window: {
      location: {
        reload: function() {
          reloadCount += 1;
        }
      }
    },
    globalThis: null,
    fetch: function(input) {
      if (String(input) === ghUrl) {
        return Promise.resolve({
          ok: true,
          json: function() {
            return Promise.resolve({ sha: currentRef });
          },
          text: function() {
            return Promise.resolve("");
          }
        });
      }
      return Promise.reject(new Error("unexpected fetch: " + input));
    },
    queueMicrotask: queueMicrotask,
    Promise: Promise
  });
  ctx.globalThis = ctx.window;
  ctx.__ujgBody = createMockGadgetBody();
  ctx.__ujgKey = key;
  ctx.__ujgSaveLog = saveLog;
  ctx.__ujgPropertyPromise = propertyDeferred.promise;

  vm.runInContext(bootstrapSrc, ctx);
  var Ctor = defineCapture.factory();
  ctx.__ujgCtor = Ctor;
  vm.runInContext(
    "__ujgApi = {" +
      "getDashboardProperty: function(k) { if (k !== __ujgKey) return Promise.reject(new Error(\"bad key\")); return __ujgPropertyPromise; }," +
      "setDashboardProperty: function(k, v) { if (k !== __ujgKey) return Promise.reject(new Error(\"bad key\")); __ujgSaveLog.push({ k: k, v: v }); return Promise.resolve(); }," +
      "getGadget: function() { return { getBody: function() { return __ujgBody; } }; }" +
      "};" +
      "__ujgG = new __ujgCtor(__ujgApi);" +
      "__ujgReady = __ujgG.readyPromise;",
    ctx
  );

  var btn = ctx.__ujgBody.querySelector(".ujg-bootstrap-refresh");
  assert.ok(btn);
  btn.click();

  var saveBeforeResolve = 0;
  var reloadBeforeResolve = 0;
  for (var i = 0; i < 10; i++) {
    await new Promise(function(resolve) {
      queueMicrotask(resolve);
    });
  }
  saveBeforeResolve = saveLog.length;
  reloadBeforeResolve = reloadCount;

  propertyDeferred.resolve(currentRef);
  for (var j = 0; j < 20; j++) {
    await new Promise(function(resolve) {
      queueMicrotask(resolve);
    });
  }

  assert.equal(saveLog.length, 0, "refresh must no-op when latest SHA equals resolved current releaseRef");
  assert.equal(reloadCount, 0, "refresh must not reload when latest SHA equals resolved current releaseRef");

  var commonUrl = pinnedAssetUrlForTest(baseUrl, currentRef, "_ujgCommon.js");
  for (var warm = 0; warm < 40; warm++) {
    await new Promise(function(resolve) {
      queueMicrotask(resolve);
    });
    if (appendedScripts.some(function(n) { return n.src === commonUrl; })) {
      break;
    }
  }
  appendedScripts
    .filter(function(n) {
      return n.src === commonUrl;
    })
    .forEach(function(n) {
      if (typeof n.onload === "function") {
        n.onload();
      }
    });
  await new Promise(function(resolve) {
    queueMicrotask(resolve);
  });
  appendedLinks.forEach(function(n) {
    if (typeof n.onload === "function") {
      n.onload();
    }
  });
  appendedScripts.forEach(function(n) {
    if (
      n.src === pinnedAssetUrlForTest(baseUrl, currentRef, "ujg-daily-diligence.runtime.js") &&
      typeof n.onload === "function"
    ) {
      amdRegistry["_ujgDailyDiligenceRuntime"] = function() {};
      n.onload();
    }
  });
  await ctx.__ujgReady;

  assert.equal(saveBeforeResolve, 0, "refresh must not save before current releaseRef resolves");
  assert.equal(reloadBeforeResolve, 0, "refresh must not reload before current releaseRef resolves");
  assert.equal(saveLog.length, 0, "refresh must no-op when latest SHA equals resolved current releaseRef");
  assert.equal(reloadCount, 0, "refresh must not reload when latest SHA equals resolved current releaseRef");
});

test("refresh click is single-flight while an earlier refresh is still in progress", async function(t) {
  var mod = require(MOD_PATH);
  var key = mod.UJG_DASHBOARD_RELEASE_REF_PROPERTY_KEY;
  var ghUrl = mod.UJG_GITHUB_MAIN_COMMIT_URL || mod.UJG_GITHUB_COMMITS_MAIN_URL;
  var baseUrl = "https://cdn.jsdelivr.net/gh/skivbox-ii/jira";
  var currentRef = "cdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd";
  var newSha = "efefefefefefefefefefefefefefefefefefefef";
  var out = mod.buildAssets({
    releaseRef: "build-unused",
    assetBaseUrl: baseUrl,
    widgets: [mod.WIDGETS.dailyDiligence]
  });
  var bootstrapSrc = out["ujg-daily-diligence.bootstrap.js"];
  var appendedScripts = [];
  var appendedLinks = [];
  var amdRegistry = {};
  var defineCapture = null;
  var fetchDeferred = createDeferred();
  var fetchCount = 0;
  var saveLog = [];
  var reloadCount = 0;
  t.after(function() {
    fetchDeferred.resolve({
      ok: true,
      json: function() {
        return Promise.resolve({ sha: newSha });
      },
      text: function() {
        return Promise.resolve("");
      }
    });
  });

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

  var head = {
    appendChild: function(node) {
      if (node.tagName === "SCRIPT") {
        appendedScripts.push(node);
      } else if (node.tagName === "LINK") {
        appendedLinks.push(node);
      }
    }
  };

  var ctx = vm.createContext({
    define: defineShim,
    require: requireShim,
    document: { head: head, createElement: bootstrapTestCreateElement },
    window: {
      location: {
        reload: function() {
          reloadCount += 1;
        }
      }
    },
    globalThis: null,
    fetch: function(input) {
      if (String(input) === ghUrl) {
        fetchCount += 1;
        return fetchDeferred.promise;
      }
      return Promise.reject(new Error("unexpected fetch: " + input));
    },
    queueMicrotask: queueMicrotask,
    Promise: Promise
  });
  ctx.globalThis = ctx.window;
  ctx.__ujgBody = createMockGadgetBody();
  ctx.__ujgKey = key;
  ctx.__ujgSaveLog = saveLog;

  vm.runInContext(bootstrapSrc, ctx);
  var Ctor = defineCapture.factory();
  ctx.__ujgCtor = Ctor;
  vm.runInContext(
    "__ujgApi = {" +
      "getDashboardProperty: function(k) { if (k !== __ujgKey) return Promise.reject(new Error(\"bad key\")); return Promise.resolve(" +
      JSON.stringify(currentRef) +
      "); }," +
      "setDashboardProperty: function(k, v) { if (k !== __ujgKey) return Promise.reject(new Error(\"bad key\")); __ujgSaveLog.push({ k: k, v: v }); return Promise.resolve(); }," +
      "getGadget: function() { return { getBody: function() { return __ujgBody; } }; }" +
      "};" +
      "__ujgG = new __ujgCtor(__ujgApi);" +
      "__ujgReady = __ujgG.readyPromise;",
    ctx
  );

  var commonUrl = pinnedAssetUrlForTest(baseUrl, currentRef, "_ujgCommon.js");
  for (var warm = 0; warm < 40; warm++) {
    await new Promise(function(resolve) {
      queueMicrotask(resolve);
    });
    if (appendedScripts.some(function(n) { return n.src === commonUrl; })) {
      break;
    }
  }
  appendedScripts
    .filter(function(n) {
      return n.src === commonUrl;
    })
    .forEach(function(n) {
      if (typeof n.onload === "function") {
        n.onload();
      }
    });
  await new Promise(function(resolve) {
    queueMicrotask(resolve);
  });
  var rtUrl = pinnedAssetUrlForTest(baseUrl, currentRef, "ujg-daily-diligence.runtime.js");
  for (var warmRt = 0; warmRt < 40; warmRt++) {
    await new Promise(function(resolve) {
      queueMicrotask(resolve);
    });
    if (appendedScripts.some(function(n) { return n.src === rtUrl; })) {
      break;
    }
  }
  appendedLinks.forEach(function(n) {
    if (typeof n.onload === "function") {
      n.onload();
    }
  });
  appendedScripts.forEach(function(n) {
    if (
      n.src === rtUrl &&
      typeof n.onload === "function"
    ) {
      amdRegistry["_ujgDailyDiligenceRuntime"] = function() {};
      n.onload();
    }
  });
  await ctx.__ujgReady;

  var btn = ctx.__ujgBody.querySelector(".ujg-bootstrap-refresh");
  assert.ok(btn);
  btn.click();
  btn.click();

  var fetchCountWhileInFlight = 0;
  var saveWhileInFlight = 0;
  var reloadWhileInFlight = 0;
  for (var k = 0; k < 10; k++) {
    await new Promise(function(resolve) {
      queueMicrotask(resolve);
    });
  }
  fetchCountWhileInFlight = fetchCount;
  saveWhileInFlight = saveLog.length;
  reloadWhileInFlight = reloadCount;

  fetchDeferred.resolve({
    ok: true,
    json: function() {
      return Promise.resolve({ sha: newSha });
    },
    text: function() {
      return Promise.resolve("");
    }
  });

  for (var m = 0; m < 20 && (saveLog.length === 0 || reloadCount === 0); m++) {
    await new Promise(function(resolve) {
      queueMicrotask(resolve);
    });
  }

  assert.equal(saveLog.length, 1, "refresh save must be single-flight");
  assert.equal(saveLog[0].k, key);
  assert.equal(saveLog[0].v, newSha);
  assert.equal(fetchCountWhileInFlight, 1, "refresh must not start a second in-flight fetch");
  assert.equal(saveWhileInFlight, 0);
  assert.equal(reloadWhileInFlight, 0);
  assert.equal(reloadCount, 1, "refresh reload must be single-flight");
});
