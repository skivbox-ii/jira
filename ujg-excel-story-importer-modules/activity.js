define("_ujgESI_activity", ["_ujgESI_teams","_ujgESI_remarkId"], function(teamsModule,sourceRemarkId) {
  "use strict";
  function str(value) { return value == null ? "" : String(value).trim(); }
  function key(value) { return str(value).toUpperCase(); }
  function timestamp(value) {
    var raw = str(value);
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$/.test(raw)) return "";
    var date = new Date(raw.slice(0, 10) + "T00:00:00Z");
    if (!isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== raw.slice(0, 10) || +raw.slice(11, 13) > 23 || +raw.slice(14, 16) > 59 || +raw.slice(17, 19) > 59) return "";
    var ms = Date.parse(raw);
    return isFinite(ms) ? new Date(ms).toISOString() : "";
  }
  function day(date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "")) throw new Error("Invalid date");
    var utc = Date.parse(date + "T00:00:00Z");
    if (!isFinite(utc) || new Date(utc).toISOString().slice(0, 10) !== date) throw new Error("Invalid date");
    return {date:date,start:utc - 10800000,end:utc + 75600000};
  }
  function today(now) {
    var ms = now == null ? Date.now() : new Date(now).getTime();
    if (!isFinite(ms)) throw new Error("Invalid now");
    return new Date(ms + 10800000).toISOString().slice(0, 10);
  }
  function person(user) {
    if (!user) return {label:"",identifiers:[],color:""};
    var ids = [user.accountId,user.key,user.name,user.username].map(str).filter(Boolean);
    return {label:str(user.displayName || user.label || user.name || user.key || user.accountId),identifiers:ids.filter(function(id,i) { return ids.indexOf(id) === i; }),color:""};
  }
  function same(a,b) {
    if (a.id && b.id) return a.id === b.id;
    return !!a.name && !!b.name && a.name.toLowerCase() === b.name.toLowerCase();
  }
  function sameAssignee(a,b) {
    if (!a.id && !a.name || !b.id && !b.name) return !a.id && !a.name && !b.id && !b.name;
    return same(a,b);
  }
  function state(id,name,category) { return {id:str(id),name:str(name),category:str(category).toLowerCase()}; }
  function value(item,side) { return state(item[side],item[side + "String"],""); }
  function fieldName(item) {
    var name = str(item.fieldId || item.field).toLowerCase();
    return name === "status" ? "status" : name === "assignee" ? "assignee" : str(item.field || item.fieldId);
  }
  function capture(issue) {
    issue = issue || {};
    var fields = issue.fields || {}, log = issue.changelog || {}, raw = log.histories;
    var result = {complete:false,capturedAt:new Date().toISOString(),created:timestamp(fields.created),updated:timestamp(fields.updated),
      currentStatus:state(fields.status && fields.status.id,fields.status && fields.status.name,fields.status && fields.status.statusCategory && fields.status.statusCategory.key),
      currentAssignee:person(fields.assignee),creator:person(fields.creator),histories:[],warnings:[]};
    function warn(message) { if (result.warnings.indexOf(message) < 0) result.warnings.push(message); }
    if (!result.created) warn("Дата создания Jira недоступна или недостоверна");
    if (!result.currentStatus.name) warn("Текущий статус Jira недоступен");
    if (result.updated && result.created && result.updated < result.created) warn("Дата обновления раньше создания");
    if (!Array.isArray(raw)) { warn("История Jira недоступна"); return result; }
    var hasTotal = log.total != null, countValid = hasTotal && /^\d+$/.test(String(log.total)) && +log.total === raw.length;
    if (log.startAt !== 0 || log.isLast === false || !(hasTotal ? countValid : log.isLast === true)) warn("Полнота истории Jira не подтверждена");
    var ids = Object.create(null), disputed = Object.create(null);
    raw.forEach(function(h,index) {
      if (!h || !Array.isArray(h.items)) { warn("Поврежденная запись истории Jira"); return; }
      if (h.id != null) {
        var signature = JSON.stringify([h.created,person(h.author),h.items]);
        if (ids[str(h.id)]) {
          warn("Повторный ID истории Jira");
          if (ids[str(h.id)] !== signature) disputed[str(h.id)] = true;
          return;
        }
        ids[str(h.id)] = signature;
      }
      var at = timestamp(h.created);
      if (!at) warn("Недостоверное время истории Jira или нет часового пояса");
      if (at && result.created && at < result.created) warn("Изменение раньше создания Jira");
      // Jira Server search truncates updated milliseconds (JRASERVER-28238).
      if (at && result.updated && at > result.updated && (Date.parse(result.updated) % 1000 !== 0 || Math.floor(Date.parse(at) / 1000) > Math.floor(Date.parse(result.updated) / 1000))) warn("Изменение позже обновления Jira: " + at + " > " + result.updated);
      var items = [];
      h.items.forEach(function(item,indexInHistory) {
        if (!item || !str(item.field || item.fieldId)) { warn("Поврежденное поле истории Jira"); return; }
        if (fieldName(item) === "status" && (!str(item.from || item.fromString) || !str(item.to || item.toString))) warn("Неполный переход статуса Jira");
        items.push({field:fieldName(item),from:str(item.fromString),to:str(item.toString),fromId:str(item.from),toId:str(item.to),index:indexInHistory});
      });
      if (at) result.histories.push({id:str(h.id) || "index:" + index,at:at,author:person(h.author),items:items});
    });
    result.histories = result.histories.filter(function(h) { return !disputed[h.id]; });
    result.histories.sort(function(a,b) { return Date.parse(a.at) - Date.parse(b.at) || a.id.localeCompare(b.id); });
    ["status","assignee"].forEach(function(field) {
      var changes = [];
      result.histories.forEach(function(h) { h.items.forEach(function(item) { if (item.field === field) changes.push({at:h.at,item:item}); }); });
      for (var i=1;i<changes.length;i++) {
        if (changes[i].at === changes[i-1].at) warn("Неоднозначный порядок переходов");
        var previous = changes[i-1].item, current = changes[i].item;
        var equal = field === "assignee" ? sameAssignee : same;
        if (!equal(state(previous.toId,previous.to),state(current.fromId,current.from))) warn("Несогласованная цепочка " + field);
      }
      if (!changes.length) return;
      var last = changes[changes.length-1].item;
      var currentValue = field === "status" ? result.currentStatus : state(result.currentAssignee.identifiers[0],result.currentAssignee.label);
      var matchesCurrent = field === "status" ? same(state(last.toId,last.to),currentValue) :
        last.toId ? result.currentAssignee.identifiers.indexOf(last.toId) >= 0 : sameAssignee(state(last.toId,last.to),currentValue);
      if (!matchesCurrent) warn("Последний переход не совпадает с текущим " + field);
    });
    result.complete = result.warnings.length === 0;
    return result;
  }
  function kind(status) {
    var name = str(status && status.name).toLowerCase(), category = str(status && status.category).toLowerCase();
    if (/cancel|reject|withdrawn|отмен|отклон|аннулир|^снят[аоы]?$/.test(name)) return "cancelled";
    if (category === "done") return "done";
    if (["new","indeterminate","in progress"].indexOf(category) >= 0) return "open";
    if (/^(done|complete|completed|closed|resolved|finished|готово|выполнено|выполнена|закрыто|закрыта|завершено|завершена|принято|принята)$/.test(name)) return "done";
    if (/^(open|new|to do|todo|backlog|in progress|in review|review|progress|active|reopened|blocked|testing|in testing|qa|ready for testing|открыто|открыт|открыта|новая|новый|в работе|в процессе|на проверке|проверка|заблокирован|тестирование|на тестировании|выдано|к выполнению|готово к тестированию)$/.test(name)) return "open";
    return "unknown";
  }
  function assigneeFrom(item,side) {
    return {label:str(item[side]),identifiers:item[side + "Id"] ? [str(item[side + "Id"])] : [],color:""};
  }
  function groupId(row,index) {
    var jira = key(row.createdKey || row.jiraKey || row.storyDetails && row.storyDetails.key);
    return jira ? "jira:" + jira : "source:" + (str(row.id) || index);
  }
  function remarkId(row) {
    var source = sourceRemarkId(row);
    if (source) return source;
    var summary = str(row.storyDetails && row.storyDetails.summary || row.summary);
    var prefix = /^(?:№|#)?\s*(\d+)(?:[. ]|$)/.exec(summary);
    return prefix ? prefix[1] : key(row.createdKey || row.jiraKey || row.storyDetails && row.storyDetails.key);
  }
  function teamFor(teams,personValue) {
    var ids = personValue && personValue.identifiers || [];
    if (!ids.length && !str(personValue && personValue.label)) return "Не назначен";
    var matches = teams.filter(function(team) { return team.members.some(function(member) {
      return [member.id].concat(member.identifiers).some(function(id) { return ids.indexOf(id) >= 0; });
    }); });
    return matches.length === 1 ? matches[0].name : matches.length > 1 ? "Неоднозначная команда" : "Команда неизвестна";
  }
  function teamColor(teams,ids) {
    var matches = teams.filter(function(team) { return team.members.some(function(member) {
      return [member.id].concat(member.identifiers).some(function(id) { return ids.indexOf(id) >= 0; });
    }); });
    return matches.length === 1 ? matches[0].color : "";
  }
  function summarize(sourceRows,inputTeams,options) {
    options = options || {};
    var window = day(options.date || today(options.now)), now = options.now == null ? Date.now() : new Date(options.now).getTime();
    if (!isFinite(now)) throw new Error("Invalid now");
    var endpoint = Math.min(window.end,now), teams = teamsModule.normalize(inputTeams), grouped = Object.create(null), order = [], issues = Object.create(null), conflicts = [];
    function fingerprint(snapshot) {
      if (!snapshot) return "";
      return JSON.stringify([snapshot.complete,snapshot.created,snapshot.updated,snapshot.currentStatus,snapshot.currentAssignee,snapshot.histories]);
    }
    (sourceRows || []).forEach(function(row,index) {
      if (!row) return;
      var id = groupId(row,index);
      if (!grouped[id]) { grouped[id] = {id:id,remarkId:remarkId(row),key:key(row.createdKey || row.jiraKey || row.storyDetails && row.storyDetails.key),summary:str(row.summary),tasks:[],uncreated:false}; order.push(grouped[id]); }
      var group = grouped[id];
      if (!group.key) group.uncreated = true;
      if (row.status === "partial") group.missing = true;
      var parentDetails = row.storyDetails || row.activityDetails;
      var tasks = parentDetails ? [Object.assign({role:""},parentDetails)] : [];
      if (group.key && !row.storyDetails) group.missing = true;
      (row.childStatuses || []).forEach(function(child) { if (child && child.linkedToParent !== false) tasks.push(child); else group.missing = true; });
      tasks.forEach(function(task) {
        var taskKey = key(task.key);
        if (!taskKey) { group.missing = true; return; }
        if (group.tasks.indexOf(taskKey) < 0) group.tasks.push(taskKey);
        if (!issues[taskKey]) issues[taskKey] = {key:taskKey,task:task,snapshot:task.activity,groups:[]};
        else if (fingerprint(issues[taskKey].snapshot) !== fingerprint(task.activity) && conflicts.indexOf(taskKey) < 0) conflicts.push(taskKey);
        if (issues[taskKey].groups.indexOf(group) < 0) issues[taskKey].groups.push(group);
      });
    });
    var events = [], warnings = [], issueKeys = Object.keys(issues), states = Object.create(null), transitions = Object.create(null), transfers = Object.create(null), statusMeta = Object.create(null);
    order.forEach(function(group) {
      var parent = issues[group.key], links = parent && parent.snapshot && parent.snapshot.linkedKeys;
      if (!Array.isArray(links)) return;
      var loaded = group.tasks.filter(function(taskKey) { return taskKey !== group.key; }).sort();
      if (JSON.stringify(links.map(key).sort()) !== JSON.stringify(loaded)) {
        group.missing = true;
        warnings.push(group.key + ": Связи задач изменились; синхронизируйте реестр.");
      }
    });
    if (now >= window.start && now < window.end) issueKeys.forEach(function(issueKey) {
      var snap = issues[issueKey].snapshot, captured = snap && Date.parse(snap.capturedAt);
      if (isFinite(captured)) endpoint = Math.min(endpoint,captured);
    });
    if (options.scopeWarning) warnings.push(str(options.scopeWarning));
    conflicts.forEach(function(issueKey) { warnings.push(issueKey + ": противоречивые снимки Jira в разных замечаниях"); });
    if (now <= window.start) warnings.push("Выбранный день еще не начался");
    if (endpoint < window.start) warnings.push("Срез истории сделан до начала выбранного дня");
    issueKeys.forEach(function(issueKey) {
      var entry = issues[issueKey], snap = entry.snapshot;
      if (conflicts.indexOf(issueKey) >= 0) return;
      if (!snap) { warnings.push(issueKey + ": история Jira не загружена"); return; }
      if (!snap.complete) warnings.push(issueKey + ": история Jira неполна" + (snap.warnings && snap.warnings.length ? " (" + snap.warnings.join("; ") + ")" : ""));
      var captured = Date.parse(snap.capturedAt);
      if (!isFinite(captured) || captured < endpoint) warnings.push(issueKey + ": снимок истории сделан до конца выбранного периода");
      var current = snap.currentStatus || state("",entry.task.status,entry.task.statusCategory), currentPerson = snap.currentAssignee || {label:entry.task.assignee,identifiers:entry.task.assigneeIdentifiers || [],color:""};
      var status = state(current.id,current.name,current.category), assignee = currentPerson;
      function statusAt(id,name) { return state(id,name,id && id === current.id ? current.category : ""); }
      var all = [];
      (snap.histories || []).forEach(function(h) { (h.items || []).forEach(function(item) { all.push({h:h,item:item}); }); });
      all.sort(function(a,b) { return Date.parse(a.h.at) - Date.parse(b.h.at) || a.h.id.localeCompare(b.h.id) || a.item.index - b.item.index; });
      for (var i=all.length-1;i>=0;i--) {
        var change = all[i];
        if (Date.parse(change.h.at) < endpoint) break;
        if (change.item.field === "status") status = statusAt(change.item.fromId,change.item.from);
        if (change.item.field === "assignee") assignee = assigneeFrom(change.item,"from");
      }
      var endStatus = status, endPerson = assignee;
      for (;i>=0;i--) {
        change = all[i];
        if (Date.parse(change.h.at) < window.start) break;
        if (change.item.field === "status") status = statusAt(change.item.fromId,change.item.from);
        if (change.item.field === "assignee") assignee = assigneeFrom(change.item,"from");
      }
      states[issueKey] = {start:status,end:endStatus,startPerson:assignee,birthStatus:status,birthPerson:assignee};
      if (snap.created && Date.parse(snap.created) >= endpoint) states[issueKey].end = null;
      var eventAssignee = assignee;
      all.forEach(function(change) {
        var at = Date.parse(change.h.at), item = change.item;
        if (at < window.start || at >= endpoint) return;
        if (str(item.field).toLowerCase() === "worklogid" && change.h.items.some(function(sibling) { return /^(timespent|timeestimate)$/i.test(sibling.field); })) return;
        var fromAssignee = item.field === "assignee" ? assigneeFrom(item,"from") : eventAssignee;
        var toAssignee = item.field === "assignee" ? assigneeFrom(item,"to") : eventAssignee;
        var event = {id:issueKey + ":" + change.h.id + ":" + item.index,at:change.h.at,kind:item.field === "status" || item.field === "assignee" ? item.field : "field",field:item.field,
          issueKey:issueKey,summary:str(entry.task.summary),role:str(entry.task.role),from:item.from,to:item.to,fromId:item.fromId,toId:item.toId,author:change.h.author || person(null),assignee:toAssignee,
          fromAssignee:fromAssignee,toAssignee:toAssignee,fromTeam:teamFor(teams,fromAssignee),toTeam:teamFor(teams,toAssignee),color:"",roleColor:""};
        events.push(event);
        if (item.field === "status") statusMeta[event.id] = statusAt(item.toId,item.to);
        eventAssignee = toAssignee;
      });
      if (snap.created) {
        var created = Date.parse(snap.created);
        if (created >= window.start && created < endpoint) events.push({id:issueKey + ":created",at:snap.created,kind:"created",field:"created",issueKey:issueKey,summary:str(entry.task.summary),role:str(entry.task.role),from:"",to:"",author:snap.creator || person(null),assignee:states[issueKey].birthPerson,fromAssignee:person(null),toAssignee:states[issueKey].birthPerson,fromTeam:"Команда неизвестна",toTeam:teamFor(teams,states[issueKey].birthPerson),color:"",roleColor:""});
      }
      if (snap.created && Date.parse(snap.created) >= window.start) states[issueKey].start = null;
    });
    events.sort(function(a,b) { return Date.parse(a.at) - Date.parse(b.at) || a.id.localeCompare(b.id); });
    events.forEach(function(event) {
      ["author","assignee","fromAssignee","toAssignee"].forEach(function(field) {
        var value = event[field] || person(null);
        event[field] = {label:value.label,identifiers:value.identifiers || [],color:teamColor(teams,value.identifiers || [])};
      });
      event.color = event.assignee.color;
      var role = str(event.role).toUpperCase();
      var roleTeams = teams.filter(function(team) { return team.roles.some(function(alias) { return alias.toUpperCase() === role; }); });
      event.roleColor = role && roleTeams.length === 1 ? roleTeams[0].color : "";
    });
    var groups = order.map(function(group) {
      var parent = issues[group.key], parentStatus = parent && parent.snapshot && parent.snapshot.currentStatus && parent.snapshot.currentStatus.name || parent && parent.task.status;
      var groupEvents = events.filter(function(event) { return group.tasks.indexOf(event.issueKey) >= 0; });
      var outcomes = {completed:Object.create(null),created:Object.create(null),reopened:Object.create(null)};
      var active = Object.create(null), unchangedStatus = Object.create(null);
      groupEvents.forEach(function(event) {
        var changed = event.kind === "created" || str(event.field).toLowerCase() === "worklogid" || event.from !== event.to || !!(event.fromId && event.toId && event.fromId !== event.toId);
        if (changed) active[event.issueKey] = true;
        if (event.kind === "status" && !changed) unchangedStatus[event.issueKey] = true;
        if (event.kind === "created") outcomes.created[event.issueKey] = true;
        if (event.kind !== "status" || !event.from || !event.to || !changed) return;
        var before = kind(state("",event.from)), after = kind(statusMeta[event.id] || state("",event.to));
        if (before === "open" && after === "done") outcomes.completed[event.issueKey] = true;
        if (before === "done" && after === "open") outcomes.reopened[event.issueKey] = true;
      });
      return {id:group.id,remarkId:group.remarkId,key:group.key,summary:group.summary,events:groupEvents,
        currentStatus:parentStatus || null,currentStatusKind:parentStatus ? kind(parent && parent.snapshot && parent.snapshot.currentStatus || state("",parentStatus,parent && parent.task.statusCategory)) : "unknown",
        linkedTaskCount:group.tasks.filter(function(taskKey) { return taskKey !== group.key; }).length,
        dayActivityCount:Object.keys(active).length,dayNoopStatusCount:Object.keys(unchangedStatus).length,
        dayHighlights:{completed:Object.keys(outcomes.completed).length,created:Object.keys(outcomes.created).length,reopened:Object.keys(outcomes.reopened).length}};
    });
    var complete = warnings.length === 0 && order.every(function(group) { return !group.missing; });
    if (order.some(function(group) { return group.missing; })) warnings.push("У части замечаний нет полных данных о связанных задачах");
    var changed = Object.create(null), newRemarks = Object.create(null), completed = Object.create(null), reopened = Object.create(null), balanceStart = 0, balanceEnd = 0;
    order.forEach(function(group) {
      var groupEvents = events.filter(function(event) { return group.tasks.indexOf(event.issueKey) >= 0; });
      if (groupEvents.length) changed[group.id] = true;
      if (group.key && events.some(function(event) { return event.issueKey === group.key && event.kind === "created"; })) newRemarks[group.id] = true;
      function readiness(atEnd) {
        if (group.uncreated) return false;
        var values = group.tasks.map(function(taskKey) { var s = states[taskKey]; return s && (atEnd ? s.end : s.start); });
        if (values.some(function(value) { return value && kind(value) === "unknown"; })) return null;
        return values.length > 0 && values.every(function(value) { return kind(value) === "done"; });
      }
      var first = readiness(false), last = readiness(true);
      function openAt(atEnd) {
        if (group.uncreated) return false;
        var values = group.tasks.map(function(taskKey) { var s = states[taskKey]; return s && (atEnd ? s.end : s.start); });
        if (values.some(function(value) { return value && kind(value) === "unknown"; })) return null;
        return values.some(function(value) { return value && kind(value) === "open"; });
      }
      if (openAt(false) === true) balanceStart++;
      if (openAt(true) === true) balanceEnd++;
      if (first === null || last === null || openAt(false) === null || openAt(true) === null) warnings.push(group.key + ": статус не удалось классифицировать");
      // Co-timed changes have no provable order across issues: evaluate them atomically.
      var live = Object.create(null);
      group.tasks.forEach(function(taskKey) { live[taskKey] = states[taskKey] && states[taskKey].start; });
      function liveReady() {
        var values = group.tasks.map(function(taskKey) { return live[taskKey]; });
        return values.some(function(value) { return !value || kind(value) === "unknown"; }) ? null : values.every(function(value) { return kind(value) === "done"; });
      }
      var batches = Object.create(null);
      groupEvents.forEach(function(event) {
        if (event.kind !== "created" && event.kind !== "status") return;
        if (!batches[event.at]) batches[event.at] = [];
        batches[event.at].push(event);
      });
      Object.keys(batches).sort().forEach(function(at) {
        var batch = batches[at];
        batch.filter(function(event) { return event.kind === "created"; }).forEach(function(event) {
          live[event.issueKey] = states[event.issueKey] && states[event.issueKey].birthStatus;
        });
        var prior = liveReady();
        batch.filter(function(event) { return event.kind === "status"; }).forEach(function(event) {
          live[event.issueKey] = statusMeta[event.id] || state("",event.to,"");
        });
        var next = liveReady();
        if (prior === false && next === true) completed[group.id] = true;
        if (prior === true && next === false && group.tasks.some(function(taskKey) { return kind(live[taskKey]) === "open"; })) reopened[group.id] = true;
      });
    });
    events.forEach(function(event) {
      if (event.kind === "status" && event.from !== event.to) { var label = event.from + " → " + event.to; transitions[label] = (transitions[label] || 0) + 1; }
      if (event.kind === "assignee" && event.fromTeam !== event.toTeam) { var move = event.fromTeam + " → " + event.toTeam; transfers[move] = (transfers[move] || 0) + 1; }
    });
    function pairs(map) { return Object.keys(map).sort().map(function(label) { var parts = label.split(" → "); return {from:parts[0],to:parts[1],count:map[label]}; }); }
    complete = warnings.length === 0;
    function usable(issueKey) {
      var snap = issues[issueKey].snapshot;
      return now > window.start && endpoint >= window.start && conflicts.indexOf(issueKey) < 0 && snap && snap.complete && isFinite(Date.parse(snap.capturedAt)) && Date.parse(snap.capturedAt) >= endpoint;
    }
    groups.forEach(function(group,index) { group.dayComplete = !order[index].missing && order[index].tasks.every(usable); });
    var counted = {complete:issueKeys.filter(usable).length,total:issueKeys.length,
      incomplete:issueKeys.filter(function(issueKey) { return !usable(issueKey); }).length,
      uncreated:order.filter(function(group) { return group.uncreated; }).length,warnings:warnings,isComplete:complete};
    return {date:window.date,start:window.start,end:window.end,asOf:now <= window.start || endpoint < window.start ? null : new Date(endpoint).toISOString(),generatedAt:new Date(now).toISOString(),timezone:"МСК",coverage:counted,
      metrics:{changed:complete ? Object.keys(changed).length : null,newRemarks:complete ? Object.keys(newRemarks).length : null,completed:complete ? Object.keys(completed).length : null,reopened:complete ? Object.keys(reopened).length : null,events:events.length},
      observed:{changed:Object.keys(changed).length,newRemarks:Object.keys(newRemarks).length},
      balance:{startOpen:complete ? balanceStart : null,endOpen:complete ? balanceEnd : null},transitions:pairs(transitions),transfers:pairs(transfers),groups:groups,events:events,teams:teams};
  }
  function escape(value) { return str(value).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;"); }
  function msk(value) {
    var ms = Date.parse(value);
    if (!isFinite(ms)) return str(value);
    var stamp = new Date(ms + 10800000).toISOString();
    return stamp.slice(8,10) + "." + stamp.slice(5,7) + "." + stamp.slice(0,4) + " " + stamp.slice(11,16) + " МСК";
  }
  function metadata(value) {
    if (value == null) return "не задано";
    try { return JSON.stringify(value); } catch (_) { return "недоступно"; }
  }
  function statusLabel(value) {
    var name = str(value);
    var labels = {"open":"Открыто","new":"Новое","to do":"К выполнению","todo":"К выполнению","backlog":"В очереди",
      "in progress":"В работе","in review":"На проверке","review":"На проверке","reopened":"Возвращено в работу","blocked":"Заблокировано",
      "testing":"На тестировании","in testing":"На тестировании","ready for testing":"Готово к тестированию",
      "done":"Выполнено","complete":"Выполнено","completed":"Выполнено","finished":"Выполнено","resolved":"Решено","closed":"Закрыто",
      "cancelled":"Отменено","canceled":"Отменено","rejected":"Отклонено","accepted":"Принято","unresolved":"Не решено"};
    return labels[name.toLowerCase()] || name || "Статус не указан";
  }
  function duration(value) {
    var raw = str(value);
    if (!/^\d+(?:\.\d+)?$/.test(raw)) return raw || "не задано";
    var seconds = Number(raw), hours = Math.floor(seconds / 3600), minutes = Math.floor(seconds % 3600 / 60), rest = Math.round(seconds % 60);
    return [hours ? hours + " ч" : "",minutes ? minutes + " мин" : "",rest ? rest + " с" : ""].filter(Boolean).join(" ") || "0 мин";
  }
  function eventText(event) {
    event = event || {};
    var from = str(event.from), to = str(event.to), field = str(event.field).toLowerCase();
    if (event.kind === "created") return "Создана задача";
    if (event.kind === "status") {
      if (from && from === to) return "Статус не изменился: " + statusLabel(to);
      var destination = statusLabel(to), action = "Изменён статус";
      if (/^(done|complete|completed|finished|готово|выполнено|выполнена)$/.test(to.toLowerCase())) action = "Задача выполнена";
      else if (/^(in progress|в работе)$/.test(to.toLowerCase())) action = kind(state("",from)) === "done" ? "Возвращена в работу" : "Взята в работу";
      else if (/^(in review|review|на проверке)$/.test(to.toLowerCase())) action = "Передана на проверку";
      else if (/^(testing|in testing|тестирование|на тестировании)$/.test(to.toLowerCase())) action = "Передана на тестирование";
      else if (/^(closed|закрыто|закрыта)$/.test(to.toLowerCase())) action = "Задача закрыта";
      else if (/cancel|отмен|^снят/.test(to.toLowerCase())) action = "Задача отменена";
      return action + " · " + statusLabel(from) + " → " + destination;
    }
    if (event.kind === "assignee") {
      if (!to) return from ? "Снято назначение: " + from : "Исполнитель не назначен";
      return from ? "Передано: " + from + " → " + to : "Назначен исполнитель: " + to;
    }
    if (field === "worklogid") return "Обновлена запись трудозатрат";
    if (field === "timespent") {
      if (!from && to) return "Указаны трудозатраты: " + duration(to);
      if (/^\d+(?:\.\d+)?$/.test(from) && /^\d+(?:\.\d+)?$/.test(to) && Number(to) > Number(from)) return "Учтено " + duration(String(Number(to) - Number(from))) + " работы · всего " + duration(to);
      return "Скорректированы трудозатраты: " + duration(from) + " → " + duration(to);
    }
    if (field === "timeestimate" || field === "timeoriginalestimate") return (field === "timeestimate" ? "Оставшаяся оценка: " : "Исходная оценка: ") + duration(from) + " → " + duration(to);
    if (field === "resolution") {
      if (!from && to) return "Установлен результат: " + statusLabel(to);
      if (from && !to) return "Сброшен результат: " + statusLabel(from);
      return "Результат: " + (from ? statusLabel(from) : "не задан") + " → " + (to ? statusLabel(to) : "не задан");
    }
    if (field === "link") {
      function linkLabel(value) {
        return value.replace(/^This issue\s+/i,"")
          .replace(/^is (?:a )?child of\s+/i,"дочерняя задача для ")
          .replace(/^is (?:a )?parent of\s+/i,"родительская задача для ")
          .replace(/^is cloned by\s+/i,"скопирована в ")
          .replace(/^clones\s+/i,"копия задачи ");
      }
      if (!from && to) return "Добавлена связь: " + linkLabel(to);
      if (from && !to) return "Удалена связь: " + linkLabel(from);
      return "Изменена связь: " + linkLabel(from) + " → " + linkLabel(to);
    }
    var names = {priority:"Приоритет",summary:"Тема",description:"Описание",labels:"Метки",component:"Компоненты",components:"Компоненты",fixversion:"Версия исправления",fixversions:"Версия исправления",version:"Версия",versions:"Версии",duedate:"Срок",attachment:"Вложение",link:"Связь задач",reporter:"Автор задачи",issuetype:"Тип задачи",sprint:"Спринт","epic link":"Эпик","story points":"Оценка сложности"};
    return "Изменено поле «" + (names[field] || str(event.field) || "Данные задачи") + "»: " + (from || "не задано") + " → " + (to || "очищено");
  }
  function exportHtml(report,context) {
    context = context || {};
    var warnings = report.coverage && report.coverage.warnings || [];
    var html = '<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Активность ' + escape(report.date) + '</title><style>body{font:14px system-ui;margin:2rem;max-width:80rem;color:#24313a}table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #ddd;padding:.5rem;text-align:left;vertical-align:top}small{color:#59666e}pre{white-space:pre-wrap;overflow-wrap:anywhere}details{margin:1rem 0}</style></head><body>';
    html += '<h1>Активность за ' + escape(report.date) + ' МСК</h1><p>Проект: ' + escape(context.projectKey) + ' · Эпик: ' + escape(context.epicKey) + '</p>';
    html += '<p>Сформировано: ' + escape(msk(report.generatedAt)) + ' · Срез на: ' + escape(report.asOf ? msk(report.asOf) : '—') + ' · Покрытие: ' + escape(report.coverage && report.coverage.complete) + '/' + escape(report.coverage && report.coverage.total) + '</p>';
    html += '<p><small>Текущие связи задач и текущая локальная карта команд. Исторический состав связей и команд не восстанавливается.</small></p>';
    html += '<p>Фильтры журнала: <code>' + escape(metadata(context.filters)) + '</code> · Сортировка: <code>' + escape(metadata(context.sort)) + '</code></p>';
    if (warnings.length) {
      html += '<details><summary>Предупреждения (' + warnings.length + ')</summary><ul>';
      warnings.forEach(function(warning) { html += '<li>' + escape(warning) + '</li>'; });
      html += '</ul></details>';
    }
    html += '<h2>Итоги</h2><table><tbody>';
    [["changed","Изменённые замечания"],["newRemarks","Новые замечания"],["completed","Завершённые"],["reopened","Переоткрытые"],["events","Наблюдаемые события"]].forEach(function(pair) { html += '<tr><th>' + pair[1] + '</th><td>' + escape(report.metrics && report.metrics[pair[0]] == null ? '—' : report.metrics[pair[0]]) + '</td></tr>'; });
    if (report.coverage && !report.coverage.isComplete && report.observed) html += '<tr><th>Зафиксировано: изменённые / новые</th><td>≥' + escape(report.observed.changed) + ' / ≥' + escape(report.observed.newRemarks) + '</td></tr>';
    html += '</tbody></table><h2>Баланс</h2><p>Открыто в начале: ' + escape(report.balance && report.balance.startOpen == null ? '—' : report.balance && report.balance.startOpen) + '; в конце: ' + escape(report.balance && report.balance.endOpen == null ? '—' : report.balance && report.balance.endOpen) + '</p>';
    [["Переходы статусов",report.transitions],["Передачи между командами",report.transfers]].forEach(function(section) {
      html += '<h2>' + section[0] + '</h2>';
      var entries = section[1] || [], names = Object.create(null), counts = Object.create(null);
      entries.forEach(function(item) { names[item.from] = true; names[item.to] = true; counts[JSON.stringify([item.from,item.to])] = item.count; });
      var parties = Object.keys(names).sort();
      function display(name) { return escape(section[0] === "Переходы статусов" ? statusLabel(name) : name); }
      if (!parties.length) { html += '<p>Нет зафиксированных переходов</p>'; return; }
      html += '<table aria-label="' + section[0] + '"><thead><tr><th scope="col">Из → В</th>';
      parties.forEach(function(name) { html += '<th scope="col">' + display(name) + '</th>'; });
      html += '</tr></thead><tbody>';
      parties.forEach(function(from) {
        html += '<tr><th scope="row">' + display(from) + '</th>';
        parties.forEach(function(to) { html += '<td>' + escape(counts[JSON.stringify([from,to])] || '—') + '</td>'; });
        html += '</tr>';
      });
      html += '</tbody></table>';
    });
    html += '<h2>Команды на момент снимка</h2><ul>';
    (report.teams || []).forEach(function(team) { html += '<li>' + escape(team.name) + ' (' + escape(team.id) + '): ' + escape((team.members || []).map(function(member) { return member.label + ' [' + member.identifiers.join(', ') + ']'; }).join('; ')) + '</li>'; });
    html += '</ul><h2>Журнал</h2>';
    (report.groups || []).forEach(function(group) { html += '<h3>' + escape(group.remarkId) + ' ' + escape(group.key) + ' ' + escape(group.summary) + '</h3>';
      if (group.dayHighlights) {
        var highlights = [];
        if (group.dayHighlights.completed) highlights.push('Завершено ' + group.dayHighlights.completed);
        if (group.dayHighlights.created) highlights.push('Создано ' + group.dayHighlights.created);
        if (group.dayHighlights.reopened) highlights.push('Возвращено ' + group.dayHighlights.reopened);
        if (!highlights.length && group.dayActivityCount) highlights.push('Изменено ' + group.dayActivityCount);
        if (!highlights.length && group.dayNoopStatusCount) highlights.push('Статус без изменений');
        if (!highlights.length && group.dayComplete) highlights.push('Без изменений');
        if (!group.dayComplete) highlights.push('История неполна');
        html += '<p>Сейчас: ' + escape(statusLabel(group.currentStatus)) + ' · Связанных задач: ' + escape(group.linkedTaskCount) + ' · За день: ' + escape(highlights.join(' · ')) + ' <small>(исходная история и связанные задачи)</small></p>';
      }
      html += '<table><thead><tr><th>Время</th><th>Задача</th><th>Роль</th><th>Что произошло</th><th>Автор</th><th>Исполнитель</th><th>Команда</th></tr></thead><tbody>';
      (group.events || []).forEach(function(event) {
        var assignee = event.kind === "assignee" ? (str(event.fromAssignee && event.fromAssignee.label) || "Не назначен") + ' → ' + (str(event.toAssignee && event.toAssignee.label) || "Не назначен") : str(event.assignee && event.assignee.label) || "Не назначен";
        var team = event.kind === "assignee" && event.fromTeam !== event.toTeam ? str(event.fromTeam) + ' → ' + str(event.toTeam) : str(event.toTeam);
        html += '<tr><td>' + escape(msk(event.at)) + '</td><td>' + escape(event.issueKey) + '<br><small>' + escape(event.summary) + '</small></td><td>' + escape(event.role || "История") + '</td><td>' + escape(eventText(event)) + '</td><td>' + escape(event.author && event.author.label) + '</td><td>' + escape(assignee) + '</td><td>' + escape(team) + '</td></tr>';
      }); html += '</tbody></table>'; });
    return html + '</body></html>';
  }
  return {capture:capture,day:day,today:today,summarize:summarize,exportHtml:exportHtml,statusLabel:statusLabel,eventText:eventText};
});
