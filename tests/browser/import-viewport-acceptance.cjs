const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const {chromium} = require("playwright");

const origin = process.env.IMPORT_PREVIEW_URL || "http://127.0.0.1:4317";
assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(new URL(origin).hostname));
const artifacts = path.join(os.tmpdir(), "import-viewport-acceptance");

async function main() {
  fs.mkdirSync(artifacts, {recursive:true});
  const browser = await chromium.launch({headless:true, executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH});
  try {
    for (const embedded of [false, true]) {
      for (const size of [{width:1440,height:900}, {width:390,height:844}, {width:2560,height:1440}]) {
        const context = await browser.newContext({viewport:size});
        await context.route("**/*", async route => {
          const url = new URL(route.request().url());
          if (url.origin !== origin) return route.abort();
          if (url.pathname === "/viewport-host") return route.fulfill({contentType:"text/html", body:
            '<style>body{margin:0}header{height:180px;background:#eee}iframe{display:block;width:100%;height:90px;border:0}</style><header>Local Jira iframe fixture</header><iframe src="/?empty"></iframe>'});
          if (url.pathname !== "/test/preview-bootstrap.js") return route.continue();
          const response = await route.fetch();
          const source = await response.text();
          assert.ok(source.includes('resize:function(){}'));
          return route.fulfill({response, body:source.replace('resize:function(){}', `resize:function(){
            window.viewportResizeCalls=(window.viewportResizeCalls||0)+1;
            if(window.frameElement) {
              var root=document.querySelector('.ujg-excel-story-importer');
              window.frameElement.style.height=(root.offsetTop+root.offsetHeight+16)+'px';
            }
          }`)});
        });
        const page = await context.newPage(), errors = [];
        page.on("pageerror", error => errors.push(error.message));
        await page.goto(origin + (embedded ? "/viewport-host" : "/?empty"));
        const frame = embedded ? page.frames().find(item => item.url().includes("?empty")) : page.mainFrame();
        await frame.locator(".ujg-esi-project-select option[value='EVOSCADA']").waitFor({state:"attached"});
        const measure = () => frame.evaluate(() => {
          const root = document.querySelector(".ujg-excel-story-importer"), rect = root.getBoundingClientRect();
          return {minimum:parseFloat(root.style.minHeight), top:rect.top,
            height:rect.height, calls:window.viewportResizeCalls || 0,
            outerTop:window.frameElement ? window.frameElement.getBoundingClientRect().top : 0};
        });
        let metrics = await measure();
        assert.equal(metrics.minimum, Math.max(480, size.height-Math.max(0,metrics.top+metrics.outerTop)));
        await frame.locator(".ujg-esi-project-select").selectOption("EVOSCADA");
        await frame.getByRole("button", {name:"Режим Jira",exact:true}).click();
        await frame.locator(".ujg-esi-epic-search").fill("испытания");
        const epic = frame.getByRole("button", {name:/EVOSCADA-200.*Приёмочные испытания/});
        await epic.waitFor();
        assert.equal(await epic.evaluate(el => {
          const rect = el.getBoundingClientRect();
          return rect.top >= 0 && rect.bottom <= innerHeight && rect.left >= 0 && rect.right <= innerWidth;
        }), true);
        await page.screenshot({path:path.join(artifacts, `epic-${embedded ? "iframe" : "page"}-${size.width}.png`)});
        await epic.click();
        assert.match(await frame.locator(".ujg-esi-epic-search").inputValue(), /EVOSCADA-200/);
        await frame.getByRole("button", {name:"Загрузить замечания из Jira",exact:true}).click();
        await frame.locator(".ujg-esi-registry-table").waitFor();
        await frame.getByRole("button", {name:"На весь экран",exact:true}).click();
        await frame.getByRole("button", {name:"Выйти из полноэкранного режима",exact:true}).click();
        const smaller = {...size,height:size.height-100};
        await page.setViewportSize(smaller);
        await page.waitForTimeout(150);
        metrics = await measure();
        assert.equal(metrics.minimum, Math.max(480, smaller.height-Math.max(0,metrics.top+metrics.outerTop)));
        if (embedded) {
          await page.evaluate(() => scrollTo(0,100));
          await page.waitForTimeout(150);
          metrics = await measure();
          assert.equal(metrics.minimum, Math.max(480, smaller.height-Math.max(0,metrics.top+metrics.outerTop)));
        }
        const stable = metrics;
        await page.waitForTimeout(250);
        assert.deepEqual(await measure(), stable, "iframe resize must settle, not grow or oscillate");
        assert.ok(stable.calls < 45, "bounded host resize calls");
        assert.equal(await frame.evaluate(() => window.mutationCalls), 0);
        assert.deepEqual(errors, []);
        await page.screenshot({path:path.join(artifacts, `loaded-${embedded ? "iframe" : "page"}-${size.width}.png`)});
        console.log(JSON.stringify({embedded,...size,...stable,writes:0}));
        await context.close();
      }
    }
  } finally { await browser.close(); }
}
main().catch(error => {console.error(error); process.exitCode=1;});
