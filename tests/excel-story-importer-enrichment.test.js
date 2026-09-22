const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const loadAmdModule = require("./helpers/load-amd-module");
const MODULE_DIR = path.join(__dirname, "..", "ujg-excel-story-importer-modules");
const flush = () => new Promise(resolve => setTimeout(resolve, 0));
const plain = value => JSON.parse(JSON.stringify(value));

async function loadImporter(rows, api) {
  const config = loadAmdModule(path.join(MODULE_DIR, "config.js"), {});
  const description = loadAmdModule(path.join(MODULE_DIR, "description.js"), {});
  const creator = loadAmdModule(path.join(MODULE_DIR, "creator.js"), {
    _ujgESI_config: config, _ujgESI_description: description,
    _ujgESI_remarkId: loadAmdModule(path.join(MODULE_DIR, "remark-id.js"), {}),
  });
  const app = {};
  const Gadget = loadAmdModule(path.join(MODULE_DIR, "main.js"), {
    jquery: () => ({ length: 0 }),
    _ujgESI_config: config,
    _ujgESI_api: Object.assign({
      getProjects: () => Promise.resolve([{ key: "TEST", name: "Test" }]),
      getProjectEpics: () => Promise.resolve({ issues: [] }),
      getProjectCreateMeta: () => Promise.resolve({ projects: [] }),
    }, api),
    "_ujgESI_excel-loader": {
      readFileBuffer: () => Promise.resolve(new ArrayBuffer(1)),
      readWorkbookFromBuffer: () => Promise.resolve({ SheetNames: ["Sheet1"] }),
    },
    _ujgESI_parser: { parseWorkbook: () => ({ sheetName: "Sheet1", rows }) },
    _ujgESI_creator: creator,
    _ujgESI_mappingStore: null,
    _ujgESI_xlsxPatcher: { patchWorkbook: () => Promise.resolve(new ArrayBuffer(1)) },
    _ujgESI_rendering: {
      init: (_container, callbacks) => { app.callbacks = callbacks; },
      render: state => { app.state = state; },
    },
    _ujgShared_llmClient: null,
  });
  new Gadget({ getGadgetContentEl: () => ({ find: () => ({ length: 1 }) }), resize() {} });
  await flush();
  app.callbacks.onFileChange({ name: "test.xlsx" });
  await flush();
  await flush();
  return app;
}

function history(created, to, toString, from, fromString) {
  return { created, items: [{ field: "status", to, toString, from, fromString }] };
}

test("explicit sync enriches Story and child fields without extra requests or issue writes", async function () {
  const calls = [];
  let issues = [{
    key: "TEST-1",
    fields: {
      summary: "Existing Story", status: { id: "3", name: "In Progress" },
      assignee: { displayName: "Иван" }, priority: { name: "High" }, issuetype: { name: "Story" },
      created: "2026-01-01T10:00:00.000+0300", updated: "2026-03-03T10:00:00.000+0300",
      issuelinks: [{ type: { name: "Child" }, outwardIssue: { key: "TEST-2", fields: { summary: "[FE] Existing child" } } }],
    },
    changelog: { startAt: 0, total: 3, histories: [
      history("2026-03-01T10:00:00.000+0300", "3", "In Progress", "1", "Open"),
      { created: "2026-03-03T10:00:00.000+0300", items: [{ field: "summary" }] },
      history("2026-02-01T10:00:00.000+0300", "1", "Open", "3", "In Progress"),
    ] },
  }];
  const child = {
    key: "TEST-2", fields: {
      summary: "[FE] Existing child", status: { id: "1", name: "Open", statusCategory: { key: "new" } },
      assignee: { name: "developer" }, priority: { name: "Low" }, issuetype: { name: "Task" },
      created: "2026-02-01T00:00:00Z", updated: "2026-02-02T00:00:00Z",
    }, changelog: { startAt: 0, total: 0, histories: [] },
  };
  const inputRow = { jiraKey: "TEST-1", summary: "Source remark", alreadyLinked: true, sourceColumns: { "№": 42 } };
  const app = await loadImporter([inputRow], {
    getIssuesByKeys(keys, options) {
      calls.push({ keys: Array.from(keys), options: plain(options || {}) });
      return Promise.resolve({ issues: keys[0] === "TEST-2" ? [child] : issues });
    },
    createIssue() { assert.fail("Sync must not create issues"); },
    updateIssue() { assert.fail("Sync must not update issues"); },
  });
  const row = app.state.rows[0];
  assert.equal(calls.length, 0);
  app.callbacks.onSyncJira();
  await flush();
  await flush();
  assert.deepEqual(calls, [
    { keys: ["TEST-1"], options: { expand: "changelog" } },
    { keys: ["TEST-2"], options: { expand: "changelog" } },
  ]);
  assert.equal(app.state.syncError, "");
  assert.deepEqual(plain(row.storyDetails), {
    key: "TEST-1", summary: "Existing Story", status: "In Progress", assignee: "Иван",
    statusCategory: "", statusState: "progress", done: false,
    priority: "High", issueType: "Story", updated: "2026-03-03T10:00:00.000+0300",
    statusSince: "2026-03-01T07:00:00.000Z", statusSinceReason: row.storyDetails.statusSinceReason,
  });
  assert.match(row.storyDetails.statusSinceReason, /истор|переход/i);
  assert.deepEqual(plain(row.childStatuses[0]), {
    role: "FE", key: "TEST-2", summary: "[FE] Existing child", status: "Open",
    statusCategory: "new", statusState: "todo", done: false, assignee: "developer", blocked: false,
    priority: "Low", issueType: "Task", updated: "2026-02-02T00:00:00Z",
    statusSince: "2026-02-01T00:00:00.000Z", statusSinceReason: row.childStatuses[0].statusSinceReason,
  });
  assert.match(row.childStatuses[0].statusSinceReason, /создани/i);
  assert.equal(row.summary, "Source remark");
  app.callbacks.onCreateRow(0);
  assert.equal(app.state.createDialog, null);
  issues = [];
  app.callbacks.onSyncJira();
  await flush();
  await flush();
  assert.equal(row.storyDetails, null, "Missing issues must clear stale details");
  assert.deepEqual(plain(row.childStatuses), []);
});

