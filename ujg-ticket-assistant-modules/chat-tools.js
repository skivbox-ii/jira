define('_ujgTA_chatTools', ['_ujgTA_fields'], function(fields) {
    'use strict';
    function copy(value) { return JSON.parse(JSON.stringify(value)); }
    // Metadata signatures contain whole catalogs; keep them private to the controller's guards.
    function modelValue(value) {
        if(Array.isArray(value)) return value.map(modelValue);
        if(value && typeof value==='object') {var out={};Object.keys(value).forEach(function(k) {if(k!=='metaSignature' && k!=='automaticUndo' && ['__proto__','constructor','prototype'].indexOf(k)===-1) out[k]=modelValue(value[k]);});return out;}
        return value;
    }
    function taskForModel(state) {
        var d=modelValue(state.draft),type=state.meta && d && state.meta.issueTypes.find(function(t){return t.id===d.issueTypeId;});
        if(!d)return d;
        var ids=new Set(['reporter','assignee']);
        (state.meta && state.meta.issueTypes || []).forEach(function(t){
            t.fields.filter(function(f){return f.kind==='user';}).forEach(function(f){ids.add(f.id);});
        });
        var present={};
        ids.forEach(function(id){
            if(type && type.fields.some(function(f){return f.id===id;}))present[id]=!!d.fields[id];
            delete d.fields[id];
            delete d.pendingFields[id];
        });
        d.userFieldsPresent=present;
        return d;
    }
    function fail(code) { var error=new Error(code);error.code=code;throw error; }
    function object(value) {return value && typeof value==='object' && !Array.isArray(value);}
    function argsOnly(args, keys) {
        if (!object(args) || Object.keys(args).some(function(k) {return keys.indexOf(k)===-1;})) fail('input');
    }
    function schema(properties, required) {return {type:'object',properties:properties || {},required:required || [],additionalProperties:false};}
    var changeProperties={instructions:{type:'string'},name:{type:'string'},whenToUse:{type:'string'},issueTypeId:{type:['string','null']}};
    // Only a stated effort estimate may populate Jira's estimate. A date, a
    // deployment window or time already spent is a different value.
    function effortQuestion(text) {
        if(!text || /окн[оаеуы]|длительность (?:выкладки|простоя)|затрачен|потрачен|уже потра|фактически|time spent/i.test(text))return false;
        return /трудозатрат|трудо[её]мкост|(?:исходн|оставш)\S* оценк|оценк[ауи]? (?:работ|времени)|(?:original|remaining) estimate|сколько (?:рабочих )?(?:часов|времени) (?:займ[её]т|нужно на|потребуется на) (?:эта |эту |данная )?работ/i.test(text);
    }
    function estimateTopic(text) {
        if(!effortQuestion(text))return null;
        var remaining=/(?:оставш\S* оценк|остаток трудозатрат|remaining estimate)/i.test(text);
        if(remaining && /исходн\S* оценк|original estimate/i.test(text))return null;
        return remaining?'remainingEstimate':'originalEstimate';
    }
    function estimateFromAnswer(text, question) {
        var clause=String(text || '').trim();
        var label=/^(исходная оценка(?: трудозатрат)?|оценка(?: трудозатрат| работы)?|трудозатраты|трудо[её]мкость|оставшаяся оценка|остаток трудозатрат|original estimate|remaining estimate)\s*[:=—–-]?\s*(?=\d)/i.exec(clause);
        var context=label ? label[1] : question || '';
        if(!label && !effortQuestion(context))return null;
        var value=(label ? clause.slice(label[0].length) : clause).trim().toLowerCase().replace(/[.!]$/,'')
            .replace(/(\d)\s*(недел(?:я|и|ь|ю)|нед\.?)/g,'$1w')
            .replace(/(\d)\s*(рабочих дней|день|дня|дней|д\.?)/g,'$1d')
            .replace(/(\d)\s*(час(?:а|ов)?|ч\.?)/g,'$1h')
            .replace(/(\d)\s*(минут(?:у|а|ы)?|мин\.?|м\.?)/g,'$1m');
        var key=label ? (/оставш|остаток|remaining/i.test(context)?'remainingEstimate':'originalEstimate') : estimateTopic(context);
        if(!key)return null;
        var checked=fields.timeTrackingValue({[key]:value.trim()});
        return checked.ok ? checked.value : null;
    }
    function statedEstimates(entries) {
        var estimates={},question='';
        entries.forEach(function(entry){
            if(entry.role==='assistant') {
                question=entry.text.split('\n').filter(function(line){return line.includes('?');}).pop() || '';
            } else if(entry.role==='user') {
                entry.text.split(/[;\n]/).forEach(function(line){
                    var found=estimateFromAnswer(line,question);
                    if(found)Object.assign(estimates,found);
                });
                question='';
            }
        });
        return estimates;
    }
    function keepTaskNote(args, state, text) {
        if(!state.generationFieldIds.includes('description'))return args;
        var sentences=String(text || '').split(/(?:\r?\n|(?<=[.!?;])\s+)/).map(function(s){return s.trim();});
        var notes=[];
        sentences.forEach(function(line,i){
            if(!/не (?:нужн|нужен|требуется|применим|имеет значения)|нет возможности|недоступн\S* (?:потому|так как)|неизвестн\S* (?:потому|так как)/i.test(line) ||
                /(?:спрашива|переспрашива|редактор|шаблон|повторяй|чат[-еау ]|не нужно менять описание)/i.test(line))return;
            var note=line;
            for(var j=i+1;j<sentences.length && /^(?:причина\s*[:—–-]|потому что|поскольку|так как)/i.test(sentences[j]);j++)note+=' '+sentences[j];
            notes.push(note);
        });
        if(typeof args.taskException==='string' && args.taskException.trim())notes.push(args.taskException.trim());
        // Preserve attributed user statements from the current canonical text
        // across generated rewrites. The free-form editor can explicitly edit them.
        var previous=state.draft.pendingFields.description || state.draft.fields.description || '';
        String(previous).split('\n').forEach(function(line){
            if(line.startsWith('Со слов пользователя: '))notes.push(line.slice('Со слов пользователя: '.length));
        });
        if(!notes.length)return args;
        var description=Object.hasOwn(args.fields,'description')?args.fields.description:
            state.draft.pendingFields.description || state.draft.fields.description || '';
        if(typeof description!=='string')return args;
        notes.forEach(function(note){
            if(!description.toLocaleLowerCase('ru').includes(note.toLocaleLowerCase('ru')))
                description+=(description.trim()?'\n\n':'')+'Со слов пользователя: '+note;
        });
        return Object.assign({},args,{fields:Object.assign({},args.fields,{description:description})});
    }
    function applicationQuestions(state) {
        var errors=Object.values(state.validation && state.validation.fieldErrors || {}).flat();
        return (state.validation && state.validation.questions || []).filter(function(question){return /^(?:app:|template:|devops:)/.test(question.id || '') && errors.includes(question.text);});
    }
    function descriptionSectionDefinitions(controller) {
        if(typeof controller.chatDescriptionSections==='function')return controller.chatDescriptionSections();
        var requirements=controller.chatDevopsRequirements && controller.chatDevopsRequirements();
        return requirements && requirements.sections || [];
    }
    // Read explicit section headings and catalog labels, never infer missing facts.
    // Unsupported or protected clauses remain unresolved alongside any safe edits.
    function literalAnswerPatch(controller,text) {
        var s=controller.getState(),d=s.draft,requirements=controller.chatDevopsRequirements && controller.chatDevopsRequirements();
        if(!d || d.projectKey!=='DEVOPS' || !requirements || requirements.kind==='unsupported' ||
            typeof d.fields.description!=='string' || !d.fields.description.trim() || typeof text!=='string')return null;
        var definitions=descriptionSectionDefinitions(controller),type=s.meta && s.meta.issueTypes.find(function(t){return t.id===d.issueTypeId;});
        if(!definitions.length || !type)return null;
        var patchFields={},sections={},unresolved=[],seen=Object.create(null),conflicts=new Set();
        function key(value) {return value.toLocaleLowerCase('ru').replace(/ё/g,'е').trim();}
        function available(id) {return s.generationFieldIds.includes(id) && !d.protectedFields[id] && !Object.hasOwn(d.pendingFields,id);}
        function assign(map,id,value,clause) {
            var topic=(map===sections?'section:':'field:')+id;
            if(conflicts.has(topic)) {unresolved.push(clause);return;}
            if(Object.hasOwn(map,id) && JSON.stringify(map[id])!==JSON.stringify(value)) {
                unresolved.push(seen[topic],clause);delete map[id];conflicts.add(topic);return;
            }
            map[id]=value;seen[topic]=clause;
        }
        var clauses=text.trim().split(/(?:\r?\n+|;\s*|(?<=[.!?])\s+)/).map(function(clause){return clause.trim();}).filter(Boolean);
        clauses.forEach(function(clause) {
            var clean=clause.replace(/[.!]$/,''),colon=clean.indexOf(':'),heading=colon<0?'':key(clean.slice(0,colon)),value=colon<0?'':clean.slice(colon+1).trim();
            if(/[?？][»”"')\].!]*\s*$/.test(clause) || /(?:^|[\s,:])(?:если|возможно|вероятно|при условии|при наличии|в случае|может быть|или)(?=$|[\s,:])/i.test(clean)) {
                unresolved.push(clause);return;
            }
            var definition=definitions.find(function(section){return [section.label].concat(section.aliases || []).some(function(label){return heading===key(label);});});
            if(definition && value) {
                if(!available('description')) {unresolved.push(clause);return;}
                assign(sections,definition.id,value,clause,definition.label);return;
            }
            // Catalog fields may use a colon or ordinary "Приоритет высокий".
            var spec=type.fields.find(function(field) {return field.kind==='option' &&
                (heading===key(field.name) || key(clean).startsWith(key(field.name)+' '));});
            if(spec) {
                var literal=heading===key(spec.name)?value:clean.slice(spec.name.length).trim();
                var choices=(spec.allowedValues || []).filter(function(option){return key(option.label)===key(literal);});
                if(!spec.supported || !spec.writable || !spec.optionsComplete || !available(spec.id) || choices.length!==1) {unresolved.push(clause);return;}
                assign(patchFields,spec.id,{id:choices[0].id},clause,spec.name);return;
            }
            // Reusable literal deployment phrases: preserve the whole stated
            // window/check, without computing duration, role, endpoint or status.
            var window=definitions.find(function(section){return section.id==='window';});
            var match=window && /^окно(?:\s+(?:разв[её]ртывания|работ|выполнения))?\s+((?:с|в)\s+.+)$/i.exec(clean);
            if(match) {
                if(!available('description')) {unresolved.push(clause);return;}
                assign(sections,window.id,match[1],clause,window.label);return;
            }
            var verification=definitions.find(function(section){return section.id==='verification';}),verifier=definitions.find(function(section){return section.id==='verifier';});
            match=verification && verifier && /^(.+?)\s+(?:проверит|проверяет|проверят|проверяют)\s+(.+)$/i.exec(clean);
            if(match && !/(?:^|\s)не$/i.test(match[1]) && !/^(?:если|когда|возможно|никто|кто|почему|пусть|попроси)(?:\s|$)/i.test(match[1])) {
                if(!available('description')) {unresolved.push(clause);return;}
                assign(sections,verification.id,clean,clause,verification.label);
                assign(sections,verifier.id,match[1],clause,verifier.label);return;
            }
            unresolved.push(clause);
        });
        if(!Object.keys(patchFields).length && !Object.keys(sections).length)return null;
        return {proposal:Object.assign({fields:patchFields},Object.keys(sections).length?{descriptionSections:sections}:{}),unresolved:unresolved};
    }
    function create(options) {
        var controller=options.controller;
        function fresh(request) {
            if (request && request.signal && request.signal.aborted || options.isCurrent && !options.isCurrent()) fail('stale');
        }
        function snapshot() {return options.getSnapshot ? options.getSnapshot() : controller.chatSnapshot();}
        function mutate(fn) {return options.mutate ? options.mutate(fn) : fn();}
        function appManagedQuestions() {return typeof options.appManagedQuestions==='function' ? options.appManagedQuestions()===true : options.appManagedQuestions===true;}
        function task() {
            var state=controller.getState(),draft=taskForModel(state),definitions=descriptionSectionDefinitions(controller);
            if(appManagedQuestions() && draft)draft.questions=applicationQuestions(state);
            return {draft:draft,descriptionSectionDefinitions:definitions,descriptionSectionIds:definitions.map(function(section){return section.id;}),revision:controller.chatSnapshot(),validation:state.validation,generationFieldIds:state.generationFieldIds,
                devopsRequirements:controller.chatDevopsRequirements ? controller.chatDevopsRequirements() : null};
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
            tool('update_task','Propose all known field changes and partial descriptionSections in one local patch. Section keys are IDs from descriptionSectionIds; unchanged sections are preserved. fields is optional when descriptionSections is supplied. Manual replacements remain proposals. Only explicit user-stated Jira effort units are allowed. Never set users, numeric estimates, Epic or Sprint. In appManagedPatch mode the application owns missing questions.',Object.assign(schema({
                fields:{type:'object',additionalProperties:true},descriptionSections:{type:'object',minProperties:1,additionalProperties:{type:'string'}},questions:{type:'array',items:schema({id:{type:'string'},text:{type:'string'},reason:{type:'string'},required:{type:'boolean'}},['id','text','required'])},
                warnings:{type:'array',items:{type:'string'}},taskException:{type:'string'}}),{anyOf:[{required:['fields']},{required:['descriptionSections']}]}),async function(args) {
                argsOnly(args,['fields','descriptionSections','questions','warnings','taskException']);
                var explicitReview=options.explicitReview===true,managed=appManagedQuestions(),localRejected=[];
                var hasSections=Object.hasOwn(args,'descriptionSections');
                if(!Object.hasOwn(args,'fields') && !hasSections)fail('input');
                if(hasSections && (!object(args.descriptionSections) || !Object.keys(args.descriptionSections).length || Object.keys(args.descriptionSections).some(function(id){return typeof args.descriptionSections[id]!=='string';})))fail('input');
                if(args.fields===undefined)args=Object.assign({},args,{fields:{}});
                if(!object(args.fields))fail('input');
                if(managed){args=Object.assign({},args);delete args.questions;}
                if(managed && !Object.keys(args.fields).length && !hasSections)return {ok:false,reason:'Передай изменения полей или descriptionSections. Вопросы и проверку выполняет приложение.'};
                var literal=!explicitReview && typeof options.getVerbatimDescription==='function'?options.getVerbatimDescription():null;
                if(typeof literal!=='string' || !literal.trim())literal=null;
                if(literal!==null && (Object.hasOwn(args.fields,'description') || hasSections)) {
                    args=Object.assign({},args,{fields:Object.assign({},args.fields,{description:literal})});delete args.descriptionSections;hasSections=false;
                }
                if(explicitReview) {
                    var filtered=controller.chatFilterReviewFields(args.fields,snapshot());
                    if(!filtered.ok)fail(filtered.code);
                    if(args.warnings!==undefined && (!Array.isArray(args.warnings) || args.warnings.some(function(w){return typeof w!=='string';})))fail('input');
                    args=Object.assign({},args,{fields:filtered.fields,warnings:Array.from(new Set((args.warnings || []).concat(controller.getState().draft.warnings || [],filtered.warnings)))});
                }
                function omitReviewField(id,reason,partial) {
                    var next=Object.assign({},args.fields);delete next[id];
                    args=Object.assign({},args,{fields:next,warnings:Array.from(new Set((args.warnings || []).concat('При сверке пропущено поле «'+id+'»'+(partial?' (частично)':'')+': '+reason+'; прежние значения сохранены.')))});
                }
                if(Object.prototype.hasOwnProperty.call(args.fields || {},'timetracking')) {
                    var proposed=fields.timeTrackingValue(args.fields.timetracking),evidence=options.getEstimates ? options.getEstimates() : {},existing=controller.getState().draft.fields.timetracking || {};
                    var grounded=proposed.ok && !Object.keys(proposed.value).some(function(k){return proposed.value[k]!==existing[k] && proposed.value[k]!==evidence[k];});
                    if(managed && !grounded) {
                        var next=Object.assign({},args.fields);delete next.timetracking;args=Object.assign({},args,{fields:next});
                        localRejected.push({id:'timetracking',message:proposed.ok?'Трудозатраты не подтверждены пользователем.':'Укажите оценку в единицах Jira, например 2h или 30m.'});
                    } else if(!proposed.ok)fail('value');
                    else if(!grounded) {
                        if(explicitReview)omitReviewField('timetracking','трудозатраты не подтверждены ответами пользователя');
                        else return {ok:false,reason:'Трудозатраты не подтверждены пользователем. Сохрани остальные поля без timetracking и спроси исходную оценку в чате.'};
                    } else args=Object.assign({},args,{fields:Object.assign({},args.fields,{timetracking:Object.assign({},existing,proposed.value)})});
                }
                if(explicitReview && Object.hasOwn(args.fields,'labels')) {
                    var old=controller.getState().draft.fields.labels || [],labels=args.fields.labels;
                    if(!Array.isArray(old))old=[];
                    var userText=String(typeof options.reviewUserText==='function'?options.reviewUserText():options.reviewUserText || '');
                    if(Array.isArray(labels)) {
                        var skipped=false,accepted=labels.filter(function(label){
                            if(old.includes(label))return true;
                            var escaped=label.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
                            var grounded=new RegExp('(^|[^\\p{L}\\p{N}_-])'+escaped+'($|[^\\p{L}\\p{N}_-])','u').test(userText);
                            if(!grounded)skipped=true;return grounded;
                        });
                        if(skipped)omitReviewField('labels','неподтверждённые новые метки не применены',true);
                        if(!skipped || accepted.length)args=Object.assign({},args,{fields:Object.assign({},args.fields,{labels:Array.from(new Set(old.concat(accepted)))})});
                    }
                }
                if(literal===null) {
                    var withNotes=keepTaskNote(args,controller.getState(),options.getTurnText ? options.getTurnText() : '');
                    if(hasSections && Object.hasOwn(withNotes.fields,'description') && !Object.hasOwn(args.fields,'description')) {
                        var d=controller.getState().draft,old=String(d.pendingFields.description || d.fields.description || ''),noteText=withNotes.fields.description;
                        var added=noteText.startsWith(old)?noteText.slice(old.length).trim():noteText;
                        if(added && !added.split(/\n\n(?=Со слов пользователя: )/).every(function(note){var statement=note.replace(/^Со слов пользователя: /,'');return Object.values(args.descriptionSections).some(function(value){return value.includes(statement);});}))
                            return {ok:false,reason:'Сохрани оговорку пользователя в подходящем descriptionSections, включая полный текст раздела extra при его изменении: '+added};
                    } else args=withNotes;
                }
                var result=await mutate(function() {
                    var source=options.getSourceText ? options.getSourceText() : undefined;
                    return managed || explicitReview ? controller.chatUpdate(args,snapshot(),source,{appManagedQuestions:managed,reconcileUnresolvedFacts:explicitReview}) : controller.chatUpdate(args,snapshot(),source);
                });
                if(!result.ok) fail(result.code);if(localRejected.length)result=Object.assign({},result,{rejected:(result.rejected || []).concat(localRejected)});if(options.onSourceApplied) options.onSourceApplied();if(options.onTaskUpdated) options.onTaskUpdated(args,{appManagedQuestions:managed,result:result});return Object.assign(result,{task:task()});
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
            tool('validate_task','Validate required Jira fields, DEVOPS substantive labelled description sections, evidence, links, priority and live Jira relations deterministically. Returns actionable current missing questions. Required questions block creation. Does not create an issue.',schema(),function(args,request) {
                argsOnly(args,[]);var notice=options.validationNotice && options.validationNotice();if(notice)return {ok:false,pending:true,reason:notice};return controller.chatValidate(snapshot(),request);
            })
        ];
    }
    return {applicationQuestions:applicationQuestions,descriptionSectionDefinitions:descriptionSectionDefinitions,literalAnswerPatch:literalAnswerPatch,create:create,modelValue:modelValue,taskForModel:taskForModel,estimateFromAnswer:estimateFromAnswer,estimateTopic:estimateTopic,statedEstimates:statedEstimates};
});
