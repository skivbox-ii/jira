const test = require('node:test');
const assert = require('node:assert/strict');
const { loadUnit } = require('./helpers/ticket-assistant-fixture');

function adapter(ajax, baseUrl = '/jira') {
    return loadUnit('api', {}, { location: { origin: 'https://jira.example', pathname: '/jira/plugins/servlet/gadgets' }, URL }).createApi({ ajax, baseUrl });
}

test('read methods use GET, context path and encoded scope without arbitrary autocomplete URLs', async () => {
    const calls = [], api = adapter(opts => { calls.push(opts); return Promise.resolve([]); });
    await api.getProjects(); await api.getCurrentUser(); await api.getCreateMeta('D/O', '10'); await api.getComponents('D/O'); await api.getVersions('D/O'); await api.searchUsers('alice'); await api.getAttachmentMeta();
    assert.deepEqual(calls.map(c => c.url), ['/jira/rest/api/2/project', '/jira/rest/api/2/myself', '/jira/rest/api/2/issue/createmeta', '/jira/rest/api/2/project/D%2FO/components', '/jira/rest/api/2/project/D%2FO/versions', '/jira/rest/api/2/user/picker', '/jira/rest/api/2/attachment/meta']);
    assert.ok(calls.every(c => c.type === 'GET'));
    assert.equal(calls[2].data.projectKeys, 'D/O');
    assert.equal(calls[2].data.issuetypeIds, '10');
    assert.equal(calls[5].data.query, 'alice');
    assert.throws(() => adapter(() => {}, 'https://evil.example/jira'));
    assert.throws(() => adapter(() => {}, '//evil.example'));
    assert.throws(() => adapter(() => {}, '/jira/../evil'));
    const same = [], absolute = adapter(o => { same.push(o); return Promise.resolve([]); }, 'https://jira.example/jira/');
    await absolute.getProjects();
    assert.equal(same[0].url, '/jira/rest/api/2/project');
});

test('catalog pagination is collected, malformed or stalled pages fail visibly', async () => {
    const calls = [], api = adapter(o => { calls.push(o); return Promise.resolve({ values: [{ id: String(o.data.startAt || 0) }], startAt: o.data.startAt || 0, total: 2, maxResults: 1 }); });
    const result = await api.getComponents('DO');
    assert.equal(result.complete, true);
    assert.deepEqual(Array.from(result.values, v => v.id), ['0', '1']);
    assert.equal(calls.length, 2);
    for (const data of [{ values: [], total: 2, startAt: 0 }, { values: [{}], total: 2, startAt: 4 }, { nonsense: [] }]) {
        await assert.rejects(adapter(() => Promise.resolve(data)).getProjects(), e => e.kind === 'incomplete');
    }
});

test('user picker reports limited results as partial and cannot assert assignment rights', async () => {
    const result = await adapter(() => Promise.resolve({ users: [{ name: 'alice' }], total: 20 })).searchUsers('a');
    assert.equal(result.complete, false);
    assert.equal(result.values[0].name, 'alice');
    assert.equal(result.assignable, undefined);
});

test('HTTP and transport errors have only sanitized stable fields', async () => {
    for (const [status, kind] of [[401, 'unauthorized'], [403, 'forbidden'], [404, 'not-found'], [429, 'rate-limit'], [500, 'server'], [0, 'network']]) {
        await assert.rejects(adapter(() => Promise.reject({ status, responseText: 'SECRET', responseJSON: { errors: { summary: 'SECRET' } }, headers: { authorization: 'SECRET' } })).getCurrentUser(), e => {
            assert.equal(e.kind, kind); assert.equal(e.status, status);
            assert.deepEqual(Object.keys(e).sort(), ['fieldErrors', 'kind', 'message', 'status']);
            assert.doesNotMatch(JSON.stringify(e), /SECRET|response|headers|authorization/);
            return true;
        });
    }
    await assert.rejects(adapter(() => { throw new Error('SECRET'); }).getCurrentUser(), e => e.kind === 'network' && !JSON.stringify(e).includes('SECRET'));
});

test('abort signal aborts jqXHR and pre-aborted reads send no request', async () => {
    const controller = new AbortController(); let aborted = 0, calls = 0;
    const api = adapter(() => { calls++; const request = new Promise(() => {}); request.abort = () => aborted++; return request; });
    const pending = api.getProjects({ signal: controller.signal });
    controller.abort();
    await assert.rejects(pending, e => e.kind === 'abort');
    assert.equal(aborted, 1);
    await assert.rejects(api.getCurrentUser({ signal: controller.signal }), e => e.kind === 'abort');
    assert.equal(calls, 1);
});

test('project catalogs carry scope and cancellation reaches later pages', async () => {
    const calls = [], controller = new AbortController(); let aborted = 0;
    const api = adapter(o => {
        calls.push(o);
        if (calls.length === 1) return Promise.resolve({ values: [{ id: '1' }], total: 2, startAt: 0 });
        const pending = new Promise(() => {}); pending.abort = () => aborted++;
        return pending;
    });
    const pending = api.getVersions('DO', { signal: controller.signal });
    await new Promise(resolve => setImmediate(resolve));
    controller.abort();
    await assert.rejects(pending, e => e.kind === 'abort');
    assert.equal(calls.length, 2);
    assert.equal(aborted, 1);
    const catalog = await adapter(() => Promise.resolve([{ id: '1' }])).getComponents('DO');
    assert.equal(catalog.projectKey, 'DO');
});

test('duplicate and inconsistent pages cannot be declared complete', async () => {
    for (const second of [
        { values: [{ id: '1' }], total: 2, startAt: 1 },
        { values: [{ id: '2' }], total: 3, startAt: 1 },
        { values: [{ id: '2' }], total: 2, startAt: 1, isLast: false }
    ]) {
        let count = 0;
        await assert.rejects(adapter(() => Promise.resolve(count++ ? second : { values: [{ id: '1' }], total: 2, startAt: 0 })).getProjects(), e => e.kind === 'incomplete');
    }
});

test('create metadata preserves legacy project wrappers and collects explicit pages', async () => {
    const project = { id: '1', key: 'DO', issuetypes: [{ id: '10', fields: {} }] };
    const legacy = await adapter(() => Promise.resolve({ projects: [project] })).getCreateMeta('DO', '10');
    assert.equal(legacy.projects[0].key, 'DO');
    const calls = [], api = adapter(o => {
        calls.push(o);
        return Promise.resolve({ projects: [calls.length === 1 ? project : { id: '2', key: 'APP', issuetypes: [] }], startAt: calls.length - 1, total: 2 });
    });
    const result = await api.getCreateMeta('DO', null);
    assert.equal(result.projects.length, 2);
    assert.equal(calls.length, 2);
    assert.equal(calls[1].data.startAt, 1);
    assert.equal(calls[1].data.projectKeys, 'DO');
});
