define("_ujgESI_grid", ["jquery", "_ujgESI_registry", "_ujgESI_icons", "_ujgESI_teams"], function($, registry, icon, teamsModule) {
  "use strict";
  var sequence = 0;
  var columns = [
    ["remarkId", "ID", 54], ["remark", "Замечание из Excel", 236], ["owner", "Ответственный", 138],
    ["module", "Модуль", 110], ["sourceStatus", "Статус Excel", 112], ["importState", "Импорт", 136], ["key", "Ключ Jira", 152],
    ["type", "Тип", 58], ["role", "Роль", 64], ["summary", "Тема задачи", 276],
    ["status", "Статус Jira", 112], ["age", "В статусе", 94], ["assignee", "Исполнитель", 124],
    ["priority", "Приоритет", 94], ["updated", "Обновлено", 94]
  ];
  var sourceFields = ["remarkId", "remark", "owner", "module", "sourceStatus", "importState"];
  var defaultHidden = { module: true, sourceStatus: true, importState: true };
  function storageKey(state) { return state.preferencesStorageKey || "ujg-esi-state"; }
  function readLayout(key) {
    try {
      var value = JSON.parse(window.localStorage.getItem(key) || "null");
      return value && value.gridLayout && typeof value.gridLayout === "object" ? value.gridLayout : null;
    } catch (ignore) { return null; }
  }
  function clampWidth(value, fallback) {
    return typeof value === "number" && isFinite(value) ? Math.max(50, Math.min(600, Math.round(value))) : fallback;
  }
  function button(name, label, fn) {
    return $("<button/>").attr({ type: "button", title: label, "aria-label": label }).addClass("ujg-esi-icon-button").append(icon(name)).on("click", fn);
  }
  function label(value) { return value === "" ? "(Пустые)" : value; }
  function person(value) {
    var $el = $("<span/>").addClass("ujg-esi-person");
    if (!value) return $el.text("—");
    if (value === "Не назначен") return $el.addClass("ujg-esi-unassigned").text(value);
    var initials = value.split(/\s+/).slice(0, 2).map(function(part) { return part.charAt(0); }).join("");
    return $el.append($("<span/>").addClass("ujg-esi-avatar").attr("aria-hidden", "true").text(initials), $("<span/>").text(value));
  }
  function statusClass(entry) {
    if (entry.statusState) return entry.statusState === "progress" ? "progress" : entry.statusState === "done" ? "done" : "todo";
    if (entry.statusCategory) return entry.statusCategory === "indeterminate" ? "progress" : entry.statusCategory === "done" ? "done" : "todo";
    if (entry.done) return "done";
    if (/тест|работ|progress|review|testing|разработ/i.test(entry.status)) return "progress";
    return "todo";
  }
  function create() {
    var id = ++sequence;
    var state, hooks, $host, $viewport, $menu, menuAnchor;
    var $description, descriptionAnchor, descriptionTimer, descriptionPinned = false, skipDescriptionFocus = false;
    var rows = [], sourceRows, filters = Object.create(null), sort = null, collapsed = Object.create(null), fullChildren = Object.create(null);
    var hidden = Object.assign({}, defaultHidden), order = columns.map(function(c) { return c[0]; }), widths = {}, layoutKey, page = 0, pageSize = 50;
    var suppressSort = false, drag = null;

    function loadLayout(key) {
      layoutKey = key; hidden = Object.assign({}, defaultHidden); widths = {};
      order = columns.map(function(c) { return c[0]; });
      var layout = readLayout(key);
      if (!layout) return;
      var known = order.slice(), seen = Object.create(null);
      if (Array.isArray(layout.order)) order = layout.order.filter(function(id) {
        if (known.indexOf(id) < 0 || seen[id]) return false;
        seen[id] = true; return true;
      }).concat(known.filter(function(id) { return !seen[id]; }));
      if (Array.isArray(layout.visible)) {
        var visible = layout.visible.filter(function(id) { return known.indexOf(id) !== -1; });
        if (visible.length) known.forEach(function(id) { hidden[id] = visible.indexOf(id) === -1; });
      }
      if (layout.widths && typeof layout.widths === "object" && !Array.isArray(layout.widths)) columns.forEach(function(column) {
        widths[column[0]] = clampWidth(layout.widths[column[0]], column[2]);
      });
    }
    function saveLayout() {
      try {
        var storage = window.localStorage, stored;
        try { stored = JSON.parse(storage.getItem(layoutKey) || "{}"); } catch (ignore) { stored = {}; }
        if (!stored || typeof stored !== "object" || Array.isArray(stored)) stored = {};
        stored.gridLayout = { order: order.slice(), visible: order.filter(function(id) { return !hidden[id]; }), widths: widths };
        storage.setItem(layoutKey, JSON.stringify(stored));
      } catch (ignore) { /* Storage is best-effort. */ }
    }
    function orderedColumns() {
      return order.map(function(id) { return columns.filter(function(c) { return c[0] === id; })[0]; });
    }
    function visibleWidth() {
      return 28 + 72 + orderedColumns().filter(function(c) { return !hidden[c[0]]; })
        .reduce(function(total, c) { return total + (widths[c[0]] || c[2]); }, 0);
    }
    function moveColumn(from, to) {
      if (from === to || order.indexOf(from) < 0 || order.indexOf(to) < 0) return;
      var backwards = order.indexOf(from) > order.indexOf(to);
      order.splice(order.indexOf(from), 1);
      order.splice(order.indexOf(to) + (backwards ? 0 : 1), 0, from);
      saveLayout(); draw();
    }

    function closeDescription(focus) {
      clearTimeout(descriptionTimer);
      if ($description) $description.remove();
      $description = null; descriptionPinned = false;
      if (descriptionAnchor) {
        $(descriptionAnchor).removeAttr("aria-controls").attr("aria-expanded", "false");
        if (focus && document.contains(descriptionAnchor)) {
          skipDescriptionFocus = true; descriptionAnchor.focus(); skipDescriptionFocus = false;
        }
      }
      descriptionAnchor = null;
    }
    function deferDescriptionClose() {
      clearTimeout(descriptionTimer);
      if (!descriptionPinned) descriptionTimer = setTimeout(function() { closeDescription(); }, 180);
    }
    function showDescription(anchor, entry, pinned) {
      closeDescription(); closeMenu();
      descriptionAnchor = anchor; descriptionPinned = !!pinned;
      var descriptionId = "ujg-esi-description-" + id;
      $(anchor).attr({ "aria-controls": descriptionId, "aria-expanded": "true" });
      $description = $("<section/>").addClass("ujg-esi-description-popover").attr({ id: descriptionId, role: "dialog", "aria-label": "Описание " + (entry.key || entry.remarkId || "замечания") });
      var $head = $("<div/>").addClass("ujg-esi-description-head");
      if (entry.key) $head.append($("<a/>").attr({ href: (state.baseUrl || "").replace(/\/+$/, "") + "/browse/" + encodeURIComponent(entry.key), target: "_blank", rel: "noopener noreferrer" }).text(entry.key));
      else $head.append($("<span/>").text("Замечание " + entry.remarkId));
      $head.append(button("X", "Закрыть описание", function() { closeDescription(true); }));
      $description.append($head, $("<h3/>").text(entry.summary || entry.remark), $("<div/>").addClass("ujg-esi-description-meta").text([entry.role, entry.status, entry.assignee, entry.age].filter(Boolean).join(" · ")));
      var content = entry.key ? entry.description : entry.remark;
      var $body = $("<div/>").addClass("ujg-esi-description-body");
      if (content) $body.append(hooks.renderDescription ? hooks.renderDescription(content) : $("<p/>").text(content));
      else $body.append($("<p/>").addClass("ujg-esi-description-empty").text(entry.descriptionLoaded ? "Описание не заполнено" : "Описание не загружено"));
      $description.append($body).on("mouseenter focusin", function() { clearTimeout(descriptionTimer); }).on("mouseleave", deferDescriptionClose).on("keydown", function(event) {
        if (event.key === "Escape") { event.stopPropagation(); closeDescription(true); }
        if (event.key === "Tab" && event.shiftKey && event.target === $description.find("a,button").first()[0]) { event.preventDefault(); closeDescription(true); }
      }).on("focusout", function(event) {
        if (!event.relatedTarget || !$description[0].contains(event.relatedTarget)) closeDescription();
      });
      $host.append($description);
      var rect = anchor.getBoundingClientRect(), width = Math.min(560, Math.max(240, window.innerWidth - 24));
      $description.css({ width: width, left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)), top: 12, maxHeight: Math.max(160, window.innerHeight - 24) });
      var height = $description.outerHeight();
      $description.css("top", Math.max(12, Math.min(rect.bottom + 7, window.innerHeight - height - 12)));
    }
    function descriptionTarget($target, entry) {
      return $target.attr({ tabindex: "0", role: "button", "aria-haspopup": "dialog", "aria-expanded": "false", "aria-label": "Описание: " + entry.summary })
        .on("mouseenter", function() { var anchor = this; clearTimeout(descriptionTimer); descriptionTimer = setTimeout(function() { showDescription(anchor, entry); }, 250); })
        .on("mouseleave blur", deferDescriptionClose)
        .on("focus", function() { if (!skipDescriptionFocus) showDescription(this, entry); })
        .on("click", function(event) { event.stopPropagation(); showDescription(this, entry, true); })
        .on("keydown", function(event) {
          if (event.key === "Escape" && $description) { event.stopPropagation(); closeDescription(); }
          if (event.key === "Enter" || event.key === " ") { event.preventDefault(); showDescription(this, entry, true); $description.find("a,button").first().trigger("focus"); }
          if (event.key === "Tab" && !event.shiftKey && $description && descriptionAnchor === this) { event.preventDefault(); $description.find("a,button").first().trigger("focus"); }
        });
    }

    function closeMenu(focus) {
      if ($menu) $menu.remove();
      $menu = null;
      if (menuAnchor) {
        $(menuAnchor).attr("aria-expanded", "false");
        if (focus && document.contains(menuAnchor)) menuAnchor.focus();
      }
      menuAnchor = null;
    }
    function popup(anchor, title) {
      closeDescription();
      closeMenu();
      menuAnchor = anchor;
      $(anchor).attr("aria-expanded", "true");
      $menu = $("<div/>").addClass("ujg-esi-grid-menu").attr({ role: "dialog", "aria-label": title });
      $host.append($menu);
      var rect = anchor.getBoundingClientRect(), base = $host[0].getBoundingClientRect();
      $menu.css({ left: Math.max(0, Math.min(rect.right - base.left - 268, $host.width() - 276)), top: rect.bottom - base.top + 3 });
      $menu.on("keydown", function(event) { if (event.key === "Escape") { event.stopPropagation(); closeMenu(true); } });
      return $menu;
    }
    function refresh() { closeMenu(); closeDescription(); draw(); }
    function filterMenu(anchor, column) {
      var key = column[0], isPerson = key === "owner" || key === "assignee";
      var active = Array.isArray(filters[key]) || key === "status" && !!filters.excludeDone;
      var excludeDone = !!filters.excludeDone;
      var options = registry.values(rows, key, filters);
      (filters[key] || []).forEach(function(value) { if (options.indexOf(value) === -1) options.push(value); });
      options.sort(registry.compare);
      var selected = Array.isArray(filters[key]) ? filters[key].slice() : options.slice();
      var $box = popup(anchor, "Фильтр: " + column[1]);
      [ ["asc", "ArrowDownAZ", key === "priority" ? "Сначала низкий приоритет" : "Сортировка по возрастанию"], ["desc", "ArrowUpAZ", key === "priority" ? "Сначала высокий приоритет" : "Сортировка по убыванию"] ].forEach(function(item) {
        $box.append(button(item[1], item[2], function() { sort = { column: key, direction: item[0] }; page = 0; refresh(); $host.find('[data-filter="' + key + '"]').trigger("focus"); }).addClass("ujg-esi-menu-command").append($("<span/>").text(item[2])));
      });
      $box.append(button("FunnelX", "Снять фильтр", function() { delete filters[key]; if (key === "status") delete filters.excludeDone; page = 0; refresh(); }).addClass("ujg-esi-menu-command").prop("disabled", !active).append($("<span/>").text("Снять фильтр")));
      if (key === "status") $box.append($("<label/>").addClass("ujg-esi-exclude-done").append($("<input/>").attr({ type: "checkbox", "aria-label": "Исключить готовые" }).prop("checked", excludeDone).on("change", function() { excludeDone = this.checked; }), $("<span/>").text("Исключить готовые")));
      var $search = $("<input/>").attr({ type: "search", placeholder: "Поиск", "aria-label": "Поиск значений" }).addClass("ujg-esi-filter-search");
      var $chips = $("<div/>").addClass("ujg-esi-filter-chips");
      var $all = $("<input/>").attr({ type: "checkbox", "aria-label": "Выделить все найденные значения" });
      var $list = $("<div/>").addClass("ujg-esi-filter-values");
      var $count = $("<span/>").addClass("ujg-esi-filter-count");
      $box.append($search, $chips, $("<label/>").addClass("ujg-esi-filter-all").append($all, $("<span/>").text("(Выделить всё)"), $count), $list);
      function searchValues() {
        var query = String($search.val() || "").toLocaleLowerCase();
        return options.filter(function(value) { return label(value).toLocaleLowerCase().indexOf(query) !== -1; });
      }
      function update() {
        var found = searchValues();
        var displayed = options.filter(function(value) { return found.indexOf(value) !== -1 || (isPerson && selected.indexOf(value) !== -1); });
        if (isPerson) displayed.sort(function(a, b) { return (selected.indexOf(b) !== -1 ? 1 : 0) - (selected.indexOf(a) !== -1 ? 1 : 0) || registry.compare(a, b); });
        $count.text(selected.length + " / " + options.length);
        $all.prop("checked", !!found.length && found.every(function(value) { return selected.indexOf(value) !== -1; }));
        $all.prop("indeterminate", found.some(function(value) { return selected.indexOf(value) !== -1; }) && !$all.prop("checked"));
        $chips.empty();
        if (isPerson && selected.length < options.length) selected.forEach(function(value) {
          $chips.append($("<button/>").attr({ type: "button", title: "Убрать: " + label(value) }).addClass("ujg-esi-selected-chip").append($("<span/>").text(label(value)), icon("X")).on("click", function(event) { event.stopPropagation(); selected = selected.filter(function(v) { return v !== value; }); update(); }));
        });
        $list.empty();
        if (!displayed.length) $list.append($("<div/>").addClass("ujg-esi-filter-empty").text("Нет значений"));
        displayed.forEach(function(value) {
          var checked = selected.indexOf(value) !== -1;
          var $check = $("<input/>").attr("type", "checkbox").prop("checked", checked).on("change", function() {
            if (this.checked) { if (selected.indexOf(value) === -1) selected.push(value); }
            else selected = selected.filter(function(v) { return v !== value; });
            update();
          });
          $list.append($("<label/>").addClass("ujg-esi-filter-option").toggleClass("is-selected", checked).append($check, $("<span/>").text(label(value))));
        });
      }
      $search.on("input", update);
      $all.on("change", function() {
        var found = searchValues(), check = this.checked;
        found.forEach(function(value) { if (check && selected.indexOf(value) === -1) selected.push(value); });
        if (!check) selected = selected.filter(function(value) { return found.indexOf(value) === -1; });
        update();
      });
      var $apply = $("<button/>").attr("type", "button").addClass("ujg-esi-filter-apply").text("ОК").on("click", function() {
        if (key === "status") { if (excludeDone) filters.excludeDone = true; else delete filters.excludeDone; }
        var allValues = registry.values(rows, key, {});
        if (allValues.length === selected.length && allValues.every(function(value) { return selected.indexOf(value) !== -1; })) delete filters[key]; else filters[key] = selected.slice();
        page = 0; refresh();
        $host.find('[data-filter="' + key + '"]').trigger("focus");
      });
      $box.append($("<div/>").addClass("ujg-esi-filter-actions").append($apply, $("<button/>").attr("type", "button").text("Отмена").on("click", function() { closeMenu(true); })));
      update(); $search.trigger("focus");
    }
    function teamPerson(value, identifiers) {
      var $person = person(value), names = [];
      (state.teams || []).forEach(function(team) {
        if (!(team.members || []).some(function(member) { return [member.id].concat(member.identifiers || []).some(function(id) { return (identifiers || []).indexOf(id) >= 0; }); })) return;
        names.push(team.name);
        if (teamsModule.colors.indexOf(team.color) >= 0) $person.append($("<i/>").addClass("ujg-esi-person-team").css("background-color", team.color).attr({title:team.name,"aria-label":team.name}));
      });
      if (names.length) $person.attr("title", value + " · " + names.join(", "));
      return $person;
    }
    function workSummary(entry) {
      if (!teamsModule) return null;
      var work = teamsModule.currentWork(entry.source, state.teams);
      var caption = "Текущая работа по замечанию " + (entry.remarkId || entry.key || "");
      var $button = $("<button/>").attr({type:"button", "aria-label":caption, "aria-haspopup":"dialog", "aria-expanded":"false"}).addClass("ujg-esi-current-work");
      $button.append($("<span/>").addClass("ujg-esi-current-label").text("Сейчас: "));
      work.groups.forEach(function(group) { $button.append($("<span/>").addClass("ujg-esi-work-phase is-" + group.direction).text(group.label + " · " + group.count)); });
      if (!work.groups.length) $button.append($("<span/>").addClass("ujg-esi-work-empty").text(work.message));
      if (work.warnings.length) $button.append(icon("TriangleAlert"));
      $button.on("click", function() {
        var $box = popup(this, caption).addClass("ujg-esi-work-details");
        $box.append($("<div/>").addClass("ujg-esi-work-heading").append($("<strong/>").text("Текущая работа"), button("X", "Закрыть текущую работу", function() { closeMenu(true); })));
        if (work.parent.key) $box.append($("<p/>").addClass("ujg-esi-work-parent").text([work.parent.key, work.parent.status, work.parent.assignee].filter(Boolean).join(" · ")));
        if (!work.groups.length) $box.append($("<p/>").text(work.message));
        work.groups.forEach(function(group) {
          $box.append($("<h4/>").text(group.label + " · " + group.count));
          group.tasks.forEach(function(task) {
            var $task = $("<div/>").addClass("ujg-esi-work-task");
            if (task.key) $task.append($("<a/>").attr({href:(state.baseUrl || "").replace(/\/+$/, "") + "/browse/" + encodeURIComponent(task.key),target:"_blank",rel:"noopener noreferrer"}).text(task.key));
            $task.append($("<span/>").text(task.summary), $("<small/>").text([task.status, task.assignee || "Не назначен"].join(" · ")), $("<small/>").addClass("ujg-esi-work-basis").text(task.basis));
            $box.append($task);
          });
        });
        work.warnings.forEach(function(warning) { $box.append($("<p/>").addClass("ujg-esi-work-warning").text(warning)); });
        var rect = this.getBoundingClientRect(), width = Math.min(430, window.innerWidth - 24);
        $box.css({position:"fixed",width:width,left:Math.max(12,Math.min(rect.left,window.innerWidth-width-12)),top:12,maxHeight:window.innerHeight-24});
        $box.css("top",Math.max(12,Math.min(rect.bottom+4,window.innerHeight-$box.outerHeight()-12)));
        $box.find("button").first().trigger("focus");
      });
      return $button;
    }
    function cell(entry, key) {
      var value = entry[key], $td = $("<td/>").addClass("ujg-esi-cell-" + key);
      if (key === "owner") {
        if (hooks.editOwner) $td.append($("<button/>").attr({ type: "button", "data-owner-index": entry.rowIndex, title: "Изменить ответственного", "aria-label": "Ответственный: " + (value || "Не указан"), "aria-haspopup": "dialog" }).addClass("ujg-esi-owner-button").append(person(value), icon("ChevronDown")).on("click", function() { hooks.editOwner(entry); }));
        else $td.append(person(value));
        return $td.append(workSummary(entry));
      }
      if (key === "assignee") return $td.append(teamPerson(value, entry.assigneeIdentifiers)).attr("title", value || "Не указан");
      if (key === "remark") {
        $td.append($("<div/>").addClass("ujg-esi-source-text").text(value));
        $td.attr("title", value).append($("<small/>").text([entry.module, entry.source.excelRowNumber ? "Excel: " + entry.source.excelRowNumber : ""].filter(Boolean).join(" · ")));
        if (entry.source.status === "partial") $td.append($("<small/>").addClass("ujg-esi-import-warning").append(icon("TriangleAlert"), document.createTextNode("Частично создано")));
        return $td;
      }
      if (key === "key") {
        if (entry.isChild) $td.append($("<span/>").addClass("ujg-esi-tree-mark").attr("aria-hidden", "true"));
        if (value) return $td.append($("<a/>").attr({ href: (state.baseUrl || "").replace(/\/+$/, "") + "/browse/" + encodeURIComponent(value), target: "_blank", rel: "noopener noreferrer" }).text(value));
        return $td.append($("<span/>").addClass("ujg-esi-import-state").toggleClass("is-error", entry.source.status === "failed").text(entry.importState));
      }
      if (key === "summary") {
        $td.append(descriptionTarget($("<span/>").addClass("ujg-esi-issue-summary-text").text(value || "—"), entry));
        if (!entry.key) $td.append($("<small/>").addClass("ujg-esi-draft-label").text("Черновик"));
        return $td;
      }
      if (key === "status") {
        if (entry.linkedToParent === false) $td.append($("<span/>").addClass("ujg-esi-blocked-marker").attr({role:"img", "aria-label":"Связь с основной задачей не создана", title:entry.linkError || "Связь с основной задачей не создана"}).append(icon("TriangleAlert")));
        if (entry.blocked) $td.append($("<span/>").addClass("ujg-esi-blocked-marker").attr({role:"img", "aria-label":"Заблокирована", title:"Заблокирована"}).append(icon("TriangleAlert")));
        if (value) $td.append($("<span/>").addClass("ujg-esi-workflow-status is-" + statusClass(entry)).text(value));
        return $td.attr("title", value);
      }
      if (key === "type" && value) return $td.append($("<span/>").addClass("ujg-esi-issue-type").toggleClass("is-story", !entry.isChild).toggleClass("is-qa", entry.role === "QA").attr({ role: "img", "aria-label": value }).append(icon(entry.isChild ? "CheckSquare" : "Bookmark"))).attr("title", value);
      if (key === "priority" && value) {
        var priority = /выс|крит|high|critical|blocker/i.test(value) ? "high" : /низ|незнач|low|minor|trivial/i.test(value) ? "low" : /сред|medium|normal/i.test(value) ? "medium" : "";
        if (priority) return $td.append($("<span/>").addClass("ujg-esi-priority is-" + priority).attr({ role: "img", "aria-label": value }).append(icon(priority === "high" ? "ArrowUp" : priority === "low" ? "ArrowDown" : "Equal"))).attr("title", value);
      }
      if (key === "age") return $td.text(value || "—").attr("title", entry.statusSince ? "В статусе с " + new Date(entry.statusSince).toLocaleString("ru-RU") : entry.ageReason);
      if (key === "updated" && value) { var date = new Date(value); return $td.text(isNaN(date.getTime()) ? value : date.toLocaleDateString("ru-RU")).attr("title", value); }
      return $td.text(value || "—").attr("title", value || "");
    }
    function draw() {
      if (!$host) return;
      var scroll = $viewport ? { top: $viewport.scrollTop(), left: $viewport.scrollLeft() } : { top: 0, left: 0 };
      $host.empty();
      var visible = orderedColumns().filter(function(column) { return !hidden[column[0]]; });
      var groups = registry.selectGroups(rows, filters, sort);
      var pages = Math.max(1, Math.ceil(groups.length / pageSize));
      page = Math.max(0, Math.min(page, pages - 1));
      var tableWidth = visibleWidth();
      var $table = $("<table/>").addClass("ujg-esi-registry-table").css({width:tableWidth + "px", "min-width":tableWidth + "px"}).attr("aria-label", "Замечания и связанные задачи Jira");
      var $colgroup = $("<colgroup/>").append($("<col/>").css("width", "28px"));
      var $head = $("<tr/>").append($("<th/>").attr("scope", "col").append(button("ListTree", "Развернуть все", function() { collapsed = Object.create(null); rows.forEach(function(row) { fullChildren[row.groupId] = true; }); refresh(); })));
      visible.forEach(function(column) {
        $colgroup.append($("<col/>").attr({"data-column":column[0],width:widths[column[0]] || column[2]}).css("width", (widths[column[0]] || column[2]) + "px"));
        var active = Array.isArray(filters[column[0]]) || column[0] === "status" && !!filters.excludeDone, sorted = sort && sort.column === column[0];
        var heading = column[0] === "remark" && state.viewMode === "jira" ? "Замечание" : column[1];
        var caption = "Фильтр: " + heading;
        var $filter = button(active ? "Funnel" : "ChevronDown", caption, function(event) { event.stopPropagation(); filterMenu(this, column); })
          .addClass("ujg-esi-header-filter").toggleClass("is-active", active).attr({ "data-filter": column[0], "aria-haspopup": "dialog", "aria-expanded": "false" });
        if (active && (column[0] === "owner" || column[0] === "assignee")) $filter.append($("<b/>").text(filters[column[0]].length));
        var $sort = $("<button/>").addClass("ujg-esi-header-sort").attr({ type: "button", "data-sort": column[0], title: "Сортировка: " + heading, "aria-label": "Сортировка: " + heading })
          .append($("<span/>").text(heading), sorted ? icon(sort.direction === "desc" ? "ArrowDown" : "ArrowUp") : null)
          .on("click", function() {
            if (suppressSort) { suppressSort = false; return; }
            sort = { column: column[0], direction: sorted ? (sort.direction === "asc" ? "desc" : "asc") : column[0] === "priority" ? "desc" : "asc" };
            page = 0; refresh(); $host.find('[data-sort="' + column[0] + '"]').trigger("focus");
          });
        var $resize = $("<span/>").addClass("ujg-esi-column-resize").attr({ role:"separator", tabindex:"0", "aria-label":"Ширина: " + heading, "aria-orientation":"vertical" })
          .on("pointerdown", function(event) {
            event.preventDefault(); event.stopPropagation();
            var measured = $(this).closest("th")[0].getBoundingClientRect().width;
            drag = { type:"resize", id:column[0], start:event.pageX, width:measured || widths[column[0]] || column[2] };
          }).on("keydown", function(event) {
            if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
            event.preventDefault(); widths[column[0]] = clampWidth((widths[column[0]] || column[2]) + (event.key === "ArrowRight" ? 10 : -10), column[2]); saveLayout(); draw();
          });
        $head.append($("<th/>").attr({ scope: "col", "data-column":column[0], "aria-sort": sorted ? (sort.direction === "desc" ? "descending" : "ascending") : "none" })
          .on("pointerdown", function(event) {
            if ($(event.target).closest(".ujg-esi-header-filter,.ujg-esi-column-resize").length) return;
            drag = { type:"order", id:column[0], start:event.pageX };
          }).append($sort, $filter, $resize));
      });
      $colgroup.append($("<col/>").css("width", "72px"));
      $head.append($("<th/>").attr({scope: "col", "aria-label": "Действия", title: "Действия"}).addClass("ujg-esi-actions-head").append(icon("WandSparkles"), icon("Plus")));
      $table.append($colgroup, $("<thead/>").append($head));
      var $body = $("<tbody/>");
      groups.slice(page * pageSize, (page + 1) * pageSize).forEach(function(group) {
        var parent = group.parent, force = Object.keys(filters).length > 0;
        if (!sort) group.children.sort(function(a, b) { return registry.compare(a.key, b.key); });
        var opened = force || !collapsed[parent.groupId];
        var children = opened ? (force || fullChildren[parent.groupId] || !visible.some(function(c) { return sourceFields.indexOf(c[0]) < 0; }) ? group.children : group.children.slice(0, 5)) : [];
        var remaining = opened ? group.children.length - children.length : 0;
        var span = children.length + 1 + (remaining ? 1 : 0);
        [parent].concat(children).forEach(function(entry, rowNumber) {
          var $tr = $("<tr/>").addClass(entry.isChild ? "ujg-esi-child-row" : "ujg-esi-parent-row").attr({ "data-key": entry.key, "data-source-index": entry.rowIndex });
          $tr.toggleClass("is-context", rowNumber === 0 && group.contextOnly).toggleClass("is-new", !parent.key).toggleClass("is-failed", parent.source.status === "failed");
          $tr.toggleClass("is-collapsed", !opened).toggleClass("is-last-child", entry.isChild && rowNumber === children.length && !remaining);
          if (!rowNumber) {
            var $toggle = $("<td/>").attr("rowspan", span).addClass("ujg-esi-expand-cell");
            if (group.children.length) $toggle.append(button(opened ? "ChevronDown" : "ChevronRight", (opened ? "Свернуть" : "Развернуть") + " замечание " + (parent.remarkId || parent.key || parent.source.excelRowNumber || ""), function() { if (!force) { collapsed[parent.groupId] = opened; refresh(); } }).attr("aria-expanded", String(opened)).prop("disabled", force));
            $tr.append($toggle);
          }
          visible.forEach(function(column) {
            var isSource = sourceFields.indexOf(column[0]) !== -1;
            if (rowNumber && isSource) return;
            var $cell = cell(entry, column[0]);
            if (isSource) $cell.attr("rowspan", span).addClass("ujg-esi-source-cell");
            $tr.append($cell);
          });
          if (!rowNumber) {
            var $action = $("<td/>").attr("rowspan", span).addClass("ujg-esi-registry-actions");
            hooks.appendActions($action, parent.source, parent.rowIndex);
            $tr.append($action);
          }
          $body.append($tr);
        });
        if (remaining) {
          var $more = button("ChevronDown", "Ещё " + remaining + " связанных задач", function() { fullChildren[parent.groupId] = true; refresh(); }).addClass("ujg-esi-more-children").append($("<span/>").text("Ещё " + remaining + " связанных задач"));
          var $moreRow = $("<tr/>").addClass("ujg-esi-more-row").attr("data-source-index", parent.rowIndex), runs = [], run = {count:0,width:0};
          function appendRun() {
            if (run.count) runs.push(run);
            run = {count:0,width:0};
          }
          visible.forEach(function(column) {
            if (sourceFields.indexOf(column[0]) < 0) { run.count++; run.width += widths[column[0]] || column[2]; }
            else appendRun();
          });
          appendRun();
          var widest = runs.reduce(function(best, item, index) { return item.width > runs[best].width ? index : best; }, 0);
          runs.forEach(function(item, index) {
            var $cell = $("<td/>").attr("colspan", item.count);
            if (index === widest) $cell.append($more);
            $moreRow.append($cell);
          });
          $body.append($moreRow);
        }
      });
      if (!groups.length) $body.append($("<tr/>").append($("<td/>").attr("colspan", visible.length + 2).addClass("ujg-esi-grid-empty").text("Нет замечаний по выбранным фильтрам")));
      $table.append($body);
      $viewport = $("<div/>").addClass("ujg-esi-registry-scroll").attr({ tabindex: "0", "aria-label": "Таблица замечаний" }).append($table).on("scroll", function() { closeMenu(); closeDescription(); });
      $host.append($viewport);
      var $footer = $("<div/>").addClass("ujg-esi-grid-footer");
      $footer.append($("<span/>").text(groups.length ? (page * pageSize + 1) + "–" + Math.min((page + 1) * pageSize, groups.length) + " из " + groups.length : "0 замечаний"));
      var $size = $("<select/>").attr("aria-label", "Замечаний на странице").on("change", function() { pageSize = Number(this.value); page = 0; refresh(); });
      [20, 50, 100].forEach(function(n) { $size.append($("<option/>").val(n).text(n + " на странице")); });
      $size.val(pageSize);
      $footer.append($size, button("FunnelX", "Сбросить все фильтры", function() { filters = Object.create(null); page = 0; refresh(); }).prop("disabled", !Object.keys(filters).length));
      $footer.append($("<span/>").addClass("ujg-esi-page-spacer"), button("ChevronLeft", "Предыдущая страница", function() { page -= 1; refresh(); }).prop("disabled", page === 0), $("<span/>").text((page + 1) + " / " + pages), button("ChevronRight", "Следующая страница", function() { page += 1; refresh(); }).prop("disabled", page >= pages - 1));
      $host.append($footer);
      $viewport.scrollTop(scroll.top).scrollLeft(scroll.left);
    }
    return {
      dismissPopover: function() {
        if ($menu && $menu[0].isConnected) { closeMenu(true); return true; }
        if ($description && $description[0].isConnected) { closeDescription(true); return true; }
        return false;
      },
      mount: function($parent, nextState, nextHooks) {
        state = nextState; hooks = nextHooks;
        if (layoutKey !== storageKey(state)) loadLayout(storageKey(state));
        closeMenu(); closeDescription();
        if (sourceRows !== state.rows) {
          sourceRows = state.rows; filters = Object.create(null); collapsed = Object.create(null); fullChildren = Object.create(null); page = 0;
          var linked = 0;
          (state.rows || []).forEach(function(row, index) {
            if ((row.createdKey || row.jiraKey) && linked++ >= 3 && row.status !== "partial") collapsed[String(row.id || index)] = true;
          });
        }
        rows = registry.buildRows(state.rows);
        $host = $("<div/>").addClass("ujg-esi-registry"); $parent.append($host); $viewport = null;
        $(document).off("click.ujgRegistry" + id).on("click.ujgRegistry" + id, function(event) {
          if ($menu && !$.contains($menu[0], event.target) && event.target !== $menu[0] && !$.contains(menuAnchor, event.target) && event.target !== menuAnchor) closeMenu();
          if ($description && !$.contains($description[0], event.target) && event.target !== $description[0] && event.target !== descriptionAnchor) closeDescription();
        });
        $(document).off("pointermove.ujgRegistry" + id + " pointerup.ujgRegistry" + id)
          .on("pointermove.ujgRegistry" + id, function(event) {
            if (drag && drag.type === "resize") {
              var column = columns.filter(function(c) { return c[0] === drag.id; })[0];
              widths[drag.id] = clampWidth(drag.width + event.pageX - drag.start, column[2]);
              $host.find('col[data-column="' + drag.id + '"]').attr("width", widths[drag.id]).css("width", widths[drag.id] + "px");
              $host.find("table").css({width:visibleWidth() + "px", "min-width":visibleWidth() + "px"});
            }
          }).on("pointerup.ujgRegistry" + id, function(event) {
            if (!drag) return;
            var action = drag; drag = null;
            if (action.type === "resize") { suppressSort = true; setTimeout(function() { suppressSort = false; }, 0); saveLayout(); return; }
            var $target = $(event.target).closest("th[data-column]");
            if (Math.abs(event.pageX - action.start) >= 5 && $target.length) { suppressSort = true; setTimeout(function() { suppressSort = false; }, 0); moveColumn(action.id, $target.attr("data-column")); }
          });
        draw();
      },
      toggleAll: function() {
        var collapse = !Object.keys(collapsed).length;
        collapsed = Object.create(null);
        rows.forEach(function(row) { if (collapse) collapsed[row.groupId] = true; else fullChildren[row.groupId] = true; });
        refresh();
      },
      columnsMenu: function(anchor) {
        if (!$host) return;
        var $box = popup(anchor, "Столбцы");
        orderedColumns().forEach(function(column) {
          $box.append($("<label/>").addClass("ujg-esi-filter-option").append($("<input/>").attr("type", "checkbox").prop("checked", !hidden[column[0]]).on("change", function() {
            if (!this.checked && order.filter(function(id) { return !hidden[id]; }).length <= 1) { this.checked = true; return; }
            hidden[column[0]] = !this.checked;
          }), $("<span/>").text(column[1])));
        });
        $box.append($("<button/>").attr("type", "button").addClass("ujg-esi-filter-apply").text("ОК").on("click", function() { saveLayout(); refresh(); }));
        $box.append(button("RefreshCw", "Сбросить расположение столбцов", function() { hidden = Object.assign({}, defaultHidden); order = columns.map(function(c) { return c[0]; }); widths = {}; saveLayout(); refresh(); }).addClass("ujg-esi-menu-command").append($("<span/>").text("Сбросить расположение")));
        $box.find("input,button").first().trigger("focus");
      }
    };
  }
  return { create: create, button: button };
});
