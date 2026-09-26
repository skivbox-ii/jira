const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const loadAmdModule = require("./helpers/load-amd-module");
const MODULE_DIR = path.join(__dirname, "..", "ujg-excel-story-importer-modules");
const flush = () => new Promise(resolve => setTimeout(resolve, 0));
const plain = value => JSON.parse(JSON.stringify(value));

async function loadImporter(rows, api, creatorOverride, patcherOverride) {
  const config = loadAmdModule(path.join(MODULE_DIR, "config.js"), {});
  const description = loadAmdModule(path.join(MODULE_DIR, "description.js"), {});
  const creator = loadAmdModule(path.join(MODULE_DIR, "creator.js"), {
    _ujgESI_config: config, _ujgESI_description: description,
    _ujgESI_remarkId: loadAmdModule(path.join(MODULE_DIR, "remark-id.js"), {}),
  });
  const app = {};
  const Gadget = loadAmdModule(path.join(MODULE_DIR, "main.js"), {
    jquery: () => ({ length: 0 }),
    _ujgESI_config: config,
    _ujgESI_api: Object.assign({
      getProjects: () => Promise.resolve([{ key: "TEST", name: "Test" }]),
      getProjectEpics: () => Promise.resolve({ issues: [] }),
      getProjectCreateMeta: () => Promise.resolve({ projects: [] }),
    }, api),
    "_ujgESI_excel-loader": {
      readFileBuffer: () => Promise.resolve(new ArrayBuffer(1)),
      readWorkbookFromBuffer: () => Promise.resolve({ SheetNames: ["Sheet1"] }),
    },
    _ujgESI_parser: { parseWorkbook: () => ({ sheetName: "Sheet1", rows }) },
    _ujgESI_creator: creatorOverride || creator,
    _ujgESI_mappingStore: null,
    _ujgESI_xlsxPatcher: patcherOverride || { patchWorkbook: () => Promise.resolve(new ArrayBuffer(1)) },
    _ujgESI_rendering: {
      init: (_container, callbacks) => { app.callbacks = callbacks; },
      render: state => { app.state = state; },
    },
    _ujgESI_teams: null,
    _ujgESI_dueDateSync: null, _ujgESI_activity: { capture: issue => ({ key: issue.key, capturedAt:new Date().toISOString(), complete: !!issue.changelog && issue.changelog.total === issue.changelog.histories.length, histories: issue.changelog && issue.changelog.histories }) },
    _ujgShared_llmClient: null,
  });
  new Gadget({ getGadgetContentEl: () => ({ find: () => ({ length: 1 }) }), resize() {} });
  await flush();
  app.callbacks.onFileChange({ name: "test.xlsx" });
  await flush();
  await flush();
  return app;
}

function history(created, to, toString, from, fromString) {
  return { created, items: [{ field: "status", to, toString, from, fromString }] };
}

function parentPriorityIssue(key) {
  return { key, fields: { priority: { name: "High" } } };
}

test("project change loads component options", async function () {
  const app = await loadImporter([], {
    getProjectComponents: key => {
      assert.equal(key, "TEST");
      return Promise.resolve([{ id: "1", name: "X" }]);
    },
  });
  app.callbacks.onProjectChange("TEST");
  await flush();
  assert.equal(app.state.componentsLoaded, true);
  assert.deepEqual(plain(app.state.componentOptions), [{ id: "1", name: "X" }]);
});

test("late component response from prior project cannot replace current options", async function () {
  let resolveTest;
  const app = await loadImporter([], {
    getProjectComponents: key => key === "TEST"
      ? new Promise(resolve => { resolveTest = resolve; })
      : Promise.resolve([{ id: "2", name: "Other" }]),
  });
  app.callbacks.onProjectChange("TEST");
  app.callbacks.onProjectChange("OTHER");
  await flush();
  assert.equal(app.state.componentsLoaded, true);
  assert.deepEqual(plain(app.state.componentOptions), [{ id: "2", name: "Other" }]);
  resolveTest([{ id: "1", name: "X" }]);
  await flush();
  assert.deepEqual(plain(app.state.componentOptions), [{ id: "2", name: "Other" }]);
});

test("opening Dynamics refreshes the scope on entry while retaining Excel rows", async () => {
  const calls=[];
  const excel=[{jiraKey:"TEST-10",summary:"Excel source",sourceColumns:{}}];
  const app=await loadImporter(excel,{
    getProjectIssues:(project,epic)=>{calls.push([project,epic]);return Promise.resolve({issues:[]});},
    getIssuesByKeys:()=>Promise.resolve({issues:[]})
  });
  app.callbacks.onProjectChange("TEST");
  app.callbacks.onReportViewChange("activity");
  assert.equal(app.state.viewMode,"jira");
  assert.equal(app.state.deadlineJournalRows[0].jiraKey,"TEST-10");
  assert.equal(app.state.reportView,"activity");
  await flush();await flush();
  assert.equal(calls.length,1);
  app.callbacks.onReportViewChange("registry");
  app.callbacks.onReportViewChange("activity");
  await flush();
  assert.equal(calls.length,2,"A new entry refreshes even an empty scope");
  app.callbacks.onReportViewChange("activity");
  await flush();
  assert.equal(calls.length,2,"Rendering or reselecting the active tab must not loop");
  app.callbacks.onViewModeChange("excel");
  assert.equal(app.state.reportView,"registry","Excel always returns to the registry");
  assert.equal(app.state.rows[0].summary,"Excel source");
  app.callbacks.onReportViewChange("activity");
  app.callbacks.onEpicSelect("TEST-EPIC");
  await flush();await flush();
  assert.equal(calls.length,4);
  assert.deepEqual(calls[3],["TEST","TEST-EPIC"]);
});

test("Dynamics automatically enriches missing history after registry load with progress", async () => {
  const reads = [];
  let finish;
  const child = {key:"TEST-2",fields:{summary:"[QA] Child"},changelog:{startAt:0,total:0,histories:[]}};
  const parent = {key:"TEST-1",fields:{summary:"Parent",issuetype:{name:"Story"},issuelinks:[{type:{name:"Child"},outwardIssue:child}]}};
  const app = await loadImporter([], {
    getProjectIssues:()=>Promise.resolve({issues:[parent]}),
    getIssuesByKeys:()=>Promise.resolve({issues:[child]}),
    getIssueWithHistory:key=>{reads.push(key);return new Promise(resolve=>{finish=resolve;});},
    createIssue:()=>assert.fail("Read-only load"),updateIssue:()=>assert.fail("Read-only load")
  });
  app.callbacks.onProjectChange("TEST");
  app.callbacks.onReportViewChange("activity");
  await flush(); await flush();
  assert.deepEqual(reads,["TEST-1"]);
  assert.equal(app.state.activityLoading,true);
  assert.deepEqual(plain(app.state.activityProgress),{completed:0,total:1});
  app.callbacks.onReportViewChange("activity");
  app.callbacks.onActivityDateChange("2026-09-24");
  await flush();
  assert.deepEqual(reads,["TEST-1"],"Tab/date changes do not duplicate in-flight reads");
  finish({...parent,changelog:{startAt:0,total:0,histories:[]}});
  await flush(); await flush();
  assert.equal(app.state.rows[0].storyDetails.activity.complete,true);
  assert.equal(app.state.activityLoading,false);
  assert.deepEqual(plain(app.state.activityProgress),{completed:1,total:1});
  app.state.rows[0].storyDetails.activity.capturedAt="2026-09-25T08:00:00Z";
  app.state.rows[0].childStatuses[0].activity.capturedAt="2026-09-25T08:00:00Z";
  app.callbacks.onActivityDateChange("2026-09-23");
  await flush();
  assert.deepEqual(reads,["TEST-1"],"Complete history covers earlier days without another request");
});

test("Dynamics does not retry failed history in a loop, but changing day retries missing data", async () => {
  let reads=0;
  const parent={key:"TEST-1",fields:{summary:"Parent",issuetype:{name:"Story"}}};
  const app=await loadImporter([],{
    getProjectIssues:()=>Promise.resolve({issues:[parent]}),getIssuesByKeys:()=>Promise.resolve({issues:[]}),
    getIssueWithHistory:()=>{reads++;return Promise.reject(new Error("offline"));}
  });
  app.callbacks.onProjectChange("TEST");app.callbacks.onReportViewChange("activity");
  await flush();await flush();await flush();
  assert.equal(reads,1);
  assert.match(app.state.activityError,/TEST-1.*offline/);
  assert.equal(app.state.rows[0].storyDetails.activity.complete,false);
  app.callbacks.onReportViewChange("activity");await flush();
  assert.equal(reads,1);
  app.callbacks.onActivityDateChange("2026-09-24");await flush();await flush();
  assert.equal(reads,2);
});

