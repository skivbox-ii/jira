define("_ujgESI_main", [
  "jquery",
  "_ujgESI_api",
  "_ujgESI_excel-loader",
  "_ujgESI_parser",
  "_ujgESI_creator",
  "_ujgESI_rendering",
], function($, api, excelLoader, parser, creator, rendering) {
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
      baseUrl: api && api.baseUrl ? api.baseUrl : "",
    };

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
      loadEpics(state.projectKey);
    }

    function onEpicChange(epicKey) {
      state.epicKey = epicKey != null ? String(epicKey) : "";
      render();
    }

    function onFileChange(file) {
      if (!file) return;
      state.loading = true;
      state.error = "";
      render();
      promiseOf(excelLoader.readWorkbook(file)).then(
        function(workbook) {
          var parsed = parser.parseWorkbook(workbook);
          state.rows = (parsed.rows || []).map(copyRow);
          state.parseMeta = { sheetName: parsed.sheetName, headerRowNumber: parsed.headerRowNumber };
          state.loading = false;
          render();
        },
        function(err) {
          setError("Не удалось прочитать Excel: " + (err && err.message ? err.message : "unknown error"));
        }
      );
    }

    function onSubtasksChange(enabled) {
      state.createSubtasks = !!enabled;
      render();
    }

    function onCreateRow(index) {
      var i = Number(index);
      var row = state.rows[i];
      if (!row || row.status === "creating" || row.alreadyLinked || row.jiraKey || row.createdKey) return;
      if (!state.projectKey || !state.epicKey) {
        state.error = "Выберите проект и Epic перед созданием.";
        render();
        return;
      }
      row.status = "creating";
      row.errors = [];
      render();
      promiseOf(
        creator.createRow(api, row, {
          projectKey: state.projectKey,
          epicKey: state.epicKey,
          createSubtasks: state.createSubtasks,
        })
      ).then(function(result) {
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
      });
    }

    rendering.init($container, {
      onProjectChange: onProjectChange,
      onEpicChange: onEpicChange,
      onFileChange: onFileChange,
      onSubtasksChange: onSubtasksChange,
      onCreateRow: onCreateRow,
    });

    rendering.render(state);
    loadProjects();
  }

  return ExcelStoryImporterGadget;
});
