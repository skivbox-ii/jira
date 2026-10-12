const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const load = require('./helpers/load-amd-module');
const file = path.join(__dirname, '../ujg-excel-story-importer-modules/status-transition.js');
const plain = x => JSON.parse(JSON.stringify(x));
function transition(extra = {}) { return {id:'21', name:'Start', to:{id:'3',name:'In Progress'}, fields:{}, ...extra}; }
function deferred() { let resolve; const promise = new Promise(r => resolve=r); return {promise, resolve}; }
function setup(options = {}) {
  const reads=[], writes=[], snapshots=[];
  let transitions=[transition()], scope='a', allowed=true;
  const issue={key:'TEST-1', fields:{status:{name:'Actual'}, assignee:null, resolution:null, updated:'2026-10-12'},changelog:{histories:[]}};
  const api={
    getIssueTransitions:key => {reads.push(key); return Promise.resolve({transitions});},
    transitionIssue:(key,id) => {writes.push([key,id]); return Promise.resolve();},
    getIssueWithHistory:() => Promise.resolve(issue), ...options.api
  };
  const module = fs.existsSync(file) ? load(file,{}) : {};
  assert.equal(typeof module.create,'function','status controller must exist');
  const controller=module.create({api, scope:()=>scope, canOperate:()=>allowed, onSnapshot:i=>snapshots.push(i)});
  return {controller,api,reads,writes,snapshots,issue,setTransitions:x=>transitions=x,setScope:x=>scope=x,setAllowed:x=>allowed=x};
}
test('selection is read-only; Apply rechecks and then reads the actual issue once', async () => {
  const a=setup(); await a.controller.open('TEST-1'); a.controller.select('21');
  assert.equal(a.writes.length,0); await a.controller.apply();
  assert.deepEqual(a.reads,['TEST-1','TEST-1']);
  assert.deepEqual(a.writes,[['TEST-1','21']]); assert.equal(a.snapshots[0],a.issue);
  assert.equal(a.controller.getState().outcome,'success');
  await a.controller.apply(); assert.equal(a.writes.length,1);
});
test('extra fields and incomplete or invalid metadata never permit POST', async () => {
  for (const metadata of [transition({fields:{resolution:{name:'Resolution',required:true}}}),
    transition({fields:undefined}),transition({fields:null}),transition({fields:[]}),transition({id:'../21'}),transition({to:null})]) {
    const a=setup(); a.setTransitions([metadata]); await a.controller.open('TEST-1'); a.controller.select('21'); await a.controller.apply();
    assert.equal(a.writes.length,0);
  }
  const a=setup(); a.setTransitions([transition({fields:{resolution:{name:'Resolution',required:true}}})]);
  await a.controller.open('TEST-1');
  assert.deepEqual(plain(a.controller.getState().transitions[0].fields),[{name:'Resolution',required:true}]);
});
test('removed, changed or newly complex transition requires fresh selection', async () => {
  for (const next of [[],[transition({to:{id:'4',name:'Testing'}})],[transition({name:'Changed'})],
    [transition({fields:{resolution:{name:'Resolution'}}})]]) {
    const a=setup(); await a.controller.open('TEST-1'); a.controller.select('21'); a.setTransitions(next); await a.controller.apply();
    assert.equal(a.writes.length,0); assert.equal(a.controller.getState().selectedId,null);
    assert.match(a.controller.getState().message,/измен|недоступ/i);
  }
});
test('single flight and context guard prevent retargeting while Apply is pending', async () => {
  const wait=deferred(), a=setup({api:{transitionIssue:()=>wait.promise}});
  await a.controller.open('TEST-1'); a.controller.select('21'); const applying=a.controller.apply();
  assert.equal(a.controller.apply(),false); assert.equal(a.controller.close(),false);
  assert.equal(a.controller.open('TEST-2'),false); a.setScope('b'); wait.resolve(); await applying;
  assert.equal(a.snapshots.length,0);
  const b=setup(); await b.controller.open('TEST-1'); b.controller.select('21'); b.setScope('b'); await b.controller.apply();
  assert.equal(b.writes.length,0);
});
test('success with failed readback offers read only recovery and no optimistic snapshot', async () => {
  const a=setup({api:{getIssueWithHistory:()=>Promise.reject(new Error('private'))}});
  await a.controller.open('TEST-1'); a.controller.select('21'); await a.controller.apply();
  assert.equal(a.controller.getState().outcome,'refresh-failed'); assert.equal(a.snapshots.length,0);
  assert.match(a.controller.getState().message,/запис|выполн|успеш/i);
  a.api.getIssueWithHistory=()=>Promise.resolve(a.issue); await a.controller.refresh();
  assert.equal(a.writes.length,1); assert.equal(a.snapshots.length,1);
});
test('ambiguous writes survive close/reopen and can only recover by reading', async () => {
  const a=setup({api:{transitionIssue:()=>{a.writes.push('attempt'); return Promise.reject({status:0,responseText:'private'});}}});
  await a.controller.open('TEST-1'); a.controller.select('21'); await a.controller.apply();
  assert.equal(a.controller.getState().outcome,'unconfirmed');
  assert.equal(JSON.stringify(a.controller.getState()).includes('private'),false);
  a.controller.close(); await a.controller.open('TEST-1'); a.controller.select('21'); await a.controller.apply();
  assert.equal(a.writes.length,1); await a.controller.refresh(); assert.equal(a.writes.length,1);
  assert.equal(a.controller.getState().outcome,'unconfirmed'); assert.equal(a.snapshots.length,1);
});
test('4xx rejection is sanitized and requires fresh selection', async () => {
  const a=setup({api:{transitionIssue:()=>Promise.reject({status:400,responseJSON:{errorMessages:['secret']}})}});
  await a.controller.open('TEST-1'); a.controller.select('21'); await a.controller.apply();
  assert.equal(a.controller.getState().outcome,'rejected'); assert.match(a.controller.getState().message,/HTTP 400/);
  assert.equal(a.controller.getState().selectedId,null); assert.equal(JSON.stringify(a.controller.getState()).includes('secret'),false);
});
test('read failure retries, empty is explicit, close aborts stale GET and invalid keys never read', async () => {
  const a=setup(); for (const key of ['',null,'../TEST-1','TEST-0']) assert.equal(a.controller.open(key),false);
  assert.equal(a.reads.length,0); a.setAllowed(false); assert.equal(a.controller.open('TEST-1'),false); a.setAllowed(true);
  a.api.getIssueTransitions=()=>Promise.reject(new Error('private')); await a.controller.open('TEST-1');
  assert.equal(a.controller.getState().outcome,'load-failed');
  a.api.getIssueTransitions=()=>Promise.resolve({transitions:[]}); await a.controller.retry();
  assert.equal(a.controller.getState().outcome,'empty');
  const wait=deferred(); let aborted=0; wait.promise.abort=()=>{aborted++;}; a.api.getIssueTransitions=()=>wait.promise;
  const pending=a.controller.retry(); a.controller.close(); wait.resolve({transitions:[transition()]}); await pending;
  assert.equal(aborted,1); assert.equal(a.controller.getState().open,false);
});
test('wrong issue readback cannot update data; duplicate metadata cannot allow a write', async () => {
  const a=setup({api:{getIssueWithHistory:()=>Promise.resolve({key:'TEST-2',fields:{status:{name:'Wrong'}}})}});
  await a.controller.open('TEST-1'); a.controller.select('21'); await a.controller.apply(); assert.equal(a.snapshots.length,0);
  assert.equal(a.controller.getState().outcome,'refresh-failed');
  const b=setup(); b.setTransitions([transition(),transition()]); await b.controller.open('TEST-1'); b.controller.select('21'); await b.controller.apply();
  assert.equal(b.writes.length,0);
});
test('uncertain write remains guarded after source scope changes and retry cannot remove the guard', async () => {
  const a=setup({api:{transitionIssue:()=>{a.writes.push('attempt');return Promise.reject({status:503});}}});
  await a.controller.open('TEST-1');a.controller.select('21');await a.controller.apply();
  a.controller.close();a.setScope('another source');await a.controller.open('TEST-1');
  assert.equal(a.controller.getState().outcome,'unconfirmed');await a.controller.retry();
  assert.equal(a.controller.getState().outcome,'unconfirmed');a.controller.select('21');await a.controller.apply();
  assert.equal(a.writes.length,1);
});
test('close cancels stale preflight before POST, and actual readback must include history completeness', async () => {
  const a=setup();await a.controller.open('TEST-1');a.controller.select('21');
  const wait=deferred();a.api.getIssueTransitions=()=>wait.promise;
  const applying=a.controller.apply();a.setScope('changed');wait.resolve({transitions:[transition()]});await applying;
  assert.equal(a.writes.length,0);
  const b=setup({api:{getIssueWithHistory:()=>Promise.resolve({key:'TEST-1',fields:{status:{name:'Open'},assignee:null,resolution:null,updated:'now'},changelog:{}})}});
  await b.controller.open('TEST-1');b.controller.select('21');await b.controller.apply();
  assert.equal(b.controller.getState().outcome,'refresh-failed');assert.equal(b.snapshots.length,0);
});

