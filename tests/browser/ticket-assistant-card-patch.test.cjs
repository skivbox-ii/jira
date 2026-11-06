const test = require('node:test');
const assert = require('node:assert/strict');
const {chromium} = require('playwright');
const {startPreview} = require('./ticket-assistant-preview-server.cjs');

test('one conversation edits multiple Jira fields and only asks for the remaining DEVOPS requirement', async t => {
    const server = await startPreview({port: 0});
    t.after(() => server.close());
    const browser = await chromium.launch({channel: 'chrome'});
    t.after(() => browser.close());
    const page = await browser.newPage({viewport: {width: 1440, height: 900}});
    await page.route('**/*', route => route.request().url().startsWith(server.url) ? route.continue() : route.abort());
    await page.goto(server.url);
    await page.waitForSelector('html[data-ta-preview-ready=true]');
    await page.evaluate(async () => {
        const preview = window.taPreview;
        preview.instance.destroy();
        const api = preview.api;
        api.getProjects = async () => ({values: [{key: 'DEVOPS', id: '102', name: 'DEVOPS'}], complete: true});
        const fixtureMetadata = api.getCreateMeta;
        api.getCreateMeta = async key => {
            const result = await fixtureMetadata(key);
            const deployment = result.projects[0].issuetypes[2];
            deployment.name = 'Задача развертывания';
            delete deployment.fields.customfield_99;
            return result;
        };
        api.checkDevopsIssue = async () => ({warnings: [], fieldErrors: {}, link: null});
        const Widget = window.taRequire('_ujgTicketAssistantRuntime');
        preview.patchRequests = 0;
        preview.instance = new Widget({getGadgetContentEl: () => window.jQuery('#ticket-assistant')}, {
            storage: null, api, requestText: async () => {
                preview.patchRequests++;
                if (preview.patchRequests > 3) throw Error('Unexpected additional model call');
                if (preview.patchRequests > 1) return {text: 'Спасибо за уточнение. Я зафиксировал окно развёртывания и высокий приоритет.'};
                return {text: JSON.stringify({
                    fields: {priority: {id: '3'}, duedate: '2026-11-20'},
                    descriptionSections: {location: 'DEV, demo-api', release: 'demo-api v1.0', order: 'Перезапустить сервис',
                        window: 'После 18:00', verification: 'Дежурный проверит HTTP 200 на /health'}
                })};
            }
        });
        await preview.instance.ready;
        await preview.instance.controller.selectProject('DEVOPS');
    });
    await page.locator('[data-ta-type] button').first().click();
    await page.locator('[data-ta-type] [role=option]').filter({hasText: '(12)'}).click();
    const editor = page.locator('[data-ta-live-editor]');
    const subject = editor.locator('[data-ta-field=summary] input:visible').first();
    await subject.fill('Обновить demo-api на DEV');
    await subject.press('Tab');
    const input = page.locator('[data-ta-chat-input]');
    const send = async text => {await input.fill(text); await input.press('Enter');};
    await send('Развернуть demo-api v1.0 в DEV, после 18:00 перезапустить сервис. Дежурный проверит HTTP 200 на /health. Приоритет обычный. Срок 20.11.2026.');
    await page.locator('[data-ta-chat-log] [data-role=assistant]').first().waitFor();
    const description = editor.locator('[data-ta-field=description] textarea:visible');
    assert.match(await description.inputValue(), /Окно: После 18:00/);
    assert.match(await description.inputValue(), /Проверка: Дежурный проверит/);
    assert.equal(await subject.inputValue(), 'Обновить demo-api на DEV');
    const state = await page.evaluate(() => window.taPreview.instance.controller.getState());
    assert.equal(state.draft.protectedFields.summary, true);
    assert.equal(state.draft.fields.duedate, '2026-11-20');
    assert.equal(state.draft.fields.priority.id, '3');
    assert.deepEqual(state.validation.questions.map(q => q.id), ['devops:links']);
    const log = page.locator('[data-ta-chat-log]');
    assert.match(await log.innerText(), /ссылк[ау] на репозиторий/i);
    const create = page.locator('[data-ta-card-create]:visible, [data-ta-create]:visible').first();
    assert.equal(await create.isEnabled(), false);
    await send('Окно развёртывания с 19:00 до 20:00. Приоритет высокий. Дежурный проверит HTTP 200 на /health.');
    await page.waitForFunction(() => window.taPreview.instance.controller.getState().draft.fields.priority.id === '2');
    assert.match(await description.inputValue(), /Окно:[^\n]*19:00[^\n]*20:00/);
    assert.match(await description.inputValue(), /Версия и состав: demo-api v1.0/);
    assert.equal(await subject.inputValue(), 'Обновить demo-api на DEV');
    assert.equal(await create.isEnabled(), false);
    await send('https://git.example/devops/demo-api');
    await page.waitForFunction(() => !!window.taPreview.instance.controller.getState().draft.checked);
    await create.click();
    await page.waitForFunction(() => !!window.taPreview.createdPayload);
    const sent = await page.evaluate(() => ({fields: window.taPreview.createdPayload.fields, calls: window.taPreview.patchRequests}));
    assert.equal(sent.calls, 3);
    assert.equal(sent.fields.summary, 'Обновить demo-api на DEV');
    assert.match(sent.fields.description, /Ссылки: https:\/\/git.example\/devops\/demo-api/);
    assert.equal(sent.fields.priority.id, '2');
    assert.equal(sent.fields.duedate, '2026-11-20');
});