const transition = history("2026-02-01T10:00:00+0300", "3", "In Progress", "1", "Open");
const complete = histories => ({ startAt: 0, total: histories.length, histories });
const statusDateCases = [
  { name: "no changelog", changelog: undefined, reason: /недоступ|отсутств/i },
  { name: "empty histories without completeness", changelog: { histories: [] }, reason: /полн/i },
  { name: "nonempty histories without completeness", changelog: { histories: [transition] }, reason: /полн/i },
  { name: "truncated history", changelog: { startAt: 0, total: 2, histories: [transition] }, reason: /полн/i },
  { name: "later page", changelog: { startAt: 1, total: 1, histories: [transition] }, reason: /полн/i },
  { name: "more pages flagged", changelog: { startAt: 0, total: 1, isLast: false, histories: [transition] }, reason: /полн/i },
  { name: "current status ID mismatch despite matching name", changelog: complete([history("2026-02-01T00:00:00Z", "2", "In Progress")]), reason: /совпад/i },
  { name: "current status name mismatch without IDs", changelog: complete([history("2026-02-01T00:00:00Z", null, "Done")]), reason: /совпад/i },
  { name: "invalid transition timestamp", changelog: complete([history("invalid", "3", "In Progress")]), reason: /дат|врем/i },
  { name: "timezone missing", changelog: complete([history("2026-02-01T00:00:00", "3", "In Progress")]), reason: /дат|врем/i },
  { name: "invalid calendar date", changelog: complete([history("2026-02-30T00:00:00Z", "3", "In Progress")]), reason: /дат|врем/i },
  { name: "transition predates issue creation", changelog: complete([history("2025-12-31T00:00:00Z", "3", "In Progress")]), reason: /дат|создани/i },
  { name: "transition exceeds issue update time", changelog: complete([transition]), updated: "2026-01-02T00:00:00Z", reason: /дат|обновлен/i },
  { name: "duplicate histories do not prove completeness", changelog: complete([
    Object.assign({ id: "17" }, transition),
    Object.assign({ id: "17" }, history("2026-03-01T00:00:00Z", "3", "In Progress")),
  ]), reason: /полн|повтор/i },
  { name: "same-status event keeps the actual status entry date", changelog: complete([
    transition, history("2026-03-01T00:00:00Z", "3", "In Progress", "3", "In Progress"),
  ]), expected: "2026-02-01T07:00:00.000Z" },
  { name: "malformed history", changelog: complete([{ created: "2026-02-01T00:00:00Z" }]), reason: /полн/i },
  { name: "broken transition chain", changelog: complete([transition, history("2026-03-01T00:00:00Z", "3", "In Progress", "2", "Done")]), reason: /полн|соглас/i },
  { name: "ambiguous same-time transitions", changelog: complete([transition, history("2026-02-01T10:00:00+0300", "3", "In Progress", "2", "Done")]), reason: /поряд|врем|однознач/i },
  { name: "explicit empty complete history", changelog: complete([]), expected: "2026-01-01T00:00:00.000Z" },
  { name: "complete total without startAt", changelog: { total: 0, histories: [] }, expected: "2026-01-01T00:00:00.000Z" },
  { name: "explicit only last page", changelog: { startAt: 0, isLast: true, histories: [transition] }, expected: "2026-02-01T07:00:00.000Z" },
  { name: "non-status history only", changelog: complete([{ items: [{ field: "assignee" }] }]), expected: "2026-01-01T00:00:00.000Z" },
  { name: "missing created for complete empty history", changelog: complete([]), created: null, reason: /дат|создани/i },
  { name: "current status name renamed with same ID", changelog: complete([history("2026-02-01T00:00:00Z", "3", "Old name")]), expected: "2026-02-01T00:00:00.000Z" },
  { name: "localized field with status fieldId", changelog: complete([{ created: "2026-02-01T00:00:00Z", items: [{ field: "Статус", fieldId: "status", to: "3" }] }]), expected: "2026-02-01T00:00:00.000Z" },
  { name: "status name fallback", changelog: complete([history("2026-02-01T00:00:00Z", null, "In Progress")]), expected: "2026-02-01T00:00:00.000Z" },
];

