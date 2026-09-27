const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const load=require('./helpers/load-amd-module');
const file=path.join(__dirname,'../ujg-excel-story-importer-modules/source-export-api.js');
function setup(fail=false) {
  const calls=[];
  const engine=fs.existsSync(file)?load(file,{jquery:{ajax:options=>{calls.push(options);return fail?Promise.reject({status:403,responseText:'SECRET'}):Promise.resolve({startAt:0,total:0,issues:[]});}},_ujgESI_config:{baseUrl:'https://jira.test',EPIC_LINK_FIELD:'customfield_10109'}}):{};
  return {engine,calls};
}
test('raw reader uses GET only and all fields; plan precedes requests',async()=>{
  const x=setup();assert.equal(typeof x.engine.create,'function');const r=x.engine.create({projectKey:'P',epicKey:'P-99'});
  assert.equal(x.calls.length,0);assert.match(JSON.stringify(r.plan),/cf\[10109\]/);
  await r.readStories(100);await r.readIssue('P-1');await r.readPage('P-1','histories',100);
  assert.ok(x.calls.every(c=>c.type==='GET'));assert.equal(x.calls[0].data.startAt,100);
  assert.equal(x.calls[1].data.fields,'*all');assert.match(x.calls[2].url,/\/changelog$/);
  assert.equal(r.requests.length,3);assert.ok(r.requests.every(r=>r.finishedAt&&r.durationMs>=0));
});
test('invalid keys and collections cannot issue requests',async()=>{
  const x=setup();assert.equal(typeof x.engine.create,'function');const r=x.engine.create({projectKey:'P'});
  assert.throws(()=>r.readIssue('../secret'));assert.throws(()=>r.readPage('P-1','delete',0));assert.equal(x.calls.length,0);
});
test('failed reads preserve status without response, headers or credentials',async()=>{
  const x=setup(true);assert.equal(typeof x.engine.create,'function');const r=x.engine.create({projectKey:'P'});
  await assert.rejects(r.readIssue('P-1'),/403/);assert.equal(r.requests[0].status,403);
  assert.doesNotMatch(JSON.stringify(r.requests),/SECRET|responseText/);
});
