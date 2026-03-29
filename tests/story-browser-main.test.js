const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const loadAmdModule = require("./helpers/load-amd-module");

const MODULE_DIR = path.join(__dirname, "..", "ujg-story-browser-modules");

function mockWindow() {
  return {
    location: { origin: "https://jira.example.com", protocol: "https:" },
    AJS: { params: { baseURL: "" } }
  };
}

function loadConfig(windowImpl) {
  return loadAmdModule(path.join(MODULE_DIR, "config.js"), {}, windowImpl ? { window: windowImpl } : {});
}

function loadUtils(windowImpl) {
  const config = loadConfig(windowImpl);
  return loadAmdModule(path.join(MODULE_DIR, "utils.js"), {
    _ujgSB_config: config
  });
}

function createLocalStorageMock() {
  const store = Object.create(null);
  return {
    getItem: function(k) {
      return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null;
    },
    setItem: function(k, v) {
      store[k] = String(v);
    }
  };
}

function createDeferred() {
  var state = "pending";
  var settledArgs = [];
  var doneHandlers = [];
  var failHandlers = [];
  var deferred = {
    resolve: function() {
      if (state !== "pending") return deferred;
      state = "resolved";
      settledArgs = Array.prototype.slice.call(arguments);
      doneHandlers.slice().forEach(function(handler) {
        handler.apply(null, settledArgs);
      });
      return deferred;
    },
    reject: function() {
      if (state !== "pending") return deferred;
      state = "rejected";
      settledArgs = Array.prototype.slice.call(arguments);
      failHandlers.slice().forEach(function(handler) {
        handler.apply(null, settledArgs);
      });
      return deferred;
    },
    then: function(onFulfilled, onRejected) {
      return new Promise(function(resolve, reject) {
        deferred.done(function() {
          try {
            resolve(onFulfilled ? onFulfilled.apply(null, arguments) : arguments[0]);
          } catch (err) {
            reject(err);
          }
        });
        deferred.fail(function() {
          if (!onRejected) {
            reject(arguments[0]);
            return;
          }
          try {
            resolve(onRejected.apply(null, arguments));
          } catch (err) {
            reject(err);
          }
        });
      });
    },
    done: function(handler) {
      if (state === "resolved") {
        handler.apply(null, settledArgs);
      } else if (state === "pending") {
        doneHandlers.push(handler);
      }
      return deferred;
    },
    fail: function(handler) {
      if (state === "rejected") {
        handler.apply(null, settledArgs);
      } else if (state === "pending") {
        failHandlers.push(handler);
      }
      return deferred;
    },
    promise: function() {
      return deferred;
    }
  };
  return deferred;
}

function loadStorage(localStorageImpl, windowImpl) {
  const config = loadConfig(windowImpl);
  return loadAmdModule(
    path.join(MODULE_DIR, "storage.js"),
    { _ujgSB_config: config },
    localStorageImpl ? { localStorage: localStorageImpl } : {}
  );
}

function loadData(windowImpl) {
  const config = loadConfig(windowImpl);
  const utils = loadUtils(windowImpl);
  return loadAmdModule(path.join(MODULE_DIR, "data.js"), {
    _ujgSB_config: config,
    _ujgSB_utils: utils
  });
}

function createEmptyCollection() {
  return {
    length: 0,
    hasClass: function() {
      return false;
    },
    removeAttr: function() {},
    append: function() {},
    find: function() {
      return createEmptyCollection();
    }
  };
}

function createElement(className) {
  return {
    length: 1,
    className: className || "",
    attrs: {},
    children: [],
    hasClass: function(name) {
      return this.className.split(/\s+/).indexOf(name) !== -1;
    },
    removeAttr: function(name) {
      delete this.attrs[name];
    },
    append: function(child) {
      this.children.push(child);
    },
    find: function(selector) {
      var i;
      if (selector !== ".ujg-story-browser") {
        return createEmptyCollection();
      }
      for (i = 0; i < this.children.length; i += 1) {
        if (this.children[i].hasClass("ujg-story-browser")) {
          return this.children[i];
        }
      }
      return createEmptyCollection();
    }
  };
}

function createJQuery() {
  return function(html) {
    if (html === '<div class="ujg-story-browser"></div>') {
      return createElement("ujg-story-browser");
    }
    throw new Error("Unexpected jQuery call: " + html);
  };
}

function withMockedConsoleError(run) {
  var original = console.error;
  var messages = [];

  console.error = function() {
    messages.push(Array.prototype.join.call(arguments, " "));
  };

  try {
    run(messages);
  } finally {
    console.error = original;
  }
}

function resolved(value) {
  return {
    then: function(onFulfilled, onRejected) {
      try {
        var out = onFulfilled ? onFulfilled(value) : value;
        return resolvedThenable(out);
      } catch (e) {
        return rejected(e);
      }
    }
  };
}

function rejected(reason) {
  return {
    then: function(onFulfilled, onRejected) {
      if (onRejected) {
        try {
          var out = onRejected(reason);
          return resolvedThenable(out);
        } catch (e) {
          return rejected(e);
        }
      }
      return rejected(reason);
    }
  };
}

function resolvedThenable(x) {
  if (x && typeof x.then === "function") {
    return x;
  }
  return resolved(x);
}

function nextTurn() {
  return new Promise(function(resolve) {
    setImmediate(resolve);
  });
}

async function flushTurns(count) {
  var left = count;
  while (left > 0) {
    await nextTurn();
    left -= 1;
  }
}

function makeIssue(key, typeName, extraFields) {
  return {
    key: key,
    fields: Object.assign({
      summary: key + " summary",
      status: { name: "Open", statusCategory: { name: "To Do", key: "new" } },
      issuetype: { name: typeName },
      priority: { name: "Medium" },
      assignee: null,
      timetracking: {},
      components: [],
      labels: [],
      fixVersions: [],
      parent: null,
      issuelinks: [],
      created: "2026-01-01",
      updated: "2026-01-02",
      customfield_10014: null,
      customfield_10020: null
    }, extraFields || {})
  };
}

function loadMain(deps) {
  return loadAmdModule(path.join(MODULE_DIR, "main.js"), {
    jquery: deps.jquery,
    _ujgSB_config: deps.config,
    _ujgSB_utils: deps.utils,
    _ujgSB_storage: deps.storage,
    _ujgSB_api: deps.api,
    _ujgSB_data: deps.data,
    _ujgSB_rendering: deps.rendering,
    "_ujgSB_create-story": deps.createStory
  });
}

