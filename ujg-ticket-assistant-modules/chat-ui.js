define('_ujgTA_chatUi', ['_ujgTA_icons'], function(icon) {
    'use strict';
    function create(options) {
        var $=options.$,c=options.controller,chat=options.chat,root,host,log,input,card,proposal,state,dead=false;
        var transcriptKey=null,proposalKey=null,cardKey=null,pendingKey=null,scope=null,lastSent='',sending=false,retryReconcileScope=null;
        var messageRows=new Map(),expandedDrafts=new Map(),lastFields=null,changedFields=[],jiraRetrying=false,reconciling=false;
        var localCheck=null;
        var liveEditor=false,chatLayout=null,releaseEditor=null;
        var assigneeHost,assigneeRequest=null,assigneePicker=null;
        function cancelAssignee() {
            if(assigneeRequest)assigneeRequest.abort.abort();assigneeRequest=null;
            if(assigneePicker)assigneePicker.destroy();assigneePicker=null;
            if(assigneeHost)assigneeHost.empty().prop('hidden',true);
        }
        function assigneeContext() {
            var next=c.getState(),d=next.draft;
            return d && JSON.stringify([d.projectKey,d.id,d.issueTypeId,d.templateId,next.meta,d.fields,d.protectedFields,next.settings,next.stage,next.error,d.creation]);
        }
        function assigneeField() {
            var next=c.getState(),d=next.draft,p=next.settings && next.settings.profiles.find(function(p){return p.id===next.settings.activeProfileId;}),
                type=d && next.meta && next.meta.projectKey===d.projectKey && next.meta.issueTypes.find(function(t){return t.id===d.issueTypeId;}),
                field=type && type.fields.find(function(f){return f.id==='assignee';});
            return p && p.allowAssignee===true && d && !locked(d) && !next.error && next.stage!=='metadata' && field && field.kind==='user' && field.supported && field.writable ? field : null;
        }
        function assigneeIntent(text) {
            // Only explicit commands/clauses are interpreted locally; mentions in prose are not authority.
            var rest=[],intent=null;
            String(text).trim().split(/\s*[;\n]\s*/).forEach(function(clause){
                if(/^(?:без исполнителя|сними исполнителя|убери исполнителя|unassign(?:ed)?)\s*[.!]?$/i.test(clause)){intent={clear:true};return;}
                var match=/^(?:назначь(?:те)?(?:\s+(?:задачу|исполнителя))?\s+на\s+|исполнитель\s*:\s*|assignee\s*:\s*|assign\s+(?:to\s+)?)(.+?)\s*[.!]?$/i.exec(clause);
                if(!match && /^(?:на меня|на себя)\s*[.!]?$/i.test(clause))match=[clause,'меня'];
                if(!match){rest.push(clause);return;}
                var query=match[1].trim().replace(/^[«"']|[»"']$/g,'');
                intent={query:query,self:/^(?:меня|себя|me|myself)$/i.test(query),clear:/^(?:никого|без исполнителя|unassigned|none)$/i.test(query)};
            });
            if(intent)intent.rest=rest.join('\n');return intent;
        }
        function assigneeNotice(text) {assigneeHost.empty().prop('hidden',false).append($('<p role="status">').text(text));}
        function verifiedUsers(result) {
            var seen=new Set();
            return (Array.isArray(result)?result:result && result.values || []).filter(function(user){
                if(!user || user.active===false || typeof user.name!=='string' || !user.name.trim() || user.name.trim()!==user.name || seen.has(user.name))return false;
                seen.add(user.name);return true;
            }).map(function(user){return {name:user.name,displayName:typeof user.displayName==='string'?user.displayName:user.name};});
        }
        async function fillAssignee(intent) {
            var next=c.getState(),profile=next.settings && next.settings.profiles.find(function(p){return p.id===next.settings.activeProfileId;});
            var requestedScope=JSON.stringify([next.draft.projectKey,next.draft.id]);
            function continueTask() {
                var d=c.getState().draft;
                if(!dead && d && JSON.stringify([d.projectKey,d.id])===requestedScope && intent.rest && input.val()===intent.rest && !locked(d) && !sending && chat.getState().status!=='running')sendText(intent.rest);
            }
            if(!profile || profile.allowAssignee!==true) {
                assigneeNotice('Выбор исполнителя отключён активным профилем. Настройки → Профили → активный профиль → «Разрешить ручной выбор исполнителя». Назначение определят правила Jira.');
                assigneeHost.append(button('Открыть настройки','Settings',{'data-ta-assignee-settings':''},function(){options.editor.openSettings();}));continueTask();return;
            }
            var field=assigneeField();
            if(!field){assigneeNotice('Поле исполнителя недоступно. Проверьте тип задачи и поля в редакторе.');return;}
            if(intent.clear && field.required){assigneeNotice('Исполнитель обязателен в Jira; оставить задачу без исполнителя нельзя.');return;}
            var request={abort:new AbortController(),context:assigneeContext()};assigneeRequest=request;
            function current(){return !dead && assigneeRequest===request && !request.abort.signal.aborted && request.context===assigneeContext() && !!assigneeField();}
            function apply(value) {
                if(!current())return;
                cancelAssignee();c.updateField('assignee',value);
                var edited=c.getState().draft;
                if(!edited || JSON.stringify(edited.fields.assignee)!==JSON.stringify(value) || edited.protectedFields.assignee!==true){assigneeNotice('Не удалось сохранить исполнителя. Текст задачи оставлен в поле сообщения.');return;}
                assigneeNotice(value?'Исполнитель выбран в Jira: '+value.name+'.':'Явно выбрано: без исполнителя. Jira проверит возможность при создании.');
                continueTask();
            }
            if(intent.clear){apply(null);return;}
            assigneeNotice('Проверяю пользователя в Jira…');
            assigneeHost.append(button('Отменить поиск','X',{'data-ta-assignee-cancel':''},cancelAssignee));
            try {
                var result=intent.self?await options.getCurrentUser({signal:request.abort.signal}):await options.onSearch(intent.query,field,{signal:request.abort.signal});
                if(!current())return;
                var users=verifiedUsers(intent.self?[result]:result),exact=users.filter(function(user){return intent.self || user.name.toLowerCase()===intent.query.toLowerCase();});
                if(!exact.length && result && result.complete===true)exact=users.filter(function(user){return user.displayName.toLowerCase()===intent.query.toLowerCase();});
                if(exact.length===1){apply({name:exact[0].name});return;}
                if(!users.length){assigneeNotice('Пользователь не найден в Jira. Уточните имя или логин; исполнитель не изменён.');return;}
                assigneeNotice('Выберите подтверждённого пользователя Jira. Результаты поиска остаются только в этом интерфейсе.');
                if(typeof options.createAssigneePicker!=='function'){assigneeHost.append(button('Выбрать в редакторе','Settings',{},function(){openEditor(this);}));return;}
                var pickerHost=$('<div data-ta-assignee-picker>').appendTo(assigneeHost);
                assigneePicker=options.createAssigneePicker({$: $,onSearch:async function(query,f,opts){
                    if(!current())return {values:[]};
                    var found=query?await options.onSearch(query,f,opts):{values:users};
                    if(!current())return {values:[]};
                    users=verifiedUsers(found);return {values:users};
                },onChange:function(id,value){if(value && users.some(function(user){return user.name===value.name;}))apply(value);}});
                // Search selections are verified by the same adapter, including refined searches.
                var picker=assigneePicker;
                picker.mount(pickerHost[0]);picker.update({field:field,value:null,removable:false,errors:[],scopeKey:request.context});
                assigneeHost.append(button('Отменить выбор','X',{'data-ta-assignee-cancel':''},cancelAssignee));
            } catch(error) {
                if(current())assigneeNotice('Не удалось проверить пользователя в Jira. Повторите запрос или выберите исполнителя в редакторе.');
            }
        }
        function button(label,name,attr,action) {
            return $('<button type="button">').attr(attr || {}).append(icon(name),$('<span>').text(label)).on('click',action);
        }
        function resetReconcileRetry() {if(retryReconcileScope!==null){retryReconcileScope=null;if(!dead && host)update(c.getState());}}
        function openEditor(invoker) {cancelAssignee();resetReconcileRetry();options.editor.openEditor(invoker);}
        function run(action,keepReconcileRetry) {if(!keepReconcileRetry)resetReconcileRetry();return Promise.resolve().then(action).catch(function() {if(!dead)host.find('[data-ta-chat-error]').text('Не удалось выполнить действие. Текст сохранён; повторите действие вручную.').prop('hidden',false);});}
        // Deliberately small Markdown subset. All source text becomes text nodes;
        // Jira description is rendered separately, without Markdown conversion.
        function markdown(target,text) {
            var pattern=/(`[^`\n]+`|\*\*[^*\n]+\*\*|\[[^\]\n]+\]\(https?:\/\/[^\s)]+\))/g,offset=0,match;
            while((match=pattern.exec(text))) {
                target.append(document.createTextNode(text.slice(offset,match.index)));
                var token=match[0];
                if(token[0]==='`')target.append($('<code>').text(token.slice(1,-1)));
                else if(token.slice(0,2)==='**')target.append($('<strong>').text(token.slice(2,-2)));
                else {var parts=/^\[([^\]]+)\]\((.*)\)$/.exec(token);target.append($('<a target="_blank" rel="noopener noreferrer">').attr('href',parts[2]).text(parts[1]));}
                offset=pattern.lastIndex;
            }
            target.append(document.createTextNode(text.slice(offset)));
        }
        function assistantText(target,text) {
            var parts=/^((?:Известные факты:|\*\*Известные факты:\*\*)[\s\S]*?\r?\n)((?:Вопрос:|\*\*Вопрос:\*\*)[\s\S]*\S\s*)$/.exec(text);
            if(!parts)return markdown(target,text);
            var facts=$('<details class="ta-message-facts" data-ta-message-facts>').appendTo(target);
            facts.append($('<summary>').text('Известные факты'));
            markdown($('<div data-ta-message-facts-text>').appendTo(facts),parts[1]);
            markdown($('<div data-ta-message-question>').appendTo(target),parts[2]);
        }
        // Translate only known application notices for display. Keep persisted
        // legacy values and every conversation message verbatim.
        function noticeText(notice) {
            var text=String((typeof notice==='string'?notice:notice && notice.message) || '');
            return text.replace(/^Pico недоступен\./,'Сервис недоступен.')
                .replace(/^Pico вернул ответ неверного формата\./,'Получен ответ неверного формата.')
                .replace(/^Не удалось получить ответ Pico\./,'Не удалось получить ответ.')
                .replace(/^Ответ Pico отклонён:/,'Ответ не принят:');
        }
        function mount(el) {
            root=$(el).addClass('ta-chat-mode');
            liveEditor=typeof options.editor.mountLiveEditor==='function';
            if(liveEditor)chatLayout=$('<div class="ta-chat-workspace" data-ta-chat-workspace>').appendTo(root.children('.ta-layout'));
            host=$('<section class="ta-chat" aria-label="Подготовка задачи">').appendTo(chatLayout || root.children('.ta-layout'));
            root.find('.ta-header h2').text('Помощник по задачам');
            var newButton=button('Новый разговор','Plus',{'data-ta-chat-new':'','aria-label':'Новый разговор',title:'Новый разговор'},function() {
                cancelAssignee();run(function(){chat.stop();return c.newDraft();});
            }).addClass('ta-icon-button');
            root.find('.ta-header-tools').prepend(newButton);
            log=$('<div class="ta-chat-log" data-ta-chat-log role="log" aria-label="Сообщения" aria-live="polite" aria-relevant="additions text">').appendTo(host);
            assigneeHost=$('<section data-ta-chat-assignee aria-label="Выбор исполнителя в чате" hidden>').appendTo(host);
            card=$('<article class="ta-task-card" data-ta-task-card aria-label="Текущая задача">').appendTo(host);
            card.append('<details data-ta-card-details><summary class="ta-card-summary"><span class="ta-card-heading"><span class="ta-card-title">Задача: <span data-ta-card-summary></span></span><span data-ta-card-type class="ta-muted"></span></span><span data-ta-card-reason class="ta-muted"></span><span data-ta-card-counts class="ta-muted"></span></summary><div class="ta-card-details-body"><div data-ta-card-values></div><div data-ta-card-questions></div><div data-ta-card-pending></div></div></details><div data-ta-card-warnings class="ta-warning" role="status" hidden></div><div data-ta-card-creation role="status"></div>');
            card.find('[data-ta-card-details]').on('toggle',function(){if(scope)expandedDrafts.set(scope,this.open);});
            var actions=$('<div class="ta-actions">').appendTo(card);
            actions.append(button('Сверить с чатом','Check',{'data-ta-card-check':'',title:'Сверить поля с сохранённым разговором и проверить недостающие сведения'},reconcile),
                button('Проверить поля Jira','Check',{'data-ta-card-local-check':'',hidden:true,title:'Проверить текущие значения карточки по правилам Jira. Сообщения чата заново не обрабатываются.'},checkCurrentFields),
                button('Редактировать','Settings',{'data-ta-card-edit':''},function(){openEditor(this);}),
                button('Создать','Check',{'data-ta-card-create':''},function(){run(function(){return c.submit();});}).addClass('ta-primary'),
                button('Отменить изменение','RefreshCw',{'data-ta-card-undo':''},function(){run(function(){return chat.undo();});}));
            if(liveEditor) {
                card.addClass('ta-live-card').appendTo(chatLayout);
                var heading=$('<header class="ta-live-card-heading">').prependTo(card);
                heading.append(card.find('.ta-card-heading'),card.find('[data-ta-card-reason]'),card.find('[data-ta-card-counts]'));
                card.find('[data-ta-card-details]').prop('hidden',true);
                var editorHost=$('<div class="ta-live-editor" data-ta-live-editor>').insertBefore(card.find('[data-ta-card-warnings]'));
                releaseEditor=options.editor.mountLiveEditor(editorHost[0]);
                card.find('[data-ta-card-questions]').insertBefore(actions);
                card.find('[data-ta-card-edit],[data-ta-card-creation]').prop('hidden',true);
            }
            proposal=$('<section class="ta-template-proposal" data-ta-template-proposal aria-label="Изменение личного шаблона" hidden>').appendTo(card.find('.ta-card-details-body'));
            if(liveEditor)proposal.insertBefore(actions);
            proposal.append('<h3>Предложение для шаблона</h3><p class="ta-muted">Сохранится только после применения. Текущая версия действует до этого.</p><div class="ta-template-diff"><div><h4>Сейчас</h4><pre data-ta-template-before></pre></div><div><h4>После применения</h4><pre data-ta-template-after></pre></div></div>');
            proposal.append(button('Применить к шаблону','Check',{'data-ta-template-apply':''},function(){run(function(){return chat.applyTemplateProposal();});}),
                button('Отклонить','X',{'data-ta-template-reject':''},function(){run(function(){return chat.rejectTemplateProposal();});}));
            host.append('<p data-ta-chat-status role="status" class="ta-muted"></p><p data-ta-chat-warning class="ta-warning" hidden></p><div data-ta-chat-error class="ta-error" role="alert" hidden></div>');
            host.append($('<div data-ta-chat-rate-limit class="ta-warning" hidden>').append(
                $('<p role="status">').text('Сервис модели ограничил запросы (HTTP 429). Повторите запрос вручную позже. Точное время ожидания неизвестно.'),
                button('Повторить запрос','RefreshCw',{'data-ta-chat-rate-retry':''},retryRateLimit)));
            host.append($('<div class="ta-actions" data-ta-chat-error-actions>').append(
                button('Проверить подключение AI','Settings',{'data-ta-chat-configure':'',hidden:true},function(){resetReconcileRetry();options.editor.openConnection();}),
                button('Бюджет контекста','Settings',{'data-ta-chat-error-budget':'',hidden:true},function(){resetReconcileRetry();options.editor.openSettings();}),
                button('Продолжить в редакторе','Settings',{'data-ta-chat-error-edit':'',hidden:true},function(){openEditor(this);})));
            host.append(button('Повторить загрузку Jira','RefreshCw',{'data-ta-jira-retry':'',hidden:true},function(){
                if(jiraRetrying)return;jiraRetrying=true;update(c.getState());
                run(function(){return state.draft?c.selectProject(state.draft.projectKey):c.init();}).finally(function(){
                    if(dead)return;jiraRetrying=false;update(c.getState());
                    if(!state.error)root.find('[data-ta-project] [data-ta-picker]').trigger('focus');
                });
            }));
            var form=$('<form class="ta-chat-composer" data-ta-chat-composer>').appendTo(host);
            input=$('<textarea rows="3" data-ta-chat-input aria-label="Сообщение" placeholder="Опишите задачу или ответьте на вопрос…">').appendTo(form);
            var composerActions=$('<div class="ta-composer-actions">').appendTo(form);
            composerActions.append($('<span class="ta-muted">').text('Enter — отправить · Shift+Enter — новая строка'),
                button('Повторить','RefreshCw',{'data-ta-chat-retry':'',hidden:true},function(){
                    var d=c.getState().draft;
                    if(dead || sending || reconciling || chat.getState().status==='running' || !d || locked(d) || JSON.stringify([d.projectKey,d.id])!==scope)return;
                    if(retryReconcileScope===scope)reconcile();
                    else if(lastSent){input.val(lastSent);send();}
                }),
                button('Остановить','Square',{'data-ta-chat-stop':'',hidden:true},function(){cancelAssignee();chat.stop();input.trigger('focus');}),
                button('Отправить','WandSparkles',{'data-ta-chat-send':'',type:'submit'},function(){}).addClass('ta-primary'));
            form.on('submit',function(event){event.preventDefault();send();});
            input.on('input',updateSend).on('keydown',function(event){
                if(event.key==='Enter' && !event.shiftKey && !(event.originalEvent && event.originalEvent.isComposing) && !event.isComposing) {event.preventDefault();send();}
            });
            update(c.getState());
        }
        function locked(d) {return !!d && (!!d.creation.issueKey || ['preflight','submitting','unknown','created'].indexOf(d.creation.status)!==-1);}
        function canCheckFields(d) {
            return !!d && !locked(d) && !d.checked && d.issueTypeId && d.templateId &&
                typeof d.fields.summary==='string' && d.fields.summary.trim() &&
                typeof d.fields.description==='string' && d.fields.description.trim();
        }
        async function checkCurrentFields() {
            var s=chat.getState(),d=c.getState().draft;
            if(dead || localCheck || sending || reconciling || s.status==='running' || c.getState().error || !canCheckFields(d))return;
            cancelAssignee();
            var check=new AbortController();
            var snapshot=c.chatSnapshot();
            localCheck=check;update(c.getState());
            var failed=false;
            try {
                var result=await c.chatValidate(snapshot,{signal:check.signal});
                failed=result.code==='metadata';
            } catch(error) {
                failed=true;
            } finally {
                localCheck=null;if(!dead)update(c.getState());
                if(failed && !dead && !check.signal.aborted && c.getState().draft?.id===d.id) {
                    host.find('[data-ta-chat-error]').text('Не удалось проверить поля в Jira. Повторите проверку, когда Jira будет доступна.').prop('hidden',false);
                }
            }
        }
        function reconcile() {
            if(dead || localCheck || sending || reconciling || chat.getState().status==='running' || !state.draft || locked(state.draft) || typeof chat.reconcile!=='function')return;
            cancelAssignee();
            var requestedScope=scope;
            retryReconcileScope=requestedScope;lastSent='';
            reconciling=true;update(c.getState());
            run(function(){
                var d=c.getState().draft;
                if(dead || !d || JSON.stringify([d.projectKey,d.id])!==requestedScope || locked(d) || chat.getState().status==='running')return;
                return chat.reconcile();
            },true).finally(function(){
                reconciling=false;
                if(retryReconcileScope===requestedScope && ['error','stopped'].indexOf(chat.getState().status)===-1)retryReconcileScope=null;
                if(!dead)update(c.getState());
            });
        }
        function hasRateLimit(s) {
            if(s.error)return /\bHTTP 429\b/.test(s.error.message || '');
            return (s.notices || []).some(function(n){return /\bHTTP 429\b/.test(typeof n==='string'?n:n.message || '');});
        }
        function retryRateLimit() {
            var next=c.getState(),d=next.draft,s=chat.getState();
            if(dead || localCheck || sending || reconciling || s.status==='running' || !d || locked(d) || JSON.stringify([d.projectKey,d.id])!==scope || !hasRateLimit(s))return;
            if(!(s.error && s.error.retryTarget==='turn') && (s.status==='idle' || retryReconcileScope===scope || d.fields.summary || d.fields.description || d.source)) {reconcile();return;}
            var original=(s.transcript || []).filter(function(m){return m.role==='user';}).pop();
            if(original) {cancelAssignee();sendText(original.text,true);}
        }
        function updateSend() {
            var busy=chat.getState().status==='running' || sending || reconciling || !!localCheck;
            host.find('[data-ta-chat-send]').prop('disabled',busy || !state || !state.draft || locked(state.draft) || !input.val().trim());
        }
        function send() {
            var text=input.val();if(localCheck || sending || reconciling || !text.trim() || chat.getState().status==='running' || !state.draft || locked(state.draft))return;
            cancelAssignee();
            var intent=assigneeIntent(text);
            if(intent) {
                // Keep the queued task editable and sendable while lookup/selection waits.
                // A new send cancels the old request; only its surviving selection can resume it.
                input.val(intent.rest);lastSent='';
                fillAssignee(intent);
                updateSend();return;
            }
            sendText(text);
        }
        function sendText(text,preserveComposer) {
            var requestedScope=scope;
            lastSent=text;sending=true;updateSend();
            run(function(){
                var d=c.getState().draft;
                if(dead || !d || locked(d) || JSON.stringify([d.projectKey,d.id])!==requestedScope)return;
                return chat.send(text,preserveComposer?{retryRateLimit:true}:undefined);
            }).then(function(){
                if(dead)return;sending=false;
                var current=chat.getState();
                if(!preserveComposer && scope===requestedScope && current.status!=='error' && input.val()===text)input.val('');
                update(c.getState());
            });
        }
        function value(value,field) {
            if(value==null)return '—';
            if(Array.isArray(value))return value.map(function(v){return formatOption(v,field);}).join(', ');
            if(field && field.kind==='timetracking' && typeof value==='object')return ['originalEstimate','remainingEstimate'].filter(function(key){return typeof value[key]==='string';}).map(function(key){
                return (key==='originalEstimate'?'Исходная оценка: ':'Оставшаяся оценка: ')+value[key];
            }).join(' · ') || '—';
            if(field && field.kind==='user' && typeof value==='object') {
                var login=value.name || value.key;
                if(value.displayName)return value.displayName+(login && login!==value.displayName?' ('+login+')':'');
                return login || value.label || value.id || '—';
            }
            if(field && ['option','multioption','components','versions'].indexOf(field.kind)!==-1)return formatOption(value,field);
            if(typeof value==='object')return value.label || value.name || value.id || JSON.stringify(value);
            return String(value);
        }
        function formatOption(value,field) {
            if(field && ['option','multioption','components','versions'].indexOf(field.kind)!==-1) {
                var id=value && typeof value==='object'?value.id:value;
                var known=(field.allowedValues || []).find(function(option){return String(option.id)===String(id);});
                return known?known.label || known.name || 'ID: '+id:'ID: '+String(id);
            }
            return value && typeof value==='object'?value.label || value.name || value.id || JSON.stringify(value):String(value);
        }
        function templateText(t) {return 'Название: '+(t.name || '—')+'\nТип Jira: '+(t.issueTypeId || 'не привязан')+'\nКогда использовать: '+(t.whenToUse || '')+'\n\n'+(t.instructions || '');}
        function update(next) {
            if(dead || !host)return;state=next;
            if(assigneeRequest && assigneeRequest.context!==assigneeContext())cancelAssignee();
            var s=chat.getState(),d=state.draft,newScope=d && JSON.stringify([d.projectKey,d.id]);
            if(scope!==newScope) {
                cancelAssignee();
                if(scope!==null) {input.val('');expandedDrafts.set(scope,card.find('[data-ta-card-details]')[0].open);}
                scope=newScope;lastSent='';retryReconcileScope=null;lastFields=null;changedFields=[];cardKey=null;pendingKey=null;
                card.find('[data-ta-card-details]').prop('open',expandedDrafts.get(scope)===true);
            }
            var entries=s.transcript || [],key=JSON.stringify(entries);
            if(key!==transcriptKey || !entries.length) {
                transcriptKey=key;log.children('.ta-chat-intro').remove();
                var ids=new Set(entries.map(function(entry){return entry.id;}));
                messageRows.forEach(function(row,id){if(!ids.has(id)){row.remove();messageRows.delete(id);}});
                if(!entries.length)log.append($('<p class="ta-chat-intro">').text(d && Object.keys(d.fields || {}).length?'Черновик восстановлен. Продолжите разговор или откройте редактор.':'Опишите, что нужно сделать. Я соберу задачу и уточню недостающее.'));
                entries.forEach(function(entry){
                    if(messageRows.has(entry.id))return;
                    var row=$('<article class="ta-message">').attr({'data-ta-message':entry.id,'data-role':entry.role});
                    row.append($('<span class="ta-message-author">').text(entry.role==='user'?'Вы':'Помощник'));
                    var text=$('<div class="ta-message-text">').appendTo(row);
                    if(entry.kind==='template')text.attr('data-ta-template-read','').text(String(entry.text || ''));
                    else if(entry.role==='assistant')assistantText(text,String(entry.text || ''));
                    else markdown(text,String(entry.text || ''));
                    log.append(row);
                    messageRows.set(entry.id,row);
                });
            }
            card.prop('hidden',!d);
            if(d)renderCard(d,s);
            var p=s.pendingTemplateProposal,pkey=JSON.stringify(p);
            var proposalHadFocus=proposal[0].contains(document.activeElement);
            proposal.prop('hidden',!p);
            if(!p && proposalHadFocus)input[0].focus({preventScroll:true});
            if(p && pkey!==proposalKey){proposal.find('[data-ta-template-before]').text(templateText(p.before));proposal.find('[data-ta-template-after]').text(templateText(p.after));}
            proposalKey=pkey;
            var busy=s.status==='running' || reconciling,error=s.error || state.error,rateLimited=hasRateLimit(s);
            host.find('[data-ta-chat-rate-limit]').prop('hidden',!rateLimited);
            host.find('[data-ta-chat-rate-retry]').prop('hidden',!rateLimited).prop('disabled',!!localCheck || sending || busy || !d || locked(d));
            var visibleNotices=(s.notices || []).filter(function(n){return !s.error || rateLimited || !/\bHTTP 429\b/.test(typeof n==='string'?n:n.message || '');});
            host.find('[data-ta-chat-status]').text(busy?'Готовлю ответ…':s.status==='stopped'?'Остановлено. Изменения сохранены.':visibleNotices.map(noticeText).join('\n'));
            host.find('[data-ta-chat-error]').prop('hidden',!error).text(error ? error.message || String(error) : '');
            host.find('[data-ta-chat-warning]').prop('hidden',!s.storageWarning).text(s.storageWarning || '');
            host.find('[data-ta-chat-stop]').prop('hidden',!busy);
            host.find('[data-ta-chat-retry]').prop('hidden',rateLimited || busy || !(lastSent || retryReconcileScope===scope && scope!==null) || !(s.status==='stopped' || s.status==='error' && (!s.error || !s.error.action || s.error.action==='retry')));
            host.find('[data-ta-chat-configure]').prop('hidden',busy || !s.error || s.error.action!=='connection');
            host.find('[data-ta-chat-error-budget]').prop('hidden',busy || !s.error || s.error.action!=='budget').prop('disabled',!state.settings);
            host.find('[data-ta-chat-error-edit]').prop('hidden',busy || !d || !s.error || ['editor','connection'].indexOf(s.error.action)===-1);
            host.find('[data-ta-chat-error-actions]').prop('hidden',busy || !s.error || ['connection','budget','editor'].indexOf(s.error.action)===-1 || s.error.action==='editor' && !d);
            host.find('[data-ta-jira-retry]').prop('hidden',!state.error || ['network','metadata'].indexOf(state.error.code)===-1)
                .prop('disabled',jiraRetrying || busy || state.stage==='metadata');
            root.find('[data-ta-chat-new]').prop('disabled',!d || ['preflight','submitting','unknown'].indexOf(d.creation.status)!==-1 || (d.attachments || []).some(function(a){return a.status==='uploading';}));
            proposal.find('button').prop('disabled',busy || locked(d));
            updateSend();
        }
        function renderCard(d,s) {
            card.attr('data-ta-task-card-id',d.id);
            var issue=state.meta && state.meta.issueTypes.find(function(t){return t.id===d.issueTypeId;}),validation=state.validation;
            var fieldErrors=Object.values(validation && validation.fieldErrors || {}).flat();
            var requiredQuestions=(d.questions || []).filter(function(q){return q.required;});
            var nextReason=liveEditor?(fieldErrors[0] || requiredQuestions[0]?.text):fieldErrors.join(' ');
            var reason=!d.issueTypeId?'Выберите тип Jira в редакторе.':!d.templateId?'Выберите шаблон.':!validation?'Текущие поля ещё не проверены.':!validation.ok?(nextReason || 'Проверьте обязательные поля.') :!d.checked?'Текущие изменения требуют проверки.':'';
            if(validation && validation.unsupportedRequired && validation.unsupportedRequired.length)reason+=' Откройте «Редактировать», затем «Открыть форму Jira» для обязательных полей.';
            if(s.status==='running' || reconciling)reason='Дождитесь ответа или остановите запрос.';
            var creation=d.creation,labels={preflight:'Предварительная проверка Jira и файлов…',submitting:'Ожидаем результат создания…',created:'Задача создана.',unknown:'Результат неизвестен. Повторное создание заблокировано до сверки с Jira.',rejected:'Создание отклонено.'};
            if(locked(d))reason=labels[creation.status] || 'Создание заблокировано.';
            card.find('[data-ta-card-summary]').text(d.fields.summary || 'Тема пока не заполнена');
            var required=requiredQuestions.length,
                proposed=Object.keys(d.pendingFields || {}).length+(s.pendingTemplateProposal?1:0),counts=[];
            if(required)counts.push('Обязательных вопросов: '+required);
            if(proposed)counts.push('Предложений: '+proposed);
            card.find('[data-ta-card-counts]').text(counts.join(' · '));
            var warnings=Array.from(new Set((d.warnings || []).concat(validation && validation.warnings || [])));
            card.find('[data-ta-card-warnings]').prop('hidden',!warnings.length).text(warnings.join('\n'));
            card.find('[data-ta-card-type]').text(issue?issue.name:d.issueTypeId || 'Тип не выбран');
            var fieldState=JSON.stringify(d.fields);
            if(lastFields!==fieldState) {var prior=lastFields?JSON.parse(lastFields):null;changedFields=prior?Object.keys(d.fields).filter(function(id){return JSON.stringify(prior[id])!==JSON.stringify(d.fields[id]);}):[];lastFields=fieldState;}
            var key=JSON.stringify([d.issueTypeId,state.meta && state.meta.signature,d.fields,d.questions,validation && validation.fieldErrors]);
            if(key!==cardKey) {
                cardKey=key;var fields=card.find('[data-ta-card-values]').empty();
                ['summary','description'].concat(Object.keys(d.fields).filter(function(id){return ['summary','description'].indexOf(id)===-1;})).forEach(function(id){
                    var f=issue && issue.fields.find(function(f){return f.id===id;}),name=f?f.name:id==='summary'?'Тема':id==='description'?'Описание':id;
                    fields.append($('<div class="ta-card-field">').attr('data-ta-card-field',id).append($('<span class="ta-muted">').text(name),changedFields.indexOf(id)!==-1?$('<span class="ta-change-label">').text(' · Изменено'):null,$('<div class="ta-card-value">').text(value(d.fields[id],f))));
                });
                var questions=card.find('[data-ta-card-questions]').empty();
                (d.questions || []).forEach(function(q){questions.append($('<p>').text((q.required?'Нужно уточнить: ':'Уточнение: ')+q.text));});
            }
            var nextPendingKey=JSON.stringify([d.issueTypeId,state.meta && state.meta.signature,d.pendingFields,Object.keys(d.pendingFields || {}).map(function(id){return d.fields[id];})]);
            if(nextPendingKey!==pendingKey) {
                pendingKey=nextPendingKey;
                var pendingHadFocus=card.find('[data-ta-card-pending]')[0].contains(document.activeElement),pending=card.find('[data-ta-card-pending]').empty();
                Object.keys(d.pendingFields || {}).forEach(function(id){
                    var f=issue && issue.fields.find(function(f){return f.id===id;});
                    pending.append($('<div class="ta-card-proposal">').append($('<strong>').text('Предложение: '+(f?f.name:id)),
                        $('<p>').text('Сейчас: '+value(d.fields[id],f)),$('<p>').text('Предложено: '+value(d.pendingFields[id],f)),
                        button('Применить','Check',{'data-ta-chat-accept':id},function(){run(function(){return c.acceptField(id);});}),
                        button('Отклонить','X',{'data-ta-chat-reject':id},function(){run(function(){return c.rejectField(id);});})));
                });
                if(pendingHadFocus)card.find('[data-ta-card-edit]')[0].focus({preventScroll:true});
            }
            card.find('[data-ta-card-reason]').text(reason || 'Готово к созданию.');
            card.find('[data-ta-card-create]').prop('disabled',!d.checked || !validation || !validation.ok || !!reason || !!state.error);
            card.find('[data-ta-card-edit]').prop('disabled',false);
            card.find('[data-ta-card-check]').prop('disabled',!!localCheck || reconciling || sending || s.status==='running' || locked(d) || typeof chat.reconcile!=='function');
            card.find('[data-ta-card-undo]').prop('disabled',!s.canUndo || reconciling || s.status==='running' || locked(d));
            card.find('[data-ta-card-local-check]').prop('hidden',!canCheckFields(d))
                .prop('disabled',!!localCheck || !!state.error || reconciling || sending || s.status==='running');
            if(liveEditor) {
                var hasAnswers=(s.transcript || []).some(function(m){return m.role==='user';});
                card.find('[data-ta-card-check]').prop('hidden',!hasAnswers || !!d.checked || locked(d) || hasRateLimit(s));
                var locallyComplete=validation && validation.ok && !d.templateReviewPending;
                card.find('[data-ta-card-local-check]').prop('hidden',!canCheckFields(d) || hasAnswers && !locallyComplete && !s.error && s.status!=='stopped');
                card.find('[data-ta-card-undo]').prop('hidden',!s.canUndo || locked(d));
            }
            card.find('[data-ta-chat-accept],[data-ta-chat-reject]').prop('disabled',reconciling || s.status==='running' || locked(d));
            var status=card.find('[data-ta-card-creation]'),creationKey=JSON.stringify(creation);
            if(status.attr('data-state')!==creationKey) {
                status.attr('data-state',creationKey).empty();
                if(creation.error)status.append($('<p class="ta-warning">').text(creation.error));
                if(creation.issueKey && /^[A-Za-z][A-Za-z0-9_]*-\d+$/.test(creation.issueKey))status.append($('<a target="_blank" rel="noopener" data-ta-chat-issue-link>').attr('href',(options.baseUrl || '').replace(/\/+$/,'')+'/browse/'+encodeURIComponent(creation.issueKey)).text(creation.issueKey));
            }
        }
        function destroy(){dead=true;cancelAssignee();if(localCheck)localCheck.abort();messageRows.clear();expandedDrafts.clear();if(releaseEditor)releaseEditor();if(chatLayout)chatLayout.remove();if(host)host.remove();if(root){root.removeClass('ta-chat-mode');root.find('[data-ta-chat-new]').remove();}}
        return {mount:mount,update:update,destroy:destroy};
    }
    return {create:create};
});