test("leaving Dynamics cancels the history queue and ignores late responses", async () => {
  const finishes=[],reads=[];
  const parents=Array.from({length:5},(_,i)=>({key:"TEST-"+(i+1),fields:{issuetype:{name:"Story"}}}));
  const app=await loadImporter([],{
    getProjectIssues:()=>Promise.resolve({issues:parents}),getIssuesByKeys:()=>Promise.resolve({issues:[]}),
    getIssueWithHistory:key=>{reads.push(key);return new Promise(resolve=>finishes.push(()=>resolve({key,fields:{},changelog:{startAt:0,total:0,histories:[]}})));}
  });
  app.callbacks.onProjectChange("TEST");app.callbacks.onReportViewChange("activity");
  await flush();await flush();
  assert.equal(reads.length,3);
  app.callbacks.onReportViewChange("registry");
  finishes.forEach(finish=>finish());await flush();await flush();
  assert.equal(reads.length,3);
  assert.equal(app.state.activityLoading,false);
  assert.ok(app.state.rows.every(row=>!row.storyDetails.activity.complete));
});

test("changing day renews a complete history captured before that day's end", async () => {
  let reads=0;
  const parent={key:"TEST-1",fields:{issuetype:{name:"Story"}},changelog:{startAt:0,total:0,histories:[]}};
  const app=await loadImporter([],{
    getProjectIssues:()=>Promise.resolve({issues:[parent]}),getIssuesByKeys:()=>Promise.resolve({issues:[]}),
    getIssueWithHistory:()=>{reads++;return Promise.resolve(parent);}
  });
  app.callbacks.onProjectChange("TEST");app.callbacks.onReportViewChange("activity");await flush();await flush();
  assert.equal(reads,0);
  app.state.rows[0].storyDetails.activity.capturedAt="2026-09-23T10:00:00Z";
  app.callbacks.onActivityDateChange("2026-09-24");await flush();await flush();
  assert.equal(reads,1);
});

test("a day change during enrichment queues newly stale history without retrying the same failed issue", async () => {
  const reads=[];
  let rejectPending;
  const parents=[
    {key:"TEST-1",fields:{issuetype:{name:"Story"}},changelog:{startAt:0,total:0,histories:[]}},
    {key:"TEST-2",fields:{issuetype:{name:"Story"}}}
  ];
  const app=await loadImporter([],{
    getProjectIssues:()=>Promise.resolve({issues:parents}),getIssuesByKeys:()=>Promise.resolve({issues:[]}),
    getIssueWithHistory:key=>{reads.push(key);return key==="TEST-2" ? new Promise((resolve,reject)=>{rejectPending=reject;}) : Promise.resolve(parents[0]);}
  });
  app.callbacks.onProjectChange("TEST");
  app.callbacks.onActivityDateChange("2026-09-22");
  app.callbacks.onReportViewChange("activity");await flush();await flush();
  app.state.rows[0].storyDetails.activity.capturedAt="2026-09-23T10:00:00Z";
  app.callbacks.onActivityDateChange("2026-09-24");
  assert.deepEqual(reads,["TEST-2"]);
  rejectPending(new Error("offline"));await flush();await flush();await flush();
  assert.deepEqual(reads,["TEST-2","TEST-1"]);
  assert.match(app.state.activityError,/TEST-2.*offline/);
  assert.equal(app.state.activityLoading,false);
});

test("status-since retains the real transition time for same-second Jira timestamp skew only", async () => {
  const at="2026-09-25T04:20:37.628Z";
  for (const [updated,expected] of [["2026-09-25T04:20:37.626Z",at],["2026-09-25T04:20:37.000Z",at],["2026-09-25T04:20:36.999Z",""]]) {
    const parent={key:"TEST-1",fields:{created:"2026-09-01T00:00:00Z",updated,status:{id:"2",name:"Done"}},
      changelog:{startAt:0,total:1,histories:[history(at,"2","Done","1","Open")]}};
    const app=await loadImporter([{jiraKey:"TEST-1",sourceColumns:{}}],{getIssuesByKeys:()=>Promise.resolve({issues:[parent]})});
    app.callbacks.onSyncJira();await flush();await flush();
    assert.equal(app.state.rows[0].storyDetails.statusSince,expected);
  }
});

test("Dynamics retries failed loads explicitly and does not duplicate pending reads", async () => {
  let calls=0, resolve;
  const app=await loadImporter([],{
    getProjectIssues:()=>{calls++;return new Promise(done=>{resolve=done;});},
    getIssuesByKeys:()=>Promise.resolve({issues:[]})
  });
  app.callbacks.onProjectChange("TEST");
  app.callbacks.onReportViewChange("activity");
  app.callbacks.onReportViewChange("activity");
  assert.equal(calls,1);
  app.callbacks.onViewModeChange("excel");
  resolve({issues:[]});await flush();await flush();
  assert.equal(app.state.viewMode,"excel");
  assert.equal(app.state.reportView,"registry");
  app.callbacks.onReportViewChange("activity");
  assert.equal(calls,2,"Cancelled scope loads again");
  resolve({issues:[]});await flush();await flush();
});

test("a failed refresh after success is retried when reopening Dynamics", async () => {
  let calls=0;
  const app=await loadImporter([],{
    getProjectIssues:()=>{calls++;return calls===2 ? Promise.reject(new Error("offline")) : Promise.resolve({issues:[]});},
    getIssuesByKeys:()=>Promise.resolve({issues:[]})
  });
  app.callbacks.onProjectChange("TEST");
  app.callbacks.onReportViewChange("activity");await flush();await flush();
  app.callbacks.onLoadRegistry();await flush();await flush();
  assert.match(app.state.registryError,/offline/);
  app.callbacks.onViewModeChange("excel");
  app.callbacks.onReportViewChange("activity");await flush();await flush();
  assert.equal(calls,3);
  assert.equal(app.state.registryError,"");
});

test("a cancelled refresh after success is retried instead of silently reusing the old scope", async () => {
  let calls=0, finish;
  const app=await loadImporter([],{
    getProjectIssues:()=>{calls++;return calls===2 ? new Promise(resolve=>{finish=resolve;}) : Promise.resolve({issues:[]});},
    getIssuesByKeys:()=>Promise.resolve({issues:[]})
  });
  app.callbacks.onProjectChange("TEST");
  app.callbacks.onReportViewChange("activity");await flush();await flush();
  app.callbacks.onLoadRegistry();
  app.callbacks.onViewModeChange("excel");
  app.callbacks.onReportViewChange("activity");await flush();await flush();
  assert.equal(calls,3);
  finish({issues:[]});await flush();await flush();
  assert.equal(app.state.registryLoading,false);
});

test("daily activity retains history on parent and child and explicitly enriches only incomplete issues", async () => {
  const calls = [];
  const child = { key: "TEST-2", fields: { summary: "[QA] Child", created: "2026-09-01T00:00:00Z", components: [{ id: "2", name: "Y" }] }, changelog: { startAt: 0, total: 0, histories: [] } };
  const parent = { key: "TEST-1", fields: { summary: "Parent", created: "2026-09-01T00:00:00Z", components: [{ id: "1", name: "X" }], issuelinks: [{ type: { name: "Child" }, outwardIssue: child }] } };
  const app = await loadImporter([{jiraKey:"TEST-1",sourceColumns:{}}], {
    getIssuesByKeys: keys => Promise.resolve({issues: keys.map(key => key === parent.key ? parent : child)}),
    getIssueWithHistory: key => { calls.push(key); return Promise.resolve(Object.assign({}, parent, {changelog: {startAt:0,total:0,histories:[]}})); }
  });
  app.callbacks.onSyncJira(); await flush(); await flush();
  assert.equal(app.state.rows[0].storyDetails.activity.complete, false);
  assert.equal(app.state.rows[0].childStatuses[0].activity.complete, true);
  assert.equal(app.state.rows[0].storyDetails.created, parent.fields.created);
  assert.deepEqual(plain(app.state.rows[0].storyDetails.components), [{ id: "1", name: "X" }]);
  assert.deepEqual(plain(app.state.rows[0].childStatuses[0].components), [{ id: "2", name: "Y" }]);
  assert.equal(calls.length, 0);
  app.callbacks.onLoadActivityHistory(); await flush(); await flush();
  assert.deepEqual(calls, ["TEST-1"]);
  assert.equal(app.state.rows[0].storyDetails.activity.complete, true);
  assert.equal(app.state.activityLoading, false);
});