function baseDeps(overrides) {
  var win = mockWindow();
  var config = loadConfig(win);
  var utils = loadUtils(win);
  var ls = createLocalStorageMock();
  var storage = loadStorage(ls, win);
  var data = loadData(win);
  var rendering = {
    initCalls: [],
    init: function($c, svc) {
      rendering.initCalls.push({ container: $c, services: svc });
    },
    renderHeader: function() {
      rendering.headerCalls += 1;
    },
    renderTree: function(tree, viewMode, expanded) {
      rendering.treeCalls.push({
        tree: tree,
        viewMode: viewMode,
        expanded: expanded
      });
    },
    renderProgress: function(loaded, total) {
      rendering.progressCalls.push({ loaded: loaded, total: total });
    },
    renderCreateStoryModalCalls: [],
    renderCreateStoryModal: function(draft) {
      rendering.renderCreateStoryModalCalls.push(draft);
    },
    clearCreateStoryModalCalls: 0,
    clearCreateStoryModal: function() {
      rendering.clearCreateStoryModalCalls += 1;
    },
    headerCalls: 0,
    treeCalls: [],
    progressCalls: []
  };
  var createStory = {
    makeDefaultDraftCalls: [],
    makeDefaultDraft: function(projectKey) {
      createStory.makeDefaultDraftCalls.push(projectKey);
      return {
        projectKey: projectKey != null ? String(projectKey) : "",
        mode: "draft",
        epicMode: "existingEpic",
        existingEpicKey: "P1-EP",
        story: { summary: "S", errors: [], assignee: null, components: [], labels: [] },
        children: [],
        ui: { formErrors: [] },
        _fromTest: true
      };
    },
    validateDraft: function() {},
    hasSubmitValidationErrors: function() {
      return false;
    },
    submitCreateDraft: function() {
      return resolved({ ok: true });
    }
  };
  var api = {
    getProjects: function() {
      return resolved([{ key: "P1", name: "Project 1" }]);
    },
    getProjectIssues: function(projectKey, onProgress) {
      if (onProgress) {
        onProgress(1, 1);
      }
      return resolved([
        {
          key: "S1",
          fields: {
            summary: "Story one",
            status: { name: "Open", statusCategory: { name: "To Do" } },
            issuetype: { name: "Story" },
            priority: { name: "Medium" },
            assignee: null,
            timetracking: {},
            components: [],
            labels: [],
            fixVersions: [],
            parent: null,
            created: "2026-01-01",
            updated: "2026-01-02",
            customfield_10014: null,
            customfield_10020: null
          }
        }
      ]);
    }
  };
  var out = {
    win: win,
    config: config,
    utils: utils,
    ls: ls,
    storage: storage,
    data: data,
    rendering: rendering,
    createStory: createStory,
    api: api,
    jquery: createJQuery()
  };
  if (overrides) {
    Object.keys(overrides).forEach(function(k) {
      out[k] = overrides[k];
    });
  }
  return out;
}

test("story browser main reuses .ujg-story-browser child when present", function() {
  var d = baseDeps();
  var Gadget = loadMain(d);
  var inner = createElement("ujg-story-browser");
  var content = createElement("page-shell");
  content.append(inner);

  new Gadget({
    getGadgetContentEl: function() {
      return content;
    }
  });

  assert.equal(content.children.length, 1);
  assert.strictEqual(d.rendering.initCalls[0].container, inner);
});

test("story browser main appends widget container when wrapper is plain", function() {
  var d = baseDeps();
  var Gadget = loadMain(d);
  var content = createElement("page-shell");

  new Gadget({
    getGadgetContentEl: function() {
      return content;
    }
  });

  assert.equal(content.children.length, 1);
  assert.equal(content.children[0].hasClass("ujg-story-browser"), true);
  assert.strictEqual(d.rendering.initCalls[0].container, content.children[0]);
});

test("story browser main logs and stops when API is missing", function() {
  var d = baseDeps();
  var Gadget = loadMain(d);

  withMockedConsoleError(function(messages) {
    new Gadget();

    assert.equal(d.rendering.initCalls.length, 0);
    assert.equal(messages.length, 1);
    assert.match(messages[0], /API object is missing/);
  });
});

test("story browser main logs and stops when content element is missing", function() {
  var d = baseDeps();
  var Gadget = loadMain(d);

  withMockedConsoleError(function(messages) {
    new Gadget({
      getGadgetContentEl: function() {
        return null;
      }
    });

    assert.equal(d.rendering.initCalls.length, 0);
    assert.match(messages[0], /No content element/);
  });
});

test("story browser main logs and stops when content collection is empty", function() {
  var d = baseDeps();
  var Gadget = loadMain(d);

  withMockedConsoleError(function(messages) {
    new Gadget({
      getGadgetContentEl: function() {
        return createEmptyCollection();
      }
    });

    assert.equal(d.rendering.initCalls.length, 0);
    assert.match(messages[0], /No content element/);
  });
});

test("story browser main passes callbacks and state to rendering.init", async function() {
  var d = baseDeps();
  var Gadget = loadMain(d);

  new Gadget({
    getGadgetContentEl: function() {
      return createElement("page-shell");
    }
  });

  var svc = d.rendering.initCalls[0].services;
  assert.ok(typeof svc.onProjectChange === "function");
  assert.ok(typeof svc.onStatusChange === "function");
  assert.ok(typeof svc.onEpicChange === "function");
  assert.ok(typeof svc.onSprintChange === "function");
  assert.ok(typeof svc.onSearchInput === "function");
  assert.ok(typeof svc.onSearchChange === "function");
  assert.ok(typeof svc.onViewMode === "function");
  assert.ok(typeof svc.onExpandAll === "function");
  assert.ok(typeof svc.onCollapseAll === "function");
  assert.ok(typeof svc.onToggleExpandedKey === "function");
  assert.ok(typeof svc.onToggleEpic === "function");
  assert.ok(svc.state);
  assert.equal(svc.state.filters.status, "");
  assert.equal(svc.state.filters.epic, "");
  assert.equal(svc.state.filters.sprint, "");
  assert.equal(svc.state.filters.search, "");

  await new Promise(function(resolve) {
    setImmediate(resolve);
  });
  assert.ok(Array.isArray(svc.state.projects));
  assert.equal(svc.state.projects.length, 1);
});

test("story browser main loads first project when none saved", async function() {
  var d = baseDeps();
  var issuesSpy = 0;
  d.api.getProjectIssues = function(key, onProgress) {
    issuesSpy += 1;
    assert.equal(key, "P1");
    if (onProgress) {
      onProgress(2, 2);
    }
    return resolved([]);
  };
  var Gadget = loadMain(d);

  new Gadget({
    getGadgetContentEl: function() {
      return createElement("page-shell");
    }
  });

  await new Promise(function(resolve) {
    setImmediate(resolve);
  });
  assert.equal(issuesSpy, 1);
  assert.equal(d.rendering.progressCalls.length, 3);
  assert.equal(d.rendering.progressCalls[0].loaded, 0);
  assert.equal(d.rendering.progressCalls[0].total, 0);
  assert.equal(d.rendering.progressCalls[1].loaded, 2);
  assert.equal(d.rendering.progressCalls[1].total, 2);
  assert.equal(d.rendering.progressCalls[2].loaded, 0);
  assert.equal(d.rendering.progressCalls[2].total, 0);
});

test("story browser main restores saved project and viewMode", async function() {
  var d = baseDeps();
  d.ls.setItem(d.config.STORAGE_KEY, JSON.stringify({ project: "P2", viewMode: "accordion" }));
  d.api.getProjects = function() {
    return resolved([
      { key: "P1", name: "A" },
      { key: "P2", name: "B" }
    ]);
  };
  var loadedKey = null;
  d.api.getProjectIssues = function(key) {
    loadedKey = key;
    return resolved([]);
  };
  var Gadget = loadMain(d);

  new Gadget({
    getGadgetContentEl: function() {
      return createElement("page-shell");
    }
  });

  await new Promise(function(resolve) {
    setImmediate(resolve);
  });
  assert.equal(loadedKey, "P2");
  assert.equal(d.rendering.initCalls[0].services.state.viewMode, "accordion");
});

