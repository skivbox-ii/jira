const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {chromium} = require("playwright");

const origin = process.env.IMPORT_PREVIEW_URL || "http://127.0.0.1:4317";
assert.ok(["127.0.0.1","localhost","[::1]"].includes(new URL(origin).hostname));
const artifacts = process.env.IMPORT_PROCESSED_ARTIFACTS || path.join(os.tmpdir(),"import-processed-summary-acceptance");
const fixture = `
(function() {
  function set(key, status, category, user, resolved) {
    var issue = fixtureIssues[key];
    issue.fields.status = {id:key,name:status,statusCategory:category ? {key:category} : undefined};
    issue.fields.assignee = {name:user,displayName:"Одинаковое имя"};
    if(resolved) { issue.fields.resolution={name:"Готово"}; issue.fields.resolutiondate="2026-09-01T09:00:00Z"; }
  }
  set("EVOSCADA-16104","Готово","done","impl-local");
  set("EVOSCADA-17906","Выдано","new","impl-local",true);
  set("EVOSCADA-20000","Тестирование","indeterminate","impl-alias");
  set("EVOSCADA-21032","Снята","done","impl-local");
  set("EVOSCADA-20862","Reopened","indeterminate","other-user",true);
  set("EVOSCADA-20914","В работе","indeterminate","other-user");
  set("EVOSCADA-30050","В работе","indeterminate","impl-local");
  set("EVOSCADA-24006","Unknown workflow","","impl-local");
  set("EVOSCADA-24007","Custom active workflow","indeterminate","impl-local");
  set("EVOSCADA-24008","Тестирование","indeterminate","other-user");
  set("EVOSCADA-24009","Повторно выдано","","other-user",true);
  set("EVOSCADA-24010","Выдано","new","not-a-member");
  set("EVOSCADA-24011","В разработке","","other-user",true);
  set("EVOSCADA-24012","Тестирование","indeterminate","impl-local");
  set("EVOSCADA-24013","На проверку","","other-user",true);
  set("EVOSCADA-24014","Ожидает","","other-user",true);
  set("EVOSCADA-24015","В процессе","","other-user",true);
  fixtureIssues["EVOSCADA-24012"].fields.summary="Синтетическая история без номера";
  fixtureIssues["EVOSCADA-24012"].fields.description="Без идентификатора Excel";
})();`;
const seed = `
(function() {
  var teamsModule=modules._ujgESI_teams;
  var teams=teamsModule.defaults();
  teams.filter(function(team){return team.direction==="implementation";})[0].members=[
    {id:"impl-local",label:"Одинаковое имя",identifiers:["impl-local","impl-alias"]}
  ];
  teamsModule.save(localStorage,"ujg-esi-state","EVOSCADA",teams);
  var original=modules._ujgESI_rendering.render;
  modules._ujgESI_rendering.render=function(state) { window.processedFixtureState=state; return original.apply(this,arguments); };
})();`;

async function expected(page) {
  return page.evaluate(() => {
    const counts={done:0,processed:0,testing:0,cancelled:0,open:0,unknown:0};
    for(const issue of Object.values(fixtureIssues)) {
      if(issue.fields.issuetype.name!=="История") continue;
      const status=issue.fields.status, category=status.statusCategory?.key;
      if(status.name==="Снята") counts.cancelled++;
      else if(status.name==="Готово") counts.done++;
      else if(status.name==="Unknown workflow") counts.unknown++;
      else if(["impl-local","impl-alias"].includes(issue.fields.assignee?.name)) counts.processed++;
      else if(["Тестирование","На проверку"].includes(status.name)) counts.testing++;
      else {
        assertFixtureOpen(category,status.name);
        counts.open++;
      }
    }
    function assertFixtureOpen(category,name) {
      if(!["new","indeterminate"].includes(category) && !["Повторно выдано","В разработке","Ожидает","В процессе"].includes(name)) throw new Error("Unexpected fixture: "+name);
    }
    return counts;
  });
}

