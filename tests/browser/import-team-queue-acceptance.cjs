const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {chromium} = require("playwright");

const origin = process.env.IMPORT_PREVIEW_URL || "http://127.0.0.1:4318";
assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(new URL(origin).hostname), "Use the local fixture only");
const artifacts = process.env.IMPORT_TEAM_QUEUE_ARTIFACTS || path.join(os.tmpdir(), "import-team-queue-acceptance");
const teamButton = ".ujg-esi-team-filter-button";
const menuSelector = ".ujg-esi-team-filter-menu";
const table = ".ujg-esi-registry-table";
const syntheticFixture = `
(function() {
  var parent = fixtureIssues["EVOSCADA-16104"];
  function add(key, role, status, category, assignee) {
    var issue = JSON.parse(JSON.stringify(fixtureIssues["EVOSCADA-23111"]));
    issue.key = key;
    issue.fields.summary = "[" + role + "] QA queue regression " + key;
    issue.fields.status = {id:key,name:status,statusCategory:{key:category}};
    issue.fields.assignee = {name:assignee,displayName:"Петров П."};
    fixtureIssues[key] = issue;
    parent.fields.issuelinks.push({type:{name:"Child",outward:"is parent of",inward:"is child of"},outwardIssue:{key:key,fields:issue.fields}});
  }
  add("EVOSCADA-99001","QA","Готово","done","petrov");
  add("EVOSCADA-99002","QA","Отменено","indeterminate","petrov");
  add("EVOSCADA-99003","QA","Custom workflow","indeterminate","petrov");
  add("EVOSCADA-99004","BE","В работе","indeterminate","qa-local");
  add("EVOSCADA-99005","BE","Готово","done","qa-local");
  add("EVOSCADA-99006","BE","Тестирование","indeterminate","qa-local");
  add("EVOSCADA-99007","BE","В работе","indeterminate","petrov");
  fixtureIssues["EVOSCADA-23110"].fields.assignee = {name:"qa-local",displayName:"Петров П."};
})();`;
const teamSeed = `
(function() {
  var teamsModule = modules._ujgESI_teams;
  var key = teamsModule.storageKey("ujg-esi-state", "EVOSCADA");
  if (localStorage.getItem(key) === null) {
    var teams = teamsModule.defaults();
    teams.filter(function(team) { return team.id === "qa"; })[0].members.push({id:"qa-local",label:"Петров П.",identifiers:["qa-local","qa-alias"]});
    teamsModule.save(localStorage,"ujg-esi-state","EVOSCADA",teams);
  }
})();`;

async function layout(page) {
  return page.evaluate(() => {
    for (const key of Object.keys(localStorage)) {
      try { const value = JSON.parse(localStorage.getItem(key)); if (value && value.gridLayout) return value.gridLayout; }
      catch (_) { /* Other preferences may not be JSON. */ }
    }
    return null;
  });
}

async function rows(page) {
  return page.locator(`${table} tbody tr.ujg-esi-parent-row, ${table} tbody tr.ujg-esi-child-row`).evaluateAll(elements => elements.map(row => ({
    key:row.dataset.key, child:row.classList.contains("ujg-esi-child-row"), context:row.classList.contains("is-context"),
    assignee:row.querySelector(".ujg-esi-cell-assignee .ujg-esi-person > span:last-child")?.textContent.trim() || ""
  })));
}

