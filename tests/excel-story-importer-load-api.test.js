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
test('explicit registry profile uses light 50 pages and retries only a timed-out offset once at 25',async()=>{
  const calls=[];let timed=false;
  const api=setup(opts=>{const b=JSON.parse(opts.data);calls.push(b);
    if(b.startAt===50&&!timed){timed=true;return Promise.reject({statusText:'timeout'});}
    return Promise.resolve({startAt:b.startAt,total:101,issues:Array.from({length:Math.min(b.maxResults,101-b.startAt)},(_,i)=>({key:'P-'+(b.startAt+i+1)}))});});
  const result=await api.getProjectIssues('P','',{profile:'registry',pageSize:50,timeoutRetrySize:25,expand:null});
  assert.equal(result.issues.length,101);
  assert.deepEqual(calls.map(b=>[b.startAt,b.maxResults]),[[0,50],[50,50],[50,25],[75,50]]);
  for(const b of calls){assert.ok(b.fields.includes('description'));assert.ok(b.fields.includes('updated'));assert.ok(!b.fields.includes('comment'));assert.ok(!b.fields.includes('worklog'));assert.equal(b.expand,undefined);}
});
test('registry timeout recovery is bounded and abort during recovery prevents further pages',async()=>{
  let calls=0;const api=setup(()=>{calls++;return Promise.reject({statusText:'timeout'});});
  await assert.rejects(api.getProjectIssues('P','',{profile:'registry',pageSize:50,timeoutRetrySize:25,expand:null}));assert.equal(calls,2);
  let resolve;const bodies=[];const other=setup(opts=>{bodies.push(JSON.parse(opts.data));if(bodies.length===1)return Promise.reject({statusText:'timeout'});return new Promise(r=>resolve=r);});
  const request=other.getProjectIssues('P','',{profile:'registry',pageSize:50,timeoutRetrySize:25,expand:null});await new Promise(r=>setImmediate(r));
  request.abort();await assert.rejects(request,e=>e.name==='AbortError');resolve({startAt:0,total:30,issues:[{key:'P-1'}]});await new Promise(r=>setImmediate(r));assert.equal(bodies.length,2);
});
test('registry history requests minimal age validation fields while default full readers retain collections',async()=>{
  const calls=[],api=setup(opts=>{calls.push(opts);return Promise.resolve({});});
  await api.getIssueWithHistory('P-1',{profile:'registry-history'});await api.getIssueWithHistory('P-1');
  assert.equal(calls[0].data.fields,'status,updated,created');assert.equal(calls[0].data.expand,'changelog');
  assert.ok(calls[1].data.fields.includes('comment'));assert.ok(calls[1].data.fields.includes('worklog'));
});
test('linked registry lookups explicitly omit heavy data; HTTP errors never consume the timeout retry',async()=>{
  const calls=[],api=setup(opts=>{const b=JSON.parse(opts.data);calls.push(b);const keys=b.jql.match(/key in \(([^)]+)\)/)[1].split(', ');return Promise.resolve({startAt:b.startAt,total:keys.length,issues:keys.slice(b.startAt,b.startAt+b.maxResults).map(key=>({key}))});});
  const result=await api.getIssuesByKeys(Array.from({length:101},(_,i)=>'P-'+(i+1)),{profile:'registry',pageSize:50,timeoutRetrySize:25,expand:null});assert.equal(result.issues.length,101);
  assert.deepEqual(calls.map(b=>b.startAt),[0,50,0]);for(const b of calls){assert.equal(b.maxResults,50);assert.ok(!b.fields.includes('comment'));assert.ok(!b.fields.includes('worklog'));assert.equal(b.expand,undefined);}
  let reads=0;const broken=setup(()=>{reads++;return Promise.reject({status:502,statusText:'Bad Gateway'});});await assert.rejects(broken.getProjectIssues('P','',{profile:'registry',pageSize:50,timeoutRetrySize:25,expand:null}));assert.equal(reads,1);
});
test('multi epic search normalizes a set into one project constrained IN query',async()=>{
  const calls=[],api=setup(opts=>{calls.push(JSON.parse(opts.data));return Promise.resolve({startAt:0,total:0,issues:[]});});
  await api.getProjectIssues('P',[' P-20 ','P-10','P-20','']);
  assert.match(calls[0].jql,/project = P AND issuetype = Story AND cf\[1\] IN \(P-10, P-20\)/);
  await api.getProjectIssues('P','P-10');assert.match(calls[1].jql,/cf\[1\] = P-10/);
  await api.getProjectIssues('P',[]);assert.doesNotMatch(calls[2].jql,/cf\[/);
});
test('selected epics reject an unconfigured link field instead of reading the entire project',async()=>{
  const api=load(path.join(__dirname,'../ujg-excel-story-importer-modules/api.js'),{jquery:{ajax:()=>{throw Error('must not read');}},_ujgESI_config:{baseUrl:'/jira'}});
  await assert.rejects(async()=>api.getProjectIssues('P',['P-1','P-2']),/эпик/i);
});
