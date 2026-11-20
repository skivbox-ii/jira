const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const loadAmdModule = require("./helpers/load-amd-module");
const MODULE_DIR = path.join(__dirname, "..", "ujg-excel-story-importer-modules");

function loadExcelLoader(xlsx, extraGlobals) {
  return loadAmdModule(path.join(MODULE_DIR, "excel-loader.js"), {
    _ujgESI_sheetjs: xlsx,
  }, extraGlobals);
}

function forbidden() { throw new Error("Unexpected network/global/require fallback"); }

test("readWorkbook uses private AMD SheetJS and preserves exact read options", async () => {
  const workbook = { SheetNames: ["Журнал"], Sheets: {} };
  const buffer = new ArrayBuffer(8);
  const calls = [];
  const xlsx = { read(input, options) { calls.push({ input, options }); return workbook; } };
  const loader = loadExcelLoader(xlsx, {
    XLSX: { read: forbidden }, window: { XLSX: { read: forbidden }, require: forbidden },
    document: { createElement: forbidden }, require: forbidden,
  });
  assert.equal(await loader.ensureXlsx(), xlsx);
  assert.equal(await loader.readWorkbook({ arrayBuffer: () => Promise.resolve(buffer) }), workbook);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].input, buffer);
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0].options)), {
    type: "array", cellDates: false, cellStyles: true,
  });
});

test("readFileBuffer and readWorkbookFromBuffer allow one file read for parsing and export", async () => {
  const xlsx = require("./helpers/importer-vendor-deps").sheetjs;
  const source = xlsx.utils.book_new();
  const sheet = xlsx.utils.aoa_to_sheet([["Замечание", "Срок"], ["Visible", 45000], ["Hidden", 45001]]);
  sheet["!rows"] = [null, null, { hidden: true }];
  source.Workbook = { WBProps: { date1904: true } };
  xlsx.utils.book_append_sheet(source, sheet, "Журнал");
  const buffer = xlsx.write(source, { type: "array", bookType: "xlsx" });
  const loader = loadExcelLoader(xlsx);
  let reads = 0;
  const readBuffer = await loader.readFileBuffer({ arrayBuffer() { reads++; return Promise.resolve(buffer); } });
  const result = await loader.readWorkbookFromBuffer(readBuffer);
  assert.equal(reads, 1);
  assert.equal(readBuffer, buffer);
  assert.equal(result.Sheets["Журнал"].B2.v, 45000);
  assert.equal(result.Sheets["Журнал"].B2.t, "n");
  assert.equal(result.Workbook.WBProps.date1904, true);
  assert.equal(result.Sheets["Журнал"]["!rows"][2].hidden, true);
});

test("loader and parser share private SheetJS for raw dates, offsets and hidden rows", async () => {
  const xlsx = require("./helpers/importer-vendor-deps").sheetjs;
  const config = loadAmdModule(path.join(MODULE_DIR, "config.js"), {});
  const parser = loadAmdModule(path.join(MODULE_DIR, "parser.js"), {
    _ujgESI_config: config, _ujgESI_sheetjs: xlsx,
  }, { XLSX: { utils: { sheet_to_json: forbidden }, SSF: { parse_date_code: forbidden } } });
  const source = xlsx.utils.book_new();
  const sheet = xlsx.utils.aoa_to_sheet([
    ["Замечание", "Срок"], ["Visible", 45000], ["Hidden", 45001],
  ], { origin: "C3" });
  sheet["!rows"] = [null, null, null, null, { hidden: true }];
  source.Workbook = { WBProps: { date1904: true } };
  xlsx.utils.book_append_sheet(source, sheet, "Журнал");
  const workbook = await loadExcelLoader(xlsx).readWorkbookFromBuffer(
    xlsx.write(source, { type: "array", bookType: "xlsx" })
  );
  const result = parser.parseWorkbook(workbook);
  assert.equal(result.headerRowNumber, 3);
  assert.equal(result.headerColumns["Замечание"], 3);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].summary, "Visible");
  assert.equal(result.rows[0].excelRowNumber, 4);
  assert.equal(result.rows[0].sourceColumns["Срок"], "2027-03-16");
});
