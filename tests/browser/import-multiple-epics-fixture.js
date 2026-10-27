(function() {
  "use strict";
  if (!window.progressiveFixture) throw new Error("Multi-epic fixture requires progressive transport");
  var epicField=modules._ujgESI_config.EPIC_LINK_FIELD;
  var epics=[{key:"EVOSCADA-100",fields:{summary:"Замечания ИИ"}},
    {key:"EVOSCADA-200",fields:{summary:"Замечания ОЭ"}},
    {key:"EVOSCADA-300",fields:{summary:"Другой этап"}}];
  var stories=Object.values(fixtureIssues).filter(function(issue) {return issue.fields.issuetype.name === "История";});
  stories.forEach(function(issue,index) {issue.fields[epicField]=epics[index % epics.length].key;});
  // A shared child must appear under both stories, but be fetched/enriched once.
  var shared=stories[0].fields.issuelinks[0];
  stories[1].fields.issuelinks.push(JSON.parse(JSON.stringify(shared)));
  window.multiEpicFixture={epics:epics,sharedChild:shared.outwardIssue.key,stories:stories.map(function(issue) {
    return {key:issue.key,epic:issue.fields[epicField]};
  })};
  offlineApi.getProjectEpics=function() {return Promise.resolve({issues:epics});};
  progressiveFixture.historyDelay=1;
  progressiveFixture.selectIssues=function(payload,all) {
    if (/\bkey in\s*\(/i.test(payload.jql || "")) return all;
    var scope=/(?:cf\[10109\]|"Epic Link"|customfield_10109)\s*(?:in\s*\(([^)]+)\)|=\s*("[^"]+"|[\w-]+))/i.exec(payload.jql || "");
    if (!scope) return all;
    var keys=(scope[1] || scope[2]).split(",").map(function(key) {return key.trim().replace(/^"|"$/g,"");});
    return all.filter(function(issue) {return keys.indexOf(issue.fields[epicField]) >= 0;});
  };
})();
