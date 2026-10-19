const test = require('node:test');
const assert = require('node:assert/strict');
const { loadUnit } = require('./helpers/ticket-assistant-fixture');
const draft = () => loadUnit('draft');
const plain = value => JSON.parse(JSON.stringify(value));

test('Russian answer blocks preserve exact legacy deduplication and multiline boundaries', () => {
    const api = draft();
    let d = api.createDraft({projectKey:'DO'});
    d.questions = [{id:'q',text:'Среда?',required:true},{id:'later',text:'Версия?',required:false}];
    d = api.appendAnswers(d,{q:'TEST\n\nQuestion: literal\nAnswer: text',later:'v1'});
    assert.match(d.source,/Вопрос: Среда\?\nОтвет: TEST/);
    assert.equal(api.appendAnswers(d,{q:'TEST\n\nQuestion: literal\nAnswer: text'}).source,d.source);
    const legacy = {...d,source:'Original\n\nQuestion: Среда?\nAnswer: TEST\n\nQuestion: Версия?\nAnswer: v1'};
    assert.equal(api.appendAnswers(legacy,{q:'TEST'}).source,legacy.source);
    assert.ok(api.appendAnswers(legacy,{q:'TE'}).source.endsWith('Вопрос: Среда?\nОтвет: TE'),'shorter answers still append');
});

test('late proposal cannot replace manual edits; current replacement requires acceptance', () => {
    const api = draft();
    const initial = api.createDraft({ projectKey: 'DO' });
    const snap = api.snapshot(initial);
    let d = api.editField(initial, 'summary', 'My summary');
    assert.equal(initial.fields.summary, undefined);
    assert.equal(api.isCurrent(d, snap), false);
    assert.equal(api.applyProposal(d, { fields: { summary: 'Late' } }, snap), d);
    d = api.applyProposal(d, { fields: { summary: 'Current', description: 'Body' } }, api.snapshot(d));
    assert.equal(d.fields.summary, 'My summary');
    assert.equal(d.pendingFields.summary, 'Current');
    assert.equal(d.fields.description, 'Body');
    const accepted = api.acceptField(d, 'summary');
    assert.equal(accepted.fields.summary, 'Current');
    assert.equal(accepted.pendingFields.summary, undefined);
    assert.equal(accepted.protectedFields.summary, true);
    assert.equal(d.fields.summary, 'My summary');
});

test('snapshots include draft identity and scope as well as all revisions', () => {
    const api = draft();
    const d = api.createDraft({ projectKey: 'DO' });
    assert.equal(api.isCurrent(api.createDraft({ projectKey: 'DO' }), api.snapshot(d)), false);
    for (const key of ['projectKey', 'issueTypeId', 'templateId', 'sourceRevision', 'settingsRevision', 'draftRevision', 'metaSignature']) {
        assert.equal(api.isCurrent({ ...d, [key]: 'different' }, api.snapshot(d)), false, key);
    }
});

test('checked requires current successful validation and no required unanswered questions', () => {
    const api = draft();
    let d = api.createDraft({ projectKey: 'DO' });
    const ok = { ok: true, fieldErrors: {}, warnings: [], unsupportedRequired: [] };
    const snap = api.snapshot(d);
    d = api.markChecked(d, ok, [], snap);
    assert.deepEqual(plain(d.checked), { sourceRevision: 0, settingsRevision: 0, draftRevision: 0, metaSignature: null });
    assert.equal(api.markChecked(d, { ...ok, ok: false }, [], snap).checked, null);
    assert.equal(api.markChecked(d, ok, [{ id: 'q', text: '?', required: true }], snap).checked, null);
    assert.equal(api.markChecked(d, { ...ok, unsupportedRequired: ['x'] }, [], snap).checked, null);
    assert.equal(api.markChecked(d, { ...ok, fieldErrors: { summary: ['missing'] } }, [], snap).checked, null);
    assert.equal(api.setSource(d, 'New source').checked, null);
    assert.equal(api.editField(d, 'summary', 'Manual').checked, null);
    assert.equal(api.setSelection(d, { metaSignature: 'changed' }).checked, null);
    assert.equal(api.setSelection(d, { settingsRevision: 1 }).checked, null);
    assert.equal(api.setSelection(d, { issueTypeId: '10' }).checked, null);
    assert.equal(api.setSelection(d, { templateId: 'bug' }).checked, null);
    assert.deepEqual(plain(api.setSelection(d, { metaSignature: null }).checked), plain(d.checked));
    const edited = api.setSource(d, 'Edit');
    assert.equal(api.markChecked(edited, ok, [], snap), edited);
});

