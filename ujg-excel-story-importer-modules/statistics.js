define("_ujgESI_statistics", ["_ujgESI_teams"], function(teamsModule) {
  "use strict";
  function text(value) { return value == null ? "" : String(value).trim(); }
  function issueKey(value) { return text(value).toUpperCase(); }
  function parentKey(row) { return issueKey(row.createdKey || row.jiraKey || row.storyDetails && row.storyDetails.key); }
  function uniqueRemarks(rows) {
    var byId = Object.create(null), result = [];
    (rows || []).forEach(function(row, index) {
      if (!row || typeof row !== "object") return;
      var key = parentKey(row), id = key ? "jira:" + key : "source:" + (text(row.id) || index);
      if (byId[id]) {
        byId[id].row.childStatuses = byId[id].row.childStatuses.concat(row.childStatuses || []);
        if (!byId[id].row.storyDetails && row.storyDetails) byId[id].row.storyDetails = row.storyDetails;
        if (row.status === "partial") byId[id].row.status = "partial";
        return;
      }
      var item = {id:id,row:Object.assign({}, row, {childStatuses:(row.childStatuses || []).slice()})};
      byId[id] = item; result.push(item);
    });
    return result;
  }
  function conflictingStatuses(rows) {
    var seen = Object.create(null), conflicts = Object.create(null);
    (rows || []).forEach(function(row) {
      if (!row || typeof row !== "object") return;
      var tasks = (row.childStatuses || []).slice();
      if (row.storyDetails) tasks.push(Object.assign({},row.storyDetails,{key:parentKey(row)}));
      tasks.forEach(function(task) {
        if (!task || task.linkedToParent === false) return;
        var key = issueKey(task.key), value = stage(task);
        if (!key) return;
        if (seen[key] && seen[key] !== value) conflicts[key] = true;
        seen[key] = value;
      });
    });
    return conflicts;
  }
  function tasksFor(row, conflicts) {
    var key = parentKey(row), seen = Object.create(null), tasks = [];
    if (key) {
      seen[key] = true;
      tasks.push(Object.assign({}, row.storyDetails || {}, {key:key,isParent:true}));
    }
    (row.childStatuses || []).forEach(function(child, index) {
      if (!child || child.linkedToParent === false) return;
      var key = issueKey(child.key);
      if (key && seen[key]) return;
      if (key) seen[key] = true;
      tasks.push(Object.assign({}, child, {key:key,isParent:false,missingKey:!key,sourceIndex:index}));
    });
    // Contradictory snapshots cannot establish completion or team workload.
    return tasks.map(function(task) {
      return conflicts[task.key] ? Object.assign({},task,{status:"Unknown",done:false,statusCategory:"",statusState:""}) : task;
    });
  }
  function stage(task) {
    var kind = teamsModule.statusKind(task);
    if (kind === "done" || kind === "cancelled" || kind === "unknown" || kind === "testing") return kind;
    if (task.statusState === "todo" || task.statusCategory === "new" || /^(open|new|to do|todo|backlog|выдано|новая|новый|открыт[ао]?|к выполнению)$/i.test(text(task.status))) return "waiting";
    return "progress";
  }
  function isOpen(task) { return ["done","cancelled","unknown"].indexOf(teamsModule.statusKind(task)) < 0; }
  function outcome(row, tasks) {
    if (!parentKey(row)) return "uncreated";
    if (!row.storyDetails || row.status === "partial" || (row.childStatuses || []).some(function(child) { return child && child.linkedToParent === false; }) || tasks.some(function(task) { return task.missingKey || stage(task) === "unknown"; })) return "incomplete";
    if (tasks.every(function(task) { return stage(task) === "done"; })) return "ready";
    if (tasks.every(function(task) { return ["done","cancelled"].indexOf(stage(task)) >= 0; })) return "cancelled";
    return "open";
  }
  function bucket(key, label, color) {
    return {key:key,label:label,color:color || "",remarks:0,tasks:0,open:0,progress:0,testing:0,waiting:0,done:0,cancelled:0,unknown:0,remarkIds:Object.create(null),taskIds:Object.create(null)};
  }
  function add(target, remarkId, task) {
    if (!target.remarkIds[remarkId]) { target.remarkIds[remarkId] = true; target.remarks++; }
    var id = task.key || remarkId + ":missing:" + task.sourceIndex;
    if (target.taskIds[id]) return;
    target.taskIds[id] = true; target.tasks++;
    var status = stage(task);
    target[status]++;
    if (isOpen(task)) target.open++;
  }
  function finish(value) {
    var out = Object.assign({},value); delete out.remarkIds; delete out.taskIds; return out;
  }
  function summarize(sourceRows, inputTeams) {
    var teams = teamsModule.normalize(inputTeams), remarks = uniqueRemarks(sourceRows), conflicts = conflictingStatuses(sourceRows);
    var outcomes = [
      {key:"ready",label:"Готово по всем тикетам",count:0},
      {key:"open",label:"Есть открытые работы",count:0},
      {key:"cancelled",label:"Закрыто с отменёнными задачами",count:0},
      {key:"incomplete",label:"Неполные данные",count:0},
      {key:"uncreated",label:"Не заведено в Jira",count:0}
    ];
    var teamRows = teams.map(function(team) { return bucket(team.id,team.name,team.color); });
    var noTeam = bucket("__unassigned","Без команды"), roles = Object.create(null);
    var directions = teamsModule.directions.map(function(direction) { return bucket(direction.id,direction.label); });
    var noDirection = bucket("__unknown","Направление не определено");
    remarks.forEach(function(item) {
      var row = item.row, tasks = tasksFor(row,conflicts), result = outcome(row,tasks);
      outcomes.filter(function(value) { return value.key === result; })[0].count++;
      var currentRow = Object.assign({},row,{storyDetails:row.storyDetails ? tasks.filter(function(task) { return task.isParent; })[0] : null,childStatuses:tasks.filter(function(task) { return !task.isParent; })});
      var current = teamsModule.currentWork(currentRow,teams), currentKeys = Object.create(null);
      current.groups.forEach(function(group) {
        var target = directions.filter(function(value) { return value.key === group.direction; })[0];
        group.tasks.forEach(function(task) {
          var key = issueKey(task.key); currentKeys[key] = true;
          var original = tasks.filter(function(value) { return value.key === key; })[0];
          if (target && original) add(target,item.id,original);
        });
      });
      tasks.forEach(function(task) {
        var role = task.isParent ? "__story" : text(task.role).toUpperCase() || "__none";
        if (!roles[role]) roles[role] = bucket(role,task.isParent ? "История" : role === "__none" ? "Без роли" : role);
        add(roles[role],item.id,task);
        if (!isOpen(task)) return;
        // A generic parent is a coordinator, not another team's active child task.
        if (task.isParent && tasks.length > 1 && !currentKeys[task.key]) return;
        var owners = teamsModule.forUser(teams,task.assigneeIdentifiers);
        if (!owners.length) owners = teamsModule.forRole(teams,task.role);
        if (!owners.length) add(noTeam,item.id,task);
        owners.forEach(function(team) { add(teamRows.filter(function(value) { return value.key === team.id; })[0],item.id,task); });
      });
      if (result === "open" && !current.groups.length) {
        var openTask = tasks.filter(isOpen)[0];
        if (openTask) add(noDirection,item.id,openTask);
      }
    });
    if (noTeam.tasks) teamRows.push(noTeam);
    if (noDirection.remarks) directions.push(noDirection);
    return {total:remarks.length,sourceRows:(sourceRows || []).length,outcomes:outcomes,directions:directions.map(finish),teams:teamRows.map(finish),roles:Object.keys(roles).sort().map(function(key) { return finish(roles[key]); })};
  }
  return {summarize:summarize};
});