test("activity enrichment ignores a response after switching project", async () => {
  let resolveHistory;
  const issue = { key: "TEST-1", fields: { summary: "Parent" } };
  const app = await loadImporter([{jiraKey:"TEST-1",sourceColumns:{}}], {
    getIssuesByKeys: () => Promise.resolve({issues:[issue]}),
    getIssueWithHistory: () => new Promise(resolve => { resolveHistory = resolve; })
  });
  app.callbacks.onSyncJira(); await flush(); await flush();
  const original = app.state.rows[0].storyDetails.activity;
  app.callbacks.onLoadActivityHistory(); await flush();
  app.callbacks.onProjectChange("OTHER");
  resolveHistory(Object.assign({}, issue, {changelog:{startAt:0,total:0,histories:[]}})); await flush(); await flush();
  assert.equal(app.state.rows[0].storyDetails.activity, original);
  assert.equal(app.state.activityLoading, false);
});

test("activity enrichment reports read failures without changing ticket fields", async () => {
  const issue = { key: "TEST-1", fields: { summary: "Parent" } };
  const app = await loadImporter([{jiraKey:"TEST-1",sourceColumns:{}}], {
    getIssuesByKeys: () => Promise.resolve({issues:[issue]}),
    getIssueWithHistory: () => Promise.reject(new Error("offline"))
  });
  app.callbacks.onSyncJira(); await flush(); await flush();
  app.callbacks.onLoadActivityHistory(); await flush(); await flush();
  assert.equal(app.state.activityLoading, false);
  assert.match(app.state.activityError, /TEST-1.*offline/);
  assert.equal(app.state.rows[0].storyDetails.summary, "Parent");
});

test("full issue history reads attribution, comments and logged work without a mutation", async () => {
  let request;
  const api = loadAmdModule(path.join(MODULE_DIR, "api.js"), {
    jquery: {ajax: options => { request = options; return Promise.resolve({}); }},
    _ujgESI_config: {baseUrl:"https://jira.example.test"}
  });
  await api.getIssueWithHistory("TEST-1");
  assert.equal(request.type,"GET");
  assert.equal(request.url,"https://jira.example.test/rest/api/2/issue/TEST-1");
  assert.equal(request.data.expand,"changelog");
  assert.ok(request.data.fields.includes("creator"));
  for (const field of ["timespent", "worklog", "comment"]) assert.ok(request.data.fields.split(",").includes(field), field);
});

test("history enrichment deduplicates keys, bounds concurrency, and cancels queued reads on source change", async () => {
  const resolvers = [], reads = [];
  const issues = Array.from({length:8},(_,i) => ({key:"TEST-"+(i+1),fields:{summary:"Parent"}}));
  const app = await loadImporter(issues.concat(issues[0]).map(issue => ({jiraKey:issue.key,sourceColumns:{}})), {
    getIssuesByKeys: () => Promise.resolve({issues}),
    getIssueWithHistory: key => { reads.push(key); return new Promise(resolve => resolvers.push(() => resolve(Object.assign({},issues.find(issue => issue.key === key),{changelog:{startAt:0,total:0,histories:[]}})))); }
  });
  app.callbacks.onSyncJira(); await flush(); await flush();
  app.callbacks.onLoadActivityHistory(); await flush();
  assert.equal(reads.length,3);
  resolvers[0](); await flush();
  assert.equal(reads.length,4);
  app.callbacks.onViewModeChange("jira");
  resolvers.slice(1).forEach(resolve => resolve()); await flush(); await flush();
  assert.equal(reads.length,4);
  assert.equal(app.state.activityLoading,false);
  assert.equal(app.state.activityError,"");
});

test("explicit history refresh can renew complete but stale snapshots", async () => {
  let reads = 0;
  const issue = {key:"TEST-1",fields:{summary:"Parent"},changelog:{startAt:0,total:0,histories:[]}};
  const app = await loadImporter([{jiraKey:issue.key,sourceColumns:{}}], {
    getIssuesByKeys: () => Promise.resolve({issues:[issue]}),
    getIssueWithHistory: () => { reads++; return Promise.resolve(issue); }
  });
  app.callbacks.onSyncJira(); await flush(); await flush();
  assert.equal(app.state.rows[0].storyDetails.activity.complete,true);
  app.callbacks.onLoadActivityHistory(); await flush(); await flush();
  assert.equal(reads,1);
});

test("activity-only reads never replace unsynchronized Excel fields with key-only Story details", async () => {
  const sourceColumns = {"Статус в Jira":"Готово","Исполнитель в Jira":"Иванов","Приоритет":"Высокий"};
  const app = await loadImporter([{jiraKey:"TEST-1",summary:"Excel remark",sourceColumns}], {
    getIssueWithHistory: () => Promise.reject(new Error("offline"))
  });
  app.callbacks.onLoadActivityHistory(); await flush(); await flush();
  assert.equal(app.state.rows[0].storyDetails,undefined);
  assert.deepEqual(plain(app.state.rows[0].sourceColumns),sourceColumns);
  assert.match(app.state.activityError,/offline/);
});

test("ready-for-testing without a status category remains an open testing task", async () => {
  const issue = {key:"TEST-1",fields:{summary:"Work",status:{name:"Готово к тестированию"}}};
  const app = await loadImporter([{jiraKey:"TEST-1",sourceColumns:{}}], {getIssuesByKeys:()=>Promise.resolve({issues:[issue]})});
  app.callbacks.onSyncJira(); await flush(); await flush();
  assert.equal(app.state.rows[0].storyDetails.done, false);
  assert.equal(app.state.rows[0].storyDetails.statusState, "progress");
});

test("explicit sync enriches Story and child fields without extra requests or issue writes", async function () {
  const calls = [];
  let issues = [{
    key: "TEST-1",
    fields: {
      summary: "Existing Story", description: "Story detail", status: { id: "3", name: "In Progress" },
      assignee: { displayName: "Иван", name: "ivan", key: "JIRAUSER100" }, priority: { name: "High" }, issuetype: { name: "Story" },
      created: "2026-01-01T10:00:00.000+0300", updated: "2026-03-03T10:00:00.000+0300",
      issuelinks: [{ type: { name: "Child" }, outwardIssue: { key: "TEST-2", fields: { summary: "[FE] Existing child" } } }],
    },
    changelog: { startAt: 0, total: 3, histories: [
      history("2026-03-01T10:00:00.000+0300", "3", "In Progress", "1", "Open"),
      { created: "2026-03-03T10:00:00.000+0300", items: [{ field: "summary" }] },
      history("2026-02-01T10:00:00.000+0300", "1", "Open", "3", "In Progress"),
    ] },
  }];
  const child = {
    key: "TEST-2", fields: {
      summary: "[FE] Existing child", description: "Child detail", status: { id: "1", name: "Open", statusCategory: { key: "new" } },
      assignee: { name: "developer" }, priority: { name: "Low" }, issuetype: { name: "Task" },
      created: "2026-02-01T00:00:00Z", updated: "2026-02-02T00:00:00Z",
    }, changelog: { startAt: 0, total: 0, histories: [] },
  };
  const inputRow = { jiraKey: "TEST-1", summary: "Source remark", alreadyLinked: true, sourceColumns: { "№": 42 } };
  const app = await loadImporter([inputRow], {
    getIssuesByKeys(keys, options) {
      calls.push({ keys: Array.from(keys), options: plain(options || {}) });
      return Promise.resolve({ issues: keys[0] === "TEST-2" ? [child] : issues });
    },
    createIssue() { assert.fail("Sync must not create issues"); },
    updateIssue() { assert.fail("Sync must not update issues"); },
  });
  const row = app.state.rows[0];
  assert.equal(calls.length, 0);
  app.callbacks.onSyncJira();
  await flush();
  await flush();
  assert.deepEqual(calls, [
    { keys: ["TEST-1"], options: { expand: "changelog" } },
    { keys: ["TEST-2"], options: { expand: "changelog" } },
  ]);
  assert.equal(app.state.syncError, "");
  assert.deepEqual(plain(row.storyDetails), {
    key: "TEST-1", summary: "Existing Story", description: "Story detail", descriptionLoaded: true, status: "In Progress", assignee: "Иван",
    statusCategory: "", statusState: "progress", done: false,
    assigneeIdentifiers: ["JIRAUSER100", "ivan"],
    priority: "High", components: [], issueType: "Story", updated: "2026-03-03T10:00:00.000+0300",
    created: issues[0].fields.created,
    activity: {key:"TEST-1",capturedAt:row.storyDetails.activity.capturedAt,complete:true,histories:plain(issues[0].changelog.histories),linkedKeys:["TEST-2"]},
    statusSince: "2026-03-01T07:00:00.000Z", statusSinceReason: row.storyDetails.statusSinceReason,
  });
  assert.match(row.storyDetails.statusSinceReason, /истор|переход/i);
  assert.deepEqual(plain(row.childStatuses[0]), {
    role: "FE", key: "TEST-2", summary: "[FE] Existing child", description: "Child detail", descriptionLoaded: true, status: "Open", linkedToParent: true,
    statusCategory: "new", statusState: "todo", done: false, assignee: "developer", blocked: false,
    assigneeIdentifiers: ["developer"],
    priority: "Low", components: [], issueType: "Task", updated: "2026-02-02T00:00:00Z",
    created: child.fields.created,
    activity: {key:"TEST-2",capturedAt:row.childStatuses[0].activity.capturedAt,complete:true,histories:[],linkedKeys:[]},
    statusSince: "2026-02-01T00:00:00.000Z", statusSinceReason: row.childStatuses[0].statusSinceReason,
  });
  assert.match(row.childStatuses[0].statusSinceReason, /создани/i);
  assert.equal(row.summary, "Source remark");
  app.callbacks.onCreateRow(0);
  assert.equal(app.state.createDialog, null);
  issues = [];
  app.callbacks.onSyncJira();
  await flush();
  await flush();
  assert.equal(row.storyDetails, null, "Missing issues must clear stale details");
  assert.deepEqual(plain(row.childStatuses), []);
});