for (const status of [408,499]) {
  for (const committed of [false,true]) {
    test(`HTTP ${status} preserves read-only recovery after reopen when backend committed=${committed}`, async () => {
      const a=setup();
      let attempts=0, sideEffects=0, readbacks=0;
      a.issue.fields.status.name='Open';
      a.api.transitionIssue=()=>{
        attempts++;
        if (committed) { sideEffects++;a.issue.fields.status.name='Changed on server'; }
        return Promise.reject({status,responseText:'private proxy response'});
      };
      a.api.getIssueWithHistory=()=>{readbacks++;return Promise.resolve(a.issue);};
      await a.controller.open('TEST-1');a.controller.select('21');await a.controller.apply();
      assert.equal(a.snapshots.length,0,'uncertain response cannot publish an optimistic snapshot');
      assert.equal(readbacks,0);
      a.controller.close();await a.controller.open('TEST-1');a.controller.select('21');await a.controller.apply();
      assert.equal(attempts,1,'reopening and applying cannot send another uncertain POST');
      assert.equal(a.controller.getState().outcome,'unconfirmed');
      assert.equal(JSON.stringify(a.controller.getState()).includes('private'),false);
      await a.controller.refresh();
      assert.equal(readbacks,1,'recovery remains available and performs only a read');
      assert.equal(a.snapshots.length,1);
      assert.equal(a.snapshots[0].fields.status.name,committed ? 'Changed on server' : 'Open');
      a.controller.close();a.setScope('another source');await a.controller.open('TEST-1');
      a.controller.select('21');await a.controller.apply();await a.controller.retry();
      assert.equal(a.controller.getState().outcome,'unconfirmed');
      assert.equal(readbacks,2,'generic retry also stays read-only');
      assert.equal(attempts,1);assert.equal(sideEffects,committed ? 1 : 0);
    });
  }
}

test('unknown or malformed client HTTP statuses cannot establish write rejection', async () => {
  for (const status of [470,400.5,'400']) {
    const a=setup({api:{transitionIssue:()=>Promise.reject({status})}});
    await a.controller.open('TEST-1');a.controller.select('21');await a.controller.apply();
    assert.equal(a.controller.getState().outcome,'unconfirmed',String(status));
    await a.controller.refresh();assert.equal(a.snapshots.length,1);
  }
});

test('known Jira rejection statuses allow a fresh explicit selection after revalidation', async () => {
  for (const status of [400,401,403,404,405,409,422]) {
    const a=setup();let attempts=0;
    a.api.transitionIssue=()=>{attempts++;return Promise.reject({status,responseText:'private rejection'});};
    await a.controller.open('TEST-1');a.controller.select('21');await a.controller.apply();
    assert.equal(a.controller.getState().outcome,'rejected',String(status));
    assert.equal(a.controller.getState().selectedId,null);
    await a.controller.apply();assert.equal(attempts,1);
    a.controller.select('21');await a.controller.apply();
    assert.equal(attempts,2);assert.equal(a.reads.length,3,'both explicit writes recheck available transitions');
    assert.equal(JSON.stringify(a.controller.getState()).includes('private'),false);
  }
});
