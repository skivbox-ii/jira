define('_ujgKA_transport', [], function() {
    'use strict';

    var messages = {
        'not-configured': 'Подключение не настроено',
        'invalid-request': 'Недопустимый запрос чтения',
        'invalid-response': 'Сервер не вернул ожидаемый JSON',
        unauthorized: 'Требуется авторизация', forbidden: 'Доступ запрещён',
        'rate-limit': 'Превышен лимит запросов', aborted: 'Запрос отменён',
        network: 'Не удалось выполнить запрос', http: 'Ошибка чтения сервера',
        scope: 'Источник вне разрешённой области'
    };
    function failure(code, retryAfter) {
        return { code: code, message: messages[code], retryAfter: retryAfter == null ? null : retryAfter };
    }
    function createTransport(config) {
        config = config || {};
        var mode = config.mode, base, invalid = false, verified = false, authGeneration = 0;
        var fetchImpl = config.fetchImpl || (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
        try {
            var raw = String(config.baseUrl || '');
            if (/[?#%\\]/.test(raw) || /(^|\/)\.{1,2}(\/|$)/.test(raw) || /^\/\//.test(raw)) throw failure('invalid-request');
            var origin = typeof location !== 'undefined' ? location.origin : null;
            if (mode === 'session') {
                if (!origin || raw && raw[0] !== '/' && !/^https?:\/\//.test(raw)) throw failure('invalid-request');
                base = new URL(raw || '/', origin);
                if (base.origin !== origin) throw failure('invalid-request');
            } else if (mode === 'bridge') {
                if (!raw) throw failure('not-configured');
                base = new URL(raw);
                var loopback = base.hostname === 'localhost' || base.hostname === '127.0.0.1' || base.hostname === '[::1]';
                if (base.protocol !== 'https:' && !(base.protocol === 'http:' && loopback)) throw failure('invalid-request');
            } else throw failure('invalid-request');
            if (base.username || base.password) throw failure('invalid-request');
        } catch (ignore) { invalid = true; }

        // Only requests from the current auth generation may change verification state.
        function invalidateAuth(generation) {
            if (mode === 'bridge' && generation === authGeneration) {
                verified = false;
                authGeneration += 1;
            }
        }

        async function getJson(path, query, options) {
            options = options || {}; query = query || {};
            if (invalid || !fetchImpl) throw failure(mode === 'bridge' ? 'not-configured' : 'invalid-request');
            if (options.method != null && options.method !== 'GET') throw failure('invalid-request');
            var allowed;
            if (mode === 'session') {
                if (path === '/rest/api/2/myself') allowed = [];
                else if (path === '/rest/api/2/search') allowed = ['jql', 'fields', 'startAt', 'maxResults'];
                else if (/^\/rest\/api\/2\/issue\/(?:[A-Za-z][A-Za-z0-9_]*-\d+|\d+)$/.test(path)) allowed = ['fields'];
            } else {
                if (path === '/rest/api/user/current') allowed = [];
                else if (path === '/rest/api/content/search') allowed = ['cql', 'expand', 'start', 'limit'];
                else if (/^\/rest\/api\/content\/\d+$/.test(path)) allowed = ['expand'];
            }
            if (!allowed || Object.keys(query).some(function(k) { return allowed.indexOf(k) === -1 || !['string', 'number'].includes(typeof query[k]); })) throw failure('invalid-request');
            var signal = options.signal;
            if (signal && signal.aborted) throw failure('aborted');
            var generation = authGeneration;
            function checkCurrent() {
                if (signal && signal.aborted) throw failure('aborted');
                if (mode === 'bridge' && generation !== authGeneration) throw failure('not-configured');
            }
            var headers = { Accept: 'application/json' };
            if (mode === 'bridge') {
                if (path !== '/rest/api/user/current' && !verified) throw failure('not-configured');
                if (path === '/rest/api/user/current') {
                    invalidateAuth(generation);
                    generation = authGeneration;
                }
                var token;
                try { token = typeof config.getToken === 'function' ? config.getToken() : ''; } catch (ignore) { invalidateAuth(generation); throw failure('not-configured'); }
                if (typeof token !== 'string' || !token.trim() || /[\r\n]/.test(token)) { invalidateAuth(generation); throw failure('not-configured'); }
                headers.Authorization = 'Bearer ' + token;
                // Never store the token in transport state or attach it to returned errors.
                token = null;
            }
            checkCurrent();
            var url = new URL(base.href.replace(/\/+$/, '') + path);
            Object.keys(query).forEach(function(k) { url.searchParams.set(k, String(query[k])); });
            var resp;
            try {
                resp = await fetchImpl(url.href, { method: 'GET', headers: headers, credentials: mode === 'bridge' ? 'omit' : 'same-origin', redirect: 'error', signal: signal });
            } catch (error) {
                if (signal && signal.aborted || error && error.name === 'AbortError') throw failure('aborted');
                checkCurrent();
                throw failure('network');
            }
            checkCurrent();
            if (!resp || resp.redirected) throw failure('invalid-response');
            if (!resp.ok) {
                if (resp.status === 401 || resp.status === 403) invalidateAuth(generation);
                var retry = null;
                if (resp.status === 429) {
                    var value = resp.headers && resp.headers.get('Retry-After');
                    if (value && /^\d+$/.test(value)) retry = Number(value);
                    else if (value && !isNaN(Date.parse(value))) retry = Math.max(0, Math.ceil((Date.parse(value) - Date.now()) / 1000));
                    if (!Number.isFinite(retry)) retry = null;
                }
                throw failure(({ 401: 'unauthorized', 403: 'forbidden', 429: 'rate-limit' })[resp.status] || 'http', retry);
            }
            var type = resp.headers && resp.headers.get('Content-Type');
            if (!type || !/^application\/(?:[\w.-]+\+)?json(?:\s*;|$)/i.test(type)) throw failure('invalid-response');
            var data;
            try { data = await resp.json(); }
            catch (ignore) { checkCurrent(); throw failure('invalid-response'); }
            checkCurrent();
            if (!data || typeof data !== 'object' || Array.isArray(data)) throw failure('invalid-response');
            if (mode === 'bridge' && path === '/rest/api/user/current') {
                if (data.type !== 'known' || ![data.userKey, data.username, data.accountId].some(function(id) { return typeof id === 'string' && id.trim(); })) throw failure('not-configured');
                verified = true;
            }
            return data;
        }
        return { getJson: getJson };
    }

    // Shared read-contract helpers keep both adapters fail-closed in the same way.
    function createScope(scopes) {
        var allowed = Array.isArray(scopes) ? scopes.filter(function(s) { return typeof s === 'string' && s.trim() && !/[\x00-\x1f]/.test(s); }).slice() : [];
        return function(requested) {
            var selected = requested == null ? allowed.slice() : Array.isArray(requested) ? requested.slice() : [];
            if (!selected.length || selected.some(function(s) { return allowed.indexOf(s) === -1; })) throw failure('scope');
            return selected.filter(function(s, i) { return selected.indexOf(s) === i; });
        };
    }
    function offset(value) {
        if (value == null) return 0;
        if (!Number.isSafeInteger(value) || value < 0) throw failure('invalid-request');
        return value;
    }
    function quote(value) {
        return '"' + String(value == null ? '' : value).replace(/[\x00-\x1f]/g, ' ').replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
    }
    function fragment(source, text, start, warnings) {
        return { source: source, text: text.slice(start, start + 8000), total: text.length, nextOffset: start + 8000 < text.length ? start + 8000 : null, warnings: warnings || [] };
    }
    function sourceBase(value) {
        var raw = String(value || '').replace(/\/+$/, '');
        if (!raw) return '';
        try {
            var parsed = new URL(raw, typeof location !== 'undefined' ? location.origin : undefined);
            if (!/^https?:$/.test(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) throw failure('invalid-request');
            return parsed.href.replace(/\/+$/, '');
        } catch (ignore) { throw failure('invalid-request'); }
    }
    return { createTransport: createTransport, failure: failure, createScope: createScope, offset: offset, quote: quote, fragment: fragment, sourceBase: sourceBase };
});
