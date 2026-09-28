const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {chromium} = require("playwright");

const origin = process.env.IMPORT_PREVIEW_URL || "http://127.0.0.1:4318";
assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(new URL(origin).hostname), "Use the local fixture only");
const artifacts = process.env.IMPORT_FILTER_ARTIFACTS || path.join(os.tmpdir(), "import-filter-acceptance");
const person = "Петров П.";

async function layout(page) {
  return page.evaluate(() => {
    for (const key of Object.keys(localStorage)) {
      try {
        const value = JSON.parse(localStorage.getItem(key));
        if (value && value.gridLayout) return value.gridLayout;
      } catch (_) { /* Ignore other preferences. */ }
    }
    return null;
  });
}

async function filteredRows(page) {
  return page.locator(".ujg-esi-registry-table tbody tr.ujg-esi-parent-row, .ujg-esi-registry-table tbody tr.ujg-esi-child-row").evaluateAll(rows => rows.map(row => ({
    key:row.dataset.key, child:row.classList.contains("ujg-esi-child-row"), context:row.classList.contains("is-context"),
    assignee:row.querySelector(".ujg-esi-cell-assignee .ujg-esi-person > span:last-child")?.textContent.trim() || ""
  })));
}

async function assertChildMatch(page) {
  const rows = await filteredRows(page);
  assert.ok(rows.some(row => row.child && row.assignee === person), "Fixture must show matching BE tasks");
  assert.ok(rows.some(row => !row.child && row.context), "Child match must retain its context story");
  assert.ok(rows.filter(row => row.child).every(row => row.assignee === person), "No unrelated children may appear");
  assert.equal(await page.locator("[data-filter='assignee'].is-active").count(), 1);
  return rows;
}

async function openAssigneeFilter(page) {
  await page.locator("[data-filter='assignee']").scrollIntoViewIfNeeded();
  await page.waitForTimeout(150);
  await page.locator("[data-filter='assignee']").click();
  await page.locator(".ujg-esi-grid-menu").waitFor();
  return page.locator(".ujg-esi-grid-menu");
}

async function applyAssignee(page) {
  const menu = await openAssigneeFilter(page);
  await menu.locator(".ujg-esi-filter-all input").uncheck();
  await menu.locator(".ujg-esi-filter-option").filter({hasText:person}).locator("input").click();
  assert.equal(await menu.locator(".ujg-esi-selected-chip").filter({hasText:person}).count(), 1);
  assert.equal(await menu.locator(".ujg-esi-filter-option").filter({hasText:person}).count(), 0, "Selected person must not be duplicated");
  await menu.locator(".ujg-esi-filter-search").fill("Соколова");
  assert.equal(await menu.locator(".ujg-esi-selected-chip").filter({hasText:person}).count(), 1, "Search must retain the selected chip");
  await menu.locator(".ujg-esi-filter-apply").click();
  return assertChildMatch(page);
}

async function screenshot(page, name, width) {
  const file = path.join(artifacts, `${name}-${width}.png`);
  await page.screenshot({path:file, fullPage:false});
  return file;
}

async function loadJira(page) {
  await page.getByRole("button", {name:"Режим Jira", exact:true}).click();
  await refreshJira(page);
}

async function refreshJira(page) {
  const reads = await page.evaluate(() => window.issueReadCalls || 0);
  await page.getByRole("button", {name:"Загрузить замечания из Jira", exact:true}).click();
  await page.waitForFunction(previous => window.issueReadCalls > previous && document.querySelectorAll(".ujg-esi-parent-row").length > 0 &&
    !document.querySelector(".ujg-esi-loading") && !document.querySelector(".ujg-esi-sync-loading"), reads, {timeout:60000});
}

