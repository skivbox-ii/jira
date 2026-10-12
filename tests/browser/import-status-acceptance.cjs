const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {chromium} = require("playwright");
const origin = process.env.IMPORT_PREVIEW_URL || "http://127.0.0.1:4318";
assert.ok(["127.0.0.1","localhost","[::1]"].includes(new URL(origin).hostname));
const artifacts = process.env.IMPORT_STATUS_ARTIFACTS || "/tmp/import-usability-20261012/status-screenshots";

async function ready(page) {
  await page.waitForFunction(() => window.usabilityState?.rows.length > 60 && !usabilityState.loading &&
    !usabilityState.syncLoading && !usabilityState.registryLoading &&
    usabilityState.rows.some(row => row.storyDetails?.key === "EVOSCADA-16104"), null, {timeout:60000});
}
async function openStatus(page, key) {
  const status = page.locator(`tr[data-key='${key}'] .ujg-esi-cell-status button`).first();
  await status.scrollIntoViewIfNeeded();
  await page.waitForTimeout(100);
  await status.click();
  await page.locator(".ujg-esi-status-dialog [data-transition-id='21']").waitFor();
}
async function capture(page, name) {
  const dialog = page.locator(".ujg-esi-status-dialog");
  const bounds = await dialog.boundingBox(), viewport = page.viewportSize();
  assert.ok(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= viewport.width + 1 &&
    bounds.y + bounds.height <= viewport.height + 1, JSON.stringify(bounds));
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({path:path.join(artifacts,name + ".png")});
}
async function writes(page) { return page.evaluate(() => usabilityFixture.writes.length); }
async function outcome(page, expected) {
  await page.waitForFunction(value => document.querySelector(".ujg-esi-status-dialog")?.textContent.includes(value), expected);
}

(async () => {
  fs.mkdirSync(artifacts,{recursive:true});
  const browser = await chromium.launch({headless:true, executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined});
  try {
    for (const viewport of [{width:1440,height:900},{width:390,height:500}]) {
      const context = await browser.newContext({viewport});
      await context.addInitScript(() => localStorage.setItem("ujg-esi-state", JSON.stringify({projectKey:"EVOSCADA"})));
      await context.route("**/*", route => new URL(route.request().url()).origin === new URL(origin).origin ? route.continue() : route.abort());
      const page = await context.newPage(), errors=[];
      page.on("pageerror", error => errors.push(error.message));
      await page.goto(origin + "/?usability"); await ready(page);
      await page.evaluate(() => { usabilityFixture.delay=80; });
      await openStatus(page,"EVOSCADA-16104");
      const dialog=page.locator(".ujg-esi-status-dialog");
      await dialog.locator("[data-transition-id='41']").click();
      assert.match(await dialog.innerText(),/Решение/);
      assert.equal(await dialog.getByRole("button",{name:"Применить",exact:true}).isEnabled(),false);
      assert.match(await dialog.getByRole("link").first().getAttribute("href"),/EVOSCADA-16104/);
      assert.equal(await writes(page),0);
      await capture(page,"extra-fields-"+viewport.width);
      await dialog.locator("[data-transition-id='21']").click();
      assert.equal(await writes(page),0,"Selection alone must never write");
      await capture(page,"choose-"+viewport.width);
      await dialog.getByRole("button",{name:"Применить",exact:true}).click();
      await page.waitForFunction(() => usabilityFixture.writes.length === 1 &&
        usabilityState.rows.find(row => row.jiraKey === "EVOSCADA-16104")?.storyDetails?.status === "В работе");
      assert.deepEqual(await page.evaluate(() => usabilityFixture.writes[0]),{key:"EVOSCADA-16104",payload:{transition:{id:"21"}}});
      await capture(page,"success-"+viewport.width);
      await page.keyboard.press("Escape");
      await dialog.waitFor({state:"detached"});
      await openStatus(page,"EVOSCADA-18057");
      await dialog.locator("[data-transition-id='31']").click();
      await page.evaluate(() => { usabilityFixture.failReadback=true; });
      await dialog.getByRole("button",{name:"Применить",exact:true}).click();
      await outcome(page,"обнов");
      await page.waitForFunction(() => usabilityFixture.writes.length === 2 &&
        usabilityFixture.requests.some(request => request.state === "error" && request.url.endsWith("EVOSCADA-18057")));
      await capture(page,"readback-failed-"+viewport.width);
      assert.equal(await writes(page),2);
      await page.evaluate(() => { usabilityFixture.failReadback=false; });
      await dialog.getByRole("button",{name:/Обновить/}).click();
      await page.waitForFunction(() => usabilityState.rows.some(row => row.childStatuses?.some(child => child.key === "EVOSCADA-18057" && child.status === "Тестирование")));
      assert.equal(await writes(page),2,"Readback recovery must not repeat transition");
      await page.keyboard.press("Escape");
      await openStatus(page,"EVOSCADA-17906");
      await dialog.locator("[data-transition-id='21']").click();
      await page.evaluate(status => { usabilityFixture.uncertainTransition=true; usabilityFixture.uncertainStatus=status; },viewport.width === 1440 ? 408 : 499);
      await dialog.getByRole("button",{name:"Применить",exact:true}).click();
      await outcome(page,"Результат записи не подтверждён");
      assert.equal(await writes(page),3);
      await page.keyboard.press("Escape");
      await page.locator("tr[data-key='EVOSCADA-17906'] .ujg-esi-cell-status button").press("Enter");
      await outcome(page,"Результат записи не подтверждён");
      assert.equal(await dialog.getByRole("button",{name:"Применить",exact:true}).isEnabled(),false);
      await dialog.getByRole("button",{name:"Обновить данные",exact:true}).click();
      await outcome(page,"Данные обновлены. Результат записи не подтверждён");
      assert.equal(await writes(page),3,"Ambiguous writes stay read-only across reopening and recovery");
      await capture(page,"uncertain-"+viewport.width);
      await page.keyboard.press("Escape");
      assert.deepEqual(errors,[]);
      assert.equal(await page.evaluate(() => llmPreviewCalls.length),0);
      console.log(JSON.stringify({viewport,writes:3,onlyMockWrites:true,extraFields:true,readbackRetry:true,uncertainWriteGuard:true,errors,artifacts}));
      await context.close();
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode=1; });
