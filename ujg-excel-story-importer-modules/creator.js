define("_ujgESI_creator", ["_ujgESI_config", "_ujgESI_description"], function(config, description) {
  "use strict";

  function ajaxErrorText(err) {
    if (!err) return "Request failed";
    if (err.responseJSON && err.responseJSON.errorMessages && err.responseJSON.errorMessages.length) {
      return err.responseJSON.errorMessages.join(" ");
    }
    if (err.statusText) return String(err.statusText);
    if (err.message) return String(err.message);
    return "Request failed";
  }

  function createdKey(res) {
    return res && res.key != null ? String(res.key).trim() : "";
  }

  function storyFields(row, options) {
    var opts = options || {};
    var fields = {
      project: { key: String(opts.projectKey || "") },
      summary: String(row && row.summary != null ? row.summary : "").trim(),
      issuetype: { name: config.STORY_ISSUE_TYPE },
      description: description.buildDescription(row),
    };
    if (opts.epicKey && config.EPIC_LINK_FIELD) {
      fields[config.EPIC_LINK_FIELD] = { key: String(opts.epicKey) };
    }
    return fields;
  }

  function subtaskFields(projectKey, parentKey, role) {
    return {
      project: { key: String(projectKey || "") },
      parent: { key: String(parentKey || "") },
      summary: String((role && role.summary) || ""),
      issuetype: { name: String((role && role.issueType) || "") },
      description: "Создано автоматически из журнала замечаний.",
    };
  }

  function createSubtasksSequential(api, projectKey, parentKey, index, errors) {
    var roles = config.CREATE_TEMPLATE_ROLES || [];
    if (index >= roles.length) {
      return Promise.resolve({ ok: errors.length === 0, errors: errors });
    }
    return Promise.resolve(api.createIssue({ fields: subtaskFields(projectKey, parentKey, roles[index]) })).then(
      function(res) {
        if (!createdKey(res)) {
          errors.push("Subtask response missing issue key: " + roles[index].role);
        }
        return createSubtasksSequential(api, projectKey, parentKey, index + 1, errors);
      },
      function(err) {
        errors.push(roles[index].role + ": " + ajaxErrorText(err));
        return createSubtasksSequential(api, projectKey, parentKey, index + 1, errors);
      }
    );
  }

  function createRow(api, row, options) {
    var opts = options || {};
    if (row && (row.alreadyLinked || row.jiraKey)) {
      return Promise.resolve({ ok: true, skipped: true, createdKey: row.jiraKey || "" });
    }
    if (!api || typeof api.createIssue !== "function") {
      return Promise.resolve({ ok: false, errors: ["Jira API is not available"] });
    }
    return Promise.resolve(api.createIssue({ fields: storyFields(row, opts) })).then(
      function(res) {
        var key = createdKey(res);
        if (!key) return { ok: false, errors: ["Story response missing issue key"] };
        if (!opts.createSubtasks) return { ok: true, createdKey: key, errors: [] };
        return createSubtasksSequential(api, opts.projectKey, key, 0, []).then(function(sub) {
          return {
            ok: sub.errors.length === 0,
            partial: sub.errors.length > 0,
            createdKey: key,
            errors: sub.errors,
          };
        });
      },
      function(err) {
        return { ok: false, errors: [ajaxErrorText(err)] };
      }
    );
  }

  return {
    createRow: createRow,
    storyFields: storyFields,
    subtaskFields: subtaskFields,
  };
});
