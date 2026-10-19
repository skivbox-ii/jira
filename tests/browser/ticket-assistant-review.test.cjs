const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {chromium}=require('playwright');
const {startPreview}=require('./ticket-assistant-preview-server.cjs');
const artifacts='/tmp/ticket-assistant-20261019';

test('final review fixtures expose obsolete recovery catalog fallback live quota warning and confirmed discard',async()=>{
    let server,browser;
    const errors=[],external=[],methods=[];
    fs.mkdirSync(artifacts,{recursive:true});
    try {
        server=await startPreview({port:0});browser=await chromium.launch({channel:'chrome',headless:true});
        for(const scenario of ['obsolete','catalog','storage','discard']) {
            const context=await browser.newContext({viewport:{width:1440,height:900},reducedMotion:'reduce'});
            try {
                const page=await context.newPage();page.setDefaultTimeout(8000);page.on('pageerror',e=>errors.push(e.message));
                await context.route('**/*',route=>{const request=route.request();methods.push(request.method());if(new URL(request.url()).origin!==new URL(server.url).origin){external.push(request.url());return route.abort();}return route.continue();});
                await page.goto(server.url+'?review='+(scenario==='discard'?'obsolete':scenario));await page.waitForSelector('html[data-ta-preview-ready="true"]');
                const source=page.locator('[data-ta-source]');await source.fill('Review '+scenario);await page.locator('[data-ta-field="summary"] input').fill('Manual review title');
                if(scenario==='obsolete') {
                    await page.locator('[data-ta-field="customfield_10"] textarea').fill('Manual recovery value');
                    await page.locator('[data-ta-type] [data-ta-picker]').click();await page.locator('[data-ta-type] [data-ta-search]').fill('11');await page.locator('[data-ta-type] [data-ta-candidate]').click();
                    await page.screenshot({path:artifacts+'/review-obsolete-before.png',fullPage:true});
                    await page.locator('[data-ta-discard-field="customfield_10"]').click();assert.match(await source.inputValue(),/Заметки только для задачи[\s\S]*Manual recovery value/);
                    assert.equal(await page.locator('[data-ta-field="customfield_10"]').count(),0);
                    await page.locator('[data-ta-check]').click();await page.waitForSelector('[data-ta-checked]:not([hidden])');
                } else if(scenario==='catalog') {
                    await page.locator('[data-ta-check]').click();await page.waitForSelector('[data-ta-jira-form]');
                    assert.equal(await page.locator('[data-ta-create]').isDisabled(),true);
                    assert.equal(await page.locator('[data-ta-jira-form]').getAttribute('href'),'/secure/CreateIssue!default.jspa?pid=101&issuetype=10');
                    assert.match(await page.locator('[data-ta-fallback]').textContent(),/Контур приёмки/);
                    await page.locator('[data-ta-field="customfield_50"] [data-ta-picker]').click();assert.match(await page.locator('[data-ta-field="customfield_50"]').textContent(),/Каталог вариантов недоступен/);
                    assert.equal(await source.inputValue(),'Review catalog');
                } else if(scenario==='storage') {
                    await page.evaluate(()=>{window.reviewSource=document.querySelector('[data-ta-source]');});
                    await page.locator('[data-ta-preview-storage-fail]').click();await source.focus();await source.evaluate(el=>el.setSelectionRange(3,3));await page.keyboard.type('X');
                    assert.equal(await page.locator('[data-ta-storage-warning]').isVisible(),true);
                    assert.equal(await source.evaluate(el=>el===window.reviewSource && el===document.activeElement && el.selectionStart===4),true);
                    assert.equal(await page.evaluate(()=>window.taPreview.storageFailures),1);
                } else {
                    await page.locator('[data-ta-open-settings]').click();await page.locator('[data-ta-profile-name]').fill('Keep personal rules');await page.locator('[data-ta-settings-apply]').click();
                    await page.locator('[data-ta-files]').setInputFiles({name:'discard.txt',mimeType:'text/plain',buffer:Buffer.from('DISCARD BYTES')});
                    await page.locator('[data-ta-discard-draft]').click();await page.locator('[data-ta-discard-cancel]').click();assert.equal(await source.inputValue(),'Review discard');assert.match(await page.locator('[data-ta-file-list]').textContent(),/discard.txt/);
                    await page.locator('[data-ta-discard-draft]').click();await page.locator('[data-ta-discard-draft-confirm]').click();
                    assert.equal(await source.inputValue(),'');assert.equal(await page.locator('[data-ta-file-list]').textContent(),'');
                    assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem(Object.keys(localStorage).find(key=>key.startsWith('ujg-ticket-assistant:v1:')))).draft),null);
                    await page.reload();await page.waitForSelector('html[data-ta-preview-ready="true"]');assert.equal(await source.inputValue(),'');
                    assert.equal(await page.locator('[data-ta-profile]').textContent(),'Keep personal rules');
                }
                assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
                assert.equal(await page.evaluate(()=>window.taPreview.calls.filter(call=>call==='create').length),0);
                await page.screenshot({path:artifacts+'/review-'+scenario+'.png',fullPage:true});
                await page.screenshot({path:artifacts+'/review-'+scenario+'-viewport.png'});
            } finally {await context.close();}
        }
        assert.deepEqual(errors,[]);assert.deepEqual(external,[]);assert.ok(methods.every(method=>method==='GET'));
    } finally {if(browser)await browser.close();if(server)await server.close();}
});
