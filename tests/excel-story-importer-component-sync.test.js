const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const load = require("./helpers/load-amd-module");
const modulePath = path.join(__dirname, "..", "ujg-excel-story-importer-modules/component-sync.js");
function row(id, key, module) { return {id, jiraKey:key, summary:"Story " + id, sourceColumns:{"Модуль":module}}; }
function client() {
  const components = {"P-1":[{id:"200",name:"Old"}],"P-2":[]};
  const writes = [], reads = [];
  return {components,writes,reads,
    getProjectComponents: async () => [{id:"100",name:"New"},{id:"200",name:"Old"}],
    getIssueComponents: async key => { reads.push(key); return {key,fields:{project:{key:"P"},issuetype:{name:"Story"},summary:key,components:components[key]}}; },
    updateIssueComponents: async (key,ids) => { writes.push([key,ids]); components[key] = ids.map(id=>({id})); },
  };
}
function engine(api, options = {}) { return load(modulePath, {}).create({api,...options}); }

test("preview replaces full set with singleton, defaults selected, and writes only after confirmation", async () => {
  const api = client(), sync = engine(api);
  await sync.open([row(1,"P-1","A"),row(2,"P-2","A")],{projectKey:"P",moduleComponentMap:{A:"New"}});
  assert.equal(api.writes.length,0);
  assert.deepEqual(Array.from(sync.getState().rows,r=>r.selected),[true,true]);
  assert.deepEqual(Array.from(sync.getState().rows[0].oldComponents),["Old"]);
  assert.deepEqual(Array.from(sync.getState().rows[0].newComponents),["New"]);
  sync.select(2,false);
  await sync.confirm();
  assert.deepEqual(JSON.parse(JSON.stringify(api.writes)),[["P-1",["100"]]]);
  assert.equal(sync.getState().rows[0].status,"updated");
});

test("invalid mapping, duplicate conflict, wrong project, missing field, and child skip", async () => {
  const api = client();
  api.getIssueComponents = async key => ({key,fields:{project:{key:key==="P-3"?"OTHER":"P"},issuetype:{name:key==="P-4"?"Sub-task":"Story"},components:key==="P-5"?undefined:[]}});
  const sync = engine(api);
  await sync.open([row(1,"P-1",""),row(2,"P-2","Missing"),row(3,"P-3","A"),row(4,"P-4","A"),row(5,"P-5","A"),row(6,"P-6","A"),row(7,"P-6","B")],{projectKey:"P",moduleComponentMap:{A:"New",B:"Old"}});
  assert.deepEqual(Array.from(sync.getState().rows,r=>r.status),["skipped","skipped","skipped","skipped","skipped","conflict"]);
  assert.equal(api.writes.length,0);
});

test("preflight conflict prevents PUT and uncertain response is not retried automatically", async () => {
  const api = client(), sync = engine(api);
  await sync.open([row(1,"P-1","A")],{projectKey:"P",moduleComponentMap:{A:"New"}});
  api.components["P-1"] = [{id:"200",name:"Old"},{id:"100",name:"New"}];
  await sync.confirm();
  assert.equal(sync.getState().rows[0].status,"conflict");
  assert.equal(api.writes.length,0);
  await sync.open([row(1,"P-1","A")],{projectKey:"P",moduleComponentMap:{A:"New"}});
  api.updateIssueComponents = async () => { api.writes.push(1); throw new Error("network"); };
  await sync.confirm();
  assert.equal(sync.getState().rows[0].status,"unconfirmed");
  assert.equal(api.writes.length,1);
});

test("confirmation rereads catalog and skips removed or renamed desired component", async () => {
  const api = client(), sync = engine(api);
  await sync.open([row(1,"P-1","A")],{projectKey:"P",moduleComponentMap:{A:"New"}});
  api.getProjectComponents = async () => [{id:"200",name:"Old"}];
  await sync.confirm();
  assert.equal(api.writes.length,0);
  assert.equal(sync.getState().rows[0].status,"conflict");
});

test("preview cancellation ignores stale issue responses and bounds read concurrency", async () => {
  const api = client(), held=[];
  api.getIssueComponents = key => new Promise(resolve => held.push({key,resolve}));
  const sync = engine(api);
  const pending=sync.open(Array.from({length:6},(_,i)=>row(i+1,"P-"+(i+1),"A")),{projectKey:"P",moduleComponentMap:{A:"New"}});
  for(let i=0;i<10 && held.length<3;i++) await new Promise(resolve=>setImmediate(resolve));
  assert.equal(held.length,3);
  assert.equal(sync.close(),true);
  held.forEach(({key,resolve})=>resolve({key,fields:{project:{key:"P"},issuetype:{name:"Story"},components:[]}}));
  await pending;
  assert.equal(held.length,3);
  assert.equal(sync.getState().open,false);
});

test("localized Story identity is eligible while another issue type remains blocked", async () => {
  const api=client(), sync=engine(api);
  api.getIssueComponents=async key=>({key,fields:{project:{key:"P"},issuetype:{name:key==="P-1"?"История":"Задача разработки"},components:[]}});
  await sync.open([row(1,"P-1","A"),row(2,"P-2","A")],{projectKey:"P",moduleComponentMap:{A:"New"}});
  assert.deepEqual(Array.from(sync.getState().rows,r=>r.status),["ready","skipped"]);
});

test("large preview reports bounded progress without redrawing every resolved row", async () => {
  const api=client(), states=[], sync=engine(api,{onChange:state=>states.push(state)});
  api.getIssueComponents=async key=>({key,fields:{project:{key:"P"},issuetype:{name:"Story"},components:[]}});
  await sync.open(Array.from({length:70},(_,i)=>row(i+1,"P-"+(i+1),"A")),{projectKey:"P",moduleComponentMap:{A:"New"}});
  assert.equal(sync.getState().loading,false);
  assert.equal(sync.getState().rows.filter(item=>item.eligible).length,70);
  assert.ok(states.length<15,`preview emitted ${states.length} full table renders`);
});

test("duplicate Jira key with different source modules blocks even when both map to one component", async () => {
  const api=client(),sync=engine(api);
  await sync.open([row(1,"P-1","A"),row(2,"P-1","B")],{projectKey:"P",moduleComponentMap:{A:"New",B:"New"}});
  assert.equal(sync.getState().rows.length,1);
  assert.equal(sync.getState().rows[0].status,"conflict");
  assert.equal(api.writes.length,0);
});

test("ambiguous normalized mapping keys block while identical targets coalesce", async () => {
  const api=client(),sync=engine(api);
  await sync.open([row(1,"P-1","A")],{projectKey:"P",moduleComponentMap:{A:"New",a:"Old"}});
  assert.equal(sync.getState().rows[0].status,"conflict");
  assert.equal(api.writes.length,0);
  await sync.open([row(1,"P-1","A")],{projectKey:"P",moduleComponentMap:{A:"New",a:" new "}});
  assert.equal(sync.getState().rows[0].status,"ready");
  await sync.open([row(1,"P-1","A")],{projectKey:"P",moduleComponentMap:{A:"",a:"New"}});
  assert.equal(sync.getState().rows[0].status,"conflict");
});