test("story browser main clears stale persisted filters when startup falls back to first project", async function() {
  var d = baseDeps();
  var p1 = createDeferred();

  d.ls.setItem(d.config.STORAGE_KEY, JSON.stringify({
    project: "OLD",
    viewMode: "rows",
    statusFilter: "Blocked",
    epicFilter: "OLD-EPIC",
    sprintFilter: "Sprint Old"
  }));
  d.api.getProjects = function() {
    return resolved([{ key: "P1", name: "One" }]);
  };
  d.api.getProjectIssues = function(key) {
    assert.equal(key, "P1");
    return p1.promise();
  };
  d.data.buildTree = function(issues) {
    return [{ key: issues[0].treeKey, type: "Epic", children: [] }];
  };
  d.data.collectFilters = function(tree) {
    return {
      statuses: [tree[0].key + "-status"],
      sprints: [tree[0].key + "-sprint"],
      epics: [{ key: tree[0].key, summary: tree[0].key }]
    };
  };
  d.data.filterTree = function(tree, filters) {
    if (filters.status || filters.epic || filters.sprint || filters.search) {
      return [];
    }
    return tree;
  };

  var Gadget = loadMain(d);
  new Gadget({
    getGadgetContentEl: function() {
      return createElement("page-shell");
    }
  });

  var svc = d.rendering.initCalls[0].services;
  await nextTurn();

  assert.equal(svc.state.project, "P1");
  assert.equal(svc.state.loading, true);
  assert.equal(svc.state.filters.status, "");
  assert.equal(svc.state.filters.epic, "");
  assert.equal(svc.state.filters.sprint, "");
  assert.equal(svc.state.filters.search, "");

  p1.resolve([{ treeKey: "P1-tree" }]);
  await nextTurn();

  assert.equal(svc.state.filteredTree.length, 1);
  assert.equal(svc.state.filteredTree[0].key, "P1-tree");
});

test("story browser main project pipeline order: progress then header then tree", async function() {
  var d = baseDeps();
  var log = [];
  d.rendering.renderHeader = function() {
    log.push("header");
  };
  d.rendering.renderTree = function() {
    log.push("tree");
  };
  d.rendering.renderProgress = function() {
    log.push("progress");
  };
  d.api.getProjectIssues = function(_key, onProgress) {
    log.push("issues-start");
    if (onProgress) {
      onProgress(1, 5);
    }
    return resolved([]);
  };
  var Gadget = loadMain(d);

  new Gadget({
    getGadgetContentEl: function() {
      return createElement("page-shell");
    }
  });

  await new Promise(function(resolve) {
    setImmediate(resolve);
  });
  var i = log.indexOf("issues-start");
  assert.ok(i >= 0);
  assert.equal(log[i + 1], "progress");
  var headerAfterIssues = log.slice(i + 1).indexOf("header");
  assert.ok(headerAfterIssues >= 0);
  var lastHeader = -1;
  var j;
  for (j = 0; j < log.length; j += 1) {
    if (log[j] === "header") {
      lastHeader = j;
    }
  }
  assert.ok(lastHeader >= 0);
  var treeAfterLastHeader = log.slice(lastHeader + 1).indexOf("tree");
  assert.ok(treeAfterLastHeader >= 0);
});

test("story browser main filter callback recomputes filtered tree", async function() {
  var d = baseDeps();
  var Gadget = loadMain(d);
  new Gadget({
    getGadgetContentEl: function() {
      return createElement("page-shell");
    }
  });

  await new Promise(function(resolve) {
    setImmediate(resolve);
  });
  var svc = d.rendering.initCalls[0].services;
  var before = d.rendering.treeCalls.length;
  svc.onStatusChange("Open");
  assert.ok(d.rendering.treeCalls.length > before);
  assert.equal(svc.state.filters.status, "Open");
});

test("story browser main view mode persists and triggers tree rerender", async function() {
  var d = baseDeps();
  var savedModes = [];
  var origSave = d.storage.save;
  d.storage.save = function(s) {
    if (s && s.viewMode != null) {
      savedModes.push(String(s.viewMode));
    }
    return origSave.call(d.storage, s);
  };
  var Gadget = loadMain(d);
  new Gadget({
    getGadgetContentEl: function() {
      return createElement("page-shell");
    }
  });

  await new Promise(function(resolve) {
    setImmediate(resolve);
  });
  var svc = d.rendering.initCalls[0].services;
  var treesBefore = d.rendering.treeCalls.length;
  svc.onViewMode("rows");
  assert.equal(svc.state.viewMode, "rows");
  assert.ok(d.rendering.treeCalls.length > treesBefore);
  assert.ok(savedModes.indexOf("rows") >= 0);
  svc.onViewMode("accordion");
  assert.equal(svc.state.viewMode, "accordion");
  assert.ok(savedModes.indexOf("accordion") >= 0);
});

test("story browser main expand all collapse all and toggle", async function() {
  var d = baseDeps();
  d.api.getProjectIssues = function() {
    return resolved([
      {
        key: "E1",
        fields: {
          summary: "Epic",
          status: { name: "Open", statusCategory: { name: "To Do" } },
          issuetype: { name: "Epic" },
          priority: { name: "Medium" },
          assignee: null,
          timetracking: {},
          components: [],
          labels: [],
          fixVersions: [],
          parent: null,
          created: "",
          updated: "",
          customfield_10014: null,
          customfield_10020: null
        }
      },
      {
        key: "S1",
        fields: {
          summary: "S",
          status: { name: "Open", statusCategory: { name: "To Do" } },
          issuetype: { name: "Story" },
          priority: { name: "Medium" },
          assignee: null,
          timetracking: {},
          components: [],
          labels: [],
          fixVersions: [],
          parent: { key: "E1" },
          created: "",
          updated: "",
          customfield_10014: null,
          customfield_10020: null
        }
      }
    ]);
  };
  var Gadget = loadMain(d);
  new Gadget({
    getGadgetContentEl: function() {
      return createElement("page-shell");
    }
  });

  await new Promise(function(resolve) {
    setImmediate(resolve);
  });
  var svc = d.rendering.initCalls[0].services;
  svc.onExpandAll();
  assert.equal(svc.state.expanded.E1, true);
  svc.onCollapseAll();
  assert.equal(svc.state.expanded.E1, undefined);
  svc.onToggleEpic("E1");
  assert.equal(svc.state.expanded.E1, true);
  svc.onToggleExpandedKey("E1");
  assert.equal(svc.state.expanded.E1, undefined);
});

test("story browser main project load failure renders empty tree", async function() {
  var d = baseDeps();
  d.api.getProjectIssues = function() {
    return rejected({ status: 500 });
  };
  var Gadget = loadMain(d);
  new Gadget({
    getGadgetContentEl: function() {
      return createElement("page-shell");
    }
  });

  await new Promise(function(resolve) {
    setImmediate(resolve);
  });
  var last = d.rendering.treeCalls[d.rendering.treeCalls.length - 1];
  assert.ok(last);
  assert.ok(Array.isArray(last.tree));
  assert.equal(last.tree.length, 0);
  assert.equal(d.rendering.initCalls[0].services.state.loading, false);
});