test('answers are visible, idempotent and absent from hidden context after source edits', () => {
    const api = draft();
    let d = api.setSource(api.createDraft({ projectKey: 'DO' }), 'Original');
    d = api.applyProposal(d, { questions: [{ id: 'env', text: 'Which environment?', reason: 'Needed', required: true }] }, api.snapshot(d));
    d = api.appendAnswers(d, { env: 'TEST' });
    assert.match(d.source, /Which environment\?/);
    assert.match(d.source, /TEST/);
    const again = api.appendAnswers(d, { env: 'TEST' });
    assert.equal(again.source, d.source);
    assert.equal(again.sourceRevision, d.sourceRevision);
    d = api.setSource(d, 'Original edited');
    assert.doesNotMatch(api.serialize(d), /TEST/);
    assert.equal(d.checked, null);
});

test('evidence only keeps literal current source quotes or explicit suggestions', () => {
    const api = draft();
    let d = api.setSource(api.createDraft({ projectKey: 'DO' }), 'Observed outage');
    d = api.applyProposal(d, { evidence: [
        { fieldId: 'summary', kind: 'source', quote: 'outage' },
        { fieldId: 'summary', kind: 'source', quote: 'invented' },
        { fieldId: 'description', kind: 'suggestion', quote: 'Investigate' }
    ] }, api.snapshot(d));
    assert.equal(d.evidence.length, 2);
    assert.equal(api.setSource(d, 'New facts').evidence.some(e => e.kind === 'source'), false);
});

test('serialization whitelists nested values and attachment outcomes without invoking file serialization', () => {
    const api = draft();
    const d = api.createDraft({ projectKey: 'DO' });
    d.fields = { summary: 'Title', option: { id: '12', token: 'SECRET' }, assignee: { name: 'alice', cookie: 'SECRET' }, labels: ['a'], cleared: null, effort: 3 };
    d.pendingFields = { option: { id: '13', secret: 'SECRET' } };
    d.protectedFields = { summary: true, token: 'SECRET' };
    d.questions = [{ id: 'q', text: '?', reason: 'why', required: true, token: 'SECRET' }];
    d.warnings = ['warning', { token: 'SECRET' }];
    d.evidence = [{ fieldId: 'summary', kind: 'suggestion', quote: 'Maybe', token: 'SECRET' }];
    d.creation = { status: 'created', issueKey: 'DO-42', attemptId: 'a', error: { token: 'SECRET' }, token: 'SECRET' };
    d.attachments = [{ id: 'local-1', name: 'log.txt', size: 42, type: 'text/plain', lastModified: 7,
        status: 'uploaded', attachmentId: '99', error: null, content: 'SECRET',
        file: { toJSON() { throw new Error('File must not be serialized'); } } }];
    d.extra = 'SECRET';
    const text = api.serialize(d);
    assert.doesNotMatch(text, /SECRET|content|cookie|token|file|toJSON/);
    const restored = api.restore(text);
    assert.deepEqual(plain(restored.fields.option), { id: '12' });
    assert.equal(restored.creation.issueKey, 'DO-42');
    assert.equal(restored.creation.error, null);
    assert.equal(restored.attachments[0].attachmentId, '99');
    assert.equal(restored.attachments[0].needsReselect, true);
    assert.equal(restored.attachments[0].status, 'uploaded');
});

