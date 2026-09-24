const test = require("node:test");
const assert = require("node:assert/strict");
const {JSDOM, ResourceLoader, VirtualConsole} = require("jsdom");

test("the shared preview URL opens a populated tree without manual import or synchronization", async t => {
  const errors = [];
  const console = new VirtualConsole();
  console.on("jsdomError", error => errors.push(error.message));
  class LocalResources extends ResourceLoader {
    fetch(url,options) {
      assert.equal(new URL(url).hostname,"127.0.0.1","Preview must not request live Jira");
      return super.fetch(url,options);
    }
  }
  const dom = await JSDOM.fromURL("http://127.0.0.1:4317/",{
    runScripts:"dangerously",resources:new LocalResources(),virtualConsole:console,
    beforeParse(window) {
      window.scrollTo = () => {};
      // JSZip's postMessage scheduler needs a real event.source, which JSDOM does not provide.
      window.setImmediate = setImmediate;
      window.clearImmediate = clearImmediate;
      window.File.prototype.arrayBuffer = function() {
        const file = this;
        return new Promise((resolve,reject) => {
          const reader = new window.FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = reject;
          reader.readAsArrayBuffer(file);
        });
      };
      window.fetch = url => {
        const target = new URL(url,"http://127.0.0.1:4317/");
        assert.equal(target.hostname,"127.0.0.1");
        return fetch(target);
      };
    }
  });
  t.after(() => dom.window.close());
  const doc = dom.window.document;
  const deadline = Date.now() + 15000;
  while (!doc.querySelector(".ujg-esi-child-row") && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve,20));
  assert.equal(doc.querySelectorAll(".ujg-esi-parent-row").length,50);
  assert.ok(doc.querySelector(".ujg-esi-child-row"), (doc.querySelector(".ujg-esi-sync-error")?.textContent || doc.querySelector("main").textContent.slice(0,800)) + " | " + errors.join(" | "));
  assert.ok(doc.querySelector(".ujg-esi-more-children"));
  assert.equal(doc.querySelectorAll(".ujg-esi-create-row").length,2);
  assert.match(doc.querySelector(".ujg-esi-parent-row .ujg-esi-cell-owner").textContent, /Орлова Н\./, "The multiline source owner header must populate the grid");
  assert.ok(doc.querySelector(".ujg-esi-parent-row.is-failed"));
  assert.ok(doc.querySelector(".ujg-esi-import-warning"));
  const readsBefore = dom.window.issueReadCalls;
  doc.querySelector('tr[data-key="EVOSCADA-18080"] .ujg-esi-issue-summary-text').focus();
  assert.match(doc.querySelector('.ujg-esi-description-popover').textContent, /Сценарии проверки/);
  assert.equal(dom.window.issueReadCalls, readsBefore, "description preview must use loaded data");
  const activityTab = Array.from(doc.querySelectorAll('[role="tab"]')).find(node => node.textContent === "Динамика");
  assert.ok(activityTab);
  activityTab.click();
  assert.ok(doc.querySelector(".ujg-esi-activity-table"), "Actual activity module mounts");
  assert.ok(doc.querySelector(".ujg-esi-compact-toolbar"), "Activity must not erase the surrounding toolbar");
  assert.ok(doc.querySelector(".ujg-esi-fullscreen-button"));
  const date = doc.querySelector('[aria-label="Дата отчёта"]');
  assert.ok(date);
  date.value = "2026-09-01";
  date.dispatchEvent(new dom.window.Event("change",{bubbles:true}));
  assert.equal(doc.querySelector('[aria-label="Дата отчёта"]').value,"2026-09-01");
  assert.equal(dom.window.issueReadCalls, readsBefore, "Report date changes use loaded data only");
  Array.from(doc.querySelectorAll('[role="tab"]')).find(node => node.textContent === "Реестр").click();
  assert.equal(doc.querySelectorAll(".ujg-esi-parent-row").length,50);
  assert.equal(dom.window.mutationCalls,0);
  assert.deepEqual(errors,[]);
});
