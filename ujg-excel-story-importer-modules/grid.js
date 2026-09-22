define("_ujgESI_grid", ["jquery", "_ujgESI_registry", "_ujgESI_icons"], function($, registry, icon) {
  "use strict";
  var sequence = 0;
  var columns = [
    ["remarkId", "ID", 66], ["remark", "Замечание из Excel", 260], ["owner", "Ответственный", 144],
    ["module", "Модуль", 110], ["importState", "Импорт", 136], ["key", "Ключ Jira", 146],
    ["type", "Тип", 90], ["role", "Роль", 68], ["summary", "Тема задачи", 270],
    ["status", "Статус Jira", 142], ["age", "В статусе", 105], ["assignee", "Исполнитель", 154],
    ["priority", "Приоритет", 100], ["updated", "Обновлено", 104]
  ];
  var sourceFields = ["remarkId", "remark", "owner", "module", "importState"];
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
    var rows = [], sourceRows, filters = Object.create(null), sort = null, collapsed = Object.create(null);
    var hidden = { module: true, importState: true }, page = 0, pageSize = 50;

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
    function refresh() { closeMenu(); draw(); }
    function filterMenu(anchor, column) {
      var key = column[0], isPerson = key === "owner" || key === "assignee";
      var active = Array.isArray(filters[key]);
      var options = registry.values(rows, key, filters);
      (filters[key] || []).forEach(function(value) { if (options.indexOf(value) === -1) options.push(value); });
      options.sort(registry.compare);
      var selected = active ? filters[key].slice() : options.slice();
      var $box = popup(anchor, "Фильтр: " + column[1]);
      [ ["asc", "ArrowDownAZ", "Сортировка по возрастанию"], ["desc", "ArrowUpAZ", "Сортировка по убыванию"] ].forEach(function(item) {
        $box.append(button(item[1], item[2], function() { sort = { column: key, direction: item[0] }; page = 0; refresh(); }).addClass("ujg-esi-menu-command").append($("<span/>").text(item[2])));
      });
      $box.append(button("FunnelX", "Снять фильтр", function() { delete filters[key]; page = 0; refresh(); }).addClass("ujg-esi-menu-command").prop("disabled", !active).append($("<span/>").text("Снять фильтр")));
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
        var allValues = registry.values(rows, key, {});
        if (allValues.length === selected.length && allValues.every(function(value) { return selected.indexOf(value) !== -1; })) delete filters[key]; else filters[key] = selected.slice();
        page = 0; refresh();
        $host.find('[data-filter="' + key + '"]').trigger("focus");
      });
      $box.append($("<div/>").addClass("ujg-esi-filter-actions").append($apply, $("<button/>").attr("type", "button").text("Отмена").on("click", function() { closeMenu(true); })));
      update(); $search.trigger("focus");
    }
    function cell(entry, key) {
      var value = entry[key], $td = $("<td/>").addClass("ujg-esi-cell-" + key);
      if (key === "owner" || key === "assignee") return $td.append(person(value)).attr("title", value || "Не указан");
      if (key === "remark") {
        $td.append($("<div/>").addClass("ujg-esi-source-text").text(value));
        $td.attr("title", value).append($("<small/>").text([entry.module, "Excel: " + entry.source.excelRowNumber].filter(Boolean).join(" · ")));
        if (entry.source.status === "partial") $td.append($("<small/>").addClass("ujg-esi-import-warning").append(icon("TriangleAlert"), document.createTextNode("Частично создано")));
        return $td;
      }
      if (key === "key") {
        if (value) return $td.append($("<a/>").attr({ href: (state.baseUrl || "").replace(/\/+$/, "") + "/browse/" + encodeURIComponent(value), target: "_blank", rel: "noopener noreferrer" }).text(value));
        return $td.append($("<span/>").addClass("ujg-esi-import-state").toggleClass("is-error", entry.source.status === "failed").text(entry.importState));
      }
      if (key === "summary") {
        if (entry.isChild) $td.append($("<span/>").addClass("ujg-esi-tree-mark").attr("aria-hidden", "true"));
        return $td.append($("<span/>").addClass("ujg-esi-issue-summary-text").text(value || "—")).attr("title", value);
      }
      if (key === "status" && value) return $td.append($("<span/>").addClass("ujg-esi-workflow-status is-" + statusClass(entry)).text(value)).attr("title", entry.blocked ? "Задача заблокирована" : value);
      if (key === "type" && value) return $td.append($("<span/>").addClass("ujg-esi-issue-type").toggleClass("is-story", !entry.isChild).append(icon(entry.isChild ? "CheckSquare" : "Bookmark")), $("<span/>").text(value)).attr("title", value);
      if (key === "age") return $td.text(value || "—").attr("title", entry.statusSince ? "В статусе с " + new Date(entry.statusSince).toLocaleString("ru-RU") : entry.ageReason);
      if (key === "updated" && value) { var date = new Date(value); return $td.text(isNaN(date.getTime()) ? value : date.toLocaleDateString("ru-RU")).attr("title", value); }
      return $td.text(value || "—").attr("title", value || "");
    }
    function draw() {
      if (!$host) return;
      var scroll = $viewport ? { top: $viewport.scrollTop(), left: $viewport.scrollLeft() } : { top: 0, left: 0 };
      $host.empty();
      var visible = columns.filter(function(column) { return !hidden[column[0]]; });
      var groups = registry.selectGroups(rows, filters, sort);
      var pages = Math.max(1, Math.ceil(groups.length / pageSize));
      page = Math.max(0, Math.min(page, pages - 1));
      var $table = $("<table/>").addClass("ujg-esi-registry-table").attr("aria-label", "Замечания и связанные задачи Jira");
      var $colgroup = $("<colgroup/>").append($("<col/>").css("width", "30px"));
      var $head = $("<tr/>").append($("<th/>").attr("scope", "col").append(button("Expand", "Развернуть все", function() { collapsed = Object.create(null); refresh(); })));
      visible.forEach(function(column) {
        $colgroup.append($("<col/>").css("width", column[2] + "px"));
        var active = Array.isArray(filters[column[0]]), sorted = sort && sort.column === column[0];
        var caption = "Фильтр: " + column[1];
        var $filter = button(active ? "Funnel" : "ChevronDown", caption, function(event) { event.stopPropagation(); filterMenu(this, column); })
          .addClass("ujg-esi-header-filter").toggleClass("is-active", active).attr({ "data-filter": column[0], "aria-haspopup": "dialog", "aria-expanded": "false" });
        if (active && (column[0] === "owner" || column[0] === "assignee")) $filter.append($("<b/>").text(filters[column[0]].length));
        $head.append($("<th/>").attr({ scope: "col", "aria-sort": sorted ? (sort.direction === "desc" ? "descending" : "ascending") : "none" })
          .append($("<span/>").text(column[1]), sorted ? icon(sort.direction === "desc" ? "ArrowDown" : "ArrowUp") : null, $filter));
      });
      $colgroup.append($("<col/>").css("width", "118px"));
      $head.append($("<th/>").attr("scope", "col").text("Действия"));
      $table.append($colgroup, $("<thead/>").append($head));
      var $body = $("<tbody/>");
      groups.slice(page * pageSize, (page + 1) * pageSize).forEach(function(group) {
        var parent = group.parent, force = Object.keys(filters).length > 0;
        var opened = force || !collapsed[parent.groupId];
        var children = opened ? group.children : [];
        [parent].concat(children).forEach(function(entry, rowNumber) {
          var $tr = $("<tr/>").addClass(entry.isChild ? "ujg-esi-child-row" : "ujg-esi-parent-row").attr({ "data-key": entry.key, "data-source-index": entry.rowIndex });
          $tr.toggleClass("is-context", rowNumber === 0 && group.contextOnly).toggleClass("is-new", !parent.key).toggleClass("is-failed", parent.source.status === "failed");
          if (!rowNumber) {
            var $toggle = $("<td/>").attr("rowspan", children.length + 1).addClass("ujg-esi-expand-cell");
            if (group.children.length) $toggle.append(button(opened ? "ChevronDown" : "ChevronRight", (opened ? "Свернуть" : "Развернуть") + " замечание " + (parent.remarkId || parent.source.excelRowNumber), function() { if (!force) { collapsed[parent.groupId] = opened; refresh(); } }).attr("aria-expanded", String(opened)).prop("disabled", force));
            $tr.append($toggle);
          }
          visible.forEach(function(column) {
            var isSource = sourceFields.indexOf(column[0]) !== -1;
            if (rowNumber && isSource) return;
            var $cell = cell(entry, column[0]);
            if (isSource) $cell.attr("rowspan", children.length + 1).addClass("ujg-esi-source-cell");
            $tr.append($cell);
          });
          if (!rowNumber) {
            var $action = $("<td/>").attr("rowspan", children.length + 1).addClass("ujg-esi-registry-actions");
            hooks.appendActions($action, parent.source, parent.rowIndex);
            $tr.append($action);
          }
          $body.append($tr);
        });
      });
      if (!groups.length) $body.append($("<tr/>").append($("<td/>").attr("colspan", visible.length + 2).addClass("ujg-esi-grid-empty").text("Нет замечаний по выбранным фильтрам")));
      $table.append($body);
      $viewport = $("<div/>").addClass("ujg-esi-registry-scroll").attr({ tabindex: "0", "aria-label": "Таблица замечаний" }).append($table).on("scroll", function() { closeMenu(); });
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
      mount: function($parent, nextState, nextHooks) {
        state = nextState; hooks = nextHooks;
        closeMenu();
        if (sourceRows !== state.rows) { sourceRows = state.rows; filters = Object.create(null); collapsed = Object.create(null); page = 0; }
        rows = registry.buildRows(state.rows);
        $host = $("<div/>").addClass("ujg-esi-registry"); $parent.append($host); $viewport = null;
        $(document).off("click.ujgRegistry" + id).on("click.ujgRegistry" + id, function(event) {
          if ($menu && !$.contains($menu[0], event.target) && event.target !== $menu[0] && !$.contains(menuAnchor, event.target) && event.target !== menuAnchor) closeMenu();
        });
        draw();
      },
      toggleAll: function() {
        var collapse = !Object.keys(collapsed).length;
        collapsed = Object.create(null);
        if (collapse) rows.forEach(function(row) { collapsed[row.groupId] = true; });
        refresh();
      },
      columnsMenu: function(anchor) {
        if (!$host) return;
        var $box = popup(anchor, "Столбцы");
        columns.forEach(function(column) {
          $box.append($("<label/>").addClass("ujg-esi-filter-option").append($("<input/>").attr("type", "checkbox").prop("checked", !hidden[column[0]]).prop("disabled", column[0] === "remarkId" || column[0] === "remark").on("change", function() { hidden[column[0]] = !this.checked; }), $("<span/>").text(column[1])));
        });
        $box.append($("<button/>").attr("type", "button").addClass("ujg-esi-filter-apply").text("ОК").on("click", refresh));
      }
    };
  }
  return { create: create, button: button };
});
