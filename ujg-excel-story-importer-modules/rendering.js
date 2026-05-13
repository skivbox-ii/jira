define("_ujgESI_rendering", ["jquery"], function($) {
  "use strict";

  var $root;
  var services;

  function init(container, svc) {
    $root = container;
    services = svc || {};
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

  function appendEpicSelect($toolbar, state) {
    var $field = $("<label/>").addClass("ujg-esi-field");
    var $select = $("<select/>").addClass("ujg-esi-epic-select");
    $field.append($("<span/>").text("Epic"));
    $select.append($("<option/>").attr("value", "").text(state.projectKey ? "Без Epic" : "Сначала проект"));
    (state.epics || []).forEach(function(epic) {
      var key = epic && epic.key != null ? String(epic.key) : "";
      if (!key) return;
      $select.append($("<option/>").attr("value", key).text(epicLabel(epic)));
    });
    $select.val(state.epicKey || "");
    if (!state.projectKey) $select.prop("disabled", true);
    $select.on("change", function() {
      if (services && services.onEpicChange) services.onEpicChange($(this).val());
    });
    $field.append($select);
    $toolbar.append($field);
  }

  function appendFileInput($toolbar) {
    var $field = $("<label/>").addClass("ujg-esi-field ujg-esi-file-field");
    var $file = $("<input/>")
      .addClass("ujg-esi-file")
      .attr("type", "file")
      .attr("accept", ".xlsx,.xls");
    $field.append($("<span/>").text("Excel"));
    $file.on("change", function() {
      var file = this.files && this.files.length ? this.files[0] : null;
      if (services && services.onFileChange) services.onFileChange(file);
    });
    $field.append($file);
    $toolbar.append($field);
  }

  function appendSubtasksToggle($toolbar, state) {
    var $label = $("<label/>").addClass("ujg-esi-check");
    var $input = $("<input/>").addClass("ujg-esi-subtasks").attr("type", "checkbox");
    $input.prop("checked", state.createSubtasks !== false);
    $input.on("change", function() {
      if (services && services.onSubtasksChange) services.onSubtasksChange(!!$(this).prop("checked"));
    });
    $label.append($input, $("<span/>").text("Создавать дочерние задачи"));
    $toolbar.append($label);
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

  function appendValue($tr, value, className) {
    $tr.append($("<td/>").addClass(className || "").text(value != null ? String(value) : ""));
  }

  function appendJiraCell($tr, row, state) {
    var key = row.createdKey || row.jiraKey || "";
    var $td = $("<td/>");
    var base = state.baseUrl || "";
    if (key && base) {
      $td.append(
        $("<a/>")
          .attr("href", String(base).replace(/\/+$/, "") + "/browse/" + encodeURIComponent(key))
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
          .append($("<td/>").append(appendTextInput("ujg-esi-confirm-child-type", task.issueType, function(value) {
            if (services && services.onDialogChildChange) services.onDialogChildChange(index, "issueType", value);
          }).prop("disabled", !enabled)))
          .append($("<td/>").append(appendTextInput("ujg-esi-confirm-child-summary", task.summary, function(value) {
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
    appendConfirmControl($fields, "Тип Jira", appendTextInput("ujg-esi-confirm-issue-type", dialog.issueType || "Story", function(value) {
      if (services && services.onDialogFieldChange) services.onDialogFieldChange("issueType", value);
    }));
    appendConfirmControl($fields, "Epic", appendSelect("ujg-esi-confirm-epic", dialog.epicKey || "", [{ value: "", label: "Без Epic" }].concat((state.epics || []).map(function(epic) {
      return { value: epic.key || "", label: epicLabel(epic) };
    })), function(value) {
      if (services && services.onDialogFieldChange) services.onDialogFieldChange("epicKey", value);
    }));
    appendConfirmControl($fields, "Название", appendTextInput("ujg-esi-confirm-summary", dialog.summary, function(value) {
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
      appendValue($tr, cols["Статус"] || "", "ujg-esi-status");
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
    $root.empty();
    var s = state || {};
    var $header = $("<div/>").addClass("ujg-esi-header");
    var $toolbar = $("<div/>").addClass("ujg-esi-toolbar");
    $header.append($("<h2/>").text("Импорт замечаний из Excel"));
    if (s.parseMeta) {
      $header.append(
        $("<div/>")
          .addClass("ujg-esi-meta")
          .text("Лист: " + s.parseMeta.sheetName + " · заголовок строка " + s.parseMeta.headerRowNumber)
      );
    }
    appendProjectSelect($toolbar, s);
    appendEpicSelect($toolbar, s);
    appendFileInput($toolbar, s);
    appendSubtasksToggle($toolbar, s);
    $root.append($header, $toolbar);
    appendCounters($root, s);
    if (s.error) $root.append($("<div/>").addClass("ujg-esi-error").text(s.error));
    if (s.loading) $root.append($("<div/>").addClass("ujg-esi-loading").text("Загрузка..."));
    appendPreview($root, s);
    appendConfirmModal($root, s);
  }

  return {
    init: init,
    render: render,
  };
});
