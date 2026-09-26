const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const loadAmdModule = require("./helpers/load-amd-module");
const moduleDir = path.join(__dirname, "..", "ujg-excel-story-importer-modules");

function creatorModule() {
  return loadAmdModule(path.join(moduleDir, "creator.js"), {
    _ujgESI_config: loadAmdModule(path.join(moduleDir, "config.js"), {}),
    _ujgESI_description: loadAmdModule(path.join(moduleDir, "description.js"), {}),
    _ujgESI_remarkId: loadAmdModule(path.join(moduleDir, "remark-id.js"), {}),
  });
}

test("new children use the created Story's Jira priority even when mapping requested another", async function () {
  const creator = creatorModule();
  const created = [];
  const links = [];
  const result = await creator.createRow({
    createIssue(payload) {
      created.push(payload.fields);
      return Promise.resolve({ key: "TEST-" + created.length });
    },
    getIssueWithHistory(key) {
      assert.equal(key, "TEST-1");
      return Promise.resolve({ key, fields: { priority: { name: "Highest" } } });
    },
    createIssueLink(payload) { links.push(payload); return Promise.resolve({}); },
  }, { summary: "Story", sourceColumns: { "Приоритет": "Высокий" } }, {
    projectKey: "TEST", createSubtasks: true,
    childTasks: [{ role: "FE", issueType: "Task" }, { role: "BE", issueType: "Task" }],
  });

  assert.equal(result.ok, true);
  assert.equal(created[0].priority.name, "High");
  assert.deepEqual(created.slice(1).map(fields => fields.priority.name), ["Highest", "Highest"]);
  assert.equal(created[1].parent, undefined);
  assert.deepEqual(links.map(link => [link.outwardIssue.key, link.inwardIssue.key]), [
    ["TEST-1", "TEST-2"], ["TEST-1", "TEST-3"],
  ]);
});

test("additional children use existing Story priority instead of Excel priority", async function () {
  const creator = creatorModule();
  const created = [];
  const result = await creator.createAdditionalTasks({
    createIssue(payload) { created.push(payload.fields); return Promise.resolve({ key: "TEST-2" }); },
    createIssueLink() { return Promise.resolve({}); },
  }, {
    jiraKey: "TEST-1", summary: "Story", storyDetails: { priority: "Low" },
    sourceColumns: { "Приоритет": "Высокий" },
  }, { projectKey: "TEST", childTasks: [{ role: "FE", issueType: "Task" }] });

  assert.equal(result.ok, true);
  assert.equal(created[0].priority.name, "Low");
  assert.equal(created[0].parent, undefined);
});

test("additional children accept explicit current parent priority and never infer it from Excel", async function () {
  const creator = creatorModule();
  const created = [];
  const api = {
    createIssue(payload) { created.push(payload.fields); return Promise.resolve({ key: "TEST-2" }); },
    createIssueLink() { return Promise.resolve({}); },
  };
  const row = { jiraKey: "TEST-1", summary: "Story", sourceColumns: { "Приоритет": "Высокий" } };
  const options = { projectKey: "TEST", childTasks: [{ role: "FE", issueType: "Task" }] };

  await creator.createAdditionalTasks(api, row, { ...options, parentPriority: "Medium" });
  assert.equal(created[0].priority.name, "Medium");
  await creator.createAdditionalTasks(api, row, options);
  assert.equal(created[1].priority, undefined);
});

test("a failed priority read retains the new Story key and does not create children", async function () {
  const creator = creatorModule();
  const created = [];
  const result = await creator.createRow({
    createIssue(payload) { created.push(payload.fields); return Promise.resolve({ key: "TEST-1" }); },
    getIssueWithHistory() { return Promise.reject(new Error("priority read failed")); },
    createIssueLink() { throw new Error("unexpected link"); },
  }, { summary: "Story", sourceColumns: { "Приоритет": "Высокий" } }, {
    projectKey: "TEST", createSubtasks: true, childTasks: [{ role: "FE", issueType: "Task" }],
  });

  assert.equal(result.ok, false);
  assert.equal(result.partial, true);
  assert.equal(result.createdKey, "TEST-1");
  assert.equal(created.length, 1);
  assert.match(result.errors.join(" "), /priority read failed/);
});

for (const issue of [
  null,
  { key: "TEST-2", fields: { priority: { name: "High" } } },
  { key: "TEST-1", fields: {} },
  { key: "TEST-1", fields: { priority: { name: "  " } } },
]) {
  test("malformed created Story priority read keeps the key and blocks child writes: " + JSON.stringify(issue), async function () {
    const creator = creatorModule();
    let writes = 0;
    const result = await creator.createRow({
      createIssue() { writes++; return Promise.resolve({ key: "TEST-1" }); },
      getIssueWithHistory() { return Promise.resolve(issue); },
      createIssueLink() { throw new Error("unexpected link"); },
    }, { summary: "Story", sourceColumns: { "Приоритет": "Высокий" } }, {
      projectKey: "TEST", createSubtasks: true, childTasks: [{ role: "FE", issueType: "Task" }],
    });
    assert.equal(result.ok, false);
    assert.equal(result.partial, true);
    assert.equal(result.createdKey, "TEST-1");
    assert.equal(writes, 1);
    assert.match(result.errors.join(" "), /priority/i);
  });
}