for (const scenario of statusDateCases) {
  test("sync statusSince: " + scenario.name, async function () {
    const app = await loadImporter([{ jiraKey: "TEST-1", sourceColumns: {} }], {
      getIssuesByKeys: () => Promise.resolve({ issues: [{
        key: "TEST-1", changelog: scenario.changelog,
        fields: { status: { id: "3", name: "In Progress" }, created: scenario.created === null ? null : "2026-01-01T00:00:00Z", updated: scenario.updated },
      }] }),
    });
    const row = app.state.rows[0];
    app.callbacks.onSyncJira();
    await flush();
    await flush();
    assert.ok(row.storyDetails, "Sync must expose Story details");
    assert.equal(row.storyDetails.statusSince, scenario.expected || "");
    assert.match(row.storyDetails.statusSinceReason, scenario.reason || /истор|создани|переход/i);
    assert.equal(row.storyDetails.priority, "");
    assert.equal(row.storyDetails.issueType, "");
    assert.equal(row.storyDetails.updated, scenario.updated || "");
  });
}

test("API expands changelog only when requested and retains one existing search per nonempty key set", async function () {
  const calls = [];
  const api = loadAmdModule(path.join(MODULE_DIR, "api.js"), {
    jquery: { ajax(options) { calls.push(options); return Promise.resolve({ issues: [] }); } },
    _ujgESI_config: { baseUrl: "https://jira.invalid", SPRINT_FIELD: "customfield_42" },
  });
  await api.getIssuesByKeys([], { expand: "changelog" });
  assert.equal(calls.length, 0);
  await api.getIssuesByKeys(["test-1", "TEST-1"], { expand: "changelog" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://jira.invalid/rest/api/2/search");
  assert.equal(calls[0].type, "POST");
  const body = JSON.parse(calls[0].data);
  assert.equal(body.expand, "changelog");
  assert.equal(body.jql, "key in (TEST-1)");
  assert.equal(body.maxResults, 1);
  for (const field of ["summary", "status", "assignee", "priority", "issuetype", "updated", "created", "issuelinks", "resolution", "resolutiondate", "customfield_42", "customfield_10020", "customfield_10007"]) {
    assert.ok(body.fields.includes(field), field);
  }
  await api.getIssuesByKeys(["TEST-2"]);
  assert.equal(calls.length, 2);
  assert.equal(JSON.parse(calls[1].data).expand, undefined);
});

test("create preview and edits keep remark numbers through confirmation without altering source text", async function () {
  const calls = [];
  const row = { id: "internal-999", excelRowNumber: 123, summary: "Source remark", sourceColumns: { "№": 42, "Замечание": "Source remark" } };
  const app = await loadImporter([row], {
    createIssue(payload) { calls.push(plain(payload.fields)); return Promise.resolve({ key: "TEST-" + calls.length }); },
    createIssueLink: () => Promise.resolve({}),
  });
  app.callbacks.onProjectChange("TEST");
  app.callbacks.onCreateRow(0);
  assert.equal(calls.length, 0);
  assert.equal(app.state.createDialog.summary, "№42 Source remark");
  assert.equal(app.state.createDialog.childTasks[0].summary, "[SE] №42 Source remark");
  assert.equal(app.state.createDialog.sourceRows.find(source => source.name === "Замечание").value, "Source remark");
  app.callbacks.onDialogFieldChange("summary", "Edited Story");
  assert.equal(app.state.createDialog.summary, "№42 Edited Story");
  assert.equal(app.state.createDialog.childTasks[0].summary, "[SE] №42 Edited Story");
  app.callbacks.onDialogChildChange(0, "summary", "Edited child");
  assert.equal(app.state.createDialog.childTasks[0].summary, "[SE] №42 Edited child");
  const preview = plain(app.state.createDialog);
  app.callbacks.onConfirmCreate();
  await flush();
  await flush();
  assert.equal(calls[0].summary, preview.summary);
  assert.deepEqual(calls.slice(1).map(fields => fields.summary), preview.childTasks.map(task => task.summary));
  assert.equal(row.summary, "Source remark");
  const count = calls.length;
  app.callbacks.onCreateRow(0);
  app.callbacks.onConfirmCreate();
  await flush();
  assert.equal(calls.length, count);
});
