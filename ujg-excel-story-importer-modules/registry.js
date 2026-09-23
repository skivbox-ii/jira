define("_ujgESI_registry", ["_ujgESI_remarkId"], function(remarkId) {
  "use strict";

  function text(value) { return value == null ? "" : String(value).trim(); }
  function compare(a, b) { return text(a).localeCompare(text(b), "ru", { numeric: true, sensitivity: "base" }); }
  function priorityRank(value) {
    value = text(value).toLocaleLowerCase();
    if (/blocker|блокер|блокир/.test(value)) return 6;
    if (/highest|critical|крит|наивыс/.test(value)) return 5;
    if (/high|major|высок|значительн/.test(value) && !/незнач/.test(value)) return 4;
    if (/medium|normal|средн|обычн/.test(value)) return 3;
    if (/lowest|trivial|самый низ|незнач/.test(value)) return 1;
    if (/low|minor|низк/.test(value)) return 2;
    return null;
  }
  function comparePriority(a, b, direction) {
    if (!text(a) || !text(b)) return text(a) ? -1 : text(b) ? 1 : 0;
    var ar = priorityRank(a), br = priorityRank(b), sign = direction === "desc" ? -1 : 1;
    if (ar == null || br == null) return ar == null && br == null ? compare(a, b) * sign : ar == null ? 1 : -1;
    return (ar - br) * sign;
  }
  function importStatus(row) {
    if (row.status === "creating") return "Создается";
    if (row.status === "partial") return "Частично создано";
    if (row.status === "failed") return "Ошибка создания";
    if (row.status === "created") return "Создано";
    if (row.jiraKey || row.createdKey || row.alreadyLinked) return "Уже в Jira";
    return "Не заведено";
  }
  function ageText(ms) {
    if (ms == null || !isFinite(ms) || ms < 0) return "";
    var hours = Math.floor(ms / 3600000);
    if (hours >= 24) return Math.floor(hours / 24) + " д " + (hours % 24) + " ч";
    if (hours) return hours + " ч " + Math.floor(ms / 60000 % 60) + " мин";
    return Math.floor(ms / 60000) + " мин";
  }
  function buildRows(rows, now) {
    var result = [];
    now = now == null ? Date.now() : now;
    (rows || []).forEach(function(row, index) {
      var cols = row.sourceColumns || {};
      var groupId = text(row.id) || String(index);
      var parentKey = text(row.createdKey || row.jiraKey);
      function entry(details, child, childIndex) {
        var synced = !!details;
        details = details || {};
        var key = text(details.key || (child ? "" : parentKey));
        var since = key && details.statusSince ? Date.parse(details.statusSince) : NaN;
        var ms = isFinite(since) && since <= now ? now - since : null;
        return {
          source: row, rowIndex: index, groupId: groupId, uid: groupId + ":" + (child ? childIndex : "story"), isChild: !!child,
          remarkId: remarkId(row), remark: text(row.summary), owner: text(Object.prototype.hasOwnProperty.call(cols, "Ответственный") ? cols["Ответственный"] : cols["Исполнитель"]),
          module: text(cols["Модуль"]), sourceStatus: text(cols["Статус"]), importState: importStatus(row), key: key,
          type: key ? text(details.issueType) : "",
          role: child ? text(details.role) : "",
          summary: text(details.summary || (child ? "" : row.summary)),
          description: text(details.description), descriptionLoaded: typeof details.descriptionLoaded === "boolean" ? details.descriptionLoaded : details.description != null,
          status: key ? text(synced || child ? details.status : cols["Статус в Jira"]) : "",
          assignee: key ? text(synced || child ? details.assignee : cols["Исполнитель в Jira"]) : "",
          priority: text(synced || child ? details.priority : cols["Приоритет"]),
          updated: key ? text(details.updated) : "", age: ageText(ms), ageMs: ms,
          statusSince: text(details.statusSince), ageReason: text(details.statusSinceReason) || "История переходов не загружена",
          done: typeof details.done === "boolean" ? details.done : details.statusCategory ? details.statusCategory === "done" : /^(done|готово|закрыт[ао]?|closed|resolved|снят[ао]?)$/i.test(text(details.status || cols["Статус в Jira"])),
          statusState: text(details.statusState), statusCategory: text(details.statusCategory),
          blocked: !!details.blocked,
          linkedToParent: details.linkedToParent, linkError: text(details.linkError),
        };
      }
      result.push(entry(row.storyDetails, false));
      (row.childStatuses || []).forEach(function(child, childIndex) { result.push(entry(child, true, childIndex)); });
    });
    return result;
  }
  function matches(row, filters, except) {
    return Object.keys(filters || {}).every(function(key) {
      if (key === "excludeDone") return except === "status" || !filters[key] || !row.done;
      return key === except || !Array.isArray(filters[key]) || filters[key].indexOf(text(row[key])) !== -1;
    });
  }
  function values(rows, column, filters) {
    var seen = Object.create(null);
    (rows || []).filter(function(row) { return matches(row, filters, column); }).forEach(function(row) { seen[text(row[column])] = true; });
    return Object.keys(seen).sort(compare);
  }
  function selectGroups(rows, filters, sort) {
    var groups = [];
    var current;
    (rows || []).forEach(function(row) {
      if (!row.isChild) {
        current = { parent: row, children: [], contextOnly: !matches(row, filters), totalChildren: 0 };
        groups.push(current);
      } else if (current) {
        current.totalChildren += 1;
        if (matches(row, filters)) current.children.push(row);
      }
    });
    groups = groups.filter(function(group) { return !group.contextOnly || group.children.length; });
    if (sort && sort.column) {
      function value(row) { return sort.column === "age" ? row.ageMs : row[sort.column]; }
      function cmp(a, b) {
        var av = value(a), bv = value(b);
        if (sort.column === "priority") return comparePriority(av, bv, sort.direction);
        var result = sort.column === "age" ? (av == null ? -1 : av) - (bv == null ? -1 : bv) : compare(av, bv);
        return result * (sort.direction === "desc" ? -1 : 1);
      }
      groups.forEach(function(group) { group.children.sort(cmp); });
      groups.sort(function(a, b) {
        return cmp(a.contextOnly ? a.children[0] : a.parent, b.contextOnly ? b.children[0] : b.parent) || a.parent.rowIndex - b.parent.rowIndex;
      });
    }
    return groups;
  }
  return { buildRows: buildRows, selectGroups: selectGroups, values: values, remarkId: remarkId, importStatus: importStatus, compare: compare };
});
