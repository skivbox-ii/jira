define('_ujgTA_api', [], function() {
    'use strict';

    function failure(kind, status) {
        return { kind: kind, status: status || 0, fieldErrors: {}, message: 'Jira read failed: ' + kind };
    }

    function createApi(config) {
        var base = String(config.baseUrl || ''), origin = typeof location !== 'undefined' ? location.origin : null;
        if (typeof config.ajax !== 'function' || /[?#\\]/.test(base) || /(^|\/)\.{1,2}(\/|$)/.test(base) || /%/i.test(base) || /^\/\//.test(base)) throw new Error('Invalid Jira base URL');
        if (/^https?:\/\//.test(base)) {
            var parsed = new URL(base);
            if (!origin || parsed.origin !== origin || parsed.username || parsed.password) throw new Error('Jira base URL must use the current origin');
            base = parsed.pathname;
        } else if (base && base[0] !== '/') throw new Error('Jira base URL must be a context path');
        base = base.replace(/\/+$/, '');

        function request(path, data, options) {
            return new Promise(function(resolve, reject) {
                var signal = options && options.signal, xhr, settled = false;
                function finish(error, value) {
                    if (settled) return;
                    settled = true;
                    if (signal) signal.removeEventListener('abort', abort);
                    if (error) reject(error); else resolve(value);
                }
                function abort() {
                    finish(failure('abort'));
                    if (xhr && typeof xhr.abort === 'function') { try { xhr.abort(); } catch (ignore) {} }
                }
                if (signal && signal.aborted) { abort(); return; }
                if (signal) signal.addEventListener('abort', abort, { once: true });
                try {
                    xhr = config.ajax({ url: base + '/rest/api/2' + path, type: 'GET', dataType: 'json', timeout: 30000, data: data || {} });
                    Promise.resolve(xhr).then(function(value) { finish(null, value); }, function(error) {
                        var status = Number(error && error.status) || 0;
                        var kinds = { 401: 'unauthorized', 403: 'forbidden', 404: 'not-found', 429: 'rate-limit' };
                        finish(failure(kinds[status] || (status >= 500 ? 'server' : status ? 'http' : 'network'), status));
                    });
                    if (signal && signal.aborted && !settled) abort();
                } catch (ignore) { finish(failure('network')); }
            });
        }

        function catalog(path, data, options, picker, collectionKey) {
            var collected = [], expectedTotal = null, seen = Object.create(null);
            function page(startAt) {
                return request(path, Object.assign({}, data, { startAt: startAt, maxResults: 1000 }), options).then(function(raw) {
                    var values = Array.isArray(raw) ? raw : raw && raw[collectionKey || (picker ? 'users' : 'values')];
                    if (!Array.isArray(values)) throw failure('incomplete');
                    var total = raw && raw.total;
                    if (total != null && (!Number.isInteger(total) || total < 0 || expectedTotal !== null && total !== expectedTotal)) throw failure('incomplete');
                    if (total != null) expectedTotal = total;
                    if (raw.startAt != null && raw.startAt !== startAt || total != null && startAt + values.length > total) throw failure('incomplete');
                    values.forEach(function(value) {
                        var id = value && (value.id || value.name || value.key);
                        if (!id || seen[id]) throw failure('incomplete');
                        seen[id] = true;
                    });
                    collected = collected.concat(values);
                    var next = startAt + values.length;
                    if (picker) return { values: collected, complete: total != null ? next === total : raw.isLast === true, total: total == null ? null : total };
                    if (!Array.isArray(raw) && (total != null && next < total || raw.isLast === false)) {
                        if (!values.length || raw.isLast === true || total != null && next >= total) throw failure('incomplete');
                        return page(next);
                    }
                    if (!Array.isArray(raw) && total == null && raw.isLast !== true && !(collectionKey === 'projects' && raw.startAt == null && raw.isLast == null)) throw failure('incomplete');
                    return { values: collected, complete: true, total: total == null ? collected.length : total };
                });
            }
            return page(0);
        }

        function projectPath(key, suffix) { return '/project/' + encodeURIComponent(String(key)) + suffix; }
        function write(path, data, multipart, options) {
            return new Promise(function(resolve, reject) {
                var signal = options && options.signal, xhr, settled = false, sent = false;
                function finish(error, value) {
                    if (settled) return; settled = true;
                    if (signal) signal.removeEventListener('abort', abort);
                    if (error) reject(error); else resolve(value);
                }
                function fail(status) {
                    var e = failure(status ? 'http' : 'network', status);
                    e.outcome = !sent || status >= 400 && status < 500 && status !== 408 ? 'rejected' : 'unknown';
                    // Server text may contain secrets. Report field identities with a fixed message.
                    return e;
                }
                function abort() { finish(fail(0)); if (xhr && xhr.abort) xhr.abort(); }
                if (signal && signal.aborted) { abort(); return; }
                if (signal) signal.addEventListener('abort', abort, {once:true});
                try {
                    sent = true;
                    xhr = config.ajax({url:base + '/rest/api/2' + path,type:'POST',dataType:'json',timeout:30000,
                        data:multipart ? data : JSON.stringify(data),contentType:multipart ? false : 'application/json',
                        processData:false,headers:multipart ? {'X-Atlassian-Token':'no-check'} : {}});
                    Promise.resolve(xhr).then(function(raw) {
                        var value = multipart && Array.isArray(raw) && raw.length === 1 ? raw[0] : raw;
                        if (!value || typeof value.id !== 'string' || !value.id ||
                            (multipart ? typeof value.filename !== 'string' : typeof value.key !== 'string' || !/^[A-Za-z][A-Za-z0-9_]*-\d+$/.test(value.key))) {
                            finish(fail(0)); return;
                        }
                        finish(null, multipart ? {id:value.id,filename:value.filename} : {id:value.id,key:value.key});
                    }, function(error) {
                        var result = fail(Number(error && error.status) || 0), errors = error && error.responseJSON && error.responseJSON.errors;
                        if (result.outcome === 'rejected' && errors && typeof errors === 'object') Object.keys(errors).forEach(function(id) {
                            if (/^[A-Za-z][A-Za-z0-9_]*$/.test(id) && ['constructor','prototype','__proto__'].indexOf(id) === -1) result.fieldErrors[id] = ['Jira rejected this field.'];
                        });
                        finish(result);
                    });
                } catch (ignore) { finish(fail(0)); }
            });
        }
        function projectCatalog(key, suffix, options) {
            return catalog(projectPath(key, suffix), {}, options).then(function(result) {
                result.projectKey = String(key);
                return result;
            });
        }
        return {
            getProjects: function(options) { return catalog('/project', {}, options); },
            getCurrentUser: function(options) { return request('/myself', {}, options); },
            getCreateMeta: function(projectKey, issueTypeId, options) {
                var data = { projectKeys: String(projectKey), expand: 'projects.issuetypes.fields' };
                if (issueTypeId != null) data.issuetypeIds = String(issueTypeId);
                return catalog('/issue/createmeta', data, options, false, 'projects').then(function(result) { return { projects: result.values }; });
            },
            getComponents: function(key, options) { return projectCatalog(key, '/components', options); },
            getVersions: function(key, options) { return projectCatalog(key, '/versions', options); },
            searchUsers: function(query, options) { return catalog('/user/picker', { query: String(query || '') }, options, true); },
            getAttachmentMeta: function(options) { return request('/attachment/meta', {}, options); },
            createIssue: function(payload, options) { return write('/issue', payload, false, options); },
            uploadAttachment: function(key, file, options) {
                var data = new FormData(); data.append('file', file);
                return write('/issue/' + encodeURIComponent(key) + '/attachments', data, true, options);
            },
            getIssueAttachments: function(key, options) {
                return request('/issue/' + encodeURIComponent(key), {fields:'attachment'}, options).then(function(raw) {
                    if (!raw || !raw.fields || !Array.isArray(raw.fields.attachment)) throw failure('incomplete');
                    return raw.fields.attachment.map(function(a) {return {id:String(a.id),filename:String(a.filename),size:a.size};});
                });
            }
        };
    }

    return { createApi: createApi };
});
