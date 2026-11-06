define('_ujgTA_draft', [], function() {
    'use strict';

    var sequence = 0;
    var revisionKeys = ['sourceRevision', 'settingsRevision', 'draftRevision', 'metaSignature'];
    var snapshotKeys = ['id', 'projectKey', 'issueTypeId', 'templateId'].concat(revisionKeys);
    function safeKey(key) { return ['__proto__', 'constructor', 'prototype'].indexOf(key) === -1; }
    function record(value) { return value && typeof value === 'object' && !Array.isArray(value); }
    function str(value) { return typeof value === 'string' ? value : null; }
    function revision(value) { return Number.isSafeInteger(value) && value >= 0 ? value : 0; }
    function strings(value) { return Array.isArray(value) ? value.filter(function(v) { return typeof v === 'string'; }) : []; }
    function list(value, mapper) { return Array.isArray(value) ? value.filter(record).map(mapper).filter(Boolean) : []; }
    function atom(value) {
        if (value === null || typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))) return value;
        if (record(value) && Object.prototype.toString.call(value) === '[object Object]') {
            if (typeof value.id === 'string') return { id: value.id };
            if (typeof value.name === 'string') return { name: value.name };
        }
        return undefined;
    }
    function fieldValue(value, id) {
        if (id==='timetracking' && record(value)) {
            var keys=Object.keys(value),result={};
            if (!keys.length || keys.some(function(key){return ['originalEstimate','remainingEstimate'].indexOf(key)===-1 || typeof value[key]!=='string';}))return undefined;
            keys.forEach(function(key){result[key]=value[key];});return result;
        }
        if (!Array.isArray(value)) return atom(value);
        var values = value.map(atom);
        return values.some(function(v) { return v === undefined; }) ? undefined : values;
    }
    function fields(input, protectedOnly) {
        var result = {};
        if (record(input)) Object.keys(input).filter(safeKey).forEach(function(key) {
            var value = protectedOnly ? (input[key] === true ? true : undefined) : fieldValue(input[key],key);
            if (value !== undefined) result[key] = value;
        });
        return result;
    }
    function questions(input) {
        return list(input, function(q) {
            return str(q.id) && str(q.text) ? { id: q.id, text: q.text, reason: str(q.reason) || '', required: q.required === true } : null;
        });
    }
    function includeReviewedQuestions(current, reviewed) {
        var result=questions(current);
        questions(reviewed).forEach(function(item) {
            result=result.filter(function(q) {return q.id!==item.id;});result.push(item);
        });
        return result;
    }
    function evidence(input, source) {
        return list(input, function(e) {
            if (!str(e.fieldId) || !str(e.quote) || ['source', 'suggestion'].indexOf(e.kind) === -1) return null;
            if (e.kind === 'source' && source.indexOf(e.quote) === -1) return null;
            return { fieldId: e.fieldId, kind: e.kind, quote: e.quote };
        });
    }
    function checked(input) {
        if (!record(input) || !revisionKeys.every(function(k) {
            return k === 'metaSignature' ? input[k] === null || typeof input[k] === 'string' : Number.isSafeInteger(input[k]) && input[k] >= 0;
        })) return null;
        var result = {};
        revisionKeys.forEach(function(k) { result[k] = input[k]; });
        return result;
    }
    function creation(input) {
        var missing = input === undefined;
        input = record(input) ? input : {};
        return {
            status: ['idle', 'preflight', 'submitting', 'created', 'rejected', 'unknown'].indexOf(input.status) !== -1 ? input.status : (missing ? 'idle' : 'unknown'),
            attemptId: str(input.attemptId), issueKey: str(input.issueKey), error: str(input.error)
        };
    }
    function attachments(input) {
        return list(input, function(a) {
            if (!str(a.name)) return null;
            return { id: str(a.id), name: a.name, size: revision(a.size), type: str(a.type) || '',
                lastModified: revision(a.lastModified), status: ['pending', 'uploading', 'uploaded', 'failed', 'unknown'].indexOf(a.status) !== -1 ? a.status : 'pending',
                attachmentId: str(a.attachmentId), error: str(a.error), needsReselect: true };
        });
    }

    function automaticUndo(input, source) {
        if(!record(input) || !record(input.before) || !record(input.after)) return null;
        var after={};
        if(!snapshotKeys.every(function(k) {
            var value=input.after[k];
            if(['sourceRevision','settingsRevision','draftRevision'].indexOf(k)!==-1) return Number.isSafeInteger(value) && value>=0;
            return value===null || typeof value==='string';
        })) return null;
        snapshotKeys.forEach(function(k) {after[k]=input.after[k];});
        var before=input.before;
        return {after:after,before:{fields:fields(before.fields),pendingFields:fields(before.pendingFields),protectedFields:fields(before.protectedFields,true),
            questions:questions(before.questions),warnings:strings(before.warnings),evidence:evidence(before.evidence,source),taskExceptions:strings(before.taskExceptions),unresolvedChatFacts:strings(before.unresolvedChatFacts),appManagedQuestions:before.appManagedQuestions===true,templateReviewPending:before.templateReviewPending===true}};
    }
    function recordAutomaticChange(next, before) {
        var result=Object.assign({},next);
        result.automaticUndo=automaticUndo({before:before,after:snapshot(next)},next.source);
        return result;
    }
    // Read only known properties; never stringify user-supplied objects or File/Blob values.
    function persistent(input) {
        if (!record(input) || (input.schemaVersion !== undefined && input.schemaVersion !== 1)) throw new Error('Invalid draft');
        var source = str(input.source) || '';
        var result = {
            schemaVersion: 1, id: str(input.id), projectKey: str(input.projectKey), issueTypeId: str(input.issueTypeId), templateId: str(input.templateId),
            source: source, appManagedQuestions:input.appManagedQuestions===true, templateReviewPending:input.templateReviewPending===true, automaticUndo:automaticUndo(input.automaticUndo,source), fields: fields(input.fields), protectedFields: fields(input.protectedFields, true), pendingFields: fields(input.pendingFields),
            pendingAssistance: record(input.pendingAssistance) && safeKey(input.pendingAssistance.fieldId) &&
                typeof input.pendingAssistance.fieldId === 'string' && ['generate', 'improve', 'shorten'].indexOf(input.pendingAssistance.action) !== -1 &&
                Object.prototype.hasOwnProperty.call(fields(input.pendingFields), input.pendingAssistance.fieldId) ?
                {fieldId: input.pendingAssistance.fieldId, action: input.pendingAssistance.action} : null,
            taskExceptions: strings(input.taskExceptions), unresolvedChatFacts:strings(input.unresolvedChatFacts),
            reviewedTemplateQuestions:questions(input.reviewedTemplateQuestions), questions: questions(input.questions), warnings: strings(input.warnings), evidence: evidence(input.evidence, source),
            sourceRevision: revision(input.sourceRevision), settingsRevision: revision(input.settingsRevision), draftRevision: revision(input.draftRevision),
            metaSignature: str(input.metaSignature), checked: checked(input.checked), creation: creation(input.creation), attachments: attachments(input.attachments)
        };
        result.questions=includeReviewedQuestions(result.questions,result.reviewedTemplateQuestions);
        if(result.unresolvedChatFacts.length || result.templateReviewPending || result.reviewedTemplateQuestions.some(function(q) {return q.required;})) result.checked=null;
        if (result.checked && !revisionKeys.every(function(k) { return result.checked[k] === result[k]; })) result.checked = null;
        return result;
    }
    function createDraft(options) {
        var d = persistent({ projectKey: options.projectKey });
        d.id = 'draft-' + Date.now().toString(36) + '-' + (++sequence) + '-' + Math.random().toString(36).slice(2);
        return d;
    }
    function serialize(d) { return JSON.stringify(persistent(d)); }
    function restore(json) {
        var d = persistent(typeof json === 'string' ? JSON.parse(json) : json);
        d.checked = null;
        if (d.creation.status === 'submitting') d.creation.status = 'unknown';
        d.attachments.forEach(function(a) {if (a.status === 'uploading') a.status = 'unknown';});
        return d;
    }
    function snapshot(d) {
        var result = {};
        snapshotKeys.forEach(function(k) { result[k] = d[k]; });
        return result;
    }
    function isCurrent(d, snap) {
        return !!snap && snapshotKeys.every(function(k) { return d[k] === snap[k]; });
    }
    function changed(d) {
        var next = persistent(d);
        if (next.pendingAssistance) delete next.pendingFields[next.pendingAssistance.fieldId];
        next.pendingAssistance = null;
        // Runtime file references remain in memory across pure draft mutations.
        next.attachments = (d.attachments || []).map(function(a) { return Object.assign({}, a); });
        next.automaticUndo=null;
        next.draftRevision++;
        next.checked = null;
        return next;
    }
    function placeholderSummary(value) {
        return /^(?:(?:учебный|тестовый) (?:черновик|пример)|черновик)[.!]?$/i.test(String(value || '').trim());
    }
    function narrativeSummary(description) {
        var text=description.trim().replace(/^(?:(?:добрый (?:день|вечер)|доброе утро|здравствуйте|привет)(?=$|[!.,\s])[!.,\s]*)+/i,'').trim();
        var sentences=text.split(/\r?\n/).flatMap(function(line){return line.match(/.+?(?:[.!?](?=\s|$)|$)/g) || [];});
        var first=sentences.find(function(sentence){return sentence.trim() && !placeholderSummary(sentence);});
        return first ? first.trim().slice(0,255) : '';
    }
    function repairAutomaticSummary(d, maxLength) {
        maxLength=maxLength===undefined ? 255 : maxLength;
        if(!d || !d.fields || !placeholderSummary(d.fields.summary) || d.protectedFields.summary ||
            Object.prototype.hasOwnProperty.call(d.pendingFields,'summary') || d.pendingAssistance ||
            d.creation.issueKey || ['idle','rejected'].indexOf(d.creation.status)===-1 ||
            !Number.isSafeInteger(maxLength) || maxLength<1 || typeof d.fields.description!=='string')return d;
        function opening(text) {
            var first=text.trim().split(/\r?\n/)[0];
            return ((first.match(/^.+?[.!?](?=\s|$)/) || [first])[0]).trim().replace(/[.!?]$/,'').toLocaleLowerCase('ru');
        }
        var marker=String(d.fields.summary).trim().replace(/[.!?]$/,'').toLocaleLowerCase('ru');
        if(opening(d.fields.description)!==marker || opening(d.source)!==marker)return d;
        var summary=narrativeSummary(d.fields.description);
        if(!summary || summary!==narrativeSummary(d.source))return d;
        var next=changed(d);next.fields.summary=summary.slice(0,Math.min(maxLength,255));return next;
    }
    function setAutomaticDescription(d,value) {
        if(typeof value!=='string' || !value.trim() || d.fields.description===value || d.protectedFields.description ||
            Object.prototype.hasOwnProperty.call(d.pendingFields,'description') || d.pendingAssistance ||
            d.creation.issueKey || ['idle','rejected'].indexOf(d.creation.status)===-1)return d;
        var next=changed(d);next.fields.description=value;return next;
    }
    function setSource(d, text) {
        if (typeof text !== 'string') throw new Error('Expected source text');
        if (text === d.source) return d;
        var next = changed(d);
        next.source = text;
        next.sourceRevision++;
        next.evidence = evidence(next.evidence, text);
        return next;
    }
    function setSelection(d, selection) {
        var keys = ['issueTypeId', 'templateId', 'settingsRevision', 'metaSignature'];
        var updates = {};
        keys.forEach(function(k) {
            if (!Object.prototype.hasOwnProperty.call(selection, k)) return;
            if (k === 'settingsRevision' ? !Number.isSafeInteger(selection[k]) || selection[k] < 0 : selection[k] !== null && typeof selection[k] !== 'string') throw new Error('Invalid selection');
            updates[k] = selection[k];
        });
        if (Object.keys(updates).every(function(k) { return d[k] === updates[k]; })) return d;
        return Object.assign(changed(d), updates);
    }
    function editField(d, id, value) {
        var normalized = fieldValue(value,id);
        if (!safeKey(id) || typeof id !== 'string' || normalized === undefined) throw new Error('Invalid field');
        var next = changed(d);
        next.fields[id] = normalized;
        next.protectedFields[id] = true;
        delete next.pendingFields[id];
        return next;
    }
    function hasAnswerBlock(source, block) {
        var boundaries = ['\n\nQuestion: ', '\n\nВопрос: '];
        var index = source.indexOf(block);
        while (index !== -1) {
            var end = index + block.length;
            if (end === source.length || boundaries.some(function(boundary) {return source.slice(end, end + boundary.length) === boundary;})) return true;
            index = source.indexOf(block, index + 1);
        }
        return false;
    }
    function appendAnswers(d, answersById) {
        var source = d.source;
        d.questions.forEach(function(q) {
            if (!safeKey(q.id) || !Object.prototype.hasOwnProperty.call(answersById, q.id)) return;
            var answer = answersById[q.id];
            if (typeof answer !== 'string' || !answer.trim()) return;
            var block = '\n\nВопрос: ' + q.text + '\nОтвет: ' + answer;
            var legacy = '\n\nQuestion: ' + q.text + '\nAnswer: ' + answer;
            if (!hasAnswerBlock(source, block) && !hasAnswerBlock(source, legacy)) source += block;
        });
        return setSource(d, source);
    }
    function applyProposal(d, proposal, requestSnapshot, options) {
        if (!isCurrent(d, requestSnapshot)) return d;
        var next = changed(d), proposed = fields(proposal.fields),keepPending=!!options && options.preservePendingFields===true;
        if(keepPending)next.pendingFields=fields(d.pendingFields);
        Object.keys(proposed).forEach(function(id) {
            if (next.protectedFields[id] || keepPending && Object.prototype.hasOwnProperty.call(d.pendingFields,id)) {
                if (JSON.stringify(next.fields[id]) !== JSON.stringify(proposed[id])) next.pendingFields[id] = proposed[id];
                else if(!keepPending || !Object.prototype.hasOwnProperty.call(d.pendingFields,id))delete next.pendingFields[id];
            } else next.fields[id] = proposed[id];
        });
        next.questions = includeReviewedQuestions(proposal.questions,next.reviewedTemplateQuestions);
        next.warnings = strings(proposal.warnings);
        next.evidence = evidence(proposal.evidence, next.source);
        return next;
    }
    function acceptField(d, id) {
        if (!safeKey(id) || !Object.prototype.hasOwnProperty.call(d.pendingFields, id)) return d;
        return editField(d, id, d.pendingFields[id]);
    }
    function rejectField(d, id) {
        if (!safeKey(id) || !Object.prototype.hasOwnProperty.call(d.pendingFields, id)) return d;
        var next = changed(d);
        delete next.pendingFields[id];
        return next;
    }
    function invalidateAssistance(d) {
        return d.pendingAssistance ? changed(d) : d;
    }
    function applyFieldProposal(d, id, action, proposal, requestSnapshot) {
        if (!isCurrent(d, requestSnapshot) || !safeKey(id)) return d;
        var proposed = fields(proposal.fields);
        if (Object.keys(proposed).length !== 1 || !Object.prototype.hasOwnProperty.call(proposed, id)) throw new Error('Invalid field proposal');
        var next = changed(d);
        next.pendingFields = {}; next.pendingFields[id] = proposed[id];
        next.pendingAssistance = {fieldId: id, action: action};
        next.questions = includeReviewedQuestions(proposal.questions,next.reviewedTemplateQuestions);
        next.warnings = strings(proposal.warnings);
        next.evidence = evidence(proposal.evidence, next.source);
        return next;
    }
    function markChecked(d, validation, currentQuestions, requestSnapshot) {
        if (!isCurrent(d, requestSnapshot)) return d;
        var next = persistent(d);
        next.attachments = (d.attachments || []).map(function(a) { return Object.assign({}, a); });
        next.questions = includeReviewedQuestions(currentQuestions,next.reviewedTemplateQuestions);
        next.warnings = strings(validation.warnings);
        var valid = !next.unresolvedChatFacts.length && !next.templateReviewPending && !next.reviewedTemplateQuestions.some(function(q) {return q.required;}) && validation.ok === true && !strings(validation.unsupportedRequired).length &&
            !Object.keys(validation.fieldErrors || {}).some(function(k) { return validation.fieldErrors[k].length; }) &&
            !next.questions.some(function(q) { return q.required; });
        next.checked = valid ? checked(d) : null;
        return next;
    }
    return {setAutomaticDescription:setAutomaticDescription,placeholderSummary:placeholderSummary,narrativeSummary:narrativeSummary,repairAutomaticSummary:repairAutomaticSummary,recordAutomaticChange:recordAutomaticChange,createDraft: createDraft, setSource: setSource, setSelection: setSelection, editField: editField,
        appendAnswers: appendAnswers, applyProposal: applyProposal, applyFieldProposal: applyFieldProposal,
        invalidateAssistance: invalidateAssistance, rejectField: rejectField, acceptField: acceptField, markChecked: markChecked,
        snapshot: snapshot, isCurrent: isCurrent, serialize: serialize, restore: restore };
});
