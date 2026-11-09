/* Browser fixture: API writes and AI transport stay in memory. No HTTP writes/provider. */
(function() {
    'use strict';
    var $ = window.jQuery, shared = window.taRequire('_ujgTA_llmClient');
    var parameters=new URLSearchParams(window.location.search),review=parameters.get('review');
    var devopsPreview=parameters.get('devops')==='1';
    if(['obsolete','catalog','storage','response','guided'].indexOf(review)===-1)review='';
    var records = {calls:[], pending:0}; window.taPreview = records;
    var legacyForm=parameters.get('form')==='1' || !!review;
    records.chatMode='normal';records.chatRequests=[];
    // Personal UI checks may inject a canned model result via the preview route.
    records.screenshotExample=window.taScreenshotExample || null;
    if(review==='response') records.responseMode=new URLSearchParams(window.location.search).get('responseMode');
    var scenario='success', issueSequence=100, failedFiles=new Set();
    var controls=$('<nav aria-label="Synthetic creation scenario" class="ta-preview-scenarios">').append($('<strong>').text('Offline create: '));
    ['success','rejected','lostresponse','filefail'].forEach(function(value) {
        controls.append($('<button type="button">').attr({'data-ta-preview-scenario':value,'aria-pressed':String(value===scenario)}).text(value).on('click',function() {
            scenario=value;failedFiles.clear();controls.find('[data-ta-preview-scenario]').attr('aria-pressed','false');$(this).attr('aria-pressed','true');
        }));
    });
    $('#ticket-assistant').before(controls);
    var devopsExamples={
        '10':'Тема: Вернуть команде доступ к API.\nЦель: вернуть команде доступ к API.\nЧто сделать: обновить конфигурацию API и перезапустить сервис.\nГде: API на TEST, узел test-01.\nКритерии приёмки: API отвечает HTTP 200 на /health.\nСсылки: https://example.org/api/runbook\nОценка: 30 минут.',
        '11':'Тема: Исправить загрузку sample.csv через API.\nЧто происходит: API на TEST возвращает HTTP 500 при загрузке sample.csv.\nЧто ожидалось: API принимает файл с HTTP 201.\nШаги воспроизведения: открыть загрузку и отправить sample.csv.\nГде: API версии 2.3 на TEST.\nЛоги / скриншоты: https://example.org/logs/123\nКритерии приёмки: sample.csv загружается с HTTP 201.\nСсылки: https://example.org/api\nОценка: 1 час.',
        '12':'Тема: Обновить виджет Jira в DEV.\nСреда: DEV.\nВерсия и состав: Виджет Jira из коммита 5961fa4.\nПорядок: Заменить скрипт и перезагрузить страницу.\nОкно: в рабочее время.\nПроверка: Постановщик проверит открытие карточки DEVOPS.\nСсылки: https://example.org/mama-myla-ramu\nОценка: 30 минут.'
    };
    if(devopsPreview) {
        controls.append($('<p>').text('Демо DEVOPS: готовые примеры с явно подписанными полями. Ответы модели имитируются только по этим подписям; свободный текст не разбирается. Чат работает локально, ключ не нужен. Jira и модель не вызываются. Для нового примера нажмите «Очистить», выберите пример и отправьте его. Недостающий раздел можно дописать, например «Окно: в рабочее время».'));
        Object.keys(devopsExamples).forEach(function(id){
            controls.append($('<button type="button">').attr('data-ta-preview-example',id).text({'10':'Готовый пример задачи','11':'Готовый пример ошибки','12':'Готовый пример развёртывания'}[id]).on('click',async function(){
                await records.instance.controller.selectIssueType(id);
                $('[data-ta-chat-input]').val(devopsExamples[id]).trigger('input').trigger('focus');
            }));
        });
        ['normal','malformed','error','slow'].forEach(function(mode){
            controls.append($('<button type="button">').attr({'data-ta-preview-pico':mode,'aria-pressed':String(mode==='normal')}).text({normal:'Pico: работает',malformed:'Pico: неверный ответ',error:'Pico: ошибка',slow:'Pico: задержка'}[mode]).on('click',function(){
                records.chatMode=mode;controls.find('[data-ta-preview-pico]').attr('aria-pressed','false');$(this).attr('aria-pressed','true');
            }));
        });
    }
    var failStorage=false;
    if(review==='storage') controls.append($('<button type="button" data-ta-preview-storage-fail>').text('Имитировать отказ хранилища').on('click',function(){failStorage=true;$(this).text('Следующее сохранение завершится отказом');}));
    var rawFields = {
        summary:{name:'Тема', required:true, schema:{type:'string',system:'summary'}},
        description:{name:'Описание', schema:{type:'string',system:'description'}},
        priority:{name:'Приоритет', schema:{type:'priority',system:'priority'}, allowedValues:[{id:'2',name:'Высокий'},{id:'3',name:'Обычный'},{id:'4',name:'Низкий'}]},
        components:{name:'Компоненты',schema:{type:'array',items:'component',system:'components'}},
        fixVersions:{name:'Версии',schema:{type:'array',items:'version',system:'fixVersions'}},
        reporter:{name:'Автор',schema:{type:'user',system:'reporter'}},
        assignee:{name:'Исполнитель',schema:{type:'user',system:'assignee'}},
        duedate:{name:'Срок',schema:{type:'date',system:'duedate'}},
        labels:{name:'Метки',schema:{type:'array',items:'string',system:'labels'}},
        customfield_1:{name:'Оценка',schema:{type:'number',custom:'com.atlassian.jira.plugin.system.customfieldtypes:float'}}
    };
    if(parameters.get('effort')==='required') {
        rawFields.timetracking={name:'Учёт времени',required:true,schema:{system:'timetracking',type:'timetracking'}};
        rawFields.reporter.required=true;
    }
    if(devopsPreview) {
        rawFields.timetracking={name:'Учёт времени',schema:{system:'timetracking',type:'timetracking'}};
        rawFields.priority.hasDefaultValue=true;rawFields.priority.defaultValue={id:'3'};
    }
    if(review==='guided') {
        rawFields.environment={name:'Окружение',schema:{type:'string',system:'environment'}};
        rawFields.customfield_71={name:'Epic',schema:{type:'any',custom:'com.pyxis.greenhopper.jira:gh-epic-link'}};
        rawFields.customfield_72={name:'Sprint',schema:{type:'array',items:'string',custom:'com.pyxis.greenhopper.jira:gh-sprint'}};
        rawFields.customfield_73={name:'Неизвестное поле',schema:{type:'any',custom:'fixture:unsupported'}};
        records.assistMode='normal';
        var assistControls=$('<fieldset>').append($('<legend>').text('Offline AI'));
        ['normal','null','error','slow','foreign'].forEach(function(mode) {
            assistControls.append($('<button type="button">').attr({'data-ta-preview-assist':mode,'aria-pressed':String(mode==='normal')}).text(mode).on('click',function() {
                records.assistMode=mode;assistControls.find('button').attr('aria-pressed','false');$(this).attr('aria-pressed','true');
            }));
        });
        assistControls.append($('<label>').append($('<input type="checkbox" data-ta-preview-lookup-denied>').on('change',function(){records.lookupDenied=this.checked;}),' lookup denied'));
        controls.append(assistControls);
    }
    if(review==='catalog') rawFields.customfield_50={name:'Контур приёмки',required:true,schema:{type:'option',custom:'com.atlassian.jira.plugin.system.customfieldtypes:select'},allowedValues:[],autoCompleteUrl:'https://never-follow.invalid/catalog'};
    function result(name, value) {records.calls.push(name); return Promise.resolve(value);}
    var api = {
        getCurrentUser:function() {return result('identity', {key:'synthetic-ticket-assistant-preview-v1'+(devopsPreview?'-devops':'')+(review?'-review-'+review:''),name:'preview'});},
        getProjects:function() {return result('projects',{values:(devopsPreview?[{id:'103',key:'DEVOPS',name:'DEVOPS — локальная демонстрация'}]:[]).concat([{id:'101',key:'DEMO',name:'Демонстрационный проект'},{id:'102',key:'APP',name:'Приложение'}]),complete:true});},
        getCreateMeta:function(key) {return result('metadata',{projects:[{key:key,id:key==='DEVOPS'?'103':key === 'DEMO' ? '101':'102',issuetypes:[
            {id:key==='APP'?'20':'10',name:'Задача',subtask:false,fields:review==='obsolete'?Object.assign({},rawFields,{customfield_10:{name:'Заметки только для задачи',schema:{type:'string',custom:'com.atlassian.jira.plugin.system.customfieldtypes:textarea'}}}):rawFields},
            {id:key==='APP'?'21':'11',name:'Ошибка',subtask:false,fields:rawFields},
            {id:key==='APP'?'22':'12',name:key==='DEVOPS'?'Задача развёртывания':'Согласование',subtask:false,fields:key==='DEVOPS'?rawFields:Object.assign({},rawFields,{customfield_99:{name:'Согласующий комитет',required:true,schema:{type:'string',custom:'fixture:unsupported'}}})}
        ]}]});},
        checkDevopsIssue:function(){return result('devops-check',{fieldErrors:{},warnings:[],link:null});},
        getComponents:function(key) {return result('components',{values:[{id:'31',name:'API'},{id:'32',name:'Интерфейс'},{id:'33',name:'Инфраструктура'}].concat(review==='guided'?Array.from({length:180},function(unused,index){return {id:String(100+index),name:'Компонент тестовой системы '+index};}):[]),complete:true,projectKey:key});},
        getVersions:function(key) {return result('versions',{values:[{id:'41',name:'2026.10'},{id:'42',name:'2026.11'}],complete:true,projectKey:key});},
        searchEpics:function(key,query) {return records.lookupDenied?Promise.reject({kind:'forbidden'}):result('epics',{values:query==='none'?[]:[{id:key+'-42',label:'Работа с ошибками API'}],complete:false,projectKey:key});},
        getBoards:function(key) {return records.lookupDenied?Promise.reject({kind:'forbidden'}):result('boards',{values:[{id:'12',label:'Команда API'},{id:'13',label:'Команда UI'}],complete:true,projectKey:key});},
        getSprints:function(key,board) {return result('sprints',{values:[{id:'73',label:'Итерация приёмки',state:'active',boardId:board}],complete:true,projectKey:key,boardId:board});},
        getEpic:function(key,id) {return result('epic',{id:id,label:'Работа с ошибками API'});},
        getSprint:function(key,id) {return result('sprint',{id:String(id),label:'Итерация приёмки',state:'active',boardId:'12'});},
        searchUsers:function(query) {return result('users',{values:[{name:'anna',displayName:'Анна Смирнова'},{name:'alex',displayName:'Алексей Петров'},{name:'irina',displayName:'Ирина Козлова'}].filter(function(u) {return (u.name+' '+u.displayName).toLowerCase().indexOf(query.toLowerCase()) !== -1;}),complete:false});},
        getAttachmentMeta:function() {return result('attachment-meta',{enabled:true,uploadLimit:10000000});},
        createIssue:function(payload) {
            records.calls.push('create');records.createdPayload=payload;var mode=scenario;
            return new Promise(function(resolve,reject) {setTimeout(function() {
                if(mode==='rejected')reject({outcome:'rejected',fieldErrors:{summary:['Synthetic field rejection.']}});
                else if(mode==='lostresponse')reject({outcome:'unknown'});
                else resolve({id:String(++issueSequence),key:(payload.fields.project.id==='103'?'DEVOPS-':payload.fields.project.id==='102'?'APP-':'DEMO-')+issueSequence});
            },650);});
        },
        uploadAttachment:function(key,file) {
            records.calls.push('upload:'+file.name);
            return new Promise(function(resolve,reject) {setTimeout(function() {
                if(scenario==='filefail' && /b\.txt$/.test(file.name) && !failedFiles.has(file.name)) {failedFiles.add(file.name);reject({outcome:'rejected'});}
                else resolve({id:'synthetic-'+file.name,filename:file.name});
            },350);});
        },
        getIssueAttachments:function() {return result('attachment-reconcile',[]);}
    };
    records.api=api;
    function devopsPatch(text) {
        var state=records.instance.controller.getState(),definitions=window.taRequire('_ujgTA_validation').descriptionSectionDefinitions(state.meta,state.draft.issueTypeId,state.draft.templateId);
        // This is a canned transport, not a prose-to-fields fallback. Only
        // explicit demo labels can supply model-authored fields or sections.
        var fields={},sections={};
        text.split(/\r?\n/).forEach(function(line){
            var match=/^([^:]+):\s*(.*)$/.exec(line);
            if(!match || !match[2].trim())return;
            var label=match[1].trim(),value=match[2].trim();
            var section=definitions.find(function(d){return d.label===label;});
            if(section)sections[section.id]=value;
            else if(/^(?:Тема|summary)$/i.test(label))fields.summary=value;
            else if(label==='Оценка') {
                var estimate=/^(\d+)\s*(минут(?:а|ы)?|час(?:а|ов)?)[.]?$/.exec(value);
                if(estimate)fields.timetracking={originalEstimate:estimate[1]+(/^минут/.test(estimate[2])?'m':'h')};
            }
        });
        return {fields:fields,descriptionSections:sections};
    }
    var llm = Object.assign({},shared,{requestText:function(config, request) {
        var input = JSON.parse(request.userPrompt); records.calls.push('ai:'+input.action); records.pending++;
        return new Promise(function(resolve,reject) {var mode=records.assistMode;setTimeout(function() {
            records.pending--;
            if(input.action==='assist' && mode==='error') {reject({code:'transport'});return;}
            var response;
            if (input.action === 'route') response = {schemaVersion:1,kind:'route',issueTypeId:null,templateId:null,candidates:input.candidatePairs.map(function(pair) {return Object.assign({reason:'Выберите подходящий вариант'},pair);}),questions:[]};
            else if (input.action === 'check') response = {schemaVersion:1,kind:'check',questions:[],warnings:[],evidence:[]};
            else {
                var fields = {}, allowed = input.issueTypes[0].fieldSchema.map(function(f) {return f.id;});
                if (allowed.indexOf('summary') !== -1) fields.summary = 'Уточнить обработку ошибок API';
                if (allowed.indexOf('description') !== -1) fields.description = 'Цель\n' + input.source + '\n\nКритерии приёмки\nОшибки доступны в журнале, поведение проверено на тестовой среде.';
                response = {schemaVersion:1,kind:'draft',issueTypeId:input.selected.issueTypeId,templateId:input.selected.templateId,
                    fields:fields,questions:[{id:'release',text:'В какой версии нужно проверить результат?',reason:'Версия не указана в исходном запросе.',required:false}],
                    warnings:['Критерии приёмки предложены для ручной проверки.'],evidence:[]};
            }
            if(input.action==='assist') {
                response.fields={};response.fields[input.targetFieldId]=mode==='null'?null:input.targetFieldId==='components'?[{id:mode==='foreign'?'99999':'31'}]:input.targetFieldId==='summary'?'Уточнить обработку ошибок API':'Предложение для поля: '+input.source;
                response.questions=mode==='null'?[{id:'target-fact',text:'Уточните недостающий факт для поля.',reason:'В исходнике нет ответа.',required:true}]:[];
                response.warnings=['Проверьте предложение перед применением.'];
            }
            if(review==='response' && input.action==='check') response.warnings=['Synthetic optional warning'];
            if(review==='response' && input.action==='prepare') response.fields.components=records.responseMode==='malformed'?[31]:['31'];
            if(review==='response' && input.action==='prepare') {
                if(records.responseMode==='json') {resolve({text:'{PRIVATE'});return;}
                if(records.responseMode==='contract') response.extra='PRIVATE';
                if(records.responseMode==='questions') response.questions=[{id:'q',text:'PRIVATE',required:true}];
                if(records.responseMode==='evidence') response.evidence=[{fieldId:'summary',kind:'source',quote:'PRIVATE'}];
            }
            resolve({text:JSON.stringify(response)});
        },records.assistMode==='slow'?2200:1100);});
    }});
    var ai = window.taRequire('_ujgTA_ai').createClient({llmClient:llm,readConfig:function() {return {apiKey:'offline-fixture-key'};},fetchImpl:function() {throw new Error('Offline preview prohibits fetch');}});
    var Gadget = window.taRequire('_ujgTicketAssistantRuntime');
    var dependencies={api:api,ai:ai,baseUrl:'',storage:window.localStorage,legacyForm:legacyForm,
        fetchImpl:function(){throw new Error('Offline preview prohibits fetch');},
        requestText:function(request) {
            // Actual Pi runtime + domain tools; only the text transport is scripted.
            var input=JSON.parse(request.user);
            if(input.userAnswers) {
                records.calls.push('pico');records.chatRequests.push(input);
                if(records.chatMode==='error')return Promise.reject(new Error('Synthetic transport failure'));
                if(records.chatMode==='malformed')return Promise.resolve({text:'{"fields":'});
                var answer=input.userAnswers[input.userAnswers.length-1],patch=devopsPreview?devopsPatch(answer && answer.text || ''):{fields:{}};
                return Promise.resolve({text:JSON.stringify({fields:Object.assign({description:input.current.description || ''},patch.fields),missing:[]})});
            }
            var messages=input.messages,last=-1;
            messages.forEach(function(message,index){if(message.role==='user')last=index;});
            var content=messages[last].content,text=typeof content==='string'?content:content.filter(function(c){return c.type==='text';}).map(function(c){return c.text;}).join('\n');
            var toolResults=messages.slice(last+1).filter(function(message){return message.role==='toolResult';});
            records.calls.push('pico');records.chatRequests.push(input);records.pending++;
            var mode=records.chatMode;
            return new Promise(function(resolve,reject){setTimeout(function(){
                records.pending--;
                if(mode==='error'){reject(new Error('Synthetic transport failure'));return;}
                if(mode==='malformed'){resolve({text:'{"toolCalls":[{"name":"update_task","arguments":{"fields":{"summary":"UNTRUSTED"}}}'});return;}
                var response={text:'Карточка обновлена. Проверьте сведения перед созданием.',toolCalls:[]};
                function call(name,args){response={text:'',toolCalls:[{id:'offline_'+Date.now()+'_'+records.chatRequests.length,name:name,arguments:args}]};}
                var current=input.authoritativeContext,template=current.template && current.template.template;
                if(current.conversationForReview) {
                    if(!toolResults.length)call('update_task',{fields:current.draft.fields.description?{description:current.draft.fields.description}:{},questions:current.draft.questions});
                    else response.text='Сверка завершена.';
                } else if(/покажи шаблон/i.test(text)) {
                    if(!toolResults.length)call('read_template',{});else response.text='Это точный текущий текст шаблона. Он не изменён.';
                } else if(/^Проверь текущую задачу заново по сохранённым правилам выбранного шаблона\./.test(text)) {
                    if(!toolResults.length) {
                        var needsEnvironment=/Обязательно укажи среду проверки/.test(template && template.instructions || '') && !/Тестовая среда/i.test(current.draft.fields.description || '');
                        call('update_task',{fields:{},questions:needsEnvironment?[{id:'template-environment',text:'Укажите среду проверки по новым правилам шаблона.',reason:'Среда проверки не указана.',required:true}]:[]});
                    } else response.text='Задача оценена по сохранённым правилам. Недостающие сведения отражены в карточке.';
                } else if(/измени шаблон/i.test(text)) {
                    if(!toolResults.length)call('propose_template_change',{changes:{instructions:(template && template.instructions || '')+'\nОбязательно укажи среду проверки.'}});
                    else response.text='Предложение готово. Примените его кнопкой, чтобы сохранить новую ревизию.';
                } else if(records.screenshotExample && text===records.screenshotExample.source) {
                    if(!toolResults.length)call('update_task',{fields:records.screenshotExample.fields,descriptionSections:records.screenshotExample.descriptionSections});
                    else response.text='Сведения перенесены из имитации ответа модели. Проверьте недостающие сведения в карточке.';
                } else if(devopsPreview && current.draft.projectKey==='DEVOPS') {
                    if(!toolResults.length)call('update_task',devopsPatch(text));
                    else response.text='Сведения перенесены. Готовность проверяет карточка.';
                } else if(/компонент/i.test(text) && !/выбираю/i.test(text)) {
                    if(!toolResults.length)call('find_options',{fieldId:'components',query:'',limit:10});
                    else response.text='Найдено несколько компонентов: API, Интерфейс, Инфраструктура. Какой выбрать?';
                } else {
                    if(!toolResults.length) {
                        var fields={},questions=[];
                        var managed=current.appManagedPatch===true,sections={};
                        if(/предложи другую тему/i.test(text))fields.summary='Проверить обработку ошибок API';
                        else if(/выбираю API/i.test(text))fields.components=[{id:'31'}];
                        else if(/добавь/i.test(text)) {
                            if(managed)sections.acceptance='Сохранение завершается без ошибки.\n'+text;
                            else fields.description=(current.draft.fields.description || '')+'\n'+text;
                        }
                        else if(!current.draft.fields.summary) {
                            fields.summary='Исправить ошибку API при сохранении';
                            if(managed) {
                                // These are the synthetic incident's known facts. Leave
                                // the environment absent until the human supplies it.
                                sections.goal='Восстановить успешное сохранение задачи через API.';
                                sections.work='Устранить ошибку API при сохранении задачи.\n'+text;
                                sections.acceptance='Сохранение завершается без ошибки.';
                            } else {
                                fields.description='Фактическое поведение\n'+text+'\n\nОжидаемое поведение\nСохранение завершается без ошибки.';
                                questions=[{id:'environment',text:'В какой среде воспроизводится ошибка?',reason:'Среда не указана.',required:true}];
                            }
                        } else if(managed && /подтверди готовность/i.test(text))fields.description=current.draft.fields.description;
                        else if(!managed)fields.description=(current.draft.fields.description || '')+'\n\nУточнение\n'+text;
                        if(managed && /тестов\S* сред|\b(?:DEV|TEST|PREPROD)\b/i.test(text))sections.location=text;
                        var patch={fields:fields,warnings:[]};
                        if(Object.keys(sections).length)patch.descriptionSections=sections;
                        if(!managed)patch.questions=questions;
                        call('update_task',patch);
                    } else if(toolResults.length===1)call('validate_task',{});
                    else response.text=current.draft.questions.length?'В какой среде воспроизводится ошибка?':'Карточка обновлена и проверена. Можно отредактировать или создать задачу.';
                }
                resolve({text:JSON.stringify(response)});
            },mode==='slow'?2200:90);});
        },
        createStore:function(userKey) {
            var store=window.taRequire('_ujgTA_storage').createStore({storage:window.localStorage,origin:window.location.origin+'/offline-ticket-assistant-preview-v1'+(devopsPreview?'/devops':'')+(review?'/review-'+review:''),userKey:userKey});
            return {load:function(key){var snapshot=store.load(key);records.restored=!!snapshot.draft;return snapshot;},save:store.save,clearDraft:store.clearDraft,isPersistent:store.isPersistent,
                loadConversation:store.loadConversation,saveConversation:store.saveConversation};
        }};
    if(review==='storage') {
        delete dependencies.createStore;
        dependencies.storage={getItem:function(key){return window.localStorage.getItem(key);},setItem:function(key,value){
            if(failStorage){records.storageFailures=(records.storageFailures||0)+1;throw new Error('Synthetic storage quota');}window.localStorage.setItem(key,value);
        }};
    }
    var instance = new Gadget({getGadgetContentEl:function() {return $('#ticket-assistant');}}, dependencies);
    records.instance = instance;
    records.ready = instance.ready.then(function() {return instance.controller.selectProject(devopsPreview?'DEVOPS':'DEMO');}).then(function() {
        if (!records.restored) return instance.controller.selectIssueType(devopsPreview?'12':'10').then(function(){
            return devopsPreview?(parameters.get('screenshot')==='1'?undefined:instance.chat.send(devopsExamples['12'])):instance.controller.selectTemplate('task');
        });
    }).then(function() {
        document.documentElement.setAttribute('data-ta-preview-ready','true');
    });
})();