test('reload clears checked and distinguishes created from interrupted submissions', () => {
    const api = draft();
    for (const status of ['submitting', 'created', 'unknown', 'rejected', 'idle', 'preflight']) {
        const d = api.createDraft({ projectKey: 'DO' });
        d.checked = { sourceRevision: 0, settingsRevision: 0, draftRevision: 0, metaSignature: null };
        d.creation = { status, attemptId: 'a', issueKey: 'DO-42', error: 'failure' };
        const restored = api.restore(api.serialize(d));
        assert.equal(restored.creation.status, status === 'submitting' ? 'unknown' : status);
        assert.equal(restored.creation.issueKey, 'DO-42');
        assert.equal(restored.checked, null);
    }
});

test('unsafe keys and non-normalized field objects are excluded without prototype mutation', () => {
    const api = draft();
    const d = api.createDraft({ projectKey: 'DO' });
    d.fields = JSON.parse('{"__proto__":{"polluted":true},"constructor":"bad","summary":{"content":"SECRET"},"nested":[[{"id":"x"}]]}');
    const restored = api.restore(api.serialize(d));
    assert.deepEqual(plain(restored.fields), {});
    assert.equal({}.polluted, undefined);
    assert.throws(() => api.restore('{broken'));
    assert.throws(() => api.restore('{"schemaVersion":2}'));
});

test('universal and DEVOPS templates are isolated within one defaults instance', () => {
    const settings = loadUnit('profiles').createDefaults();
    const original = settings.profiles[1].templates[0].instructions;
    settings.profiles[0].templates[0].instructions = 'Custom';
    assert.equal(settings.profiles[1].templates[0].instructions, original);
});

test('runtime files survive draft edits but never become normalized field values or persisted bytes', () => {
    const api = draft();
    const file = new File(['PRIVATE_BYTES'], 'log.txt', { type: 'text/plain' });
    const blob = new Blob(['PRIVATE_BYTES']);
    let d = api.createDraft({ projectKey: 'DO' });
    d.attachments = [{ name: file.name, file }];
    d.fields = { invalidFile: file, invalidBlob: blob };
    d = api.setSource(d, 'Text');
    assert.equal(d.attachments[0].file, file);
    assert.deepEqual(plain(d.fields), {});
    assert.doesNotMatch(api.serialize(d), /PRIVATE_BYTES|invalidFile|invalidBlob|"file"/);
});

test('malformed creation never becomes retryable idle and mismatched checked is discarded', () => {
    const api = draft();
    const d = api.createDraft({ projectKey: 'DO' });
    d.creation = { status: 'unexpected', issueKey: 'DO-7', attemptId: 'a' };
    d.checked = { sourceRevision: 99, settingsRevision: 0, draftRevision: 0, metaSignature: null };
    const persisted = JSON.parse(api.serialize(d));
    assert.equal(persisted.creation.status, 'unknown');
    assert.equal(persisted.creation.issueKey, 'DO-7');
    assert.equal(persisted.checked, null);
});

test('saving a shorter answer after a longer one still appends its visible text', () => {
    const api = draft();
    let d = api.createDraft({ projectKey: 'DO' });
    d.questions = [{ id: 'q', text: 'Environment?', required: true }];
    d = api.appendAnswers(d, { q: 'TESTING' });
    d = api.appendAnswers(d, { q: 'TEST' });
    assert.match(d.source, /Ответ: TEST$/);
});

test('multiline answers containing literal question delimiters remain idempotent at any block position', () => {
    const api = draft();
    let d = api.setSource(api.createDraft({ projectKey: 'DO' }), 'Original');
    d.questions = [
        { id: 'q', text: 'Environment?', required: true },
        { id: 'other', text: 'Version?', required: true }
    ];
    const answers = { q: 'First line\n\nQuestion: literal answer text\nAnswer: still answer\nLast line' };
    d = api.appendAnswers(d, answers);
    const first = d;
    d = api.appendAnswers(d, answers);
    assert.equal(d.source, first.source);
    assert.equal(d.sourceRevision, first.sourceRevision);
    assert.equal(d.draftRevision, first.draftRevision);
    d = api.appendAnswers(d, { other: '1.0' });
    const followed = d;
    d = api.appendAnswers(d, answers);
    assert.equal(d.source, followed.source);
    assert.equal(d.sourceRevision, followed.sourceRevision);
    assert.equal(d.draftRevision, followed.draftRevision);
});
