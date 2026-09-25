const test = require("node:test");
const assert = require("node:assert/strict");
const {JSDOM, ResourceLoader, VirtualConsole} = require("jsdom");

test("due-date preview writes only explicitly selected fixture dates and leaves a visible report", async t => {
  const errors=[], virtualConsole=new VirtualConsole();
  virtualConsole.on("jsdomError",error=>errors.push(error.message));
  class LocalResources extends ResourceLoader {
    fetch(url,options) { assert.equal(new URL(url).hostname,"127.0.0.1"); return super.fetch(url,options); }
  }
  const dom=await JSDOM.fromURL("http://127.0.0.1:4317/",{
    runScripts:"dangerously",resources:new LocalResources(),virtualConsole,
    beforeParse(w) {
      w.scrollTo=()=>{}; w.setImmediate=setImmediate; w.clearImmediate=clearImmediate;
      w.File.prototype.arrayBuffer=function() {
        return new Promise((resolve,reject)=>{const r=new w.FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsArrayBuffer(this);});
      };
      w.fetch=url=>{const target=new URL(url,"http://127.0.0.1:4317/");assert.equal(target.hostname,"127.0.0.1");return fetch(target);};
    }
  });
  t.after(()=>dom.window.close());
  const w=dom.window,doc=w.document;
  async function until(check) {const end=Date.now()+15000;while(!check() && Date.now()<end) await new Promise(r=>setTimeout(r,20));assert.ok(check(),errors.join(" | "));}
  const query=selector=>doc.querySelector(selector);
  await until(()=>query(".ujg-esi-child-row"));
  const parentCount=doc.querySelectorAll(".ujg-esi-parent-row").length;
  query(".ujg-esi-sync-due-date").click();
  await until(()=>query(".ujg-esi-due-dialog") && !query(".ujg-esi-due-progress"));
  assert.equal(w.mutationCalls,0,"Opening the preview is read-only");
  const all=query(".ujg-esi-due-select-all");
  assert.equal(all.checked,true,"Eligible different dates start selected");
  assert.ok(doc.querySelectorAll(".ujg-esi-due-row-select:checked").length>2);
  all.click(); assert.equal(doc.querySelectorAll(".ujg-esi-due-row-select:checked").length,0);
  assert.equal(query(".ujg-esi-due-confirm").disabled,true);
  query(".ujg-esi-due-row-select:not(:disabled)").click();
  assert.equal(query(".ujg-esi-due-select-all").indeterminate,true);
  assert.match(query(".ujg-esi-due-confirm").textContent,/\(1\)/);
  const chosen=query(".ujg-esi-due-row-select:checked").closest("tr").querySelector("a").textContent;
  query(".ujg-esi-due-confirm").click();
  query(".ujg-esi-due-confirm").click();
  assert.equal(query(".ujg-esi-due-close").disabled,true);
  await until(()=>query(".ujg-esi-due-result.is-updated"));
  await until(()=>!query(".ujg-esi-due-close").disabled);
  assert.deepEqual(Array.from(w.dueDateWriteCalls,call=>call.key),[chosen]);
  assert.equal(w.mutationCalls,1);
  assert.ok(query(".ujg-esi-due-dialog"),"Finished report remains open");
  assert.equal(query(".ujg-esi-due-result.is-updated").closest("tr").querySelector("input").disabled,true);
  assert.equal(query(".ujg-esi-due-confirm").disabled,true);
  query(".ujg-esi-due-close").click();
  assert.equal(query(".ujg-esi-due-dialog"),null);
  assert.equal(doc.querySelectorAll(".ujg-esi-parent-row").length,parentCount);
  assert.equal(doc.activeElement,query(".ujg-esi-sync-due-date"));
  assert.deepEqual(errors,[]);
});
