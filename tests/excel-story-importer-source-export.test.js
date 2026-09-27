const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const load = require('./helpers/load-amd-module');
const dir = path.join(__dirname, '../ujg-excel-story-importer-modules');
const file = path.join(dir, 'source-export.js');
const engine = fs.existsSync(file) ? load(file, {}) : {};
function envelope(member, entries) { return {startAt:0,total:entries.length,[member]:entries}; }
function issue(key) {
  return {key, fields:{summary:key,description:' full description\n ',created:'2026-09-25T22:30:00Z',updated:'2026-09-27T09:00:00Z',
    status:{name:'Open',statusCategory:{key:'new'}},assignee:{name:'owner',displayName:'Owner'},creator:{name:'creator'},
    issuelinks:[],subtasks:[],comment:envelope('comments',[]),worklog:envelope('worklogs',[])},changelog:envelope('histories',[])};
}
function fixture(overrides={}) {
  const calls=[], a=issue('P-1'), b=issue('P-2');
  const reader={requests:[],plan:['GET /search'],readStories:async start=>{calls.push(['search',start]);return {startAt:start,total:1,issues:[{key:'P-1'}]};},
    readIssue:async key=>{calls.push(['issue',key]);return key==='P-1'?a:b;},
    readPage:async(key,kind,start)=>{calls.push([kind,key,start]);throw new Error('Unexpected page');},...overrides};
  return {a,b,calls,reader,options:{scope:{projectKey:'P',epicKey:'P-99'},journalRows:[{jiraKey:'P-1',sourceColumns:{'№':'52','Срок':'01.10.2026'}}],teams:[],children:i=>i.key==='P-1'?['P-2','P-2']:[]}};
}
test('exports fresh raw issues exactly once and leaves inputs intact',async()=>{
  assert.equal(typeof engine.collect,'function');
  const x=fixture(),before=JSON.stringify(x.a); const data=await engine.collect(x.reader,x.options);
  assert.equal(data.issues.length,2);assert.equal(data.coverage.complete,true);
  assert.deepEqual(x.calls.filter(x=>x[0]==='issue'),[['issue','P-1'],['issue','P-2']]);
  assert.equal(JSON.stringify(x.a),before);assert.equal(data.issues[0].raw.fields.description,' full description\n ');
  assert.deepEqual(JSON.parse(JSON.stringify(data.parents)),[{key:'P-1',children:['P-2']}]);
  assert.equal(data.journalRows[0].sourceColumns['№'],'52');
});
test('uncapped story pagination validates totals and retains inaccessible keys',async()=>{
  const x=fixture({readStories:async start=>({startAt:start,total:2,issues:[{key:start?'P-3':'P-1'}]}),readIssue:async key=>{if(key==='P-3')throw {status:403};return issue(key);}});
  const data=await engine.collect(x.reader,x.options);
  assert.equal(data.coverage.expectedIssues,3);assert.equal(data.coverage.loadedIssues,2);assert.equal(data.coverage.complete,false);
  assert.ok(data.errors.some(e=>e.key==='P-3'));assert.deepEqual(Array.from(data.parentKeys),['P-1','P-3']);
});
test('comments and worklogs page fully; original embedded envelopes are retained',async()=>{
  const x=fixture();x.a.fields.comment={startAt:0,total:2,comments:[{id:'1',created:'2026-09-26T22:00:00Z',body:' first '}]};
  x.reader.readPage=async(key,kind,start)=>({startAt:start,total:2,[kind]:[{id:String(start+1),created:'2026-09-26T22:00:00Z',body:start?' last\ncomment ':' first '}]});
  const data=await engine.collect(x.reader,x.options),a=data.issues.find(i=>i.key==='P-1');
  assert.equal(a.raw.fields.comment.comments.length,1);assert.equal(a.collections.comments.entries.length,2);assert.equal(a.collections.comments.complete,true);
  assert.match(engine.text(data,'2026-09-27'),/ last\ncomment /);
});
test('duplicate, drifting or empty pages never masquerade as complete',async()=>{
  for(const bad of ['duplicate','total','empty']) {
    const x=fixture();x.a.fields.comment={startAt:0,total:2,comments:[]};
    x.reader.readPage=async(key,kind,start)=>({startAt:start,total:bad==='total'?3:2,[kind]:bad==='empty'?[]:[{id:bad==='duplicate'?'same':String(start),created:'2026-09-26T10:00:00Z',body:'x'}]});
    const data=await engine.collect(x.reader,x.options);
    assert.equal(data.coverage.complete,false,bad);assert.equal(data.issues[0].collections.comments.complete,false,bad);
  }
});
test('partial changelog is paginated and every raw field change preserved',async()=>{
  const x=fixture();x.a.changelog={startAt:0,total:2,histories:[]};
  x.reader.readPage=async(key,kind,start)=>({startAt:start,total:2,values:[{id:String(start+1),created:'2026-09-26T21:00:00Z',author:{displayName:'Actor'},items:[{field:'description',fromString:'old',toString:'x'.repeat(25000)}]}]});
  const data=await engine.collect(x.reader,x.options);
  assert.equal(data.issues[0].collections.histories.entries.length,2);
  const text=engine.text(data,'2026-09-27');assert.ok(text.includes('x'.repeat(25000)));assert.match(text,/Actor/);
});
test('daily MSK export separates work date from record creation and emits all date metadata',async()=>{
  const x=fixture();x.a.fields.worklog=envelope('worklogs',[{id:'w',author:{name:'worker',displayName:'Worker'},started:'2026-09-25T22:00:00Z',created:'2026-09-27T10:00:00Z',updated:'2026-09-27T11:00:00Z',timeSpentSeconds:5400,comment:'work note'}]);
  const data=await engine.collect(x.reader,x.options);
  assert.ok(engine.days(data).includes('2026-09-26'));
  assert.match(engine.text(data,'2026-09-26'),/5400.*1 ч 30 мин/);
  assert.match(engine.text(data,'2026-09-26'),/Worker/);
  assert.match(engine.text(data,'2026-09-27'),/WORKLOG_CREATED/);
  assert.match(engine.text(data,'2026-09-27'),/WORKLOG_UPDATED/);
  assert.match(engine.text(data,'2026-09-26'),/2026-09-27T10:00:00Z/);
});
test('invalid timestamps stay visible as undated records and cannot establish full coverage',async()=>{
  const x=fixture();x.a.changelog=envelope('histories',[{id:'bad',created:'not-date',items:[{field:'status',toString:'Done'}]}]);
  const data=await engine.collect(x.reader,x.options);
  assert.ok(engine.days(data).includes('unknown'));assert.match(engine.text(data,'unknown'),/not-date/);
  assert.equal(data.coverage.complete,false);
});
test('cancellation stops subsequent reads and is not swallowed into successful partial result',async()=>{
  const x=fixture();let stop=false;const read=x.reader.readIssue;x.reader.readIssue=async key=>{stop=true;return read(key);};
  await assert.rejects(engine.collect(x.reader,{...x.options,isCancelled:()=>stop}),/отмен/i);
  assert.equal(x.calls.filter(x=>x[0]==='issue').length,1);
});
test('missing child links or contradictory discovery cannot yield a complete export',async()=>{
  const x=fixture();x.options.children=()=>{throw new Error('Child link unavailable');};
  const data=await engine.collect(x.reader,x.options);assert.equal(data.coverage.complete,false);assert.ok(data.errors.length);
});
test('only explicit source metadata is retained, not configuration or transport secrets',async()=>{
  const x=fixture();const data=await engine.collect(x.reader,{...x.options,llmConfig:{apiKey:'SECRET'},authorization:'TOKEN'});
  assert.doesNotMatch(JSON.stringify(data),/SECRET|TOKEN|llmConfig/);
  assert.match(engine.text(data),/GET \/search/);
  assert.match(engine.text(data),/P-99/);
});
test('explicit isLast false contradicts apparently complete totals',async()=>{
  for(const paged of [false,true]) {
    const x=fixture();x.a.fields.comment={startAt:0,total:paged?1:0,isLast:false,comments:[]};
    x.reader.readPage=async()=>({startAt:0,total:1,isLast:false,comments:[{id:'1',created:'2026-09-27T10:00:00Z',body:'x'}]});
    const d=await engine.collect(x.reader,x.options);assert.equal(d.coverage.complete,false);assert.equal(d.issues[0].collections.comments.complete,false);
  }
});
test('failed pagination keeps already embedded records visible, even malformed ones',async()=>{
  const x=fixture();x.a.fields.comment={startAt:0,total:3,comments:[{id:'embedded',created:'2026-09-27T10:00:00Z',body:'embedded evidence'},null]};
  const d=await engine.collect(x.reader,x.options);assert.equal(d.coverage.complete,false);
  assert.match(engine.text(d,'2026-09-27'),/embedded evidence/);assert.ok(engine.days(d).includes('unknown'));
});
test('nested child tasks are collected once even with shared links or cycles',async()=>{
 const x=fixture({readIssue:async key=>issue(key)});x.options.children=i=>({'P-1':['P-2'],'P-2':['P-3'],'P-3':['P-1']}[i.key]);
 const d=await engine.collect(x.reader,x.options);assert.equal(d.issues.length,3);assert.equal(d.relationships.length,3);assert.equal(d.parents.length,1);
});
test('embedded records absent from a later complete page remain dated evidence and flag disagreement',async()=>{
 const x=fixture();x.a.fields.comment={startAt:0,total:0,comments:[{id:'e',created:'2026-09-27T10:00:00Z',body:'lost evidence'}]};
 x.reader.readPage=async()=>({startAt:0,total:0,comments:[]});
 const d=await engine.collect(x.reader,x.options);assert.equal(d.coverage.complete,false);assert.match(engine.text(d,'2026-09-27'),/lost evidence/);
});
