const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const load = require('./helpers/load-amd-module');
const root = path.join(__dirname, '..', 'ujg-knowledge-assistant-modules');
function unit(name, deps = {}) {
    const file = path.join(root, name + '.js');
    assert.ok(fs.existsSync(file), name + ' implementation is missing');
    return load(file, deps, { URL, location: { origin: 'https://jira.example' }, AbortController });
}
function transport(options = {}) {
    return unit('transport').createTransport({ mode: 'session', baseUrl: '/jira', ...options });
}
function response(data, status = 200, type = 'application/json', extra = {}) {
    return { status, ok: status >= 200 && status < 300, redirected: false,
        headers: { get: key => key.toLowerCase() === 'content-type' ? type : null },
        json: async () => data, ...extra };
}
function adapter(kind, fetchImpl, scopes = ['DOC']) {
    let connection = transport({ fetchImpl });
    if (kind === 'confluence') {
        const bridge = transport({ mode: 'bridge', baseUrl: 'http://127.0.0.1:8769', getToken: () => 'TEST_ONLY',
            fetchImpl: (url, options) => url.endsWith('/rest/api/user/current') ? Promise.resolve(response({ type: 'known', username: 'reader' })) : fetchImpl(url, options) });
        connection = { getJson: async (...args) => { await bridge.getJson('/rest/api/user/current'); return bridge.getJson(...args); } };
    }
    return unit(kind + '-api', { _ujgKA_transport: unit('transport') }).createApi({
        transport: connection, scopes, baseUrl: kind === 'jira' ? 'https://jira.example/jira' : 'https://wiki.example/wiki'
    });
}
function page(id = '42', space = 'DOC', value = '<p>Hello &amp; world</p>') {
    return { id, type: 'page', title: 'Guide', space: { key: space }, version: { number: 3, when: '2026-11-01T12:00:00Z' }, body: { storage: { value } } };
}
function issue(key = 'DOC-1', project = 'DOC', description = 'Hello world') {
    return { id: '1001', key, fields: { summary: 'Issue', project: { key: project }, description, updated: '2026-11-01T12:00:00Z' } };
}
const code = expected => error => error.code === expected && typeof error.message === 'string' && Object.hasOwn(error, 'retryAfter');

