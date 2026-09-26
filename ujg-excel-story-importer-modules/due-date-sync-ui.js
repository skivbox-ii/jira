define("_ujgESI_dueDateSyncUi", ["jquery", "_ujgESI_icons"], function($, icon) {
  "use strict";
  var LABELS = {loading:"Загрузка", ready:"Готово к обновлению", skipped:"Пропущено", conflict:"Конфликт", error:"Ошибка", updating:"Обновление", updated:"Обновлено", unconfirmed:"Не подтверждено"};
  function button(className, label, iconName) {
    var el = $("<button type='button'/>").addClass(className).attr({"aria-label":label,title:label});
    if (iconName) el.append(icon(iconName)); else el.text(label);
    return el;
  }
  function date(value) {
    return /^\d{4}-\d{2}-\d{2}$/.test(String(value || "")) ? value.slice(8,10)+"."+value.slice(5,7)+"."+value.slice(0,4) : "—";
  }
  function jiraUrl(base, key) {
    if (!/^[A-Z][A-Z0-9_]*-[1-9][0-9]*$/.test(String(key || ""))) return null;
    try {
      var url = new URL(String(base || ""));
      if (!/^https?:$/.test(url.protocol)) return null;
      return url.origin + url.pathname.replace(/\/+$/, "") + "/browse/" + encodeURIComponent(key);
    } catch (_) { return null; }
  }
  function value(row, column, component) {
    if (column === "remark") return [row.remarkId, row.summary].filter(Boolean).join(" ");
    if (component && column === "oldComponents") return Array.isArray(row.oldComponents) ? row.oldComponents.length ? row.oldComponents.join(", ") : "Без компонентов" : "Неизвестно";
    if (component && column === "newComponents") return Array.isArray(row.newComponents) && row.newComponents.length ? row.newComponents.join(", ") : "—";
    if (component && column === "sourceRaw") return String(row.sourceRaw || "");
    if (column === "oldDate" || column === "newDate") return date(row[column]);
    if (column === "result") return [LABELS[row.status] || row.status || "", row.message && row.message !== LABELS[row.status] ? row.message : ""].join(" ").trim();
    return String(row[column] || "");
  }
  function validPrefs(raw, COLUMNS) {
    var source = raw && typeof raw === "object" ? raw : {};
    var ids = COLUMNS.map(function(c) { return c.id; });
    var order = Array.isArray(source.order) ? source.order.filter(function(id) { return ids.indexOf(id) >= 0; }) : [];
    ids.forEach(function(id) { if (order.indexOf(id) < 0) order.push(id); });
    var widths = {}, visible = {}, filters = {};
    COLUMNS.forEach(function(c) {
      widths[c.id] = Math.max(80, Math.min(800, Number(source.widths && source.widths[c.id]) || c.width));
      visible[c.id] = !(source.visible && source.visible[c.id] === false);
      if (source.filters && Array.isArray(source.filters[c.id])) filters[c.id] = source.filters[c.id].map(String);
    });
    if (!ids.some(function(id) { return visible[id]; })) visible[ids[0]] = true;
    var sort = source.sort && ids.indexOf(source.sort.id) >= 0 && /^(asc|desc)$/.test(source.sort.dir) ? {id:source.sort.id,dir:source.sort.dir} : null;
    return {order:order, widths:widths, visible:visible, filters:filters, sort:sort};
  }
  function create(options) {
    var component=options && options.kind === "component";
    var COLUMNS=component ? [
      {id:"remark",label:"Замечание",width:260},{id:"key",label:"Jira",width:140},
      {id:"sourceRaw",label:"Модуль Excel",width:135},{id:"oldComponents",label:"Компоненты Jira",width:150},
      {id:"newComponents",label:"Будет в Jira",width:150},{id:"result",label:"Результат",width:190}
    ] : [{id:"remark",label:"Замечание",width:320},{id:"key",label:"Jira",width:160},
      {id:"oldDate",label:"Срок Jira",width:145},{id:"newDate",label:"Срок Excel",width:180},
      {id:"result",label:"Результат",width:220}];
    var stateName=component?"componentSync":"dueDateSync";
    var eventNamespace=component?".ujgComponentSync":".ujgDueSync";
    var methods=component?{close:"onCloseComponentSync",row:"onSelectComponentSyncRow",all:"onSelectAllComponentSync",confirm:"onConfirmComponentSync"}:
      {close:"onCloseDueDateSync",row:"onSelectDueDateSyncRow",all:"onSelectAllDueDateSync",confirm:"onConfirmDueDateSync"};
    var title=component?"Обновление компонентов Jira из Excel":"Обновление сроков Jira из Excel";
    var triggerLabel=component?"Обновить компоненты Jira из Excel":"Обновить сроки Jira из Excel";
    var prefs = validPrefs(null,COLUMNS), storageKey = null, host = null, anchor = null, open = false;
    var popup = null, popupSearch = "", popupDraft = null, columnMenu = false, lastState = null, lastServices = null;
    var doc = null, resize = null, bodyOverflow = null;
    function save() {
      try { if (storageKey) window.localStorage.setItem(storageKey, JSON.stringify(prefs)); } catch (_) {}
    }
    function load(state) {
      var key = String(state.preferencesStorageKey || "") + (component ? ":component-sync-ui" : ":due-date-sync-ui");
      if (key === storageKey) return;
      storageKey = key;
      try { prefs = validPrefs(JSON.parse(window.localStorage.getItem(key)),COLUMNS); } catch (_) { prefs = validPrefs(null,COLUMNS); }
    }
    function dismiss() {
      if (lastState && lastState[stateName] && !lastState[stateName].running) lastServices[methods.close]();
    }
    function onKey(e) {
      if (!open) return;
      if (e.key === "Escape") {
        if (popup || columnMenu) { popup = null; popupDraft = null; columnMenu = false; draw(); e.preventDefault(); return; }
        if (!lastState[stateName].running) { dismiss(); e.preventDefault(); }
      }
      if (e.key === "Tab") {
        var dialog = host.find(".ujg-esi-due-dialog")[0];
        var items = $(dialog).find("button:not(:disabled),input:not(:disabled),a[href],[tabindex='0']").filter(":visible").toArray();
        // jsdom has no layout, so use the DOM list if visibility cannot be measured.
        if (!items.length) items = host.find(".ujg-esi-due-dialog button:not(:disabled),.ujg-esi-due-dialog input:not(:disabled),.ujg-esi-due-dialog a[href],.ujg-esi-due-dialog [tabindex='0']").toArray();
        if (!items.length) return;
        var first = items[0], last = items[items.length-1];
        if (e.shiftKey && (document.activeElement === first || document.activeElement === dialog || !dialog.contains(document.activeElement))) { last.focus(); e.preventDefault(); }
        else if (!e.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) { first.focus(); e.preventDefault(); }
      }
    }
    function onOutside(e) {
      if (!open || (!popup && !columnMenu)) return;
      if ($(e.target).closest(".ujg-esi-due-filter-menu,.ujg-esi-due-columns-menu,.ujg-esi-due-header-filter,.ujg-esi-due-columns-button,.ujg-esi-due-hidden-filter").length) return;
      popup=null;popupDraft=null;columnMenu=false;draw();
    }
    function sortedFiltered(rows) {
      var shown = rows.filter(function(row) {
        return COLUMNS.every(function(c) { var chosen = prefs.filters[c.id]; return !Array.isArray(chosen) || chosen.indexOf(value(row,c.id,component)) >= 0; });
      });
      if (prefs.sort) shown.sort(function(a,b) {
        var av = /^(oldDate|newDate)$/.test(prefs.sort.id) ? String(a[prefs.sort.id] || "") : value(a,prefs.sort.id,component);
        var bv = /^(oldDate|newDate)$/.test(prefs.sort.id) ? String(b[prefs.sort.id] || "") : value(b,prefs.sort.id,component);
        return av.localeCompare(bv,"ru",{numeric:true}) * (prefs.sort.dir === "asc" ? 1 : -1);
      });
      return shown;
    }
    function focusId(node) { return node && node.getAttribute && node.getAttribute("data-due-focus"); }
    function draw() {
      if (!host || !lastState || !lastState[stateName]) return;
      var state = lastState, plan = state[stateName], rows = Array.isArray(plan.rows) ? plan.rows : [];
      var old = host.find(".ujg-esi-due-scroll")[0], top = old ? old.scrollTop : 0, left = old ? old.scrollLeft : 0;
      var active = host[0].contains(document.activeElement) ? focusId(document.activeElement) : null;
      host.empty().addClass("ujg-esi-due-active");
      host.append($("<div/>").addClass("ujg-esi-due-overlay").attr("aria-hidden","true").on("wheel touchmove",function(e){e.preventDefault();}));
      var dialog = $("<section/>").addClass("ujg-esi-due-dialog").attr({role:"dialog","aria-modal":"true","aria-label":title,tabindex:"-1"});
      var head = $("<header/>").addClass("ujg-esi-due-head").append($("<h2/>").text(title));
      head.append(button("ujg-esi-due-close","Закрыть","X").attr("data-due-focus","close").prop("disabled",!!plan.running).on("click",dismiss));
      dialog.append(head);
      if (plan.loading || plan.running) dialog.append($("<div/>").addClass("ujg-esi-due-progress").attr({role:"status","aria-live":"polite"}).append($("<span/>").addClass("ujg-esi-due-spinner")).append($("<span/>").text(plan.running ? (component ? "Обновление компонентов: ":"Обновление сроков: ")+(plan.completed || 0)+" из "+(plan.total || 0) : component ? "Чтение компонентов Jira…":"Чтение сроков Jira…")));
      if (plan.error) dialog.append($("<div/>").addClass("ujg-esi-due-error").attr("role","alert").text(plan.error));
      var eligible = rows.filter(function(r) { return r.eligible && r.status !== "updated"; });
      var selected = eligible.filter(function(r) { return r.selected; }).length;
      var shown = sortedFiltered(rows), toolbar = $("<div/>").addClass("ujg-esi-due-tools");
      toolbar.append($("<span/>").addClass("ujg-esi-due-count").text("Показано "+shown.length+" из "+rows.length+" · Выбрано "+selected+" из "+eligible.length));
      Object.keys(prefs.filters).forEach(function(id) {
        if (Array.isArray(prefs.filters[id]) && !prefs.visible[id]) toolbar.append(button("ujg-esi-due-hidden-filter",COLUMNS.find(function(c){return c.id===id;}).label+": фильтр").on("click",function(){ popup=id; popupDraft=null; popupSearch=""; columnMenu=false; draw(); }));
      });
      if (Object.keys(prefs.filters).some(function(id){return Array.isArray(prefs.filters[id]);})) toolbar.append(button("ujg-esi-due-reset-filters","Сбросить фильтры","FunnelX").on("click",function(){prefs.filters={};save();draw();}));
      toolbar.append(button("ujg-esi-due-columns-button","Столбцы","Columns3").attr("data-due-focus","columns").on("click",function(){columnMenu=!columnMenu;popup=null;popupDraft=null;draw();}));
      dialog.append(toolbar);
      if (columnMenu) {
        var menu = $("<div/>").addClass("ujg-esi-due-columns-menu");
        COLUMNS.forEach(function(c) {
          var input = $("<input type='checkbox'/>").attr("data-due-visible",c.id).prop("checked",prefs.visible[c.id]);
          input.on("change",function(){ prefs.visible[c.id]=this.checked; if (!Object.keys(prefs.visible).some(function(id){return prefs.visible[id];})) {prefs.visible[c.id]=true;this.checked=true;} save();draw(); });
          menu.append($("<label/>").append(input," ",c.label));
        });
        menu.append(button("ujg-esi-due-reset-columns","Сбросить столбцы").on("click",function(){var oldFilters=prefs.filters,oldSort=prefs.sort;prefs=validPrefs(null,COLUMNS);prefs.filters=oldFilters;prefs.sort=oldSort;save();draw();}));
        dialog.append(menu);
      }
      var scroll = $("<div/>").addClass("ujg-esi-due-scroll").attr("tabindex","0");
      var visibleColumns = prefs.order.filter(function(id){return prefs.visible[id];});
      var tableWidth = 42 + visibleColumns.reduce(function(sum,id){return sum+prefs.widths[id];},0);
      var table = $("<table/>").addClass("ujg-esi-due-table").css("width",tableWidth+"px");
      var colgroup = $("<colgroup/>").appendTo(table);
      colgroup.append($("<col/>").attr("width","42"));
      visibleColumns.forEach(function(id){colgroup.append($("<col/>").attr({"data-column":id,width:String(prefs.widths[id])}));});
      var thead = $("<thead/>").appendTo(table), tr = $("<tr/>").appendTo(thead);
      var all = $("<input type='checkbox'/>").addClass("ujg-esi-due-select-all").attr({"aria-label":"Выбрать все доступные строки","data-due-focus":"all"}).prop({checked:eligible.length>0 && selected===eligible.length,indeterminate:selected>0 && selected<eligible.length,disabled:!!(plan.loading||plan.running||!eligible.length)});
      all.on("change",function(){lastServices[methods.all](this.checked);});
      tr.append($("<th scope='col'/>").addClass("ujg-esi-due-select-head").append(all));
      visibleColumns.forEach(function(id) {
        var c = COLUMNS.find(function(item){return item.id===id;}), th = $("<th scope='col' draggable='true'/>").attr("data-column",id).css("width",prefs.widths[id]+"px");
        var sortLabel = c.label+(prefs.sort && prefs.sort.id===id ? (prefs.sort.dir==="asc" ? " ↑":" ↓") : "");
        th.append(button("ujg-esi-due-header-sort",sortLabel).attr({"data-due-sort":id,"data-due-focus":"sort-"+id}).on("click",function(){ prefs.sort={id:id,dir:prefs.sort && prefs.sort.id===id && prefs.sort.dir==="asc" ? "desc":"asc"};save();draw(); }));
        th.append(button("ujg-esi-due-header-filter"+(Array.isArray(prefs.filters[id]) ? " is-active":""),"Фильтр: "+c.label,"Funnel").attr({"data-due-filter":id,"data-due-focus":"filter-"+id}).on("click",function(){popup=popup===id ? null : id;popupDraft=null;popupSearch="";columnMenu=false;draw();}));
        th.append($("<span role='separator' tabindex='0'/>").addClass("ujg-esi-due-column-resize").attr({"aria-label":"Изменить ширину: "+c.label,"aria-orientation":"vertical","data-due-focus":"resize-"+id}).on("keydown",function(e){if(e.key!=="ArrowLeft"&&e.key!=="ArrowRight")return;prefs.widths[id]=Math.max(80,Math.min(800,prefs.widths[id]+(e.key==="ArrowRight"?10:-10)));save();draw();e.preventDefault();}).on("pointerdown mousedown",function(e){resize={id:id,x:e.clientX,width:prefs.widths[id]};e.stopPropagation();e.preventDefault();}));
        th.on("dragstart",function(e){ if(resize){e.preventDefault();return;} e.originalEvent.dataTransfer.setData("text/plain",id); });
        th.on("dragover",function(e){e.preventDefault();});
        th.on("drop",function(e){e.preventDefault();var from=e.originalEvent.dataTransfer.getData("text/plain"), a=prefs.order.indexOf(from), b=prefs.order.indexOf(id);if(a<0||b<0||a===b)return;prefs.order.splice(a,1);prefs.order.splice(b,0,from);save();draw();});
        tr.append(th);
      });
      var body = $("<tbody/>").appendTo(table);
      shown.forEach(function(row) {
        var item = $("<tr/>").addClass("ujg-esi-due-row").attr("data-row-id",String(row.id));
        var check = $("<input type='checkbox'/>").addClass("ujg-esi-due-row-select").attr({"data-row-id":String(row.id),"data-due-focus":"row-"+row.id,"aria-label":"Выбрать "+(row.key || row.remarkId || row.id)}).prop({checked:!!row.selected,disabled:!!(plan.loading||plan.running||!row.eligible||row.status==="updated")});
        check.on("change",function(){lastServices[methods.row](row.id,this.checked);});
        item.append($("<td/>").append(check));
        prefs.order.filter(function(id){return prefs.visible[id];}).forEach(function(id) {
          var cell = $("<td/>").css("width",prefs.widths[id]+"px");
          if (id==="remark") cell.append($("<strong/>").text(row.remarkId || "—"),$("<span/>").addClass("ujg-esi-due-summary").text(row.summary || ""));
          else if (id==="key") { var url=jiraUrl(state.baseUrl,row.key); if(url) cell.append($("<a target='_blank' rel='noopener noreferrer'/>").attr("href",url).text(row.key)); else cell.text(row.key || "—"); }
          else if (id==="newDate") cell.append($("<span/>").text(date(row.newDate)), $("<small/>").text(row.sourceRaw || ""));
          else if (component && (id==="oldComponents" || id==="newComponents")) cell.text(value(row,id,true));
          else if (component && id==="sourceRaw") cell.text(row.sourceRaw || "—");
          else if (id==="result") { cell.addClass("ujg-esi-due-result").addClass("is-"+(LABELS[row.status] ? row.status : "unknown")); if(row.status==="updated") cell.append(icon("CheckSquare")); cell.append($("<span/>").text(LABELS[row.status] || row.status || "—")); if(row.message && row.message !== LABELS[row.status]) cell.append($("<small/>").text(row.message)); }
          else cell.text(date(row.oldDate));
          item.append(cell);
        });
        body.append(item);
      });
      if (!shown.length) body.append($("<tr/>").append($("<td/>").attr("colspan",1+prefs.order.filter(function(id){return prefs.visible[id];}).length).text(rows.length ? "Нет строк по фильтрам" : "Нет строк для обновления")));
      scroll.append(table);dialog.append(scroll);
      if (popup) {
        var c = COLUMNS.find(function(item){return item.id===popup;}), id=popup;
        var values = Array.from(new Set(rows.map(function(row){return value(row,id,component);}).concat(prefs.filters[id] || []))).sort(function(a,b){return a.localeCompare(b,"ru",{numeric:true});});
        if (popupDraft === null) popupDraft = Array.isArray(prefs.filters[id]) ? prefs.filters[id].slice() : values.slice();
        var pop = $("<div/>").addClass("ujg-esi-due-filter-menu").attr("role","group").attr("aria-label","Фильтр: "+c.label);
        pop.append(button("ujg-esi-due-sort-asc","Сортировать по возрастанию","ArrowDownAZ").on("click",function(){prefs.sort={id:id,dir:"asc"};save();popup=null;draw();}));
        pop.append(button("ujg-esi-due-sort-desc","Сортировать по убыванию","ArrowUpAZ").on("click",function(){prefs.sort={id:id,dir:"desc"};save();popup=null;draw();}));
        var search = $("<input type='search'/>").addClass("ujg-esi-due-filter-search").attr({placeholder:"Поиск","aria-label":"Поиск значений","data-due-focus":"search-"+id}).val(popupSearch);pop.append(search);
        var list = $("<div/>").addClass("ujg-esi-due-filter-values");
        function refreshList() {
          list.empty();
          values.filter(function(v){return v.toLocaleLowerCase().includes(popupSearch.toLocaleLowerCase());}).forEach(function(v) {
            var check = $("<input type='checkbox'/>").attr("data-due-focus","value-"+id+"-"+v).prop("checked",popupDraft.indexOf(v)>=0);
            check.on("change",function(){if(this.checked && popupDraft.indexOf(v)<0)popupDraft.push(v);if(!this.checked)popupDraft=popupDraft.filter(function(x){return x!==v;});});
            var only = button("ujg-esi-due-filter-only","Только это значение: "+(v || "—")).attr("data-value",v).text("Только");
            only.on("click",function(){popupDraft=[v];refreshList();});
            list.append($("<div/>").addClass("ujg-esi-due-filter-value-row").append($("<label/>").append(check,$("<span/>").text(v || "—")),only));
          });
        }
        search.on("input",function(){popupSearch=this.value;refreshList();});refreshList();pop.append(list);
        pop.append(button("ujg-esi-due-filter-select","Выбрать найденные").on("click",function(){values.filter(function(v){return v.toLocaleLowerCase().includes(popupSearch.toLocaleLowerCase());}).forEach(function(v){if(popupDraft.indexOf(v)<0)popupDraft.push(v);});refreshList();}));
        pop.append(button("ujg-esi-due-filter-clear","Снять найденные").on("click",function(){popupDraft=popupDraft.filter(function(v){return !v.toLocaleLowerCase().includes(popupSearch.toLocaleLowerCase());});refreshList();}));
        pop.append(button("ujg-esi-due-filter-apply","Применить").on("click",function(){prefs.filters[id]=popupDraft;save();popup=null;popupDraft=null;draw();}));
        pop.append(button("ujg-esi-due-filter-cancel","Отмена").on("click",function(){popup=null;popupDraft=null;draw();}));
        pop.append(button("ujg-esi-due-filter-reset","Сбросить фильтр").on("click",function(){delete prefs.filters[id];save();popup=null;popupDraft=null;draw();}));
        dialog.append(pop);
      }
      var foot = $("<footer/>").addClass("ujg-esi-due-foot");
      foot.append($("<span/>").text(component ? "Excel → Jira · полный набор заменится показанным компонентом" : "Excel → Jira · изменяется только срок исполнения"));
      foot.append(button("ujg-esi-due-confirm","Обновить выбранные ("+selected+")").attr("data-due-focus","confirm").prop("disabled",!!(plan.loading||plan.running||!selected)).on("click",function(){lastServices[methods.confirm]();}));
      dialog.append(foot);host.append(dialog);
      var fresh=host.find(".ujg-esi-due-scroll")[0];if(fresh){fresh.scrollTop=top;fresh.scrollLeft=left;}
      var target=active && host.find("[data-due-focus]").filter(function(){return this.getAttribute("data-due-focus")===active;})[0];
      if (target && !target.disabled) target.focus();else if (active) dialog[0].focus();
    }
    function onPointerMove(e) {
      if (!resize) return;
      var visible = prefs.order.filter(function(id){return prefs.visible[id];});
      prefs.widths[resize.id]=Math.max(80,Math.min(800,resize.width+e.clientX-resize.x));
      host.find('.ujg-esi-due-table col[data-column="'+resize.id+'"]').attr("width",String(prefs.widths[resize.id]));
      host.find('th[data-column="'+resize.id+'"]').css("width",prefs.widths[resize.id]+"px");
      host.find(".ujg-esi-due-row").each(function(){ $(this).children().eq(1+visible.indexOf(resize.id)).css("width",prefs.widths[resize.id]+"px"); });
      host.find(".ujg-esi-due-table").css("width",42+visible.reduce(function(sum,id){return sum+prefs.widths[id];},0)+"px");
    }
    function onPointerUp(){if(!resize)return;resize=null;save();draw();}
    return {
      render:function(nextHost,state,services) {
        host=$(nextHost);lastState=state;lastServices=services;doc=host[0] && host[0].ownerDocument;
        load(state);
        if (!doc) return;
        if (state[stateName] && state[stateName].open) {
          if(!open){anchor=doc.activeElement;bodyOverflow=doc.body.style.overflow;doc.body.style.overflow="hidden";open=true;$(doc).on("keydown"+eventNamespace,onKey).on("mousedown"+eventNamespace,onOutside).on("pointermove"+eventNamespace+" mousemove"+eventNamespace,onPointerMove).on("pointerup"+eventNamespace+" mouseup"+eventNamespace+" pointercancel"+eventNamespace,onPointerUp);}
          draw();
          if (!host[0].contains(doc.activeElement)) host.find(".ujg-esi-due-dialog")[0].focus();
        } else if(open) {
          open=false;popup=null;popupDraft=null;columnMenu=false;host.empty().removeClass("ujg-esi-due-active");$(doc).off(eventNamespace);
          doc.body.style.overflow=bodyOverflow === null ? "" : bodyOverflow;bodyOverflow=null;
          var validAnchor=anchor && doc.contains(anchor) && anchor.matches && anchor.matches('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],[tabindex]:not([tabindex="-1"])');
          var restore=validAnchor ? anchor : doc.querySelector('button[aria-label="'+triggerLabel+'"]:not(:disabled)');
          if(restore && restore.focus) restore.focus();anchor=null;
        }
      },
      destroy:function(){if(doc){$(doc).off(eventNamespace);if(bodyOverflow !== null)doc.body.style.overflow=bodyOverflow;}if(host)host.empty().removeClass("ujg-esi-due-active");open=false;bodyOverflow=null;anchor=null;host=null;lastState=null;lastServices=null;}
    };
  }
  return {create:create};
});