async function expectedQa(page) {
  return page.evaluate(() => {
    const exact = /^(testing|in testing|тестирование|на тестировании)$/i;
    const aliases = new Set(), roles = new Set(), members = new Set(), stories = new Set();
    const saved = JSON.parse(localStorage.getItem(modules._ujgESI_teams.storageKey("ujg-esi-state","EVOSCADA")));
    const memberIds = new Set(saved.find(team => team.id === "qa").members.flatMap(member => [member.id,...member.identifiers]));
    for (const issue of Object.values(window.fixtureIssues)) {
      const story = issue.fields.issuetype.name === "История";
      const role = /^\[([^\]]+)\]/.exec(issue.fields.summary)?.[1].toUpperCase() || "";
      const status = issue.fields.status.name.trim().replace(/\s+/g, " ");
      const byStatus = exact.test(status), byRole = role === "QA";
      const byMember = memberIds.has(issue.fields.assignee?.name);
      if (byStatus) aliases.add(issue.key);
      if (byRole) roles.add(issue.key);
      if (byMember) members.add(issue.key);
      if (story && (byStatus || byMember)) stories.add(issue.key);
    }
    const children = [...new Set([...aliases,...roles,...members])].filter(key => !stories.has(key)).sort();
    return {aliases:[...aliases].sort(), roles:[...roles].sort(), members:[...members].sort(), stories:[...stories].sort(), children};
  });
}

async function qaRows(page, expected) {
  const actual = await rows(page), children = actual.filter(row => row.child);
  assert.deepEqual(children.map(row => row.key).sort(), expected.children, "QA rows must equal status OR role OR member union");
  assert.equal(new Set(children.map(row => row.key)).size, children.length, "No duplicate child rows");
  assert.ok(actual.some(row => !row.child && row.context), "Matching children retain context stories");
  assert.ok(expected.stories.every(key => actual.some(row => row.key === key && !row.child && !row.context)), "Directly matching stories remain visible");
  assert.ok(!actual.some(row => row.key === "EVOSCADA-23111" || row.key === "EVOSCADA-99007"), "Parent and label matches do not leak siblings");
  for (const key of ["EVOSCADA-99001","EVOSCADA-99002","EVOSCADA-99003","EVOSCADA-99004","EVOSCADA-99005","EVOSCADA-99006"]) {
    assert.ok(children.some(row => row.key === key), `${key} exercises a QA branch`);
  }
  assert.equal(await page.locator(`${teamButton}.is-active`).count(), 1);
  return actual;
}

async function openTeam(page) {
  await page.locator(teamButton).click();
  const menu = page.locator(menuSelector);
  await menu.waitFor();
  assert.equal(await menu.getAttribute("role"), "dialog");
  assert.equal(await page.locator(teamButton).getAttribute("aria-expanded"), "true");
  const command = await menu.locator(".ujg-esi-menu-command").evaluate(button => {
    const label=button.querySelector("span"), box=button.getBoundingClientRect(), text=label.getBoundingClientRect();
    return {label:label.textContent.trim(), width:box.width, textWidth:text.width,
      clipped:label.scrollWidth > label.clientWidth || text.right > box.right-3};
  });
  assert.equal(command.label,"Снять фильтр");
  assert.ok(command.width > 90 && command.textWidth > 40 && !command.clipped,"Team reset command text must fit its button");
  return menu;
}

async function onlyQa(page) {
  const menu = await openTeam(page);
  await menu.locator(".ujg-esi-team-filter-only[data-team-id='qa']").click();
  await menu.locator(".ujg-esi-filter-apply").click();
  assert.equal(await page.locator(teamButton).getAttribute("aria-expanded"), "false");
}

async function applyAssignee(page, name) {
  await page.locator("[data-filter='assignee']").scrollIntoViewIfNeeded();
  await page.locator("[data-filter='assignee']").click();
  const menu = page.locator(".ujg-esi-grid-menu");
  await menu.locator(".ujg-esi-filter-all input").uncheck();
  await menu.locator(".ujg-esi-filter-option").filter({hasText:name}).locator("input").click();
  await menu.locator(".ujg-esi-filter-apply").click();
}