test('rejectsLoginHtml200', async () => {
    for (const type of ['text/html', 'application/json']) {
        await assert.rejects(transport({ fetchImpl: async () => response('<html>Login SECRET</html>', 200, type) }).getJson('/rest/api/2/myself'), code('invalid-response'));
    }
});
test('rejectsForeignOriginAndWriteMethods', async () => {
    let calls = 0;
    const t = transport({ fetchImpl: async () => { calls++; return response({}); } });
    for (const p of ['https://evil.example/rest/api/2/myself', '//evil.example', '/rest/api/2/issue/ABC-1/comment', '/rest/api/2/../myself', '/rest/api/2/issue/ABC%2f1', '/rest/api/2/search?x=1']) {
        await assert.rejects(t.getJson(p), code('invalid-request'));
    }
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) await assert.rejects(t.getJson('/rest/api/2/myself', {}, { method }), code('invalid-request'));
    await assert.rejects(t.getJson('/rest/api/2/myself', { access_token: 'SECRET' }), code('invalid-request'));
    await assert.rejects(transport({ baseUrl: 'https://evil.example', fetchImpl: async () => {} }).getJson('/rest/api/2/myself'), code('invalid-request'));
    assert.equal(calls, 0);
});
test('session only permits Jira GET with same-origin credentials and redirect error', async () => {
    const calls = [];
    const t = transport({ fetchImpl: async (url, options) => { calls.push({ url, options }); return response({ name: 'reader' }); } });
    await t.getJson('/rest/api/2/myself');
    assert.equal(calls[0].url, 'https://jira.example/jira/rest/api/2/myself');
    assert.equal(calls[0].options.credentials, 'same-origin');
    assert.equal(calls[0].options.method, 'GET');
    assert.equal(calls[0].options.redirect, 'error');
    assert.equal(calls[0].options.headers.Authorization, undefined);
    await assert.rejects(t.getJson('/rest/api/user/current'), code('invalid-request'));
});
test('bridge requires configured identity and obtains each bearer from memory', async () => {
    let token = 'FIRST', calls = [];
    const t = transport({ mode: 'bridge', baseUrl: 'http://127.0.0.1:8769', getToken: () => token,
        fetchImpl: async (url, options) => { calls.push({ url, options }); return response({ type: 'known', username: 'reader' }); } });
    await assert.rejects(t.getJson('/rest/api/content/42'), code('not-configured'));
    await t.getJson('/rest/api/user/current');
    token = 'SECOND';
    await t.getJson('/rest/api/content/42');
    assert.equal(calls[0].options.headers.Authorization, 'Bearer FIRST');
    assert.equal(calls[1].options.headers.Authorization, 'Bearer SECOND');
    assert.ok(calls.every(c => c.options.credentials === 'omit' && c.options.redirect === 'error' && !c.url.includes('FIRST') && !c.url.includes('SECOND')));
    await assert.rejects(t.getJson('/rest/api/2/myself'), code('invalid-request'));
    for (const baseUrl of ['', 'http://evil.example', 'http://127.0.0.1.evil.example', 'https://u:p@bridge.example', 'http://127.0.0.1:8769/../x', '//localhost:8769']) {
        await assert.rejects(transport({ mode: 'bridge', baseUrl, getToken: () => token, fetchImpl: async () => { throw Error('must not fetch'); } }).getJson('/rest/api/user/current'));
    }
});
test('bridge anonymous identity and missing credentials fail closed', async () => {
    const t = transport({ mode: 'bridge', baseUrl: 'https://bridge.example', getToken: () => 'TOKEN', fetchImpl: async () => response({ type: 'anonymous' }) });
    await assert.rejects(t.getJson('/rest/api/user/current'), code('not-configured'));
    await assert.rejects(t.getJson('/rest/api/content/42'), code('not-configured'));
    await assert.rejects(transport({ mode: 'bridge', baseUrl: 'http://localhost:8769', getToken: () => '', fetchImpl: async () => response({}) }).getJson('/rest/api/user/current'), code('not-configured'));
});
test('maps401403429 without exposing upstream secrets', async () => {
    for (const [status, expected] of [[401, 'unauthorized'], [403, 'forbidden'], [429, 'rate-limit']]) {
        const t = transport({ fetchImpl: async () => response({ message: 'SECRET' }, status, 'application/json', { headers: { get: k => k.toLowerCase() === 'retry-after' ? '12' : 'application/json' } }) });
        await assert.rejects(t.getJson('/rest/api/2/myself'), e => {
            assert.ok(code(expected)(e)); assert.equal(e.retryAfter, status === 429 ? 12 : null);
            assert.ok(!JSON.stringify(e).includes('SECRET')); return true;
        });
    }
    await assert.rejects(transport({ fetchImpl: async () => { throw Error('SECRET'); } }).getJson('/rest/api/2/myself'), code('network'));
});
test('rejects redirects and invalid JSON', async () => {
    for (const extra of [{ redirected: true }, { json: async () => { throw Error('SECRET'); } }]) {
        await assert.rejects(transport({ fetchImpl: async () => response({}, 200, 'application/json', extra) }).getJson('/rest/api/2/myself'), code('invalid-response'));
    }
});
test('abortsRequest before dispatch and during fetch', async () => {
    const pre = new AbortController(); pre.abort(); let calls = 0;
    await assert.rejects(transport({ fetchImpl: async () => { calls++; } }).getJson('/rest/api/2/myself', {}, { signal: pre.signal }), code('aborted'));
    assert.equal(calls, 0);
    const active = new AbortController();
    const pending = transport({ fetchImpl: (url, opts) => new Promise((resolve, reject) => {
        assert.equal(opts.signal, active.signal);
        opts.signal.addEventListener('abort', () => reject(Object.assign(Error('SECRET'), { name: 'AbortError' })), { once: true });
    }) }).getJson('/rest/api/2/myself', {}, { signal: active.signal });
    active.abort(); await assert.rejects(pending, code('aborted'));
});
for (const kind of ['confluence', 'jira']) {
    test(kind + ' escapesSearchAndEnforcesScopes', async () => {
        const calls = [], scopes = ['DOC'];
        const api = adapter(kind, async url => { calls.push(new URL(url)); return response(kind === 'jira' ? { issues: [issue(), issue('OTHER-1', 'OTHER')], total: 2 } : { results: [page(), page('43', 'OTHER')], totalSize: 2 }); }, scopes);
        scopes.push('OTHER');
        const result = await api.search({ text: 'x" OR space = "OTHER\\z' });
        assert.equal(result.items.length, 1); assert.ok(result.warnings.length);
        const query = calls[0].searchParams;
        assert.equal(query.get(kind === 'jira' ? 'jql' : 'cql'), (kind === 'jira' ? 'project' : 'space') + ' in ("DOC") AND ' + (kind === 'jira' ? 'text' : 'text') + ' ~ "x\\" OR space = \\"OTHER\\\\z"' + (kind === 'jira' ? ' ORDER BY key ASC' : ' AND type = page ORDER BY title ASC'));
        assert.equal(query.get(kind === 'jira' ? 'maxResults' : 'limit'), '20');
        await assert.rejects(api.search({ text: 'x', scopes: ['OTHER'] }), code('scope'));
        assert.equal(calls.length, 1);
    });
    test(kind + ' missing and empty scopes fail closed, narrowed scopes filter results', async () => {
        let calls = 0;
        const fetcher = async () => { calls++; return response(kind === 'jira' ? { issues: [issue('OTHER-1', 'OTHER')], total: 1 } : { results: [page('43', 'OTHER')], totalSize: 1 }); };
        const empty = adapter(kind, fetcher, []);
        await assert.rejects(empty.search({ text: 'x' }), code('scope'));
        await assert.rejects(empty.read({ id: kind === 'jira' ? 'DOC-1' : '42' }), code('scope'));
        assert.equal(calls, 0);
        const narrowed = await adapter(kind, fetcher, ['DOC', 'OTHER']).search({ text: 'x', scopes: ['DOC'] });
        assert.equal(narrowed.items.length, 0); assert.ok(narrowed.warnings.length);
    });
    test(kind + ' read validates returned scope, not id prefix or previous search', async () => {
        const calls = [], api = adapter(kind, async url => { calls.push(new URL(url)); return response(kind === 'jira' ? issue('DOC-1', 'OTHER', 'PRIVATE') : page('42', 'OTHER', 'PRIVATE')); });
        await assert.rejects(api.read({ id: kind === 'jira' ? 'DOC-1' : '42' }), code('scope'));
        const q = calls[0].searchParams;
        assert.ok((q.get(kind === 'jira' ? 'fields' : 'expand') || '').split(',').includes(kind === 'jira' ? 'project' : 'space'));
        for (const id of ['../42', 'https://evil.example/42', '42?expand=secret']) await assert.rejects(api.read({ id }), code('invalid-request'));
        assert.equal(calls.length, 1);
    });
    test(kind + ' read returns metadata and explicit 8000 character fragments', async () => {
        const api = adapter(kind, async () => response(kind === 'jira' ? issue('DOC-1', 'DOC', 'A'.repeat(8001)) : page('42', 'DOC', '<p>' + 'A'.repeat(8001) + '</p>')));
        const id = kind === 'jira' ? 'DOC-1' : '42';
        const first = await api.read({ id });
        assert.equal(first.text, 'A'.repeat(8000)); assert.equal(first.total, 8001); assert.equal(first.nextOffset, 8000);
        assert.equal(first.source.id, id); assert.equal(first.source.kind, kind); assert.ok(first.source.title);
        assert.ok(first.source.version); assert.equal(first.source.updatedAt, '2026-11-01T12:00:00Z'); assert.ok(!isNaN(Date.parse(first.source.fetchedAt)));
        assert.equal(first.source.url, kind === 'jira' ? 'https://jira.example/jira/browse/DOC-1' : 'https://wiki.example/wiki/pages/viewpage.action?pageId=42');
        const last = await api.read({ id, offset: 8000 }); assert.equal(last.text, 'A'); assert.equal(last.nextOffset, null);
        await assert.rejects(api.read({ id, offset: -1 }), code('invalid-request'));
    });
    test(kind + ' search pagination uses offsets and never follows upstream URLs', async () => {
        const urls = [], api = adapter(kind, async url => { urls.push(new URL(url)); return response(kind === 'jira' ? { issues: Array.from({ length: 20 }, (_, i) => issue('DOC-' + (i + 1))), total: 21 } : { results: Array.from({ length: 20 }, (_, i) => page(String(i + 1))), _links: { next: 'https://evil.example/SECRET' } }); });
        const first = await api.search({ text: 'x' }); assert.equal(first.items.length, 20); assert.equal(first.nextCursor, 20);
        await api.search({ text: 'x', cursor: first.nextCursor });
        assert.equal(urls[1].searchParams.get(kind === 'jira' ? 'startAt' : 'start'), '20');
        await assert.rejects(api.search({ text: 'x', cursor: 'https://evil.example' }), code('invalid-request'));
        assert.equal(urls.length, 2);
    });
    test(kind + ' malformed response cannot masquerade as empty search or readable content', async () => {
        const api = adapter(kind, async () => response({}));
        await assert.rejects(api.search({ text: 'x' }), code('invalid-response'));
        await assert.rejects(api.read({ id: kind === 'jira' ? 'DOC-1' : '42' }), code('invalid-response'));
    });
}
test('Confluence strips active markup and decodes storage text', async () => {
    const result = await adapter('confluence', async () => response(page('42', 'DOC', '<script>SECRET</script><p>Hello &amp; world</p><p>&#65;&#x42;</p>'))).read({ id: '42' });
    assert.equal(result.text, 'Hello & world\nAB');
});

