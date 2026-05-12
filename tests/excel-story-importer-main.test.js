const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const loadAmdModule = require("./helpers/load-amd-module");

const MODULE_DIR = path.join(__dirname, "..", "ujg-excel-story-importer-modules");

function flush() {
  return new Promise(function (resolve) {
    setTimeout(resolve, 0);
  });
}

test("file import surfaces parser exceptions as visible errors", async function () {
  const states = [];
  let callbacks = null;
  const rendering = {
    init: function (_container, services) {
      callbacks = services;
    },
    render: function (state) {
      states.push({
        loading: !!state.loading,
        error: state.error || "",
      });
    },
  };
  const api = {
    baseUrl: "https://jira.example.com",
    getProjects: function () {
      return Promise.resolve([]);
    },
  };
  const excelLoader = {
    readWorkbook: function () {
      return Promise.resolve({ SheetNames: [] });
    },
  };
  const parser = {
    parseWorkbook: function () {
      throw new Error("bad workbook");
    },
  };
  const Gadget = loadAmdModule(path.join(MODULE_DIR, "main.js"), {
    jquery: function () {
      return { length: 0 };
    },
    "_ujgESI_api": api,
    "_ujgESI_excel-loader": excelLoader,
    "_ujgESI_parser": parser,
    "_ujgESI_creator": {},
    "_ujgESI_rendering": rendering,
  });

  new Gadget({
    getGadgetContentEl: function () {
      return {
        find: function () {
          return { length: 1 };
        },
      };
    },
    resize: function () {},
  });
  await flush();

  callbacks.onFileChange({ name: "bad.xlsx" });
  await flush();
  await flush();

  const last = states[states.length - 1];
  assert.equal(last.loading, false);
  assert.match(last.error, /Не удалось прочитать Excel: bad workbook/);
});

test("row create allows empty Epic when project is selected", async function () {
  const states = [];
  let callbacks = null;
  let creatorOptions = null;
  const rendering = {
    init: function (_container, services) {
      callbacks = services;
    },
    render: function (state) {
      states.push({
        projectKey: state.projectKey || "",
        epicKey: state.epicKey || "",
        error: state.error || "",
        rows: (state.rows || []).map(function (row) {
          return { status: row.status, createdKey: row.createdKey || "" };
        }),
      });
    },
  };
  const api = {
    baseUrl: "https://jira.example.com",
    getProjects: function () {
      return Promise.resolve([{ key: "EVOSCADA" }]);
    },
    getProjectEpics: function () {
      return Promise.resolve([]);
    },
  };
  const excelLoader = {
    readWorkbook: function () {
      return Promise.resolve({ SheetNames: ["Лист1"] });
    },
  };
  const parser = {
    parseWorkbook: function () {
      return {
        sheetName: "Лист1",
        headerRowNumber: 0,
        rows: [
          {
            summary: "Test jira task",
            sourceColumns: { "Замечание": "Test jira task" },
            status: "ready",
            errors: [],
          },
        ],
      };
    },
  };
  const creator = {
    createRow: function (_api, _row, options) {
      creatorOptions = options;
      return Promise.resolve({ ok: true, createdKey: "EVOSCADA-1", errors: [] });
    },
  };
  const Gadget = loadAmdModule(path.join(MODULE_DIR, "main.js"), {
    jquery: function () {
      return { length: 0 };
    },
    "_ujgESI_api": api,
    "_ujgESI_excel-loader": excelLoader,
    "_ujgESI_parser": parser,
    "_ujgESI_creator": creator,
    "_ujgESI_rendering": rendering,
  });

  new Gadget({
    getGadgetContentEl: function () {
      return {
        find: function () {
          return { length: 1 };
        },
      };
    },
    resize: function () {},
  });
  await flush();

  callbacks.onProjectChange("EVOSCADA");
  await flush();
  callbacks.onFileChange({ name: "rows.xlsx" });
  await flush();
  await flush();
  callbacks.onCreateRow(0);
  await flush();
  await flush();

  assert.equal(creatorOptions.projectKey, "EVOSCADA");
  assert.equal(creatorOptions.epicKey, "");
  assert.equal(creatorOptions.createSubtasks, true);
  const last = states[states.length - 1];
  assert.equal(last.error, "");
  assert.equal(last.rows[0].status, "created");
  assert.equal(last.rows[0].createdKey, "EVOSCADA-1");
});