test("story browser main ignores stale in-flight project responses after switching projects", async function() {
  var d = baseDeps();
  var p1 = createDeferred();
  var p2 = createDeferred();

  d.api.getProjects = function() {
    return resolved([
      { key: "P1", name: "One" },
      { key: "P2", name: "Two" }
    ]);
  };
  d.api.getProjectIssues = function(key) {
    if (key === "P1") return p1.promise();
    if (key === "P2") return p2.promise();
    throw new Error("Unexpected project key: " + key);
  };
  d.data.buildTree = function(issues) {
    return [{ key: issues[0].treeKey, type: "Epic", children: [] }];
  };
  d.data.collectFilters = function(tree) {
    return {
      statuses: [tree[0].key + "-status"],
      sprints: [],
      epics: [{ key: tree[0].key, summary: tree[0].key }]
    };
  };
  d.data.filterTree = function(tree) {
    return tree;
  };

  var Gadget = loadMain(d);
  new Gadget({
    getGadgetContentEl: function() {
      return createElement("page-shell");
    }
  });

  var svc = d.rendering.initCalls[0].services;
  svc.onProjectChange("P2");

  p2.resolve([{ treeKey: "P2-tree" }]);
  await nextTurn();
  assert.equal(svc.state.project, "P2");
  assert.equal(svc.state.tree[0].key, "P2-tree");
  assert.equal(svc.state.filterOptions.statuses[0], "P2-tree-status");

  var treeCallsAfterP2 = d.rendering.treeCalls.length;
  var headerCallsAfterP2 = d.rendering.headerCalls;

  p1.resolve([{ treeKey: "P1-tree" }]);
  await nextTurn();
  assert.equal(svc.state.project, "P2");
  assert.equal(svc.state.tree[0].key, "P2-tree");
  assert.equal(svc.state.filterOptions.statuses[0], "P2-tree-status");
  assert.equal(d.rendering.treeCalls.length, treeCallsAfterP2);
  assert.equal(d.rendering.headerCalls, headerCallsAfterP2);
});

test("story browser main resets progress at load start and clears it after a successful project load", async function() {
  var d = baseDeps();

  d.api.getProjectIssues = function(_key, onProgress) {
    if (onProgress) {
      onProgress(4, 5);
    }
    return resolved([]);
  };

  var Gadget = loadMain(d);
  new Gadget({
    getGadgetContentEl: function() {
      return createElement("page-shell");
    }
  });

  await nextTurn();
  assert.equal(d.rendering.progressCalls.length, 3);
  assert.equal(d.rendering.progressCalls[0].loaded, 0);
  assert.equal(d.rendering.progressCalls[0].total, 0);
  assert.equal(d.rendering.progressCalls[1].loaded, 4);
  assert.equal(d.rendering.progressCalls[1].total, 5);
  assert.equal(d.rendering.progressCalls[2].loaded, 0);
  assert.equal(d.rendering.progressCalls[2].total, 0);
});

test("story browser main rerenders header after a rejected project load clears filter options", async function() {
  var d = baseDeps();
  var p1 = createDeferred();
  var p2 = createDeferred();

  d.api.getProjects = function() {
    return resolved([
      { key: "P1", name: "One" },
      { key: "P2", name: "Two" }
    ]);
  };
  d.api.getProjectIssues = function(key) {
    if (key === "P1") return p1.promise();
    if (key === "P2") return p2.promise();
    throw new Error("Unexpected project key: " + key);
  };
  d.data.buildTree = function(issues) {
    return [{ key: issues[0].treeKey, type: "Epic", children: [] }];
  };
  d.data.collectFilters = function(tree) {
    return {
      statuses: [tree[0].key + "-status"],
      sprints: [tree[0].key + "-sprint"],
      epics: [{ key: tree[0].key, summary: tree[0].key }]
    };
  };
  d.data.filterTree = function(tree) {
    return tree;
  };

  var Gadget = loadMain(d);
  new Gadget({
    getGadgetContentEl: function() {
      return createElement("page-shell");
    }
  });

  var svc = d.rendering.initCalls[0].services;
  p1.resolve([{ treeKey: "P1-tree" }]);
  await nextTurn();
  assert.equal(svc.state.filterOptions.statuses[0], "P1-tree-status");

  var headerCallsBeforeFailure = d.rendering.headerCalls;
  svc.onProjectChange("P2");
  p2.reject({ status: 500 });
  await nextTurn();

  assert.equal(svc.state.filterOptions.statuses.length, 0);
  assert.equal(svc.state.filterOptions.sprints.length, 0);
  assert.equal(svc.state.filterOptions.epics.length, 0);
  assert.equal(d.rendering.headerCalls, headerCallsBeforeFailure + 2);
});

test("story browser main resets progress immediately when a new project load starts", async function() {
  var d = baseDeps();
  var p1 = createDeferred();
  var p2 = createDeferred();

  d.api.getProjects = function() {
    return resolved([
      { key: "P1", name: "One" },
      { key: "P2", name: "Two" }
    ]);
  };
  d.api.getProjectIssues = function(key, onProgress) {
    if (key === "P1") {
      if (onProgress) {
        onProgress(3, 7);
      }
      return p1.promise();
    }
    if (key === "P2") {
      return p2.promise();
    }
    throw new Error("Unexpected project key: " + key);
  };

  var Gadget = loadMain(d);
  new Gadget({
    getGadgetContentEl: function() {
      return createElement("page-shell");
    }
  });

  await nextTurn();
  var svc = d.rendering.initCalls[0].services;
  var callsBeforeSwitch = d.rendering.progressCalls.length;

  svc.onProjectChange("P2");

  assert.equal(d.rendering.progressCalls.length, callsBeforeSwitch + 1);
  assert.equal(d.rendering.progressCalls[d.rendering.progressCalls.length - 1].loaded, 0);
  assert.equal(d.rendering.progressCalls[d.rendering.progressCalls.length - 1].total, 0);

  p2.resolve([]);
  p1.resolve([]);
  await nextTurn();
});

test("story browser main clears stale tree and filter options immediately when a new project load starts", async function() {
  var d = baseDeps();
  var p1 = createDeferred();
  var p2 = createDeferred();

  d.api.getProjects = function() {
    return resolved([
      { key: "P1", name: "One" },
      { key: "P2", name: "Two" }
    ]);
  };
  d.api.getProjectIssues = function(key) {
    if (key === "P1") return p1.promise();
    if (key === "P2") return p2.promise();
    throw new Error("Unexpected project key: " + key);
  };
  d.data.buildTree = function(issues) {
    return [{ key: issues[0].treeKey, type: "Epic", children: [] }];
  };
  d.data.collectFilters = function(tree) {
    return {
      statuses: [tree[0].key + "-status"],
      sprints: [tree[0].key + "-sprint"],
      epics: [{ key: tree[0].key, summary: tree[0].key }]
    };
  };
  d.data.filterTree = function(tree) {
    return tree;
  };

  var Gadget = loadMain(d);
  new Gadget({
    getGadgetContentEl: function() {
      return createElement("page-shell");
    }
  });

  var svc = d.rendering.initCalls[0].services;
  p1.resolve([{ treeKey: "P1-tree" }]);
  await nextTurn();

  assert.equal(svc.state.tree[0].key, "P1-tree");
  assert.equal(svc.state.filterOptions.statuses[0], "P1-tree-status");

  var headerCallsBeforeSwitch = d.rendering.headerCalls;
  var treeCallsBeforeSwitch = d.rendering.treeCalls.length;

  svc.onProjectChange("P2");

  assert.equal(svc.state.loading, true);
  assert.ok(Array.isArray(svc.state.tree));
  assert.equal(svc.state.tree.length, 0);
  assert.ok(Array.isArray(svc.state.filteredTree));
  assert.equal(svc.state.filteredTree.length, 0);
  assert.equal(svc.state.filterOptions.statuses.length, 0);
  assert.equal(svc.state.filterOptions.sprints.length, 0);
  assert.equal(svc.state.filterOptions.epics.length, 0);
  assert.equal(d.rendering.headerCalls, headerCallsBeforeSwitch + 1);
  assert.equal(d.rendering.treeCalls.length, treeCallsBeforeSwitch + 1);
  assert.equal(d.rendering.treeCalls[d.rendering.treeCalls.length - 1].tree.length, 0);

  p2.resolve([{ treeKey: "P2-tree" }]);
  await nextTurn();
});

