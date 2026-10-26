const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {chromium} = require("playwright");
const origin = process.env.IMPORT_PREVIEW_URL || "http://127.0.0.1:4318";
const artifacts = process.env.IMPORT_PROGRESSIVE_ARTIFACTS || "/tmp/import-progressive-20261026";
assert.ok(["127.0.0.1","localhost","[::1]"].includes(new URL(origin).hostname));
const band = page => page.locator(".ujg-esi-request-progress[data-progress-kind='registry']");
const control = (page, name) => band(page).locator(`[data-request-control='${name}']`);
async function settled(page) {
  await page.waitForFunction(() => window.usabilityState && usabilityState.registryProgress?.status !== "running" &&
    !usabilityState.registryLoading && !usabilityState.syncLoading, null, {timeout:120000});
}
async function screenshot(page,name) {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth+1),false);
  await page.screenshot({path:path.join(artifacts,name+".png")});
}
async function load(page) {
  await page.getByRole("button",{name:"Загрузить замечания из Jira",exact:true}).click();
}
async function registry(page,width) {
  await page.goto(origin+"/?empty&usability&progressive");
  await page.getByRole("button",{name:"Режим Jira",exact:true}).click();
  await page.evaluate(() => {progressiveFixture.historyDelay=1000;});
  await load(page);
  await page.waitForFunction(() => progressiveFixture.requests.length>0);
  const first=await page.evaluate(() => progressiveFixture.requests[0].payload);
  assert.equal(first.maxResults,50,"The first registry page must be lightweight and request 50 issues");
  assert.ok(!first.expand?.includes("changelog"));
  for(const field of ["comment","worklog"]) assert.ok(!first.fields.includes(field));
  assert.ok(first.fields.includes("description"));
  await page.waitForFunction(() => usabilityState.rows.length===69 && progressiveFixture.requests.some(r=>r.heavy && r.state==="running"));
  assert.equal(await page.locator(".ujg-esi-registry-table tbody tr").count()>0,true);
  assert.match(await page.locator("#root").innerText(),/Загружается/);
  const baseAt=await page.evaluate(() => performance.now());
  const firstHistory=await page.evaluate(() => progressiveFixture.requests.find(r=>r.heavy));
  assert.ok(firstHistory && !firstHistory.finished,"Base rows must be available while the first history is pending");
  await band(page).waitFor({state:"visible"});
  await screenshot(page,"base-before-history-"+width);
  await page.locator('th[data-column="remarkId"] .ujg-esi-header-filter').click();
  const search=page.getByRole("searchbox",{name:"Поиск значений",exact:true});
  await search.fill("744");await search.focus();
  await search.evaluate(element=>element.setSelectionRange(1,2));
  await page.evaluate(() => {progressiveFixture.historyDelay=1;});
  await settled(page);
  assert.equal(await search.inputValue(),"744");
  assert.deepEqual(await search.evaluate(element=>[element===document.activeElement,element.selectionStart,element.selectionEnd]),[true,1,2]);
  assert.equal(await band(page).isVisible(),false,"Successful enrichment hides the whole bar");
  await screenshot(page,"finished-with-draft-"+width);
  await search.press("Escape");
  const reads=await page.evaluate(() => progressiveFixture.requests);
  assert.equal(new Set(reads.filter(r=>r.heavy).map(r=>r.url)).size,reads.filter(r=>r.heavy).length);
  assert.ok(reads.filter(r=>r.heavy).every(r=>!String(r.payload.fields).includes("comment") && !String(r.payload.fields).includes("worklog")));
  for(let i=1;i<reads.length;i++) assert.ok(reads[i].started>=reads[i-1].finished-1,"Registry transport must run sequentially");
  assert.ok(reads.every(r=>r.heavy || r.payload.maxResults<=50));
  assert.ok(reads.at(-1).finished>baseAt);

  // One failed history must preserve the base table and retry only the missing key.
  const failKey=reads.find(r=>r.heavy).url.split("/").pop();
  await page.evaluate(key=>{progressiveFixture.historyDelay=1;progressiveFixture.failKeys[key]=true;},failKey);
  await load(page);await settled(page);
  assert.equal(await page.evaluate(()=>usabilityState.rows.length),69);
  assert.equal(await band(page).isVisible(),true);
  await screenshot(page,"history-error-"+width);
  const beforeRetry=await page.evaluate(()=>progressiveFixture.requests.length);
  await page.evaluate(key=>{delete progressiveFixture.failKeys[key];},failKey);
  await control(page,"retry").click();await settled(page);
  const retry=await page.evaluate(start=>progressiveFixture.requests.slice(start),beforeRetry);
  assert.equal(retry.length,1,"History retry must not repeat successful histories or base pages");
  assert.ok(retry[0].url.endsWith("/"+failKey));
  assert.equal(await band(page).isVisible(),false);

  // A second-page timeout retries offset 50 at 25, retaining the first page.
  await page.evaluate(()=>{progressiveFixture.timeoutOffset=50;progressiveFixture.timeoutUsed=false;progressiveFixture.historyDelay=1;});
  const timeoutStart=await page.evaluate(()=>progressiveFixture.requests.length);
  await load(page);await settled(page);
  const pages=await page.evaluate(start=>progressiveFixture.requests.slice(start).filter(r=>!r.heavy && !/key in/.test(r.payload.jql)),timeoutStart);
  assert.deepEqual(pages.map(r=>[r.payload.startAt,r.payload.maxResults]),[[0,50],[50,50],[50,25]]);
  assert.equal(await page.evaluate(()=>usabilityState.rows.length),69);

  // Stop while a late unabortable history is outstanding: no new requests or writes.
  await page.evaluate(()=>{progressiveFixture.timeoutOffset=null;progressiveFixture.historyDelay=1200;progressiveFixture.ignoreAbort=true;});
  await load(page);
  await page.waitForFunction(()=>progressiveFixture.requests.some(r=>r.heavy && r.state==="running"));
  await control(page,"stop").click();await settled(page);
  const stopped=await page.evaluate(()=>({rows:JSON.stringify(usabilityState.rows),reads:progressiveFixture.requests.length}));
  await page.waitForTimeout(1400);
  assert.equal(await page.evaluate(()=>JSON.stringify(usabilityState.rows)),stopped.rows);
  assert.equal(await page.evaluate(()=>progressiveFixture.requests.length),stopped.reads);
  await screenshot(page,"history-stopped-"+width);
  assert.equal(await page.evaluate(()=>mutationCalls),0);
  assert.equal(await page.evaluate(()=>llmPreviewCalls.length),0);
  console.log(JSON.stringify({width,baseRows:69,historyReads:reads.filter(r=>r.heavy).length,
    baseBeforeHistory:true,filterDraft:true,retryMissingOnly:true,pageTimeoutRecovery:true,stopLateReply:true}));
}

