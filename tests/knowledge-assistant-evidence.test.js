const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const load = require('./helpers/load-amd-module');
const file = path.join(__dirname, '../ujg-knowledge-assistant-modules/evidence.js');
function unit() { assert.ok(fs.existsSync(file), 'evidence implementation is missing'); return load(file, {}); }
function source(id = '42', version = 1, kind = 'confluence') {
    return { id, kind, title: 'Same title', url: 'https://wiki.example/' + id, version, updatedAt: '2026-11-03', fetchedAt: '2026-11-03' };
}
function part(offset = 0, text = 'abc', total = 3, nextOffset = null, version = 1) {
    return { source: source('42', version), offset, text, total, nextOffset, warnings: [] };
}
test('evidence records ranges, gaps, offsets and explicit completeness for 8001 characters', () => {
    const store = unit().createEvidenceStore({ identityKey: 'user@origin/connection' });
    store.put(part(8000, 'z', 8001));
    assert.equal(store.get('confluence:42').complete, false);
    store.put(part(0, 'a'.repeat(8000), 8001, 8000));
    const result = store.get('confluence:42');
    assert.equal(result.complete, true);
    assert.deepEqual(Array.from(result.ranges, r => [r.offset, r.text.length]), [[0, 8000], [8000, 1]]);
    result.ranges[0].text = 'mutated';
    assert.equal(store.get('confluence:42').ranges[0].text.length, 8000);
});
test('same titles and cross-kind identifiers stay distinct; stores and clear are isolated', () => {
    const { createEvidenceStore } = unit();
    const a = createEvidenceStore({ identityKey: 'a' }), b = createEvidenceStore({ identityKey: 'b' });
    a.put(part()); a.put({ ...part(), source: source('43') });
    a.put({ ...part(), source: source('DOC-1', 1, 'jira') });
    assert.equal(a.get('confluence:42').sourceId, 'confluence:42');
    assert.equal(a.get('confluence:43').sourceId, 'confluence:43');
    assert.equal(a.get('jira:DOC-1').sourceId, 'jira:DOC-1');
    assert.equal(b.get('confluence:42'), null); a.clear(); assert.equal(a.get('confluence:42'), null);
    assert.throws(() => createEvidenceStore({ identityKey: '' }));
});
test('new revision invalidates old ranges instead of mixing; unknown revision cannot combine', () => {
    const store = unit().createEvidenceStore({ identityKey: 'a' });
    store.put(part(0, 'a'.repeat(8000), 8001, 8000));
    store.put(part(8000, 'b', 8001, null, 2));
    let result = store.get('confluence:42');
    assert.equal(result.complete, false); assert.equal(result.ranges.length, 1); assert.ok(result.warnings.length);
    store.clear(); store.put(part(0, 'a'.repeat(8000), 8001, 8000, null));
    store.put(part(8000, 'b', 8001, null, null));
    result = store.get('confluence:42'); assert.equal(result.complete, false); assert.equal(result.ranges.length, 1);
});
test('failed next fragment preserves ranges but explicitly leaves evidence incomplete', () => {
    const store = unit().createEvidenceStore({ identityKey: 'a' });
    store.put(part(0, 'a'.repeat(8000), 8001, 8000));
    store.put({ sourceId: 'confluence:42', error: { code: 'forbidden' } });
    const result = store.get('confluence:42');
    assert.equal(result.complete, false); assert.equal(result.ranges[0].text.length, 8000);
    assert.ok(result.warnings.some(w => w.includes('forbidden')));
});
test('malformed fragments and conflicting same-revision data are rejected', () => {
    const store = unit().createEvidenceStore({ identityKey: 'a' });
    for (const bad of [{ ...part(), offset: -1 }, { ...part(), total: 4 }, { ...part(), nextOffset: 0 },
        { ...part(), text: 'a'.repeat(8001), total: 8001 }, { ...part(), source: { ...source(), url: 'javascript:alert(1)' } },
        { ...part(), warnings: 'oops' }, { ...part(), source: { ...source(), kind: 'other' } }]) assert.throws(() => store.put(bad));
    store.put(part()); assert.throws(() => store.put(part(0, 'xyz')));
    assert.equal(store.get('confluence:42').complete, false);
});
test('storage extraction preserves headings, lists, table cells and entities without active markup', () => {
    const out = unit().extractStorage('<h2>Rules</h2><ul><li>One &amp; two</li><li>Three</li></ul><table><tr><th>Name</th><th>Value</th></tr><tr><td>A</td><td>2</td></tr></table><script>SECRET</script><iframe>SECRET</iframe><img onerror="SECRET"/><style>SECRET</style>');
    assert.match(out.text, /Rules\n/); assert.match(out.text, /- One & two\n- Three/);
    assert.match(out.text, /Name\tValue\nA\t2/); assert.ok(!out.text.includes('SECRET')); assert.equal(out.warnings.length, 0);
});
test('unknown and nested macros are visibly incomplete and discard active payloads', () => {
    const out = unit().extractStorage('<p>Before</p><ac:structured-macro ac:name="mystery"><ac:parameter ac:name="url">PRIVATE</ac:parameter><ac:rich-text-body><p>Readable</p><ac:structured-macro ac:name="nested"><script>SECRET</script></ac:structured-macro></ac:rich-text-body></ac:structured-macro><p>After</p>');
    assert.match(out.text, /Before/); assert.match(out.text, /Readable/); assert.match(out.text, /After/);
    assert.ok(out.warnings.length); assert.ok(!/PRIVATE|SECRET|<script|ac:/.test(out.text));
    const store = unit().createEvidenceStore({ identityKey: 'a' });
    store.put({ ...part(0, out.text, out.text.length), warnings: out.warnings });
    assert.equal(store.get('confluence:42').complete, false);
});
test('formatted table cells retain their boundaries when Confluence wraps contents in paragraphs', () => {
    const out = unit().extractStorage('<table>\n<tr><th><p>Name</p></th><th><p>Value</p></th></tr>\n<tr><td><p>A</p><p>B</p></td><td><p>2</p></td></tr>\n</table>');
    assert.equal(out.text, 'Name\tValue\nA B\t2');
});
