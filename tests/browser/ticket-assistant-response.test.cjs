const test=require('node:test');
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const {startPreview}=require('./ticket-assistant-preview-server.cjs');

test('offline response UI preserves normalized drafts, shows warnings once and actionable safe errors',async()=>{
    let server,browser;
    try {
        server=await startPreview({port:0});browser=await chromium.launch({channel:'chrome',headless:true});
        const page=await browser.newPage();page.setDefaultTimeout(8000);const errors=[];
        page.on('pageerror',e=>errors.push(e.message));
        await page.route('**/*',route=>new URL(route.request().url()).origin===new URL(server.url).origin?route.continue():route.abort());
        await page.goto(server.url+'?review=response');await page.waitForSelector('html[data-ta-preview-ready="true"]');
        await page.locator('[data-ta-source]').fill('Synthetic bug');
        await page.locator('[data-ta-field="summary"] input').fill('Manual title');
        await page.locator('[data-ta-check]').click();await page.waitForSelector('[data-ta-checked]:not([hidden])');
        assert.equal(await page.locator('[data-ta-warnings]').textContent(),'Synthetic optional warning');
        await page.locator('[data-ta-prepare]').click();
        await page.waitForFunction(()=>['idle','error'].includes(window.taPreview.instance.controller.getState().stage));
        assert.equal(await page.locator('[data-ta-error]').isVisible(),false);
        assert.equal(await page.evaluate(()=>window.taPreview.instance.controller.getState().draft.fields.components[0].id),'31');
        await page.locator('[data-ta-check]').click();await page.waitForSelector('[data-ta-checked]:not([hidden])');
        assert.equal(await page.locator('[data-ta-warnings]').textContent(),'Synthetic optional warning');
        await page.goto(server.url+'?review=response&responseMode=malformed');await page.waitForSelector('html[data-ta-preview-ready="true"]');
        await page.locator('[data-ta-prepare]').click();await page.waitForSelector('[data-ta-error]:not([hidden])');
        assert.match(await page.locator('[data-ta-error]').textContent(),/components/);
        assert.match(await page.locator('[data-ta-error]').textContent(),/формат/i);
        assert.equal(await page.locator('[data-ta-create]').isDisabled(),true);
        assert.equal(await page.locator('[data-ta-source]').inputValue(),'Synthetic bug');
        for(const [mode,reason] of [['json',/допустимым JSON/],['contract',/структура/i],['questions',/вопрос/i],['evidence',/цитата|обоснован/i]]) {
            await page.goto(server.url+'?review=response&responseMode='+mode);await page.waitForSelector('html[data-ta-preview-ready="true"]');
            await page.locator('[data-ta-prepare]').click();await page.waitForSelector('[data-ta-error]:not([hidden])');
            const message=await page.locator('[data-ta-error]').textContent();assert.match(message,reason);assert.ok(!message.includes('PRIVATE'));
            assert.equal(await page.locator('[data-ta-create]').isDisabled(),true);
        }
        assert.deepEqual(errors,[]);
    } finally {if(browser)await browser.close();if(server)await server.close();}
});
