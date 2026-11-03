define('_ujgKA_chat', ['_ujgKA_picoRuntime', '_ujgKA_skills'], function(picoRuntime, skills) {
    'use strict';
    var READ_TOOLS = ['search_confluence', 'read_page', 'search_jira', 'read_issue'];
    function copy(value) { return JSON.parse(JSON.stringify(value)); }
    function safeUrl(value) {
        return typeof value === 'string' && /^(?:https?:\/\/[^\s<>"']+|\/(?!\/)[^\s<>"']*)$/.test(value) && !/\\/.test(value);
    }
    function projectCitations(answer, evidence) {
        var warnings = [], sources = [];
        function warn(message) { if (warnings.indexOf(message) < 0) warnings.push(message); }
        // UI text is inert plain text. URLs are available ONLY through source cards.
        var text = String(answer || '').replace(/<(think|thinking|analysis)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi, '');
        text = text.replace(/\[\[([\s\S]*?)\]\]/g, function(all, token) {
            var match = /^(confluence:\d+|jira:[A-Za-z][A-Za-z0-9_]*-\d+)@(\d+):(\d+)$/.exec(token);
            var entry = match && evidence.get(match[1]), start = match && Number(match[2]), end = match && Number(match[3]);
            var covered = start;
            if (entry && Array.isArray(entry.ranges)) {
                entry.ranges.slice().sort(function(a, b) { return a.offset - b.offset; }).forEach(function(range) {
                    if (range.offset <= covered && range.offset + range.text.length > covered) covered = range.offset + range.text.length;
                });
            }
            if (!entry || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end <= start || end > entry.total || covered < end ||
                !entry.source || !safeUrl(entry.source.url) || entry.sourceId !== match[1]) {
                warn('Источник или диапазон не подтверждён чтением в текущем ходе.');
                return '[Источник не подтверждён]';
            }
            var entryWarnings = Array.isArray(entry.warnings) ? entry.warnings.slice() : [];
            entryWarnings.forEach(warn);
            if (!entry.complete && !entryWarnings.length) warn('Источник прочитан не полностью.');
            var key = match[1] + '@' + start + ':' + end;
            var index = sources.findIndex(function(s) { return s.key === key; });
            if (index < 0) {
                index = sources.length;
                sources.push({key: key, sourceId: match[1], offset: start, end: end, title: entry.source.title,
                    url: entry.source.url, version: entry.source.version, updatedAt: entry.source.updatedAt, fetchedAt: entry.source.fetchedAt,
                    complete: entry.complete === true, warnings: entryWarnings, confirmed: entryWarnings.length === 0});
            }
            return '[Источник ' + (index + 1) + ']';
        });
        // Reject dangling markers, arbitrary Markdown targets, HTML and bare URLs.
        text = text.replace(/\[\[[^\n]*/g, function() { warn('Некорректная ссылка на источник.'); return '[Источник не подтверждён]'; })
            .replace(/!?\[([^\]]*)\]\([^)]*\)/g, function(all, label) { warn('Ссылка модели не подтверждена.'); return label + ' [Ссылка не подтверждена]'; })
            .replace(/<[^>]*>/g, function() { warn('Разметка модели удалена.'); return ''; })
            .replace(/(?:https?:\/\/|javascript:|data:|www\.)[^\s<>]*/gi, function() { warn('Ссылка модели не подтверждена.'); return '[Ссылка не подтверждена]'; });
        if (!sources.length) warn('Нет подтверждённых чтением источников; факты не перепроверены.');
        return {answer: text, warnings: warnings, sources: sources};
    }
    function validateCitations(answer, evidence) {
        var result = projectCitations(answer, evidence);
        return {answer: result.answer, warnings: result.warnings};
    }
    function failureCode(event) {
        var reason = String(event && (event.reason || event.message) || '');
        if (/model call limit/i.test(reason)) return 'model-calls';
        if (/tool call limit/i.test(reason)) return 'tool-calls';
        if (/wall time limit/i.test(reason)) return 'elapsed';
        if (/context limit/i.test(reason)) return 'context';
        if (/reserve exceeded/i.test(reason)) return 'reserve';
        return event && event.type === 'limit' ? 'limit' : 'transport';
    }
    var safeMessages = { 'model-calls': 'Достигнут предел вызовов модели. Уточните вопрос.', 'tool-calls': 'Достигнут предел чтения источников. Уточните вопрос.',
        elapsed: 'Время ответа истекло. Попробуйте более узкий вопрос.', context: 'Текущий вопрос и источники не помещаются в контекст. Сократите вопрос или измените бюджет.',
        reserve: 'Ответ превышает резерв контекста. Уточните вопрос или измените бюджет.', limit: 'Достигнут предел хода. Уточните вопрос.',
        transport: 'Не удалось получить ответ. Проверьте подключение и повторите запрос.' };
    function createKnowledgeChat(options) {
        var runtime = options && options.runtime || picoRuntime;
        if (!options || typeof options.requestText !== 'function' || typeof options.getContext !== 'function' || !options.evidence ||
            !options.tools || !Array.isArray(options.tools.descriptors) || typeof options.tools.run !== 'function' || !runtime || typeof runtime.createSession !== 'function') throw new Error('Invalid knowledge chat options');
        options.tools.descriptors.forEach(function(d) { if (READ_TOOLS.indexOf(d.name) < 0) throw new Error('Knowledge tools must be read-only'); });
        var messages = [], active = null, dead = false, historyScope = null;
        function emit(event) {
            if (dead || typeof options.onEvent !== 'function') return;
            try { Promise.resolve(options.onEvent(copy(event))).catch(function() {}); } catch (ignored) { /* Observer cannot control a session. */ }
        }
        async function context() {
            var raw = await options.getContext();
            if (!raw || typeof raw.identityKey !== 'string' || !raw.identityKey.trim() || !raw.scopes ||
                !Array.isArray(raw.scopes.spaces) || !Array.isArray(raw.scopes.projects) ||
                raw.scopes.spaces.concat(raw.scopes.projects).some(function(s) { return typeof s !== 'string' || !s.trim(); })) throw new Error('Invalid knowledge context');
            var budget = raw.tokenBudget || options.tokenBudget || {context: 32768, reserve: 4096};
            // Allowlist: connection config, credentials and arbitrary host state never enter Pico.
            return {identityKey: raw.identityKey, scopes: {spaces: raw.scopes.spaces.slice().sort(), projects: raw.scopes.projects.slice().sort()},
                skill: skills.normalizeSkill(raw.skill), tokenBudget: {context: budget.context, reserve: budget.reserve}};
        }
        function scopeKey(ctx) { return JSON.stringify([ctx.identityKey, ctx.scopes]); }
        async function current(run) {
            if (dead || active !== run || run.cancelled) throw new Error('Stopped');
            var ctx = await context();
            if (dead || active !== run || run.cancelled) throw new Error('Stopped');
            if (scopeKey(ctx) !== run.scope) {
                run.stale = true; run.cancelled = true; messages = []; historyScope = null; options.evidence.clear();
                if (run.session) run.session.abort();
                throw new Error('Scope changed');
            }
            return ctx;
        }
        function publicEvent(run, event) {
            if (dead || active !== run || run.stale) return;
            if (event.type === 'assistant') {
                if (run.cancelled) return;
                var answer = projectCitations(event.text, options.evidence);
                run.answers.push(event.text);
                emit({type: 'assistant', text: answer.answer, warnings: answer.warnings, sources: answer.sources});
            } else if (event.type === 'error' || event.type === 'limit') {
                run.reason = failureCode(event); emit({type: event.type, code: run.reason, message: safeMessages[run.reason]});
            } else if (event.type === 'compaction') {
                emit({type: 'compaction', removedMessages: event.removedMessages, message: 'Старые ходы исключены из контекста; полная история сохранена. Источники нужно перечитать.'});
            } else if (event.type === 'tool' && event.phase !== 'update') {
                // Source documents, tool diagnostics and arguments are not chat text.
                emit({type: 'tool', phase: event.phase, name: event.name, toolCallId: event.toolCallId, isError: event.isError === true});
            }
            // done is emitted after prompt settlement, exactly once by the host.
        }
        function prompt(text) {
            if (dead) throw new Error('Knowledge chat disposed');
            if (active) throw new Error('Knowledge chat already running');
            if (typeof text !== 'string' || !text.trim()) throw new Error('Knowledge prompt required');
            var run = {session: null, cancelled: false, stale: false, deadline: false, answers: [], reason: null}; active = run;
            var started = Date.now(), wallMs = options.limits && options.limits.wallMs;
            wallMs = Number.isSafeInteger(wallMs) && wallMs > 0 ? Math.min(wallMs, 180000) : 180000;
            var stopped = new Promise(function(resolve) { run.stopReady = resolve; });
            var initialTimer = setTimeout(function() { run.deadline = true; run.stopReady(null); }, wallMs);
            options.evidence.clear();
            return (async function() {
                var result;
                try {
                    var ctx = await Promise.race([context(), stopped]);
                    clearTimeout(initialTimer);
                    if (run.cancelled || dead) return (result = {status: 'aborted', answer: '', warnings: [], sources: []});
                    if (run.deadline || Date.now() - started >= wallMs) {
                        run.reason = 'elapsed';
                        emit({type: 'limit', code: run.reason, message: safeMessages[run.reason]});
                        return (result = {status: 'limit', reason: run.reason, answer: '', warnings: [], sources: []});
                    }
                    run.scope = scopeKey(ctx);
                    if (historyScope !== run.scope) { messages = []; historyScope = run.scope; }
                    run.session = runtime.createSession({system: skills.SYSTEM_POLICY, messages: copy(messages), tokenBudget: ctx.tokenBudget,
                        limits: Object.assign({}, options.limits, {wallMs: Math.max(1, wallMs - (Date.now() - started))}), getContext: function() { return current(run); },
                        tools: options.tools.descriptors.map(function(d) {
                            return {name: d.name, description: d.description, parameters: copy(d.parameters), execute: async function(args, toolContext) {
                                await current(run);
                                var value = await options.tools.run(d.name, args, {signal: toolContext.signal});
                                await current(run); return value;
                            }};
                        }),
                        requestText: async function(request) {
                            await current(run);
                            var response = await options.requestText(request);
                            await current(run); return response;
                        }, onEvent: function(event) { publicEvent(run, event); }});
                    result = await run.session.prompt(text);
                    if (!run.stale && !dead) messages = copy(run.session.getMessages());
                    var finalAnswer = !run.stale && run.answers.length ? projectCitations(run.answers.join('\n\n'), options.evidence) : {answer: '', warnings: [], sources: []};
                    return {status: result.status, usage: copy(result.usage), answer: finalAnswer.answer, warnings: finalAnswer.warnings, sources: finalAnswer.sources,
                        ...(run.reason ? {reason: run.reason} : {})};
                } catch (ignored) {
                    run.reason = 'transport';
                    if (!dead && !run.cancelled) emit({type: 'error', code: run.reason, message: safeMessages[run.reason]});
                    return (result = {status: run.cancelled ? 'aborted' : 'error', reason: run.reason, answer: '', warnings: [], sources: []});
                } finally {
                    clearTimeout(initialTimer);
                    if (run.session) run.session.dispose();
                    active = null;
                    if (!dead) emit({type: 'done', status: run.stale || run.cancelled ? 'aborted' : result ? result.status : 'error', ...(result && result.usage ? {usage: copy(result.usage)} : {})});
                }
            })();
        }
        function abort() { if (active) { active.cancelled = true; active.stopReady(null); if (active.session) active.session.abort(); } }
        function dispose() { if (!dead) { abort(); dead = true; options.evidence.clear(); } }
        return {prompt: prompt, abort: abort, getMessages: function() { return copy(messages); }, dispose: dispose};
    }
    return {createKnowledgeChat: createKnowledgeChat, validateCitations: validateCitations};
});
