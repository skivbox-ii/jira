const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const {chromium} = require("playwright");

const origin = process.env.IMPORT_PREVIEW_URL || "http://127.0.0.1:4317";
assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(new URL(origin).hostname));
const artifacts = process.env.IMPORT_USABILITY_ARTIFACTS || path.join(os.tmpdir(), "import-usability-20261012", "screenshots");
const captureState = `(function(){
  var render=modules._ujgESI_rendering.render;
  modules._ujgESI_rendering.render=function(state){window.usabilityState=state;return render.apply(this,arguments);};
})();`;

async function ready(page) {
  await page.waitForFunction(() => window.usabilityState?.rows.length > 60 &&
    !usabilityState.loading && !usabilityState.syncLoading && !usabilityState.registryLoading &&
    usabilityState.rows.some(row => row.storyDetails), null, {timeout:60000});
}
async function widths(page) {
  return page.locator(".ujg-esi-registry-table").evaluate(table => Object.fromEntries(
    Array.from(table.querySelectorAll("col[data-column]")).map(col => [col.dataset.column, Number(col.getAttribute("width"))])
  ));
}
async function fit(page) {
  await page.getByRole("button", {name:"Столбцы", exact:true}).click();
  await page.getByRole("button", {name:"Подстроить ширины", exact:true}).click();
}
async function screen(page, name) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  assert.ok(overflow <= 1, "Only the table may overflow, not the page: " + overflow);
  await page.screenshot({path:path.join(artifacts, name + ".png")});
}

(async () => {
  fs.mkdirSync(artifacts, {recursive:true});
  const browser = await chromium.launch({headless:true, executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined});
  try {
    for (const viewport of [{width:1440,height:900}, {width:390,height:844}, {width:390,height:500}]) {
      const context = await browser.newContext({viewport});
      await context.addInitScript(() => {
        if (sessionStorage.getItem("usability-seeded")) return;
        sessionStorage.setItem("usability-seeded", "yes");
        localStorage.setItem("ujg-esi-state", JSON.stringify({projectKey:"EVOSCADA", gridLayout:{
          visible:["remarkId","remark","status","age","assignee","priority","summary"],
          order:["remarkId","remark","status","age","assignee","priority","summary"],
          widths:{remark:280, summary:310}, filters:{}, sort:null
        }}));
      });
      await context.route("**/*", async route => {
        const url = new URL(route.request().url());
        if (url.origin !== new URL(origin).origin) return route.abort();
        if (url.pathname === "/test/preview-bootstrap.js") {
          const response = await route.fetch();
          return route.fulfill({response, body:captureState + await response.text()});
        }
        return route.continue();
      });
      const page = await context.newPage(), errors = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.goto(origin); await ready(page);
      assert.equal((await widths(page)).summary, 310, "Existing saved width is preserved before fitting");
      await fit(page);
      const compact = await widths(page);
      assert.ok(compact.remark >= 300 && compact.remarkId <= 54 && compact.status < 112);
      const fixed = Object.entries(compact).filter(([key]) => key !== "summary").reduce((sum, [,value]) => sum + value, 72);
      const container = await page.locator(".ujg-esi-registry-scroll").evaluate(el => el.clientWidth);
      assert.equal(compact.summary, Math.max(240, container - fixed));
      assert.ok(await page.locator(".ujg-esi-remark-controls").count() > 0);
      await screen(page, "compact-" + viewport.width + "x" + viewport.height);

      await page.getByRole("button", {name:"Столбцы",exact:true}).click();
      await page.getByRole("dialog", {name:"Столбцы",exact:true}).getByRole("checkbox", {name:"Замечание из Excel",exact:true}).uncheck();
      await page.setViewportSize({width:viewport.width + 250, height:viewport.height});
      await page.waitForTimeout(100);
      assert.equal((await widths(page)).remark, compact.remark, "Unconfirmed visibility does not change rendered widths");
      await page.getByRole("dialog", {name:"Столбцы",exact:true}).press("Escape");
      await fit(page);
      assert.equal((await widths(page)).remark, compact.remark, "Fitting must not persist cancelled visibility");
      await page.setViewportSize(viewport);

      await page.locator("[data-filter='assignee']").scrollIntoViewIfNeeded();
      await page.waitForTimeout(100);
      await page.locator("[data-filter='assignee']").click();
      const search = page.getByRole("searchbox", {name:"Поиск значений",exact:true});
      await search.fill("Соколова"); await search.focus();
      const draft = await search.inputValue();
      await page.setViewportSize({width:viewport.width + 250, height:viewport.height});
      await page.waitForTimeout(100);
      assert.equal(await search.inputValue(), draft);
      assert.equal(await search.evaluate(el => el === document.activeElement), true);
      await search.press("Escape");
      const resized = await widths(page);
      assert.equal(resized.remark, compact.remark);
      assert.equal(resized.status, compact.status);
      if (viewport.width === 1440) assert.equal(resized.summary, compact.summary + 250);
      await page.setViewportSize(viewport);

      await page.getByRole("button", {name:"Режим Jira", exact:true}).click();
      if (!await page.locator(".ujg-esi-parent-row").count()) {
        await page.getByRole("button", {name:"Загрузить замечания из Jira",exact:true}).click();
      }
      await ready(page);
      assert.equal((await widths(page)).summary, 310, "Excel fit must not alter Jira profile");
      await fit(page);
      await page.getByRole("separator", {name:"Ширина: Тема задачи",exact:true}).press("ArrowLeft");
      const manual = (await widths(page)).summary;
      await page.setViewportSize({width:viewport.width + 250, height:viewport.height});
      await page.waitForTimeout(100);
      assert.equal((await widths(page)).summary, manual);
      await page.getByRole("button", {name:"Режим Excel",exact:true}).click();
      await ready(page);
      assert.equal((await widths(page)).summary, resized.summary, "Excel stays flexible independently");
      await page.reload(); await ready(page);
      assert.equal((await widths(page)).summary, resized.summary, "Flexible profile survives reload");
      assert.deepEqual(await page.evaluate(() => ({writes:mutationCalls,llm:llmPreviewCalls.length})), {writes:0,llm:0});
      assert.deepEqual(errors, []);
      console.log(JSON.stringify({viewport,compact,manual,errors,artifacts}));
      await context.close();
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
