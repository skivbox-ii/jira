define("_ujgESI_activityLoader", [], function() {
  "use strict";
  function create(options) {
    var active = Object.create(null), wanted = [], queued = [], results = Object.create(null);
    var epoch = 0, selection = 0, completedSelection = -1, enabled = false;
    function snapshot() {
      var failures = [], completed = 0;
      wanted.forEach(function(key) {
        if (!results[key]) return;
        completed++;
        if (results[key].error) failures.push({key:key,message:results[key].error});
      });
      return {total:wanted.length,completed:completed,failures:failures,
        activeKeys:Object.keys(active).filter(function(key) { return wanted.indexOf(key) >= 0; }),queued:queued.length};
    }
    function notify() {
      if (!enabled || completedSelection === selection) return;
      var current = selection, progress = snapshot();
      if (options.onProgress) options.onProgress(progress);
      if (current === selection && progress.completed === progress.total && completedSelection !== current) {
        completedSelection = current;
        if (options.onComplete) options.onComplete(progress);
      }
    }
    function pump(skipNotification) {
      while (enabled && queued.length && Object.keys(active).length < 3) start(queued.shift());
      if (!skipNotification) notify();
    }
    function start(key) {
      var entry = {epoch:epoch,request:null};
      active[key] = entry;
      function current() { return enabled && entry.epoch === epoch && active[key] === entry; }
      Promise.resolve().then(function() {
        if (!current()) return null;
        entry.request = options.read(key);
        return entry.request;
      }).then(function(value) {
        if (!current() || wanted.indexOf(key) < 0) return null;
        if (value && value.fields) value = Object.assign({},value,{_activityReadAt:new Date().toISOString()});
        return hydrateComments(key,value,entry,current);
      }).then(function(value) {
        if (!current() || wanted.indexOf(key) < 0) return;
        options.accept(key,value);
        if (wanted.indexOf(key) >= 0) results[key] = {error:value && value.fields && value.fields.comment && value.fields.comment.loadError || ""};
      }).catch(function(error) {
        if (!current() || wanted.indexOf(key) < 0) return;
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
          if (entries.length < total) return page();
          if (value.isLast === false) throw new Error("Последняя страница комментариев не подтверждена");
          result.fields.comment = {startAt:0,total:total,comments:entries};
          return result;
        });
      }
      return Promise.resolve().then(page).catch(function(error) {
        check();
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
      delete active[key];
      if (entry && entry.request && typeof entry.request.abort === "function") {
        try { entry.request.abort(); } catch (ignore) { /* Late responses are isolated by identity. */ }
      }
    }
    function select(keys) {
      selection++; enabled = true; results = Object.create(null);
      var seen = Object.create(null);
      wanted = (keys || []).filter(function(key) {
        if (typeof key !== "string" || !key || seen[key]) return false;
        seen[key] = true; return true;
      });
      Object.keys(active).forEach(function(key) {
        if (!seen[key] && (!active[key].request || typeof active[key].request.abort === "function")) abort(key);
      });
      queued = wanted.filter(function(key) { return !active[key]; });
      pump();
    }
    function cancel() {
      enabled = false; epoch++; selection++; queued = []; wanted = []; results = Object.create(null);
      Object.keys(active).forEach(abort);
    }
    return {select:select,cancel:cancel};
  }
  return {create:create};
});
