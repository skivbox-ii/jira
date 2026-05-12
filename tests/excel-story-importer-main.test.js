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
