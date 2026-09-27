const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const load = require("../helpers/load-amd-module");
const dir = path.join(__dirname,"../../ujg-excel-story-importer-modules");
const teamsModule = load(path.join(dir,"teams.js"),{});
const activity = load(path.join(dir,"activity.js"),{
  _ujgESI_teams:teamsModule,
  _ujgESI_remarkId:load(path.join(dir,"remark-id.js"),{}),
  _ujgESI_deadlines:load(path.join(dir,"deadlines.js"),{_ujgESI_config:load(path.join(dir,"config.js"),{})})
},{URL});
const {createPerformanceFixture} = require("./import-performance-fixture.cjs");
const {spawn} = require("node:child_process");

for (const remarks of [250,500]) test(`performance fixture (${remarks} remarks) has complete histories and exact activity events`, () => {
  const fixture = createPerformanceFixture({latestDate:"2026-09-27",remarks});
  assert.equal(fixture.parents.length,remarks);
  assert.equal(Object.keys(fixture.issues).length,remarks*4);
  assert.deepEqual(fixture.dates,["2026-09-25","2026-09-26","2026-09-27"]);
  const histories=Object.values(fixture.issues).flatMap(issue=>issue.changelog.histories);
  assert.ok(histories.some(history=>history.items.length>1),"One Jira history carries several fields at the same minute");
  const fields=new Set(histories.flatMap(history=>history.items.map(item=>item.field)));
  for(const field of ["status","assignee","description","timeestimate","timespent"])assert.ok(fields.has(field),field);
  assert.ok(histories.flatMap(history=>history.items).some(item=>item.field==="status"&&item.fromString==="Готово"&&item.toString!=="Готово"),"Completed work reopens");
  const rows = fixture.parents.map(parent => {
    const detail = issue => {
      const snapshot = activity.capture(issue);
      assert.equal(snapshot.complete,true,`${issue.key}: ${snapshot.warnings.join("; ")}`);
      snapshot.capturedAt = fixture.now;
      return {key:issue.key,summary:issue.fields.summary,role:issue.fields.issuetype.name === "История" ? "" : issue.fields.summary.match(/^\[([^\]]+)\]/)[1],
        components:issue.fields.components,componentsKnown:true,activity:snapshot};
    };
    return {jiraKey:parent.key,summary:parent.fields.summary,storyDetails:detail(parent),
      childStatuses:parent.fields.issuelinks.map(link => detail(fixture.issues[link.outwardIssue.key]))};
  });
  for (const date of fixture.dates) {
    const raw = Object.values(fixture.issues).flatMap(issue => issue.changelog.histories.flatMap(history =>
      history.created.startsWith(date) ? history.items.map((_,index) => `${issue.key}:${history.id}:${index}`) : []));
    assert.equal(raw.length,fixture.expected[date].count);
    assert.deepEqual(raw.sort(),fixture.expected[date].ids.slice().sort());
    const report = activity.summarize(rows,fixture.teams,{date,now:fixture.now});
    assert.equal(report.coverage.isComplete,true,`${date}: ${report.coverage.warnings.join("; ")}`);
    assert.equal(report.coverage.complete,remarks*4);
    assert.equal(report.confirmed.remarks,remarks);
    assert.equal(report.events.length,fixture.expected[date].count);
    assert.deepEqual(Array.from(report.events,event => event.id).sort(),fixture.expected[date].ids.slice().sort());
  }
});

test("performance URL selects only the stress fixture and preserves ordinary preview", async t => {
  const server=spawn(process.execPath,[path.join(__dirname,"import-preview-server.cjs")],{
    env:{...process.env,PORT:"0",IMPORT_PERFORMANCE_DATE:"2026-09-27"},stdio:["ignore","pipe","pipe"]
  });
  t.after(()=>server.kill());
  const origin=await new Promise((resolve,reject)=>{
    server.stdout.on("data",chunk=>{
      const match=chunk.toString().match(/Offline import preview: (http:\/\/127\.0\.0\.1:\d+)/);
      if(match) resolve(match[1]);
    });
    server.once("error",reject);server.once("exit",code=>reject(new Error(`Server exited ${code}`)));
  });
  const normal=await (await fetch(origin+"/")).text();
  const preflight=await (await fetch(origin+"/?preflight")).text();
  const perf=await (await fetch(origin+"/?performance")).text();
  assert.equal(preflight,normal);
  assert.match(normal,/src="\/test\/fixture.js"/);
  assert.doesNotMatch(normal,/src="\/test\/performance-fixture.js"/);
  assert.match(perf,/src="\/test\/performance-fixture.js"/);
  const context={window:{}};
  const response=await fetch(origin+"/test/performance-fixture.js");
  assert.equal(response.status,200);
  require("node:vm").runInNewContext(await response.text(),context);
  assert.equal(Object.keys(context.window.fixtureIssues).length,1000);
  assert.equal(context.window.fixtureExpected["2026-09-27"].count,1100);
  assert.equal(context.window.fixtureNow,"2026-09-27T18:00:00+03:00");
});
