const test = require("node:test");
const assert = require("node:assert/strict");
const {JSDOM,ResourceLoader,VirtualConsole} = require("jsdom");

test("offline component preview writes only one explicitly selected Story", async t => {
  const errors=[], virtualConsole=new VirtualConsole();
  virtualConsole.on("jsdomError",error=>errors.push(error.message));
  class LocalResources extends ResourceLoader {
    fetch(url,options){assert.equal(new URL(url).hostname,"127.0.0.1");return super.fetch(url,options);}
  }
  const dom=await JSDOM.fromURL("http://127.0.0.1:4317/",{runScripts:"dangerously",resources:new LocalResources(),virtualConsole,
    beforeParse(w){
      w.scrollTo=()=>{};w.setImmediate=setImmediate;w.clearImmediate=clearImmediate;
      w.localStorage.setItem("ujg-esi-mapping-settings",JSON.stringify({mappings:{moduleComponentMap:{"МЭК":"АСУТП","Интерфейс":"Алармы"}}}));
      w.File.prototype.arrayBuffer=function(){return new Promise((resolve,reject)=>{const r=new w.FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsArrayBuffer(this);});};
      w.fetch=url=>{const target=new URL(url,"http://127.0.0.1:4317/");assert.equal(target.hostname,"127.0.0.1");return fetch(target);};
    }});
  t.after(()=>dom.window.close());
  const w=dom.window,doc=w.document,query=selector=>doc.querySelector(selector);
  async function until(check){const end=Date.now()+15000;while(!check()&&Date.now()<end)await new Promise(resolve=>setTimeout(resolve,20));
    assert.ok(check(),JSON.stringify({errors:errors,progress:query(".ujg-esi-due-progress")&&query(".ujg-esi-due-progress").textContent,
      rows:doc.querySelectorAll(".ujg-esi-due-row").length,ready:doc.querySelectorAll(".ujg-esi-due-row-select:not(:disabled)").length}));}
  await until(()=>query(".ujg-esi-sync-component") && !query(".ujg-esi-sync-component").disabled);
  query(".ujg-esi-sync-component").click();
  await until(()=>query(".ujg-esi-due-dialog") && !query(".ujg-esi-due-progress"));
  assert.equal(w.componentWriteCalls.length,0);
  const ready=doc.querySelectorAll(".ujg-esi-due-row-select:not(:disabled)");
  assert.ok(ready.length>1,JSON.stringify({rows:doc.querySelectorAll(".ujg-esi-due-row").length,dialog:query(".ujg-esi-due-dialog").textContent.slice(0,700)}));
  query(".ujg-esi-due-select-all").click();
  assert.equal(doc.querySelectorAll(".ujg-esi-due-row-select:checked").length,0);
  assert.equal(query(".ujg-esi-due-confirm").disabled,true);
  query(".ujg-esi-due-row-select:not(:disabled)").click();
  const chosen=query(".ujg-esi-due-row-select:checked").closest("tr").querySelector("a").textContent;
  const before=w.fixtureIssues[chosen].fields.components.map(component=>component.id);
  assert.match(query(".ujg-esi-due-foot").textContent,/полный набор заменится/);
  query(".ujg-esi-due-confirm").click();
  await until(()=>!query(".ujg-esi-due-close").disabled);
  assert.deepEqual(Array.from(w.componentWriteCalls,call=>call.key),[chosen]);
  assert.equal(w.mutationCalls,1);
  assert.deepEqual(Array.from(w.fixtureIssues[chosen].fields.components,component=>component.id),Array.from(w.componentWriteCalls[0].ids));
  assert.notDeepEqual(Array.from(w.fixtureIssues[chosen].fields.components,component=>component.id),before);
  assert.ok(query(".ujg-esi-due-result.is-updated"));
  assert.deepEqual(errors,[]);
});
