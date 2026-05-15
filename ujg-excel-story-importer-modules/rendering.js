define("_ujgESI_rendering", ["jquery"], function($) {
  "use strict";

  var $root;
  var services;
  var SUMMARY_MAX_LENGTH = 250;
  var epicSearchTimer = null;

  function init(container, svc) {
    $root = container;
    services = svc || {};
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
    var selectors = [".ujg-esi-confirm-modal", ".ujg-esi-confirm-scroll", ".ujg-esi-preview-wrap", ".ujg-esi-mapping-panel"];
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

  function previewStatusText(cols) {
    return cols && (cols["Статус в Jira"] || cols["Статус"] || "") || "";
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
      if (services && services.onFileChange) services.onFileChange(file);
    });
    $upload.append($("<span/>").addClass("ujg-esi-action-icon").html("&#8682;"), $file);
    $actions.append($upload);
  }

  function appendMappingButton($actions) {
    var $button = $("<button/>")
      .attr("type", "button")
      .addClass("ujg-esi-icon-button ujg-esi-mapping-button")
      .attr("title", "Настроить мапинг")
      .attr("aria-label", "Настроить мапинг")
      .append($("<span/>").addClass("ujg-esi-action-icon ujg-esi-mapping-button-icon").html("&#9881;"))
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
      .append($("<span/>").addClass("ujg-esi-action-icon").html("&#8635;"))
      .prop("disabled", !canSync)
      .on("click", function() {
        if (services && services.onSyncJira) services.onSyncJira();
      });
    var $download = $("<button/>")
      .attr("type", "button")
      .addClass("ujg-esi-icon-button ujg-esi-download-excel")
      .attr("title", "Скачать Excel")
      .attr("aria-label", "Скачать Excel")
      .append($("<span/>").addClass("ujg-esi-action-icon").html("&#10515;"))
      .prop("disabled", !canDownload)
      .on("click", function() {
        if (services && services.onDownloadPatchedExcel) services.onDownloadPatchedExcel();
      });
    $actions.append($sync, $download);
  }

  function appendExcelActions($toolbar, state) {
    var $field = $("<div/>").addClass("ujg-esi-field ujg-esi-file-field ujg-esi-actions-field");
    var $actions = $("<div/>").addClass("ujg-esi-toolbar-actions");
    $field.append($("<span/>").text("Excel"));
    appendFileInput($actions);
    appendMappingButton($actions);
    appendSyncActions($actions, state);
    $field.append($actions);
    $toolbar.append($field);
  }

  function appendParseMeta($header, state) {
    var meta = state && state.parseMeta ? state.parseMeta : null;
    var sheetNames = state && Array.isArray(state.sheetNames) ? state.sheetNames : [];
    var currentSheet = meta && meta.sheetName != null ? String(meta.sheetName) : "";
    var $meta = $("<div/>").addClass("ujg-esi-meta");
    $meta.append($("<span/>").text("Лист: "));
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
    $meta.append($sheetWrap, $("<span/>").text(" · заголовок строка " + meta.headerRowNumber));
    if (state && state.sourceFileName) {
      $meta.append(
        $("<span/>").text(" · файл: "),
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
    if (block === "priorities" || block === "roles" || block === "columns" || block === "tableStart") return block;
    return "modules";
  }

  function columnMappingRows(settings) {
    var map = settings && settings.columnMap ? settings.columnMap : {};
    return [
      { key: "summary", label: "Название / Summary", value: map.summary || "Замечание" },
      { key: "jira", label: "Jira key", value: map.jira || "Jira" },
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

  function issueBrowseUrl(key, baseUrl) {
    var path = "/browse/" + encodeURIComponent(String(key || ""));
    var base = baseUrl != null ? String(baseUrl).replace(/\/+$/, "") : "";
    return base ? base + path : path;
  }

  function childStatusClass(status) {
    var value = String(status || "").toLowerCase();
    if (/done|resolved|closed|готов|закры|снят/.test(value)) return "ujg-esi-child-status-done";
    if (/progress|review|testing|тест|работ|разработ|выполн/.test(value)) return "ujg-esi-child-status-progress";
    if (/todo|open|backlog|нов|выдан|ожид/.test(value)) return "ujg-esi-child-status-todo";
    return "ujg-esi-child-status-default";
  }

  function childStatusIsDone(status) {
    return childStatusClass(status) === "ujg-esi-child-status-done";
  }

  function childStatusLabel(item) {
    var role = item && item.role != null ? String(item.role).trim() : "";
    var key = item && item.key != null ? String(item.key).trim() : "";
    var summary = item && item.summary != null ? String(item.summary).trim() : "";
    var match = !role && summary ? summary.match(/^\s*\[([^\]]+)\]/) : null;
    return role || (match && match[1] ? String(match[1]).trim() : "") || key || "TASK";
  }

  function childStatusTitle(item) {
    var summary = item && item.summary ? item.summary : item && item.key ? item.key : "Задача";
    var status = item && item.status ? item.status : "Без статуса";
    var assignee = item && item.assignee ? item.assignee : "Не назначен";
    return summary + " | " + status + " | " + assignee;
  }

  function appendStatusCell($tr, row, state, fallbackText) {
    var $td = $("<td/>").addClass("ujg-esi-status");
    var children = row && Array.isArray(row.childStatuses) ? row.childStatuses : [];
    var base = state && state.baseUrl || "";
    var storyStatus = fallbackText != null ? String(fallbackText) : "";
    if (row && row.statusTitle) $td.attr("title", row.statusTitle);
    if (storyStatus) {
      $td.append($("<div/>").addClass("ujg-esi-story-status").text(storyStatus));
    }
    if (children.length) {
      var $list = $("<div/>").addClass("ujg-esi-child-status-list");
      children.forEach(function(item) {
        var key = item && item.key != null ? String(item.key).trim() : "";
        var label = childStatusLabel(item);
        var roleClass = "ujg-esi-role-" + label.toLowerCase().replace(/[^a-z0-9]/g, "");
        var $badge = key ? $("<a/>").attr("href", issueBrowseUrl(item.key, base)).attr("target", "_blank").attr("rel", "noreferrer noopener") : $("<span/>");
        $badge
          .addClass("ujg-esi-child-status-badge")
          .addClass(childStatusClass(item && item.status))
          .addClass(roleClass)
          .toggleClass("ujg-esi-child-status-blocked", !!(item && item.blocked))
          .toggleClass("ujg-esi-child-status-closed", childStatusIsDone(item && item.status))
          .attr("title", childStatusTitle(item))
          .text(label);
        $list.append($badge);
      });
      $td.append($list);
    } else {
      $td.text(fallbackText != null ? String(fallbackText) : "");
    }
    $tr.append($td);
  }

  function appendJiraCell($tr, row, state) {
    var key = row.createdKey || row.jiraKey || "";
    var $td = $("<td/>");
    var base = state.baseUrl || "";
    if (key) {
      $td.append(
        $("<a/>")
          .attr("href", issueBrowseUrl(key, base))
          .attr("target", "_blank")
          .attr("rel", "noreferrer noopener")
          .addClass("ujg-esi-jira-link")
          .text(key)
      );
    } else {
      $td.text(key || "—");
    }
    $tr.append($td);
  }

  function appendActionCell($tr, row, state, index) {
    var $td = $("<td/>").addClass("ujg-esi-action-cell");
    var canCreate = canCreateRow(row, state);
    var actionStatus = rowActionStatusText(row, state);
    var $button = $("<button/>")
      .attr("type", "button")
      .attr("title", actionStatus)
      .addClass("ujg-esi-create-row")
      .text(row.alreadyLinked || row.jiraKey ? "Уже создано" : row.status === "created" ? "Создано" : "Создать");
    if (!canCreate) $button.prop("disabled", true);
    $button.on("click", function() {
      if (services && services.onCreateRow) services.onCreateRow(index);
    });
    $td.append($button, $("<div/>").addClass("ujg-esi-row-status").text(actionStatus));
    if (row.errors && row.errors.length) {
      $td.append($("<div/>").addClass("ujg-esi-row-errors").text(row.errors.join(" · ")));
    }
    $tr.append($td);
  }

  function appendConfirmControl($list, label, $control) {
    $list.append($("<dt/>").text(label), $("<dd/>").append($control));
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

  function appendSummaryInput(className, value, onChange) {
    return appendTextInput(className, value, onChange).attr("maxlength", String(SUMMARY_MAX_LENGTH));
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

  function appendMappingPairs($parent, blockKey, title, entries) {
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
          .append($("<td/>").append(appendTextInput("ujg-esi-mapping-entry-jira", entry.jira, function(value) {
            if (services && services.onMappingPairChange) services.onMappingPairChange(blockKey, index, "jira", value);
          })))
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
        $("<h1/>").text("Мапинг Excel Import")
      );
    var $main = $("<div/>").addClass("ujg-esi-mapping-main");
    var $left = $("<div/>").addClass("ujg-esi-mapping-left");
    var $right = $("<div/>").addClass("ujg-esi-mapping-right");
    $left.append($("<div/>").addClass("ujg-esi-mapping-section-title").text("Блоки мапинга"));
    mappingBlockRows(settings).forEach(function(block) {
      appendMappingBlock($left, block, active === block.key);
    });
    if (active === "priorities") {
      appendMappingPairs($right, "priorities", "Приоритет → Priority", mapEntries(settings.priorityMap));
    } else if (active === "columns") {
      appendColumnMappings($right, settings);
    } else if (active === "tableStart") {
      appendTableStartMapping($right, settings);
    } else if (active === "roles") {
      appendMappingRoles($right, settings, state);
    } else {
      appendMappingPairs($right, "modules", "Модуль → Component", mapEntries(settings.moduleComponentMap));
    }
    if (state.mappingLoading) $right.append($("<div/>").addClass("ujg-esi-mapping-note").text("Загрузка мапинга..."));
    if (state.mappingError) $right.append($("<div/>").addClass("ujg-esi-mapping-error").text(state.mappingError));
    $main.append($left, $right);
    $shell.append($header, $main);
    $overlay.append($shell);
    $parent.append($overlay);
  }

  function appendConfirmSourceRows($parent, rows) {
    var $table = $("<table/>").addClass("ujg-esi-confirm-source");
    var $tbody = $("<tbody/>");
    (rows || []).forEach(function(row, index) {
      $tbody.append(
        $("<tr/>")
          .append($("<th/>").text(row.name != null ? String(row.name) : ""))
          .append($("<td/>").append(appendTextInput("ujg-esi-confirm-source-value", row.value, function(value) {
            if (services && services.onDialogSourceChange) services.onDialogSourceChange(index, value);
          })))
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
          .append($("<td/>").append(appendSummaryInput("ujg-esi-confirm-child-summary", task.summary, function(value) {
            if (services && services.onDialogChildChange) services.onDialogChildChange(index, "summary", value);
          }).prop("disabled", !enabled)))
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
    var $modal = $("<div/>")
      .addClass("ujg-esi-confirm-modal")
      .attr("role", "dialog")
      .attr("aria-modal", "true");
    var $fields = $("<dl/>").addClass("ujg-esi-confirm-fields");

    appendConfirmControl($fields, "Проект", appendSelect("ujg-esi-confirm-project", dialog.projectKey, (state.projects || []).map(function(project) {
      return { value: project.key || "", label: projectLabel(project) };
    }), function(value) {
      if (services && services.onDialogFieldChange) services.onDialogFieldChange("projectKey", value);
    }));
    appendConfirmControl($fields, "Тип Jira", appendIssueTypePicker("ujg-esi-confirm-issue-type", "story-type", dialog.issueType || "Story", state, false));
    appendConfirmControl($fields, "Epic", appendSelect("ujg-esi-confirm-epic", dialog.epicKey || "", [{ value: "", label: "Без Epic" }].concat((state.epics || []).map(function(epic) {
      return { value: epic.key || "", label: epicLabel(epic) };
    })), function(value) {
      if (services && services.onDialogFieldChange) services.onDialogFieldChange("epicKey", value);
    }));
    appendConfirmControl($fields, "Название", appendSummaryInput("ujg-esi-confirm-summary", dialog.summary, function(value) {
      if (services && services.onDialogFieldChange) services.onDialogFieldChange("summary", value);
    }));
    appendConfirmControl($fields, "Исполнитель", appendAssigneePicker("ujg-esi-confirm-assignee", "story", dialog.assigneeId || "", dialog.assigneeLabel || "", state, false));
    appendConfirmControl($fields, "Первоначальная оценка", appendTextInput("ujg-esi-confirm-original", dialog.originalEstimate, function(value) {
      if (services && services.onDialogFieldChange) services.onDialogFieldChange("originalEstimate", value);
    }));
    appendConfirmControl($fields, "Оставшееся время", appendTextInput("ujg-esi-confirm-remaining", dialog.remainingEstimate, function(value) {
      if (services && services.onDialogFieldChange) services.onDialogFieldChange("remainingEstimate", value);
    }));
    if (dialog.childTasks && dialog.childTasks.length) appendConfirmControl($fields, "Связь", $("<span/>").text("child of Story"));

    $modal.append(
      $("<div/>")
        .addClass("ujg-esi-confirm-head")
        .append($("<h3/>").text("Подтвердите создание"), $("<button/>")
          .attr("type", "button")
          .addClass("ujg-esi-confirm-close")
          .attr("aria-label", "Закрыть")
          .text("×")
          .on("click", function() {
            if (services && services.onCancelCreate) services.onCancelCreate();
          }))
    );
    $modal.append($fields);
    if (dialog.epicKey && dialog.epicLinkAllowed === false) {
      $modal.append(
        $("<div/>")
          .addClass("ujg-esi-confirm-epic-warning")
          .text("Epic выбран, но поле Epic Link недоступно для этого типа задачи; задача будет создана без Epic.")
      );
    }
    if (state.usersError) $modal.append($("<div/>").addClass("ujg-esi-confirm-users-error").text(state.usersError));
    $modal.append($("<h4/>").text("Описание"));
    appendConfirmSourceRows($modal, dialog.sourceRows);
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
            .text("Создать в Jira")
            .on("click", function() {
              if (services && services.onConfirmCreate) services.onConfirmCreate();
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
      $wrap.append($("<div/>").addClass("ujg-esi-empty").text("Загрузите Excel с журналом замечаний."));
      $parent.append($wrap);
      return;
    }
    var $table = $("<table/>").addClass("ujg-esi-preview-table");
    $table.append(
      $("<thead/>").append(
        $("<tr/>")
          .append($("<th/>").text("Строка"))
          .append($("<th/>").text("Замечание"))
          .append($("<th/>").text("Модуль"))
          .append($("<th/>").text("Статус"))
          .append($("<th/>").text("Приоритет"))
          .append($("<th/>").text("Jira"))
          .append($("<th/>").text("Действие"))
      )
    );
    var $tbody = $("<tbody/>");
    rows.forEach(function(row, index) {
      var cols = row.sourceColumns || {};
      var $tr = $("<tr/>")
        .addClass("ujg-esi-row-" + String(row.status || "ready"))
        .toggleClass("ujg-esi-row-linked", !!(row.alreadyLinked || row.jiraKey));
      appendValue($tr, row.excelRowNumber || "", "ujg-esi-row-num");
      appendValue($tr, row.summary || "", "ujg-esi-summary");
      appendValue($tr, cols["Модуль"] || "", "ujg-esi-module");
      appendStatusCell($tr, row, state, previewStatusText(cols));
      appendValue($tr, cols["Приоритет"] || "", "ujg-esi-priority");
      appendJiraCell($tr, row, state);
      appendActionCell($tr, row, state, index);
      $tbody.append($tr);
    });
    $table.append($tbody);
    $wrap.append($table);
    $parent.append($wrap);
  }

  function render(state) {
    if (!$root || !$root.length) return;
    var scrollState = captureScrollState();
    $root.empty();
    var s = state || {};
    var $header = $("<div/>").addClass("ujg-esi-header");
    var $toolbar = $("<div/>").addClass("ujg-esi-toolbar");
    $header.append($("<h2/>").text("Импорт замечаний из Excel"));
    if (s.parseMeta) {
      appendParseMeta($header, s);
    }
    appendProjectSelect($toolbar, s);
    appendEpicPicker($toolbar, s);
    appendExcelActions($toolbar, s);
    $root.append($header, $toolbar);
    appendCounters($root, s);
    if (s.error) $root.append($("<div/>").addClass("ujg-esi-error").text(s.error));
    if (s.syncError) $root.append($("<div/>").addClass("ujg-esi-sync-error").text(s.syncError));
    if (s.syncSummary) $root.append($("<div/>").addClass("ujg-esi-sync-summary").text(s.syncSummary));
    if (s.loading) $root.append($("<div/>").addClass("ujg-esi-loading").text("Загрузка..."));
    appendPreview($root, s);
    appendConfirmModal($root, s);
    appendMappingOverlay($root, s);
    restoreScrollState(scrollState);
  }

  return {
    init: init,
    render: render,
  };
});
