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

  function normalizeUsers(data) {
    var rows = data && Array.isArray(data.users) ? data.users : Array.isArray(data) ? data : [];
    return rows
      .map(function(user) {
        var id = user && user.accountId != null && String(user.accountId).trim()
          ? String(user.accountId).trim()
          : user && user.name != null && String(user.name).trim()
            ? String(user.name).trim()
            : user && user.key != null && String(user.key).trim()
              ? String(user.key).trim()
              : "";
        var label = user && user.displayName != null && String(user.displayName).trim()
          ? String(user.displayName).trim()
          : user && user.name != null && String(user.name).trim()
            ? String(user.name).trim()
            : id;
        if (!id) return null;
        return { id: id, label: label, raw: user };
      })
      .filter(Boolean);
  }

  function mergeUsers(existing, incoming) {
    var out = [];
    var seen = {};
    (existing || []).concat(incoming || []).forEach(function(user) {
      var id = user && user.id != null ? String(user.id) : "";
      if (!id || seen[id]) return;
      seen[id] = true;
      out.push(user);
    });
    return out;
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
      users: [],
      usersLoading: false,
      usersError: "",
      createMetaByProject: {},
      createMetaLoading: false,
      createMetaError: "",
      userPicker: {
        target: "",
        query: "",
        rows: [],
        loading: false,
        error: "",
        seq: 0,
      },
      baseUrl: api && api.baseUrl ? api.baseUrl : "",
    };

    function hasOwn(obj, key) {
      return !!(obj && Object.prototype.hasOwnProperty.call(obj, key));
    }

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

    function selectedUser(userId) {
      var id = userId != null ? String(userId) : "";
      var found = (state.users || []).filter(function(user) {
        return user && String(user.id || "") === id;
      })[0];
      return found && found.raw ? found.raw : null;
    }

    function userLabel(user) {
      if (!user || typeof user !== "object") return "";
      if (user.displayName != null && String(user.displayName).trim()) return String(user.displayName).trim();
      if (user.name != null && String(user.name).trim()) return String(user.name).trim();
      if (user.key != null && String(user.key).trim()) return String(user.key).trim();
      if (user.accountId != null && String(user.accountId).trim()) return String(user.accountId).trim();
      return "";
    }

    function userTargetNode(target) {
      var key = target != null ? String(target) : "";
      var dialog = state.createDialog;
      var match;
      if (!dialog) return null;
      if (key === "story") return dialog;
      match = /^child-(\d+)$/.exec(key);
      if (match) return dialog.childTasks ? dialog.childTasks[Number(match[1])] : null;
      return null;
    }

    function setTargetAssignee(target, userRow) {
      var node = userTargetNode(target);
      var raw = userRow && userRow.raw ? userRow.raw : null;
      if (!node) return;
      if (!raw) {
        node.assigneeId = "";
        node.assigneeLabel = "";
        node.assignee = null;
        return;
      }
      node.assigneeId = userRow.id || "";
      node.assigneeLabel = userRow.label || userLabel(raw) || userRow.id || "";
      node.assignee = raw;
    }

    function selectedProjectTextFor(projectKey) {
      var key = projectKey || "";
      var found = (state.projects || []).filter(function(project) {
        return project && String(project.key || "") === key;
      })[0];
      return projectLabel(found) || key;
    }

    function selectedEpicTextFor(epicKey) {
      var key = epicKey || "";
      if (!key) return "Без Epic";
      var found = (state.epics || []).filter(function(epic) {
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

    function estimateHours(value) {
      var text = value != null ? String(value) : "";
      var match = /(\d+(?:[.,]\d+)?)/.exec(text);
      return match ? Number(match[1].replace(",", ".")) : 0;
    }

    function storyEstimate(roles) {
      var total = (roles || []).reduce(function(sum, role) {
        return sum + estimateHours(role && role.originalEstimate);
      }, 0);
      return (total || 1) + "h";
    }

    function issueTypeFieldsFromCreateMeta(data, issueTypeName) {
      var projects = data && Array.isArray(data.projects) ? data.projects : [];
      var wanted = String(issueTypeName || "").toLowerCase();
      var type = null;
      projects.some(function(project) {
        var types = project && Array.isArray(project.issuetypes) ? project.issuetypes : [];
        return types.some(function(issueType) {
          var name = issueType && issueType.name != null ? String(issueType.name).toLowerCase() : "";
          if (name === wanted) {
            type = issueType;
            return true;
          }
          return false;
        });
      });
      return type && type.fields ? type.fields : null;
    }

    function epicLinkAllowedFromCreateMeta(data, issueTypeName) {
      var fields = issueTypeFieldsFromCreateMeta(data, issueTypeName);
      if (!fields) return true;
      return !!(config && config.EPIC_LINK_FIELD && hasOwn(fields, config.EPIC_LINK_FIELD));
    }

    function projectEpicLinkAllowed(projectKey, issueTypeName) {
      var key = projectKey != null ? String(projectKey) : "";
      if (!key || !hasOwn(state.createMetaByProject, key)) return true;
      return epicLinkAllowedFromCreateMeta(state.createMetaByProject[key], issueTypeName);
    }

    function buildCreateDialog(row, index) {
      var roles = config && Array.isArray(config.CREATE_TEMPLATE_ROLES) ? config.CREATE_TEMPLATE_ROLES : [];
      var summary = row && row.summary != null ? String(row.summary) : "";
      var estimate = state.createSubtasks !== false ? storyEstimate(roles) : "1h";
      var issueType = config && config.STORY_ISSUE_TYPE ? config.STORY_ISSUE_TYPE : "Story";
      return {
        rowIndex: index,
        issueType: issueType,
        projectKey: state.projectKey,
        projectText: selectedProjectText(),
        epicKey: state.epicKey,
        epicText: selectedEpicText(),
        epicLinkAllowed: projectEpicLinkAllowed(state.projectKey, issueType),
        summary: summary,
        assigneeId: "",
        assigneeLabel: "",
        assignee: null,
        originalEstimate: estimate,
        remainingEstimate: estimate,
        createSubtasks: state.createSubtasks !== false,
        childTasks: state.createSubtasks !== false ? roles.map(function(role) {
          return {
            enabled: true,
            role: role && role.role != null ? String(role.role) : "",
            issueType: role && role.issueType != null ? String(role.issueType) : "",
            summary: childSummary(role, summary),
            assigneeId: "",
            assigneeLabel: "",
            assignee: null,
            originalEstimate: role && role.originalEstimate != null ? String(role.originalEstimate) : "1h",
            remainingEstimate: role && role.remainingEstimate != null ? String(role.remainingEstimate) : "1h",
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

    function loadCreateMeta(projectKey) {
      var key = projectKey != null ? String(projectKey) : "";
      if (!key || !api || typeof api.getProjectCreateMeta !== "function") return Promise.resolve();
      state.createMetaLoading = true;
      state.createMetaError = "";
      render();
      return promiseOf(api.getProjectCreateMeta(key)).then(
        function(data) {
          state.createMetaByProject[key] = data;
          state.createMetaLoading = false;
          state.createMetaError = "";
          if (state.createDialog && state.createDialog.projectKey === key) {
            state.createDialog.epicLinkAllowed = projectEpicLinkAllowed(key, state.createDialog.issueType);
          }
          render();
        },
        function(err) {
          state.createMetaByProject[key] = null;
          state.createMetaLoading = false;
          state.createMetaError = "Не удалось загрузить create metadata: " + (err && err.statusText ? err.statusText : "request failed");
          render();
        }
      );
    }

    function loadUsers() {
      if (!api || typeof api.searchUsers !== "function") return Promise.resolve();
      state.usersLoading = true;
      state.usersError = "";
      render();
      return promiseOf(api.searchUsers("")).then(
        function(data) {
          state.users = normalizeUsers(data);
          state.usersLoading = false;
          state.usersError = "";
          render();
        },
        function(err) {
          state.usersLoading = false;
          state.usersError = "Не удалось загрузить исполнителей: " + (err && err.statusText ? err.statusText : "request failed");
          render();
        }
      );
    }

    function closeUserPicker() {
      state.userPicker.target = "";
      state.userPicker.query = "";
      state.userPicker.rows = [];
      state.userPicker.loading = false;
      state.userPicker.error = "";
      state.userPicker.seq += 1;
    }

    function loadAssigneeSearch(target, query) {
      var targetKey = target != null ? String(target) : "";
      var q = query != null ? String(query) : "";
      if (!api || typeof api.searchUsers !== "function" || !userTargetNode(targetKey)) return Promise.resolve();
      state.userPicker.target = targetKey;
      state.userPicker.query = q;
      state.userPicker.loading = true;
      state.userPicker.error = "";
      state.userPicker.seq += 1;
      var seq = state.userPicker.seq;
      render();
      return promiseOf(api.searchUsers(q)).then(
        function(data) {
          var rows = normalizeUsers(data);
          if (!state.createDialog || state.userPicker.seq !== seq || state.userPicker.target !== targetKey) return;
          state.users = mergeUsers(state.users, rows);
          state.userPicker.rows = rows;
          state.userPicker.loading = false;
          state.userPicker.error = "";
          render();
        },
        function(err) {
          if (!state.createDialog || state.userPicker.seq !== seq || state.userPicker.target !== targetKey) return;
          state.userPicker.rows = [];
          state.userPicker.loading = false;
          state.userPicker.error = "Не удалось найти исполнителей: " + (err && err.statusText ? err.statusText : "request failed");
          render();
        }
      );
    }

    function onProjectChange(projectKey) {
      state.projectKey = projectKey != null ? String(projectKey) : "";
      state.error = "";
      state.createDialog = null;
      closeUserPicker();
      loadEpics(state.projectKey);
      loadCreateMeta(state.projectKey);
    }

    function onEpicChange(epicKey) {
      state.epicKey = epicKey != null ? String(epicKey) : "";
      state.createDialog = null;
      closeUserPicker();
      render();
    }

    function onFileChange(file) {
      if (!file) return;
      state.loading = true;
      state.error = "";
      state.createDialog = null;
      closeUserPicker();
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
      closeUserPicker();
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
      closeUserPicker();
      render();
      promiseOf(
        creator.createRow(api, row, {
          projectKey: dialog.projectKey,
          epicKey: dialog.epicKey,
          epicLinkAllowed: dialog.epicLinkAllowed,
          issueType: dialog.issueType,
          summary: dialog.summary,
          assignee: dialog.assignee,
          originalEstimate: dialog.originalEstimate,
          remainingEstimate: dialog.remainingEstimate,
          sourceRows: dialog.sourceRows,
          createSubtasks: dialog.createSubtasks,
          childTasks: dialog.childTasks,
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

    function onDialogFieldChange(field, value) {
      var dialog = state.createDialog;
      var key = field != null ? String(field) : "";
      if (!dialog) return;
      if (key === "summary") {
        dialog.summary = value != null ? String(value) : "";
        (dialog.childTasks || []).forEach(function(task) {
          task.summary = childSummary(task, dialog.summary);
        });
      } else if (key === "projectKey") {
        dialog.projectKey = value != null ? String(value) : "";
        dialog.projectText = selectedProjectTextFor(dialog.projectKey);
        dialog.epicKey = "";
        dialog.epicText = "Без Epic";
        dialog.epicLinkAllowed = projectEpicLinkAllowed(dialog.projectKey, dialog.issueType);
        loadEpics(dialog.projectKey);
        loadCreateMeta(dialog.projectKey);
      } else if (key === "issueType") {
        dialog.issueType = value != null ? String(value) : "";
        dialog.epicLinkAllowed = projectEpicLinkAllowed(dialog.projectKey, dialog.issueType);
      } else if (key === "epicKey") {
        dialog.epicKey = value != null ? String(value) : "";
        dialog.epicText = selectedEpicTextFor(dialog.epicKey);
      } else if (key === "assigneeId") {
        dialog.assigneeId = value != null ? String(value) : "";
        dialog.assignee = selectedUser(dialog.assigneeId);
        dialog.assigneeLabel = userLabel(dialog.assignee);
      } else if (key === "originalEstimate") {
        dialog.originalEstimate = value != null ? String(value) : "";
      } else if (key === "remainingEstimate") {
        dialog.remainingEstimate = value != null ? String(value) : "";
      }
      render();
    }

    function onDialogSourceChange(index, value) {
      var dialog = state.createDialog;
      var i = Number(index);
      if (!dialog || !dialog.sourceRows || !dialog.sourceRows[i]) return;
      dialog.sourceRows[i].value = value != null ? String(value) : "";
      render();
    }

    function onDialogChildToggle(index, enabled) {
      var dialog = state.createDialog;
      var i = Number(index);
      if (!dialog || !dialog.childTasks || !dialog.childTasks[i]) return;
      dialog.childTasks[i].enabled = !!enabled;
      render();
    }

    function onDialogChildChange(index, field, value) {
      var dialog = state.createDialog;
      var i = Number(index);
      var key = field != null ? String(field) : "";
      var task = dialog && dialog.childTasks ? dialog.childTasks[i] : null;
      if (!task) return;
      if (key === "summary") {
        task.summary = value != null ? String(value) : "";
      } else if (key === "issueType") {
        task.issueType = value != null ? String(value) : "";
      } else if (key === "assigneeId") {
        task.assigneeId = value != null ? String(value) : "";
        task.assignee = selectedUser(task.assigneeId);
        task.assigneeLabel = userLabel(task.assignee);
      } else if (key === "originalEstimate") {
        task.originalEstimate = value != null ? String(value) : "";
      } else if (key === "remainingEstimate") {
        task.remainingEstimate = value != null ? String(value) : "";
      }
      render();
    }

    function onDialogAssigneeFocus(target) {
      var targetKey = target != null ? String(target) : "";
      if (!userTargetNode(targetKey)) return;
      if (state.userPicker.target === targetKey && (state.userPicker.loading || state.userPicker.rows.length || state.userPicker.query)) {
        return;
      }
      loadAssigneeSearch(targetKey, "");
    }

    function onDialogAssigneeSearch(target, query) {
      loadAssigneeSearch(target, query);
    }

    function onDialogAssigneeSelect(target, userId) {
      var id = userId != null ? String(userId) : "";
      var row = (state.userPicker.rows || []).filter(function(user) {
        return user && String(user.id || "") === id;
      })[0] || (state.users || []).filter(function(user) {
        return user && String(user.id || "") === id;
      })[0] || null;
      setTargetAssignee(target, row);
      closeUserPicker();
      render();
    }

    function onDialogAssigneeClear(target) {
      setTargetAssignee(target, null);
      closeUserPicker();
      render();
    }

    function onConfirmCreate() {
      var dialog = state.createDialog;
      if (!dialog) return;
      createConfirmedRow(dialog);
    }

    function onCancelCreate() {
      state.createDialog = null;
      closeUserPicker();
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
      onDialogFieldChange: onDialogFieldChange,
      onDialogSourceChange: onDialogSourceChange,
      onDialogChildToggle: onDialogChildToggle,
      onDialogChildChange: onDialogChildChange,
      onDialogAssigneeFocus: onDialogAssigneeFocus,
      onDialogAssigneeSearch: onDialogAssigneeSearch,
      onDialogAssigneeSelect: onDialogAssigneeSelect,
      onDialogAssigneeClear: onDialogAssigneeClear,
    });

    rendering.render(state);
    loadProjects();
  }

  return ExcelStoryImporterGadget;
});
