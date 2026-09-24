define("_ujgESI_deadlines", [], function() {
  "use strict";

  var aliases = ["Срок исполнения", "Срок исполнения замечания", "Срок устранения",
    "Плановый срок устранения", "Планируемый срок устранения", "Плановый срок исполнения",
    "Срок выполнения", "Срок", "Планируемая дата устранения"];

  function text(value) { return value == null ? "" : String(value).trim(); }
  function key(value) { return text(value).toUpperCase(); }
  function iso(year, month, day) {
    var value = String(year).padStart(4, "0") + "-" + String(month).padStart(2, "0") + "-" + String(day).padStart(2, "0");
    var date = new Date(value + "T00:00:00Z");
    return isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : null;
  }
  function parseDate(value) {
    if (value instanceof Date) return !isNaN(value.getTime()) ? iso(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate()) : null;
    var raw = text(value), match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
    if (match) return iso(+match[1], +match[2], +match[3]);
    match = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(raw);
    return match ? iso(+match[3], +match[2], +match[1]) : null;
  }
  function baseName(name) { return text(name).replace(/ \(колонка \d+\)\**$/, ""); }
  function names(columnMap, entries) {
    var preferred = text(columnMap && columnMap.deadline) || "Срок";
    if (preferred === "Срок") {
      return entries.some(function(entry) { return baseName(entry.name) === "Срок" && text(entry.value); })
        ? ["Срок"] : aliases.filter(function(name) { return name !== "Срок"; });
    }
    if (preferred === aliases[0]) return [aliases[0]];
    var hasExact = entries.some(function(entry) { return text(entry.name) === preferred && text(entry.value); });
    var hasCanonical = entries.some(function(entry) { return text(entry.name) === aliases[0] && text(entry.value); });
    return hasExact ? [preferred] : hasCanonical ? [aliases[0], preferred] : [preferred];
  }
  function values(columns, columnMap, source) {
    var entries = Array.isArray(columns) ? columns : Object.keys(columns || {}).map(function(name) {
      return {name:name,value:columns[name]};
    });
    var preferred = text(columnMap && columnMap.deadline) || "Срок";
    var canonicalFallback = preferred !== "Срок" && preferred !== aliases[0] && !entries.some(function(entry) {
      return text(entry.name) === preferred && text(entry.value);
    });
    var approved = names(columnMap, entries);
    return entries.filter(function(entry) {
      var base = baseName(entry.name);
      return approved.indexOf(base) !== -1 && text(entry.value) &&
        !(canonicalFallback && base === aliases[0] && text(entry.name) !== aliases[0]);
    }).sort(function(a, b) {
      return approved.indexOf(baseName(a.name)) - approved.indexOf(baseName(b.name));
    }).map(function(entry) { return {raw:text(entry.value),source:source,field:entry.name}; });
  }
  function unescapeCell(value) {
    return text(value).replace(/\\&#124;/g, "|").replace(/\\\\/g, "\n").replace(/\\\\/g, "\\");
  }
  function importedColumns(description) {
    var lines = text(description).split(/\r?\n/), start = lines.findIndex(function(line) {
      return line.trim() === "||Поле||Значение||";
    });
    if (start < 0 || lines[0].trim() !== "Импортировано из журнала замечаний." ||
        lines.slice(1, start).some(function(line) { return line.trim(); })) return [];
    var columns = [];
    for (var i = start + 1; i < lines.length; i += 1) {
      var line = lines[i].trim();
      if (!line.startsWith("|") || line.startsWith("||")) break;
      var cells = [], current = "";
      for (var j = 1; j < line.length; j += 1) {
        if (line[j] === "|" && line[j - 1] !== "\\") { cells.push(current); current = ""; }
        else current += line[j];
      }
      if (cells.length !== 2 || current) continue;
      var name = unescapeCell(cells[0]);
      if (name) columns.push({name:name,value:unescapeCell(cells[1])});
    }
    return columns;
  }
  function result(candidates) {
    if (!candidates.length) return {date:null,raw:"",source:null,field:null,problem:"missing"};
    var first = candidates[0], dates = candidates.map(function(candidate) { return parseDate(candidate.raw); });
    var distinct = candidates.map(function(candidate, index) { return dates[index] || "!" + candidate.raw; })
      .filter(function(value, index, all) { return all.indexOf(value) === index; });
    var problem = distinct.length > 1 ? "conflict" : dates[0] ? null : "invalid";
    return {date:problem ? null : dates[0],raw:first.raw,source:first.source,field:first.field,problem:problem};
  }
  function resolve(row, options) {
    row = row || {};
    options = options || {};
    var jiraMode = !(row.sheetName || row.excelRowNumber) && !!(row.storyDetails || row.activityDetails);
    if (!jiraMode) return result(values(row.sourceColumns, options.columnMap, "excel"));
    var jiraKey = key(row.createdKey || row.jiraKey || row.storyDetails && row.storyDetails.key);
    var matching = jiraKey && Array.isArray(options.journalRows) ? options.journalRows.filter(function(journalRow) {
      return key(journalRow && (journalRow.createdKey || journalRow.jiraKey)) === jiraKey;
    }) : [];
    if (matching.length) {
      var candidates = [];
      matching.forEach(function(journalRow) { candidates = candidates.concat(values(journalRow.sourceColumns, options.columnMap, "excel")); });
      return result(candidates);
    }
    var details = row.storyDetails || row.activityDetails || {};
    return result(values(importedColumns(details.description), options.columnMap, "jira-description"));
  }

  return {resolve:resolve};
});
