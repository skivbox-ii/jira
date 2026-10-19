/* Browser fixture: all API reads and AI transport stay in memory. No provider or POST. */
(function() {
    'use strict';
    var $ = window.jQuery, shared = window.taRequire('_ujgTA_llmClient');
    var records = {calls:[], pending:0}; window.taPreview = records;
    var rawFields = {
        summary:{name:'Тема', required:true, schema:{type:'string',system:'summary'}},
        description:{name:'Описание', schema:{type:'string',system:'description'}},
        priority:{name:'Приоритет', schema:{type:'priority',system:'priority'}, allowedValues:[{id:'2',name:'Высокий'},{id:'3',name:'Обычный'},{id:'4',name:'Низкий'}]},
        components:{name:'Компоненты',schema:{type:'array',items:'component',system:'components'}},
        fixVersions:{name:'Версии',schema:{type:'array',items:'version',system:'fixVersions'}},
        reporter:{name:'Автор',schema:{type:'user',system:'reporter'}},
        duedate:{name:'Срок',schema:{type:'date',system:'duedate'}},
        labels:{name:'Метки',schema:{type:'array',items:'string',system:'labels'}},
        customfield_1:{name:'Оценка',schema:{type:'number',custom:'com.atlassian.jira.plugin.system.customfieldtypes:float'}}
    };
    function result(name, value) {records.calls.push(name); return Promise.resolve(value);}
    var api = {
        getCurrentUser:function() {return result('identity', {key:'offline-reviewer',name:'reviewer'});},
        getProjects:function() {return result('projects',{values:[{id:'101',key:'DEMO',name:'Демонстрационный проект'},{id:'102',key:'APP',name:'Приложение'}],complete:true});},
        getCreateMeta:function(key) {return result('metadata',{projects:[{key:key,id:key === 'DEMO' ? '101':'102',issuetypes:[
            {id:'10',name:'Задача',subtask:false,fields:rawFields},
            {id:'11',name:'Ошибка',subtask:false,fields:rawFields},
            {id:'12',name:'Согласование',subtask:false,fields:Object.assign({},rawFields,{customfield_99:{name:'Согласующий комитет',required:true,schema:{type:'string',custom:'fixture:unsupported'}}})}
        ]}]});},
        getComponents:function(key) {return result('components',{values:[{id:'31',name:'API'},{id:'32',name:'Интерфейс'},{id:'33',name:'Инфраструктура'}],complete:true,projectKey:key});},
        getVersions:function(key) {return result('versions',{values:[{id:'41',name:'2026.10'},{id:'42',name:'2026.11'}],complete:true,projectKey:key});},
        searchUsers:function(query) {return result('users',{values:[{name:'anna',displayName:'Анна Смирнова'},{name:'alex',displayName:'Алексей Петров'},{name:'irina',displayName:'Ирина Козлова'}].filter(function(u) {return (u.name+' '+u.displayName).toLowerCase().indexOf(query.toLowerCase()) !== -1;}),complete:false});}
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
            resolve({text:JSON.stringify(response)});
        },1100);});
    }});
    var ai = window.taRequire('_ujgTA_ai').createClient({llmClient:llm,readConfig:function() {return {apiKey:'offline-fixture-key'};},fetchImpl:function() {throw new Error('Offline preview prohibits fetch');}});
    var Gadget = window.taRequire('_ujgTicketAssistantRuntime');
    var instance = new Gadget({getGadgetContentEl:function() {return $('#ticket-assistant');}}, {api:api,ai:ai,baseUrl:'',storage:null});
    records.instance = instance;
    records.ready = instance.ready.then(function() {return instance.controller.selectProject('DEMO');}).then(function() {
        return instance.controller.selectIssueType('10');
    }).then(function() {return instance.controller.selectTemplate('task');}).then(function() {
        document.documentElement.setAttribute('data-ta-preview-ready','true');
    });
})();