for (const mode of ["excel", "jira"]) {
  for (const { reverse, bare } of [{ reverse: false }, { reverse: true }, { reverse: false, bare: true }, { reverse: true, bare: true }]) {
    test(mode + " tree follows parent relations without including backlinks (reverse=" + reverse + ", bare=" + !!bare + ")", async function () {
      const childSide = reverse ? "inwardIssue" : "outwardIssue";
      const parentSide = reverse ? "outwardIssue" : "inwardIssue";
      const parentLabel = bare ? "parent" : "is parent of";
      const childLabel = bare ? "child" : "is child of";
      const type = { name: bare ? "Child" : "Parent-Child", inward: reverse ? parentLabel : childLabel, outward: reverse ? childLabel : parentLabel };
      const parent = { key: "TEST-1", fields: { summary: "Story", issuetype: { name: "Story" }, issuelinks: [
        { type, [childSide]: { key: "TEST-2", fields: { summary: "[BE] Child" } } },
        { type, [childSide]: { key: "TEST-3", fields: { summary: "[QA] Child" } } },
        { type, [parentSide]: { key: "TEST-99", fields: { summary: "Parent, not a child" } } },
        { type: { name: "Blocks", outward: "blocks", inward: "is blocked by" }, outwardIssue: { key: "TEST-98" } },
      ] } };
      const requested = [];
      const app = await loadImporter([{ jiraKey: "TEST-1", sourceColumns: {} }], {
        getProjectIssues: () => Promise.resolve({ issues: [parent] }),
        getIssuesByKeys(keys) {
          requested.push(Array.from(keys));
          return Promise.resolve({ issues: keys[0] === "TEST-1" ? [parent] : keys.map(key => ({ key, fields: {
            summary: key === "TEST-2" ? "[BE] Child" : "[QA] Child", description: "Loaded " + key,
            status: { name: "Done", statusCategory: { key: "done" } }, assignee: { displayName: "Developer" },
          } })) });
        },
        createIssue() { assert.fail("Loading a tree must not create issues"); },
        updateIssue() { assert.fail("Loading a tree must not update issues"); },
      });
      if (mode === "jira") {
        app.callbacks.onProjectChange("TEST");
        app.callbacks.onViewModeChange("jira");
        app.callbacks.onLoadRegistry();
      } else app.callbacks.onSyncJira();
      await flush(); await flush();
      assert.deepEqual(requested, mode === "jira" ? [["TEST-2", "TEST-3"]] : [["TEST-1"], ["TEST-2", "TEST-3"]]);
      assert.deepEqual(plain(app.state.rows[0].childStatuses.map(child => [child.key, child.role, child.description, child.done])), [
        ["TEST-2", "BE", "Loaded TEST-2", true], ["TEST-3", "QA", "Loaded TEST-3", true],
      ]);
    });
  }
}

const transition = history("2026-02-01T10:00:00+0300", "3", "In Progress", "1", "Open");
const complete = histories => ({ startAt: 0, total: histories.length, histories });
const statusDateCases = [
  { name: "no changelog", changelog: undefined, reason: /недоступ|отсутств/i },
  { name: "empty histories without completeness", changelog: { histories: [] }, reason: /полн/i },
  { name: "nonempty histories without completeness", changelog: { histories: [transition] }, reason: /полн/i },
  { name: "truncated history", changelog: { startAt: 0, total: 2, histories: [transition] }, reason: /полн/i },
  { name: "later page", changelog: { startAt: 1, total: 1, histories: [transition] }, reason: /полн/i },
  { name: "more pages flagged", changelog: { startAt: 0, total: 1, isLast: false, histories: [transition] }, reason: /полн/i },
  { name: "current status ID mismatch despite matching name", changelog: complete([history("2026-02-01T00:00:00Z", "2", "In Progress")]), reason: /совпад/i },
  { name: "current status name mismatch without IDs", changelog: complete([history("2026-02-01T00:00:00Z", null, "Done")]), reason: /совпад/i },
  { name: "invalid transition timestamp", changelog: complete([history("invalid", "3", "In Progress")]), reason: /дат|врем/i },
  { name: "timezone missing", changelog: complete([history("2026-02-01T00:00:00", "3", "In Progress")]), reason: /дат|врем/i },
  { name: "invalid calendar date", changelog: complete([history("2026-02-30T00:00:00Z", "3", "In Progress")]), reason: /дат|врем/i },
  { name: "transition predates issue creation", changelog: complete([history("2025-12-31T00:00:00Z", "3", "In Progress")]), reason: /дат|создани/i },
  { name: "transition exceeds issue update time", changelog: complete([transition]), updated: "2026-01-02T00:00:00Z", reason: /дат|обновлен/i },
  { name: "duplicate histories do not prove completeness", changelog: complete([
    Object.assign({ id: "17" }, transition),
    Object.assign({ id: "17" }, history("2026-03-01T00:00:00Z", "3", "In Progress")),
  ]), reason: /полн|повтор/i },
  { name: "same-status event keeps the actual status entry date", changelog: complete([
    transition, history("2026-03-01T00:00:00Z", "3", "In Progress", "3", "In Progress"),
  ]), expected: "2026-02-01T07:00:00.000Z" },
  { name: "malformed history", changelog: complete([{ created: "2026-02-01T00:00:00Z" }]), reason: /полн/i },
  { name: "broken transition chain", changelog: complete([transition, history("2026-03-01T00:00:00Z", "3", "In Progress", "2", "Done")]), reason: /полн|соглас/i },
  { name: "ambiguous same-time transitions", changelog: complete([transition, history("2026-02-01T10:00:00+0300", "3", "In Progress", "2", "Done")]), reason: /поряд|врем|однознач/i },
  { name: "explicit empty complete history", changelog: complete([]), expected: "2026-01-01T00:00:00.000Z" },
  { name: "complete total without startAt", changelog: { total: 0, histories: [] }, expected: "2026-01-01T00:00:00.000Z" },
  { name: "explicit only last page", changelog: { startAt: 0, isLast: true, histories: [transition] }, expected: "2026-02-01T07:00:00.000Z" },
  { name: "non-status history only", changelog: complete([{ items: [{ field: "assignee" }] }]), expected: "2026-01-01T00:00:00.000Z" },
  { name: "missing created for complete empty history", changelog: complete([]), created: null, reason: /дат|создани/i },
  { name: "current status name renamed with same ID", changelog: complete([history("2026-02-01T00:00:00Z", "3", "Old name")]), expected: "2026-02-01T00:00:00.000Z" },
  { name: "localized field with status fieldId", changelog: complete([{ created: "2026-02-01T00:00:00Z", items: [{ field: "Статус", fieldId: "status", to: "3" }] }]), expected: "2026-02-01T00:00:00.000Z" },
  { name: "status name fallback", changelog: complete([history("2026-02-01T00:00:00Z", null, "In Progress")]), expected: "2026-02-01T00:00:00.000Z" },
];

