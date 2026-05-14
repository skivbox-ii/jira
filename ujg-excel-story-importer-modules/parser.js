define("_ujgESI_parser", ["_ujgESI_config"], function(config) {
  "use strict";

  function cellText(value) {
    if (value == null) return "";
    if (value instanceof Date && !isNaN(value.getTime())) return value.toISOString().slice(0, 10);
    return String(value).replace(/\s+/g, " ").trim();
  }

  function sheetRows(sheet) {
    if (!sheet) return [];
    var hiddenRows = sheet["!rows"] || [];
    function visibleRows(rows) {
      return (rows || []).map(function(row, index) {
        return hiddenRows[index] && hiddenRows[index].hidden ? [] : row;
      });
    }
    if (Array.isArray(sheet.__rows)) return visibleRows(sheet.__rows);
    if (typeof XLSX !== "undefined" && XLSX.utils && XLSX.utils.sheet_to_json) {
      return visibleRows(XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "" }));
    }
    return [];
  }

  function extractJiraKey(value) {
    var match = /([A-Z][A-Z0-9]+-\d+)/.exec(String(value || "").toUpperCase());
    return match ? match[1] : "";
  }

  function defaultColumnMap() {
    return {
      summary: config.SUMMARY_COLUMN,
      jira: config.JIRA_COLUMN,
      module: "Модуль",
      priority: "Приоритет",
      statusInJira: "Статус в Jira",
      assigneeInJira: "Исполнитель в Jira",
      sprintInJira: "Спринт",
    };
  }

  function parserSettings(options) {
    var source = options && typeof options === "object" ? options : {};
    var columnMap = {};
    var defaults = config.COLUMN_MAP || defaultColumnMap();
    Object.keys(defaults).forEach(function(key) {
      columnMap[key] = source.columnMap && source.columnMap[key] != null && String(source.columnMap[key]).trim()
        ? String(source.columnMap[key]).trim()
        : String(defaults[key] || "").trim();
    });
    return {
      sheetName: source.sheetName != null && String(source.sheetName).trim() ? String(source.sheetName).trim() : "",
      columnMap: columnMap,
      tableStart: {
        headerMarker: source.tableStart && source.tableStart.headerMarker != null && String(source.tableStart.headerMarker).trim()
          ? String(source.tableStart.headerMarker).trim()
          : config.TABLE_START && config.TABLE_START.headerMarker
            ? String(config.TABLE_START.headerMarker)
            : config.SUMMARY_COLUMN,
      },
    };
  }

  function canonicalColumnName(excelName, settings) {
    var text = cellText(excelName);
    var map = settings && settings.columnMap ? settings.columnMap : {};
    if (text && cellText(map.summary) === text) return config.SUMMARY_COLUMN;
    if (text && cellText(map.jira) === text) return config.JIRA_COLUMN;
    if (text && cellText(map.module) === text) return "Модуль";
    if (text && cellText(map.priority) === text) return "Приоритет";
    if (text && cellText(map.statusInJira) === text) return "Статус в Jira";
    if (text && cellText(map.assigneeInJira) === text) return "Исполнитель в Jira";
    if (text && cellText(map.sprintInJira) === text) return "Спринт";
    return text;
  }

  function findHeader(rows, settings) {
    var i;
    var j;
    var marker = settings && settings.tableStart ? cellText(settings.tableStart.headerMarker) : config.SUMMARY_COLUMN;
    for (i = 0; i < rows.length; i += 1) {
      for (j = 0; j < (rows[i] || []).length; j += 1) {
        if (cellText(rows[i][j]) === marker) {
          return { rowIndex: i, summaryIndex: j };
        }
      }
    }
    return null;
  }

  function headerNames(row, settings) {
    return (row || []).map(function(value, index) {
      var text = canonicalColumnName(value, settings);
      return text || "Колонка " + String(index + 1);
    });
  }

  function columnIndexes(names) {
    var out = {};
    (names || []).forEach(function(name, index) {
      var text = name != null ? String(name).trim() : "";
      if (text && !Object.prototype.hasOwnProperty.call(out, text)) out[text] = index + 1;
    });
    return out;
  }

  function fallbackHeaderColumns() {
    return {
      "№": 1,
      "Замечание": 2,
      "Jira": 3,
    };
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

  function parseRows(sheetName, rows, header, settings) {
    var headers = headerNames(rows[header.rowIndex], settings);
    var indexes = columnIndexes(headers);
    var summaryIndex = Object.prototype.hasOwnProperty.call(indexes, config.SUMMARY_COLUMN) ? indexes[config.SUMMARY_COLUMN] - 1 : header.summaryIndex;
    var out = [];
    var i;
    var j;
    for (i = header.rowIndex + 1; i < rows.length; i += 1) {
      var row = rows[i] || [];
      var summary = cellText(row[summaryIndex]);
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
        sourceColumnIndexes: indexes,
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
    var indexes = fallbackHeaderColumns();
    if (rows.some(rowHasKnownHeader)) return { rows: [], headerColumns: indexes };
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
        sourceColumnIndexes: indexes,
        jiraKey: jiraKey,
        alreadyLinked: !!jiraKey,
        status: jiraKey ? "linked" : "ready",
        createdKey: "",
        errors: [],
      });
    }
    return { rows: out, headerColumns: indexes };
  }

  function parseWorkbook(workbook, options) {
    var settings = parserSettings(options);
    var sheetNames = workbook && Array.isArray(workbook.SheetNames) ? workbook.SheetNames : [];
    var selectedSheetName = settings.sheetName;
    var scanSheetNames = selectedSheetName ? sheetNames.filter(function(name) {
      return String(name) === selectedSheetName;
    }) : sheetNames;
    var i;
    var fallback = null;
    for (i = 0; i < scanSheetNames.length; i += 1) {
      var sheetName = String(scanSheetNames[i]);
      var rows = sheetRows(workbook.Sheets && workbook.Sheets[sheetName]);
      var header = findHeader(rows, settings);
      if (header) {
        var headers = headerNames(rows[header.rowIndex], settings);
        return {
          sheetName: sheetName,
          headerRowNumber: header.rowIndex + 1,
          headerColumns: columnIndexes(headers),
          rows: parseRows(sheetName, rows, header, settings),
        };
      }
      if (!fallback) {
        var simple = parseSimpleRows(sheetName, rows);
        if (simple.rows.length) {
          fallback = {
            sheetName: sheetName,
            headerRowNumber: 0,
            headerColumns: simple.headerColumns,
            rows: simple.rows,
          };
        }
      }
    }
    if (fallback) return fallback;
    throw new Error('Колонка "' + String(settings.tableStart.headerMarker || config.SUMMARY_COLUMN) + '" не найдена');
  }

  return {
    parseWorkbook: parseWorkbook,
    extractJiraKey: extractJiraKey,
    cellText: cellText,
    columnIndexes: columnIndexes,
  };
});
