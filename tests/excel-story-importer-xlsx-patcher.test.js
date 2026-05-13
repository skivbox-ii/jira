const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const loadAmdModule = require("./helpers/load-amd-module");

const MODULE_DIR = path.join(__dirname, "..", "ujg-excel-story-importer-modules");

function loadPatcher() {
  const config = loadAmdModule(path.join(MODULE_DIR, "config.js"), {});
  return loadAmdModule(path.join(MODULE_DIR, "xlsx-patcher.js"), {
    "_ujgESI_config": config,
  });
}

test("patchWorksheetXml updates existing cells with inline strings while preserving style", function () {
  const patcher = loadPatcher();
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
  const patcher = loadPatcher();
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

