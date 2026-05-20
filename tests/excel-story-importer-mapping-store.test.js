const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const loadAmdModule = require("./helpers/load-amd-module");

const MODULE_DIR = path.join(__dirname, "..", "ujg-excel-story-importer-modules");

function createLocalStorage() {
  const values = {};
  return {
    getItem: function (key) {
      return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : null;
    },
    setItem: function (key, value) {
      values[key] = String(value);
    },
  };
}

function loadStore($, localStorage, window) {
  const config = {
    baseUrl: "https://jira.example.com",
    MAPPING_STORAGE_KEY: "ujg-esi-mapping-settings-test",
    CREATE_TEMPLATE_ROLES: [
      { role: "SE", issueType: "System Engineer", originalEstimate: "4h", remainingEstimate: "4h" },
    ],
    MODULE_COMPONENT_MAP: {
      "Алармы": "Алармы",
    },
    PRIORITY_MAP: {
      "Высокий": "High",
    },
  };
  return loadAmdModule(
    path.join(MODULE_DIR, "mapping-store.js"),
    {
      jquery: $,
      "_ujgESI_config": config,
    },
    {
      localStorage,
      window,
      Promise,
    }
  );
}

test("mapping store loads and saves mappings only in localStorage", async function () {
  const localStorage = createLocalStorage();
  const ajaxCalls = [];
  const $ = {
    ajax: function (options) {
      ajaxCalls.push(options);
      return Promise.reject(new Error("mapping store must not call Jira REST"));
    },
  };
  localStorage.setItem("ujg-esi-mapping-settings-test", JSON.stringify({
    mappings: {
      moduleComponentMap: { "Примитивы": "Primitive Component" },
      priorityMap: { "Срочно": "Highest" },
      columnMap: { summary: "Тема", jira: "Тикет" },
      tableStart: { headerMarker: "Тема" },
      sheetName: "Замечания",
      storyAssigneeId: "story-acc",
      storyAssigneeLabel: "Story User",
      storyAssignee: { accountId: "story-acc", displayName: "Story User" },
      roles: [
        {
          role: "QA",
          issueType: "QA",
          originalEstimate: "3h",
          remainingEstimate: "3h",
          enabled: false,
          assigneeId: "qa-name",
          assigneeLabel: "QA User",
          assignee: { name: "qa-name", displayName: "QA User" },
        },
      ],
    },
  }));
  const module = loadStore($, localStorage, { location: { search: "?selectPageId=77" } });
  const store = module.create();

  const loaded = await store.load();
  assert.equal(loaded.moduleComponentMap["Примитивы"], "Primitive Component");
  assert.equal(loaded.priorityMap["Срочно"], "Highest");
  assert.equal(loaded.columnMap.summary, "Тема");
  assert.equal(loaded.tableStart.headerMarker, "Тема");
  assert.equal(loaded.sheetName, "Замечания");
  assert.equal(loaded.storyAssigneeId, "story-acc");
  assert.equal(loaded.storyAssignee.accountId, "story-acc");
  assert.equal(loaded.storyAssignee.displayName, "Story User");
  assert.equal(loaded.roles[0].enabled, false);
  assert.equal(loaded.roles[0].assigneeId, "qa-name");
  assert.equal(loaded.roles[0].assignee.name, "qa-name");
  assert.equal(loaded.roles[0].assignee.displayName, "QA User");
  assert.equal(ajaxCalls.length, 0);

  await store.save({
    moduleComponentMap: { "Модуль": "Component" },
    priorityMap: { "Средний": "Medium" },
    columnMap: { summary: "Замечание", jira: "Jira" },
    tableStart: { headerMarker: "Замечание" },
    sheetName: "Журнал приемки",
    storyAssigneeId: "lead-acc",
    storyAssigneeLabel: "Lead User",
    storyAssignee: { accountId: "lead-acc", displayName: "Lead User" },
    roles: [
      {
        role: "SE",
        issueType: "System Engineer",
        originalEstimate: "2h",
        remainingEstimate: "1h",
        enabled: true,
        assigneeId: "se-name",
        assigneeLabel: "SE User",
        assignee: { name: "se-name", displayName: "SE User" },
      },
    ],
  });

  assert.equal(ajaxCalls.length, 0);
  assert.deepEqual(JSON.parse(localStorage.getItem("ujg-esi-mapping-settings-test")).mappings.priorityMap, { "Средний": "Medium" });
  assert.deepEqual(JSON.parse(localStorage.getItem("ujg-esi-mapping-settings-test")).mappings.moduleComponentMap, { "Модуль": "Component" });
  assert.equal(JSON.parse(localStorage.getItem("ujg-esi-mapping-settings-test")).mappings.columnMap.summary, "Замечание");
  assert.equal(JSON.parse(localStorage.getItem("ujg-esi-mapping-settings-test")).mappings.tableStart.headerMarker, "Замечание");
  assert.equal(JSON.parse(localStorage.getItem("ujg-esi-mapping-settings-test")).mappings.sheetName, "Журнал приемки");
  assert.equal(JSON.parse(localStorage.getItem("ujg-esi-mapping-settings-test")).mappings.storyAssigneeId, "lead-acc");
  assert.equal(JSON.parse(localStorage.getItem("ujg-esi-mapping-settings-test")).mappings.roles[0].assigneeId, "se-name");
  assert.equal(JSON.parse(localStorage.getItem("ujg-esi-mapping-settings-test")).mappings.roles[0].assignee.displayName, "SE User");
});

test("mapping store keeps draft mapping rows with empty Jira value", async function () {
  const localStorage = createLocalStorage();
  const module = loadStore({}, localStorage, { location: { search: "" } });
  const store = module.create();

  await store.save({
    moduleComponentMap: { "Новый модуль": "" },
    priorityMap: { "Новое значение": "" },
    columnMap: {},
    tableStart: {},
    roles: [],
  });

  const saved = JSON.parse(localStorage.getItem("ujg-esi-mapping-settings-test")).mappings;
  assert.deepEqual(saved.moduleComponentMap, { "Новый модуль": "" });
  assert.deepEqual(saved.priorityMap, { "Новое значение": "" });

  const loaded = await store.load();
  assert.deepEqual(Object.assign({}, loaded.moduleComponentMap), { "Новый модуль": "" });
  assert.deepEqual(Object.assign({}, loaded.priorityMap), { "Новое значение": "" });
});
