define("_ujgESI_parser", ["_ujgESI_config"], function(config) {
  "use strict";

  function cellText(value) {
    if (value == null) return "";
    if (value instanceof Date && !isNaN(value.getTime())) return value.toISOString().slice(0, 10);
    return String(value).replace(/\s+/g, " ").trim();
  }

  function sheetRows(sheet, raw, includeHidden) {
    if (!sheet) return [];
    var hiddenRows = sheet["!rows"] || [];
    function visibleRows(rows) {
      return (rows || []).map(function(row, index) {
        return !includeHidden && hiddenRows[index] && hiddenRows[index].hidden ? [] : row;
      });
    }
    if (Array.isArray(sheet.__rows)) return visibleRows(sheet.__rows);
    if (typeof XLSX !== "undefined" && XLSX.utils && XLSX.utils.sheet_to_json) {
      var rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: !!raw, defval: "" });
      if (sheet["!ref"] && XLSX.utils.decode_range) {
        var start = XLSX.utils.decode_range(sheet["!ref"]).s;
        rows = rows.map(function(row) {
          return Array(start.c).fill("").concat(row || []);
        });
        rows = Array(start.r).fill(null).map(function() { return []; }).concat(rows);
      }
      return visibleRows(rows);
    }
    return [];
  }

  function extractJiraKey(value) {
    var match = /([A-Z][A-Z0-9]+-\d+)/.exec(String(value || "").toUpperCase());
    return match ? match[1] : "";
  }

  function defaultColumnMap() {
    return {
      remarkId: "ID",
      summary: config.SUMMARY_COLUMN,
      jira: config.JIRA_COLUMN,
      owner: "Ответственный",
      module: "Модуль",
      priority: "Приоритет",
      statusInJira: "Статус в Jira",
      assigneeInJira: "Исполнитель в Jira",
      sprintInJira: "Спринт",
      deadline: "Срок",
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
      columnBindings: source.columnBindings && typeof source.columnBindings === "object" ? source.columnBindings : {},
      headerRowNumber: Number.isInteger(source.headerRowNumber) && source.headerRowNumber > 0 ? source.headerRowNumber : 0,
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
    if (text && cellText(map.remarkId) === text) return "ID";
    if (text && cellText(map.summary) === text) return config.SUMMARY_COLUMN;
    if (text && cellText(map.jira) === text) return config.JIRA_COLUMN;
    if (text && cellText(map.owner) === text) return "Ответственный";
    if (text && cellText(map.module) === text) return "Модуль";
    if (text && cellText(map.priority) === text) return "Приоритет";
    if (text && cellText(map.statusInJira) === text) return "Статус в Jira";
    if (text && cellText(map.assigneeInJira) === text) return "Исполнитель в Jira";
    if (text && cellText(map.sprintInJira) === text) return "Спринт";
    if (text && cellText(map.deadline) === text) return text === "Срок" ? "Срок" : "Срок исполнения";
    return text;
  }

  function findHeader(rows, settings, boundSummary) {
    var i;
    var j;
    var marker = boundSummary ? cellText(boundSummary.header)
      : settings && settings.tableStart ? cellText(settings.tableStart.headerMarker) : config.SUMMARY_COLUMN;
    for (i = 0; i < rows.length; i += 1) {
      var occurrence = 0;
      for (j = 0; j < (rows[i] || []).length; j += 1) {
        if (cellText(rows[i][j]) === marker) {
          if (!boundSummary || occurrence === boundSummary.occurrence) return { rowIndex: i, summaryIndex: j };
          occurrence += 1;
        }
      }
    }
    return null;
  }

  function headerNames(row, settings) {
    var raw = (row || []).map(cellText);
    var useOwnerAlias = cellText(settings.columnMap.owner) === "Ответственный" && raw.indexOf("Ответственный") === -1;
    var useModuleAlias = cellText(settings.columnMap.module) === "Модуль" && raw.indexOf("Модуль") === -1;
    var names = raw.map(function(value, index) {
      var text = canonicalColumnName(value, settings);
      if (useOwnerAlias && value === "Ответственный от ТНТ" && text === value) text = "Ответственный";
      if (useModuleAlias && value === "Компонент" && text === value) text = "Модуль";
      return text || "Колонка " + String(index + 1);
    });
    var preferred = {
      ID: settings.columnMap.remarkId,
      "Замечание": settings.columnMap.summary,
      Jira: settings.columnMap.jira,
      "Ответственный": settings.columnMap.owner,
      "Модуль": settings.columnMap.module,
      "Приоритет": settings.columnMap.priority,
      "Статус в Jira": settings.columnMap.statusInJira,
      "Исполнитель в Jira": settings.columnMap.assigneeInJira,
      "Спринт": settings.columnMap.sprintInJira,
      "Срок исполнения": settings.columnMap.deadline,
    };
    var selected = {};
    names.forEach(function(name, index) {
      if (!Object.prototype.hasOwnProperty.call(selected, name) || raw[index] === preferred[name]) {
        if (!Object.prototype.hasOwnProperty.call(selected, name) || raw[selected[name]] !== preferred[name]) selected[name] = index;
      }
    });
    var used = {};
    Object.keys(selected).forEach(function(name) { used[name] = true; });
    return names.map(function(name, index) {
      if (selected[name] === index) return name;
      var base = (raw[index] || name) + " (колонка " + String(index + 1) + ")";
      var unique = base;
      while (used[unique]) unique += "*";
      used[unique] = true;
      return unique;
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

  function deadlineCell(value, date1904) {
    if (typeof value !== "number" || !isFinite(value)) return cellText(value);
    var xlsx = typeof XLSX !== "undefined" ? XLSX : null;
    var parts = xlsx && xlsx.SSF && xlsx.SSF.parse_date_code && xlsx.SSF.parse_date_code(value, {date1904:date1904});
    if (!parts || !parts.y || !parts.m || !parts.d) return cellText(value);
    return String(parts.y).padStart(4, "0") + "-" + String(parts.m).padStart(2, "0") + "-" + String(parts.d).padStart(2, "0");
  }

  function isDeadlineColumn(name, settings) {
    var base = String(name || "").replace(/ \(колонка \d+\)\**$/, "");
    if (base === cellText(settings.columnMap.deadline)) return true;
    return ["Срок исполнения", "Срок исполнения замечания", "Срок устранения",
      "Плановый срок устранения", "Планируемый срок устранения", "Плановый срок исполнения",
      "Срок выполнения", "Срок", "Планируемая дата устранения"].indexOf(base) !== -1;
  }

  var FIELD_LABELS = {
    remarkId: "ID", summary: "Замечание", jira: "Jira", owner: "Ответственный",
    module: "Модуль", priority: "Приоритет", statusInJira: "Статус в Jira",
    assigneeInJira: "Исполнитель в Jira", sprintInJira: "Спринт", deadline: "Срок исполнения",
  };
  var REPORT_LABELS = {remarkId:"ID замечания",jira:"Ключ Jira"};

  function columnLetter(index) {
    var value = index + 1, out = "";
    while (value > 0) { value -= 1; out = String.fromCharCode(65 + value % 26) + out; value = Math.floor(value / 26); }
    return out;
  }

  function fieldCandidates(key, settings) {
    var expected = cellText(settings.columnMap[key]);
    var aliases = key === "owner" && expected === "Ответственный" ? ["Ответственный от ТНТ"]
      : key === "module" && expected === "Модуль" ? ["Компонент"]
      : key === "remarkId" && expected === "ID" ? ["№", "номер", "Номер замечания"]
      : key === "deadline" && expected === "Срок" ? ["Срок исполнения", "Срок исполнения замечания", "Срок устранения", "Плановый срок устранения", "Планируемый срок устранения", "Плановый срок исполнения", "Срок выполнения", "Планируемая дата устранения"] : [];
    return [expected].concat(aliases);
  }

  function inspectWorkbook(workbook, options) {
    var settings = parserSettings(options);
    var sheetNames = workbook && Array.isArray(workbook.SheetNames) ? workbook.SheetNames.map(String) : [];
    var name = settings.sheetName || "";
    var sheet = null, rows = [], header = null, error = "";
    if (name && sheetNames.indexOf(name) === -1) error = 'Лист "' + name + '" не найден';
    else {
      for (var s = 0; s < (name ? 1 : sheetNames.length); s += 1) {
        var candidate = name || sheetNames[s];
        var candidateSheet = workbook.Sheets && workbook.Sheets[candidate];
        var candidateRows = sheetRows(candidateSheet, false, true);
        var summaryBinding = settings.columnBindings.summary;
        var found = settings.headerRowNumber
          ? {rowIndex:settings.headerRowNumber - 1,summaryIndex:0}
          : summaryBinding && typeof summaryBinding === "object"
            ? findHeader(candidateRows, settings, summaryBinding)
            : findHeader(candidateRows, settings);
        if (found && candidateRows[found.rowIndex]) {
          name = candidate; sheet = candidateSheet; rows = candidateRows; header = found; break;
        }
      }
      if (!header) error = 'Колонка "' + String(settings.tableStart.headerMarker || config.SUMMARY_COLUMN) + '" не найдена';
    }
    var columns = [], fields = [], counts = {total:0,visible:0,hidden:0};
    if (header) {
      var headerRow = rows[header.rowIndex] || [], occurrences = {};
      headerRow.forEach(function(value, index) {
        var text = cellText(value);
        if (!text) return;
        var occurrence = occurrences[text] || 0;
        occurrences[text] = occurrence + 1;
        columns.push({index:index,header:text,letter:columnLetter(index),occurrence:occurrence,examples:[],nonEmptyCount:0});
      });
    }
    Object.keys(FIELD_LABELS).forEach(function(key) {
      var binding = settings.columnBindings[key], explicit = Object.prototype.hasOwnProperty.call(settings.columnBindings,key);
      var matches = [];
      if (explicit && binding === null) fields.push({key:key,label:REPORT_LABELS[key] || FIELD_LABELS[key],required:key === "summary",selectedIndex:null,status:"skipped"});
      else {
        if (explicit && binding && typeof binding === "object") matches = columns.filter(function(col) {
          return col.header === cellText(binding.header) && col.occurrence === binding.occurrence;
        });
        else if (!explicit) {
          var candidates = fieldCandidates(key, settings);
          matches = columns.filter(function(col) { return col.header === candidates[0]; });
          if (!matches.length) matches = columns.filter(function(col) { return candidates.slice(1).indexOf(col.header) !== -1; });
        }
        var chosen = matches.length === 1 ? matches[0] : null;
        fields.push({key:key,label:REPORT_LABELS[key] || FIELD_LABELS[key],required:key === "summary",
          selectedIndex:chosen ? chosen.index : null,
          status:matches.length > 1 ? "ambiguous" : !chosen ? "missing" : "matched"});
      }
    });
    fields.forEach(function(field) {
      if (field.selectedIndex != null && fields.some(function(other) { return other !== field && other.selectedIndex === field.selectedIndex; })) field.status = "conflict";
    });
    if (header) {
      var summary = fields.filter(function(field) { return field.key === "summary"; })[0];
      if (summary.selectedIndex != null) {
        for (var i = header.rowIndex + 1; i < rows.length; i += 1) {
          if (!cellText((rows[i] || [])[summary.selectedIndex])) continue;
          counts.total += 1;
          if (sheet["!rows"] && sheet["!rows"][i] && sheet["!rows"][i].hidden) counts.hidden += 1;
          else {
            counts.visible += 1;
            columns.forEach(function(column) {
              var sample = cellText((rows[i] || [])[column.index]);
              if (!sample) return;
              column.nonEmptyCount += 1;
              if (column.examples.length < 3 && column.examples.indexOf(sample) === -1) column.examples.push(sample);
            });
          }
        }
      } else {
        for (var sampleRow = header.rowIndex + 1; sampleRow < rows.length; sampleRow += 1) {
          if (sheet["!rows"] && sheet["!rows"][sampleRow] && sheet["!rows"][sampleRow].hidden) continue;
          columns.forEach(function(column) {
            var sample = cellText((rows[sampleRow] || [])[column.index]);
            if (!sample) return;
            column.nonEmptyCount += 1;
            if (column.examples.length < 3 && column.examples.indexOf(sample) === -1) column.examples.push(sample);
          });
        }
      }
    }
    fields.forEach(function(field) {
      if (field.status !== "matched") return;
      if (!fields.some(function(candidate) { return candidate.key === "summary" && candidate.selectedIndex != null; })) return;
      var selectedColumn = columns.filter(function(column) { return column.index === field.selectedIndex; })[0];
      if (selectedColumn && !selectedColumn.nonEmptyCount) field.status = "empty";
    });
    var needsReview = !!error || fields.some(function(field) { return field.status !== "matched" && field.status !== "skipped"; });
    var canApply = !error && fields.every(function(field) {
      return field.status === "matched" || field.status === "empty" || field.status === "skipped" && !field.required;
    });
    var report = {sheetName:name,headerRowNumber:header ? header.rowIndex + 1 : 0,sheetNames:sheetNames,
      columns:columns,fields:fields,counts:counts,needsReview:needsReview,canApply:canApply};
    if (error) report.error = error;
    return report;
  }

  function parseRows(sheetName, rows, header, settings, rawRows, date1904) {
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
        var value = isDeadlineColumn(name, settings) ? deadlineCell((rawRows[i] || [])[j], date1904) : cellText(row[j]);
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

  function parseBoundRows(workbook, sheetName, sheet, report, settings) {
    var rows = sheetRows(sheet), rawRows = sheetRows(sheet, true);
    var headerIndex = report.headerRowNumber - 1;
    var selected = {}, indexes = {}, names = {};
    report.fields.forEach(function(field) {
      if (field.selectedIndex != null && field.status !== "conflict") {
        selected[field.selectedIndex] = field.key;
        indexes[FIELD_LABELS[field.key]] = field.selectedIndex + 1;
      }
    });
    report.columns.forEach(function(column) {
      if (Object.prototype.hasOwnProperty.call(selected, column.index)) return;
      var normalizedHeader = cellText(column.header).toLocaleLowerCase();
      var semantic = Object.keys(FIELD_LABELS).some(function(key) {
        return fieldCandidates(key, settings).concat(FIELD_LABELS[key]).some(function(name) {
          return cellText(name).toLocaleLowerCase() === normalizedHeader;
        });
      }) || isDeadlineColumn(column.header, settings) || ["Исполнитель", "№", "номер", "номер замечания"].some(function(name) {
        return name.toLocaleLowerCase() === normalizedHeader;
      });
      var name = semantic ? "Исходная колонка " + column.letter + ": " + column.header : column.header;
      if (Object.prototype.hasOwnProperty.call(indexes, name)) name += " (колонка " + String(column.index + 1) + ")";
      names[column.index] = name;
      indexes[name] = column.index + 1;
    });
    var summaryField = report.fields.filter(function(field) { return field.key === "summary"; })[0];
    var out = [];
    for (var i = headerIndex + 1; i < rows.length; i += 1) {
      var row = rows[i] || [];
      var summary = cellText(row[summaryField.selectedIndex]);
      if (!summary) continue;
      var sourceColumns = {};
      report.columns.forEach(function(column) {
        var index = column.index, key = selected[index];
        var name = key ? FIELD_LABELS[key] : names[index];
        var value = key === "deadline"
          ? deadlineCell((rawRows[i] || [])[index], !!(workbook.Workbook && workbook.Workbook.WBProps && workbook.Workbook.WBProps.date1904))
          : cellText(row[index]);
        if (name && value) sourceColumns[name] = value;
      });
      var jiraKey = extractJiraKey(sourceColumns[config.JIRA_COLUMN]);
      out.push({id:sheetName + ":" + String(i + 1),sheetName:sheetName,excelRowNumber:i + 1,
        summary:summary,sourceColumns:sourceColumns,sourceColumnIndexes:indexes,jiraKey:jiraKey,
        alreadyLinked:!!jiraKey,status:jiraKey ? "linked" : "ready",createdKey:"",errors:[]});
    }
    return {sheetName:sheetName,headerRowNumber:report.headerRowNumber,headerColumns:indexes,rows:out};
  }

  function parseWorkbook(workbook, options) {
    var settings = parserSettings(options);
    if (settings.headerRowNumber || Object.keys(settings.columnBindings).length) {
      var report = inspectWorkbook(workbook, options);
      var summary = report.fields.filter(function(field) { return field.key === "summary"; })[0];
      if (report.error) throw new Error(report.error);
      if (summary.selectedIndex == null || summary.status === "conflict") throw new Error('Колонка "Замечание" не выбрана');
      if (report.fields.some(function(field) { return field.status === "conflict"; })) throw new Error("Одна колонка выбрана для нескольких полей");
      return parseBoundRows(workbook, report.sheetName, workbook.Sheets[report.sheetName], report, settings);
    }
    var sheetNames = workbook && Array.isArray(workbook.SheetNames) ? workbook.SheetNames : [];
    var selectedSheetName = settings.sheetName;
    var scanSheetNames = selectedSheetName ? sheetNames.filter(function(name) {
      return String(name) === selectedSheetName;
    }) : sheetNames;
    var i;
    var fallback = null;
    for (i = 0; i < scanSheetNames.length; i += 1) {
      var sheetName = String(scanSheetNames[i]);
      var sheet = workbook.Sheets && workbook.Sheets[sheetName];
      var rows = sheetRows(sheet);
      var header = findHeader(rows, settings);
      if (header) {
        var headers = headerNames(rows[header.rowIndex], settings);
        return {
          sheetName: sheetName,
          headerRowNumber: header.rowIndex + 1,
          headerColumns: columnIndexes(headers),
          rows: parseRows(sheetName, rows, header, settings, sheetRows(sheet, true), !!(workbook.Workbook && workbook.Workbook.WBProps && workbook.Workbook.WBProps.date1904)),
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
    inspectWorkbook: inspectWorkbook,
    extractJiraKey: extractJiraKey,
    cellText: cellText,
    columnIndexes: columnIndexes,
  };
});
