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

test("patchWorksheetXml preserves existing cell attributes while replacing only text", function () {
  const { patcher } = loadPatcher();
  const xml = [
    '<worksheet><sheetData>',
    '<row r="1"><c r="A1" t="inlineStr"><is><t>Jira</t></is></c><c r="B1" t="inlineStr"><is><t>Статус в Jira</t></is></c></row>',
    '<row r="2"><c r="A2" s="11" cm="2" vm="3" ph="1" t="s"><v>4</v></c><c r="B2" s="12"/></row>',
    '</sheetData></worksheet>',
  ].join("");

  const out = patcher.patchWorksheetXml(xml, {
    headerRowNumber: 1,
    rows: [
      {
        excelRowNumber: 2,
        values: {
          Jira: "EVOSCADA-1",
          "Статус в Jira": "Done",
        },
      },
    ],
  });

  assert.match(out, /<c r="A2" s="11" cm="2" vm="3" ph="1" t="inlineStr"><is><t>EVOSCADA-1<\/t><\/is><\/c>/);
  assert.match(out, /<c r="B2" s="12" t="inlineStr"><is><t>Done<\/t><\/is><\/c>/);
});

test("patchWorksheetXml updates only the target self-closing cell", function () {
  const { patcher } = loadPatcher();
  const xml = [
    '<worksheet><sheetData>',
    '<row r="1"><c r="M1" t="inlineStr"><is><t>Статус исполнителя</t></is></c><c r="N1" t="inlineStr"><is><t>Планируемая дата</t></is></c><c r="O1" t="inlineStr"><is><t>Фактическая дата</t></is></c><c r="P1" t="inlineStr"><is><t>Примечание исполнитель</t></is></c></row>',
    '<row r="792"><c r="M792" s="50"/><c r="N792" s="51"/><c r="O792" s="52"/><c r="P792" s="53"/><c r="Q792" s="54" t="inlineStr"><is><t>Примечание заказчик</t></is></c></row>',
    '</sheetData></worksheet>',
  ].join("");

  const out = patcher.patchWorksheetXml(xml, {
    headerRowNumber: 1,
    headerColumns: {
      "Статус в Jira": 13,
    },
    rows: [
      {
        excelRowNumber: 792,
        values: {
          "Статус в Jira": "Выдано",
        },
      },
    ],
  });

  assert.match(out, /<c r="M792" s="50" t="inlineStr"><is><t>Выдано<\/t><\/is><\/c>/);
  assert.match(out, /<c r="N792" s="51"\/>/);
  assert.match(out, /<c r="O792" s="52"\/>/);
  assert.match(out, /<c r="P792" s="53"\/>/);
  assert.match(out, /<c r="Q792" s="54" t="inlineStr"><is><t>Примечание заказчик<\/t><\/is><\/c>/);
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

test("patchWorksheetXml gives inserted missing cells the nearest row style", function () {
  const { patcher } = loadPatcher();
  const xml = [
    '<worksheet><sheetData>',
    '<row r="1"><c r="A1" t="inlineStr"><is><t>Замечание</t></is></c><c r="B1" t="inlineStr"><is><t>Jira</t></is></c><c r="C1" t="inlineStr"><is><t>Статус в Jira</t></is></c><c r="D1" t="inlineStr"><is><t>Комментарий</t></is></c></row>',
    '<row r="5"><c r="A5" s="31" t="inlineStr"><is><t>Текст</t></is></c><c r="D5" s="31" t="inlineStr"><is><t>Old</t></is></c></row>',
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

  assert.match(out, /<c r="B5" s="31" t="inlineStr"><is><t>EVOSCADA-2<\/t><\/is><\/c>/);
  assert.match(out, /<c r="C5" s="31" t="inlineStr"><is><t>Done<\/t><\/is><\/c>/);
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

test("cellCommentsForWorksheet maps row comments to existing header columns", function () {
  const { patcher } = loadPatcher();
  const xml = [
    '<worksheet><sheetData>',
    '<row r="1"><c r="A1" t="inlineStr"><is><t>Jira</t></is></c><c r="C1" t="inlineStr"><is><t>Статус в Jira</t></is></c><c r="D1" t="inlineStr"><is><t>Комментарий</t></is></c></row>',
    '<row r="792"><c r="C792" s="50"/></row>',
    '</sheetData></worksheet>',
  ].join("");

  const comments = patcher.cellCommentsForWorksheet(xml, {
    headerRowNumber: 1,
    rows: [
      {
        excelRowNumber: 792,
        comments: {
          "Статус в Jira": "[SE] Existing | Done | Сергей\n[QA] Existing | Testing | Ольга",
          "Неизвестная колонка": "ignore",
        },
      },
    ],
  });

  assert.deepEqual(JSON.parse(JSON.stringify(comments)), [
    {
      ref: "C792",
      rowNumber: 792,
      columnNumber: 3,
      text: "[SE] Existing | Done | Сергей\n[QA] Existing | Testing | Ольга",
    },
  ]);
});

test("patchCommentsXml writes escaped multiline Excel note text", function () {
  const { patcher } = loadPatcher();

  const out = patcher.patchCommentsXml("", [
    {
      ref: "C792",
      rowNumber: 792,
      columnNumber: 3,
      text: "[SE] A&B | Done | Иван\n[QA] Test | In <Review> | Ольга",
    },
  ]);

  assert.match(out, /<comment ref="C792" authorId="0" shapeId="0">/);
  assert.match(out, /\[SE\] A&amp;B \| Done \| Иван/);
  assert.match(out, /\[QA\] Test \| In &lt;Review&gt; \| Ольга/);
});

test("ensureWorksheetLegacyDrawing adds only the drawing reference and namespace", function () {
  const { patcher } = loadPatcher();
  const xml = '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData/></worksheet>';

  const out = patcher.ensureWorksheetLegacyDrawing(xml, "rId7");

  assert.match(out, /xmlns:r="http:\/\/schemas.openxmlformats.org\/officeDocument\/2006\/relationships"/);
  assert.match(out, /<legacyDrawing r:id="rId7"\/><\/worksheet>/);
  assert.doesNotMatch(out, /comments/);
});
