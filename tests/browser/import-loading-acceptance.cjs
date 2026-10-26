const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {chromium} = require("playwright");
const origin = process.env.IMPORT_PREVIEW_URL || "http://127.0.0.1:4318";
const artifacts = process.env.IMPORT_LOADING_ARTIFACTS || "/tmp/import-usability-20261012/loading-screenshots";
assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(new URL(origin).hostname));
const panel = (page, kind) => page.locator(`.ujg-esi-request-progress[data-progress-kind='${kind}']`);
const control = (page, kind, name) => panel(page, kind).locator(`[data-request-control='${name}']`);
async function idle(page) {
  await page.waitForFunction(() => window.usabilityState && !usabilityState.loading &&
    !usabilityState.registryLoading && !usabilityState.syncLoading && !usabilityState.activityLoading,
  null, {timeout:90000});
}
async function running(page, kind) {
  await page.waitForFunction(kind => document.querySelector(
    `.ujg-esi-request-progress[data-progress-kind='${kind}'][data-progress-status='running']`), kind);
  assert.equal(await panel(page,kind).isVisible(),true);
}
async function hidden(page, kind) {
  assert.equal(await panel(page,kind).isVisible(),false,"Successful loading must remove the entire status bar");
}
async function details(page, kind, open) {
  const disclosure=panel(page,kind).locator("details");
  if (await disclosure.evaluate(element => element.open) !== open) await disclosure.locator("summary").click();
  if (open) {
    const bounds=await disclosure.evaluate(element => ({
      head:element.parentElement.getBoundingClientRect().toJSON(),
      toggle:element.querySelector("summary").getBoundingClientRect().toJSON(),
      body:element.querySelector(".ujg-esi-request-details-body").getBoundingClientRect().toJSON()
    }));
    assert.ok(Math.abs(bounds.body.width-bounds.head.width)<1,"Details must span the full loading band");
    assert.ok(bounds.body.y>=bounds.toggle.bottom,"Details must open below, not beside the controls");
  }
}
async function compact(page, kind) {
  assert.equal(await panel(page,kind).locator("details").evaluate(element => element.open),false,
    "Every new run starts with the request log collapsed");
  const bounds=await panel(page,kind).boundingBox();
  assert.ok(bounds.height <= (page.viewportSize().width > 600 ? 105 : 180),"The active status bar must stay compact");
}
async function fingerprint(page) {
  return page.evaluate(() => JSON.stringify(usabilityState.rows));
}
async function capture(page, name) {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
  await page.screenshot({path:path.join(artifacts,name + ".png")});
}
async function contextFor(browser, viewport) {
  const context = await browser.newContext({viewport});
  await context.addInitScript(() => localStorage.setItem("ujg-esi-state", JSON.stringify({projectKey:"EVOSCADA"})));
  await context.route("**/*", route => new URL(route.request().url()).origin === new URL(origin).origin ? route.continue() : route.abort());
  return context;
}

