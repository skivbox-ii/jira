define('_ujgKA_evidence', [], function() {
    'use strict';

    function fail() { throw { code: 'invalid-response', message: 'Некорректные данные источника', retryAfter: null }; }
    function copy(value) { return JSON.parse(JSON.stringify(value)); }
    function canonicalId(kind, id) {
        if (kind !== 'confluence' && kind !== 'jira' || typeof id !== 'string') return fail();
        var raw = id.indexOf(kind + ':') === 0 ? id.slice(kind.length + 1) : id;
        if (!(kind === 'confluence' ? /^\d+$/ : /^[A-Za-z][A-Za-z0-9_]*-\d+$/).test(raw)) return fail();
        return kind + ':' + raw;
    }
    function validateSource(source) {
        if (!source || typeof source.title !== 'string' || typeof source.url !== 'string' ||
            !/^(?:https?:\/\/[^\s<>"']+|\/(?!\/)[^\s<>"']*)$/.test(source.url) || /\\/.test(source.url) ||
            !(source.version === null || typeof source.version === 'string' || Number.isSafeInteger(source.version)) ||
            !(source.updatedAt === null || typeof source.updatedAt === 'string') || typeof source.fetchedAt !== 'string') return fail();
        return canonicalId(source.kind, source.id);
    }
    function validateRead(result) {
        if (!result || typeof result.text !== 'string' || result.text.length > 8000 ||
            !Number.isSafeInteger(result.offset) || result.offset < 0 || !Number.isSafeInteger(result.total) || result.total < result.offset ||
            result.offset + result.text.length > result.total || !Array.isArray(result.warnings) ||
            result.warnings.some(function(w) { return typeof w !== 'string'; })) return fail();
        var end = result.offset + result.text.length;
        if (end < result.total ? !result.text.length || result.nextOffset !== end : result.nextOffset !== null) return fail();
        return validateSource(result.source);
    }
    function createEvidenceStore(config) {
        if (!config || typeof config.identityKey !== 'string' || !config.identityKey.trim()) return fail();
        var entries = Object.create(null);
        function get(id) { return entries[id] ? copy(entries[id]) : null; }
        function put(result) {
            if (result && result.error) {
                var previous = entries[result.sourceId];
                if (previous) {
                    var code = /^(forbidden|unauthorized|scope|aborted|network|http|rate-limit|not-configured|invalid-response)$/.test(result.error.code) ? result.error.code : 'invalid-response';
                    previous.complete = false;
                    var warning = 'Не удалось прочитать фрагмент: ' + code;
                    if (previous.warnings.indexOf(warning) < 0) previous.warnings.push(warning);
                }
                return get(result.sourceId);
            }
            var id = validateRead(result), old = entries[id], revision = result.source.version;
            var revisionChanged = old && (revision == null || old.source.version !== revision || old.source.updatedAt !== result.source.updatedAt);
            var warnings = result.warnings.slice();
            if (revisionChanged) warnings.push('Версия изменилась или неизвестна; прежние диапазоны удалены');
            if (!old || revisionChanged) old = { sourceId: id, source: copy(result.source), total: result.total, ranges: [], warnings: [], complete: false };
            if (old.total !== result.total) { old.complete = false; old.warnings.push('Конфликт длины одной версии'); entries[id] = old; return fail(); }
            var end = result.offset + result.text.length;
            old.ranges.forEach(function(range) {
                var start = Math.max(range.offset, result.offset), stop = Math.min(range.offset + range.text.length, end);
                if (start < stop && range.text.slice(start - range.offset, stop - range.offset) !== result.text.slice(start - result.offset, stop - result.offset)) {
                    old.complete = false; old.warnings.push('Конфликт текста одной версии'); entries[id] = old; fail();
                }
            });
            old.source = copy(result.source);
            old.ranges = old.ranges.filter(function(r) { return r.offset !== result.offset; });
            old.ranges.push({ offset: result.offset, text: result.text, nextOffset: result.nextOffset, warnings: result.warnings.slice() });
            old.ranges.sort(function(a, b) { return a.offset - b.offset; });
            warnings.forEach(function(w) { if (old.warnings.indexOf(w) < 0) old.warnings.push(w); });
            var covered = 0;
            old.ranges.forEach(function(r) { if (r.offset <= covered) covered = Math.max(covered, r.offset + r.text.length); });
            old.complete = covered === old.total && old.warnings.length === 0;
            entries[id] = old;
            return get(id);
        }
        return { put: put, get: get, clear: function() { entries = Object.create(null); } };
    }
    function decode(text) {
        var entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
        return text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, function(all, entity) {
            var lower = entity.toLowerCase();
            if (lower[0] !== '#') return entities[lower];
            var n = lower[1] === 'x' ? parseInt(lower.slice(2), 16) : parseInt(lower.slice(1), 10);
            return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : '\ufffd';
        });
    }
    // Tokenize inert storage markup only. Never insert HTML into a document or evaluate it.
    function extractStorage(html) {
        if (typeof html !== 'string') return fail();
        var tokens = html.match(/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\/?[A-Za-z][\w:.-]*(?:\s+(?:[^<>"']|"[^"]*"|'[^']*')*)?\s*\/?>|[^<]+|</g) || [];
        var output = '', blocked = [], warnings = [], cell = 0, inCell = false;
        function warn(message) { if (warnings.indexOf(message) < 0) warnings.push(message); }
        tokens.forEach(function(token) {
            if (token.slice(0, 4) === '<!--') return;
            var tag = /^<(\/)?([\w:.-]+)/.exec(token), name = tag && tag[2].toLowerCase(), closing = tag && !!tag[1];
            if (blocked.length) {
                if (tag && !closing && name === blocked[blocked.length - 1] && !/\/>$/.test(token)) blocked.push(name);
                else if (tag && closing && name === blocked[blocked.length - 1]) blocked.pop();
                return;
            }
            if (tag && /^(script|style|iframe|object|embed|svg|math|template|noscript|ac:parameter)$/.test(name)) {
                if (!closing && !/\/>$/.test(token) && name !== 'embed') blocked.push(name);
                return;
            }
            if (tag) {
                if (name === 'ac:structured-macro' || name === 'ac:macro') {
                    if (!closing) { warn('Неподдерживаемый макрос: содержимое неполно'); output += '\n[Неподдерживаемый макрос]\n'; }
                } else if (name === 'li' && !closing) output += (output.endsWith('\n') ? '' : '\n') + '- ';
                else if (name === 'tr' && !closing) { output = output.replace(/ +$/, ''); if (!output.endsWith('\n')) output += '\n'; cell = 0; }
                else if (name === 'td' || name === 'th') {
                    if (!closing) {
                        if (/\s(?:rowspan|colspan)\s*=/i.test(token)) warn('Неподдерживаемые rowspan/colspan: позиции ячеек таблицы неполны');
                        if (cell++) output += '\t';
                        inCell = true;
                    }
                    else { output = output.replace(/ +$/, ''); inCell = false; }
                }
                else if (name === 'br' || closing && /^(p|div|li|h[1-6]|tr|ul|ol|table|pre)$/.test(name)) output += inCell ? ' ' : '\n';
                else if (!closing && /^(ac:|ri:)/.test(name) && !/^(ac:rich-text-body|ac:plain-text-body)$/.test(name)) warn('Неподдерживаемый блок: содержимое неполно');
                return;
            }
            if (token.slice(0, 9) === '<![CDATA[') output += token.slice(9, -3);
            else if (token === '<') warn('Некорректная разметка: содержимое неполно');
            else output += decode(token).replace(/[\r\n\t ]+/g, ' ');
        });
        if (blocked.length) warn('Незакрытый блок: содержимое неполно');
        // Keep boundary tabs: they represent empty leading/trailing table cells.
        return { text: output.replace(/ *\t */g, '\t').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').replace(/^[ \r\n]+|[ \r\n]+$/g, ''), warnings: warnings };
    }
    return { createEvidenceStore: createEvidenceStore, canonicalId: canonicalId, validateSource: validateSource, validateRead: validateRead, extractStorage: extractStorage };
});
