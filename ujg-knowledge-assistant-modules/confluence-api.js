define('_ujgKA_confluenceApi', ['_ujgKA_transport', '_ujgKA_evidence'], function(contract, evidence) {
    'use strict';

    function createApi(config) {
        var transport = config.transport, select = contract.createScope(config.scopes), base = contract.sourceBase(config.baseUrl);
        function inScope(page, scopes) { return page && page.space && scopes.indexOf(page.space.key) !== -1; }
        function source(page) {
            if (!page || !/^\d+$/.test(String(page.id)) || page.type !== 'page' || typeof page.title !== 'string') throw contract.failure('invalid-response');
            return { id: String(page.id), kind: 'confluence', title: page.title,
                url: base + '/pages/viewpage.action?pageId=' + page.id,
                version: page.version && page.version.number != null ? page.version.number : null,
                updatedAt: page.version && page.version.when || null, fetchedAt: new Date().toISOString() };
        }
        async function search(options) {
            options = options || {};
            var scopes = select(options.scopes), start = contract.offset(options.cursor);
            var query = 'space in (' + scopes.map(contract.quote).join(',') + ') AND text ~ ' + contract.quote(options.text) + ' AND type = page ORDER BY title ASC';
            var raw = await transport.getJson('/rest/api/content/search', { cql: query, expand: 'space,version', start: start, limit: 20 }, { signal: options.signal });
            if (!Array.isArray(raw.results)) throw contract.failure('invalid-response');
            if (raw.start != null && raw.start !== start || raw.totalSize != null && (!Number.isSafeInteger(raw.totalSize) || raw.totalSize < 0)) throw contract.failure('invalid-response');
            var warnings = [], items = [];
            raw.results.slice(0, 20).forEach(function(page) {
                if (!inScope(page, scopes)) { warnings.push('Результат вне выбранной области пропущен'); return; }
                items.push(source(page));
            });
            var count = Math.min(raw.results.length, 20), next = start + count, more;
            if (Number.isSafeInteger(raw.totalSize) && raw.totalSize >= 0) more = next < raw.totalSize;
            else {
                more = Boolean(raw._links && raw._links.next) || count === 20;
                warnings.push('Сервер не сообщил общее число результатов');
            }
            if (raw.results.length > 20) warnings.push('Ответ ограничен 20 результатами');
            if (!count && more) { warnings.push('Пустая страница: полнота не подтверждена'); more = false; }
            return { items: items, nextCursor: more ? next : null, warnings: warnings };
        }
        async function read(options) {
            options = options || {};
            var scopes = select(), start = contract.offset(options.offset), id = String(options.id || '');
            if (!/^\d+$/.test(id)) throw contract.failure('invalid-request');
            var raw = await transport.getJson('/rest/api/content/' + id, { expand: 'body.storage,version,space' }, { signal: options.signal });
            if (!raw || String(raw.id) !== id || !raw.space) throw contract.failure('invalid-response');
            if (!inScope(raw, scopes)) throw contract.failure('scope');
            if (!raw.body || !raw.body.storage || typeof raw.body.storage.value !== 'string') throw contract.failure('invalid-response');
            var extracted = evidence.extractStorage(raw.body.storage.value);
            return contract.fragment(source(raw), extracted.text, start, extracted.warnings);
        }
        return { search: search, read: read };
    }
    return { createApi: createApi };
});
