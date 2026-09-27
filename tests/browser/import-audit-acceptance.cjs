const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {chromium} = require("playwright");

const origin = process.env.IMPORT_PREVIEW_URL || "http://127.0.0.1:4317";
assert.ok(["127.0.0.1","localhost","[::1]"].includes(new URL(origin).hostname),"Acceptance must use a loopback preview");
const artifacts = process.env.IMPORT_AUDIT_ARTIFACTS || path.join(os.tmpdir(), "import-audit-fixes-20260927");

async function main() {
  fs.mkdirSync(artifacts, {recursive:true});
  const browser = await chromium.launch({headless:true,
    executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined});
  try {
    for (const width of process.argv.includes("--components-only") ? [] : [1440,390]) {
      const context = await browser.newContext({viewport:{width,height:900}});
      await context.route("**/*", route => {
        const url = new URL(route.request().url());
        return url.origin === new URL(origin).origin ? route.continue() : route.abort();
      });
      const page = await context.newPage(), errors = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.goto(origin + "/?performance");
      await page.waitForFunction(() => document.querySelector(".ujg-esi-activity-coverage")?.textContent.includes("Проверена история 1000 из 1000"));
      const count = page.locator(".ujg-esi-activity-status-matrix td.is-return button").first();
      await count.click();
      const popover = page.locator(".ujg-esi-activity-event-popover");
      const expected = await popover.locator(".ujg-esi-activity-popover-event").count();
      assert.ok(expected > 30, "The test must scroll a genuinely long event list");
      await popover.evaluate(element => { element.scrollTop = element.scrollHeight; });
      await page.screenshot({path:path.join(artifacts, `events-bottom-${width}.png`)});
      const close = popover.getByRole("button", {name:"Закрыть события",exact:true});
      const bounds = await close.boundingBox(), frame = await popover.boundingBox();
      assert.ok(bounds && frame && bounds.y >= frame.y && bounds.y + bounds.height <= frame.y + frame.height,
        "Close must remain within the event popover after scrolling to the last event");
      assert.equal(await close.evaluate(element => {
        const r = element.getBoundingClientRect();
        return element.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
      }), true, "The visible close button must be reachable, not covered");
      await close.click();
      assert.equal(await popover.count(),0);
      assert.equal(await count.evaluate(element => element === document.activeElement),true);
      if (width === 1440) {
        const slow = page.getByLabel("Медленные ответы истории (60 мс)", {exact:true});
        const fail = page.getByLabel("Ошибка EVOSCADA-50000", {exact:true});
        const refresh = page.getByRole("button", {name:"Обновить историю",exact:true});
        await slow.check();
        await refresh.click();
        await page.waitForFunction(() => document.querySelector(".ujg-esi-activity-coverage")?.textContent.includes("Загрузка истории:"));
        await page.locator('[data-activity-filter="module"]').click();
        const menu = page.locator(".ujg-esi-activity-filter-menu");
        const search = menu.getByRole("searchbox", {name:"Поиск значений"});
        await search.fill("АСУ");
        await menu.getByLabel("АСУТП", {exact:true}).uncheck();
        await search.focus();
        await search.evaluate(element => element.setSelectionRange(1,2));
        await page.waitForFunction(() => !document.querySelector('[aria-label="Обновить историю"]')?.disabled, null, {timeout:60000});
        assert.equal(await menu.count(),1,"Final history publication must preserve the open draft");
        assert.equal(await search.inputValue(),"АСУ");
        assert.equal(await menu.getByLabel("АСУТП", {exact:true}).isChecked(),false);
        assert.deepEqual(await search.evaluate(element => [element === document.activeElement,element.selectionStart,element.selectionEnd]),[true,1,2]);
        await page.screenshot({path:path.join(artifacts,"draft-after-final-publication.png")});
        await search.press("Escape");
        assert.equal(await menu.count(),0);
        assert.equal(await page.locator('[data-activity-filter="module"]').evaluate(element => element.classList.contains("is-active")),false);

        await refresh.click();
        await page.getByRole("button", {name:"Предыдущий день",exact:true}).click();
        await page.waitForFunction(() => !document.querySelector('[aria-label="Обновить историю"]')?.disabled, null, {timeout:60000});
        assert.equal(await page.locator('[data-metric="events"] strong').textContent(),"1000");
        await slow.uncheck();
        await page.getByRole("button", {name:"Предыдущий день",exact:true}).click();
        assert.equal(await page.locator('[data-metric="events"] strong').textContent(),"900");
        await page.getByRole("button", {name:"Следующий день",exact:true}).click();
        await page.getByRole("button", {name:"Следующий день",exact:true}).click();
        assert.equal(await page.locator('[data-metric="events"] strong').textContent(),"1100");

        await fail.check();
        await refresh.click();
        await page.waitForFunction(() => document.querySelector(".ujg-esi-activity-error")?.textContent.includes("EVOSCADA-50000"));
        const coverage = await page.locator(".ujg-esi-activity-coverage").textContent();
        assert.match(coverage,/(предыдущ|сохранён)/i);
        assert.match(coverage,/18:00/);
        assert.match(coverage,/1000 из 1000/);
        await page.screenshot({path:path.join(artifacts,"retained-history-after-error.png")});
        await fail.uncheck();
        await slow.check();
        await refresh.click();
        await page.waitForFunction(() => document.querySelector(".ujg-esi-activity-coverage")?.textContent.includes("Загрузка истории:"));
        assert.equal(await page.locator(".ujg-esi-activity-error").count(),1);
        assert.match(await page.locator(".ujg-esi-activity-error").textContent(),/EVOSCADA-50000/,
          "Starting a retry must not erase the previous failure before successful publication");
        assert.match(await page.locator(".ujg-esi-activity-coverage").textContent(),/сохранённый снимок Jira/);
        await page.waitForFunction(() => !document.querySelector('[aria-label="Обновить историю"]')?.disabled, null, {timeout:60000});
        assert.equal(await page.locator(".ujg-esi-activity-error").count(),0);
        await page.locator(".ujg-esi-activity-journal tbody tr").last().scrollIntoViewIfNeeded();
        await page.screenshot({path:path.join(artifacts,"last-journal-row.png")});
      }
      assert.deepEqual(errors,[]);
      const stats = await page.evaluate(() => ({writes:window.mutationCalls,llm:window.importPerformance.llmCalls}));
      assert.deepEqual(stats,{writes:0,llm:0});
      console.log(JSON.stringify({width,events:expected,closeVisible:true,...stats}));
      await context.close();
    }
    const context = await browser.newContext({viewport:{width:1440,height:900}});
    await context.route("**/*", async route => {
      const url = new URL(route.request().url());
      if (url.origin !== new URL(origin).origin) return route.abort();
      if (url.pathname !== "/test/preview-bootstrap.js") return route.continue();
      const response = await route.fetch();
      const body = (await response.text()).replace("new modules._ujgExcelStoryImporter",
        "window.importAudit = {state:function(){return currentState;},callbacks:function(){return callbacks;}}; new modules._ujgExcelStoryImporter");
      return route.fulfill({response,body});
    });
    const page = await context.newPage();
    await page.goto(origin);
    await page.waitForFunction(() => window.importAudit?.state()?.rows?.length === 71 && !window.importAudit.state().syncLoading);
    await page.getByRole("button",{name:"Обновить компоненты Jira из Excel",exact:true}).click();
    await page.waitForFunction(() => document.body.textContent.includes("Ключ Jira не указан"));
    await page.screenshot({path:path.join(artifacts,"component-plan-missing-key.png")});
    await page.keyboard.press("Escape");
    await page.evaluate(() => {
      const state = window.importAudit.state();
      state.createSubtasks=false;
      state.mappingSettings.moduleComponentMap={"Интерфейс":"Unknown component"};
      window.importAuditCreates=[];
      window.offlineApi.createIssue=payload => {
        window.importAuditCreates.push(payload);
        return Promise.resolve({key:"EVOSCADA-99999"});
      };
    });
    await page.locator(".ujg-esi-create-row").first().click();
    await page.getByRole("button",{name:"Создать в Jira",exact:true}).click();
    await page.waitForFunction(() => window.importAudit.state().rows.some(row => row.errors?.some(error => error.includes("Unknown component"))));
    assert.equal(await page.evaluate(() => window.importAuditCreates.length),0);
    await page.locator(".ujg-esi-error-details").filter({hasText:"Unknown component"}).locator("summary").click();
    await page.screenshot({path:path.join(artifacts,"creation-unknown-component.png")});
    assert.equal(await page.locator(".ujg-esi-error-details").filter({hasText:"Unknown component"}).locator("div").evaluate(element => {
      const r=element.getBoundingClientRect();
      return element.contains(document.elementFromPoint(r.right-10,r.y+r.height/2));
    }),true,"The creation error must not be covered by the next row's sticky actions");
    await page.evaluate(() => { window.importAudit.state().mappingSettings.moduleComponentMap={"Интерфейс":"АСУТП"}; });
    await page.locator(".ujg-esi-create-row").first().click();
    await page.getByRole("button",{name:"Создать в Jira",exact:true}).click();
    await page.waitForFunction(() => window.importAuditCreates.length === 1);
    assert.deepEqual(await page.evaluate(() => window.importAuditCreates[0].fields.components),[{id:"1"}]);
    await page.screenshot({path:path.join(artifacts,"creation-valid-component-stub.png")});
    console.log(JSON.stringify({componentGuard:true,invalidCreates:0,validStubCreates:1,componentId:"1"}));
    await context.close();
  } finally { await browser.close(); }
}

main().catch(error => { console.error(error); process.exitCode=1; });
