(function() {
  "use strict";
  var sample=JSON.parse(JSON.stringify(Object.values(fixtureIssues)[0]));
  var linkType=JSON.parse(JSON.stringify(sample.fields.issuelinks[0].type));
  var now=new Date(), changed=new Date(now.getTime()-60000).toISOString();
  var created=new Date(now.getTime()-86400000).toISOString();
  Object.keys(fixtureIssues).forEach(function(key) {delete fixtureIssues[key];});
  window.fixtureNow=now.toISOString();
  function add(number,status,isStory,children) {
    var key="EVOSCADA-"+number, issue=JSON.parse(JSON.stringify(sample));
    var done=status==="Готово", id=done?"3":"1";
    issue.key=key; issue.fields.summary=number+". "+(isStory?"Замечание":"Связанная задача")+" — "+status;
    issue.fields.issuetype={name:isStory?"История":"Задача"};
    issue.fields.status={id:id,name:status,statusCategory:{key:done?"done":"new"}};
    issue.fields.created=created;issue.fields.updated=changed;
    issue.fields.resolution=done||status==="Повторно выдано"?{name:"Fixed"}:null;
    issue.fields.resolutiondate=issue.fields.resolution?changed:null;
    issue.fields.comment={startAt:0,total:0,comments:[]};
    issue.fields.worklog={startAt:0,total:0,worklogs:[]};
    issue.fields.issuelinks=(children||[]).map(function(child) {return {type:linkType,outwardIssue:{key:"EVOSCADA-"+child}};});
    issue.changelog={startAt:0,total:1,histories:[{id:key+"-change",created:changed,author:{name:"tester",displayName:"Тестировщик"},
      items:[{field:"status",from:"0",fromString:"Новая",to:id,toString:status}]}]};
    fixtureIssues[key]=issue;
  }
  add(101,"Готово",true,[201,202]);add(102,"К выполнению",true,[202,203]);
  add(103,"Повторно выдано",true,[204]);add(104,"Готово",true,[]);
  add(201,"К выполнению",false);add(202,"К выполнению",false);
  add(203,"Готово",false);add(204,"Готово",false);
  Object.values(fixtureIssues).forEach(function(issue) {(issue.fields.issuelinks||[]).forEach(function(link) {
    link.outwardIssue.fields={summary:fixtureIssues[link.outwardIssue.key].fields.summary,status:fixtureIssues[link.outwardIssue.key].fields.status,issuetype:{name:"Задача"}};
  });});
  fixtureIssues["EVOSCADA-101"].fields.comment={startAt:0,total:1,comments:[{id:"ready-comment",body:"Комментарий к готовому замечанию: проверка сохранена.",
    created:changed,updated:changed,author:{name:"tester",displayName:"Тестировщик"}}]};
  if (!new URLSearchParams(location.search).has("historyDelay")) progressiveFixture.historyDelay=10;
  window.filteredHistoryFixture={all:[101,102,103,104,201,202,203,204].map(function(n){return "EVOSCADA-"+n;}),
    visible:[102,103,202].map(function(n){return "EVOSCADA-"+n;})};
})();
