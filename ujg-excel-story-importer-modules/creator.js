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
      fields[config.EPIC_LINK_FIELD] = String(opts.epicKey);
    }
    return fields;
  }

  function childSummary(role, storySummary) {
    var prefix = role && role.role != null ? String(role.role).trim() : "";
    var summary = storySummary != null ? String(storySummary).trim() : "";
    return (prefix ? "[" + prefix + "] " : "") + summary;
  }

  function subtaskFields(projectKey, parentKey, role, storySummary) {
    return {
      project: { key: String(projectKey || "") },
      summary: childSummary(role, storySummary),
      issuetype: { name: String((role && role.issueType) || "") },
      description: "Создано автоматически из журнала замечаний.",
    };
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

  function createSubtasksSequential(api, projectKey, parentKey, storySummary, index, errors) {
    var roles = config.CREATE_TEMPLATE_ROLES || [];
    if (index >= roles.length) {
      return Promise.resolve({ ok: errors.length === 0, errors: errors });
    }
    return Promise.resolve(api.createIssue({ fields: subtaskFields(projectKey, parentKey, roles[index], storySummary) })).then(
      function(res) {
        var key = createdKey(res);
        if (!key) {
          errors.push("Subtask response missing issue key: " + roles[index].role);
          return createSubtasksSequential(api, projectKey, parentKey, storySummary, index + 1, errors);
        }
        return linkChildIssue(api, parentKey, key).then(function(link) {
          if (!link.ok) errors.push(roles[index].role + " link: " + link.error);
          return createSubtasksSequential(api, projectKey, parentKey, storySummary, index + 1, errors);
        });
      },
      function(err) {
        errors.push(roles[index].role + ": " + ajaxErrorText(err));
        return createSubtasksSequential(api, projectKey, parentKey, storySummary, index + 1, errors);
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
        return createSubtasksSequential(api, opts.projectKey, key, row && row.summary, 0, []).then(function(sub) {
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
  };
});
