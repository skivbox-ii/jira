define("_ujgESI_activityUi", ["jquery", "_ujgESI_activity", "_ujgESI_icons"], function($, activity, icon) {
  "use strict";

  function moscowToday() { return new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10); }
  function validDate(value) {
    return /^\d{4}-\d{2}-\d{2}$/.test(value) && !isNaN(Date.parse(value)) && new Date(value + "T00:00:00Z").toISOString().slice(0, 10) === value;
  }
  function shiftDate(value, days) {
    return new Date(Date.parse(value + "T00:00:00Z") + days * 86400000).toISOString().slice(0, 10);
  }
  function label(value) {
    if (value == null || value === "") return "Не указано";
    return typeof value === "object" ? String(value.label || "Не указано") : String(value);
  }
  function roleLabel(value) { return value == null || value === "" ? "История" : label(value); }
  function issueKeyNode(key, baseUrl) {
    var value = String(key || "");
    if (!value) return $("<span/>");
    try {
      var base = new URL(String(baseUrl || ""));
      if (!/^https?:$/.test(base.protocol) || base.username || base.password) throw new Error("Unsafe Jira URL");
      base.search = ""; base.hash = "";
      return $("<a/>").attr({href:base.href.replace(/\/+$/,"") + "/browse/" + encodeURIComponent(value),target:"_blank",rel:"noopener noreferrer"}).text(value);
    } catch (ignore) { return $("<span/>").text(value); }
  }
  function metric(value) { return value == null ? "Нет данных" : String(value); }
  function time(at) {
    var value = typeof at === "number" ? at : Date.parse(at);
    if (!isFinite(value)) return "—";
    return new Date(value + 3 * 3600000).toISOString().slice(11, 16);
  }
  function timestamp(at) { return typeof at === "number" ? at : Date.parse(at); }
  function cutoff(report) {
    if (!report.asOf) return "24:00";
    return timestamp(report.asOf) === Number(report.end) ? "24:00" : time(report.asOf);
  }
  function button(name, title, onClick) {
    return $("<button/>").attr({type:"button", title:title, "aria-label":title}).addClass("ujg-esi-activity-icon-button").append(icon(name)).on("click", onClick);
  }
  function safeColor(value) { return /^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(value || "") ? value : ""; }
  function personNode(value) {
    var name = label(value), parts = name.split(/\s+/), initials = parts.slice(0,2).map(function(part) { return part.slice(0,1); }).join("").toUpperCase();
    var $node = $("<span/>").addClass("ujg-esi-activity-person");
    var $avatar = $("<span/>").addClass("ujg-esi-activity-avatar").attr("aria-hidden","true").text(initials);
    var color = safeColor(value && value.color) || "#e5e9ee";
    var hex = color.length === 4 ? color.slice(1).split("").map(function(c) { return c+c; }).join("") : color.slice(1);
    var channels = [0,2,4].map(function(offset) {
      var channel = parseInt(hex.slice(offset,offset+2),16) / 255;
      return channel <= 0.04045 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055,2.4);
    });
    var luminance = 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
    $avatar.css({"background-color":color,color:1.05 / (luminance + 0.05) >= 4.5 ? "#fff" : "#000"});
    return $node.append($avatar,$("<span/>").text(name));
  }
  function roleClass(value) {
    var role = String(value || "").toUpperCase();
    if (/\bQA\b|ТЕСТ/.test(role)) return "role-qa";
    if (/\bBE\b|BACK/.test(role)) return "role-be";
    if (/\bFE\b|FRONT/.test(role)) return "role-fe";
    return "role-other";
  }
  function create() {
    var date = moscowToday(), filters = {}, sort = {key:"time", descending:false}, collapsed = {}, $host, currentState, currentServices;
    var fields = [
      {key:"time", title:"Время, МСК", value:function(event) { return time(event.at); }},
      {key:"remark", title:"ID · Замечание", value:function(event,group) { return String(group.remarkId || group.key || ""); }},
      {key:"role", title:"Тикет · Роль", value:function(event) { return roleLabel(event.role); }},
      {key:"change", title:"Изменение", value:function(event) { return event.kind === "created" ? "Создано" : label(event.from) + " → " + label(event.to); }},
      {key:"assignee", title:"Исполнитель / передача", value:function(event) { return label(event.assignee); }},
      {key:"author", title:"Кто изменил", value:function(event) { return label(event.author); }}
    ];
    function matching(event, group) {
      return fields.every(function(field) { return !filters[field.key] || field.value(event,group) === filters[field.key]; });
    }
    function filtered(report) {
      var groups = (report.groups || []).map(function(group) {
        return Object.assign({}, group, {events:(group.events || []).filter(function(event) { return matching(event,group); })});
      }).filter(function(group) { return group.events.length; });
      var ids = Object.create(null), events = [];
      groups.forEach(function(group) { group.events.forEach(function(event) {
        var key = String(event.id == null ? event.issueKey + ":" + event.at + ":" + event.kind : event.id);
        if (!ids[key]) { ids[key] = true; events.push(event); }
      }); });
      return Object.assign({}, report, {groups:groups, events:events});
    }
    function sortedEvents(events, group) {
      var field = fields.filter(function(item) { return item.key === sort.key; })[0] || fields[0];
      return events.slice().sort(function(a,b) {
        var left = field.key === "time" ? timestamp(a.at) : field.value(a,group).toLocaleLowerCase();
        var right = field.key === "time" ? timestamp(b.at) : field.value(b,group).toLocaleLowerCase();
        var comparison = left < right ? -1 : left > right ? 1 : 0;
        return (sort.descending ? -comparison : comparison) || String(a.id || "").localeCompare(String(b.id || ""));
      });
    }
    function sortedGroups(groups) {
      var field = fields.filter(function(item) { return item.key === sort.key; })[0] || fields[0];
      return groups.slice().sort(function(a,b) {
        var first = sortedEvents(a.events,a)[0], second = sortedEvents(b.events,b)[0];
        var left = field.key === "time" ? timestamp(first.at) : field.value(first,a).toLocaleLowerCase();
        var right = field.key === "time" ? timestamp(second.at) : field.value(second,b).toLocaleLowerCase();
        return (left < right ? -1 : left > right ? 1 : 0) * (sort.descending ? -1 : 1);
      });
    }
    function download(report, state) {
      var snapshot = filtered(report);
      snapshot.groups = sortedGroups(snapshot.groups).map(function(group) { return Object.assign({},group,{events:sortedEvents(group.events,group)}); });
      var html = activity.exportHtml(snapshot, {projectKey:state.projectKey, epicKey:state.epicKey, filters:Object.assign({},filters), sort:Object.assign({},sort)});
      var url = URL.createObjectURL(new Blob([html], {type:"text/html;charset=utf-8"}));
      var anchor = document.createElement("a");
      anchor.href = url; anchor.download = "activity-" + date + ".html";
      document.body.appendChild(anchor); anchor.click(); anchor.remove();
      setTimeout(function() { URL.revokeObjectURL(url); }, 0);
    }
    function draw() {
      var state = currentState || {}, services = currentServices || {};
      var report = activity.summarize(state.rows || [], state.teams || [], {date:date, scopeWarning:state.viewMode === "jira" ? state.registryWarning : undefined});
      var coverage = report.coverage || {}, metrics = report.metrics || {}, observed = report.observed || {}, balance = report.balance || {};
      fields.forEach(function(field) {
        if (!filters[field.key]) return;
        var found = (report.groups || []).some(function(group) { return (group.events || []).some(function(event) { return field.value(event,group) === filters[field.key]; }); });
        if (!found) delete filters[field.key];
      });
      var journal = filtered(report), $root = $("<div/>").addClass("ujg-esi-activity");
      var $toolbar = $("<div/>").addClass("ujg-esi-activity-toolbar");
      $toolbar.append($("<h2/>").text("Динамика замечаний"));
      var $controls = $("<div/>").addClass("ujg-esi-activity-controls");
      $controls.append(button("ChevronLeft","Предыдущий день",function() { date = shiftDate(date,-1); filters = {}; draw(); }));
      $controls.append($("<input/>").addClass("ujg-esi-activity-date").attr({type:"date", "aria-label":"Дата отчёта"}).val(date).on("change",function() {
        if (validDate(this.value)) { if (date !== this.value) filters = {}; date = this.value; draw(); } else $(this).val(date);
      }));
      $controls.append(button("ChevronRight","Следующий день",function() { date = shiftDate(date,1); filters = {}; draw(); }));
      $controls.append($("<span/>").addClass("ujg-esi-activity-zone").text("00:00–" + cutoff(report) + " · МСК"));
      $controls.append(button("Download","Скачать HTML",function() { download(report,state); }));
      $toolbar.append($controls); $root.append($toolbar);
      $root.append($("<p/>").addClass("ujg-esi-activity-scope").text("Загруженные замечания · " + label(state.projectKey) + (state.epicKey ? " · " + state.epicKey : "") + " · текущие связи и настройки команд; история состава связей недоступна."));
      if (state.viewMode === "jira" && state.registryWarning) $root.append($("<p/>").addClass("ujg-esi-activity-warning").text(state.registryWarning));
      var partialDay = report.asOf && timestamp(report.asOf) !== Number(report.end);
      var $metrics = $("<section/>").addClass("ujg-esi-activity-summary").append($("<h3/>").text(partialDay ? "Итоги на " + cutoff(report) + " МСК" : "Итоги за весь день"));
      var $band = $("<div/>").addClass("ujg-esi-activity-metrics");
      [["changed","Замечаний с изменениями"],["newRemarks","Создано замечаний"],["completed","Стали готовы"],["reopened","Возвращены в работу"],["events","Событий"]].forEach(function(item) {
        var value = metrics[item[0]], lowerBound = value == null && (item[0] === "changed" || item[0] === "newRemarks") && observed[item[0]] != null;
        var display = value != null ? String(value) : lowerBound ? "≥" + observed[item[0]] : "—";
        var title = value != null ? item[1] : lowerBound ? "Зафиксировано по загруженной истории; итог может быть больше" : "Недостаточно истории для итогового значения";
        $band.append($("<div/>").addClass("ujg-esi-activity-metric").attr("data-metric",item[0])
          .append($("<strong/>").attr("title",title).text(display), $("<span/>").text(item[1])));
      });
      $metrics.append($band,$("<p/>").addClass("ujg-esi-activity-balance").text("Открытые замечания: " + metric(balance.startOpen) + " на начало · " + metric(balance.endOpen) + " на конец"));
      if ((state.rows || []).length) $root.append($metrics);
      var $flows = $("<div/>").addClass("ujg-esi-activity-flows");
      var $statusSection = $("<section/>").append($("<h3/>").text("Переходы статусов задач"));
      var $statusFlow = $("<div/>").addClass("ujg-esi-activity-status-flows");
      (report.transitions || []).forEach(function(item) {
        $statusFlow.append($("<div/>").addClass("ujg-esi-activity-flow").append(
          $("<span/>").addClass("ujg-esi-activity-flow-state").text(label(item.from)),
          $("<span/>").addClass("ujg-esi-activity-flow-arrow").append($("<strong/>").text(metric(item.count)),icon("ChevronRight")),
          $("<span/>").addClass("ujg-esi-activity-flow-state").text(label(item.to))));
      });
      if (!(report.transitions || []).length) $statusFlow.text(coverage.isComplete ? "Нет переходов за день" : "Не зафиксировано в загруженной истории");
      $flows.append($statusSection.append($statusFlow));
      var $transferSection = $("<section/>").append($("<h3/>").text("Передачи между командами"));
      var transfers = report.transfers || [], names = Object.create(null);
      transfers.forEach(function(item) { names[label(item.from)] = true; names[label(item.to)] = true; });
      var parties = Object.keys(names).sort(), $matrixScroll = $("<div/>").addClass("ujg-esi-activity-matrix-scroll");
      var $matrix = $("<table/>").addClass("ujg-esi-activity-transfer-matrix").attr("aria-label","Передачи между командами");
      var $matrixHead = $("<tr/>").append($("<th/>").attr("scope","col").text("Из → В"));
      parties.forEach(function(name) { $matrixHead.append($("<th/>").attr("scope","col").text(name)); });
      $matrix.append($("<thead/>").append($matrixHead));
      var $matrixBody = $("<tbody/>");
      parties.forEach(function(from) {
        var $row = $("<tr/>").append($("<th/>").attr("scope","row").text(from));
        parties.forEach(function(to) {
          var match = transfers.filter(function(item) { return label(item.from) === from && label(item.to) === to; })[0];
          $row.append($("<td/>").toggleClass("has-transfer",!!match).text(match ? metric(match.count) : "–"));
        });
        $matrixBody.append($row);
      });
      if (transfers.length) $transferSection.append($matrixScroll.append($matrix.append($matrixBody)));
      else $transferSection.append($("<p/>").addClass("ujg-esi-activity-flow-empty").text(coverage.isComplete ? "Нет передач за день" : "Не зафиксировано в загруженной истории"));
      $flows.append($transferSection);
      if ((state.rows || []).length) $root.append($flows);
      var $coverage = $("<div/>").addClass("ujg-esi-activity-coverage");
      $coverage.append($("<span/>").text("История: " + (coverage.complete || 0) + " из " + (coverage.total || 0) + " · МСК"));
      if ((coverage.warnings || []).length) {
        var warnings = coverage.warnings;
        var $details = $("<details/>").addClass("ujg-esi-activity-warning-details");
        $details.append($("<summary/>").text(warnings.length + " предупреждения · " + warnings.slice(0,2).join(" · ")));
        var $warningList = $("<div/>").addClass("ujg-esi-activity-warning-list");
        warnings.forEach(function(warning) { $warningList.append($("<div/>").text(warning)); });
        $coverage.append($details.append($warningList));
      }
      if (coverage.total || state.activityError || state.activityLoading) {
        if (services.onLoadActivityHistory) $coverage.append(button("RefreshCw","Обновить историю",function() { services.onLoadActivityHistory(); }).prop("disabled",!!(state.activityLoading || state.loading || state.syncLoading || state.registryLoading)));
        if (state.activityLoading) $coverage.append($("<span/>").text("Загрузка истории…"));
        if (state.activityError) $coverage.append($("<span/>").addClass("ujg-esi-activity-error").text(state.activityError));
      }
      $root.append($coverage);
      var $journal = $("<section/>").addClass("ujg-esi-activity-journal");
      $journal.append($("<div/>").addClass("ujg-esi-activity-journal-heading").append($("<h3/>").text("Изменения по замечаниям"),$("<span/>").text("Фильтры только для журнала · " + journal.groups.length + " замечаний · " + journal.events.length + " событий")));
      if (!(state.rows || []).length) $journal.append($("<p/>").addClass("ujg-esi-activity-empty").text("Загрузите источник и связанный состав Jira, чтобы увидеть активность."));
      else if (!journal.groups.length) $journal.append($("<p/>").addClass("ujg-esi-activity-empty").text("Для выбранного дня и фильтров событий нет."));
      var $scroll = $("<div/>").addClass("ujg-esi-activity-scroll"), $table = $("<table/>").addClass("ujg-esi-activity-table").attr("aria-label","Журнал изменений");
      var $head = $("<tr/>");
      fields.forEach(function(field) {
        var $th = $("<th/>").attr("scope","col"), $line = $("<div/>").addClass("ujg-esi-activity-th-line");
        $line.append($("<button/>").attr({type:"button","data-activity-sort":field.key,"aria-label":"Сортировать: " + field.title}).text(field.title).on("click",function() {
          sort = {key:field.key,descending:sort.key === field.key && !sort.descending}; draw();
        }));
        var values = Object.create(null);
        (report.groups || []).forEach(function(group) { (group.events || []).forEach(function(event) { values[field.value(event,group)] = true; }); });
        var $select = $("<select/>").attr({"data-activity-filter":field.key,"aria-label":"Фильтр: " + field.title,"title":"Фильтр: " + field.title});
        $select.append($("<option/>").val("").text("Все"));
        Object.keys(values).sort().forEach(function(value) { $select.append($("<option/>").val(value).text(value)); });
        $select.val(filters[field.key] || "").on("change",function() { filters[field.key] = this.value; draw(); });
        $th.append($line,$select); $head.append($th);
      });
      var $body = $("<tbody/>");
      sortedGroups(journal.groups).forEach(function(group) {
        var key = String(group.id || group.key || group.remarkId), isCollapsed = !!collapsed[key];
        var $group = $("<tr/>").addClass("ujg-esi-activity-group");
        $group.append($("<th/>").attr({scope:"rowgroup",colspan:fields.length}).append(
          button(isCollapsed ? "ChevronRight" : "ChevronDown",(isCollapsed ? "Развернуть " : "Свернуть ") + label(group.remarkId || group.key),function() { collapsed[key] = !collapsed[key]; draw(); })
            .addClass("ujg-esi-activity-group-toggle").attr("aria-expanded",String(!isCollapsed)),
          $("<span/>").addClass("ujg-esi-activity-group-key").append($("<span/>").text("#" + label(group.remarkId || group.key)),group.key ? issueKeyNode(group.key,state.baseUrl) : $("<span/>")),
          $("<span/>").text(group.summary || ""), $("<small/>").text(" · " + group.events.length)));
        $body.append($group);
        if (isCollapsed) return;
        sortedEvents(group.events,group).forEach(function(event) {
          var $row = $("<tr/>").addClass("ujg-esi-activity-event");
          $row.append($("<td/>").text(time(event.at)));
          $row.append($("<td/>").text(group.key || group.remarkId || ""));
          var $role = $("<span/>").addClass("ujg-esi-activity-role " + roleClass(event.role)).text(roleLabel(event.role));
          if (safeColor(event.roleColor)) $role.css("border-color",event.roleColor).css("color",event.roleColor);
          $row.append($("<td/>").append($("<span/>").addClass("ujg-esi-activity-issue").append(issueKeyNode(event.issueKey,state.baseUrl)),$role,event.summary ? $("<div/>").addClass("ujg-esi-activity-task-summary").text(event.summary) : $("<span/>")));
          var change = event.kind === "created" ? "Создано" : label(event.from) + " → " + label(event.to);
          $row.append($("<td/>").append($("<span/>").text(change),event.kind === "field" ? $("<small/>").text(" · " + label(event.field)) : $("<span/>")));
          var assignee = event.kind === "assignee" ? label(event.fromAssignee || event.from) + " → " + label(event.toAssignee || event.to) : label(event.assignee);
          var $assigneeCell = $("<td/>").append(personNode(event.assignee));
          if (event.kind === "assignee" && event.fromTeam !== event.toTeam) $assigneeCell.append($("<small/>").addClass("ujg-esi-activity-team-move").text(label(event.fromTeam) + " → " + label(event.toTeam)));
          else if (event.kind === "assignee") $assigneeCell.append($("<small/>").addClass("ujg-esi-activity-team-move").text(assignee));
          $row.append($assigneeCell);
          $row.append($("<td/>").append(personNode(event.author))); $body.append($row);
        });
      });
      $journal.append($scroll.append($table.append($("<thead/>").append($head),$body)));
      $root.append($journal); $host.empty().append($root);
    }
    return {render:function($parent,state,services) {
      if (!$host || !$host.length || $host.parent()[0] !== $parent[0]) $host = $("<div/>").addClass("ujg-esi-activity-mount").appendTo($parent);
      currentState = state || {}; currentServices = services || {}; draw();
    }};
  }
  return {create:create};
});
