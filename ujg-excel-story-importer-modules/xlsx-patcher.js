define("_ujgESI_xlsxPatcher", ["_ujgESI_config"], function(config) {
  "use strict";

  var loadPromise = null;

  function loadScript(url) {
    return new Promise(function(resolve, reject) {
      var s = document.createElement("script");
      s.src = url;
      s.onload = function() {
        resolve();
      };
      s.onerror = function() {
        reject(new Error("JSZip load failed"));
      };
      document.head.appendChild(s);
    });
  }

  function getGlobalJsZip() {
    if (typeof window !== "undefined" && window.JSZip) return window.JSZip;
    if (typeof globalThis !== "undefined" && globalThis.JSZip) return globalThis.JSZip;
    if (typeof JSZip !== "undefined") return JSZip;
    return null;
  }

  function isUsableJsZip(jszip) {
    return !!(jszip && typeof jszip.loadAsync === "function");
  }

  function ensureJsZip() {
    var existing = getGlobalJsZip();
    if (isUsableJsZip(existing)) return Promise.resolve(existing);
    if (!loadPromise) {
      loadPromise = loadScript(config.DEFAULT_JSZIP_URL).then(function() {
        var loaded = getGlobalJsZip();
        if (isUsableJsZip(loaded)) return loaded;
        throw new Error("JSZip is unavailable");
      });
    }
    return loadPromise;
  }

  function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function escapeXml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }

  function decodeXml(value) {
    return String(value == null ? "" : value)
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&");
  }

  function columnNumberToName(number) {
    var n = Number(number);
    var out = "";
    while (n > 0) {
      n -= 1;
      out = String.fromCharCode(65 + (n % 26)) + out;
      n = Math.floor(n / 26);
    }
    return out;
  }

  function columnNameToNumber(name) {
    var text = String(name || "").toUpperCase();
    var out = 0;
    var i;
    for (i = 0; i < text.length; i += 1) {
      var code = text.charCodeAt(i);
      if (code < 65 || code > 90) continue;
      out = out * 26 + code - 64;
    }
    return out;
  }

  function cellRefColumnNumber(ref) {
    var match = /^([A-Z]+)/i.exec(String(ref || ""));
    return match ? columnNameToNumber(match[1]) : 0;
  }

  function attrValue(xml, name) {
    var match = new RegExp("\\b" + escapeRegExp(name) + "=\"([^\"]*)\"").exec(xml || "");
    return match ? decodeXml(match[1]) : "";
  }

  function attrXml(xml, name) {
    var match = new RegExp("\\s" + escapeRegExp(name) + "=\"[^\"]*\"").exec(xml || "");
    return match ? match[0] : "";
  }

  function extractRowXml(xml, rowNumber) {
    var re = new RegExp("<row\\b[^>]*\\br=\"" + escapeRegExp(String(rowNumber)) + "\"[^>]*>[\\s\\S]*?<\\/row>", "i");
    var match = re.exec(xml || "");
    return match ? { text: match[0], index: match.index } : null;
  }

  function textFromRuns(xml) {
    var out = "";
    var re = /<t\b[^>]*>([\s\S]*?)<\/t>/gi;
    var match;
    while ((match = re.exec(xml || ""))) {
      out += decodeXml(match[1]);
    }
    return out;
  }

  function parseSharedStrings(xml) {
    var out = [];
    var re = /<si\b[^>]*>([\s\S]*?)<\/si>/gi;
    var match;
    while ((match = re.exec(xml || ""))) {
      out.push(textFromRuns(match[1]));
    }
    return out;
  }

  function cellTextFromXml(cellXml, sharedStrings) {
    var type = attrValue(cellXml, "t");
    var inlineText = textFromRuns(cellXml);
    var valueMatch;
    if (type === "inlineStr" || inlineText) return inlineText;
    valueMatch = /<v\b[^>]*>([\s\S]*?)<\/v>/i.exec(cellXml || "");
    if (!valueMatch) return "";
    if (type === "s") {
      var index = Number(decodeXml(valueMatch[1]));
      return sharedStrings && sharedStrings[index] != null ? sharedStrings[index] : "";
    }
    return decodeXml(valueMatch[1]);
  }

  function headerColumnsFromWorksheetXml(xml, headerRowNumber, sharedStrings) {
    var row = extractRowXml(xml, headerRowNumber);
    var out = {};
    var re = /<c\b[^>]*\br="([A-Z]+\d+)"[^>]*>[\s\S]*?<\/c>|<c\b[^>]*\br="([A-Z]+\d+)"[^>]*\/>/gi;
    var match;
    if (!row) return out;
    while ((match = re.exec(row.text))) {
      var cellXml = match[0];
      var text = cellTextFromXml(cellXml, sharedStrings).trim();
      var ref = match[1] || match[2] || "";
      if (text && !Object.prototype.hasOwnProperty.call(out, text)) {
        out[text] = cellRefColumnNumber(ref);
      }
    }
    return out;
  }

  function mergeColumns(primary, fallback) {
    var out = {};
    Object.keys(primary || {}).forEach(function(key) {
      if (primary[key]) out[key] = primary[key];
    });
    Object.keys(fallback || {}).forEach(function(key) {
      if (!out[key] && fallback[key]) out[key] = fallback[key];
    });
    return out;
  }

  function buildInlineCell(ref, value, styleAttr) {
    return '<c r="' + escapeXml(ref) + '"' + (styleAttr || "") + ' t="inlineStr"><is><t>' + escapeXml(value) + "</t></is></c>";
  }

  function patchCellInRow(rowXml, columnNumber, rowNumber, value) {
    var ref = columnNumberToName(columnNumber) + String(rowNumber);
    var cellRe = new RegExp("<c\\b[^>]*\\br=\"" + escapeRegExp(ref) + "\"[^>]*(?:>[\\s\\S]*?<\\/c>|\\/>)", "i");
    var match = cellRe.exec(rowXml);
    if (match) {
      return rowXml.slice(0, match.index) +
        buildInlineCell(ref, value, attrXml(match[0], "s")) +
        rowXml.slice(match.index + match[0].length);
    }

    var insert = buildInlineCell(ref, value, "");
    var allCellsRe = /<c\b[^>]*\br="([A-Z]+\d+)"[^>]*(?:>[\s\S]*?<\/c>|\/>)/gi;
    var cell;
    while ((cell = allCellsRe.exec(rowXml))) {
      if (cellRefColumnNumber(cell[1]) > columnNumber) {
        return rowXml.slice(0, cell.index) + insert + rowXml.slice(cell.index);
      }
    }
    return rowXml.replace(/<\/row>$/i, insert + "</row>");
  }

  function expandDimension(xml, rows, headerColumns) {
    var match = /<dimension\b[^>]*\bref="([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?"[^>]*\/>/i.exec(xml || "");
    var maxColumn = 0;
    var maxRow = 0;
    if (!match) return xml;
    maxColumn = columnNameToNumber(match[3] || match[1]);
    maxRow = Number(match[4] || match[2]) || 0;
    (rows || []).forEach(function(rowPatch) {
      var rowNumber = Number(rowPatch && rowPatch.excelRowNumber) || 0;
      var values = rowPatch && rowPatch.values ? rowPatch.values : {};
      if (rowNumber > maxRow) maxRow = rowNumber;
      Object.keys(values).forEach(function(columnName) {
        var columnNumber = Number(headerColumns[columnName]) || 0;
        if (columnNumber > maxColumn) maxColumn = columnNumber;
      });
    });
    if (!maxColumn || !maxRow) return xml;
    return xml.replace(/(<dimension\b[^>]*\bref=")([A-Z]+\d+)(?::([A-Z]+\d+))?("[^>]*\/>)/i, function(_all, before, start, _end, after) {
      return before + start + ":" + columnNumberToName(maxColumn) + String(maxRow) + after;
    });
  }

  function patchWorksheetXml(xml, patch) {
    var options = patch || {};
    var headerColumns = mergeColumns(
      headerColumnsFromWorksheetXml(xml, options.headerRowNumber || 0, options.sharedStrings || []),
      options.headerColumns || {}
    );
    var out = String(xml || "");
    (options.rows || []).forEach(function(rowPatch) {
      var rowNumber = rowPatch && rowPatch.excelRowNumber;
      var values = rowPatch && rowPatch.values ? rowPatch.values : {};
      var row = extractRowXml(out, rowNumber);
      var rowXml;
      if (!row) return;
      rowXml = row.text;
      Object.keys(values).forEach(function(columnName) {
        var columnNumber = headerColumns[columnName];
        if (!columnNumber) return;
        rowXml = patchCellInRow(rowXml, columnNumber, rowNumber, values[columnName]);
      });
      out = out.slice(0, row.index) + rowXml + out.slice(row.index + row.text.length);
    });
    return expandDimension(out, options.rows || [], headerColumns);
  }

  function sheetRelationshipId(workbookXml, sheetName) {
    var re = /<sheet\b[^>]*\/?>/gi;
    var match;
    while ((match = re.exec(workbookXml || ""))) {
      if (attrValue(match[0], "name") === String(sheetName || "")) return attrValue(match[0], "r:id");
    }
    return "";
  }

  function relationshipTarget(relsXml, relationshipId) {
    var re = /<Relationship\b[^>]*\/?>/gi;
    var match;
    while ((match = re.exec(relsXml || ""))) {
      if (attrValue(match[0], "Id") === String(relationshipId || "")) return attrValue(match[0], "Target");
    }
    return "";
  }

  function normalizeSheetPath(target) {
    var text = String(target || "").replace(/^\/+/, "");
    if (text.indexOf("xl/") === 0) return text;
    return "xl/" + text.replace(/^\.\.\//, "");
  }

  function firstWorksheetPath(zip) {
    var files = Object.keys(zip.files || {}).filter(function(name) {
      return /^xl\/worksheets\/sheet\d+\.xml$/i.test(name);
    });
    files.sort();
    return files[0] || "";
  }

  function patchWorkbook(buffer, patch) {
    return ensureJsZip().then(function(JSZip) {
      return JSZip.loadAsync(buffer).then(function(zip) {
        return Promise.all([
          zip.file("xl/workbook.xml") ? zip.file("xl/workbook.xml").async("string") : "",
          zip.file("xl/_rels/workbook.xml.rels") ? zip.file("xl/_rels/workbook.xml.rels").async("string") : "",
          zip.file("xl/sharedStrings.xml") ? zip.file("xl/sharedStrings.xml").async("string") : "",
        ]).then(function(parts) {
          var workbookXml = parts[0] || "";
          var relsXml = parts[1] || "";
          var sharedStrings = parseSharedStrings(parts[2] || "");
          var relId = patch && patch.sheetName ? sheetRelationshipId(workbookXml, patch.sheetName) : "";
          var target = relId ? relationshipTarget(relsXml, relId) : "";
          var sheetPath = target ? normalizeSheetPath(target) : firstWorksheetPath(zip);
          if (!sheetPath || !zip.file(sheetPath)) throw new Error("Worksheet not found");
          return zip.file(sheetPath).async("string").then(function(sheetXml) {
            var patchedXml = patchWorksheetXml(sheetXml, Object.assign({}, patch, { sharedStrings: sharedStrings }));
            zip.file(sheetPath, patchedXml);
            return zip.generateAsync({
              type: typeof Blob !== "undefined" ? "blob" : "arraybuffer",
              mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            });
          });
        });
      });
    });
  }

  return {
    ensureJsZip: ensureJsZip,
    patchWorkbook: patchWorkbook,
    patchWorksheetXml: patchWorksheetXml,
    parseSharedStrings: parseSharedStrings,
    headerColumnsFromWorksheetXml: headerColumnsFromWorksheetXml,
    columnNumberToName: columnNumberToName,
    columnNameToNumber: columnNameToNumber,
  };
});
