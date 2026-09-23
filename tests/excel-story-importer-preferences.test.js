const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const loadAmdModule = require("./helpers/load-amd-module");

const MODULE_DIR = path.join(__dirname, "..", "ujg-excel-story-importer-modules");
const STORAGE_KEY = "ujg-esi-preferences-test";
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

function memoryStorage() {
  const values = new Map();
  return {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
  };
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function loadImporter(options = {}) {
  const app = {};
  const config = loadAmdModule(path.join(MODULE_DIR, "config.js"), {});
  config.STORAGE_KEY = STORAGE_KEY;
  const globals = Object.assign({ localStorage: options.storage }, options.globals);
  const Gadget = loadAmdModule(path.join(MODULE_DIR, "main.js"), {
    jquery: () => ({ length: 0 }),
    _ujgESI_config: config,
    _ujgESI_api: {
      getProjects: options.getProjects || (() => Promise.resolve([{ key: "P1" }, { key: "P2" }])),
      getProjectEpics: options.getProjectEpics || (() => Promise.resolve({ issues: [], total: 200 })),
      getProjectCreateMeta: () => Promise.resolve({ projects: [] }),
    },
    "_ujgESI_excel-loader": { readWorkbook: () => Promise.resolve({ SheetNames: ["S"] }) },
    _ujgESI_parser: { parseWorkbook: () => ({ rows: [{ summary: "Remark", sourceColumns: {}, status: "ready" }] }) },
    _ujgESI_creator: {},
    _ujgESI_mappingStore: null,
    _ujgESI_xlsxPatcher: null,
    _ujgESI_rendering: {
      init: (_container, callbacks) => { app.callbacks = callbacks; },
      render: state => { app.state = state; },
    },
    _ujgESI_teams: null,
    _ujgShared_llmClient: null,
  }, globals);
  new Gadget({ getGadgetContentEl: () => ({ find: () => ({ length: 1 }) }), resize() {} });
  await flush();
  return app;
}

test("preferences restore each project's Epic across switches and reload with a partial list", async () => {
  const storage = memoryStorage();
  const app = await loadImporter({ storage });
  app.callbacks.onProjectChange("P1");
  await flush();
  app.callbacks.onEpicSelect("P1-10");
  app.callbacks.onProjectChange("P2");
  await flush();
  app.callbacks.onEpicSelect("P2-20");
  app.callbacks.onProjectChange("P1");
  assert.equal(app.state.epicKey, "P1-10");
  await flush();
  app.callbacks.onEpicSearch("unrelated query");
  assert.equal(app.state.epicKey, "P1-10");
  const restored = await loadImporter({ storage });
  assert.equal(restored.state.projectKey, "P1");
  assert.equal(restored.state.epicKey, "P1-10");
  restored.callbacks.onProjectChange("P2");
  await flush();
  assert.equal(restored.state.epicKey, "P2-20");
});

test("explicit no Epic survives returning to a project and reload", async () => {
  const storage = memoryStorage();
  const app = await loadImporter({ storage });
  app.callbacks.onProjectChange("P1");
  app.callbacks.onEpicSelect("P1-10");
  app.callbacks.onEpicChange("");
  app.callbacks.onProjectChange("P2");
  app.callbacks.onEpicSelect("P2-20");
  app.callbacks.onProjectChange("P1");
  await flush();
  assert.equal(app.state.epicKey, "");
  const saved = JSON.parse(storage.getItem(app.state.preferencesStorageKey));
  assert.ok(saved, "The exposed preference key must contain the saved selection");
  assert.equal(saved.epicsByProject.P1, "");
  const restored = await loadImporter({ storage });
  assert.equal(restored.state.epicKey, "");
  restored.callbacks.onProjectChange("P2");
  assert.equal(restored.state.epicKey, "P2-20");
});

test("preferences preserve gridLayout and other projects written by another consumer", async () => {
  const storage = memoryStorage();
  const app = await loadImporter({ storage });
  assert.equal(app.state.preferencesStorageKey, STORAGE_KEY);
  app.callbacks.onProjectChange("P1");
  const shared = JSON.parse(storage.getItem(app.state.preferencesStorageKey));
  shared.gridLayout = { widths: { owner: 210 }, hidden: ["module"] };
  shared.epicsByProject = { P2: "P2-99" };
  shared.extra = { retained: true };
  storage.setItem(app.state.preferencesStorageKey, JSON.stringify(shared));
  app.callbacks.onEpicSelect("P1-10");
  app.callbacks.onProjectChange("P2");
  const saved = JSON.parse(storage.getItem(app.state.preferencesStorageKey));
  assert.deepEqual(saved.gridLayout, shared.gridLayout);
  assert.deepEqual(saved.extra, shared.extra);
  assert.equal(saved.projectKey, "P2");
  assert.deepEqual(saved.epicsByProject, { P1: "P1-10", P2: "P2-99" });
  assert.equal(app.state.epicKey, "P2-99");
});

test("Epic responses from an older project visit cannot replace options or loading state", async () => {
  const requests = [];
  const app = await loadImporter({ getProjectEpics: project => {
    const request = Object.assign(deferred(), { project });
    requests.push(request);
    return request.promise;
  } });
  app.callbacks.onProjectChange("P1");
  app.callbacks.onEpicSelect("P1-10");
  app.callbacks.onProjectChange("P2");
  app.callbacks.onProjectChange("P1");
  requests[0].resolve({ issues: [{ key: "P1-OLD" }] });
  requests[1].reject({ statusText: "old failure" });
  await flush();
  assert.equal(app.state.loading, true);
  assert.equal(app.state.error, "");
  assert.equal(app.state.epics.length, 0);
  assert.equal(app.state.epicKey, "P1-10");
  requests[2].resolve({ issues: [{ key: "P1-NEW" }] });
  await flush();
  assert.equal(app.state.loading, false);
  assert.equal(app.state.epics[0].key, "P1-NEW");
  assert.equal(app.state.epicKey, "P1-10");
});

test("clearing a project invalidates pending Epic success and error responses", async () => {
  for (const result of ["resolve", "reject"]) {
    const request = deferred();
    const app = await loadImporter({ getProjectEpics: () => request.promise });
    app.callbacks.onProjectChange("P1");
    app.callbacks.onEpicSelect("P1-10");
    app.callbacks.onProjectChange("");
    request[result](result === "resolve" ? { issues: [{ key: "P1-OLD" }] } : { statusText: "old failure" });
    await flush();
    assert.equal(app.state.projectKey, "");
    assert.equal(app.state.epicKey, "");
    assert.equal(app.state.loading, false);
    assert.equal(app.state.error, "");
    assert.equal(app.state.epics.length, 0);
  }
});

test("an in-flight Epic list and its failure preserve the latest explicit selection", async () => {
  const storage = memoryStorage();
  const requests = [];
  const app = await loadImporter({ storage, getProjectEpics: () => {
    const request = deferred();
    requests.push(request);
    return request.promise;
  } });
  app.callbacks.onProjectChange("P1");
  app.callbacks.onEpicSelect("P1-10");
  requests[0].resolve({ issues: [], total: 300 });
  await flush();
  assert.equal(app.state.epicKey, "P1-10");
  app.callbacks.onProjectChange("P1");
  app.callbacks.onEpicSelect("");
  requests[1].reject({ statusText: "unavailable" });
  await flush();
  assert.equal(app.state.epicKey, "");
  assert.match(app.state.error, /unavailable/);
  const restored = await loadImporter({ storage });
  assert.equal(restored.state.projectKey, "P1");
  assert.equal(restored.state.epicKey, "");
});

test("changing the create dialog project does not reset the main Epic preference", async () => {
  const storage = memoryStorage();
  const app = await loadImporter({ storage });
  app.callbacks.onProjectChange("P1");
  await flush();
  app.callbacks.onEpicSelect("P1-10");
  app.callbacks.onFileChange({ name: "test.xlsx" });
  await flush();
  app.callbacks.onCreateRow(0);
  app.callbacks.onDialogFieldChange("projectKey", "P2");
  await flush();
  assert.equal(app.state.epicKey, "P1-10");
  app.callbacks.onCancelCreate();
  const restored = await loadImporter({ storage });
  assert.equal(restored.state.projectKey, "P1");
  assert.equal(restored.state.epicKey, "P1-10");
});

test("canceling a dialog restores main Epic options and ignores its pending response", async () => {
  const pending = deferred();
  const app = await loadImporter({ getProjectEpics: project => project === "P2" ? pending.promise : Promise.resolve({ issues: [{ key: "P1-10" }] }) });
  app.callbacks.onProjectChange("P1");
  await flush();
  app.callbacks.onEpicSelect("P1-10");
  app.callbacks.onFileChange({ name: "test.xlsx" });
  await flush();
  app.callbacks.onCreateRow(0);
  app.callbacks.onDialogFieldChange("projectKey", "P2");
  app.callbacks.onCancelCreate();
  pending.resolve({ issues: [{ key: "P2-20" }] });
  await flush();
  assert.equal(app.state.epicKey, "P1-10");
  assert.equal(app.state.epics[0] && app.state.epics[0].key, "P1-10");
  assert.equal(app.state.loading, false);
});

test("late initial project response does not revive an explicitly cleared selection", async () => {
  const storage = memoryStorage();
  storage.setItem(STORAGE_KEY, JSON.stringify({ project: "P1" }));
  const pending = deferred();
  const app = await loadImporter({ storage, getProjects: () => pending.promise });
  app.callbacks.onProjectChange("");
  // Even if another consumer restores the legacy state, the current explicit choice wins.
  storage.setItem(STORAGE_KEY, JSON.stringify({ project: "P1" }));
  pending.resolve([{ key: "P1" }]);
  await flush();
  assert.equal(app.state.projectKey, "");
  assert.equal(app.state.epicKey, "");
});

test("AJS user metadata isolates two users while providing a stable scoped key", async () => {
  const storage = memoryStorage();
  function globals(user, username = user) {
    return { window: { AJS: { Meta: { get: key => ({ "remote-user-key": user, "remote-user": username })[key] } } } };
  }
  const alice = await loadImporter({ storage, globals: globals("alice/key") });
  alice.callbacks.onProjectChange("P1");
  alice.callbacks.onEpicSelect("P1-10");
  const bob = await loadImporter({ storage, globals: globals("bob") });
  assert.equal(bob.state.projectKey, "");
  assert.notEqual(alice.state.preferencesStorageKey, bob.state.preferencesStorageKey);
  assert.notEqual(alice.state.preferencesStorageKey, STORAGE_KEY);
  bob.callbacks.onProjectChange("P2");
  bob.callbacks.onEpicSelect("P2-20");
  const restored = await loadImporter({ storage, globals: globals("alice/key", "renamed-alice") });
  assert.equal(restored.state.preferencesStorageKey, alice.state.preferencesStorageKey);
  assert.equal(restored.state.projectKey, "P1");
  assert.equal(restored.state.epicKey, "P1-10");
  assert.equal(storage.getItem(STORAGE_KEY), null);
});

test("DOM Jira user metadata and AJS metadata produce the same preference scope", async () => {
  const storage = memoryStorage();
  const app = await loadImporter({ storage, globals: { AJS: { Meta: { get: key => key === "remote-user" ? "alice" : "" } } } });
  app.callbacks.onProjectChange("P1");
  app.callbacks.onEpicSelect("P1-10");
  const restored = await loadImporter({ storage, globals: { document: {
    querySelector: selector => selector === 'meta[name="ajs-remote-user"]' ? { getAttribute: () => "alice" } : null,
  } } });
  assert.notEqual(restored.state.preferencesStorageKey, STORAGE_KEY);
  assert.equal(restored.state.preferencesStorageKey, app.state.preferencesStorageKey);
  assert.equal(restored.state.epicKey, "P1-10");
});

test("legacy project read works for scoped preferences without adopting legacy Epics or layout", async () => {
  const storage = memoryStorage();
  const legacy = { project: "P1", epicsByProject: { P1: "P1-LEGACY" }, gridLayout: { hidden: ["owner"] } };
  storage.setItem(STORAGE_KEY, JSON.stringify(legacy));
  const globals = { AJS: { Meta: { get: () => "alice" } } };
  const app = await loadImporter({ storage, globals });
  assert.equal(app.state.projectKey, "P1");
  assert.equal(app.state.epicKey, "");
  app.callbacks.onProjectChange("");
  const restored = await loadImporter({ storage, globals });
  assert.equal(restored.state.projectKey, "");
  assert.deepEqual(JSON.parse(storage.getItem(STORAGE_KEY)), legacy);
  const scoped = JSON.parse(storage.getItem(app.state.preferencesStorageKey));
  assert.equal(scoped.gridLayout, undefined);
});

test("local fallback reads legacy project and persists its explicit clearing", async () => {
  const storage = memoryStorage();
  storage.setItem(STORAGE_KEY, JSON.stringify({ project: "P1" }));
  const app = await loadImporter({ storage });
  assert.equal(app.state.projectKey, "P1");
  app.callbacks.onProjectChange("");
  const restored = await loadImporter({ storage });
  assert.equal(restored.state.projectKey, "");
});

test("malformed storage is ignored and subsequent selections remain persistable", async () => {
  for (const raw of ["{", "null", "[]", '"bad"', '{"projectKey":"P1","epicsByProject":[]}', '{"projectKey":"P1","epicsByProject":{"P1":{}}}']) {
    const storage = memoryStorage();
    storage.setItem(STORAGE_KEY, raw);
    const app = await loadImporter({ storage });
    assert.equal(app.state.epicKey, "");
    app.callbacks.onProjectChange("P1");
    app.callbacks.onEpicSelect("P1-10");
    const restored = await loadImporter({ storage });
    assert.equal(restored.state.epicKey, "P1-10");
  }
});

test("unavailable storage and throwing user metadata preserve in-session choices", async () => {
  const denied = () => { throw new Error("denied"); };
  // The VM helper copies globals, so a getter on its window exercises browser access denial.
  const deniedWindow = { AJS: { Meta: { get: denied } } };
  Object.defineProperty(deniedWindow, "localStorage", { get: denied });
  for (const options of [
    {},
    { storage: { getItem: denied, setItem: denied } },
    { storage: { getItem: () => null, setItem: denied } },
    { globals: { window: deniedWindow } },
  ]) {
    const app = await loadImporter(options);
    app.callbacks.onProjectChange("P1");
    app.callbacks.onEpicSelect("P1-10");
    app.callbacks.onProjectChange("P2");
    app.callbacks.onProjectChange("P1");
    await flush();
    assert.equal(app.state.epicKey, "P1-10");
    assert.equal(app.state.preferencesStorageKey, STORAGE_KEY);
    assert.equal(app.state.error, "");
  }
});