test('bridge requires an explicitly authenticated Confluence identity', async () => {
    for (const identity of [{ type: 'anonymous', username: 'anonymous' }, { username: 'anonymous' }, { type: 'unknown', username: 'reader' }, { type: 'known', userKey: {} }, { type: 'known', username: ' ' }]) {
        const t = transport({ mode: 'bridge', baseUrl: 'http://[::1]:8769', getToken: () => 'TEST_ONLY', fetchImpl: async () => response(identity) });
        await assert.rejects(t.getJson('/rest/api/user/current'), code('not-configured'));
        await assert.rejects(t.getJson('/rest/api/content/42'), code('not-configured'));
    }
});
test('bridge invalidates identity after authorization failure', async () => {
    let calls = 0;
    const t = transport({ mode: 'bridge', baseUrl: 'https://bridge.example', getToken: () => 'TEST_ONLY', fetchImpl: async url => {
        calls++; return response(url.endsWith('/current') ? { type: 'known', userKey: 'reader' } : {}, url.endsWith('/current') ? 200 : 401);
    } });
    await t.getJson('/rest/api/user/current');
    await assert.rejects(t.getJson('/rest/api/content/42'), code('unauthorized'));
    await assert.rejects(t.getJson('/rest/api/content/42'), code('not-configured'));
    assert.equal(calls, 2);
});
for (const kind of ['confluence', 'jira']) {
    test(kind + ' rejects mismatched pagination and invalid totals', async () => {
        for (const metadata of kind === 'jira' ? [{ startAt: 99 }, { total: -1 }] : [{ start: 99 }, { totalSize: -1 }]) {
            const api = adapter(kind, async () => response(kind === 'jira' ? { issues: [issue()], ...metadata } : { results: [page()], ...metadata }));
            await assert.rejects(api.search({ text: 'x' }), code('invalid-response'));
        }
    });
    test(kind + ' empty search ends pagination and unknown totals remain explicit', async () => {
        const api = adapter(kind, async () => response(kind === 'jira' ? { issues: [] } : { results: [] }));
        const result = await api.search({ text: 'x' }); assert.equal(result.items.length, 0); assert.equal(result.nextCursor, null); assert.ok(result.warnings.length);
    });
    test(kind + ' read fails closed without returned scope and aborts before fetch', async () => {
        let calls = 0;
        const api = adapter(kind, async () => { calls++; const raw = kind === 'jira' ? issue() : page(); if (kind === 'jira') delete raw.fields.project; else delete raw.space; return response(raw); });
        const id = kind === 'jira' ? 'DOC-1' : '42';
        await assert.rejects(api.read({ id }), code('invalid-response'));
        const controller = new AbortController(); controller.abort();
        await assert.rejects(api.read({ id, signal: controller.signal }), code('aborted'));
        assert.equal(calls, 1);
    });
}
test('bridge failed credential callback clears previously verified identity', async () => {
    let broken = false;
    const t = transport({ mode: 'bridge', baseUrl: 'http://localhost:8769', getToken: () => { if (broken) throw Error('SECRET'); return 'TEST_ONLY'; }, fetchImpl: async () => response({ type: 'known', username: 'reader' }) });
    await t.getJson('/rest/api/user/current');
    broken = true;
    await assert.rejects(t.getJson('/rest/api/user/current'), e => code('not-configured')(e) && !JSON.stringify(e).includes('SECRET'));
    broken = false;
    await assert.rejects(t.getJson('/rest/api/content/42'), code('not-configured'));
});