async function registry(page) {
  await page.goto(origin + "/?usability");
  await page.waitForFunction(() => window.usabilityState?.rows.length === 71 && !usabilityState.syncLoading, null, {timeout:60000});
  await hidden(page,"registry");
  await page.evaluate(() => { usabilityFixture.delay=400; window.priorExport=usabilityState.exportBuffer; });
  const excelBefore = await fingerprint(page);
  await page.getByRole("button", {name:"Синхронизировать из Jira",exact:true}).click();
  await running(page,"registry");
  await compact(page,"registry");
  await capture(page,"excel-running");
  await control(page,"registry","stop").click(); await idle(page);
  assert.equal(await fingerprint(page),excelBefore,"Stopped Excel enrichment must retain prior rows");
  assert.equal(await page.evaluate(() => usabilityState.exportBuffer === priorExport),true);
  await page.evaluate(() => { usabilityFixture.delay=10; });
  await control(page,"registry","restart").click(); await idle(page);
  await hidden(page,"registry");
  assert.equal(await page.evaluate(() => usabilityState.rows.length),71);
  assert.ok(await page.evaluate(() => usabilityFixture.aborts > 0));
  await page.getByRole("button",{name:"Режим Jira",exact:true}).click();
  await page.getByRole("button",{name:"Загрузить замечания из Jira",exact:true}).click(); await idle(page);
  await hidden(page,"registry");
  const counts=await page.evaluate(() => ({actual:usabilityState.rows.length,
    expected:Object.values(fixtureIssues).filter(issue => issue.fields.issuetype.name === "История").length}));
  assert.equal(counts.actual,counts.expected);
  assert.ok(await page.evaluate(() => usabilityFixture.requests.some(request => request.requested === 50)),"Registry Story pages request up to 50");
  const jiraBefore=await fingerprint(page);
  await page.evaluate(() => { usabilityFixture.delay=100; usabilityFixture.failNext=true; });
  await page.getByRole("button",{name:"Загрузить замечания из Jira",exact:true}).click(); await idle(page);
  assert.ok(await page.evaluate(() => usabilityState.registryError));
  assert.equal(await fingerprint(page),jiraBefore,"Failed refresh must retain complete registry");
  assert.equal(await panel(page,"registry").isVisible(),true);
  await capture(page,"registry-error");
  assert.ok(await panel(page,"registry").locator("[data-request-state='error']").count());
  await page.evaluate(() => { usabilityFixture.delay=400; });
  await control(page,"registry","retry").click(); await running(page,"registry");
  await compact(page,"registry");
  assert.ok(await panel(page,"registry").locator("[data-request-state='error']").count(),"Previous failure remains visible during retry");
  await page.evaluate(() => { usabilityFixture.delay=10; });
  await idle(page);
  await hidden(page,"registry");
  assert.equal(await page.evaluate(() => usabilityState.registryError),"");
  await capture(page,"registry-retried");
  await page.evaluate(() => { usabilityFixture.ignoreAbort=true; usabilityFixture.delay=400; });
  const lateBefore=await fingerprint(page);
  await page.getByRole("button",{name:"Загрузить замечания из Jira",exact:true}).click(); await running(page,"registry");
  await control(page,"registry","stop").click(); await idle(page);
  const readsAtStop=await page.evaluate(() => usabilityFixture.requests.length);
  await page.waitForTimeout(650);
  assert.equal(await fingerprint(page),lateBefore,"A late unabortable reply must not publish or start another page");
  assert.equal(await page.evaluate(() => usabilityFixture.requests.length),readsAtStop);
  await capture(page,"registry-stopped");
  assert.deepEqual(await page.evaluate(() => ({writes:mutationCalls,llm:llmPreviewCalls.length})),{writes:0,llm:0});
  console.log(JSON.stringify({registry:true,excelStop:true,atomicFailure:true,cappedPages:true,lateReplyIgnored:true}));
}

