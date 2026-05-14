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

test("mapping store loads dashboard property and saves the normalized mappings back", async function () {
  const localStorage = createLocalStorage();
  const ajaxCalls = [];
  const $ = {
    ajax: function (options) {
      ajaxCalls.push(options);
      if (options.type === "GET") {
        return Promise.resolve({
          key: "ujg-esi-mapping-settings-test",
          value: {
            mappings: {
              moduleComponentMap: { "Примитивы": "Primitive Component" },
              priorityMap: { "Срочно": "Highest" },
              columnMap: { summary: "Тема", jira: "Тикет" },
              tableStart: { headerMarker: "Тема" },
              sheetName: "Замечания",
              roles: [{ role: "QA", issueType: "QA", originalEstimate: "3h", remainingEstimate: "3h", enabled: false }],
            },
          },
        });
      }
      return Promise.resolve({});
    },
  };
  const module = loadStore($, localStorage, { location: { search: "?selectPageId=77" } });
  const store = module.create();

  const loaded = await store.load();
  assert.equal(loaded.moduleComponentMap["Примитивы"], "Primitive Component");
  assert.equal(loaded.priorityMap["Срочно"], "Highest");
  assert.equal(loaded.columnMap.summary, "Тема");
  assert.equal(loaded.tableStart.headerMarker, "Тема");
  assert.equal(loaded.sheetName, "Замечания");
  assert.equal(loaded.roles[0].enabled, false);
  assert.match(ajaxCalls[0].url, /\/rest\/api\/2\/dashboard\/77\/properties\/ujg-esi-mapping-settings-test/);

  await store.save({
    moduleComponentMap: { "Модуль": "Component" },
    priorityMap: { "Средний": "Medium" },
    columnMap: { summary: "Замечание", jira: "Jira" },
    tableStart: { headerMarker: "Замечание" },
    sheetName: "Журнал приемки",
    roles: [{ role: "SE", issueType: "System Engineer", originalEstimate: "2h", remainingEstimate: "1h", enabled: true }],
  });

  assert.equal(ajaxCalls[1].type, "PUT");
  assert.deepEqual(JSON.parse(ajaxCalls[1].data).mappings.moduleComponentMap, { "Модуль": "Component" });
  assert.equal(JSON.parse(ajaxCalls[1].data).mappings.columnMap.summary, "Замечание");
  assert.equal(JSON.parse(ajaxCalls[1].data).mappings.tableStart.headerMarker, "Замечание");
  assert.equal(JSON.parse(ajaxCalls[1].data).mappings.sheetName, "Журнал приемки");
  assert.deepEqual(JSON.parse(localStorage.getItem("ujg-esi-mapping-settings-test")).mappings.priorityMap, { "Средний": "Medium" });
});
