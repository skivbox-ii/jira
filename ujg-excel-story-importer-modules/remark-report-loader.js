define("_ujgESI_remarkReportLoader", [], function() {
  "use strict";
  function key(value) { return String(value || "").trim().toUpperCase(); }
  function validKey(value) { return /^[A-Z][A-Z0-9_]*-\d+$/.test(value); }
  function complete(envelope, field) {
    if (!envelope || envelope.startAt !== 0 || !/^\d+$/.test(String(envelope.total)) || !Array.isArray(envelope[field]) || Number(envelope.total) !== envelope[field].length || envelope.isLast === false) return false;
    var seen = Object.create(null);
    return envelope[field].every(function(item) { var id = String(item && item.id || ""); if (!id || seen[id]) return false; seen[id] = true; return true; });
  }
  function sameComments(captured, current) {
    if (!complete(captured,"comments") || !current || current.total !== captured.total || !Array.isArray(current.comments)) return false;
    var byId = Object.create(null), seen = Object.create(null);
    function revision(comment) {
      var author = comment.author || {};
      return JSON.stringify([comment.body,comment.created,comment.updated,author.accountId || author.key || author.name]);
    }
    captured.comments.forEach(function(comment) { byId[String(comment.id)] = revision(comment); });
    return current.comments.every(function(comment) {
      var id = String(comment && comment.id || "");
      if (!id || seen[id] || byId[id] !== revision(comment)) return false;
      seen[id] = true; return true;
    });
  }
  function create(deps) {
    function load(inputKey, options) {
      options = options || {};
      var original = key(inputKey), warnings = [], children = [], startedAt = new Date().toISOString();
      function check() { if (options.isCancelled && options.isCancelled()) throw new Error("Загрузка отменена"); }
      function progress(phase, issueKey, completed, total) {
        check();
        if (options.onProgress) options.onProgress({phase:phase,key:issueKey,completed:completed,total:total});
      }
      function readIssue(issueKey) {
        check();
        return Promise.resolve().then(function() { check(); return deps.readIssue(issueKey); }).then(function(issue) {
          check();
          if (!issue || key(issue.key) !== issueKey || !issue.fields) throw new Error("Ответ Jira не соответствует задаче " + issueKey);
          return JSON.parse(JSON.stringify(issue));
        });
      }
      function entries(issue, field, member, read) {
        var initial = issue.fields[field];
        progress(member === "comments" ? "comments" : "worklogs", issue.key);
        if (complete(initial,member)) return Promise.resolve();
        var result = [], seen = Object.create(null), total = null, pages = 0;
        function page() {
          check();
          if (typeof read !== "function" || ++pages > 500) return Promise.reject(new Error("Список не загружен полностью"));
          return Promise.resolve().then(function() { check(); return read(issue.key,result.length); }).then(function(value) {
            check();
            if (!value || value.startAt !== result.length || !/^\d+$/.test(String(value.total)) || !Array.isArray(value[member])) throw new Error("Некорректная страница");
            if (total === null) total = Number(value.total);
            if (initial && /^\d+$/.test(String(initial.total)) && Number(initial.total)!==total) throw new Error("Список изменился после чтения задачи");
            if (total !== Number(value.total)) throw new Error("Список изменился во время чтения");
            var batch = value[member];
            if (result.length + batch.length > total || !batch.length && result.length < total) throw new Error("Страница неполна");
            batch.forEach(function(item) {
              var id = String(item && item.id || "");
              if (!id || seen[id]) throw new Error("Повторная запись");
              seen[id] = true; result.push(item);
            });
            if (result.length < total) return page();
            if (value.isLast === false) throw new Error("Последняя страница не подтверждена");
            var envelope = {startAt:0,total:total,maxResults:total}; envelope[member] = result;
            issue.fields[field] = envelope;
          });
        }
        return page().catch(function() {
          check();
          if (member === "comments") warnings.push(issue.key + ": не удалось подтвердить полный список комментариев. Обновите данные вручную.");
          // Missing worklogs remain unknown; they do not invalidate the narrative evidence.
        });
      }
      function hydrate(issue) {
        return entries(issue,"comment","comments",deps.readComments).then(function() {
          return entries(issue,"worklog","worklogs",deps.readWorklogs);
        }).then(function() { return issue; });
      }
      function verify(issue, current) {
        if (!issue.fields.updated || current.fields.updated !== issue.fields.updated) warnings.push(issue.key + ": задача изменилась во время загрузки. Обновите данные вручную.");
        if (!sameComments(issue.fields.comment,current.fields.comment)) warnings.push(issue.key + ": комментарии изменились или их актуальность не подтверждена. Обновите данные вручную.");
      }
      return Promise.resolve().then(function() {
        check();
        if (!validKey(original)) throw new Error("Некорректный ключ истории");
        progress("story",original,0,1);
        return readIssue(original);
      }).then(function(parent) {
        var keys = [], seen = Object.create(null);
        (deps.children(parent) || []).forEach(function(value) {
          var child = key(value);
          if (!validKey(child) || child === original) { warnings.push(original + ": некорректная дочерняя связь"); return; }
          if (!seen[child]) { keys.push(child); seen[child] = true; }
        });
        return hydrate(parent).then(function() {
          var chain = Promise.resolve();
          keys.forEach(function(childKey,index) {
            chain = chain.then(function() {
              progress("tasks",childKey,index,keys.length);
              return readIssue(childKey).then(hydrate).then(function(issue) {
                children.push(issue);
              }).catch(function() {
                check(); warnings.push(childKey + ": задача или её история недоступна. Полный разбор невозможен.");
              });
            });
          });
          return chain;
        }).then(function() {
          var chain = Promise.resolve();
          children.forEach(function(issue,index) {
            chain = chain.then(function() {
              progress("verify",issue.key,index,children.length);
              return readIssue(issue.key).then(function(current) { verify(issue,current); }).catch(function() {
                check(); warnings.push(issue.key + ": не удалось проверить актуальность задачи.");
              });
            });
          });
          return chain;
        }).then(function() {
          progress("verify",original,keys.length,keys.length);
          return readIssue(original).then(function(current) {
            verify(parent,current);
            var latestKeys = (deps.children(current) || []).map(key).sort();
            if (!parent.fields.updated || current.fields.updated !== parent.fields.updated || JSON.stringify(latestKeys) !== JSON.stringify(keys.slice().sort())) {
              warnings.push(original + ": история или связи изменились во время загрузки. Обновите данные вручную.");
            }
          }).catch(function() { check(); warnings.push(original + ": не удалось проверить актуальность истории и связей."); });
        }).then(function() {
          check();
          return {parent:parent,children:children,warnings:warnings,startedAt:startedAt,asOf:new Date().toISOString()};
        });
      });
    }
    return {load:load};
  }
  return {create:create};
});