async function activity(page, width) {
  await page.goto(origin + "/?performance&usability"); await idle(page);
  await page.waitForFunction(() => window.importPerformance?.report?.events === 1100, null, {timeout:60000});
  await hidden(page,"activity");
  await hidden(page,"registry");
  assert.equal(await page.evaluate(() => usabilityState.rows.length),250);
  const dates=await page.evaluate(() => fixtureDates);
  const date=page.getByRole("textbox",{name:"Дата отчёта",exact:true});
  const refresh=page.getByRole("button",{name:"Обновить историю",exact:true});
  await page.evaluate(() => { usabilityFixture.delay=3000; });
  await refresh.click(); await running(page,"activity");
  await compact(page,"activity");
  await page.emulateMedia({reducedMotion:"reduce"});
  assert.equal(await panel(page,"activity").locator(".ujg-esi-request-spinner svg").first()
    .evaluate(element => getComputedStyle(element).animationName),"none");
  await page.emulateMedia({reducedMotion:"no-preference"});
  const stopBounds=await control(page,"activity","stop").boundingBox();
  assert.ok(stopBounds && stopBounds.y >= 0 && stopBounds.y + stopBounds.height <= page.viewportSize().height,
    "Explicit refresh must reveal Stop without a separate scroll");
  await capture(page,"history-running-"+width);
  await details(page,"activity",true);
  await panel(page,"activity").evaluate(element => {
    window.progressRowNodes=Array.from(element.querySelectorAll("[data-request-id]"));
  });
  const timerBefore=await panel(page,"activity").innerText();
  await page.waitForTimeout(1100);
  assert.notEqual(await panel(page,"activity").innerText(),timerBefore,"Elapsed timers must change while responses are pending");
  assert.equal(await panel(page,"activity").evaluate(element => {
    const current=Array.from(element.querySelectorAll("[data-request-id]"));
    return current.length === progressRowNodes.length && current.every((node,index) => node === progressRowNodes[index]);
  }),true,"Timer ticks must retain the 1000 existing request row nodes");
  assert.ok(await panel(page,"activity").locator("[data-request-state='running']").count() <= 3);
  await capture(page,"history-details-"+width);
  const last=panel(page,"activity").locator("[data-request-id]").last();
  await last.scrollIntoViewIfNeeded(); await capture(page,"history-last-request-"+width);
  await details(page,"activity",false);
  await control(page,"activity","stop").click(); await idle(page);
  assert.ok(await panel(page,"activity").locator("[data-request-state='cancelled']").count());
  await capture(page,"history-stopped-"+width);
  await page.evaluate(() => { usabilityFixture.delay=15; });
  await control(page,"activity","restart").click(); await running(page,"activity");
  await compact(page,"activity");
  await page.waitForFunction(() => usabilityState.activityProgress.completed >= 300 && usabilityState.activityLoading);
  await capture(page,"history-mid-run-"+width);
  await panel(page,"activity").screenshot({path:path.join(artifacts,"status-bar-"+width+".png")});
  await date.fill(dates[1]); await date.dispatchEvent("change");
  await idle(page);
  assert.equal(await page.evaluate(() => usabilityState.activityProgress.status),"cancelled",
    "Selecting an already complete historical snapshot stops unnecessary forced refresh work");
  assert.equal(await panel(page,"activity").isVisible(),true,"Cancellation must never be disguised as success");
  await control(page,"activity","restart").click(); await running(page,"activity");
  await compact(page,"activity");
  await page.locator('[data-activity-filter="module"]').click();
  const search=page.getByRole("searchbox",{name:"Поиск значений",exact:true});
  await search.fill("АСУ"); await search.focus();
  await search.evaluate(element => element.setSelectionRange(1,2));
  const rendersBefore=await page.evaluate(() => importPerformance.timings["main.render"].count);
  await idle(page);
  await hidden(page,"activity");
  assert.equal(await search.inputValue(),"АСУ");
  assert.deepEqual(await search.evaluate(element => [element === document.activeElement,element.selectionStart,element.selectionEnd]),[true,1,2]);
  assert.ok(await page.evaluate(() => importPerformance.timings["main.render"].count) - rendersBefore <= 3,"Progress must not repeatedly redraw all tables");
  await capture(page,"history-final-draft-"+width);
  await search.press("Escape");
  assert.equal(await page.locator('[data-metric="events"] strong').textContent(),"1000");
  await date.fill(dates[0]); await date.dispatchEvent("change");
  assert.equal(await page.locator('[data-metric="events"] strong').textContent(),"900");
  await date.fill(dates[2]); await date.dispatchEvent("change");
  assert.equal(await page.locator('[data-metric="events"] strong').textContent(),"1100");
  await idle(page);
  await hidden(page,"activity");
  if (width === 1440) {
    await page.evaluate(() => { usabilityFixture.delay=2; usabilityFixture.failKeys["EVOSCADA-50000"]=true; });
    await refresh.click(); await idle(page);
    assert.match(await page.evaluate(() => usabilityState.activityError),/EVOSCADA-50000/);
    assert.equal(await panel(page,"activity").isVisible(),true);
    await capture(page,"history-error");
    assert.ok(await panel(page,"activity").locator("[data-request-state='error']").count());
    const requestsBefore=await page.evaluate(() => usabilityFixture.requests.length);
    await page.evaluate(() => { usabilityFixture.delay=400; delete usabilityFixture.failKeys["EVOSCADA-50000"]; });
    await control(page,"activity","retry").click(); await running(page,"activity");
    await compact(page,"activity");
    assert.ok(await panel(page,"activity").locator("[data-request-state='error']").count());
    await idle(page);
    await hidden(page,"activity");
    assert.equal(await page.evaluate(() => usabilityState.activityError),"");
    const retried=await page.evaluate(start => usabilityFixture.requests.slice(start).filter(request => /\/issue\/[A-Z]+-\d+$/.test(request.url)).length,requestsBefore);
    assert.equal(retried,1,"Retry failed reads must not reload all 1000 successful tasks");
    await capture(page,"history-error-recovery");
    await page.evaluate(() => {
      usabilityFixture.delay=2; usabilityFixture.cap=2;
      const comments=[0,1,2].map(index => ({id:"loading-comment-"+index,created:fixtureDates[1]+"T09:0"+index+":00+03:00",
        author:{name:"reviewer",displayName:"Автор комментария"},body:"Комментарий со страницы "+index}));
      fixtureIssues["EVOSCADA-50000"].fields.comment={startAt:0,total:3,comments:comments.slice(0,1)};
      usabilityFixture.commentPages["EVOSCADA-50000"]=comments;
    });
    await refresh.click(); await idle(page);
    const commentPages=await page.evaluate(() => usabilityFixture.requests.filter(request => request.url.endsWith("/comment")).map(request => request.page));
    assert.deepEqual(commentPages,[0,2]);
    await hidden(page,"activity");
    assert.ok(await page.evaluate(() => usabilityState.activityProgress.rows.some(row => row.stage === "comments")),
      "Hiding a successful bar must preserve comment-page diagnostics");
    await date.fill(dates[1]); await date.dispatchEvent("change");
    assert.equal(await page.locator('[data-metric="events"] strong').textContent(),"1003");
    await capture(page,"comment-pages");
    await date.fill(dates[2]); await date.dispatchEvent("change");
  }
  await page.locator(".ujg-esi-activity-journal tbody tr").last().scrollIntoViewIfNeeded();
  await capture(page,"journal-last-row-"+width);
  assert.deepEqual(await page.evaluate(() => ({writes:mutationCalls,llm:importPerformance.llmCalls})),{writes:0,llm:0});
  console.log(JSON.stringify({width,historyTasks:1000,events:[900,1000,1100],stopRestart:true,filterDraft:true,writes:0,llm:0}));
}

