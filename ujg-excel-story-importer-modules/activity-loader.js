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
        if (!current() || wanted.indexOf(key) < 0) return;
        options.accept(key,value);
        if (wanted.indexOf(key) >= 0) results[key] = {};
      }).catch(function(error) {
        if (!current() || wanted.indexOf(key) < 0) return;
        results[key] = {error:options.errorText ? options.errorText(error) : String(error && (error.message || error.statusText) || error)};
      }).then(function() {
        if (!current()) return;
        delete active[key];
        pump(wanted.indexOf(key) < 0 && !queued.length);
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
