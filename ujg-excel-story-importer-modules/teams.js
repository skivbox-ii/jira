define("_ujgESI_teams", [], function() {
  "use strict";

  var directions = [
    { id: "development", label: "Разработка" },
    { id: "testing", label: "Тестирование" },
    { id: "implementation", label: "Внедрение" },
    { id: "analysis", label: "Анализ" },
    { id: "other", label: "Другое" }
  ];
  var colors = ["#3973B9", "#168477", "#B05D24", "#8A5AA8", "#C34F62", "#5F7180", "#75833C"];
  var defaultRows = [
    ["be", "BE", "development", ["BE"]],
    ["fe", "FE", "development", ["FE"]],
    ["de", "DE", "development", ["DE"]],
    ["qa", "QA", "testing", ["QA"]],
    ["se", "SE", "analysis", ["SE"]],
    ["devops", "DevOps", "other", ["DEVOPS"]],
    ["implementation", "Внедрение", "implementation", ["IMP", "IMPLEMENTATION"]]
  ];
  function str(value, max) { return typeof value === "string" || typeof value === "number" ? String(value).trim().slice(0, max || 160) : ""; }
  function unique(values, maxItems, maxLength) {
    var seen = Object.create(null);
    return (Array.isArray(values) ? values : []).slice(0, maxItems).map(function(x) { return str(x, maxLength); }).filter(function(x) {
      if (!x || seen[x]) return false;
      seen[x] = true;
      return true;
    });
  }
  function defaults() {
    return defaultRows.map(function(row, index) {
      return { id: row[0], name: row[1], direction: row[2], roles: row[3].slice(), members: [], color: colors[index] };
    });
  }
  function normalize(input) {
    if (!Array.isArray(input)) return defaults();
    var seen = Object.create(null);
    return input.slice(0, 50).map(function(row, index) {
      if (!row || typeof row !== "object" || Array.isArray(row)) return null;
      var id = str(row.id, 80);
      if (!id || id === "__proto__" || id === "constructor" || id === "prototype" || seen[id]) id = "team-" + index;
      while (seen[id]) id += "-";
      seen[id] = true;
      var members = (Array.isArray(row.members) ? row.members : []).slice(0, 100).map(function(member) {
        if (!member || typeof member !== "object") return null;
        var memberId = str(member.id, 160);
        var identifiers = unique(member.identifiers, 20, 160);
        if (!memberId && !identifiers.length) return null;
        return { id: memberId || identifiers[0], label: str(member.label, 160) || memberId || identifiers[0], identifiers: identifiers };
      }).filter(Boolean);
      return {
        id: id,
        name: str(row.name, 80) || "Команда " + (index + 1),
        direction: directions.some(function(item) { return item.id === row.direction; }) ? row.direction : "other",
        roles: unique(row.roles, 30, 80),
        members: members,
        color: colors.indexOf(row.color) >= 0 ? row.color : colors[index % colors.length]
      };
    }).filter(Boolean);
  }
  function storageKey(preferencesKey, projectKey) {
    return "ujg-esi-teams:" + encodeURIComponent(str(preferencesKey, 300)) + ":" + encodeURIComponent(str(projectKey, 300));
  }
  function load(storage, preferencesKey, projectKey) {
    try {
      var raw = storage.getItem(storageKey(preferencesKey, projectKey));
      if (raw == null) return defaults();
      var parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? normalize(parsed) : defaults();
    } catch (_) { return defaults(); }
  }
  function save(storage, preferencesKey, projectKey, teams) {
    var value = normalize(teams);
    storage.setItem(storageKey(preferencesKey, projectKey), JSON.stringify(value));
    return value;
  }
  function forUser(input, identifiers) {
    var ids = unique(identifiers, 20, 160);
    return normalize(input).filter(function(team) {
      return team.members.some(function(member) {
        return [member.id].concat(member.identifiers).some(function(id) { return ids.indexOf(id) >= 0; });
      });
    });
  }
  function forRole(input, role) {
    var wanted = str(role, 80).toUpperCase();
    return wanted ? normalize(input).filter(function(team) {
      return team.roles.some(function(alias) { return alias.toUpperCase() === wanted; });
    }) : [];
  }
  function assignUser(input, user, teamId) {
    var list = normalize(input), id = str(user && user.id, 160);
    if (!id) throw new Error("Нужен идентификатор пользователя Jira");
    if (teamId && !list.some(function(team) { return team.id === teamId; })) throw new Error("Команда не найдена");
    var identifiers = unique([id].concat(user.identifiers || []), 20, 160);
    // Resolve connected Jira aliases before removing memberships, independent of team order.
    var changed = true;
    while (changed) {
      changed = false;
      list.forEach(function(team) {
        team.members.forEach(function(member) {
          var aliases = [member.id].concat(member.identifiers);
          if (!aliases.some(function(key) { return identifiers.indexOf(key) >= 0; })) return;
          aliases.forEach(function(key) {
            if (identifiers.indexOf(key) < 0) { identifiers.push(key); changed = true; }
          });
        });
      });
    }
    list.forEach(function(team) {
      team.members = team.members.filter(function(member) {
        return ![member.id].concat(member.identifiers).some(function(key) { return identifiers.indexOf(key) >= 0; });
      });
    });
    if (teamId) {
      var target = list.filter(function(team) { return team.id === teamId; })[0];
      if (target.members.length >= 100) throw new Error("В команде уже 100 участников");
      target.members.push({id:id,label:str(user.label,160) || id,identifiers:unique(identifiers,20,160)});
    }
    return list;
  }
  function statusKind(task) {
    var status = str(task.status, 160).toLowerCase();
    var category = str(task.statusCategory, 80).toLowerCase();
    var state = str(task.statusState, 80).toLowerCase();
    if (/cancel|reject|withdrawn|отмен|отклон|аннулир|^снят[аоы]?$/.test(status) || /cancel|reject/.test(state)) return "cancelled";
    var completed = typeof task.done === "boolean" ? task.done : category ? category === "done" : state ? state === "done" : /^(done|complete|completed|closed|resolved|finished|готово|выполнено|выполнена|закрыто|закрыта|завершено|завершена|принято|принята)$/.test(status);
    if (completed) return "done";
    if (/test|qa|тест|провер|испыт/.test(status)) return "testing";
    if (/implement|deploy|rollout|внедр|разверт|передач.*эксплуатац/.test(status)) return "implementation";
    if (/develop|coding|разработ|программир/.test(status)) return "development";
    if (/^(open|new|to do|todo|in progress|progress|active|reopened|blocked|ожидает|открыт|новая|новый|в работе|в процессе|заблокирован)$/.test(status) || /^(new|todo|progress)$/.test(state) || /^(new|indeterminate|in progress)$/.test(category)) return "active";
    return "unknown";
  }
  function matches(task, teams) {
    var role = str(task.role, 80).toUpperCase();
    var identifiers = unique(task.assigneeIdentifiers, 20, 160);
    var roleDirs = Object.create(null), memberDirs = Object.create(null);
    teams.forEach(function(team) {
      if (role && team.roles.some(function(alias) { return alias.toUpperCase() === role; })) roleDirs[team.direction] = true;
      if (identifiers.length && team.members.some(function(member) {
        return member.identifiers.some(function(id) { return identifiers.indexOf(id) >= 0; }) || identifiers.indexOf(member.id) >= 0;
      })) memberDirs[team.direction] = true;
    });
    return { roles: Object.keys(roleDirs), members: Object.keys(memberDirs) };
  }
  function currentWork(row, inputTeams) {
    row = row && typeof row === "object" ? row : {};
    var teams = normalize(inputTeams), warnings = [], byDirection = Object.create(null);
    var details = row.storyDetails && typeof row.storyDetails === "object" ? row.storyDetails : null;
    var parentKey = str(row.jiraKey || row.createdKey || (details && details.key), 160);
    var parent = { key: parentKey, status: details ? str(details.status, 160) : "", assignee: details ? str(details.assignee, 160) : "" };
    var children = (Array.isArray(row.childStatuses) ? row.childStatuses : []).filter(function(child) {
      return !(parentKey && child && str(child.key, 160) === parentKey);
    });
    var seen = Object.create(null), activeChild = false, doneChild = false, unknownChild = false;
    function add(task, direction, basis) {
      if (!byDirection[direction]) byDirection[direction] = [];
      byDirection[direction].push({ key: str(task.key, 160), summary: str(task.summary, 500), status: str(task.status, 160), assignee: str(task.assignee, 160), basis: basis });
    }
    function classify(task, isParent) {
      var kind = statusKind(task), key = str(task.key, 160) || (isParent ? parentKey : "");
      if (kind === "done") { if (!isParent) doneChild = true; return; }
      if (kind === "cancelled") return;
      if (kind === "unknown") { if (!isParent) unknownChild = true; warnings.push((key || "Задача") + ": неизвестный статус"); return; }
      if (!isParent) activeChild = true;
      var evidence = matches(task, teams);
      if (evidence.roles.length && evidence.members.length && evidence.members.some(function(x) { return evidence.roles.indexOf(x) < 0; })) warnings.push(key + ": роль и назначенная команда указывают разные направления");
      if (evidence.roles.length > 1 || evidence.members.length > 1) warnings.push(key + ": несколько направлений команды");
      if (kind !== "active") { add(task, kind, "Явный статус: " + str(task.status, 160)); return; }
      var chosen = evidence.roles.length ? evidence.roles : evidence.members;
      if (chosen.length > 1) { add(task, "other", "Неоднозначная команда"); return; }
      if (chosen.length) { add(task, chosen[0], evidence.roles.length ? "Роль: " + str(task.role, 80) : "Назначен участник команды"); return; }
      if (!isParent) add(task, "other", "Направление неизвестно");
    }
    children.forEach(function(child) {
      if (!child || typeof child !== "object") return;
      var key = str(child.key, 160);
      if (child.linkedToParent === false) { warnings.push((key || "Задача") + ": связь с основной задачей не создана"); return; }
      if (key && seen[key]) return;
      if (key) seen[key] = true;
      classify(child, false);
    });
    if (details) {
      var parentKind = statusKind(details);
      if (parentKind === "done" && activeChild) warnings.push(parentKey + ": основная задача завершена, но есть открытые дочерние задачи");
      if (parentKind !== "active" || !children.length) classify(Object.assign({ key: parentKey }, details), true);
    }
    var groups = directions.filter(function(direction) { return byDirection[direction.id] && byDirection[direction.id].length; }).map(function(direction) {
      return { direction: direction.id, label: direction.label, count: byDirection[direction.id].length, tasks: byDirection[direction.id] };
    });
    var message = groups.length ? "" : (doneChild && !unknownChild ? "Нет подтвержденной передачи в следующую фазу" : "Нет данных о текущей работе");
    return { groups: groups, message: message, warnings: warnings, parent: parent };
  }
  return { directions: directions, colors: colors, defaults: defaults, normalize: normalize, storageKey: storageKey, load: load, save: save, currentWork: currentWork, forUser: forUser, forRole: forRole, assignUser: assignUser, statusKind: statusKind };
});