async function summary(page, counts, name) {
  await page.locator(".ujg-esi-import-summary > summary").click();
  const dialog=page.getByRole("dialog",{name:"Сводка замечаний",exact:true});
  await dialog.waitFor();
  const actual={};
  for(const [key,value] of Object.entries(counts)) {
    const row=dialog.locator(`.ujg-esi-stats-stories [data-story-state='${key}']`);
    assert.equal(await row.count(),1,"Summary row: "+key);
    actual[key]=Number(await row.locator("td").innerText());
    assert.equal(actual[key],value,key);
  }
  assert.match(await dialog.innerText(),/Отработано \(внедрение\)/);
  const state=await page.evaluate(() => ({
    parent:processedFixtureState.rows.find(row=>(row.jiraKey||row.createdKey)==="EVOSCADA-17906").storyDetails,
    reopened:processedFixtureState.rows.find(row=>(row.jiraKey||row.createdKey)==="EVOSCADA-20862").storyDetails,
    issued:processedFixtureState.rows.find(row=>(row.jiraKey||row.createdKey)==="EVOSCADA-24009").storyDetails,
    developing:processedFixtureState.rows.find(row=>(row.jiraKey||row.createdKey)==="EVOSCADA-24011").storyDetails,
    review:processedFixtureState.rows.find(row=>(row.jiraKey||row.createdKey)==="EVOSCADA-24013").storyDetails,
    waiting:processedFixtureState.rows.find(row=>(row.jiraKey||row.createdKey)==="EVOSCADA-24014").storyDetails,
    inProgress:processedFixtureState.rows.find(row=>(row.jiraKey||row.createdKey)==="EVOSCADA-24015").storyDetails,
    noId:modules._ujgESI_remarkId(processedFixtureState.rows.find(row=>(row.jiraKey||row.createdKey)==="EVOSCADA-24012")),
    viewMode:processedFixtureState.viewMode,
    total:processedFixtureState.rows.filter(row=>row.jiraKey||row.createdKey).length
  }));
  assert.equal(state.parent.done,false,"Issued with old resolution stays open");
  assert.equal(state.reopened.done,false,"Reopened with old resolution stays open");
  assert.equal(state.issued.done,false,"Reissued without category stays open");
  assert.equal(state.developing.done,false,"Development without category overrides old resolution");
  assert.equal(state.review.done,false,"Review without category overrides old resolution");
  assert.equal(state.waiting.done,false,"Waiting without category overrides old resolution");
  assert.equal(state.inProgress.done,false,"In progress without category overrides old resolution");
  if(state.viewMode==="jira") assert.equal(state.noId,"","Jira Story without Excel ID remains counted");
  assert.equal(Object.values(actual).reduce((a,b)=>a+b,0),state.total,"Exclusive buckets conserve original Story count");
  const bounds=await dialog.evaluate(el=>{
    const rect=el.getBoundingClientRect();
    return {left:rect.left,right:rect.right,width:innerWidth,overflow:el.scrollWidth-el.clientWidth,
      pageOverflow:document.documentElement.scrollWidth-innerWidth};
  });
  assert.ok(bounds.left>=0 && bounds.right<=bounds.width && bounds.overflow<=1 && bounds.pageOverflow<=1);
  await page.screenshot({path:path.join(artifacts,name+".png")});
  const details=dialog.locator(".ujg-esi-stats-details");
  assert.equal(await details.getAttribute("open"),name.startsWith("qa-") ? "" : null,
    "QA filtering preserves the expanded details of the same loaded view");
  if(await details.getAttribute("open")===null) {
    await details.locator("summary").scrollIntoViewIfNeeded();
    await details.locator("summary").click();
  }
  assert.equal(await details.locator("table").count(),4,"Existing task and team tables survive");
  await dialog.locator(".ujg-esi-counters").scrollIntoViewIfNeeded();
  assert.equal(await dialog.locator(".ujg-esi-counters").isVisible(),true);
  await page.screenshot({path:path.join(artifacts,name+"-bottom.png")});
  await page.keyboard.press("Escape");
  assert.equal(await dialog.isVisible(),false);
  return {actual,bounds};
}

(async()=>{
  fs.mkdirSync(artifacts,{recursive:true});
  const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined});
  try {
    for(const [width,height] of [[1440,900],[390,844],[390,500]]) {
      const context=await browser.newContext({viewport:{width,height}});
      await context.route("**/*",async route=>{
        const url=new URL(route.request().url());
        if(url.origin!==new URL(origin).origin) return route.abort();
        if(["/test/fixture.js","/test/preview-bootstrap.js"].includes(url.pathname)) {
          const response=await route.fetch(), body=await response.text();
          return route.fulfill({response,body:url.pathname==="/test/fixture.js" ? body+fixture : seed+body});
        }
        return route.continue();
      });
      const page=await context.newPage(),errors=[];
      page.on("pageerror",e=>errors.push(e.message));
      await page.goto(origin);
      await page.waitForFunction(()=>window.processedFixtureState?.rows.length>60 &&
        !processedFixtureState.loading && !processedFixtureState.syncing &&
        processedFixtureState.rows.find(row=>row.jiraKey==="EVOSCADA-17906")?.storyDetails,{},{timeout:60000});
      const counts=await expected(page);
      assert.equal(counts.processed,4,"Explicit implementation cases");
      const excel=await summary(page,counts,`excel-${width}-${height}`);
      await page.getByRole("button",{name:"Режим Jira",exact:true}).click();
      await page.getByRole("button",{name:"Загрузить замечания из Jira",exact:true}).click();
      await page.waitForFunction(()=>window.processedFixtureState.viewMode==="jira" &&
        processedFixtureState.rows.length>60 && !processedFixtureState.registryLoading && !processedFixtureState.syncing);
      const jira=await summary(page,counts,`jira-${width}-${height}`);
      await page.locator(".ujg-esi-team-filter-button").click();
      await page.locator(".ujg-esi-team-filter-only[data-team-id='qa']").click();
      await page.locator(".ujg-esi-team-filter-menu .ujg-esi-filter-apply").click();
      const qa=await summary(page,counts,`qa-${width}-${height}`);
      assert.deepEqual(errors,[]);
      const calls=await page.evaluate(()=>({writes:mutationCalls,llm:llmPreviewCalls.length}));
      assert.deepEqual(calls,{writes:0,llm:0});
      console.log(JSON.stringify({width,height,excel,jira,qa,calls,errors,artifacts}));
      await context.close();
    }
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
