define("_ujgESI_main", [
  "jquery",
  "_ujgESI_config",
  "_ujgESI_api",
  "_ujgESI_excel-loader",
  "_ujgESI_parser",
  "_ujgESI_creator",
  "_ujgESI_rendering",
], function($, config, api, excelLoader, parser, creator, rendering) {
  "use strict";

  function copyRow(row) {
    var out = {};
    Object.keys(row || {}).forEach(function(key) {
      out[key] = row[key];
    });
    out.errors = Array.isArray(out.errors) ? out.errors.slice() : [];
    return out;
  }

  function normalizeProjects(projects) {
    return Array.isArray(projects) ? projects : [];
  }

  function normalizeEpics(data) {
    if (data && Array.isArray(data.issues)) return data.issues;
    return Array.isArray(data) ? data : [];
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

  function promiseOf(value) {
    return value && typeof value.then === "function" ? Promise.resolve(value) : Promise.resolve(value);
  }

  function ensureContainer($content) {
    var $container = $content && $content.find ? $content.find(".ujg-excel-story-importer") : $();
    if ($container && $container.length) return $container;
    if ($content && $content.hasClass && $content.hasClass("ujg-excel-story-importer")) return $content;
    $container = $('<div class="ujg-excel-story-importer"></div>');
    if ($content && $content.append) $content.append($container);
    return $container;
  }

  function ExcelStoryImporterGadget(API) {
    var $content = API && API.getGadgetContentEl ? API.getGadgetContentEl() : $();
    var $container = ensureContainer($content);
    var state = {
      projects: [],
      projectKey: "",
      epics: [],
      epicKey: "",
      rows: [],
      createSubtasks: true,
      loading: false,
      error: "",
      parseMeta: null,
      createDialog: null,
      baseUrl: api && api.baseUrl ? api.baseUrl : "",
    };

    function selectedProjectText() {
      var key = state.projectKey || "";
      var list = state.projects || [];
      var found = list.filter(function(project) {
        return project && String(project.key || "") === key;
      })[0];
      return projectLabel(found) || key;
    }

    function selectedEpicText() {
      var key = state.epicKey || "";
      if (!key) return "Без Epic";
      var list = state.epics || [];
      var found = list.filter(function(epic) {
        return epic && String(epic.key || "") === key;
      })[0];
      return epicLabel(found) || key;
    }

    function sourceRows(row) {
      var out = [];
      var cols = row && row.sourceColumns ? row.sourceColumns : {};
      if (row && row.sheetName) out.push({ name: "Лист", value: row.sheetName });
      if (row && row.excelRowNumber != null) out.push({ name: "Строка Excel", value: row.excelRowNumber });
      Object.keys(cols).forEach(function(name) {
        var value = cols[name];
        if (value != null && String(value).trim()) out.push({ name: name, value: value });
      });
      return out;
    }

    function childSummary(role, storySummary) {
      var prefix = role && role.role != null ? String(role.role).trim() : "";
      var summary = storySummary != null ? String(storySummary).trim() : "";
      return (prefix ? "[" + prefix + "] " : "") + summary;
    }

    function buildCreateDialog(row, index) {
      var roles = config && Array.isArray(config.CREATE_TEMPLATE_ROLES) ? config.CREATE_TEMPLATE_ROLES : [];
      var summary = row && row.summary != null ? String(row.summary) : "";
      return {
        rowIndex: index,
        issueType: config && config.STORY_ISSUE_TYPE ? config.STORY_ISSUE_TYPE : "Story",
        projectKey: state.projectKey,
        projectText: selectedProjectText(),
        epicKey: state.epicKey,
        epicText: selectedEpicText(),
        summary: summary,
        createSubtasks: state.createSubtasks !== false,
        childTasks: state.createSubtasks !== false ? roles.map(function(role) {
          return {
            role: role && role.role != null ? String(role.role) : "",
            issueType: role && role.issueType != null ? String(role.issueType) : "",
            summary: childSummary(role, summary),
          };
        }) : [],
        sourceRows: sourceRows(row),
      };
    }

    function render() {
      rendering.render(state);
      if (API && typeof API.resize === "function") API.resize();
    }

    function setError(message) {
      state.error = message ? String(message) : "";
      state.loading = false;
      render();
    }

    function loadProjects() {
      state.loading = true;
      render();
      return promiseOf(api.getProjects()).then(
        function(projects) {
          state.projects = normalizeProjects(projects);
          state.loading = false;
          render();
        },
        function(err) {
          setError("Не удалось загрузить проекты: " + (err && err.statusText ? err.statusText : "request failed"));
        }
      );
    }

    function loadEpics(projectKey) {
      state.epicKey = "";
      state.epics = [];
      if (!projectKey) {
        render();
        return Promise.resolve();
      }
      state.loading = true;
      render();
      return promiseOf(api.getProjectEpics(projectKey)).then(
        function(data) {
          state.epics = normalizeEpics(data);
          state.loading = false;
          render();
        },
        function(err) {
          setError("Не удалось загрузить Epic: " + (err && err.statusText ? err.statusText : "request failed"));
        }
      );
    }

    function onProjectChange(projectKey) {
      state.projectKey = projectKey != null ? String(projectKey) : "";
      state.error = "";
      state.createDialog = null;
      loadEpics(state.projectKey);
    }

    function onEpicChange(epicKey) {
      state.epicKey = epicKey != null ? String(epicKey) : "";
      state.createDialog = null;
      render();
    }

    function onFileChange(file) {
      if (!file) return;
      state.loading = true;
      state.error = "";
      state.createDialog = null;
      render();
      promiseOf(excelLoader.readWorkbook(file)).then(function(workbook) {
        var parsed = parser.parseWorkbook(workbook);
        state.rows = (parsed.rows || []).map(copyRow);
        state.parseMeta = { sheetName: parsed.sheetName, headerRowNumber: parsed.headerRowNumber };
        state.loading = false;
        render();
      }).then(null,
        function(err) {
          setError("Не удалось прочитать Excel: " + (err && err.message ? err.message : "unknown error"));
        }
      );
    }

    function onSubtasksChange(enabled) {
      state.createSubtasks = !!enabled;
      state.createDialog = null;
      render();
    }

    function completeCreate(row, result) {
      row.createdKey = result && result.createdKey ? String(result.createdKey) : row.createdKey || "";
      row.errors = result && Array.isArray(result.errors) ? result.errors.slice() : [];
      if (result && result.partial) {
        row.status = "partial";
      } else if (result && result.ok) {
        row.status = "created";
      } else {
        row.status = "failed";
      }
      render();
    }

    function createConfirmedRow(dialog) {
      var row = dialog ? state.rows[dialog.rowIndex] : null;
      if (!row || row.status === "creating" || row.alreadyLinked || row.jiraKey || row.createdKey) return;
      row.status = "creating";
      row.errors = [];
      state.createDialog = null;
      render();
      promiseOf(
        creator.createRow(api, row, {
          projectKey: dialog.projectKey,
          epicKey: dialog.epicKey,
          createSubtasks: dialog.createSubtasks,
        })
      ).then(function(result) {
        completeCreate(row, result);
      });
    }

    function onCreateRow(index) {
      var i = Number(index);
      var row = state.rows[i];
      if (!row || row.status === "creating" || row.alreadyLinked || row.jiraKey || row.createdKey) return;
      if (!state.projectKey) {
        state.error = "Выберите проект перед созданием.";
        render();
        return;
      }
      state.error = "";
      state.createDialog = buildCreateDialog(row, i);
      render();
    }

    function onConfirmCreate() {
      var dialog = state.createDialog;
      if (!dialog) return;
      createConfirmedRow(dialog);
    }

    function onCancelCreate() {
      state.createDialog = null;
      render();
    }

    rendering.init($container, {
      onProjectChange: onProjectChange,
      onEpicChange: onEpicChange,
      onFileChange: onFileChange,
      onSubtasksChange: onSubtasksChange,
      onCreateRow: onCreateRow,
      onConfirmCreate: onConfirmCreate,
      onCancelCreate: onCancelCreate,
    });

    rendering.render(state);
    loadProjects();
  }

  return ExcelStoryImporterGadget;
});
