define('_ujgKA_jiraApi', ['_ujgKA_transport'], function(contract) {
    'use strict';

    function createApi(config) {
        var transport = config.transport, select = contract.createScope(config.scopes), base = contract.sourceBase(config.baseUrl);
        function inScope(issue, scopes) { return issue && issue.fields && issue.fields.project && scopes.indexOf(issue.fields.project.key) !== -1; }
        function source(issue) {
            if (!issue || !/^[A-Za-z][A-Za-z0-9_]*-\d+$/.test(issue.key) || !issue.fields || typeof issue.fields.summary !== 'string') throw contract.failure('invalid-response');
            return { id: issue.key, kind: 'jira', title: issue.fields.summary, url: base + '/browse/' + issue.key,
                version: issue.fields.updated || null, updatedAt: issue.fields.updated || null, fetchedAt: new Date().toISOString() };
        }
        async function search(options) {
            options = options || {};
            var scopes = select(options.scopes), start = contract.offset(options.cursor);
            var query = 'project in (' + scopes.map(contract.quote).join(',') + ') AND text ~ ' + contract.quote(options.text) + ' ORDER BY key ASC';
            var raw = await transport.getJson('/rest/api/2/search', { jql: query, fields: 'summary,project,updated', startAt: start, maxResults: 20 }, { signal: options.signal });
            if (!Array.isArray(raw.issues)) throw contract.failure('invalid-response');
            if (raw.startAt != null && raw.startAt !== start || raw.total != null && (!Number.isSafeInteger(raw.total) || raw.total < 0)) throw contract.failure('invalid-response');
            var warnings = [], items = [];
            raw.issues.slice(0, 20).forEach(function(issue) {
                if (!inScope(issue, scopes)) { warnings.push('Результат вне выбранной области пропущен'); return; }
                items.push(source(issue));
            });
            var count = Math.min(raw.issues.length, 20), next = start + count;
            var knownTotal = Number.isSafeInteger(raw.total) && raw.total >= 0;
            var more = knownTotal ? next < raw.total : count === 20;
            if (!knownTotal) warnings.push('Сервер не сообщил общее число результатов');
            if (raw.issues.length > 20) warnings.push('Ответ ограничен 20 результатами');
            if (!count && more) { warnings.push('Пустая страница: полнота не подтверждена'); more = false; }
            return { items: items, nextCursor: more ? next : null, warnings: warnings };
        }
        async function read(options) {
            options = options || {};
            var scopes = select(), start = contract.offset(options.offset), id = String(options.id || '');
            if (!/^(?:[A-Za-z][A-Za-z0-9_]*-\d+|\d+)$/.test(id)) throw contract.failure('invalid-request');
            var raw = await transport.getJson('/rest/api/2/issue/' + id, { fields: 'summary,description,project,updated' }, { signal: options.signal });
            if (!raw || (raw.key !== id && String(raw.id) !== id) || !raw.fields || !raw.fields.project) throw contract.failure('invalid-response');
            if (!inScope(raw, scopes)) throw contract.failure('scope');
            var description = raw.fields.description;
            if (description != null && typeof description !== 'string') throw contract.failure('invalid-response');
            return contract.fragment(source(raw), description || '', start);
        }
        return { search: search, read: read };
    }
    return { createApi: createApi };
});
