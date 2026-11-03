const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const load = require('./helpers/load-amd-module');
const root = path.join(__dirname, '../ujg-knowledge-assistant-modules');
function unit(name, deps = {}) { const file = path.join(root, name + '.js'); assert.ok(fs.existsSync(file), name + ' implementation is missing'); return load(file, deps, { URL }); }
function src(id = '42', kind = 'confluence') { return { id, kind, title: 'Guide', url: 'https://wiki.example/' + id, version: 1, updatedAt: 'today', fetchedAt: 'now' }; }
function fragment(id = '42', kind = 'confluence', offset = 0) { return { source: src(id, kind), text: offset ? 'z' : 'a'.repeat(8000), total: 8001, nextOffset: offset ? null : 8000, warnings: [] }; }
function setup(options = {}) {
    const evidenceModule = unit('evidence');
    const evidence = evidenceModule.createEvidenceStore({ identityKey: 'a' });
    const calls = [];
    let scopes = { spaces: ['DOC'], projects: ['DO'] };
    const factory = kind => selected => {
        calls.push({ selected: Array.from(selected), kind });
        return { search: options.search || (async () => ({ items: [src(kind === 'jira' ? 'DO-1' : '42', kind)], nextCursor: null, warnings: [] })),
            read: options.read || (async args => fragment(args.id, kind, args.offset)) };
    };
    const api = unit('tools', { _ujgKA_evidence: evidenceModule }).createTools({ confluence: factory('confluence'), jira: factory('jira'), evidence, getScopes: () => scopes });
    return { ...api, evidence, calls, setScopes: value => { scopes = value; } };
}
const rejectsCode = code => e => e.code === code;
test('four JSON-schema descriptors and runner reject invalid arguments before calling adapters', async () => {
    const h = setup(); assert.deepEqual(Array.from(h.descriptors, d => d.name), ['search_confluence', 'read_page', 'search_jira', 'read_issue']);
    for (const d of h.descriptors) { assert.equal(d.parameters.additionalProperties, false); assert.equal(d.parameters.type, 'object'); }
    for (const [name, args] of [['write_issue', {}], ['read_page', { id: 'jira:DO-1' }], ['read_issue', { id: 'https://evil' }],
        ['read_page', { id: '42', offset: -1 }], ['search_jira', { text: '' }], ['search_confluence', { text: 'x', cursor: 'url' }],
        ['search_jira', { text: 'x', unexpected: true }], ['read_page', null]]) await assert.rejects(h.run(name, args), rejectsCode('invalid-request'));
    assert.equal(h.calls.length, 0);
});
test('search produces canonical sources and excerpts without creating evidence', async () => {
    const h = setup();
    const result = await h.run('search_confluence', { text: 'rules' });
    assert.equal(result.items[0].id, 'confluence:42'); assert.equal(result.items[0].excerpt, '');
    assert.equal(h.evidence.get('confluence:42'), null);
    assert.equal((await h.run('search_jira', { text: 'rules' })).items[0].id, 'jira:DO-1');
});
test('21 search results cannot silently lose the 21st; forward cursors must progress', async () => {
    const h = setup({ search: async () => ({ items: Array.from({ length: 21 }, (_, i) => src(String(i + 1))), nextCursor: null, warnings: [] }) });
    await assert.rejects(h.run('search_confluence', { text: 'x' }), rejectsCode('invalid-response'));
    const repeating = setup({ search: async () => ({ items: [src()], nextCursor: 20, warnings: [] }) });
    assert.equal((await repeating.run('search_confluence', { text: 'x' })).nextCursor, 20);
    await assert.rejects(repeating.run('search_confluence', { text: 'x', cursor: 20 }), rejectsCode('invalid-response'));
});
test('read 8001 characters retains offsets and evidence only becomes complete after all parts', async () => {
    const h = setup(); const first = await h.run('read_page', { id: 'confluence:42' });
    assert.equal(first.source.id, 'confluence:42'); assert.equal(first.offset, 0); assert.equal(first.nextOffset, 8000);
    assert.equal(h.evidence.get('confluence:42').complete, false);
    await h.run('read_page', { id: 'confluence:42', offset: 8000 });
    assert.equal(h.evidence.get('confluence:42').complete, true);
    const issue = await h.run('read_issue', { id: 'jira:DO-1' }); assert.equal(issue.source.id, 'jira:DO-1');
});
test('403 on next read leaves previous ranges incomplete with a safe warning', async () => {
    const h = setup({ read: async args => { if (args.offset) throw { code: 'forbidden', message: 'SECRET' }; return fragment(); } });
    await h.run('read_page', { id: '42' });
    await assert.rejects(h.run('read_page', { id: '42', offset: 8000 }), e => e.code === 'forbidden' && !JSON.stringify(e).includes('SECRET'));
    const entry = h.evidence.get('confluence:42'); assert.equal(entry.complete, false); assert.equal(entry.ranges.length, 1); assert.ok(entry.warnings.length);
});
test('current scopes are checked on every call; selection changes clear evidence and stale reads reject', async () => {
    let finish;
    const h = setup({ read: () => new Promise(resolve => { finish = resolve; }) });
    const pending = h.run('read_page', { id: '42' });
    h.setScopes({ spaces: ['OTHER'], projects: ['DO'] }); finish(fragment());
    await assert.rejects(pending, rejectsCode('scope')); assert.equal(h.evidence.get('confluence:42'), null);
    const next = h.run('read_page', { id: '42' }); assert.deepEqual(h.calls[1].selected, ['OTHER']); finish(fragment()); await next;
    h.setScopes({ spaces: [], projects: ['DO'] }); await assert.rejects(h.run('read_page', { id: '42' }), rejectsCode('scope'));
    assert.equal(h.evidence.get('confluence:42'), null);
});
test('malformed API results, wrong identities and incomplete pagination fail closed', async () => {
    for (const result of [{ ...fragment(), nextOffset: null }, { ...fragment(), text: 'a'.repeat(8001) },
        { ...fragment(), source: src('99') }, { ...fragment(), warnings: null }, { ...fragment(), total: -1 }]) {
        const h = setup({ read: async () => result });
        await assert.rejects(h.run('read_page', { id: '42' }), rejectsCode('invalid-response')); assert.equal(h.evidence.get('confluence:42'), null);
    }
    for (const result of [{ items: [], warnings: [], nextCursor: 0 }, { items: [src('X', 'other')], warnings: [], nextCursor: null }, { items: [], nextCursor: null }]) {
        await assert.rejects(setup({ search: async () => result }).run('search_confluence', { text: 'x' }), rejectsCode('invalid-response'));
    }
});
test('abort signal is forwarded and late completion never becomes evidence', async () => {
    const controller = new AbortController(); let finish;
    const h = setup({ read: args => { assert.equal(args.signal, controller.signal); return new Promise(resolve => { finish = resolve; }); } });
    const pending = h.run('read_page', { id: '42' }, { signal: controller.signal }); controller.abort(); finish(fragment());
    await assert.rejects(pending, rejectsCode('aborted')); assert.equal(h.evidence.get('confluence:42'), null);
    await assert.rejects(h.run('read_page', { id: '42' }, { signal: controller.signal }), rejectsCode('aborted'));
    assert.equal(h.calls.length, 1);
});
for (const kind of ['confluence', 'jira']) {
    test(kind + ' real Task1 adapter keeps 21st search result and enforces actual returned scope per read', async () => {
        const evidenceModule = unit('evidence'); const transportModule = unit('transport');
        const adapter = unit(kind + '-api', { _ujgKA_transport: transportModule, _ujgKA_evidence: evidenceModule });
        const evidence = evidenceModule.createEvidenceStore({ identityKey: 'real-adapter' });
        let actualScope = 'DOC';
        const record = i => kind === 'confluence' ? { id: String(i), type: 'page', title: 'Same title', space: { key: actualScope }, version: { number: 1 }, body: { storage: { value: '<p>' + 'x'.repeat(8001) + '</p>' } } } :
            { key: 'DOC-' + i, fields: { summary: 'Same title', project: { key: actualScope }, updated: 'today', description: 'x'.repeat(8001) } };
        const transport = { getJson: async (url, query) => {
            if (/search$/.test(url)) {
                const start = query.start || query.startAt || 0;
                const records = Array.from({ length: Math.min(20, 21 - start) }, (_, i) => record(start + i + 1));
                return kind === 'confluence' ? { results: records, totalSize: 21 } : { issues: records, total: 21 };
            }
            return record(1);
        } };
        const factory = scopes => adapter.createApi({ transport, scopes, baseUrl: 'https://source.example' });
        const tools = unit('tools', { _ujgKA_evidence: evidenceModule }).createTools({ confluence: factory, jira: factory, evidence, getScopes: () => ({ spaces: ['DOC'], projects: ['DOC'] }) });
        const name = kind === 'confluence' ? 'search_confluence' : 'search_jira', read = kind === 'confluence' ? 'read_page' : 'read_issue';
        const first = await tools.run(name, { text: 'x' }); assert.equal(first.items.length, 20); assert.equal(first.nextCursor, 20); assert.equal(first.complete, false);
        const last = await tools.run(name, { text: 'x', cursor: first.nextCursor }); assert.equal(last.items.length, 1); assert.equal(last.nextCursor, null);
        const id = first.items[0].id;
        assert.notEqual(id, first.items[1].id);
        const chunk = await tools.run(read, { id }); assert.equal(chunk.text.length, 8000); assert.equal(chunk.nextOffset, 8000);
        actualScope = 'OTHER';
        await assert.rejects(tools.run(read, { id, offset: chunk.nextOffset }), rejectsCode('scope'));
        assert.equal(evidence.get(id).complete, false); assert.equal(evidence.get(id).ranges.length, 1);
    });
}
test('stale search and failed read cannot return after scope changes; newer evidence survives obsolete failure', async () => {
    let finishSearch;
    const h = setup({ search: () => new Promise(resolve => { finishSearch = resolve; }) });
    const pending = h.run('search_confluence', { text: 'x' });
    h.setScopes({ spaces: ['OTHER'], projects: ['DO'] }); finishSearch({ items: [src()], nextCursor: null, warnings: [] });
    await assert.rejects(pending, rejectsCode('scope'));
    let failOld; let first = true;
    const r = setup({ read: args => { if (first) { first = false; return new Promise((resolve, reject) => { failOld = reject; }); } return Promise.resolve(fragment(args.id)); } });
    const old = r.run('read_page', { id: '42' });
    r.setScopes({ spaces: ['OTHER'], projects: ['DO'] });
    await r.run('read_page', { id: '42' });
    failOld({ code: 'forbidden', message: 'SECRET' });
    await assert.rejects(old, rejectsCode('scope'));
    assert.equal(r.evidence.get('confluence:42').warnings.length, 0);
});
test('read results expose accumulated revision warnings so incomplete evidence is explainable', async () => {
    let revision = 1;
    const h = setup({ read: async args => ({ ...fragment(args.id, 'confluence', args.offset), source: { ...src(args.id), version: revision } }) });
    await h.run('read_page', { id: '42' }); revision = 2;
    const result = await h.run('read_page', { id: '42', offset: 8000 });
    assert.equal(result.complete, false); assert.ok(result.warnings.some(w => /Версия/.test(w)));
    assert.equal(h.evidence.get('confluence:42').ranges.length, 1);
});
