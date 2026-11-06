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
        {id:'work',label:'Что сделать',aliases:['объём работ','объем работ','работы','задача','действия','what to do'],question:'Что именно должен сделать DevOps? Укажите конкретные действия и объём работ.'},
        {id:'location',label:'Где',aliases:['окружение','среда','environment','where'],question:'Где выполнить работу или воспроизвести сбой? Укажите среду, сервис и стенд.'},
        {id:'acceptance',label:'Критерии приёмки',aliases:['критерии приемки','критерии проверки исправления','критерии готовности','критерии успешности','acceptance criteria'],question:'По каким наблюдаемым результатам вы примете выполненную работу?'},
        {id:'links',label:'Ссылки',aliases:['links'],question:'Добавьте ссылку на репозиторий, документацию или базу знаний.'},
        {id:'actual',label:'Что происходит',aliases:['фактическое поведение','actual behavior'],question:'Что именно сломалось? Опишите фактическое поведение.'},
        {id:'expected',label:'Что ожидалось',aliases:['ожидаемое поведение','expected behavior'],question:'Какое поведение ожидалось при тех же действиях?'},
        {id:'steps',label:'Шаги воспроизведения',aliases:['steps to reproduce'],question:'Как воспроизвести сбой? Укажите последовательность действий.'},
        {id:'evidence',label:'Логи / скриншоты',aliases:['логи','скриншоты','логи/скриншоты','logs / screenshots'],question:'Приложите лог или скриншот, вставьте фрагмент ошибки либо ссылку на него. Для ошибки с поля объясните недоступность логов и укажите конфигурацию, версию и условия возникновения.'},
        {id:'configuration',label:'Конфигурация',aliases:['configuration'],question:'Какая конфигурация системы была у ошибки с поля без доступных логов?'},
        {id:'version',label:'Версия',aliases:['version'],question:'На какой версии возникла ошибка с поля без доступных логов?'},
        {id:'conditions',label:'Условия возникновения',aliases:['conditions'],question:'При каких условиях наблюдалась ошибка с поля без доступных логов?'},
        {id:'release',label:'Версия и состав',aliases:['версия/артефакт и состав','release and scope'],question:'Какую версию или артефакт разворачиваем и что входит в релиз? Можно указать ссылку на релиз, тег или ветку.'},
        {id:'order',label:'Порядок',aliases:['порядок действий','порядок развёртывания','порядок развертывания','действия','deployment steps'],question:'В каком порядке выполнять развёртывание? Укажите шаги, миграции или скрипты.'},
        {id:'window',label:'Окно',aliases:['окно работ','окно выполнения','время выполнения','окно развёртывания','окно развертывания','deployment window'],question:'Какое окно развёртывания согласовано? Укажите время или явно рабочие часы.'},
        {id:'verification',label:'Проверка',aliases:['проверка результата','verification'],question:'Что проверяем после развёртывания и кто проверяет результат?'},
        {id:'verifier',label:'Кто проверяет',aliases:['проверяющий','проверяющая команда','проверку выполнит','проверку проводит','проверку выполняет','verifier'],question:'Кто проверяет результат развёртывания?'},
        {id:'impact',label:'Влияние',aliases:['основание критического приоритета','impact'],question:'Что упало или недоступно и какую разработку, проверку или демонстрацию это остановило? Укажите основание критического приоритета.'},
        {id:'buildLog',label:'Лог сборки',aliases:['логи сборки','build log'],question:'Для ошибки пайплайна добавьте лог сборки и укажите упавший шаг.'},
        {id:'due',label:'Срок (опционально)',aliases:['срок','due date','deadline'],question:''},
        {id:'extra',label:'Дополнительно',aliases:[],question:''}
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
    function descriptionSectionDefinitions(meta,typeId,templateId) {
        var requirements=devopsRequirements(meta,typeId),kind=requirements && requirements.kind;
        if(!kind && ['task','bug','deployment'].indexOf(templateId)!==-1)kind=templateId;
        var ids={task:['goal','work','location','acceptance','links','impact','due','extra'],
            bug:['actual','expected','steps','location','evidence','configuration','version','conditions','acceptance','links','buildLog','impact','due','extra'],
            deployment:['location','release','order','window','verification','verifier','links','impact','due','extra']}[kind];
        if(!ids)return [];
        var required={task:['goal','work','location','acceptance'],bug:['actual','expected','steps','location','evidence','acceptance'],
            deployment:['location','release','order','window','verification']}[kind];
        return ids.map(function(id) {
            var section=devopsSections.find(function(item) {return item.id===id;});
            return {id:id,label:id==='location' && kind==='deployment'?'Среда':section.label,
                question:section.question,required:requirements ? requirements.sections.some(function(item) {return item.id===id;}) : required.indexOf(id)!==-1};
        });
    }
    function mergeDescriptionSections(meta,typeId,description,updates,templateId) {
        var result={description:description,applied:[],rejected:[]},definitions=descriptionSectionDefinitions(meta,typeId,templateId);
        if(typeof description!=='string' || !updates || typeof updates!=='object' || Array.isArray(updates)) {
            result.rejected.push({id:'descriptionSections',message:'Ожидается объект разделов описания с текстовыми значениями.'});return result;
        }
        var spec=fields.getField(meta,typeId,'description'),newline=description.indexOf('\r\n')!==-1?'\r\n':'\n';
        Object.keys(updates).forEach(function(id) {
            var definition=definitions.find(function(section) {return section.id===id;});
            if(!definition || ['__proto__','constructor','prototype'].indexOf(id)!==-1 || typeof updates[id]!=='string') {
                result.rejected.push({id:id,message:'Раздел неизвестен выбранному шаблону или значение не является текстом.'});return;
            }
            var value=updates[id],candidate=result.description,headers=descriptionHeaders(candidate);
            var targets=headers.filter(function(header) {
                var section=devopsSections.find(function(item) {return item.id===id;});
                return [section.label].concat(section.aliases).some(function(label) {return sectionKey(label)===header.key;});
            });
            if(targets.length) {
                targets.slice().reverse().forEach(function(header) {
                    var index=headers.indexOf(header),end=index+1<headers.length?headers[index+1].start:candidate.length;
                    var content=header===targets[0]?value:'';
                    if(end<candidate.length)content+=newline+newline;
                    var prefix=candidate.slice(0,header.content);
                    if(!header.inline && prefix && !prefix.endsWith('\n'))prefix+=newline;
                    candidate=prefix+content+candidate.slice(end);
                });
            } else {
                var extra=headers.find(function(header) {return header.key===sectionKey('Дополнительно');});
                var position=extra?extra.start:candidate.length,prefix=candidate.slice(0,position),suffix=candidate.slice(position);
                if(prefix && !prefix.endsWith(newline+newline))prefix+=prefix.endsWith(newline)?newline:newline+newline;
                candidate=prefix+definition.label+': '+value+(suffix?newline+newline+suffix:'');
            }
            if(spec && spec.maxLength && candidate.length>spec.maxLength) {
                result.rejected.push({id:id,message:'После обновления раздела превышен лимит длины описания Jira.'});return;
            }
            result.description=candidate;result.applied.push(id);
        });
        return result;
    }
    function unresolvedInstruction(value) {
        return /не\s+(?:нужн|надо|требу|согласован|определ[её]н|извест|выполн|провед|провер|ожида|подтвержд|будет|будут)|неизвест|отмен[её]н|уточн(?:им|ить)/i.test(value || '');
    }
    function proseClause(text,fact,offset) {
        var start=text.indexOf(fact,offset),from=0,boundary,pattern=/[.!?](?=\s|$)|\n/g;
        if(start<0)return {text:'',prefix:''};
        var before=text.slice(0,start);
        while((boundary=pattern.exec(before)))from=boundary.index+boundary[0].length;
        return {text:(text.slice(from).match(/^[\s\S]*?(?:[.!?](?=\s|$)|\n|$)/) || [''])[0],prefix:text.slice(from,start)};
    }
    function assertedProse(text,fact,offset) {
        var sentence=proseClause(text,fact,offset).text;
        return !!sentence && !/[?？][»"')]*\s*$/.test(sentence) && !unresolvedInstruction(sentence) &&
            !/(?:^|[\s,:])(?:если|возможно|вероятно|например|при условии|при наличии|или|либо)(?=$|[\s,:])/i.test(sentence) &&
            !/(?:^|[\s,:])(?:не|нельзя|запрещено)\s+(?:развер\p{L}*|разворач\p{L}*|обнов\p{L}*|выкат\p{L}*|устан\p{L}*|использ\p{L}*)/iu.test(sentence);
    }
    function targetCommit(text,match) {
        var prefix=proseClause(text,match[0],match.index).prefix;
        return /^\s*(?:(?:нужно|необходимо|требуется|прошу)\s+)?(?:обновить|развернуть|выкатить|установить|обновление|разв[её]ртывание|deploy|upgrade|rollout)\s/i.test(prefix) &&
            !/(?:^|[\s,:])(?:текущ\p{L}*|исходн\p{L}*|предыдущ\p{L}*|стар\p{L}*|уже|раньше)(?=$|[\s,:])/iu.test(prefix);
    }
    function codeRanges(text) {
        var ranges=[],open=null,offset=0;
        text.split('\n').forEach(function(line) {
            var fence=/^[ \t]*(`{3,}|~{3,})([^\r\n]*)\r?$/.exec(line);
            if(fence) {
                if(!open)open={start:offset,mark:fence[1][0],length:fence[1].length};
                else if(fence[1][0]===open.mark && fence[1].length>=open.length && !fence[2].trim()) {ranges.push({start:open.start,end:offset+line.length});open=null;}
            }
            offset+=line.length+1;
        });
        if(open)ranges.push({start:open.start,end:text.length});
        function covered(index) {return ranges.some(function(range){return index>=range.start && index<range.end;});}
        var pattern=/\{(code|noformat)(?::[^}\n]*)?\}/gi,match;
        open=null;
        while((match=pattern.exec(text))) {
            if(covered(match.index))continue;
            if(!open)open={start:match.index,kind:match[1].toLowerCase()};
            else if(match[1].toLowerCase()===open.kind) {ranges.push({start:open.start,end:pattern.lastIndex});open=null;}
        }
        if(open)ranges.push({start:open.start,end:text.length});
        pattern=/`+/g;open=null;
        while((match=pattern.exec(text))) {
            if(covered(match.index))continue;
            if(!open)open={start:match.index,length:match[0].length};
            else if(match[0].length===open.length) {ranges.push({start:open.start,end:pattern.lastIndex});open=null;}
        }
        if(open) {var end=text.indexOf('\n',open.start);ranges.push({start:open.start,end:end<0?text.length:end});}
        return ranges.sort(function(a,b){return a.start-b.start;});
    }
    function codeAt(ranges,index) {return ranges.some(function(range){return index>=range.start && index<range.end;});}
    function maskCode(text) {
        var cursor=0,result='';codeRanges(text).forEach(function(range){result+=text.slice(cursor,range.start)+text.slice(range.start,range.end).replace(/[^\r\n]/g,' ');cursor=range.end;});
        return result+text.slice(cursor);
    }
    function descriptionParts(text) {
        var parts=[],cursor=0;
        function prose(value) {(value.match(/[\s\S]+?(?:[.!?](?=\s|$)|\n|$)/g) || []).forEach(function(part){parts.push({text:part,code:false});});}
        codeRanges(text).forEach(function(range){prose(text.slice(cursor,range.start));parts.push({text:text.slice(range.start,range.end),code:true});cursor=range.end;});
        prose(text.slice(cursor));return parts;
    }
    function sectionMarkers(text,definitions) {
        var sections=definitions || devopsSections,labels=[];
        sections.forEach(function(section) {
            var original=devopsSections.find(function(item){return item.id===section.id;});
            [section.label].concat(original && original.aliases || []).forEach(function(label){if(!labels.includes(label))labels.push(label);});
        });
        var names=labels.sort(function(a,b){return b.length-a.length;}).map(function(label){return label.split('').map(function(character){return '.*+?^${}()|[]'.includes(character) || character.charCodeAt(0)===92?String.fromCharCode(92)+character:character;}).join('').replace(/ /g,'[ \\t]+');}).join('|');
        var pattern=new RegExp('(^|\\s)(?:#{1,6}[ \\t]+|h[1-6]\\.[ \\t]+|[-•][ \\t]+)?(?:\\*{1,2}|__)?('+names+')(?:[ \\t]*:(?:\\*{1,2}|__)?|(?:\\*{1,2}|__)[ \\t]*:|(?:\\*{1,2}|__)?(?=[ \\t]*(?:\\r?\\n|$)))','gim');
        var markers=[],match,ranges=codeRanges(text);
        while((match=pattern.exec(text))) {
            var start=match.index+match[1].length,end=match.index+match[0].length,label=match[2],key=sectionKey(label);
            if(codeAt(ranges,start))continue;
            var lineStart=text.lastIndexOf('\n',start-1)+1,linePrefix=text.slice(lineStart,start);
            var labeledLine=markers.some(function(marker){return marker.start>=lineStart && !marker.inline;});
            if(linePrefix.trim() && !/[.!?;]$/.test(linePrefix.trimEnd()) && !labeledLine)continue;
            if(!text.slice(start,end).includes(':') && linePrefix.trim())continue;
            var definition=sections.find(function(section){var original=devopsSections.find(function(item){return item.id===section.id;});return [section.label].concat(original && original.aliases || []).some(function(alias){return sectionKey(alias)===key;});});
            markers.push({start:start,end:end,key:key,label:label,id:definition.id,canonical:definition.label,inline:!!linePrefix.trim()});
        }
        return markers;
    }
    function renderSectionMarkers(text,markers,wiki,canonical) {
        var cursor=0,result='',newline=text.includes('\r\n')?'\r\n':'\n';
        markers.forEach(function(marker) {
            result+=text.slice(cursor,marker.start);
            if(marker.inline)result+=newline;
            result+=wiki?'*'+marker.canonical+':*':(canonical?marker.canonical:marker.label)+':';cursor=marker.end;
        });
        return result+text.slice(cursor);
    }
    function normalizedDescriptionText(description) {
        var text=String(description || '');return renderSectionMarkers(text,sectionMarkers(text),false);
    }
    function jiraTemplateDescription(meta,typeId,text) {
        var requirements=devopsRequirements(meta,typeId);
        if(typeof text!=='string' || !requirements || requirements.kind==='unsupported')return text;
        return renderSectionMarkers(text,sectionMarkers(text,descriptionSectionDefinitions(meta,typeId)),true);
    }
    function readSections(description,infer) {
        var result=Object.create(null),current=[],intro=[],headed=false;
        // Models use both **Label:** and **Label**:, including several headings
        // on one line. Strip heading formatting before assigning the actual text.
        var text=normalizedDescriptionText(maskCode(String(description || '')));
        text.split(/\r?\n/).forEach(function(line) {
            var clean=line.replace(/^\s*(?:h[1-6]\.\s*|#{1,6}\s*|[-•]\s*|\d+[.)]\s*)/,'').trim();
            var colon=clean.indexOf(':'),label=colon===-1 ? clean : clean.slice(0,colon);
            var key=sectionKey(label),sections=devopsSections.filter(function(s) {
                return [s.label].concat(s.aliases).some(function(alias) {return sectionKey(alias)===key;});
            });
            if(sections.length) {
                headed=true;
                current=sections.map(function(s) {return s.id;});
                current.forEach(function(id) {
                    if(!result[id])result[id]='';
                    result[id]+='\n'+(colon===-1?'':clean.slice(colon+1).replace(/^\s*\*{1,2}\s*/,''));
                });
            } else if (/^(?:срок(?: \(опционально\))?|родительская история|влияние \(опционально\)|история|приоритет|исполнитель)\s*:/i.test(clean)) current=[];
            else {
                if(!headed)intro.push(line);
                current.forEach(function(id) {result[id]+='\n'+line;});
            }
        });
        if(infer===false)return result;
        // Credit literal facts in task prose without rewriting the description or
        // inventing missing data. Links/tags/examples alone cannot name a target.
        var facts=[intro.join('\n'),result.work || '',result.actual || '',result.steps || '',result.location || '',result.extra || ''].join('\n');
        if(!meaningful(result.location)) {
            var location=/(?:в|на)\s+(?:(?:сред[еу]|стенд[еу]|окружени[еи]|контур[еу])\s+)?(?:[«"'`])?(DEV|TEST|PREPROD|PROD|UAT|STAGE|QA)(?=$|[^a-z0-9_-])/ig;
            var match,locations=[];
            var alternativeLocation=/(?:DEV|TEST|PREPROD|PROD|UAT|STAGE|QA)\s*(?:или|либо|\/)\s*(?:(?:в|на)\s+)?(?:(?:сред[еу]|стенд[еу]|окружени[еи]|контур[еу])\s+)?(?:DEV|TEST|PREPROD|PROD|UAT|STAGE|QA)(?=$|[^a-z0-9_-])/i.test(facts);
            while((match=location.exec(facts))) {
                var before=facts.slice(Math.max(0,match.index-15),match.index);
                if(/(?:не|например)\s*$/i.test(before))continue;
                locations.push(match);
            }
            var targets=Array.from(new Set(locations.map(function(item) {return item[1].toUpperCase();})));
            if(!alternativeLocation && targets.length===1)result.location=locations[0][0];
        }
        if(!meaningful(result.release) && /обнов|разверн|разв[её]рт|выкат|установ|deploy|upgrade|rollout/i.test(facts)) {
            // Only an explicitly stated target version, tag or commit identifies a release.
            // A current/source version is useful context, never the target by itself.
            var release=/(?:до\s+версии|на\s+версию)\s+([vV]?\d[\w.-]*)|(?:из\s+)?тег[а]?\s+[`"']?([\w][\w./-]*)/i.exec(facts);
            var commit=false;
            if(!release) {
                release=/(?:из|на)\s+коммит[а]?\s+([a-f0-9]{7,40})(?![a-z0-9_-])/i.exec(facts);
                commit=!!release;
            }
            var unknownTarget=/(?:целевая|новая|нужная)\s+версия\s+(?:пока\s+)?(?:неизвестна|не определена|не указана)/i.test(facts);
            if(release) {
                var beforeRelease=facts.slice(0,release.index),afterRelease=facts.slice(release.index+release[0].length);
                var alternativeRelease=/^\s*(?:или|либо|\/)\s*(?:(?:до|на|из)\s+)?(?:(?:версии|версию|тега)\s+)?[\w\d]/i.test(afterRelease);
                var placeholderTag=release[2] && /^(?:tbd|todo|unknown|none|n\/a)[.!?]*$/i.test(release[2]);
                if(!unknownTarget && !alternativeRelease && !placeholderTag && !/(?:не|нет|уточнить|например)\s*$/i.test(beforeRelease) &&
                    (!commit || targetCommit(facts,release) && assertedProse(facts,release[0],release.index)))result.release=release[0];
            }
        }
        if(!meaningful(result.window)) {
            var workingHours=/(?:в\s+)?рабоч(?:ие|их|ее|ем)\s+(?:часы|часов|время|времени)/i.exec(facts);
            if(workingHours && !/(?:не|вне)\s*$/i.test(facts.slice(Math.max(0,workingHours.index-5),workingHours.index)))result.window=workingHours[0];
        }
        // A provider fallback may preserve the user's original paragraph. Credit
        // explicit operational steps and an attributed observable check verbatim.
        var paragraph=facts;
        if(!meaningful(result.order)) {
            var operation=/(?:^|[.!?\n])\s*((?:поменять|заменить|обновить)\s+(?:образ|конфигураци\S*|манифест\S*|скрипт\S*|файл\S*|пакет\S*|бандл\S*)[^.!?\n]*|(?:перезапустить|перезагрузить)\s+[^.!?\n]+|выполнить\s+(?:миграци\S*|скрипт\S*)[^.!?\n]*)/i.exec(paragraph);
            var unresolvedOrder=/(?:порядок(?:\s+действий)?)\s+(?:пока\s+|ещ[её]\s+)?(?:не\s+(?:согласован|определ[её]н)|неизвест)/i.test(paragraph);
            if(operation && !unresolvedOrder && !unresolvedInstruction(operation[1]) && assertedProse(paragraph,operation[1],operation.index))result.order=operation[1];
        }
        if(!meaningful(result.verification)) {
            var attributedCheck=/(?:^|[.!?\n])\s*((?:постановщик|заказчик|дежурный|QA|DevOps|команда\s+[\wА-Яа-яЁё-]+)\s+(?:проверит|проверяет|проверят|проверяют)\s+[^.!?\n]+)/i.exec(paragraph) ||
                /(?:^|[.!?\n])\s*((?:[А-ЯЁ][а-яё-]+\s+){1,2}[А-ЯЁ][а-яё-]+\s+(?:проверит|проверяет|проверят|проверяют)\s+[^.!?\n]+)/.exec(paragraph);
            var unresolvedCheck=/(?:проверка|результат(?:\s+проверки)?|ожидаемый\s+код|код\s+ответа)\s+(?:пока\s+|ещ[её]\s+)?(?:не\s+(?:согласован|определ[её]н|извест)|неизвест|отмен[её]н)/i.test(paragraph);
            if(attributedCheck && !unresolvedCheck && !unresolvedInstruction(attributedCheck[1]) && assertedProse(paragraph,attributedCheck[1],attributedCheck.index) &&
                (/\bHTTP\s+[1-5]\d{2}\b/i.test(attributedCheck[1]) ||
                    /(?:^|\s)(?:открыти[ея]|отображени[ея]|появлени[ея]|загрузк[ауи]|запуск[ау]?)\s+(?!(?:чего|что|результат)(?:\s|[.-]))[\wА-Яа-яЁё/-]{2,}/i.test(attributedCheck[1])))result.verification=attributedCheck[1];
        }
        if(!meaningful(result.verification) && meaningful(result.acceptance))result.verification=result.acceptance;
        return result;
    }
    function formatDevopsDescription(meta,typeId,description,strict) {
        var requirements=devopsRequirements(meta,typeId);
        if(typeof description!=='string' || !description.trim() || !requirements || requirements.kind==='unsupported')return description;
        var definitions=descriptionSectionDefinitions(meta,typeId),markers=sectionMarkers(description,definitions),normalized=normalizedDescriptionText(description);
        var complete=requirements.sections.every(function(section){return markers.some(function(marker){return marker.id===section.id;});});
        var links=readSections(description,false).links || '';
        if(complete && dedupeReferences(links)===links)return markers.some(function(marker){return marker.inline;})?renderSectionMarkers(description,markers,false,true):description;
        var parsed=readSections(description),groups=Object.create(null),extra=[];
        var order=definitions.filter(function(section){return section.id!=='extra';}).map(function(section){return section.id;});
        var known=order.filter(function(id) {
            return meaningful(parsed[id]) && normalized.indexOf(parsed[id].trim())!==-1;
        });
        function editableSkeleton() {
            var newline=description.includes('\r\n')?'\r\n':'\n';
            return definitions.filter(function(section){return section.required;}).map(function(section){return section.label+': ';}).join(newline+newline)+newline+newline+'Дополнительно:'+newline+description;
        }
        if(!known.length && !markers.length)return strict===true?editableSkeleton():description;
        function append(id,value) {
            if(!groups[id])groups[id]=[];
            groups[id].push(value);
        }
        // A decimal or version dot is not a sentence boundary. Keep each source
        // sentence exactly once, moving only literal facts into template groups.
        var active=null;
        descriptionParts(normalized).forEach(function(part) {
            if(part.code) {if(active && active!=='extra' && active!=='custom')append(active,part.text);else extra.push(part.text);return;}
            var sentence=part.text.trim();
            if(!sentence)return;
            if(/ссылк|репозитори|документаци|баз[а-яё]* знаний/i.test(sentence) &&
                /нет(?:$|[.\s])|неизвест|отсутств|не (?:указан|предоставлен)|требуется для создания/i.test(sentence)) {
                append('links',sentence);return;
            }
            var heading=/^([^:\n]{1,80}):[ \t]*([\s\S]*)$/.exec(sentence);
            if(heading && !/^https?$/i.test(heading[1]) && /^[a-zа-яё][^:\n]{0,79}$/i.test(heading[1])) {
                var definition=definitions.find(function(section){var original=devopsSections.find(function(item){return item.id===section.id;});return [section.label].concat(original.aliases).some(function(label){return sectionKey(label)===sectionKey(heading[1]);});});
                if(definition) {active=definition.id;if(active==='extra')extra.push(heading[2]);else append(active,heading[2]);return;}
                active='custom';extra.push(sentence);return;
            }
            if(active==='custom') {extra.push(sentence);return;}
            var matches=known.filter(function(id) {return sentence.indexOf(parsed[id].trim())!==-1;});
            if(!matches.length) {if(active && active!=='extra')append(active,sentence);else extra.push(sentence);return;}
            var id=matches.indexOf('release')!==-1 ? 'release' : matches[0];
            if(id==='release') ['location','window'].forEach(function(other) {
                if(matches.indexOf(other)===-1)return;
                var value=parsed[other].trim();
                append(other,value);sentence=sentence.replace(value,'');
            });
            append(id,sentence.replace(/[ \t]{2,}/g,' ').replace(/\s+([.!?])/g,'$1').trim());
        });
        var blocks=[];
        order.forEach(function(id) {
            if(!groups[id] && !requirements.sections.some(function(section){return section.id===id;}))return;
            var section=devopsSections.find(function(section) {return section.id===id;});
            var label=id==='location' && requirements.kind==='deployment' ? 'Среда' : section.label;
            blocks.push(label+': '+(id==='links'?dedupeReferences((groups[id] || []).join('\n')):(groups[id] || []).join('\n')));
        });
        if(extra.length)blocks.push('Дополнительно:\n'+extra.join('\n'));
        var formatted=blocks.join('\n\n');
        function missing(text) {
            var result={questions:[],warnings:[],fieldErrors:Object.create(null)};
            validateDevops(meta,typeId,{summary:'Сверка описания задачи',description:text},{},result,function(id,message) {
                if(!result.fieldErrors[id])result.fieldErrors[id]=[];
                result.fieldErrors[id].push(message);
            });
            return result.questions.map(function(q) {return q.id;}).sort().join('|');
        }
        // Formatting grants no new authority and may not hide a known blocker.
        return missing(formatted)===missing(description) ? formatted : strict===true?editableSkeleton():description;
    }
    function meaningful(value) {
        var text=String(value || '').replace(/[*_`#{}<>\[\]]/g,'').replace(/\s+/g,' ').trim();
        if(text.replace(/[^a-zа-яё0-9]/gi,'').length<2) return false;
        if(/^(?:не указано|не заполнено|неизвестно|уточним позже)(?:[.,!\s]|$)/i.test(text))return false;
        if(/^(?:конкретный объ[её]м работ|зачем это нужно(?:[, ]+1[–—-]2 предложения)?|окружение, версия, сервис, стенд|что и кто проверяет|как пойм[её]м, что готово)[.!?\s]*$/i.test(text))return false;
        return !/^(?:todo|tbd|n\/?a|да|ок|ok|нет|неизвестно|не указано|не заполнено|не нужно(?: заполнять)?|не надо|не применимо|уточним(?: позже)?|позже|цель|что сделать|описание|среда|версия|ссылки|логи|проверка)[.!?\s]*$/i.test(text);
    }
    function url(value) {return /https?:\/\/[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::\d+)?(?:[/?#][^\s<>]*)?(?=$|[\s<>])/i.test(value || '');}
    var referenceMessage='Пришлите одну ссылку http(s) на репозиторий, документацию или базу знаний.';
    var dashboardMessage='Эта ссылка ведёт на дашборд Jira. Нужна ссылка на репозиторий, документацию или базу знаний для задачи.';
    function referenceUrl(value) {
        var match=typeof value==='string' && /^(https?):\/\/([^/?#\s]+)([^?#\s]*)(?:\?[^\s#]*)?(?:#[^\s]*)?$/i.exec(value);
        if(!match || /[\\\u0000-\u0020<>"`]/.test(value) ||
            !/^(?:[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?|\[[a-f0-9:]+\])(?::\d{1,5})?$/i.test(match[2]))
            return {ok:false,url:null,code:'reference',message:referenceMessage};
        var path;
        try {path=decodeURIComponent(match[3] || '/');} catch(ignore) {return {ok:false,url:null,code:'reference',message:referenceMessage};}
        var segments=[];
        path.split('/').forEach(function(segment) {if(segment==='..')segments.pop();else if(segment && segment!=='.')segments.push(segment);});
        if(/(?:^|\/)secure\/Dashboard\.jspa\/?$/i.test(segments.join('/')))
            return {ok:false,url:null,code:'dashboard',message:dashboardMessage};
        return {ok:true,url:value,code:null,message:null};
    }
    function parseDevopsReferenceAnswer(text) {
        if(typeof text!=='string')return {ok:false,url:null,code:'reference',message:referenceMessage};
        var match=/^(?:(?:вот\s+)?(?:ссылка(?:\s+на\s+(?:репу|репозиторий|документацию|базу\s+знаний))?|репозиторий|репа|документация|база\s+знаний)\s*[:—-]?\s*)?(https?:\/\/\S+)$/i.exec(text.trim());
        return match ? referenceUrl(match[1]) : {ok:false,url:null,code:'reference',message:referenceMessage};
    }
    function referenceCandidates(text) {
        return (String(text || '').match(/https?:\/\/[^\s<>"`]+/gi) || []).map(function(candidate) {
            // Closing Markdown delimiters are outside the URL. Balanced brackets
            // within a path/query remain part of the literal supplied address.
            [['(',')'],['[',']'],['{','}']].forEach(function(pair) {
                while(candidate.endsWith(pair[1]) && candidate.split(pair[1]).length>candidate.split(pair[0]).length)candidate=candidate.slice(0,-1);
            });
            return referenceUrl(candidate.replace(/[.,;]+$/,''));
        });
    }
    function dedupeReferences(text) {
        var seen=new Set(),ranges=codeRanges(text),offset=0,newline=text.includes('\r\n')?'\r\n':'\n';
        return text.split(/\r?\n/).filter(function(line) {
            var inCode=codeAt(ranges,offset);offset+=line.length+newline.length;
            if(inCode)return true;
            var literal=line.trim(),references=referenceCandidates(literal),reference=references.length===1?references[0]:null;
            if(!reference || !reference.ok || !(literal===reference.url || literal.startsWith(reference.url) && /^[.,;]$/.test(literal.slice(reference.url.length))))return true;
            if(seen.has(reference.url))return false;
            seen.add(reference.url);return true;
        }).join(newline);
    }
    function simpleMissingReference(value) {
        var text=String(value).trim().replace(/^[-•]\s*/,'').replace(/[*_`]/g,'');
        return /^(?:нет|неизвестно|не указана|не предоставлена|отсутствует)\.?$/i.test(text) ||
            /^ссылк[аи]\s+на\s+(?:репозиторий|репу|документацию|базу знаний)(?:\s+для примера)?\s+(?:нет|не указана|не предоставлена|отсутствует)\.?$/i.test(text) ||
            /^неизвестно:\s*ссылка на (?:репозиторий|документацию|базу знаний)(?:,\s*(?:репозиторий|документацию|базу знаний))*(?:\s+или\s+(?:репозиторий|документацию|базу знаний))?(?:\s*\(требуется для создания\))?\.?$/i.test(text);
    }
    function descriptionHeaders(description) {
        var headers=[],offset=0,lines=description.split('\n'),ranges=codeRanges(description);
        lines.forEach(function(line,index) {
            if(codeAt(ranges,offset)) {offset+=line.length+1;return;}
            var raw=line.replace(/\r$/,''),colon=raw.indexOf(':'),marked=/^\s*(?:#{1,6}\s|h[1-6]\.\s|\*{1,2}|__)/.test(raw);
            var label=(colon===-1?raw:raw.slice(0,colon)).replace(/^\s*(?:#{1,6}\s*|h[1-6]\.\s*)/,'');
            var key=sectionKey(label);
            var known=devopsSections.some(function(section) {return [section.label].concat(section.aliases).some(function(alias) {return sectionKey(alias)===key;});});
            if(key && !/^https?$/i.test(key) && (known || marked || colon!==-1 && /^[a-zа-яё][^:\n]{0,79}$/i.test(key)) && !simpleMissingReference(raw)) {
                var content=colon===-1 ? offset+line.length+(index<lines.length-1?1:0) : offset+colon+1;
                if(colon!==-1)content+=(description.slice(content).match(/^(?:\*{1,2}|__)?[ \t]*/) || [''])[0].length;
                headers.push({key:key,start:offset,content:content,inline:colon!==-1});
            }
            offset+=line.length+1;
        });
        return headers;
    }
    function mergeDevopsReference(description,value) {
        var parsed=parseDevopsReferenceAnswer(value);
        if(!parsed.ok || typeof description!=='string')return {ok:false,description:description,code:parsed.code || 'description',message:parsed.message || 'Описание задачи должно быть текстом.'};
        var newline=description.indexOf('\r\n')!==-1?'\r\n':'\n',headers=descriptionHeaders(description);
        var index=headers.findIndex(function(header) {return header.key===sectionKey('Ссылки') || header.key==='links';});
        if(index===-1) {
            var extra=headers.find(function(header) {return header.key===sectionKey('Дополнительно');});
            var position=extra?extra.start:description.length,prefix=description.slice(0,position),suffix=description.slice(position);
            if(prefix && !prefix.endsWith(newline+newline))prefix+=prefix.endsWith(newline)?newline:newline+newline;
            return {ok:true,description:prefix+'Ссылки: '+parsed.url+(suffix?newline+newline+suffix:''),code:null,message:null};
        }
        var header=headers[index],end=index+1<headers.length?headers[index+1].start:description.length;
        var original=description.slice(header.content,end),pieces=original.split(/\r?\n/),kept=pieces.filter(function(line) {return !simpleMissingReference(line);});
        var present=(original.match(/https?:\/\/[^\s<>"`]+/gi) || []).some(function(candidate) {
            return candidate===parsed.url || candidate.indexOf(parsed.url)===0 && /^[)\]}.,;]+$/.test(candidate.slice(parsed.url.length));
        });
        if(present && kept.length===pieces.length)return {ok:true,description:description,code:null,message:null};
        var content=kept.join(newline);
        if(!present)content=parsed.url+(content?newline+content:'');
        if(end<description.length && !content.endsWith(newline))content+=newline+newline;
        var before=description.slice(0,header.content);
        if(!header.inline && before && !before.endsWith('\n'))before+=newline;
        return {ok:true,description:before+content+description.slice(end),code:null,message:null};
    }
    function explanatoryException(value) {
        return /(?:не применим|отсутству|нет (?:репозитория|документации|источник)|не существует|недоступн)/i.test(value || '') &&
            meaningful(value) && String(value).trim().split(/\s+/).length>=7;
    }
    function validateDevops(meta,typeId,values,policy,result,error) {
        var requirements=devopsRequirements(meta,typeId);
        if(!requirements && policy.appManagedQuestions===true) {
            var definitions=descriptionSectionDefinitions(meta,typeId,policy.templateId);
            if(definitions.length)requirements={kind:policy.templateId,sections:definitions.filter(function(section) {return section.required;})};
        }
        if(!requirements)return;
        result.questions=[];
        function missing(id,text,field) {
            error(field || 'description',text);
            result.questions.push({id:(meta.projectKey==='DEVOPS'?'devops:':'template:')+id,text:text,required:true});
        }
        if(requirements.kind==='unsupported')missing('type','Для DEVOPS выберите тип «Задача», «Ошибка» или «Задача развёртывания».','issuetype');
        var structured=meta.projectKey==='DEVOPS' && policy.requireStructuredDescription===true && (!policy.templateId || policy.templateId===requirements.kind);
        var inlineStructure=structured && sectionMarkers(String(values.description || ''),descriptionSectionDefinitions(meta,typeId)).some(function(marker){return marker.inline;});
        var sections=readSections(values.description,!structured),summary=typeof values.summary==='string'?values.summary.trim():'';
        if(!meaningful(summary) || /^(?:сделать обновление|задача|ошибка|тест|test|обновить|развернуть)[.!?\s]*$/i.test(summary))
            missing('summary','Укажите содержательную тему с действием или сбоем, сервисом и местом.','summary');
        requirements.sections.forEach(function(s) {
            if(s.id==='evidence')return;
            if(!meaningful(sections[s.id]))missing(s.id,s.question);
        });
        if(requirements.sections.some(function(section) {return section.id==='links';}) && meaningful(sections.links)) {
            var references=referenceCandidates(sections.links);
            if(!references.some(function(reference) {return reference.ok;}))
                missing('links',references.some(function(reference) {return reference.code==='dashboard';}) ? dashboardMessage : devopsSections.find(function(s) {return s.id==='links';}).question);
        }
        if(requirements.kind==='deployment' && meaningful(sections.verification) && !meaningful(sections.verifier) &&
            !/(?:проверя(?:ет|ют|ющий)|проверит|проверять будет|проверку (?:выполнит|выполняет|проводит)|кто\s*[:—-]|ответственный\s*[:—-])/i.test(sections.verification))
            missing('verifier','Кто проверяет результат развёртывания? Укажите человека или команду в разделе «Проверка».');
        if(requirements.kind==='deployment' && meaningful(sections.window) &&
            !/(?:\d{1,2}[:.]\d{2}|рабоч(?:ие|их|ее|ем) (?:час|врем)|ноч(?:ь|ью)|утр|вечер|с\s*\d{1,2}\s*(?:до|[-–—])\s*\d{1,2})/i.test(sections.window))
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
        if(inlineStructure && !result.questions.length)missing('structure','Начните каждый раздел выбранного шаблона с новой строки.');
        if(meta.projectKey!=='DEVOPS')return;
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
            var value=values[id],requirements=devopsRequirements(meta,typeId);
            var wiki=id==='description' && policy.requireStructuredDescription===true && policy.descriptionFormat==='markdown' && requirements && requirements.kind!=='unsupported' && (!policy.templateId || policy.templateId===requirements.kind);
            if(wiki && typeof value==='string')value=jiraTemplateDescription(meta,typeId,value);
            var encoded = encode(field, value, policy);
            if(wiki && typeof value==='string' && field.maxLength && value.length>field.maxLength)encoded.error='Описание в формате Jira превышает лимит '+field.maxLength+' символов (получилось '+value.length+'). Сократите текст перед созданием.';
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

    return { validateFields: validateFields, buildCreatePayload: buildCreatePayload, normalizeTimeTracking:fields.timeTrackingValue, devopsRequirements:devopsRequirements, formatDevopsDescription:formatDevopsDescription, jiraTemplateDescription:jiraTemplateDescription, parseDevopsReferenceAnswer:parseDevopsReferenceAnswer, mergeDevopsReference:mergeDevopsReference, descriptionSectionDefinitions:descriptionSectionDefinitions, mergeDescriptionSections:mergeDescriptionSections };
});
