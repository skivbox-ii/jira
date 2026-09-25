const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const load = require("./helpers/load-amd-module");
const dir = path.join(__dirname, "..", "ujg-excel-story-importer-modules");

function engine(api, onChange) {
  return load(path.join(dir, "due-date-sync.js"), {
    _ujgESI_deadlines: load(path.join(dir, "deadlines.js"), {}),
  }).create({api, onChange});
}
function row(id, key, date, extra = {}) {
  return {id, jiraKey:key, summary:"Topic " + id, sourceColumns:{"Срок":date}, ...extra};
}
function api(dates = {}) {
  const reads = [], writes = [];
  return {
    reads, writes,
    getIssueDueDate(key) { reads.push(key); return Promise.resolve({key,fields:{duedate:dates[key] ?? null, summary:"Jira " + key}}); },
    updateIssueDueDate(key, date) { writes.push([key,date]); dates[key] = date; return Promise.resolve({}); },
  };
}
function plain(value) { return JSON.parse(JSON.stringify(value)); }
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return {promise,resolve,reject}; }

test("preview is read-only, Excel-only, frozen, and selection controls all eligible rows", async () => {
  const client = api({"X-1":"2026-09-20", "X-2":"2026-09-25"});
  const states = [], sync = engine(client, state => states.push(plain(state)));
  const rows = [row(1,"X-1","25.09.2026"),row(2,"X-2","25.09.2026"),row(3,"X-3",""),
    row(4,null,"25.09.2026",{storyDetails:{description:"|Срок|25.09.2026|"}}),row(5,"X-5","31.02.2026")];
  await sync.open(rows,{});
  rows[0].sourceColumns["Срок"] = "2026-10-01";
  assert.equal(client.writes.length,0);
  assert.deepEqual(plain(sync.getState().rows.map(r => r.status)),["ready","skipped","skipped","skipped","skipped"]);
  assert.equal(sync.getState().rows[0].newDate,"2026-09-25");
  assert.equal(sync.getState().rows[0].selected,true);
  assert.equal(sync.select(2,true),false);
  sync.selectAll(false);
  assert.equal(sync.getState().rows[0].selected,false);
  sync.selectAll(true);
  assert.equal(sync.getState().rows[0].selected,true);
  assert.ok(states.length >= 3);
  assert.equal(sync.close(),true);
  assert.equal(client.writes.length,0);
});

test("duplicates coalesce, conflicting dates block, and prototype-like keys do not collide", async () => {
  const client = api(); const sync = engine(client);
  await sync.open([row(1,"X-1","25.09.2026"),row(2,"X-1","2026-09-25"),row(3,"X-2","25.09.2026"),
    row(4,"X-2","26.09.2026"),row(5,"toString","25.09.2026"),row(6,"__proto__","25.09.2026")],{});
  assert.equal(client.reads.filter(k => k === "X-1").length,1);
  assert.equal(sync.getState().rows.find(r => r.key === "X-2").status,"conflict");
  assert.equal(sync.getState().rows.find(r => r.key === "X-1").sourceRaw,"25.09.2026; 2026-09-25");
  await sync.confirm();
  assert.deepEqual(client.writes,[ ["X-1","2026-09-25"] ]);
});

test("blank duplicate never clears a dated key and an internal Excel conflict remains visible", async () => {
  const client = api(), sync = engine(client);
  await sync.open([
    row(1,"X-1",""), row(2,"X-1","25.09.2026"),
    row(3,"X-2","25.09.2026",{sourceColumns:{"Срок исполнения":"25.09.2026","Срок устранения":"26.09.2026"}}),
    row(4,"X-3","25.09.2026",{storyDetails:{description:"|Срок|26.09.2026|"}})
  ],{});
  assert.equal(sync.getState().rows.find(r => r.key === "X-1").newDate,"2026-09-25");
  assert.equal(sync.getState().rows.find(r => r.key === "X-2").status,"conflict");
  assert.equal(sync.getState().rows.find(r => r.key === "X-3").newDate,"2026-09-25");
  await sync.confirm();
  assert.deepEqual(client.writes,[["X-1","2026-09-25"],["X-3","2026-09-25"]]);
});