async function main() {
  fs.mkdirSync(artifacts, {recursive:true});
  const browser = await chromium.launch({headless:true, executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined});
  try {
    for (const width of [1440, 390]) {
      const context = await browser.newContext({viewport:{width,height:900}});
      await context.route("**/*", route => {
        const url = new URL(route.request().url());
        return url.origin === new URL(origin).origin ? route.continue() : route.abort();
      });
      const page = await context.newPage(), errors = [], shots = [];
      page.on("pageerror", error => errors.push(error.message));
      try {
        await page.goto(origin);
        await page.waitForFunction(() => document.querySelectorAll(".ujg-esi-parent-row").length === 50 &&
          document.querySelectorAll(".ujg-esi-child-row").length === 10 && !document.querySelector(".ujg-esi-loading"), null, {timeout:60000});

        // Set independent layout preferences before exercising filter resets.
        await page.locator("[data-sort='remarkId']").click();
        await page.getByRole("separator", {name:"Ширина: ID", exact:true}).press("ArrowRight");
        await page.getByRole("button", {name:"Столбцы", exact:true}).click();
        const columns = page.locator(".ujg-esi-grid-menu");
        await columns.locator(".ujg-esi-filter-option").filter({hasText:"Модуль Excel"}).locator("input").uncheck();
        await columns.locator(".ujg-esi-filter-apply").click();
        const chosenLayout = await layout(page);
        assert.equal(chosenLayout.sort.column, "remarkId");
        assert.equal(chosenLayout.widths.remarkId, 64);
        assert.ok(!chosenLayout.visible.includes("module"));

        await applyAssignee(page);
        shots.push(await screenshot(page, "filtered-excel", width));
        const before = await filteredRows(page);
        const matched = before.filter(row => row.child).length;
        assert.ok(matched > 1);
        const story = page.locator(".ujg-esi-parent-row").filter({has:page.locator(".ujg-esi-cell-remarkId", {hasText:"744"})}).first();
        assert.equal(await story.count(), 1);
        assert.equal(await story.evaluate(row => row.classList.contains("is-context")), true);
        await story.getByRole("button", {name:"Свернуть замечание 744", exact:true}).click();
        assert.ok((await filteredRows(page)).filter(row => row.child).length < matched, "Own disclosure hides its matching children");
        await page.getByRole("button", {name:"Развернуть замечание 744", exact:true}).click();
        assert.equal((await filteredRows(page)).filter(row => row.child).length, matched, "Own disclosure restores only matching children");

        // Both controls must work while the filter is active and never reveal siblings.
        const headerToggle = page.locator(".ujg-esi-registry-table thead th").first().locator("button");
        await headerToggle.click();
        assert.equal((await filteredRows(page)).filter(row => row.child).length, 0, "Header collapses matching groups");
        shots.push(await screenshot(page, "header-collapsed", width));
        await headerToggle.click();
        assert.equal((await filteredRows(page)).filter(row => row.child).length, matched, "Header reopens only matching children");
        await page.getByRole("button", {name:"Развернуть / свернуть все", exact:true}).click();
        assert.equal((await filteredRows(page)).filter(row => row.child).length, 0, "Toolbar collapses matching groups");
        await page.getByRole("button", {name:"Развернуть / свернуть все", exact:true}).click();
        await assertChildMatch(page);

        await loadJira(page);
        await assertChildMatch(page);
        shots.push(await screenshot(page, "filtered-jira", width));
        await refreshJira(page);
        await assertChildMatch(page);
        await page.getByRole("tab", {name:"Динамика"}).click();
        await page.getByRole("tab", {name:"Реестр"}).click();
        await page.locator(".ujg-esi-registry-table").waitFor();
        await assertChildMatch(page);
        await page.getByRole("button", {name:"Режим Excel", exact:true}).click();
        await assertChildMatch(page);
        await loadJira(page);
        await assertChildMatch(page);
        await page.reload();
        await page.locator(".ujg-esi-registry-table").waitFor({timeout:60000});
        await page.waitForFunction(() => document.querySelectorAll(".ujg-esi-parent-row").length > 0 && !document.querySelector(".ujg-esi-loading"), null, {timeout:60000});
        await assertChildMatch(page);
        shots.push(await screenshot(page, "persisted-reload", width));
        const beforeResetLayout = await layout(page);

        const topReset = page.locator(".ujg-esi-toolbar [aria-label='Сбросить все фильтры']");
        assert.equal(await topReset.count(), 1, "Toolbar reset must be reachable without scrolling to the footer");
        assert.equal(await topReset.isEnabled(), true);
        await topReset.click();
        assert.equal(await page.locator("[data-filter='assignee'].is-active").count(), 0);
        const resetLayout = await layout(page);
        assert.deepEqual(resetLayout.sort, beforeResetLayout.sort, "Reset preserves sorting");
        assert.deepEqual(resetLayout.order, beforeResetLayout.order, "Reset preserves column order");
        assert.deepEqual(resetLayout.visible, beforeResetLayout.visible, "Reset preserves visible columns");
        Object.entries(beforeResetLayout.widths).forEach(([column, widthValue]) => {
          assert.equal(resetLayout.widths[column], widthValue, "Reset preserves width of " + column);
        });
        assert.equal(resetLayout.widths.remarkId, 64, "The manually resized ID column survives reset");

        // Applying an empty selection must keep the reset action available.
        const emptyFilter = await openAssigneeFilter(page);
        await emptyFilter.locator(".ujg-esi-filter-all input").uncheck();
        await emptyFilter.locator(".ujg-esi-filter-apply").click();
        assert.equal(await page.locator(".ujg-esi-parent-row").count(), 0);
        assert.match(await page.locator(".ujg-esi-grid-empty").innerText(), /Нет замечаний/);
        assert.equal(await topReset.isEnabled(), true);
        shots.push(await screenshot(page, "empty-result", width));
        await topReset.click();
        await page.locator(".ujg-esi-parent-row").first().waitFor();

        // Reach the final page and both ends of the table's own scroll region.
        await page.getByRole("combobox", {name:"Замечаний на странице"}).selectOption("20");
        const next = page.getByRole("button", {name:"Следующая страница", exact:true});
        let pages = 1;
        while (await next.isEnabled()) {
          assert.ok(pages < 10, "Fixture pagination should be bounded");
          await next.click();
          pages++;
        }
        assert.ok(pages > 1, "Fixture must reach a later page");
        const scroll = page.locator(".ujg-esi-registry-scroll");
        const edges = await scroll.evaluate(el => {
          el.scrollTop = el.scrollHeight;
          el.scrollLeft = el.scrollWidth;
          return {left:el.scrollLeft, maxLeft:el.scrollWidth-el.clientWidth,
            top:el.scrollTop, maxTop:el.scrollHeight-el.clientHeight,
            documentOverflow:document.documentElement.scrollWidth > innerWidth};
        });
        assert.ok(edges.maxLeft > 0 && Math.abs(edges.left-edges.maxLeft) <= 2, "Table must scroll horizontally to the end");
        assert.ok(Math.abs(edges.top-edges.maxTop) <= 2, "Table must scroll vertically to the final row");
        assert.equal(edges.documentOverflow, false, "Horizontal overflow belongs inside the table");
        assert.ok(await page.locator(".ujg-esi-parent-row").last().count());
        shots.push(await screenshot(page, "last-page-end", width));

        const stats = await page.evaluate(() => ({mutationCalls:window.mutationCalls, llmCalls:window.llmPreviewCalls?.length || 0}));
        assert.deepEqual(stats, {mutationCalls:0,llmCalls:0});
        assert.deepEqual(errors, []);
        console.log(JSON.stringify({width,pages,edges,...stats,pageerrors:errors.length,screenshots:shots}));
      } finally { await context.close(); }
    }
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
