define('_ujgTA_fields', [], function() {
    'use strict';

    var own = function(obj, key) { return Object.prototype.hasOwnProperty.call(obj, key); };
    var customPrefix = 'com.atlassian.jira.plugin.system.customfieldtypes:';
    var customKinds = { textfield: 'string', textarea: 'textarea', float: 'number', datepicker: 'date', datetime: 'datetime', select: 'option', multiselect: 'multioption', userpicker: 'user' };
    var systems = { summary: 'string', description: 'textarea', environment: 'textarea', duedate: 'date', priority: 'option', components: 'components', versions: 'versions', fixVersions: 'versions', labels: 'labels', assignee: 'user', reporter: 'user' };

    function kindFor(id, schema) {
        var kind;
        if (schema.custom) {
            if (schema.custom.indexOf(customPrefix) !== 0) return 'unknown';
            kind = customKinds[schema.custom.slice(customPrefix.length)];
        } else if (schema.system === id) kind = systems[id];
        if (kind === 'option' && schema.type === (schema.custom ? 'option' : 'priority')) return kind;
        var shapes = { string: ['string'], textarea: ['string'], number: ['number'], date: ['date'], datetime: ['datetime'], user: ['user'], multioption: ['array', 'option'], components: ['array', 'component'], versions: ['array', 'version'], labels: ['array', 'string'] };
        var shape = shapes[kind];
        return shape && schema.type === shape[0] && (!shape[1] || schema.items === shape[1]) ? kind : 'unknown';
    }

    function option(value) {
        if (!value || (typeof value.id !== 'string' && typeof value.id !== 'number') || !String(value.id)) return null;
        return { id: String(value.id), label: String(value.label != null ? value.label : value.value != null ? value.value : value.name != null ? value.name : value.id) };
    }

    function present(value) {
        return value !== undefined && value !== null && (typeof value !== 'string' || value.trim() !== '') && (!Array.isArray(value) || value.length > 0);
    }

    // Signature uses canonical JSON, avoiding a lossy hash for metadata invalidation.
    function canonical(value) {
        if (Array.isArray(value)) return value.map(canonical);
        if (value && typeof value === 'object') {
            var result = Object.create(null);
            Object.keys(value).sort().forEach(function(key) { result[key] = canonical(value[key]); });
            return result;
        }
        return value;
    }

    // catalogs = {components, versions, fields:{[typeId]:{[fieldId]:Catalog}}}.
    // Catalog = {values:Array, complete:boolean, projectKey?:string}; project
    // catalogs require the selected key. allowedValues is the authoritative
    // create-screen restriction; a known entry in a partial list is confirmed
    // only by its ID. autoCompleteUrl is informational and is never fetched.
    function normalizeMeta(raw, projectKey, catalogs) {
        catalogs = catalogs || {};
        var matches = raw && Array.isArray(raw.projects) ? raw.projects.filter(function(p) { return p.key === projectKey; }) : [];
        if (matches.length !== 1 || !present(matches[0].id) || !Array.isArray(matches[0].issuetypes)) throw new Error('Missing or ambiguous project metadata');
        var project = matches[0], seenTypes = Object.create(null);
        var meta = { projectKey: projectKey, projectId: String(project.id), issueTypes: project.issuetypes.map(function(type) {
            var typeId = String(type.id || '');
            if (!typeId || seenTypes[typeId] || !type.fields || typeof type.fields !== 'object' || Array.isArray(type.fields)) throw new Error('Incomplete issue type metadata');
            seenTypes[typeId] = true;
            return { id: typeId, name: String(type.name || typeId), subtask: type.subtask === true, fields: Object.keys(type.fields).sort().map(function(id) {
                var source = type.fields[id] || {}, kind = kindFor(id, source.schema || {});
                var typeCatalogs = catalogs.fields && own(catalogs.fields, typeId) ? catalogs.fields[typeId] : null;
                var catalog = typeCatalogs && own(typeCatalogs, id) ? typeCatalogs[id] : kind === 'components' ? catalogs.components : kind === 'versions' ? catalogs.versions : null;
                if (catalog && (kind === 'components' || kind === 'versions') && catalog.projectKey !== projectKey) catalog = null;
                // Create-screen restrictions take precedence over project-wide catalogs.
                if (Array.isArray(source.allowedValues)) catalog = null;
                var values = catalog ? catalog.values : source.allowedValues;
                var complete = catalog ? catalog.complete === true : Array.isArray(values) && source.optionsComplete !== false && !source.autoCompleteUrl;
                var allowed = Array.isArray(values) ? values.map(option).filter(Boolean) : [];
                if (!Array.isArray(values) || allowed.length !== values.length) complete = false;
                var spec = {
                    id: id, name: String(source.name || id), kind: kind, required: source.required === true,
                    supported: kind !== 'unknown', writable: !Array.isArray(source.operations) || source.operations.indexOf('set') !== -1,
                    hasDefaultValue: source.hasDefaultValue === true,
                    defaultValue: own(source, 'defaultValue') ? JSON.parse(JSON.stringify(source.defaultValue)) : null,
                    defaultApplicable: source.hasDefaultValue === true && own(source, 'defaultValue') && present(source.defaultValue),
                    allowedValues: allowed, optionsComplete: complete,
                    autoCompleteUrl: typeof source.autoCompleteUrl === 'string' ? source.autoCompleteUrl : null,
                    maxLength: Number.isInteger(source.maxLength) && source.maxLength > 0 ? source.maxLength : null
                };
                if (id === 'summary') spec.maxLength = Math.min(spec.maxLength || 255, 255);
                return spec;
            }) };
        }) };
        meta.signature = JSON.stringify(canonical(meta));
        return meta;
    }

    function getField(meta, typeId, fieldId) {
        var type = meta && meta.issueTypes.find(function(item) { return item.id === typeId; });
        return type && type.fields.find(function(field) { return field.id === fieldId; }) || null;
    }

    function resolveOption(field, input) {
        var byId = input && typeof input === 'object' && !Array.isArray(input) && typeof input.id === 'string';
        var matches = (field.allowedValues || []).filter(function(item) { return byId ? item.id === input.id : typeof input === 'string' && item.label === input; });
        if (matches.length === 1 && (byId || field.optionsComplete)) return { ok: true, value: { id: matches[0].id }, error: null };
        return { ok: false, value: null, error: !field.optionsComplete ? 'Jira confirmation required for this option' : matches.length > 1 ? 'Ambiguous option; select an ID' : 'Unknown option ID or label' };
    }

    return { normalizeMeta: normalizeMeta, getField: getField, resolveOption: resolveOption };
});
