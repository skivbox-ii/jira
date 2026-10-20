define('_ujgTA_controller', ['_ujgTA_draft', '_ujgTA_profiles', '_ujgTA_fields', '_ujgTA_validation', '_ujgTA_creator'], function(drafts, profiles, fields, validation, creators) {
    'use strict';

    var messages = {
        input: 'Проверьте выбранный проект, тип, шаблон и область полей.',
        identity: 'Пользователь недоступен. Используется временное хранилище в памяти.',
        conflict: 'Черновик изменён в другой вкладке. Текущий ввод сохранён в памяти; разрешите конфликт перед сохранением.',
        storage: 'Не удалось сохранить данные. Текущий ввод сохранён в памяти.',
        limit: 'Приблизительная оценка контекста превышает локальный бюджет. Откройте настройки бюджета или явно сократите контекст.',
        safety: 'Контекст превышает защитный предел размера передачи 4 МиБ. Сократите контекст явно.',
        secret: 'Контекст содержит возможные секреты. Удалите их перед отправкой.',
        config: 'Проверьте настройки подключения AI.',
        response: 'AI вернул ответ вне контракта. Проверьте данные вручную.',
        transport: 'Не удалось получить ответ AI. Повторите действие вручную.',
        metadata: 'Не удалось обновить metadata Jira. Повторите действие вручную.',
        network: 'Не удалось получить данные Jira. Повторите действие вручную.'
    };
    function copy(value) { return JSON.parse(JSON.stringify(value)); }
    var responseReasons = {
        json: 'Ответ не является допустимым JSON. Повторите подготовку вручную или заполните поля.',
        contract: 'Неверная структура ответа JSONv1. Повторите действие вручную.',
        questions: 'Неверный формат уточняющих вопросов. Повторите действие вручную.',
        warnings: 'Неверный формат предупреждений. Повторите действие вручную.',
        evidence: 'Неверный формат или неподтверждённая цитата в обосновании. Проверьте исходник и повторите действие вручную.',
        selection: 'Ответ изменяет выбранный тип или шаблон либо содержит недопустимый выбор. Проверьте выбор и повторите действие вручную.',
        scope: 'Ответ содержит поле вне разрешённой области. Проверьте область генерации и повторите действие вручную.',
        shape: 'Неверный формат значения поля. Выберите значение вручную или повторите подготовку.',
        value: 'Значение поля не прошло проверку metadata или каталога. Обновите поля и выберите значение вручную.'
    };
    function errorState(error, fallback, meta, typeId) {
        var code = error && Object.prototype.hasOwnProperty.call(messages, error.code) ? error.code : fallback;
        var result = { code: code, message: messages[code] };
        if (code === 'response' && error && error.details && typeof error.details.reason === 'string' && Object.prototype.hasOwnProperty.call(responseReasons, error.details.reason)) {
            var reason = error.details.reason, fieldId = error.details.fieldId;
            result.details = {reason: reason};
            result.message += ' ' + responseReasons[reason];
            if (typeof fieldId === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(fieldId) && meta && fields.getField(meta, typeId, fieldId)) {
                result.details.fieldId = fieldId;
                result.message += ' Поле: ' + fieldId + '.';
            }
        }
        if (code === 'limit' && error && error.details) {
            var keys = ['instructions', 'source', 'metadata', 'input', 'context', 'reserve', 'available'];
            if (keys.every(function(k) { return Number.isSafeInteger(error.details[k]) && error.details[k] >= 0; })) {
                result.details = {};
                keys.forEach(function(k) { result.details[k] = error.details[k]; });
            }
        }
        return result;
    }

    function create(options) {
        var api = options.api, ai = options.ai, store = null, scopes = Object.create(null);
        var active = null, destroyed = false, identityWarning = null;
        var state = { draft: null, settings: null, meta: null, projects: [], stage: 'idle', startedAt: null,
            error: null, validation: null, routeCandidates: [], generationFieldIds: [], contextScope: null };
        var explicitGeneration = null;
        var creator = null, runtimeFiles = new Map(), fileSequence = 0;
        var budgetCache = null, providerUsage = null;
        function locked() {return state.draft && (state.draft.creation.issueKey || ['submitting','unknown','created'].indexOf(state.draft.creation.status) !== -1);}
        function durableGuard() {
            if (!store || !state.draft) return false;
            var saved = store.load(state.draft.projectKey), d = saved.draft;
            var guarded = d && (d.creation.issueKey || ['submitting','unknown','created'].indexOf(d.creation.status) !== -1);
            if (guarded && (d.id !== state.draft.id || JSON.stringify(d.creation) !== JSON.stringify(state.draft.creation))) {
                state.error = errorState(null,'conflict');scopes[state.draft.projectKey].error=state.error;return true;
            }
            return false;
        }

        function getState() {
            var result = Object.assign({}, state);
            result.tokenPreflight = null;
            if (state.draft && state.meta && state.settings && typeof ai.preflight === 'function') {
                if (!budgetCache || budgetCache.draft!==state.draft || budgetCache.meta!==state.meta ||
                    budgetCache.settings!==state.settings || budgetCache.generation!==state.generationFieldIds) {
                    var estimate=null;
                    try {estimate=ai.preflight(state.draft.issueTypeId && state.draft.templateId ? 'prepare' : 'route', input());} catch (ignored) { /* Selection may still be incomplete. */ }
                    budgetCache={draft:state.draft,meta:state.meta,settings:state.settings,generation:state.generationFieldIds,value:estimate};
                }
                result.tokenPreflight=budgetCache.value;
            }
            result.providerUsage=providerUsage;
            result.draft = state.draft ? JSON.parse(drafts.serialize(state.draft)) : null;
            if (result.draft) result.draft.attachments.forEach(function(a) {a.needsReselect = a.status !== 'uploaded' && !runtimeFiles.has(a.id);});
            return copy(result);
        }
        function emit() {
            var entry = state.draft && scopes[state.draft.projectKey];
            if (entry && entry.error && entry.error.code === 'conflict') state.error = entry.error;
            if (!destroyed && typeof options.onChange === 'function') options.onChange(getState());
            return getState();
        }
        function stop() {
            var previous = active;
            active = null;
            if (previous) previous.abort.abort();
            state.startedAt = null;
        }
        function begin(kind) {
            stop();
            var run = { kind: kind, abort: new AbortController(), promise: null };
            active = run;
            state.error = identityWarning;
            return run;
        }
        function current(run, snapshot) {
            return !destroyed && active === run && !run.abort.signal.aborted &&
                (!snapshot || (state.draft && drafts.isCurrent(state.draft, snapshot)));
        }
        function stage(run, value) {
            if (!current(run)) return;
            state.stage = value;
            state.startedAt = (options.now || Date.now)();
            emit();
        }
        function finish(run) {
            if (!current(run)) return;
            active = null;
            state.stage = 'idle'; state.startedAt = null;
            emit();
        }
        function fail(run, error, fallback) {
            if (!current(run)) return;
            active = null; state.startedAt = null;
            if (error && (error.code === 'abort' || error.kind === 'abort' || error.name === 'AbortError')) state.stage = 'stopped';
            else { state.stage = 'error'; state.error = errorState(error, fallback, state.meta, state.draft && state.draft.issueTypeId); }
            emit();
        }
        function profile() {
            return state.settings && state.settings.profiles.find(function(p) { return p.id === state.settings.activeProfileId; });
        }
        function eligible() {
            var ids = [];
            if (state.meta) state.meta.issueTypes.forEach(function(type) {
                if (type.subtask || (state.draft.issueTypeId && type.id !== state.draft.issueTypeId)) return;
                var templates = profile() ? profile().templates : [];
                if (!templates.some(function(t) {
                    return (!state.draft.templateId || t.id === state.draft.templateId) && (t.issueTypeId === null || t.issueTypeId === type.id);
                })) return;
                type.fields.forEach(function(f) {
                    if (f.supported && f.writable && f.kind !== 'user' && ['project', 'issuetype'].indexOf(f.id) === -1 && ids.indexOf(f.id) === -1) ids.push(f.id);
                });
            });
            return ids;
        }
        function updateScope() {
            var available = eligible();
            state.generationFieldIds = explicitGeneration === null ? available : explicitGeneration.slice();
            state.contextScope = {
                explicit: explicitGeneration !== null, issueTypeId: state.draft && state.draft.issueTypeId,
                templateId: state.draft && state.draft.templateId, generationFieldIds: state.generationFieldIds.slice(),
                excludedFieldIds: available.filter(function(id) { return state.generationFieldIds.indexOf(id) === -1; }),
                currentValuesRetained: true, userValuesExcluded: true
            };
        }
        function remember() {
            if (!state.draft) return;
            var entry = scopes[state.draft.projectKey];
            entry.draft = state.draft; entry.settings = state.settings; entry.meta = state.meta;
            entry.generation = explicitGeneration;
        }
        function save() {
            if (!store || !state.draft) return;
            remember();
            if (locked()) return;
            var entry = scopes[state.draft.projectKey];
            try {
                var result = store.save(state.draft.projectKey, { draft: state.draft, settings: state.settings }, entry.revision);
                if (!result.ok) {
                    entry.error = errorState(null, result.reason === 'conflict' || result.reason === 'creation-guard' ? 'conflict' : 'storage');
                    state.error = entry.error;
                    return;
                }
                entry.revision = result.revision; entry.error = null;
            } catch (error) { entry.error = errorState(null, 'storage'); state.error = entry.error; }
        }
        function edited(next) {
            if (locked() || durableGuard()) return emit();
            if (next.creation.status === 'preflight') next = Object.assign({},next,{creation:{status:'idle',attemptId:null,issueKey:null,error:null}});
            stop(); state.draft = next; state.validation = null; state.routeCandidates = [];
            providerUsage=null;
            state.stage = 'idle'; state.error = identityWarning;
            updateScope(); save(); return emit();
        }
        function policy() {
            var p = profile();
            return { allowAssignee: !!p && p.allowAssignee === true, explicitUserFields: Object.keys(state.draft.protectedFields).filter(function(id) {
                var field = fields.getField(state.meta, state.draft.issueTypeId, id);
                return state.draft.protectedFields[id] === true && field && field.kind === 'user';
            }) };
        }
        function input() {
            return copy({ source: state.draft.source, meta: state.meta, profile: profile(), issueTypeId: state.draft.issueTypeId,
                templateId: state.draft.templateId, allowFieldIds: state.generationFieldIds, tokenBudget:state.settings.tokenBudget,
                draft: { fields: state.draft.fields }, explicitUserFields: policy().explicitUserFields });
        }
        function compatible(typeId, templateId) {
            var type = state.meta && state.meta.issueTypes.find(function(t) { return t.id === typeId && !t.subtask; });
            var template = profile() && profile().templates.find(function(t) { return t.id === templateId; });
            return !!type && !!template && (template.issueTypeId === null || template.issueTypeId === typeId);
        }
        async function metadata(run, readOnly) {
            var snapshot = drafts.snapshot(state.draft), key = state.draft.projectKey;
            stage(run, 'metadata');
            if (!current(run, snapshot)) return false;
            var request = { signal: run.abort.signal };
            // Keep the full project type catalog available for subsequent explicit selections.
            var raw = await api.getCreateMeta(key, null, request);
            if (!current(run, snapshot)) return false;
            var components = await api.getComponents(key, request);
            if (!current(run, snapshot)) return false;
            var versions = await api.getVersions(key, request);
            if (!current(run, snapshot)) return false;
            state.meta = fields.normalizeMeta(raw, key, { components: components, versions: versions });
            if (!readOnly) state.draft = drafts.setSelection(state.draft, { metaSignature: state.meta.signature });
            state.validation = null; updateScope();
            if (readOnly) remember(); else save();
            return true;
        }

        async function init() {
            if (destroyed) return getState();
            var run = begin('init');
            if (creator) creator.destroy();creator=null;runtimeFiles=new Map();
            store = null; scopes = Object.create(null); explicitGeneration = null; identityWarning = null;
            budgetCache=null;providerUsage=null;
            state = { draft: null, settings: null, meta: null, projects: [], stage: 'idle', startedAt: null,
                error: null, validation: null, routeCandidates: [], generationFieldIds: [], contextScope: null };
            emit();
            try {
                var user = null;
                try { user = await api.getCurrentUser({ signal: run.abort.signal }); } catch (error) { /* No identity means no persistent scope. */ }
                if (!current(run)) return getState();
                var key = user && (typeof user.key === 'string' && user.key.trim() ? user.key : typeof user.name === 'string' && user.name.trim() ? user.name : null);
                if (!key) { key = null; identityWarning = errorState(null, 'identity'); state.error = identityWarning; }
                store = options.createStore(key);
                creator = creators.create({api:api,store:store,now:options.now});
                var projects = await api.getProjects({ signal: run.abort.signal });
                if (!current(run)) return getState();
                state.projects = projects.values.map(function(p) { return { id: String(p.id), key: String(p.key), name: String(p.name || p.key) }; });
                finish(run);
            } catch (error) { fail(run, error, 'network'); }
            return getState();
        }
        async function selectProject(key) {
            if (destroyed) return getState();
            if (!store || !state.projects.some(function(p) { return p.key === key; })) {
                state.error = errorState(null, 'input'); return emit();
            }
            var run = begin('project');
            save();
            try {
                var entry = scopes[key];
                if (!entry) {
                    var loaded = store.load(key);
                    entry = scopes[key] = { revision: loaded.revision, settings: loaded.settings,
                        draft: loaded.draft ? drafts.restore(loaded.draft) : drafts.createDraft({ projectKey: key }), meta: null, generation: null, error: null };
                    if (entry.draft.projectKey !== key) entry.draft = drafts.createDraft({ projectKey: key });
                }
                state.draft = drafts.setSelection(entry.draft, { settingsRevision: entry.settings.revision });
                state.settings = entry.settings; state.meta = entry.meta; explicitGeneration = entry.generation;
                providerUsage=null;
                state.validation = null; state.routeCandidates = []; state.error = entry.error || identityWarning;
                updateScope();
                if (await metadata(run, !!locked())) finish(run);
            } catch (error) { fail(run, error, 'metadata'); }
            return getState();
        }
        async function selectIssueType(id) {
            if (destroyed || !state.draft) return getState();
            if (id !== null && !(state.meta && state.meta.issueTypes.some(function(t) { return t.id === id && !t.subtask; }))) {
                state.error = errorState(null, 'input'); return emit();
            }
            return edited(drafts.setSelection(state.draft, { issueTypeId: id }));
        }
        async function selectTemplate(id) {
            if (destroyed || !state.draft) return getState();
            if (id !== null && !profile().templates.some(function(t) { return t.id === id; })) {
                state.error = errorState(null, 'input'); return emit();
            }
            return edited(drafts.setSelection(state.draft, { templateId: id }));
        }
        async function mutate(method, args) {
            if (destroyed || !state.draft) return getState();
            try { return edited(method.apply(null, [state.draft].concat(args))); }
            catch (error) { state.error = errorState(null, 'input'); return emit(); }
        }
        async function applySettings(settings) {
            if (destroyed || !state.draft || locked()) return getState();
            if (durableGuard()) return emit();
            var checked = profiles.validateSettings(settings);
            if (!checked.ok || state.settings.revision === Number.MAX_SAFE_INTEGER) { state.error = errorState(null, 'input'); return emit(); }
            checked.value.revision = state.settings.revision + 1;
            return installSettings(checked.value);
        }
        function settingsSelection(settings) {
            var changedProfile = state.settings.activeProfileId !== settings.activeProfileId;
            var p = settings.profiles.find(function(p) {return p.id === settings.activeProfileId;});
            var selected = p.templates.find(function(t) {return t.id === state.draft.templateId;});
            var selection = {settingsRevision:settings.revision};
            if (changedProfile || !selected) selection.templateId = null;
            if (state.draft.issueTypeId && (!state.meta || !state.meta.issueTypes.some(function(t) {return t.id === state.draft.issueTypeId && !t.subtask;}) ||
                selected && selected.issueTypeId !== null && selected.issueTypeId !== state.draft.issueTypeId)) selection.issueTypeId = null;
            return selection;
        }
        function installSettings(settings) {
            var selection=settingsSelection(settings), previous=state.settings.tokenBudget;
            if (previous.context!==settings.tokenBudget.context || previous.reserve!==settings.tokenBudget.reserve) invalidateCachedChecks();
            state.settings=settings;
            return edited(drafts.setSelection(state.draft, selection));
        }
        async function loadSavedSettings() {
            if (destroyed || !state.draft || !store) return getState();
            if (locked()) return getState();if (durableGuard()) return emit();
            try {
                var saved = store.load(state.draft.projectKey);
                // Loading rules never replaces or persists this tab's draft, nor acknowledges the CAS conflict.
                stop();var selection=settingsSelection(saved.settings), previous=state.settings.tokenBudget;
                if (previous.context!==saved.settings.tokenBudget.context || previous.reserve!==saved.settings.tokenBudget.reserve) invalidateCachedChecks();
                state.settings = saved.settings;providerUsage=null;
                state.draft = drafts.setSelection(state.draft, selection);
                state.draft = Object.assign({},state.draft,{checked:null});
                state.validation = null; state.routeCandidates = [];state.stage='idle';updateScope();remember();
            } catch (error) {state.error=errorState(null,'storage');}
            return emit();
        }
        async function resolveSettingsConflict(settings) {
            if (destroyed || !state.draft || !store) return getState();
            if (locked()) return getState();if (durableGuard()) return emit();
            var checked = profiles.validateSettings(settings);
            if (!checked.ok) {state.error=errorState(null,'input');return emit();}
            try {
                var saved=store.load(state.draft.projectKey), revision=Math.max(saved.settings.revision,state.settings.revision);
                if(revision===Number.MAX_SAFE_INTEGER) {state.error=errorState(null,'input');return emit();}
                checked.value.revision=revision+1;
                var entry=scopes[state.draft.projectKey];entry.revision=saved.revision;entry.error=null;
                return installSettings(checked.value);
            } catch(error) {state.error=errorState(null,'storage');return emit();}
        }
        async function discardField(id) {
            if (destroyed || !state.draft || locked() || durableGuard()) return getState();
            var spec=fields.getField(state.meta,state.draft.issueTypeId,id);
            var obsolete=!spec || !spec.supported || !spec.writable;
            var unavailable=spec && !spec.required && fields.catalogUnavailable(spec);
            if (!(id==='assignee' && !policy().allowAssignee) && !obsolete && !unavailable) return getState();
            if (!Object.prototype.hasOwnProperty.call(state.draft.fields,id) && !Object.prototype.hasOwnProperty.call(state.draft.pendingFields,id)) return getState();
            var recovered=state.draft;
            if (id!=='assignee' || obsolete || unavailable) {
                var previous=spec;
                (state.meta && state.meta.issueTypes || []).some(function(type) {previous=previous || type.fields.find(function(field) {return field.id===id;});return !!previous;});
                var value=Object.prototype.hasOwnProperty.call(recovered.fields,id) ? recovered.fields[id] : recovered.pendingFields[id];
                var text=typeof value==='string' ? value : JSON.stringify(value);
                if (Object.prototype.hasOwnProperty.call(recovered.pendingFields,id) && JSON.stringify(value)!==JSON.stringify(recovered.pendingFields[id]))
                    text+='\nПредлагалось: '+JSON.stringify(recovered.pendingFields[id]);
                recovered=drafts.setSource(recovered,recovered.source+'\n\nСохранённое поле '+(previous ? previous.name : id)+' ('+id+'):\n'+text);
            }
            var next=Object.assign({},recovered,{fields:Object.assign({},recovered.fields),protectedFields:Object.assign({},recovered.protectedFields),pendingFields:Object.assign({},recovered.pendingFields),
                draftRevision:recovered.draftRevision+1,checked:null});
            delete next.fields[id];delete next.protectedFields[id];delete next.pendingFields[id];
            return edited(next);
        }
        async function setGenerationFields(ids) {
            if (destroyed || !state.draft) return getState();
            if (locked() || durableGuard()) return emit();
            var available = eligible();
            if (!Array.isArray(ids) || ids.some(function(id, index) { return typeof id !== 'string' || ids.indexOf(id) !== index || available.indexOf(id) === -1; })) {
                state.error = errorState(null, 'input'); return emit();
            }
            explicitGeneration = ids.slice();
            // Generation scope is workflow-only, but changing it must invalidate checked snapshots too.
            var next = Object.assign({}, state.draft, { draftRevision: state.draft.draftRevision + 1, checked: null });
            return edited(next);
        }

        async function pipeline(kind) {
            if (destroyed || !state.draft) return getState();
            if (locked() || durableGuard()) return emit();
            if (active && active.kind === kind) { await active.promise; return getState(); }
            var run = begin(kind);
            state.draft = Object.assign({}, state.draft, { checked: null });
            run.promise = (async function() {
                try {
                    if (!state.draft.source.trim() || !profile()) throw { code: 'input' };
                    if (!state.meta && !await metadata(run)) return;
                    if (kind === 'prepare' && (!state.draft.issueTypeId || !state.draft.templateId)) {
                        var routeSnapshot = drafts.snapshot(state.draft), routeInput = input();
                        stage(run, 'routing');
                        if (!current(run, routeSnapshot)) return;
                        var route = await ai.route(routeInput, { signal: run.abort.signal });
                        if (!current(run, routeSnapshot)) return;
                        providerUsage=route.usage || null;
                        state.routeCandidates = copy(route.candidates || []).map(function(c) { return { issueTypeId: c.issueTypeId, templateId: c.templateId, reason: c.reason }; });
                        var typeId = state.draft.issueTypeId || route.issueTypeId;
                        var templateId = state.draft.templateId || route.templateId;
                        state.draft = drafts.applyProposal(state.draft, { questions: route.questions }, routeSnapshot);
                        var template = profile().templates.find(function(t) { return t.id === templateId; });
                        var hasTypeAuthority = !!state.draft.issueTypeId || (template && template.issueTypeId !== null && template.issueTypeId === typeId);
                        // An unbound model suggestion is a choice for the human, even if it is the only candidate.
                        if (!hasTypeAuthority && compatible(typeId, templateId)) {
                            if (!state.routeCandidates.some(function(c) { return c.issueTypeId === typeId && c.templateId === templateId; })) {
                                state.routeCandidates.push({ issueTypeId: typeId, templateId: templateId, reason: 'Подтвердите тип и шаблон задачи.' });
                            }
                            if (!state.draft.questions.some(function(q) { return q.required; })) {
                                state.draft.questions.push({ id: 'route:selection', text: 'Выберите тип и шаблон задачи.', reason: 'У шаблона нет настроенной привязки к типу Jira.', required: true });
                            }
                        }
                        if (!route.issueTypeId || !route.templateId || !compatible(typeId, templateId) ||
                            !hasTypeAuthority ||
                            (state.draft.issueTypeId && state.draft.issueTypeId !== route.issueTypeId) ||
                            (state.draft.templateId && state.draft.templateId !== route.templateId)) {
                            save(); finish(run); return;
                        }
                        state.draft = drafts.setSelection(state.draft, { issueTypeId: typeId, templateId: templateId });
                        updateScope(); save();
                    }
                    if (!await metadata(run)) return;
                    if (!compatible(state.draft.issueTypeId, state.draft.templateId) || state.generationFieldIds.some(function(id) { return eligible().indexOf(id) === -1; })) throw { code: 'input' };
                    var snapshot = drafts.snapshot(state.draft), requestInput = input();
                    stage(run, kind === 'check' ? 'checking' : 'preparing');
                    if (!current(run, snapshot)) return;
                    var result = await ai[kind](requestInput, { signal: run.abort.signal });
                    if (!current(run, snapshot)) return;
                    providerUsage=result.usage || null;
                    if (kind === 'prepare') {
                        var generated = {};
                        state.generationFieldIds.forEach(function(id) {
                            if (result.fields && Object.prototype.hasOwnProperty.call(result.fields, id)) generated[id] = result.fields[id];
                        });
                        state.draft = drafts.applyProposal(state.draft, { fields: generated, questions: result.questions, warnings: result.warnings, evidence: result.evidence }, snapshot);
                    }
                    state.validation = validation.validateFields(state.meta, state.draft.issueTypeId, state.draft.fields, policy());
                    if (kind === 'check') {
                        state.validation.warnings = (result.warnings || []).filter(function(w) { return typeof w === 'string'; });
                        state.draft = drafts.markChecked(state.draft, state.validation, result.questions, snapshot);
                        // Reuse the nested whitelist without advancing the checked content revision.
                        state.draft = JSON.parse(drafts.serialize(Object.assign({}, state.draft, { evidence: result.evidence })));
                    }
                    save(); finish(run);
                } catch (error) { fail(run, error, state.stage === 'metadata' ? 'metadata' : 'transport'); }
            })();
            await run.promise;
            return getState();
        }
        async function cancel() {
            if (destroyed) return getState();
            if (locked()) return emit();
            if (state.draft && state.draft.creation.status === 'preflight') {
                return edited(Object.assign({},state.draft,{checked:null,draftRevision:state.draft.draftRevision+1}));
            }
            stop(); state.stage = 'stopped'; return emit();
        }
        async function destroy() {
            if (!destroyed) { stop(); destroyed = true; if (creator) creator.destroy();runtimeFiles.clear(); }
            return getState();
        }
        function creationUpdate(ownerScopes, draft, info) {
            if (destroyed || scopes !== ownerScopes) return;
            var entry = scopes[draft.projectKey];
            if (!entry || entry.draft.id !== draft.id) return;
            // Edits during preflight own their newer snapshot. Creator never resaves in this callback.
            if (entry.draft.draftRevision !== draft.draftRevision && draft.creation.status === 'preflight') return;
            entry.draft=draft;entry.revision=info.revision;
            if (info.persistenceFailed) entry.error=errorState(null,'conflict');
            if (info.meta) entry.meta=info.meta;
            if (state.draft && state.draft.id === draft.id) {
                state.draft=draft;if (info.meta) state.meta=info.meta;
                if (info.fieldErrors && Object.keys(info.fieldErrors).length) state.validation={ok:false,fieldErrors:info.fieldErrors,warnings:[],unsupportedRequired:[]};
                emit();
            }
        }
        async function submit(submitOptions) {
            if (destroyed || !state.draft || !creator || locked() || durableGuard()) return getState();
            stop();state.stage='idle';remember();var owner=scopes;
            await creator.submit({draft:state.draft,settings:state.settings,files:state.draft.attachments.map(function(a) {return {id:a.id,file:runtimeFiles.get(a.id)};}),
                withoutAttachments:!!submitOptions && submitOptions.withoutAttachments===true},function(d,info) {creationUpdate(owner,d,info);});
            return getState();
        }
        async function selectFiles(files) {
            if (destroyed || !state.draft || ['submitting','unknown'].indexOf(state.draft.creation.status)!==-1 || durableGuard()) return getState();
            var next=Object.assign({},state.draft,{attachments:state.draft.attachments.map(function(a) {return Object.assign({},a);})});
            var added=false;
            Array.from(files || []).forEach(function(file) {
                var previous=next.attachments.find(function(a) {return a.status!=='uploaded' && !runtimeFiles.has(a.id) && a.name===file.name && a.size===file.size && a.type===file.type;});
                var id=previous && previous.id;
                if (!previous) {
                    do {id=next.id + '-file-' + (++fileSequence);}
                    while (runtimeFiles.has(id) || next.attachments.some(function(a) {return a.id===id;}));
                }
                if (!previous && next.creation.issueKey) return;
                runtimeFiles.set(id,file);
                if (!previous) {added=true;next.attachments.push({id:id,name:file.name,size:file.size,type:file.type,lastModified:file.lastModified,status:'pending',attachmentId:null,error:null,needsReselect:false});}
            });
            if (added) return edited(Object.assign({},next,{draftRevision:next.draftRevision+1,checked:null}));
            state.draft=next;remember();
            // Reselecting bytes does not change issue content or the checked snapshot.
            if (!locked()) save();return emit();
        }
        async function removeFile(id) {
            if (destroyed || !state.draft || locked() || durableGuard()) return getState();
            runtimeFiles.delete(id);return edited(Object.assign({},state.draft,{attachments:state.draft.attachments.filter(function(a) {return a.id!==id;}),draftRevision:state.draft.draftRevision+1,checked:null}));
        }
        async function retryAttachment(id) {
            if (destroyed || !creator || !state.draft || durableGuard()) return getState();
            remember();var owner=scopes;
            await creator.retryAttachment({draft:state.draft,file:{id:id,file:runtimeFiles.get(id)}},function(d,info) {creationUpdate(owner,d,info);});return getState();
        }
        async function reconcileUnknown(resolution,key) {
            if (destroyed || !creator || !state.draft || durableGuard()) return getState();
            remember();var owner=scopes;
            await creator.reconcileUnknown({draft:state.draft,resolution:resolution,issueKey:key},function(d,info) {creationUpdate(owner,d,info);});return getState();
        }
        async function newDraft() {
            if (destroyed || !state.draft || durableGuard() || ['submitting','unknown','preflight'].indexOf(state.draft.creation.status)!==-1 || state.draft.attachments.some(function(a) {return a.status==='uploading';})) return getState();
            var previous=state.draft,entry=scopes[previous.projectKey],next=drafts.createDraft({projectKey:previous.projectKey});
            next=drafts.setSelection(next,{settingsRevision:state.settings.revision,metaSignature:state.meta && state.meta.signature});
            var result=store.save(previous.projectKey,{draft:next,settings:state.settings},entry.revision,{newDraft:true,draftId:previous.id,attemptId:previous.creation.attemptId});
            if (!result.ok) {state.error=errorState(null,'conflict');return emit();}
            previous.attachments.forEach(function(a) {runtimeFiles.delete(a.id);});entry.revision=result.revision;state.draft=next;state.validation=null;state.error=identityWarning;remember();updateScope();
            if (!state.meta) {
                var run=begin('newDraft');
                try {if(await metadata(run)) finish(run);} catch(error) {fail(run,error,'metadata');}
            }
            return emit();
        }
        async function discardDraft(confirmed) {
            if (confirmed!==true || destroyed || !state.draft || active || locked() || state.draft.creation.status==='preflight') return getState();
            if (durableGuard()) return emit();
            var previous=state.draft,entry=scopes[previous.projectKey];
            try {
                var result=store.clearDraft(previous.projectKey,entry.revision);
                if (!result.ok) {state.error=errorState(null,result.reason==='conflict' || result.reason==='creation-guard' ? 'conflict':'storage');return emit();}
                stop();previous.attachments.forEach(function(file) {runtimeFiles.delete(file.id);});
                state.draft=drafts.setSelection(drafts.createDraft({projectKey:previous.projectKey}),{settingsRevision:state.settings.revision,metaSignature:state.meta && state.meta.signature});
                entry.revision=result.revision;entry.error=null;state.validation=null;state.routeCandidates=[];state.stage='idle';state.error=identityWarning;
                remember();updateScope();return emit();
            } catch(error) {state.error=errorState(null,'storage');return emit();}
        }
        function invalidateCachedChecks() {
            Object.keys(scopes).forEach(function(key) {
                var entry=scopes[key], draft=entry.draft;
                if (key===state.draft.projectKey || !draft || !draft.checked || draft.creation.issueKey ||
                    ['preflight','submitting','unknown','created'].indexOf(draft.creation.status)!==-1) return;
                // Inactive scopes save on selection; retain their storage revision and creation outcome.
                entry.draft=Object.assign({},draft,{checked:null,draftRevision:draft.draftRevision+1});
            });
        }
        function connectionChanged() {
            if (destroyed || active || locked() || state.draft && state.draft.creation.status === 'preflight') return getState();
            if (!state.draft) return getState();
            invalidateCachedChecks();
            return edited(Object.assign({},state.draft,{checked:null,draftRevision:state.draft.draftRevision+1}));
        }
        return { init: init, selectProject: selectProject, selectTemplate: selectTemplate, selectIssueType: selectIssueType,
            connectionChanged:connectionChanged,
            updateSource: function(text) { return mutate(drafts.setSource, [text]); },
            updateField: function(id, value) { return mutate(drafts.editField, [id, value]); },
            answer: function(answers) { return mutate(drafts.appendAnswers, [answers]); },
            acceptField: function(id) { return mutate(drafts.acceptField, [id]); },
            applySettings: applySettings, loadSavedSettings:loadSavedSettings, resolveSettingsConflict:resolveSettingsConflict, discardField:discardField, setGenerationFields: setGenerationFields,
            prepare: function() { return pipeline('prepare'); }, check: function() { return pipeline('check'); },
            submit:submit, selectFiles:selectFiles,removeFile:removeFile,retryAttachment:retryAttachment,reconcileUnknown:reconcileUnknown,newDraft:newDraft,discardDraft:discardDraft,
            cancel: cancel, getState: getState, destroy: destroy };
    }
    return { create: create };
});