test("story browser main resets stale filters on project switch so new project is not hidden", async function() {
  var d = baseDeps();
  var p1 = createDeferred();
  var p2 = createDeferred();

  d.api.getProjects = function() {
    return resolved([
      { key: "P1", name: "One" },
      { key: "P2", name: "Two" }
    ]);
  };
  d.api.getProjectIssues = function(key) {
    if (key === "P1") return p1.promise();
    if (key === "P2") return p2.promise();
    throw new Error("Unexpected project key: " + key);
  };
  d.data.buildTree = function(issues) {
    return [{ key: issues[0].treeKey, type: "Epic", children: [] }];
  };
  d.data.collectFilters = function(tree) {
    return {
      statuses: [tree[0].key + "-status"],
      sprints: [tree[0].key + "-sprint"],
      epics: [{ key: tree[0].key, summary: tree[0].key }]
    };
  };
  d.data.filterTree = function(tree, filters) {
    if (filters.status || filters.epic || filters.sprint || filters.search) {
      return [];
    }
    return tree;
  };

  var Gadget = loadMain(d);
  new Gadget({
    getGadgetContentEl: function() {
      return createElement("page-shell");
    }
  });

  var svc = d.rendering.initCalls[0].services;
  p1.resolve([{ treeKey: "P1-tree" }]);
  await nextTurn();

  svc.onStatusChange("Blocked");
  svc.onEpicChange("EPIC-OLD");
  svc.onSprintChange("Sprint Old");
  svc.onSearchChange("carry-over");

  assert.equal(svc.state.filteredTree.length, 0);

  svc.onProjectChange("P2");

  assert.equal(svc.state.filters.status, "");
  assert.equal(svc.state.filters.epic, "");
  assert.equal(svc.state.filters.sprint, "");
  assert.equal(svc.state.filters.search, "");

  p2.resolve([{ treeKey: "P2-tree" }]);
  await nextTurn();

  assert.equal(svc.state.filteredTree.length, 1);
  assert.equal(svc.state.filteredTree[0].key, "P2-tree");
});

test("story browser main surfaces partial tree and filter options while project is still loading", async function() {
  var d = baseDeps();
  var finalLoad = createDeferred();

  d.api.getProjectIssues = function(_key, onProgress) {
    if (onProgress) {
      onProgress(100, 500, [{ treeKey: "partial-tree" }]);
    }
    return finalLoad.promise();
  };
  d.data.buildTree = function(issues) {
    return [{ key: issues[0].treeKey, type: "Epic", children: [] }];
  };
  d.data.collectFilters = function(tree) {
    return {
      statuses: [tree[0].key + "-status"],
      sprints: [tree[0].key + "-sprint"],
      epics: [{ key: tree[0].key, summary: tree[0].key }]
    };
  };
  d.data.filterTree = function(tree) {
    return tree;
  };

  var Gadget = loadMain(d);
  new Gadget({
    getGadgetContentEl: function() {
      return createElement("page-shell");
    }
  });

  await nextTurn();
  var svc = d.rendering.initCalls[0].services;
  assert.equal(svc.state.loading, true);
  assert.equal(svc.state.tree.length, 1);
  assert.equal(svc.state.tree[0].key, "partial-tree");
  assert.equal(svc.state.filterOptions.statuses[0], "partial-tree-status");
  assert.equal(svc.state.filterOptions.sprints[0], "partial-tree-sprint");
  assert.equal(svc.state.filterOptions.epics[0].key, "partial-tree");
  assert.equal(d.rendering.treeCalls[d.rendering.treeCalls.length - 1].tree[0].key, "partial-tree");

  finalLoad.resolve([{ treeKey: "final-tree" }]);
  await nextTurn();

  assert.equal(svc.state.loading, false);
  assert.equal(svc.state.tree[0].key, "final-tree");
  assert.equal(svc.state.filterOptions.epics[0].key, "final-tree");
});

test("story browser main staged load fetches full epic catalog before display data", async function() {
  var d = baseDeps();
  var log = [];
  var buildPayload = null;

  d.api.getProjects = function() {
    return resolved([{ key: "P1", name: "One" }]);
  };
  d.api.getProjectEpics = function(projectKey) {
    log.push("epics:" + projectKey);
    return resolved([
      makeIssue("E-10", "Epic"),
      makeIssue("E-20", "Epic", {
        status: { name: "Done", statusCategory: { name: "Done", key: "done" } }
      })
    ]);
  };
  d.api.getStoriesForEpicKeys = function(projectKey, epicKeys) {
    log.push("stories:" + projectKey + ":" + epicKeys.join("|"));
    return resolved([
      makeIssue("S-1", "Story", {
        customfield_10014: "E-10",
        issuelinks: [
          {
            type: { outward: "child", inward: "parent" },
            outwardIssue: { key: "C-1" }
          }
        ]
      })
    ]);
  };
  d.api.getIssuesByKeys = function(issueKeys) {
    log.push("children:" + issueKeys.join("|"));
    return resolved([
      makeIssue("C-1", "Task", {
        summary: "[BE] Backend child"
      })
    ]);
  };
  d.data.buildTree = function(payload) {
    buildPayload = payload;
    return [{ key: "E-10", type: "Epic", children: [] }];
  };
  d.data.collectFilters = function(_tree, epicCatalog) {
    return {
      statuses: [],
      sprints: [],
      epics: epicCatalog.map(function(issue) {
        return { key: issue.key, summary: issue.fields.summary };
      })
    };
  };
  d.data.filterTree = function(tree) {
    return tree;
  };

  var Gadget = loadMain(d);
  new Gadget({
    getGadgetContentEl: function() {
      return createElement("page-shell");
    }
  });

  await flushTurns(5);
  var svc = d.rendering.initCalls[0].services;

  assert.equal(log.join(">"), "epics:P1>stories:P1:E-10>children:C-1");
  assert.ok(buildPayload);
  assert.equal(buildPayload.epics.length, 1);
  assert.equal(buildPayload.epics[0].key, "E-10");
  assert.equal(buildPayload.stories.length, 1);
  assert.equal(buildPayload.children.length, 1);
  assert.equal(svc.state.filterOptions.epics.length, 2);
  assert.equal(svc.state.filterOptions.epics[0].key, "E-10");
  assert.equal(svc.state.filterOptions.epics[1].key, "E-20");
});

