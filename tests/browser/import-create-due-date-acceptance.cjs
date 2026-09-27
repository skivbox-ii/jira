const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {chromium} = require("playwright");

const origin = process.env.IMPORT_PREVIEW_URL || "http://127.0.0.1:4317";
assert.ok(["127.0.0.1","localhost","[::1]"].includes(new URL(origin).hostname),"Acceptance must use a loopback preview");
const artifacts = process.env.IMPORT_DUE_CREATE_ARTIFACTS || path.join(os.tmpdir(),"import-create-due-date-20260927");

async function setup(browser, width, raw, reject = false) {
  const context = await browser.newContext({viewport:{width,height:900}});
  await context.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.origin !== new URL(origin).origin) return route.abort();
    if (url.pathname !== "/test/preview-bootstrap.js") return route.continue();
    const response = await route.fetch();
    const body = (await response.text()).replace("new modules._ujgExcelStoryImporter",
      "window.importDue = {state:function(){return currentState;},callbacks:function(){return callbacks;}}; new modules._ujgExcelStoryImporter");
    return route.fulfill({response,body});
  });
  const page = await context.newPage(), errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(origin);
  await page.waitForFunction(() => window.importDue?.state()?.rows?.length === 71 && !window.importDue.state().syncLoading);
  await page.evaluate(({raw,reject}) => {
    const state=window.importDue.state(), row=state.rows.find(row => String(row.sourceColumns.ID || row.sourceColumns["№"]) === "815");
    state.createSubtasks=false;
    state.mappingSettings.moduleComponentMap={"Интерфейс":"АСУТП"};
    state.mappingSettings.columnMap.deadline="Плановый выпуск";
    state.sourceColumnSettings=Object.assign({},state.sourceColumnSettings,{
      columnMap:Object.assign({},state.sourceColumnSettings?.columnMap || state.mappingSettings.columnMap,{deadline:"Плановый выпуск"})
    });
    row.sourceColumns={ID:"815","Замечание":row.summary,"Модуль":"Интерфейс","Плановый выпуск":typeof raw === "object" ? raw.primary : raw};
    if (raw && typeof raw === "object") row.sourceColumns["Плановый выпуск (колонка 2)"]=raw.duplicate;
    window.importDueRow=row;
    window.importDueSource=JSON.stringify(row.sourceColumns);
    window.importDueCreates=[];
    window.offlineApi.createIssue=payload => {
      window.importDueCreates.push(payload);
      return reject ? Promise.reject({responseJSON:{errors:{duedate:"Срок отклонён тестовой Jira"}}}) : Promise.resolve({key:"EVOSCADA-99998"});
    };
  },{raw,reject});
  await page.locator(".ujg-esi-create-row").first().click();
  const dialog=page.locator(".ujg-esi-confirm-modal");
  await dialog.waitFor();
  return {context,page,dialog,errors,date:dialog.getByLabel("Срок исполнения (Due date)",{exact:true}),
    omit:dialog.getByLabel("Не указывать срок",{exact:true})};
}

async function sourceUnchanged(page) {
  const sources=await page.evaluate(() => {
    const original=JSON.parse(window.importDueSource), current=window.importDueRow.sourceColumns;
    return {original,current:Object.fromEntries(Object.keys(original).map(key=>[key,current[key]]))};
  });
  assert.deepEqual(sources.current,sources.original,"Source cells must remain unchanged; newly added Jira key metadata is expected after creation");
  assert.equal(await page.evaluate(() => window.llmPreviewCalls.length),0);
}

async function submit(test, expected) {
  await test.dialog.getByRole("button",{name:"Создать в Jira",exact:true}).click();
  await test.page.waitForFunction(() => window.importDueCreates.length === 1);
  const fields=await test.page.evaluate(() => window.importDueCreates[0].fields);
  assert.equal(fields.duedate,expected);
  assert.deepEqual(fields.components,[{id:"1"}]);
  await sourceUnchanged(test.page);
  assert.deepEqual(test.errors,[]);
}

