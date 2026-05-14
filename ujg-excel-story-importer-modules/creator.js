define("_ujgESI_creator", ["_ujgESI_config", "_ujgESI_description"], function(config, description) {
  "use strict";

  function ajaxErrorText(err) {
    if (!err) return "Request failed";
    if (err.responseJSON && err.responseJSON.errorMessages && err.responseJSON.errorMessages.length) {
      return err.responseJSON.errorMessages.join(" ");
    }
    if (err.responseJSON && err.responseJSON.errors) {
      var parts = [];
      Object.keys(err.responseJSON.errors).forEach(function(name) {
        if (err.responseJSON.errors[name]) parts.push(String(err.responseJSON.errors[name]));
      });
      if (parts.length) return parts.join(" ");
    }
    if (err.statusText) return String(err.statusText);
    if (err.message) return String(err.message);
    return "Request failed";
  }

  function createdKey(res) {
    return res && res.key != null ? String(res.key).trim() : "";
  }

  function limitSummary(value) {
    var max = Number(config.SUMMARY_MAX_LENGTH) || 250;
    var text = value != null ? String(value).trim() : "";
    return text.length > max ? text.slice(0, max) : text;
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

  function mappingMap(options, name, fallback) {
    var mappings = options && options.mappings && typeof options.mappings === "object" ? options.mappings : {};
    var map = mappings && mappings[name] && typeof mappings[name] === "object" ? mappings[name] : null;
    return map || fallback || {};
  }

  function epicLinkValue(epicKey) {
    var key = epicKey != null ? String(epicKey).trim() : "";
    if (!key) return "";
    return key.replace(/^key:/i, "").trim();
  }

  function appendComponent(fields, row, options) {
    var component = lookupMappedValue(mappingMap(options, "moduleComponentMap", config.MODULE_COMPONENT_MAP), sourceValue(row, "Модуль"), false);
    if (component) fields.components = [{ name: component }];
  }

  function appendPriority(fields, row, options) {
    var priority = lookupMappedValue(mappingMap(options, "priorityMap", config.PRIORITY_MAP), sourceValue(row, "Приоритет"), false);
    if (priority) fields.priority = { name: priority };
  }

  function storyFields(row, options) {
    var opts = options || {};
    var fields = {
      project: { key: String(opts.projectKey || "") },
      summary: limitSummary(opts.summary != null ? opts.summary : row && row.summary != null ? row.summary : ""),
      issuetype: { name: String(opts.issueType || config.STORY_ISSUE_TYPE) },
      description: opts.sourceRows ? description.buildDescriptionFromRows(opts.sourceRows) : description.buildDescription(row),
    };
    if (opts.epicKey && config.EPIC_LINK_FIELD && opts.omitEpicLink !== true && opts.epicLinkAllowed !== false) {
      fields[config.EPIC_LINK_FIELD] = epicLinkValue(opts.epicKey);
    }
    appendComponent(fields, row, opts);
    appendPriority(fields, row, opts);
    appendAssignee(fields, opts.assignee);
    appendTimetracking(fields, opts.originalEstimate, opts.remainingEstimate);
    return fields;
  }

  function epicLinkRejected(err) {
    var field = config.EPIC_LINK_FIELD;
    var errors = err && err.responseJSON && err.responseJSON.errors ? err.responseJSON.errors : {};
    return !!(field && errors && Object.prototype.hasOwnProperty.call(errors, field));
  }

  function withoutEpicLinkOptions(opts) {
    var out = {};
    Object.keys(opts || {}).forEach(function(key) {
      out[key] = opts[key];
    });
    out.omitEpicLink = true;
    return out;
  }

  function epicSkippedWarning(epicKey) {
    return "Epic " + String(epicKey || "") + " не установлен: Jira не разрешила поле " + String(config.EPIC_LINK_FIELD || "Epic Link") + " для этого типа задачи.";
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
    return limitSummary((prefix ? "[" + prefix + "] " : "") + summary);
  }

  function subtaskFields(projectKey, parentKey, role, storySummary) {
    var fields = {
      project: { key: String(projectKey || "") },
      summary: limitSummary(role && role.summary != null ? role.summary : childSummary(role, storySummary)),
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

  function blocksLinkPayload(blockerKey, blockedKey) {
    return {
      type: { name: String(config.BLOCKS_LINK_TYPE_NAME || "Blocks") },
      outwardIssue: { key: String(blockerKey || "") },
      inwardIssue: { key: String(blockedKey || "") },
    };
  }

  function isTestingRole(role) {
    var roleText = normalizedKey(
      [
        role && role.role,
        role && role.issueType,
      ].join(" ")
    );
    var summary = normalizedKey(role && role.summary);
    return /(^|\s)(qa|test|testing)(\s|$)/.test(roleText) ||
      roleText.indexOf("тест") !== -1 ||
      /^\s*\[(qa|test|testing)\]/.test(summary) ||
      /^тест/.test(summary);
  }

  function linkIssue(api, payload) {
    if (!api || typeof api.createIssueLink !== "function") {
      return Promise.resolve({ ok: false, error: "Jira issue link API is not available" });
    }
    return Promise.resolve(api.createIssueLink(payload)).then(
      function() {
        return { ok: true };
      },
      function(err) {
        return { ok: false, error: ajaxErrorText(err) };
      }
    );
  }

  function linkChildIssue(api, parentKey, childKey) {
    return linkIssue(api, childLinkPayload(parentKey, childKey));
  }

  function linkBlockedByIssue(api, blockerKey, blockedKey) {
    return linkIssue(api, blocksLinkPayload(blockerKey, blockedKey));
  }

  function linkTestingBlockedBySequential(api, testing, blockers, index, errors) {
    var testingRole = testing && testing.role && testing.role.role ? String(testing.role.role) : "QA";
    var blockerRole;
    if (!testing || index >= blockers.length) {
      return Promise.resolve({ ok: errors.length === 0, errors: errors });
    }
    blockerRole = blockers[index] && blockers[index].role && blockers[index].role.role ? String(blockers[index].role.role) : "child";
    return linkBlockedByIssue(api, blockers[index].key, testing.key).then(function(link) {
      if (!link.ok) errors.push(testingRole + " blocked by " + blockerRole + ": " + link.error);
      return linkTestingBlockedBySequential(api, testing, blockers, index + 1, errors);
    });
  }

  function linkTestingTasksBlockedBy(api, created, index, errors) {
    var testing;
    var blockers;
    if (index >= created.length) {
      return Promise.resolve({ ok: errors.length === 0, errors: errors });
    }
    testing = created[index];
    if (!isTestingRole(testing && testing.role)) {
      return linkTestingTasksBlockedBy(api, created, index + 1, errors);
    }
    blockers = created.filter(function(child) {
      return child && child.key && child.key !== testing.key && !isTestingRole(child.role);
    });
    return linkTestingBlockedBySequential(api, testing, blockers, 0, errors).then(function() {
      return linkTestingTasksBlockedBy(api, created, index + 1, errors);
    });
  }

  function createSubtasksSequential(api, projectKey, parentKey, storySummary, roles, index, errors, created) {
    created = created || [];
    if (index >= roles.length) {
      return Promise.resolve({ ok: errors.length === 0, errors: errors, created: created });
    }
    return Promise.resolve(api.createIssue({ fields: subtaskFields(projectKey, parentKey, roles[index], storySummary) })).then(
      function(res) {
        var key = createdKey(res);
        if (!key) {
          errors.push("Subtask response missing issue key: " + roles[index].role);
          return createSubtasksSequential(api, projectKey, parentKey, storySummary, roles, index + 1, errors, created);
        }
        created.push({ key: key, role: roles[index] });
        return linkChildIssue(api, parentKey, key).then(function(link) {
          if (!link.ok) errors.push(roles[index].role + " link: " + link.error);
          return createSubtasksSequential(api, projectKey, parentKey, storySummary, roles, index + 1, errors, created);
        });
      },
      function(err) {
        errors.push(roles[index].role + ": " + ajaxErrorText(err));
        return createSubtasksSequential(api, projectKey, parentKey, storySummary, roles, index + 1, errors, created);
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
    function finishStory(res, warnings, epicLinkSkipped) {
      var key = createdKey(res);
      warnings = warnings || [];
      if (!key) return { ok: false, errors: warnings.concat(["Story response missing issue key"]) };
      if (!opts.createSubtasks) return { ok: true, createdKey: key, errors: warnings, epicLinkSkipped: !!epicLinkSkipped };
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
      return createSubtasksSequential(api, opts.projectKey, key, storySummary, roles, 0, [], []).then(function(sub) {
        return linkTestingTasksBlockedBy(api, sub.created || [], 0, sub.errors || []).then(function(linked) {
          return linked;
        });
      }).then(function(sub) {
        return {
          ok: sub.errors.length === 0,
          partial: sub.errors.length > 0,
          createdKey: key,
          errors: warnings.concat(sub.errors),
          epicLinkSkipped: !!epicLinkSkipped,
        };
      });
    }

    return Promise.resolve(api.createIssue({ fields: storyFields(row, opts) })).then(
      function(res) {
        return finishStory(res, [], false);
      },
      function(err) {
        if (opts.epicKey && opts.omitEpicLink !== true && epicLinkRejected(err)) {
          return Promise.resolve(api.createIssue({ fields: storyFields(row, withoutEpicLinkOptions(opts)) })).then(
            function(res) {
              return finishStory(res, [epicSkippedWarning(opts.epicKey)], true);
            },
            function(retryErr) {
              return { ok: false, errors: [ajaxErrorText(retryErr)] };
            }
          );
        }
        return { ok: false, errors: [ajaxErrorText(err)] };
      }
    );
  }

  return {
    createRow: createRow,
    storyFields: storyFields,
    subtaskFields: subtaskFields,
    childSummary: childSummary,
    limitSummary: limitSummary,
    childLinkPayload: childLinkPayload,
    blocksLinkPayload: blocksLinkPayload,
    isTestingRole: isTestingRole,
    lookupMappedValue: lookupMappedValue,
  };
});
