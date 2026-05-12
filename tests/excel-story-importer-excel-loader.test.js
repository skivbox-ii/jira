const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const loadAmdModule = require("./helpers/load-amd-module");

const MODULE_DIR = path.join(__dirname, "..", "ujg-excel-story-importer-modules");

function loadConfig() {
  return loadAmdModule(path.join(MODULE_DIR, "config.js"), {});
}

function loadExcelLoader(extraGlobals) {
  const config = loadConfig();
  return {
    config,
    loader: loadAmdModule(
      path.join(MODULE_DIR, "excel-loader.js"),
      { "_ujgESI_config": config },
      extraGlobals
    ),
  };
}

test("readWorkbook reloads SheetJS when global XLSX is not usable", async function () {
  const existingXlsx = { version: "partial" };
  const appendedUrls = [];
  let readArgs = null;
  const workbook = { SheetNames: ["Журнал"], Sheets: {} };

  const document = {
    createElement: function () {
      return {};
    },
    head: {
      appendChild: function (script) {
        appendedUrls.push(script.src);
        existingXlsx.read = function (buffer, options) {
          readArgs = { buffer, options };
          return workbook;
        };
        existingXlsx.utils = {
          sheet_to_json: function () {
            return [];
          },
        };
        script.onload();
      },
    },
  };

  const loaded = loadExcelLoader({ document, XLSX: existingXlsx });
  const buffer = new ArrayBuffer(8);
  const result = await loaded.loader.readWorkbook({
    arrayBuffer: function () {
      return Promise.resolve(buffer);
    },
  });

  assert.equal(result, workbook);
  assert.deepEqual(appendedUrls, [loaded.config.DEFAULT_SHEETJS_URL]);
  assert.equal(readArgs.buffer, buffer);
  assert.equal(readArgs.options.type, "array");
  assert.equal(readArgs.options.cellDates, true);
});

test("readWorkbook resolves SheetJS from AMD module when CDN defines xlsx", async function () {
  const windowXlsx = {};
  const appendedUrls = [];
  const requireCalls = [];
  let readArgs = null;
  const workbook = { SheetNames: ["Журнал"], Sheets: {} };
  const amdXlsx = {
    read: function (buffer, options) {
      readArgs = { buffer, options };
      return workbook;
    },
    utils: {
      sheet_to_json: function () {
        return [];
      },
    },
  };

  const document = {
    createElement: function () {
      return {};
    },
    head: {
      appendChild: function (script) {
        appendedUrls.push(script.src);
        script.onload();
      },
    },
  };
  function require(names, resolve, reject) {
    requireCalls.push(names.slice());
    if (names[0] === "xlsx") {
      resolve(amdXlsx);
      return;
    }
    reject(new Error("unexpected module"));
  }

  const loaded = loadExcelLoader({
    document,
    window: { XLSX: windowXlsx },
    require,
  });
  const buffer = new ArrayBuffer(4);
  const result = await loaded.loader.readWorkbook({
    arrayBuffer: function () {
      return Promise.resolve(buffer);
    },
  });

  assert.equal(result, workbook);
  assert.deepEqual(appendedUrls, [loaded.config.DEFAULT_SHEETJS_URL]);
  assert.equal(requireCalls.length, 1);
  assert.equal(requireCalls[0].length, 1);
  assert.equal(requireCalls[0][0], "xlsx");
  assert.equal(readArgs.buffer, buffer);
  assert.equal(readArgs.options.type, "array");
  assert.equal(readArgs.options.cellDates, true);
});