async function activity(page,width) {
  await page.goto(origin+"/?performance&usability&progressive");
  await page.waitForFunction(()=>window.usabilityState?.rows.length===250 && usabilityState.activityLoading,null,{timeout:60000});
  const date=page.getByRole("textbox",{name:"Дата отчёта",exact:true});
  const dates=await page.evaluate(()=>fixtureDates);
  await date.fill(dates[0]);await date.dispatchEvent("change");
  await page.locator('[data-activity-filter="module"]').click();
  const search=page.getByRole("searchbox",{name:"Поиск значений",exact:true});
  await search.fill("АСУ");await search.focus();
  await page.evaluate(()=>{progressiveFixture.historyDelay=1;});
  await page.waitForFunction(()=>!usabilityState.activityLoading && !usabilityState.registryLoading,null,{timeout:120000});
  assert.equal(await search.inputValue(),"АСУ");
  assert.equal(await search.evaluate(el=>document.activeElement===el),true);
  await screenshot(page,"activity-final-draft-"+width);
  await search.press("Escape");
  for(let i=0;i<dates.length;i++) {
    await date.fill(dates[i]);await date.dispatchEvent("change");
    await page.waitForFunction(()=>!usabilityState.activityLoading,null,{timeout:60000});
    assert.equal(await page.locator('[data-metric="events"] strong').textContent(),String([900,1000,1100][i]));
  }
  const history=await page.evaluate(()=>progressiveFixture.requests.filter(r=>r.heavy));
  assert.ok(history.length>=1000);
  const base=await page.evaluate(()=>progressiveFixture.requests.filter(r=>!r.heavy));
  assert.ok(base.length>5 && base.every(r=>r.payload.maxResults<=50 && !r.payload.expand));
  // Explicit comments beyond the embedded page must still be fetched in Dynamics.
  await page.evaluate(()=>{
    usabilityFixture.delay=1;usabilityFixture.cap=2;
    const comments=[0,1,2].map(i=>({id:"progressive-comment-"+i,created:fixtureDates[1]+"T09:0"+i+":00+03:00",
      author:{name:"reviewer",displayName:"Автор"},body:"Полный комментарий со страницы "+i}));
    fixtureIssues["EVOSCADA-50000"].fields.comment={startAt:0,total:3,comments:comments.slice(0,1)};
    usabilityFixture.commentPages["EVOSCADA-50000"]=comments;
  });
  await page.getByRole("button",{name:"Обновить историю",exact:true}).click();
  await page.waitForFunction(()=>!usabilityState.activityLoading,null,{timeout:120000});
  assert.deepEqual(await page.evaluate(()=>usabilityFixture.requests.filter(r=>r.url.endsWith("/comment")).map(r=>r.page)),[0,2]);
  await date.fill(dates[1]);await date.dispatchEvent("change");
  assert.equal(await page.locator('[data-metric="events"] strong').textContent(),"1003");
  await page.locator(".ujg-esi-activity-journal tbody tr").last().scrollIntoViewIfNeeded();
  await screenshot(page,"activity-last-row-"+width);
  assert.equal(await page.evaluate(()=>mutationCalls),0);
  assert.equal(await page.evaluate(()=>importPerformance.llmCalls),0);
  console.log(JSON.stringify({width,dynamics:true,tasks:1000,events:[900,1000,1100],commentPages:[0,2],draft:true}));
}

(async()=>{
  fs.mkdirSync(artifacts,{recursive:true});
  const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined});
  let page;
  try {
    for(const width of [1440,390]) {
      const context=await browser.newContext({viewport:{width,height:width===1440?900:844}});
      await context.addInitScript(()=>localStorage.setItem("ujg-esi-state",JSON.stringify({projectKey:"EVOSCADA"})));
      await context.route("**/*",route=>new URL(route.request().url()).origin===new URL(origin).origin ? route.continue() : route.abort());
      page=await context.newPage();const errors=[];page.on("pageerror",error=>errors.push(error.message));
      await registry(page,width);
      await activity(page,width);assert.deepEqual(errors,[]);
      await context.close();
    }
  } catch(error) {
    if(page && !page.isClosed()) await page.screenshot({path:path.join(artifacts,"failure.png")});
    throw error;
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
