define('_ujgTA_chatTools', ['_ujgTA_fields'], function(fields) {
    'use strict';
    function copy(value) { return JSON.parse(JSON.stringify(value)); }
    // Metadata signatures contain whole catalogs; keep them private to the controller's guards.
    function modelValue(value) {
        if(Array.isArray(value)) return value.map(modelValue);
        if(value && typeof value==='object') {var out={};Object.keys(value).forEach(function(k) {if(k!=='metaSignature' && k!=='automaticUndo' && ['__proto__','constructor','prototype'].indexOf(k)===-1) out[k]=modelValue(value[k]);});return out;}
        return value;
    }
    function fail(code) { var error=new Error(code);error.code=code;throw error; }
    function object(value) {return value && typeof value==='object' && !Array.isArray(value);}
    function argsOnly(args, keys) {
        if (!object(args) || Object.keys(args).some(function(k) {return keys.indexOf(k)===-1;})) fail('input');
    }
    function schema(properties, required) {return {type:'object',properties:properties || {},required:required || [],additionalProperties:false};}
    var changeProperties={instructions:{type:'string'},name:{type:'string'},whenToUse:{type:'string'},issueTypeId:{type:['string','null']}};
    function create(options) {
        var controller=options.controller;
        function fresh(request) {
            if (request && request.signal && request.signal.aborted || options.isCurrent && !options.isCurrent()) fail('stale');
        }
        function snapshot() {return options.getSnapshot ? options.getSnapshot() : controller.chatSnapshot();}
        function mutate(fn) {return options.mutate ? options.mutate(fn) : fn();}
        function task() {
            var state=controller.getState();
            return {draft:state.draft,revision:controller.chatSnapshot(),validation:state.validation,generationFieldIds:state.generationFieldIds};
        }
        function readTemplate() {var result=controller.chatReadTemplate();if(!result) fail('selection');return result;}
        function tool(name, description, parameters, execute) {
            return {name:name,description:description,parameters:parameters,execute:async function(args,request) {
                fresh(request);var result=await execute(args,request || {});fresh(request);return modelValue(copy(result));
            }};
        }
        return [
            tool('get_task','Read the authoritative task, protected fields, questions, revisions and readiness.',schema(),function(args) {argsOnly(args,[]);return task();}),
            tool('list_fields','Read field schemas and available issue types without loading option catalogs.',schema(),function(args) {
                argsOnly(args,[]);var state=controller.getState(), d=state.draft;
                var type=state.meta && d && state.meta.issueTypes.find(function(t) {return t.id===d.issueTypeId;});
                return {issueTypes:state.meta ? state.meta.issueTypes.filter(function(t) {return !t.subtask;}).map(function(t) {return {id:t.id,name:t.name};}) : [],
                    fields:type ? type.fields.map(function(f) {return {id:f.id,name:f.name,kind:f.kind,required:f.required,supported:f.supported,writable:f.writable,
                        maxLength:f.maxLength,humanOnly:['user','number','epic','sprint'].indexOf(f.kind)!==-1,optionsComplete:f.optionsComplete};}) : []};
            }),
            tool('find_options','Search actual metadata options. An incomplete result requires explicit disambiguation; never invent IDs.',schema({fieldId:{type:'string'},query:{type:'string'},limit:{type:'integer',minimum:1,maximum:50}},['fieldId']),function(args) {
                argsOnly(args,['fieldId','query','limit']);
                if(typeof args.fieldId!=='string' || args.query!==undefined && typeof args.query!=='string' || args.limit!==undefined && (!Number.isSafeInteger(args.limit) || args.limit<1 || args.limit>50)) fail('input');
                var state=controller.getState(), spec=state.draft && fields.getField(state.meta,state.draft.issueTypeId,args.fieldId);
                if(!spec || !spec.supported || ['user','number','epic','sprint'].indexOf(spec.kind)!==-1) fail('human-only');
                var query=(args.query || '').toLowerCase(), limit=args.limit || 20;
                var matches=(spec.allowedValues || []).filter(function(v) {return (v.id+' '+v.label).toLowerCase().indexOf(query)!==-1;});
                return {fieldId:spec.id,values:matches.slice(0,limit),complete:spec.optionsComplete===true && matches.length<=limit,total:matches.length};
            }),
            tool('update_task','Apply a validated local patch; replacements of manual fields remain proposals. Never set users, estimates, Epic or Sprint. Questions omitted are retained.',schema({
                fields:{type:'object',additionalProperties:true},questions:{type:'array',items:schema({id:{type:'string'},text:{type:'string'},reason:{type:'string'},required:{type:'boolean'}},['id','text','required'])},
                warnings:{type:'array',items:{type:'string'}},taskException:{type:'string'}},['fields']),async function(args) {
                argsOnly(args,['fields','questions','warnings','taskException']);
                var result=await mutate(function() {return controller.chatUpdate(args,snapshot(),options.getSourceText ? options.getSourceText() : undefined);});
                if(!result.ok) fail(result.code);if(options.onSourceApplied) options.onSourceApplied();if(options.onTaskUpdated) options.onTaskUpdated(args);return Object.assign(result,{task:task()});
            }),
            tool('read_template','Read the exact selected personal template text, binding and revision.',schema(),function(args) {
                argsOnly(args,[]);var result=readTemplate();
                if(options.onTemplateRead) options.onTemplateRead(result);return result;
            }),
            tool('propose_template_change','Stage an explicit visible template diff. Does not save settings or alter this task. Only the human Apply action can commit it.',schema({changes:schema(changeProperties)},['changes']),function(args) {
                argsOnly(args,['changes']);argsOnly(args.changes,Object.keys(changeProperties));
                if(!Object.keys(args.changes).length || Object.keys(args.changes).some(function(k) {return k==='issueTypeId' ? args.changes[k]!==null && typeof args.changes[k]!=='string' : typeof args.changes[k]!=='string';})) fail('input');
                var read=readTemplate(), after=Object.assign({},read.template,args.changes);
                var state=controller.getState();if(after.issueTypeId!==null && !state.meta.issueTypes.some(function(t) {return !t.subtask && t.id===after.issueTypeId;})) fail('selection');
                var proposal={before:read.template,after:after,snapshot:snapshot()};
                if(options.onTemplateProposal) options.onTemplateProposal(copy(proposal));return {ok:true,pending:true,proposal:proposal};
            }),
            tool('validate_task','Validate required fields, allowed values and live Jira relations deterministically. Required questions block creation. Does not create an issue.',schema(),function(args,request) {
                argsOnly(args,[]);return controller.chatValidate(snapshot(),request);
            })
        ];
    }
    return {create:create,modelValue:modelValue};
});
