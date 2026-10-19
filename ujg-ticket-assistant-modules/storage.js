define('_ujgTA_storage', ['_ujgTA_profiles'], function(profiles) {
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

    // Draft files and arbitrary extra properties never enter persistent storage.
    function copyDraft(input) {
        if (input === null || input === undefined) return null;
        if (typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid draft');
        var result = {};
        ['schemaVersion', 'id', 'projectKey', 'issueTypeId', 'templateId', 'source', 'fields', 'protectedFields', 'pendingFields', 'questions', 'warnings', 'evidence', 'sourceRevision', 'settingsRevision', 'draftRevision', 'metaSignature', 'checked', 'creation'].forEach(function(key) {
            if (Object.prototype.hasOwnProperty.call(input, key)) result[key] = clone(input[key]);
        });
        result.attachments = [];
        return result;
    }

    function createStore(options) {
        var memory = Object.create(null);
        var observed = Object.create(null), startedAt = eventRevision;
        var persistent = typeof options.userKey === 'string' && !!options.userKey.trim() && typeof options.origin === 'string' && !!options.origin && !!options.storage;
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
                        if (draft && draft.creation && draft.creation.status === 'submitting') {
                            var previousDraft = memory[scope] && memory[scope].draft;
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
        function save(projectKey, value, expectedRevision) {
            // A fresh read detects other tabs; this is not an atomic cross-tab lock.
            var current = load(projectKey);
            if (current.revision !== expectedRevision) return { ok: false, revision: current.revision, reason: 'conflict' };
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
        return { load: load, save: save, clearDraft: clearDraft };
    }

    return { createStore: createStore };
});
