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

  function getAmdRequire() {
    if (typeof require === "function") return require;
    if (typeof window !== "undefined" && typeof window.require === "function") return window.require;
    return null;
  }

  function loadAmdJsZip() {
    var req = getAmdRequire();
    if (!req) return Promise.resolve(null);
    return new Promise(function(resolve) {
      try {
        req(
          ["jszip"],
          function(jszip) {
            resolve(isUsableJsZip(jszip) ? jszip : null);
          },
          function() {
            resolve(null);
          }
        );
      } catch (_err) {
        resolve(null);
      }
    });
  }

  function ensureJsZip() {
    var existing = getGlobalJsZip();
    if (isUsableJsZip(existing)) return Promise.resolve(existing);
    if (!loadPromise) {
      loadPromise = loadScript(config.DEFAULT_JSZIP_URL).then(function() {
        var loaded = getGlobalJsZip();
        if (isUsableJsZip(loaded)) return loaded;
        return loadAmdJsZip().then(function(amdJsZip) {
          if (isUsableJsZip(amdJsZip)) return amdJsZip;
          loaded = getGlobalJsZip();
          if (isUsableJsZip(loaded)) return loaded;
          throw new Error("JSZip is unavailable");
        });
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

  function cellAttributesXml(cellXml) {
    var match = /^<c\b([^>]*?)(?:\/>|>)/i.exec(cellXml || "");
    if (!match) return "";
    return match[1].replace(/\s(?:r|t)="[^"]*"/gi, "");
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
    var re = /<c\b(?=[^>]*\br="([A-Z]+\d+)")[^>]*?(?:\/>|>[\s\S]*?<\/c>)/gi;
    var match;
    if (!row) return out;
    while ((match = re.exec(row.text))) {
      var cellXml = match[0];
      var text = cellTextFromXml(cellXml, sharedStrings).trim();
      var ref = match[1] || "";
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

  function headerColumnsForPatch(xml, options) {
    options = options || {};
    return mergeColumns(
      headerColumnsFromWorksheetXml(xml, options.headerRowNumber || 0, options.sharedStrings || []),
      options.headerColumns || {}
    );
  }

  function buildInlineCell(ref, value, styleAttr) {
    return '<c r="' + escapeXml(ref) + '"' + (styleAttr || "") + ' t="inlineStr"><is><t>' + escapeXml(value) + "</t></is></c>";
  }

  function nearestRowStyleAttr(rowXml, columnNumber) {
    var re = /<c\b(?=[^>]*\br="([A-Z]+\d+)")[^>]*?(?:\/>|>[\s\S]*?<\/c>)/gi;
    var nearestDistance = Infinity;
    var nearestStyle = "";
    var match;
    while ((match = re.exec(rowXml || ""))) {
      var column = cellRefColumnNumber(match[1]);
      var style = /\ss="[^"]*"/i.exec(match[0] || "");
      var distance;
      if (!column || !style) continue;
      distance = Math.abs(column - columnNumber);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestStyle = style[0];
      }
    }
    return nearestStyle;
  }

  function patchCellInRow(rowXml, columnNumber, rowNumber, value) {
    var ref = columnNumberToName(columnNumber) + String(rowNumber);
    var cellRe = new RegExp("<c\\b(?=[^>]*\\br=\"" + escapeRegExp(ref) + "\")[^>]*?(?:\\/>|>[\\s\\S]*?<\\/c>)", "i");
    var match = cellRe.exec(rowXml);
    if (match) {
      return rowXml.slice(0, match.index) +
        buildInlineCell(ref, value, cellAttributesXml(match[0])) +
        rowXml.slice(match.index + match[0].length);
    }

    var insert = buildInlineCell(ref, value, nearestRowStyleAttr(rowXml, columnNumber));
    var allCellsRe = /<c\b(?=[^>]*\br="([A-Z]+\d+)")[^>]*?(?:\/>|>[\s\S]*?<\/c>)/gi;
    var cell;
    while ((cell = allCellsRe.exec(rowXml))) {
      var nextColumn = cellRefColumnNumber(cell[1]);
      if (nextColumn > columnNumber) {
        return rowXml.slice(0, cell.index) + insert + rowXml.slice(cell.index);
      }
    }
    return rowXml.replace(/<\/row>$/i, insert + "</row>");
  }

  function expandRowSpans(rowXml) {
    var re = /<c\b(?=[^>]*\br="([A-Z]+\d+)")[^>]*?(?:\/>|>[\s\S]*?<\/c>)/gi;
    var minColumn = 0;
    var maxColumn = 0;
    var match;
    while ((match = re.exec(rowXml || ""))) {
      var column = cellRefColumnNumber(match[1]);
      if (!column) continue;
      if (!minColumn || column < minColumn) minColumn = column;
      if (column > maxColumn) maxColumn = column;
    }
    if (!minColumn || !maxColumn || !/\bspans="[^"]*"/.test(rowXml || "")) return rowXml;
    return rowXml.replace(/\bspans="[^"]*"/, 'spans="' + String(minColumn) + ":" + String(maxColumn) + '"');
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
    var headerColumns = headerColumnsForPatch(xml, options);
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
      rowXml = expandRowSpans(rowXml);
      out = out.slice(0, row.index) + rowXml + out.slice(row.index + row.text.length);
    });
    return expandDimension(out, options.rows || [], headerColumns);
  }

  function cellCommentsForWorksheet(xml, patch) {
    var options = patch || {};
    var headerColumns = headerColumnsForPatch(xml, options);
    var out = [];
    (options.rows || []).forEach(function(rowPatch) {
      var rowNumber = Number(rowPatch && rowPatch.excelRowNumber) || 0;
      var comments = rowPatch && rowPatch.comments ? rowPatch.comments : {};
      if (!rowNumber) return;
      Object.keys(comments).forEach(function(columnName) {
        var text = comments[columnName] != null ? String(comments[columnName]).trim() : "";
        var columnNumber = Number(headerColumns[columnName]) || 0;
        if (!text || !columnNumber) return;
        out.push({
          ref: columnNumberToName(columnNumber) + String(rowNumber),
          rowNumber: rowNumber,
          columnNumber: columnNumber,
          text: text,
        });
      });
    });
    return out;
  }

  function buildCommentXml(comment, index) {
    return '<comment ref="' + escapeXml(comment.ref) + '" authorId="0" shapeId="' + String(index) + '">' +
      '<text><r><rPr><sz val="9"/><color indexed="81"/><rFont val="Tahoma"/><family val="2"/></rPr>' +
      '<t xml:space="preserve">' + escapeXml(comment.text) + '</t></r></text></comment>';
  }

  function existingCommentXmlItems(xml, refsToReplace) {
    var out = [];
    var re = /<comment\b(?=[^>]*\bref="([^"]*)")[^>]*>[\s\S]*?<\/comment>/gi;
    var match;
    while ((match = re.exec(xml || ""))) {
      if (!refsToReplace[decodeXml(match[1] || "")]) out.push(match[0]);
    }
    return out;
  }

  function patchCommentsXml(xml, comments) {
    var list = comments || [];
    var refs = {};
    var existing = String(xml || "");
    var kept;
    var commentXml;
    if (!list.length && existing) return existing;
    list.forEach(function(comment) {
      if (comment && comment.ref) refs[String(comment.ref)] = true;
    });
    kept = existingCommentXmlItems(existing, refs);
    commentXml = kept.concat(list.map(buildCommentXml)).join("");
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<comments xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<authors><author>UJG</author></authors><commentList>' +
      commentXml +
      '</commentList></comments>';
  }

  function ensureWorksheetRNamespace(xml) {
    var text = String(xml || "");
    if (/\sxmlns:r=/.test(text)) return text;
    return text.replace(/<worksheet\b([^>]*)>/i, '<worksheet$1 xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">');
  }

  function ensureWorksheetLegacyDrawing(xml, relId) {
    var text = ensureWorksheetRNamespace(xml);
    if (/<legacyDrawing\b/i.test(text)) return text;
    return text.replace(/<\/worksheet>\s*$/i, '<legacyDrawing r:id="' + escapeXml(relId) + '"/></worksheet>');
  }

  function ensureContentTypeDefault(xml, extension, contentType) {
    var text = String(xml || "");
    var re = new RegExp('<Default\\b(?=[^>]*\\bExtension="' + escapeRegExp(extension) + '")[^>]*>', "i");
    if (re.test(text)) return text;
    return text.replace("</Types>", '<Default Extension="' + escapeXml(extension) + '" ContentType="' + escapeXml(contentType) + '"/></Types>');
  }

  function ensureContentTypeOverride(xml, partName, contentType) {
    var text = String(xml || "");
    var re = new RegExp('<Override\\b(?=[^>]*\\bPartName="' + escapeRegExp(partName) + '")[^>]*>', "i");
    if (re.test(text)) return text;
    return text.replace("</Types>", '<Override PartName="' + escapeXml(partName) + '" ContentType="' + escapeXml(contentType) + '"/></Types>');
  }

  function relationshipXml(id, type, target) {
    return '<Relationship Id="' + escapeXml(id) + '" Type="' + escapeXml(type) + '" Target="' + escapeXml(target) + '"/>';
  }

  function emptyRelationshipsXml() {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';
  }

  function nextRelationshipId(xml) {
    var max = 0;
    var re = /\bId="rId(\d+)"/gi;
    var match;
    while ((match = re.exec(xml || ""))) {
      max = Math.max(max, Number(match[1]) || 0);
    }
    return "rId" + String(max + 1);
  }

  function relationshipByType(xml, type) {
    var re = /<Relationship\b[^>]*\/?>/gi;
    var match;
    while ((match = re.exec(xml || ""))) {
      if (attrValue(match[0], "Type") === type) return {
        id: attrValue(match[0], "Id"),
        target: attrValue(match[0], "Target"),
      };
    }
    return null;
  }

  function appendRelationship(xml, id, type, target) {
    var text = String(xml || "") || emptyRelationshipsXml();
    return text.replace("</Relationships>", relationshipXml(id, type, target) + "</Relationships>");
  }

  function dirname(path) {
    return String(path || "").replace(/\/[^\/]*$/, "");
  }

  function basename(path) {
    var text = String(path || "");
    return text.slice(text.lastIndexOf("/") + 1);
  }

  function worksheetRelsPath(sheetPath) {
    return dirname(sheetPath) + "/_rels/" + basename(sheetPath) + ".rels";
  }

  function normalizePartPath(path) {
    var parts = [];
    String(path || "").split("/").forEach(function(part) {
      if (!part || part === ".") return;
      if (part === "..") parts.pop();
      else parts.push(part);
    });
    return parts.join("/");
  }

  function resolvePartTarget(fromPartPath, target) {
    var raw = String(target || "");
    if (raw.charAt(0) === "/") return raw.replace(/^\/+/, "");
    return normalizePartPath(dirname(fromPartPath) + "/" + raw);
  }

  function relativeTargetFromWorksheet(partPath) {
    var text = String(partPath || "");
    if (text.indexOf("xl/") === 0) return "../" + text.slice(3);
    return text;
  }

  function nextPartPath(zip, prefix, suffix) {
    var index = 1;
    var path;
    do {
      path = prefix + String(index) + suffix;
      index += 1;
    } while (zip.file(path));
    return path;
  }

  function baseVmlXml() {
    return '<xml xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel">' +
      '<o:shapelayout v:ext="edit"><o:idmap v:ext="edit" data="1"/></o:shapelayout>' +
      '<v:shapetype id="_x0000_t202" coordsize="21600,21600" o:spt="202" path="m,l,21600r21600,l21600,xe">' +
      '<v:stroke joinstyle="miter"/><v:path gradientshapeok="t" o:connecttype="rect"/></v:shapetype></xml>';
  }

  function nextVmlShapeId(xml) {
    var max = 1024;
    var re = /_x0000_s(\d+)/g;
    var match;
    while ((match = re.exec(xml || ""))) {
      max = Math.max(max, Number(match[1]) || 0);
    }
    return max + 1;
  }

  function vmlShapeXml(comment, shapeId) {
    var row = Math.max(0, Number(comment.rowNumber) - 1);
    var column = Math.max(0, Number(comment.columnNumber) - 1);
    var anchor = [column + 1, 15, row, 2, column + 3, 15, row + 4, 16].join(", ");
    return '<v:shape id="_x0000_s' + String(shapeId) + '" type="#_x0000_t202" ' +
      'style="position:absolute;margin-left:80pt;margin-top:5pt;width:180pt;height:90pt;z-index:1;visibility:hidden" fillcolor="#ffffe1" o:insetmode="auto">' +
      '<v:fill color2="#ffffe1"/><v:shadow on="t" color="black" obscured="t"/><v:path o:connecttype="none"/>' +
      '<v:textbox style="mso-direction-alt:auto"><div style="text-align:left"></div></v:textbox>' +
      '<x:ClientData ObjectType="Note"><x:MoveWithCells/><x:SizeWithCells/><x:Anchor>' + anchor + '</x:Anchor>' +
      '<x:AutoFill>False</x:AutoFill><x:Row>' + String(row) + '</x:Row><x:Column>' + String(column) + '</x:Column></x:ClientData></v:shape>';
  }

  function removeExistingVmlShapes(xml, comments) {
    var refs = {};
    (comments || []).forEach(function(comment) {
      refs[String(Math.max(0, Number(comment.rowNumber) - 1)) + ":" + String(Math.max(0, Number(comment.columnNumber) - 1))] = true;
    });
    return String(xml || "").replace(/<v:shape\b[\s\S]*?<\/v:shape>/gi, function(shape) {
      var row = /<x:Row>(\d+)<\/x:Row>/i.exec(shape);
      var column = /<x:Column>(\d+)<\/x:Column>/i.exec(shape);
      var key = (row ? row[1] : "") + ":" + (column ? column[1] : "");
      return refs[key] ? "" : shape;
    });
  }

  function patchVmlDrawingXml(xml, comments) {
    var text = String(xml || "") || baseVmlXml();
    var nextId;
    text = removeExistingVmlShapes(text, comments);
    nextId = nextVmlShapeId(text);
    (comments || []).forEach(function(comment) {
      text = text.replace(/<\/xml>\s*$/i, vmlShapeXml(comment, nextId) + "</xml>");
      nextId += 1;
    });
    return text;
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

  function applyWorksheetComments(zip, sheetPath, sheetXml, patch, comments) {
    if (!comments.length) return Promise.resolve(sheetXml);
    var relsPath = worksheetRelsPath(sheetPath);
    var commentsRelType = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments";
    var vmlRelType = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/vmlDrawing";
    return Promise.all([
      zip.file("[Content_Types].xml") ? zip.file("[Content_Types].xml").async("string") : "",
      zip.file(relsPath) ? zip.file(relsPath).async("string") : "",
    ]).then(function(parts) {
      var contentTypesXml = parts[0] || "";
      var sheetRelsXml = parts[1] || emptyRelationshipsXml();
      var commentsRel = relationshipByType(sheetRelsXml, commentsRelType);
      var vmlRel = relationshipByType(sheetRelsXml, vmlRelType);
      var commentsPath;
      var vmlPath;
      var commentsId;
      var vmlId;
      var existingCommentsPromise;
      var existingVmlPromise;

      if (commentsRel && commentsRel.target) {
        commentsPath = resolvePartTarget(sheetPath, commentsRel.target);
      } else {
        commentsPath = nextPartPath(zip, "xl/comments", ".xml");
        commentsId = nextRelationshipId(sheetRelsXml);
        sheetRelsXml = appendRelationship(sheetRelsXml, commentsId, commentsRelType, relativeTargetFromWorksheet(commentsPath));
      }

      if (vmlRel && vmlRel.target) {
        vmlPath = resolvePartTarget(sheetPath, vmlRel.target);
      } else {
        vmlPath = nextPartPath(zip, "xl/drawings/vmlDrawing", ".vml");
        vmlId = nextRelationshipId(sheetRelsXml);
        sheetRelsXml = appendRelationship(sheetRelsXml, vmlId, vmlRelType, relativeTargetFromWorksheet(vmlPath));
        sheetXml = ensureWorksheetLegacyDrawing(sheetXml, vmlId);
      }

      if (contentTypesXml) {
        contentTypesXml = ensureContentTypeDefault(contentTypesXml, "vml", "application/vnd.openxmlformats-officedocument.vmlDrawing");
        contentTypesXml = ensureContentTypeOverride(contentTypesXml, "/" + commentsPath, "application/vnd.openxmlformats-officedocument.spreadsheetml.comments+xml");
        zip.file("[Content_Types].xml", contentTypesXml);
      }

      existingCommentsPromise = zip.file(commentsPath) ? zip.file(commentsPath).async("string") : Promise.resolve("");
      existingVmlPromise = zip.file(vmlPath) ? zip.file(vmlPath).async("string") : Promise.resolve("");

      return Promise.all([existingCommentsPromise, existingVmlPromise]).then(function(existingParts) {
        zip.file(commentsPath, patchCommentsXml(existingParts[0] || "", comments));
        zip.file(vmlPath, patchVmlDrawingXml(existingParts[1] || "", comments));
        zip.file(relsPath, sheetRelsXml);
        return sheetXml;
      });
    });
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
            var comments = cellCommentsForWorksheet(sheetXml, Object.assign({}, patch, { sharedStrings: sharedStrings }));
            var patchedXml = patchWorksheetXml(sheetXml, Object.assign({}, patch, { sharedStrings: sharedStrings }));
            return applyWorksheetComments(zip, sheetPath, patchedXml, patch, comments).then(function(patchedWithCommentsXml) {
              zip.file(sheetPath, patchedWithCommentsXml);
              return zip.generateAsync({
                type: typeof Blob !== "undefined" ? "blob" : "arraybuffer",
                mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
              });
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
    cellCommentsForWorksheet: cellCommentsForWorksheet,
    patchCommentsXml: patchCommentsXml,
    patchVmlDrawingXml: patchVmlDrawingXml,
    ensureWorksheetLegacyDrawing: ensureWorksheetLegacyDrawing,
    parseSharedStrings: parseSharedStrings,
    headerColumnsFromWorksheetXml: headerColumnsFromWorksheetXml,
    columnNumberToName: columnNumberToName,
    columnNameToNumber: columnNameToNumber,
  };
});