for (const scenario of statusDateCases) {
  test("sync statusSince: " + scenario.name, async function () {
    const app = await loadImporter([{ jiraKey: "TEST-1", sourceColumns: {} }], {
      getIssuesByKeys: () => Promise.resolve({ issues: [{
        key: "TEST-1", changelog: scenario.changelog,
        fields: { status: { id: "3", name: "In Progress" }, created: scenario.created === null ? null : "2026-01-01T00:00:00Z", updated: scenario.updated },
      }] }),
    });
    const row = app.state.rows[0];
    app.callbacks.onSyncJira();
    await flush();
    await flush();
    assert.ok(row.storyDetails, "Sync must expose Story details");
    assert.equal(row.storyDetails.statusSince, scenario.expected || "");
    assert.match(row.storyDetails.statusSinceReason, scenario.reason || /истор|создани|переход/i);
    assert.equal(row.storyDetails.priority, "");
    assert.equal(row.storyDetails.issueType, "");
    assert.equal(row.storyDetails.updated, scenario.updated || "");
  });
}

for (const scenario of [
  { name: "Jira JSON error", error: { status: 400, statusText: "error", responseJSON: { errorMessages: ["expand must be an array"] } }, expected: "HTTP 400: expand must be an array" },
  { name: "field errors", error: { status: 400, statusText: "error", responseJSON: { errorMessages: [], errors: { jql: "Invalid JQL" } } }, expected: "HTTP 400: Invalid JQL" },
  { name: "JSON response text", error: { status: 400, responseText: '{"errorMessages":["Invalid search"]}' }, expected: "HTTP 400: Invalid search" },
  { name: "HTML gateway response", error: { status: 502, statusText: "Bad Gateway", responseText: "<html>gateway diagnostics</html>" }, expected: "HTTP 502: Bad Gateway" },
  { name: "local failure", error: new Error("Workbook export failed"), expected: "Workbook export failed" },
]) {
  test("sync displays actionable failure: " + scenario.name, async function () {
    const app = await loadImporter([{ jiraKey: "TEST-1", summary: "Keep this row", sourceColumns: {} }], {
      getIssuesByKeys: () => Promise.reject(scenario.error),
    });
    app.callbacks.onSyncJira();
    await flush(); await flush();
    assert.equal(app.state.syncError, "Не удалось синхронизировать Jira: " + scenario.expected);
    assert.equal(app.state.syncLoading, false);
    assert.equal(app.state.exportBuffer, null);
    assert.equal(app.state.rows[0].summary, "Keep this row");
  });
}

test("Jira registry displays search rejection details", async function () {
  const app = await loadImporter([], {
    getProjectIssues: () => Promise.reject({ status: 400, statusText: "error", responseJSON: { errorMessages: ["expand must be an array"] } }),
    getIssuesByKeys: () => Promise.resolve({ issues: [] }),
  });
  app.callbacks.onProjectChange("TEST");
  app.callbacks.onViewModeChange("jira");
  app.callbacks.onLoadRegistry();
  await flush(); await flush();
  assert.equal(app.state.registryError, "Не удалось загрузить Jira: HTTP 400: expand must be an array");
  assert.equal(app.state.registryLoading, false);
});

