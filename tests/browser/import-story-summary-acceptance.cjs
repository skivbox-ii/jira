const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const {chromium} = require("playwright");

const origin = process.env.IMPORT_PREVIEW_URL || "http://127.0.0.1:4318";
assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(new URL(origin).hostname));
const artifacts = process.env.IMPORT_STORY_SUMMARY_ARTIFACTS || path.join(os.tmpdir(), "import-story-summary-acceptance");
const main = "table[aria-label='Истории по текущему статусу Jira']";

async function expected(page) {
  return page.evaluate(() => {
    const counts = {done:0,testing:0,cancelled:0,open:0};
    for (const issue of Object.values(window.fixtureIssues)) {
      if (issue.fields.issuetype.name !== "История") continue;
      const status = issue.fields.status;
      if (/снят|отмен|cancel/i.test(status.name)) counts.cancelled++;
      else if (status.statusCategory.key === "done") counts.done++;
      else if (/тест|провер/i.test(status.name)) counts.testing++;
      else if (["new","indeterminate"].includes(status.statusCategory.key)) counts.open++;
      else throw new Error("Unexpected fixture story status: " + status.name);
    }
    return counts;
  });
}

async function inspectSummary(page, counts, label, width) {
  await page.locator(".ujg-esi-import-summary > summary").click();
  const dialog = page.getByRole("dialog", {name:"Сводка замечаний", exact:true});
  await dialog.waitFor();
  const details = dialog.locator(".ujg-esi-stats-details");
  assert.equal(await details.getAttribute("open"), null);
  for (const [key,value] of Object.entries(counts)) {
    const row = dialog.locator(`${main} [data-story-state='${key}']`);
    assert.equal(await row.locator("td").innerText(), String(value));
    const box = await row.boundingBox();
    assert.ok(box.y >= 0 && box.y + box.height <= 900, "All four totals fit the first view");
  }
  assert.equal(await dialog.locator(".ujg-esi-counters").isVisible(), false);
  await page.screenshot({path:path.join(artifacts, `${label}-${width}.png`)});
  await details.locator("summary").focus();
  await page.keyboard.press("Enter");
  assert.notEqual(await details.getAttribute("open"), null);
  assert.equal(await details.locator("table").count(), 4);
  await dialog.locator(".ujg-esi-counters").scrollIntoViewIfNeeded();
  assert.equal(await dialog.locator(".ujg-esi-counters").isVisible(), true);
  const bounds = await dialog.evaluate(el => {
    const box = el.getBoundingClientRect();
    return {left:box.left,right:box.right,bottom:box.bottom,width:innerWidth,overflow:el.scrollWidth-el.clientWidth,
      atBottom:el.scrollHeight-el.scrollTop-el.clientHeight};
  });
  assert.ok(bounds.left >= 0 && bounds.right <= bounds.width && bounds.bottom <= 900);
  assert.ok(bounds.overflow <= 1, "Summary has no horizontal overflow");
  assert.ok(bounds.atBottom < 3, "Details scrolled through the final counters");
  await page.screenshot({path:path.join(artifacts, `${label}-details-bottom-${width}.png`)});
  await details.locator("summary").click();
  assert.equal(await details.getAttribute("open"), null);
  await page.keyboard.press("Escape");
  assert.equal(await dialog.isVisible(), false);
  return bounds;
}

(async () => {
  fs.mkdirSync(artifacts, {recursive:true});
  const browser = await chromium.launch({headless:true, executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined});
  try {
    for (const width of [1440,390]) {
      const context = await browser.newContext({viewport:{width,height:900}});
      await context.route("**/*", route => new URL(route.request().url()).origin === new URL(origin).origin ? route.continue() : route.abort());
      const page = await context.newPage(), errors = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.goto(origin);
      await page.waitForFunction(() => document.querySelectorAll(".ujg-esi-parent-row").length === 50 &&
        document.querySelectorAll(".ujg-esi-child-row").length === 10 && !document.querySelector(".ujg-esi-loading"), null, {timeout:60000});
      const counts = await expected(page);
      const excel = await inspectSummary(page, counts, "excel", width);
      await page.getByRole("button", {name:"Режим Jira", exact:true}).click();
      await page.getByRole("button", {name:"Загрузить замечания из Jira", exact:true}).click();
      await page.waitForFunction(() => document.querySelectorAll(".ujg-esi-parent-row").length > 0 &&
        !document.querySelector(".ujg-esi-loading") && !document.querySelector(".ujg-esi-sync-loading"), null, {timeout:60000});
      const jira = await inspectSummary(page, counts, "jira", width);
      await page.locator(".ujg-esi-team-filter-button").click();
      await page.locator(".ujg-esi-team-filter-only[data-team-id='qa']").click();
      await page.locator(".ujg-esi-team-filter-menu .ujg-esi-filter-apply").click();
      const filtered = await inspectSummary(page, counts, "qa-filtered", width);
      const calls = await page.evaluate(() => ({writes:window.mutationCalls,llm:window.llmPreviewCalls.length}));
      assert.deepEqual(calls, {writes:0,llm:0}); assert.deepEqual(errors, []);
      console.log(JSON.stringify({width,counts,excel,jira,filtered,calls,errors,artifacts}));
      await context.close();
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
