define("_ujgESI_excel-loader", ["_ujgESI_sheetjs"], function(XLSX) {
  "use strict";

  function ensureXlsx() {
    return Promise.resolve(XLSX);
  }

  function readFileBuffer(file) {
    return file.arrayBuffer();
  }

  function readWorkbookFromBuffer(buffer) {
    return ensureXlsx().then(function(xlsx) {
      // Keep Excel calendar serials intact, including the workbook's 1904 epoch.
      return xlsx.read(buffer, { type: "array", cellDates: false, cellStyles: true });
    });
  }

  function readWorkbook(file) {
    return readFileBuffer(file).then(readWorkbookFromBuffer);
  }

  return {
    ensureXlsx: ensureXlsx,
    readFileBuffer: readFileBuffer,
    readWorkbookFromBuffer: readWorkbookFromBuffer,
    readWorkbook: readWorkbook,
  };
});
