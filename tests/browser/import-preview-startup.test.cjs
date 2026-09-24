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
  const activityDeadline = Date.now() + 5000;
  while (/История: 0 из 0/.test(doc.querySelector(".ujg-esi-activity-coverage").textContent) && Date.now() < activityDeadline) await new Promise(resolve => setTimeout(resolve,20));
  assert.doesNotMatch(doc.querySelector(".ujg-esi-activity-coverage").textContent,/История: 0 из 0/,"Opening Dynamics loads Jira automatically");
  assert.ok(dom.window.issueReadCalls > readsBefore);
  const readsAfterActivityLoad = dom.window.issueReadCalls;
  const completedMetric=doc.querySelector('[data-metric="completed"]');
  completedMetric.focus();
  const completedPreview=doc.querySelector('.ujg-esi-management-preview');
  assert.ok(completedPreview,"Completion metric exposes the short summary");
  assert.match(completedPreview.textContent,/Создано в Jira.*01\.09\.2026 12:00 МСК/is);
  assert.match(completedPreview.textContent,/Полная готовность.*12:05 МСК/is);
  assert.doesNotMatch(completedPreview.textContent,/До завершения|Завершено за день/);
  completedMetric.click();
  const completedDialog=doc.querySelector('.ujg-esi-management-dialog');
  assert.match(completedDialog.textContent,/Создано в Jira.*01\.09\.2026 12:00 МСК/is);
  assert.match(completedDialog.textContent,/Полная готовность.*12:05 МСК/is);
  completedDialog.querySelector('[aria-label="Закрыть сводку"]').click();
  assert.equal(dom.window.issueReadCalls,readsAfterActivityLoad,"Completion dates use existing source snapshots");
  const overdueMetric=doc.querySelector('[data-metric="overdue"]');
  assert.ok(overdueMetric,"Dynamics exposes the deadline summary");
  overdueMetric.focus();
  const overduePreview=doc.querySelector('.ujg-esi-management-preview');
  assert.match(overduePreview.textContent,/EVOSCADA-17906/,"No-event overdue remark remains in the management summary");
  assert.match(overduePreview.textContent,/Просрочено\s*2 календарных дня/i);
  assert.match(doc.querySelector('.ujg-esi-activity-group-deadline.is-near').textContent,/сегодня|завтра/);
  overdueMetric.click();
  const overdueDialog=doc.querySelector('.ujg-esi-management-dialog');
  assert.match(overdueDialog.textContent,/EVOSCADA-17906/);
  assert.match(overdueDialog.textContent,/Оставшиеся задачи/);
  overdueDialog.querySelector('[aria-label="Закрыть сводку"]').click();
  assert.equal(dom.window.issueReadCalls,readsAfterActivityLoad,"Deadline summaries add no Jira reads");
  const deadlineIssues=doc.querySelector('[data-metric="deadlineIssues"]');
  assert.ok(deadlineIssues,"The coverage line exposes deadline diagnostics");
  deadlineIssues.focus();
  const deadlinePreview=doc.querySelector('.ujg-esi-management-preview');
  for (const key of ["EVOSCADA-24006","EVOSCADA-24007","EVOSCADA-24008"]) {
    assert.match(deadlinePreview.textContent,new RegExp(key),"Diagnostics includes quiet remarks");
  }
  assert.match(deadlinePreview.textContent,/24\/09\/26/);
  assert.match(deadlinePreview.textContent,/31\.02\.2026/);
  assert.match(deadlinePreview.textContent,/Excel/);
  deadlineIssues.click();
  const deadlineDialog=doc.querySelector('.ujg-esi-management-dialog');
  assert.match(deadlineDialog.textContent,/24\/09\/26/);
  deadlineDialog.querySelector('[aria-label="Закрыть сводку"]').click();
  assert.equal(dom.window.issueReadCalls,readsAfterActivityLoad,"Diagnostics only use loaded source cells");
  const llmButton=doc.querySelector('[aria-label="LLM-отчёт"]');
  assert.ok(llmButton,"Dynamics must expose the LLM report entry point");
  llmButton.click();
  const llmDialog=doc.querySelector(".ujg-esi-activity-ai-dialog");
  assert.ok(llmDialog);
  assert.equal(dom.window.llmPreviewCalls.length,0,"Opening the panel never sends source data");
  llmDialog.querySelector('[aria-label="Сформировать отчёт"]').click();
  const llmDeadline=Date.now()+5000;
  while (!llmDialog.querySelector(".ujg-esi-activity-markdown") && Date.now()<llmDeadline) await new Promise(resolve=>setTimeout(resolve,20));
  assert.match(llmDialog.textContent,/Демонстрационный ответ/);
  assert.ok(llmDialog.querySelector("table th"),"Markdown tables must render as tables");
  assert.ok(llmDialog.querySelector('a[href="https://jira.example.test/browse/EVOSCADA-30041"]'));
  assert.ok(dom.window.llmPreviewCalls.length>0);
  const callsBeforeQuestion=dom.window.llmPreviewCalls.length;
  const question=llmDialog.querySelector('[aria-label="Вопрос по отчёту"]');
  question.value="Кто завершил QA?";
  question.dispatchEvent(new dom.window.Event("input",{bubbles:true}));
  llmDialog.querySelector('[aria-label="Отправить вопрос"]').click();
  const questionDeadline=Date.now()+5000;
  while (dom.window.llmPreviewCalls.length===callsBeforeQuestion && Date.now()<questionDeadline) await new Promise(resolve=>setTimeout(resolve,20));
  assert.ok(dom.window.llmPreviewCalls.length>callsBeforeQuestion);
  assert.equal(dom.window.issueReadCalls,readsAfterActivityLoad,"AI uses loaded data without additional Jira reads");
  llmDialog.querySelector('[aria-label="Закрыть LLM-отчёт"]').click();
  const date = doc.querySelector('[aria-label="Дата отчёта"]');
  assert.ok(date);
  date.value = "2026-09-01";
  date.dispatchEvent(new dom.window.Event("change",{bubbles:true}));
  assert.equal(doc.querySelector('[aria-label="Дата отчёта"]').value,"2026-09-01");
  doc.querySelector('[data-metric="deadlineIssues"]').focus();
  assert.match(doc.querySelector('.ujg-esi-management-preview').textContent,/EVOSCADA-24008/,"Deadline diagnostics are independent of the selected event day");
  assert.equal(dom.window.issueReadCalls, readsAfterActivityLoad, "Report date changes use loaded data only");
  Array.from(doc.querySelectorAll('[role="tab"]')).find(node => node.textContent === "Реестр").click();
  assert.equal(doc.querySelectorAll(".ujg-esi-parent-row").length,50);
  assert.equal(dom.window.mutationCalls,0);
  assert.deepEqual(errors,[]);
});