test("API serializes POST search expand as an array only when requested", async function () {
  const calls = [];
  const api = loadAmdModule(path.join(MODULE_DIR, "api.js"), {
    jquery: { ajax(options) { calls.push(options); return Promise.resolve({ issues: [] }); } },
    _ujgESI_config: { baseUrl: "https://jira.invalid", SPRINT_FIELD: "customfield_42" },
  });
  await api.getIssuesByKeys([], { expand: "changelog" });
  assert.equal(calls.length, 0);
  await api.getIssuesByKeys(["test-1", "TEST-1"], { expand: "changelog" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://jira.invalid/rest/api/2/search");
  assert.equal(calls[0].type, "POST");
  const body = JSON.parse(calls[0].data);
  assert.deepEqual(body.expand, ["changelog"]);
  assert.equal(body.jql, "key in (TEST-1)");
  assert.equal(body.maxResults, 1);
  for (const field of ["summary", "description", "status", "assignee", "priority", "issuetype", "updated", "created", "issuelinks", "resolution", "resolutiondate", "customfield_42", "customfield_10020", "customfield_10007"]) {
    assert.ok(body.fields.includes(field), field);
  }
  await api.getIssuesByKeys(["TEST-2"]);
  assert.equal(calls.length, 2);
  assert.equal(JSON.parse(calls[1].data).expand, undefined);
});

test("project issue API pages bounded Story searches with enrichment fields", async function () {
  const calls = [];
  const api = loadAmdModule(path.join(MODULE_DIR, "api.js"), {
    jquery: { ajax(options) {
      const body = JSON.parse(options.data);
      calls.push(body);
      return Promise.resolve({ issues: Array.from({ length: body.startAt ? 1 : 100 }, (_, index) => ({ key: "TEST-" + (body.startAt + index) })), total: 101 });
    } },
    _ujgESI_config: { baseUrl: "https://jira.invalid", EPIC_LINK_FIELD: "customfield_10109" },
  });
  const data = await api.getProjectIssues("TEST", "TEST-9");
  assert.equal(data.issues.length, 101);
  assert.deepEqual(calls.map(call => call.startAt), [0, 100]);
  assert.match(calls[0].jql, /project = TEST.*issuetype = Story.*cf\[10109\] = TEST-9/);
  for (const call of calls) assert.deepEqual(call.expand, ["changelog"]);
  assert.ok(calls[0].fields.includes("description"));
});

test("project issue API caps a large registry and reports the actual loaded count", async function () {
  const calls = [];
  const api = loadAmdModule(path.join(MODULE_DIR, "api.js"), {
    jquery: { ajax(options) {
      const body = JSON.parse(options.data);
      calls.push(body);
      return Promise.resolve({ issues: Array.from({ length: 100 }, (_, index) => ({ key: "TEST-" + (body.startAt + index) })), total: 1001 });
    } },
    _ujgESI_config: { baseUrl: "https://jira.invalid", EPIC_LINK_FIELD: "customfield_10109" },
  });
  const data = await api.getProjectIssues("TEST", "");
  assert.equal(calls.length, 10);
  assert.equal(data.issues.length, 1000);
  assert.equal(data.total, 1001);
  assert.equal(data.truncated, true);
});

test("Jira registry loads explicitly, enriches linked children, and preserves workbook rows", async function () {
  const calls = [];
  const app = await loadImporter([{ summary: "Excel remark", sourceColumns: { "№": 42 } }], {
    getProjectIssues(project, epic) {
      calls.push([project, epic]);
      return Promise.resolve({ issues: [{ key: "TEST-1", fields: {
        summary: "Existing Story", description: "Story body", issuetype: { name: "Story" },
        assignee: {name:"jira.owner",key:"user-42",displayName:"Registry owner"},
        issuelinks: [{ type: { name: "Child" }, outwardIssue: { key: "TEST-2", fields: { summary: "[FE] child" } } }],
      } }] });
    },
    getIssuesByKeys(keys) {
      assert.deepEqual(Array.from(keys), ["TEST-2"]);
      return Promise.resolve({ issues: [{ key: "TEST-2", fields: { summary: "[FE] child", description: "Child body" } }] });
    },
  });
  app.callbacks.onProjectChange("TEST");
  app.callbacks.onViewModeChange("jira");
  assert.equal(calls.length, 0);
  assert.equal(app.state.rows.length, 0);
  app.callbacks.onLoadRegistry();
  assert.equal(app.state.registryLoading, true);
  await flush(); await flush();
  assert.deepEqual(calls, [["TEST", ""]]);
  assert.equal(app.state.rows[0].storyDetails.description, "Story body");
  assert.deepEqual(Array.from(app.state.rows[0].ownerIdentifiers),["user-42","jira.owner"]);
  assert.equal(app.state.rows[0].childStatuses[0].description, "Child body");
  app.callbacks.onViewModeChange("excel");
  assert.equal(app.state.rows[0].summary, "Excel remark");
  app.callbacks.onViewModeChange("jira");
  assert.equal(app.state.rows[0].jiraKey, "TEST-1");
});

test("registry warns with loaded and total counts when Jira results are truncated", async function () {
  const app = await loadImporter([], {
    getProjectIssues: () => Promise.resolve({
      issues: [{ key: "TEST-1", fields: { summary: "Story", issuetype: { name: "Story" } } }],
      total: 1001,
      truncated: true,
    }),
    getIssuesByKeys: () => Promise.resolve({ issues: [] }),
  });
  app.callbacks.onProjectChange("TEST");
  app.callbacks.onViewModeChange("jira");
  app.callbacks.onLoadRegistry();
  await flush(); await flush();
  assert.equal(app.state.rows.length, 1);
  assert.match(app.state.registryWarning, /1 из 1001/);
  assert.equal(app.state.registryError, "");
});

test("late registry response cannot replace rows after project scope changes", async function () {
  let resolveSearch;
  const app = await loadImporter([{ summary: "Excel remark", sourceColumns: {} }], {
    getProjectIssues: () => new Promise(resolve => { resolveSearch = resolve; }),
    getIssuesByKeys: () => Promise.resolve({ issues: [] }),
  });
  app.callbacks.onProjectChange("TEST");
  app.callbacks.onViewModeChange("jira");
  app.callbacks.onLoadRegistry();
  app.callbacks.onProjectChange("OTHER");
  resolveSearch({ issues: [{ key: "TEST-1", fields: { summary: "Old scope", issuetype: { name: "Story" } } }] });
  await flush(); await flush();
  assert.equal(app.state.rows.length, 0);
  assert.equal(app.state.registryLoading, false);
  app.callbacks.onViewModeChange("excel");
  assert.equal(app.state.rows[0].summary, "Excel remark");
});

test("switching views during workbook sync cancels stale enrichment and export", async function () {
  let resolveIssues;
  const app = await loadImporter([{ jiraKey: "TEST-1", summary: "Excel remark", sourceColumns: {} }], {
    getIssuesByKeys: () => new Promise(resolve => { resolveIssues = resolve; }),
  });
  app.callbacks.onSyncJira();
  await flush();
  app.callbacks.onViewModeChange("jira");
  resolveIssues({ issues: [{ key: "TEST-1", fields: { summary: "Late Story" } }] });
  await flush(); await flush();
  assert.equal(app.state.registryLoading, false);
  assert.equal(app.state.syncLoading, false);
  assert.equal(app.state.exportBuffer, null);
  app.callbacks.onViewModeChange("excel");
  assert.equal(app.state.rows[0].storyDetails, undefined);
});

test("row owner picker updates local owner and Story default without assigning Jira", async function () {
  const app = await loadImporter([{ summary: "Remark", sourceColumns: { "Ответственный": "Original text" } }], {
    searchUsers: () => Promise.resolve({ users: [{ accountId: "owner-1", displayName: "Owner One" }] }),
    createIssue() { assert.fail("Owner selection must not write Jira"); },
  });
  app.callbacks.onProjectChange("TEST");
  app.callbacks.onRowOwnerSearch(0, "Owner");
  await flush();
  app.callbacks.onDialogAssigneeSelect("row-owner-0", "owner-1");
  assert.equal(app.state.rows[0].sourceColumns["Ответственный"], "Owner One");
  assert.equal(app.state.rows[0].ownerAssignee.accountId, "owner-1");
  assert.deepEqual(Array.from(app.state.rows[0].ownerIdentifiers),["owner-1"]);
  app.callbacks.onCreateRow(0);
  assert.equal(app.state.createDialog.assigneeId, "owner-1");
  app.callbacks.onCloseUserPicker();
  assert.equal(app.state.rows[0].ownerAssigneeId, "owner-1");
});

test("owner selection and clearing patch the mapped Excel owner column", async function () {
  const patches = [];
  const row = { excelRowNumber: 7, jiraKey: "TEST-1", sourceColumns: { "Ответственный": "Original", "Исполнитель": "Fallback" } };
  const app = await loadImporter([row], {
    searchUsers: () => Promise.resolve({ users: [{ accountId: "owner-1", displayName: "Owner One" }] }),
    getIssuesByKeys: () => Promise.resolve({ issues: [{ key: "TEST-1", fields: { summary: "Story" } }] }),
  }, null, { patchWorkbook(_buffer, patch) { patches.push(plain(patch)); return Promise.resolve(new ArrayBuffer(1)); } });
  app.state.mappingSettings.columnMap.owner = "Owner mapped";
  app.callbacks.onRowOwnerSearch(0, "Owner");
  await flush();
  app.callbacks.onDialogAssigneeSelect("row-owner-0", "owner-1");
  app.callbacks.onSyncJira();
  await flush(); await flush();
  assert.equal(patches[0].rows[0].values["Owner mapped"], "Owner One");
  app.callbacks.onDialogAssigneeClear("row-owner-0");
  assert.equal(app.state.rows[0].sourceColumns["Ответственный"], "");
  assert.deepEqual(Array.from(app.state.rows[0].ownerIdentifiers),[]);
  app.callbacks.onSyncJira();
  await flush(); await flush();
  assert.equal(patches[1].rows[0].values["Owner mapped"], "");
  assert.equal(app.state.rows[0].sourceColumns["Исполнитель"], "Fallback");
});

test("owner export changes only the mapped worksheet column when both owner headers exist", async function () {
  const patcher = loadAmdModule(path.join(MODULE_DIR, "xlsx-patcher.js"), { _ujgESI_config: {} });
  const worksheet = '<worksheet><sheetData>' +
    '<row r="1"><c r="A1" t="inlineStr"><is><t>Ответственный</t></is></c><c r="B1" t="inlineStr"><is><t>Owner mapped</t></is></c></row>' +
    '<row r="2"><c r="A2" t="inlineStr"><is><t>Preserve original column</t></is></c><c r="B2" t="inlineStr"><is><t>Mapped old owner</t></is></c></row>' +
    '</sheetData></worksheet>';
  const outputs = [];
  const app = await loadImporter([{ excelRowNumber: 2, jiraKey: "TEST-1", sourceColumns: { "Ответственный": "Mapped old owner" } }], {
    searchUsers: () => Promise.resolve({ users: [{ accountId: "owner-1", displayName: "New Owner" }] }),
    getIssuesByKeys: () => Promise.resolve({ issues: [{ key: "TEST-1", fields: { summary: "Story" } }] }),
  }, null, { patchWorkbook(_buffer, patch) {
    outputs.push(patcher.patchWorksheetXml(worksheet, patch));
    return Promise.resolve(new ArrayBuffer(1));
  } });
  app.state.mappingSettings.columnMap.owner = "Owner mapped";
  app.state.parseMeta.headerRowNumber = 1;
  app.state.parseMeta.headerColumns = { "Ответственный": 2 };
  app.callbacks.onRowOwnerSearch(0, "New Owner");
  await flush();
  app.callbacks.onDialogAssigneeSelect("row-owner-0", "owner-1");
  app.callbacks.onSyncJira();
  await flush(); await flush();
  assert.match(outputs[0], /<c r="A2"[^>]*><is><t>Preserve original column<\/t><\/is><\/c>/);
  assert.match(outputs[0], /<c r="B2"[^>]*><is><t>New Owner<\/t><\/is><\/c>/);
  app.callbacks.onDialogAssigneeClear("row-owner-0");
  app.callbacks.onSyncJira();
  await flush(); await flush();
  assert.match(outputs[1], /<c r="A2"[^>]*><is><t>Preserve original column<\/t><\/is><\/c>/);
  assert.match(outputs[1], /<c r="B2"[^>]*><is><t><\/t><\/is><\/c>/);
});

test("owner edit invalidates a pending export so its late result cannot replace a fresh export", async function () {
  let resolveOldPatch;
  const patches = [];
  const oldBuffer = new ArrayBuffer(1);
  const freshBuffer = new ArrayBuffer(2);
  const app = await loadImporter([{ excelRowNumber: 2, jiraKey: "TEST-1", ownerEdited: true, sourceColumns: { "Ответственный": "Old owner" } }], {
    getIssuesByKeys: () => Promise.resolve({ issues: [{ key: "TEST-1", fields: { summary: "Story" } }] }),
  }, null, { patchWorkbook(_buffer, patch) {
    patches.push(plain(patch));
    return patches.length === 1 ? new Promise(resolve => { resolveOldPatch = resolve; }) : Promise.resolve(freshBuffer);
  } });
  app.callbacks.onSyncJira();
  await flush();
  assert.equal(typeof resolveOldPatch, "function");
  app.callbacks.onDialogAssigneeClear("row-owner-0");
  assert.equal(app.state.syncLoading, false);
  assert.equal(app.state.exportBuffer, null);
  app.callbacks.onSyncJira();
  await flush(); await flush();
  assert.equal(app.state.exportBuffer, freshBuffer);
  resolveOldPatch(oldBuffer);
  await flush();
  assert.equal(app.state.exportBuffer, freshBuffer);
  assert.equal(patches[1].rows[0].values["Ответственный"], "");
});

test("modal project override creates Story in the chosen project", async function () {
  const calls = [];
  const app = await loadImporter([{ summary: "Remark", sourceColumns: {} }], {}, {
    createRow(_api, _row, options) {
      calls.push(options);
      return Promise.resolve({ ok: true, createdKey: "OTHER-1", createdChildren: [], errors: [] });
    },
  });
  app.callbacks.onProjectChange("TEST");
  app.callbacks.onCreateRow(0);
  app.callbacks.onDialogFieldChange("projectKey", "OTHER");
  assert.equal(app.state.projectKey, "TEST");
  app.callbacks.onConfirmCreate();
  await flush();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].projectKey, "OTHER");
});

