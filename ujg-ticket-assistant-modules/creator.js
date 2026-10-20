define('_ujgTA_creator', ['_ujgTA_draft', '_ujgTA_fields', '_ujgTA_validation'], function(drafts, fields, validation) {
    'use strict';
    var locks = new Map(), sequence = 0;
    function canonical(value) {
        if (Array.isArray(value)) return value.map(canonical);
        if (!value || typeof value !== 'object') return value;
        var result={};Object.keys(value).sort().forEach(function(k) {result[k]=canonical(value[k]);});return result;
    }
    function equal(a,b) {return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));}
    function copy(d) { return JSON.parse(drafts.serialize(d)); }
    function checked(d) {
        return !!d.checked && ['sourceRevision','settingsRevision','draftRevision','metaSignature'].every(function(k) {return d.checked[k] === d[k];});
    }
    function issueKey(key) {return typeof key === 'string' && /^[A-Za-z][A-Za-z0-9_]*-\d+$/.test(key);}
    function create(options) {
        var api = options.api, store = options.store, dead = false, guards = new Map();
        function context(d, settings, callback) {
            var saved = store.load(d.projectKey), candidate=copy(d);
            if (!saved.draft || saved.draft.id !== d.id || !drafts.isCurrent(saved.draft, drafts.snapshot(d)) || !equal(saved.draft.creation,d.creation) ||
                !['source','fields','protectedFields','questions','attachments'].every(function(k) {return equal(saved.draft[k],candidate[k]);}) ||
                settings && !equal(saved.settings,settings)) return null;
            return {draft:copy(d), settings:saved.settings, revision:saved.revision, callback:callback};
        }
        function notify(ctx, extra) {
            if (!dead && ctx.callback) ctx.callback(copy(ctx.draft), Object.assign({revision:ctx.revision}, extra));
        }
        function persist(ctx, extra) {
            var result;
            var memoryWarning='Временное хранение: после перезагрузки защита от повтора может быть потеряна. Перед повтором проверьте Jira.';
            function warnMemory() {
                if (store.isPersistent && !store.isPersistent() && ctx.draft.warnings.indexOf(memoryWarning) === -1) ctx.draft.warnings.push(memoryWarning);
            }
            warnMemory();
            try {result = store.save(ctx.draft.projectKey, {draft:ctx.draft,settings:ctx.settings},ctx.revision,
                {creation:true,draftId:ctx.draft.id,attemptId:ctx.draft.creation.attemptId});} catch (ignore) {result = {ok:false};}
            if (result.ok) ctx.revision = result.revision;
            else ctx.draft.creation.error = 'Не удалось сохранить результат. Он остаётся в памяти; не повторяйте создание. Разрешите конфликт хранения.';
            // A quota failure can switch the store to memory during save. Keep the
            // outcome identical to the saved guard; durability is a separate warning.
            if (result.ok) warnMemory();
            notify(ctx, Object.assign({persistenceFailed:!result.ok},extra));
            return result.ok;
        }
        function stillCurrent(ctx, snap) {
            var saved = store.load(ctx.draft.projectKey);
            return !dead && saved.revision === ctx.revision && saved.draft && drafts.isCurrent(saved.draft,snap) &&
                equal(saved.settings,ctx.settings);
        }
        function policy(d, settings, meta) {
            var profile = settings.profiles.find(function(p) {return p.id === settings.activeProfileId;});
            var template = profile && profile.templates.find(function(t) {return t.id === d.templateId;});
            if (!profile || !template || template.issueTypeId !== null && template.issueTypeId !== d.issueTypeId || settings.revision !== d.settingsRevision) throw new Error('policy');
            return {allowAssignee:profile.allowAssignee === true,explicitUserFields:Object.keys(d.protectedFields).filter(function(id) {
                var field = fields.getField(meta,d.issueTypeId,id); return d.protectedFields[id] === true && field && field.kind === 'user';
            })};
        }
        async function attachmentLimits(d, files) {
            var meta = await api.getAttachmentMeta();
            if (!meta || meta.enabled !== true || !Number.isSafeInteger(meta.uploadLimit) || meta.uploadLimit < 0) throw new Error('limits');
            d.attachments.filter(function(a) {return a.status !== 'uploaded';}).forEach(function(a) {
                var entry = files.find(function(f) {return f.id === a.id;});
                if (!entry || !entry.file || entry.file.name !== a.name || entry.file.size !== a.size || a.size > meta.uploadLimit) throw new Error('file');
            });
        }
        async function upload(ctx, descriptor, file) {
            descriptor.status = 'uploading'; descriptor.error = null;
            if (!persist(ctx)) {descriptor.status='unknown';notify(ctx);return;}
            try {
                var result = await api.uploadAttachment(ctx.draft.creation.issueKey,file);
                if (!result || !result.id) throw {outcome:'unknown'};
                descriptor.status='uploaded';descriptor.attachmentId=result.id;descriptor.error=null;
            } catch (error) {
                descriptor.status=error && error.outcome === 'rejected' ? 'failed' : 'unknown';
                descriptor.error=descriptor.status === 'unknown' ? 'Результат загрузки неизвестен. Сверьте вложения в Jira; повторная загрузка заблокирована.' : 'Jira отклонила файл. Можно повторить только этот файл.';
            }
            persist(ctx);
        }
        async function submit(request, callback) {
            var d = request.draft;
            if (!d || dead || locks.has(d.id) || guards.has(d.id) || d.creation.issueKey || ['submitting','unknown','created'].indexOf(d.creation.status) !== -1 || !checked(d)) return;
            var ctx = context(d,request.settings,callback);
            if (!ctx || !checked(store.load(d.projectKey).draft)) return;
            var snap = drafts.snapshot(d), attempt = 'attempt-' + (options.now || Date.now)() + '-' + (++sequence);
            locks.set(d.id,attempt);
            try {
                ctx.draft.creation={status:'preflight',attemptId:attempt,issueKey:null,error:null};
                if (!persist(ctx)) return;
                var raw = await api.getCreateMeta(d.projectKey,null);
                if (!stillCurrent(ctx,snap)) return;
                var components = await api.getComponents(d.projectKey);
                if (!stillCurrent(ctx,snap)) return;
                var versions = await api.getVersions(d.projectKey);
                if (!stillCurrent(ctx,snap)) return;
                var meta = fields.normalizeMeta(raw,d.projectKey,{components:components,versions:versions});
                if (meta.signature !== d.metaSignature) {
                    ctx.draft=drafts.setSelection(ctx.draft,{metaSignature:meta.signature});ctx.draft.creation.status='idle';
                    ctx.draft.creation.error='Поля Jira изменились. Проверьте черновик заново.';persist(ctx,{meta:meta});return;
                }
                var confirmed = await fields.confirmRelations(meta,d.issueTypeId,d.fields,api,{});
                if (!stillCurrent(ctx,snap)) return;
                var p = policy(d,ctx.settings,meta); p.relations=confirmed;
                var valid = validation.validateFields(meta,d.issueTypeId,d.fields,p);
                if (!valid.ok || d.questions.some(function(q) {return q.required;})) throw new Error('validation');
                var payload = validation.buildCreatePayload(meta,d.issueTypeId,d.fields,p);
                if (d.attachments.length && !request.withoutAttachments) {
                    try {await attachmentLimits(d,request.files || []);} catch (ignore) {
                        ctx.draft.creation.status='idle';ctx.draft.creation.error='Не удалось проверить вложения. Повторите проверку файлов или явно создайте без вложений.';
                        if (stillCurrent(ctx,snap)) persist(ctx,{attachmentBlocked:true}); return;
                    }
                }
                if (!stillCurrent(ctx,snap) || !checked(ctx.draft)) return;
                ctx.draft.creation.status='submitting';
                if (!persist(ctx)) {
                    // Nothing has reached Jira. A failed guard save must not invent
                    // a submitted outcome or prevent ordinary conflict resolution.
                    ctx.draft.creation.status='idle';ctx.draft.checked=null;notify(ctx,{persistenceFailed:true});return;
                }
                guards.set(d.id,ctx);
                try {
                    var result = await api.createIssue(payload);
                    if (!result || !issueKey(result.key) || !result.id) throw {outcome:'unknown'};
                    ctx.draft.creation.status='created';ctx.draft.creation.issueKey=result.key;ctx.draft.checked=null;
                } catch (error) {
                    ctx.draft.creation.status=error && error.outcome === 'rejected' ? 'rejected' : 'unknown';ctx.draft.checked=null;
                    ctx.draft.creation.error=ctx.draft.creation.status === 'rejected' ? 'Jira отклонила создание. Исправьте поля и проверьте снова.' : 'Результат создания неизвестен. Сверьте Jira перед любым повтором.';
                    if (ctx.draft.creation.status === 'rejected') guards.delete(d.id);
                    persist(ctx,{fieldErrors:error && error.outcome==='rejected' ? error.fieldErrors || {} : {}});return;
                }
                if (!persist(ctx) || request.withoutAttachments) return;
                for (var a of ctx.draft.attachments) {
                    if (a.status !== 'pending') continue;
                    var file = (request.files || []).find(function(f) {return f.id === a.id;});
                    await upload(ctx,a,file.file);
                }
            } catch (ignore) {
                if (stillCurrent(ctx,snap)) {
                    ctx.draft.creation.status='idle';ctx.draft.checked=null;ctx.draft.creation.error='Не удалось выполнить предварительную проверку. Проверьте черновик заново.';persist(ctx);
                }
            } finally {locks.delete(d.id);}
        }
        async function retryAttachment(request, callback) {
            var d=request.draft, entry=request.file;
            if (!d || !issueKey(d.creation.issueKey) || locks.has(d.id) || dead) return;
            var ctx=context(d,null,callback);if (!ctx) return;
            var a=ctx.draft.attachments.find(function(a) {return a.id === entry.id;});
            if (!a || ['failed','unknown','pending'].indexOf(a.status) === -1) return;
            locks.set(d.id,'attachment');
            try {
                if (a.status === 'unknown') {
                    var found=await api.getIssueAttachments(d.creation.issueKey);
                    a.error='Сверка Jira: ' + found.filter(function(item) {return item.filename === a.name;}).length + ' совпадений по имени. Откройте Jira и проверьте файл; автоматический повтор заблокирован.';persist(ctx);return;
                }
                await attachmentLimits(Object.assign({},d,{attachments:[a]}),[entry]);
                await upload(ctx,a,entry.file);
            } catch (ignore) {a.error='Не удалось проверить вложения. Выберите исходный файл и повторите проверку.';persist(ctx);}
            finally {locks.delete(d.id);}
        }
        async function reconcileUnknown(request, callback) {
            var d=request.draft;
            if (!d || d.creation.status !== 'unknown' || d.creation.issueKey || locks.has(d.id) || dead) return;
            var ctx=context(d,null,callback);if (!ctx) return;
            if (request.resolution === 'found' && issueKey(request.issueKey) && request.issueKey.split('-')[0] === d.projectKey) {
                ctx.draft.creation.status='created';ctx.draft.creation.issueKey=request.issueKey;
            } else if (request.resolution === 'confirmed-not-created') {ctx.draft.creation.status='idle';guards.delete(d.id);}
            else return;
            ctx.draft.checked=null;ctx.draft.creation.error=null;persist(ctx);
        }
        return {submit:submit,retryAttachment:retryAttachment,reconcileUnknown:reconcileUnknown,destroy:function() {dead=true;}};
    }
    return {create:create};
});
