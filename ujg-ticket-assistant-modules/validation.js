define('_ujgTA_validation', ['_ujgTA_fields'], function(fields) {
    'use strict';

    function present(value) {
        return value !== undefined && value !== null && (typeof value !== 'string' || value.trim() !== '') && (!Array.isArray(value) || value.length > 0);
    }

    function safeTree(value, seen) {
        if (!value || typeof value !== 'object') return true;
        if (seen.indexOf(value) !== -1) return false;
        seen.push(value);
        var ok = Object.keys(value).every(function(key) {
            return ['__proto__', 'prototype', 'constructor'].indexOf(key) === -1 && safeTree(value[key], seen);
        });
        seen.pop();
        return ok;
    }

    function calendar(value) {
        if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
        var date = new Date(value + 'T00:00:00Z');
        return isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
    }

    function datetime(value) {
        if (typeof value !== 'string') return false;
        var parts = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:?\d{2})$/.exec(value);
        if (!parts || !calendar(parts[1]) || +parts[2] > 23 || +parts[3] > 59 || +parts[4] > 59) return false;
        if (parts[5] !== 'Z') {
            var offset = parts[5].replace(':', '');
            if (+offset.slice(1, 3) > 23 || +offset.slice(3) > 59) return false;
        }
        return isFinite(new Date(value).getTime());
    }

    function encode(field, value, policy) {
        if (field.kind === 'user' && ((field.id === 'assignee' && policy.allowAssignee !== true) || !Array.isArray(policy.explicitUserFields) || policy.explicitUserFields.indexOf(field.id) === -1)) return { ok: false, error: 'Explicit user selection and policy approval required' };
        if (value === null) return { ok: true, value: null };
        var kind = field.kind;
        if (kind === 'epic' || kind === 'sprint') return {ok:fields.relationAllowed(field,value) && !!policy.relations &&
            Object.prototype.hasOwnProperty.call(policy.relations,field.id) && policy.relations[field.id] === value, value:value,
            error:'Confirm the selected Jira relation again'};
        if (kind === 'string' || kind === 'textarea') return { ok: typeof value === 'string' && (!field.maxLength || value.length <= field.maxLength), value: value };
        if (kind === 'number') return { ok: typeof value === 'number' && isFinite(value), value: value };
        if (kind === 'date' || kind === 'datetime') return { ok: kind === 'date' ? calendar(value) : datetime(value), value: value };
        if (kind === 'labels') return { ok: Array.isArray(value) && value.every(function(item) { return typeof item === 'string' && !!item.trim(); }), value: value };
        if (kind === 'user') return {
            ok: value && !Array.isArray(value) && typeof value.name === 'string' && !!value.name.trim(),
            value: { name: value && value.name }
        };
        if (kind === 'option') return fields.resolveOption(field, value);
        if (['multioption', 'components', 'versions'].indexOf(kind) !== -1) {
            if (!Array.isArray(value)) return { ok: false };
            var resolved = value.map(function(item) { return fields.resolveOption(field, item); });
            return { ok: resolved.every(function(item) { return item.ok; }), value: resolved.map(function(item) { return item.value; }) };
        }
        return { ok: false };
    }

    function check(meta, typeId, values, policy) {
        var result = { ok: false, fieldErrors: Object.create(null), warnings: [], unsupportedRequired: [] }, output = {};
        policy = policy || {};
        function error(id, message) {
            if (!result.fieldErrors[id]) result.fieldErrors[id] = [];
            result.fieldErrors[id].push(message);
        }
        var validProject = meta && typeof meta.projectId === 'string' && !!meta.projectId.trim() && meta.projectId.trim() === meta.projectId;
        if (!validProject) error('project', 'Select a project with a valid metadata ID');
        var validTypeId = typeof typeId === 'string' && !!typeId.trim() && typeId.trim() === typeId;
        var type = validTypeId && meta && Array.isArray(meta.issueTypes) && meta.issueTypes.find(function(item) { return item.id === typeId; });
        if (!type || type.subtask) error('issuetype', 'Select an available non-subtask issue type');
        if (!values || typeof values !== 'object' || Array.isArray(values) || !safeTree(values, [])) error('_input', 'Expected field object without forbidden keys or cycles');
        if (Object.keys(result.fieldErrors).length) return { validation: result, output: output };
        Object.keys(values).forEach(function(id) {
            var field = fields.getField(meta, typeId, id);
            if (id === 'project' || id === 'issuetype' || !field || !field.supported || !field.writable) { error(id, 'Field is unknown, unsupported or not writable: ' + id); return; }
            var encoded = encode(field, values[id], policy);
            if (!encoded.ok) error(id, encoded.error || 'Invalid value for ' + field.name + ' (' + id + ')');
            else output[id] = encoded.value;
        });
        type.fields.forEach(function(field) {
            // Scope is validated above and injected by the builder, never supplied by values.
            if (field.id === 'project' || field.id === 'issuetype') return;
            if (!field.required) return;
            var supplied = Object.prototype.hasOwnProperty.call(values, field.id);
            if ((!supplied || !present(values[field.id])) && (supplied || !field.defaultApplicable)) {
                error(field.id, 'Обязательное поле: ' + field.name + ' (' + field.id + ')');
                if (!field.supported || !field.writable) result.unsupportedRequired.push(field.id);
            }
            if (fields.catalogUnavailable(field) && result.fieldErrors[field.id]) {
                error(field.id, 'Каталог вариантов недоступен: ' + field.name + '. Используйте форму Jira.');
                if (result.unsupportedRequired.indexOf(field.id) === -1) result.unsupportedRequired.push(field.id);
            }
        });
        result.ok = Object.keys(result.fieldErrors).length === 0;
        return { validation: result, output: output };
    }

    function validateFields(meta, typeId, values, policy) { return check(meta, typeId, values, policy).validation; }

    function buildCreatePayload(meta, typeId, values, policy) {
        var checked = check(meta, typeId, values, policy);
        if (!checked.validation.ok) {
            var error = new Error('Invalid Jira create fields');
            error.kind = 'validation'; error.validation = checked.validation;
            throw error;
        }
        checked.output.project = { id: meta.projectId };
        checked.output.issuetype = { id: typeId };
        return { fields: checked.output };
    }

    return { validateFields: validateFields, buildCreatePayload: buildCreatePayload };
});
