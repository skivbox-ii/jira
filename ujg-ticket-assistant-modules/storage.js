define('_ujgTA_storage', ['_ujgTA_profiles', '_ujgTA_draft'], function(profiles, drafts) {
    'use strict';

    // One module listener records invalidations, never retains stores or edits drafts.
    var changes = Object.create(null), eventRevision = 0, cleared = null;
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
        window.addEventListener('storage', function(event) {
            if (event.key === null) cleared = { area: event.storageArea, revision: ++eventRevision };
            else if (event.key.indexOf('ujg-ticket-assistant:v1:') === 0) {
                changes[event.key] = { area: event.storageArea, revision: ++eventRevision };
            }
        });
    }

    function clone(value) { return JSON.parse(JSON.stringify(value)); }

    // Use the same nested whitelist for writes, rereads and in-memory fallback.
    function copyDraft(input) {
        if (input === null || input === undefined) return null;
        return JSON.parse(drafts.serialize(input));
    }

    function createStore(options) {
        var memory = Object.create(null);
        var observed = Object.create(null), startedAt = eventRevision;
        var persistent = typeof options.userKey === 'string' && !!options.userKey.trim() && typeof options.origin === 'string' && !!options.origin && !!options.storage;
        var conversationPersistent = persistent;
        function warn(reason) {
            if (typeof options.onWarning === 'function') options.onWarning(reason);
        }
        function key(projectKey) {
            return 'ujg-ticket-assistant:v1:' + [options.origin, options.userKey, projectKey].map(encodeURIComponent).join(':');
        }
        function empty() { return { revision: 0, settings: profiles.createDefaults(), draft: null }; }
        function load(projectKey) {
            var scope = key(projectKey);
            if (persistent) {
                var change = changes[scope];
                var externalRevision = Math.max(
                    change && change.area === options.storage ? change.revision : 0,
                    cleared && cleared.area === options.storage ? cleared.revision : 0
                );
                if (externalRevision > (observed[scope] || startedAt)) {
                    observed[scope] = externalRevision;
                    warn('Personal storage changed externally; reload or resolve the revision conflict.');
                }
                try {
                    var text = options.storage.getItem(scope);
                    if (text === null) memory[scope] = empty();
                    else {
                        var parsed = JSON.parse(text);
                        var settings = profiles.validateSettings(parsed.settings);
                        if (!settings.ok || !Number.isSafeInteger(parsed.revision) || parsed.revision < 0) throw new Error('Invalid stored settings');
                        var draft = copyDraft(parsed.draft);
                        var previousDraft = memory[scope] && memory[scope].draft;
                        if (draft) {
                            var sameLiveDraft = previousDraft && JSON.stringify(previousDraft) === JSON.stringify(draft);
                            var recovered = drafts.restore(draft);
                            // A reread of this instance's unchanged draft is not a reload.
                            if (sameLiveDraft) { recovered.checked = draft.checked; recovered.attachments = draft.attachments; }
                            recovered.creation = draft.creation;
                            draft = recovered;
                        }
                        if (draft && draft.creation && draft.creation.status === 'submitting') {
                            var previousCreation = previousDraft && previousDraft.creation;
                            // Only this store's matching live attempt survives a persistent reread.
                            var live = previousCreation && previousCreation.status === 'submitting' &&
                                typeof draft.creation.attemptId === 'string' && !!draft.creation.attemptId &&
                                previousCreation.attemptId === draft.creation.attemptId && previousDraft.id === draft.id;
                            if (!live) draft.creation.status = 'unknown';
                        }
                        memory[scope] = { revision: parsed.revision, settings: settings.value, draft: draft };
                    }
                } catch (error) {
                    persistent = false;
                    warn('Persistent storage unavailable or damaged; using memory.');
                }
            }
            if (!memory[scope]) memory[scope] = empty();
            return clone(memory[scope]);
        }
        function save(projectKey, value, expectedRevision, transition) {
            // A fresh read detects other tabs; this is not an atomic cross-tab lock.
            var current = load(projectKey);
            if (current.revision !== expectedRevision) return { ok: false, revision: current.revision, reason: 'conflict' };
            var previous = current.draft, creation = previous && previous.creation, nextDraft = value && value.draft;
            if (creation && (creation.issueKey || ['submitting','unknown','created'].indexOf(creation.status) !== -1)) {
                var sameOutcome = nextDraft && previous.id === nextDraft.id && JSON.stringify(creation) === JSON.stringify(nextDraft.creation);
                var explicitTransition = transition && transition.draftId === previous.id && transition.attemptId === creation.attemptId &&
                    (transition.creation === true && nextDraft && nextDraft.id === previous.id || transition.newDraft === true && creation.status === 'created');
                if (!sameOutcome && !explicitTransition) return {ok:false,revision:current.revision,reason:'creation-guard'};
            }
            var settings = profiles.validateSettings(value && value.settings);
            if (!settings.ok || current.revision === Number.MAX_SAFE_INTEGER) return { ok: false, revision: current.revision, reason: 'invalid' };
            var next;
            try { next = { revision: current.revision + 1, settings: settings.value, draft: copyDraft(value.draft) }; }
            catch (error) { return { ok: false, revision: current.revision, reason: 'invalid' }; }
            memory[key(projectKey)] = next;
            if (persistent) {
                try { options.storage.setItem(key(projectKey), JSON.stringify(next)); }
                catch (error) {
                    persistent = false;
                    warn('Persistent storage unavailable; changes retained in memory.');
                }
            }
            return { ok: true, revision: next.revision, reason: null };
        }
        function clearDraft(projectKey, expectedRevision) {
            var value = load(projectKey);
            value.draft = null;
            return save(projectKey, value, expectedRevision);
        }
        // Conversations have a separate CAS counter, so history never rewrites task creation guards.
        var conversations=Object.create(null);
        function conversationKey(projectKey,draftId) {return key(projectKey)+':chat:'+encodeURIComponent(draftId);}
        function cleanConversation(value) {
            if(!value || !Array.isArray(value.transcript) || !Array.isArray(value.messages)) throw new Error('Invalid conversation');
            // Runtime history is inert data; never deserialize functions or invoke tools on load.
            function clean(value,depth) {
                if(depth>40) throw new Error('Conversation nesting');
                if(value===null || typeof value==='string' || typeof value==='boolean' || typeof value==='number' && Number.isFinite(value)) return value;
                if(Array.isArray(value)) return value.map(function(v) {return clean(v,depth+1);});
                if(value && Object.prototype.toString.call(value)==='[object Object]') {
                    var result={};Object.keys(value).forEach(function(k) {
                        if(['__proto__','constructor','prototype','apiKey','authorization','headers','cookie','token','file'].indexOf(k)===-1 && value[k]!==undefined) result[k]=clean(value[k],depth+1);
                    });return result;
                }
                throw new Error('Invalid conversation value');
            }
            return {transcript:value.transcript.filter(function(m) {return m && typeof m.id==='string' && ['user','assistant','system'].indexOf(m.role)!==-1 && typeof m.text==='string';})
                .map(function(m) {
                    var entry={id:m.id,role:m.role,text:m.text};
                    if(m.kind==='template') entry.kind='template';
                    return entry;
                }),messages:clean(value.messages,0),
                pendingTemplateProposal:value.pendingTemplateProposal ? clean(value.pendingTemplateProposal,0) : null,
                notices:Array.isArray(value.notices) ? value.notices.filter(function(n) {return typeof n==='string';}) : []};
        }
        function loadConversation(projectKey,draftId) {
            var scope=conversationKey(projectKey,draftId);
            if(conversationPersistent) try {
                var raw=options.storage.getItem(scope);
                if(raw===null) conversations[scope]={revision:0,value:null};
                else {
                    var parsed=JSON.parse(raw);
                    if(!Number.isSafeInteger(parsed.revision) || parsed.revision<0) throw new Error('Invalid conversation revision');
                    conversations[scope]={revision:parsed.revision,value:cleanConversation(parsed.value)};
                }
            } catch(error) {conversationPersistent=false;warn('Conversation storage unavailable; using memory.');}
            return clone(conversations[scope] || {revision:0,value:null});
        }
        function saveConversation(projectKey,draftId,value,expectedRevision) {
            var current=loadConversation(projectKey,draftId);
            if(current.revision!==expectedRevision) return {ok:false,reason:'conflict',revision:current.revision};
            if(current.revision===Number.MAX_SAFE_INTEGER) return {ok:false,reason:'invalid',revision:current.revision};
            var next;try {next={revision:current.revision+1,value:cleanConversation(value)};} catch(error) {return {ok:false,reason:'invalid',revision:current.revision};}
            var scope=conversationKey(projectKey,draftId);conversations[scope]=next;
            if(conversationPersistent) try {options.storage.setItem(scope,JSON.stringify(next));}
            catch(error) {conversationPersistent=false;warn('Conversation storage unavailable; changes retained in memory.');}
            return {ok:true,revision:next.revision};
        }
        function withCreationLock(projectKey,draftId,action) {
            var locks=options.locks || (typeof navigator!=='undefined' && navigator.locks);
            if(!locks || typeof locks.request!=='function') return Promise.resolve().then(action);
            return locks.request(key(projectKey)+':create:'+encodeURIComponent(draftId),{mode:'exclusive',ifAvailable:true},function(lock) {
                return lock ? action() : {ok:false,reason:'busy'};
            });
        }
        return { isConversationPersistent:function() {return conversationPersistent;},withCreationLock:withCreationLock,loadConversation:loadConversation,saveConversation:saveConversation,load: load, save: save, clearDraft: clearDraft, isPersistent: function() { return persistent; } };
    }

    return { createStore: createStore };
});
