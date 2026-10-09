const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const load = require("./helpers/load-amd-module");
const flush = () => new Promise(resolve => setImmediate(resolve));
function commentsHarness(initial, readComments) {
  const api=load(path.join(__dirname,"../ujg-excel-story-importer-modules/activity-loader.js"),{});
  const accepted=[], completed=[], calls=[];
  const issue={key:"P-1",fields:{comment:initial}};
  const loader=api.create({read:()=>Promise.resolve(issue),readComments:(key,offset)=>{calls.push([key,offset]);return readComments(key,offset);},
    accept:(key,value)=>accepted.push(value),onComplete:value=>completed.push(value)});
  return {loader,accepted,completed,calls,issue};
}
test("comment hydration reads every page and skips already complete envelopes",async()=>{
  const x=commentsHarness({startAt:0,total:3,comments:[{id:"a",body:"a"}]},(_key,offset)=>Promise.resolve({startAt:offset,total:3,
    comments:offset===0?[{id:"a",body:"a"},{id:"b",body:"b"}]:[{id:"c",body:"c"}]}));
  x.loader.select(["P-1"]);await flush();await flush();
  assert.deepEqual(x.calls,[["P-1",0],["P-1",2]]);
  assert.deepEqual(Array.from(x.accepted[0].fields.comment.comments,c=>c.id),["a","b","c"]);
  assert.equal(x.issue.fields.comment.comments.length,1,"Never mutate the API's source envelope");
  const empty=commentsHarness({startAt:0,total:0,comments:[]},()=>{throw new Error("unexpected");});
  empty.loader.select(["P-1"]);await flush();assert.equal(empty.calls.length,0);
});
test("comment page failure preserves observed entries with explicit incomplete diagnostics and allows retry",async()=>{
  let fail=true;
  const x=commentsHarness({startAt:0,total:3,comments:[]},(_key,offset)=>{
    if(offset>0&&fail)return Promise.reject(new Error("offline"));
    return Promise.resolve({startAt:offset,total:3,comments:offset===0?[{id:"a"},{id:"b"}]:[{id:"c"}]});
  });
  x.loader.select(["P-1"]);await flush();await flush();
  assert.equal(x.accepted[0].fields.comment.comments.length,2);
  assert.equal(x.accepted[0].fields.comment.isLast,false);
  assert.match(x.accepted[0].fields.comment.loadError,/комментар/i);
  assert.equal(x.completed[0].failures.length,1);
  fail=false;x.loader.select(["P-1"]);await flush();await flush();
  assert.equal(x.accepted[1].fields.comment.comments.length,3);
  assert.equal(x.completed[1].failures.length,0);
});
test("malformed comment pagination cannot be certified complete",async()=>{
  for(const page of [{startAt:1,total:2,comments:[{id:"a"},{id:"b"}]},{startAt:0,total:3,comments:[{id:"a"},{id:"b"}]},
    {startAt:0,total:2,comments:[{id:"a"},{id:"a"}]},{startAt:0,total:2,comments:[]}]) {
    const x=commentsHarness({startAt:0,total:2,comments:[]},()=>Promise.resolve(page));
    x.loader.select(["P-1"]);await flush();await flush();
    assert.equal(x.accepted[0].fields.comment.isLast,false);
    assert.equal(x.completed[0].failures.length,1);
    assert.equal(x.calls.length,1);
  }
});
test("cancellation during comment pagination prevents further reads and acceptance",async()=>{
  let resolvePage;
  const x=commentsHarness({startAt:0,total:2,comments:[]},()=>new Promise(resolve=>{resolvePage=resolve;}));
  x.loader.select(["P-1"]);await flush();
  assert.equal(x.calls.length,1);x.loader.cancel();
  resolvePage({startAt:0,total:2,comments:[{id:"a"}]});await flush();await flush();
  assert.equal(x.calls.length,1);assert.equal(x.accepted.length,0);assert.equal(x.completed.length,0);
});
test("issue read timestamp precedes slow comment pagination",async()=>{
  let resolvePage;
  const x=commentsHarness({startAt:0,total:1,comments:[]},()=>new Promise(resolve=>{resolvePage=resolve;}));
  x.loader.select(["P-1"]);await flush();
  const beforePages=Date.now();await new Promise(resolve=>setTimeout(resolve,15));
  resolvePage({startAt:0,total:1,comments:[{id:"a"}]});await flush();
  assert.ok(Date.parse(x.accepted[0]._activityReadAt)<=beforePages);
});
test("comment page failure retains initial evidence missing from successful pages",async()=>{
  const x=commentsHarness({startAt:0,total:4,comments:[{id:"a",body:"old"},{id:"b"},{id:"c"}]},(_key,start)=>
    start===0 ? Promise.resolve({startAt:0,total:4,comments:[{id:"a",body:"new"}]}) : Promise.reject(new Error("offline")));
  x.loader.select(["P-1"]);await flush();await flush();
  const comments=x.accepted[0].fields.comment;
  assert.deepEqual(Array.from(comments.comments,c=>c.id),["a","b","c"]);
  assert.equal(comments.comments[0].body,"new");
  assert.equal(comments.isLast,false);
  assert.match(comments.loadError,/offline/);
});
test("different comment snapshots cannot expose a total below retained evidence",async()=>{
  const x=commentsHarness({startAt:0,total:3,comments:[{id:"a"},{id:"b"}]},(_key,start)=>
    start===0 ? Promise.resolve({startAt:0,total:3,comments:[{id:"c"},{id:"d"}]}) : Promise.reject(new Error("offline")));
  x.loader.select(["P-1"]);await flush();await flush();
  const comments=x.accepted[0].fields.comment;
  assert.equal(comments.comments.length,4);
  assert.equal(comments.total,null);
  assert.equal(comments.isLast,false);
});
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
