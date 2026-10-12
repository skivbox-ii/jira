define("_ujgESI_statusTransition", [], function() {
  "use strict";
  function validKey(key) { return typeof key === "string" && /^[A-Za-z][A-Za-z0-9_]*-[1-9][0-9]*$/.test(key); }
  function validId(id) { return typeof id === "string" && /^[1-9][0-9]*$/.test(id); }
  function object(value) { return !!value && typeof value === "object" && !Array.isArray(value); }
  function transitions(data) {
    if (!data || !Array.isArray(data.transitions)) throw new Error("unknown-transitions");
    var seen = Object.create(null);
    return data.transitions.map(function(t) {
      if (!object(t) || !validId(t.id) || seen[t.id] || typeof t.name !== "string" || !t.name.trim() ||
          !object(t.to) || typeof t.to.name !== "string" || !t.to.name.trim() || !validId(String(t.to.id || ""))) throw new Error("invalid-transition");
      seen[t.id] = true;
      var known = object(t.fields);
      var fields = known ? Object.keys(t.fields).map(function(key) {
        var field = t.fields[key];
        if (!object(field) || typeof field.name !== "string" || !field.name.trim() || typeof field.required !== "boolean") known = false;
        return {name:object(field) && typeof field.name === "string" && field.name.trim() ? field.name : key,required:!!(field && field.required)};
      }) : [];
      return {id:t.id,name:t.name,target:t.to.name,targetId:String(t.to.id),fields:fields,simple:known && !fields.length,
        hint:!known ? "Метаданные полей неполные; откройте карточку Jira" : fields.length ? "Переход требует полей в Jira" : "Без дополнительных полей"};
    });
  }
  function create(options) {
    var api=options.api, generation=0, request=null, identity=null, scope=null;
    var retained=Object.create(null);
    var state={open:false,loading:false,running:false,key:null,transitions:[],selectedId:null,outcome:null,message:""};
    function snapshot() { return JSON.parse(JSON.stringify(state)); }
    function notify() { if (options.onChange) options.onChange(snapshot()); }
    function allowed() { return !options.canOperate || options.canOperate(); }
    function currentScope() { return options.scope ? options.scope() : ""; }
    function active(token) { return state.open && token === generation && scope === currentScope(); }
    function abort() { if (request && typeof request.abort === "function") request.abort(); request=null; }
    function errorMessage(prefix, error) {
      var status=error && error.status;
      return prefix + (typeof status === "number" && status >= 100 && status <= 599 ? " (HTTP " + status + ")" : "");
    }
    function load() {
      if (retained[identity]) return refresh();
      if (!state.open || state.running || !allowed() || scope !== currentScope()) return false;
      abort(); var token=++generation;
      state.loading=true; state.selectedId=null; state.message="Чтение доступных переходов…"; notify();
      try { request=api.getIssueTransitions(state.key); } catch (e) { request=Promise.reject(e); }
      return Promise.resolve(request).then(function(data) {
        if (!active(token)) return;
        state.transitions=transitions(data); state.outcome=state.transitions.length ? "ready" : "empty";
        state.message=state.transitions.length ? "" : "Нет доступных переходов для текущего пользователя";
      }).catch(function(error) {
        if (!active(token)) return;
        state.transitions=[]; state.outcome="load-failed"; state.message=errorMessage("Не удалось прочитать доступные переходы Jira",error);
      }).then(function() { if (active(token)) { request=null; state.loading=false; notify(); } });
    }
    function open(key) {
      if (state.running || !validKey(key) || !allowed()) return false;
      abort(); ++generation; scope=currentScope(); key=key.toUpperCase(); identity=key;
      state={open:true,loading:false,running:false,key:key,transitions:[],selectedId:null,outcome:null,message:""};
      if (retained[identity]) { state.outcome=retained[identity]; state.message=state.outcome === "unconfirmed" ? "Результат записи не подтверждён. Обновите данные или откройте Jira; повторная запись заблокирована" : "Переход выполнен, но обновить данные не удалось. Повторите чтение"; notify(); return Promise.resolve(); }
      return load();
    }
    function close() {
      if (state.running) return false;
      ++generation; abort(); state.open=false; state.loading=false; state.selectedId=null; notify(); return true;
    }
    function select(id) {
      if (!state.open || state.loading || state.running || retained[identity] || scope !== currentScope()) return false;
      if (!state.transitions.some(function(t) { return t.id === id; })) return false;
      state.selectedId=id; notify(); return true;
    }
    function readback(token, uncertain) {
      try { request=api.getIssueWithHistory(state.key); } catch (e) { request=Promise.reject(e); }
      return Promise.resolve(request).then(function(issue) {
        if (!active(token)) return;
        var f=issue && issue.fields;
        if (!validKey(issue && issue.key) || issue.key.toUpperCase() !== state.key || !object(f) || !object(f.status) ||
            typeof f.status.name !== "string" || !f.status.name.trim() ||
            !["assignee","resolution","updated"].every(function(name) { return Object.prototype.hasOwnProperty.call(f,name); }) ||
            !object(issue.changelog) || !Array.isArray(issue.changelog.histories)) throw new Error("incomplete-readback");
        if (options.onSnapshot) options.onSnapshot(issue);
        state.outcome=uncertain ? "unconfirmed" : "success";
        state.message=uncertain ? "Данные обновлены. Результат записи не подтверждён; проверьте карточку Jira. Повторная запись заблокирована" : "Переход выполнен. Данные Jira обновлены";
        if (!uncertain) delete retained[identity];
      }).catch(function(error) {
        if (!active(token)) return;
        state.outcome=uncertain ? "unconfirmed" : "refresh-failed"; retained[identity]=state.outcome;
        state.message=errorMessage(uncertain ? "Результат записи не подтверждён; не удалось обновить данные. Повторите чтение" : "Переход выполнен, но обновить данные не удалось. Повторите чтение",error);
      });
    }
    function refresh() {
      if (!state.open || state.running || state.loading || !allowed() || scope !== currentScope() || !retained[identity]) return false;
      var token=++generation, uncertain=retained[identity] === "unconfirmed";
      state.loading=true; notify();
      return readback(token,uncertain).then(function() { if (active(token)) { request=null; state.loading=false; notify(); } });
    }
    function apply() {
      var chosen=state.transitions.find(function(t) { return t.id === state.selectedId; });
      if (!state.open || state.loading || state.running || !allowed() || scope !== currentScope() || retained[identity] ||
          state.outcome === "success" || !chosen || !chosen.simple) return false;
      var token=generation, key=state.key;
      state.running=true; state.message="Проверка перехода…"; notify();
      try { request=api.getIssueTransitions(key); } catch (e) { request=Promise.reject(e); }
      return Promise.resolve(request).then(function(data) {
        if (!active(token) || !allowed()) return;
        var fresh=transitions(data), now=fresh.find(function(t) { return t.id === chosen.id; });
        state.transitions=fresh;
        if (!now || !now.simple || JSON.stringify(now) !== JSON.stringify(chosen)) {
          state.selectedId=null; state.outcome="changed"; state.message="Переход изменился или недоступен. Выберите переход заново"; return;
        }
        request=null; state.message="Выполнение перехода…"; state.selectedId=null; notify();
        // Persist the uncertain result before invoking POST, including synchronous transport failures.
        retained[identity]="unconfirmed";
        var write;
        try { write=api.transitionIssue(key,chosen.id); } catch (e) { write=Promise.reject(e); }
        return Promise.resolve(write).then(function() {
          retained[identity]="refresh-failed";
          if (active(token)) return readback(token,false);
        },function(error) {
          // Timeouts and unfamiliar proxy responses do not prove the write was rejected.
          var rejected=error && [400,401,403,404,405,409,422].indexOf(error.status) >= 0;
          if (rejected) delete retained[identity];
          if (!active(token)) return;
          state.outcome=rejected ? "rejected" : "unconfirmed";
          state.message=errorMessage(rejected ? "Jira отклонила переход. Выберите переход заново" : "Результат записи не подтверждён. Обновите данные или откройте Jira; повторная запись заблокирована",error);
        });
      }).catch(function(error) {
        if (!active(token)) return;
        state.selectedId=null; state.outcome="load-failed"; state.message=errorMessage("Не удалось проверить доступные переходы Jira",error);
      }).then(function() {
        state.running=false;
        if (active(token)) { request=null; notify(); }
      });
    }
    return {open:open,close:close,select:select,apply:apply,retry:load,refresh:refresh,getState:snapshot};
  }
  return {create:create,validKey:validKey};
});
