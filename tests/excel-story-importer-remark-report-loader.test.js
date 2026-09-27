const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const load = require("./helpers/load-amd-module");
const file = path.join(__dirname,"../ujg-excel-story-importer-modules/remark-report-loader.js");
const clone = value => JSON.parse(JSON.stringify(value));
function issue(key, children=[]) {
  return {key,children,fields:{updated:"2026-09-27T12:00:00Z",comment:{startAt:0,total:0,comments:[]},worklog:{startAt:0,total:0,worklogs:[]}},changelog:{startAt:0,total:0,histories:[]}};
}
function setup(overrides={}) {
  const calls=[], progress=[], parent=issue("P-1",["P-2"]), child=issue("P-2");
  const deps={
    readIssue:async key=>{calls.push(["issue",key]);return clone(key==="P-1" ? parent : child);},
    readComments:async(key,start)=>{calls.push(["comments",key,start]);return {startAt:start,total:2,comments:[{id:String(start+1),body:"Комментарий "+(start+1)}]};},
    readWorklogs:async(key,start)=>{calls.push(["worklogs",key,start]);return {startAt:start,total:0,worklogs:[]};},
    children:value=>value.children || [],...overrides
  };
  return {loader:load(file,{}).create(deps),calls,progress,parent,child,options:{onProgress:value=>progress.push(value)}};
}
test("loads only selected original story and its children and rechecks parent",async()=>{
  const x=setup(), result=await x.loader.load("P-1",x.options);
  assert.deepEqual(x.calls,[["issue","P-1"],["issue","P-2"],["issue","P-2"],["issue","P-1"]]);
  assert.equal(result.parent.key,"P-1");assert.equal(result.children[0].key,"P-2");
  assert.equal(result.warnings.length,0);assert.ok(Date.parse(result.asOf));
  assert.ok(x.progress.some(v=>v.phase==="comments"));
});
test("reads all comment pages without truncation or mutation",async()=>{
  const x=setup();x.child.fields.comment={startAt:0,total:2,comments:[{id:"1",body:"Комментарий 1"}]};
  const result=await x.loader.load("P-1",x.options);
  assert.deepEqual(x.calls.filter(c=>c[0]==="comments"),[["comments","P-2",0],["comments","P-2",1]]);
  assert.equal(result.children[0].fields.comment.comments.length,2);
  assert.equal(result.children[0].fields.comment.total,2);
  assert.equal(x.child.fields.comment.comments.length,1);
  assert.equal(result.warnings.length,0);
});
for (const [name,page] of [
  ["empty",{startAt:0,total:2,comments:[]}],
  ["wrong offset",{startAt:1,total:1,comments:[{id:"a"}]}],
  ["duplicate",{startAt:0,total:2,comments:[{id:"a"},{id:"a"}]}],
  ["invalid total",{startAt:0,total:null,comments:[]}]
]) test("incomplete comment collection blocks explicitly: "+name,async()=>{
  const x=setup({readComments:async()=>page});delete x.parent.fields.comment;
  const result=await x.loader.load("P-1",x.options);
  assert.match(result.warnings.join(" "),/P-1.*комментар/i);
  assert.notEqual(result.parent.fields.comment && result.parent.fields.comment.total,0);
});
test("changing totals and HTTP failures do not produce complete comment envelope",async()=>{
  for (const fail of [false,true]) {
    const x=setup({readComments:async(_key,start)=>{if(fail)throw new Error("secret internal response");return {startAt:start,total:start?3:2,comments:[{id:String(start)}]};}});
    delete x.parent.fields.comment;
    const result=await x.loader.load("P-1",x.options);
    assert.ok(result.warnings.length);assert.doesNotMatch(result.warnings.join(),/secret/);
  }
});
test("child updated while comments are paginating is blocked even when parent stayed unchanged",async()=>{
  let childReads=0;
  const x=setup({readIssue:async key=>{
    const value=issue(key,key==="P-1"?["P-2"]:[]);
    if(key==="P-2") {
      value.fields.comment={startAt:0,total:2,comments:[]};
      if(++childReads>1)value.fields.updated="2026-09-27T12:01:00Z";
    }
    return value;
  }});
  const result=await x.loader.load("P-1",x.options);
  assert.match(result.warnings.join(),/P-2.*изменил/);
});
test("early child changes while later children load are detected by the final revision pass",async()=>{
  let laterLoaded=false;
  const x=setup({readIssue:async key=>{
    const value=issue(key,key==="P-1"?["P-2","P-3"]:[]);
    if(key==="P-3")laterLoaded=true;
    if(key==="P-2" && laterLoaded)value.fields.updated="2026-09-27T12:01:00Z";
    return value;
  }});
  const result=await x.loader.load("P-1",x.options);
  assert.match(result.warnings.join(),/P-2.*изменил/);
});
for(const change of ["body","id","updated"]) test("same-count comment revision is detected without an issue updated change: "+change,async()=>{
  let count=0;
  const x=setup({readIssue:async key=>{
    const value=issue(key,key==="P-1"?["P-2"]:[]);
    if(key==="P-2") {
      const comment={id:"c1",body:"Проверено",updated:"2026-09-27T10:00:00Z"};
      if(++count===2)comment[change]="changed";
      value.fields.comment={startAt:0,total:1,comments:[comment]};
    }
    return value;
  }});
  const result=await x.loader.load("P-1",x.options);
  assert.match(result.warnings.join(),/P-2.*комментар/);
});
test("first comment page total cannot replace a different initial issue total silently",async()=>{
  const x=setup();x.child.fields.comment={startAt:0,total:3,comments:[]};
  const result=await x.loader.load("P-1",x.options);
  assert.match(result.warnings.join(),/P-2.*комментар/);
});
test("partial worklogs remain unknown without failing available narrative",async()=>{
  const x=setup({readWorklogs:async()=>{throw new Error("not allowed");}});delete x.child.fields.worklog;
  const result=await x.loader.load("P-1",x.options);
  assert.equal(result.warnings.length,0);assert.equal(result.children[0].fields.worklog,undefined);
});
test("failed child remains a blocker; wrong response key rejected",async()=>{
  for (const wrong of [false,true]) {
    const x=setup({readIssue:async key=>{if(key==="P-1")return issue(key,["P-2"]);if(wrong)return issue("P-3");throw new Error("private");}});
    const result=await x.loader.load("P-1",x.options);
    assert.match(result.warnings.join(),/P-2/);assert.equal(result.children.length,0);
  }
});
test("concurrent parent revision or relation changes block snapshot",async()=>{
  for (const field of ["updated","children"]) {
    let count=0;const x=setup({readIssue:async key=>{
      const value=issue(key,key==="P-1"?["P-2"]:[]);
      if(key==="P-1" && ++count===2) {if(field==="updated")value.fields.updated="2026-09-27T12:01:00Z";else value.children=[];}return value;
    }});
    const result=await x.loader.load("P-1",x.options);assert.match(result.warnings.join(),/изменил|изменени|изменил|изменен/i);
  }
});
test("cancelled load issues no further reads and key validation precedes network",async()=>{
  const x=setup();await assert.rejects(x.loader.load("P-1",{isCancelled:()=>true}),/отмен/);
  await assert.rejects(x.loader.load("bad/path"),/ключ/i);assert.equal(x.calls.length,0);
});
test("new API resources are read-only and paginated",async()=>{
  const calls=[];const api=load(path.join(__dirname,"../ujg-excel-story-importer-modules/api.js"),{jquery:{ajax:v=>{calls.push(v);return Promise.resolve({});}},_ujgESI_config:{baseUrl:"https://jira.test"}});
  assert.equal(typeof api.getIssueComments,"function");assert.equal(typeof api.getIssueWorklogs,"function");
  await api.getIssueComments("P-1",100);await api.getIssueWorklogs("P-1",0);
  assert.equal(calls[0].url,"https://jira.test/rest/api/2/issue/P-1/comment");
  assert.equal(calls[0].data.startAt,100);assert.equal(calls[0].data.maxResults,100);
  assert.equal(calls[1].url,"https://jira.test/rest/api/2/issue/P-1/worklog");assert.ok(calls.every(c=>c.type==="GET"));
});
