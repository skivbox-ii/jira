const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {chromium} = require("playwright");
const origin=process.env.IMPORT_PREVIEW_URL || "http://127.0.0.1:4318";
const artifacts=process.env.IMPORT_MULTI_EPIC_ARTIFACTS || "/tmp/import-multiple-epics-20261027";
assert.ok(["127.0.0.1","localhost","[::1]"].includes(new URL(origin).hostname));
const picker=page=>page.locator(".ujg-esi-epic-picker");
const epic=key=>"EVOSCADA-"+key;
async function open(page) {await picker(page).getByRole("button",{name:/Эпики/}).first().click();}
async function toggle(page,key) {await picker(page).getByRole("checkbox",{name:new RegExp(epic(key))}).click();}
async function apply(page) {await picker(page).getByRole("button",{name:"ОК",exact:true}).click();}
async function load(page) {await page.getByRole("button",{name:"Загрузить замечания из Jira",exact:true}).click();}
async function settled(page) {await page.waitForFunction(()=>window.usabilityState && !usabilityState.registryLoading && !usabilityState.syncLoading && usabilityState.registryProgress?.status!=="running",null,{timeout:120000});}
async function selected(page,keys) {assert.deepEqual(await page.evaluate(()=>usabilityState.epicKeys),keys.map(epic));}
async function rows(page,keys) {
  const actual=await page.evaluate(()=>usabilityState.rows.map(row=>row.jiraKey).sort());
  const expected=await page.evaluate(keys=>multiEpicFixture.stories.filter(row=>!keys.length || keys.includes(row.epic)).map(row=>row.key).sort(),keys.map(epic));
  assert.deepEqual(actual,expected,"Registry must contain exactly the selected epic union");
}
async function shot(page,name) {
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,"Page must fit viewport");
  await page.screenshot({path:path.join(artifacts,name+".png")});
}
async function scenario(page,width) {
  await page.goto(origin+"/?empty&usability&progressive&multiEpics");
  await page.getByRole("button",{name:"Режим Jira",exact:true}).click();
  await open(page);
  const dimensions=await picker(page).getByRole("checkbox").evaluateAll(nodes=>nodes.map(n=>({width:n.getBoundingClientRect().width,height:n.getBoundingClientRect().height,row:n.closest("label").getBoundingClientRect().height})));
  assert.ok(dimensions.every(n=>n.width<=24 && n.height<=24 && n.row<90),"Epic checkboxes and labels must be compact/readable");
  await toggle(page,100);
  const search=picker(page).getByRole("searchbox");
  await search.fill("ОЭ");
  await toggle(page,200);
  await selected(page,[]);
  await shot(page,"draft-search-"+width);
  await apply(page);await selected(page,[100,200]);
  await load(page);await settled(page);await rows(page,[100,200]);
  const reads=await page.evaluate(()=>progressiveFixture.requests);
  const query=reads.find(request=>/issuetype = Story/.test(request.payload.jql || "")).payload;
  assert.match(query.jql,/\bIN\s*\(/i);assert.match(query.jql,/EVOSCADA-100/);assert.match(query.jql,/EVOSCADA-200/);
  assert.equal(query.maxResults,50);assert.ok(!query.expand);
  const shared=await page.evaluate(()=>multiEpicFixture.sharedChild);
  assert.equal(reads.filter(request=>request.heavy && request.url.endsWith("/"+shared)).length,1,"Shared child history must load only once");
  assert.equal(new Set(reads.filter(request=>request.heavy).map(request=>request.url)).size,reads.filter(request=>request.heavy).length);
  await shot(page,"two-epics-registry-"+width);
  await page.getByRole("tab",{name:"Динамика",exact:true}).click();
  await page.waitForFunction(()=>!usabilityState.activityLoading && usabilityState.reportView==="activity",null,{timeout:120000});
  assert.match(await page.locator(".ujg-esi-activity-scope").innerText(),/EVOSCADA-100, EVOSCADA-200/);
  await rows(page,[100,200]);await shot(page,"two-epics-dynamics-"+width);
  await page.getByRole("tab",{name:"Реестр",exact:true}).click();

  await page.reload();await page.waitForFunction(()=>window.usabilityState?.epicKeys?.length===2);
  await selected(page,[100,200]);
  await page.getByRole("button",{name:"Режим Jira",exact:true}).click();
  await open(page);await toggle(page,200);await toggle(page,300);
  await picker(page).getByRole("searchbox").press("Escape");await selected(page,[100,200]);
  await open(page);await toggle(page,200);
  await page.locator("footer").click();await selected(page,[100,200]);
  await open(page);await shot(page,"saved-selection-"+width);await apply(page);

  // Change only the second epic while an old unabortable history response is pending.
  await page.evaluate(()=>{progressiveFixture.historyDelay=1000;progressiveFixture.ignoreAbort=true;});
  await load(page);await page.waitForFunction(()=>progressiveFixture.requests.some(r=>r.heavy && r.state==="running"));
  await open(page);await toggle(page,200);await toggle(page,300);await apply(page);
  await selected(page,[100,300]);
  await page.evaluate(()=>{progressiveFixture.historyDelay=1;});
  await load(page);await settled(page);await page.waitForTimeout(1100);await rows(page,[100,300]);
  await shot(page,"changed-second-epic-"+width);
  await open(page);await toggle(page,100);await toggle(page,300);await apply(page);
  await load(page);await settled(page);await rows(page,[]);
  assert.equal(await page.evaluate(()=>mutationCalls),0);assert.equal(await page.evaluate(()=>llmPreviewCalls.length),0);

  // Existing Excel creation must not silently choose the first selected epic.
  await page.goto(origin+"/?usability&progressive&multiEpics");
  await page.waitForFunction(()=>window.usabilityState?.rows.length===71 && !usabilityState.syncLoading,null,{timeout:60000});
  await open(page);await toggle(page,100);await toggle(page,200);await apply(page);
  await page.locator(".ujg-esi-create-row").first().click();
  const dialog=page.locator(".ujg-esi-confirm-modal");await dialog.waitFor();
  assert.match(await dialog.innerText(),/несколько эпиков/i);
  assert.equal(await page.evaluate(()=>usabilityState.createDialog.epicKey),"");
  await shot(page,"single-target-creation-"+width);
  assert.equal(await page.evaluate(()=>mutationCalls),0);assert.equal(await page.evaluate(()=>llmPreviewCalls.length),0);
  console.log(JSON.stringify({width,epics:2,unionRows:46,persisted:true,draftCancel:true,secondEpicScope:true,sharedChildOnce:true,emptyAll:true,creationExplicit:true,writes:0,llmCalls:0}));
}
(async()=>{
  fs.mkdirSync(artifacts,{recursive:true});
  const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined});
  let page;
  try {
    for(const width of [1440,390]) {
      const context=await browser.newContext({viewport:{width,height:width===1440?900:844}});
      await context.addInitScript(()=>{if(!localStorage.getItem("ujg-esi-state"))localStorage.setItem("ujg-esi-state",JSON.stringify({projectKey:"EVOSCADA"}));});
      await context.route("**/*",route=>new URL(route.request().url()).origin===new URL(origin).origin?route.continue():route.abort());
      page=await context.newPage();const errors=[];page.on("pageerror",error=>errors.push(error.message));
      await scenario(page,width);assert.deepEqual(errors,[]);await context.close();
    }
  } catch(error) {
    if(page && !page.isClosed()) await page.screenshot({path:path.join(artifacts,"failure.png")});
    throw error;
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