test("existing Story opens child-only dialog and keeps partial created children without duplicate parent", async function () {
  const calls = [];
  const app = await loadImporter([{ jiraKey: "TEST-1", summary: "Remark", sourceColumns: {} }], {
    getIssueWithHistory: key => Promise.resolve(parentPriorityIssue(key)),
  }, {
    createRow() { assert.fail("Existing Story must not be recreated"); },
    createAdditionalTasks(_api, row, options) {
      calls.push({ row, options });
      return Promise.resolve({ ok: false, partial: true, createdKey: "TEST-1", createdChildren: [{ key: "TEST-3", role: "FE", summary: "[FE] Remark", description: "Body" }], errors: ["QA failed"] });
    },
  });
  app.callbacks.onProjectChange("TEST");
  app.callbacks.onAddChildTasks(0);
  assert.equal(app.state.createDialog.mode, "children");
  assert.equal(app.state.createDialog.parentKey, "TEST-1");
  assert.ok(app.state.createDialog.childTasks.every(task => !task.enabled));
  app.callbacks.onConfirmCreate();
  assert.equal(calls.length, 0);
  assert.match(app.state.error, /Выберите/);
  app.callbacks.onDialogChildToggle(1, true);
  app.callbacks.onConfirmCreate();
  app.callbacks.onConfirmCreate();
  await flush();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.childTasks.filter(task => task.enabled).length, 1);
  assert.equal(calls[0].options.summary, "Remark");
  assert.equal(app.state.rows[0].createdKey, "TEST-1");
  assert.equal(app.state.rows[0].status, "partial");
  assert.equal(app.state.rows[0].childStatuses[0].key, "TEST-3");
  assert.equal(app.state.rows[0].createdChildren[0].key, "TEST-3");
  assert.deepEqual(Array.from(app.state.rows[0].errors), ["QA failed"]);
});

test("child confirmation reads current Jira priority before invoking creator", async function () {
  const calls = [];
  let resolveParent;
  const app = await loadImporter([{
    jiraKey: "TEST-1", summary: "Remark", storyDetails: { priority: "Low" },
    sourceColumns: { "Приоритет": "Высокий" },
  }], {
    getIssuesByKeys(keys) {
      calls.push(["read", plain(keys)]);
      return new Promise(resolve => { resolveParent = resolve; });
    },
  }, {
    createAdditionalTasks(_api, _row, options) {
      calls.push(["create", plain(options)]);
      return Promise.resolve({ ok: true, createdKey: "TEST-1", createdChildren: [], errors: [] });
    },
  });
  app.callbacks.onAddChildTasks(0);
  app.callbacks.onDialogChildToggle(0, true);
  app.callbacks.onConfirmCreate();
  await flush();
  assert.deepEqual(calls, [["read", ["TEST-1"]]]);
  resolveParent({ issues: [{ key: "TEST-1", fields: { priority: { name: "Highest" } } }] });
  await flush(); await flush();
  assert.equal(calls.length, 2);
  assert.equal(calls[1][1].parentPriority, "Highest");
  assert.equal(app.state.rows[0].status, "created");
});

for (const change of ["project", "workbook", "row"]) {
  test("child confirmation cancels before writes when " + change + " changes during parent read", async function () {
    let resolveParent, creates = 0;
    const row = { jiraKey: "TEST-1", summary: "Remark", sourceColumns: {} };
    const app = await loadImporter([row], {
      getIssuesByKeys() { return new Promise(resolve => { resolveParent = resolve; }); },
    }, {
      createAdditionalTasks() { creates++; return Promise.resolve({ ok: true, createdKey: "TEST-1", createdChildren: [], errors: [] }); },
    });
    const confirmedRow = app.state.rows[0];
    app.callbacks.onProjectChange("TEST");
    app.callbacks.onAddChildTasks(0);
    app.callbacks.onDialogChildToggle(0, true);
    app.callbacks.onConfirmCreate();
    await flush();
    assert.equal(app.state.createDialog, null, "Submitting closes the dialog before the read completes");
    assert.equal(confirmedRow.status, "creating");
    if (change === "project") app.callbacks.onProjectChange("OTHER");
    else if (change === "workbook") {
      app.callbacks.onFileChange({ name: "replacement.xlsx" });
      await flush(); await flush();
    } else app.state.rows[0] = { jiraKey: "TEST-1", summary: "Replacement", sourceColumns: {} };
    resolveParent({ issues: [parentPriorityIssue("TEST-1")] });
    await flush(); await flush();
    assert.equal(creates, 0);
    assert.notEqual(confirmedRow.status, "creating", "The old row must not stay locked");
  });
}

for (const scenario of [
  { name: "missing issue", response: { issues: [] } },
  { name: "wrong issue", response: { issues: [{ key: "TEST-2", fields: { priority: { name: "High" } } }] } },
  { name: "missing priority", response: { issues: [{ key: "TEST-1", fields: {} }] } },
  { name: "blank priority", response: { issues: [{ key: "TEST-1", fields: { priority: { name: "  " } } }] } },
  { name: "read failure", error: new Error("offline") },
]) {
  test("child confirmation blocks writes on " + scenario.name + " and can retry", async function () {
    let reads = 0, creates = 0;
    const app = await loadImporter([{
      jiraKey: "TEST-1", summary: "Remark", storyDetails: { priority: "Low" },
      sourceColumns: { "Приоритет": "Высокий" },
    }], {
      getIssuesByKeys() {
        reads++;
        return reads === 1
          ? scenario.error ? Promise.reject(scenario.error) : Promise.resolve(scenario.response)
          : Promise.resolve({ issues: [{ key: "TEST-1", fields: { priority: { name: "Medium" } } }] });
      },
    }, {
      createAdditionalTasks(_api, _row, options) {
        creates++;
        assert.equal(options.parentPriority, "Medium");
        return Promise.resolve({ ok: true, createdKey: "TEST-1", createdChildren: [], errors: [] });
      },
    });
    app.callbacks.onAddChildTasks(0);
    app.callbacks.onDialogChildToggle(0, true);
    app.callbacks.onConfirmCreate();
    await flush(); await flush();
    assert.equal(creates, 0);
    assert.equal(app.state.rows[0].status, "failed");
    assert.match(app.state.rows[0].errors.join(" "), /приоритет|priority/i);
    app.callbacks.onAddChildTasks(0);
    app.callbacks.onDialogChildToggle(0, true);
    app.callbacks.onConfirmCreate();
    await flush(); await flush();
    assert.equal(reads, 2);
    assert.equal(creates, 1);
  });
}

test("failed parent link metadata and child key survive a later Jira sync", async function () {
  const app = await loadImporter([{ jiraKey: "TEST-1", summary: "Remark", sourceColumns: {} }], {
    getIssuesByKeys: () => Promise.resolve({ issues: [{ key: "TEST-1", fields: { summary: "Story", issuetype: { name: "Story" }, priority: { name: "High" }, issuelinks: [] } }] }),
  }, {
    createAdditionalTasks: () => Promise.resolve({
      ok: false, partial: true, createdKey: "TEST-1", errors: ["link denied"],
      createdChildren: [{ key: "TEST-3", role: "FE", summary: "[FE] Remark", linkedToParent: false, linkError: "link denied" }],
    }),
  });
  app.callbacks.onAddChildTasks(0);
  app.callbacks.onDialogChildToggle(1, true);
  app.callbacks.onConfirmCreate();
  await flush();
  assert.equal(app.state.rows[0].childStatuses[0].linkedToParent, false);
  assert.equal(app.state.rows[0].childStatuses[0].linkError, "link denied");
  app.callbacks.onSyncJira();
  await flush(); await flush();
  assert.equal(app.state.rows[0].childStatuses[0].key, "TEST-3");
  assert.equal(app.state.rows[0].childStatuses[0].linkedToParent, false);
  assert.equal(app.state.rows[0].createdChildren[0].key, "TEST-3");
});

