define("_ujgESI_activityUi", ["jquery", "_ujgESI_activity", "_ujgESI_icons", "_ujgESI_activityManagementUi", "_ujgESI_activityAiUi"], function($, activity, icon, managementUi, activityAiUi) {
  "use strict";
  var sequence = 0;

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
  function deadlineDate(value) { return /^\d{4}-\d{2}-\d{2}$/.test(value || "") ? value.slice(8,10) + "." + value.slice(5,7) + "." + value.slice(0,4) : "Нет данных"; }
  function deadlineText(deadline) {
    deadline = deadline || {};
    var date = deadline.date ? deadlineDate(deadline.date) : "";
    var state = deadline.state || "missing";
    if (state === "missing") return "Срок не указан";
    if (state === "invalid") return "Некорректный срок";
    if (state === "conflict") return "Противоречивый срок";
    var suffix = {today:"сегодня",tomorrow:"завтра",completed:"готово",cancelled:"отменено",unknown:"состояние не подтверждено"}[state];
    if (state === "overdue") suffix = "просрочено " + deadline.daysOverdue + " д";
    return "Срок: " + (date || "не указан") + (suffix ? " · " + suffix : "");
  }
  function deadlineTitle(deadline, referenceDate) {
    deadline = deadline || {};
    var source = deadline.source === "excel" ? "текущий журнал Excel" : deadline.source === "jira-description" ? "сохранённое описание Jira" : "не указан";
    return "Источник срока: " + source + (deadline.field ? " · Поле: " + String(deadline.field) : "") + (deadline.raw != null && deadline.raw !== "" ? " · Значение: " + String(deadline.raw) : "") + " · На сегодня, " + deadlineDate(deadline.referenceDate || referenceDate) + " МСК; история переносов срока неизвестна";
  }
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
    var aiUi = activityAiUi.create();
    var namespace = ".ujgActivity" + (++sequence);
    var date = moscowToday(), filters = {}, sort = {key:"time", descending:false}, collapsed = {}, $host, currentState, currentServices;
    var layoutKey, order, hidden = {}, widths = {}, $popover, popoverAnchor, drag, suppressPopoverFocus = false;
    var resizeObserver, observedViewportWidth;
    var $managementDialog, managementAnchor, bodyOverflow, previewTimer, previewCloseTimer;
    var fields = [
      {key:"time", title:"Время", width:100, value:function(event) { return time(event.at); }},
      {key:"remark", title:"ID · Замечание", width:130, value:function(event,group) { return String(group.remarkId || group.key || ""); }},
      {key:"role", title:"Тикет · Роль", width:240, value:function(event) { return roleLabel(event.role); }},
      {key:"change", title:"Изменение", width:230, value:function(event) { return activity.eventText(event); }, filterValue:function(event) { return activity.eventCategory(event); }},
      {key:"assignee", title:"Исполнитель / передача", width:190, value:function(event) { return label(event.assignee); }},
      {key:"author", title:"Кто изменил", width:145, value:function(event) { return label(event.author); }}
    ];
    order = fields.map(function(field) { return field.key; });
    function clampWidth(value, fallback) { return typeof value === "number" && isFinite(value) ? Math.max(55, Math.min(1600, Math.round(value))) : fallback; }
    function loadLayout(key) {
      layoutKey = key; order = fields.map(function(field) { return field.key; }); hidden = {remark:true}; widths = {}; filters = {}; sort = {key:"time",descending:false};
      try {
        var data = JSON.parse(window.localStorage.getItem(key) || "null");
        if (!data || typeof data !== "object") return;
        var known = order.slice(), seen = Object.create(null);
        if (Array.isArray(data.order)) order = data.order.filter(function(id) { if (known.indexOf(id) < 0 || seen[id]) return false; seen[id] = true; return true; }).concat(known.filter(function(id) { return !seen[id]; }));
        if (Array.isArray(data.visible) && data.visible.some(function(id) { return known.indexOf(id) >= 0; })) known.forEach(function(id) { hidden[id] = data.visible.indexOf(id) < 0; });
        if (data.version !== 2) { hidden.remark = true; if (known.every(function(id) { return hidden[id]; })) hidden.time = false; }
        fields.forEach(function(field) {
          if (data.widths && typeof data.widths[field.key] === "number" && isFinite(data.widths[field.key])) widths[field.key] = clampWidth(data.widths[field.key],field.width);
        });
        if (data.sort && known.indexOf(data.sort.key) >= 0) sort = {key:data.sort.key,descending:!!data.sort.descending};
        if (data.filters && typeof data.filters === "object") known.forEach(function(id) {
          if (Array.isArray(data.filters[id])) filters[id] = data.filters[id].filter(function(value,index,array) { return typeof value === "string" && array.indexOf(value) === index; });
        });
        // Old selections contain full event text, not change categories.
        if (data.changeFilterVersion !== 1 && filters.change && filters.change.length) delete filters.change;
        if (data.version !== 2 || data.changeFilterVersion !== 1) saveLayout();
      } catch (ignore) { /* Storage is best-effort. */ }
    }
    function saveLayout() {
      try { window.localStorage.setItem(layoutKey,JSON.stringify({version:2,changeFilterVersion:1,order:order.slice(),visible:order.filter(function(id) { return !hidden[id]; }),widths:widths,sort:sort,filters:filters})); }
      catch (ignore) { /* Storage is best-effort. */ }
    }
    function visibleFields() { return order.filter(function(id) { return !hidden[id]; }).map(function(id) { return fields.filter(function(field) { return field.key === id; })[0]; }); }
    function tableLayout(shown, available) {
      var result = Object.create(null), total = 0;
      shown.forEach(function(field) { result[field.key] = widths[field.key] || field.width; total += result[field.key]; });
      available = available || $host && $host.width() || 0;
      var extra = Math.max(0,available-total);
      if (extra) {
        var flexible = shown.filter(function(field) { return widths[field.key] == null && (field.key === "role" || field.key === "change"); });
        if (!flexible.length) flexible = shown.filter(function(field) { return widths[field.key] == null; });
        var weight = flexible.reduce(function(sum,field) { return sum + (field.key === "role" ? 3 : field.key === "change" ? 2 : 1); },0);
        var remaining = extra;
        flexible.forEach(function(field,index) {
          var portion = field.key === "role" ? 3 : field.key === "change" ? 2 : 1;
          var added = index === flexible.length - 1 ? remaining : Math.round(extra * portion / weight);
          result[field.key] += added; total += added; remaining -= added;
        });
      }
      return {widths:result,total:total};
    }
    function resize() {
      if (!$host || !$host[0].isConnected) return;
      if ($popover && popoverAnchor && $popover.hasClass("ujg-esi-activity-metric-preview")) placePopover(popoverAnchor);
      var $scroll = $host.find(".ujg-esi-activity-scroll"), $table = $scroll.find(".ujg-esi-activity-table");
      if (!$table.length) return;
      observedViewportWidth = $scroll[0].clientWidth;
      var layout = tableLayout(visibleFields(),observedViewportWidth), scrollLeft = $scroll.scrollLeft();
      Object.keys(layout.widths).forEach(function(key) { $table.find('col[data-column="'+key+'"]').css("width",layout.widths[key]+"px"); });
      $table.css({width:layout.total+"px",minWidth:layout.total+"px"});
      $scroll.scrollLeft(scrollLeft);
    }
    function columnWidth(field) {
      var header = $host.find('th[data-column="'+field.key+'"]')[0];
      return header && header.getBoundingClientRect().width || parseFloat($host.find('col[data-column="'+field.key+'"]').css("width")) || widths[field.key] || field.width;
    }
    function closePopover(focus) {
      clearTimeout(previewTimer); clearTimeout(previewCloseTimer);
      if ($popover) $popover.remove(); $popover = null;
      if (popoverAnchor) { $(popoverAnchor).attr("aria-expanded","false"); if (focus && document.contains(popoverAnchor)) { suppressPopoverFocus = true; popoverAnchor.focus(); suppressPopoverFocus = false; } }
      popoverAnchor = null;
    }
    function dismissPopover() {
      if ($managementDialog) { closeManagement(true); return true; }
      var opened = !!($popover && $popover[0].isConnected);
      closePopover(opened);
      return opened;
    }
    function closeManagement(focus) {
      if ($managementDialog) { $managementDialog.remove(); document.body.style.overflow = bodyOverflow; }
      $managementDialog = null;
      if (managementAnchor) {
        $(managementAnchor).attr("aria-expanded","false");
        if (focus && document.contains(managementAnchor)) {
          suppressPopoverFocus = true; managementAnchor.focus(); suppressPopoverFocus = false;
        }
      }
      managementAnchor = null;
    }
    function openManagement(anchor, report, key, state) {
      closePopover(); closeManagement();
      managementAnchor = anchor; $(anchor).attr("aria-expanded","true");
      bodyOverflow = document.body.style.overflow; document.body.style.overflow = "hidden";
      $managementDialog = $("<div/>").addClass("ujg-esi-management-dialog").attr({role:"dialog","aria-modal":"true","aria-label":$(anchor).find("span").last().text(),tabindex:"-1"}).appendTo($host);
      $managementDialog.append(managementUi.render(report,key,state,Object.assign({},currentServices,{onClose:function() { closeManagement(true); },onOpenMetric:function(nextKey) { openManagement(anchor,report,nextKey,state); }})));
      $managementDialog.attr("aria-label",$managementDialog.find(".ujg-esi-management-header h2").first().text() || "Сводка");
      $managementDialog.on("keydown",function(event) {
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closeManagement(true); return; }
        if (event.key !== "Tab") return;
        var $focusable = $managementDialog.find('a[href],button,input,select,textarea,summary,[tabindex="0"]').filter(function() {
          var node = this;
          return !this.disabled && !this.hidden && !$(this).closest("[hidden]").length && !$(this).parents("details:not([open])").toArray().some(function(details) { return details.querySelector("summary") !== node; });
        });
        var first = $focusable[0], last = $focusable[$focusable.length-1];
        if (!first) { event.preventDefault(); $managementDialog.trigger("focus"); }
        else if (event.shiftKey && (document.activeElement === first || document.activeElement === $managementDialog[0])) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      });
      $managementDialog.trigger("focus");
    }
    function previewMetric(anchor, report, key, state) {
      if ($managementDialog || suppressPopoverFocus || !document.contains(anchor)) return;
      if ($popover && popoverAnchor === anchor) { clearTimeout(previewCloseTimer); return; }
      var viewportWidth = document.documentElement.clientWidth || window.innerWidth;
      var $box = popup(anchor,$(anchor).find("span").last().text(),"ujg-esi-activity-metric-preview",Math.round(viewportWidth * 0.9));
      $box.css("left",Math.max(12,Math.round((viewportWidth - $box.outerWidth()) / 2)));
      $box.append(managementUi.preview(report,key,state,{onOpen:function() { openManagement(anchor,report,key,state); },onOpenMetric:function(nextKey) { openManagement(anchor,report,nextKey,state); }}));
      $box.on("mouseenter focusin",function() { clearTimeout(previewCloseTimer); })
        .on("mouseleave",schedulePreviewClose);
      placePopover(anchor);
    }
    function schedulePreviewClose() {
      clearTimeout(previewTimer); clearTimeout(previewCloseTimer);
      previewCloseTimer = setTimeout(function() { if ($popover && $popover.hasClass("ujg-esi-activity-metric-preview")) closePopover(); },180);
    }
    function popup(anchor, title, className, width) {
      closePopover(); popoverAnchor = anchor; $(anchor).attr("aria-expanded","true");
      $popover = $("<div/>").addClass(className).attr({role:"dialog","aria-label":title,tabindex:"-1"}).appendTo($host);
      var rect = anchor.getBoundingClientRect(), viewportWidth = document.documentElement.clientWidth || window.innerWidth;
      var viewportHeight = document.documentElement.clientHeight || window.innerHeight, w = Math.min(width,Math.max(180,viewportWidth-24));
      $popover.css({position:"fixed",width:w,left:Math.max(12,Math.min(rect.left,viewportWidth-w-12)),top:12,maxHeight:Math.max(120,viewportHeight-24)});
      $popover.on("keydown",function(event) { if (event.key === "Escape") { event.stopPropagation(); closePopover(true); } });
      return $popover;
    }
    function placePopover(anchor) {
      var rect = anchor.getBoundingClientRect(), viewportHeight = document.documentElement.clientHeight || window.innerHeight;
      if ($popover.hasClass("ujg-esi-activity-metric-preview")) {
        var viewportWidth = document.documentElement.clientWidth || window.innerWidth;
        $popover.css({width:Math.min(Math.round(viewportWidth * 0.9),Math.max(180,viewportWidth-24)),left:Math.max(12,Math.round(viewportWidth * 0.05))});
        var below = Math.max(0,viewportHeight - rect.bottom - 16), above = Math.max(0,rect.top - 16);
        var useAbove = below < 180 && above > below, available = useAbove ? above : below;
        $popover.css("maxHeight",available);
        $popover.find(".ujg-esi-management-preview").css("maxHeight",Math.max(0,available - 26));
        $popover.css("top",useAbove ? Math.max(12,rect.top - $popover.outerHeight() - 4) : rect.bottom + 4);
        return;
      }
      $popover.css("top",Math.max(12,Math.min(rect.bottom+4,viewportHeight-$popover.outerHeight()-12)));
    }
    function matching(event, group) {
      return fields.every(function(field) { return !Array.isArray(filters[field.key]) || filters[field.key].indexOf((field.filterValue || field.value)(event,group)) >= 0; });
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
    function filterMenu(anchor, field, report) {
      var values = Object.create(null), options;
      (report.groups || []).forEach(function(group) { (group.events || []).forEach(function(event) { values[(field.filterValue || field.value)(event,group)] = true; }); });
      options = Object.keys(values).sort(function(a,b) { return a.localeCompare(b,"ru"); });
      var selected = Array.isArray(filters[field.key]) ? filters[field.key].slice() : options.slice();
      var isPerson = field.key === "assignee" || field.key === "author";
      var $box = popup(anchor,"Фильтр: " + field.title,"ujg-esi-grid-menu ujg-esi-activity-filter-menu",options.length > 8 ? 440 : 360);
      [[false,"ArrowDownAZ","Сортировка по возрастанию"],[true,"ArrowUpAZ","Сортировка по убыванию"]].forEach(function(item) {
        $box.append(button(item[1],item[2],function() { sort = {key:field.key,descending:item[0]}; saveLayout(); draw(); }).addClass("ujg-esi-activity-menu-command").append($("<span/>").text(item[2])));
      });
      $box.append(button("FunnelX","Снять фильтр",function() { delete filters[field.key]; saveLayout(); draw(); })
        .addClass("ujg-esi-activity-menu-command ujg-esi-activity-filter-reset").prop("disabled",!Array.isArray(filters[field.key])).append($("<span/>").text("Снять фильтр")));
      var $search = $("<input/>").addClass("ujg-esi-filter-search ujg-esi-activity-filter-search").attr({type:"search",placeholder:"Поиск","aria-label":"Поиск значений"});
      var $chips = $("<div/>").addClass("ujg-esi-filter-chips");
      var $all = $("<input/>").attr({type:"checkbox","aria-label":"Выделить все найденные значения"});
      var $list = $("<div/>").addClass("ujg-esi-filter-values");
      var $count = $("<span/>").addClass("ujg-esi-filter-count");
      $box.append($search,$chips,$("<label/>").addClass("ujg-esi-filter-all").append($all,$("<span/>").text("Выделить всё"),$count),$list);
      function foundValues() { var query = String($search.val() || "").toLocaleLowerCase(); return options.filter(function(value) { return value.toLocaleLowerCase().indexOf(query) >= 0; }); }
      var candidates = options.map(function(value) {
        var $check = $("<input/>").attr("type","checkbox").on("change",function() {
          if (this.checked && selected.indexOf(value) < 0) selected.push(value);
          if (!this.checked) selected = selected.filter(function(item) { return item !== value; });
          update();
        });
        var $label = $("<label/>").addClass("ujg-esi-filter-option ujg-esi-activity-filter-option").append($check,$("<span/>").text(value));
        var $only = button("Funnel","Выбрать только " + value,function(event) {
          event.stopPropagation(); selected = [value]; update();
          if (isPerson) $search.trigger("focus");
        }).addClass("ujg-esi-filter-only");
        var $row = $("<div/>").addClass("ujg-esi-filter-value-row").append($label,$only).appendTo($list);
        return {value:value,row:$row,label:$label,check:$check};
      });
      var $empty = $("<div/>").addClass("ujg-esi-filter-empty").text("Нет значений").appendTo($list);
      function update() {
        var found = foundValues(), chosen = isPerson && (Array.isArray(filters[field.key]) ||
          !options.every(function(value) { return selected.indexOf(value) >= 0; }) ||
          selected.some(function(value) { return options.indexOf(value) < 0; }));
        $count.text(options.filter(function(value) { return selected.indexOf(value) >= 0; }).length + " / " + options.length);
        $all.prop("checked",!!found.length && found.every(function(value) { return selected.indexOf(value) >= 0; }));
        $all.prop("indeterminate",found.some(function(value) { return selected.indexOf(value) >= 0; }) && !$all.prop("checked"));
        $chips.empty();
        selected.filter(function(value) { return chosen || options.indexOf(value) < 0; }).forEach(function(value) {
          $chips.append($("<button/>").attr({type:"button",title:"Убрать: " + value,"aria-label":"Убрать: " + value}).addClass("ujg-esi-selected-chip ujg-esi-activity-selected-chip")
            .append($("<span/>").text(value),icon("X")).on("click",function(event) {
              // The removed target must not reach the document's outside-click handler.
              event.stopPropagation(); selected = selected.filter(function(item) { return item !== value; }); update(); $search.trigger("focus");
            }));
        });
        var displayed = found.filter(function(value) { return !chosen || selected.indexOf(value) < 0; });
        candidates.forEach(function(item) {
          var checked = selected.indexOf(item.value) >= 0, visible = displayed.indexOf(item.value) >= 0;
          item.row.prop("hidden",!visible); item.label.toggleClass("is-selected",checked); item.check.prop("checked",checked);
        });
        $empty.prop("hidden",!!displayed.length);
      }
      $search.on("input",update);
      $all.on("change",function() { var found = foundValues(); if (this.checked) found.forEach(function(value) { if (selected.indexOf(value) < 0) selected.push(value); }); else selected = selected.filter(function(value) { return found.indexOf(value) < 0; }); update(); });
      var $actions = $("<div/>").addClass("ujg-esi-filter-actions");
      $actions.append($("<button/>").attr("type","button").addClass("ujg-esi-activity-filter-clear").text("Очистить").on("click",function() { selected = []; update(); }));
      $actions.append($("<button/>").attr("type","button").addClass("ujg-esi-filter-apply ujg-esi-activity-filter-apply").text("Применить").on("click",function() {
        filters[field.key] = selected.slice();
        saveLayout(); draw();
      }));
      $box.append($actions); update(); placePopover(anchor); $search.trigger("focus");
    }
    function eventPopover(anchor, title, events, state) {
      var $box = popup(anchor,title,"ujg-esi-activity-event-popover",520);
      $box.append($("<div/>").addClass("ujg-esi-activity-popover-head").append($("<strong/>").text(title + " · " + events.length),button("X","Закрыть события",function() { closePopover(true); })));
      events.forEach(function(event,index) {
        var $item = $("<div/>").addClass("ujg-esi-activity-popover-event").attr("data-event-id",event.id == null ? String(index) : String(event.id));
        $item.append($("<div/>").addClass("ujg-esi-activity-popover-event-head").append($("<time/>").text(time(event.at)),issueKeyNode(event.issueKey,state.baseUrl)));
        $item.append($("<div/>").addClass("ujg-esi-activity-popover-title").text(event.summary || "Без темы"));
        $item.append($("<div/>").text("Изменил: " + label(event.author)));
        $item.append($("<div/>").text(activity.eventText(event)));
        if (event.kind === "assignee") {
          $item.append($("<div/>").text("Исполнитель: " + label(event.fromAssignee || event.from) + " → " + label(event.toAssignee || event.to)));
          $item.append($("<div/>").text("Команда: " + label(event.fromTeam) + " → " + label(event.toTeam)));
        } else $item.append($("<div/>").text("Исполнитель: " + label(event.assignee)));
        $box.append($item);
      });
      placePopover(anchor);
    }
    function matchingEvents(report, predicate) {
      var seen = Object.create(null), matches = [];
      (report.events || []).forEach(function(event,index) {
        if (!predicate(event)) return;
        var id = event.id == null ? String(index) : String(event.id);
        if (!seen[id]) { seen[id] = true; matches.push(event); }
      });
      return matches;
    }
    function eventCount(count, caption, events, state) {
      function show(anchor, focusControl) {
        if (suppressPopoverFocus) return;
        if (!$popover || popoverAnchor !== anchor) eventPopover(anchor,caption,events,state);
        if (focusControl) $popover.find("button,a").first().trigger("focus");
      }
      return $("<button/>").attr({type:"button","aria-label":caption + ": " + count,"aria-haspopup":"dialog","aria-expanded":"false"}).text(metric(count))
        .on("mouseenter focus click",function() { show(this,false); })
        .on("keydown",function(event) {
          if (event.key === "Enter" || event.key === " ") { event.preventDefault(); show(this,true); }
          else if (event.key === "Tab" && !event.shiftKey && $popover && popoverAnchor === this) { event.preventDefault(); show(this,true); }
        });
    }
    function columnsMenu(anchor) {
      var $box = popup(anchor,"Столбцы журнала","ujg-esi-grid-menu ujg-esi-activity-columns-menu",280);
      var visible = order.filter(function(id) { return !hidden[id]; });
      order.forEach(function(id) {
        var field = fields.filter(function(item) { return item.key === id; })[0];
        $box.append($("<label/>").addClass("ujg-esi-filter-option ujg-esi-activity-column-option")
          .append($("<input/>").attr("type","checkbox").prop("checked",visible.indexOf(id) >= 0).on("change",function() {
            if (this.checked && visible.indexOf(id) < 0) visible.push(id);
            if (!this.checked && visible.length > 1) visible = visible.filter(function(value) { return value !== id; });
            else if (!this.checked) this.checked = true;
          }),$("<span/>").text(field.title)));
      });
      $box.append($("<div/>").addClass("ujg-esi-filter-actions").append(
        $("<button/>").attr("type","button").addClass("ujg-esi-activity-columns-reset").text("Сбросить").on("click",function() {
          order = fields.map(function(field) { return field.key; }); hidden = {remark:true}; widths = {}; saveLayout(); draw();
        }),
        $("<button/>").attr("type","button").addClass("ujg-esi-filter-apply ujg-esi-activity-columns-apply").text("Применить").on("click",function() {
          order.forEach(function(id) { hidden[id] = visible.indexOf(id) < 0; }); saveLayout(); draw();
        })));
      placePopover(anchor); $box.find("input").first().trigger("focus");
    }
    function download(report, state) {
      var snapshot = filtered(report);
      snapshot.deadlineGroups = report.groups;
      snapshot.groups = sortedGroups(snapshot.groups).map(function(group) { return Object.assign({},group,{events:sortedEvents(group.events,group)}); });
      var filterSnapshot = {};
      Object.keys(filters).forEach(function(key) { filterSnapshot[key] = filters[key].slice(); });
      var html = activity.exportHtml(snapshot, {projectKey:state.projectKey, epicKey:state.epicKey, baseUrl:state.baseUrl, filters:filterSnapshot, sort:Object.assign({},sort)});
      var url = URL.createObjectURL(new Blob([html], {type:"text/html;charset=utf-8"}));
      var anchor = document.createElement("a");
      anchor.href = url; anchor.download = "activity-" + date + ".html";
      document.body.appendChild(anchor); anchor.click(); anchor.remove();
      setTimeout(function() { URL.revokeObjectURL(url); }, 0);
    }
    function draw() {
      var scrollLeft = $host && $host.find(".ujg-esi-activity-scroll").scrollLeft() || 0;
      if (resizeObserver) resizeObserver.disconnect();
      closePopover(); closeManagement();
      var state = currentState || {}, services = currentServices || {};
      var report = activity.summarize(state.rows || [], state.teams || [], {date:date, scopeWarning:state.viewMode === "jira" ? state.registryWarning : undefined, columnMap:state.mappingSettings && state.mappingSettings.columnMap, journalRows:state.deadlineJournalRows});
      aiUi.update(report,state,services);
      var coverage = report.coverage || {}, metrics = report.metrics || {}, observed = report.observed || {}, balance = report.balance || {};
      var journal = filtered(report), $root = $("<div/>").addClass("ujg-esi-activity");
      var $toolbar = $("<div/>").addClass("ujg-esi-activity-toolbar");
      $toolbar.append($("<h2/>").text("Динамика замечаний"));
      var $controls = $("<div/>").addClass("ujg-esi-activity-controls");
      function changeDate(nextDate) {
        if (!validDate(nextDate) || nextDate === date) return;
        date = nextDate; filters = {}; saveLayout();
        if (currentServices && currentServices.onActivityDateChange) currentServices.onActivityDateChange(date);
        draw();
      }
      $controls.append(button("ChevronLeft","Предыдущий день",function() { changeDate(shiftDate(date,-1)); }));
      $controls.append($("<input/>").addClass("ujg-esi-activity-date").attr({type:"date", "aria-label":"Дата отчёта"}).val(date).on("change",function() {
        if (validDate(this.value)) changeDate(this.value); else $(this).val(date);
      }));
      $controls.append(button("ChevronRight","Следующий день",function() { changeDate(shiftDate(date,1)); }));
      $controls.append($("<span/>").addClass("ujg-esi-activity-zone").text("00:00–" + cutoff(report) + " · МСК"));
      $controls.append(button("Download","Скачать HTML",function() { download(report,state); }));
      $controls.append(button("WandSparkles","LLM-отчёт",function() { if (state.activityLoading || state.registryLoading) return; closePopover(); closeManagement(); aiUi.open(this); })
        .addClass("ujg-esi-activity-ai-command").attr({"aria-label":"LLM-отчёт","aria-haspopup":"dialog","aria-expanded":"false"}).prop("disabled",!!(state.activityLoading || state.registryLoading)).append($("<span/>").text("LLM-отчёт")));
      $toolbar.append($controls); $root.append($toolbar);
      $root.append($("<p/>").addClass("ujg-esi-activity-scope").text("Загруженные замечания · " + label(state.projectKey) + (state.epicKey ? " · " + state.epicKey : "") + " · текущие связи и настройки команд; история состава связей недоступна."));
      var partialDay = report.asOf && timestamp(report.asOf) !== Number(report.end);
      var $metrics = $("<section/>").addClass("ujg-esi-activity-summary").append($("<h3/>").text(partialDay ? "Итоги на " + cutoff(report) + " МСК" : "Итоги за весь день"));
      var $band = $("<div/>").addClass("ujg-esi-activity-metrics");
      [["changed","Замечаний с изменениями"],["newRemarks","Создано замечаний"],["completed","Стали готовы"],["taskReturns","Возвраты задач"],["events","Событий"],["overdue","Просроченные"]].forEach(function(item) {
        var value = metrics[item[0]], lowerBound = value == null && (item[0] === "changed" || item[0] === "newRemarks" || item[0] === "overdue" || item[0] === "taskReturns") && observed[item[0]] != null;
        var display = value != null ? String(value) : lowerBound ? "≥" + observed[item[0]] : "—";
        var title = value != null ? item[1] : lowerBound ? item[0] === "overdue" ? "Подтверждённая просрочка; итог может быть больше" : "Зафиксировано по загруженной истории; итог может быть больше" : "Недостаточно истории для итогового значения";
        if (item[0] === "overdue") title += " · На сегодня, " + deadlineDate(report.deadlineReferenceDate) + " МСК";
        $band.append($("<button/>").addClass("ujg-esi-activity-metric").attr({type:"button","data-metric":item[0],"aria-haspopup":"dialog","aria-expanded":"false","aria-label":item[1]+": "+display})
          .append($("<strong/>").attr("title",title).text(display), $("<span/>").text(item[1]))
          .on("click",function() { openManagement(this,report,item[0],state); })
          .on("mouseenter",function() { var anchor=this; clearTimeout(previewTimer); clearTimeout(previewCloseTimer); previewTimer=setTimeout(function() { previewMetric(anchor,report,item[0],state); },160); })
          .on("focus",function() { previewMetric(this,report,item[0],state); })
          .on("mouseleave blur",schedulePreviewClose));
      });
      $metrics.append($band,$("<p/>").addClass("ujg-esi-activity-balance").text("Открытые замечания: " + metric(balance.startOpen) + " на начало · " + metric(balance.endOpen) + " на конец"));
      if (report.deadlineCoverage) {
        var deadlines = report.deadlineCoverage;
        var issueCount = (deadlines.invalid || 0) + (deadlines.conflict || 0);
        var $deadlineCoverage = $("<p/>").addClass("ujg-esi-activity-deadline-coverage").append(document.createTextNode("На сегодня, " + deadlineDate(report.deadlineReferenceDate) + " МСК · Покрытие сроками: известны " + (deadlines.known || 0) + " · без срока " + (deadlines.missing || 0) + " · "));
        $deadlineCoverage.append($("<button/>").addClass("ujg-esi-activity-deadline-issues").attr({type:"button","data-metric":"deadlineIssues","aria-haspopup":"dialog","aria-expanded":"false"}).append($("<span/>").text("Ошибки сроков: " + issueCount))
          .on("click",function() { openManagement(this,report,"deadlineIssues",state); })
          .on("mouseenter",function() { var anchor=this; clearTimeout(previewTimer); clearTimeout(previewCloseTimer); previewTimer=setTimeout(function() { previewMetric(anchor,report,"deadlineIssues",state); },160); })
          .on("focus",function() { previewMetric(this,report,"deadlineIssues",state); })
          .on("mouseleave blur",schedulePreviewClose));
        $deadlineCoverage.append(document.createTextNode(" · ошибки " + (deadlines.invalid || 0) + " · конфликты " + (deadlines.conflict || 0) + " · состояние не подтверждено " + (deadlines.unknownState || 0) + " из " + (deadlines.total || 0) + " · Текущий срок из журнала или сохранённого описания; история переносов не учитывается"));
        $metrics.append($deadlineCoverage);
      }
      if ((state.rows || []).length) $root.append($metrics);
      var $flows = $("<div/>").addClass("ujg-esi-activity-flows");
      var $statusSection = $("<section/>").append($("<h3/>").text("Переходы статусов задач"));
      var transitions = report.transitions || [], statusKeys = Object.create(null);
      transitions.forEach(function(item) { statusKeys[String(item.from)] = true; statusKeys[String(item.to)] = true; });
      var statuses = Object.keys(statusKeys).sort(function(a,b) { return activity.statusLabel(a).localeCompare(activity.statusLabel(b),"ru"); });
      function statusBadge(value) {
        var known = (report.events || []).reduce(function(all,event) {
          [event.fromStatus,event.toStatus].forEach(function(status) { if (status && status.name === value && status.category) all.push(activity.statusTone(status)); });
          return all;
        },[]);
        var tone = known.length ? known.every(function(item) { return item === known[0]; }) ? known[0] : "unknown" : activity.statusTone(value);
        return $("<span/>").addClass("ujg-esi-activity-status is-" + tone).text(activity.statusLabel(value));
      }
      if (transitions.length) {
        var $statusScroll = $("<div/>").addClass("ujg-esi-activity-matrix-scroll"), $statusMatrix = $("<table/>").addClass("ujg-esi-activity-status-matrix").attr("aria-label","Переходы статусов задач");
        var $statusHead = $("<tr/>").append($("<th/>").attr("scope","col").text("Из → В"));
        statuses.forEach(function(value) { $statusHead.append($("<th/>").attr("scope","col").append(statusBadge(value))); });
        var $statusBody = $("<tbody/>");
        statuses.forEach(function(from) {
          var $row = $("<tr/>").append($("<th/>").attr("scope","row").append(statusBadge(from)));
          statuses.forEach(function(to) {
            var match = transitions.filter(function(item) { return String(item.from) === from && String(item.to) === to; })[0];
            var $cell = $("<td/>").toggleClass("has-transfer",!!match);
            if (match) {
              var events = matchingEvents(report,function(event) { return event.kind === "status" && String(event.from) === from && String(event.to) === to && (event.from !== event.to || event.fromId && event.toId && event.fromId !== event.toId); });
              var hasReturn = events.some(function(event) { return !!event.returnKind; });
              var $count = eventCount(match.count,(hasReturn ? "Возврат · " : "Переход ") + activity.statusLabel(from) + " → " + activity.statusLabel(to),events,state);
              if (hasReturn) $count.prepend(icon("ChevronLeft"));
              $cell.toggleClass("is-return",hasReturn).append($count);
            } else $cell.text("–");
            $row.append($cell);
          }); $statusBody.append($row);
        });
        $statusSection.append($statusScroll.append($statusMatrix.append($("<thead/>").append($statusHead),$statusBody)));
      } else $statusSection.append($("<p/>").addClass("ujg-esi-activity-flow-empty").text(coverage.isComplete ? "Нет переходов за день" : "Не зафиксировано в загруженной истории"));
      $flows.append($statusSection);
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
          var $cell = $("<td/>").toggleClass("has-transfer",!!match);
          if (match) {
            var events = matchingEvents(report,function(event) {
              return event.kind === "assignee" && label(event.fromTeam) === from && label(event.toTeam) === to && label(event.fromTeam) !== label(event.toTeam);
            });
            var caption = "Передача " + from + " → " + to;
            $cell.append(eventCount(match.count,caption,events,state));
          } else $cell.text("–");
          $row.append($cell);
        });
        $matrixBody.append($row);
      });
      if (transfers.length) $transferSection.append($matrixScroll.append($matrix.append($matrixBody)));
      else $transferSection.append($("<p/>").addClass("ujg-esi-activity-flow-empty").text(coverage.isComplete ? "Нет передач за день" : "Не зафиксировано в загруженной истории"));
      $flows.append($transferSection);
      if ((state.rows || []).length) $root.append($flows);
      var $coverage = $("<div/>").addClass("ujg-esi-activity-coverage");
      var progress = state.activityProgress || {};
      var coverageText = state.registryLoading ? "Загрузка реестра Jira…" : state.activityLoading ?
        (Number.isFinite(progress.completed) && Number.isFinite(progress.total) ? "Загрузка истории: " + progress.completed + " из " + progress.total + " задач" : "Загрузка истории…") :
        "Проверена история " + (coverage.complete || 0) + " из " + (coverage.total || 0) + " задач";
      $coverage.append($("<span/>").text(coverageText));
      if (!state.activityLoading && !state.registryLoading && (coverage.warnings || []).length) {
        var warnings = coverage.warnings;
        var $details = $("<details/>").addClass("ujg-esi-activity-warning-details");
        $details.append($("<summary/>").text("Остались проблемы с историей (" + warnings.length + "). Технические подробности"));
        var $warningList = $("<div/>").addClass("ujg-esi-activity-warning-list");
        warnings.forEach(function(warning) { $warningList.append($("<div/>").text(warning)); });
        $coverage.append($details.append($warningList));
      }
      if (!state.activityLoading && !state.registryLoading && (coverage.diagnostics || []).length) {
        var $diagnostics = $("<details/>").addClass("ujg-esi-activity-diagnostic-details");
        $diagnostics.append($("<summary/>").text("Неблокирующие расхождения времени (" + coverage.diagnostics.length + ")"));
        var $diagnosticList = $("<div/>").addClass("ujg-esi-activity-diagnostic-list");
        coverage.diagnostics.forEach(function(message) { $diagnosticList.append($("<div/>").text(message)); });
        $coverage.append($diagnostics.append($diagnosticList));
      }
      if (coverage.total || state.activityError || state.activityLoading) {
        if (services.onLoadActivityHistory) $coverage.append(button("RefreshCw","Обновить историю",function() { services.onLoadActivityHistory(); }).prop("disabled",!!(state.activityLoading || state.loading || state.syncLoading || state.registryLoading)));
        if (state.activityError) $coverage.append($("<span/>").addClass("ujg-esi-activity-error").text(state.activityError));
      }
      $coverage.insertAfter($root.children(".ujg-esi-activity-scope"));
      var $journal = $("<section/>").addClass("ujg-esi-activity-journal");
      var $journalTools = $("<div/>").addClass("ujg-esi-activity-journal-tools");
      fields.forEach(function(field) {
        if (!hidden[field.key] || !Array.isArray(filters[field.key])) return;
        $journalTools.append(button("Funnel","Фильтр: " + field.title,function(event) { event.stopPropagation(); filterMenu(this,field,report); })
          .addClass("ujg-esi-activity-hidden-filter").attr({"data-activity-hidden-filter":field.key,"aria-haspopup":"dialog","aria-expanded":"false"})
          .append($("<span/>").text(field.title + " · " + filters[field.key].length)));
      });
      if (Object.keys(filters).some(function(key) { return Array.isArray(filters[key]); })) {
        $journalTools.append(button("FunnelX","Сбросить фильтры журнала",function() { filters = {}; saveLayout(); draw(); }));
      }
      $journalTools.append(button("Columns3","Столбцы журнала",function() { columnsMenu(this); }));
      $journal.append($("<div/>").addClass("ujg-esi-activity-journal-heading").append($("<h3/>").text("Изменения по замечаниям"),$("<span/>").text("Фильтры только для журнала · " + journal.groups.length + " замечаний · " + journal.events.length + " событий"),$journalTools));
      if (!(state.rows || []).length) $journal.append($("<p/>").addClass("ujg-esi-activity-empty").text(state.registryLoading ? "Загрузка замечаний Jira…" : state.registryError ? "Не удалось загрузить замечания Jira: " + state.registryError : "Загрузите источник и связанный состав Jira, чтобы увидеть активность."));
      else if (!journal.groups.length) $journal.append($("<p/>").addClass("ujg-esi-activity-empty").text("Для выбранного дня и фильтров событий нет."));
      var shown = visibleFields(), layout = tableLayout(shown);
      var $scroll = $("<div/>").addClass("ujg-esi-activity-scroll"), $table = $("<table/>").addClass("ujg-esi-activity-table").css({width:layout.total+"px",minWidth:layout.total+"px"}).attr("aria-label","Журнал изменений");
      var $cols = $("<colgroup/>"), $head = $("<tr/>");
      shown.forEach(function(field) {
        $cols.append($("<col/>").attr("data-column",field.key).css("width",layout.widths[field.key]+"px"));
        var active = Array.isArray(filters[field.key]), sorted = sort.key === field.key;
        var $sort = $("<button/>").attr({type:"button","data-activity-sort":field.key,"aria-label":"Сортировать: " + field.title}).addClass("ujg-esi-activity-header-sort")
          .append($("<span/>").text(field.title),sorted ? icon(sort.descending ? "ArrowDown" : "ArrowUp") : null).on("click",function() {
            sort = {key:field.key,descending:sort.key === field.key && !sort.descending}; saveLayout(); draw();
          });
        var $filter = button("Funnel","Фильтр: " + field.title,function(event) { event.stopPropagation(); filterMenu(this,field,report); })
          .addClass("ujg-esi-header-filter").toggleClass("is-active",active).attr({"data-activity-filter":field.key,"aria-haspopup":"dialog","aria-expanded":"false"});
        if (active) $filter.append($("<b/>").text(filters[field.key].length));
        var $resize = $("<span/>").addClass("ujg-esi-activity-column-resize").attr({role:"separator",tabindex:"0","aria-label":"Ширина: " + field.title,"aria-orientation":"vertical"})
          .on("pointerdown",function(event) { event.preventDefault(); event.stopPropagation();
            drag = {type:"resize",id:field.key,start:event.pageX,width:columnWidth(field)};
          }).on("keydown",function(event) { if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return; event.preventDefault(); widths[field.key] = clampWidth(columnWidth(field)+(event.key === "ArrowRight" ? 10 : -10),field.width); saveLayout(); draw(); $host.find('th[data-column="'+field.key+'"] .ujg-esi-activity-column-resize').trigger("focus"); });
        $head.append($("<th/>").attr({scope:"col","data-column":field.key,"aria-sort":sorted ? sort.descending ? "descending" : "ascending" : "none"})
          .on("pointerdown",function(event) { if ($(event.target).closest(".ujg-esi-header-filter,.ujg-esi-activity-column-resize").length) return; drag = {type:"order",id:field.key,start:event.pageX}; })
          .append($sort,$filter,$resize));
      });
      var $body = $("<tbody/>");
      sortedGroups(journal.groups).forEach(function(group) {
        var key = String(group.id || group.key || group.remarkId), isCollapsed = !!collapsed[key];
        var dayBadgeTitle = "За выбранный день: исходная история и связанные задачи; каждая задача учтена один раз в каждом итоге.";
        var $group = $("<tr/>").addClass("ujg-esi-activity-group");
        $group.append($("<th/>").attr({scope:"rowgroup",colspan:shown.length}).append(
          button(isCollapsed ? "ChevronRight" : "ChevronDown",(isCollapsed ? "Развернуть " : "Свернуть ") + label(group.remarkId || group.key),function() { collapsed[key] = !collapsed[key]; draw(); })
            .addClass("ujg-esi-activity-group-toggle").attr("aria-expanded",String(!isCollapsed)),
          $("<span/>").addClass("ujg-esi-activity-group-key").append($("<span/>").text("#" + label(group.remarkId || group.key)),group.key ? issueKeyNode(group.key,state.baseUrl) : $("<span/>")),
          $("<span/>").addClass("ujg-esi-activity-group-summary").text(group.summary || ""),
          $("<span/>").addClass("ujg-esi-activity-group-context").append(
            $("<span/>").addClass("ujg-esi-activity-group-badge is-status" + (group.currentStatusKind ? " is-" + group.currentStatusKind : "")).text("Сейчас: " + activity.statusLabel(group.currentStatus)),
            $("<span/>").addClass("ujg-esi-activity-group-badge").text("Связанных задач: " + group.linkedTaskCount),
            $("<span/>").addClass("ujg-esi-activity-group-day-label").text("За день:"),
            group.dayHighlights && group.dayHighlights.completed ? $("<span/>").addClass("ujg-esi-activity-group-badge is-done").attr("title",dayBadgeTitle).text("Завершено " + group.dayHighlights.completed) : $("<span/>"),
            group.dayHighlights && group.dayHighlights.created ? $("<span/>").addClass("ujg-esi-activity-group-badge is-created").attr("title",dayBadgeTitle).text("Создано " + group.dayHighlights.created) : $("<span/>"),
            group.taskReturns && group.taskReturns.length ? $("<span/>").addClass("ujg-esi-activity-group-badge is-reopened").append(eventCount(group.taskReturns.length,"Возвраты задач · переходов",group.taskReturns,state)) : $("<span/>"),
            group.dayHighlights && !group.dayHighlights.completed && !group.dayHighlights.created && !group.dayHighlights.reopened && group.dayActivityCount ? $("<span/>").addClass("ujg-esi-activity-group-badge").attr("title",dayBadgeTitle).text("Изменено " + group.dayActivityCount) : $("<span/>"),
            group.dayHighlights && !group.dayHighlights.completed && !group.dayHighlights.created && !group.dayHighlights.reopened && !group.dayActivityCount && group.dayNoopStatusCount ? $("<span/>").addClass("ujg-esi-activity-group-badge").text("Статус без изменений") : $("<span/>"),
            group.dayHighlights && !group.dayHighlights.completed && !group.dayHighlights.created && !group.dayHighlights.reopened && !group.dayActivityCount && !group.dayNoopStatusCount && group.dayComplete ? $("<span/>").addClass("ujg-esi-activity-group-badge").text("Без изменений") : $("<span/>"),
            group.dayComplete === false ? $("<span/>").addClass("ujg-esi-activity-group-badge is-incomplete").text("История неполна") : $("<span/>"),
            $("<span/>").addClass("ujg-esi-activity-group-badge ujg-esi-activity-group-deadline " + (group.deadline && group.deadline.state === "overdue" ? "is-overdue" : group.deadline && (group.deadline.state === "today" || group.deadline.state === "tomorrow") ? "is-near" : "is-neutral")).attr("title",deadlineTitle(group.deadline,report.deadlineReferenceDate)).text(deadlineText(group.deadline)))));
        $body.append($group);
        if (isCollapsed) return;
        sortedEvents(group.events,group).forEach(function(event) {
          var $row = $("<tr/>").addClass("ujg-esi-activity-event");
          var $role = $("<span/>").addClass("ujg-esi-activity-role " + roleClass(event.role)).text(roleLabel(event.role));
          if (safeColor(event.roleColor)) $role.css("border-color",event.roleColor).css("color",event.roleColor);
          var assignee = event.kind === "assignee" ? label(event.fromAssignee || event.from) + " → " + label(event.toAssignee || event.to) : label(event.assignee);
          var $assigneeCell = $("<td/>").append(personNode(event.assignee));
          if (event.kind === "assignee" && event.fromTeam !== event.toTeam) $assigneeCell.append($("<small/>").addClass("ujg-esi-activity-team-move").text(label(event.fromTeam) + " → " + label(event.toTeam)));
          else if (event.kind === "assignee") $assigneeCell.append($("<small/>").addClass("ujg-esi-activity-team-move").text(assignee));
          var cells = {
            time:$("<td/>").text(time(event.at)), remark:$("<td/>").text(group.key || group.remarkId || ""),
            role:$("<td/>").append($("<span/>").addClass("ujg-esi-activity-issue").append(issueKeyNode(event.issueKey,state.baseUrl)),$role,event.summary ? $("<div/>").addClass("ujg-esi-activity-task-summary").text(event.summary) : $("<span/>")),
            change:$("<td/>").text(activity.eventText(event)), assignee:$assigneeCell, author:$("<td/>").append(personNode(event.author))
          };
          shown.forEach(function(field) { $row.append(cells[field.key]); }); $body.append($row);
        });
      });
      $journal.append($scroll.append($table.append($cols,$("<thead/>").append($head),$body)));
      $root.append($journal); $host.empty().append($root);
      aiUi.rebindAnchor($root.find(".ujg-esi-activity-ai-command")[0]);
      resize();
      if (typeof window.ResizeObserver === "function") {
        if (!resizeObserver) resizeObserver = new window.ResizeObserver(function() {
          var viewport = $host && $host.find(".ujg-esi-activity-scroll")[0];
          if (viewport && viewport.clientWidth !== observedViewportWidth) resize();
        });
        resizeObserver.observe($scroll[0]);
      }
      $host.find(".ujg-esi-activity-scroll").scrollLeft(scrollLeft);
    }
    return {resize:resize,dismissPopover:dismissPopover,suspend:function() { aiUi.suspend(); closePopover(); closeManagement(); },destroy:function() {
      aiUi.destroy(); closePopover(); closeManagement(); if (resizeObserver) resizeObserver.disconnect();
      $(window).off(namespace); $(document).off(namespace);
    },render:function($parent,state,services) {
      if (!$host || !$host.length || $host.parent()[0] !== $parent[0]) $host = $("<div/>").addClass("ujg-esi-activity-mount").appendTo($parent);
      currentState = state || {}; currentServices = services || {};
      var key = (currentState.preferencesStorageKey || "ujg-esi-state") + ":activity-layout";
      if (layoutKey !== key) loadLayout(key);
      $(window).off("resize"+namespace).on("resize"+namespace,resize);
      $(document).off(namespace)
        .on("click"+namespace,function(event) { if ($popover && event.target !== popoverAnchor && !$.contains(popoverAnchor,event.target) && event.target !== $popover[0] && !$.contains($popover[0],event.target)) closePopover(); })
        .on("keydown"+namespace,function(event) { if ($popover && event.key === "Escape") { event.stopPropagation(); closePopover(true); } })
        .on("pointermove"+namespace,function(event) {
          if (!drag || drag.type !== "resize") return;
          var field = fields.filter(function(item) { return item.key === drag.id; })[0];
          widths[drag.id] = clampWidth(drag.width + event.pageX - drag.start,field.width);
          resize();
        }).on("pointerup"+namespace,function(event) {
          if (!drag) return;
          var action = drag; drag = null;
          if (action.type === "resize") { saveLayout(); return; }
          var $target = $(event.target).closest("th[data-column]");
          if (Math.abs(event.pageX-action.start) < 5 || !$target.length) return;
          var from = order.indexOf(action.id), to = order.indexOf($target.attr("data-column"));
          if (from < 0 || to < 0 || from === to) return;
          order.splice(from,1); order.splice(order.indexOf($target.attr("data-column"))+(from < to ? 1 : 0),0,action.id);
          saveLayout(); draw();
        }).on("pointercancel"+namespace,function() { drag = null; });
      draw();
    }};
  }
  return {create:create};
});
