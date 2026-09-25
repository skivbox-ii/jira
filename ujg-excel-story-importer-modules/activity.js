define("_ujgESI_activity", ["_ujgESI_teams","_ujgESI_remarkId","_ujgESI_deadlines"], function(teamsModule,sourceRemarkId,deadlines) {
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
  function seconds(value) { return typeof value === "number" && isFinite(value) && value >= 0 ? value : null; }
  function captureEntries(envelope,field,convert) {
    var raw = envelope && envelope[field], entries = [], seen = Object.create(null), valid = !!envelope && Array.isArray(raw) && envelope.startAt === 0 &&
      /^\d+$/.test(String(envelope.total)) && +envelope.total === raw.length && envelope.isLast !== false;
    if (Array.isArray(raw)) raw.forEach(function(value) {
      var id = str(value && value.id);
      if (!id || seen[id]) { valid = false; return; }
      seen[id] = true;
      var entry = convert(value);
      if (!entry) { valid = false; return; }
      if (field === "worklogs" && entry.seconds === null) valid = false;
      if (field === "comments" && entry.updatedInvalid) valid = false;
      entries.push(entry);
    });
    return {entries:entries,complete:valid};
  }
  function capture(issue) {
    issue = issue || {};
    var fields = issue.fields || {}, log = issue.changelog || {}, raw = log.histories;
    var result = {complete:false,capturedAt:new Date().toISOString(),created:timestamp(fields.created),updated:timestamp(fields.updated),
      currentStatus:state(fields.status && fields.status.id,fields.status && fields.status.name,fields.status && fields.status.statusCategory && fields.status.statusCategory.key),
      currentAssignee:person(fields.assignee),creator:person(fields.creator),histories:[],warnings:[],diagnostics:[],spentSeconds:seconds(fields.timespent),
      worklogs:captureEntries(fields.worklog,"worklogs",function(log) {
        var at = timestamp(log && log.started), duration = seconds(log && log.timeSpentSeconds);
        return at ? {id:str(log.id),at:at,author:person(log.author),seconds:duration} : null;
      }),comments:captureEntries(fields.comment,"comments",function(comment) {
        var at = timestamp(comment && comment.created), updatedAt = timestamp(comment && comment.updated);
        return at ? {id:str(comment.id),at:at,updatedAt:updatedAt || null,updatedInvalid:!!str(comment && comment.updated) && !updatedAt,author:person(comment.author),body:str(comment.body)} : null;
      })};
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
      if (at && result.updated && at > result.updated) {
        var difference = "Изменение позже обновления Jira: " + at + " > " + result.updated;
        if (Date.parse(at) - Date.parse(result.updated) < 1000) result.diagnostics.push(difference);
        else warn(difference);
      }
      var items = [];
      h.items.forEach(function(item,indexInHistory) {
        if (!item || !str(item.field || item.fieldId)) { warn("Поврежденное поле истории Jira"); return; }
        if (fieldName(item) === "status" && (!str(item.from || item.fromString) || !str(item.to || item.toString))) warn("Неполный переход статуса Jira");
        items.push({field:fieldName(item),fieldId:str(item.fieldId),from:str(item.fromString),to:str(item.toString),fromId:str(item.from),toId:str(item.to),index:indexInHistory});
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
    if (/^(done|complete|completed|closed|resolved|finished|accepted|готово|выполнено|выполнена|выполнен|закрыто|закрыта|закрыт|завершено|завершена|принято|принята|принят)$/.test(name)) return "done";
    if (/^(open|new|to do|todo|backlog|issued|in progress|in review|review|progress|active|reopened|blocked|testing|in testing|qa|ready for testing|открыто|открыт|открыта|новая|новый|в работе|в процессе|на проверке|проверка|заблокирован|тестирование|на тестировании|выдано|к выполнению|готово к тестированию)$/.test(name)) return "open";
    return "unknown";
  }
  function statusTone(input) {
    var value = typeof input === "string" ? state("",input) : input || {}, category = kind(value), name = str(value.name).toLowerCase();
    if (category !== "open") return category;
    if (/^(in review|review|на проверке|проверка)$/.test(name)) return "review";
    if (/^(testing|in testing|qa|ready for testing|тестирование|на тестировании|готово к тестированию)$/.test(name)) return "testing";
    if (/^(in progress|progress|active|в работе|в процессе)$/.test(name)) return "progress";
    return value.category === "indeterminate" || value.category === "in progress" ? "progress" : "todo";
  }
  function returnKind(event) {
    if (!event || event.kind !== "status" || !event.from || !event.to || event.from === event.to && !(event.fromId && event.toId && event.fromId !== event.toId)) return null;
    var before = event.fromStatus || state("",event.from), after = event.toStatus || state("",event.to);
    if (kind(after) !== "open") return null;
    if (kind(before) === "done") return "reopened";
    if (kind(before) !== "open" || !/^(in progress|progress|active|open|new|to do|todo|backlog|issued|в работе|в процессе|выдано|открыто|к выполнению)$/.test(str(event.to).toLowerCase())) return null;
    var tone = statusTone(before);
    return tone === "review" || tone === "testing" ? tone : null;
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
      return JSON.stringify([snapshot.complete,snapshot.created,snapshot.updated,snapshot.currentStatus,snapshot.currentAssignee,snapshot.histories,
        snapshot.spentSeconds,snapshot.worklogs,snapshot.comments]);
    }
    (sourceRows || []).forEach(function(row,index) {
      if (!row) return;
      var id = groupId(row,index);
      if (!grouped[id]) { grouped[id] = {id:id,remarkId:remarkId(row),key:key(row.createdKey || row.jiraKey || row.storyDetails && row.storyDetails.key),summary:str(row.summary),tasks:[],sourceRows:[],uncreated:false}; order.push(grouped[id]); }
      var group = grouped[id];
      group.sourceRows.push(row);
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
    var events = [], warnings = [], diagnostics = [], issueKeys = Object.keys(issues), states = Object.create(null), transitions = Object.create(null), transfers = Object.create(null), statusMeta = Object.create(null), statusBeforeMeta = Object.create(null);
    order.forEach(function(group) {
      var parent = issues[group.key], links = parent && parent.snapshot && parent.snapshot.linkedKeys;
      if (!Array.isArray(links)) return;
      var loaded = group.tasks.filter(function(taskKey) { return taskKey !== group.key; }).sort();
      if (JSON.stringify(links.map(key).sort()) !== JSON.stringify(loaded)) {
        group.missing = true;
        warnings.push(group.key + ": Связи задач изменились; синхронизируйте реестр.");
      }
    });
    if (now >= window.start && now < window.end) {
      var captures = issueKeys.map(function(issueKey) {
        var snap = issues[issueKey].snapshot;
        return snap ? Date.parse(snap.capturedAt) : NaN;
      }).filter(function(captured) { return isFinite(captured); });
      var currentCaptures = captures.filter(function(captured) { return captured >= window.start; });
      // Older snapshots stay excluded; they must not erase a fresh current-day slice.
      (currentCaptures.length ? currentCaptures : captures).forEach(function(captured) { endpoint = Math.min(endpoint,captured); });
    }
    if (options.scopeWarning) warnings.push(str(options.scopeWarning));
    conflicts.forEach(function(issueKey) { warnings.push(issueKey + ": противоречивые снимки Jira в разных замечаниях"); });
    if (now <= window.start) warnings.push("Выбранный день еще не начался");
    if (endpoint < window.start) warnings.push("Срез истории сделан до начала выбранного дня");
    issueKeys.forEach(function(issueKey) {
      var entry = issues[issueKey], snap = entry.snapshot;
      if (conflicts.indexOf(issueKey) >= 0) return;
      if (!snap) { warnings.push(issueKey + ": история Jira не загружена"); return; }
      (snap.diagnostics || []).forEach(function(message) { diagnostics.push(issueKey + ": " + message); });
      if (!snap.complete) warnings.push(issueKey + ": история Jira неполна" + (snap.warnings && snap.warnings.length ? " (" + snap.warnings.join("; ") + ")" : ""));
      var captured = Date.parse(snap.capturedAt);
      if (!isFinite(captured)) warnings.push(issueKey + ": Время загрузки данных задачи неизвестно; требуется обновление");
      else if (captured < endpoint) warnings.push(issueKey + ": Данные задачи загружены раньше времени среза отчёта; требуется обновление");
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
      states[issueKey] = {start:status,end:endStatus,endPerson:endPerson,startPerson:assignee,birthStatus:status,birthPerson:assignee};
      if (snap.created && Date.parse(snap.created) >= endpoint) states[issueKey].end = null;
      var eventAssignee = assignee;
      all.forEach(function(change) {
        var at = Date.parse(change.h.at), item = change.item;
        if (at < window.start || at >= endpoint) return;
        if (str(item.field).toLowerCase() === "worklogid" && change.h.items.some(function(sibling) { return /^(timespent|timeestimate)$/i.test(sibling.field); })) return;
        var fromAssignee = item.field === "assignee" ? assigneeFrom(item,"from") : eventAssignee;
        var toAssignee = item.field === "assignee" ? assigneeFrom(item,"to") : eventAssignee;
        var event = {id:issueKey + ":" + change.h.id + ":" + item.index,at:change.h.at,kind:item.field === "status" || item.field === "assignee" ? item.field : "field",field:item.field,fieldId:str(item.fieldId),
          issueKey:issueKey,summary:str(entry.task.summary),role:str(entry.task.role),from:item.from,to:item.to,fromId:item.fromId,toId:item.toId,author:change.h.author || person(null),assignee:toAssignee,
          fromAssignee:fromAssignee,toAssignee:toAssignee,fromTeam:teamFor(teams,fromAssignee),toTeam:teamFor(teams,toAssignee),color:"",roleColor:""};
        events.push(event);
        if (item.field === "status") {
          statusBeforeMeta[event.id] = statusAt(item.fromId,item.from);
          statusMeta[event.id] = statusAt(item.toId,item.to);
          event.fromStatus = statusBeforeMeta[event.id];
          event.toStatus = statusMeta[event.id];
          event.returnKind = returnKind(event);
        }
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
        var before = kind(statusBeforeMeta[event.id] || state("",event.from)), after = kind(statusMeta[event.id] || state("",event.to));
        if (before === "open" && after === "done") outcomes.completed[event.issueKey] = true;
        if (before === "done" && after === "open") outcomes.reopened[event.issueKey] = true;
      });
      return {id:group.id,remarkId:group.remarkId,key:group.key,summary:group.summary,events:groupEvents,taskReturns:groupEvents.filter(function(event) { return !!event.returnKind; }),
        currentStatus:parentStatus || null,currentStatusKind:parentStatus ? kind(parent && parent.snapshot && parent.snapshot.currentStatus || state("",parentStatus,parent && parent.task.statusCategory)) : "unknown",
        linkedTaskCount:group.tasks.filter(function(taskKey) { return taskKey !== group.key; }).length,
        dayActivityCount:Object.keys(active).length,dayNoopStatusCount:Object.keys(unchangedStatus).length,
        dayHighlights:{completed:Object.keys(outcomes.completed).length,created:Object.keys(outcomes.created).length,reopened:Object.keys(outcomes.reopened).length}};
    });
    var complete = warnings.length === 0 && order.every(function(group) { return !group.missing; });
    if (order.some(function(group) { return group.missing; })) warnings.push("У части замечаний нет полных данных о связанных задачах");
    var changed = Object.create(null), newRemarks = Object.create(null), completed = Object.create(null), reopened = Object.create(null), balanceStart = 0, balanceEnd = 0;
    order.forEach(function(group,index) {
      var groupEvents = events.filter(function(event) { return group.tasks.indexOf(event.issueKey) >= 0; });
      if (groupEvents.length) changed[group.id] = true;
      if (group.key && events.some(function(event) { return event.issueKey === group.key && event.kind === "created"; })) newRemarks[group.id] = true;
      var management = groups[index].management = {changed:!!changed[group.id],newRemark:!!newRemarks[group.id],completed:[],reopened:[],tasks:[],notes:[]};
      var certified = !group.missing && group.tasks.every(usable);
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
      if (first === null || last === null || openAt(false) === null || openAt(true) === null) {
        group.unknownStatus = true;
        warnings.push(group.key + ": статус не удалось классифицировать");
      }
      // Co-timed changes have no provable order across issues: evaluate them atomically.
      var live = Object.create(null);
      group.tasks.forEach(function(taskKey) { live[taskKey] = states[taskKey] && states[taskKey].start; });
      function liveReady() {
        var values = group.tasks.map(function(taskKey) { return live[taskKey]; });
        return values.some(function(value) { return !value || kind(value) === "unknown"; }) ? null : values.every(function(value) { return kind(value) === "done"; });
      }
      function unknownLive() {
        return group.tasks.some(function(taskKey) { return live[taskKey] && kind(live[taskKey]) === "unknown"; });
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
        if (unknownLive()) group.unknownStatus = true;
        batch.filter(function(event) { return event.kind === "status"; }).forEach(function(event) {
          live[event.issueKey] = statusMeta[event.id] || state("",event.to,"");
        });
        var next = liveReady();
        if (unknownLive()) group.unknownStatus = true;
        var evidence = batch.filter(function(event) { return event.kind === "status"; });
        if (prior === false && next === true) {
          completed[group.id] = true;
          if (certified) management.completed.push({at:at,events:evidence});
        }
        if (prior === true && next === false && group.tasks.some(function(taskKey) { return kind(live[taskKey]) === "open"; })) {
          reopened[group.id] = true;
          if (certified) management.reopened.push({at:at,events:evidence});
        }
      });
      if (group.unknownStatus) {
        warnings.push(group.key + ": промежуточный статус не удалось классифицировать");
        management.completed = [];
        management.reopened = [];
      }
    });
    events.forEach(function(event) {
      if (event.kind === "status" && (event.from !== event.to || event.fromId && event.toId && event.fromId !== event.toId)) { var label = event.from + " → " + event.to; transitions[label] = (transitions[label] || 0) + 1; }
      if (event.kind === "assignee" && event.fromTeam !== event.toTeam) { var move = event.fromTeam + " → " + event.toTeam; transfers[move] = (transfers[move] || 0) + 1; }
    });
    function pairs(map) { return Object.keys(map).sort().map(function(label) { var parts = label.split(" → "); return {from:parts[0],to:parts[1],count:map[label]}; }); }
    complete = warnings.length === 0;
    function usable(issueKey) {
      var snap = issues[issueKey].snapshot;
      return now > window.start && endpoint >= window.start && conflicts.indexOf(issueKey) < 0 && snap && snap.complete && isFinite(Date.parse(snap.capturedAt)) && Date.parse(snap.capturedAt) >= endpoint;
    }
    function activeStatus(value) {
      var name = str(value && value.name);
      if (/^(in progress|in review|review|testing|in testing|qa|ready for testing|в работе|в процессе|на проверке|проверка|тестирование|на тестировании|готово к тестированию)$/i.test(name)) return true;
      if (kind(value) === "done" || kind(value) === "cancelled" || /^(open|new|to do|todo|backlog|reopened|blocked|открыто|открыт|открыта|новая|новый|заблокирован|к выполнению)$/i.test(name)) return false;
      return null;
    }
    function taskReport(issueKey) {
      var entry = issues[issueKey], disputed = conflicts.indexOf(issueKey) >= 0, snap = !disputed && entry && entry.snapshot, notes = [], endState = states[issueKey] && states[issueKey].end;
      var report = {key:issueKey,summary:str(entry && entry.task.summary),role:str(entry && entry.task.role),created:snap && snap.created || null,
        status:endState && endState.name || null,assignee:null,completedAt:null,completedBy:null,dayCompletions:[],elapsedSeconds:null,inProgressSeconds:null,
        spentSeconds:snap ? snap.spentSeconds == null ? null : snap.spentSeconds : null,spentAsOf:snap && timestamp(snap.capturedAt) || null,
        worklogs:[],worklogsComplete:!!(snap && snap.worklogs && snap.worklogs.complete),comments:[],commentsComplete:!!(snap && snap.comments && snap.comments.complete),notes:notes};
      if (!snap || !usable(issueKey)) notes.push("История задачи неполна для выбранного среза");
      if (disputed) notes.push("Противоречивые снимки Jira; детали задачи недоступны");
      if (report.spentSeconds === null) notes.push("Трудозатраты Jira недоступны");
      if (report.spentSeconds !== null && !report.spentAsOf) { report.spentSeconds = null; notes.push("Время снимка трудозатрат недостоверно"); }
      if (snap && report.spentAsOf) notes.push("Трудозатраты и записи работы отражают текущий снимок Jira, не срез выбранного дня");
      if (!report.worklogsComplete) notes.push("Список трудозатрат неполон или недостоверен");
      if (!report.commentsComplete) notes.push("Список комментариев неполон или недостоверен");
      (snap && snap.worklogs && snap.worklogs.entries || []).forEach(function(log) {
        report.worklogs.push({id:log.id,at:log.at,author:log.author,seconds:log.seconds,team:teamFor(teams,log.author),color:teamColor(teams,log.author.identifiers)});
      });
      (snap && snap.comments && snap.comments.entries || []).forEach(function(comment) {
        if (Date.parse(comment.at) >= endpoint) return;
        report.comments.push({id:comment.id,at:comment.at,updatedAt:comment.updatedAt,author:comment.author,body:comment.body});
        if (comment.updatedAt && Date.parse(comment.updatedAt) >= endpoint) notes.push("Комментарий " + comment.id + " редактировался после среза; показан текущий текст");
        if (comment.updatedInvalid) notes.push("Время изменения комментария " + comment.id + " недостоверно");
      });
      if (!usable(issueKey) || !snap.created || Date.parse(snap.created) >= endpoint || !endState) return report;
      report.assignee = states[issueKey].endPerson;
      var changes = [];
      function statusAt(id,name) { return state(id,name,id && id === snap.currentStatus.id ? snap.currentStatus.category : ""); }
      (snap.histories || []).forEach(function(history) { (history.items || []).forEach(function(item) {
        if (item.field === "status" && Date.parse(history.at) < endpoint) changes.push({at:history.at,author:history.author,from:statusAt(item.fromId,item.from),to:statusAt(item.toId,item.to),index:item.index,id:history.id});
      }); });
      changes.sort(function(a,b) { return Date.parse(a.at) - Date.parse(b.at) || a.id.localeCompare(b.id) || a.index - b.index; });
      changes.forEach(function(change) {
        if (Date.parse(change.at) >= window.start && kind(change.from) === "open" && kind(change.to) === "done") report.dayCompletions.push({at:change.at,author:change.author});
      });
      if (kind(endState) === "done") {
        for (var i=changes.length-1;i>=0;i--) if (kind(changes[i].to) === "done" && kind(changes[i].from) !== "done") {
          if (kind(changes[i].from) === "open") {
            report.completedAt = changes[i].at;
            report.completedBy = Object.assign({},changes[i].author,{color:teamColor(teams,changes[i].author.identifiers || [])});
            report.elapsedSeconds = (Date.parse(report.completedAt) - Date.parse(snap.created)) / 1000;
          }
          break;
        }
        if (!report.completedAt) notes.push("Момент завершения не подтвержден переходом статуса");
      }
      var initial = changes.length ? changes[0].from : endState, cursor = Date.parse(snap.created), total = 0, current = initial, provable = true;
      function addActiveInterval(at) {
        var active = activeStatus(current);
        if (at < cursor || active === null) provable = false;
        else if (active) total += at - cursor;
        cursor = at;
      }
      changes.forEach(function(change) {
        var at = Date.parse(change.at);
        addActiveInterval(at);
        current = change.to;
      });
      addActiveInterval(endpoint);
      if (provable) report.inProgressSeconds = total / 1000;
      else notes.push("Время в работе не подтверждено полной цепочкой статусов");
      return report;
    }
    var deadlineDay = day(today(now));
    var deadlineCoverage = {known:0,missing:0,invalid:0,conflict:0,unknownState:0,total:groups.length}, overdue = 0;
    function currentDeadlineSnapshot(issueKey) {
      var entry = issues[issueKey], snap = entry && entry.snapshot;
      return !!(snap && conflicts.indexOf(issueKey) < 0 && snap.created && snap.currentStatus && snap.currentStatus.name &&
        isFinite(Date.parse(snap.capturedAt)) && Date.parse(snap.capturedAt) >= deadlineDay.start);
    }
    function groupDeadline(source, group) {
      var candidates = source.sourceRows.map(function(row) { return deadlines.resolve(row,options); });
      var found = candidates.filter(function(candidate) { return candidate.problem !== "missing"; });
      var selected = found[0] || candidates[0], signatures = [];
      found.forEach(function(candidate) {
        var signature = JSON.stringify([candidate.date,candidate.problem,candidate.date ? "" : String(candidate.raw).trim()]);
        if (signatures.indexOf(signature) < 0) signatures.push(signature);
      });
      var evidence = found.reduce(function(all,candidate) { return all.concat(candidate.candidates || [{raw:candidate.raw,source:candidate.source,field:candidate.field}]); },[]);
      evidence = evidence.filter(function(candidate,index) { return evidence.findIndex(function(other) { return other.raw === candidate.raw && other.source === candidate.source && other.field === candidate.field; }) === index; });
      if (signatures.length > 1) selected = {date:null,raw:found.map(function(candidate) { return candidate.raw; }).join("; "),source:selected.source,field:selected.field,problem:"conflict",
        reasonCode:"conflict",reasonLabel:deadlines.reasonLabel("conflict"),candidates:evidence};
      else if (selected && evidence.length) selected = Object.assign({},selected,{candidates:evidence});
      var result = Object.assign({},selected,{referenceDate:deadlineDay.date,state:selected.problem || "unknown",daysOverdue:0,daysRemaining:null,owner:null,pendingTasks:[]});
      if (selected.problem) { deadlineCoverage[selected.problem]++; return result; }
      deadlineCoverage.known++;
      result.daysRemaining = Math.round((Date.parse(result.date + "T00:00:00Z") - Date.parse(deadlineDay.date + "T00:00:00Z")) / 86400000);
      var root = issues[group.key], rootSnapshot = root && root.snapshot;
      if (source.uncreated) {
        result.reason = "not-created-in-jira";
        return result;
      }
      if (currentDeadlineSnapshot(group.key) && Date.parse(rootSnapshot.created) >= now) {
        result.reason = "not-created-at-cutoff";
        return result;
      }
      // Today's deadline uses current Jira fields, independent of the selected journal day.
      if (source.missing || !currentDeadlineSnapshot(group.key) || !source.tasks.every(currentDeadlineSnapshot)) {
        deadlineCoverage.unknownState++;
        return result;
      }
      result.owner = rootSnapshot.currentAssignee;
      var existing = source.tasks.filter(function(taskKey) { return Date.parse(issues[taskKey].snapshot.created) < now; });
      if (existing.some(function(taskKey) { return kind(issues[taskKey].snapshot.currentStatus) === "unknown"; })) {
        deadlineCoverage.unknownState++;
        return result;
      }
      result.pendingTasks = existing.filter(function(taskKey) { return kind(issues[taskKey].snapshot.currentStatus) === "open"; }).map(function(taskKey) {
        var entry = issues[taskKey], assignee = entry.snapshot.currentAssignee;
        return {key:taskKey,role:str(entry.task.role),summary:str(entry.task.summary),status:entry.snapshot.currentStatus.name,assignee:assignee,
          team:teamFor(teams,assignee),color:teamColor(teams,assignee && assignee.identifiers || [])};
      });
      if (kind(rootSnapshot.currentStatus) === "cancelled" || !result.pendingTasks.length && existing.some(function(taskKey) { return kind(issues[taskKey].snapshot.currentStatus) === "cancelled"; })) result.state = "cancelled";
      else if (!result.pendingTasks.length) result.state = "completed";
      else if (result.daysRemaining < 0) { result.state = "overdue"; result.daysOverdue = -result.daysRemaining; overdue++; }
      else result.state = result.daysRemaining === 0 ? "today" : result.daysRemaining === 1 ? "tomorrow" : "upcoming";
      return result;
    }
    groups.forEach(function(group,index) {
      var source = order[index];
      group.dayComplete = !source.missing && !source.unknownStatus && source.tasks.every(usable);
      group.management.tasks = source.tasks.map(taskReport);
      if (!group.dayComplete) group.management.notes.push("Полнота группы не подтверждена; переходы готовности не показаны");
      if (source.uncreated) group.management.notes.push("Родительская задача Jira не создана");
      group.deadline = groupDeadline(source,group);
    });
    var deadlinesComplete = !options.scopeWarning && !deadlineCoverage.invalid && !deadlineCoverage.conflict && !deadlineCoverage.unknownState;
    var returnEvents = events.filter(function(event) { return !!event.returnKind; }), returnedTasks = Object.create(null);
    returnEvents.forEach(function(event) { returnedTasks[event.issueKey] = true; });
    var taskReturns = Object.keys(returnedTasks).length;
    var returnCounts = {tasks:taskReturns,events:returnEvents.length,remarks:groups.filter(function(group) { return group.taskReturns.length; }).length};
    ["reopened","review","testing"].forEach(function(type) { returnCounts[type] = returnEvents.filter(function(event) { return event.returnKind === type; }).length; });
    var counted = {complete:issueKeys.filter(usable).length,total:issueKeys.length,
      incomplete:issueKeys.filter(function(issueKey) { return !usable(issueKey); }).length,
      uncreated:order.filter(function(group) { return group.uncreated; }).length,warnings:warnings,diagnostics:diagnostics,isComplete:complete};
    var confirmed = {metrics:{changed:0,newRemarks:0,completed:0,reopened:0,taskReturns:0,events:events.length,overdue:overdue},
      balance:{startOpen:0,endOpen:0},remarks:0,totalRemarks:groups.length,excluded:[]};
    var confirmedReturns = Object.create(null);
    groups.forEach(function(group,index) {
      var source = order[index];
      group.confirmed = !source.uncreated && source.tasks.length > 0 && group.dayComplete;
      if (!group.confirmed) {
        var reasons = warnings.filter(function(warning) {
          return source.tasks.concat([group.key]).some(function(issueKey) { return issueKey && warning.indexOf(issueKey + ":") === 0; });
        });
        if (source.uncreated) reasons.push("Исходная история Jira не создана");
        if (source.missing) reasons.push("Не загружены все связанные задачи замечания");
        if (now <= window.start) reasons.push("Выбранный день ещё не начался");
        if (endpoint < window.start) reasons.push("Данные загружены до начала выбранного дня");
        if (!reasons.length) reasons.push("История замечания не подтверждена");
        confirmed.excluded.push({id:group.id,key:group.key,summary:group.summary,reasons:reasons});
        return;
      }
      confirmed.remarks++;
      if (group.management.changed) confirmed.metrics.changed++;
      if (group.management.newRemark) confirmed.metrics.newRemarks++;
      if (group.management.completed.length) confirmed.metrics.completed++;
      if (group.management.reopened.length) confirmed.metrics.reopened++;
      group.taskReturns.forEach(function(event) { confirmedReturns[event.issueKey] = true; });
      ["start","end"].forEach(function(boundary) {
        if (source.tasks.some(function(issueKey) { return states[issueKey] && kind(states[issueKey][boundary]) === "open"; })) confirmed.balance[boundary + "Open"]++;
      });
    });
    confirmed.metrics.taskReturns = Object.keys(confirmedReturns).length;
    if (!confirmed.remarks) {
      ["changed","newRemarks","completed","reopened","taskReturns"].forEach(function(name) { confirmed.metrics[name] = null; });
      confirmed.balance = {startOpen:null,endOpen:null};
    }
    return {date:window.date,start:window.start,end:window.end,asOf:now <= window.start || endpoint < window.start ? null : new Date(endpoint).toISOString(),generatedAt:new Date(now).toISOString(),timezone:"МСК",coverage:counted,
      confirmed:confirmed,
      metrics:{changed:complete ? Object.keys(changed).length : null,newRemarks:complete ? Object.keys(newRemarks).length : null,completed:complete ? Object.keys(completed).length : null,reopened:complete ? Object.keys(reopened).length : null,taskReturns:complete ? taskReturns : null,events:events.length,overdue:deadlinesComplete ? overdue : null},
      observed:{changed:Object.keys(changed).length,newRemarks:Object.keys(newRemarks).length,taskReturns:taskReturns,overdue:overdue},returns:returnCounts,deadlineCoverage:deadlineCoverage,deadlineReferenceDate:deadlineDay.date,
      balance:{startOpen:complete ? balanceStart : null,endOpen:complete ? balanceEnd : null},transitions:pairs(transitions),transfers:pairs(transfers),groups:groups,events:events,teams:teams};
  }
  function escapeRaw(value) { return String(value == null ? "" : value).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;"); }
  function escape(value) { return escapeRaw(str(value)); }
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
  function deadlineText(deadline) {
    if (!deadline || deadline.problem === "missing") return "Срок не указан";
    if (deadline.problem === "invalid") return "Срок не распознан";
    if (deadline.problem === "conflict") return "Противоречивые сроки";
    var date = str(deadline.date).split("-").reverse().join(".");
    var suffix = {today:"сегодня",tomorrow:"завтра",completed:"готово",cancelled:"отменено",unknown:"состояние не подтверждено"};
    return "Срок: " + date + (deadline.state === "overdue" ? " · просрочено " + deadline.daysOverdue + " д" : suffix[deadline.state] ? " · " + suffix[deadline.state] : "");
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
  var changeCategories = Object.create(null);
  [
    ["Создание задачи",["created"]],
    ["Статус",["status","статус"]],
    ["Исполнитель",["assignee","исполнитель"]],
    ["Описание",["description","описание"]],
    ["Тема",["summary","тема"]],
    ["Трудозатраты",["timespent","worklogid","worklog","затраченное время","трудозатраты"]],
    ["Оценка трудозатрат",["timeestimate","timeoriginalestimate","remaining estimate","original estimate","оставшаяся оценка","исходная оценка"]],
    ["Результат",["resolution","решение","результат"]],
    ["Приоритет",["priority","приоритет"]],
    ["Сроки",["duedate","due date","startdate","срок исполнения","срок","дата начала"]],
    ["Связи задач",["link","issuelinks","parent","epic link","связь","связи задач","родитель","связь эпика"]],
    ["Комментарии",["comment","комментарий"]],
    ["Вложения",["attachment","вложение","вложения"]],
    ["Параметры задачи",["labels","component","components","fixversion","fixversions","version","versions","sprint","issuetype","reporter","project","story points","метки","компоненты","версия исправления","версии исправления","версии","спринт","тип задачи","автор","проект"]]
  ].forEach(function(category) {
    category[1].forEach(function(field) { changeCategories[categoryField(field)] = category[0]; });
  });
  function categoryField(value) { return str(value).toLowerCase().replace(/[\s_-]+/g,""); }
  function eventCategory(event) {
    event = event || {};
    if (event.kind === "created" || event.kind === "status" || event.kind === "assignee") return changeCategories[event.kind];
    return changeCategories[categoryField(event.fieldId)] || changeCategories[categoryField(event.field)] || "Другие поля";
  }
  function eventText(event) {
    event = event || {};
    var from = str(event.from), to = str(event.to), field = str(event.field).toLowerCase();
    if (event.kind === "created") return "Создана задача";
    if (event.kind === "status") {
      if (from && from === to && !(event.fromId && event.toId && event.fromId !== event.toId)) return "Статус не изменился: " + statusLabel(to);
      var destination = statusLabel(to), action = "Изменён статус";
      var returned = returnKind(event), destinationKind = kind(event.toStatus || state("",to));
      if (returned) action = {reopened:"Переоткрыта после завершения",review:"Возвращена с проверки",testing:"Возвращена с тестирования"}[returned];
      else if (destinationKind === "cancelled") action = "Задача отменена";
      else if (destinationKind === "done") action = /^(closed|закрыто|закрыта)$/.test(to.toLowerCase()) ? "Задача закрыта" : "Задача выполнена";
      else if (destinationKind === "open") {
        if (/^(in progress|в работе)$/.test(to.toLowerCase())) action = "Взята в работу";
        else if (/^(in review|review|на проверке)$/.test(to.toLowerCase())) action = "Передана на проверку";
        else if (/^(testing|in testing|тестирование|на тестировании)$/.test(to.toLowerCase())) action = "Передана на тестирование";
      }
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
    html += '<style>.status{display:inline-block;padding:2px 6px;border-radius:3px;background:#edf0f3;color:#4b5664}.is-progress{background:#e2efff;color:#0755ab}.is-done{background:#dff3e7;color:#20653d}.is-review{background:#fff1d2;color:#77500b}.is-testing{background:#dcf3f1;color:#186962}.is-cancelled{background:#fae8e8;color:#914747}</style>';
    var summary = report.confirmed, summaryMetrics = summary ? summary.metrics : report.metrics || {}, summaryBalance = summary ? summary.balance : report.balance || {};
    html += '<h2>Итоги</h2>';
    if (summary) {
      html += '<p>Подтверждено замечаний: ' + escape(summary.remarks) + ' из ' + escape(summary.totalRemarks) + '. Итоги замечаний рассчитаны по проверенным данным. События показаны по всей загруженной истории; просрочка — по подтверждённым текущим срокам и статусам.</p>';
      if (summary.excluded.length) {
        html += '<details><summary>Не включены в итоги замечаний: ' + escape(summary.excluded.length) + '</summary><ul>';
        summary.excluded.forEach(function(group) { html += '<li>' + issueLink(group.key) + ' ' + escape(group.summary) + ': ' + escape(group.reasons.join('; ')) + '</li>'; });
        html += '</ul></details>';
      }
    }
    html += '<table><tbody>';
    [["changed","Изменённые замечания"],["newRemarks","Новые замечания"],["completed","Завершённые"],["taskReturns","Возвраты задач"],["reopened","Повторно открытые полностью готовые замечания"],["events","Наблюдаемые события"],["overdue","Просроченные"]].forEach(function(pair) {
      var count = summaryMetrics[pair[0]];
      if (!summary && count == null && report.observed && report.observed[pair[0]] != null) count = report.observed[pair[0]];
      html += '<tr><th>' + pair[1] + '</th><td>' + escape(count == null ? '—' : count) + '</td></tr>';
    });
    html += '</tbody></table><h2>Баланс</h2><p>Открыто на начало дня: ' + escape(summaryBalance.startOpen == null ? '—' : summaryBalance.startOpen) + '; ' + (report.asOf && Date.parse(report.asOf) === report.end ? 'на конец дня' : 'на момент загрузки') + ': ' + escape(summaryBalance.endOpen == null ? '—' : summaryBalance.endOpen) + '</p>';
    var dueCoverage = report.deadlineCoverage || {};
    html += '<h2>Просроченные замечания</h2><p>На сегодня, ' + escape(str(report.deadlineReferenceDate).split("-").reverse().join(".")) + ' МСК. Сроки из текущего журнала сравниваются с текущей датой; история переносов не учитывается. Показаны текущие состояния задач, независимо от даты журнала событий.</p>';
    html += '<p>Срок известен: ' + escape(dueCoverage.known) + '; без срока: ' + escape(dueCoverage.missing) + '; не распознано: ' + escape(dueCoverage.invalid) + '; конфликт: ' + escape(dueCoverage.conflict) + '; состояние не подтверждено: ' + escape(dueCoverage.unknownState) + '</p>';
    function issueLink(issueKey) {
      try {
        var base = new URL(str(context.baseUrl));
        if (!/^https?:$/.test(base.protocol) || base.username || base.password) throw new Error("Unsafe URL");
        base.search = ""; base.hash = "";
        return '<a href="' + escape(base.href.replace(/\/+$/,"") + '/browse/' + encodeURIComponent(str(issueKey))) + '">' + escape(issueKey) + '</a>';
      } catch (ignore) { return escape(issueKey); }
    }
    var overdueGroups = (report.deadlineGroups || report.groups || []).filter(function(group) { return group.deadline && group.deadline.state === "overdue"; })
      .slice().sort(function(a,b) { return b.deadline.daysOverdue - a.deadline.daysOverdue || str(a.key).localeCompare(str(b.key)); });
    html += '<table aria-label="Просроченные замечания"><thead><tr><th>Замечание</th><th>Срок исполнения</th><th>Ответственный</th><th>Осталось выполнить</th></tr></thead><tbody>';
    overdueGroups.forEach(function(group) {
      var due = group.deadline;
      html += '<tr><td>' + issueLink(group.key) + ' ' + escape(group.remarkId) + '<br>' + escape(group.summary) + '</td><td>' + escape(deadlineText(due)) + '</td><td>' + escape(due.owner && due.owner.label || 'Не назначен') + '</td><td>';
      (due.pendingTasks || []).forEach(function(task) { html += '<div>' + issueLink(task.key) + ' [' + escape(task.role || 'История') + '] · ' + escape(statusLabel(task.status)) + ' · ' + escape(task.assignee && task.assignee.label || 'Не назначен') + ' · ' + escape(task.team) + '</div>'; });
      html += '</td></tr>';
    });
    html += '</tbody></table>';
    var issueGroups = (report.deadlineGroups || report.groups || []).filter(function(group) { return group.deadline && (group.deadline.problem === "invalid" || group.deadline.problem === "conflict"); });
    html += '<h2>Не распознаны сроки: ' + issueGroups.length + '</h2><p>Снимок загруженных данных; Excel не проверялся в реальном времени. История переносов срока неизвестна.</p>';
    html += '<table aria-label="Не распознаны сроки"><thead><tr><th>Замечание</th><th>Причина</th><th>Источник</th><th>Поле</th><th>Значение</th></tr></thead><tbody>';
    issueGroups.forEach(function(group) {
      var due = group.deadline, reason = due.reasonLabel || deadlines.reasonLabel(due.reasonCode || (due.problem === "conflict" ? "conflict" : "unsupported-format"));
      var candidates = due.candidates && due.candidates.length ? due.candidates : [{raw:due.raw,source:due.source,field:due.field}];
      candidates.forEach(function(candidate) {
        var source = candidate.source === "excel" ? "текущий журнал Excel" : candidate.source === "jira-description" ? "сохранённое описание Jira" : "Источник не указан";
        html += '<tr><td>' + issueLink(group.key) + ' ' + escape(group.remarkId) + '<br>' + escape(group.summary) + '</td><td>' + escape(reason) + '</td><td>' + escape(source) + '</td><td>' + escape(candidate.field) + '</td><td><pre><span>' + escapeRaw(candidate.raw) + '</span></pre></td></tr>';
      });
    });
    html += '</tbody></table>';
    html += '<h2>Возвраты задач</h2><p>Каждая задача учтена один раз в итогах. Ниже все её возвраты в пределах фильтра журнала; причина без подтверждающего комментария неизвестна.</p><table aria-label="Возвраты задач"><thead><tr><th>МСК</th><th>Задача</th><th>Роль</th><th>Переход</th><th>Автор</th></tr></thead><tbody>';
    (report.events || []).filter(function(event) { return !!event.returnKind && (!summary || (report.groups || []).some(function(group) {
      return group.confirmed && (group.taskReturns || []).some(function(candidate) { return candidate.id === event.id; });
    })); }).forEach(function(event) {
      html += '<tr><td>' + escape(msk(event.at)) + '</td><td>' + issueLink(event.issueKey) + '</td><td>' + escape(event.role || 'История') + '</td><td>' + escape(eventText(event)) + '</td><td>' + escape(event.author && event.author.label) + '</td></tr>';
    });
    html += '</tbody></table>';
    [["Переходы статусов",report.transitions],["Передачи между командами",report.transfers]].forEach(function(section) {
      html += '<h2>' + section[0] + '</h2>';
      var entries = section[1] || [], names = Object.create(null), counts = Object.create(null);
      entries.forEach(function(item) { names[item.from] = true; names[item.to] = true; counts[JSON.stringify([item.from,item.to])] = item.count; });
      var parties = Object.keys(names).sort();
      function display(name) { return section[0] === "Переходы статусов" ? '<span class="status is-' + statusTone(name) + '">' + escape(statusLabel(name)) + '</span>' : escape(name); }
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
      if (group.deadline) html += '<p>' + escape(deadlineText(group.deadline)) + '</p>';
      if (group.dayHighlights) {
        var highlights = [];
        if (group.dayHighlights.completed) highlights.push('Завершено ' + group.dayHighlights.completed);
        if (group.dayHighlights.created) highlights.push('Создано ' + group.dayHighlights.created);
        if (group.taskReturns && group.taskReturns.length) highlights.push('Возвратов ' + group.taskReturns.length);
        else if (group.dayHighlights.reopened) highlights.push('Переоткрыто ' + group.dayHighlights.reopened);
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
  return {capture:capture,day:day,today:today,summarize:summarize,exportHtml:exportHtml,statusLabel:statusLabel,statusTone:statusTone,returnKind:returnKind,eventText:eventText,eventCategory:eventCategory};
});
