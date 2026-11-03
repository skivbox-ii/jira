define('_ujgKnowledgeAssistant', ['_ujgShared_llmClient','_ujgKA_transport','_ujgKA_jiraApi','_ujgKA_confluenceApi','_ujgKA_evidence','_ujgKA_tools','_ujgKA_skills','_ujgKA_chat','_ujgKA_storage','_ujgKA_ui'],
function(shared, transportModule, jiraModule, confluenceModule, evidenceModule, toolsModule, skills, chatModule, storageModule, uiModule) {
    'use strict';
    function KnowledgeAssistantGadget(API, dependencies) {
        var deps=dependencies||{}, content=API.getGadgetContentEl();
        if(content && content.jquery) content=content[0];
        if(!content) throw new Error('Knowledge assistant content element required');
        if(content._ujgKA_instance) content._ujgKA_instance.destroy();
        var doc=content.ownerDocument, win=doc.defaultView, root=doc.createElement('div');content.appendChild(root);
        var dead=false, generation=0, currentChat=null, evidence=null, verification=null, token='', store=null, view;
        // Rotation does not revoke old credentials. Keep every supplied PAT in tab memory only.
        var knownSecrets=new Set();
        var backend;try{backend=deps.storage===undefined?win.localStorage:deps.storage;}catch(ignored){backend=null;}
        var settings=storageModule.cleanSettings(Object.assign({skill:skills.getDefaultSkill(),tokenBudget:{context:32768,reserve:4096}},deps.settings||{}));
        var origin=deps.origin||win.location.origin, jiraBase=deps.baseUrl==null?(API.getBaseUrl?API.getBaseUrl():''):deps.baseUrl;
        var fetchImpl=deps.fetchImpl||win.fetch && win.fetch.bind(win);
        var pendingResize=null;
        function resize(){if(dead||pendingResize!==null||!API.resize)return;pendingResize=win.setTimeout(function(){pendingResize=null;if(!dead)API.resize();},16);}
        function redact(value){
            var secrets=Array.from(knownSecrets).sort(function(a,b){return b.length-a.length;});
            var pattern=secrets.map(function(secret){return secret.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');}).join('|');
            return pattern ? String(value).replace(new RegExp(pattern,'g'),'[скрыто]') : String(value);
        }
        function scrub(value){if(typeof value==='string')return redact(value);if(Array.isArray(value))return value.map(scrub);if(value && typeof value==='object'){var out={};Object.keys(value).forEach(function(k){out[k]=scrub(value[k]);});return out;}return value;}
        function scrubModel(value){
            // Decode string literals only, including nested serialized tool envelopes.
            // Never parse objects/numbers: source IDs, numeric text, whitespace and code
            // must remain exact. Preserve each original literal unless a secret changed it.
            return value.replace(/"(?:[^"\\]|\\[\s\S])*"/g,function(literal){
                var text;
                try{text=JSON.parse(literal);}catch(ignored){return literal;}
                var clean=redact(scrubModel(text));
                return clean===text ? literal : JSON.stringify(clean);
            });
        }
        function clear(){
            generation++;if(verification)verification.abort();verification=null;
            if(currentChat)currentChat.dispose();currentChat=null;
            if(evidence)evidence.clear();evidence=null;
        }
        function userId(user){return user && [user.accountId,user.key,user.userKey,user.name,user.username].find(function(v){return typeof v==='string'&&v.trim();});}
        var facade={
            prompt:function(text){if(!currentChat)return Promise.reject({code:'not-configured'});return currentChat.prompt(redact(text)).then(scrub);},
            abort:function(){if(currentChat)currentChat.abort();},
            getFragment:function(source){
                var entry=evidence && evidence.get(source.sourceId); if(!entry || source.historical)return '';
                return redact((entry.ranges||[]).map(function(r){var start=Math.max(source.offset,r.offset),end=Math.min(source.end,r.offset+r.text.length);return end>start?r.text.slice(start-r.offset,end-r.offset):'';}).join(''));
            }
        };
        async function apply(next, newToken){
            clear();var epoch=generation;store=null;
            if(newToken){token=newToken.trim();if(token)knownSecrets.add(token);}
            settings=scrub(storageModule.cleanSettings(next));
            if(!transportModule.sourceBase(settings.confluenceBaseUrl))throw {code:'not-configured'};
            var aborter=new AbortController();verification=aborter;
            function current(){if(dead||epoch!==generation)throw {code:'aborted'};}
            var jiraTransport=transportModule.createTransport({mode:'session',baseUrl:jiraBase,fetchImpl:fetchImpl});
            var confluenceTransport=transportModule.createTransport({mode:'bridge',baseUrl:settings.bridgeBaseUrl,getToken:function(){return token;},fetchImpl:fetchImpl});
            try {
                // Explicit identities, never a health check or inferred display name.
                var jiraUser=await jiraTransport.getJson('/rest/api/2/myself',{}, {signal:aborter.signal});current();
                var confUser=await confluenceTransport.getJson('/rest/api/user/current',{}, {signal:aborter.signal});current();
                var jiraId=userId(jiraUser), confId=userId(confUser);
                if(!jiraId||!confId)throw {code:'unauthorized'};
                var userKey=JSON.stringify([jiraId,confId]), identityKey=JSON.stringify([origin,userKey,settings.bridgeBaseUrl,settings.confluenceBaseUrl]);
                store=storageModule.createStore({storage:backend,origin:origin,userKey:jiraId,historyKey:identityKey,redact:redact});
                var restored=store.load();
                evidence=evidenceModule.createEvidenceStore({identityKey:identityKey});
                var tools=toolsModule.createTools({evidence:evidence,getScopes:function(){return {spaces:settings.spaces,projects:settings.projects};},
                    jira:function(scopes){return jiraModule.createApi({transport:jiraTransport,scopes:scopes,baseUrl:jiraBase});},
                    confluence:function(scopes){return confluenceModule.createApi({transport:confluenceTransport,scopes:scopes,baseUrl:settings.confluenceBaseUrl});}});
                var runTool=tools.run;
                tools.run=async function(name,args,options){try{return await runTool(name,args,options);}catch(error){
                    if(epoch===generation&&view && /^(unauthorized|forbidden|not-configured|scope)$/.test(error.code)) view.onEvent({type:'error',message:error.code==='scope'?'Область поиска пуста: добавьте пространства или проекты в настройках.':'Требуется авторизация: проверьте вход Jira и PAT Confluence в настройках.'});
                    throw error;
                }};
                currentChat=chatModule.createKnowledgeChat({tools:tools,evidence:evidence,runtime:deps.runtime,
                    getContext:function(){return {identityKey:identityKey,scopes:{spaces:settings.spaces,projects:settings.projects},skill:settings.skill,tokenBudget:settings.tokenBudget};},
                    onEvent:function(event){if(!dead&&epoch===generation&&view){view.onEvent(scrub(event));resize();}},
                    requestText:function(request){
                        // Tool corpus and prior raw runtime messages also cross this model boundary.
                        request=Object.assign({},request,{system:redact(request.system),user:scrubModel(request.user)});
                        if(deps.requestText)return deps.requestText(request);
                        var config=shared.normalizeConfig((deps.readConfig||function(){return shared.readStoredConfig(backend);})());
                        if(!config)throw {code:'not-configured'};
                        return shared.requestText(config,{systemPrompt:request.system,userPrompt:request.user,preservePrompt:true,allowProtocolFallback:false,signal:request.signal,tokenBudget:settings.tokenBudget},function(url,options){return fetchImpl(url,Object.assign({},options,{signal:request.signal}));});
                    }});
                verification=null;resize();
                return {identity:{key:identityKey},storage:store,settings:settings,history:restored.history};
            }catch(error){current();throw {code:error && /^(unauthorized|forbidden|not-configured|aborted|rate-limit)$/.test(error.code)?error.code:'network',retryAfter:error && Number.isFinite(error.retryAfter)?error.retryAfter:null};}
        }
        async function restoreSettings(){
            clear();store=null;var epoch=generation,aborter=new AbortController();verification=aborter;
            try{
                var transport=transportModule.createTransport({mode:'session',baseUrl:jiraBase,fetchImpl:fetchImpl});
                var user=await transport.getJson('/rest/api/2/myself',{}, {signal:aborter.signal});
                if(dead||epoch!==generation)throw {code:'aborted'};
                var id=userId(user);if(!id)throw {code:'unauthorized'};
                var personal=storageModule.createStore({storage:backend,origin:origin,userKey:id,settingsOnly:true,redact:redact});
                verification=null;
                return personal.load().settings;
            }catch(error){throw {code:error && /^(unauthorized|forbidden|aborted)$/.test(error.code)?error.code:'network'};}
        }
        view=uiModule.mount(root,{chat:facade,identity:null,storage:null,redact:redact,connection:{getSettings:function(){return settings;},restoreSettings:restoreSettings,apply:apply}});
        var observer=typeof win.MutationObserver==='function'?new win.MutationObserver(resize):null;if(observer)observer.observe(root,{subtree:true,childList:true,attributes:true,characterData:true});
        this.ready=Promise.resolve();this.openSettings=function(){view.openSettings();resize();};
        this.destroy=function(){if(dead)return;dead=true;clear();token='';knownSecrets.clear();store=null;if(observer)observer.disconnect();if(pendingResize!==null)win.clearTimeout(pendingResize);view.dispose();root.remove();if(content._ujgKA_instance===this)delete content._ujgKA_instance;};
        content._ujgKA_instance=this;resize();
    }
    return KnowledgeAssistantGadget;
});
