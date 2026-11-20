const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const root = path.join(__dirname, "..");

function runtime(filename) {
  const definitions = new Map(), instances = new Map();
  const loadHandlers = [], scannedSelectors = [];
  const unexpected = () => { throw new Error("Unexpected external dependency request"); };
  const foreign = Object.freeze({read: unexpected, loadAsync: unexpected, utils: {sheet_to_json: unexpected}});
  const context = {console, setTimeout, clearTimeout, setImmediate, clearImmediate, ArrayBuffer, Uint8Array,
    Uint16Array, Uint32Array, Int32Array, Float64Array, DataView, TextEncoder, TextDecoder,
    XLSX: foreign, JSZip: foreign, mermaid: foreign, fetch: unexpected, location: {origin:"https://jira.example.test"},
    addEventListener(type, callback) { if (type === "load") loadHandlers.push(callback); },
    document: {createElement: unexpected, head: {appendChild: unexpected},
      querySelectorAll(selector) { scannedSelectors.push(selector); return []; }},
    require: unexpected, define(name, deps, factory) {
      assert.equal(typeof name, "string", "All dependencies must use private named AMD modules");
      assert.ok(!definitions.has(name), "Duplicate AMD module: " + name);
      definitions.set(name, {deps, factory});
    }};
  context.define.amd = {};
  context.window = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, filename), "utf8"), context);
  function get(name) {
    if (instances.has(name)) return instances.get(name);
    assert.ok(definitions.has(name), "Dependency missing from bundle: " + name);
    const {deps, factory} = definitions.get(name), value = factory(...deps.map(get));
    instances.set(name, value);
    return value;
  }
  return {get, context, foreign, definitions, loadHandlers, scannedSelectors};
}

for (const filename of ["ujg-excel-story-importer.js", "ujg-excel-story-importer.runtime.js"]) {
  test(filename + " never auto-scans host-page diagrams on window load", async () => {
    const {get, context, foreign, loadHandlers, scannedSelectors} = runtime(filename);
    const mermaid = get("_ujgESI_mermaid");
    assert.equal(typeof mermaid.render, "function");
    assert.equal(loadHandlers.length, 1, "Exercise the actual vendor load listener");
    for (const onLoad of loadHandlers) await onLoad();
    assert.deepEqual(scannedSelectors, [], "The private renderer must not query unrelated .mermaid elements");
    assert.equal(context.mermaid, foreign);
  });
  test(filename + " reads and patches a workbook with no external XLSX/ZIP or global replacements", async () => {
    const {get, context, foreign, definitions} = runtime(filename);
    const xlsx = get("_ujgESI_sheetjs"), zip = get("_ujgESI_jszip");
    assert.equal(xlsx.version, "0.18.5");assert.equal(zip.version, "3.10.1");
    const book = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(book, xlsx.utils.aoa_to_sheet([
      ["ID","Замечание","Jira","Статус в Jira"],["815","Проверка импорта","",""]
    ]), "Замечания");
    const bytes = xlsx.write(book, {type:"array", bookType:"xlsx"});
    const loader = get("_ujgESI_excel-loader");
    assert.equal(await loader.ensureXlsx(), xlsx);
    const parsed = await loader.readWorkbookFromBuffer(bytes);
    assert.equal(get("_ujgESI_parser").parseWorkbook(parsed).rows[0].summary, "Проверка импорта");
    const patcher = get("_ujgESI_xlsxPatcher");
    assert.equal(await patcher.ensureJsZip(), zip);
    const patched = await patcher.patchWorkbook(bytes, {sheetName:"Замечания",headerRowNumber:1,
      rows:[{excelRowNumber:2,values:{Jira:"EVOSCADA-815","Статус в Jira":"Выдано"}}]});
    const result = await loader.readWorkbookFromBuffer(patched);
    assert.equal(result.Sheets["Замечания"].C2.v, "EVOSCADA-815");
    assert.equal(result.Sheets["Замечания"].D2.v, "Выдано");
    assert.equal(result.Sheets["Замечания"].B2.v, "Проверка импорта");
    for (const name of ["XLSX","JSZip","mermaid"]) assert.equal(context[name],foreign);
    for (const name of ["xlsx","jszip","mermaid"]) assert.equal(definitions.has(name),false);
    assert.ok(definitions.has("_ujgESI_mermaid"), "Diagram renderer is bundled too");
  });
}
