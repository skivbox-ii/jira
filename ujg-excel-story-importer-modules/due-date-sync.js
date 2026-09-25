define("_ujgESI_dueDateSync", ["_ujgESI_deadlines"], function(deadlines) {
  "use strict";

  var own = Object.prototype.hasOwnProperty;
  function validKey(key) { return typeof key === "string" && /^[A-Za-z][A-Za-z0-9_]*-[1-9][0-9]*$/.test(key.trim()); }
  function validDate(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    var parsed = new Date(value + "T00:00:00Z");
    return isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }
  function current(issue, expectedKey) {
    if (!issue || !validKey(issue.key) || issue.key.trim().toUpperCase() !== expectedKey.toUpperCase()) throw new Error("unknown-issue");
    if (!issue || !issue.fields || !own.call(issue.fields, "duedate")) throw new Error("unknown-date");
    var date = issue.fields.duedate;
    if (date === null) return null;
    if (!validDate(date)) throw new Error("unknown-date");
    return date;
  }
  function usableId(id) {
    return typeof id === "string" && !!id.trim() || typeof id === "number" && isFinite(id);
  }
  function uniqueIds(rows) {
    var reserved = new Set(), used = new Set();
    rows.forEach(function(row) { if (usableId(row.id)) reserved.add(String(row.id)); });
    rows.forEach(function(row, index) {
      var id = usableId(row.id) ? String(row.id) : "";
      if (id && !used.has(id)) { used.add(id); return; }
      var generated = "due-row-" + (index + 1), suffix = 2;
      while (reserved.has(generated) || used.has(generated)) generated = "due-row-" + (index + 1) + "-" + suffix++;
      row.id = generated; used.add(generated);
    });
  }
  function httpStatus(error) {
    var value = error && error.status;
    return typeof value === "number" && value >= 100 && value <= 599 && Math.floor(value) === value ? value : null;
  }
  function frozenRow(source, columnMap) {
    var columns = source && source.sourceColumns;
    var due = deadlines.resolve({sourceColumns:Array.isArray(columns) ? columns.map(function(entry) {
      return {name:entry.name,value:entry.value};
    }) : Object.assign({}, columns || {})}, {columnMap:columnMap});
    var key = source && (source.createdKey || source.jiraKey);
    key = typeof key === "string" ? key.trim() : "";
    var remark = source && source.remarkId;
    if (remark == null && columns && !Array.isArray(columns)) remark = columns["№"] || columns.ID || null;
    return {
      id:source && source.id, key:key, remarkId:remark == null ? null : String(remark),
      summary:String(source && source.summary || ""), sourceRaw:due.candidates.map(function(item) { return item.raw; }).join("; "),
      newDate:due.date, oldDate:null, eligible:false, selected:false,
      status:due.problem === "conflict" && validKey(key) ? "conflict" : "skipped",
      message:!validKey(key) ? "Нет корректного Jira-ключа" : due.reasonLabel || "",
      problem:due.problem
    };
  }
  function create(options) {
    options = options || {};
    var api = options.api, onChange = typeof options.onChange === "function" ? options.onChange : function() {};
    var state = {open:false,loading:false,running:false,rows:[],error:null,completed:0,total:0};
    var generation = 0;
    function snapshot() {
      return {open:state.open,loading:state.loading,running:state.running,error:state.error,
        completed:state.completed,total:state.total,rows:state.rows.map(function(row) {
          return {id:row.id,key:row.key,remarkId:row.remarkId,summary:row.summary,
            sourceRaw:row.sourceRaw,newDate:row.newDate,oldDate:row.oldDate,
            eligible:row.eligible,selected:row.selected,status:row.status,message:row.message};
        })};
    }
    function notify() { onChange(snapshot()); }
    function queue(items, limit, task, active) {
      var next = 0;
      function worker() {
        if (!active() || next >= items.length) return Promise.resolve();
        var item = items[next++];
        return Promise.resolve().then(function() { return task(item); }).then(worker);
      }
      var workers = [];
      for (var i = 0; i < Math.min(limit, items.length); i++) workers.push(worker());
      return Promise.all(workers);
    }
    function open(rows, settings) {
      if (state.running) return false;
      var token = ++generation, grouped = new Map(), plan = [];
      (Array.isArray(rows) ? rows : []).forEach(function(source) {
        var item = frozenRow(source, settings && settings.columnMap);
        if (validKey(item.key)) {
          var normalized = item.key.toUpperCase();
          if (grouped.has(normalized)) {
            var existing = grouped.get(normalized);
            existing.sourceRaw = [existing.sourceRaw,item.sourceRaw].filter(Boolean).join("; ");
            if (item.problem && item.problem !== "missing" || existing.problem && existing.problem !== "missing" ||
                item.newDate && existing.newDate && item.newDate !== existing.newDate) {
              existing.problem = "conflict";
              existing.newDate = null;
              existing.message = "Противоречивые сроки Excel";
              existing.status = "conflict";
            } else if (!existing.newDate && item.newDate) {
              existing.newDate = item.newDate; existing.problem = null; existing.message = "";
            }
            return;
          }
          grouped.set(normalized,item);
        }
        plan.push(item);
      });
      uniqueIds(plan);
      state = {open:true,loading:true,running:false,rows:plan,error:null,completed:0,total:plan.length};
      plan.forEach(function(item) {
        if (validKey(item.key) && item.newDate && !item.problem) item.status = "loading";
      });
      notify();
      var candidates = plan.filter(function(item) { return item.status === "loading"; });
      return queue(candidates,3,function(item) {
        return Promise.resolve().then(function() { return api.getIssueDueDate(item.key); }).then(function(issue) {
          if (token !== generation) return;
          var old = current(issue,item.key);
          item.oldDate = old;
          if (old === item.newDate) { item.status = "skipped"; item.message = "Срок уже совпадает"; }
          else { item.status = "ready"; item.message = ""; item.eligible = true; item.selected = true; }
          notify();
        },function() {
          if (token !== generation) return;
          item.status = "skipped"; item.message = "Карточка Jira недоступна"; notify();
        }).catch(function() {
          if (token !== generation) return;
          item.status = "skipped"; item.message = "Текущий срок Jira неизвестен"; notify();
        });
      },function() { return token === generation; }).then(function() {
        if (token !== generation) return;
        state.loading = false; notify();
        return snapshot();
      });
    }
    function close() {
      if (state.running) return false;
      ++generation; state.open = false; state.loading = false; state.rows = []; state.total = 0; state.completed = 0; state.error = null;
      notify(); return true;
    }
    function select(id, selected) {
      if (!state.open || state.loading || state.running) return false;
      var item = state.rows.find(function(row) { return row.id === id; });
      if (!item || !item.eligible || item.status === "updated") return false;
      item.selected = !!selected; notify(); return true;
    }
    function selectAll(selected) {
      if (!state.open || state.loading || state.running) return false;
      state.rows.forEach(function(item) { if (item.eligible && item.status !== "updated") item.selected = !!selected; });
      notify(); return true;
    }
    function confirm() {
      if (!state.open || state.loading || state.running) return false;
      var chosen = state.rows.filter(function(item) { return item.eligible && item.selected && item.status !== "updated"; });
      if (!chosen.length) return false;
      var token = generation;
      state.running = true; state.completed = 0; state.total = chosen.length; notify();
      return queue(chosen,2,function(item) {
        item.status = "updating"; item.selected = false; notify();
        return Promise.resolve().then(function() { return api.getIssueDueDate(item.key); }).then(function(issue) {
          var now = current(issue,item.key);
          if (now === item.newDate) { item.status = "skipped"; item.eligible = false; item.message = "Срок уже установлен"; return; }
          if (now !== item.oldDate) { item.status = "conflict"; item.eligible = false; item.message = "Срок Jira изменился после просмотра"; return; }
          if (!validKey(item.key) || !validDate(item.newDate)) { item.status = "error"; item.eligible = false; item.message = "Некорректный ключ или срок"; return; }
          var request;
          try { request = api.updateIssueDueDate(item.key,item.newDate); }
          catch (_) { item.status = "error"; item.message = "Не удалось начать запись"; return; }
          return Promise.resolve(request).then(function() {
            item.status = "updated"; item.eligible = false; item.message = "Обновлено";
          },function(error) {
            var status = httpStatus(error);
            item.status = status >= 400 && status < 500 ? "error" : "unconfirmed";
            item.message = (item.status === "error" ? "Jira отклонила обновление" : "Результат записи не подтверждён") +
              (status ? " (HTTP " + status + ")" : "");
          });
        }).catch(function(error) {
          item.status = "error";
          item.message = "Не удалось проверить текущий срок Jira";
        }).then(function() { state.completed++; notify(); });
      },function() { return token === generation; }).then(function() {
        state.running = false; notify(); return snapshot();
      });
    }
    return {open:open,close:close,select:select,selectAll:selectAll,confirm:confirm,getState:snapshot};
  }
  return {create:create};
});
