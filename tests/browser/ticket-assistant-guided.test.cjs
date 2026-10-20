const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs');
const {chromium}=require('playwright');
const {startPreview}=require('./ticket-assistant-preview-server.cjs');
const artifacts=path.resolve(__dirname,'../../.superpowers/sdd/2026-10-20-ticket-assistant-ux/task-3-visuals');

async function assist(page,action='generate') {
    await page.locator('[data-ta-field="description"] [data-ta-assist-menu]').click();
    await page.locator('[data-ta-field="description"] [data-ta-assist="'+action+'"]').click();
}
async function settled(page) {
    await page.waitForFunction(()=>['idle','error','stopped'].includes(window.taPreview.instance.controller.getState().stage));
}

for(const width of [1440,390]) test('guided source UI offline at '+width,async()=>{
    const server=await startPreview({port:0,sourceAssets:true}),browser=await chromium.launch({channel:'chrome',headless:true});
    const context=await browser.newContext({viewport:{width,height:width===390?844:900}}),page=await context.newPage();
    const faults=[],external=[];page.on('pageerror',e=>faults.push(e.message));
    await page.route('**/*',route=>{
        if(!route.request().url().startsWith(server.url) || route.request().method()!=='GET') {external.push(route.request().url());return route.abort();}
        return route.continue();
    });
    try {
        await page.goto(server.url+'?review=guided');await page.waitForSelector('html[data-ta-preview-ready="true"]');
        const source='На тестовом стенде требуется проверить обработку ошибок API. '.repeat(12);
        await page.locator('[data-ta-source]').fill(source);
        const description=page.locator('[data-ta-field="description"] textarea');
        assert.equal(await page.locator('[data-ta-token-preflight]').isVisible(),false);
        await page.locator('[data-ta-tokens]').click();assert.equal(await page.locator('[data-ta-token-preflight]').isVisible(),true);
        await page.keyboard.press('Escape');assert.equal(await page.locator('[data-ta-token-preflight]').isVisible(),false);
        await page.evaluate(()=>window.scrollTo(0,60));const beforeFullscreen=await page.evaluate(()=>scrollY);
        await page.locator('[data-ta-fullscreen]').click();
        await page.locator('[data-ta-type] [data-ta-picker]').click();await page.locator('[data-ta-source]').focus();await page.keyboard.press('Escape');
        assert.equal(await page.locator('[data-ta-type] [data-ta-popover]').isVisible(),false);
        assert.equal(await page.locator('.ta-fullscreen').count(),1);await page.keyboard.press('Escape');assert.equal(await page.locator('.ta-fullscreen').count(),0);
        assert.equal(await page.evaluate(()=>scrollY),beforeFullscreen,'fullscreen restores document scroll');
        await page.locator('[data-ta-fullscreen]').click();await page.locator('[data-ta-discard-draft]').click();await page.keyboard.press('Escape');
        assert.equal(await page.locator('[data-ta-discard-dialog]').isVisible(),false);assert.equal(await page.locator('.ta-fullscreen').count(),1);
        assert.equal(await page.locator('[data-ta-discard-draft]').evaluate(el=>el===document.activeElement),true);
        await page.keyboard.press('Escape');assert.equal(await page.locator('.ta-fullscreen').count(),0);
        const additional=page.locator('[data-ta-additional]'),labels=page.locator('[data-ta-field="labels"] input');
        await additional.locator('summary').first().click();await labels.fill('manual-label');
        assert.equal(await labels.evaluate(el=>!!el.closest('[data-ta-additional]')),true,'no movement during typing');
        await description.focus();await description.evaluate(el=>el.setSelectionRange(0,0));
        await page.waitForFunction(()=>!document.querySelector('[data-ta-field="labels"]').closest('[data-ta-additional]'));
        assert.equal(await description.evaluate(el=>el===document.activeElement && el.selectionStart===0),true);
        await additional.locator('summary').first().click();assert.equal(await labels.isVisible(),true);
        if(width===1440) {
            const left=await page.locator('.ta-source-area').boundingBox(),right=await page.locator('.ta-draft-area').boundingBox(),create=await page.locator('[data-ta-create]').boundingBox();
            assert.ok(right.width>left.width*1.7);assert.ok(create.y+create.height<=900);
        }
        await assist(page);await page.waitForSelector('[data-ta-accept="description"]');
        assert.equal(await description.inputValue(),'');
        assert.equal(await page.locator('[data-ta-accept="description"]').isEnabled(),true);
        fs.mkdirSync(artifacts,{recursive:true});await page.screenshot({path:path.join(artifacts,'proposal-'+width+'.png')});
        await page.locator('[data-ta-reject="description"]').click();assert.equal(await description.inputValue(),'');
        await description.fill('Ручное описание');
        await page.locator('[data-ta-field="summary"] input').fill('Ручная тема');
        await assist(page,'improve');await page.waitForSelector('[data-ta-accept="description"]');
        assert.match(await page.locator('[data-ta-field="description"] .ta-pending').textContent(),/Ручное описание/);
        await page.locator('[data-ta-accept="description"]').click();assert.match(await description.inputValue(),/Предложение/);
        assert.equal(await page.locator('[data-ta-field="summary"] input').inputValue(),'Ручная тема');
        await assist(page);await page.waitForSelector('[data-ta-accept="description"]');
        await description.fill('Исправление после ответа');assert.equal(await page.locator('[data-ta-accept="description"]').count(),0);
        await page.locator('[data-ta-preview-assist="slow"]').click();await assist(page);
        await page.locator('[data-ta-source]').fill(source+' Новая информация');await settled(page);await page.waitForTimeout(2300);
        assert.equal(await page.locator('[data-ta-accept="description"]').count(),0);assert.equal(await description.inputValue(),'Исправление после ответа');
        await assist(page);await page.locator('[data-ta-stop]').click();await settled(page);await page.waitForTimeout(2300);
        assert.equal(await page.locator('[data-ta-accept="description"]').count(),0);
        await page.locator('[data-ta-preview-assist="error"]').click();await assist(page);await page.locator('[data-ta-error]:not([hidden])').waitFor();
        assert.equal(await description.inputValue(),'Исправление после ответа');
        await page.locator('[data-ta-preview-assist="null"]').click();await assist(page);await page.waitForSelector('[data-ta-accept="description"]');
        assert.equal(await page.locator('[data-ta-question="target-fact"]').count(),1);
        await page.locator('[data-ta-focus-field="description"]').click();assert.equal(await description.evaluate(el=>el===document.activeElement),true);
        await page.locator('[data-ta-reject="description"]').click();
        await page.locator('[data-ta-additional] > summary').click();
        await page.locator('[data-ta-preview-assist="normal"]').click();
        const components=page.locator('[data-ta-field="components"]');
        await components.locator('[data-ta-picker]').click();
        assert.equal(await components.locator('[data-ta-candidate]').count(),183);
        await components.locator('[data-ta-search]').fill('API');await components.locator('[data-ta-candidate]').click();
        assert.equal(await components.locator('[data-ta-chip]').count(),1);assert.equal(await components.locator('[data-ta-candidate]').count(),0);
        await page.keyboard.press('Escape');
        await components.locator('[data-ta-assist-menu]').click();await components.locator('[data-ta-assist="improve"]').click();
        await components.locator('[data-ta-accept]').waitFor();assert.match(await components.locator('.ta-pending').textContent(),/Сейчас: API.*Предложение: API/s);
        await components.locator('[data-ta-reject]').click();
        await page.locator('[data-ta-preview-assist="foreign"]').click();
        await components.locator('[data-ta-assist-menu]').click();await components.locator('[data-ta-assist="generate"]').click();
        await page.locator('[data-ta-error]:not([hidden])').waitFor();assert.equal(await components.locator('[data-ta-accept]').count(),0);
        for(const id of ['customfield_1','customfield_71','customfield_72','reporter','assignee'])assert.equal(await page.locator('[data-ta-field="'+id+'"] [data-ta-assist-menu]').count(),0);
        assert.match(await page.locator('[data-ta-field="assignee"] [data-ta-field-help]').textContent(),/профил.*настройках.*Jira/);
        assert.match(await page.locator('[data-ta-field="customfield_1"] [data-ta-field-help]').textContent(),/вручную.*AI/);
        await page.locator('[data-ta-field="customfield_1"] input').fill('0.5');
        await page.locator('[data-ta-field="customfield_71"] [data-ta-picker]').click();await page.locator('[data-ta-field="customfield_71"] [data-ta-partial]').waitFor();
        await page.locator('[data-ta-field="customfield_71"] [data-ta-candidate]').click();
        await page.locator('[data-ta-field="customfield_72"] [data-ta-picker]').click();await page.locator('[data-ta-board="12"]').click();
        await page.locator('[data-ta-field="customfield_72"] [data-ta-candidate]').click();
        assert.deepEqual(await page.evaluate(()=>{
            const f=window.taPreview.instance.controller.getState().draft.fields;return [f.customfield_1,f.customfield_71,f.customfield_72];
        }),[0.5,'DEMO-42',73]);
        await page.locator('[data-ta-preview-lookup-denied]').check();
        await page.locator('[data-ta-field="customfield_71"] [data-ta-picker]').click();
        await page.locator('[data-ta-field="customfield_71"] .ta-candidates .ta-errors').waitFor();
        assert.match(await page.locator('[data-ta-field="customfield_71"] .ta-candidates').textContent(),/Нет доступа/);
        await page.keyboard.press('Escape');
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
        await page.screenshot({path:path.join(artifacts,'manual-'+width+'.png')});
        assert.deepEqual(faults,[]);assert.deepEqual(external,[]);
    } finally {await context.close();await browser.close();await server.close();}
});
