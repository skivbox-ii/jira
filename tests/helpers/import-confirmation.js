const assert = require("node:assert/strict");

// Controller fixtures model a recognized workbook; even these need confirmation.
function inspectWorkbook(workbook, settings) {
  const columns = Object.entries(settings.columnMap || {}).map(([key, header], index) => ({
    index, key, header, occurrence: 0, letter: String.fromCharCode(65 + index), examples: [],
  }));
  return {
    sheetName: settings.sheetName || workbook.SheetNames[0],
    sheetNames: workbook.SheetNames.slice(),
    headerRowNumber: settings.headerRowNumber || 1,
    columns,
    fields: columns.map(column => ({
      key: column.key, label: column.header, selectedIndex: column.index, status: "matched",
    })),
    counts: { total: 1, visible: 1, hidden: 0 },
    canApply: true,
    needsReview: false,
  };
}

function confirmImport(state, callbacks) {
  assert.ok(state.pendingImport, "File selection must stage an import before confirmation");
  assert.equal(state.pendingImport.report.canApply, true);
  callbacks.onImportRememberChange(false);
  callbacks.onConfirmColumnImport();
  assert.equal(state.pendingImport, null, "Explicit confirmation must commit the staged import");
}

module.exports = { inspectWorkbook, confirmImport };
