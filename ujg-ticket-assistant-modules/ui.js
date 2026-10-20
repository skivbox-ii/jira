define('_ujgTA_ui', ['_ujgTA_fieldUi', '_ujgTA_icons', '_ujgTA_settingsUi'], function(fieldUi, icon, settingsUi) {
    'use strict';
    var connectionSequence = 0;
    function create(options) {
        var $ = options.$, c = options.controller, root, state, source, fieldsHost, questionsHost, scopeHost;
        var project, template, type, timer = null, lastOperation = {name:'prepare'}, dead = false, settingsView = null, discardId = null;
        var fields = new Map(), questions = new Map(), scope = new Map(), selectionKey = null, settingsScope = null, connectionHost = null;
        var stages = {metadata: 'Загрузка полей Jira', routing: 'Выбор шаблона', preparing: 'Подготовка черновика', checking: 'Проверка черновика'};
        function button(label, name, selector) {
            return $('<button type="button">').attr(selector || {}).attr({title: label, 'aria-label': label}).append(name ? icon(name) : null, $('<span>').text(label));
        }
        function textValue(value) { return value == null ? '—' : typeof value === 'object' ? JSON.stringify(value) : String(value); }
        function canEditField(id) {
            if (writeLocked()) return false;
            var p=state.settings && state.settings.profiles.find(function(p){return p.id===state.settings.activeProfileId;});
            return id!=='assignee' || !!p && p.allowAssignee===true;
        }
        function writeLocked() {var d=state && state.draft;return !!d && (!!d.creation.issueKey || ['submitting','unknown','created'].indexOf(d.creation.status)!==-1);}
        function connectionLocked() {return !!stages[state.stage] || writeLocked() || !!state.draft && state.draft.creation.status==='preflight';}
        function closeConnection() {
            if (!connectionHost) return;
            connectionHost.find('input').val('');connectionHost.prop('hidden',true);
            connectionHost.find('[data-ta-connection-dialog]').prop('hidden',true);
            root.children().prop('inert',false);root.find('[data-ta-open-connection]').trigger('focus');
        }
        function openConnection() {
            if (connectionLocked() || !options.connection) return;
            var shared=options.connection.shared, storage=options.connection.storage, existing;
            try {existing=shared.readStoredConfig(storage) || {};} catch (ignored) {existing={};}
            if (!connectionHost) {
                var uid='ta-connection-'+(++connectionSequence);
                connectionHost=$('<div data-ta-connection hidden>');root.append(connectionHost);
                var dialog=$('<section class="ta-settings-dialog ta-connection-dialog" data-ta-connection-dialog role="dialog" aria-modal="true" hidden>').attr('aria-labelledby',uid);
                connectionHost.append(dialog);
                dialog.append($('<header class="ta-settings-header">').append($('<h3>').attr('id',uid).text('Подключение AI'),button('Закрыть','X',{'data-ta-connection-close':''}).on('click',closeConnection)));
                var body=$('<div class="ta-settings-body">').append($('<p class="ta-muted">').text('Подключение общее с другими виджетами в этом браузере.'));
                [['API Base URL','base','text'],['Модель','model','text'],['API key','key','password']].forEach(function(field) {
                    var input=$('<input>').attr({type:field[2],autocomplete:'off',spellcheck:'false'}).attr('data-ta-connection-'+field[1],'');
                    body.append($('<label>').append($('<span>').text(field[0]),input));
                });
                body.append($('<label class="ta-connection-protocol">').append($('<input type="checkbox" data-ta-connection-legacy>'),$('<span>').text('Legacy /completions')),
                    $('<p class="ta-errors" data-ta-connection-error role="alert">'));
                dialog.append(body,$('<footer class="ta-settings-footer">').append(
                    button('Отмена','X',{'data-ta-connection-cancel':''}).on('click',closeConnection),
                    button('Сохранить','Check',{'data-ta-connection-save':''}).addClass('ta-primary').on('click',saveConnection)));
                dialog.on('keydown',function(event) {
                    if (event.key==='Escape') {event.preventDefault();event.stopPropagation();closeConnection();}
                    if (event.key==='Tab') {
                        var controls=dialog.find('button,input').filter(function() {return !this.disabled;}).toArray();
                        var first=controls[0],last=controls[controls.length-1];
                        if (event.shiftKey && document.activeElement===first) {event.preventDefault();last.focus();}
                        else if (!event.shiftKey && document.activeElement===last) {event.preventDefault();first.focus();}
                    }
                });
            }
            connectionHost.find('[data-ta-connection-base]').val(existing.apiBase || '');
            connectionHost.find('[data-ta-connection-model]').val(existing.model || '');
            connectionHost.find('[data-ta-connection-key]').val(existing.apiKey || '');
            connectionHost.find('[data-ta-connection-legacy]').prop('checked',!!existing.useLegacyCompletionsEndpoint);
            connectionHost.find('[data-ta-connection-error]').empty();
            root.children().not(connectionHost).prop('inert',true);
            connectionHost.prop('hidden',false).find('[data-ta-connection-dialog]').prop('hidden',false);
            connectionHost.find('[data-ta-connection-base]').trigger('focus');
        }
        function saveConnection() {
            if (connectionLocked() || !options.connection) return;
            var shared=options.connection.shared, storage=options.connection.storage, config;
            var error=connectionHost.find('[data-ta-connection-error]');
            try {
                var previous=shared.readStoredConfig(storage) || {};
                config=shared.normalizeConfig({apiBase:connectionHost.find('[data-ta-connection-base]').val(),
                    model:connectionHost.find('[data-ta-connection-model]').val(),apiKey:connectionHost.find('[data-ta-connection-key]').val(),
                    basePrompt:previous.basePrompt || '',useLegacyCompletionsEndpoint:connectionHost.find('[data-ta-connection-legacy]').prop('checked')});
                if (!config) throw new Error('invalid');
                var url=new URL(config.apiBase);
                if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('invalid');
            } catch (ignored) {error.text('Заполните корректный API Base URL (http/https), модель и ключ.');return;}
            try {
                if (!storage || typeof storage.setItem!=='function' || typeof storage.getItem!=='function') throw new Error('storage');
                shared.writeStoredConfig(storage,config);
                // Shared writer also accepts missing storage; confirm durable read-back here.
                if (JSON.stringify(shared.readStoredConfig(storage))!==JSON.stringify(config)) throw new Error('storage');
            } catch (ignored) {error.text('Не удалось сохранить подключение: хранилище браузера недоступно.');return;}
            c.connectionChanged();closeConnection();
        }
        function invoke(name, argument) {
            lastOperation = {name:name, argument:argument};
            return argument === undefined ? c[name]() : c[name](argument);
        }
        function fieldName(id) {
            var found;
            (state.meta && state.meta.issueTypes || []).some(function(t) {found = t.fields.find(function(f) {return f.id === id;}); return !!found;});
            return found ? found.name + ' (' + id + ')' : id;
        }
        function eligibleFields() {
            var result = new Map(), d = state.draft;
            var profile = state.settings && state.settings.profiles.find(function(p) {return p.id === state.settings.activeProfileId;});
            var selectedTemplate = profile && profile.templates.find(function(t) {return t.id === d.templateId;});
            (state.meta && state.meta.issueTypes || []).forEach(function(t) {
                if (t.subtask || d.issueTypeId && t.id !== d.issueTypeId || selectedTemplate && selectedTemplate.issueTypeId && t.id !== selectedTemplate.issueTypeId) return;
                t.fields.forEach(function(f) {if (f.supported && f.writable && f.kind !== 'user' && f.id !== 'project' && f.id !== 'issuetype') result.set(f.id, f);});
            }); return result;
        }
        function makeSelection(host, id, name, action) {
            var view = fieldUi.create({$: $, onChange: function(unused, value) {
                var id = value ? value.id : null;
                if (action === 'selectProject') invoke(action, id); else c[action](id);
            }});
            view.mount(host); return {view: view, id: id, name: name};
        }
        function updateSelection(selection, values, value, disabled) {
            selection.view.update({field: {id: selection.id, name: selection.name, kind:'option', supported:true, writable:true, allowedValues:values}, value: value ? {id:value} : null, errors:[], disabled:disabled, removable:selection.id!=='project'});
        }
        function mount(el) {
            root = $(el).addClass('ujg-ticket-assistant');
            root.append('<header class="ta-header"><h2>Помощник задач</h2><span data-ta-profile class="ta-muted"></span></header><div class="ta-selections"><div data-ta-project></div><div data-ta-template></div><div data-ta-type></div></div><div class="ta-workspace"><section class="ta-source-area"><h3>Исходные данные</h3><label class="ta-source-label">Запрос<textarea rows="12" data-ta-source></textarea></label><div class="ta-actions" data-ta-actions></div><div data-ta-progress class="ta-progress" hidden><span data-ta-stage></span><span data-ta-elapsed aria-live="off"></span></div><div data-ta-error class="ta-error" role="alert" hidden></div><div data-ta-stopped class="ta-warning" hidden></div><div data-ta-retry-host hidden></div><section class="ta-questions"><h3>Уточнения</h3><div data-ta-questions></div></section><details class="ta-scope"><summary>Поля генерации</summary><div data-ta-scope></div><p data-ta-omitted class="ta-muted"></p><p class="ta-muted">Текущие значения проверяются и вне области генерации. Пользователи не передаются AI.</p></details></section><section class="ta-draft-area"><div class="ta-draft-heading"><h3>Черновик Jira</h3><span data-ta-checked class="ta-result" hidden>Проверен</span></div><div data-ta-fields></div><div data-ta-routes></div><div data-ta-warnings class="ta-warning" hidden></div><div data-ta-evidence></div><div data-ta-fallback class="ta-warning" hidden></div><div class="ta-actions" data-ta-copy-actions></div><textarea data-ta-copy-text aria-label="Текст для копирования" rows="5" readonly hidden></textarea><p data-ta-copy-status class="ta-muted" role="status"></p><footer class="ta-footer"><button type="button" data-ta-create disabled>Создать задачу</button><span class="ta-muted">Создание пока недоступно</span></footer></section></div><div data-ta-settings hidden></div>');
            source = root.find('[data-ta-source]').on('input', function() {c.updateSource(source.val());});
            $('<div class="ta-token-preflight" data-ta-token-preflight role="status" hidden>').append(
                '<p data-ta-token-summary></p><p class="ta-muted" data-ta-token-breakdown></p><p class="ta-muted" data-ta-token-usage hidden></p>',
                button('Бюджет контекста','Settings',{'data-ta-budget-settings':''}).on('click',openSettings)
            ).insertAfter(root.find('.ta-source-label'));
            root.find('.ta-footer').empty().append(
                button('Создать задачу','Check',{'data-ta-create':''}).addClass('ta-primary').on('click',function() {c.submit();}),
                button('Новая задача','Plus',{'data-ta-new-draft':''}).on('click',function() {c.newDraft();}));
            root.find('.ta-footer').append(button('Удалить черновик','Trash2',{'data-ta-discard-draft':''}).on('click',function() {
                discardId=state.draft && state.draft.id;root.find('[data-ta-discard-dialog]').prop('hidden',false);root.find('[data-ta-discard-cancel]').trigger('focus');
            }));
            root.find('.ta-footer').before($('<div class="ta-warning" data-ta-discard-dialog role="alertdialog" aria-label="Удалить сохранённый черновик" hidden>').append(
                $('<p>').text('Удалить исходник, поля и выбранные файлы этого черновика? Личные настройки сохранятся.'),
                button('Отмена','X',{'data-ta-discard-cancel':''}).on('click',function() {discardId=null;root.find('[data-ta-discard-dialog]').prop('hidden',true);root.find('[data-ta-discard-draft]').trigger('focus');}),
                button('Удалить черновик навсегда','Trash2',{'data-ta-discard-draft-confirm':''}).on('click',function() {
                    if (state.draft && state.draft.id===discardId) c.discardDraft(true);
                    discardId=null;root.find('[data-ta-discard-dialog]').prop('hidden',true);
                })));
            root.find('.ta-footer').before('<section class="ta-attachments"><h3>Вложения</h3><label>Выбрать файлы<input type="file" multiple data-ta-files></label><div data-ta-file-list></div></section><div data-ta-creation role="status"></div><div data-ta-reconcile hidden><label>Ключ найденной задачи<input data-ta-found-key placeholder="DEMO-123"></label><label><input type="checkbox" data-ta-reconcile-confirm> Я сверил результат создания в Jira</label><div class="ta-actions" data-ta-reconcile-actions></div></div>');
            root.find('[data-ta-files]').on('change',function() {c.selectFiles(this.files);this.value='';});
            root.find('[data-ta-reconcile-actions]').append(
                button('Задача найдена','Check',{'data-ta-found':''}).on('click',function() {if(root.find('[data-ta-reconcile-confirm]').prop('checked')) c.reconcileUnknown('found',root.find('[data-ta-found-key]').val());}),
                button('Подтверждаю: задача не создана','RefreshCw',{'data-ta-not-created':''}).on('click',function() {if(root.find('[data-ta-reconcile-confirm]').prop('checked')) c.reconcileUnknown('confirmed-not-created');}));
            root.find('[data-ta-reconcile-confirm]').on('change',function() {root.find('[data-ta-reconcile-actions] button').prop('disabled',!this.checked);});
            root.find('.ta-header').append(button('Настройки', 'Settings', {'data-ta-open-settings':''}).on('click',openSettings));
            root.find('.ta-header').append(button('Подключение AI','Settings',{'data-ta-open-connection':''}).on('click',openConnection));
            project = makeSelection(root.find('[data-ta-project]'), 'project', 'Проект', 'selectProject');
            template = makeSelection(root.find('[data-ta-template]'), 'template', 'Шаблон', 'selectTemplate');
            type = makeSelection(root.find('[data-ta-type]'), 'issuetype', 'Тип Jira', 'selectIssueType');
            root.find('[data-ta-actions]').append(
                button('Подготовить', 'WandSparkles', {'data-ta-prepare':''}).addClass('ta-primary').on('click', function() {invoke('prepare');}),
                button('Проверить', 'Check', {'data-ta-check':''}).on('click', function() {invoke('check');}),
                button('Остановить', 'Square', {'data-ta-stop':''}).on('click', function() {c.cancel();}));
            root.find('[data-ta-retry-host]').append(button('Повторить', 'RefreshCw', {'data-ta-retry':''}).on('click', function() {
                if (!state.draft) c.init();
                else if (writeLocked() && !state.meta) c.selectProject(state.draft.projectKey);
                else invoke(lastOperation.name, lastOperation.argument);
            }));
            root.find('[data-ta-copy-actions]').append(
                button('Копировать тему', null, {'data-ta-copy':'summary'}).on('click', function() {copy('summary');}),
                button('Копировать описание', null, {'data-ta-copy':'description'}).on('click', function() {copy('description');}));
            fieldsHost = root.find('[data-ta-fields]'); questionsHost = root.find('[data-ta-questions]'); scopeHost = root.find('[data-ta-scope]');
            root.find('[data-ta-omitted]').insertAfter(root.find('.ta-scope'));
            update(c.getState());
        }
        function copy(id) {
            if (!state.draft) return;
            var text = state.draft.fields[id] == null ? '' : String(state.draft.fields[id]);
            var area = root.find('[data-ta-copy-text]').prop('hidden', false).val(text); area[0].focus(); area[0].select();
            root.find('[data-ta-copy-status]').text('Текст выделен для копирования.');
            if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
                Promise.resolve().then(function() {return navigator.clipboard.writeText(text);}).then(function() {
                    if (!dead) root.find('[data-ta-copy-status]').text('Скопировано.');
                }, function() {if (!dead) root.find('[data-ta-copy-status]').text('Копирование недоступно. Текст можно выделить вручную.');});
            }
        }
        function renderFields(d, busy) {
            fieldsHost.children('[data-ta-recovery-value],[data-ta-recovery-note]').remove();
            if (!state.meta && writeLocked()) {
                fields.forEach(function(entry) {entry.view.destroy();entry.host.remove();});fields.clear();
                fieldsHost.append($('<p class="ta-muted" data-ta-recovery-note>').text(state.stage==='metadata' ? 'Загрузка metadata Jira. Сохранённые значения доступны только для чтения.' : 'metadata Jira недоступны. Сохранённые значения доступны только для чтения; результат создания требует сверки.'));
                var names={summary:'Тема',description:'Описание'};
                Object.keys(d.fields).forEach(function(id) {
                    fieldsHost.append($('<div data-ta-recovery-value>').append($('<strong>').text(names[id] || id),$('<p>').text(textValue(d.fields[id]))));
                });
                return;
            }
            var issue = state.meta && state.meta.issueTypes.find(function(t) {return t.id === d.issueTypeId;});
            var list = issue ? issue.fields.filter(function(f) {return f.id !== 'project' && f.id !== 'issuetype';}) : [];
            // Reorder only this display projection; Meta and its signature remain exact.
            list = ['summary', 'description'].map(function(id) {return list.find(function(f) {return f.id === id;});}).filter(Boolean)
                .concat(list.filter(function(f) {return f.id !== 'summary' && f.id !== 'description';}));
            Object.keys(d.fields).concat(Object.keys(d.pendingFields)).forEach(function(id) {
                if (id !== 'project' && id !== 'issuetype' && !list.some(function(f) {return f.id === id;}))
                    list.push({id:id,name:id + ' (нет в текущих metadata)',kind:'unknown',supported:false,writable:false,required:false,allowedValues:[]});
            });
            var ids = new Set(list.map(function(f) {return f.id;}));
            fields.forEach(function(entry, id) {if (!ids.has(id)) {entry.view.destroy(); entry.host.remove(); fields.delete(id);}});
            list.forEach(function(field) {
                var entry = fields.get(field.id);
                if (!entry) {
                    var host = $('<div>').attr('data-ta-field', field.id), pending = $('<div class="ta-pending" hidden>');
                    var editor = $('<div>'); host.append(editor, pending); fieldsHost.append(host);
                    var view = fieldUi.create({$: $, onChange: function(id, value) {if(canEditField(id)) c.updateField(id, value);},
                        onSearch:function(query,field,request){
                            if(!canEditField(field.id) || !options.onSearch) return Promise.resolve({values:[]});
                            return Promise.resolve(options.onSearch(query,field,request)).then(function(result){return canEditField(field.id)?result:{values:[]};});
                        }});
                    view.mount(editor); entry = {host:host, view:view, pending:pending, pendingKey:null}; fields.set(field.id, entry);
                }
                var profile = state.settings && state.settings.profiles.find(function(p) {return p.id === state.settings.activeProfileId;});
                entry.view.update({field:field, value:d.fields[field.id], errors:state.validation && state.validation.fieldErrors[field.id] || [],
                    disabled:writeLocked() || field.id === 'assignee' && (!profile || !profile.allowAssignee), selectedUsers:[]});
                if(field.id==='assignee') entry.host.find('[data-ta-search],[data-ta-candidate]').prop('disabled',!canEditField(field.id));
                entry.host.find('[data-ta-policy-block]').remove();
                entry.host.find('[data-ta-field-exclusion]').remove();
                var unavailable=fieldUi.catalogUnavailable(field),obsolete=!field.supported || !field.writable;
                if ((obsolete || unavailable && !field.required) && (Object.prototype.hasOwnProperty.call(d.fields,field.id) || Object.prototype.hasOwnProperty.call(d.pendingFields,field.id)))
                    entry.host.append($('<div data-ta-field-exclusion class="ta-warning">').append($('<p>').text('Поле недоступно для отправки. Значение можно сохранить в исходнике и явно исключить из полей.'),
                        button('Сохранить в исходнике и исключить поле','Trash2',{'data-ta-discard-field':field.id}).prop('disabled',!!writeLocked()).on('click',function() {c.discardField(field.id);} )));
                if (field.id === 'assignee' && (!profile || !profile.allowAssignee) && Object.prototype.hasOwnProperty.call(d.fields,field.id)) {
                    entry.host.append($('<div data-ta-policy-block class="ta-warning">').append($('<p>').text('Выбор исполнителя запрещён профилем. Сохранённое значение не будет отправлено без разрешения. Можно разрешить выбор в настройках или исключить поле.'),
                        button('Не отправлять исполнителя','Trash2',{'data-ta-discard-field':field.id}).on('click',function(){c.discardField(field.id);} )));
                }
                var hasPending = Object.prototype.hasOwnProperty.call(d.pendingFields, field.id);
                var pendingKey = hasPending ? JSON.stringify(d.pendingFields[field.id]) : null;
                entry.pending.prop('hidden', !hasPending);
                if (entry.pendingKey !== pendingKey) {
                    entry.pending.empty(); entry.pendingKey = pendingKey;
                    if (hasPending) entry.pending.append($('<p>').text('Предлагаемое изменение: ' + textValue(d.pendingFields[field.id])),
                        button('Принять изменение', 'Check', {'data-ta-accept':field.id}).on('click', function() {c.acceptField(field.id);}));
                }
                entry.pending.find('button').prop('disabled', busy);
            });
            if (!list.length) fieldsHost.attr('data-empty', 'Выберите тип Jira'); else fieldsHost.removeAttr('data-empty');
        }
        function renderQuestions(d) {
            var ids = new Set(d.questions.map(function(q) {return q.id;}));
            questions.forEach(function(entry, id) {if (!ids.has(id)) {entry.host.remove(); questions.delete(id);}});
            d.questions.forEach(function(q) {
                var entry = questions.get(q.id);
                if (!entry) {
                    var host = $('<div class="ta-question">').attr('data-ta-question', q.id);
                    var title = $('<span>'), reason = $('<p class="ta-muted">'), input = $('<textarea rows="2">').attr('aria-label', q.text);
                    host.append($('<label>').append(title, input), reason, button('Добавить ответ', 'Check').on('click', function() {
                        var answer = Object.create(null); answer[q.id] = input.val(); c.answer(answer);
                    })); questionsHost.append(host); entry = {host:host, title:title, reason:reason}; questions.set(q.id, entry);
                }
                entry.title.text(q.text + (q.required ? ' *' : '')); entry.reason.text(q.reason);
            });
            questionsHost.attr('data-empty', d.questions.length ? '' : 'Нет открытых вопросов');
        }
        function renderScope(d) {
            var eligible = eligibleFields();
            // Keep stale explicit IDs visible so the user can remove them after metadata changes.
            (state.generationFieldIds || []).forEach(function(id) {if (!eligible.has(id)) eligible.set(id, {id:id,name:fieldName(id)});});
            scope.forEach(function(entry, id) {if (!eligible.has(id)) {entry.host.remove(); scope.delete(id);}});
            eligible.forEach(function(field, id) {
                var entry = scope.get(id);
                if (!entry) {
                    var input = $('<input type="checkbox">').attr('data-ta-generation', id);
                    var name = $('<span>'), host = $('<label class="ta-scope-option">').append(input, name); scopeHost.append(host);
                    input.on('change', function() {
                        var selected = (state.generationFieldIds || []).filter(function(value) {return value !== id;});
                        if (input.prop('checked')) selected.push(id); c.setGenerationFields(selected);
                    }); entry = {host:host, input:input, name:name}; scope.set(id, entry);
                }
                entry.name.text(field.name + ' (' + id + ')'); entry.input.prop('checked', (state.generationFieldIds || []).indexOf(id) !== -1);
            });
            var excluded = state.contextScope && state.contextScope.excludedFieldIds || [];
            root.find('[data-ta-omitted]').text('Каталоги вне генерации: ' + (excluded.length ? excluded.map(fieldName).join(', ') : 'нет') + '.');
        }
        function renderStatus() {
            var busy = !!stages[state.stage], progress = root.find('[data-ta-progress]');
            progress.prop('hidden', !busy); root.find('[data-ta-stage]').text(stages[state.stage] || '');
            function tick() {if (!dead && state.startedAt != null) root.find('[data-ta-elapsed]').text(Math.max(0, Math.floor((Date.now() - state.startedAt) / 1000)) + ' с');}
            if (busy) {tick(); if (!timer) timer = setInterval(tick, 1000);} else if (timer) {clearInterval(timer); timer = null;}
            var error = root.find('[data-ta-error]').empty().prop('hidden', !state.error);
            if (state.error) {
                error.append($('<p>').text(state.error.message));
                var detail = state.error.details;
                if (state.error.code === 'limit') {
                    if (detail && ['input','available','reserve'].every(function(k) {return Number.isSafeInteger(detail[k]) && detail[k] >= 0;}))
                        error.append($('<p>').text('Приблизительно ' + detail.input + ' токенов / ' + detail.available + ' на вход; резерв ответа ' + detail.reserve + '.'));
                    error.append(button('Открыть бюджет контекста','Settings',{'data-ta-error-budget':''}).on('click',openSettings));
                }
            }
            root.find('[data-ta-stopped]').prop('hidden', state.stage !== 'stopped').text('Остановлено. Черновик сохранён.');
            root.find('[data-ta-retry-host]').prop('hidden', busy || (!state.error && state.stage !== 'stopped'));
            root.find('[data-ta-stop]').prop('hidden', !busy);
            root.find('[data-ta-prepare]').prop('disabled', writeLocked() || busy || !state.draft || !state.draft.source.trim());
            root.find('[data-ta-check]').prop('disabled', writeLocked() || busy || !state.draft || !state.draft.issueTypeId || !state.draft.templateId);
            root.find('[data-ta-checked]').prop('hidden', !state.draft || !state.draft.checked);
        }
        function renderCreation() {
            var d=state.draft, creation=d && d.creation, status=creation && creation.status, locked=writeLocked();
            root.find('[data-ta-create]').prop('disabled',!d || !d.checked || locked || status==='preflight' || !!stages[state.stage] || !!state.error);
            var editable=d && !locked && ['idle','rejected'].indexOf(status)!==-1 && !stages[state.stage];
            root.find('[data-ta-discard-draft]').prop('disabled',!editable);
            root.find('[data-ta-discard-draft-confirm]').prop('disabled',!editable);
            if (!editable || discardId && (!d || discardId!==d.id)) {discardId=null;root.find('[data-ta-discard-dialog]').prop('hidden',true);}
            root.find('[data-ta-new-draft]').prop('hidden',status!=='created').prop('disabled',d && d.attachments.some(function(a) {return a.status==='uploading';}));
            var host=root.find('[data-ta-creation]').empty();
            var labels={preflight:'Предварительная проверка Jira и файлов…',submitting:'Создание отправлено. Ожидаем результат; остановка не отменяет запись.',created:'Задача создана.',rejected:'Создание отклонено.',unknown:'Результат неизвестен. Повторное создание заблокировано до сверки с Jira.'};
            if (status==='rejected' && d.checked) labels.rejected='Предыдущая попытка создания отклонена. Исправленный черновик проверен; новая попытка требует явного создания.';
            if (creation) {
                if (labels[status]) host.append($('<p>').text(labels[status]));
                if (creation.error) host.append($('<p class="ta-warning">').text(creation.error));
                if (creation.issueKey && /^[A-Za-z][A-Za-z0-9_]*-\d+$/.test(creation.issueKey)) host.append($('<a data-ta-issue-link target="_blank" rel="noopener">').attr('href',(options.baseUrl || '').replace(/\/+$/,'')+'/browse/'+encodeURIComponent(creation.issueKey)).text(creation.issueKey));
                if (status==='idle' && creation.error && d.attachments.length) host.append(
                    button('Повторить проверку файлов','RefreshCw',{'data-ta-files-check':''}).on('click',function() {c.submit();}),
                    button('Создать без вложений','Check',{'data-ta-without-files':''}).on('click',function() {c.submit({withoutAttachments:true});}));
            }
            root.find('[data-ta-reconcile]').prop('hidden',status!=='unknown' || !!creation.issueKey);
            root.find('[data-ta-reconcile-actions] button').prop('disabled',!root.find('[data-ta-reconcile-confirm]').prop('checked'));
            root.find('[data-ta-files]').prop('disabled',!d || status==='submitting' || status==='unknown' || status==='preflight');
            var list=root.find('[data-ta-file-list]').empty();
            var fileLabels={pending:'Ожидает загрузки',uploading:'Загружается',uploaded:'Загружен',failed:'Ошибка загрузки',unknown:'Результат загрузки неизвестен'};
            (d && d.attachments || []).forEach(function(a) {
                var row=$('<div class="ta-file">').append($('<span>').text(a.name+' · '+a.size+' B · '+(fileLabels[a.status] || a.status)+(a.needsReselect?' · выберите файл повторно':'')));
                if(a.error)row.append($('<p class="ta-warning">').text(a.error));
                if(!locked)row.append(button('Удалить файл','Trash2',{'data-ta-file-remove':a.id}).on('click',function() {c.removeFile(a.id);}));
                if(creation.issueKey && ['pending','failed','unknown'].indexOf(a.status)!==-1) row.append(
                    button(a.status==='unknown'?'Сверить вложения в Jira':'Повторить файл','RefreshCw',{'data-ta-file-retry':a.id}).on('click',function() {c.retryAttachment(a.id);}));
                list.append(row);
            });
        }
        function update(next) {
            if (dead || !root) return; state = next;
            var d = state.draft, busy = !!stages[state.stage];
            var key = d ? d.id : null;
            if (key !== selectionKey) {
                fields.forEach(function(entry) {entry.view.destroy(); entry.host.remove();}); fields.clear();
                fieldsHost.children('[data-ta-recovery-value],[data-ta-recovery-note]').remove();
                questions.forEach(function(entry) {entry.host.remove();}); questions.clear(); selectionKey = key;
                scope.forEach(function(entry) {entry.host.remove();}); scope.clear(); root.find('[data-ta-omitted]').text('');
                root.find('[data-ta-copy-text]').val('').prop('hidden', true); root.find('[data-ta-copy-status]').text('');
                root.find('[data-ta-found-key]').val('');root.find('[data-ta-reconcile-confirm]').prop('checked',false);
            }
            if (source.val() !== (d ? d.source : '')) source.val(d ? d.source : ''); source.prop('disabled', !d || writeLocked());
            var profile = state.settings && state.settings.profiles.find(function(p) {return p.id === state.settings.activeProfileId;});
            root.find('[data-ta-profile]').text(profile ? profile.name : '');
            root.find('[data-ta-open-settings]').prop('disabled',!state.settings || writeLocked());
            root.find('[data-ta-budget-settings],[data-ta-error-budget]').prop('disabled',!state.settings || writeLocked());
            var estimate=state.tokenPreflight, counter=root.find('[data-ta-token-preflight]');
            counter.prop('hidden',!estimate);
            if (estimate) {
                counter.toggleClass('ta-budget-over',!estimate.fits || !estimate.safetyFits);
                root.find('[data-ta-token-summary]').text('Приблизительно ' + estimate.input + ' / ' + estimate.available + ' токенов на вход' + (!estimate.fits ? ' · Бюджет превышен' : '') + (!estimate.safetyFits ? ' · Превышен защитный размер передачи 4 МиБ' : ''));
                root.find('[data-ta-token-breakdown]').text('Инструкции ' + estimate.instructions + ' · Текст ' + estimate.source + ' · Поля Jira и служебные данные ' + estimate.metadata + ' · Резерв ответа ' + estimate.reserve + '. Консервативная оценка; токенизатор неизвестен.');
                var usage=state.providerUsage;
                root.find('[data-ta-token-usage]').prop('hidden',!usage).text(usage ? 'Последний запрос · Точно по usage провайдера: вход ' + (usage.inputTokens===null ? 'нет данных' : usage.inputTokens) + ', ответ ' + (usage.outputTokens===null ? 'нет данных' : usage.outputTokens) + ', всего ' + (usage.totalTokens===null ? 'нет данных' : usage.totalTokens) + '.' : '');
            }
            root.find('[data-ta-open-connection]').prop('disabled',connectionLocked() || !options.connection);
            if (connectionHost) connectionHost.find('input,[data-ta-connection-save]').prop('disabled',connectionLocked());
            updateSelection(project, (state.projects || []).map(function(p) {return {id:p.key,label:p.name + ' · ' + p.key};}), d && d.projectKey, false);
            updateSelection(template, (profile && profile.templates || []).map(function(t) {return {id:t.id,label:t.name};}), d && d.templateId, !d || writeLocked());
            updateSelection(type, (state.meta && state.meta.issueTypes || []).filter(function(t) {return !t.subtask;}).map(function(t) {return {id:t.id,label:t.name,iconUrl:t.iconUrl};}), d && d.issueTypeId, !d || writeLocked());
            if (d) {renderFields(d, busy); renderQuestions(d); renderScope(d);}
            var routes = root.find('[data-ta-routes]').empty();
            (state.routeCandidates || []).forEach(function(pair) {
                var issue = state.meta && state.meta.issueTypes.find(function(t) {return t.id === pair.issueTypeId;});
                var tmpl = profile && profile.templates.find(function(t) {return t.id === pair.templateId;});
                routes.append($('<p>').text((issue ? issue.name : pair.issueTypeId) + ' / ' + (tmpl ? tmpl.name : pair.templateId) + ': ' + pair.reason),
                    button('Выбрать вариант', 'Check').on('click', function() {c.selectIssueType(pair.issueTypeId).then(function() {return c.selectTemplate(pair.templateId);});}));
            });
            var warnings = d ? d.warnings.concat(state.validation && state.validation.warnings || []).filter(function(w, index, all) { return all.indexOf(w) === index; }) : [];
            root.find('[data-ta-warnings]').prop('hidden', !warnings.length).text(warnings.join('\n'));
            var evidence = root.find('[data-ta-evidence]').empty();
            (d && d.evidence || []).forEach(function(e) {evidence.append($('<p class="ta-muted">').text((e.kind === 'source' ? 'Из источника: ' : 'Предположение: ') + fieldName(e.fieldId) + ' — ' + e.quote));});
            var blocked = !writeLocked() && state.validation && state.validation.unsupportedRequired || [];
            var fallback = root.find('[data-ta-fallback]').empty().prop('hidden', !blocked.length);
            blocked.forEach(function(id) {fallback.append($('<p>').text(fieldName(id) + ': ' + ((state.validation.fieldErrors[id] || []).join(' ') || 'Обязательное поле не поддерживается.')));});
            if (blocked.length && d && state.meta) {
                var href = (options.baseUrl || '').replace(/\/+$/, '') + '/secure/CreateIssue!default.jspa?pid=' + encodeURIComponent(state.meta.projectId) + '&issuetype=' + encodeURIComponent(d.issueTypeId || '');
                fallback.append($('<a data-ta-jira-form target="_blank" rel="noopener">').attr('href', href).append(icon('ExternalLink'), $('<span>').text('Открыть форму Jira')));
            }
            root.find('[data-ta-copy]').prop('disabled', !d); renderStatus();renderCreation();
            root.find('[data-ta-questions] textarea,[data-ta-questions] button,[data-ta-scope] input,[data-ta-accept],[data-ta-discard-field]').prop('disabled',!!writeLocked());
        }
        function openSettings() {
            if (!state.settings || writeLocked()) return;
            var host = root.find('[data-ta-settings]').prop('hidden', false);
            if (!settingsScope) settingsScope=state.draft.id;
            root.children().not(host).prop('inert',true);
            function settingsScopeError() {
                return !state.draft || state.draft.id!==settingsScope ? {error:{code:'scope',message:'Изменилась область проекта или пользователя. Закройте окно и откройте настройки текущего проекта.'}} : null;
            }
            if (options.createSettingsView && !settingsView) {settingsView = options.createSettingsView({$: $, controller:c}); settingsView.mount(host[0]);}
            else if (!settingsView) settingsView = settingsUi.create({$: $,host:host,
                onApply:function(settings,options){return settingsScopeError() || (options.resolveConflict ? c.resolveSettingsConflict(settings) : c.applySettings(settings));},
                onLoadSaved:function(){return settingsScopeError() || c.loadSavedSettings();},onClose:function(){host.prop('hidden',true);root.children().prop('inert',false);settingsScope=null;root.find('[data-ta-open-settings]').trigger('focus');}});
            if (settingsView.open) settingsView.open({settings:state.settings,meta:state.meta,conflict:state.error && state.error.code==='conflict',returnFocus:root.find('[data-ta-open-settings]')[0]});
            return host[0];
        }
        function destroy() {
            if (dead) return; dead = true; if (timer) clearInterval(timer); timer = null;
            [project, template, type].forEach(function(s) {if (s) s.view.destroy();});
            fields.forEach(function(entry) {entry.view.destroy();}); fields.clear();
            if (settingsView) settingsView.destroy(); if (root) root.empty();
        }
        return {mount:mount, update:update, openSettings:openSettings, destroy:destroy};
    }
    return {create:create};
});