test("failed-link child remains visible after manual registry refresh", async function () {
  const app = await loadImporter([], {
    getProjectIssues: () => Promise.resolve({ issues: [{ key: "TEST-1", fields: { summary: "Story", issuetype: { name: "Story" }, issuelinks: [] } }] }),
    getIssuesByKeys: keys => Promise.resolve({ issues: keys.indexOf("TEST-1") !== -1 ? [parentPriorityIssue("TEST-1")] : [] }),
  }, {
    createAdditionalTasks: () => Promise.resolve({
      ok: false, partial: true, createdKey: "TEST-1", errors: ["link denied"],
      createdChildren: [{ key: "TEST-3", role: "FE", summary: "[FE] Story", linkedToParent: false, linkError: "link denied" }],
    }),
  });
  app.callbacks.onProjectChange("TEST");
  app.callbacks.onViewModeChange("jira");
  app.callbacks.onLoadRegistry();
  await flush(); await flush();
  app.callbacks.onAddChildTasks(0);
  app.callbacks.onDialogChildToggle(1, true);
  app.callbacks.onConfirmCreate();
  await flush();
  app.callbacks.onLoadRegistry();
  await flush(); await flush();
  assert.equal(app.state.rows[0].childStatuses[0].key, "TEST-3");
  assert.equal(app.state.rows[0].childStatuses[0].linkedToParent, false);
  assert.equal(app.state.rows[0].childStatuses[0].linkError, "link denied");
});

for (const scope of ["project", "epic"]) {
  test("Jira-only created children survive a " + scope + " scope round trip", async function () {
    const app = await loadImporter([], {
      getProjectIssues: (project, epic) => Promise.resolve({ issues: [{
        key: project !== "TEST" ? "OTHER-1" : epic ? "TEST-2" : "TEST-1",
        fields: { summary: "Story", issuetype: { name: "Story" }, issuelinks: [] },
      }] }),
      getIssuesByKeys: keys => Promise.resolve({ issues: keys.indexOf("TEST-1") !== -1 ? [parentPriorityIssue("TEST-1")] : [] }),
    }, {
      createAdditionalTasks: () => Promise.resolve({
        ok: false, partial: true, createdKey: "TEST-1", errors: ["link denied"],
        createdChildren: [{ key: "TEST-3", role: "FE", summary: "[FE] Story", linkedToParent: false, linkError: "link denied" }],
      }),
    });
    app.callbacks.onProjectChange("TEST");
    app.callbacks.onViewModeChange("jira");
    app.callbacks.onLoadRegistry();
    await flush(); await flush();
    app.callbacks.onAddChildTasks(0);
    app.callbacks.onDialogChildToggle(1, true);
    app.callbacks.onConfirmCreate();
    await flush();
    if (scope === "project") app.callbacks.onProjectChange("OTHER");
    else app.callbacks.onEpicSelect("TEST-99");
    app.callbacks.onLoadRegistry();
    await flush(); await flush();
    assert.equal(app.state.rows[0].childStatuses.length, 0, "Other parents must not inherit child records");
    if (scope === "project") app.callbacks.onProjectChange("TEST");
    else app.callbacks.onEpicSelect("");
    app.callbacks.onLoadRegistry();
    await flush(); await flush();
    assert.equal(app.state.rows[0].createdChildren.length, 1);
    assert.equal(app.state.rows[0].childStatuses[0].key, "TEST-3");
    assert.equal(app.state.rows[0].childStatuses[0].linkedToParent, false);
    assert.equal(app.state.rows[0].childStatuses[0].linkError, "link denied");
  });
}

test("controller passes existing Story to real creator and creates only selected child", async function () {
  const payloads = [];
  const links = [];
  const app = await loadImporter([{ jiraKey: "TEST-1", summary: "Source remark", sourceColumns: {} }], {
    createIssue(payload) {
      payloads.push(plain(payload));
      return Promise.resolve({ key: "TEST-2" });
    },
    createIssueLink(payload) { links.push(plain(payload)); return Promise.resolve({}); },
    getIssueLinkTypes: () => Promise.resolve({ issueLinkTypes: [{ name: "Child", outward: "child of", inward: "parent of" }] }),
    getIssueWithHistory: key => Promise.resolve(parentPriorityIssue(key)),
  });
  app.callbacks.onProjectChange("TEST");
  app.callbacks.onAddChildTasks(0);
  app.callbacks.onDialogChildToggle(0, true);
  app.callbacks.onConfirmCreate();
  await flush(); await flush(); await flush();
  assert.equal(payloads.length, 1);
  assert.match(payloads[0].fields.summary, /Source remark/);
  assert.equal(payloads[0].fields.priority.name, "High");
  assert.equal(links.length, 1);
  assert.equal(app.state.rows[0].createdKey, "TEST-1");
  assert.equal(app.state.rows[0].childStatuses[0].key, "TEST-2");
});

test("existing parent supplies child project when no project is selected", async function () {
  const calls = [];
  const app = await loadImporter([{ jiraKey: "TEST-1", summary: "Remark", sourceColumns: {} }], {
    getIssueWithHistory: key => Promise.resolve(parentPriorityIssue(key)),
  }, {
    createAdditionalTasks(_api, _row, options) {
      calls.push(options);
      return Promise.resolve({ ok: true, createdKey: "TEST-1", createdChildren: [], errors: [] });
    },
  });
  app.callbacks.onAddChildTasks(0);
  assert.equal(app.state.createDialog.projectKey, "TEST");
  app.callbacks.onDialogChildToggle(0, true);
  app.callbacks.onConfirmCreate();
  await flush();
  assert.equal(calls[0].projectKey, "TEST");
});

test("synchronous child creator failure releases the row for retry", async function () {
  const app = await loadImporter([{ jiraKey: "TEST-1", summary: "Remark", sourceColumns: {} }], {
    getIssueWithHistory: key => Promise.resolve(parentPriorityIssue(key)),
  }, {
    createAdditionalTasks() { throw new Error("transport setup failed"); },
  });
  app.callbacks.onAddChildTasks(0);
  app.callbacks.onDialogChildToggle(0, true);
  app.callbacks.onConfirmCreate();
  await flush();
  assert.equal(app.state.rows[0].status, "failed");
  assert.match(app.state.rows[0].errors[0], /transport setup failed/);
  app.callbacks.onAddChildTasks(0);
  assert.equal(app.state.createDialog.mode, "children");
});

test("create preview and edits keep remark numbers through confirmation without altering source text", async function () {
  const calls = [];
  const row = { id: "internal-999", excelRowNumber: 123, summary: "Source remark", sourceColumns: { "№": 42, "Замечание": "Source remark" } };
  const app = await loadImporter([row], {
    createIssue(payload) { calls.push(plain(payload.fields)); return Promise.resolve({ key: "TEST-" + calls.length }); },
    createIssueLink: () => Promise.resolve({}),
  });
  app.callbacks.onProjectChange("TEST");
  app.callbacks.onCreateRow(0);
  assert.equal(calls.length, 0);
  assert.equal(app.state.createDialog.summary, "№42 Source remark");
  assert.equal(app.state.createDialog.childTasks[0].summary, "[SE] №42 Source remark");
  assert.equal(app.state.createDialog.sourceRows.find(source => source.name === "Замечание").value, "Source remark");
  app.callbacks.onDialogFieldChange("summary", "Edited Story");
  assert.equal(app.state.createDialog.summary, "№42 Edited Story");
  assert.equal(app.state.createDialog.childTasks[0].summary, "[SE] №42 Edited Story");
  app.callbacks.onDialogChildChange(0, "summary", "Edited child");
  assert.equal(app.state.createDialog.childTasks[0].summary, "[SE] №42 Edited child");
  const preview = plain(app.state.createDialog);
  app.callbacks.onConfirmCreate();
  await flush();
  await flush();
  assert.equal(calls[0].summary, preview.summary);
  assert.deepEqual(calls.slice(1).map(fields => fields.summary), preview.childTasks.map(task => task.summary));
  assert.equal(row.summary, "Source remark");
  const count = calls.length;
  app.callbacks.onCreateRow(0);
  app.callbacks.onConfirmCreate();
  await flush();
  assert.equal(calls.length, count);
});
