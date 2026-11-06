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
        if (kind === 'timetracking') return fields.timeTrackingValue(value);
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

    var devopsSections = [
        {id:'goal',label:'Цель',aliases:['goal'],question:'Зачем нужна эта работа и какой результат она должна дать?'},
        {id:'work',label:'Что сделать',aliases:['объём работ','объем работ','работы','what to do'],question:'Что именно должен сделать DevOps? Укажите конкретные действия и объём работ.'},
        {id:'location',label:'Где',aliases:['окружение','среда','environment','where'],question:'Где выполнить работу или воспроизвести сбой? Укажите среду, сервис и стенд.'},
        {id:'acceptance',label:'Критерии приёмки',aliases:['критерии приемки','критерии проверки исправления','acceptance criteria'],question:'По каким наблюдаемым результатам вы примете выполненную работу?'},
        {id:'links',label:'Ссылки',aliases:['links'],question:'Добавьте ссылку на репозиторий, документацию или базу знаний. Правило DEVOPS требует ссылку перед созданием; причина её отсутствия сохраняется в описании.'},
        {id:'actual',label:'Что происходит',aliases:['фактическое поведение','actual behavior'],question:'Что именно сломалось? Опишите фактическое поведение.'},
        {id:'expected',label:'Что ожидалось',aliases:['ожидаемое поведение','expected behavior'],question:'Какое поведение ожидалось при тех же действиях?'},
        {id:'steps',label:'Шаги воспроизведения',aliases:['steps to reproduce'],question:'Как воспроизвести сбой? Укажите последовательность действий.'},
        {id:'evidence',label:'Логи / скриншоты',aliases:['логи','скриншоты','логи/скриншоты','logs / screenshots'],question:'Приложите лог или скриншот, вставьте фрагмент ошибки либо ссылку на него. Для ошибки с поля объясните недоступность логов и укажите конфигурацию, версию и условия возникновения.'},
        {id:'configuration',label:'Конфигурация',aliases:['configuration'],question:'Какая конфигурация системы была у ошибки с поля без доступных логов?'},
        {id:'version',label:'Версия',aliases:['version'],question:'На какой версии возникла ошибка с поля без доступных логов?'},
        {id:'conditions',label:'Условия возникновения',aliases:['conditions'],question:'При каких условиях наблюдалась ошибка с поля без доступных логов?'},
        {id:'release',label:'Версия и состав',aliases:['версия/артефакт и состав','release and scope'],question:'Какую версию или артефакт разворачиваем и что входит в релиз? Можно указать ссылку на релиз, тег или ветку.'},
        {id:'order',label:'Порядок',aliases:['порядок действий','порядок развёртывания','порядок развертывания','deployment steps'],question:'В каком порядке выполнять развёртывание? Укажите шаги, миграции или скрипты.'},
        {id:'window',label:'Окно',aliases:['окно работ','окно развёртывания','окно развертывания','deployment window'],question:'Какое окно развёртывания согласовано? Укажите время или явно рабочие часы.'},
        {id:'verification',label:'Проверка',aliases:['проверка результата','verification'],question:'Что проверяем после развёртывания и кто проверяет результат?'},
        {id:'verifier',label:'Кто проверяет',aliases:['проверяющий','проверяющая команда','verifier'],question:'Кто проверяет результат развёртывания?'},
        {id:'impact',label:'Влияние',aliases:['основание критического приоритета','impact'],question:'Что упало или недоступно и какую разработку, проверку или демонстрацию это остановило? Укажите основание критического приоритета.'},
        {id:'buildLog',label:'Лог сборки',aliases:['логи сборки','build log'],question:'Для ошибки пайплайна добавьте лог сборки и укажите упавший шаг.'}
    ];
    function sectionKey(text) {
        return String(text).toLocaleLowerCase('ru').replace(/ё/g,'е').replace(/[\s\/*_#`]+/g,' ').trim();
    }
    function devopsKind(meta,typeId) {
        if (!meta || meta.projectKey !== 'DEVOPS') return null;
        var type=meta.issueTypes.find(function(t) {return t.id===typeId;});
        var name=type && sectionKey(type.name);
        if (name==='задача' || name==='task') return 'task';
        if (name==='ошибка' || name==='bug') return 'bug';
        if (['задача развертывания','задача развёртывания','развертывание','deployment','deployment task'].indexOf(name)!==-1) return 'deployment';
        return 'unsupported';
    }
    function devopsRequirements(meta,typeId) {
        var kind=devopsKind(meta,typeId);
        if (!kind) return null;
        var ids={task:['goal','work','location','acceptance','links'],bug:['actual','expected','steps','location','evidence','acceptance','links'],
            deployment:['location','release','order','window','verification','links']}[kind] || [];
        return {kind:kind,sections:devopsSections.filter(function(s) {return ids.indexOf(s.id)!==-1;}).map(function(s) {
            return {id:s.id,label:s.label,question:s.question};
        })};
    }
    function readSections(description) {
        var result=Object.create(null),current=null;
        String(description || '').split(/\r?\n/).forEach(function(line) {
            var clean=line.replace(/^\s*(?:h[1-6]\.\s*|#{1,6}\s*|[-•]\s*)/,'').trim();
            var colon=clean.indexOf(':'),label=colon===-1 ? clean : clean.slice(0,colon);
            var key=sectionKey(label),section=devopsSections.find(function(s) {
                return [s.label].concat(s.aliases).some(function(alias) {return sectionKey(alias)===key;});
            });
            if(section) {
                current=section.id;
                if(!result[current])result[current]='';
                result[current]+='\n'+(colon===-1?'':clean.slice(colon+1).replace(/^\s*\*{1,2}\s*/,''));
            } else if (/^(?:срок(?: \(опционально\))?|родительская история|влияние \(опционально\)|история|приоритет|исполнитель)\s*:/i.test(clean)) current=null;
            else if (current) result[current]+='\n'+line;
        });
        return result;
    }
    function meaningful(value) {
        var text=String(value || '').replace(/[*_`#{}<>\[\]]/g,'').replace(/\s+/g,' ').trim();
        if(text.replace(/[^a-zа-яё0-9]/gi,'').length<2) return false;
        if(/^(?:не указано|не заполнено|неизвестно|уточним позже)(?:[.,!\s]|$)/i.test(text))return false;
        if(/^(?:конкретный объ[её]м работ|зачем это нужно(?:[, ]+1[–—-]2 предложения)?|окружение, версия, сервис, стенд|что и кто проверяет|как пойм[её]м, что готово)[.!?\s]*$/i.test(text))return false;
        return !/^(?:todo|tbd|n\/?a|да|ок|ok|нет|неизвестно|не указано|не заполнено|не нужно(?: заполнять)?|не надо|не применимо|уточним(?: позже)?|позже|цель|что сделать|описание|среда|версия|ссылки|логи|проверка)[.!?\s]*$/i.test(text);
    }
    function url(value) {return /https?:\/\/[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::\d+)?(?:[/?#][^\s<>]*)?(?=$|[\s<>])/i.test(value || '');}
    function explanatoryException(value) {
        return /(?:не применим|отсутству|нет (?:репозитория|документации|источник)|не существует|недоступн)/i.test(value || '') &&
            meaningful(value) && String(value).trim().split(/\s+/).length>=7;
    }
    function validateDevops(meta,typeId,values,policy,result,error) {
        var requirements=devopsRequirements(meta,typeId);
        if(!requirements)return;
        result.questions=[];
        function missing(id,text,field) {
            error(field || 'description',text);
            result.questions.push({id:'devops:'+id,text:text,required:true});
        }
        if(requirements.kind==='unsupported')missing('type','Для DEVOPS выберите тип «Задача», «Ошибка» или «Задача развёртывания».','issuetype');
        var sections=readSections(values.description),summary=typeof values.summary==='string'?values.summary.trim():'';
        if(!meaningful(summary) || /^(?:сделать обновление|задача|ошибка|тест|test|обновить|развернуть)[.!?\s]*$/i.test(summary))
            missing('summary','Укажите содержательную тему с действием или сбоем, сервисом и местом.','summary');
        requirements.sections.forEach(function(s) {
            if(s.id==='evidence')return;
            if(!meaningful(sections[s.id]))missing(s.id,s.question);
        });
        if(meaningful(sections.links) && !url(sections.links))
            missing('links',devopsSections.find(function(s) {return s.id==='links';}).question);
        if(requirements.kind==='deployment' && meaningful(sections.verification) && !meaningful(sections.verifier) &&
            !/(?:проверя(?:ет|ют|ющий)|проверит|проверять будет|кто\s*[:—-]|ответственн|инженер|разработчик|тестировщик|команда|заказчик|(?:QA|DevOps)\s)/i.test(sections.verification))
            missing('verifier','Кто проверяет результат развёртывания? Укажите человека или команду в разделе «Проверка».');
        if(requirements.kind==='deployment' && meaningful(sections.window) &&
            !/(?:\d{1,2}[:.]\d{2}|рабочи[ех] (?:час|врем)|ноч(?:ь|ью)|утр|вечер|с\s*\d{1,2}\s*(?:до|[-–—])\s*\d{1,2})/i.test(sections.window))
            missing('window',devopsSections.find(function(s) {return s.id==='window';}).question);
        if(requirements.kind==='bug') {
            var evidence=sections.evidence || '';
            var attached=(policy.attachments || []).some(function(a) {
                return a && typeof a.name==='string' && a.size>0 && a.needsReselect!==true && ['pending','uploaded'].indexOf(a.status)!==-1;
            });
            var fieldException=/(?:с поля|внедрен|установщик)/i.test(evidence) && /(?:логи?\s+(?:недоступн|отсутству)|нет доступа|нет возможности|невозможно собрать)/i.test(evidence) && explanatoryException(evidence);
            var inlineEvidence=/(?:фрагмент(?: лога| ошибки)?|текст (?:ошибки|лога))\s*:/i.test(evidence) && meaningful(evidence.split(':').slice(1).join(':'));
            if(!attached && !url(evidence) && !inlineEvidence && !fieldException)
                missing('evidence',devopsSections.find(function(s) {return s.id==='evidence';}).question);
            if(fieldException) ['configuration','version','conditions'].forEach(function(id) {
                if(!(id==='version' && /\d+(?:\.\d+)+(?:[.\s]|$)/.test(sections[id] || '')) && !meaningful(sections[id]))missing(id,devopsSections.find(function(s) {return s.id===id;}).question);
            });
            if(/пайплайн|pipeline|(?:сборк|build).*(?:упал|пада|ошиб)/i.test(sections.actual || '') &&
                !(meaningful(sections.buildLog) && (url(sections.buildLog) || attached || /фрагмент|error|failed/i.test(sections.buildLog)) && /шаг|stage|step|job/i.test(sections.buildLog)))
                missing('buildLog',devopsSections.find(function(s) {return s.id==='buildLog';}).question);
        }
        var priority=fields.getField(meta,typeId,'priority');
        var value=Object.prototype.hasOwnProperty.call(values,'priority') ? values.priority : priority && priority.defaultApplicable && priority.defaultValue;
        var resolved=priority && value && fields.resolveOption(priority,value);
        if(!resolved || !resolved.ok) missing('priority','Выберите приоритет Jira или загрузите его фактическое значение по умолчанию.','priority');
        else {
            var option=priority.allowedValues.find(function(o) {return o.id===resolved.value.id;});
            if(option && /критическ|critical|blocker/i.test(option.label || '')) {
                var impact=sections.impact || '';
                var outage=/(?:упал|падает|недоступен|недоступна|не работает|crash|unavailable)/i.test(impact);
                var stopped=/(?:разработк|тестирован|демонстрац|испытан).*(?:остановлен|невозможн|заблокирован)|(?:остановлен|невозможн|заблокирован).*(?:разработк|тестирован|демонстрац|испытан)/i.test(impact);
                if(!outage || !stopped || /не\s+(?:упал|падает|остановлен|заблокирован)|без\s+(?:простоя|остановки)/i.test(impact))
                    missing('impact',devopsSections.find(function(s) {return s.id==='impact';}).question,'priority');
                else result.warnings.push('После создания критической задачи отметьте через @ обоих руководителей — начальника отдела эксплуатации и тимлида DEVOPS — в комментарии Jira.');
            }
        }
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
        validateDevops(meta,typeId,values,policy,result,error);
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

    return { validateFields: validateFields, buildCreatePayload: buildCreatePayload, normalizeTimeTracking:fields.timeTrackingValue, devopsRequirements:devopsRequirements };
});
