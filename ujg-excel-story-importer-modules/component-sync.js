define("_ujgESI_componentSync", [], function() {
  "use strict";
  var own = Object.prototype.hasOwnProperty;
  function clean(value) { return value == null ? "" : String(value).trim(); }
  function keyOk(key) { return /^[A-Za-z][A-Za-z0-9_]*-[1-9][0-9]*$/.test(key); }
  function idOk(id) { return /^[1-9][0-9]*$/.test(clean(id)); }
  function normalized(value) { return clean(value).replace(/\s+/g," ").toLocaleLowerCase(); }
  function idsEqual(a,b) { return a.length === b.length && a.every(function(id,i) { return id === b[i]; }); }
  function queue(items, limit, task, active) {
    var next = 0;
    function worker() {
      if (!active() || next >= items.length) return Promise.resolve();
      var item = items[next++];
      return Promise.resolve().then(function() { return task(item); }).then(worker);
    }
    var workers=[];
    for (var i=0;i<Math.min(limit,items.length);i++) workers.push(worker());
    return Promise.all(workers);
  }
  function create(options) {
    options = options || {};
    var api = options.api, changed = options.onChange || function() {}, updated = options.onUpdated || function() {};
    var generation = 0, project = "", catalog = new Map();
    var state = {open:false,loading:false,running:false,rows:[],error:null,completed:0,total:0};
    function snapshot() { return {open:state.open,loading:state.loading,running:state.running,error:state.error,
      completed:state.completed,total:state.total,rows:state.rows.map(function(row) { return {
        id:row.id,key:row.key,remarkId:row.remarkId,summary:row.summary,sourceRaw:row.sourceRaw,
        oldComponents:row.oldComponents && row.oldComponents.slice(),newComponents:row.newComponents && row.newComponents.slice(),
        eligible:row.eligible,selected:row.selected,status:row.status,message:row.message}; })}; }
    function notify() { changed(snapshot()); }
    function resolveMapping(raw,map) {
      var desired = "", seen = false, ambiguous = false, source = normalized(raw);
      Object.keys(map || {}).forEach(function(name) {
        if (normalized(name) !== source) return;
        var candidate=clean(map[name]);
        if (seen && normalized(desired) !== normalized(candidate)) ambiguous=true;
        else if (!seen) desired=candidate;
        seen=true;
      });
      return {desired:desired,ambiguous:ambiguous};
    }
    function current(issue,key) {
      if (!issue || !keyOk(clean(issue.key)) || clean(issue.key).toUpperCase() !== key.toUpperCase() ||
          !issue.fields || !issue.fields.project || clean(issue.fields.project.key).toUpperCase() !== project.toUpperCase() ||
          !issue.fields.issuetype || ["story","история"].indexOf(normalized(issue.fields.issuetype.name)) < 0 ||
          !own.call(issue.fields,"components") || !Array.isArray(issue.fields.components)) throw new Error("unknown-issue");
      var components = issue.fields.components;
      if (!components.every(function(c) { return c && idOk(c.id) && clean(c.name); })) throw new Error("unknown-components");
      return {ids:Array.from(new Set(components.map(function(c) { return clean(c.id); }))).sort(),
        names:components.map(function(c) { return clean(c.name); })};
    }
    function open(rows,settings) {
      if (state.running) return false;
      var token=++generation, opts=settings || {}, map=Object.assign({},opts.moduleComponentMap || {}), grouped=new Map(), used=new Set();
      project=clean(opts.projectKey).toUpperCase(); catalog=new Map();
      var plan=[];
      (Array.isArray(rows)?rows:[]).forEach(function(source,index) {
        var key=clean(source && (source.createdKey || source.jiraKey)).toUpperCase();
        var columns=source && source.sourceColumns || {}, raw=clean(columns["Модуль"]), mapping=resolveMapping(raw,map), desired=mapping.desired;
        var id=source && source.id != null ? String(source.id) : "component-row-"+(index+1), base=id, suffix=2;
        while (used.has(id)) id=base+"-"+suffix++;
        used.add(id);
        var item={id:id,key:key,remarkId:source && source.remarkId || clean(columns["№"] || columns.ID),
          summary:clean(source && source.summary),sourceRaw:raw,sourceModule:normalized(raw),desiredName:desired,desiredId:"",oldIds:[],oldComponents:null,
          newComponents:desired?[desired]:[],eligible:false,selected:false,status:"skipped",message:""};
        if (!keyOk(key) || key.split("-")[0] !== project) item.message="Ключ не относится к выбранному проекту";
        else if (!raw) item.message="Модуль Excel пуст";
        else if (mapping.ambiguous) {item.status="conflict";item.message="Неоднозначное сопоставление модуля";}
        else if (!desired) item.message="Модуль не сопоставлен с компонентом";
        else item.status="loading";
        if (keyOk(key) && key.split("-")[0] === project) {
          if (grouped.has(key)) {
            var first=grouped.get(key);
            if (first.sourceModule !== item.sourceModule || normalized(first.desiredName) !== normalized(item.desiredName) ||
                first.status !== "loading" || item.status !== "loading") {
              first.status="conflict";first.message="Противоречивые модули Excel";first.eligible=false;first.selected=false;
            }
            first.sourceRaw=[first.sourceRaw,raw].filter(Boolean).join("; ");
            return;
          }
          grouped.set(key,item);
        }
        plan.push(item);
      });
      state={open:true,loading:true,running:false,rows:plan,error:null,completed:0,total:plan.length};notify();
      return Promise.resolve().then(function() { return api.getProjectComponents(project); }).then(function(data) {
        if (token !== generation) return;
        if (!Array.isArray(data)) throw new Error("catalog");
        data.forEach(function(c) { if (c && idOk(c.id) && clean(c.name)) {
          var name=normalized(c.name);if (!catalog.has(name)) catalog.set(name,[]);
          catalog.get(name).push({id:clean(c.id),name:clean(c.name)});
        }});
        plan.forEach(function(item) { if (item.status !== "loading") return;
          var matches=catalog.get(normalized(item.desiredName)) || [];
          if (matches.length !== 1) {item.status="skipped";item.message="Компонент недоступен в проекте";}
          else {item.desiredId=matches[0].id;item.newComponents=[matches[0].name];}
        });
        var previewDone=0;
        function previewNotify() { if (++previewDone % 10 === 0) notify(); }
        return queue(plan.filter(function(item){return item.status==="loading";}),3,function(item) {
          return Promise.resolve().then(function(){return api.getIssueComponents(item.key);}).then(function(issue) {
            if (token !== generation) return;
            var old=current(issue,item.key);item.oldIds=old.ids;item.oldComponents=old.names;
            if (idsEqual(old.ids,[item.desiredId])) {item.status="skipped";item.message="Компонент уже совпадает";}
            else {item.status="ready";item.message="";item.eligible=true;item.selected=true;}
            previewNotify();
          }).catch(function(){if(token===generation){item.status="skipped";item.message="Компоненты или тип задачи Jira неизвестны";previewNotify();}});
        },function(){return token===generation;});
      }).catch(function(){if(token===generation){state.error="Не удалось загрузить компоненты проекта Jira";plan.forEach(function(item){if(item.status==="loading"){item.status="skipped";item.message="Справочник компонентов недоступен";}});}}).then(function(){
        if(token!==generation)return;state.loading=false;notify();return snapshot();
      });
    }
    function close() {if(state.running)return false;++generation;state.open=false;state.loading=false;state.rows=[];state.error=null;state.total=0;state.completed=0;notify();return true;}
    function select(id,yes) {if(!state.open||state.loading||state.running)return false;var item=state.rows.find(function(r){return r.id===String(id);});if(!item||!item.eligible)return false;item.selected=!!yes;notify();return true;}
    function selectAll(yes) {if(!state.open||state.loading||state.running)return false;state.rows.forEach(function(r){if(r.eligible)r.selected=!!yes;});notify();return true;}
    function confirm() {
      if(!state.open||state.loading||state.running)return false;
      var chosen=state.rows.filter(function(r){return r.eligible&&r.selected;});if(!chosen.length)return false;
      var token=generation;state.running=true;state.completed=0;state.total=chosen.length;notify();
      return Promise.resolve().then(function(){return api.getProjectComponents(project);}).then(function(data){
        if (!Array.isArray(data)) throw new Error("catalog");
        var fresh=new Map();
        data.forEach(function(c){if(c&&idOk(c.id)&&clean(c.name)){
          var name=normalized(c.name);if(!fresh.has(name))fresh.set(name,[]);
          fresh.get(name).push(clean(c.id));
        }});
        catalog.forEach(function(matches,name){
          if (!fresh.has(name) || fresh.get(name).length !== 1 || matches.length !== 1 || fresh.get(name)[0] !== matches[0].id) catalog.delete(name);
        });
      }).catch(function(){catalog.clear();}).then(function(){return queue(chosen,2,function(item){
        item.status="updating";item.selected=false;notify();
        return Promise.resolve().then(function(){return api.getIssueComponents(item.key);}).then(function(issue){
          if(token!==generation)return;
          var matches=catalog.get(normalized(item.desiredName)) || [];
          if(matches.length!==1||matches[0].id!==item.desiredId) {item.status="conflict";item.eligible=false;item.message="Компонент изменился после просмотра";return;}
          var now=current(issue,item.key);
          if(idsEqual(now.ids,[item.desiredId])) {item.status="skipped";item.eligible=false;item.message="Компонент уже установлен";return;}
          if(!idsEqual(now.ids,item.oldIds)) {item.status="conflict";item.eligible=false;item.message="Компоненты Jira изменились после просмотра";return;}
          return Promise.resolve().then(function(){return api.updateIssueComponents(item.key,[item.desiredId]);}).then(function(){
            item.status="updated";item.eligible=false;item.message="Обновлено";
            try {updated(item.key,{id:item.desiredId,name:item.newComponents[0]});} catch (_) {}
          },function(error){
            var status=error&&Number(error.status);item.status=status>=400&&status<500?"error":"unconfirmed";
            item.eligible=false;item.message=item.status==="error"?"Jira отклонила обновление":"Результат записи не подтверждён";
          });
        }).catch(function(){item.status="error";item.eligible=false;item.message="Не удалось проверить компоненты Jira";}).then(function(){state.completed++;notify();});
      },function(){return token===generation;});}).then(function(){state.running=false;notify();return snapshot();});
    }
    return {open:open,close:close,select:select,selectAll:selectAll,confirm:confirm,getState:snapshot};
  }
  return {create:create};
});
