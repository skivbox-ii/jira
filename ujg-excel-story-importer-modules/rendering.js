define("_ujgESI_rendering", ["jquery", "_ujgESI_grid", "_ujgESI_icons", "_ujgESI_teamsUi", "_ujgESI_statisticsUi", "_ujgESI_activityUi"], function($, gridModule, icon, teamsUi, statisticsUi, activityUi) {
  "use strict";

  var $root;
  var services;
  var SUMMARY_MAX_LENGTH = 255;
  var epicSearchTimer = null;
  var grid;
  var activityView;
  var mermaidLoad;
  var mermaidRenderSequence = 0;
  var fullscreenHost, fullscreenStyle, fullscreenScroll, fullscreen = false;

  function loadMermaid() {
    if (window.mermaid) return Promise.resolve(window.mermaid);
    if (mermaidLoad) return mermaidLoad;
    mermaidLoad = new Promise(function(resolve, reject) {
      var script = document.createElement("script"), settled = false;
      var timer = setTimeout(function() { finish(new Error("Mermaid timed out")); }, 8000);
      function finish(error) {
        if (settled) return;
        settled = true; clearTimeout(timer);
        if (error) reject(error); else resolve(window.mermaid);
      }
      script.src = "https://cdn.jsdelivr.net/npm/mermaid@11.15.0/dist/mermaid.min.js";
      script.async = true;
      script.onload = function() { finish(window.mermaid ? null : new Error("Mermaid unavailable")); };
      script.onerror = function() { finish(new Error("Mermaid load failed")); };
      document.head.appendChild(script);
    }).catch(function(error) { mermaidLoad = null; throw error; });
    return mermaidLoad;
  }

  function renderDiagram($node, source) {
    if (/%%\{|^---\s*$|\b(?:https?:|data:|click\s|href\s|image\s*:|img\s*:)/im.test(source)) return;
    // Mermaid can fetch assets while rendering, before the SVG is sanitized.
    if (/@\s*\{|url\s*\(|@\s*import\b|!\s*\[|<\s*\/?\s*(?:img|image|iframe|video|audio|source|link|style|script|object|embed)\b/i.test(source)) return;
    var renderId = "ujg-esi-mermaid-" + (++mermaidRenderSequence) + "-" + Math.random().toString(36).slice(2);
    function cleanupRender() {
      ["d" + renderId, "i" + renderId, renderId].forEach(function(id) {
        var node = document.getElementById(id);
        if (node) node.remove();
      });
    }
    loadMermaid().then(function(lib) {
      if (!$node[0] || !$node[0].isConnected) return;
      lib.initialize({
        startOnLoad: false, securityLevel: "strict", htmlLabels: false, suppressErrorRendering: true,
        secure: ["securityLevel", "startOnLoad", "secure", "htmlLabels", "flowchart", "suppressErrorRendering"],
        flowchart: { htmlLabels: false }
      });
      return lib.render(renderId, source);
    }).then(function(result) {
      cleanupRender();
      if (!result || !$node[0] || !$node[0].isConnected) return;
      var svg = new DOMParser().parseFromString(result.svg, "image/svg+xml").documentElement;
      if (svg.localName !== "svg" || svg.querySelector("parsererror")) return;
      svg.querySelectorAll("script,foreignObject,image,feImage,use,a,iframe,animate,set").forEach(function(node) { node.remove(); });
      [svg].concat(Array.from(svg.querySelectorAll("*"))).forEach(function(node) {
        Array.from(node.attributes).forEach(function(attr) {
          if (/^on/i.test(attr.name) || /href/i.test(attr.name) || /url\s*\(\s*(?!['"]?#)/i.test(attr.value)) node.removeAttribute(attr.name);
        });
      });
      svg.querySelectorAll("style").forEach(function(node) {
        if (/@import|url\s*\(\s*(?!['"]?#)/i.test(node.textContent)) node.remove();
      });
      $node.empty().append(document.importNode(svg, true));
    }).catch(function() { cleanupRender(); /* The source remains readable. */ });
  }

  function wikiRowEnds(line, marker) {
    if (!line.endsWith(marker)) return false;
    var slashes = 0;
    for (var i = line.length - marker.length - 1; i >= 0 && line[i] === "\\"; i--) slashes++;
    return slashes % 2 === 0;
  }

  function wikiCells(line, marker) {
    if (!line.startsWith(marker) || !wikiRowEnds(line, marker)) return null;
    var cells = [], current = "";
    for (var i = marker.length; i < line.length - marker.length; i++) {
      var ch = line[i];
      if (ch === "\\" && (line[i + 1] === "|" || line[i + 1] === "\\")) { current += line[++i]; continue; }
      if (ch === "|" && (marker === "|" || line[i + 1] === "|")) {
        cells.push(current.trim()); current = "";
        if (marker === "||") i++;
      } else current += ch;
    }
    cells.push(current.trim());
    return cells;
  }

  function init(container, svc) {
    $root = container;
    services = svc || {};
    grid = gridModule.create();
    activityView = activityUi ? activityUi.create() : null;
    $(document).off("keydown.ujgEsiFullscreen").on("keydown.ujgEsiFullscreen", function(event) {
      if (event.key !== "Escape" || event.isPropagationStopped()) return;
      if (grid.dismissPopover()) { event.stopPropagation(); return; }
      if (!fullscreen) return;
      if ($(event.target).closest("[role='dialog'],.ujg-esi-grid-menu").length) return;
      toggleFullscreen();
    });
  }

  function toggleFullscreen() {
    if (!fullscreen) {
      fullscreenHost = $root.closest(".dashboard-item-content, .gadget, .ujg-gadget-wrapper");
      if (!fullscreenHost.length) fullscreenHost = $root;
      fullscreenStyle = fullscreenHost.attr("style");
      fullscreenScroll = { top: fullscreenHost.scrollTop(), left: fullscreenHost.scrollLeft() };
      fullscreenHost.addClass("ujg-esi-fullscreen");
      fullscreen = true;
    } else {
      fullscreenHost.removeClass("ujg-esi-fullscreen");
      if (fullscreenStyle == null) fullscreenHost.removeAttr("style"); else fullscreenHost.attr("style", fullscreenStyle);
      fullscreenHost.scrollTop(fullscreenScroll.top).scrollLeft(fullscreenScroll.left);
      fullscreen = false;
    }
    $root.find(".ujg-esi-fullscreen-button").empty().append(icon(fullscreen ? "Minimize2" : "Expand"))
      .attr({ title: fullscreen ? "Выйти из полноэкранного режима" : "На весь экран", "aria-label": fullscreen ? "Выйти из полноэкранного режима" : "На весь экран" });
  }

  function scheduleEpicSearch(query) {
    if (typeof clearTimeout === "function" && epicSearchTimer) clearTimeout(epicSearchTimer);
    if (typeof setTimeout === "function") {
      epicSearchTimer = setTimeout(function() {
        epicSearchTimer = null;
        if (services && services.onEpicSearch) services.onEpicSearch(query);
      }, 80);
    } else if (services && services.onEpicSearch) {
      services.onEpicSearch(query);
    }
  }

  function captureScrollState() {
    var selectors = [".ujg-esi-confirm-modal", ".ujg-esi-confirm-scroll", ".ujg-esi-registry-scroll", ".ujg-esi-mapping-panel"];
    var state = {
      windowLeft: typeof window !== "undefined" && window.pageXOffset != null ? window.pageXOffset : null,
      windowTop: typeof window !== "undefined" && window.pageYOffset != null ? window.pageYOffset : null,
      nodes: [],
    };
    if (!$root || !$root.length) return state;
    selectors.forEach(function(selector) {
      $root.find(selector).each(function(index) {
        var $node = $(this);
        state.nodes.push({
          selector: selector,
          index: index,
          left: $node.scrollLeft(),
          top: $node.scrollTop(),
        });
      });
    });
    return state;
  }

  function restoreScrollState(state) {
    if (!state || !$root || !$root.length) return;
    (state.nodes || []).forEach(function(item) {
      var $node = $root.find(item.selector).eq(item.index);
      if (!$node.length) return;
      $node.scrollLeft(item.left || 0);
      $node.scrollTop(item.top || 0);
    });
    if (typeof window !== "undefined" && typeof window.scrollTo === "function" && state.windowLeft != null && state.windowTop != null) {
      window.scrollTo(state.windowLeft, state.windowTop);
    }
  }

  function projectLabel(project) {
    var key = project && project.key != null ? String(project.key) : "";
    var name = project && project.name != null ? String(project.name) : "";
    return key && name && name !== key ? key + " - " + name : key || name;
  }

  function epicLabel(epic) {
    var key = epic && epic.key != null ? String(epic.key) : "";
    var fields = epic && epic.fields ? epic.fields : {};
    var summary = fields.summary != null ? String(fields.summary) : epic && epic.summary != null ? String(epic.summary) : "";
    return key && summary && summary !== key ? key + " - " + summary : key || summary;
  }

  function selectedEpicLabel(state) {
    var key = state && state.epicKey != null ? String(state.epicKey) : "";
    if (!key) return "";
    var found = (state.epics || []).filter(function(epic) {
      return epic && String(epic.key || "") === key;
    })[0];
    return epicLabel(found) || key;
  }

  function normalizedSearch(value) {
    return String(value || "").toLowerCase().trim();
  }

  function filteredEpics(state) {
    var picker = state && state.epicPicker ? state.epicPicker : {};
    var query = normalizedSearch(picker.query);
    return (state.epics || []).filter(function(epic) {
      var label = normalizedSearch(epicLabel(epic));
      var key = normalizedSearch(epic && epic.key);
      return !query || label.indexOf(query) !== -1 || key.indexOf(query) !== -1;
    }).slice(0, 50);
  }

  function rowStatusText(row) {
    if (!row) return "";
    if (row.status === "creating") return "Создается";
    if (row.status === "created") return "Создано";
    if (row.status === "partial") return "Частично создано";
    if (row.alreadyLinked || row.status === "linked") return "Уже создано";
    if (row.status === "failed") return "Ошибка";
    return "Готово";
  }

  function canCreateRow(row, state) {
    return !!(
      state.projectKey &&
      row &&
      !row.alreadyLinked &&
      !row.jiraKey &&
      !row.createdKey &&
      row.status !== "creating" &&
      row.status !== "created"
    );
  }

  function rowActionStatusText(row, state) {
    var status = rowStatusText(row);
    if (status !== "Готово") return status;
    if (!state.projectKey) return "Выберите проект";
    return status;
  }


  function wikiInline($parent, text) {
    String(text || "").split(/(\*[^*\n]+\*|_[^_\n]+_|-[^-\n]+-|\+[^\+\n]+\+)/g).forEach(function(part) {
      var node;
      if (!part) return;
      if (/^\*[^*\n]+\*$/.test(part)) node = $("<strong/>").text(part.slice(1, -1));
      else if (/^_[^_\n]+_$/.test(part)) node = $("<em/>").text(part.slice(1, -1));
      else if (/^-[^-\n]+-$/.test(part)) node = $("<span/>").addClass("ujg-esi-wiki-strike").text(part.slice(1, -1));
      else if (/^\+[^\+\n]+\+$/.test(part)) node = $("<u/>").text(part.slice(1, -1));
      else node = document.createTextNode(part);
      $parent.append(node);
    });
  }

  function renderJiraWiki(text) {
    var $wrap = $("<div/>").addClass("ujg-esi-jira-wiki-preview");
    var lines = String(text || "").split(/\n/), $table = null, $lastCell = null;
    for (var index = 0; index < lines.length; index++) {
      var line = lines[index];
      var trimmed = line.trim();
      var $line;
      var fence = /^```mermaid\s*$/i.test(trimmed) ? "```" : /^\{code:mermaid\}\s*$/i.test(trimmed) ? "{code}" : /^\{mermaid\}\s*$/i.test(trimmed) ? "{mermaid}" : null;
      if (fence) {
        var source = [];
        while (++index < lines.length && lines[index].trim() !== fence) source.push(lines[index]);
        var raw = source.join("\n"), $diagram = $("<div/>").addClass("ujg-esi-mermaid-diagram").append($("<pre/>").text(raw));
        $wrap.append($diagram);
        if (index < lines.length) renderDiagram($diagram, raw);
        $table = null; $lastCell = null; continue;
      }
      if (trimmed.charAt(0) === "|" && !wikiRowEnds(trimmed, "|")) {
        while (index + 1 < lines.length && !wikiRowEnds(line.trim(), "|")) line += "\n" + lines[++index];
        trimmed = line.trim();
      }
      var headers = wikiCells(trimmed, "||"), cells = headers ? null : wikiCells(trimmed, "|");
      if (headers || cells) {
        if (!$table) { $table = $("<table/>").addClass("ujg-esi-wiki-table"); $wrap.append($table); }
        var $row = $("<tr/>");
        (headers || cells).forEach(function(value) {
          $lastCell = $(headers ? "<th/>" : "<td/>");
          value.replace(/\\?&#124;/gi, "|").split("\n").forEach(function(part, partIndex) {
            if (partIndex) $lastCell.append($("<br/>"));
            wikiInline($lastCell, part);
          });
          $row.append($lastCell);
        });
        $table.append($row); continue;
      }
      $table = null; $lastCell = null;
      if (!trimmed) {
        $wrap.append($("<div/>").addClass("ujg-esi-wiki-blank").html("&nbsp;"));
        continue;
      }
      if (/^h[1-6]\.\s+/.test(trimmed)) {
        $line = $("<h4/>").text(trimmed.replace(/^h[1-6]\.\s+/, ""));
      } else if (/^#\s+/.test(trimmed)) {
        $line = $("<div/>").addClass("ujg-esi-wiki-list ujg-esi-wiki-ordered");
        wikiInline($line, trimmed.replace(/^#\s+/, ""));
      } else if (/^\*\s+/.test(trimmed)) {
        $line = $("<div/>").addClass("ujg-esi-wiki-list");
        wikiInline($line, trimmed.replace(/^\*\s+/, ""));
      } else {
        $line = $("<p/>");
        wikiInline($line, line);
      }
      $wrap.append($line);
    }
    return $wrap;
  }

  function appendProjectSelect($toolbar, state) {
    var $field = $("<label/>").addClass("ujg-esi-field");
    var $select = $("<select/>").addClass("ujg-esi-project-select");
    $field.append($("<span/>").text("Проект"));
    $select.append($("<option/>").attr("value", "").text("Выберите проект"));
    (state.projects || []).forEach(function(project) {
      var key = project && project.key != null ? String(project.key) : "";
      if (!key) return;
      $select.append($("<option/>").attr("value", key).text(projectLabel(project)));
    });
    $select.val(state.projectKey || "");
    $select.on("change", function() {
      if (services && services.onProjectChange) services.onProjectChange($(this).val());
    });
    $field.append($select);
    $toolbar.append($field);
  }

  function appendEpicPicker($toolbar, state) {
    var picker = state && state.epicPicker ? state.epicPicker : {};
    var disabled = !state.projectKey;
    var active = !disabled && !!picker.open;
    var selected = selectedEpicLabel(state);
    var value = active ? picker.query || "" : selected;
    var $field = $("<label/>").addClass("ujg-esi-field");
    var $wrap = $("<div/>")
      .addClass("ujg-esi-epic-picker")
      .toggleClass("ujg-esi-epic-picker-active", active);
    var $input = $("<input/>")
      .attr("type", "text")
      .attr("autocomplete", "off")
      .attr("placeholder", state.projectKey ? "Поиск Epic" : "Сначала проект")
      .addClass("ujg-esi-epic-search")
      .val(value);
    $field.append($("<span/>").text("Epic"));
    if (disabled) $input.prop("disabled", true);
    $input.on("input", function() {
      var query = $(this).val();
      if (!disabled) scheduleEpicSearch(query);
    });
    $wrap.append($input);
    if (!disabled && state.epicKey) {
      $wrap.append(
        $("<button/>")
          .attr("type", "button")
          .attr("title", "Очистить Epic")
          .addClass("ujg-esi-epic-clear")
          .text("×")
          .on("click", function() {
            if (services && services.onEpicSelect) services.onEpicSelect("");
          })
      );
    }
    if (active) {
      var $options = $("<div/>").addClass("ujg-esi-epic-options");
      $options.append(
        $("<button/>")
          .attr("type", "button")
          .addClass("ujg-esi-epic-option")
          .toggleClass("ujg-esi-epic-option-active", !state.epicKey)
          .text("Без Epic")
          .on("click", function() {
            if (services && services.onEpicSelect) services.onEpicSelect("");
          })
      );
      filteredEpics(state).forEach(function(epic) {
        var key = epic && epic.key != null ? String(epic.key) : "";
        if (!key) return;
        $options.append(
          $("<button/>")
            .attr("type", "button")
            .addClass("ujg-esi-epic-option")
            .toggleClass("ujg-esi-epic-option-active", key === state.epicKey)
            .text(epicLabel(epic))
            .on("click", function() {
              if (services && services.onEpicSelect) services.onEpicSelect(key);
            })
        );
      });
      if (!filteredEpics(state).length) {
        $options.append($("<div/>").addClass("ujg-esi-epic-empty").text("Ничего не найдено"));
      }
      $wrap.append($options);
      if (typeof setTimeout === "function") {
        setTimeout(function() {
          var node = $input[0];
          $input.trigger("focus");
          if (node && node.setSelectionRange) node.setSelectionRange(String($input.val() || "").length, String($input.val() || "").length);
        }, 0);
      }
    }
    $field.append($wrap);
    $toolbar.append($field);
  }

  function appendFileInput($actions) {
    var $upload = $("<label/>")
      .addClass("ujg-esi-icon-button ujg-esi-upload-excel")
      .attr("title", "Загрузить Excel")
      .attr("aria-label", "Загрузить Excel");
    var $file = $("<input/>")
      .addClass("ujg-esi-file")
      .attr("type", "file")
      .attr("accept", ".xlsx,.xls");
    $file.on("change", function() {
      var file = this.files && this.files.length ? this.files[0] : null;
      if (file && services && services.onFileChange) services.onFileChange(file);
    });
    $upload.append(icon("Upload"), $file);
    $actions.append($upload);
  }

  function appendDropzone($parent) {
    var $dropzone = $("<label/>")
      .addClass("ujg-esi-dropzone")
      .attr("title", "Загрузить Excel")
      .attr("aria-label", "Перетащите Excel-файл или нажмите, чтобы выбрать файл");
    var $file = $("<input/>")
      .addClass("ujg-esi-dropzone-file")
      .attr("type", "file")
      .attr("accept", ".xlsx,.xls");
    $file.on("change", function() {
      var file = this.files && this.files.length ? this.files[0] : null;
      if (file && services && services.onFileChange) services.onFileChange(file);
    });
    $dropzone.on("dragenter dragover", function(event) {
      event.preventDefault();
      event.stopPropagation();
      $dropzone.addClass("ujg-esi-dropzone-dragover");
    });
    $dropzone.on("dragleave dragend", function(event) {
      event.preventDefault();
      event.stopPropagation();
      $dropzone.removeClass("ujg-esi-dropzone-dragover");
    });
    $dropzone.on("drop", function(event) {
      var original = event.originalEvent || {};
      var files = original.dataTransfer && original.dataTransfer.files ? original.dataTransfer.files : [];
      var file = files && files.length ? files[0] : null;
      event.preventDefault();
      event.stopPropagation();
      $dropzone.removeClass("ujg-esi-dropzone-dragover");
      if (file && services && services.onFileChange) services.onFileChange(file);
    });
    $dropzone.append($file);
    $parent.append($dropzone);
  }

  function appendMappingButton($actions) {
    var $button = $("<button/>")
      .attr("type", "button")
      .addClass("ujg-esi-icon-button ujg-esi-mapping-button")
      .attr("title", "Настроить мапинг")
      .attr("aria-label", "Настроить мапинг")
      .append(icon("Settings"))
      .on("click", function() {
        if (services && services.onOpenMappings) services.onOpenMappings();
      });
    $actions.append($button);
  }

  function appendSyncActions($actions, state) {
    var rows = state && state.rows ? state.rows : [];
    var canSync = !!rows.length && !(state && state.syncLoading);
    var canDownload = !!(state && state.exportBuffer);
    var $sync = $("<button/>")
      .attr("type", "button")
      .addClass("ujg-esi-icon-button ujg-esi-sync-jira")
      .attr("title", state && state.syncLoading ? "Синхронизация из Jira" : "Синхронизировать из Jira")
      .attr("aria-label", state && state.syncLoading ? "Синхронизация из Jira" : "Синхронизировать из Jira")
      .append(icon("RefreshCw"))
      .prop("disabled", !canSync)
      .on("click", function() {
        if (services && services.onSyncJira) services.onSyncJira();
      });
    var $download = $("<button/>")
      .attr("type", "button")
      .addClass("ujg-esi-icon-button ujg-esi-download-excel")
      .attr("title", "Скачать Excel")
      .attr("aria-label", "Скачать Excel")
      .append(icon("Download"))
      .prop("disabled", !canDownload)
      .on("click", function() {
        if (services && services.onDownloadPatchedExcel) services.onDownloadPatchedExcel();
      });
    $actions.append($sync, $download);
  }

  function appendExcelActions($toolbar, state) {
    var $field = $("<div/>").addClass("ujg-esi-field ujg-esi-file-field ujg-esi-actions-field");
    var $actions = $("<div/>").addClass("ujg-esi-toolbar-actions");
    appendFileInput($actions);
    appendMappingButton($actions);
    if (state.viewMode === "jira") {
      $actions.append(gridModule.button("RefreshCw", "Загрузить замечания из Jira", function() {
        if (services && services.onLoadRegistry) services.onLoadRegistry();
      }).prop("disabled", !state.projectKey || !!state.registryLoading));
    } else appendSyncActions($actions, state);
    $field.append($actions);
    $toolbar.append($field);
  }

  function appendParseMeta($header, state) {
    var meta = state && state.parseMeta ? state.parseMeta : null;
    var sheetNames = state && Array.isArray(state.sheetNames) ? state.sheetNames : [];
    var currentSheet = meta && meta.sheetName != null ? String(meta.sheetName) : "";
    var $meta = $("<div/>").addClass("ujg-esi-meta");
    $meta.attr("title", (state.sourceFileName || "") + " · заголовок: строка " + meta.headerRowNumber);
    var $sheetWrap = $("<span/>").addClass("ujg-esi-meta-sheet");
    var $sheetButton = $("<button/>")
      .attr("type", "button")
      .addClass("ujg-esi-meta-sheet-button")
      .attr("title", "Выбрать лист Excel")
      .text(currentSheet || "Авто")
      .prop("disabled", sheetNames.length <= 1)
      .on("click", function() {
        if (services && services.onToggleSheetPicker) services.onToggleSheetPicker();
      });
    $sheetWrap.append($sheetButton);
    if (state && state.sheetPickerOpen && sheetNames.length) {
      var $menu = $("<div/>").addClass("ujg-esi-meta-sheet-menu");
      sheetNames.forEach(function(sheetName) {
        var name = String(sheetName || "");
        $menu.append(
          $("<button/>")
            .attr("type", "button")
            .addClass("ujg-esi-meta-sheet-option")
            .toggleClass("ujg-esi-meta-sheet-option-active", name === currentSheet)
            .text(name)
            .on("click", function() {
              if (services && services.onMetaSheetSelect) services.onMetaSheetSelect(name);
            })
        );
      });
      $sheetWrap.append($menu);
    }
    $meta.append($sheetWrap);
    if (state && state.sourceFileName) {
      $meta.append(
        $("<span/>").text(" · "),
        $("<span/>").addClass("ujg-esi-file-name ujg-esi-meta-file").text(String(state.sourceFileName))
      );
    }
    $header.append($meta);
  }

  function mapEntries(map) {
    return Object.keys(map || {}).map(function(key) {
      return { excel: key, jira: map[key] };
    });
  }

  function activeMappingBlock(state) {
    var block = state && state.activeMappingBlock ? String(state.activeMappingBlock) : "";
    if (block === "priorities" || block === "roles" || block === "columns" || block === "tableStart" || block === "llmPrompts" || block === "teams") return block;
    return "modules";
  }

  function columnMappingRows(settings) {
    var map = settings && settings.columnMap ? settings.columnMap : {};
    return [
      { key: "remarkId", label: "ID замечания", value: map.remarkId || "ID" },
      { key: "summary", label: "Название / Summary", value: map.summary || "Замечание" },
      { key: "jira", label: "Jira key", value: map.jira || "Jira" },
      { key: "owner", label: "Ответственный за замечание", value: map.owner || "Ответственный" },
      { key: "module", label: "Модуль", value: map.module || "Модуль" },
      { key: "priority", label: "Приоритет", value: map.priority || "Приоритет" },
      { key: "statusInJira", label: "Статус Jira", value: map.statusInJira || "Статус в Jira" },
      { key: "assigneeInJira", label: "Исполнитель Jira", value: map.assigneeInJira || "Исполнитель в Jira" },
      { key: "sprintInJira", label: "Спринт Jira", value: map.sprintInJira || "Спринт" },
    ];
  }

  function mappingBlockRows(settings) {
    var maps = settings || {};
    return [
      { key: "teams", title: "Команды", subtitle: "Участники и направления · локально" },
      {
        key: "modules",
        title: "Модуль → Component",
        subtitle: String(mapEntries(maps.moduleComponentMap).length) + " значений",
      },
      {
        key: "priorities",
        title: "Приоритет → Priority",
        subtitle: String(mapEntries(maps.priorityMap).length) + " значений",
      },
      {
        key: "columns",
        title: "Колонки Excel",
        subtitle: String(columnMappingRows(maps).length) + " полей",
      },
      {
        key: "tableStart",
        title: "Начало таблицы",
        subtitle: (maps.sheetName ? String(maps.sheetName) + " · " : "") + (maps.tableStart && maps.tableStart.headerMarker ? String(maps.tableStart.headerMarker) : "Замечание"),
      },
      {
        key: "roles",
        title: "Дочерние задачи",
        subtitle: String((maps.roles || []).length) + " ролей",
      },
      {
        key: "llmPrompts",
        title: "AI промпты",
        subtitle: String(Object.keys(maps.llmPrompts || {}).length) + " шаблонов + проект",
      },
    ];
  }

  function appendCounters($parent, state) {
    var rows = state.rows || [];
    var linked = rows.filter(function(row) {
      return row.alreadyLinked || row.status === "linked";
    }).length;
    var created = rows.filter(function(row) {
      return row.status === "created" || row.status === "partial";
    }).length;
    var failed = rows.filter(function(row) {
      return row.status === "failed" || row.status === "partial";
    }).length;
    var $counters = $("<div/>").addClass("ujg-esi-counters");
    [
      ["Строк", rows.length],
      ["Уже в Jira", linked],
      ["Создано", created],
      ["Ошибок", failed],
    ].forEach(function(item) {
      $counters.append(
        $("<span/>")
          .addClass("ujg-esi-counter")
          .append($("<b/>").text(String(item[1])), $("<span/>").text(item[0]))
      );
    });
    $parent.append($counters);
  }

  function appendValue($tr, value, className, title) {
    var $td = $("<td/>").addClass(className || "").text(value != null ? String(value) : "");
    if (title != null && String(title).trim()) $td.attr("title", String(title));
    $tr.append($td);
  }

  function appendRowAiButton(row, state, index) {
    var text = row && row.summary != null ? String(row.summary) : "";
    var target = "row-remark-" + index;
    var isBusy = state && state.llmLoadingTarget === target;
    return $("<button/>")
      .attr("type", "button")
      .addClass("ujg-esi-row-ai ujg-esi-icon-button")
      .prop("disabled", isBusy || !text.trim())
      .attr("title", isBusy ? "Исправляю..." : "Исправить текст замечания (AI)")
      .attr("aria-label", "Исправить текст замечания (AI)")
      .append(icon(isBusy ? "RefreshCw" : "WandSparkles"))
      .on("click", function() {
        if (services && services.onRowImproveRemark) services.onRowImproveRemark(index);
      });
  }


  function appendRowActions($td, row, state, index) {
    var canCreate = canCreateRow(row, state);
    var actionStatus = rowActionStatusText(row, state);
    var linked = !!(row.jiraKey || row.createdKey);
    var actionLabel = linked ? "Добавить задачу" : "Создать";
    var $button = $("<button/>")
      .attr({type: "button", title: actionLabel, "aria-label": actionLabel})
      .addClass("ujg-esi-icon-button " + (linked ? "ujg-esi-add-child" : "ujg-esi-create-row"))
      .append(icon("Plus"));
    $button.prop("disabled", linked ? row.status === "creating" || !!state.registryLoading : !canCreate);
    $button.on("click", function() {
      if (linked) { if (services && services.onAddChildTasks) services.onAddChildTasks(index); }
      else if (services && services.onCreateRow) services.onCreateRow(index);
    });
    var $actions = $("<div/>").addClass("ujg-esi-action-buttons").append(appendRowAiButton(row, state, index));
    if (linked || !(row.alreadyLinked || row.status === "created")) $actions.append($button);
    $td.attr("title", actionStatus).append($actions);
    if (row.errors && row.errors.length) {
      var $details = $("<details/>").addClass("ujg-esi-error-details");
      $details.append($("<summary/>").attr({ title: row.errors.join(" · "), "aria-label": "Ошибки создания" }).append(icon("TriangleAlert")), $("<div/>").text(row.errors.join(" · ")));
      $td.append($details);
    }
  }

  function appendConfirmControl($list, label, $control) {
    $list.append($("<dt/>").text(label), $("<dd/>").append($control));
  }

  function appendImproveSummaryControl(input, target, busyTarget) {
    var isBusy = busyTarget === target;
    return $("<div/>")
      .addClass("ujg-esi-summary-ai-row")
      .append(
        input,
        $("<button/>")
          .attr("type", "button")
          .addClass("ujg-esi-summary-ai")
          .prop("disabled", isBusy)
          .text(isBusy ? "Улучшаю..." : "Улучшить")
          .on("click", function() {
            if (services && services.onDialogImproveSummary) services.onDialogImproveSummary(target);
          })
      );
  }

  function appendImproveRemarkControl(input, index, busyTarget) {
    var target = "remark-" + index;
    var isBusy = busyTarget === target;
    return $("<div/>")
      .addClass("ujg-esi-source-ai-row")
      .append(
        input,
        $("<button/>")
          .attr("type", "button")
          .addClass("ujg-esi-source-ai")
          .prop("disabled", isBusy)
          .text(isBusy ? "Исправляю..." : "Исправить")
          .on("click", function() {
            if (services && services.onDialogImproveRemark) services.onDialogImproveRemark(index);
          })
      );
  }

  function appendTextInput(className, value, onChange) {
    var $input = $("<input/>")
      .attr("type", "text")
      .addClass(className || "")
      .val(value != null ? String(value) : "");
    $input.on("input", function() {
      onChange($(this).val());
    });
    return $input;
  }

  function appendTextarea(className, value, onChange, options) {
    options = options || {};
    var $textarea = $("<textarea/>")
      .addClass(className || "")
      .val(value != null ? String(value) : "");
    if (options.maxLength) $textarea.attr("maxlength", String(options.maxLength));
    $textarea.on("input", function() {
      updateLlmReviewCount(options.countNode, $(this).val(), options.maxLength);
      onChange($(this).val());
    });
    return $textarea;
  }

  function appendSummaryInput(className, value, onChange) {
    return appendTextInput(className, value, onChange).attr("maxlength", String(SUMMARY_MAX_LENGTH));
  }

  function llmReviewCountText(value, maxLength) {
    var count = String(value || "").length;
    return maxLength ? count + "/" + maxLength : String(count);
  }

  function updateLlmReviewCount($node, value, maxLength) {
    if ($node && $node.length) $node.text(llmReviewCountText(value, maxLength));
  }

  function appendLlmReviewLabel(label, value, maxLength) {
    var $count = $("<span/>").addClass("ujg-esi-summary-review-count");
    updateLlmReviewCount($count, value, maxLength);
    return {
      label: $("<span/>")
        .addClass("ujg-esi-summary-review-label")
        .append(
          $("<span/>").text(label),
          $count
        ),
      count: $count,
    };
  }

  function appendSystemPromptToggle(dialog, onChange) {
    return $("<label/>")
      .addClass("ujg-esi-summary-review-system-prompt")
      .append(
        $("<input/>")
          .attr("type", "checkbox")
          .prop("checked", !dialog || dialog.useSystemPrompt !== false)
          .on("change", function() {
            onChange($(this).prop("checked"));
          }),
        $("<span/>").text("Использовать системный prompt")
      );
  }

  function appendSelect(className, value, rows, onChange) {
    var $select = $("<select/>").addClass(className || "");
    (rows || []).forEach(function(row) {
      $select.append($("<option/>").attr("value", row.value).text(row.label));
    });
    $select.val(value || "");
    $select.on("change", function() {
      onChange($(this).val());
    });
    return $select;
  }

  function priorityOptionRows(value, state) {
    var selected = value != null ? String(value) : "";
    var seen = {};
    var rows = [];
    (state && Array.isArray(state.priorityOptions) ? state.priorityOptions : []).forEach(function(row) {
      var name = row && row.name != null ? String(row.name).trim() : "";
      if (!name || seen[name]) return;
      seen[name] = true;
      rows.push({ value: name, label: name });
    });
    if (selected && !seen[selected]) rows.unshift({ value: selected, label: selected });
    return rows;
  }

  function appendAssigneePicker(className, target, selectedId, selectedLabel, state, disabled) {
    var picker = state && state.userPicker ? state.userPicker : {};
    var active = !disabled && picker.target === target;
    var value = active ? picker.query || "" : selectedLabel || "";
    var $wrap = $("<div/>")
      .addClass("ujg-esi-assignee-picker")
      .addClass(className || "")
      .toggleClass("ujg-esi-assignee-picker-active", active);
    var $input = $("<input/>")
      .attr("type", "text")
      .attr("autocomplete", "off")
      .attr("placeholder", "Введите имя или логин")
      .addClass("ujg-esi-assignee-search")
      .val(value);
    if (disabled) $input.prop("disabled", true);
    $input.on("focus click", function() {
      if (!disabled && services && services.onDialogAssigneeFocus) services.onDialogAssigneeFocus(target);
    });
    $input.on("input", function() {
      if (!disabled && services && services.onDialogAssigneeSearch) services.onDialogAssigneeSearch(target, $(this).val());
    });
    $wrap.append($input);
    if (!disabled && selectedId) {
      $wrap.append(
        $("<button/>")
          .attr("type", "button")
          .attr("title", "Очистить исполнителя")
          .addClass("ujg-esi-assignee-clear")
          .text("×")
          .on("click", function() {
            if (services && services.onDialogAssigneeClear) services.onDialogAssigneeClear(target);
          })
      );
    }
    if (active) {
      var $options = $("<div/>").addClass("ujg-esi-assignee-options");
      if (picker.loading) $options.append($("<div/>").addClass("ujg-esi-assignee-loading").text("Поиск..."));
      if (picker.error) $options.append($("<div/>").addClass("ujg-esi-assignee-error").text(String(picker.error)));
      (picker.rows || []).forEach(function(user) {
        var id = user && user.id != null ? String(user.id) : "";
        if (!id) return;
        $options.append(
          $("<button/>")
            .attr("type", "button")
            .addClass("ujg-esi-assignee-option")
            .text(user.label || id)
            .on("click", function() {
              if (services && services.onDialogAssigneeSelect) services.onDialogAssigneeSelect(target, id);
            })
        );
      });
      if (!picker.loading && !picker.error && !(picker.rows || []).length) {
        $options.append($("<div/>").addClass("ujg-esi-assignee-empty").text("Ничего не найдено"));
      }
      $wrap.append($options);
      if (typeof setTimeout === "function") {
        setTimeout(function() {
          var node = $input[0];
          $input.trigger("focus");
          if (node && node.setSelectionRange) node.setSelectionRange(String($input.val() || "").length, String($input.val() || "").length);
        }, 0);
      }
    }
    return $wrap;
  }

  function appendIssueTypePicker(className, target, value, state, disabled) {
    var picker = state && state.issueTypePicker ? state.issueTypePicker : {};
    var active = !disabled && picker.target === target;
    var text = active ? picker.query || "" : value || "";
    var $wrap = $("<div/>")
      .addClass("ujg-esi-issue-type-picker")
      .addClass(className || "")
      .toggleClass("ujg-esi-issue-type-picker-active", active);
    var $input = $("<input/>")
      .attr("type", "text")
      .attr("autocomplete", "off")
      .attr("placeholder", "Введите тип Jira")
      .addClass("ujg-esi-issue-type-search")
      .val(text);
    if (disabled) $input.prop("disabled", true);
    $input.on("focus click", function() {
      if (!disabled && services && services.onIssueTypeFocus) services.onIssueTypeFocus(target);
    });
    $input.on("input", function() {
      if (!disabled && services && services.onIssueTypeSearch) services.onIssueTypeSearch(target, $(this).val());
    });
    $wrap.append($input);
    if (active) {
      var $options = $("<div/>").addClass("ujg-esi-issue-type-options");
      (picker.rows || []).forEach(function(row) {
        var name = row && row.name != null ? String(row.name) : "";
        if (!name) return;
        $options.append(
          $("<button/>")
            .attr("type", "button")
            .addClass("ujg-esi-issue-type-option")
            .text(name)
            .on("click", function() {
              if (services && services.onIssueTypeSelect) services.onIssueTypeSelect(target, name);
            })
        );
      });
      if (!(picker.rows || []).length) {
        $options.append($("<div/>").addClass("ujg-esi-issue-type-empty").text("Ничего не найдено"));
      }
      $wrap.append($options);
      if (typeof setTimeout === "function") {
        setTimeout(function() {
          var node = $input[0];
          $input.trigger("focus");
          if (node && node.setSelectionRange) node.setSelectionRange(String($input.val() || "").length, String($input.val() || "").length);
        }, 0);
      }
    }
    return $wrap;
  }

  function appendMappingBlock($parent, block, active) {
    var $button = $("<button/>")
      .attr("type", "button")
      .addClass("ujg-esi-mapping-block")
      .toggleClass("ujg-esi-mapping-block-active", active)
      .append(
        $("<span/>").addClass("ujg-esi-mapping-block-title").text(block.title),
        $("<span/>").addClass("ujg-esi-mapping-block-subtitle").text(block.subtitle)
      )
      .on("click", function() {
        if (services && services.onMappingBlockSelect) services.onMappingBlockSelect(block.key);
      });
    $parent.append($button);
  }

  function appendMappingPairs($parent, blockKey, title, entries, state) {
    var isPriority = blockKey === "priorities";
    var $head = $("<div/>")
      .addClass("ujg-esi-mapping-editor-head")
      .append(
        $("<h2/>").text(title),
        $("<button/>")
          .attr("type", "button")
          .addClass("ujg-esi-mapping-add")
          .text("+ Добавить")
          .on("click", function() {
            if (services && services.onMappingPairAdd) services.onMappingPairAdd(blockKey);
          })
      );
    var $table = $("<table/>").addClass("ujg-esi-mapping-table");
    var $tbody = $("<tbody/>");
    $table.append(
      $("<thead/>").append(
        $("<tr/>")
          .append($("<th/>").text("Excel значение"))
          .append($("<th/>").text("Jira значение"))
          .append($("<th/>").text(""))
      )
    );
    (entries || []).forEach(function(entry, index) {
      $tbody.append(
        $("<tr/>")
          .append($("<td/>").append(appendTextInput("ujg-esi-mapping-entry-excel", entry.excel, function(value) {
            if (services && services.onMappingPairChange) services.onMappingPairChange(blockKey, index, "excel", value);
          })))
          .append($("<td/>").append(isPriority
            ? appendSelect("ujg-esi-mapping-entry-jira ujg-esi-mapping-priority-select", entry.jira, priorityOptionRows(entry.jira, state), function(value) {
              if (services && services.onMappingPairChange) services.onMappingPairChange(blockKey, index, "jira", value);
            })
            : appendTextInput("ujg-esi-mapping-entry-jira", entry.jira, function(value) {
              if (services && services.onMappingPairChange) services.onMappingPairChange(blockKey, index, "jira", value);
            })
          ))
          .append($("<td/>").append(
            $("<button/>")
              .attr("type", "button")
              .addClass("ujg-esi-mapping-remove")
              .attr("title", "Удалить")
              .text("×")
              .on("click", function() {
                if (services && services.onMappingPairRemove) services.onMappingPairRemove(blockKey, index);
              })
          ))
      );
    });
    if (!(entries || []).length) {
      $tbody.append($("<tr/>").append($("<td/>").attr("colspan", "3").addClass("ujg-esi-mapping-empty").text("Нет значений мапинга.")));
    }
    $table.append($tbody);
    $parent.append($head, $table);
  }

  function appendColumnMappings($parent, settings) {
    var $head = $("<div/>")
      .addClass("ujg-esi-mapping-editor-head")
      .append($("<h2/>").text("Колонки Excel"));
    var $table = $("<table/>").addClass("ujg-esi-mapping-table ujg-esi-mapping-columns");
    var $tbody = $("<tbody/>");
    $table.append(
      $("<thead/>").append(
        $("<tr/>")
          .append($("<th/>").text("Поле importer"))
          .append($("<th/>").text("Колонка Excel"))
      )
    );
    columnMappingRows(settings).forEach(function(row) {
      $tbody.append(
        $("<tr/>")
          .append($("<td/>").text(row.label))
          .append($("<td/>").append(appendTextInput("ujg-esi-mapping-column-value", row.value, function(value) {
            if (services && services.onMappingColumnChange) services.onMappingColumnChange(row.key, value);
          })))
      );
    });
    $table.append($tbody);
    $parent.append($head, $table);
  }

  function appendTableStartMapping($parent, settings) {
    var tableStart = settings && settings.tableStart ? settings.tableStart : {};
    var sheetName = settings && settings.sheetName != null ? String(settings.sheetName) : "";
    var $head = $("<div/>")
      .addClass("ujg-esi-mapping-editor-head")
      .append($("<h2/>").text("Начало таблицы"));
    var $box = $("<div/>").addClass("ujg-esi-mapping-start");
    $box.append(
      $("<label/>")
        .addClass("ujg-esi-mapping-start-field")
        .append(
          $("<span/>").text("Лист"),
          appendTextInput("ujg-esi-mapping-sheet-name", sheetName, function(value) {
            if (services && services.onMappingSheetNameChange) services.onMappingSheetNameChange(value);
          }).attr("placeholder", "Пусто = авто")
        ),
      $("<label/>")
        .addClass("ujg-esi-mapping-start-field")
        .append(
          $("<span/>").text("Колонка-маркер заголовка"),
          appendTextInput("ujg-esi-mapping-start-marker", tableStart.headerMarker || "Замечание", function(value) {
            if (services && services.onMappingTableStartChange) services.onMappingTableStartChange("headerMarker", value);
          })
        )
    );
    $parent.append($head, $box);
  }

  function appendMappingRoles($parent, settings, state) {
    var roles = settings && settings.roles ? settings.roles : [];
    var $head = $("<div/>")
      .addClass("ujg-esi-mapping-editor-head")
      .append(
        $("<h2/>").text("Дочерние задачи"),
        $("<button/>")
          .attr("type", "button")
          .addClass("ujg-esi-mapping-add")
          .text("+ Добавить")
          .on("click", function() {
            if (services && services.onMappingRoleAdd) services.onMappingRoleAdd();
          })
      );
    var $storyAssignee = $("<label/>")
      .addClass("ujg-esi-mapping-default-assignee")
      .append(
        $("<span/>").text("Исполнитель истории по умолчанию"),
        appendAssigneePicker("ujg-esi-mapping-story-assignee", "mapping-story", settings && settings.storyAssigneeId || "", settings && settings.storyAssigneeLabel || "", state, false)
      );
    var $table = $("<table/>").addClass("ujg-esi-mapping-table ujg-esi-mapping-roles");
    var $tbody = $("<tbody/>");
    $table.append(
      $("<thead/>").append(
        $("<tr/>")
          .append($("<th/>").text("Создавать"))
          .append($("<th/>").text("Код"))
          .append($("<th/>").text("Тип Jira"))
          .append($("<th/>").text("Исполнитель"))
          .append($("<th/>").text("Первоначальная оценка"))
          .append($("<th/>").text("Оставшееся время"))
          .append($("<th/>").text(""))
      )
    );
    (roles || []).forEach(function(role, index) {
      var enabled = !(role && role.enabled === false);
      var $checkbox = $("<input/>")
        .attr("type", "checkbox")
        .addClass("ujg-esi-mapping-role-enabled")
        .prop("checked", enabled)
        .on("change", function() {
          if (services && services.onMappingRoleChange) services.onMappingRoleChange(index, "enabled", !!$(this).prop("checked"));
        });
      $tbody.append(
        $("<tr/>")
          .append($("<td/>").append($checkbox))
          .append($("<td/>").append(appendTextInput("ujg-esi-mapping-role-code", role.role, function(value) {
            if (services && services.onMappingRoleChange) services.onMappingRoleChange(index, "role", value);
          })))
          .append($("<td/>").append(appendIssueTypePicker("ujg-esi-mapping-role-type", "mapping-role-type-" + index, role.issueType, state, false)))
          .append($("<td/>").append(appendAssigneePicker("ujg-esi-mapping-role-assignee", "mapping-role-" + index, role.assigneeId || "", role.assigneeLabel || "", state, false)))
          .append($("<td/>").append(appendTextInput("ujg-esi-mapping-role-original", role.originalEstimate, function(value) {
            if (services && services.onMappingRoleChange) services.onMappingRoleChange(index, "originalEstimate", value);
          })))
          .append($("<td/>").append(appendTextInput("ujg-esi-mapping-role-remaining", role.remainingEstimate, function(value) {
            if (services && services.onMappingRoleChange) services.onMappingRoleChange(index, "remainingEstimate", value);
          })))
          .append($("<td/>").append(
            $("<button/>")
              .attr("type", "button")
              .addClass("ujg-esi-mapping-remove")
              .attr("title", "Удалить")
              .text("×")
              .on("click", function() {
                if (services && services.onMappingRoleRemove) services.onMappingRoleRemove(index);
              })
          ))
      );
    });
    if (!(roles || []).length) {
      $tbody.append($("<tr/>").append($("<td/>").attr("colspan", "7").addClass("ujg-esi-mapping-empty").text("Нет дочерних задач.")));
    }
    $table.append($tbody);
    $parent.append($head, $storyAssignee, $table);
  }

  function appendLlmPromptMappings($parent, settings, state) {
    var prompts = settings && settings.llmPrompts ? settings.llmPrompts : {};
    var descriptionPrompts = settings && settings.llmDescriptionPrompts ? settings.llmDescriptionPrompts : {};
    var order = ["story", "SE", "FE", "BE", "QA", "DevOps"];
    var seen = {};
    var seenDescriptions = {};
    var $head = $("<div/>")
      .addClass("ujg-esi-mapping-editor-head")
      .append($("<h2/>").text("AI промпты для названий"));
    var $project = $("<label/>")
      .addClass("ujg-esi-llm-prompt-row ujg-esi-llm-project-prompt-row")
      .append(
        $("<span/>").text("Общий prompt проекта"),
        appendTextarea("ujg-esi-llm-prompt ujg-esi-llm-project-prompt", settings && settings.llmProjectPrompt || "", function(value) {
          if (services && services.onMappingLlmProjectPromptChange) services.onMappingLlmProjectPromptChange(value);
        })
      );
    var $remark = $("<label/>")
      .addClass("ujg-esi-llm-prompt-row ujg-esi-llm-remark-prompt-row")
      .append(
        $("<span/>").text("Текст замечания"),
        appendTextarea("ujg-esi-llm-prompt ujg-esi-llm-remark-prompt", settings && settings.llmRemarkPrompt || "", function(value) {
          if (services && services.onMappingLlmRemarkPromptChange) services.onMappingLlmRemarkPromptChange(value);
        })
      );
    var $wrap = $("<div/>").addClass("ujg-esi-llm-prompts");
    order.concat(Object.keys(prompts || {})).forEach(function(key) {
      if (!key || seen[key]) return;
      seen[key] = true;
      $wrap.append(
        $("<label/>")
          .addClass("ujg-esi-llm-prompt-row")
          .append(
            $("<span/>").text(key === "story" ? "Story" : key),
            appendTextarea("ujg-esi-llm-prompt", prompts[key] || "", function(value) {
              if (services && services.onMappingLlmPromptChange) services.onMappingLlmPromptChange(key, value);
            })
          )
      );
    });
    var $descriptionHead = $("<div/>")
      .addClass("ujg-esi-mapping-editor-head ujg-esi-llm-description-head")
      .append($("<h2/>").text("Описания дочерних задач"));
    var $descriptionWrap = $("<div/>").addClass("ujg-esi-llm-prompts ujg-esi-llm-description-prompts");
    order.filter(function(key) { return key !== "story"; }).concat(Object.keys(descriptionPrompts || {})).forEach(function(key) {
      if (!key || seenDescriptions[key]) return;
      seenDescriptions[key] = true;
      $descriptionWrap.append(
        $("<label/>")
          .addClass("ujg-esi-llm-prompt-row")
          .append(
            $("<span/>").text(key),
            appendTextarea("ujg-esi-llm-prompt ujg-esi-llm-description-prompt", descriptionPrompts[key] || "", function(value) {
              if (services && services.onMappingLlmDescriptionPromptChange) services.onMappingLlmDescriptionPromptChange(key, value);
            })
          )
      );
    });
    var $connection = $("<div/>").addClass("ujg-esi-llm-connection");
    $connection.append(gridModule.button("RefreshCw", "Сбросить LLM", function() { services.onLlmResetRequest(); }).append($("<span/>").text("Сбросить LLM")).prop("disabled", !!state.llmLoadingTarget));
    if (state.llmResetConfirm) {
      $connection.append($("<p/>").text("Удалить адрес API, модель и ключ LLM? Подключение общее для виджетов в этом браузере. Промпты, команды и настройки таблицы сохранятся."));
      $connection.append($("<button/>").attr("type", "button").text("Удалить подключение").prop("disabled", !!state.llmLoadingTarget).on("click", function() { services.onLlmResetConfirm(); }));
      $connection.append($("<button/>").attr("type", "button").text("Отмена").on("click", function() { services.onLlmResetCancel(); }));
    }
    if (state.llmResetNotice) $connection.append($("<p/>").attr("role", "status").text(state.llmResetNotice));
    if (state.llmResetError) $connection.append($("<p/>").attr("role", "alert").addClass("ujg-esi-mapping-error").text(state.llmResetError));
    $parent.append($head, $connection, $project, $remark, $wrap, $descriptionHead, $descriptionWrap);
  }

  function appendMappingOverlay($parent, state) {
    if (!state || !state.mappingEditorOpen) return;
    var settings = state.mappingSettings || {};
    var active = activeMappingBlock(state);
    var $overlay = $("<div/>").addClass("ujg-esi-mapping-overlay");
    var $shell = $("<div/>").addClass("ujg-esi-mapping-shell");
    var $header = $("<div/>")
      .addClass("ujg-esi-mapping-header")
      .append(
        $("<button/>")
          .attr("type", "button")
          .addClass("ujg-esi-mapping-close")
          .attr("title", "Закрыть")
          .text("‹")
          .on("click", function() {
            if (services && services.onCloseMappings) services.onCloseMappings();
          }),
        $("<span/>").addClass("ujg-esi-mapping-header-icon").html("&#9881;"),
        $("<h1/>").text("Настройки импорта")
      );
    var $main = $("<div/>").addClass("ujg-esi-mapping-main");
    var $left = $("<div/>").addClass("ujg-esi-mapping-left");
    var $right = $("<div/>").addClass("ujg-esi-mapping-right");
    $left.append($("<div/>").addClass("ujg-esi-mapping-section-title").text("Разделы"));
    mappingBlockRows(settings).forEach(function(block) {
      appendMappingBlock($left, block, active === block.key);
    });
    if (active === "priorities") {
      appendMappingPairs($right, "priorities", "Приоритет → Priority", mapEntries(settings.priorityMap), state);
    } else if (active === "columns") {
      appendColumnMappings($right, settings);
    } else if (active === "tableStart") {
      appendTableStartMapping($right, settings);
    } else if (active === "roles") {
      appendMappingRoles($right, settings, state);
    } else if (active === "llmPrompts") {
      appendLlmPromptMappings($right, settings, state);
    } else if (active === "teams" && teamsUi) {
      if (state.projectKey) teamsUi.render($right, state, services);
      else $right.append($("<p/>").text("Проект не выбран"));
    } else {
      appendMappingPairs($right, "modules", "Модуль → Component", mapEntries(settings.moduleComponentMap), state);
    }
    if (state.mappingLoading) $right.append($("<div/>").addClass("ujg-esi-mapping-note").text("Загрузка мапинга..."));
    if (state.mappingError) $right.append($("<div/>").addClass("ujg-esi-mapping-error").text(state.mappingError));
    $main.append($left, $right);
    $shell.append($header, $main);
    $overlay.append($shell);
    $parent.append($overlay);
  }

  function appendConfirmSourceRows($parent, rows, state) {
    var $table = $("<table/>").addClass("ujg-esi-confirm-source");
    var $tbody = $("<tbody/>");
    var settings = state && state.mappingSettings ? state.mappingSettings : {};
    var columnMap = settings.columnMap || {};
    var summaryColumn = String(columnMap.summary || "Замечание").trim();
    (rows || []).forEach(function(row, index) {
      var name = row && row.name != null ? String(row.name) : "";
      var $input = appendTextInput("ujg-esi-confirm-source-value", row.value, function(value) {
        if (services && services.onDialogSourceChange) services.onDialogSourceChange(index, value);
      });
      var $control = name.trim() === summaryColumn ? appendImproveRemarkControl($input, index, state && state.llmLoadingTarget) : $input;
      $tbody.append(
        $("<tr/>")
          .append($("<th/>").text(name))
          .append($("<td/>").append($control))
      );
    });
    $table.append($tbody);
    $parent.append($("<div/>").addClass("ujg-esi-confirm-scroll").append($table));
  }

  function appendConfirmChildTasks($parent, tasks, state) {
    var rows = tasks || [];
    if (!rows.length) {
      $parent.append($("<div/>").addClass("ujg-esi-confirm-empty").text("Не создавать"));
      return;
    }
    var $table = $("<table/>").addClass("ujg-esi-confirm-tasks");
    $table.append(
      $("<thead/>").append(
        $("<tr/>")
          .append($("<th/>").text("Создать"))
          .append($("<th/>").text("Роль"))
          .append($("<th/>").text("Тип Jira"))
          .append($("<th/>").text("Название"))
          .append($("<th/>").text("Описание"))
          .append($("<th/>").text("Исполнитель"))
          .append($("<th/>").text("Первоначальная оценка"))
          .append($("<th/>").text("Оставшееся время"))
      )
    );
    var $tbody = $("<tbody/>");
    rows.forEach(function(task, index) {
      var enabled = task.enabled !== false;
      var $enabled = $("<input/>")
        .attr("type", "checkbox")
        .addClass("ujg-esi-confirm-child-enabled")
        .prop("checked", enabled)
        .on("change", function() {
          if (services && services.onDialogChildToggle) services.onDialogChildToggle(index, !!$(this).prop("checked"));
        });
      $tbody.append(
        $("<tr/>").toggleClass("ujg-esi-confirm-child-disabled", !enabled)
          .append($("<td/>").append($enabled))
          .append($("<td/>").text(task.role || ""))
          .append($("<td/>").append(appendIssueTypePicker("ujg-esi-confirm-child-type", "child-type-" + index, task.issueType, state, !enabled)))
          .append($("<td/>").append(appendImproveSummaryControl(appendSummaryInput("ujg-esi-confirm-child-summary", task.summary, function(value) {
            if (services && services.onDialogChildChange) services.onDialogChildChange(index, "summary", value);
          }).prop("disabled", !enabled), "child-" + index, state.llmLoadingTarget).toggleClass("ujg-esi-summary-ai-disabled", !enabled)))
          .append($("<td/>").append(
            $("<button/>")
              .attr("type", "button")
              .addClass("ujg-esi-confirm-child-description")
              .attr("title", "Редактировать описание")
              .attr("aria-label", "Редактировать описание")
              .prop("disabled", !enabled)
              .html("&#9776;")
              .on("click", function() {
                if (services && services.onDialogImproveDescription) services.onDialogImproveDescription("child-" + index);
              })
          ))
          .append($("<td/>").append(appendAssigneePicker("ujg-esi-confirm-child-assignee", "child-" + index, task.assigneeId || "", task.assigneeLabel || "", state, !enabled)))
          .append($("<td/>").append(appendTextInput("ujg-esi-confirm-child-original", task.originalEstimate, function(value) {
            if (services && services.onDialogChildChange) services.onDialogChildChange(index, "originalEstimate", value);
          }).prop("disabled", !enabled)))
          .append($("<td/>").append(appendTextInput("ujg-esi-confirm-child-remaining", task.remainingEstimate, function(value) {
            if (services && services.onDialogChildChange) services.onDialogChildChange(index, "remainingEstimate", value);
          }).prop("disabled", !enabled)))
      );
    });
    $table.append($tbody);
    $parent.append($table);
  }

  function appendConfirmModal($parent, state) {
    var dialog = state && state.createDialog ? state.createDialog : null;
    if (!dialog) return;
    var $overlay = $("<div/>").addClass("ujg-esi-confirm-overlay");
    var $shell = $("<div/>").addClass("ujg-esi-confirm-shell");
    var $modal = $("<div/>")
      .addClass("ujg-esi-confirm-modal")
      .attr("role", "dialog")
      .attr("aria-modal", "true");
    var $fields = $("<dl/>").addClass("ujg-esi-confirm-fields");
    var childrenMode = dialog.mode === "children";

    if (!childrenMode) {
    appendConfirmControl($fields, "Проект", appendSelect("ujg-esi-confirm-project", dialog.projectKey, (state.projects || []).map(function(project) {
      return { value: project.key || "", label: projectLabel(project) };
    }), function(value) {
      if (services && services.onDialogFieldChange) services.onDialogFieldChange("projectKey", value);
    }));
    appendConfirmControl($fields, "Тип Jira", appendIssueTypePicker("ujg-esi-confirm-issue-type", "story-type", dialog.issueType || "Story", state, false));
    var epicOptions = [{ value: "", label: "Без Epic" }].concat((state.epics || []).map(function(epic) {
      return { value: epic.key || "", label: epicLabel(epic) };
    }));
    if (dialog.epicKey && !epicOptions.some(function(option) { return option.value === dialog.epicKey; })) {
      epicOptions.push({ value: dialog.epicKey, label: dialog.epicText || dialog.epicKey });
    }
    appendConfirmControl($fields, "Epic", appendSelect("ujg-esi-confirm-epic", dialog.epicKey || "", epicOptions, function(value) {
      if (services && services.onDialogFieldChange) services.onDialogFieldChange("epicKey", value);
    }));
    appendConfirmControl($fields, "Название", appendImproveSummaryControl(appendSummaryInput("ujg-esi-confirm-summary", dialog.summary, function(value) {
      if (services && services.onDialogFieldChange) services.onDialogFieldChange("summary", value);
    }), "story", state.llmLoadingTarget));
    appendConfirmControl($fields, "Исполнитель", appendAssigneePicker("ujg-esi-confirm-assignee", "story", dialog.assigneeId || "", dialog.assigneeLabel || "", state, false));
    appendConfirmControl($fields, "Первоначальная оценка", appendTextInput("ujg-esi-confirm-original", dialog.originalEstimate, function(value) {
      if (services && services.onDialogFieldChange) services.onDialogFieldChange("originalEstimate", value);
    }));
    appendConfirmControl($fields, "Оставшееся время", appendTextInput("ujg-esi-confirm-remaining", dialog.remainingEstimate, function(value) {
      if (services && services.onDialogFieldChange) services.onDialogFieldChange("remainingEstimate", value);
    }));
    if (dialog.childTasks && dialog.childTasks.length) appendConfirmControl($fields, "Связь", $("<span/>").text("child of Story"));
    } else {
      $fields.addClass("ujg-esi-confirm-parent");
      appendConfirmControl($fields, "Основная задача", $("<span/>").text(dialog.parentKey + " · " + (dialog.parentSummary || "")));
      var parent = state.rows && state.rows[dialog.rowIndex];
      var existing = parent && parent.childStatuses || [];
      if (existing.length) appendConfirmControl($fields, "Уже связаны", $("<span/>").text(existing.map(function(task) { return task.key + (task.role ? " [" + task.role + "]" : ""); }).join(", ")));
    }

    $modal.append(
      $("<div/>")
        .addClass("ujg-esi-confirm-head")
        .append($("<h3/>").text(childrenMode ? "Добавить задачи к " + dialog.parentKey : "Подтвердите создание"), $("<button/>")
          .attr("type", "button")
          .addClass("ujg-esi-confirm-close")
          .attr("aria-label", "Закрыть")
          .text("×")
          .on("click", function() {
            if (services && services.onCancelCreate) services.onCancelCreate();
          }))
    );
    $modal.append($fields);
    if (!childrenMode && dialog.epicKey && dialog.epicLinkAllowed === false) {
      $modal.append(
        $("<div/>")
          .addClass("ujg-esi-confirm-epic-warning")
          .text("Epic выбран, но поле Epic Link недоступно для этого типа задачи; задача будет создана без Epic.")
      );
    }
    if (state.usersError) $modal.append($("<div/>").addClass("ujg-esi-confirm-users-error").text(state.usersError));
    if (state.llmError) $modal.append($("<div/>").addClass("ujg-esi-confirm-users-error").text(state.llmError));
    if (!childrenMode) {
      $modal.append($("<h4/>").text("Описание"));
      appendConfirmSourceRows($modal, dialog.sourceRows, state);
    }
    $modal.append($("<h4/>").text("Дочерние задачи"));
    appendConfirmChildTasks($modal, dialog.childTasks, state);
    $modal.append(
      $("<div/>")
        .addClass("ujg-esi-confirm-actions")
        .append(
          $("<button/>")
            .attr("type", "button")
            .addClass("ujg-esi-confirm-cancel")
            .text("Отмена")
            .on("click", function() {
              if (services && services.onCancelCreate) services.onCancelCreate();
            }),
          $("<button/>")
            .attr("type", "button")
            .addClass("ujg-esi-confirm-create")
            .prop("disabled", childrenMode && !(dialog.childTasks || []).some(function(task) { return task.enabled !== false; }))
            .text("Создать в Jira")
            .on("click", function() {
              if (services && services.onConfirmCreate) services.onConfirmCreate();
            })
        )
    );
    $shell.append($modal);
    $overlay.append($shell);
    $parent.append($overlay);
  }

  function appendLlmReviewDialog($parent, state, mode) {
    var isRemark = mode === "remark";
    var dialog = isRemark ? state && state.remarkDialog : state && state.summaryDialog;
    var target = isRemark ? dialog ? "row-remark-" + dialog.rowIndex : "" : dialog ? "summary-dialog-" + dialog.target : "";
    var isBusy = !!(state && state.llmLoadingTarget === target);
    var title = isRemark ? "Улучшение текста замечания" : dialog && dialog.target === "story" ? "Улучшение названия Story" : "Улучшение названия задачи";
    var callbacks = isRemark
      ? {
          cancel: "onRemarkDialogCancel",
          field: "onRemarkDialogFieldChange",
          improve: "onRemarkDialogImprove",
          apply: "onRemarkDialogApply",
        }
      : {
          cancel: "onSummaryDialogCancel",
          field: "onSummaryDialogFieldChange",
          improve: "onSummaryDialogImprove",
          apply: "onSummaryDialogApply",
        };
    function call(name) {
      if (services && services[name]) services[name]();
    }
    function change(field, value) {
      if (services && services[callbacks.field]) services[callbacks.field](field, value);
    }
    if (!dialog) return;
    var $overlay = $("<div/>").addClass("ujg-esi-summary-review-overlay");
    var $modal = $("<div/>")
      .addClass("ujg-esi-summary-review-modal")
      .attr("role", "dialog")
      .attr("aria-modal", "true");
    var beforeLabel = appendLlmReviewLabel("Исходные данные, на основании которых создано", dialog.beforeText || "", null);
    var afterLabel = appendLlmReviewLabel("После LLM", dialog.afterText || "", isRemark ? null : SUMMARY_MAX_LENGTH);
    $modal.append(
      $("<div/>")
        .addClass("ujg-esi-summary-review-head")
        .append(
          $("<h3/>").text(title),
          $("<button/>")
            .attr("type", "button")
            .addClass("ujg-esi-summary-review-close")
            .attr("aria-label", "Закрыть")
            .text("×")
            .on("click", function() {
              call(callbacks.cancel);
            })
        )
    );
    $modal.append(
      $("<div/>")
        .addClass("ujg-esi-summary-review-grid")
        .append(
          $("<label/>").append(
            beforeLabel.label,
            appendTextarea("ujg-esi-summary-review-before", dialog.beforeText || "", function(value) {
              change("beforeText", value);
            }, { countNode: beforeLabel.count })
          ),
          $("<label/>").append(
            afterLabel.label,
            appendTextarea("ujg-esi-summary-review-after", dialog.afterText || "", function(value) {
              change("afterText", value);
            }, { maxLength: isRemark ? null : SUMMARY_MAX_LENGTH, countNode: afterLabel.count })
          )
        )
    );
    $modal.append(
      $("<label/>")
        .addClass("ujg-esi-summary-review-comment-row")
        .append(
          $("<span/>").text("Что сделал LLM"),
          $("<div/>")
            .addClass("ujg-esi-summary-review-comment")
            .text(dialog.comment || "LLM не вернул комментарий.")
        )
    );
    $modal.append(
      appendSystemPromptToggle(dialog, function(value) {
        change("useSystemPrompt", value);
      })
    );
    $modal.append(
      $("<label/>")
        .addClass("ujg-esi-summary-review-prompt-row")
        .append(
          $("<span/>").text("Prompt"),
          appendTextarea("ujg-esi-summary-review-prompt", dialog.prompt || "", function(value) {
            change("prompt", value);
          })
        )
    );
    if (state.llmError) $modal.append($("<div/>").addClass("ujg-esi-confirm-users-error").text(state.llmError));
    $modal.append(
      $("<div/>")
        .addClass("ujg-esi-summary-review-actions")
        .append(
          $("<button/>")
            .attr("type", "button")
            .addClass("ujg-esi-summary-review-cancel")
            .text("Отмена")
            .on("click", function() {
              call(callbacks.cancel);
            }),
          $("<button/>")
            .attr("type", "button")
            .addClass("ujg-esi-summary-review-improve")
            .prop("disabled", isBusy)
            .text(isBusy ? "Улучшаю..." : "Улучшить")
            .on("click", function() {
              call(callbacks.improve);
            }),
          $("<button/>")
            .attr("type", "button")
            .addClass("ujg-esi-summary-review-apply")
            .prop("disabled", isBusy || !String(dialog.afterText || "").trim())
            .text("Применить")
            .on("click", function() {
              call(callbacks.apply);
            })
        )
    );
    $overlay.append($modal);
    $parent.append($overlay);
  }

  function appendDescriptionReviewDialog($parent, state) {
    var dialog = state && state.descriptionDialog;
    if (!dialog) return;
    var target = "description-dialog-" + (dialog.target || "");
    var isBusy = !!(state && state.llmLoadingTarget === target);
    var viewMode = dialog.viewMode === "preview" ? "preview" : "edit";
    var $overlay = $("<div/>").addClass("ujg-esi-description-review-overlay");
    var $modal = $("<div/>")
      .addClass("ujg-esi-description-review-modal")
      .attr("role", "dialog")
      .attr("aria-modal", "true");
    function change(field, value) {
      if (services && services.onDescriptionDialogFieldChange) services.onDescriptionDialogFieldChange(field, value);
    }
    function call(name) {
      if (services && services[name]) services[name]();
    }
    $modal.append(
      $("<div/>")
        .addClass("ujg-esi-description-review-head")
        .append(
          $("<h3/>").text("Описание " + (dialog.role || "задачи")),
          $("<button/>")
            .attr("type", "button")
            .addClass("ujg-esi-description-review-close")
            .attr("aria-label", "Закрыть")
            .text("×")
            .on("click", function() {
              call("onDescriptionDialogCancel");
            })
        )
    );
    $modal.append(
      $("<div/>")
        .addClass("ujg-esi-description-review-grid")
        .append(
          $("<label/>").append(
            $("<span/>").text("Исходные данные, на основании которых создано"),
            appendTextarea("ujg-esi-description-review-before", dialog.beforeText || "", function(value) {
              change("beforeText", value);
            })
          ),
          $("<div/>")
            .addClass("ujg-esi-description-review-after-panel")
            .append(
              $("<span/>").text("После LLM"),
              $("<div/>")
                .addClass("ujg-esi-description-editor")
                .append(
                  $("<div/>")
                    .addClass("ujg-esi-description-editor-toolbar")
                    .append(
                      $("<button/>").attr("type", "button").text("Стиль"),
                      $("<button/>").attr("type", "button").html("<b>B</b>"),
                      $("<button/>").attr("type", "button").html("<i>I</i>"),
                      $("<button/>").attr("type", "button").html("<u>U</u>"),
                      $("<button/>").attr("type", "button").text("🔗"),
                      $("<button/>").attr("type", "button").text("•"),
                      $("<button/>").attr("type", "button").text("1."),
                      $("<button/>").attr("type", "button").text("+")
                    ),
                  viewMode === "preview"
                    ? renderJiraWiki(dialog.afterText || "")
                    : appendTextarea("ujg-esi-description-review-after", dialog.afterText || "", function(value) {
                        change("afterText", value);
                      }),
                  $("<div/>")
                    .addClass("ujg-esi-description-editor-footer")
                    .append(
                      $("<button/>")
                        .attr("type", "button")
                        .addClass(viewMode === "preview" ? "ujg-esi-description-mode-active" : "")
                        .text("Визуальный")
                        .on("click", function() {
                          if (services && services.onDescriptionDialogViewModeChange) services.onDescriptionDialogViewModeChange("preview");
                        }),
                      $("<button/>")
                        .attr("type", "button")
                        .addClass(viewMode === "edit" ? "ujg-esi-description-mode-active" : "")
                        .text("Текст")
                        .on("click", function() {
                          if (services && services.onDescriptionDialogViewModeChange) services.onDescriptionDialogViewModeChange("edit");
                        })
                    )
                )
            )
        )
    );
    $modal.append(
      $("<label/>")
        .addClass("ujg-esi-summary-review-comment-row")
        .append(
          $("<span/>").text("Что сделал LLM"),
          $("<div/>").addClass("ujg-esi-summary-review-comment").text(dialog.comment || "LLM не вернул комментарий.")
        )
    );
    $modal.append(
      appendSystemPromptToggle(dialog, function(value) {
        change("useSystemPrompt", value);
      })
    );
    $modal.append(
      $("<label/>")
        .addClass("ujg-esi-summary-review-prompt-row")
        .append(
          $("<span/>").text("Prompt"),
          appendTextarea("ujg-esi-summary-review-prompt", dialog.prompt || "", function(value) {
            change("prompt", value);
          })
        )
    );
    if (state.llmError) $modal.append($("<div/>").addClass("ujg-esi-confirm-users-error").text(state.llmError));
    $modal.append(
      $("<div/>")
        .addClass("ujg-esi-summary-review-actions")
        .append(
          $("<button/>").attr("type", "button").addClass("ujg-esi-summary-review-cancel").text("Отмена").on("click", function() {
            call("onDescriptionDialogCancel");
          }),
          $("<button/>").attr("type", "button").addClass("ujg-esi-summary-review-improve").prop("disabled", isBusy).text(isBusy ? "Улучшаю..." : "Улучшить").on("click", function() {
            call("onDescriptionDialogImprove");
          }),
          $("<button/>").attr("type", "button").addClass("ujg-esi-summary-review-apply").prop("disabled", isBusy || !String(dialog.afterText || "").trim()).text("Применить").on("click", function() {
            call("onDescriptionDialogApply");
          })
        )
    );
    $overlay.append($modal);
    $parent.append($overlay);
  }

  function appendPreview($parent, state) {
    var rows = state.rows || [];
    var $wrap = $("<div/>").addClass("ujg-esi-preview");
    if (!rows.length) {
      $wrap.addClass("ujg-esi-preview-empty");
      if (state.viewMode === "jira") $wrap.text(state.registryLoading ? "Загрузка замечаний..." : "Нет загруженных замечаний");
      else appendDropzone($wrap);
      $parent.append($wrap);
      return;
    }
    grid.mount($parent, state, {
      appendActions: function($td, row, index) { appendRowActions($td, row, state, index); },
      renderDescription: renderJiraWiki,
      editOwner: function(entry) { if (services && services.onDialogAssigneeFocus) services.onDialogAssigneeFocus("row-owner-" + entry.rowIndex); },
      assignTeam: function(user, teamId) { if (services && services.onAssignUserTeam) services.onAssignUserTeam(user, teamId); }
    });
  }

  function appendRowOwnerPopover($parent, state) {
    var picker = state.userPicker || {}, match = /^row-owner-(\d+)$/.exec(picker.target || "");
    if (!match) return;
    var index = Number(match[1]), row = state.rows && state.rows[index];
    if (!row) return;
    var $anchor = $parent.find('[data-owner-index="' + index + '"]');
    if (!$anchor.length) return;
    var $popup = $("<div/>").addClass("ujg-esi-row-owner-popover").attr({role:"dialog", "aria-label":"Ответственный за замечание"});
    $popup.append($("<div/>").addClass("ujg-esi-description-head").append($("<strong/>").text("Ответственный"), gridModule.button("X", "Закрыть выбор ответственного", function() { if (services.onCloseUserPicker) services.onCloseUserPicker(); })));
    $popup.append(appendAssigneePicker("ujg-esi-row-owner-picker", picker.target, row.ownerAssigneeId || "", row.ownerAssigneeLabel || "", state, false));
    $popup.on("keydown", function(event) { if (event.key === "Escape" && services.onCloseUserPicker) { event.stopPropagation(); services.onCloseUserPicker(); } });
    $parent.append($popup);
    var rect = $anchor[0].getBoundingClientRect(), width = Math.min(310, window.innerWidth - 24);
    $popup.css({ width: width, left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)), top: Math.max(12, Math.min(rect.bottom + 4, window.innerHeight - 340)) });
    $(document).off("click.ujgEsiOwner").on("click.ujgEsiOwner", function(event) {
      if (!$(event.target).closest(".ujg-esi-row-owner-popover,[data-owner-index]").length && services.onCloseUserPicker) services.onCloseUserPicker();
    });
  }

  function render(state) {
    if (!$root || !$root.length) return;
    var $active = $(document.activeElement), $teamRow = $active.closest(".ujg-esi-team-row");
    var teamControl = ["name", "roles", "search", "member-row", "chip", "members-button", "direction"].filter(function(name) { return $active.hasClass("ujg-esi-team-" + name); })[0];
    var teamFocus = $teamRow.length && teamControl ? {
      id: $teamRow.attr("data-team-id"), control: teamControl, user: $active.attr("data-user-id"),
      draft: $active.is("input") ? $active.val() : null,
      start: document.activeElement.selectionStart, end: document.activeElement.selectionEnd
    } : null;
    var scrollState = captureScrollState();
    $(document).off("click.ujgEsiOwner");
    $(document).off("click.ujgEsiSummary");
    $root.empty();
    var s = state || {};
    var $toolbar = $("<div/>").addClass("ujg-esi-toolbar ujg-esi-compact-toolbar");
    $toolbar.append($("<h2/>").text("Импорт замечаний"));
    var $reportTabs = $("<div/>").addClass("ujg-esi-view-modes").attr({role:"tablist", "aria-label":"Представление замечаний"});
    [["registry", "Реестр"], ["activity", "Динамика"]].forEach(function(view) {
      var selected = (s.reportView || "registry") === view[0];
      $reportTabs.append($("<button/>").attr({type:"button",role:"tab","aria-selected":String(selected),"aria-pressed":String(selected)})
        .text(view[1]).on("click",function() {
          grid.dismissPopover();
          if (services.onReportViewChange) services.onReportViewChange(view[0]);
        }));
    });
    $toolbar.append($reportTabs);
    var $modes = $("<div/>").addClass("ujg-esi-view-modes").attr({ role:"group", "aria-label":"Источник замечаний" });
    [["excel", "Excel"], ["jira", "Jira"]].forEach(function(mode) {
      $modes.append($("<button/>").attr({type:"button", "aria-label":"Режим " + mode[1], "aria-pressed":String((s.viewMode || "excel") === mode[0])}).text(mode[1]).on("click", function() { if (services.onViewModeChange) services.onViewModeChange(mode[0]); }));
    });
    $toolbar.append($modes);
    appendProjectSelect($toolbar, s);
    appendEpicPicker($toolbar, s);
    if (s.parseMeta && s.viewMode !== "jira") appendParseMeta($toolbar, s);
    appendExcelActions($toolbar, s);
    if (s.reportView !== "activity" && s.rows && s.rows.length) {
      var $tools = $("<div/>").addClass("ujg-esi-grid-tools");
      $tools.append(gridModule.button("ChevronsUpDown", "Развернуть / свернуть все", function() { grid.toggleAll(); }), gridModule.button("Columns3", "Столбцы", function() { grid.columnsMenu(this); }));
      var $summary = $("<details/>").addClass("ujg-esi-import-summary");
      $summary.append($("<summary/>").attr({ title: "Сводка импорта", "aria-label": "Сводка импорта" }).append(icon("Info")));
      var $analytics = $("<div/>").addClass("ujg-esi-analytics").attr({role:"dialog","aria-label":"Сводка замечаний"});
      $analytics.append($("<div/>").addClass("ujg-esi-stats-head").append($("<strong/>").text("Сводка замечаний"),gridModule.button("X","Закрыть сводку",function() { $summary.prop("open",false); $summary.children("summary").trigger("focus"); })));
      if (statisticsUi) statisticsUi.render($analytics,s);
      appendCounters($analytics,s);
      if (s.syncSummary) $analytics.append($("<div/>").addClass("ujg-esi-stats-note").text(s.syncSummary));
      $summary.append($analytics).on("toggle",function() {
        if (!$summary.prop("open")) return;
        var rect = $summary[0].getBoundingClientRect(), viewportWidth = document.documentElement.clientWidth || window.innerWidth;
        var width = Math.min(940,viewportWidth - 24), top = Math.max(12,Math.min(rect.bottom+6,window.innerHeight-180));
        $analytics.css({width:width,left:Math.max(12,Math.min(rect.right-width,viewportWidth-width-12)),top:top,maxHeight:Math.max(140,window.innerHeight-top-12)});
      }).on("keydown",function(event) {
        if (event.key === "Escape" && $summary.prop("open")) { event.stopPropagation(); $summary.prop("open",false); $summary.children("summary").trigger("focus"); }
      });
      $(document).on("click.ujgEsiSummary",function(event) {
        if (!$(event.target).closest($summary).length) $summary.prop("open",false);
      });
      $tools.append($summary); $toolbar.append($tools);
    }
    $toolbar.append(gridModule.button(fullscreen ? "Minimize2" : "Expand", fullscreen ? "Выйти из полноэкранного режима" : "На весь экран", toggleFullscreen).addClass("ujg-esi-fullscreen-button"));
    $root.append($toolbar);
    if (s.error) $root.append($("<div/>").addClass("ujg-esi-error").text(s.error));
    if (s.teamsError && (!s.mappingEditorOpen || s.activeMappingBlock !== "teams")) $root.append($("<div/>").addClass("ujg-esi-error").attr("role", "alert").text(s.teamsError));
    if (s.llmError) $root.append($("<div/>").addClass("ujg-esi-error").text(s.llmError));
    if (s.syncError) $root.append($("<div/>").addClass("ujg-esi-sync-error").text(s.syncError));
    if (s.registryError) $root.append($("<div/>").addClass("ujg-esi-sync-error").text(s.registryError));
    if (s.viewMode === "jira" && s.registryWarning) $root.append($("<div/>").addClass("ujg-esi-registry-warning").attr("role", "status").text(s.registryWarning));
    if (s.loading) $root.append($("<div/>").addClass("ujg-esi-loading").text("Загрузка..."));
    if (s.reportView === "activity" && activityView) activityView.render($root,s,services);
    else appendPreview($root, s);
    appendRowOwnerPopover($root, s);
    appendConfirmModal($root, s);
    appendLlmReviewDialog($root, s, "summary");
    appendLlmReviewDialog($root, s, "remark");
    appendDescriptionReviewDialog($root, s);
    appendMappingOverlay($root, s);
    if (teamFocus) {
      var $newRow = $root.find(".ujg-esi-team-row").filter(function() { return $(this).attr("data-team-id") === teamFocus.id; });
      var $replacement = $newRow.find(".ujg-esi-team-" + teamFocus.control).filter(function() { return !teamFocus.user || $(this).attr("data-user-id") === teamFocus.user; }).first();
      if (!$replacement.length && teamFocus.user) $replacement = $newRow.find(".ujg-esi-team-member-row").filter(function() { return $(this).attr("data-user-id") === teamFocus.user; }).first();
      if (!$replacement.length && teamFocus.user) $replacement = $newRow.find(".ujg-esi-team-search").first();
      if ($replacement.length) {
        if (teamFocus.draft !== null) $replacement.val(teamFocus.draft);
        $replacement[0].focus();
        if (teamFocus.start != null && $replacement[0].setSelectionRange) $replacement[0].setSelectionRange(teamFocus.start, teamFocus.end);
      }
    }
    restoreScrollState(scrollState);
  }

  function clearMappingError() {
    if (!$root || !$root.length) return;
    $root.find(".ujg-esi-mapping-error").remove();
  }

  return {
    init: init,
    render: render,
    clearMappingError: clearMappingError,
  };
});
