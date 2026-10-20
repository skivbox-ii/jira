/* Browser fixture: API writes and AI transport stay in memory. No HTTP writes/provider. */
(function() {
    'use strict';
    var $ = window.jQuery, shared = window.taRequire('_ujgTA_llmClient');
    var review=new URLSearchParams(window.location.search).get('review');
    if(['obsolete','catalog','storage','response'].indexOf(review)===-1)review='';
    var records = {calls:[], pending:0}; window.taPreview = records;
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
        getComponents:function(key) {return result('components',{values:[{id:'31',name:'API'},{id:'32',name:'Интерфейс'},{id:'33',name:'Инфраструктура'}],complete:true,projectKey:key});},
        getVersions:function(key) {return result('versions',{values:[{id:'41',name:'2026.10'},{id:'42',name:'2026.11'}],complete:true,projectKey:key});},
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
    var llm = Object.assign({},shared,{requestText:function(config, request) {
        var input = JSON.parse(request.userPrompt); records.calls.push('ai:'+input.action); records.pending++;
        return new Promise(function(resolve) {setTimeout(function() {
            records.pending--;
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
            if(review==='response' && input.action==='check') response.warnings=['Synthetic optional warning'];
            if(review==='response' && input.action==='prepare') response.fields.components=records.responseMode==='malformed'?[31]:['31'];
            resolve({text:JSON.stringify(response)});
        },1100);});
    }});
    var ai = window.taRequire('_ujgTA_ai').createClient({llmClient:llm,readConfig:function() {return {apiKey:'offline-fixture-key'};},fetchImpl:function() {throw new Error('Offline preview prohibits fetch');}});
    var Gadget = window.taRequire('_ujgTicketAssistantRuntime');
    var dependencies={api:api,ai:ai,baseUrl:'',storage:window.localStorage,
        createStore:function(userKey) {
            var store=window.taRequire('_ujgTA_storage').createStore({storage:window.localStorage,origin:window.location.origin+'/offline-ticket-assistant-preview-v1'+(review?'/review-'+review:''),userKey:userKey});
            return {load:function(key){var snapshot=store.load(key);records.restored=!!snapshot.draft;return snapshot;},save:store.save,clearDraft:store.clearDraft,isPersistent:store.isPersistent};
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