async function refreshJira(page) {
  const reads = await page.evaluate(() => window.issueReadCalls || 0);
  await page.getByRole("button", {name:"Загрузить замечания из Jira", exact:true}).click();
  await page.waitForFunction(previous => window.issueReadCalls > previous && document.querySelectorAll(".ujg-esi-parent-row").length > 0 &&
    !document.querySelector(".ujg-esi-loading") && !document.querySelector(".ujg-esi-sync-loading"), reads, {timeout:60000});
}

async function shot(page, label, width) {
  const file = path.join(artifacts, `${label}-${width}.png`);
  await page.screenshot({path:file, fullPage:false});
  return file;
}

async function main() {
  fs.mkdirSync(artifacts, {recursive:true});
  const browser = await chromium.launch({headless:true, executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined});
  try {
    for (const width of [1440,390]) {
      const context = await browser.newContext({viewport:{width,height:900}});
      await context.route("**/*", async route => {
        const url = new URL(route.request().url());
        if (url.origin !== new URL(origin).origin) return route.abort();
        if (url.pathname === "/test/fixture.js" || url.pathname === "/test/preview-bootstrap.js") {
          const response = await route.fetch();
          const body = await response.text();
          return route.fulfill({response,body:url.pathname === "/test/fixture.js" ? body + syntheticFixture : teamSeed + body});
        }
        return route.continue();
      });
      const page = await context.newPage(), errors = [], shots = [];
      page.on("pageerror", error => errors.push(error.message));
      try {
        await page.goto(origin);
        await page.waitForFunction(() => document.querySelectorAll(".ujg-esi-parent-row").length === 50 &&
          document.querySelectorAll(".ujg-esi-child-row").length === 10 && !document.querySelector(".ujg-esi-loading") &&
          !document.querySelector(".ujg-esi-sync-loading"), null, {timeout:60000});
        await page.getByRole("combobox", {name:"Замечаний на странице"}).selectOption("100");
        await page.locator("[data-sort='remarkId']").click();
        const selectedSort = (await layout(page)).sort;
        assert.equal(selectedSort.column, "remarkId");
        const expected = await expectedQa(page);
        assert.ok(expected.aliases.length > 0 && expected.roles.length > 0 && expected.members.length > 0 && expected.stories.length > 0,
          "Fixture covers status, role, member and parent branches");
        const beFixture = await page.evaluate(() => window.fixtureIssues["EVOSCADA-23111"].fields);
        assert.match(beFixture.summary,/^\[BE\]/);
        assert.equal(beFixture.status.name,"В работе");
        assert.ok(!expected.children.includes("EVOSCADA-23111"));

        // Draft changes keep their inputs and focus; Cancel must leave the applied filter alone.
        let menu = await openTeam(page);
        shots.push(await shot(page,"team-menu",width));
        const qaInput = await menu.locator("input[data-team-id='qa']").elementHandle();
        await menu.locator(".ujg-esi-team-filter-only[data-team-id='qa']").click();
        await menu.locator("input[data-team-id='qa']").focus();
        await menu.locator("input[data-team-id='qa']").uncheck();
        assert.equal(await qaInput.evaluate(el => el === document.activeElement), true, "Checkbox retains focus");
        await menu.locator(".ujg-esi-team-filter-only[data-team-id='qa']").click();
        await menu.locator(".ujg-esi-filter-search").fill("BE");
        assert.equal(await qaInput.evaluate(el => el === document.querySelector(".ujg-esi-team-filter-menu input[data-team-id='qa']")), true, "Search retains checkbox node");
        assert.equal(await menu.locator("input[data-team-id='qa']").isChecked(), true, "Search retains hidden selection");
        await menu.locator("input[data-team-id='be']").check();
        assert.equal(await menu.locator("input[data-team-id='be']").isChecked(), true);
        await menu.getByRole("button", {name:"Отмена"}).click();
        assert.equal(await page.locator(`${teamButton}.is-active`).count(), 0, "Cancel does not apply draft");
        assert.equal((await layout(page)).filters.teamIds, undefined);

        await onlyQa(page);
        const selected = await qaRows(page, expected);
        shots.push(await shot(page,"qa-excel",width));
        const childrenBefore = selected.filter(row => row.child).length;
        await page.locator("[data-filter='status']").scrollIntoViewIfNeeded();
        await page.locator("[data-filter='status']").click();
        await page.locator(".ujg-esi-grid-menu input[aria-label='Исключить готовые']").check();
        await page.locator(".ujg-esi-grid-menu .ujg-esi-filter-apply").click();
        await page.waitForFunction(() => {
          const saved = JSON.parse(localStorage.getItem("ujg-esi-state"));
          return saved?.gridLayout?.filters?.excludeDone === true &&
            !document.querySelector("tr[data-key='EVOSCADA-99001'], tr[data-key='EVOSCADA-99005']");
        });
        assert.equal(await page.locator("tr[data-key='EVOSCADA-99002']").count(),1);
        await page.locator("[data-filter='status']").scrollIntoViewIfNeeded();
        await page.locator("[data-filter='status']").click();
        await page.locator(".ujg-esi-grid-menu input[aria-label='Исключить готовые истории']").check();
        await page.locator(".ujg-esi-grid-menu .ujg-esi-filter-apply").click();
        await page.waitForFunction(() => JSON.parse(localStorage.getItem("ujg-esi-state"))?.gridLayout?.filters?.excludeDoneStories === true);
        assert.equal(await page.locator("tr[data-key='EVOSCADA-23110']").count(),1);
        await page.locator(".ujg-esi-toolbar [aria-label='Сбросить все фильтры']").click();
        await onlyQa(page);
        await qaRows(page,expected);
        const contextStory = page.locator(".ujg-esi-parent-row.is-context").first();
        const disclosure = contextStory.locator(".ujg-esi-expand-cell button");
        await disclosure.click();
        assert.ok((await rows(page)).filter(row => row.child).length < childrenBefore, "Story disclosure hides its matching children");
        await contextStory.locator(".ujg-esi-expand-cell button").click();
        await qaRows(page,expected);
        const headerToggle = page.locator(`${table} thead th`).first().locator("button");
        await headerToggle.click();
        assert.equal((await rows(page)).filter(row => row.child).length, 0, "Header collapses matching children");
        await headerToggle.click();
        await qaRows(page,expected);
        await page.getByRole("button", {name:"Развернуть / свернуть все", exact:true}).click();
        assert.equal((await rows(page)).filter(row => row.child).length, 0, "Toolbar collapses matching children");
        await page.getByRole("button", {name:"Развернуть / свернуть все", exact:true}).click();
        await qaRows(page,expected);

        await applyAssignee(page,"Соколова А.");
        const narrowed = (await rows(page)).filter(row => row.child);
        assert.ok(narrowed.length > 0 && narrowed.length < childrenBefore);
        assert.ok(narrowed.every(row => row.assignee === "Соколова А." && expected.children.includes(row.key)), "Team and assignee must match the same child");
        await page.getByRole("button", {name:"Режим Jira", exact:true}).click();
        await refreshJira(page);
        assert.deepEqual((await rows(page)).filter(row => row.child).map(row => row.key).sort(), narrowed.map(row => row.key).sort());
        shots.push(await shot(page,"qa-assignee-jira",width));
        await refreshJira(page);
        await page.getByRole("tab", {name:"Динамика"}).click();
        await page.getByRole("tab", {name:"Реестр"}).click();
        await page.locator(table).waitFor();
        assert.deepEqual((await rows(page)).filter(row => row.child).map(row => row.key).sort(), narrowed.map(row => row.key).sort());
        await page.getByRole("button", {name:"Режим Excel", exact:true}).click();
        assert.deepEqual((await rows(page)).filter(row => row.child).map(row => row.key).sort(), narrowed.map(row => row.key).sort());
        await page.reload();
        await page.locator(table).waitFor({timeout:60000});
        await page.waitForFunction(() => document.querySelectorAll(".ujg-esi-parent-row").length > 0 && !document.querySelector(".ujg-esi-loading"), null, {timeout:60000});
        await page.getByRole("combobox", {name:"Замечаний на странице"}).selectOption("100");
        assert.deepEqual((await rows(page)).filter(row => row.child).map(row => row.key).sort(), narrowed.map(row => row.key).sort());
        assert.deepEqual((await layout(page)).filters.teamIds,["qa"]);
        shots.push(await shot(page,"qa-persisted",width));

        const beforeReset = await layout(page);
        const reset = page.locator(".ujg-esi-toolbar [aria-label='Сбросить все фильтры']");
        assert.equal(await reset.count(),1);
        await reset.click();
        const afterReset = await layout(page);
        assert.deepEqual(afterReset.filters,{},"Toolbar reset clears team and assignee filters");
        assert.deepEqual(afterReset.sort,beforeReset.sort,"Toolbar reset preserves sorting");
        assert.equal(await page.locator(`${teamButton}.is-active`).count(),0);

        menu = await openTeam(page);
        await menu.locator(".ujg-esi-team-filter-only[data-team-id='qa']").click();
        await menu.locator("input[data-team-id='be']").check();
        await menu.locator(".ujg-esi-filter-apply").click();
        assert.deepEqual((await layout(page)).filters.teamIds,["be","qa"]);
        const both = (await rows(page)).filter(row => row.child);
        assert.ok(both.some(row => expected.children.includes(row.key)),"Multi-select retains QA tasks");
        assert.ok(both.some(row => !expected.children.includes(row.key)),"Multi-select adds BE tasks");

        menu = await openTeam(page);
        await menu.locator(".ujg-esi-filter-all input").check();
        await menu.locator(".ujg-esi-filter-all input").uncheck();
        await menu.locator(".ujg-esi-filter-apply").click();
        assert.equal(await page.locator(".ujg-esi-parent-row").count(),0);
        assert.match(await page.locator(".ujg-esi-grid-empty").innerText(),/Нет замечаний/);
        shots.push(await shot(page,"empty",width));
        await reset.click();
        await page.getByRole("combobox", {name:"Замечаний на странице"}).selectOption("20");
        const next = page.getByRole("button", {name:"Следующая страница", exact:true});
        let pages = 1;
        while (await next.isEnabled()) { assert.ok(pages < 10); await next.click(); pages++; }
        assert.ok(pages > 1);
        const edges = await page.locator(".ujg-esi-registry-scroll").evaluate(el => {
          el.scrollTop=el.scrollHeight; el.scrollLeft=el.scrollWidth;
          return {left:el.scrollLeft,maxLeft:el.scrollWidth-el.clientWidth,top:el.scrollTop,maxTop:el.scrollHeight-el.clientHeight,
            documentOverflow:document.documentElement.scrollWidth > innerWidth};
        });
        assert.ok(edges.maxLeft > 0 && Math.abs(edges.left-edges.maxLeft) <= 2,"Table reaches horizontal end");
        assert.ok(Math.abs(edges.top-edges.maxTop) <= 2,"Table reaches final row");
        assert.equal(edges.documentOverflow,false,"Narrow layout has no document overflow");
        shots.push(await shot(page,"last-page-end",width));
        const calls = await page.evaluate(() => ({jira:window.mutationCalls,llm:window.llmPreviewCalls.length}));
        assert.deepEqual(calls,{jira:0,llm:0});
        assert.deepEqual(errors,[]);
        console.log(JSON.stringify({width,pages,qaAliases:expected.aliases.length,qaRoles:expected.roles.length,qaMembers:expected.members.length,qaStories:expected.stories.length,
          qaChildren:childrenBefore,edges,...calls,pageErrors:errors.length,screenshots:shots}));
      } finally { await context.close(); }
    }
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode=1; });
