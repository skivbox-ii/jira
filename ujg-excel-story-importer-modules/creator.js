define("_ujgESI_creator", ["_ujgESI_config", "_ujgESI_description", "_ujgESI_remarkId"], function(config, description, remarkId) {
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
    var max = Number(config.SUMMARY_MAX_LENGTH) || 255;
    var text = value != null ? String(value).trim() : "";
    return text.length > max ? text.slice(0, max) : text;
  }

  function sourceValue(row, name) {
    var cols = row && row.sourceColumns ? row.sourceColumns : {};
    return cols && cols[name] != null ? String(cols[name]).trim() : "";
  }

  function summaryWithRemarkId(row, summary, childRole) {
    var id = remarkId(row);
    var text = summary != null ? String(summary).trim() : "";
    var role = text.match(/^\[([^\]]+)\]\s*/);
    var prefix = "";
    if (!id || !text) return limitSummary(text);
    if (childRole && childRole.role && (!role || role[1] === id)) {
      text = childSummary(childRole, text);
      role = text.match(/^\[([^\]]+)\]\s*/);
    }
    if (role && role[1] !== id) {
      prefix = role[0].trim() + " ";
      text = text.slice(role[0].length);
    }
    var escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    var existing = new RegExp("^(?:(?:№|#)\\s*)?" + escaped + "(?=$|\\s|[.):;\\-](?:\\s|$))|^\\[" + escaped + "\\](?=$|\\s)");
    return limitSummary(prefix + (existing.test(text) ? text : "№" + id + (text ? " " + text : "")));
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
      summary: summaryWithRemarkId(row, opts.summary != null ? opts.summary : row && row.summary != null ? row.summary : ""),
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
      description: role && role.description != null && String(role.description).trim() ? String(role.description) : "Создано автоматически из журнала замечаний.",
    };
    appendAssignee(fields, role && role.assignee);
    appendTimetracking(fields, role && role.originalEstimate, role && role.remainingEstimate);
    return fields;
  }

  function normalizeLinkText(value) {
    return String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  }

  function looksLikeChildRelation(value) {
    var text = normalizeLinkText(value);
    if (looksLikeParentRelation(value)) return false;
    return text === "child" ||
      text === "is_child" ||
      text === "child_of" ||
      text === "is_child_of" ||
      text.indexOf("child") !== -1 ||
      text.indexOf("дочер") !== -1;
  }

  function looksLikeParentRelation(value) {
    var text = normalizeLinkText(value);
    return text === "has_child" ||
      text === "has_children" ||
      text === "parent" ||
      text === "is_parent" ||
      text === "parent_of" ||
      text === "is_parent_of" ||
      text.indexOf("parent") !== -1 ||
      text.indexOf("родител") !== -1;
  }

  function defaultChildLinkType() {
    return {
      name: String(config.CHILD_LINK_TYPE_NAME || "Child"),
      parentOutward: true,
    };
  }

  function issueLinkTypes(data) {
    if (Array.isArray(data)) return data;
    return data && Array.isArray(data.issueLinkTypes) ? data.issueLinkTypes : [];
  }

  function scoreChildLinkType(type, configured) {
    var name = normalizeLinkText(type && type.name);
    var outward = type && type.outward;
    var inward = type && type.inward;
    var outwardChild = looksLikeChildRelation(outward);
    var inwardChild = looksLikeChildRelation(inward);
    var outwardParent = looksLikeParentRelation(outward);
    var inwardParent = looksLikeParentRelation(inward);

    var score = 0, parentOutward = true;
    // The issue view uses the OTHER endpoint's label: an outward parent label
    // requires the Story in inwardIssue and the child in outwardIssue.
    if (outwardParent && inwardChild) { score = 90; parentOutward = false; }
    else if (outwardChild && inwardParent) { score = 90; parentOutward = true; }
    else if (inwardChild || outwardParent) { score = 80; parentOutward = false; }
    else if (outwardChild || inwardParent) { score = 80; parentOutward = true; }
    if (name && name === configured) score = 100;
    return { score: score, parentOutward: parentOutward };
  }

  function pickChildLinkType(data) {
    var configured = normalizeLinkText(config.CHILD_LINK_TYPE_NAME || "Child");
    var best = null;
    issueLinkTypes(data).forEach(function(type) {
      var scored = scoreChildLinkType(type, configured);
      if (!scored.score || !type || !type.name) return;
      if (!best || scored.score > best.score) {
        best = {
          name: String(type.name),
          parentOutward: scored.parentOutward,
          score: scored.score,
        };
      }
    });
    return best || defaultChildLinkType();
  }

  function resolveChildLinkType(api) {
    if (!api || typeof api.getIssueLinkTypes !== "function") {
      return Promise.resolve(defaultChildLinkType());
    }
    return Promise.resolve(api.getIssueLinkTypes()).then(
      function(data) {
        return pickChildLinkType(data);
      },
      function() {
        return defaultChildLinkType();
      }
    );
  }

  function childLinkPayload(parentKey, childKey, linkType) {
    var type = linkType || defaultChildLinkType();
    var parentOutward = type.parentOutward !== false;
    return {
      type: { name: String(type.name || config.CHILD_LINK_TYPE_NAME || "Child") },
      outwardIssue: { key: String(parentOutward ? parentKey || "" : childKey || "") },
      inwardIssue: { key: String(parentOutward ? childKey || "" : parentKey || "") },
    };
  }

  function blocksLinkPayload(blockerKey, blockedKey) {
    return {
      type: { name: String(config.BLOCKS_LINK_TYPE_NAME || "Blocks") },
      outwardIssue: { key: String(blockedKey || "") },
      inwardIssue: { key: String(blockerKey || "") },
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
    return Promise.resolve().then(function() {
      return api.createIssueLink(payload);
    }).then(
      function() {
        return { ok: true };
      },
      function(err) {
        return { ok: false, error: ajaxErrorText(err) };
      }
    );
  }

  function linkChildIssue(api, parentKey, childKey, linkType) {
    return linkIssue(api, childLinkPayload(parentKey, childKey, linkType));
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

  function linkTestingTasksBlockedBy(api, created, index, errors, existingBlockers) {
    var testing;
    var blockers;
    if (index >= created.length) {
      return Promise.resolve({ ok: errors.length === 0, errors: errors });
    }
    testing = created[index];
    if (!isTestingRole(testing && testing.role) || testing.linkedToParent === false) {
      return linkTestingTasksBlockedBy(api, created, index + 1, errors, existingBlockers);
    }
    var seen = {};
    blockers = created.concat(existingBlockers || []).filter(function(child) {
      if (!child || !child.key || child.linkedToParent === false || child.key === testing.key || isTestingRole(child.role) || seen[child.key]) return false;
      seen[child.key] = true;
      return true;
    });
    return linkTestingBlockedBySequential(api, testing, blockers, 0, errors).then(function() {
      return linkTestingTasksBlockedBy(api, created, index + 1, errors, existingBlockers);
    });
  }

  function preparedRoles(row, storySummary, tasks) {
    return tasks.filter(function(role) {
      return role && role.enabled !== false;
    }).map(function(role) {
      var out = {};
      Object.keys(role).forEach(function(name) { out[name] = role[name]; });
      out.summary = summaryWithRemarkId(row, out.summary != null ? out.summary : childSummary(role, storySummary), role);
      return out;
    });
  }

  function publicCreatedChildren(created) {
    return (created || []).map(function(child) {
      var fields = child.fields || {};
      var out = {
        key: child.key,
        role: child.role.role,
        summary: fields.summary,
        description: fields.description,
        issueType: fields.issuetype && fields.issuetype.name,
        linkedToParent: child.linkedToParent === true,
      };
      if (child.linkError) out.linkError = child.linkError;
      if (child.role.enabled != null) out.enabled = child.role.enabled;
      if (child.role.assignee != null) out.assignee = child.role.assignee;
      if (child.role.originalEstimate != null) out.originalEstimate = child.role.originalEstimate;
      if (child.role.remainingEstimate != null) out.remainingEstimate = child.role.remainingEstimate;
      return out;
    });
  }

  function knownExistingChildren(row, parentKey) {
    var created = row && Array.isArray(row.createdChildren) ? row.createdChildren : [];
    var synced = row && String(row.jiraKey || "").trim() === parentKey && Array.isArray(row.childStatuses) ? row.childStatuses : [];
    return created.concat(synced).filter(function(child) {
      return child && createdKey(child) && child.role && child.linkedToParent !== false;
    }).map(function(child) {
      return { key: createdKey(child), role: typeof child.role === "object" ? child.role : { role: child.role } };
    });
  }

  function createSubtasksSequential(api, projectKey, parentKey, storySummary, roles, index, errors, created, childLinkType) {
    created = created || [];
    if (index >= roles.length) {
      return Promise.resolve({ ok: errors.length === 0, errors: errors, created: created });
    }
    var fields = subtaskFields(projectKey, parentKey, roles[index], storySummary);
    return Promise.resolve().then(function() {
      return api.createIssue({ fields: fields });
    }).then(
      function(res) {
        var key = createdKey(res);
        if (!key) {
          errors.push("Subtask response missing issue key: " + roles[index].role);
          return createSubtasksSequential(api, projectKey, parentKey, storySummary, roles, index + 1, errors, created, childLinkType);
        }
        var child = { key: key, role: roles[index], fields: fields, linkedToParent: false };
        created.push(child);
        return linkChildIssue(api, parentKey, key, childLinkType).then(function(link) {
          child.linkedToParent = link.ok;
          if (!link.ok) {
            child.linkError = link.error;
            errors.push(roles[index].role + " link: " + link.error);
          }
          return createSubtasksSequential(api, projectKey, parentKey, storySummary, roles, index + 1, errors, created, childLinkType);
        });
      },
      function(err) {
        errors.push(roles[index].role + ": " + ajaxErrorText(err));
        return createSubtasksSequential(api, projectKey, parentKey, storySummary, roles, index + 1, errors, created, childLinkType);
      }
    );
  }

  function createAdditionalTasks(api, row, options) {
    var opts = options || {};
    var parentKey = row && createdKey({ key: row.createdKey || row.jiraKey });
    var tasks = Array.isArray(opts.childTasks) ? opts.childTasks : [];
    var errors = [];
    if (!parentKey) errors.push("Existing Story parent key is required");
    if (!String(opts.projectKey || "").trim()) errors.push("Project key is required");
    if (!tasks.some(function(role) { return role && role.enabled !== false; })) errors.push("At least one enabled child task is required");
    if (!api || typeof api.createIssue !== "function") errors.push("Jira API is not available");
    if (errors.length) return Promise.resolve({ ok: false, partial: false, createdKey: parentKey || "", createdChildren: [], errors: errors });

    var storySummary = summaryWithRemarkId(row, opts.summary != null ? opts.summary : row && row.summary);
    var roles = preparedRoles(row, storySummary, tasks);
    return resolveChildLinkType(api).then(function(childLinkType) {
      return createSubtasksSequential(api, opts.projectKey, parentKey, storySummary, roles, 0, [], [], childLinkType);
    }).then(function(sub) {
      return linkTestingTasksBlockedBy(api, sub.created, 0, sub.errors, knownExistingChildren(row, parentKey)).then(function() {
        return {
          ok: sub.errors.length === 0,
          partial: sub.errors.length > 0 && sub.created.length > 0,
          createdKey: parentKey,
          createdChildren: publicCreatedChildren(sub.created),
          errors: sub.errors,
        };
      });
    });
  }

  function createRow(api, row, options) {
    var opts = options || {};
    if (row && (row.alreadyLinked || row.jiraKey || row.createdKey)) {
      return Promise.resolve({ ok: true, skipped: true, createdKey: row.createdKey || row.jiraKey || "", createdChildren: [] });
    }
    if (!api || typeof api.createIssue !== "function") {
      return Promise.resolve({ ok: false, errors: ["Jira API is not available"] });
    }
    function finishStory(res, warnings, epicLinkSkipped) {
      var key = createdKey(res);
      warnings = warnings || [];
      if (!key) return { ok: false, errors: warnings.concat(["Story response missing issue key"]) };
      if (!opts.createSubtasks) return { ok: true, createdKey: key, createdChildren: [], errors: warnings, epicLinkSkipped: !!epicLinkSkipped };
      var storySummary = summaryWithRemarkId(row, opts.summary != null ? opts.summary : row && row.summary);
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
      roles = preparedRoles(row, storySummary, roles);
      return resolveChildLinkType(api).then(function(childLinkType) {
        return createSubtasksSequential(api, opts.projectKey, key, storySummary, roles, 0, [], [], childLinkType).then(function(sub) {
          return linkTestingTasksBlockedBy(api, sub.created || [], 0, sub.errors || []).then(function(linked) {
            linked.created = sub.created;
            return linked;
          });
        });
      }).then(function(sub) {
        return {
          ok: sub.errors.length === 0,
          partial: sub.errors.length > 0,
          createdKey: key,
          createdChildren: publicCreatedChildren(sub.created),
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
    createAdditionalTasks: createAdditionalTasks,
    storyFields: storyFields,
    subtaskFields: subtaskFields,
    childSummary: childSummary,
    limitSummary: limitSummary,
    summaryWithRemarkId: summaryWithRemarkId,
    childLinkPayload: childLinkPayload,
    pickChildLinkType: pickChildLinkType,
    blocksLinkPayload: blocksLinkPayload,
    isTestingRole: isTestingRole,
    lookupMappedValue: lookupMappedValue,
  };
});
