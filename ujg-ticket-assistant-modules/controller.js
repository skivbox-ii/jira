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
        response: 'Не удалось применить ответ AI. Проверьте поля и повторите действие вручную.',
        transport: 'Не удалось получить ответ AI. Повторите действие вручную.',
        metadata: 'Не удалось обновить данные Jira. Повторите действие вручную.',
        network: 'Не удалось получить данные Jira. Повторите действие вручную.'
    };
    function copy(value) { return JSON.parse(JSON.stringify(value)); }
    var responseReasons = {
        json: 'не удалось прочитать ответ. Повторите подготовку вручную или заполните поля.',
        contract: 'неверная структура ответа. Повторите действие вручную.',
        questions: 'неверный формат уточняющих вопросов. Повторите действие вручную.',
        warnings: 'неверный формат предупреждений. Повторите действие вручную.',
        evidence: 'неверное обоснование или цитата отсутствует в исходнике. Проверьте исходник и повторите действие вручную.',
        selection: 'ответ меняет выбранный тип задачи или шаблон либо предлагает недоступный вариант. Проверьте выбор и повторите действие вручную.',
        scope: 'ответ содержит поле, которое не разрешено заполнять. Проверьте выбранные поля генерации и повторите действие вручную.',
        shape: 'неверный формат значения поля. Выберите значение вручную или повторите подготовку.',
        value: 'значение поля не соответствует данным Jira или списку допустимых значений. Обновите данные Jira и выберите значение вручную.',
        maxLength: 'текст превышает допустимую длину поля. Сократите предложение вручную или явно запросите новое.'
    };
    var responseFieldLabels = {
        summary: 'Тема', description: 'Описание', components: 'Компоненты', fixVersions: 'Исправить в версиях',
        versions: 'Затронутые версии', priority: 'Приоритет', labels: 'Метки', duedate: 'Срок исполнения',
        assignee: 'Исполнитель', reporter: 'Автор', environment: 'Окружение', project: 'Проект', issuetype: 'Тип задачи'
    };
    function errorState(error, fallback, meta, typeId) {
        var code = error && Object.prototype.hasOwnProperty.call(messages, error.code) ? error.code : fallback;
        var result = { code: code, message: messages[code] };
        if (code === 'response' && error && error.details && typeof error.details.reason === 'string' && Object.prototype.hasOwnProperty.call(responseReasons, error.details.reason)) {
            var reason = error.details.reason, fieldId = error.details.fieldId;
            result.details = {reason: reason};
            result.message = 'Не удалось применить ответ AI: ' + responseReasons[reason];
            if (typeof fieldId === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(fieldId) && meta && fields.getField(meta, typeId, fieldId)) {
                result.details.fieldId = fieldId;
                var label = Object.prototype.hasOwnProperty.call(responseFieldLabels, fieldId) ? responseFieldLabels[fieldId] + ' (' + fieldId + ')' : fieldId;
                result.message += ' Поле: ' + label + '.';
                var spec=fields.getField(meta,typeId,fieldId);
                if (reason==='maxLength' && Number.isSafeInteger(spec.maxLength) && spec.maxLength>0 &&
                    error.details.maxLength===spec.maxLength && Number.isSafeInteger(error.details.length) && error.details.length>spec.maxLength) {
                    result.details.maxLength=spec.maxLength;result.details.length=error.details.length;
                    result.message+=' Длина: '+error.details.length+'; максимум: '+spec.maxLength+'.';
                }
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
            error: null, validation: null, routeCandidates: [], generationFieldIds: [], contextScope: null, assistance: null };
        var explicitGeneration = null;
        var creator = null, runtimeFiles = new Map(), fileSequence = 0;
        var budgetCache = null, providerUsage = null;
        var metadataReady = false, currentReporterName = null,templateQuestionCandidate=null;
        var listeners = new Set();
        var relationConfirmations = Object.create(null), relationSearches = new Map();
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
            result.destroyed = destroyed;
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
            if (!result.assistance && state.draft && state.draft.pendingAssistance && canAcceptField(state.draft.pendingAssistance.fieldId)) result.assistance = Object.assign({}, state.draft.pendingAssistance,
                {status:'ready',error:null,questions:state.draft.questions,warnings:state.draft.warnings,evidence:state.draft.evidence});
            result.draft = state.draft ? JSON.parse(drafts.serialize(state.draft)) : null;
            if (result.draft) result.draft.attachments.forEach(function(a) {a.needsReselect = a.status !== 'uploaded' && !runtimeFiles.has(a.id);});
            return copy(result);
        }
        function emit() {
            var entry = state.draft && scopes[state.draft.projectKey];
            if (entry && entry.error && entry.error.code === 'conflict') state.error = entry.error;
            if (!destroyed && typeof options.onChange === 'function') options.onChange(getState());
            if (!destroyed) listeners.forEach(function(listener) { listener(getState()); });
            return getState();
        }
        function stop() {
            relationSearches.forEach(function(run) {run.abort();}); relationSearches.clear();
            var previous = active;
            active = null;
            if (previous) previous.abort.abort();
            state.assistance = null;
            if (state.draft) state.draft = drafts.invalidateAssistance(state.draft);
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
            if (run.kind === 'assist') state.assistance = {fieldId:run.fieldId,action:run.action,
                status:state.stage === 'stopped' ? 'stopped' : 'error',error:state.error,questions:[],warnings:[],evidence:[]};
            emit();
        }
        function profile() {
            return state.settings && state.settings.profiles.find(function(p) { return p.id === state.settings.activeProfileId; });
        }
        function selectedProject() {
            return state.draft && state.projects.find(function(p){return p.key===state.draft.projectKey;});
        }
        function projectSelection(settings, typeId) {
            return profiles.typeTemplateSelection(settings || state.settings,selectedProject(),state.meta,typeId===undefined ? state.draft && state.draft.issueTypeId : typeId);
        }
        function syncProjectSelection() {
            if(!state.draft || !state.settings)return;
            var selected=projectSelection();
            if(!selected.automatic)return;
            state.settings=profiles.forProject(state.settings,selectedProject());
            if(!state.meta)return;
            var typeId=state.meta && state.meta.issueTypes.some(function(t){return t.id===state.draft.issueTypeId && !t.subtask;}) ? state.draft.issueTypeId : null;
            selected=projectSelection(state.settings,typeId);
            state.draft=drafts.setSelection(state.draft,{issueTypeId:typeId,templateId:selected.templateId,settingsRevision:state.settings.revision});
        }
        function canFormatDescription(d) {
            if(!d || d.projectKey!=='DEVOPS' || !d.issueTypeId || !d.templateId || typeof validation.formatDevopsDescription!=='function' ||
                d.protectedFields.description || Object.prototype.hasOwnProperty.call(d.pendingFields,'description') ||
                d.creation.issueKey || ['idle','rejected'].indexOf(d.creation.status)===-1)return false;
            var p=profile(),template=p && p.templates.find(function(t){return t.id===d.templateId;}),
                standard=profiles.createDefaults().profiles.find(function(p){return p.id==='devops';}).templates.find(function(t){return t.id===d.templateId;}),
                requirements=validation.devopsRequirements(state.meta,d.issueTypeId),spec=fields.getField(state.meta,d.issueTypeId,'description');
            return p && p.id==='devops' && template && standard && requirements && requirements.kind===template.id &&
                ['name','instructions','whenToUse'].every(function(k){return template[k]===standard[k];}) &&
                spec && spec.supported && spec.writable && ['string','textarea'].indexOf(spec.kind)!==-1;
        }
        function formattedDescription(d,value) {
            if(typeof value!=='string' || !value.trim() || !canFormatDescription(d))return {value:value,automatic:false};
            var spec=fields.getField(state.meta,d.issueTypeId,'description'),formatted;
            try {formatted=validation.formatDevopsDescription(state.meta,d.issueTypeId,value);} catch(error){return {value:value,automatic:false};}
            if(typeof formatted!=='string' || !formatted.trim() || spec.maxLength && formatted.length>spec.maxLength)return {value:value,automatic:false};
            return {value:formatted,automatic:true};
        }
        function restoreAutomaticDescription(d) {
            if(!d || !d.source || d.protectedFields.description || d.pendingAssistance || Object.prototype.hasOwnProperty.call(d.pendingFields,'description') ||
                d.creation.issueKey || ['idle','rejected'].indexOf(d.creation.status)===-1 || typeof d.fields.description!=='string')return d;
            var literal=/^\s*описание(?: задачи)?\s*: ?([\s\S]+)$/i.exec(d.source);
            if(literal && literal[1]===d.fields.description)return drafts.editField(d,'description',d.fields.description);
            var proven=d.fields.description===d.source || drafts.narrativeSummary(d.fields.description)===drafts.narrativeSummary(d.source);
            if(!proven)return d;
            var formatted=formattedDescription(d,d.fields.description);
            return formatted.automatic && formatted.value!==d.fields.description ? drafts.setAutomaticDescription(d,formatted.value) : d;
        }
        function descriptionMatchesSource(text) {
            var d=state.draft;
            if(!d || d.source!==text || d.protectedFields.description || Object.prototype.hasOwnProperty.call(d.pendingFields,'description'))return false;
            if(d.fields.description===text)return true;
            var formatted=formattedDescription(d,text);
            return formatted.automatic && formatted.value===d.fields.description;
        }
        function descriptionMatches(value) {
            return !!state.draft && (state.draft.fields.description===value || formattedDescription(state.draft,value).value===state.draft.fields.description);
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
                    if (f.supported && f.writable && ['user','number','epic','sprint'].indexOf(f.kind) === -1 && ['project', 'issuetype'].indexOf(f.id) === -1 && ids.indexOf(f.id) === -1) ids.push(f.id);
                });
            });
            return ids;
        }
        function updateScope() {
            state.typeTemplateSelection=state.settings ? projectSelection() : {automatic:false};
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
        function fillMissingReporter(draft) {
            if (!metadataReady || !currentReporterName || !draft || draft.protectedFields.reporter === true ||
                draft.creation.issueKey || ['preflight','submitting','unknown','created'].indexOf(draft.creation.status) !== -1) return draft;
            var reporter = fields.getField(state.meta,draft.issueTypeId,'reporter'), value = draft.fields.reporter;
            if (!reporter || !reporter.supported || !reporter.writable || reporter.kind !== 'user') {
                // Only the unprotected current-user default belongs to the app.
                // Explicit manual values, even the same login, stay visible.
                if (!isAutomaticReporter(draft)) return draft;
                var removed=drafts.editField(draft,'reporter',null);
                delete removed.fields.reporter;delete removed.protectedFields.reporter;
                return removed;
            }
            if (value !== undefined && value !== null && value !== '') return draft;
            var filled=drafts.editField(draft,'reporter',{name:currentReporterName});
            delete filled.protectedFields.reporter;
            return filled;
        }
        function isAutomaticReporter(draft) {
            var value=draft.fields.reporter;
            return !!currentReporterName && draft.protectedFields.reporter !== true && value &&
                typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length===1 && value.name===currentReporterName;
        }
        function edited(next, editOptions) {
            templateQuestionCandidate=null;
            if (locked() || durableGuard()) return emit();
            var reviewedBefore=state.draft && metadataReady?reviewedTemplateQuestions():[];
            if(reviewedBefore.length && !(next.reviewedTemplateQuestions || []).length)next=Object.assign({},next,{reviewedTemplateQuestions:copy(reviewedBefore)});
            if (next.creation.status === 'preflight') next = Object.assign({},next,{creation:{status:'idle',attemptId:null,issueKey:null,error:null}});
            stop(); state.draft = drafts.invalidateAssistance(next);syncProjectSelection();state.draft=fillMissingReporter(state.draft); state.validation = null; state.routeCandidates = [];
            providerUsage=null;
            state.stage = 'idle'; state.error = identityWarning;
            if(state.draft.appManagedQuestions && metadataReady) {
                if(customTemplateRules() || (state.draft.reviewedTemplateQuestions || []).length)state.draft=Object.assign({},state.draft,{templateReviewPending:true});
                var local=localChatValidation(true);
                if(editOptions && editOptions.reviewQuestions)local.questions=local.questions.concat(editOptions.reviewQuestions);
                state.validation=local;state.draft=Object.assign({},state.draft,{questions:local.questions});
            }
            updateScope(); save(); return emit();
        }
        function policy() {
            var p = profile();
            var explicit=Object.keys(state.draft.protectedFields).filter(function(id) {
                var field = fields.getField(state.meta, state.draft.issueTypeId, id);
                return state.draft.protectedFields[id] === true && field && field.kind === 'user';
            });
            if (isAutomaticReporter(state.draft))explicit.push('reporter');
            return {relations:relationConfirmations,allowAssignee:!!p && p.allowAssignee === true,explicitUserFields:explicit,
                attachments:state.draft.attachments.filter(function(a) {return a.status==='uploaded' || runtimeFiles.has(a.id);})};
        }
        function currentQuestions(questions,result) {
            if(!Array.isArray(result.questions))return questions;
            return (questions || []).filter(function(q) {return q.id.indexOf('devops:')!==0;}).concat(result.questions);
        }
        function input() {
            return copy({ source: state.draft.source, meta: state.meta, profile: profile(), issueTypeId: state.draft.issueTypeId,
                templateId: state.draft.templateId, allowFieldIds: state.generationFieldIds, tokenBudget:state.settings.tokenBudget,
                draft: { fields: state.draft.fields }, attachments:policy().attachments, relationConfirmations:relationConfirmations, explicitUserFields: policy().explicitUserFields });
        }
        function compatible(typeId, templateId) {
            var type = state.meta && state.meta.issueTypes.find(function(t) { return t.id === typeId && !t.subtask; });
            var template = profile() && profile().templates.find(function(t) { return t.id === templateId; });
            return !!type && !!template && (template.issueTypeId === null || template.issueTypeId === typeId);
        }
        function canAcceptField(id) {
            if (!metadataReady || !state.meta || !state.draft || state.meta.projectKey !== state.draft.projectKey ||
                state.meta.signature !== state.draft.metaSignature || !compatible(state.draft.issueTypeId,state.draft.templateId) ||
                !Object.prototype.hasOwnProperty.call(state.draft.pendingFields,id)) return false;
            var spec = fields.getField(state.meta,state.draft.issueTypeId,id);
            if (!spec || !spec.supported || !spec.writable || spec.kind === 'user' || ['project','issuetype'].indexOf(id) !== -1) return false;
            if (['number','epic','sprint'].indexOf(spec.kind) !== -1) return false;
            var targetMeta = {projectId:state.meta.projectId,issueTypes:[{id:state.draft.issueTypeId,subtask:false,
                fields:[Object.assign({},spec,{required:false})]}]}, value = {};
            value[id] = state.draft.pendingFields[id];
            return validation.validateFields(targetMeta,state.draft.issueTypeId,value,policy()).ok;
        }
        async function acceptField(id) {
            if (destroyed || !state.draft || locked() || durableGuard() || state.draft.creation.status === 'preflight') return emit();
            if (!Object.prototype.hasOwnProperty.call(state.draft.pendingFields,id) || !metadataReady) return emit();
            if (!canAcceptField(id)) {
                state.error = errorState({code:'response',details:{reason:'value',fieldId:id}},'response',state.meta,state.draft.issueTypeId);
                return emit();
            }
            return mutate(drafts.acceptField,[id]);
        }
        async function metadata(run, readOnly) {
            var snapshot = drafts.snapshot(state.draft), key = state.draft.projectKey;
            metadataReady = false;
            relationConfirmations = Object.create(null);
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
            if(!readOnly)syncProjectSelection();
            metadataReady = true;
            if (!readOnly) state.draft = fillMissingReporter(state.draft);
            if(!readOnly) {
                var summaryField=fields.getField(state.meta,state.draft.issueTypeId,'summary');
                if(summaryField && summaryField.supported && summaryField.writable && summaryField.kind==='string')
                    state.draft=drafts.repairAutomaticSummary(state.draft,summaryField.maxLength || 255);
                state.draft=restoreAutomaticDescription(state.draft);
            }
            if (fields.hasRelationValues(state.meta,state.draft.issueTypeId,state.draft.fields)) {
                var confirmed = await fields.confirmRelations(state.meta,state.draft.issueTypeId,state.draft.fields,api,request);
                if (!current(run)) return false;
                relationConfirmations = confirmed;
            }
            state.validation = null;
            if(!readOnly && key==='DEVOPS' && state.draft.issueTypeId) {
                var restoredValidation=validation.validateFields(state.meta,state.draft.issueTypeId,state.draft.fields,policy());
                restoredValidation.warnings=warningUnion(restoredValidation.warnings,state.draft.warnings);
                state.validation=restoredValidation;
                state.draft=Object.assign({},state.draft,{questions:currentQuestions(state.draft.questions,restoredValidation)});
                if(!restoredValidation.ok)state.draft=Object.assign({},state.draft,{checked:null});
                else if(run.restoredCheck && drafts.isCurrent(state.draft,run.restoredCheck) && !state.draft.questions.some(function(q) {return q.required;}))
                    state.draft=drafts.markChecked(state.draft,restoredValidation,state.draft.questions,drafts.snapshot(state.draft));
            }
            updateScope();
            if (readOnly) remember(); else save();
            return true;
        }

        async function init() {
            templateQuestionCandidate=null;
            if (destroyed) return getState();
            var run = begin('init');
            if (creator) creator.destroy();creator=null;runtimeFiles=new Map();
            store = null; scopes = Object.create(null); explicitGeneration = null; identityWarning = null;
            budgetCache=null;providerUsage=null;metadataReady=false;currentReporterName=null;
            state = { draft: null, settings: null, meta: null, projects: [], stage: 'idle', startedAt: null,
                error: null, validation: null, routeCandidates: [], generationFieldIds: [], contextScope: null, assistance: null };
            emit();
            try {
                var user = null;
                try { user = await api.getCurrentUser({ signal: run.abort.signal }); } catch (error) { /* No identity means no persistent scope. */ }
                if (!current(run)) return getState();
                // Jira Server/DC create payloads require the login, not the
                // account/storage key or display name. Retain no other /myself data.
                currentReporterName = user && typeof user.name === 'string' && user.name.trim() && user.name.trim() === user.name ? user.name : null;
                var key = user && (typeof user.key === 'string' && user.key.trim() ? user.key : typeof user.name === 'string' && user.name.trim() ? user.name : null);
                if (!key) { key = null; identityWarning = errorState(null, 'identity'); state.error = identityWarning; }
                store = options.createStore(key);
                creator = creators.create({api:api,store:store,now:options.now,currentReporterName:currentReporterName});
                var projects = await api.getProjects({ signal: run.abort.signal });
                if (!current(run)) return getState();
                state.projects = projects.values.map(function(p) { return { id: String(p.id), key: String(p.key), name: String(p.name || p.key) }; });
                finish(run);
            } catch (error) { fail(run, error, 'network'); }
            return getState();
        }
        async function selectProject(key) {
            templateQuestionCandidate=null;
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
                if(key==='DEVOPS' && state.draft.checked && !locked()) {
                    run.restoredCheck=copy(state.draft.checked);state.draft=Object.assign({},state.draft,{checked:null});
                }
                state.settings = profiles.forProject(entry.settings,state.projects.find(function(p){return p.key===key;})); state.meta = entry.meta; explicitGeneration = entry.generation;
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
        async function searchRelation(query, spec, options) {
            options = options || {};
            var id=spec && spec.id, field=state.draft && fields.getField(state.meta,state.draft.issueTypeId,id);
            if (destroyed || !metadataReady || !field || !field.supported || !field.writable ||
                ['epic','sprint'].indexOf(field.kind) === -1 || locked() || durableGuard() || state.draft.creation.status==='preflight') throw {kind:'input'};
            if (relationSearches.has(id)) relationSearches.get(id).abort();
            var aborter=new AbortController(), signal=options.signal, snapshot=drafts.snapshot(state.draft), meta=state.meta;
            function abort() {aborter.abort();}
            if(signal) {if(signal.aborted) abort(); else signal.addEventListener('abort',abort,{once:true});}
            relationSearches.set(id,aborter);
            function fresh() {
                if(destroyed || aborter.signal.aborted || relationSearches.get(id)!==aborter || state.meta!==meta ||
                    !state.draft || !drafts.isCurrent(state.draft,snapshot)) throw {kind:'abort'};
            }
            try {
                fresh();var request={signal:aborter.signal}, result;
                if(field.kind==='epic') result=await api.searchEpics(state.draft.projectKey,String(query || ''),request);
                else {
                    var boards=await api.getBoards(state.draft.projectKey,request);fresh();
                    if(!boards || !boards.complete || !Array.isArray(boards.values)) throw {kind:'incomplete'};
                    if(options.boardId==null) return copy({values:[],complete:false,boards:boards.values,needsBoard:true,boardId:null});
                    var board=boards.values.find(function(b) {return b.id===String(options.boardId);});
                    if(!board) throw {kind:'input'};
                    result=await api.getSprints(state.draft.projectKey,board.id,request);fresh();
                    result=Object.assign({},result,{boards:boards.values,boardId:board.id,needsBoard:false});
                    result.values=result.values.filter(function(v) {return (v.label+' '+v.id).toLowerCase().indexOf(String(query || '').toLowerCase())!==-1;});
                }
                fresh();
                if(!result || !Array.isArray(result.values)) throw {kind:'incomplete'};
                result=Object.assign({},result,{values:result.values.filter(function(v) {
                    return fields.relationAllowed(field,field.kind==='epic'?v.id:Number(v.id));
                })});
                return copy(result);
            } catch(error) {
                fresh();
                throw {kind:error && ['unauthorized','forbidden','not-found','rate-limit','incomplete','input','abort'].indexOf(error.kind)!==-1 ? error.kind : 'network'};
            } finally {
                if(relationSearches.get(id)===aborter) relationSearches.delete(id);
                if(signal) signal.removeEventListener('abort',abort);
            }
        }
        async function selectTemplate(id) {
            if (destroyed || !state.draft) return getState();
            var automatic=projectSelection();
            if(automatic.automatic) {
                if(id!==automatic.templateId){state.error=errorState(null,'input');return emit();}
                return getState();
            }
            if (id !== null && !profile().templates.some(function(t) { return t.id === id; })) {
                state.error = errorState(null, 'input'); return emit();
            }
            var selected=profile().templates.find(function(t) {return t.id===id;}), selection={templateId:id};
            if(selected && selected.issueTypeId!==null && state.meta && state.meta.issueTypes.some(function(t) {return t.id===selected.issueTypeId && !t.subtask;})) selection.issueTypeId=selected.issueTypeId;
            return edited(drafts.setSelection(state.draft, selection));
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
            var automatic=projectSelection(settings);
            if(automatic.automatic)return {settingsRevision:settings.revision,templateId:automatic.templateId};
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
            settings=profiles.forProject(settings,selectedProject());
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
                saved.settings=profiles.forProject(saved.settings,selectedProject());
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

        async function assistField(id, action) {
            if (destroyed || !state.draft || locked() || durableGuard() || state.draft.creation.status === 'preflight') return emit();
            var spec = fields.getField(state.meta, state.draft.issueTypeId, id);
            if (!compatible(state.draft.issueTypeId, state.draft.templateId) || !spec || spec.kind === 'number' || eligible().indexOf(id) === -1 ||
                state.generationFieldIds.indexOf(id) === -1 || ['generate','improve','shorten'].indexOf(action) === -1 ||
                action === 'shorten' && ['string','textarea'].indexOf(spec.kind) === -1) {
                state.error = errorState(null,'input'); return emit();
            }
            var run = begin('assist'); run.fieldId = id; run.action = action;
            state.draft = Object.assign({},state.draft,{checked:null}); state.validation = null; save();
            state.assistance = {fieldId:id,action:action,status:'running',error:null,questions:[],warnings:[],evidence:[]};
            run.promise = (async function() {
                try {
                    if (!state.draft.source.trim()) throw {code:'input'};
                    if (!await metadata(run)) return;
                    if (eligible().indexOf(id) === -1 || state.generationFieldIds.indexOf(id) === -1) throw {code:'input'};
                    var snapshot = drafts.snapshot(state.draft), requestInput = input();
                    requestInput.allowFieldIds = [id]; requestInput.targetFieldId = id; requestInput.fieldAction = action;
                    stage(run,'assisting');
                    if (!current(run,snapshot)) return;
                    var result = await ai.assist(requestInput,{signal:run.abort.signal});
                    if (!current(run,snapshot)) return;
                    if (durableGuard()) throw {code:'conflict'};
                    state.draft = drafts.applyFieldProposal(state.draft,id,action,result,snapshot);
                    providerUsage = result.usage || null;
                    state.assistance = {fieldId:id,action:action,status:'ready',error:null,
                        questions:state.draft.questions,warnings:state.draft.warnings,evidence:state.draft.evidence};
                    save(); finish(run);
                } catch (error) {fail(run,error,state.stage === 'metadata' ? 'metadata' : 'transport');}
            })();
            await run.promise; return getState();
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
                    if(kind==='prepare' && projectSelection().automatic && (!state.draft.issueTypeId || !state.draft.templateId))throw {code:'input'};
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
                        // This explicit AI check used the current selected rules and passed the snapshot guard.
                        if(Array.isArray(result.questions)) state.draft=Object.assign({},state.draft,{templateReviewPending:false,
                            reviewedTemplateQuestions:customTemplateRules() || (state.draft.reviewedTemplateQuestions || []).length?semanticTemplateQuestions(result.questions):[]});
                        state.validation.warnings = warningUnion(state.validation.warnings,warningUnion((result.warnings || []).filter(function(w) { return typeof w === 'string'; }),retainedReviewWarnings(state.draft.warnings)));
                        state.draft = drafts.markChecked(state.draft, state.validation, currentQuestions(result.questions,state.validation), snapshot);
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
            var assistance = state.assistance;
            stop(); state.stage = 'stopped';
            if (assistance) state.assistance = {fieldId:assistance.fieldId,action:assistance.action,status:'stopped',error:null,questions:[],warnings:[],evidence:[]};
            save(); return emit();
        }
        async function destroy() {
            if (!destroyed) { stop(); destroyed = true;listeners.forEach(function(listener) {listener(getState());});listeners.clear(); if (creator) creator.destroy();runtimeFiles.clear(); }
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
            var snapshot=drafts.snapshot(state.draft), ownerStore=store;
            async function guardedSubmit() {
                if(destroyed || store!==ownerStore || !state.draft || !drafts.isCurrent(state.draft,snapshot) || locked() || durableGuard()) return;
                stop();state.stage='idle';remember();var owner=scopes;
                await creator.submit({draft:state.draft,settings:state.settings,files:state.draft.attachments.map(function(a) {return {id:a.id,file:runtimeFiles.get(a.id)};}),
                    withoutAttachments:!!submitOptions && submitOptions.withoutAttachments===true},function(d,info) {creationUpdate(owner,d,info);});
            }
            try {
                var result=store.withCreationLock ? await store.withCreationLock(state.draft.projectKey,state.draft.id,guardedSubmit) : await guardedSubmit();
                if(result && result.reason==='busy') {state.error=errorState(null,'conflict');emit();}
            } catch(error) {state.error=errorState(null,'storage');emit();}
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
            if (destroyed || active && active.kind !== 'assist' || locked() || state.draft && state.draft.creation.status === 'preflight') return getState();
            if (!state.draft) return getState();
            invalidateCachedChecks();
            return edited(Object.assign({},state.draft,{checked:null,draftRevision:state.draft.draftRevision+1}));
        }
        // Chat operations always compare the complete canonical selection/revision snapshot.
        function chatSnapshot() { return state.draft ? drafts.snapshot(state.draft) : null; }
        function chatFresh(snapshot) {
            return !destroyed && state.draft && metadataReady && drafts.isCurrent(state.draft,snapshot) &&
                !locked() && state.draft.creation.status !== 'preflight' && !durableGuard() &&
                !(state.error && state.error.code === 'conflict');
        }
        function chatFailure(code) { return {ok:false,code:code || 'stale'}; }
        function retainedReviewWarnings(warnings) {
            return (warnings || []).filter(function(w){return typeof w==='string' && w.startsWith('При сверке пропущено поле');});
        }
        function warningUnion(a,b) {return Array.from(new Set((a || []).concat(b || [])));}
        // Shared read-only codec for strict chat updates and explicit review filtering.
        function validatedChatField(id,value) {
            var spec=fields.getField(state.meta,state.draft.issueTypeId,id);
            if (!spec || !spec.supported || !spec.writable || ['user','number','epic','sprint'].indexOf(spec.kind)!==-1 ||
                ['project','issuetype','__proto__','constructor','prototype'].indexOf(id)!==-1 || state.generationFieldIds.indexOf(id)===-1)return {ok:false};
            var single={};single[id]=value;
            var partial={projectId:state.meta.projectId,issueTypes:[{id:state.draft.issueTypeId,subtask:false,fields:[Object.assign({},spec,{required:false})]}]};
            try {return {ok:true,value:validation.buildCreatePayload(partial,state.draft.issueTypeId,single,policy()).fields[id]};}
            catch(error){return {ok:false};}
        }
        function chatFilterReviewFields(values,snapshot) {
            if(!chatFresh(snapshot))return chatFailure();
            if(!compatible(state.draft.issueTypeId,state.draft.templateId) || !values || typeof values!=='object' || Array.isArray(values) ||
                Object.keys(values).some(function(id){return ['__proto__','constructor','prototype'].includes(id);}))return chatFailure('input');
            var patch={},warnings=[],valid=true;
            Object.keys(values).forEach(function(id){
                var core=id==='summary' || id==='description',checked=validatedChatField(id,values[id]);
                if(core && (typeof values[id]!=='string' || !values[id].trim()))checked={ok:false};
                // An explicit review may add validated facts, not silently clear
                // existing optional values via a model-produced null.
                if(!core && values[id]===null)checked={ok:false};
                if(checked.ok)patch[id]=checked.value;
                else if(core)valid=false;
                else warnings.push('При сверке пропущено поле «'+(/^[a-zA-Z][a-zA-Z0-9_]{0,79}$/.test(id)?id:'неизвестное поле')+'»: значение неверно или недоступно для автоматического заполнения; прежнее значение не изменено.');
            });
            return valid?{ok:true,fields:patch,warnings:warnings}:chatFailure('value');
        }
        function chatBeginReview(snapshot) {
            if(!chatFresh(snapshot))return chatFailure();
            var reviewed=reviewedTemplateQuestions();
            state.draft=Object.assign({},state.draft,{checked:null,draftRevision:state.draft.draftRevision+1,
                templateReviewPending:state.draft.templateReviewPending || customTemplateRules() || reviewed.length>0});
            state.validation=null;save();emit();
            return state.error && ['storage','conflict'].includes(state.error.code)?chatFailure(state.error.code):{ok:true};
        }
        function chatDevopsReferenceAnswer(text,allowExisting) {
            var d=state.draft;
            if(!d || d.projectKey!=='DEVOPS' || !metadataReady || !state.meta || !compatible(d.issueTypeId,d.templateId) ||
                d.creation.issueKey || ['idle','rejected'].indexOf(d.creation.status)===-1 ||
                typeof validation.parseDevopsReferenceAnswer!=='function' || typeof validation.mergeDevopsReference!=='function')return null;
            var parsed=validation.parseDevopsReferenceAnswer(text);
            if(!parsed.ok && parsed.code!=='dashboard')return null; // Mixed replies remain ordinary model turns.
            var local=validation.validateFields(state.meta,d.issueTypeId,d.fields,policy()),missing=(local.questions || []).some(function(q){return q.id==='devops:links';});
            var merged=parsed.ok ? validation.mergeDevopsReference(d.fields.description,parsed.url) : null;
            if(!missing && !(allowExisting && merged && merged.ok && merged.description===d.fields.description))return null;
            if(!parsed.ok)return {kind:'explain',message:parsed.message};
            if(Object.prototype.hasOwnProperty.call(d.pendingFields,'description'))return {kind:'explain',message:'В карточке есть предложение к описанию. Подтвердите или отклоните его, затем добавьте ссылку.'};
            if(state.generationFieldIds.indexOf('description')===-1)return {kind:'explain',message:'Описание исключено из автоматического заполнения. Добавьте ссылку в редакторе или включите это поле в настройках.'};
            if(!merged.ok)return {kind:'explain',message:merged.message};
            return {kind:'apply',description:merged.description,unchanged:merged.description===d.fields.description};
        }
        function customTemplateRules() {
            var p=profile(),template=p && p.templates.find(function(t) {return t.id===state.draft.templateId;}),
                standardProfile=profiles.createDefaults().profiles.find(function(item) {return p && item.id===p.id;}),
                standard=standardProfile && standardProfile.templates.find(function(t) {return template && t.id===template.id;});
            return !standard || p.instructions!==standardProfile.instructions || template.instructions!==standard.instructions || template.whenToUse!==standard.whenToUse;
        }
        function semanticTemplateQuestions(questions) {
            return (questions || []).filter(function(q) {return !/^(?:app:|template:|devops:|required:|route:)/.test(q.id);});
        }
        function reviewedTemplateQuestions() {
            var retained=state.draft.reviewedTemplateQuestions || [];
            // Earlier saved drafts held explicit review blockers only in questions.
            if(!retained.length && !state.draft.templateReviewPending && customTemplateRules()) {
                retained=semanticTemplateQuestions(state.draft.questions);
                if(retained.length)state.draft=Object.assign({},state.draft,{reviewedTemplateQuestions:copy(retained)});
            }
            return retained;
        }
        function retainReviewedQuestions(questions,reviewed) {
            var retained=reviewed===undefined?reviewedTemplateQuestions():reviewed;
            return questions.filter(function(q) {return !retained.some(function(item) {return item.id===q.id;});}).concat(copy(retained));
        }
        function managedQuestions(result) {
            var questions=(result.questions || []).slice(),messages=new Set(questions.map(function(q) {return q.text;}));
            Object.keys(result.fieldErrors).forEach(function(id) {
                result.fieldErrors[id].forEach(function(message,index) {
                    if(messages.has(message))return;
                    messages.add(message);questions.push({id:'app:'+id+':'+index,text:message,required:true});
                });
            });
            return retainReviewedQuestions(questions);
        }
        function localChatValidation(managed,reviewedTemplateRevision,reviewQuestions) {
            var p=policy();p.appManagedQuestions=managed || state.draft.appManagedQuestions===true;p.templateId=state.draft.templateId;
            var result=validation.validateFields(state.meta,state.draft.issueTypeId,state.draft.fields,p);
            var description=fields.getField(state.meta,state.draft.issueTypeId,'description');
            if(description && description.supported && description.writable &&
                (typeof state.draft.fields.description!=='string' || !state.draft.fields.description.trim())) {
                result.ok=false;
                (result.fieldErrors.description || (result.fieldErrors.description=[])).push('Заполните описание задачи: укажите известные сведения и ожидаемый результат.');
            }
            Object.keys(state.draft.pendingFields).forEach(function(id) {
                if(!managed && !state.draft.appManagedQuestions && state.draft.protectedFields[id]!==true)return;
                result.ok=false;var spec=fields.getField(state.meta,state.draft.issueTypeId,id);
                (result.fieldErrors[id] || (result.fieldErrors[id]=[])).push('Подтвердите или отклоните предложение для поля «'+(spec?spec.name:id)+'» в карточке или редакторе.');
            });
            if(!compatible(state.draft.issueTypeId,state.draft.templateId)) {result.ok=false;result.fieldErrors.template=['Select a compatible template'];}
            if(state.draft.templateReviewPending && reviewedTemplateRevision!==state.draft.settingsRevision) {
                result.ok=false;result.fieldErrors._templateReview=['Новые правила шаблона ещё не проверены.'];
            }
            var previous=reviewQuestions===undefined?state.draft.questions:reviewQuestions;
            if(reviewedTemplateRevision!==undefined)previous=previous.filter(function(q) {return !/^(?:app:|template:)/.test(q.id);});
            result.questions=managed?managedQuestions(result):retainReviewedQuestions(currentQuestions(previous,result),reviewQuestions);
            if(result.questions.some(function(q) {return q.required;}))result.ok=false;
            return result;
        }
        async function chatUpdate(proposal, snapshot, sourceText, updateOptions) {
            if(!chatFresh(snapshot))return chatFailure();
            if(!compatible(state.draft.issueTypeId,state.draft.templateId) || !proposal || typeof proposal!=='object' || Array.isArray(proposal) ||
                Object.keys(proposal).some(function(k) {return ['fields','descriptionSections','questions','warnings','taskException'].indexOf(k)===-1;}))return chatFailure('input');
            var hasSections=Object.prototype.hasOwnProperty.call(proposal,'descriptionSections'),form=hasSections || !!(updateOptions && updateOptions.appManagedQuestions===true);
            var supplied=proposal.fields===undefined && form?{}:proposal.fields;
            if(!supplied || typeof supplied!=='object' || Array.isArray(supplied))return chatFailure('input');
            if(!form && proposal.questions!==undefined && (!Array.isArray(proposal.questions) || proposal.questions.some(function(q) {
                return !q || typeof q.id!=='string' || !q.id || typeof q.text!=='string' || !q.text || typeof q.required!=='boolean';
            })))return chatFailure('input');
            if(proposal.warnings!==undefined && (!Array.isArray(proposal.warnings) || proposal.warnings.some(function(v) {return typeof v!=='string';})))return chatFailure('input');
            if(proposal.taskException!==undefined && typeof proposal.taskException!=='string')return chatFailure('input');
            if(sourceText!==undefined && typeof sourceText!=='string')return chatFailure('input');
            var patch={},rejected=[],appliedSections=[],literal=!!(updateOptions && updateOptions.verbatimDescription===true),description;
            if(Object.prototype.hasOwnProperty.call(supplied,'description') && !literal)description=formattedDescription(state.draft,supplied.description);
            Object.keys(supplied).forEach(function(id) {
                var pending=Object.prototype.hasOwnProperty.call(state.draft.pendingFields,id);
                if(form && (id==='description' && hasSections || pending)) {
                    rejected.push({id:id,message:'Поле уже содержит отдельное предложение или обновляется по разделам.'});return;
                }
                var checked=validatedChatField(id,id==='description' && description?description.value:supplied[id]);
                if(checked.ok)patch[id]=checked.value;
                else rejected.push({id:id,message:'Значение неверно или недоступно для автоматического заполнения.'});
            });
            if(hasSections) {
                var base=Object.prototype.hasOwnProperty.call(state.draft.pendingFields,'description')?state.draft.pendingFields.description:state.draft.fields.description;
                var merged=validation.mergeDescriptionSections(state.meta,state.draft.issueTypeId,typeof base==='string'?base:'',proposal.descriptionSections,state.draft.templateId);
                rejected=rejected.concat(merged.rejected);appliedSections=merged.applied;
                if(appliedSections.length) {
                    var checkedDescription=validatedChatField('description',merged.description);
                    if(checkedDescription.ok)patch.description=checkedDescription.value;
                    else {appliedSections.forEach(function(id) {rejected.push({id:id,message:'Описание недоступно для автоматического заполнения или превышен лимит Jira.'});});appliedSections=[];}
                }
            }
            if(!form && rejected.length)return chatFailure('value');
            reviewedTemplateQuestions();
            var original=state.draft,before=sourceText===undefined?original:drafts.setSource(original,original.source+(original.source?'\n\n':'')+sourceText);
            if(form)before=Object.assign({},before,{pendingFields:copy(original.pendingFields)});
            var next=drafts.applyProposal(before,{fields:patch,questions:form?[]:proposal.questions===undefined?before.questions:proposal.questions,
                warnings:warningUnion(proposal.warnings===undefined?before.warnings:proposal.warnings,retainedReviewWarnings(before.warnings)),evidence:before.evidence},
                drafts.snapshot(before),{preservePendingFields:form});
            if(form)next.appManagedQuestions=true;
            if(updateOptions && updateOptions.preservePendingFields===true)Object.keys(before.pendingFields).forEach(function(id) {
                if(!Object.prototype.hasOwnProperty.call(patch,id))next.pendingFields[id]=before.pendingFields[id];
            });
            if(Object.prototype.hasOwnProperty.call(patch,'description') && literal)next.protectedFields.description=true;
            if(proposal.taskException!==undefined)next.taskExceptions=before.taskExceptions.concat([proposal.taskException]);
            next=drafts.recordAutomaticChange(next,before);
            var explicitQuestions=!form && original.templateReviewPending && Array.isArray(proposal.questions)?semanticTemplateQuestions(proposal.questions):undefined;
            edited(next,{reviewQuestions:explicitQuestions});
            if(explicitQuestions!==undefined)templateQuestionCandidate={snapshot:chatSnapshot(),questions:copy(explicitQuestions)};
            return {ok:true,snapshot:chatSnapshot(),pendingFields:copy(state.draft.pendingFields),warnings:copy(state.draft.warnings),
                appliedFields:Object.keys(patch),appliedSections:appliedSections,rejected:rejected,validation:copy(state.validation),questions:copy(state.draft.questions)};
        }
        function chatCanUndo() { return !!state.draft && !!state.draft.automaticUndo && metadataReady && drafts.isCurrent(state.draft,state.draft.automaticUndo.after) && !locked() && state.draft.creation.status!=='preflight'; }
        async function chatUndo() {
            if (!chatCanUndo() || !chatFresh(state.draft.automaticUndo.after)) return chatFailure();
            var previous=state.draft.automaticUndo.before, next=Object.assign({},state.draft,{
                fields:copy(previous.fields),pendingFields:copy(previous.pendingFields),protectedFields:copy(previous.protectedFields),
                questions:copy(previous.questions),warnings:copy(previous.warnings),evidence:copy(previous.evidence),taskExceptions:copy(previous.taskExceptions),templateReviewPending:previous.templateReviewPending===true,appManagedQuestions:previous.appManagedQuestions===true,
                checked:null,draftRevision:state.draft.draftRevision+1});
            next.automaticUndo=null;edited(next);return {ok:true,snapshot:chatSnapshot()};
        }
        async function chatValidate(snapshot, request, reviewedTemplateRevision) {
            if (!chatFresh(snapshot)) return chatFailure();
            var meta=state.meta, signal=request && request.signal;
            try {
                var confirmed=await fields.confirmRelations(meta,state.draft.issueTypeId,state.draft.fields,api,{signal:signal});
                if (signal && signal.aborted || !chatFresh(snapshot) || state.meta !== meta) return chatFailure();
                relationConfirmations=confirmed;
                var reviewed=state.draft.templateReviewPending && reviewedTemplateRevision===state.draft.settingsRevision;
                var managed=state.draft.appManagedQuestions===true && reviewedTemplateRevision===undefined;
                var reviewQuestions;
                if(reviewed)reviewQuestions=templateQuestionCandidate && drafts.isCurrent(state.draft,templateQuestionCandidate.snapshot)?templateQuestionCandidate.questions:reviewedTemplateQuestions();
                var result=localChatValidation(managed,reviewedTemplateRevision,reviewQuestions);
                if(reviewed) {
                    state.draft=Object.assign({},state.draft,{templateReviewPending:false,reviewedTemplateQuestions:copy(reviewQuestions)});
                    templateQuestionCandidate=null;
                }
                if(result.ok && state.draft.projectKey==='DEVOPS') {
                    var external=await api.checkDevopsIssue(state.draft,meta,{signal:signal});
                    if(signal && signal.aborted || !chatFresh(snapshot) || state.meta!==meta)return chatFailure();
                    Object.assign(result.fieldErrors,external.fieldErrors);
                    if(Object.keys(external.fieldErrors).length)result.ok=false;
                    result.warnings=warningUnion(result.warnings,external.warnings);
                }
                if(managed)result.questions=managedQuestions(result);
                state.draft=Object.assign({},state.draft,{questions:result.questions});
                result.warnings=warningUnion(result.warnings,retainedReviewWarnings(state.draft.warnings));
                state.validation=result;
                state.draft=drafts.markChecked(state.draft,result,state.draft.questions,snapshot);
                save();emit();return {ok:result.ok,validation:copy(result),questions:copy(state.draft.questions),snapshot:chatSnapshot()};
            } catch (error) {return chatFailure('metadata');}
        }
        function chatReadTemplate() {
            var p=profile(), t=p && state.draft && p.templates.find(function(t) {return t.id===state.draft.templateId;});
            return t ? {template:copy(t),profileId:p.id,profileInstructions:p.instructions,revision:state.settings.revision,snapshot:chatSnapshot()} : null;
        }
        async function chatApplyTemplate(changes, snapshot) {
            if (!chatFresh(snapshot) || !changes || typeof changes !== 'object' || Array.isArray(changes) ||
                !Object.keys(changes).length || Object.keys(changes).some(function(k) {return ['name','whenToUse','instructions','issueTypeId'].indexOf(k)===-1;})) return chatFailure('input');
            var read=chatReadTemplate();if(!read) return chatFailure('input');
            var entry=scopes[state.draft.projectKey], saved=store.load(state.draft.projectKey);
            if (saved.revision!==entry.revision || JSON.stringify(profiles.validateSettings(saved.settings).value)!==JSON.stringify(profiles.validateSettings(state.settings).value)) return chatFailure('conflict');
            if (changes.issueTypeId !== undefined && changes.issueTypeId !== null && !state.meta.issueTypes.some(function(t) {return t.id===changes.issueTypeId && !t.subtask;})) return chatFailure('input');
            var settings=copy(state.settings), p=settings.profiles.find(function(p) {return p.id===read.profileId;});
            Object.assign(p.templates.find(function(t) {return t.id===read.template.id;}),changes);
            if(!profiles.validateSettings(settings).ok) return chatFailure('input');
            if(state.settings.revision===Number.MAX_SAFE_INTEGER) return chatFailure('input');
            var next=profiles.validateSettings(settings).value;next.revision=state.settings.revision+1;
            // Saving new rules never reuses semantic questions from the old template.
            state.draft=Object.assign({},state.draft,{templateReviewPending:true,checked:null});
            installSettings(next);
            if(state.error && ['conflict','storage'].indexOf(state.error.code)!==-1) return chatFailure(state.error.code);
            return {ok:true,snapshot:chatSnapshot(),reviewRequired:true};
        }
        return { subscribe:function(listener) {listeners.add(listener);return function() {listeners.delete(listener);};},
            chatDevopsReferenceAnswer:chatDevopsReferenceAnswer,
            chatDescriptionMatchesSource:descriptionMatchesSource,chatDescriptionMatches:descriptionMatches,
            getStore:function() {return store;}, chatSnapshot:chatSnapshot,chatBeginReview:chatBeginReview,chatFilterReviewFields:chatFilterReviewFields,chatUpdate:chatUpdate,chatUndo:chatUndo,chatCanUndo:chatCanUndo,
            chatDescriptionSections:function() {return state.draft?validation.descriptionSectionDefinitions(state.meta,state.draft.issueTypeId,state.draft.templateId):[];},
            chatDevopsRequirements:function() {return validation.devopsRequirements(state.meta,state.draft && state.draft.issueTypeId);},
            chatValidate:chatValidate,chatCompleteTemplateReview:function(snapshot,templateRevision,request) {
                if(!state.draft || !state.draft.templateReviewPending || templateRevision!==state.draft.settingsRevision) return Promise.resolve(chatFailure());
                return chatValidate(snapshot,request,templateRevision);
            },chatReadTemplate:chatReadTemplate,chatApplyTemplate:chatApplyTemplate, init: init, selectProject: selectProject, selectTemplate: selectTemplate, selectIssueType: selectIssueType,
            searchRelation:searchRelation,
            connectionChanged:connectionChanged,
            updateSource: function(text) { return mutate(drafts.setSource, [text]); },
            updateField: function(id, value) { return mutate(drafts.editField, [id, value]); },
            answer: function(answers) { return mutate(drafts.appendAnswers, [answers]); },
            acceptField: acceptField,
            rejectField: function(id) { return mutate(drafts.rejectField, [id]); }, assistField: assistField,
            applySettings: applySettings, loadSavedSettings:loadSavedSettings, resolveSettingsConflict:resolveSettingsConflict, discardField:discardField, setGenerationFields: setGenerationFields,
            prepare: function() { return pipeline('prepare'); }, check: function() { return pipeline('check'); },
            submit:submit, selectFiles:selectFiles,removeFile:removeFile,retryAttachment:retryAttachment,reconcileUnknown:reconcileUnknown,newDraft:newDraft,discardDraft:discardDraft,
            cancel: cancel, getState: getState, destroy: destroy };
    }
    return { create: create };
});
