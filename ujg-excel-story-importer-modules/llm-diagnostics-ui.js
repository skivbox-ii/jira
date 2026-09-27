define("_ujgESI_llmDiagnosticsUi", ["jquery", "_ujgESI_icons"], function($, icon) {
  "use strict";
  var unknown = "неизвестно";
  var names = {prepare:"Подготовка",headers:"Заголовки",body:"Тело ответа",json:"JSON",extract:"Извлечение текста",http:"HTTP"};
  var statuses = {running:"выполняется",ok:"готово",error:"ошибка",success:"успех"};
  function value(item) {
    if (item === null || item === undefined || item === "") return unknown;
    if (item === true) return "Да";
    if (item === false) return "Нет";
    return String(item);
  }
  function msk(item) {
    var ms=Date.parse(item);
    if (!isFinite(ms)) return unknown;
    var text=new Date(ms+10800000).toISOString();
    return text.slice(8,10)+"."+text.slice(5,7)+"."+text.slice(0,4)+" "+text.slice(11,19)+" МСК";
  }
  function body(item,bytes) { return bytes===0 && (item==="" || item===null || item===undefined) ? "(пустое тело)" : value(item); }
  function sendState(sent) {
    if (sent===false) return "не начиналась";
    if (sent===null) return "вызван fetch; приём сервером неизвестен";
    if (sent===true) return "получен HTTP-ответ";
    return unknown;
  }
  function displayBody(item,bytes) {
    if (typeof item!=="string" || !item.trim()) return body(item,bytes);
    try { return JSON.stringify(JSON.parse(item),null,2); }
    catch (error) { return item; }
  }
  function field($list,label,item) {
    $list.append($("<dt/>").text(label),$("<dd/>").text(value(item)));
  }
  function section(title,body) {
    return $("<details/>").addClass("ujg-esi-llm-diagnostic-disclosure").append($("<summary/>").text(title),$("<pre/>").text(value(body)));
  }
  function create($parent) {
    var traces=[],omitted=0,$panel=null,$host=$parent;
    var $button=$("<button/>").attr({type:"button",title:"Диагностика LLM","aria-label":"Диагностика LLM",hidden:true}).addClass("ujg-esi-llm-diagnostic-open").append(icon("Activity"),$("<span/>").text("Диагностика")).on("click",open);
    function exportJson() { return JSON.stringify({warning:"Экспорт может содержать исходные данные Jira. Проверьте файл перед передачей.",omitted:omitted,traces:traces},null,2); }
    function download() {
      var blob=new Blob([exportJson()],{type:"application/json;charset=utf-8"});
      var url=URL.createObjectURL(blob),link=document.createElement("a");
      link.href=url;link.download="llm-diagnostics.json";document.body.appendChild(link);link.click();link.remove();
      setTimeout(function(){URL.revokeObjectURL(url);},0);
    }
    function close() { if (!$panel) return; $panel.remove();$panel=null;$button.trigger("focus"); }
    function render() {
      if (!$panel) return;
      var $body=$panel.find(".ujg-esi-llm-diagnostic-body"),bodyScroll=$body[0].scrollTop;
      var expanded=$body.find(".ujg-esi-llm-diagnostic-disclosure").map(function(){return {open:this.open,scroll:this.querySelector("pre").scrollTop};}).get();
      $body.empty();
      if (omitted) $body.append($("<p/>").text("Ранние попытки пропущены: " + omitted));
      traces.forEach(function(trace,index) {
        var request=trace.request || {},response=trace.response || {},usage=response.usage || {},error=trace.error || {},network=trace.network || {};
        var $item=$("<section/>").addClass("ujg-esi-llm-diagnostic-attempt");
        $item.append($("<h3/>").text("Попытка " + (omitted+index+1) + " · ID " + value(trace.id) + " · " + value(statuses[trace.outcome] || trace.outcome) + " · " + value(trace.summary)));
        var $meta=$("<dl/>").addClass("ujg-esi-llm-diagnostic-meta");
        [["Начало",msk(trace.startedAt)],["Окончание",msk(trace.endedAt)],["Длительность, мс",trace.durationMs],["Фаза",names[trace.phase] || trace.phase],
          ["URL запроса",request.url],["Метод",request.method],["Модель",request.model],["Отправка",sendState(request.sent)],["Учётные данные",request.credentials],
          ["Тело запроса, байт",request.bodyBytes],["Система, байт",request.systemBytes],["Пользователь, байт",request.userBytes],["Запрос сокращён",request.bodyTruncated],
          ["HTTP статус",response.status],["Статус",response.statusText],["URL ответа",response.url],["Тип",response.type],["Перенаправление",response.redirected],
          ["Формат",response.format],["Структура JSON",response.jsonShape],["Причина завершения",response.finishReason],
          ["Тело ответа, байт",response.bodyBytes],["Ответ сокращён",response.bodyTruncated],
          ["Входные токены",usage.inputTokens],["Выходные токены",usage.outputTokens],["Всего токенов",usage.totalTokens],["Источник токенов",{provider:"Данные провайдера",unavailable:"Провайдер не сообщил"}[usage.source] || usage.source],
          ["Ошибка",error.name],["Сообщение ошибки",error.message],
          ["Сетевые замеры доступны",network.available],["Причина отсутствия замеров",network.reason],["Источник замеров",network.source],
          ["DNS, мс",network.dnsMs],["Соединение, мс",network.connectMs],["TLS, мс",network.tlsMs],
          ["До первого байта, мс",network.ttfbMs],["Загрузка, мс",network.downloadMs],["Протокол",network.protocol]].forEach(function(pair){field($meta,pair[0],pair[1]);});
        $item.append($meta);
        var $stages=$("<ol/>").addClass("ujg-esi-llm-diagnostic-stages");
        (trace.stages || []).forEach(function(stage){$stages.append($("<li/>").text(value(names[stage.name] || stage.name)+" · "+value(statuses[stage.status] || stage.status)+" · начало +"+value(stage.startedMs)+" мс; длительность "+value(stage.durationMs)+" мс"));});
        $item.append($("<h4/>").text("Этапы"),$stages);
        $item.append(section("Заголовки запроса",JSON.stringify(request.headers || {},null,2)),section("Отправленное тело",displayBody(request.body,request.bodyBytes)),section("Заголовки ответа",JSON.stringify(response.headers || {},null,2)),section("Тело ответа",displayBody(response.body,response.bodyBytes)));
        (trace.limitations || []).forEach(function(limit){$item.append($("<p/>").text(limit));});
        $body.append($item);
      });
      $body.find(".ujg-esi-llm-diagnostic-disclosure").each(function(index){
        if (!expanded[index]) return;
        this.open=expanded[index].open;
        this.querySelector("pre").scrollTop=expanded[index].scroll;
      });
      $body[0].scrollTop=bodyScroll;
    }
    function open() {
      if (!traces.length || $panel) return;
      $panel=$("<section/>").addClass("ujg-esi-llm-diagnostic-panel").attr({role:"dialog","aria-modal":"true","aria-label":"Диагностика LLM",tabindex:"-1"});
      var $close=$("<button/>").attr({type:"button",title:"Закрыть диагностику","aria-label":"Закрыть диагностику"}).append(icon("X")).on("click",close);
      var $save=$("<button/>").attr({type:"button",title:"Скачать JSON","aria-label":"Скачать JSON"}).append(icon("Download")).on("click",download);
      $panel.append($("<header/>").append($("<h2/>").text("Диагностика LLM"),$save,$close),$("<p/>").addClass("ujg-esi-llm-diagnostic-warning").text("Экспорт может содержать исходные данные Jira. Проверьте файл перед передачей."),$("<div/>").addClass("ujg-esi-llm-diagnostic-body"));
      $panel.on("keydown",function(event){
        if(event.key==="Escape") {event.preventDefault();event.stopPropagation();close();return;}
        if(event.key!=="Tab") return;
        event.stopPropagation();
        var items=$panel.find("button,summary").filter(function(){return !$(this).parents("details:not([open])").length || this.tagName==="SUMMARY";});
        if(event.shiftKey && document.activeElement===items[0]) {event.preventDefault();items[items.length-1].focus();}
        else if(!event.shiftKey && document.activeElement===items[items.length-1]) {event.preventDefault();items[0].focus();}
      });
      $host.append($panel);render();$close.trigger("focus");
    }
    function record(trace) {
      if (!trace || typeof trace!=="object") return;
      var index=traces.findIndex(function(item){return item.id===trace.id;});
      if (index>=0) traces[index]=trace;
      else {traces.push(trace);if(traces.length>10){traces.shift();omitted++;}}
      $button.prop("hidden",false);render();
    }
    function clear() {traces=[];omitted=0;close();$button.prop("hidden",true);}
    return {button:function(){return $button;},record:record,clear:clear,open:open,close:close,exportJson:exportJson,mount:function($parent){$host=$parent;}};
  }
  return {create:create};
});