function deferred() {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}
function deferredBridge() {
    const requests = [];
    const bridge = transport({ mode: 'bridge', baseUrl: 'http://127.0.0.1:8769', getToken: () => 'TEST_ONLY',
        fetchImpl: (url, options) => { const pending = deferred(); requests.push({ url, options, ...pending }); return pending.promise; } });
    return { bridge, requests };
}
const knownIdentity = () => response({ type: 'known', username: 'reader' });

test('bridge rejects older identity success after newer identity failure', async () => {
    const { bridge, requests } = deferredBridge();
    const older = bridge.getJson('/rest/api/user/current');
    const olderRejected = assert.rejects(older, code('not-configured'));
    const newer = bridge.getJson('/rest/api/user/current');
    requests[1].resolve(response({}, 401));
    await assert.rejects(newer, code('unauthorized'));
    requests[0].resolve(knownIdentity());
    await olderRejected;
    await assert.rejects(bridge.getJson('/rest/api/content/42'), code('not-configured'));
    assert.equal(requests.length, 2);
});
test('bridge obsolete identity failure cannot invalidate newer identity success', async () => {
    for (const status of [401, 403]) {
        const { bridge, requests } = deferredBridge();
        const older = bridge.getJson('/rest/api/user/current');
        const olderRejected = assert.rejects(older, code('not-configured'));
        const newer = bridge.getJson('/rest/api/user/current');
        requests[1].resolve(knownIdentity()); await newer;
        requests[0].resolve(response({}, status)); await olderRejected;
        const content = bridge.getJson('/rest/api/content/42');
        assert.equal(requests.length, 3);
        requests[2].resolve(response({ id: '42' }));
        assert.equal((await content).id, '42');
    }
});
test('bridge rejects pending content after a parallel authorization failure', async () => {
    const { bridge, requests } = deferredBridge();
    const identity = bridge.getJson('/rest/api/user/current'); requests[0].resolve(knownIdentity()); await identity;
    const content = bridge.getJson('/rest/api/content/42');
    const contentRejected = assert.rejects(content, code('not-configured'));
    const forbidden = bridge.getJson('/rest/api/content/43'); requests[2].resolve(response({}, 403));
    await assert.rejects(forbidden, code('forbidden'));
    requests[1].resolve(response({ id: '42', text: 'PRIVATE' })); await contentRejected;
    await assert.rejects(bridge.getJson('/rest/api/content/44'), code('not-configured'));
    assert.equal(requests.length, 3);
});
test('bridge rejects pending content when verification restarts, even after newer success', async () => {
    const { bridge, requests } = deferredBridge();
    const identity = bridge.getJson('/rest/api/user/current'); requests[0].resolve(knownIdentity()); await identity;
    const content = bridge.getJson('/rest/api/content/42');
    const contentRejected = assert.rejects(content, code('not-configured'));
    const newer = bridge.getJson('/rest/api/user/current'); requests[2].resolve(knownIdentity()); await newer;
    requests[1].resolve(response({ id: '42' })); await contentRejected;
});
test('bridge obsolete content failure cannot invalidate a newer verified connection', async () => {
    const { bridge, requests } = deferredBridge();
    const identity = bridge.getJson('/rest/api/user/current'); requests[0].resolve(knownIdentity()); await identity;
    const older = bridge.getJson('/rest/api/content/42');
    const olderRejected = assert.rejects(older, code('not-configured'));
    const newer = bridge.getJson('/rest/api/user/current'); requests[2].resolve(knownIdentity()); await newer;
    requests[1].resolve(response({}, 401)); await olderRejected;
    const current = bridge.getJson('/rest/api/content/43'); assert.equal(requests.length, 4);
    requests[3].resolve(response({ id: '43' })); assert.equal((await current).id, '43');
});
test('bridge checks authentication generation after deferred JSON decoding', async () => {
    for (const path of ['/rest/api/user/current', '/rest/api/content/42']) {
        const { bridge, requests } = deferredBridge();
        const identity = bridge.getJson('/rest/api/user/current'); requests[0].resolve(knownIdentity()); await identity;
        const body = deferred(), decoding = deferred();
        const older = bridge.getJson(path);
        const olderRejected = assert.rejects(older, code('not-configured'));
        requests[1].resolve(response({}, 200, 'application/json', { json: () => { decoding.resolve(); return body.promise; } }));
        await decoding.promise;
        const newer = bridge.getJson('/rest/api/user/current'); requests[2].resolve(response({}, 403));
        await assert.rejects(newer, code('forbidden'));
        body.resolve(path.endsWith('/current') ? { type: 'known', username: 'reader' } : { id: '42' });
        await olderRejected;
    }
});
test('bridge stale fetch and JSON exceptions cannot invalidate newer verification', async () => {
    for (const stage of ['fetch', 'json']) {
        const { bridge, requests } = deferredBridge();
        const older = bridge.getJson('/rest/api/user/current');
        const olderRejected = assert.rejects(older, code('not-configured'));
        const body = deferred(), decoding = deferred();
        if (stage === 'json') {
            requests[0].resolve(response({}, 200, 'application/json', { json: () => { decoding.resolve(); return body.promise; } }));
            await decoding.promise;
        }
        const newer = bridge.getJson('/rest/api/user/current'); requests[1].resolve(knownIdentity()); await newer;
        (stage === 'fetch' ? requests[0] : body).reject(Error('SECRET'));
        await olderRejected;
        const content = bridge.getJson('/rest/api/content/42'); assert.equal(requests.length, 3);
        requests[2].resolve(response({ id: '42' })); assert.equal((await content).id, '42');
    }
});
test('bridge authentication invalidation retains cancellation for pending requests', async () => {
    const { bridge, requests } = deferredBridge();
    const identity = bridge.getJson('/rest/api/user/current'); requests[0].resolve(knownIdentity()); await identity;
    const controller = new AbortController();
    const content = bridge.getJson('/rest/api/content/42', {}, { signal: controller.signal });
    const cancelled = assert.rejects(content, code('aborted'));
    assert.equal(requests[1].options.signal, controller.signal);
    const newer = bridge.getJson('/rest/api/user/current'); requests[2].resolve(knownIdentity()); await newer;
    controller.abort(); requests[1].resolve(response({ id: '42' })); await cancelled;
    const current = bridge.getJson('/rest/api/content/43'); requests[3].resolve(response({ id: '43' }));
    assert.equal((await current).id, '43');
});
