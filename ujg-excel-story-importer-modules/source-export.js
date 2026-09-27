define("_ujgESI_sourceExport", [], function() {
  "use strict";
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function unique(values) { return Array.from(new Set(values)); }
  function validKey(value) { return typeof value === "string" && /^[A-Z][A-Z0-9_]*-[1-9][0-9]*$/i.test(value); }
  function day(value) {
    var ms = typeof value === "string" ? Date.parse(value) : NaN;
    return isFinite(ms) ? new Date(ms + 10800000).toISOString().slice(0, 10) : "unknown";
  }
  function stamp(value) {
    var ms = typeof value === "string" ? Date.parse(value) : NaN;
    return isFinite(ms) ? new Date(ms + 10800000).toISOString().replace("T", " ").replace("Z", " МСК") : "БЕЗ ДАТЫ: " + String(value);
  }
  function person(value) { return value ? [value.displayName, value.key || value.name || value.accountId].filter(Boolean).join(" / ") : "не указан"; }
  function valueText(value) { return typeof value === "string" ? value : JSON.stringify(value == null ? null : value); }
  function duration(seconds) {
    return isFinite(seconds) && seconds >= 0 ? Math.floor(seconds / 3600) + " ч " + Math.floor(seconds % 3600 / 60) + " мин" + (seconds % 60 ? " " + seconds % 60 + " с" : "") : "неизвестно";
  }
  function events(data) {
    var out = [];
    function add(issue, kind, at, record, actor) { out.push({key:issue.key,kind:kind,at:at,day:day(at),record:record,actor:actor}); }
    data.issues.forEach(function(issue) {
      var f = issue.raw.fields || {};
      add(issue,"ISSUE_CREATED",f.created,{summary:f.summary,creator:f.creator},f.creator);
      issue.collections.histories.entries.forEach(function(h) { add(issue,"CHANGELOG",h&&h.created,h,h&&h.author); });
      issue.collections.comments.entries.forEach(function(c) {
        if(!c||typeof c!=="object"){add(issue,"INVALID_COMMENT",null,c,null);return;}
        add(issue,"COMMENT_CREATED",c.created,c,c.author);
        if (c.updated && c.updated !== c.created) add(issue,"COMMENT_UPDATED",c.updated,c,c.updateAuthor);
      });
      issue.collections.worklogs.entries.forEach(function(w) {
        if(!w||typeof w!=="object"){add(issue,"INVALID_WORKLOG",null,w,null);return;}
        add(issue,"WORKLOG_STARTED",w.started,w,w.author);
        add(issue,"WORKLOG_CREATED",w.created,w,w.author);
        if (w.updated && w.updated !== w.created) add(issue,"WORKLOG_UPDATED",w.updated,w,w.updateAuthor);
      });
    });
    return out.sort(function(a,b) { return (Date.parse(a.at) || 0) - (Date.parse(b.at) || 0) || a.key.localeCompare(b.key) || a.kind.localeCompare(b.kind); });
  }
  async function collect(reader, options) {
    options = options || {};
    var data = {schemaVersion:1,startedAt:new Date().toISOString(),finishedAt:null,scope:clone(options.scope || {}),
      queryPlan:clone(reader.plan || []),requests:[],searchPages:[],parentKeys:[],parents:[],relationships:[],issues:[],errors:[],
      journalRows:clone(options.journalRows || []),teams:clone(options.teams || []),
      limitations:["Чтение не атомарно: записи получены в разное время в указанном интервале.",
        "Полнота означает доступные этому пользователю записи Jira; удалённые и скрытые записи не восстановлены.",
        "Связи задач и состав команд отражают текущий снимок, не историческую принадлежность.",
        "WORKLOG_STARTED — дата работы; CREATED/UPDATED — действия с записью. Не суммировать часы повторно.",
        "Комментарий содержит последнюю доступную редакцию; прежние редакции Jira не предоставлены.",
        "Строки Excel — отдельное импортированное представление, включая локальные правки; не копия исходного файла и не подтверждение принадлежности текущему проекту/эпику.",
        "Проверка total и ID не доказывает неизменность Jira: замена записей без изменения total во время чтения может остаться незамеченной."],coverage:{}};
    function cancel() { if (options.isCancelled && options.isCancelled()) throw new Error("Выгрузка отменена"); }
    function progress(phase,key) { cancel(); if (options.onProgress) options.onProgress({phase:phase,key:key || "",completed:data.issues.length,total:queue.length}); }
    function error(key,kind,message,status) { data.errors.push({key:key,kind:kind,message:message,status:status || null}); }
    function message(e) { return e && e.status ? "HTTP " + e.status : String(e && e.message || "Чтение не удалось"); }
    // Never trust a short embedded collection as a complete history. Restart paging at zero.
    async function collection(key,kind,embedded) {
      var entries = [], pages = [], expected = embedded && embedded.total, seen = new Set(), start = 0, complete = false;
      var member = kind === "histories" ? "histories" : kind;
      var initial = embedded && embedded[member];
      var usable = Number.isInteger(expected) && expected >= 0;
      if (usable && Array.isArray(initial) && initial.length === expected && (!embedded.startAt || embedded.startAt === 0)) {
        pages.push(clone(embedded)); entries = clone(initial); complete = true;
        if(embedded.isLast === false){complete=false;error(key,kind,"Jira сообщает, что коллекция не закончена (isLast=false)");}
      } else {
        while (true) {
          cancel(); progress(kind,key);
          var page;
          try { page = await reader.readPage(key,kind,start); cancel(); }
          catch (e) { cancel(); error(key,kind,message(e),e.status); break; }
          pages.push(clone(page));
          var batch = page && (page[member] || (kind === "histories" && page.values));
          if (Array.isArray(batch)) entries = entries.concat(clone(batch));
          if (!page || !Number.isInteger(page.total) || page.total < 0 || page.startAt !== start || !Array.isArray(batch)) {
            error(key,kind,"Некорректная страница или неизвестен total"); break;
          }
          if (usable && expected !== page.total) { error(key,kind,"Количество записей изменилось во время чтения: " + expected + " → " + page.total); break; }
          expected = page.total; usable = true;
          var duplicate = batch.some(function(item) {
            if (!item || item.id == null || seen.has(String(item.id))) return true;
            seen.add(String(item.id)); return false;
          });
          if (duplicate) { error(key,kind,"Повторный или отсутствующий ID записи"); break; }
          start += batch.length;
          if (start === expected) {
            complete = page.isLast !== false;
            if(!complete)error(key,kind,"Jira сообщает, что коллекция не закончена (isLast=false)");
            break;
          }
          if (!batch.length || start > expected) { error(key,kind,"Пустая или избыточная страница до конца коллекции"); break; }
        }
      }
      if(Array.isArray(initial))initial.forEach(function(item){
        var found=item&&item.id!=null&&entries.find(function(e){return e&&String(e.id)===String(item.id);});
        if(!found){entries.push(clone(item));complete=false;error(key,kind,"Встроенная запись отсутствует в прочитанных страницах");}
        else if(JSON.stringify(item)!==JSON.stringify(found)){complete=false;error(key,kind,"Версия встроенной записи отличается от отдельной страницы; обе версии сохранены в raw/pages");}
      });
      var ids = entries.map(function(e) { return e && e.id != null ? String(e.id) : null; });
      if (ids.indexOf(null) >= 0 || unique(ids).length !== ids.length) { complete = false; error(key,kind,"Повторный или отсутствующий ID записи"); }
      return {expected:usable ? expected : null,entries:entries,pages:pages,complete:complete};
    }
    var queue = [], searched = new Set(), start = 0, total = null;
    while (true) {
      cancel(); progress("search");
      var page;
      try { page = await reader.readStories(start); cancel(); }
      catch (e) { cancel(); error("","search",message(e),e.status); break; }
      data.searchPages.push(clone(page));
      var batch = page && page.issues;
      var valid = page && Number.isInteger(page.total) && page.total >= 0 && page.startAt === start && Array.isArray(batch);
      var drift = total !== null && total !== page.total;
      if (Array.isArray(batch)) batch.forEach(function(issue) {
        if (!issue || !validKey(issue.key)) { valid = false; return; }
        if (searched.has(issue.key)) { valid = false; return; }
        searched.add(issue.key);data.parentKeys.push(issue.key);queue.push(issue.key);
      });
      if (!valid || drift) { error("","search","Изменился total, нарушена пагинация или ключ истории"); break; }
      total = page.total;start += batch.length;
      if (start === total) break;
      if (!batch.length || start > total) { error("","search","Список историй неполон"); break; }
    }
    var discovered = new Set(queue);
    for (var i = 0; i < queue.length; i++) {
      cancel(); var key = queue[i]; progress("issue",key);
      var raw;
      try { raw = await reader.readIssue(key); cancel(); }
      catch (e) { cancel(); error(key,"issue",message(e),e.status); continue; }
      if (!raw || raw.key !== key || !raw.fields) { error(key,"issue","Ответ не содержит запрошенную задачу"); continue; }
      var issue = {key:key,readAt:new Date().toISOString(),consistency:"not-verified",raw:clone(raw),collections:{}};
      data.issues.push(issue);
      {
        try {
          var children = options.children(raw);
          if (!Array.isArray(children) || children.some(function(k) { return !validKey(k); })) throw new Error("Некорректные связи дочерних задач");
          children = unique(children);
          data.relationships.push({key:key,children:children});
          if(searched.has(key))data.parents.push({key:key,children:children});
          children.forEach(function(child) { if (!discovered.has(child)) { discovered.add(child);queue.push(child); } });
        } catch (e) { error(key,"links",message(e)); }
      }
      issue.collections.histories = await collection(key,"histories",raw.changelog);
      issue.collections.comments = await collection(key,"comments",raw.fields.comment);
      issue.collections.worklogs = await collection(key,"worklogs",raw.fields.worklog);
    }
    cancel();
    events(data).forEach(function(event) { if (event.day === "unknown") error(event.key,event.kind,"Не распознана дата: " + String(event.at)); });
    data.finishedAt = new Date().toISOString(); data.requests = clone(reader.requests || []);
    data.journalAssociation={verified:false,matchedParentKeys:unique(data.journalRows.map(function(r){return r.jiraKey;}).filter(function(k){return searched.has(k);}))};
    data.coverage = {scope:"available-page-counts",complete:data.errors.length === 0 && data.issues.every(function(i) {return Object.keys(i.collections).every(function(k) {return i.collections[k].complete;});}),
      expectedParents:total,loadedParents:data.issues.filter(function(i) {return searched.has(i.key);}).length,
      expectedIssues:queue.length,loadedIssues:data.issues.length,journalLoaded:data.journalRows.length > 0};
    return data;
  }
  function days(data) { return unique(events(data).map(function(e) {return e.day;})).sort(); }
  function text(data, selectedDay, options) {
    var audit = !options || options.audit !== false;
    var out = ["ИСХОДНЫЕ ДАННЫЕ JIRA. НЕ LLM-ОТЧЁТ.","Область: " + JSON.stringify(data.scope),
      "Чтение: " + stamp(data.startedAt) + " — " + stamp(data.finishedAt),
      "Проверка количества доступных записей: " + (data.coverage.complete ? "пройдена" : "НЕПОЛНЫЕ ДАННЫЕ"),
      "Историй: " + data.coverage.loadedParents + " / " + data.coverage.expectedParents + "; задач: " + data.coverage.loadedIssues + " / " + data.coverage.expectedIssues,
      "Excel: " + (data.journalRows.length ? data.journalRows.length + " строк отдельного загруженного файла; принадлежность срезу не подтверждена" : "не загружен; Jira не заменяет исходный журнал"),
      data.limitations.join("\n")];
    if(audit) out.push("\nПЛАН ЗАПРОСОВ",JSON.stringify(data.queryPlan,null,2),"\nЖУРНАЛ ЗАПРОСОВ",JSON.stringify(data.requests,null,2),
      "\nОШИБКИ",JSON.stringify(data.errors,null,2),"\nТЕКУЩИЕ КОМАНДЫ",JSON.stringify(data.teams,null,2),
      "\nСВЯЗИ ИСТОРИЙ И ЗАДАЧ",JSON.stringify(data.relationships,null,2),"\nИСХОДНЫЕ СТРОКИ EXCEL",JSON.stringify(data.journalRows,null,2));
    var list = events(data).filter(function(e) {return !selectedDay || e.day === selectedDay;});
    var keys = new Set(list.map(function(e) {return e.key;}));
    out.push("\nЗАДАЧИ (ТЕКУЩИЕ ПОЛЯ)");
    data.issues.filter(function(i) {return !selectedDay || keys.has(i.key);}).forEach(function(i) {
      var f=i.raw.fields;
      out.push("\n=== " + i.key + " ===",f.summary || "Тема не указана",
        "Родительские истории: " + data.parents.filter(function(p){return p.key===i.key||p.children.indexOf(i.key)>=0;}).map(function(p){return p.key;}).join(", "),
        "Статус: " + valueText(f.status) + "; решение: " + valueText(f.resolution),
        "Исполнитель сейчас: " + person(f.assignee) + "; создатель: " + person(f.creator),
        "Создана: " + f.created + "; обновлена: " + f.updated + "; срок: " + valueText(f.duedate),
        "Компоненты: " + valueText(f.components) + "; приоритет: " + valueText(f.priority),
        "Описание:\n" + valueText(f.description),
        "Коллекции: " + Object.keys(i.collections).map(function(k) {var c=i.collections[k];return k + " " + c.entries.length + "/" + c.expected + (c.complete ? " OK" : " НЕПОЛНО");}).join("; "));
      if(audit && !selectedDay)out.push("ВСЕ ПОЛЯ " + JSON.stringify(f));
    });
    out.push("\nСОБЫТИЯ " + (selectedDay || "ЗА ВСЕ ДНИ") + "; МСК; " + list.length + " записей представления");
    var currentDay;
    list.forEach(function(e) {
      if(currentDay!==e.day){currentDay=e.day;out.push("\n######## ДЕНЬ " + currentDay + " (МСК) ########");}
      var r=e.record||{};
      out.push("\n[" + stamp(e.at) + "] " + e.kind + " " + e.key + " ID=" + (r.id || e.key) + " | " + person(e.actor));
      if (e.kind === "CHANGELOG" && Array.isArray(r.items)) r.items.forEach(function(item) {if(item)out.push("  " + (item.field || item.fieldId) + ": " + valueText(item.fromString) + " → " + valueText(item.toString),"  ID значений: " + valueText(item.from) + " → " + valueText(item.to));});
      if (/^COMMENT/.test(e.kind)) out.push(valueText(r.body),"Создан: " + r.created + "; изменён: " + r.updated + "; автор изменения: " + person(r.updateAuthor));
      if (/^WORKLOG/.test(e.kind)) out.push("Трудозатраты: " + r.timeSpentSeconds + " с = " + duration(r.timeSpentSeconds),valueText(r.comment),
        "Дата работы: " + r.started + "; запись создана: " + r.created + "; изменена: " + r.updated + "; автор изменения: " + person(r.updateAuthor));
      if(e.kind==="ISSUE_CREATED")out.push(r.summary);
      if(audit || e.day==="unknown")out.push("RAW " + JSON.stringify(e.record));
    });
    return out.join("\n");
  }
  return {collect:collect,text:text,days:days,events:events};
});