test("story browser main detects field ids before staged loading and shows progress", async function() {
  var d = baseDeps();
  var storyFieldConfig = null;
  var childFieldConfig = null;
  var buildFieldConfig = null;

  d.api.getProjects = function() {
    return resolved([{ key: "P1", name: "One" }]);
  };
  d.api.getFieldMetadata = function() {
    return resolved([
      {
        id: "customfield_10008",
        name: "Epic Link",
        schema: { custom: "com.pyxis.greenhopper.jira:gh-epic-link" }
      },
      {
        id: "customfield_10007",
        name: "Sprint",
        schema: { custom: "com.pyxis.greenhopper.jira:gh-sprint" }
      }
    ]);
  };
  d.api.detectFieldConfig = function() {
    return {
      epicLinkField: "customfield_10008",
      sprintField: "customfield_10007"
    };
  };
  d.api.getProjectEpics = function(_projectKey, onProgress) {
    if (onProgress) {
      onProgress(1, 1, [makeIssue("E-1", "Epic")]);
    }
    return resolved([makeIssue("E-1", "Epic")]);
  };
  d.api.getStoriesForEpicKeys = function(_projectKey, epicKeys, onProgress, fieldConfig) {
    storyFieldConfig = fieldConfig;
    if (onProgress) {
      onProgress(1, 1, [
        makeIssue("S-1", "Story", {
          customfield_10008: epicKeys[0],
          issuelinks: [
            {
              type: { outward: "child", inward: "parent" },
              outwardIssue: { key: "C-1" }
            }
          ]
        })
      ]);
    }
    return resolved([
      makeIssue("S-1", "Story", {
        customfield_10008: epicKeys[0],
        issuelinks: [
          {
            type: { outward: "child", inward: "parent" },
            outwardIssue: { key: "C-1" }
          }
        ]
      })
    ]);
  };
  d.api.getIssuesByKeys = function(_issueKeys, onProgress, fieldConfig) {
    childFieldConfig = fieldConfig;
    if (onProgress) {
      onProgress(1, 1, [
        makeIssue("C-1", "Task", {
          customfield_10007: [{ name: "Sprint override" }]
        })
      ]);
    }
    return resolved([
      makeIssue("C-1", "Task", {
        customfield_10007: [{ name: "Sprint override" }]
      })
    ]);
  };
  d.data.buildTree = function(payload, fieldConfig) {
    buildFieldConfig = fieldConfig;
    return [
      {
        key: payload.epics[0].key,
        type: "Epic",
        children: payload.stories.map(function(issue) {
          return { key: issue.key, type: "Story", children: [] };
        })
      }
    ];
  };
  d.data.collectFilters = function(_tree, epicCatalog) {
    return {
      statuses: [],
      sprints: [],
      epics: epicCatalog.map(function(issue) {
        return { key: issue.key, summary: issue.fields.summary };
      })
    };
  };
  d.data.filterTree = function(tree) {
    return tree;
  };

  var Gadget = loadMain(d);
  new Gadget({
    getGadgetContentEl: function() {
      return createElement("page-shell");
    }
  });

  await flushTurns(5);

  assert.ok(storyFieldConfig);
  assert.equal(storyFieldConfig.epicLinkField, "customfield_10008");
  assert.equal(storyFieldConfig.sprintField, "customfield_10007");
  assert.ok(childFieldConfig);
  assert.equal(childFieldConfig.epicLinkField, "customfield_10008");
  assert.equal(childFieldConfig.sprintField, "customfield_10007");
  assert.ok(buildFieldConfig);
  assert.equal(buildFieldConfig.epicLinkField, "customfield_10008");
  assert.equal(buildFieldConfig.sprintField, "customfield_10007");
  assert.equal(
    d.rendering.progressCalls.some(function(call) {
      return call.loaded === 0 && call.total === 1;
    }),
    true
  );
  assert.equal(
    d.rendering.progressCalls.some(function(call) {
      return call.loaded === 1 && call.total === 1;
    }),
    true
  );
});

test("story browser main refetches only when epic selection changes", async function() {
  var d = baseDeps();
  var storyCalls = [];
  var childCalls = [];

  d.api.getProjects = function() {
    return resolved([{ key: "P1", name: "One" }]);
  };
  d.api.getProjectEpics = function() {
    return resolved([
      makeIssue("E-1", "Epic"),
      makeIssue("E-2", "Epic")
    ]);
  };
  d.api.getStoriesForEpicKeys = function(_projectKey, epicKeys) {
    storyCalls.push(epicKeys.join("|"));
    return resolved([
      makeIssue("S-" + (epicKeys[0] || "NONE"), "Story", {
        customfield_10014: epicKeys[0] || null
      })
    ]);
  };
  d.api.getIssuesByKeys = function(issueKeys) {
    childCalls.push(issueKeys.join("|"));
    return resolved([]);
  };
  d.data.buildTree = function(payload) {
    return payload.epics.map(function(issue) {
      return { key: issue.key, type: "Epic", children: [] };
    });
  };
  d.data.collectFilters = function(_tree, epicCatalog) {
    return {
      statuses: ["Open"],
      sprints: ["Sprint 42"],
      epics: epicCatalog.map(function(issue) {
        return { key: issue.key, summary: issue.fields.summary };
      })
    };
  };
  d.data.filterTree = function(tree) {
    return tree;
  };

  var Gadget = loadMain(d);
  new Gadget({
    getGadgetContentEl: function() {
      return createElement("page-shell");
    }
  });

  await flushTurns(5);
  var svc = d.rendering.initCalls[0].services;
  assert.equal(storyCalls[0], "E-1|E-2");

  svc.onEpicChange("E-2");
  await flushTurns(5);

  assert.equal(storyCalls[1], "E-2");
  assert.equal(Array.isArray(svc.state.selectedEpicKeys), true);
  assert.equal(svc.state.selectedEpicKeys.join("|"), "E-2");

  var storyCallsBeforeFilters = storyCalls.length;
  var childCallsBeforeFilters = childCalls.length;

  svc.onStatusChange("Open");
  svc.onSprintChange("Sprint 42");
  svc.onSearchChange("needle");

  await flushTurns(2);
  assert.equal(storyCalls.length, storyCallsBeforeFilters);
  assert.equal(childCalls.length, childCallsBeforeFilters);
});

test("story browser main selecting only closed epics yields empty tree without losing epic catalog", async function() {
  var d = baseDeps();

  d.api.getProjects = function() {
    return resolved([{ key: "P1", name: "One" }]);
  };
  d.api.getProjectEpics = function() {
    return resolved([
      makeIssue("E-1", "Epic"),
      makeIssue("E-2", "Epic", {
        status: { name: "Done", statusCategory: { name: "Done", key: "done" } }
      })
    ]);
  };
  d.api.getStoriesForEpicKeys = function(_projectKey, epicKeys) {
    return resolved(
      epicKeys.length
        ? [
            makeIssue("S-1", "Story", {
              customfield_10014: epicKeys[0]
            })
          ]
        : []
    );
  };
  d.api.getIssuesByKeys = function() {
    return resolved([]);
  };
  d.data.buildTree = function(payload) {
    return (payload.epics || []).map(function(issue) {
      return { key: issue.key, type: "Epic", children: [] };
    });
  };
  d.data.collectFilters = function(_tree, epicCatalog) {
    return {
      statuses: [],
      sprints: [],
      epics: epicCatalog.map(function(issue) {
        return { key: issue.key, summary: issue.fields.summary };
      })
    };
  };
  d.data.filterTree = function(tree) {
    return tree;
  };

  var Gadget = loadMain(d);
  new Gadget({
    getGadgetContentEl: function() {
      return createElement("page-shell");
    }
  });

  await flushTurns(5);
  var svc = d.rendering.initCalls[0].services;
  svc.onEpicChange("E-2");
  await flushTurns(5);

  assert.equal(svc.state.tree.length, 0);
  assert.equal(svc.state.filteredTree.length, 0);
  assert.equal(svc.state.filterOptions.epics.length, 2);
  assert.equal(svc.state.selectedEpicKeys.join("|"), "E-2");
});