(async () => {
  fs.mkdirSync(artifacts,{recursive:true});
  const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined});
  let page;
  try {
    for (const viewport of [{width:1440,height:900},{width:390,height:500}]) {
      if (process.env.IMPORT_LOADING_WIDTH && viewport.width !== Number(process.env.IMPORT_LOADING_WIDTH)) continue;
      const context=await contextFor(browser,viewport), errors=[];
      page=await context.newPage(); page.on("pageerror",error => errors.push(error.message));
      if (viewport.width === 1440) await registry(page);
      await activity(page,viewport.width);
      assert.deepEqual(errors,[]); await context.close(); page=null;
    }
  } catch (error) {
    if (page) {
      console.error(await page.evaluate(() => ({activityLoading:window.usabilityState?.activityLoading,
        activityStatus:window.usabilityState?.activityProgress?.status,
        activityError:window.usabilityState?.activityError,
        activityCompleted:window.usabilityState?.activityProgress?.completed,
        activityFailures:window.usabilityState?.activityProgress?.failures,
        panels:Array.from(document.querySelectorAll('.ujg-esi-request-progress')).map(element => ({
          kind:element.dataset.progressKind,status:element.dataset.progressStatus,display:element.style.display
        }))})).catch(() => ({})));
      await page.screenshot({path:path.join(artifacts,"failure.png")}).catch(() => {});
    }
    throw error;
  } finally { await browser.close(); }
})().catch(error => {console.error(error);process.exitCode=1;});
