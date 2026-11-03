define('_ujgKA_tools', ['_ujgKA_evidence'], function(contract) {
    'use strict';
    var descriptions = {
        search_confluence: 'Поиск страниц в выбранных пространствах. Сниппеты не являются прочитанными доказательствами.',
        read_page: 'Чтение страницы Confluence, до 8000 символов. Следуйте nextOffset и предупреждениям.',
        search_jira: 'Поиск задач в выбранных проектах. Следуйте nextCursor для продолжения.',
        read_issue: 'Чтение описания Jira, до 8000 символов. Следуйте nextOffset и предупреждениям.'
    };
    function error(code) {
        var messages = { 'invalid-request': 'Недопустимый запрос инструмента', 'invalid-response': 'Некорректный ответ источника', scope: 'Область поиска изменилась или пуста', aborted: 'Запрос отменён',
            forbidden: 'Доступ запрещён', unauthorized: 'Требуется авторизация', network: 'Ошибка сети', http: 'Ошибка чтения', 'rate-limit': 'Превышен лимит запросов', 'not-configured': 'Подключение не настроено' };
        return { code: code, message: messages[code], retryAfter: null };
    }
    function createTools(config) {
        // Factories must construct Task 1 adapters with this copied scope allowlist.
        if (!config || typeof config.confluence !== 'function' || typeof config.jira !== 'function' || typeof config.getScopes !== 'function' || !config.evidence) throw error('invalid-request');
        var lastScope = null, generation = 0;
        function snapshot() {
            var scopes = config.getScopes();
            if (!scopes || !Array.isArray(scopes.spaces) || !Array.isArray(scopes.projects) || scopes.spaces.concat(scopes.projects).some(function(s) { return typeof s !== 'string' || !s.trim(); })) {
                config.evidence.clear(); generation++; lastScope = null; throw error('scope');
            }
            var result = { spaces: scopes.spaces.slice().sort(), projects: scopes.projects.slice().sort() };
            var key = JSON.stringify(result);
            if (lastScope !== null && key !== lastScope) { config.evidence.clear(); generation++; }
            lastScope = key;
            return result;
        }
        var descriptors = Object.keys(descriptions).map(function(name) {
            var search = name.indexOf('search_') === 0;
            var properties = search ? { text: { type: 'string', minLength: 1 }, cursor: { type: 'integer', minimum: 0 } } :
                { id: { type: 'string', pattern: name === 'read_page' ? '^(confluence:)?[0-9]+$' : '^(jira:)?[A-Za-z][A-Za-z0-9_]*-[0-9]+$' }, offset: { type: 'integer', minimum: 0 } };
            return { name: name, description: descriptions[name], parameters: { type: 'object', properties: properties, required: [search ? 'text' : 'id'], additionalProperties: false } };
        });
        async function run(name, args, options) {
            var descriptor = descriptors.filter(function(d) { return d.name === name; })[0];
            if (!descriptor || !args || typeof args !== 'object' || Array.isArray(args)) throw error('invalid-request');
            var search = name.indexOf('search_') === 0, kind = name === 'search_confluence' || name === 'read_page' ? 'confluence' : 'jira';
            var position = search ? 'cursor' : 'offset';
            if (Object.keys(args).some(function(k) { return !Object.prototype.hasOwnProperty.call(descriptor.parameters.properties, k); }) ||
                args[position] !== undefined && (!Number.isSafeInteger(args[position]) || args[position] < 0) ||
                search && (typeof args.text !== 'string' || !args.text.trim())) throw error('invalid-request');
            var id;
            if (!search) { try { id = contract.canonicalId(kind, args.id); } catch (ignored) { throw error('invalid-request'); } }
            var signal = options && options.signal;
            function aborted() { if (signal && signal.aborted) throw error('aborted'); }
            aborted();
            var scopes = snapshot(), epoch = generation;
            var selected = kind === 'confluence' ? scopes.spaces : scopes.projects;
            if (!selected.length) throw error('scope');
            function current() { aborted(); snapshot(); if (epoch !== generation) throw error('scope'); }
            try {
                var api = config[kind](selected.slice());
                var result = await (search ? api.search({ text: args.text, cursor: args.cursor, scopes: selected.slice(), signal: signal }) :
                    api.read({ id: id.slice(kind.length + 1), offset: args.offset, signal: signal }));
                current();
                if (search) {
                    if (!result || !Array.isArray(result.items) || result.items.length > 20 || !Array.isArray(result.warnings) ||
                        result.warnings.some(function(w) { return typeof w !== 'string'; }) ||
                        result.nextCursor !== null && (!Number.isSafeInteger(result.nextCursor) || result.nextCursor <= (args.cursor || 0) || !result.items.length)) throw error('invalid-response');
                    var seen = Object.create(null);
                    var items = result.items.map(function(source) {
                        var sourceId = contract.validateSource(source);
                        if (source.kind !== kind || seen[sourceId] || source.excerpt !== undefined && typeof source.excerpt !== 'string') throw error('invalid-response');
                        seen[sourceId] = true;
                        return { id: sourceId, title: source.title, url: source.url, excerpt: source.excerpt || '' };
                    });
                    return { items: items, nextCursor: result.nextCursor, warnings: result.warnings.slice(), complete: result.nextCursor === null && result.warnings.length === 0 };
                }
                var read = Object.assign({}, result, { offset: args.offset || 0 });
                if (contract.validateRead(read) !== id) throw error('invalid-response');
                read.source = Object.assign({}, read.source, { id: id });
                var entry = config.evidence.put(read);
                return Object.assign({}, read, { complete: entry.complete, warnings: entry.warnings.slice() });
            } catch (failure) {
                current();
                var safe = error(failure && /^(forbidden|unauthorized|scope|aborted|network|http|rate-limit|not-configured|invalid-request|invalid-response)$/.test(failure.code) ? failure.code : 'invalid-response');
                if (failure && Number.isFinite(failure.retryAfter) && failure.retryAfter >= 0) safe.retryAfter = failure.retryAfter;
                if (!search) config.evidence.put({ sourceId: id, error: safe });
                throw safe;
            }
        }
        return { descriptors: descriptors, run: run };
    }
    return { createTools: createTools };
});
