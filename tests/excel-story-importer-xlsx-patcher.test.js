const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const loadAmdModule = require("./helpers/load-amd-module");

const MODULE_DIR = path.join(__dirname, "..", "ujg-excel-story-importer-modules");

function loadPatcher(extraGlobals) {
  const config = loadAmdModule(path.join(MODULE_DIR, "config.js"), {});
  return {
    config,
    patcher: loadAmdModule(
      path.join(MODULE_DIR, "xlsx-patcher.js"),
      {
        "_ujgESI_config": config,
      },
      extraGlobals
    ),
  };
}

test("ensureJsZip resolves JSZip from AMD module when CDN keeps it off window", async function () {
  const appendedUrls = [];
  const requireCalls = [];
  const amdJsZip = {
    loadAsync: function () {
      return Promise.resolve(null);
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
    if (names[0] === "jszip") {
      resolve(amdJsZip);
      return;
    }
    reject(new Error("unexpected module"));
  }

  const loaded = loadPatcher({
    document,
    window: {},
    require,
    Promise,
  });

  const result = await loaded.patcher.ensureJsZip();

  assert.equal(result, amdJsZip);
  assert.deepEqual(appendedUrls, [loaded.config.DEFAULT_JSZIP_URL]);
  assert.equal(requireCalls.length, 1);
  assert.equal(requireCalls[0].length, 1);
  assert.equal(requireCalls[0][0], "jszip");
});

test("patchWorksheetXml updates existing cells with inline strings while preserving style", function () {
  const { patcher } = loadPatcher();
  const xml = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>',
    '<row r="1"><c r="A1" t="inlineStr"><is><t>Замечание</t></is></c><c r="B1" t="inlineStr"><is><t>Jira</t></is></c><c r="C1" t="inlineStr"><is><t>Статус в Jira</t></is></c></row>',
    '<row r="2"><c r="A2" t="inlineStr"><is><t>Текст</t></is></c><c r="B2" s="5"><v/></c><c r="C2" s="7"><v/></c></row>',
    '</sheetData></worksheet>',
  ].join("");

  const out = patcher.patchWorksheetXml(xml, {
    headerRowNumber: 1,
    rows: [
      {
        excelRowNumber: 2,
        values: {
          Jira: "EVOSCADA-1",
          "Статус в Jira": "In Review",
        },
      },
    ],
  });

  assert.match(out, /<c r="B2" s="5" t="inlineStr"><is><t>EVOSCADA-1<\/t><\/is><\/c>/);
  assert.match(out, /<c r="C2" s="7" t="inlineStr"><is><t>In Review<\/t><\/is><\/c>/);
  assert.match(out, /<c r="A2" t="inlineStr"><is><t>Текст<\/t><\/is><\/c>/);
});

test("patchWorksheetXml inserts missing target cells in row order", function () {
  const { patcher } = loadPatcher();
  const xml = [
    '<worksheet><sheetData>',
    '<row r="1"><c r="A1" t="inlineStr"><is><t>Замечание</t></is></c><c r="B1" t="inlineStr"><is><t>Jira</t></is></c><c r="C1" t="inlineStr"><is><t>Статус в Jira</t></is></c><c r="D1" t="inlineStr"><is><t>Комментарий</t></is></c></row>',
    '<row r="5"><c r="A5" t="inlineStr"><is><t>Текст</t></is></c><c r="D5" t="inlineStr"><is><t>Old</t></is></c></row>',
    '</sheetData></worksheet>',
  ].join("");

  const out = patcher.patchWorksheetXml(xml, {
    headerRowNumber: 1,
    rows: [
      {
        excelRowNumber: 5,
        values: {
          Jira: "EVOSCADA-2",
          "Статус в Jira": "Done",
        },
      },
    ],
  });

  assert.match(out, /<c r="A5"[\s\S]*<c r="B5" t="inlineStr"><is><t>EVOSCADA-2<\/t><\/is><\/c>[\s\S]*<c r="C5" t="inlineStr"><is><t>Done<\/t><\/is><\/c>[\s\S]*<c r="D5"/);
});

test("patchWorksheetXml expands row spans when appended cells exceed existing span", function () {
  const { patcher } = loadPatcher();
  const xml = [
    '<worksheet><dimension ref="A4:C5"/><sheetData>',
    '<row r="4" spans="1:3"><c r="A4" t="inlineStr"><is><t>#</t></is></c><c r="B4" t="inlineStr"><is><t>Замечание</t></is></c><c r="C4" t="inlineStr"><is><t>Jira</t></is></c></row>',
    '<row r="5" spans="1:3"><c r="A5"><v>1</v></c><c r="B5" t="inlineStr"><is><t>Текст</t></is></c><c r="C5"/></row>',
    '</sheetData></worksheet>',
  ].join("");

  const out = patcher.patchWorksheetXml(xml, {
    headerRowNumber: 4,
    headerColumns: {
      Jira: 3,
      "Статус в Jira": 4,
      "Исполнитель в Jira": 5,
    },
    rows: [
      {
        excelRowNumber: 5,
        values: {
          Jira: "LND-172",
          "Статус в Jira": "In Review",
          "Исполнитель в Jira": "Иван Иванов",
        },
      },
    ],
  });

  assert.match(out, /<dimension ref="A4:E5"\/>/);
  assert.match(out, /<row r="5" spans="1:5">/);
  assert.match(out, /<c r="E5" t="inlineStr"><is><t>Иван Иванов<\/t><\/is><\/c>/);
});
