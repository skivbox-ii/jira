define("_ujgESI_sourceExportUi", ["jquery","_ujgESI_sourceExport","_ujgESI_icons"], function($,engine,icon) {
  "use strict";
  function scope(state) {return JSON.stringify([state.baseUrl,state.projectKey,state.epicKey,state.preferencesStorageKey,state.viewMode,state.sourceFileName]);}
  function download(name,text,type) {
    var url=URL.createObjectURL(new Blob([text],{type:type+";charset=utf-8"})),a=document.createElement("a");
    a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(function(){URL.revokeObjectURL(url);},30000);
  }
  function create() {
    var $dialog,$status,$text,$date,$load,$downloads,$previous,$next,$unknown,$audit,serial=0,data,busy=false,planError=false,days=[],selected,state,services,oldScope,rows,anchor,overflow,destroyed=false;
    function button(name,label,cls,action) {return $("<button/>").attr({type:"button",title:label,"aria-label":label}).addClass(cls).append(icon(name)).on("click",action);}
    function dismiss() {
      serial++;data=null;busy=false;
      if (!$dialog) return;
      $dialog.remove();$dialog=null;document.body.style.overflow=overflow;
      if(anchor&&document.contains(anchor)){anchor.focus();$(anchor).attr("aria-expanded","false");}anchor=null;
    }
    function show(day) {
      if(!data)return;
      selected=day;$date.val(day==="unknown"?"":day);
      $text.text(engine.text(data,day,{audit:false}));
      $previous.prop("disabled",days.indexOf(day)<=0);$next.prop("disabled",days.indexOf(day)<0||days.indexOf(day)>=days.length-1);
      $dialog.find(".ujg-esi-ai-content").scrollTop(0);
    }
    function controls() {$load.prop("disabled",busy||planError);$downloads.prop("disabled",busy||!data);$date.prop("disabled",busy||!data);$dialog.attr("aria-busy",String(busy));}
    function read() {
      if(busy||planError)return;var active=++serial;busy=true;data=null;controls();$text.empty();$audit.empty();$status.text("Чтение списка историй");
      $previous.prop("disabled",true);$next.prop("disabled",true);$unknown.prop("hidden",true);
      function cancelled(){return active!==serial||!$dialog||destroyed;}
      Promise.resolve().then(function(){
        if(cancelled())return;
        return services.onLoadSourceExport({isCancelled:cancelled,onProgress:function(p){if(!cancelled())$status.text((p.phase==="search"?"Список историй":"Чтение "+p.phase)+" · "+p.key+" · задач "+p.completed+" / "+p.total);}});
      }).then(function(result){
        if(cancelled())return;data=result;busy=false;controls();
        var c=data.coverage;days=engine.days(data);$status.text((c.complete?"Доступные записи прочитаны":"НЕПОЛНЫЕ ДАННЫЕ")+" · задач "+c.loadedIssues+" / "+c.expectedIssues+" · ошибок "+data.errors.length);
        $audit.text(JSON.stringify({coverage:c,errors:data.errors,requests:data.requests},null,2));
        $dialog.find("details").prop("open",false);
        $unknown.prop("hidden",days.indexOf("unknown")<0);days=days.filter(function(d){return d!=="unknown";});
        show(days[days.length-1]||"unknown");
      }).catch(function(e){if(cancelled())return;busy=false;controls();$status.text(String(e&&e.message||"Чтение не удалось"));});
    }
    function open(nextState,nextServices,control) {
      if(destroyed)return;dismiss();planError=false;state=nextState;services=nextServices;oldScope=scope(state);rows=state.rows;anchor=control||document.activeElement;
      overflow=document.body.style.overflow;document.body.style.overflow="hidden";
      if(anchor)$(anchor).attr("aria-expanded","true");
      $dialog=$("<section/>").addClass("ujg-esi-activity-ai-dialog ujg-esi-source-dialog").attr({role:"dialog","aria-modal":"true","aria-label":"Исходные данные Jira",tabindex:"-1"}).appendTo(document.body);
      var $close=button("X","Закрыть исходные данные","ujg-esi-source-close",dismiss);
      $dialog.append($("<header/>").addClass("ujg-esi-ai-header").append($("<h2/>").text("Исходные данные Jira"),$close));
      $status=$("<p/>").addClass("ujg-esi-source-status").attr({role:"status","aria-live":"polite"}).text(state.projectKey+" · "+(state.epicKey||"Все истории проекта"));
      $load=button("RefreshCw","Загрузить исходные данные","ujg-esi-source-load",read).append($("<span/>").text("Загрузить"));
      var $json=button("Download","Скачать полный JSON","ujg-esi-source-json",function(){if(data)download("jira-source-"+state.projectKey+"-"+data.finishedAt.replace(/[:.]/g,"-")+".json",JSON.stringify(data,null,2),"application/json");}).append($("<span/>").text("JSON"));
      var $all=button("Download","Скачать текст за все дни","ujg-esi-source-all",function(){if(data)download("jira-source-all.txt",engine.text(data),"text/plain");}).append($("<span/>").text("Все дни · TXT"));
      var $day=button("Download","Скачать текст за выбранный день","ujg-esi-source-day",function(){if(data)download("jira-source-"+selected+".txt",engine.text(data,selected),"text/plain");}).append($("<span/>").text("День · TXT"));
      $downloads=$json.add($all).add($day);
      $date=$("<input/>").attr({type:"date","aria-label":"День исходных событий"}).addClass("ujg-esi-source-date").on("change",function(){if(/^\d{4}-\d{2}-\d{2}$/.test(this.value))show(this.value);});
      $previous=button("ChevronLeft","Предыдущий день с записями","ujg-esi-source-prev",function(){show(days[days.indexOf(selected)-1]);}).prop("disabled",true);
      $next=button("ChevronRight","Следующий день с записями","ujg-esi-source-next",function(){show(days[days.indexOf(selected)+1]);}).prop("disabled",true);
      $unknown=button("Calendar","Записи без даты","ujg-esi-source-unknown",function(){show("unknown");}).append($("<span/>").text("Без даты")).prop("hidden",true);
      var $plan=$("<pre/>").addClass("ujg-esi-source-plan");
      try{$plan.text(JSON.stringify(services.onSourceExportPlan(),null,2));}catch(e){planError=true;$status.text(e.message);}
      $audit=$("<pre/>").addClass("ujg-esi-source-audit");$text=$("<pre/>").addClass("ujg-esi-source-text").attr({tabindex:"0","aria-label":"Полный текст исходных записей за день"});
      $dialog.append($("<div/>").addClass("ujg-esi-ai-actions").append($load,$json,$all,$day),$status,
        $("<div/>").addClass("ujg-esi-ai-actions").append($previous,$date,$next,$unknown),
        $("<div/>").addClass("ujg-esi-ai-content").append($("<details open/>").append($("<summary/>").text("План чтения"),$plan),$("<details/>").append($("<summary/>").text("Запросы, полнота и ошибки"),$audit),$text));
      controls();$close.trigger("focus");
      $dialog.on("keydown",function(e){
        if(e.key==="Escape"){e.preventDefault();e.stopPropagation();dismiss();return;}
        if(e.key!=="Tab")return;
        var items=$dialog.find('button:not(:disabled):not([hidden]),input:not(:disabled),summary,pre[tabindex]'),first=items[0],last=items[items.length-1];
        if(e.shiftKey&&(document.activeElement===first||document.activeElement===$dialog[0])){e.preventDefault();last.focus();}
        else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
      });
    }
    return {open:open,dismiss:dismiss,updateScope:function(s){if($dialog&&(scope(s)!==oldScope||s.rows!==rows))dismiss();},destroy:function(){dismiss();destroyed=true;}};
  }
  return {create:create};
});
