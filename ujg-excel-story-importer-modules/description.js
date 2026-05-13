define("_ujgESI_description", [], function() {
  "use strict";

  function text(value) {
    return value == null ? "" : String(value);
  }

  function escapeCell(value) {
    return text(value)
      .replace(/\\/g, "\\\\")
      .replace(/\r?\n/g, "\\\\")
      .replace(/\|/g, "\\&#124;")
      .trim();
  }

  function appendRow(lines, name, value) {
    var v = escapeCell(value);
    if (!v) return;
    lines.push("|" + escapeCell(name) + "|" + v + "|");
  }

  function buildDescription(row) {
    var lines = ["Импортировано из журнала замечаний.", "", "||Поле||Значение||"];
    var cols;
    if (row && row.sheetName) appendRow(lines, "Лист", row.sheetName);
    if (row && row.excelRowNumber != null) appendRow(lines, "Строка Excel", row.excelRowNumber);
    cols = row && row.sourceColumns ? row.sourceColumns : {};
    Object.keys(cols).forEach(function(name) {
      appendRow(lines, name, cols[name]);
    });
    return lines.join("\n");
  }

  function buildDescriptionFromRows(rows) {
    var lines = ["Импортировано из журнала замечаний.", "", "||Поле||Значение||"];
    (rows || []).forEach(function(row) {
      appendRow(lines, row && row.name, row && row.value);
    });
    return lines.join("\n");
  }

  return {
    buildDescription: buildDescription,
    buildDescriptionFromRows: buildDescriptionFromRows,
    escapeCell: escapeCell,
  };
});