test("story browser main keeps stories when child issue fetch fails", async function() {
  var d = baseDeps();
  var buildPayload = null;

  d.api.getProjects = function() {
    return resolved([{ key: "P1", name: "One" }]);
  };
  d.api.getProjectEpics = function() {
    return resolved([makeIssue("E-1", "Epic")]);
  };
  d.api.getStoriesForEpicKeys = function() {
    return resolved([
      makeIssue("S-1", "Story", {
        customfield_10014: "E-1",
        issuelinks: [
          {
            type: { outward: "child", inward: "parent" },
            outwardIssue: { key: "C-1" }
          }
        ]
      })
    ]);
  };
  d.api.getIssuesByKeys = function() {
    return rejected(new Error("boom"));
  };
  d.data.buildTree = function(payload) {
    buildPayload = payload;
    return [
      {
        key: payload.epics[0].key,
        type: "Epic",
        children: payload.stories.map(function(issue) {
          return { key: issue.key, type: "Story", children: [] };
        })
      }
    ];
  };
  d.data.collectFilters = function(_tree, epicCatalog) {
    return {
      statuses: [],
      sprints: [],
      epics: epicCatalog.map(function(issue) {
        return { key: issue.key, summary: issue.fields.summary };
      })
    };
  };
  d.data.filterTree = function(tree) {
    return tree;
  };

  var Gadget = loadMain(d);
  new Gadget({
    getGadgetContentEl: function() {
      return createElement("page-shell");
    }
  });

  await flushTurns(5);
  var svc = d.rendering.initCalls[0].services;

  assert.ok(buildPayload);
  assert.equal(buildPayload.children.length, 0);
  assert.equal(svc.state.loading, false);
  assert.equal(svc.state.tree.length, 1);
  assert.equal(svc.state.tree[0].children.length, 1);
  assert.equal(svc.state.tree[0].children[0].key, "S-1");
  assert.equal(svc.state.filterOptions.epics.length, 1);
});

test("story browser main onOpenCreateStory sets state and renders modal via popup host helper", async function() {  var d = baseDeps();
  var Gadget = loadMain(d);
  new Gadget({
    getGadgetContentEl: function() {
      return createElement("page-shell");
    }
  });

  await nextTurn();
  var svc = d.rendering.initCalls[0].services;
  assert.ok(svc.state.createStory);
  assert.equal(svc.state.createStory.isOpen, false);
  assert.equal(svc.state.createStory.draft, null);

  svc.onOpenCreateStory();

  assert.equal(svc.state.createStory.isOpen, true);
  assert.ok(svc.state.createStory.draft);
  assert.equal(svc.state.createStory.draft.projectKey, "P1");
  assert.equal(d.createStory.makeDefaultDraftCalls.length, 1);
  assert.equal(d.createStory.makeDefaultDraftCalls[0], "P1");
  assert.equal(d.rendering.renderCreateStoryModalCalls.length, 1);
  assert.strictEqual(d.rendering.renderCreateStoryModalCalls[0], svc.state.createStory.draft);
});

test("story browser main onCloseCreateStory clears modal without reloading project issues", async function() {
  var d = baseDeps();
  var issuesSpy = 0;
  d.api.getProjectIssues = function(key, onProgress) {
    issuesSpy += 1;
    if (onProgress) {
      onProgress(1, 1);
    }
    return resolved([]);
  };
  var Gadget = loadMain(d);
  new Gadget({
    getGadgetContentEl: function() {
      return createElement("page-shell");
    }
  });

  await nextTurn();
  var svc = d.rendering.initCalls[0].services;
  var issuesAfterLoad = issuesSpy;

  svc.onOpenCreateStory();
  assert.equal(issuesSpy, issuesAfterLoad);

  svc.onCloseCreateStory();

  assert.equal(svc.state.createStory.isOpen, false);
  assert.equal(svc.state.createStory.draft, null);
  assert.equal(d.rendering.clearCreateStoryModalCalls, 1);
  assert.equal(issuesSpy, issuesAfterLoad);
});

test("story browser main closes create-story modal and resets state when project load starts (switch)", async function() {
  var d = baseDeps();
  d.api.getProjects = function() {
    return resolved([
      { key: "P1", name: "One" },
      { key: "P2", name: "Two" }
    ]);
  };
  var Gadget = loadMain(d);
  new Gadget({
    getGadgetContentEl: function() {
      return createElement("page-shell");
    }
  });

  await nextTurn();
  var svc = d.rendering.initCalls[0].services;
  assert.equal(svc.state.project, "P1");

  svc.onOpenCreateStory();
  assert.equal(svc.state.createStory.isOpen, true);
  assert.ok(svc.state.createStory.draft);
  assert.equal(d.rendering.clearCreateStoryModalCalls, 0);

  svc.onProjectChange("P2");

  assert.equal(svc.state.createStory.isOpen, false);
  assert.equal(svc.state.createStory.draft, null);
  assert.equal(svc.state.createStory.context, null);
  assert.equal(d.rendering.clearCreateStoryModalCalls, 1);
  assert.equal(svc.state.project, "P2");
});

test("story browser main closes create-story when switching projects while prior load is in flight", async function() {
  var d = baseDeps();
  var p1 = createDeferred();
  d.api.getProjects = function() {
    return resolved([
      { key: "P1", name: "One" },
      { key: "P2", name: "Two" }
    ]);
  };
  d.api.getProjectIssues = function(key) {
    if (key === "P1") {
      return p1.promise();
    }
    if (key === "P2") {
      return resolved([]);
    }
    throw new Error("Unexpected project key: " + key);
  };
  d.data.buildTree = function(issues) {
    if (!issues || !issues.length) {
      return [];
    }
    return [{ key: issues[0].treeKey, type: "Epic", children: [] }];
  };
  d.data.collectFilters = function(tree) {
    return { statuses: [], sprints: [], epics: [] };
  };
  d.data.filterTree = function(tree) {
    return tree;
  };

  var Gadget = loadMain(d);
  new Gadget({
    getGadgetContentEl: function() {
      return createElement("page-shell");
    }
  });

  await nextTurn();
  var svc = d.rendering.initCalls[0].services;
  assert.equal(svc.state.loading, true);
  assert.equal(svc.state.project, "P1");

  svc.onOpenCreateStory();
  assert.equal(svc.state.createStory.isOpen, true);

  svc.onProjectChange("P2");
  await nextTurn();

  assert.equal(svc.state.createStory.isOpen, false);
  assert.equal(svc.state.createStory.draft, null);
  assert.equal(d.rendering.clearCreateStoryModalCalls, 1);
  assert.equal(svc.state.project, "P2");

  p1.resolve([]);
  await nextTurn();
  assert.equal(svc.state.project, "P2");
});

