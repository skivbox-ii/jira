const test=require("node:test");
const assert=require("node:assert/strict");
const load=require("./helpers/load-amd-module");
const storeModule=load(require("node:path").join(__dirname,"../ujg-excel-story-importer-modules/activity-store.js"),{});
test("report cache keeps six recent reports and clears the whole published dataset",()=>{
  const store=storeModule.create(); let calls=0;
  const get=key=>store.get(key,()=>({key,version:++calls}));
  const a=get("a"); get("b"); assert.equal(get("a"),a);
  for(const key of ["c","d","e","f","g"])get(key);
  assert.equal(get("a"),a,"recently visited report retained");
  assert.equal(get("b").version,8,"oldest report evicted");
  store.clear(); assert.notEqual(get("a"),a);
});
test("failed calculations do not poison cache or evict a valid report",()=>{
  const store=storeModule.create(), report={};
  store.get("ok",()=>report);
  assert.throws(()=>store.get("bad",()=>{throw Error("no data");}));
  assert.equal(store.get("ok",()=>assert.fail()),report);
  assert.equal(store.get("bad",()=>42),42);
});