async function main() {
  fs.mkdirSync(artifacts,{recursive:true});
  const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined});
  try {
    for (const width of [1440,390]) {
      const test=await setup(browser,width,"30.09.2026");
      assert.equal(await test.date.inputValue(),"2026-09-30");
      assert.match(await test.dialog.textContent(),/30\.09\.2026/);
      await test.date.fill("2026-10-02");
      await test.dialog.getByRole("button",{name:"Отмена",exact:true}).click();
      assert.equal(await test.dialog.count(),0);
      assert.equal(await test.page.evaluate(() => window.importDueCreates.length),0);
      assert.equal(await test.page.evaluate(() => JSON.stringify(window.importDueRow.sourceColumns) === window.importDueSource),true);
      await sourceUnchanged(test.page);
      await test.page.locator(".ujg-esi-create-row").first().click();
      assert.equal(await test.date.inputValue(),"2026-09-30");
      await test.date.scrollIntoViewIfNeeded();
      const bounds=await test.date.boundingBox();
      assert.ok(bounds.x >= 0 && bounds.x+bounds.width <= width,"Due date input must fit viewport");
      const checkbox=await test.omit.boundingBox();
      const label=await test.dialog.locator(".ujg-esi-confirm-due-omit span").boundingBox();
      assert.ok(checkbox.width <= 20 && checkbox.height <= 20,"Omit must use a compact checkbox");
      assert.ok(Math.abs(checkbox.y+checkbox.height/2-label.y-label.height/2) < 5,"Omit label must align with checkbox");
      const frame=await test.dialog.boundingBox();
      assert.ok(frame.x >= 0 && frame.x+frame.width <= width,"Creation dialog must fit viewport");
      const confirmBounds=await test.dialog.getByRole("button",{name:"Создать в Jira",exact:true}).boundingBox();
      assert.ok(confirmBounds.x+confirmBounds.width <= width && confirmBounds.y+confirmBounds.height <= 900,"Confirm command must not be clipped");
      await test.page.screenshot({path:path.join(artifacts,`valid-date-${width}.png`)});
      await submit(test,"2026-09-30");
      await test.page.locator(".ujg-esi-add-child").last().click();
      assert.equal(await test.dialog.getByLabel("Срок исполнения (Due date)",{exact:true}).count(),0);
      await test.dialog.getByRole("button",{name:"Отмена",exact:true}).click();
      assert.equal(await test.page.evaluate(() => window.importDueCreates.length),1);
      await test.context.close();
      console.log(JSON.stringify({width,validDate:true,cancelPreservesSource:true,stubCreates:1}));
    }
    const changed=await setup(browser,1440,"30.09.2026");
    await changed.dialog.locator(".ujg-esi-confirm-source tr").filter({hasText:"Плановый выпуск"}).locator("input").fill("02.10.2026");
    await changed.dialog.getByRole("button",{name:"Создать в Jira",exact:true}).click();
    assert.equal(await changed.page.evaluate(() => window.importDueCreates.length),0,"Changed source must not submit the stale prefill");
    assert.equal(await changed.date.inputValue(),"2026-10-02");
    await changed.page.evaluate(() => { window.importDueSource=JSON.stringify(window.importDueRow.sourceColumns); });
    await changed.date.scrollIntoViewIfNeeded();
    await changed.page.screenshot({path:path.join(artifacts,"changed-source-reconfirm.png")});
    await submit(changed,"2026-10-02");
    await changed.context.close();
    console.log(JSON.stringify({changedSourceReconfirm:true,stubCreates:1}));
    for (const mode of ["correction","omit","conflict","empty","reject"]) {
      const raw=mode === "empty" ? "" : mode === "reject" ? "30.09.2026" : mode === "conflict" ? {primary:"30.09.2026",duplicate:"01.10.2026"} : "31.02.2026";
      const test=await setup(browser,1440,raw,mode === "reject");
      if (mode === "correction" || mode === "omit" || mode === "conflict") {
        assert.equal(await test.date.inputValue(),"");
        assert.match(await test.dialog.textContent(),mode === "conflict" ? /Противоречивые сроки/ : /31\.02\.2026/);
        const confirm=test.dialog.getByRole("button",{name:"Создать в Jira",exact:true});
        if (await confirm.isEnabled()) await confirm.click();
        assert.equal(await test.dialog.count(),1,"Invalid source must retain the confirmation dialog");
        assert.equal(await test.page.evaluate(() => window.importDueCreates.length),0);
        await test.date.scrollIntoViewIfNeeded();
        await test.page.screenshot({path:path.join(artifacts,`invalid-${mode}.png`)});
        if (mode !== "omit") await test.date.fill("2026-10-01");
        else await test.omit.check();
      }
      await submit(test,mode === "correction" || mode === "conflict" ? "2026-10-01" : mode === "reject" ? "2026-09-30" : undefined);
      if (mode === "reject") {
        await test.page.waitForFunction(() => window.importDueRow.errors?.some(message => message.includes("Срок отклонён")));
        assert.equal(await test.page.evaluate(() => window.importDueCreates.length),1,"No retry without due date");
        await test.page.locator(".ujg-esi-error-details").filter({hasText:"Срок отклонён"}).locator("summary").click();
        await test.page.screenshot({path:path.join(artifacts,"jira-rejection.png")});
      }
      await test.context.close();
      console.log(JSON.stringify({mode,stubCreates:1,sourceUnchanged:true}));
    }
  } finally { await browser.close(); }
}

main().catch(error => { console.error(error); process.exitCode=1; });