test("missing duedate field and malformed responses cannot become known empty", async () => {
  const client = api(); client.getIssueDueDate = key => Promise.resolve({key,fields:{summary:"No date field"}});
  const sync = engine(client); await sync.open([row(1,"X-1","25.09.2026")],{});
  assert.equal(sync.getState().rows[0].status,"skipped");
  assert.match(sync.getState().rows[0].message,/недоступ|неизвест/i);
  assert.equal(client.writes.length,0);
});

test("open invalidates stale reads and close cancels pending preview queue", async () => {
  const pending = deferred(), client = api();
  client.getIssueDueDate = key => key === "X-1" ? pending.promise : Promise.resolve({key,fields:{duedate:null}});
  const sync = engine(client);
  const old = sync.open([row(1,"X-1","25.09.2026")],{});
  await sync.open([row(2,"X-2","26.09.2026")],{});
  pending.resolve({key:"X-1",fields:{duedate:null}}); await old;
  assert.equal(sync.getState().rows[0].key,"X-2");
  const waiting = deferred(); let reads = 0;
  client.getIssueDueDate = () => { reads++; return waiting.promise; };
  const loading = sync.open([row(3,"X-3","25.09.2026"),row(4,"X-4","25.09.2026"),row(5,"X-5","25.09.2026"),row(6,"X-6","25.09.2026")],{});
  assert.equal(sync.close(),true); waiting.resolve({key:"X-3",fields:{duedate:null}}); await loading;
  assert.equal(reads,3); assert.equal(sync.getState().open,false);
});

test("confirm freezes selection, rejects double click and close while running", async () => {
  const pending = deferred(), client = api(); client.updateIssueDueDate = () => pending.promise;
  const sync = engine(client); await sync.open([row(1,"X-1","25.09.2026"),row(2,"X-2","26.09.2026")],{});
  sync.select(2,false);
  const first = sync.confirm();
  assert.equal(sync.confirm(),false); assert.equal(sync.close(),false);
  assert.equal(sync.selectAll(true),false);
  pending.resolve({}); await first;
  assert.equal(sync.getState().rows[0].status,"updated");
  assert.equal(sync.getState().rows[1].selected,false);
});

test("preflight catches changes, skips already applied values, and retries only failures", async () => {
  const dates = {"X-1":null,"X-2":null,"X-3":null}; const client = api(dates);
  const sync = engine(client); await sync.open([row(1,"X-1","25.09.2026"),row(2,"X-2","25.09.2026"),row(3,"X-3","25.09.2026")],{});
  dates["X-1"] = "2026-09-26"; dates["X-2"] = "2026-09-25";
  let fail = true; client.updateIssueDueDate = (key,date) => { client.writes.push([key,date]); if (key === "X-3" && fail) return Promise.reject(new Error("secret body")); dates[key] = date; return Promise.resolve({}); };
  await sync.confirm();
  assert.deepEqual(plain(sync.getState().rows.map(r => r.status)),["conflict","skipped","unconfirmed"]);
  assert.equal(JSON.stringify(sync.getState()).includes("secret body"),false);
  fail = false; sync.select(3,true); await sync.confirm();
  assert.deepEqual(client.writes,[["X-3","2026-09-25"],["X-3","2026-09-25"]]);
  assert.equal(sync.getState().rows[2].status,"updated");
  assert.equal(sync.select(3,true),false);
  await sync.confirm(); assert.equal(client.writes.length,2);
});

test("uncertain write stays unconfirmed; preflight retry never rewrites an applied date", async () => {
  const dates = {"X-1":null}, client = api(dates); const sync = engine(client);
  await sync.open([row(1,"X-1","25.09.2026")],{});
  client.updateIssueDueDate = () => { dates["X-1"] = "2026-09-25"; return Promise.reject(new Error("network")); };
  await sync.confirm(); assert.equal(sync.getState().rows[0].status,"unconfirmed");
  sync.select(1,true); await sync.confirm();
  assert.equal(sync.getState().rows[0].status,"skipped");
});

