define('_ujgKA_storage', [], function() {
    'use strict';
    function cleanSettings(value) {
        value = value || {};
        var out = {};
        ['bridgeBaseUrl', 'confluenceBaseUrl'].forEach(function(k) { if (typeof value[k] === 'string') out[k] = value[k]; });
        ['spaces', 'projects'].forEach(function(k) { out[k] = Array.isArray(value[k]) ? value[k].filter(function(s) {return typeof s === 'string';}) : []; });
        if (value.skill && typeof value.skill.instructions === 'string') out.skill = {id: 'corporate-rules', name: 'Корпоративные правила', instructions: value.skill.instructions};
        if (value.tokenBudget && Number.isSafeInteger(value.tokenBudget.context) && Number.isSafeInteger(value.tokenBudget.reserve) && value.tokenBudget.reserve > 0 && value.tokenBudget.reserve < value.tokenBudget.context) out.tokenBudget = {context:value.tokenBudget.context,reserve:value.tokenBudget.reserve};
        return out;
    }
    function history(value) {
        return (Array.isArray(value) ? value : []).filter(function(m) {return m && /^(user|assistant)$/.test(m.role) && typeof m.text === 'string';}).map(function(m) {
            return {role:m.role,text:m.text,warnings:(Array.isArray(m.warnings) ? m.warnings : []).filter(function(w){return typeof w === 'string';}),sources:(Array.isArray(m.sources) ? m.sources : []).map(function(s) {
                var out = {historical:true,confirmed:false};
                ['key','sourceId','title','url','updatedAt','fetchedAt'].forEach(function(k) {if(typeof s[k] === 'string') out[k]=s[k];});
                ['offset','end'].forEach(function(k) {if(Number.isSafeInteger(s[k]) && s[k]>=0) out[k]=s[k];});
                if(typeof s.version === 'number' || typeof s.version === 'string') out.version=s.version;
                out.complete=s.complete===true;
                out.warnings=(Array.isArray(s.warnings)?s.warnings:[]).filter(function(w){return typeof w==='string';});
                return out;
            })};
        });
    }
    function createStore(options) {
        if (!options || !options.origin || !options.userKey) throw new Error('Verified knowledge identity required');
        var key='ujg.knowledgeAssistant.v1:'+options.origin+':'+options.userKey;
        var memory={settings:{},histories:Object.create(null)}, persistent=!!options.storage;
        function redact(value) {
            return typeof options.redact==='function' ? options.redact(value) : value;
        }
        function scrub(value){
            if(typeof value==='string')return redact(value);
            if(Array.isArray(value))return value.map(scrub);
            if(value && typeof value==='object'){
                var out=Object.create(null);
                Object.keys(value).forEach(function(k){out[redact(k)]=scrub(value[k]);});return out;
            }
            return value;
        }
        function sanitize(value) {
            value=value||{};
            var histories=Object.create(null);
            if(value.histories && typeof value.histories==='object' && !Array.isArray(value.histories)) {
                Object.keys(value.histories).forEach(function(identity){histories[identity]=history(value.histories[identity]);});
            }
            // Migrate the previous single-transcript record without reassigning its identity.
            if(typeof value.historyIdentity==='string' && Array.isArray(value.history) && !Object.prototype.hasOwnProperty.call(histories,value.historyIdentity)) {
                histories[value.historyIdentity]=history(value.history);
            }
            return scrub({settings:cleanSettings(value.settings),histories:histories});
        }
        function read() {
            if(persistent) try {var raw=options.storage.getItem(key);if(raw)memory=sanitize(JSON.parse(raw));} catch(ignored){persistent=false;}
        }
        function load() {
            read();var snapshot=sanitize(memory), identity=redact(options.historyKey||options.userKey);
            // Never return the map: Jira-only discovery and each verified identity see their own view.
            return {settings:snapshot.settings,history:options.settingsOnly?[]:snapshot.histories[identity]||[],historyIdentity:identity};
        }
        function save(value) {
            // Another verified identity's store may have saved since this store last loaded.
            read();memory=sanitize(memory);memory.settings=scrub(cleanSettings(value && value.settings));
            if(!options.settingsOnly)memory.histories[redact(options.historyKey||options.userKey)]=scrub(history(value && value.history));
            // Keep the entire sanitized transcript in memory if the actual write fails (e.g. quota).
            if(persistent)try{options.storage.setItem(key,JSON.stringify(memory));}catch(ignored){persistent=false;}
        }
        return {load:load,save:save,isPersistent:function(){return persistent;}};
    }
    return {createStore:createStore,cleanSettings:cleanSettings};
});