test("story browser main onSubmitCreateStory with validation errors rerenders modal without reloading issues", async function() {
  var d = baseDeps();
  var issuesSpy = 0;
  d.api.getProjectIssues = function(key, onProgress) {
    issuesSpy += 1;
    if (onProgress) {
      onProgress(1, 1);
    }
    return resolved([]);
  };
  d.createStory.hasSubmitValidationErrors = function() {
    return true;
  };
  var modalCalls = 0;
  var origRender = d.rendering.renderCreateStoryModal;
  d.rendering.renderCreateStoryModal = function(draft) {
    modalCalls += 1;
    return origRender.call(d.rendering, draft);
  };
  var Gadget = loadMain(d);
  new Gadget({
    getGadgetContentEl: function() {
      return createElement("page-shell");
    }
  });

  await nextTurn();
  var svc = d.rendering.initCalls[0].services;
  var afterLoad = issuesSpy;
  svc.onOpenCreateStory();
  var afterOpen = modalCalls;
  svc.onSubmitCreateStory();
  assert.ok(modalCalls > afterOpen, "modal rerender on validation failure");
  assert.equal(issuesSpy, afterLoad, "no project reload when validation fails");
});

test("story browser main onSubmitCreateStory success closes modal and reloads current project", async function() {
  var d = baseDeps();
  var issuesSpy = 0;
  d.api.getProjectIssues = function(key, onProgress) {
    issuesSpy += 1;
    if (onProgress) {
      onProgress(1, 1);
    }
    return resolved([]);
  };
  d.createStory.submitCreateDraft = function() {
    return resolved({ ok: true });
  };
  var Gadget = loadMain(d);
  new Gadget({
    getGadgetContentEl: function() {
      return createElement("page-shell");
    }
  });

  await nextTurn();
  var svc = d.rendering.initCalls[0].services;
  var afterLoad = issuesSpy;
  svc.onOpenCreateStory();
  assert.equal(svc.state.createStory.isOpen, true);
  svc.onSubmitCreateStory();
  await nextTurn();
  assert.equal(svc.state.createStory.isOpen, false);
  assert.equal(svc.state.createStory.draft, null);
  assert.equal(d.rendering.clearCreateStoryModalCalls, 1);
  assert.ok(issuesSpy > afterLoad, "loadProject refreshes issues after successful submit");
});

test("story browser main does not rerender create modal on submit failure after user closed modal", async function() {
  var d = baseDeps();
  var pSubmit = createDeferred();
  d.createStory.submitCreateDraft = function() {
    return pSubmit.promise();
  };
  var svc;
  var modalRenderWhileClosed = 0;
  var origRender = d.rendering.renderCreateStoryModal;
  d.rendering.renderCreateStoryModal = function(draft) {
    if (svc && !svc.state.createStory.isOpen) {
      modalRenderWhileClosed += 1;
    }
    return origRender.call(d.rendering, draft);
  };
  var Gadget = loadMain(d);
  new Gadget({
    getGadgetContentEl: function() {
      return createElement("page-shell");
    }
  });

  await nextTurn();
  svc = d.rendering.initCalls[0].services;
  svc.onOpenCreateStory();
  svc.onSubmitCreateStory();
  svc.onCloseCreateStory();
  assert.equal(svc.state.createStory.isOpen, false);
  assert.equal(svc.state.createStory.draft, null);

  pSubmit.resolve({ ok: false });
  await nextTurn();

  assert.equal(
    modalRenderWhileClosed,
    0,
    "must not mount modal into popup host after close when submit completes with failure"
  );
});

test("story browser main does not rerender create modal on submit rejection after user closed modal", async function() {
  var d = baseDeps();
  var pSubmit = createDeferred();
  d.createStory.submitCreateDraft = function() {
    return pSubmit.promise();
  };
  var svc;
  var modalRenderWhileClosed = 0;
  var origRender = d.rendering.renderCreateStoryModal;
  d.rendering.renderCreateStoryModal = function(draft) {
    if (svc && !svc.state.createStory.isOpen) {
      modalRenderWhileClosed += 1;
    }
    return origRender.call(d.rendering, draft);
  };
  var Gadget = loadMain(d);
  new Gadget({
    getGadgetContentEl: function() {
      return createElement("page-shell");
    }
  });

  await nextTurn();
  svc = d.rendering.initCalls[0].services;
  svc.onOpenCreateStory();
  svc.onSubmitCreateStory();
  svc.onCloseCreateStory();

  pSubmit.reject({ status: 500 });
  await nextTurn();

  assert.equal(modalRenderWhileClosed, 0, "must not rerender modal after close on rejected submit chain");
});

test("story browser main stale submit success after close refreshes project without reopening modal", async function() {
  var d = baseDeps();
  var pSubmit = createDeferred();
  var issuesSpy = 0;
  d.api.getProjectIssues = function(key, onProgress) {
    issuesSpy += 1;
    if (onProgress) {
      onProgress(1, 1);
    }
    return resolved([]);
  };
  d.createStory.submitCreateDraft = function() {
    return pSubmit.promise();
  };
  var svc;
  var modalRenderWhileClosed = 0;
  var origRender = d.rendering.renderCreateStoryModal;
  d.rendering.renderCreateStoryModal = function(draft) {
    if (svc && !svc.state.createStory.isOpen) {
      modalRenderWhileClosed += 1;
    }
    return origRender.call(d.rendering, draft);
  };
  var Gadget = loadMain(d);
  new Gadget({
    getGadgetContentEl: function() {
      return createElement("page-shell");
    }
  });

  await nextTurn();
  svc = d.rendering.initCalls[0].services;
  var afterInitLoad = issuesSpy;
  svc.onOpenCreateStory();
  svc.onSubmitCreateStory();
  svc.onCloseCreateStory();
  pSubmit.resolve({ ok: true });
  await nextTurn();

  assert.equal(svc.state.createStory.isOpen, false);
  assert.equal(modalRenderWhileClosed, 0, "must not reopen create modal after stale success");
  assert.ok(issuesSpy > afterInitLoad, "stale success after close should refresh current project");
});

test("story browser main stale submit success does not reload or clear when a new create draft is active", async function() {
  var d = baseDeps();
  var pSubmit = createDeferred();
  var issuesSpy = 0;
  d.api.getProjectIssues = function(key, onProgress) {
    issuesSpy += 1;
    if (onProgress) {
      onProgress(1, 1);
    }
    return resolved([]);
  };
  d.createStory.submitCreateDraft = function() {
    return pSubmit.promise();
  };
  var Gadget = loadMain(d);
  new Gadget({
    getGadgetContentEl: function() {
      return createElement("page-shell");
    }
  });

  await nextTurn();
  var svc = d.rendering.initCalls[0].services;
  var afterInitLoad = issuesSpy;
  svc.onOpenCreateStory();
  svc.onSubmitCreateStory();
  svc.onCloseCreateStory();
  svc.onOpenCreateStory();
  var draftAfterReopen = svc.state.createStory.draft;
  assert.equal(svc.state.createStory.isOpen, true);
  pSubmit.resolve({ ok: true });
  await nextTurn();

  assert.equal(svc.state.createStory.isOpen, true, "new create flow must stay open");
  assert.equal(svc.state.createStory.draft, draftAfterReopen, "new draft must not be cleared");
  assert.equal(
    issuesSpy,
    afterInitLoad,
    "must not loadProject while new create modal open (would clear create state)"
  );
});
