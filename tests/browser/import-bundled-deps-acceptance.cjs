// Real browser verification of the single importer JS, with dependency downloads forbidden.
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const {chromium} = require("playwright");
const XLSX = require("xlsx");
const origin = new URL(process.env.IMPORT_PREVIEW_URL || "http://127.0.0.1:4317").origin;
assert.ok(["127.0.0.1","localhost"].includes(new URL(origin).hostname));
const artifacts = process.env.IMPORT_BUNDLE_ARTIFACTS;

(async () => {
  if (artifacts) fs.mkdirSync(artifacts,{recursive:true});
  const browser = await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined});
  try {
    for (const width of [1440,390]) {
      const context = await browser.newContext({viewport:{width,height:900},acceptDownloads:true});
      const forbidden = [], scripts = [], errors = [];
      await context.route("**/*", async route => {
        const request=route.request(), url=new URL(request.url());
        if (request.resourceType()==="script") scripts.push(url.pathname);
        if (url.origin !== origin || /\/(?:test\/(?:xlsx|jszip|mermaid)\.js|vendor\/)/.test(url.pathname)) {
          forbidden.push(url.href);return route.abort();
        }
        if (request.resourceType() === "document") {
          const response = await route.fetch();
          const body = (await response.text()).replace('<main id="root">',
            '<pre id="host-mermaid" class="mermaid" style="display:none">graph TD; Host--&gt;Untouched;</pre><main id="root">');
          assert.ok(body.includes('id="host-mermaid"'), "The host-page diagram fixture must be present");
          return route.fulfill({response,body});
        }
        return route.continue();
      });
      const page=await context.newPage();
      page.on("pageerror",error=>errors.push(error.message));
      try {
        await page.goto(origin);
        const downloadButton=page.getByRole("button",{name:"Скачать Excel",exact:true});
        await downloadButton.waitFor({state:"visible"});
        await page.waitForFunction(()=>!document.querySelector('[aria-label="Скачать Excel"]').disabled,{},{timeout:30000});
        assert.equal(await page.locator(".ujg-esi-parent-row").count(),50);
        const downloaded=page.waitForEvent("download");
        await downloadButton.click();
        const file=await downloaded, book=XLSX.readFile(await file.path());
        const data=XLSX.utils.sheet_to_json(book.Sheets["Лист1"],{header:1});
        assert.ok(data.some(row=>row.includes("EVOSCADA-16104")));
        assert.ok(data.some(row=>row.includes("Готово")));
        const description = page.locator('tr[data-key="EVOSCADA-18057"] .ujg-esi-issue-summary-text');
        await description.scrollIntoViewIfNeeded();
        await description.click();
        await page.locator(".ujg-esi-description-popover .ujg-esi-mermaid-diagram svg").waitFor({state:"visible",timeout:15000});
        assert.match(await page.locator(".ujg-esi-mermaid-diagram svg").textContent(),/Сигнал МЭК/);
        assert.equal(await page.locator("#host-mermaid").textContent(),"graph TD; Host-->Untouched;");
        assert.equal(await page.locator("#host-mermaid").getAttribute("data-processed"),null);
        if (artifacts) await page.screenshot({path:path.join(artifacts,"bundled-"+width+".png")});
        assert.equal(await page.evaluate(()=>window.mutationCalls),0);
        assert.deepEqual(await page.evaluate(()=>["XLSX","JSZip","mermaid"].filter(key=>Object.hasOwn(window,key))),[]);
        assert.deepEqual(forbidden,[]);
        assert.deepEqual(errors,[]);
        assert.equal(scripts.filter(name=>name==="/ujg-excel-story-importer.js").length,1);
        console.log(JSON.stringify({width,result:"PASS",read:true,export:true,diagram:true,extraDependencyRequests:forbidden.length,scripts}));
      } catch (error) {
        if (artifacts) {
          await page.screenshot({path:path.join(artifacts,"failed-"+width+".png")});
          console.error(JSON.stringify(await page.evaluate(()=>({
            popover:document.querySelector(".ujg-esi-description-popover")?.textContent.slice(0,600),
            svg:document.querySelectorAll(".ujg-esi-mermaid-diagram svg").length,
            active:document.activeElement?.outerHTML,
            errors:document.querySelector(".ujg-esi-error")?.textContent
          }))));
        }
        throw error;
      } finally {await context.close();}
    }
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
