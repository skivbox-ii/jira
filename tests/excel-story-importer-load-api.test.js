const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const load=require('./helpers/load-amd-module');
function setup(transport) { return load(path.join(__dirname,'../ujg-excel-story-importer-modules/api.js'),{jquery:{ajax:transport},_ujgESI_config:{baseUrl:'/jira',EPIC_LINK_FIELD:'customfield_1'}}); }
test('Story and linked search advance by actual server cap and report real request pages',async()=>{
  const calls=[],rows=[];
  const api=setup(opts=>{const body=JSON.parse(opts.data);calls.push(body);assert.equal(opts.timeout,30000);
    return Promise.resolve({startAt:body.startAt,total:63,issues:Array.from({length:Math.min(25,63-body.startAt)},(_,i)=>({key:'P-'+(body.startAt+i+1)}))});});
  const stories=await api.getProjectIssues('P','',{onRequest:row=>rows.push({...row})});
  assert.equal(stories.issues.length,63); assert.deepEqual(calls.map(x=>x.startAt),[0,25,50]);assert.equal(calls[0].maxResults,200);
  assert.equal(rows.filter(x=>x.state==='completed').length,3);assert.equal(rows.at(-1).received,13);
  calls.length=0;rows.length=0;
  const linked=await api.getIssuesByKeys(Array.from({length:63},(_,i)=>'P-'+(i+1)),{onRequest:row=>rows.push({...row})});
  assert.equal(linked.issues.length,63);assert.deepEqual(calls.map(x=>x.startAt),[0,25,50]);assert.equal(rows.at(-1).state,'completed');
});
test('zero and invalid search pages reject instead of certifying a partial snapshot',async()=>{
  for(const page of [{startAt:0,total:2,issues:[]},{startAt:1,total:2,issues:[{key:'P-1'}]},{startAt:0,total:'bad',issues:[]}]) {
    const rows=[],api=setup(()=>Promise.resolve(page));
    await assert.rejects(api.getProjectIssues('P','',{onRequest:row=>rows.push({...row})}));assert.equal(rows.at(-1).state,'error');
  }
});
test('abort invalidates an unabortable page and prevents scheduling subsequent pages',async()=>{
  let resolve;const calls=[],rows=[],api=setup(opts=>{calls.push(opts);return new Promise(r=>resolve=r);});
  const request=api.getProjectIssues('P','',{onRequest:row=>rows.push({...row})});
  assert.equal(typeof request.abort,'function');request.abort();
  await assert.rejects(request,error=>error.name==='AbortError');
  resolve({startAt:0,total:5,issues:[{key:'P-1'}]});await new Promise(r=>setImmediate(r));
  assert.equal(calls.length,1);assert.equal(rows.at(-1).state,'cancelled');
});
test('Story limit stays 1000 with honest truncation under a smaller server cap',async()=>{
  const calls=[],api=setup(opts=>{const b=JSON.parse(opts.data);calls.push(b);return Promise.resolve({startAt:b.startAt,total:1003,issues:Array.from({length:Math.min(25,b.maxResults)},(_,i)=>({key:'P-'+(b.startAt+i)}))});});
  const value=await api.getProjectIssues('P');assert.equal(value.issues.length,1000);assert.equal(value.truncated,true);assert.equal(value.total,1003);assert.equal(calls.length,40);
});
test('repeated issue keys in capped pages cannot certify a full registry',async()=>{
  const api=setup(opts=>{const b=JSON.parse(opts.data);return Promise.resolve({startAt:b.startAt,total:2,issues:[{key:'P-1'}]});});
  await assert.rejects(api.getProjectIssues('P'),/повтор|страниц/i);
});
test('linked lookup keeps 253 keys in bounded batches while honoring cap25 in every batch',async()=>{
  const calls=[],rows=[],api=setup(opts=>{const b=JSON.parse(opts.data),keys=b.jql.match(/key in \(([^)]+)\)/)[1].split(', ');
    calls.push(b);assert.ok(keys.length<=100);assert.ok(b.maxResults<=100);
    return Promise.resolve({startAt:b.startAt,total:keys.length,issues:keys.slice(b.startAt,b.startAt+25).map(key=>({key}))});});
  const result=await api.getIssuesByKeys(Array.from({length:253},(_,i)=>'P-'+(i+1)),{onRequest:r=>rows.push({...r})});
  assert.equal(result.issues.length,253);assert.deepEqual(calls.map(b=>b.startAt),[0,25,50,75,0,25,50,75,0,25,50]);
  assert.equal(rows.filter(r=>r.state==='completed').length,11);assert.equal(rows.at(-1).received,3);
});
test('summary matching exposes only actual read pages and can be aborted before a late reply',async()=>{
  let resolve;const rows=[],calls=[],api=setup(opts=>{calls.push(opts);return new Promise(r=>resolve=r);});
  const request=api.searchIssueBySummary('P','same summary',{onRequest:r=>rows.push({...r})});
  assert.equal(calls[0].timeout,30000);assert.equal(rows[0].stage,'summary');assert.equal(rows[0].requested,10);
  request.abort();await assert.rejects(request,e=>e.name==='AbortError');resolve({startAt:0,total:1,issues:[{key:'P-1'}]});
  await new Promise(r=>setImmediate(r));assert.equal(rows.at(-1).state,'cancelled');assert.equal(calls.length,1);
});
