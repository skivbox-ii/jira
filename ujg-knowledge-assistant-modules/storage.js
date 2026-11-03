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
        return (Array.isArray(value) ? value : []).filter(function(m) {return m && /^(user|assistant)$/.test(m.role) && typeof m.text === 'string';}).slice(-100).map(function(m) {
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
        var key='ujg.knowledgeAssistant.v1:'+options.origin+':'+options.userKey, memory={settings:{},history:[]}, persistent=!!options.storage;
        function sanitize(value) {
            var result={settings:cleanSettings(value && value.settings),history:history(value && value.history),historyIdentity:value && typeof value.historyIdentity==='string' ? value.historyIdentity : ''};
            // Redact a known tab credential even if a user pasted it into public prose.
            function redact(value){if(typeof value==='string')return options.redact(value);if(Array.isArray(value))return value.map(redact);if(value && typeof value==='object'){var out={};Object.keys(value).forEach(function(k){out[k]=redact(value[k]);});return out;}return value;}
            return typeof options.redact==='function' ? redact(result) : result;
        }
        function load() {
            if(persistent) try {var raw=options.storage.getItem(key); if(raw) memory=sanitize(JSON.parse(raw));} catch(ignored) {persistent=false;}
            var result=sanitize(memory);
            if(options.settingsOnly || result.historyIdentity!==(options.historyKey||options.userKey))result.history=[];
            return result;
        }
        function save(value) {
            memory=sanitize(Object.assign({},value,{historyIdentity:options.historyKey||options.userKey}));
            if(persistent) try {options.storage.setItem(key,JSON.stringify(memory));} catch(ignored) {persistent=false;}
        }
        return {load:load,save:save,isPersistent:function(){return persistent;}};
    }
    return {createStore:createStore,cleanSettings:cleanSettings};
});
