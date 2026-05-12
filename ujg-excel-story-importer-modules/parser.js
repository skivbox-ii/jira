define("_ujgESI_parser", ["_ujgESI_config"], function(config) {
  "use strict";

  function cellText(value) {
    if (value == null) return "";
    if (value instanceof Date && !isNaN(value.getTime())) return value.toISOString().slice(0, 10);
    return String(value).replace(/\s+/g, " ").trim();
  }

  function sheetRows(sheet) {
    if (!sheet) return [];
    if (Array.isArray(sheet.__rows)) return sheet.__rows;
    if (typeof XLSX !== "undefined" && XLSX.utils && XLSX.utils.sheet_to_json) {
      return XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "" });
    }
    return [];
  }

  function extractJiraKey(value) {
    var match = /([A-Z][A-Z0-9]+-\d+)/.exec(String(value || "").toUpperCase());
    return match ? match[1] : "";
  }

  function findHeader(rows) {
    var i;
    var j;
    for (i = 0; i < rows.length; i += 1) {
      for (j = 0; j < (rows[i] || []).length; j += 1) {
        if (cellText(rows[i][j]) === config.SUMMARY_COLUMN) {
          return { rowIndex: i, summaryIndex: j };
        }
      }
    }
    return null;
  }

  function headerNames(row) {
    return (row || []).map(function(value, index) {
      var text = cellText(value);
      return text || "Колонка " + String(index + 1);
    });
  }

  function fallbackHeaderName(index) {
    if (index === 0) return "№";
    if (index === 1) return config.SUMMARY_COLUMN;
    if (index === 2) return config.JIRA_COLUMN;
    return "Колонка " + String(index + 1);
  }

  function rowHasKnownHeader(row) {
    return (row || []).some(function(value) {
      var text = cellText(value);
      return text && config.KNOWN_COLUMNS.indexOf(text) !== -1;
    });
  }

  function isLikelySummary(value) {
    var text = cellText(value);
    return text.length >= 3 && /[A-Za-zА-Яа-яЁё]/.test(text);
  }

  function parseRows(sheetName, rows, header) {
    var headers = headerNames(rows[header.rowIndex]);
    var out = [];
    var i;
    var j;
    for (i = header.rowIndex + 1; i < rows.length; i += 1) {
      var row = rows[i] || [];
      var summary = cellText(row[header.summaryIndex]);
      if (!summary) continue;
      var sourceColumns = {};
      for (j = 0; j < headers.length; j += 1) {
        var name = headers[j];
        var value = cellText(row[j]);
        if (name && value) sourceColumns[name] = value;
      }
      var jiraKey = extractJiraKey(sourceColumns[config.JIRA_COLUMN]);
      out.push({
        id: sheetName + ":" + String(i + 1),
        sheetName: sheetName,
        excelRowNumber: i + 1,
        summary: summary,
        sourceColumns: sourceColumns,
        jiraKey: jiraKey,
        alreadyLinked: !!jiraKey,
        status: jiraKey ? "linked" : "ready",
        createdKey: "",
        errors: [],
      });
    }
    return out;
  }

  function parseSimpleRows(sheetName, rows) {
    if (rows.some(rowHasKnownHeader)) return [];
    var out = [];
    var i;
    var j;
    for (i = 0; i < rows.length; i += 1) {
      var row = rows[i] || [];
      var summary = cellText(row[1]);
      if (!isLikelySummary(summary)) continue;
      var sourceColumns = {};
      for (j = 0; j < row.length; j += 1) {
        var name = fallbackHeaderName(j);
        var value = cellText(row[j]);
        if (value) sourceColumns[name] = value;
      }
      var jiraKey = extractJiraKey(sourceColumns[config.JIRA_COLUMN]);
      out.push({
        id: sheetName + ":" + String(i + 1),
        sheetName: sheetName,
        excelRowNumber: i + 1,
        summary: summary,
        sourceColumns: sourceColumns,
        jiraKey: jiraKey,
        alreadyLinked: !!jiraKey,
        status: jiraKey ? "linked" : "ready",
        createdKey: "",
        errors: [],
      });
    }
    return out;
  }

  function parseWorkbook(workbook) {
    var sheetNames = workbook && Array.isArray(workbook.SheetNames) ? workbook.SheetNames : [];
    var i;
    var fallback = null;
    for (i = 0; i < sheetNames.length; i += 1) {
      var sheetName = String(sheetNames[i]);
      var rows = sheetRows(workbook.Sheets && workbook.Sheets[sheetName]);
      var header = findHeader(rows);
      if (header) {
        return {
          sheetName: sheetName,
          headerRowNumber: header.rowIndex + 1,
          rows: parseRows(sheetName, rows, header),
        };
      }
      if (!fallback) {
        var simpleRows = parseSimpleRows(sheetName, rows);
        if (simpleRows.length) {
          fallback = {
            sheetName: sheetName,
            headerRowNumber: 0,
            rows: simpleRows,
          };
        }
      }
    }
    if (fallback) return fallback;
    throw new Error('Колонка "Замечание" не найдена');
  }

  return {
    parseWorkbook: parseWorkbook,
    extractJiraKey: extractJiraKey,
    cellText: cellText,
  };
});
