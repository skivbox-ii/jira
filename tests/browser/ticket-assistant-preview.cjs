/* Browser fixture: API writes and AI transport stay in memory. No HTTP writes/provider. */
(function() {
    'use strict';
    var $ = window.jQuery, shared = window.taRequire('_ujgTA_llmClient');
    var parameters=new URLSearchParams(window.location.search),review=parameters.get('review');
    if(['obsolete','catalog','storage','response','guided'].indexOf(review)===-1)review='';
    var records = {calls:[], pending:0}; window.taPreview = records;
    var legacyForm=parameters.get('form')==='1' || !!review;
    records.chatMode='normal';records.chatRequests=[];
    if(review==='response') records.responseMode=new URLSearchParams(window.location.search).get('responseMode');
    var scenario='success', issueSequence=100, failedFiles=new Set();
    var controls=$('<nav aria-label="Synthetic creation scenario" class="ta-preview-scenarios">').append($('<strong>').text('Offline create: '));
    ['success','rejected','lostresponse','filefail'].forEach(function(value) {
        controls.append($('<button type="button">').attr({'data-ta-preview-scenario':value,'aria-pressed':String(value===scenario)}).text(value).on('click',function() {
            scenario=value;failedFiles.clear();controls.find('button').attr('aria-pressed','false');$(this).attr('aria-pressed','true');
        }));
    });
    $('#ticket-assistant').before(controls);
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
        getCurrentUser:function() {return result('identity', {key:'synthetic-ticket-assistant-preview-v1'+(review?'-review-'+review:''),name:'preview'});},
        getProjects:function() {return result('projects',{values:[{id:'101',key:'DEMO',name:'Демонстрационный проект'},{id:'102',key:'APP',name:'Приложение'}],complete:true});},
        getCreateMeta:function(key) {return result('metadata',{projects:[{key:key,id:key === 'DEMO' ? '101':'102',issuetypes:[
            {id:key==='APP'?'20':'10',name:'Задача',subtask:false,fields:review==='obsolete'?Object.assign({},rawFields,{customfield_10:{name:'Заметки только для задачи',schema:{type:'string',custom:'com.atlassian.jira.plugin.system.customfieldtypes:textarea'}}}):rawFields},
            {id:key==='APP'?'21':'11',name:'Ошибка',subtask:false,fields:rawFields},
            {id:key==='APP'?'22':'12',name:'Согласование',subtask:false,fields:Object.assign({},rawFields,{customfield_99:{name:'Согласующий комитет',required:true,schema:{type:'string',custom:'fixture:unsupported'}}})}
        ]}]});},
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
            records.calls.push('create');var mode=scenario;
            return new Promise(function(resolve,reject) {setTimeout(function() {
                if(mode==='rejected')reject({outcome:'rejected',fieldErrors:{summary:['Synthetic field rejection.']}});
                else if(mode==='lostresponse')reject({outcome:'unknown'});
                else resolve({id:String(++issueSequence),key:payload.fields.project.id==='102'?'APP-'+issueSequence:'DEMO-'+issueSequence});
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
            var input=JSON.parse(request.user),messages=input.messages,last=-1;
            messages.forEach(function(message,index){if(message.role==='user')last=index;});
            var content=messages[last].content,text=typeof content==='string'?content:content.filter(function(c){return c.type==='text';}).map(function(c){return c.text;}).join('\n');
            var toolResults=messages.slice(last+1).filter(function(message){return message.role==='toolResult';});
            records.calls.push('pico');records.chatRequests.push(input);records.pending++;
            var mode=records.chatMode;
            return new Promise(function(resolve,reject){setTimeout(function(){
                records.pending--;
                if(mode==='error'){reject(new Error('Synthetic transport failure'));return;}
                var response={text:'Карточка обновлена. Проверьте сведения перед созданием.',toolCalls:[]};
                function call(name,args){response={text:'',toolCalls:[{id:'offline_'+Date.now()+'_'+records.chatRequests.length,name:name,arguments:args}]};}
                var current=input.authoritativeContext,template=current.template && current.template.template;
                if(current.conversationForReview) {
                    if(!toolResults.length)call('update_task',{fields:{},questions:current.draft.questions});
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
                } else if(/компонент/i.test(text) && !/выбираю/i.test(text)) {
                    if(!toolResults.length)call('find_options',{fieldId:'components',query:'',limit:10});
                    else response.text='Найдено несколько компонентов: API, Интерфейс, Инфраструктура. Какой выбрать?';
                } else {
                    if(!toolResults.length) {
                        var fields={},questions=[];
                        if(/предложи другую тему/i.test(text))fields.summary='Проверить обработку ошибок API';
                        else if(/выбираю API/i.test(text))fields.components=[{id:'31'}];
                        else if(/добавь/i.test(text))fields.description=(current.draft.fields.description || '')+'\n'+text;
                        else if(!current.draft.fields.summary) {
                            fields.summary='Исправить ошибку API при сохранении';fields.description='Фактическое поведение\n'+text+'\n\nОжидаемое поведение\nСохранение завершается без ошибки.';
                            questions=[{id:'environment',text:'В какой среде воспроизводится ошибка?',reason:'Среда не указана.',required:true}];
                        } else fields.description=(current.draft.fields.description || '')+'\n\nУточнение\n'+text;
                        call('update_task',{fields:fields,questions:questions,warnings:[]});
                    } else if(toolResults.length===1)call('validate_task',{});
                    else response.text=current.draft.questions.length?'В какой среде воспроизводится ошибка?':'Карточка обновлена и проверена. Можно отредактировать или создать задачу.';
                }
                resolve({text:JSON.stringify(response)});
            },mode==='slow'?2200:90);});
        },
        createStore:function(userKey) {
            var store=window.taRequire('_ujgTA_storage').createStore({storage:window.localStorage,origin:window.location.origin+'/offline-ticket-assistant-preview-v1'+(review?'/review-'+review:''),userKey:userKey});
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
    records.ready = instance.ready.then(function() {return instance.controller.selectProject('DEMO');}).then(function() {
        if (!records.restored) return instance.controller.selectIssueType('10').then(function(){return instance.controller.selectTemplate('task');});
    }).then(function() {
        document.documentElement.setAttribute('data-ta-preview-ready','true');
    });
})();
