define("_ujgESI_activityManagementUi", ["jquery", "_ujgESI_activity", "_ujgESI_icons"], function($, activity, icon) {
  "use strict";
  var titles = {changed:"Изменённые замечания",newRemarks:"Новые замечания",completed:"Завершённые замечания",reopened:"Возобновлённые замечания",events:"Все события"};
  var completedDefinition = "В выбранный день достигнута полная готовность замечания: готовы исходная история и все связанные задачи.";
  var reopenedDefinition = "Повторное открытие после полной готовности исходной истории и всех связанных задач.";
  function list(value) { return Array.isArray(value) ? value : []; }
  function value(input) { return input == null || input === "" ? "Нет данных" : String(input); }
  function person(input) { return value(input && typeof input === "object" ? input.label : input); }
  function timestamp(input) {
    if (typeof input === "number") return isFinite(new Date(input).getTime()) ? input : NaN;
    if (typeof input !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$/.test(input)) return NaN;
    var day = new Date(input.slice(0,10) + "T00:00:00Z");
    if (!isFinite(day.getTime()) || day.toISOString().slice(0,10) !== input.slice(0,10) || +input.slice(11,13) > 23 || +input.slice(14,16) > 59 || +input.slice(17,19) > 59) return NaN;
    return Date.parse(input);
  }
  function dateTime(input) {
    var stamp = timestamp(input);
    if (!isFinite(stamp) || !isFinite(new Date(stamp + 10800000).getTime())) return "Нет данных";
    var date = new Date(stamp + 10800000).toISOString();
    return date.slice(8,10) + "." + date.slice(5,7) + "." + date.slice(0,4) + " " + date.slice(11,16) + " МСК";
  }
  function duration(input) {
    if (typeof input !== "number" || !isFinite(input) || input < 0) return "Нет данных";
    var minutes = Math.round(input / 60), hours = Math.floor(minutes / 60);
    return hours + " ч " + minutes % 60 + " мин";
  }
  function calendarDuration(input) {
    if (typeof input !== "number" || !isFinite(input) || input < 0) return "Нет данных";
    var days = Math.floor(input / 86400);
    return (days ? days + " д " : "") + duration(input - days * 86400);
  }
  function textNode(tag, className, content) { return $("<" + tag + "/>").addClass(className).text(value(content)); }
  function keyNode(key, baseUrl) {
    var label = value(key);
    try {
      var base = new URL(String(baseUrl || ""));
      if (!/^https?:$/.test(base.protocol) || base.username || base.password) throw new Error("Unsafe URL");
      base.search = ""; base.hash = "";
      return $("<a/>").attr({href:base.href.replace(/\/+$/, "") + "/browse/" + encodeURIComponent(label),target:"_blank",rel:"noopener noreferrer"}).text(label);
    } catch (ignore) { return $("<span/>").text(label); }
  }
  function roleNode(role, summary, color) {
    var match = String(role || "").toUpperCase().match(/\b(BE|FE|QA|DE|BF)\b/) || String(summary || "").toUpperCase().match(/^\s*\[(BE|FE|QA|DE|BF)\]|^\s*(BE|FE|QA|DE|BF)\s*[:\-]/);
    var name = match ? match[1] || match[2] : String(role || "История");
    var $role = textNode("span","ujg-esi-management-role role-" + (match ? name.toLowerCase() : "other"),name);
    if (/^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(color || "")) $role.css("border-color",color);
    return $role;
  }
  function richText(text, state) {
    var $text = $("<span/>");
    String(text || "").split(/(\b[A-Z][A-Z0-9_]*-\d+\b|\[(?:BE|FE|QA|DE|BF)\])/g).forEach(function(part) {
      if (/^[A-Z][A-Z0-9_]*-\d+$/.test(part)) $text.append(keyNode(part,state.baseUrl));
      else if (/^\[(BE|FE|QA|DE|BF)\]$/.test(part)) $text.append(roleNode(part.slice(1,-1)));
      else $text.append(document.createTextNode(part));
    });
    return $text;
  }
  function eventStatement(event) {
    var category = activity.eventCategory ? activity.eventCategory(event) : "";
    if (category === "Описание") return "Изменено описание";
    if (category === "Тема") return "Уточнена тема задачи";
    if (category === "Комментарии") return "Изменены комментарии";
    if (category === "Другие поля" || category === "Параметры задачи") return "Обновлены параметры задачи";
    return activity.eventText(event);
  }
  function eventRow(event, state) {
    var fullTime = dateTime(event.at);
    return $("<div/>").addClass("ujg-esi-management-event").append(textNode("time","",fullTime === "Нет данных" ? fullTime : fullTime.slice(11,16)).attr({title:fullTime,datetime:event.at}),keyNode(event.issueKey,state.baseUrl),roleNode(event.role,event.summary,event.roleColor),richText(eventStatement(event),state),textNode("span","ujg-esi-management-event-author",person(event.author)));
  }
  function management(group) { return group && group.management || {}; }
  function certifiedTransitions(group, kind) {
    return list(management(group)[kind]).filter(function(item) { return item && isFinite(timestamp(item.at)); })
      .sort(function(a,b) { return timestamp(a.at) - timestamp(b.at); });
  }
  function completionTimeline(group) {
    return ["completed","reopened"].reduce(function(entries,kind) {
      return entries.concat(certifiedTransitions(group,kind).map(function(transition) { return {kind:kind,transition:transition}; }));
    },[]).sort(function(a,b) { return timestamp(a.transition.at) - timestamp(b.transition.at); });
  }
  function completionLabel(group) {
    var completed = certifiedTransitions(group,"completed"), reopened = certifiedTransitions(group,"reopened");
    if (!completed.length) return "Полная готовность: Нет данных";
    var lastCompletion = completed[completed.length-1], lastReturn = reopened[reopened.length-1];
    return "Полная готовность достигнута" + (lastReturn && timestamp(lastReturn.at) > timestamp(lastCompletion.at) ? " · Позже возвращено в работу: " + dateTime(lastReturn.at) : "");
  }
  function selectedGroups(report, metric) {
    return list(report && report.groups).filter(function(group) {
      var item = management(group);
      if (metric === "changed") return item.changed === true;
      if (metric === "newRemarks") return item.newRemark === true;
      if (metric === "completed" || metric === "reopened") return list(item[metric]).length > 0;
      return list(group.events).length > 0;
    });
  }
  function groupLabel(group, state) {
    return $("<span/>").addClass("ujg-esi-management-group-label").append(keyNode(group.key,state.baseUrl),textNode("span","ujg-esi-management-remark-id",group.remarkId),textNode("span","ujg-esi-management-summary",group.summary));
  }
  function plainGroupLabel(group) {
    return $("<span/>").addClass("ujg-esi-management-group-label").append(textNode("strong","",group.key),textNode("span","ujg-esi-management-remark-id",group.remarkId),textNode("span","ujg-esi-management-summary",group.summary));
  }
  function outcome(group, metric) {
    var info = management(group), transitions = certifiedTransitions(group,metric), parts = [];
    if (metric === "completed" || metric === "reopened") {
      transitions.forEach(function(item) {
        if (metric === "completed") {
          parts.push((transitions.length > 1 ? dateTime(item.at) + " · " : "") + "Последние переходы задач: " + (list(item.events).map(function(event) {
            var role = roleNode(event.role,event.summary).text();
            return value(event.issueKey) + " · " + (/^(BE|FE|QA|DE|BF)$/.test(role) ? "[" + role + "]" : role) + " · Автор перехода: " + person(event.author);
          }).join("; ") || "Нет данных"));
          return;
        }
        var roles = list(item.events).map(function(event) { return String(event.role || "").toUpperCase(); }).filter(Boolean);
        parts.push((roles.length ? roles.join(", ") + " · " : "") + dateTime(item.at) + (item.events && item.events[0] ? " · Возобновил: " + person(item.events[0].author) : ""));
      });
    } else {
      if (metric === "events") parts.push("Событий " + list(group.events).length);
      if (metric === "newRemarks" && info.newRemark) {
        var created = list(group.events).filter(function(event) { return event.kind === "created" && event.issueKey === group.key; })[0];
        parts.push("Новое замечание" + (created ? " · " + dateTime(created.at) + " · " + person(created.author) : ""));
      }
      if (metric === "changed") {
        var highlights = group.dayHighlights || {};
        if (highlights.created) parts.push("Создано задач: " + highlights.created);
        if (highlights.completed) parts.push("Завершено задач: " + highlights.completed);
        else if (list(info.completed).length) parts.push("Замечание стало готово");
        if (highlights.reopened) parts.push("Возвращено задач: " + highlights.reopened);
        else if (list(info.reopened).length) parts.push("Замечание возвращено в работу");
        var roles = list(group.events).concat(list(info.completed).reduce(function(all,item) { return all.concat(list(item.events)); },[]),list(info.reopened).reduce(function(all,item) { return all.concat(list(item.events)); },[])).map(function(event) { return String(event.role || "").toUpperCase(); }).filter(Boolean);
        roles = roles.filter(function(role,index) { return roles.indexOf(role) === index; });
        if (roles.length) parts.push(roles.join(", "));
      }
      if (!parts.length && info.changed) parts.push("Изменено");
    }
    return parts.join("; ") || "Нет данных";
  }
  function warning(report) {
    return report && report.coverage && report.coverage.isComplete === true ? $() : textNode("p","ujg-esi-management-warning","История неполна: показаны подтверждённые данные, итог может быть больше.");
  }
  function turnaround(group) {
    var info = management(group), root = list(info.tasks).filter(function(task) { return task.key === group.key; })[0], milestone = certifiedTransitions(group,"completed")[0];
    var start = timestamp(root && root.created), end = timestamp(milestone && milestone.at);
    return isFinite(start) && isFinite(end) && end >= start ? (end-start)/1000 : null;
  }
  function completionChronology(group, preview) {
    var root = list(management(group).tasks).filter(function(task) { return task.key === group.key; })[0];
    var completed = certifiedTransitions(group,"completed"), milestone = completed[0];
    var $chronology = $("<div/>").addClass("ujg-esi-management-chronology");
    if (preview) $chronology.addClass("ujg-esi-management-preview-chronology");
    var $end = fact("Полная готовность",dateTime(milestone && milestone.at)).addClass("ujg-esi-management-completed-at");
    if (completed.length > 1) $end.find("dd").append(textNode("small","ujg-esi-management-milestone-note","Первое достижение за выбранный день"));
    var $elapsed = fact("От создания до полной готовности",calendarDuration(turnaround(group))).addClass("ujg-esi-management-turnaround");
    if (preview) $elapsed.addClass("ujg-esi-management-preview-elapsed");
    $chronology.append($("<dl/>").addClass("ujg-esi-management-facts").append(
      fact("Создано в Jira",dateTime(root && root.created)).addClass("ujg-esi-management-created"),$end,$elapsed));
    if (preview && milestone) {
      var $history = $("<div/>").addClass("ujg-esi-management-completion-history");
      completionTimeline(group).filter(function(item) { return timestamp(item.transition.at) > timestamp(milestone.at); }).forEach(function(item) {
        $history.append($("<div/>").append(textNode("span","",item.kind === "completed" ? "Повторная полная готовность" : "Возврат в работу"),textNode("time","",dateTime(item.transition.at))));
      });
      if ($history.children().length) $chronology.append($history);
    }
    return $chronology;
  }
  function workAuthors(tasks) {
    var names = [], incomplete = false;
    tasks.forEach(function(task) {
      if (task.worklogsComplete !== true) incomplete = true;
      list(task.worklogs).forEach(function(log) {
        var name = person(log.author);
        if (name === "Нет данных") incomplete = true;
        else if (names.indexOf(name) < 0) names.push(name);
      });
    });
    return (names.length ? names.join(", ") : "Нет данных") + (incomplete ? " · данные частичны" : "");
  }
  function previewItem(group, metric, state, report) {
    var info = management(group), allTasks = list(info.tasks), tasks = allTasks.filter(function(task) { return task.key !== group.key; });
    var $row = $("<div/>").addClass("ujg-esi-management-preview-item");
    var completions = certifiedTransitions(group,"completed"), completionAt = completions.map(function(item) { return timestamp(item.at); });
    var latestCompletion = completionAt.length ? Math.max.apply(null,completionAt) : null;
    var laterReopened = latestCompletion != null && list(info.reopened).some(function(item) { return !isFinite(timestamp(item && item.at)) || timestamp(item.at) > latestCompletion; });
    if (list(info.completed).length) {
      if (!laterReopened && latestCompletion != null) $row.addClass("is-completed");
      $row.append(textNode("div","ujg-esi-management-preview-milestone",completionLabel(group)));
    }
    $row.append(groupLabel(group,state),$("<div/>").addClass("ujg-esi-management-preview-outcome").append(richText(outcome(group,metric),state)));
    var roles = Object.create(null), $roles = $("<div/>").addClass("ujg-esi-management-preview-roles");
    tasks.forEach(function(task) {
      var name = roleNode(task.role,task.summary).text();
      if (name === "История") name = "Нет данных";
      if (!roles[name]) roles[name] = [];
      roles[name].push(task);
    });
    Object.keys(roles).forEach(function(name) {
      var roleTasks = roles[name], completers = [], assignees = [], assigneesProvided = false, assigneesIncomplete = false;
      roleTasks.forEach(function(task) {
        [task.completedBy].concat(list(task.dayCompletions).map(function(item) { return item.author; })).forEach(function(author) {
          var closer = person(author);
          if (closer !== "Нет данных" && completers.indexOf(closer) < 0) completers.push(closer);
        });
        if (Object.prototype.hasOwnProperty.call(task,"assignee")) assigneesProvided = true;
        var assignee = task.assignee && !task.assignee.label && Array.isArray(task.assignee.identifiers) && !task.assignee.identifiers.length ? "Не назначен" : person(task.assignee);
        if (assignee === "Нет данных") assigneesIncomplete = true;
        else if (assignees.indexOf(assignee) < 0) assignees.push(assignee);
      });
      var $group = $("<div/>").addClass("ujg-esi-management-preview-role-group").attr("data-role",name);
      var $keys = $("<span/>").addClass("ujg-esi-management-preview-role-tasks");
      roleTasks.forEach(function(task) { $keys.append(keyNode(task.key,state.baseUrl)); });
      $group.append($("<span/>").addClass("ujg-esi-management-preview-role-count").append(roleNode(name),textNode("span","",roleTasks.length)),$keys);
      if (assigneesProvided) $group.append(textNode("span","ujg-esi-management-preview-role-assignees","Исполнители на срезе: " + (assignees.length ? assignees.join(", ") : "Нет данных") + (assigneesIncomplete ? " · данные частичны" : "")));
      $group.append(textNode("span","ujg-esi-management-preview-role-workers","Работали: " + workAuthors(roleTasks)));
      $group.append(textNode("span","ujg-esi-management-preview-role-completers","Завершил: " + (completers.length ? completers.join(", ") : "Нет данных")));
      $roles.append($group);
    });
    if (!tasks.length) $roles.append(textNode("span","ujg-esi-management-muted","Задачи: Нет данных"));
    $row.append($roles);
    var known = [];
    allTasks.forEach(function(task) {
      if (typeof task.spentSeconds === "number" && isFinite(task.spentSeconds) && task.spentSeconds >= 0) known.push(task.spentSeconds);
    });
    $row.append(textNode("div","ujg-esi-management-preview-workers","Работали по замечанию: " + workAuthors(allTasks)));
    if (list(info.completed).length) $row.append(completionChronology(group,true));
    else {
      var root = allTasks.filter(function(task) { return task.key === group.key; })[0];
      var start = root && Date.parse(root.created), cutoff = Date.parse(report && report.asOf);
      $row.append(textNode("div","ujg-esi-management-preview-elapsed","С момента создания: " + (isFinite(start) && isFinite(cutoff) && cutoff >= start ? calendarDuration((cutoff-start)/1000) : "Нет данных")));
    }
    var partialEffort = known.length < allTasks.length || !allTasks.some(function(task) { return task.key === group.key; });
    $row.append(textNode("div","ujg-esi-management-preview-effort","Учтено на момент снимков: " + (known.length ? duration(known.reduce(function(sum,seconds) { return sum + seconds; },0)) : "Нет данных") + (partialEffort ? " · частичный итог" : "")));
    return $row;
  }
  function preview(report, metric, state, services) {
    state = state || {}; services = services || {};
    var groups = selectedGroups(report,metric), $root = $("<div/>").addClass("ujg-esi-management-preview");
    $root.append(textNode("strong","ujg-esi-management-preview-title",titles[metric] || "Сводка"),warning(report));
    if (metric === "completed") $root.append(textNode("p","ujg-esi-management-definition",completedDefinition));
    if (metric === "reopened") $root.append(textNode("p","ujg-esi-management-definition",reopenedDefinition));
    if (metric === "completed" && groups.length) {
      var elapsed = groups.map(turnaround).filter(function(seconds) { return seconds != null; });
      $root.append(textNode("p","ujg-esi-management-preview-average","Среднее время от создания до первой полной готовности за выбранный день: " + (elapsed.length ? calendarDuration(elapsed.reduce(function(sum,seconds) { return sum + seconds; },0)/elapsed.length) : "Нет данных") + " (" + elapsed.length + " из " + groups.length + " замечаний с известным временем)"));
    }
    var $scroll = $("<div/>").addClass("ujg-esi-management-preview-scroll");
    if (!groups.length) $scroll.append(textNode("p","ujg-esi-management-empty",report.coverage && report.coverage.isComplete ? "За выбранный день таких замечаний нет" : "Нет подтверждённых данных"));
    groups.forEach(function(group) { $scroll.append(previewItem(group,metric,state,report)); });
    $root.append($scroll);
    return $root.append($("<button type='button'/>").addClass("ujg-esi-management-preview-open").text("Открыть сводку").on("click",function() { if (services.onOpen) services.onOpen(); }));
  }
  function fact(label, content) {
    return $("<div/>").addClass("ujg-esi-management-fact").append(textNode("dt","",label),$("<dd/>").append(content));
  }
  function taskDetail(task, state, services, report) {
    var $section = $("<details/>").addClass("ujg-esi-management-task");
    $section.append($("<summary/>").text("Подробности " + value(task.key) + " · " + value(task.summary)));
    var $facts = $("<dl/>").addClass("ujg-esi-management-facts");
    if (task.created) $facts.append(fact("Создано",dateTime(task.created)));
    if (task.status) $facts.append(fact("На конец периода",activity.statusLabel ? activity.statusLabel(task.status) : task.status));
    if (task.completedAt) $facts.append(fact("Завершено",dateTime(task.completedAt)));
    if (task.completedBy) $facts.append(fact("Кто завершил",person(task.completedBy)));
    if (task.elapsedSeconds != null) $facts.append(fact("Календарное время задачи",calendarDuration(task.elapsedSeconds)));
    if (task.inProgressSeconds != null) $facts.append(fact("Активная работа (разработка, ревью, тестирование)",duration(task.inProgressSeconds)));
    $facts.append(fact("Учтено на момент снимка",duration(task.spentSeconds) + " · " + dateTime(task.spentAsOf)));
    $section.append($facts);
    var logs = list(task.worklogs), $work = $("<div/>").addClass("ujg-esi-management-worklogs");
    $work.append(textNode("h5","","Учёт работы"));
    if (task.worklogsComplete !== true) $work.append(textNode("p","ujg-esi-management-muted","Данные по записям неполны"));
    if (!logs.length) $work.append(textNode("p","ujg-esi-management-empty",task.worklogsComplete === true ? "Нет записей" : "Нет данных"));
    logs.forEach(function(log) {
      var $team = textNode("span","ujg-esi-management-log-team",log.team);
      if (/^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(log.color || "")) $team.css("border-left-color",log.color);
      $work.append($("<div/>").addClass("ujg-esi-management-log").append(textNode("time","",dateTime(log.at)),textNode("span","",person(log.author)),$team,textNode("strong","",duration(log.seconds))));
    });
    var teams = Object.create(null);
    logs.forEach(function(log) { if (typeof log.seconds === "number" && isFinite(log.seconds) && log.seconds >= 0) teams[value(log.team)] = (teams[value(log.team)] || 0) + log.seconds; });
    Object.keys(teams).forEach(function(team) { $work.append(textNode("p","ujg-esi-management-team-total",team + ": " + duration(teams[team]))); });
    $section.append($work);
    var $comments = $("<div/>").addClass("ujg-esi-management-comments").append(textNode("h5","","Комментарии"));
    if (task.commentsComplete !== true) $comments.append(textNode("p","ujg-esi-management-muted","Комментарии показаны частично"));
    if (!list(task.comments).length) $comments.append(textNode("p","ujg-esi-management-empty",task.commentsComplete === true ? "Нет записей" : "Нет данных"));
    list(task.comments).forEach(function(comment) {
      var $comment = $("<div/>").addClass("ujg-esi-management-comment").append(textNode("div","ujg-esi-management-comment-by",person(comment.author) + " · " + dateTime(comment.at)));
      if (comment.updatedAt && Date.parse(comment.updatedAt) >= Date.parse(report.asOf)) $comment.append(textNode("p","ujg-esi-management-note","Комментарий редактировался после выбранного периода; показан текущий текст."));
      var rendered = services.renderDescription && services.renderDescription(comment.body);
      $comment.append($("<div/>").addClass("ujg-esi-management-comment-body").append(rendered && rendered.jquery ? rendered : textNode("p","",comment.body)));
      $comments.append($comment);
    });
    $section.append($comments);
    list(task.notes).forEach(function(note) { $section.append(textNode("p","ujg-esi-management-note",note)); });
    return $section;
  }
  function detail(group, metric, state, services, report) {
    var info = management(group), $root = $("<div/>").addClass("ujg-esi-management-detail");
    $root.append($("<h3/>").append(groupLabel(group,state)));
    var $outcomes = $("<div/>").addClass("ujg-esi-management-outcomes");
    $outcomes.append(textNode("strong","",metric === "completed" ? completionLabel(group) : "За день"),$("<span/>").append(richText((metric === "reopened" ? "Возобновлено: " : "") + outcome(group,metric),state)));
    $root.append($outcomes);
    if (list(info.completed).length) $root.append(completionChronology(group,false));
    if (group.currentStatus) $root.append(textNode("p","ujg-esi-management-muted","Исходная история сейчас: " + (activity.statusLabel ? activity.statusLabel(group.currentStatus) : group.currentStatus)));
    if (typeof group.linkedTaskCount === "number") $root.append(textNode("p","ujg-esi-management-muted","Связанных задач: " + group.linkedTaskCount));
    completionTimeline(group).forEach(function(item) {
      var transition = item.transition, $line = $("<div/>").addClass("ujg-esi-management-transition is-" + item.kind);
      $line.append(textNode("strong","",item.kind === "completed" ? "Замечание полностью готово" : "Возврат в работу"),textNode("time","",dateTime(transition.at)));
      if (list(transition.events).length) $line.append(textNode("small","ujg-esi-management-transition-evidence",item.kind === "completed" ? "Последние переходы задач в готовность (ключ, роль, автор изменения статуса):" : "Переходы задач, вернувшие замечание в работу:"));
      list(transition.events).forEach(function(event) { $line.append($("<span/>").append(keyNode(event.issueKey,state.baseUrl),roleNode(event.role,event.summary,event.roleColor),textNode("span",""," · Автор перехода: " + person(event.author)))); });
      $root.append($line);
    });
    if (list(info.reopened).length && list(info.tasks).some(function(task) { return list(task.comments).length; })) $root.append(textNode("p","ujg-esi-management-note","Доступные комментарии; причина возврата не подтверждена."));
    if (!list(info.tasks).length) $root.append(textNode("p","ujg-esi-management-empty","Данные по задачам: Нет данных"));
    var tasks = list(info.tasks), known = tasks.filter(function(task) { return typeof task.spentSeconds === "number" && isFinite(task.spentSeconds) && task.spentSeconds >= 0; });
    if (tasks.length) {
      var snapshots = known.map(function(task) { return task.spentAsOf; }).filter(function(at) { return isFinite(Date.parse(at)); }).sort();
      var snapshotLabel = snapshots.length === known.length && snapshots.length ? " · снимки: " + dateTime(snapshots[0]) + (snapshots.length > 1 && dateTime(snapshots[snapshots.length-1]) !== dateTime(snapshots[0]) ? " — " + dateTime(snapshots[snapshots.length-1]) : "") : " · время снимков: Нет данных";
      var partialEffort = known.length < tasks.length || !tasks.some(function(task) { return task.key === group.key; });
      $root.append(textNode("p","ujg-esi-management-total","Учтено на момент снимков по задачам: " + (known.length ? duration(known.reduce(function(sum,task) { return sum + task.spentSeconds; },0)) : "Нет данных") + (partialEffort ? " · частичный итог" : "") + snapshotLabel));
    }
    var dayEvents = list(report.events).filter(function(event) { return list(group.events).some(function(item) { return item.id === event.id; }); });
    if (dayEvents.length) {
      var $day = $("<section/>").addClass("ujg-esi-management-day-events").append(textNode("h4","ujg-esi-management-evidence-heading","Движения за день"));
      dayEvents.forEach(function(event) { $day.append(eventRow(event,state)); });
      $root.append($day);
    }
    if (tasks.length) {
      var $scroll = $("<div/>").addClass("ujg-esi-management-task-scroll"), $table = $("<table/>").addClass("ujg-esi-management-task-table");
      $table.append($("<thead/>").append($("<tr/>").append(["Задача","Роль","На конец периода","Завершил · время","Календарно","Учтено на снимке"].map(function(label) { return textNode("th","",label); }))));
      var $tbody = $("<tbody/>");
      tasks.forEach(function(task) {
        $tbody.append($("<tr/>").append($("<td/>").append(keyNode(task.key,state.baseUrl),textNode("small","",task.summary)),$("<td/>").append(roleNode(task.role,task.summary,task.roleColor)),textNode("td","",task.status ? activity.statusLabel ? activity.statusLabel(task.status) : task.status : "Нет данных"),textNode("td","",(task.completedBy ? person(task.completedBy) + " · " : "") + dateTime(task.completedAt)),textNode("td","",calendarDuration(task.elapsedSeconds)),textNode("td","",duration(task.spentSeconds))));
      });
      $root.append($scroll.append($table.append($tbody)));
      var teamTotals = Object.create(null), teamIncomplete = false;
      tasks.forEach(function(task) {
        if (task.worklogsComplete !== true) teamIncomplete = true;
        list(task.worklogs).forEach(function(log) { if (typeof log.seconds === "number" && isFinite(log.seconds) && log.seconds >= 0) teamTotals[value(log.team)] = (teamTotals[value(log.team)] || 0) + log.seconds; else teamIncomplete = true; });
      });
      var $teams = $("<p/>").addClass("ujg-esi-management-teams").append(textNode("strong","","Вклад команд · на момент снимков; текущий состав команд"));
      Object.keys(teamTotals).forEach(function(team) { $teams.append(textNode("span","",team + ": " + duration(teamTotals[team]))); });
      if (!Object.keys(teamTotals).length) $teams.append(textNode("span","","Нет данных"));
      if (teamIncomplete) $teams.append(textNode("em","","Возможно неполно"));
      $root.append($teams);
      $root.append(textNode("h4","ujg-esi-management-evidence-heading","Детали задач"));
      tasks.forEach(function(task) { $root.append(taskDetail(task,state,services,report)); });
    }
    list(info.notes).forEach(function(note) { $root.append(textNode("p","ujg-esi-management-note",note)); });
    return $root;
  }
  function render(report, metric, state, services) {
    report = report || {}; state = state || {}; services = services || {};
    var groups = selectedGroups(report,metric), $root = $("<div/>").addClass("ujg-esi-management-panel");
    var reportDate = /^\d{4}-\d{2}-\d{2}$/.test(report.date || "") ? report.date.split("-").reverse().join(".") : value(report.date);
    var $head = $("<header/>").addClass("ujg-esi-management-header").append($("<div/>").append(textNode("h2","",titles[metric] || "Сводка"),textNode("span","ujg-esi-management-date",reportDate + " · МСК")));
    if (metric === "completed") $head.children("div").append(textNode("p","ujg-esi-management-definition",completedDefinition));
    if (metric === "reopened") $head.children("div").append(textNode("p","ujg-esi-management-definition",reopenedDefinition));
    $head.append($("<button type='button'/>").addClass("ujg-esi-management-close").attr({title:"Закрыть сводку","aria-label":"Закрыть сводку"}).append(icon("X")).on("click",function() { if (services.onClose) services.onClose(); }));
    $root.append($head,warning(report));
    var $body = $("<div/>").addClass("ujg-esi-management-body"), $list = $("<nav/>").addClass("ujg-esi-management-list").attr("aria-label","Замечания"), $detail = $("<main/>").addClass("ujg-esi-management-detail-host");
    if (metric === "events") {
      $list.append(textNode("h3","","Область"));
      var allEvents = list(report.events).slice().sort(function(a,b) { return Date.parse(a.at) - Date.parse(b.at); });
      function renderEvents(scope) {
        $detail.empty().append(textNode("h3","ujg-esi-management-events-heading",scope ? value(scope.summary) : "Все события"));
        var events = scope ? allEvents.filter(function(event) { return list(scope.events).some(function(entry) { return entry.id === event.id; }); }) : allEvents;
        if (!events.length) $detail.append(textNode("p","ujg-esi-management-empty","Нет данных"));
        var hour = "";
        events.forEach(function(event) {
          var parents = scope ? [scope] : list(report.groups).filter(function(item) { return list(item.events).some(function(entry) { return entry.id === event.id; }); });
          var currentHour = dateTime(event.at).slice(11,13);
          if (currentHour !== hour) { hour = currentHour; $detail.append(textNode("h4","ujg-esi-management-hour",hour + ":00")); }
          var $row = eventRow(event,state);
          parents.forEach(function(group) { $row.append($("<small/>").append(groupLabel(group,state))); });
          $detail.append($row);
        });
      }
      function scopeButton(group) {
        var $button = $("<button type='button'/>").addClass("ujg-esi-management-event-scope").append(group ? plainGroupLabel(group) : textNode("strong","","Все события"));
        $button.on("click",function() { $list.find(".ujg-esi-management-event-scope").removeClass("is-selected").attr("aria-current",null); $button.addClass("is-selected").attr("aria-current","true"); renderEvents(group); });
        $list.append($button);
        return $button;
      }
      scopeButton(null).trigger("click");
      groups.forEach(scopeButton);
    } else {
      $list.append(textNode("h3","","Замечания"));
      if (!groups.length) $list.append(textNode("p","ujg-esi-management-empty","Нет данных"));
      groups.forEach(function(group,index) {
        var $button = $("<button type='button'/>").addClass("ujg-esi-management-remark").append(plainGroupLabel(group)).on("click",function() {
          $list.find(".ujg-esi-management-remark").removeClass("is-selected").attr("aria-current",null);
          $button.addClass("is-selected").attr("aria-current","true");
          $detail.empty().append(detail(group,metric,state,services,report));
        });
        $list.append($button);
        if (index === 0) $button.trigger("click");
      });
    }
    $body.append($list,$detail);
    return $root.append($body);
  }
  return {preview:preview,render:render};
});