test("read and write queues respect limits and synchronous throws are isolated", async () => {
  let activeReads=0,maxReads=0,activeWrites=0,maxWrites=0;
  const client=api();
  client.getIssueDueDate = key => new Promise(resolve => { activeReads++; maxReads=Math.max(maxReads,activeReads); setImmediate(() => { activeReads--; resolve({key,fields:{duedate:null}}); }); });
  client.updateIssueDueDate = key => { if (key === "X-2") throw new Error("private"); return new Promise(resolve => { activeWrites++; maxWrites=Math.max(maxWrites,activeWrites); setImmediate(() => { activeWrites--; resolve({}); }); }); };
  const sync=engine(client); await sync.open(Array.from({length:8},(_,i)=>row(i+1,"X-"+(i+1),"25.09.2026")),{});
  assert.ok(maxReads<=3); await sync.confirm(); assert.ok(maxWrites<=2);
  assert.equal(sync.getState().rows[1].status,"error");
  assert.equal(JSON.stringify(sync.getState()).includes("private"),false);
});

test("preview rejects a response for a different or missing Jira key", async () => {
  const client = api();
  client.getIssueDueDate = key => Promise.resolve({key:key === "X-1" ? "X-2" : undefined,fields:{duedate:null}});
  const sync = engine(client);
  await sync.open([row(1,"X-1","25.09.2026"),row(2,"X-3","25.09.2026")],{});
  assert.deepEqual(plain(sync.getState().rows.map(r => r.status)),["skipped","skipped"]);
  assert.equal(sync.getState().rows.every(r => !r.eligible),true);
  assert.equal(client.writes.length,0);
});

test("preflight rejects a response for another Jira key before PUT", async () => {
  const client = api(), sync = engine(client);
  await sync.open([row(1,"X-1","25.09.2026")],{});
  client.getIssueDueDate = () => Promise.resolve({key:"X-2",fields:{duedate:null}});
  await sync.confirm();
  assert.equal(sync.getState().rows[0].status,"error");
  assert.equal(client.writes.length,0);
});

test("plan IDs are unique and stable with missing, duplicate, and reserved IDs", async () => {
  const client = api(), sync = engine(client);
  const rows = [row(7,"X-1","25.09.2026"),row(7,"X-2","25.09.2026"),
    row(undefined,"X-3","25.09.2026"),row("due-row-2","X-4","25.09.2026")];
  await sync.open(rows,{});
  const ids = sync.getState().rows.map(r => r.id);
  assert.equal(ids[0],7);
  assert.equal(ids[3],"due-row-2");
  assert.equal(new Set(ids.map(String)).size,4);
  assert.equal(sync.select(ids[1],false),true);
  assert.equal(sync.getState().rows[0].selected,true);
  assert.equal(sync.getState().rows[1].selected,false);
  await sync.open(rows,{});
  assert.deepEqual(plain(sync.getState().rows.map(r => r.id)),plain(ids));
});

test("successful update retains preview oldDate for audit", async () => {
  const client = api({"X-1":"2026-09-20"}), sync = engine(client);
  await sync.open([row(1,"X-1","25.09.2026")],{});
  await sync.confirm();
  const result = sync.getState().rows[0];
  assert.equal(result.status,"updated");
  assert.equal(result.oldDate,"2026-09-20");
  assert.equal(result.newDate,"2026-09-25");
});

test("explicit Jira 4xx is error; network and 5xx are unconfirmed without response body leaks", async () => {
  for (const [failure, expected, statusText] of [
    [{status:400,responseText:"private 400 body"},"error","HTTP 400"],
    [{status:403,responseJSON:{errorMessages:["private 403 body"]}},"error","HTTP 403"],
    [{status:503,responseText:"private 503 body"},"unconfirmed","HTTP 503"],
    [{status:0,responseText:"private network body"},"unconfirmed",null]
  ]) {
    const client = api(), sync = engine(client);
    await sync.open([row(1,"X-1","25.09.2026")],{});
    client.updateIssueDueDate = () => Promise.reject(failure);
    await sync.confirm();
    const result = sync.getState().rows[0];
    assert.equal(result.status,expected);
    assert.match(result.message,/[А-Яа-я]/);
    if (statusText) assert.match(result.message,new RegExp(statusText));
    assert.equal(JSON.stringify(sync.getState()).includes("private"),false);
  }
});
