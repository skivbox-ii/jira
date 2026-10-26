define("_ujgESI_activityLoader", [], function() {
  "use strict";
  function create(options) {
    var active = Object.create(null), wanted = [], queued = [], results = Object.create(null);
    var epoch = 0, selection = 0, completedSelection = -1, enabled = false;
    var rows = [], rowSequence = 0, runId = 0, stoppedSnapshot = null, status = "idle", lastKeys = [], historyRows = Object.create(null);
    function requestRow(stage,key,startAt) {
      var row = {id:"activity-" + (++rowSequence),runId:runId,stage:stage,key:key,startAt:startAt,state:"queued"};
      if (stage === "history") row.requested=1;
      rows.push(row); return row;
    }
    function finishRow(row,state,error) {
      if (!row) return;
      row.state=state; row.finishedAt=Date.now();
      if (error) row.error=options.errorText ? options.errorText(error) : String(error.message || error.statusText || error);
    }
    function snapshot() {
      if (stoppedSnapshot) return stoppedSnapshot;
      var failures = [], completed = 0;
      wanted.forEach(function(key) {
        if (!results[key]) return;
        completed++;
        if (results[key].error) failures.push({key:key,message:results[key].error});
      });
      return {runId:runId,status:status,rows:rows.slice(),total:wanted.length,completed:completed,failures:failures,
        activeKeys:Object.keys(active).filter(function(key) { return wanted.indexOf(key) >= 0; }),queued:queued.length};
    }
    function notify() {
      if (!enabled || completedSelection === selection) return;
      var current = selection, progress = snapshot();
      if (progress.completed === progress.total) { status=progress.failures.length ? "error" : "completed"; progress.status=status; }
      if (options.onProgress) options.onProgress(progress);
      if (current === selection && progress.completed === progress.total && completedSelection !== current) {
        completedSelection = current;
        if (options.onComplete) options.onComplete(progress);
      }
    }
    function pump(skipNotification) {
      while (enabled && queued.length && Object.keys(active).length < (options.concurrency || 3)) start(queued.shift());
      if (!skipNotification) notify();
    }
    function start(key) {
      var entry = {epoch:epoch,request:null,row:historyRows[key],rows:[historyRows[key]]};
      entry.row.state="running"; entry.row.startedAt=Date.now();
      active[key] = entry;
      function current() { return enabled && entry.epoch === epoch && active[key] === entry; }
      Promise.resolve().then(function() {
        if (!current()) return null;
        entry.request = options.read(key);
        return entry.request;
      }).then(function(value) {
        if (!current() || wanted.indexOf(key) < 0) return null;
        entry.row.received=value ? 1 : 0;
        finishRow(entry.row,"completed");
        if (value && value.fields) value = Object.assign({},value,{_activityReadAt:new Date().toISOString()});
        return hydrateComments(key,value,entry,current);
      }).then(function(value) {
        if (!current() || wanted.indexOf(key) < 0) return;
        options.accept(key,value);
        if (wanted.indexOf(key) >= 0) results[key] = {error:value && value.fields && value.fields.comment && value.fields.comment.loadError || ""};
      }).catch(function(error) {
        if (!current() || wanted.indexOf(key) < 0) return;
        finishRow(entry.row,"error",error);
        results[key] = {error:options.errorText ? options.errorText(error) : String(error && (error.message || error.statusText) || error)};
      }).then(function() {
        if (!current()) return;
        delete active[key];
        pump(wanted.indexOf(key) < 0 && !queued.length);
      });
    }
    function hydrateComments(key, issue, entry, current) {
      if (!issue || !issue.fields || typeof options.readComments !== "function") return issue;
      var initial = issue.fields.comment, raw = initial && initial.comments, ids = Object.create(null);
      var full = initial && initial.startAt === 0 && /^\d+$/.test(String(initial.total)) && Array.isArray(raw) &&
        Number(initial.total) === raw.length && initial.isLast !== false && !initial.loadError && raw.every(function(comment) {
          var id = String(comment && comment.id || "");
          if (!id || ids[id]) return false;
          ids[id] = true; return true;
        });
      if (full) return issue;
      var result = Object.assign({},issue,{fields:Object.assign({},issue.fields)}), entries = [], seen = Object.create(null), total = null, pages = 0;
      function check() { if (!current() || wanted.indexOf(key) < 0) throw new Error("Загрузка отменена"); }
      function page() {
        check();
        if (++pages > 500) throw new Error("Превышен предел страниц комментариев");
        entry.commentRow=requestRow("comments",key,entries.length);
        entry.rows.push(entry.commentRow);
        entry.commentRow.state="running"; entry.commentRow.startedAt=Date.now(); entry.commentRow.requested=100;
        if (options.onProgress) options.onProgress(snapshot());
        entry.request = options.readComments(key,entries.length);
        return Promise.resolve(entry.request).then(function(value) {
          check();
          if (!value || value.startAt !== entries.length || !/^\d+$/.test(String(value.total)) || !Array.isArray(value.comments)) throw new Error("Некорректная страница комментариев");
          if (total === null) total = Number(value.total);
          if (total !== Number(value.total) || initial && /^\d+$/.test(String(initial.total)) && Number(initial.total) !== total) throw new Error("Список комментариев изменился во время загрузки");
          var batch = value.comments, batchIds = Object.create(null);
          if (entries.length + batch.length > total || !batch.length && entries.length < total) throw new Error("Неполная страница комментариев");
          batch.forEach(function(comment) {
            var id = String(comment && comment.id || "");
            if (!id || seen[id] || batchIds[id]) throw new Error("Повторный ID комментария");
            batchIds[id] = true;
          });
          batch.forEach(function(comment) { seen[String(comment.id)] = true; entries.push(comment); });
          entry.commentRow.received=batch.length; entry.commentRow.total=total;
          if (entries.length < total) { finishRow(entry.commentRow,"completed"); return page(); }
          if (value.isLast === false) throw new Error("Последняя страница комментариев не подтверждена");
          finishRow(entry.commentRow,"completed");
          result.fields.comment = {startAt:0,total:total,comments:entries};
          return result;
        });
      }
      return Promise.resolve().then(page).catch(function(error) {
        check();
        finishRow(entry.commentRow,"error",error);
        // Keep initial evidence not reached by the failed pagination, preferring fresh pages by ID.
        (Array.isArray(raw) ? raw : []).forEach(function(comment) {
          var id = String(comment && comment.id || "");
          if (!id || seen[id]) return;
          seen[id] = true; entries.push(comment);
        });
        var expected = total === null ? initial && initial.total : total;
        if (expected != null && entries.length > Number(expected)) expected = null;
        result.fields.comment = {startAt:0,total:expected,
          comments:entries,isLast:false,
          loadError:"Не удалось полностью загрузить комментарии: " + String(error && error.message || "Ошибка чтения")};
        return result;
      });
    }
    function abort(key) {
      var entry = active[key];
      if (entry) {
        if (entry.row.state === "running" || entry.row.state === "queued") finishRow(entry.row,"cancelled");
        if (entry.commentRow && entry.commentRow.state === "running") finishRow(entry.commentRow,"cancelled");
      }
      delete active[key];
      if (entry && entry.request && typeof entry.request.abort === "function") {
        try { entry.request.abort(); } catch (ignore) { /* Late responses are isolated by identity. */ }
      }
    }
    function select(keys, retainErrors) {
      selection++; enabled = true; results = Object.create(null);
      runId++; stoppedSnapshot=null;
      status="running";
      rows=retainErrors ? rows.filter(function(row) { return row.state === "error"; }) : [];
      var seen = Object.create(null);
      wanted = (keys || []).filter(function(key) {
        if (typeof key !== "string" || !key || seen[key]) return false;
        seen[key] = true; return true;
      });
      lastKeys=wanted.slice();
      Object.keys(active).forEach(function(key) {
        if (!seen[key] && (!active[key].request || typeof active[key].request.abort === "function")) abort(key);
      });
      queued = wanted.filter(function(key) { return !active[key]; });
      historyRows=Object.create(null);
      wanted.forEach(function(key) {
        if (active[key]) {
          historyRows[key]=active[key].row;
          active[key].rows.forEach(function(row) {
            row.runId=runId;
            if (rows.indexOf(row) < 0) rows.push(row);
          });
        }
        else historyRows[key]=requestRow("history",key);
      });
      pump();
    }
    function cancel() {
      stoppedSnapshot=null;
      enabled = false; epoch++; selection++; queued = []; wanted = []; results = Object.create(null);
      Object.keys(active).forEach(abort);
    }
    function stop() {
      var keys=lastKeys.slice();
      rows.forEach(function(row) { if (row.state === "running" || row.state === "queued") finishRow(row,"cancelled"); });
      var progress=snapshot();
      cancel(); lastKeys=keys; status="cancelled";
      stoppedSnapshot=Object.assign({},progress,{status:status,activeKeys:[],queued:0});
      if (options.onProgress) options.onProgress(snapshot());
    }
    function restart() { var keys=lastKeys.slice(); cancel(); select(keys); }
    function retry() { var keys=snapshot().failures.map(function(item) { return item.key; }); if (!keys.length) return; cancel(); select(keys,true); }
    return {select:select,cancel:cancel,stop:stop,restart:restart,retry:retry,getState:snapshot};
  }
  return {create:create};
});
