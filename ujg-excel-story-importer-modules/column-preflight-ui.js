define("_ujgESI_columnPreflightUi", ["jquery", "_ujgESI_icons"], function($, icon) {
  "use strict";
  var LABELS = {matched:"Найдена",missing:"Не найдена",ambiguous:"Несколько совпадений",empty:"Значения пустые",skipped:"Не импортировать",conflict:"Колонка уже используется"};
  var COLUMNS = [{id:"field",label:"Поле импортера",width:220},{id:"column",label:"Колонка Excel",width:330},
    {id:"examples",label:"Примеры значений",width:300},{id:"status",label:"Проверка",width:210}];
  function validPrefs(raw) {
    var source=raw && typeof raw === "object" ? raw : {}, ids=COLUMNS.map(function(c) {return c.id;});
    var order=Array.isArray(source.order) ? source.order.filter(function(id,i,a) {return ids.indexOf(id)>=0 && a.indexOf(id)===i;}) : [];
    ids.forEach(function(id) {if(order.indexOf(id)<0)order.push(id);});
    var widths={},visible={},filters={};
    COLUMNS.forEach(function(c) {
      var width=Number(source.widths && source.widths[c.id]);
      widths[c.id]=Number.isFinite(width) && width>0 ? Math.max(100,Math.min(800,width)) : c.width;
      visible[c.id]=!(source.visible && source.visible[c.id]===false);
      if (source.filters && Array.isArray(source.filters[c.id])) filters[c.id]=source.filters[c.id].map(String);
    });
    if (!ids.some(function(id) {return visible[id];})) visible.field=true;
    var sort=source.sort && ids.indexOf(source.sort.id)>=0 && /^(asc|desc)$/.test(source.sort.dir) ? {id:source.sort.id,dir:source.sort.dir}:null;
    return {order:order,widths:widths,visible:visible,filters:filters,sort:sort};
  }
  function button(label, name) {
    var node = $("<button type='button'/>").attr({title:label,"aria-label":label});
    return name ? node.append(icon(name)) : node.text(label);
  }
  function columnLabel(column, report) {
    var count=(report.columns || []).filter(function(other) {return other.header===column.header;}).length;
    return column.letter+" · "+column.header+(count>1 ? " ("+(column.occurrence+1)+" из "+count+")":"");
  }
  function create() {
    var host, state, services, opened = false, anchor, overflow, popup = null, popupAnchor = null;
    var prefs=validPrefs(null), storageKey=null, resize=null, columnMenu=null;
    function save() {try {window.localStorage.setItem(storageKey,JSON.stringify(prefs));} catch (_) {}}
    function load() {
      var key=String(state.preferencesStorageKey || "ujg-esi-state")+":column-preflight-ui";
      if (key===storageKey) return;
      storageKey=key;
      try {prefs=validPrefs(JSON.parse(window.localStorage.getItem(key)));} catch (_) {prefs=validPrefs(null);}
    }
    function fieldValue(field,id,report) {
      var column=(report.columns || []).filter(function(col) {return col.index===field.selectedIndex;})[0];
      if (id==="field") return field.label;
      if (id==="column") return column ? columnLabel(column,report) : field.status==="skipped" ? "Не импортировать":"Выбрать колонку";
      if (id==="examples") return column ? (column.examples || []).join(" · ") : "";
      return LABELS[field.status] || field.status;
    }
    function shownFields(report) {
      var rows=(report.fields || []).filter(function(field) {return COLUMNS.every(function(c) {
        return !Array.isArray(prefs.filters[c.id]) || prefs.filters[c.id].indexOf(fieldValue(field,c.id,report))>=0;
      });});
      if(prefs.sort) rows.sort(function(a,b) {return fieldValue(a,prefs.sort.id,report).localeCompare(fieldValue(b,prefs.sort.id,report),"ru",{numeric:true})*(prefs.sort.dir==="asc"?1:-1);});
      return rows;
    }
    function closePopup() {
      if (!popup) return false;
      popup.remove(); popup = null;
      if (popupAnchor && popupAnchor.isConnected) { popupAnchor.setAttribute("aria-expanded","false"); popupAnchor.focus(); }
      return true;
    }
    function closeColumnMenu() {
      if (!columnMenu) return;
      columnMenu.remove();columnMenu=null;
      host.find("[data-preflight-columns]").attr("aria-expanded","false");
    }
    function onKey(event) {
      if (!opened) return;
      if (event.key === "Escape") {
        event.preventDefault(); event.stopImmediatePropagation();
        if (columnMenu) {columnMenu.remove();columnMenu=null;var trigger=host.find("[data-preflight-columns]")[0];if(trigger){trigger.setAttribute("aria-expanded","false");trigger.focus();}}
        else if (!closePopup()) services.onCancelColumnImport();
      }
      if (event.key !== "Tab") return;
      var scope = popup || host.find(".ujg-esi-preflight-dialog");
      var items = scope.find("button:not(:disabled),input:not(:disabled),[tabindex='0']").filter(function() { return !$(this).closest("[hidden]").length; }).toArray();
      if (!items.length) return;
      var first=items[0], last=items[items.length-1];
      if (event.shiftKey && (document.activeElement === first || !scope[0].contains(document.activeElement))) { last.focus();event.preventDefault(); }
      else if (!event.shiftKey && (document.activeElement === last || !scope[0].contains(document.activeElement))) { first.focus();event.preventDefault(); }
    }
    function openPicker(trigger, title, choices, choose, skip) {
      closeColumnMenu();closePopup(); popupAnchor=trigger;
      trigger.setAttribute("aria-expanded","true");
      popup=$("<div/>").addClass("ujg-esi-preflight-picker").attr({role:"dialog","aria-label":title});
      popup.append($("<div/>").addClass("ujg-esi-preflight-picker-head").append($("<strong/>").text(title),button("Закрыть список","X").on("click",closePopup)));
      var search=$("<input type='search'/>").attr({"data-preflight-search":"","aria-label":"Поиск колонки","placeholder":"Поиск"});
      var list=$("<div/>").addClass("ujg-esi-preflight-options");
      if (skip) popup.append(button("Не импортировать").attr("data-preflight-skip","").on("click",function() { closePopup();choose(null); }));
      choices.forEach(function(choice) {
        var node=button(choice.label).attr(choice.sheet ? "data-preflight-sheet-option":"data-preflight-option",String(choice.value));
        if (choice.example) node.append($("<small/>").text(choice.example));
        node.attr("data-search",(choice.label+" "+(choice.example || "")).toLocaleLowerCase("ru"));
        node.on("click",function() { closePopup();choose(choice.value); });list.append(node);
      });
      var empty=$("<div/>").addClass("ujg-esi-preflight-empty").text("Совпадений нет").prop("hidden",!!choices.length);
      search.on("input",function() {
        var query=String(search.val()).toLocaleLowerCase("ru");var count=0;
        list.children("button").each(function() { var match=$(this).attr("data-search").indexOf(query)>=0;$(this).prop("hidden",!match);if(match) count++; });
        empty.prop("hidden",!!count);
      });
      popup.append(search,list,empty);host.append(popup);
      var rect=trigger.getBoundingClientRect(), width=Math.min(560,window.innerWidth-24);
      var height=Math.min(440,window.innerHeight-32), top=Math.max(12,Math.min(rect.bottom+5,window.innerHeight-height-12));
      popup.css({width:width,left:Math.max(12,Math.min(rect.left,window.innerWidth-width-12)),top:top,maxHeight:height});search[0].focus();
    }
    function placePopup(trigger,width,maxHeight) {
      var rect=trigger.getBoundingClientRect(), w=Math.min(width,window.innerWidth-24), h=Math.min(maxHeight,window.innerHeight-32);
      popup.css({width:w,left:Math.max(12,Math.min(rect.left,window.innerWidth-w-12)),top:Math.max(12,Math.min(rect.bottom+5,window.innerHeight-h-12)),maxHeight:h});
    }
    function openFilter(trigger,id,report) {
      closeColumnMenu();closePopup();popupAnchor=trigger;trigger.setAttribute("aria-expanded","true");
      var title=COLUMNS.filter(function(c){return c.id===id;})[0].label;
      var values=Array.from(new Set((report.fields || []).map(function(field){return fieldValue(field,id,report);}).concat(prefs.filters[id] || []))).sort(function(a,b){return a.localeCompare(b,"ru",{numeric:true});});
      var draft=Array.isArray(prefs.filters[id]) ? prefs.filters[id].slice() : values.slice(), query="";
      popup=$("<div/>").addClass("ujg-esi-preflight-picker ujg-esi-preflight-filter-menu").attr({role:"dialog","aria-label":"Фильтр: "+title});
      popup.append($("<div/>").addClass("ujg-esi-preflight-picker-head").append($("<strong/>").text(title),button("Закрыть список","X").on("click",closePopup)));
      popup.append(button("По возрастанию","ArrowDownAZ").on("click",function(){prefs.sort={id:id,dir:"asc"};save();draw();}));
      popup.append(button("По убыванию","ArrowUpAZ").on("click",function(){prefs.sort={id:id,dir:"desc"};save();draw();}));
      var search=$("<input type='search'/>").attr({"data-preflight-filter-search":"","aria-label":"Поиск значений",placeholder:"Поиск"});
      var list=$("<div/>").addClass("ujg-esi-preflight-filter-values");
      function matches(value){return value.toLocaleLowerCase("ru").indexOf(query)>=0;}
      values.forEach(function(value){
        var check=$("<input type='checkbox'/>").prop("checked",draft.indexOf(value)>=0).on("change",function(){
          if(this.checked && draft.indexOf(value)<0)draft.push(value);
          if(!this.checked)draft=draft.filter(function(item){return item!==value;});
        });
        var row=$("<div/>").addClass("ujg-esi-preflight-filter-value").attr("data-preflight-filter-value",id==="status" ? Object.keys(LABELS).filter(function(key){return LABELS[key]===value;})[0] || value : value);
        row.append($("<label/>").append(check,$("<span/>").text(value || "—")),button("Только это значение").text("Только").on("click",function(){draft=[value];list.find("input").each(function(){this.checked=this===check[0];});}));
        list.append(row);
      });
      search.on("input",function(){query=String(this.value).toLocaleLowerCase("ru");list.children().each(function(){this.hidden=!matches($(this).find("span").text());});});
      popup.append(search,list);
      var actions=$("<div/>").addClass("ujg-esi-preflight-filter-actions");
      actions.append(button("Выбрать найденные").on("click",function(){list.children().each(function(){if(!this.hidden){var input=$(this).find("input")[0];if(!input.checked){input.checked=true;$(input).trigger("change");}}});}));
      actions.append(button("Снять найденные").on("click",function(){list.children().each(function(){if(!this.hidden){var input=$(this).find("input")[0];if(input.checked){input.checked=false;$(input).trigger("change");}}});}));
      actions.append(button("Применить").attr("data-preflight-filter-apply","").on("click",function(){prefs.filters[id]=draft;save();draw();}));
      actions.append(button("Сбросить фильтр").attr("data-preflight-filter-reset","").on("click",function(){delete prefs.filters[id];save();draw();}));
      popup.append(actions);host.append(popup);placePopup(trigger,440,510);search[0].focus();
    }
    function draw() {
      var pending=state.pendingImport, report=pending.report || {}, focus=document.activeElement && document.activeElement.getAttribute("data-preflight-focus");
      var old=host.find(".ujg-esi-preflight-scroll")[0], scroll=old ? {top:old.scrollTop,left:old.scrollLeft}:null;
      closePopup();columnMenu=null;host.empty();
      host.append($("<div/>").addClass("ujg-esi-due-overlay").on("wheel touchmove",function(e) {e.preventDefault();}));
      var dialog=$("<section/>").addClass("ujg-esi-due-dialog ujg-esi-preflight-dialog").attr({role:"dialog","aria-modal":"true","aria-label":"Соответствие колонок Excel",tabindex:"-1"});
      dialog.append($("<header/>").addClass("ujg-esi-due-head").append($("<h2/>").text("Соответствие колонок Excel"),
        button("Отменить импорт","X").attr("data-preflight-focus","cancel-icon").on("click",services.onCancelColumnImport)));
      dialog.append($("<div/>").addClass("ujg-esi-preflight-file").text(pending.fileName));
      var tools=$("<div/>").addClass("ujg-esi-preflight-meta");
      tools.append($("<label/>").text("Лист ").append(button(report.sheetName || "Выбрать лист").attr({"data-preflight-sheet":"","data-preflight-focus":"sheet","aria-haspopup":"dialog"}).append(icon("ChevronDown")).on("click",function() {
        openPicker(this,"Лист Excel",(report.sheetNames || pending.workbook && pending.workbook.SheetNames || []).map(function(name) {return {value:name,label:name,sheet:true};}),services.onImportSheetChange,false);
      })));
      tools.append($("<label/>").text("Строка заголовков ").append($("<input type='number' min='1' step='1'/>").attr({"data-preflight-header":"","data-preflight-focus":"header","aria-label":"Строка заголовков"})
        .val(report.headerRowNumber || pending.settings.headerRowNumber || "").on("change",function() {services.onImportHeaderChange(Number(this.value));})));
      dialog.append(tools);
      var counts=report.counts || {};
      var summary=(report.fields || []).filter(function(field){return field.key==="summary";})[0];
      dialog.append($("<div/>").addClass("ujg-esi-preflight-counts").text(!summary || summary.selectedIndex==null
        ? "Число замечаний не определено: колонка замечания не выбрана"
        : "Замечаний: "+(counts.total || 0)+" · К импорту: "+(counts.visible || 0)+" · Скрыто в Excel: "+(counts.hidden || 0)));
      if (pending.error || report.error) dialog.append($("<div/>").addClass("ujg-esi-due-error").attr("role","alert").text(pending.error || report.error));
      var tableTools=$("<div/>").addClass("ujg-esi-preflight-table-tools");
      Object.keys(prefs.filters).forEach(function(id){if(prefs.visible[id])return;var column=COLUMNS.filter(function(c){return c.id===id;})[0];
        tableTools.append(button("Фильтр: "+column.label,"Funnel").addClass("ujg-esi-preflight-hidden-filter").on("click",function(){openFilter(this,id,report);}));});
      if(Object.keys(prefs.filters).length)tableTools.append(button("Сбросить фильтры","FunnelX").on("click",function(){prefs.filters={};save();draw();}));
      tableTools.append(button("Столбцы","Columns3").attr({"data-preflight-columns":"","aria-expanded":"false"}).on("click",function(){
        if(columnMenu){columnMenu.remove();columnMenu=null;this.setAttribute("aria-expanded","false");return;}
        closePopup();var trigger=this;trigger.setAttribute("aria-expanded","true");
        columnMenu=$("<div/>").addClass("ujg-esi-preflight-columns-menu").attr({role:"group","aria-label":"Столбцы"});
        COLUMNS.forEach(function(c){var check=$("<input type='checkbox'/>").attr("data-preflight-visible",c.id).prop("checked",prefs.visible[c.id]);
          check.on("change",function(){prefs.visible[c.id]=this.checked;if(!COLUMNS.some(function(col){return prefs.visible[col.id];})){prefs.visible[c.id]=true;this.checked=true;return;}
            save();draw();host.find("[data-preflight-columns]")[0].click();host.find('[data-preflight-visible="'+c.id+'"]').trigger("focus");});
          columnMenu.append($("<label/>").append(check,$("<span/>").text(c.label)));});
        columnMenu.append(button("Сбросить столбцы").on("click",function(){var filters=prefs.filters,sort=prefs.sort;prefs=validPrefs(null);prefs.filters=filters;prefs.sort=sort;save();draw();}));
        tableTools.append(columnMenu);
      }));
      dialog.append(tableTools);
      var scrollHost=$("<div/>").addClass("ujg-esi-preflight-scroll");
      var table=$("<table/>").addClass("ujg-esi-preflight-table").attr("aria-label","Соответствия полей импорта");
      var visible=prefs.order.filter(function(id){return prefs.visible[id];});
      table.css("width",Math.max(1,visible.reduce(function(sum,id){return sum+prefs.widths[id];},0))+"px");
      var colgroup=$("<colgroup/>").appendTo(table);
      visible.forEach(function(id){colgroup.append($("<col/>").attr("data-column",id).css("width",prefs.widths[id]+"px"));});
      var head=$("<tr/>");visible.forEach(function(id){
        var column=COLUMNS.filter(function(c){return c.id===id;})[0], th=$("<th scope='col' draggable='true'/>").attr("data-column",id).css("width",prefs.widths[id]+"px");
        th.append(button(column.label+(prefs.sort && prefs.sort.id===id ? prefs.sort.dir==="asc" ? " ↑":" ↓":"")).addClass("ujg-esi-preflight-header-sort")
          .attr({"data-preflight-sort":id,"data-preflight-focus":"sort-"+id}).on("click",function(){prefs.sort={id:id,dir:prefs.sort && prefs.sort.id===id && prefs.sort.dir==="asc" ? "desc":"asc"};save();draw();}));
        th.append(button("Фильтр: "+column.label,"Funnel").addClass("ujg-esi-preflight-header-filter"+(Array.isArray(prefs.filters[id]) ? " is-active":""))
          .attr({"data-preflight-filter":id,"data-preflight-focus":"filter-"+id,"aria-expanded":"false"}).on("click",function(){openFilter(this,id,report);}));
        th.append($("<span role='separator' tabindex='0'/>").addClass("ujg-esi-preflight-column-resize")
          .attr({"data-preflight-resize":id,"data-preflight-focus":"resize-"+id,"aria-label":"Изменить ширину: "+column.label,"aria-orientation":"vertical"})
          .on("keydown",function(e){if(e.key!=="ArrowLeft" && e.key!=="ArrowRight")return;e.preventDefault();prefs.widths[id]=Math.max(100,Math.min(800,prefs.widths[id]+(e.key==="ArrowRight"?10:-10)));save();draw();})
          .on("pointerdown",function(e){resize={id:id,x:e.pageX,width:prefs.widths[id]};e.stopPropagation();e.preventDefault();}));
        th.on("dragstart",function(e){if(resize){e.preventDefault();return;}e.originalEvent.dataTransfer.setData("text/plain",id);});
        th.on("dragover",function(e){e.preventDefault();});
        th.on("drop",function(e){e.preventDefault();var from=e.originalEvent.dataTransfer.getData("text/plain"),a=prefs.order.indexOf(from),b=prefs.order.indexOf(id);
          if(a<0||b<0||a===b)return;prefs.order.splice(a,1);prefs.order.splice(b,0,from);save();draw();});
        head.append(th);
      });table.append($("<thead/>").append(head));
      var body=$("<tbody/>");
      shownFields(report).forEach(function(field) {
        var column=(report.columns || []).filter(function(col) {return col.index === field.selectedIndex;})[0];
        var caption=column ? columnLabel(column,report) : field.status === "skipped" ? "Не импортировать":"Выбрать колонку";
        var choice=button(caption).addClass("ujg-esi-preflight-choice").attr({"data-preflight-field":field.key,"data-preflight-focus":field.key,"aria-haspopup":"dialog","aria-expanded":"false"}).append(icon("ChevronDown"));
        choice.on("click",function() {
          openPicker(this,field.label,(report.columns || []).map(function(col) {return {value:col.index,label:columnLabel(col,report),example:(col.examples || []).join(" · ")};}),function(index) {services.onImportColumnChoice(field.key,index);},!field.required);
        });
        var examples=$("<td/>");(column && column.examples || []).forEach(function(value) { examples.append($("<div/>").text(value)); });
        if (column) examples.append($("<small/>").text("Заполнено: "+(column.nonEmptyCount || 0)));
        var cells={field:$("<td/>").text(field.label+(field.required ? " *":"")),column:$("<td/>").append(choice),examples:examples,
          status:$("<td/>").append($("<span/>").addClass("ujg-esi-preflight-status is-"+field.status).text(LABELS[field.status] || field.status))};
        var row=$("<tr/>").attr("data-preflight-row",field.key);
        visible.forEach(function(id){row.append(cells[id].attr("data-column",id).css("width",prefs.widths[id]+"px"));});body.append(row);
      });
      if(!body.children().length)body.append($("<tr/>").append($("<td/>").attr("colspan",visible.length).text("Нет строк по фильтрам")));
      table.append(body);scrollHost.append(table);dialog.append(scrollHost);
      var foot=$("<footer/>").addClass("ujg-esi-due-foot");
      foot.append($("<label/>").append($("<input type='checkbox'/>").attr({"data-preflight-remember":"","data-preflight-focus":"remember"}).prop("checked",pending.remember).on("change",function() { services.onImportRememberChange(this.checked); })," Запомнить соответствия"));
      foot.append($("<div/>").addClass("ujg-esi-preflight-actions").append(button("Отмена").attr("data-preflight-focus","cancel").on("click",services.onCancelColumnImport),
        button("Применить и загрузить").addClass("ujg-esi-due-confirm").attr({"data-preflight-confirm":"","data-preflight-focus":"confirm"}).prop("disabled",!report.canApply).on("click",services.onConfirmColumnImport)));
      dialog.append(foot);host.append(dialog);
      if (scroll) {scrollHost[0].scrollTop=scroll.top;scrollHost[0].scrollLeft=scroll.left;}
      var restore=host.find("[data-preflight-focus]").filter(function() {return $(this).attr("data-preflight-focus") === focus;})[0];
      (restore || dialog[0]).focus();
    }
    function destroy() {
      closePopup();if(columnMenu)columnMenu.remove();columnMenu=null;resize=null;$(document).off(".ujgColumnPreflight");
      if (opened) {document.body.style.overflow=overflow;opened=false;}
      if (host) host.empty();
    }
    return {
      render:function(target, nextState, nextServices) {
        host=target;state=nextState;services=nextServices;load();
        if (!state.pendingImport) {
          var wasOpen=opened;destroy();
          if (wasOpen) {var back=anchor && anchor.isConnected ? anchor : document.querySelector(".ujg-esi-file");if(back) back.focus();}
          return;
        }
        if (!opened) {
          opened=true;anchor=document.activeElement;overflow=document.body.style.overflow;document.body.style.overflow="hidden";
          $(document).on("keydown.ujgColumnPreflight",onKey).on("mousedown.ujgColumnPreflight",function(event) {
            if (popup && !popup[0].contains(event.target) && popupAnchor !== event.target && !popupAnchor.contains(event.target)) closePopup();
            if(columnMenu && !columnMenu[0].contains(event.target) && !$(event.target).closest("[data-preflight-columns]").length){columnMenu.remove();columnMenu=null;}
          });
          $(document).on("pointermove.ujgColumnPreflight",function(event){if(!resize)return;prefs.widths[resize.id]=Math.max(100,Math.min(800,resize.width+event.pageX-resize.x));
            host.find('col[data-column="'+resize.id+'"],th[data-column="'+resize.id+'"],td[data-column="'+resize.id+'"]').css("width",prefs.widths[resize.id]+"px");
            var ids=prefs.order.filter(function(id){return prefs.visible[id];});host.find(".ujg-esi-preflight-table").css("width",ids.reduce(function(sum,id){return sum+prefs.widths[id];},0)+"px");
          }).on("pointerup.ujgColumnPreflight",function(){if(!resize)return;resize=null;save();draw();}).on("pointercancel.ujgColumnPreflight",function(){if(!resize)return;prefs.widths[resize.id]=resize.width;resize=null;draw();});
        }
        draw();
      },destroy:destroy
    };
  }
  return {create:create};
});
