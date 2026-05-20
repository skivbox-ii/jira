define("_ujgESI_main", [
  "jquery",
  "_ujgESI_config",
  "_ujgESI_api",
  "_ujgESI_excel-loader",
  "_ujgESI_parser",
  "_ujgESI_creator",
  "_ujgESI_mappingStore",
  "_ujgESI_xlsxPatcher",
  "_ujgESI_rendering",
], function($, config, api, excelLoader, parser, creator, mappingStore, xlsxPatcher, rendering) {
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

  function normalizeIssues(data) {
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

  function copyMap(map) {
    var out = {};
    Object.keys(map || {}).forEach(function(key) {
      var source = key != null ? String(key).trim() : "";
      var target = map[key] != null ? String(map[key]).trim() : "";
      if (source || target) out[source] = target;
    });
    return out;
  }

  function copyAssignee(user) {
    var source = user && typeof user === "object" ? user : null;
    var out = {};
    if (!source) return null;
    ["accountId", "name", "key", "displayName"].forEach(function(field) {
      if (source[field] != null && String(source[field]).trim()) out[field] = String(source[field]).trim();
    });
    return Object.keys(out).length ? out : null;
  }

  function copyRoles(roles) {
    return (Array.isArray(roles) ? roles : []).map(function(role) {
      return {
        enabled: !(role && role.enabled === false),
        role: role && role.role != null ? String(role.role) : "",
        issueType: role && role.issueType != null ? String(role.issueType) : "",
        originalEstimate: role && role.originalEstimate != null ? String(role.originalEstimate) : "1h",
        remainingEstimate: role && role.remainingEstimate != null ? String(role.remainingEstimate) : "1h",
        assigneeId: role && role.assigneeId != null ? String(role.assigneeId) : "",
        assigneeLabel: role && role.assigneeLabel != null ? String(role.assigneeLabel) : "",
        assignee: copyAssignee(role && role.assignee),
      };
    });
  }

  function copyColumnMap(map) {
    var defaults = config.COLUMN_MAP || {};
    var source = map && typeof map === "object" ? map : {};
    var out = {};
    Object.keys(defaults).forEach(function(key) {
      var value = source[key] != null ? String(source[key]).trim() : "";
      out[key] = value || String(defaults[key] || "").trim();
    });
    Object.keys(source).forEach(function(key) {
      if (!Object.prototype.hasOwnProperty.call(out, key)) out[key] = source[key] != null ? String(source[key]).trim() : "";
    });
    return out;
  }

  function copyTableStart(input) {
    var defaults = config.TABLE_START || {};
    var source = input && typeof input === "object" ? input : {};
    return {
      headerMarker: source.headerMarker != null && String(source.headerMarker).trim()
        ? String(source.headerMarker).trim()
        : String(defaults.headerMarker || config.SUMMARY_COLUMN || "Замечание").trim(),
    };
  }

  function copySheetName(value) {
    return value != null ? String(value).trim() : "";
  }

  function defaultMappingSettings() {
    if (mappingStore && typeof mappingStore.defaultSettings === "function") {
      return mappingStore.defaultSettings();
    }
    return {
      moduleComponentMap: copyMap(config.MODULE_COMPONENT_MAP),
      priorityMap: copyMap(config.PRIORITY_MAP),
      columnMap: copyColumnMap(config.COLUMN_MAP),
      tableStart: copyTableStart(config.TABLE_START),
      sheetName: copySheetName(config.SHEET_NAME),
      storyAssigneeId: "",
      storyAssigneeLabel: "",
      storyAssignee: null,
      roles: copyRoles(config.CREATE_TEMPLATE_ROLES),
    };
  }

  function normalizeMappingSettings(input) {
    if (mappingStore && typeof mappingStore.normalizeSettings === "function") {
      return mappingStore.normalizeSettings(input);
    }
    var defaults = defaultMappingSettings();
    var source = input && typeof input === "object" ? input : {};
    return {
      moduleComponentMap: source.moduleComponentMap && typeof source.moduleComponentMap === "object"
        ? copyMap(source.moduleComponentMap)
        : copyMap(defaults.moduleComponentMap),
      priorityMap: source.priorityMap && typeof source.priorityMap === "object"
        ? copyMap(source.priorityMap)
        : copyMap(defaults.priorityMap),
      columnMap: source.columnMap && typeof source.columnMap === "object"
        ? copyColumnMap(source.columnMap)
        : copyColumnMap(defaults.columnMap),
      tableStart: source.tableStart && typeof source.tableStart === "object"
        ? copyTableStart(source.tableStart)
        : copyTableStart(defaults.tableStart),
      sheetName: source.sheetName != null ? copySheetName(source.sheetName) : copySheetName(defaults.sheetName),
      storyAssigneeId: source.storyAssigneeId != null ? String(source.storyAssigneeId).trim() : defaults.storyAssigneeId,
      storyAssigneeLabel: source.storyAssigneeLabel != null ? String(source.storyAssigneeLabel).trim() : defaults.storyAssigneeLabel,
      storyAssignee: source.storyAssignee != null ? copyAssignee(source.storyAssignee) : defaults.storyAssignee,
      roles: Array.isArray(source.roles) ? copyRoles(source.roles) : copyRoles(defaults.roles),
    };
  }

  function mappingEntries(map) {
    return Object.keys(map || {}).map(function(key) {
      return { excel: key, jira: map[key] };
    });
  }

  function mapFromEntries(entries) {
    var out = {};
    (entries || []).forEach(function(entry) {
      var excel = entry && entry.excel != null ? String(entry.excel) : "";
      var jira = entry && entry.jira != null ? String(entry.jira) : "";
      if (excel || jira) out[excel] = jira;
    });
    return out;
  }

  function defaultPriorityOptions() {
    var seen = {};
    var out = [];
    Object.keys(config.PRIORITY_MAP || {}).forEach(function(key) {
      var name = config.PRIORITY_MAP[key] != null ? String(config.PRIORITY_MAP[key]).trim() : "";
      if (!name || seen[name]) return;
      seen[name] = true;
      out.push({ name: name });
    });
    return out;
  }

  function priorityOptionsFromCreateMeta(data) {
    var seen = {};
    var out = [];
    (data && Array.isArray(data.projects) ? data.projects : []).forEach(function(project) {
      (project && Array.isArray(project.issuetypes) ? project.issuetypes : []).forEach(function(issueType) {
        var field = issueType && issueType.fields && issueType.fields.priority ? issueType.fields.priority : null;
        (field && Array.isArray(field.allowedValues) ? field.allowedValues : []).forEach(function(priority) {
          var name = priority && priority.name != null ? String(priority.name).trim() : "";
          if (!name || seen[name]) return;
          seen[name] = true;
          out.push({ name: name });
        });
      });
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

  function stateStorageKey() {
    return config && config.STORAGE_KEY ? String(config.STORAGE_KEY) : "ujg-esi-state";
  }

  function readStoredState() {
    if (typeof localStorage === "undefined") return {};
    try {
      var raw = localStorage.getItem(stateStorageKey());
      if (!raw) return {};
      var parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (err) {
      return {};
    }
  }

  function readStoredProjectKey() {
    var stored = readStoredState();
    var key = stored.projectKey != null ? stored.projectKey : stored.project;
    return key != null ? String(key).trim() : "";
  }

  function writeStoredProjectKey(projectKey) {
    if (typeof localStorage === "undefined") return;
    try {
      var key = projectKey != null ? String(projectKey).trim() : "";
      var stored = readStoredState();
      if (key) stored.projectKey = key;
      else delete stored.projectKey;
      localStorage.setItem(stateStorageKey(), JSON.stringify(stored));
    } catch (err) {
      // Dashboard storage is best-effort; failing to persist must not block import.
    }
  }

  function syncedFileName(name) {
    var text = name != null ? String(name).trim() : "";
    if (!text) return "jira-status.synced.xlsx";
    if (/\.(xlsx|xlsm|xls)$/i.test(text)) return text.replace(/\.(xlsx|xlsm|xls)$/i, ".synced.xlsx");
    return text + ".synced.xlsx";
  }

  function nonBlank(value) {
    return value != null && String(value).trim() !== "";
  }

  function jiraColumnName() {
    return config && config.JIRA_COLUMN ? String(config.JIRA_COLUMN) : "Jira";
  }

  function summarySearchText(value) {
    var candidates = summarySearchCandidates(value);
    return candidates.length ? candidates[0] : "";
  }

  function summarySearchWords(value) {
    var words = String(value || "")
      .replace(/[\r\n\t]+/g, " ")
      .replace(/[^\w\u0400-\u04FF-]+/g, " ")
      .split(/\s+/)
      .map(function(word) { return String(word || "").trim(); })
      .filter(function(word) { return word.length >= 3; });
    return words;
  }

  function summarySearchCandidates(value) {
    var seenWords = {};
    var words = summarySearchWords(value).filter(function(word) {
      var key = word.toLowerCase();
      if (seenWords[key]) return false;
      seenWords[key] = true;
      return true;
    });
    var sizes = [10, 6, 4, 3];
    var seen = {};
    var out = [];
    sizes.forEach(function(size) {
      var text = words.slice(0, size).join(" ");
      if (!text || seen[text]) return;
      seen[text] = true;
      out.push(text);
    });
    return out;
  }

  function exactRemarkText(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/[\r\n\t]+/g, " ")
      .replace(/[^\w\u0400-\u04FF]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function issueProjectKey(value) {
    var key = parser && typeof parser.extractJiraKey === "function" ? parser.extractJiraKey(value) : "";
    var match = String(key || value || "").trim().toUpperCase().match(/^([A-Z][A-Z0-9_]+)-\d+$/);
    return match ? match[1] : "";
  }

  function issueTypeName(issue) {
    var fields = issue && issue.fields ? issue.fields : {};
    var issueType = fields.issuetype;
    if (issueType && issueType.name != null) return String(issueType.name);
    return issueType != null ? String(issueType) : "";
  }

  function isStoryIssue(issue) {
    var typeName = issueTypeName(issue).trim().toLowerCase();
    var configured = config && config.STORY_ISSUE_TYPE != null ? String(config.STORY_ISSUE_TYPE).trim().toLowerCase() : "";
    return !!typeName && (
      typeName === configured ||
      typeName === "story" ||
      typeName === "user story" ||
      typeName === "история"
    );
  }

  function issueDescriptionName(issue) {
    var fields = issue && issue.fields ? issue.fields : {};
    if (fields.description != null) return String(fields.description);
    return issue && issue.description != null ? String(issue.description) : "";
  }

  function descriptionContainsExactRemark(issue, sourceSummary) {
    var needle = exactRemarkText(sourceSummary);
    var haystack = exactRemarkText(issueDescriptionName(issue));
    return needle.length >= 20 && haystack.indexOf(needle) !== -1;
  }

  function issueSummaryMatchScore(issue, sourceSummary) {
    var issueWords = summarySearchWords(issueSummaryName(issue).replace(/^\s*\[[^\]]+\]\s*/, ""));
    var sourceWords = summarySearchWords(sourceSummary);
    var issueSet = {};
    var hits = 0;
    issueWords.forEach(function(word) {
      issueSet[word.toLowerCase()] = true;
    });
    sourceWords.forEach(function(word) {
      if (issueSet[word.toLowerCase()]) hits += 1;
    });
    return (isStoryIssue(issue) ? 1000 : 0) + hits * 10 + (sourceWords.length ? hits / sourceWords.length : 0);
  }

  function bestSummaryIssueMatch(issues, sourceSummary) {
    var list = normalizeIssues(issues);
    var ranked;
    var exactDescriptionIssues = list.filter(function(issue) {
      return descriptionContainsExactRemark(issue, sourceSummary);
    });
    var storyIssues = list.filter(isStoryIssue);
    if (exactDescriptionIssues.length === 1) return exactDescriptionIssues[0];
    if (storyIssues.length === 1) return storyIssues[0];
    if (list.length === 1) return list[0];
    ranked = list.map(function(issue, index) {
      return { issue: issue, index: index, score: (descriptionContainsExactRemark(issue, sourceSummary) ? 100000 : 0) + issueSummaryMatchScore(issue, sourceSummary) };
    }).sort(function(a, b) {
      if (b.score !== a.score) return b.score - a.score;
      return a.index - b.index;
    });
    if (ranked.length && ranked[0].score > 0 && (!ranked[1] || ranked[0].score > ranked[1].score)) return ranked[0].issue;
    return null;
  }

  function issueStatusName(issue) {
    var fields = issue && issue.fields ? issue.fields : {};
    var status = fields.status;
    if (status && status.name != null) return String(status.name);
    return status != null ? String(status) : "";
  }

  function issueStatusCategoryKey(issue) {
    var fields = issue && issue.fields ? issue.fields : {};
    var status = fields.status;
    var category = status && status.statusCategory ? status.statusCategory : null;
    if (category && category.key != null) return String(category.key);
    if (category && category.colorName != null) return String(category.colorName);
    if (category && category.name != null) return String(category.name);
    return "";
  }

  function issueResolutionName(issue) {
    var fields = issue && issue.fields ? issue.fields : {};
    var resolution = fields.resolution;
    if (resolution && resolution.name != null) return String(resolution.name);
    return resolution != null ? String(resolution) : "";
  }

  function issueResolutionDate(issue) {
    var fields = issue && issue.fields ? issue.fields : {};
    return fields.resolutiondate != null ? String(fields.resolutiondate) : "";
  }

  function issueStatusState(issue) {
    var fields = issue && issue.fields ? issue.fields : {};
    var status = fields.status;
    var category = status && status.statusCategory ? status.statusCategory : null;
    var categoryKey = category && category.key != null ? String(category.key).toLowerCase() : "";
    var categoryColor = category && category.colorName != null ? String(category.colorName).toLowerCase() : "";
    var categoryName = category && category.name != null ? String(category.name).toLowerCase() : "";
    var categoryId = category && category.id != null ? String(category.id) : "";
    if (categoryKey === "done" || categoryColor === "green" || categoryId === "3") return "done";
    if (issueResolutionName(issue) || issueResolutionDate(issue)) return "done";
    if (categoryKey === "indeterminate" || categoryColor === "yellow" || categoryId === "4") return "progress";
    if (categoryKey === "new" || /blue|gray|grey/.test(categoryColor) || categoryId === "2") return "todo";
    var statusText = issueStatusName(issue).toLowerCase();
    if (/\bdone\b|\bresolved\b|\bclosed\b|\bcancelled\b|\bcanceled\b|готов|закрыт|снят|выполн|принят/.test(statusText)) return "done";
    if (/progress|review|testing|тест|работ|разработ|исполн|провер|ревью/.test(statusText)) return "progress";
    if (/todo|open|backlog|нов|выдан|ожид/.test(statusText)) return "todo";
    return categoryName ? "" : "";
  }

  function issueKey(issue) {
    return issue && issue.key != null ? String(issue.key).trim().toUpperCase() : "";
  }

  function resolveIssueByKey(issue, issueMap) {
    var key = issueKey(issue);
    var resolved = key && issueMap && issueMap[key] ? issueMap[key] : null;
    var out;
    var fields;
    if (!resolved) return issue;
    if (!issue) return resolved;
    out = {};
    Object.keys(issue || {}).forEach(function(field) {
      out[field] = issue[field];
    });
    Object.keys(resolved || {}).forEach(function(field) {
      if (field !== "fields" || resolved[field] != null) out[field] = resolved[field];
    });
    fields = {};
    Object.keys(issue.fields || {}).forEach(function(field) {
      fields[field] = issue.fields[field];
    });
    Object.keys(resolved.fields || {}).forEach(function(field) {
      if (resolved.fields[field] != null) fields[field] = resolved.fields[field];
    });
    if (Object.keys(fields).length) out.fields = fields;
    return out;
  }

  function issueIsDone(issue) {
    return issueStatusState(issue) === "done";
  }

  function issueAssigneeName(issue) {
    var fields = issue && issue.fields ? issue.fields : {};
    var assignee = fields.assignee;
    if (!assignee) return "";
    if (assignee.displayName != null && String(assignee.displayName).trim()) return String(assignee.displayName).trim();
    if (assignee.name != null && String(assignee.name).trim()) return String(assignee.name).trim();
    if (assignee.key != null && String(assignee.key).trim()) return String(assignee.key).trim();
    if (assignee.accountId != null && String(assignee.accountId).trim()) return String(assignee.accountId).trim();
    return "";
  }

  function normalizeLinkName(name) {
    return String(name || "").trim().toLowerCase().replace(/\s+/g, "_");
  }

  function isChildLinkName(name) {
    var normalized = normalizeLinkName(name);
    var configured = normalizeLinkName(config.CHILD_LINK_TYPE_NAME || "Child");
    return !!normalized && (
      normalized === configured ||
      normalized === "child" ||
      normalized === "is_child" ||
      normalized === "is_child_of" ||
      normalized === "has_child" ||
      normalized === "child_of" ||
      normalized === "child_of_story"
    );
  }

  function issueSummaryName(issue) {
    var fields = issue && issue.fields ? issue.fields : {};
    if (fields.summary != null && String(fields.summary).trim()) return String(fields.summary).trim();
    return issue && issue.summary != null ? String(issue.summary).trim() : "";
  }

  function childRoleFromSummary(summary) {
    var match = String(summary || "").match(/^\s*\[([^\]]+)\]/);
    return match && match[1] ? String(match[1]).trim() : "";
  }

  function childRoleSortIndex(role) {
    var value = String(role || "").trim().toLowerCase();
    if (value === "se") return 0;
    if (value === "fe") return 1;
    if (value === "be") return 2;
    if (value === "qa") return 3;
    if (value === "dev" || value === "devops" || value === "do") return 4;
    return 99;
  }

  function isBlockedRelationName(name) {
    var normalized = normalizeLinkName(name);
    return !!normalized && (
      normalized === "is_blocked_by" ||
      normalized.indexOf("blocked_by") !== -1 ||
      normalized.indexOf("blocker") !== -1 ||
      normalized.indexOf("блокир") !== -1
    );
  }

  function isBlocksLinkTypeName(name) {
    var normalized = normalizeLinkName(name);
    return normalized === "blocks" || normalized === "block";
  }

  function issueIsBlocked(issue, issueMap) {
    var links = issue && issue.fields && Array.isArray(issue.fields.issuelinks) ? issue.fields.issuelinks : [];
    return links.some(function(link) {
      var type = link && link.type ? link.type : {};
      var blocker = null;
      if (link && link.inwardIssue && (isBlockedRelationName(type.inward) || isBlocksLinkTypeName(type.name))) blocker = link.inwardIssue;
      if (!blocker && link && link.outwardIssue && isBlockedRelationName(type.outward)) blocker = link.outwardIssue;
      if (!blocker) return false;
      blocker = resolveIssueByKey(blocker, issueMap);
      return !issueIsDone(blocker);
    });
  }

  function linkedChildIssues(issue) {
    var links = issue && issue.fields && Array.isArray(issue.fields.issuelinks) ? issue.fields.issuelinks : [];
    var seen = {};
    var out = [];

    function push(linkName, linkedIssue) {
      var key = linkedIssue && linkedIssue.key != null ? String(linkedIssue.key).trim().toUpperCase() : "";
      var summary = issueSummaryName(linkedIssue);
      var identity = key || summary + "|" + issueStatusName(linkedIssue) + "|" + issueAssigneeName(linkedIssue);
      if (!isChildLinkName(linkName) || !linkedIssue || !identity || seen[identity]) return;
      seen[identity] = true;
      out.push(linkedIssue);
    }

    links.forEach(function(link) {
      var type = link && link.type ? link.type : {};
      push(type.name, link && link.inwardIssue);
      push(type.inward, link && link.inwardIssue);
      push(type.name, link && link.outwardIssue);
      push(type.outward, link && link.outwardIssue);
    });
    return out;
  }

  function childIssueKeysFromIssues(issues) {
    var seen = {};
    var out = [];
    (issues || []).forEach(function(issue) {
      linkedChildIssues(issue).forEach(function(child) {
        var key = child && child.key != null ? String(child.key).trim().toUpperCase() : "";
        if (!key || seen[key]) return;
        seen[key] = true;
        out.push(key);
      });
    });
    return out;
  }

  function issueChildStatusRows(issue, childIssueMap) {
    var children = linkedChildIssues(issue);
    var mergedIssueMap = {};
    Object.keys(childIssueMap || {}).forEach(function(key) {
      mergedIssueMap[key] = childIssueMap[key];
    });
    children.forEach(function(child) {
      var key = issueKey(child);
      if (key) mergedIssueMap[key] = resolveIssueByKey(child, childIssueMap);
    });
    return children.map(function(child, index) {
      var key = issueKey(child);
      var resolved = key && mergedIssueMap[key] ? mergedIssueMap[key] : resolveIssueByKey(child, childIssueMap);
      var summary = issueSummaryName(resolved) || (resolved && resolved.key) || (child && child.key) || "Без темы";
      var status = issueStatusName(resolved) || "Без статуса";
      var assignee = issueAssigneeName(resolved) || "Не назначен";
      var done = issueIsDone(resolved);
      return {
        role: childRoleFromSummary(summary),
        key: key || (resolved && resolved.key != null ? String(resolved.key).trim().toUpperCase() : ""),
        summary: summary,
        status: status,
        statusCategory: issueStatusCategoryKey(resolved),
        statusState: done ? "done" : issueStatusState(resolved),
        done: done,
        assignee: assignee,
        blocked: issueIsBlocked(resolved, mergedIssueMap),
        sourceIndex: index,
      };
    }).sort(function(a, b) {
      var left = childRoleSortIndex(a && a.role);
      var right = childRoleSortIndex(b && b.role);
      if (left !== right) return left - right;
      return (a && a.sourceIndex || 0) - (b && b.sourceIndex || 0);
    }).map(function(row) {
      delete row.sourceIndex;
      return row;
    });
  }

  function issueChildStatusTitleFromRows(rows) {
    return (rows || []).map(function(row) {
      var summary = row && row.summary ? row.summary : row && row.key ? row.key : "Без темы";
      var status = row && row.status ? row.status : "Без статуса";
      var assignee = row && row.assignee ? row.assignee : "Не назначен";
      return summary + " | " + status + " | " + assignee;
    }).join("\n");
  }

  function issueChildStatusTitle(issue, childIssueMap) {
    return issueChildStatusTitleFromRows(issueChildStatusRows(issue, childIssueMap));
  }

  function sprintNameFromString(value) {
    var text = String(value || "");
    var start = text.indexOf("name=");
    var markers = [",startDate=", ",endDate=", ",completeDate=", ",activatedDate=", ",goal=", ",sequence=", ",originBoardId=", ",rapidViewId=", ",state=", ",id=", ",synced=", "]"];
    var end = text.length;
    var i;
    if (start === -1) return text;
    start += 5;
    for (i = 0; i < markers.length; i += 1) {
      var markerIndex = text.indexOf(markers[i], start);
      if (markerIndex !== -1 && markerIndex < end) end = markerIndex;
    }
    return text.slice(start, end);
  }

  function sprintNameOne(value) {
    if (value == null || value === "") return "";
    if (Array.isArray(value)) return issueSprintName({ fields: { sprint: value } });
    if (typeof value === "string") return sprintNameFromString(value);
    if (typeof value === "object" && value.name != null) return String(value.name);
    return "";
  }

  function sprintName(value) {
    if (value == null || value === "") return "";
    if (Array.isArray(value)) {
      return value.map(sprintNameOne).filter(Boolean).join(", ");
    }
    return sprintNameOne(value);
  }

  function issueSprintName(issue) {
    var fields = issue && issue.fields ? issue.fields : {};
    var configured = config.SPRINT_FIELD && fields[config.SPRINT_FIELD] != null ? fields[config.SPRINT_FIELD] : null;
    if (configured != null) return sprintName(configured);
    if (fields.customfield_10020 != null) return sprintName(fields.customfield_10020);
    if (fields.customfield_10007 != null) return sprintName(fields.customfield_10007);
    if (fields.sprint != null) return sprintName(fields.sprint);
    return "";
  }

  function normalizeIssueKey(value) {
    var key = parser && typeof parser.extractJiraKey === "function" ? parser.extractJiraKey(value) : "";
    var text = value != null ? String(value).trim().toUpperCase() : "";
    if (key) return key;
    return /^[A-Z][A-Z0-9_]+-\d+$/.test(text) ? text : "";
  }

  function issueKeyFromRow(row) {
    var cols = row && row.sourceColumns ? row.sourceColumns : {};
    var value = row && row.createdKey ? row.createdKey : row && row.jiraKey ? row.jiraKey : cols[jiraColumnName()];
    return normalizeIssueKey(value);
  }

  function uniqueKeys(rows) {
    var seen = {};
    var out = [];
    (rows || []).forEach(function(row) {
      var key = issueKeyFromRow(row);
      if (!key || seen[key]) return;
      seen[key] = true;
      out.push(key);
    });
    return out;
  }

  function copyArrayForHost(values) {
    var out = new Array((values || []).length);
    var i;
    for (i = 0; i < out.length; i += 1) out[i] = values[i];
    return out;
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
    var mappingStoreInstance = mappingStore && typeof mappingStore.create === "function"
      ? mappingStore.create({
          jiraBaseUrl: api && api.baseUrl ? api.baseUrl : config.baseUrl,
          storageKey: config.MAPPING_STORAGE_KEY,
        })
      : null;
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
      priorityOptions: defaultPriorityOptions(),
      mappingSettings: defaultMappingSettings(),
      mappingEditorOpen: false,
      activeMappingBlock: "modules",
      mappingLoading: false,
      mappingError: "",
      sourceFileBuffer: null,
      sourceFileName: "",
      sourceWorkbook: null,
      sheetNames: [],
      sheetPickerOpen: false,
      exportBuffer: null,
      exportFileName: "",
      syncLoading: false,
      syncError: "",
      syncSummary: "",
      userPicker: {
        target: "",
        query: "",
        rows: [],
        loading: false,
        error: "",
        seq: 0,
      },
      epicPicker: {
        open: false,
        query: "",
      },
      issueTypePicker: {
        target: "",
        query: "",
        rows: [],
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

    function hasProjectKey(projectKey) {
      var key = projectKey != null ? String(projectKey) : "";
      return !!(state.projects || []).filter(function(project) {
        return project && String(project.key || "") === key;
      })[0];
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

    function resetExportState() {
      state.exportBuffer = null;
      state.exportFileName = "";
      state.syncError = "";
      state.syncSummary = "";
    }

    function parseLoadedWorkbook() {
      var parsed = parser.parseWorkbook(state.sourceWorkbook, state.mappingSettings);
      state.rows = (parsed.rows || []).map(copyRow);
      state.parseMeta = {
        sheetName: parsed.sheetName,
        headerRowNumber: parsed.headerRowNumber,
        headerColumns: parsed.headerColumns || {},
      };
      resetExportState();
      return parsed;
    }

    function reparseLoadedWorkbookAfterMappingChange() {
      if (!state.sourceWorkbook) return;
      state.createDialog = null;
      state.error = "";
      try {
        parseLoadedWorkbook();
      } catch (err) {
        state.error = "Не удалось применить мапинг: " + (err && err.message ? err.message : "unknown error");
      }
    }

    function readInputWorkbook(file) {
      if (excelLoader && typeof excelLoader.readFileBuffer === "function" && typeof excelLoader.readWorkbookFromBuffer === "function") {
        return promiseOf(excelLoader.readFileBuffer(file)).then(function(buffer) {
          return promiseOf(excelLoader.readWorkbookFromBuffer(buffer)).then(function(workbook) {
            return { buffer: buffer, workbook: workbook };
          });
        });
      }
      return promiseOf(excelLoader.readWorkbook(file)).then(function(workbook) {
        return { buffer: null, workbook: workbook };
      });
    }

  function exportColumnNames(settings, canonicalName, mappingKey) {
    var out = [canonicalName];
    var mapped = settings && settings.columnMap && settings.columnMap[mappingKey] != null
      ? String(settings.columnMap[mappingKey]).trim()
      : "";
    if (mapped && out.indexOf(mapped) < 0) out.push(mapped);
    return out;
  }

  function setExportValue(values, settings, canonicalName, mappingKey, value) {
    if (!nonBlank(value)) return;
    exportColumnNames(settings, canonicalName, mappingKey).forEach(function(columnName) {
      values[columnName] = value;
    });
  }

  function syncedValue(synced, canonicalName) {
    if (nonBlank(synced[canonicalName])) return synced[canonicalName];
    return "";
  }

  function patchRowsForExport(rows, settings) {
    return (rows || []).map(function(row) {
      var synced = row && row.syncedColumns ? row.syncedColumns : {};
      var values = {};
      var comments = {};
      var createdKey = row && row.createdKey ? issueKeyFromRow(row) : "";
      if (createdKey) values[jiraColumnName()] = createdKey;
      if (nonBlank(synced[jiraColumnName()])) values[jiraColumnName()] = synced[jiraColumnName()];
      setExportValue(values, settings, "Статус в Jira", "statusInJira", syncedValue(synced, "Статус в Jira"));
      setExportValue(values, settings, "Исполнитель в Jira", "assigneeInJira", syncedValue(synced, "Исполнитель в Jira"));
      setExportValue(values, settings, "Спринт", "sprintInJira", syncedValue(synced, "Спринт"));
      return {
        excelRowNumber: row && row.excelRowNumber,
        values: values,
        comments: comments,
      };
    }).filter(function(rowPatch) {
      return rowPatch.excelRowNumber && (Object.keys(rowPatch.values || {}).length || Object.keys(rowPatch.comments || {}).length);
    });
  }

    function issueMapByKey(data) {
      var out = {};
      normalizeIssues(data).forEach(function(issue) {
        var key = issue && issue.key != null ? String(issue.key).trim().toUpperCase() : "";
        if (key) out[key] = issue;
      });
      return out;
    }

    function syncSummaryText(count) {
      return "Синхронизировано " + String(count) + " тикет";
    }

    function projectKeyForSummarySearch() {
      var selected = state.projectKey != null ? String(state.projectKey).trim() : "";
      var seen = {};
      var keys;
      var epicProject;
      if (selected) return selected;
      epicProject = issueProjectKey(state.epicKey);
      if (epicProject) return epicProject;
      keys = uniqueKeys(state.rows);
      keys.forEach(function(key) {
        var project = issueProjectKey(key);
        if (project) seen[project] = true;
      });
      keys = Object.keys(seen);
      return keys.length === 1 ? keys[0] : "";
    }

    function tryMatchRowsBySummary() {
      var rows = state.rows || [];
      var projectKey = projectKeyForSummarySearch();
      var canSearch = !!(api && typeof api.searchIssueBySummary === "function" && projectKey);
      var chain = Promise.resolve();

      function matchByCandidates(row, candidates, index) {
        if (index >= candidates.length) return Promise.resolve(null);
        return promiseOf(api.searchIssueBySummary(projectKey, candidates[index])).then(function(data) {
          var issue = bestSummaryIssueMatch(data, row.summary);
          if (issue) return issue;
          return matchByCandidates(row, candidates, index + 1);
        });
      }

      rows.forEach(function(row) {
        chain = chain.then(function() {
          var key = issueKeyFromRow(row);
          var searchCandidates;
          if (key || !canSearch || !row || !row.summary) return;
          searchCandidates = summarySearchCandidates(row.summary);
          if (!searchCandidates.length) return;
          return matchByCandidates(row, searchCandidates, 0).then(function(issue) {
            var foundKey = issue && issue.key != null ? String(issue.key).trim().toUpperCase() : "";
            if (!foundKey) return;
            row.jiraKey = foundKey;
            row.alreadyLinked = true;
            row.sourceColumns = row.sourceColumns || {};
            row.sourceColumns[jiraColumnName()] = foundKey;
            row.matchedBySummary = true;
          });
        });
      });
      return chain;
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

    function userTargetRef(target) {
      var key = target != null ? String(target) : "";
      var dialog = state.createDialog;
      var match;
      if (dialog && key === "story") return { node: dialog, idKey: "assigneeId", labelKey: "assigneeLabel", assigneeKey: "assignee", mapping: false };
      match = /^child-(\d+)$/.exec(key);
      if (dialog && match && dialog.childTasks && dialog.childTasks[Number(match[1])]) {
        return { node: dialog.childTasks[Number(match[1])], idKey: "assigneeId", labelKey: "assigneeLabel", assigneeKey: "assignee", mapping: false };
      }
      if (key === "mapping-story") {
        return { node: state.mappingSettings, idKey: "storyAssigneeId", labelKey: "storyAssigneeLabel", assigneeKey: "storyAssignee", mapping: true };
      }
      match = /^mapping-role-(\d+)$/.exec(key);
      if (match && state.mappingSettings && state.mappingSettings.roles && state.mappingSettings.roles[Number(match[1])]) {
        return { node: state.mappingSettings.roles[Number(match[1])], idKey: "assigneeId", labelKey: "assigneeLabel", assigneeKey: "assignee", mapping: true };
      }
      return null;
    }

    function userTargetNode(target) {
      var ref = userTargetRef(target);
      return ref && ref.node ? ref.node : null;
    }

    function setTargetAssignee(target, userRow) {
      var ref = userTargetRef(target);
      var node = ref && ref.node ? ref.node : null;
      var raw = userRow && userRow.raw ? userRow.raw : null;
      if (!node) return false;
      if (!raw) {
        node[ref.idKey] = "";
        node[ref.labelKey] = "";
        node[ref.assigneeKey] = null;
        return !!ref.mapping;
      }
      node[ref.idKey] = userRow.id || "";
      node[ref.labelKey] = userRow.label || userLabel(raw) || userRow.id || "";
      node[ref.assigneeKey] = raw;
      return !!ref.mapping;
    }

    function normalizeIssueTypeName(value) {
      return String(value || "").trim().toLowerCase();
    }

    function issueTypeRows(projectKey) {
      var rows = [];
      var seen = {};

      function add(value) {
        var name = value != null ? String(value).trim() : "";
        var key = normalizeIssueTypeName(name);
        if (!name || seen[key]) return;
        seen[key] = true;
        rows.push({ name: name });
      }

      var key = projectKey != null ? String(projectKey) : "";
      var data = key && hasOwn(state.createMetaByProject, key) ? state.createMetaByProject[key] : null;
      (data && Array.isArray(data.projects) ? data.projects : []).forEach(function(project) {
        (project && Array.isArray(project.issuetypes) ? project.issuetypes : []).forEach(function(issueType) {
          add(issueType && issueType.name);
        });
      });
      add(config && config.STORY_ISSUE_TYPE);
      (state.mappingSettings && state.mappingSettings.roles || []).forEach(function(role) {
        add(role && role.issueType);
      });
      (config && config.CREATE_TEMPLATE_ROLES || []).forEach(function(role) {
        add(role && role.issueType);
      });
      if (state.createDialog) {
        add(state.createDialog.issueType);
        (state.createDialog.childTasks || []).forEach(function(task) {
          add(task && task.issueType);
        });
      }
      return rows;
    }

    function issueTypeTargetRef(target) {
      var key = target != null ? String(target) : "";
      var dialog = state.createDialog;
      var match;
      if (dialog && key === "story-type") return { node: dialog, key: "issueType", projectKey: dialog.projectKey, mapping: false, story: true };
      match = /^child-type-(\d+)$/.exec(key);
      if (dialog && match && dialog.childTasks && dialog.childTasks[Number(match[1])]) {
        return { node: dialog.childTasks[Number(match[1])], key: "issueType", projectKey: dialog.projectKey, mapping: false, story: false };
      }
      match = /^mapping-role-type-(\d+)$/.exec(key);
      if (match && state.mappingSettings && state.mappingSettings.roles && state.mappingSettings.roles[Number(match[1])]) {
        return { node: state.mappingSettings.roles[Number(match[1])], key: "issueType", projectKey: state.projectKey, mapping: true, story: false };
      }
      return null;
    }

    function setTargetIssueType(target, value) {
      var ref = issueTypeTargetRef(target);
      if (!ref || !ref.node) return false;
      ref.node[ref.key] = value != null ? String(value) : "";
      if (ref.story && state.createDialog) {
        state.createDialog.epicLinkAllowed = projectEpicLinkAllowed(state.createDialog.projectKey, state.createDialog.issueType);
      }
      return !!ref.mapping;
    }

    function openIssueTypePicker(target, query) {
      var targetKey = target != null ? String(target) : "";
      var ref = issueTypeTargetRef(targetKey);
      if (!ref || !ref.node) return;
      var q = query != null ? String(query) : String(ref.node[ref.key] || "");
      var normalized = normalizeIssueTypeName(q);
      state.issueTypePicker.target = targetKey;
      state.issueTypePicker.query = q;
      state.issueTypePicker.rows = issueTypeRows(ref.projectKey).filter(function(row) {
        return !normalized || normalizeIssueTypeName(row && row.name).indexOf(normalized) !== -1;
      }).slice(0, 20);
      if (ref.projectKey && !hasOwn(state.createMetaByProject, ref.projectKey)) loadCreateMeta(ref.projectKey);
      render();
    }

    function closeIssueTypePicker() {
      state.issueTypePicker.target = "";
      state.issueTypePicker.query = "";
      state.issueTypePicker.rows = [];
    }

    function closeEpicPicker() {
      state.epicPicker.open = false;
      state.epicPicker.query = "";
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

    function limitSummary(value) {
      var max = Number(config && config.SUMMARY_MAX_LENGTH) || 250;
      var text = value != null ? String(value).trim() : "";
      return text.length > max ? text.slice(0, max) : text;
    }

    function childSummary(role, storySummary) {
      var prefix = role && role.role != null ? String(role.role).trim() : "";
      var summary = storySummary != null ? String(storySummary).trim() : "";
      return limitSummary((prefix ? "[" + prefix + "] " : "") + summary);
    }

    function estimateHours(value) {
      var text = value != null ? String(value) : "";
      var match = /(\d+(?:[.,]\d+)?)/.exec(text);
      return match ? Number(match[1].replace(",", ".")) : 0;
    }

    function storyEstimate(roles) {
      var total = (roles || []).filter(function(role) {
        return !role || role.enabled !== false;
      }).reduce(function(sum, role) {
        return sum + estimateHours(role && role.originalEstimate);
      }, 0);
      return (total || 1) + "h";
    }

    function assigneeFromSettings(id, assignee) {
      var raw = copyAssignee(assignee);
      if (raw) return raw;
      var user = selectedUser(id);
      return user ? copyAssignee(user) : null;
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
      var settings = normalizeMappingSettings(state.mappingSettings);
      var roles = copyRoles(settings.roles);
      var summary = limitSummary(row && row.summary != null ? row.summary : "");
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
        assigneeId: settings.storyAssigneeId || "",
        assigneeLabel: settings.storyAssigneeLabel || "",
        assignee: assigneeFromSettings(settings.storyAssigneeId, settings.storyAssignee),
        originalEstimate: estimate,
        remainingEstimate: estimate,
        createSubtasks: state.createSubtasks !== false,
        childTasks: state.createSubtasks !== false ? roles.map(function(role) {
          return {
            enabled: !(role && role.enabled === false),
            role: role && role.role != null ? String(role.role) : "",
            issueType: role && role.issueType != null ? String(role.issueType) : "",
            summary: childSummary(role, summary),
            assigneeId: role && role.assigneeId != null ? String(role.assigneeId) : "",
            assigneeLabel: role && role.assigneeLabel != null ? String(role.assigneeLabel) : "",
            assignee: assigneeFromSettings(role && role.assigneeId, role && role.assignee),
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

    function clearMappingErrorWithoutRender() {
      state.mappingError = "";
      if (rendering && typeof rendering.clearMappingError === "function") {
        rendering.clearMappingError();
      }
    }

    function setError(message) {
      state.error = message ? String(message) : "";
      state.loading = false;
      render();
    }

    function loadMappings() {
      if (!mappingStoreInstance || typeof mappingStoreInstance.load !== "function") {
        state.mappingSettings = normalizeMappingSettings(state.mappingSettings);
        return Promise.resolve(state.mappingSettings);
      }
      state.mappingLoading = true;
      state.mappingError = "";
      render();
      return promiseOf(mappingStoreInstance.load()).then(
        function(settings) {
          state.mappingSettings = normalizeMappingSettings(settings);
          state.mappingLoading = false;
          state.mappingError = "";
          render();
          return state.mappingSettings;
        },
        function(err) {
          state.mappingSettings = normalizeMappingSettings(state.mappingSettings);
          state.mappingLoading = false;
          state.mappingError = "Не удалось загрузить мапинг: " + (err && err.statusText ? err.statusText : err && err.message ? err.message : "request failed");
          render();
          return state.mappingSettings;
        }
      );
    }

    function saveMappings(options) {
      var opts = options || {};
      var shouldRender = opts.render !== false;
      state.mappingSettings = normalizeMappingSettings(state.mappingSettings);
      if (!mappingStoreInstance || typeof mappingStoreInstance.save !== "function") {
        if (shouldRender) render();
        return Promise.resolve(state.mappingSettings);
      }
      state.mappingError = "";
      if (shouldRender) render();
      return promiseOf(mappingStoreInstance.save(state.mappingSettings)).then(
        function(settings) {
          state.mappingSettings = normalizeMappingSettings(settings);
          state.mappingError = "";
          if (shouldRender) render();
          return state.mappingSettings;
        },
        function(err) {
          state.mappingError = "Не удалось сохранить мапинг: " + (err && err.statusText ? err.statusText : err && err.message ? err.message : "request failed");
          render();
          return state.mappingSettings;
        }
      );
    }

    function loadProjects() {
      state.loading = true;
      render();
      return promiseOf(api.getProjects()).then(
        function(projects) {
          state.projects = normalizeProjects(projects);
          if (!state.projectKey) {
            var storedProjectKey = readStoredProjectKey();
            if (storedProjectKey && hasProjectKey(storedProjectKey)) state.projectKey = storedProjectKey;
          }
          state.loading = false;
          render();
          if (state.projectKey) {
            loadEpics(state.projectKey);
            loadCreateMeta(state.projectKey);
          }
        },
        function(err) {
          setError("Не удалось загрузить проекты: " + (err && err.statusText ? err.statusText : "request failed"));
        }
      );
    }

    function loadEpics(projectKey) {
      state.epicKey = "";
      state.epics = [];
      closeEpicPicker();
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
          var priorities = priorityOptionsFromCreateMeta(data);
          state.createMetaByProject[key] = data;
          state.priorityOptions = priorities.length ? priorities : defaultPriorityOptions();
          state.createMetaLoading = false;
          state.createMetaError = "";
          if (state.createDialog && state.createDialog.projectKey === key) {
            state.createDialog.epicLinkAllowed = projectEpicLinkAllowed(key, state.createDialog.issueType);
          }
          if (state.issueTypePicker && state.issueTypePicker.target) {
            var ref = issueTypeTargetRef(state.issueTypePicker.target);
            if (ref && String(ref.projectKey || "") === key) {
              var normalized = normalizeIssueTypeName(state.issueTypePicker.query);
              state.issueTypePicker.rows = issueTypeRows(key).filter(function(row) {
                return !normalized || normalizeIssueTypeName(row && row.name).indexOf(normalized) !== -1;
              }).slice(0, 20);
            }
          }
          render();
        },
        function(err) {
          state.createMetaByProject[key] = null;
          state.priorityOptions = defaultPriorityOptions();
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
          if (!userTargetRef(targetKey) || state.userPicker.seq !== seq || state.userPicker.target !== targetKey) return;
          state.users = mergeUsers(state.users, rows);
          state.userPicker.rows = rows;
          state.userPicker.loading = false;
          state.userPicker.error = "";
          render();
        },
        function(err) {
          if (!userTargetRef(targetKey) || state.userPicker.seq !== seq || state.userPicker.target !== targetKey) return;
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
      writeStoredProjectKey(state.projectKey);
      closeEpicPicker();
      closeUserPicker();
      closeIssueTypePicker();
      loadEpics(state.projectKey);
      loadCreateMeta(state.projectKey);
    }

    function onEpicChange(epicKey) {
      onEpicSelect(epicKey);
    }

    function onEpicSearch(query) {
      if (!state.projectKey) return;
      state.epicPicker.open = true;
      state.epicPicker.query = query != null ? String(query) : "";
      render();
    }

    function onEpicSelect(epicKey) {
      state.epicKey = epicKey != null ? String(epicKey) : "";
      state.createDialog = null;
      closeEpicPicker();
      closeUserPicker();
      closeIssueTypePicker();
      render();
    }

    function onFileChange(file) {
      if (!file) return;
      state.loading = true;
      state.error = "";
      state.sourceFileBuffer = null;
      state.sourceFileName = file && file.name != null ? String(file.name) : "";
      state.sourceWorkbook = null;
      state.sheetNames = [];
      state.sheetPickerOpen = false;
      state.createDialog = null;
      resetExportState();
      closeEpicPicker();
      closeUserPicker();
      closeIssueTypePicker();
      render();
      readInputWorkbook(file).then(function(result) {
        state.sourceFileBuffer = result.buffer;
        state.sourceWorkbook = result.workbook;
        state.sheetNames = result.workbook && Array.isArray(result.workbook.SheetNames)
          ? result.workbook.SheetNames.map(function(name) { return String(name); })
          : [];
        parseLoadedWorkbook();
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
      closeIssueTypePicker();
      render();
    }

    function onToggleSheetPicker() {
      if (!state.parseMeta || !state.sheetNames.length) return;
      state.sheetPickerOpen = !state.sheetPickerOpen;
      render();
    }

    function onMetaSheetSelect(sheetName) {
      var nextSheetName = copySheetName(sheetName);
      if (!nextSheetName || !state.sourceWorkbook) {
        state.sheetPickerOpen = false;
        render();
        return;
      }
      state.mappingSettings.sheetName = nextSheetName;
      state.sheetPickerOpen = false;
      state.createDialog = null;
      state.error = "";
      closeUserPicker();
      closeIssueTypePicker();
      try {
        parseLoadedWorkbook();
      } catch (err) {
        setError("Не удалось прочитать лист: " + (err && err.message ? err.message : "unknown error"));
        saveMappings();
        return;
      }
      saveMappings();
      render();
    }

    function mappingKey(block) {
      var key = block != null ? String(block) : "";
      if (key === "priorities") return "priorityMap";
      if (key === "columns") return "columnMap";
      return "moduleComponentMap";
    }

    function onOpenMappings() {
      state.mappingEditorOpen = true;
      state.activeMappingBlock = state.activeMappingBlock || "modules";
      closeUserPicker();
      render();
    }

    function onCloseMappings() {
      state.mappingEditorOpen = false;
      render();
    }

    function onMappingBlockSelect(block) {
      var key = block != null ? String(block) : "";
      state.activeMappingBlock = key === "priorities" || key === "roles" || key === "columns" || key === "tableStart" ? key : "modules";
      render();
    }

    function onMappingColumnChange(field, value) {
      var key = field != null ? String(field) : "";
      state.mappingSettings.columnMap = copyColumnMap(state.mappingSettings.columnMap);
      state.mappingSettings.columnMap[key] = value != null ? String(value) : "";
      reparseLoadedWorkbookAfterMappingChange();
      saveMappings({ render: false });
    }

    function onMappingTableStartChange(field, value) {
      var key = field != null ? String(field) : "";
      state.mappingSettings.tableStart = copyTableStart(state.mappingSettings.tableStart);
      if (key === "headerMarker") state.mappingSettings.tableStart.headerMarker = value != null ? String(value) : "";
      reparseLoadedWorkbookAfterMappingChange();
      saveMappings({ render: false });
    }

    function onMappingSheetNameChange(value) {
      state.mappingSettings.sheetName = copySheetName(value);
      reparseLoadedWorkbookAfterMappingChange();
      saveMappings({ render: false });
    }

    function onMappingPairAdd(block) {
      var key = mappingKey(block);
      var entries = mappingEntries(state.mappingSettings[key]);
      var base = "Новое значение";
      var name = base;
      var index = 2;
      var jira = "";
      while (state.mappingSettings[key] && Object.prototype.hasOwnProperty.call(state.mappingSettings[key], name)) {
        name = base + " " + index;
        index += 1;
      }
      if (key === "priorityMap") {
        jira = (state.priorityOptions && state.priorityOptions[0] && state.priorityOptions[0].name) || "";
      }
      entries.push({ excel: name, jira: jira });
      state.mappingSettings[key] = mapFromEntries(entries);
      saveMappings();
    }

    function onMappingPairChange(block, index, field, value) {
      var key = mappingKey(block);
      var i = Number(index);
      var entries = mappingEntries(state.mappingSettings[key]);
      var name = field != null ? String(field) : "";
      if (!entries[i]) return;
      var hadMappingError = !!state.mappingError;
      if (name === "excel") {
        var excel = value != null ? String(value) : "";
        var duplicate = excel && entries.some(function(entry, idx) {
          return idx !== i && entry && String(entry.excel || "").trim() === excel.trim();
        });
        if (duplicate) {
          state.mappingError = "Excel значение \"" + excel + "\" уже есть в этом блоке мапинга.";
          render();
          return;
        }
        entries[i].excel = excel;
      }
      if (name === "jira") entries[i].jira = value != null ? String(value) : "";
      state.mappingSettings[key] = mapFromEntries(entries);
      if (hadMappingError) {
        clearMappingErrorWithoutRender();
      } else {
        state.mappingError = "";
      }
      saveMappings({ render: false });
    }

    function onMappingPairRemove(block, index) {
      var key = mappingKey(block);
      var i = Number(index);
      var entries = mappingEntries(state.mappingSettings[key]);
      if (!entries[i]) return;
      entries.splice(i, 1);
      state.mappingSettings[key] = mapFromEntries(entries);
      saveMappings();
    }

    function onMappingRoleAdd() {
      var roles = copyRoles(state.mappingSettings.roles);
      roles.push({ enabled: true, role: "NEW", issueType: "Task", originalEstimate: "1h", remainingEstimate: "1h", assigneeId: "", assigneeLabel: "", assignee: null });
      state.mappingSettings.roles = roles;
      saveMappings();
    }

    function onMappingRoleChange(index, field, value) {
      var i = Number(index);
      var key = field != null ? String(field) : "";
      var roles = copyRoles(state.mappingSettings.roles);
      if (!roles[i]) return;
      if (key === "enabled") roles[i].enabled = !!value;
      if (key === "role") roles[i].role = value != null ? String(value) : "";
      if (key === "issueType") roles[i].issueType = value != null ? String(value) : "";
      if (key === "originalEstimate") roles[i].originalEstimate = value != null ? String(value) : "";
      if (key === "remainingEstimate") roles[i].remainingEstimate = value != null ? String(value) : "";
      if (key === "assigneeId") {
        roles[i].assigneeId = value != null ? String(value) : "";
        roles[i].assignee = selectedUser(roles[i].assigneeId);
        roles[i].assigneeLabel = userLabel(roles[i].assignee);
      }
      state.mappingSettings.roles = roles;
      saveMappings({ render: key === "enabled" || key === "assigneeId" });
    }

    function onMappingRoleRemove(index) {
      var i = Number(index);
      var roles = copyRoles(state.mappingSettings.roles);
      if (!roles[i]) return;
      roles.splice(i, 1);
      state.mappingSettings.roles = roles;
      saveMappings();
    }

    function completeCreate(row, result) {
      row.createdKey = result && result.createdKey ? String(result.createdKey) : row.createdKey || "";
      if (row.createdKey) {
        row.jiraKey = row.createdKey;
        row.alreadyLinked = true;
        row.sourceColumns = row.sourceColumns || {};
        row.sourceColumns[jiraColumnName()] = row.createdKey;
        resetExportState();
      }
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

    function onSyncJira() {
      if (state.syncLoading) return;
      if (!state.rows.length) {
        state.syncError = "Сначала загрузите Excel.";
        state.syncSummary = "";
        render();
        return;
      }
      if (!state.sourceFileBuffer) {
        state.syncError = "Исходный Excel недоступен для выгрузки. Загрузите файл заново.";
        state.syncSummary = "";
        render();
        return;
      }
      if (!api || typeof api.getIssuesByKeys !== "function") {
        state.syncError = "API синхронизации Jira недоступен.";
        state.syncSummary = "";
        render();
        return;
      }
      if (!xlsxPatcher || typeof xlsxPatcher.patchWorkbook !== "function") {
        state.syncError = "Модуль выгрузки Excel недоступен.";
        state.syncSummary = "";
        render();
        return;
      }
      state.syncLoading = true;
      state.syncError = "";
      state.syncSummary = "";
      state.exportBuffer = null;
      state.exportFileName = "";
      closeUserPicker();
      render();
      promiseOf(tryMatchRowsBySummary()).then(function() {
        var keys = uniqueKeys(state.rows);
        if (!keys.length) throw new Error("В строках нет Jira-ключей для синхронизации.");
        return promiseOf(api.getIssuesByKeys(copyArrayForHost(keys)));
      }).then(function(data) {
        var issueList = normalizeIssues(data);
        var childKeys = childIssueKeysFromIssues(issueList);
        var childrenPromise = childKeys.length ? promiseOf(api.getIssuesByKeys(copyArrayForHost(childKeys))) : Promise.resolve({ issues: [] });
        return childrenPromise.then(function(childData) {
          return {
            data: data,
            childIssues: issueMapByKey(childData),
          };
        });
      }).then(function(syncData) {
        var issues = issueMapByKey(syncData.data);
        var childIssues = syncData.childIssues || {};
        var synced = 0;
        (state.rows || []).forEach(function(row) {
          row.childStatuses = [];
          row.statusTitle = "";
          var key = issueKeyFromRow(row);
          var issue = issues[key];
          if (!issue) return;
          row.jiraKey = key;
          row.alreadyLinked = true;
          row.sourceColumns = row.sourceColumns || {};
          row.syncedColumns = {};
          if (row.matchedBySummary && nonBlank(key)) row.syncedColumns[jiraColumnName()] = key;
          var statusName = issueStatusName(issue);
          var assigneeName = issueAssigneeName(issue);
          var sprintNameValue = issueSprintName(issue);
          var childStatuses = issueChildStatusRows(issue, childIssues);
          row.childStatuses = childStatuses;
          row.statusTitle = issueChildStatusTitleFromRows(childStatuses);
          if (nonBlank(statusName)) {
            row.sourceColumns["Статус в Jira"] = statusName;
            row.syncedColumns["Статус в Jira"] = statusName;
          }
          if (nonBlank(assigneeName)) {
            row.sourceColumns["Исполнитель в Jira"] = assigneeName;
            row.syncedColumns["Исполнитель в Jira"] = assigneeName;
          }
          if (nonBlank(sprintNameValue)) {
            row.sourceColumns["Спринт"] = sprintNameValue;
            row.syncedColumns["Спринт"] = sprintNameValue;
          }
          synced += 1;
        });
        return promiseOf(xlsxPatcher.patchWorkbook(state.sourceFileBuffer, {
          sheetName: state.parseMeta && state.parseMeta.sheetName,
          headerRowNumber: state.parseMeta && state.parseMeta.headerRowNumber,
          headerColumns: state.parseMeta && state.parseMeta.headerColumns ? state.parseMeta.headerColumns : {},
          rows: patchRowsForExport(state.rows, state.mappingSettings),
        })).then(function(buffer) {
          state.exportBuffer = buffer;
          state.exportFileName = syncedFileName(state.sourceFileName);
          state.syncLoading = false;
          state.syncError = "";
          state.syncSummary = syncSummaryText(synced);
          render();
        });
      }).then(null,
        function(err) {
          state.syncLoading = false;
          state.exportBuffer = null;
          state.exportFileName = "";
          state.syncError = "Не удалось синхронизировать Jira: " + (err && err.message ? err.message : err && err.statusText ? err.statusText : "request failed");
          state.syncSummary = "";
          render();
        }
      );
    }

    function onDownloadPatchedExcel() {
      var blob = state.exportBuffer;
      var urlApi = typeof URL !== "undefined" ? URL : typeof webkitURL !== "undefined" ? webkitURL : null;
      var a;
      var url;
      if (!blob || typeof document === "undefined" || !urlApi || typeof urlApi.createObjectURL !== "function") return;
      if (typeof Blob !== "undefined" && !(blob instanceof Blob)) {
        blob = new Blob([blob], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      }
      url = urlApi.createObjectURL(blob);
      a = document.createElement("a");
      a.href = url;
      a.download = state.exportFileName || "jira-status.synced.xlsx";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      if (typeof setTimeout === "function") {
        setTimeout(function() {
          urlApi.revokeObjectURL(url);
        }, 0);
      } else {
        urlApi.revokeObjectURL(url);
      }
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
          mappings: state.mappingSettings,
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
      var shouldRender = false;
      if (!dialog) return;
      if (key === "summary") {
        dialog.summary = limitSummary(value);
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
        shouldRender = true;
      } else if (key === "issueType") {
        dialog.issueType = value != null ? String(value) : "";
        dialog.epicLinkAllowed = projectEpicLinkAllowed(dialog.projectKey, dialog.issueType);
        shouldRender = true;
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
      if (shouldRender) render();
    }

    function onDialogSourceChange(index, value) {
      var dialog = state.createDialog;
      var i = Number(index);
      if (!dialog || !dialog.sourceRows || !dialog.sourceRows[i]) return;
      dialog.sourceRows[i].value = value != null ? String(value) : "";
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
        task.summary = limitSummary(value);
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
    }

    function onDialogAssigneeFocus(target) {
      var targetKey = target != null ? String(target) : "";
      if (!userTargetNode(targetKey)) return;
      if (state.userPicker.target === targetKey) return;
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
      var mappingTarget = setTargetAssignee(target, row);
      closeUserPicker();
      if (mappingTarget) saveMappings();
      render();
    }

    function onDialogAssigneeClear(target) {
      var mappingTarget = setTargetAssignee(target, null);
      closeUserPicker();
      if (mappingTarget) saveMappings();
      render();
    }

    function onIssueTypeFocus(target) {
      var targetKey = target != null ? String(target) : "";
      var ref = issueTypeTargetRef(targetKey);
      if (!ref || !ref.node) return;
      openIssueTypePicker(targetKey, ref.node[ref.key]);
    }

    function onIssueTypeSearch(target, query) {
      openIssueTypePicker(target, query);
      var mappingTarget = setTargetIssueType(target, query);
      if (mappingTarget) saveMappings({ render: false });
    }

    function onIssueTypeSelect(target, name) {
      var mappingTarget = setTargetIssueType(target, name);
      closeIssueTypePicker();
      if (mappingTarget) saveMappings();
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
      closeIssueTypePicker();
      render();
    }

    rendering.init($container, {
      onProjectChange: onProjectChange,
      onEpicChange: onEpicChange,
      onEpicSearch: onEpicSearch,
      onEpicSelect: onEpicSelect,
      onFileChange: onFileChange,
      onSubtasksChange: onSubtasksChange,
      onToggleSheetPicker: onToggleSheetPicker,
      onMetaSheetSelect: onMetaSheetSelect,
      onOpenMappings: onOpenMappings,
      onCloseMappings: onCloseMappings,
      onMappingBlockSelect: onMappingBlockSelect,
      onMappingPairAdd: onMappingPairAdd,
      onMappingPairChange: onMappingPairChange,
      onMappingPairRemove: onMappingPairRemove,
      onMappingColumnChange: onMappingColumnChange,
      onMappingTableStartChange: onMappingTableStartChange,
      onMappingSheetNameChange: onMappingSheetNameChange,
      onMappingRoleAdd: onMappingRoleAdd,
      onMappingRoleChange: onMappingRoleChange,
      onMappingRoleRemove: onMappingRoleRemove,
      onSyncJira: onSyncJira,
      onDownloadPatchedExcel: onDownloadPatchedExcel,
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
      onIssueTypeFocus: onIssueTypeFocus,
      onIssueTypeSearch: onIssueTypeSearch,
      onIssueTypeSelect: onIssueTypeSelect,
    });

    rendering.render(state);
    loadMappings();
    loadProjects();
  }

  return ExcelStoryImporterGadget;
});
