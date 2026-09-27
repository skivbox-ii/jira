const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const load = require("./helpers/load-amd-module");
const flush = () => new Promise(resolve => setImmediate(resolve));
function setup(abortable=false) {
  const api=load(path.join(__dirname,"../ujg-excel-story-importer-modules/activity-loader.js"),{});
  const calls=[], accepted=[], progress=[], completed=[], requests=[];
  const loader=api.create({
    read(key) { let resolve,reject; const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});
      const request={key,resolve,reject,aborted:false};requests.push(request);calls.push(key);
      if(abortable) promise.abort=()=>{request.aborted=true;reject(new Error("aborted"));};
      return promise;
    },
    accept:(key,value)=>accepted.push([key,value]),
    onProgress:value=>progress.push(value), onComplete:value=>completed.push(value)
  });
  return {loader,calls,accepted,progress,completed,requests};
}
test("history coordinator limits concurrency and deduplicates requested keys",async()=>{
  const x=setup();x.loader.select(["A","B","A","C","D"]);await flush();
  assert.deepEqual(x.calls,["A","B","C"]);
  x.requests[0].resolve("a");await flush();assert.deepEqual(x.calls,["A","B","C","D"]);
  x.requests.slice(1).forEach(r=>r.resolve(r.key));await flush();
  assert.equal(x.completed.length,1);assert.equal(x.completed[0].completed,4);
  assert.equal(x.completed[0].total,4);assert.equal(x.accepted.length,4);
});
test("date selection immediately replaces queued work and shares relevant in-flight reads",async()=>{
  const x=setup();x.loader.select(["A","B","C","OLD"]);await flush();
  x.loader.select(["B","NEW"]);await flush();
  assert.deepEqual(x.calls,["A","B","C"]);
  x.requests[0].resolve("a");await flush();
  assert.deepEqual(x.calls,["A","B","C","NEW"]);
  x.requests[1].resolve("b");x.requests[3].resolve("new");await flush();
  assert.equal(x.completed.length,1);assert.equal(x.completed[0].total,2);
  assert.equal(x.completed[0].completed,2);
  x.requests[2].resolve("c");await flush();assert.equal(x.completed.length,1);
});
test("cancel prevents late snapshot acceptance and queued starts",async()=>{
  const x=setup();x.loader.select(["A","B","C","D"]);await flush();
  x.loader.cancel();x.requests.forEach(r=>r.resolve("late"));await flush();
  assert.equal(x.accepted.length,0);assert.equal(x.completed.length,0);
  assert.deepEqual(x.calls,["A","B","C"]);
  x.loader.select(["A"]);await flush();x.requests[3].resolve("new");await flush();
  assert.deepEqual(x.accepted,[["A","new"]]);assert.equal(x.completed.length,1);
});
test("abortable obsolete requests release capacity without aborting shared work",async()=>{
  const x=setup(true);x.loader.select(["A","B","C","OLD"]);await flush();
  x.loader.select(["B","NEW"]);await flush();
  assert.equal(x.requests[0].aborted,true);assert.equal(x.requests[1].aborted,false);
  assert.equal(x.requests[2].aborted,true);assert.equal(x.calls.filter(k=>k==="B").length,1);
  assert.ok(x.calls.includes("NEW"));assert.equal(x.accepted.length,0);
});
test("failures finish once without automatic retries; explicit selection can retry",async()=>{
  const x=setup();x.loader.select(["A","B"]);await flush();
  x.requests[0].reject(new Error("offline"));x.requests[1].resolve("b");await flush();
  assert.equal(x.completed.length,1);assert.equal(x.completed[0].failures[0].key,"A");
  assert.equal(x.completed[0].failures[0].message,"offline");assert.equal(x.calls.length,2);
  x.loader.select(["A"]);await flush();x.requests[2].resolve("a");await flush();
  assert.equal(x.completed.length,2);assert.equal(x.completed[1].failures.length,0);
});
test("old response for same key cannot displace new scope request",async()=>{
  const x=setup();x.loader.select(["A"]);await flush();x.loader.cancel();
  x.loader.select(["A"]);await flush();x.requests[1].resolve("new");await flush();
  x.requests[0].resolve("old");await flush();
  assert.deepEqual(x.accepted,[["A","new"]]);assert.equal(x.completed.length,1);
});
test("a replacement before reads start drops obsolete starts",async()=>{
  const x=setup();x.loader.select(["OLD1","OLD2","OLD3"]);x.loader.select(["NEW"]);await flush();
  assert.deepEqual(x.calls,["NEW"]);
});
test("unneeded non-abortable responses cannot mutate a published selection",async()=>{
  const x=setup();x.loader.select(["OLD","NEW"]);await flush();x.loader.select(["NEW"]);
  x.requests[1].resolve("new");await flush();const count=x.progress.length;
  x.requests[0].resolve("obsolete");await flush();
  assert.deepEqual(x.accepted,[["NEW","new"]]);assert.equal(x.progress.length,count);
});
test("obsolete non-abortable response does not repaint unchanged unfinished progress",async()=>{
  const x=setup();x.loader.select(["OLD","A","B"]);await flush();x.loader.select(["A","B"]);
  const count=x.progress.length;x.requests[0].resolve("obsolete");await flush();
  assert.equal(x.progress.length,count);assert.equal(x.accepted.length,0);
  x.requests[1].resolve("a");x.requests[2].resolve("b");await flush();
  assert.equal(x.completed.length,1);
});
