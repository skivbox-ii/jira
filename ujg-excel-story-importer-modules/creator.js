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

  function sourceValue(row, name) {
    var cols = row && row.sourceColumns ? row.sourceColumns : {};
    return cols && cols[name] != null ? String(cols[name]).trim() : "";
  }

  function normalizedKey(value) {
    return String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
  }

  function lookupMappedValue(map, value, fallbackToInput) {
    var raw = String(value || "").trim();
    var key = normalizedKey(raw);
    var name;
    if (!key) return "";
    map = map || {};
    for (name in map) {
      if (Object.prototype.hasOwnProperty.call(map, name) && normalizedKey(name) === key) {
        return String(map[name]).trim();
      }
    }
    return fallbackToInput ? raw : "";
  }

  function appendComponent(fields, row) {
    var component = lookupMappedValue(config.MODULE_COMPONENT_MAP, sourceValue(row, "Модуль"), true);
    if (component) fields.components = [{ name: component }];
  }

  function appendPriority(fields, row) {
    var priority = lookupMappedValue(config.PRIORITY_MAP, sourceValue(row, "Приоритет"), false);
    if (priority) fields.priority = { name: priority };
  }

  function storyFields(row, options) {
    var opts = options || {};
    var fields = {
      project: { key: String(opts.projectKey || "") },
      summary: String(opts.summary != null ? opts.summary : row && row.summary != null ? row.summary : "").trim(),
      issuetype: { name: String(opts.issueType || config.STORY_ISSUE_TYPE) },
      description: opts.sourceRows ? description.buildDescriptionFromRows(opts.sourceRows) : description.buildDescription(row),
    };
    if (opts.epicKey && config.EPIC_LINK_FIELD) {
      fields[config.EPIC_LINK_FIELD] = String(opts.epicKey);
    }
    appendComponent(fields, row);
    appendPriority(fields, row);
    appendAssignee(fields, opts.assignee);
    appendTimetracking(fields, opts.originalEstimate, opts.remainingEstimate);
    return fields;
  }

  function appendAssignee(fields, assignee) {
    if (!fields || !assignee || typeof assignee !== "object") return;
    if (assignee.accountId != null && String(assignee.accountId).trim()) {
      fields.assignee = { accountId: String(assignee.accountId).trim() };
    } else if (assignee.name != null && String(assignee.name).trim()) {
      fields.assignee = { name: String(assignee.name).trim() };
    }
  }

  function appendTimetracking(fields, originalEstimate, remainingEstimate) {
    var original = originalEstimate != null ? String(originalEstimate).trim() : "";
    var remaining = remainingEstimate != null ? String(remainingEstimate).trim() : "";
    if (!fields || (!original && !remaining)) return;
    fields.timetracking = {};
    if (original) fields.timetracking.originalEstimate = original;
    if (remaining) fields.timetracking.remainingEstimate = remaining;
  }

  function childSummary(role, storySummary) {
    var prefix = role && role.role != null ? String(role.role).trim() : "";
    var summary = storySummary != null ? String(storySummary).trim() : "";
    return (prefix ? "[" + prefix + "] " : "") + summary;
  }

  function subtaskFields(projectKey, parentKey, role, storySummary) {
    var fields = {
      project: { key: String(projectKey || "") },
      summary: String(role && role.summary != null ? role.summary : childSummary(role, storySummary)),
      issuetype: { name: String((role && role.issueType) || "") },
      description: "Создано автоматически из журнала замечаний.",
    };
    appendAssignee(fields, role && role.assignee);
    appendTimetracking(fields, role && role.originalEstimate, role && role.remainingEstimate);
    return fields;
  }

  function childLinkPayload(parentKey, childKey) {
    return {
      type: { name: String(config.CHILD_LINK_TYPE_NAME || "Child") },
      outwardIssue: { key: String(parentKey || "") },
      inwardIssue: { key: String(childKey || "") },
    };
  }

  function linkChildIssue(api, parentKey, childKey) {
    if (!api || typeof api.createIssueLink !== "function") {
      return Promise.resolve({ ok: false, error: "Jira issue link API is not available" });
    }
    return Promise.resolve(api.createIssueLink(childLinkPayload(parentKey, childKey))).then(
      function() {
        return { ok: true };
      },
      function(err) {
        return { ok: false, error: ajaxErrorText(err) };
      }
    );
  }

  function createSubtasksSequential(api, projectKey, parentKey, storySummary, roles, index, errors) {
    if (index >= roles.length) {
      return Promise.resolve({ ok: errors.length === 0, errors: errors });
    }
    return Promise.resolve(api.createIssue({ fields: subtaskFields(projectKey, parentKey, roles[index], storySummary) })).then(
      function(res) {
        var key = createdKey(res);
        if (!key) {
          errors.push("Subtask response missing issue key: " + roles[index].role);
          return createSubtasksSequential(api, projectKey, parentKey, storySummary, roles, index + 1, errors);
        }
        return linkChildIssue(api, parentKey, key).then(function(link) {
          if (!link.ok) errors.push(roles[index].role + " link: " + link.error);
          return createSubtasksSequential(api, projectKey, parentKey, storySummary, roles, index + 1, errors);
        });
      },
      function(err) {
        errors.push(roles[index].role + ": " + ajaxErrorText(err));
        return createSubtasksSequential(api, projectKey, parentKey, storySummary, roles, index + 1, errors);
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
        var storySummary = opts.summary != null ? opts.summary : row && row.summary;
        var roles = Array.isArray(opts.childTasks)
          ? opts.childTasks
          : (config.CREATE_TEMPLATE_ROLES || []).map(function(role) {
              var out = {};
              Object.keys(role || {}).forEach(function(name) {
                out[name] = role[name];
              });
              out.summary = childSummary(role, storySummary);
              return out;
            });
        roles = roles.filter(function(role) {
          return !role || role.enabled !== false;
        });
        return createSubtasksSequential(api, opts.projectKey, key, storySummary, roles, 0, []).then(function(sub) {
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
    childSummary: childSummary,
    childLinkPayload: childLinkPayload,
    lookupMappedValue: lookupMappedValue,
  };
});
