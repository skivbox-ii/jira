define('_ujgTA_fieldUi', ['_ujgTA_icons', '_ujgTA_fields'], function(icon, fields) {
    'use strict';
    var nextId = 0;
    function create(options) {
        var $ = options.$, host, label, body, errors, control, panel, chips, candidates, search, toggle, boards;
        var current = {}, mode, dead = false, sequence = 0, request = null, userOptions = [], query = '', outside, escape;
        var uid = 'ta-field-' + (++nextId), cache = Object.create(null), localEdit = null;
        var boardId = null, boardChoices = [], needsBoard = false, partial = false;
        var searchTimer = null;
        var relationSearchPending = false, relationSearchError = null;
        function multi() { return current.field.multiple === true || ['multioption', 'components', 'versions'].indexOf(current.field.kind) !== -1; }
        function user() { return current.field.kind === 'user'; }
        function relation() {return ['epic','sprint'].indexOf(current.field.kind)!==-1;}
        function remote() {return user() || relation();}
        function key(value) { return relation() ? value == null ? null : String(value) : value && (user() ? value.name : value.id); }
        function selected() { var value = current.value; return Array.isArray(value) ? value : value == null ? [] : [value]; }
        function display(value) { return cache[key(value)] || key(value) || ''; }
        function setValue(value) {
            current.value = value; renderChoices();
            options.onChange(current.field.id, value);
        }
        function close(restoreFocus) {
            if (panel) {
                if (relation()) cancelSearch();
                panel.prop('hidden', true); toggle.attr('aria-expanded', 'false'); if (restoreFocus) toggle.trigger('focus');
            }
        }
        function cancelSearch() {
            sequence++; if (request) request.abort(); request = null;
            if (searchTimer !== null) {window.clearTimeout(searchTimer);searchTimer=null;}
        }
        function renderChoices() {
            if (!panel) return;
            chips.empty(); candidates.empty();
            var values = selected(), seen = Object.create(null);
            values.forEach(function(value) {
                var chip = $('<span class="ta-chip" data-ta-chip>');
                chip.append($('<span>').text(display(value)));
                var remove = $('<button type="button" data-ta-remove>').attr({'aria-label': 'Удалить ' + display(value), title: 'Удалить ' + display(value)}).append(icon('X'));
                remove.prop('disabled', current.disabled === true).on('click', function() {
                    var rest = values.filter(function(v) {return key(v) !== key(value);}); setValue(multi() ? rest : null);
                });
                if (current.removable !== false) chip.append(remove);
                chips.append(chip);
            });
            var list = relation() && (relationSearchPending || relationSearchError) ? [] : remote() ? userOptions : current.field.allowedValues || [];
            list.forEach(function(value) {
                var id = relation() ? value.id : key(value); if (!id || seen[id]) return; seen[id] = true;
                if (values.some(function(v) {return key(v) === id;})) return;
                var name = user() ? value.displayName || value.name : value.label || id;
                cache[id] = name;
                if (!remote() && (name + ' ' + id).toLowerCase().indexOf(query.toLowerCase()) === -1) return;
                var button = $('<button type="button" role="option" aria-selected="false" data-ta-candidate>').text(name + ' (' + id + ')');
                // Metadata may carry actual Jira icons; external and data URLs never load.
                if (value.iconUrl) {
                    try {
                        var url = new URL(value.iconUrl, window.location.href);
                        if (url.origin === window.location.origin && /^https?:$/.test(url.protocol) && !url.username && !url.password)
                            button.prepend($('<img alt="" width="16" height="16">').attr('src', url.href));
                    } catch (ignored) { /* Invalid icons are omitted. */ }
                }
                button.on('click', function() {
                    var normalized = user() ? {name: value.name} : relation() ? current.field.kind==='sprint' ? Number(value.id) : value.id : {id: value.id};
                    setValue(multi() ? selected().concat([normalized]) : normalized);
                    if (!multi()) {close(); toggle.trigger('focus');}
                    else search.trigger('focus');
                });
                candidates.append(button);
            });
            if (relation() && relationSearchPending) candidates.append($('<p class="ta-muted">').text('Поиск…'));
            else if (relation() && relationSearchError) candidates.append($('<p class="ta-errors">').text(relationSearchError));
            else {
                if (!candidates.children().length) candidates.append($('<p class="ta-muted">').text(needsBoard ? 'Выберите доску' : fields.catalogUnavailable(current.field) ? 'Каталог вариантов недоступен. Используйте форму Jira.' : 'Нет вариантов'));
                if (relation() && partial && !needsBoard) candidates.append($('<p class="ta-muted" data-ta-partial>').text('Неполные результаты. Уточните поиск или введите ключ задачи.'));
            }
            toggle.find('span').text(values.length ? (multi() ? 'Выбрано: ' + values.length : display(values[0])) : 'Выбрать');
        }
        function runSearch() {
            query = search.val(); cancelSearch();
            if (!remote() || typeof options.onSearch !== 'function') {renderChoices(); return;}
            var token = sequence, aborter = new AbortController(), term = query, field = current.field;
            request = aborter;
            if (relation()) {
                userOptions=[];partial=false;relationSearchPending=true;relationSearchError=null;renderChoices();
            } else candidates.empty().append($('<p class="ta-muted">').text('Поиск…'));
            function dispatch() {
                searchTimer=null;
                Promise.resolve().then(function() {
                if (dead || token !== sequence || aborter.signal.aborted) return null;
                return options.onSearch(term, field, {signal: aborter.signal, boardId:boardId});
            }).then(function(result) {
                if (dead || token !== sequence) return;
                relationSearchPending=false;relationSearchError=null;
                userOptions = Array.isArray(result) ? result : result && result.values || [];
                userOptions.forEach(function(value) {cache[user() ? value.name : value.id] = user() ? value.displayName || value.name : value.label || value.id;});
                partial = result && result.complete === false; needsBoard = !!(result && result.needsBoard);
                boardChoices = result && result.boards || []; renderBoards(); renderChoices();
            }, function(error) {
                if (dead || token !== sequence) return;
                var message=error && ['forbidden','unauthorized'].indexOf(error.kind)!==-1 ? 'Нет доступа к вариантам Jira.' : 'Поиск недоступен. Повторите поиск.';
                if (relation()) {relationSearchPending=false;relationSearchError=message;renderChoices();}
                else candidates.empty().append($('<p class="ta-errors">').text(message));
            });
            }
            if (relation()) searchTimer=window.setTimeout(dispatch,250); else dispatch();
        }
        function renderBoards() {
            if (!boards) return; boards.empty();
            if (current.field.kind!=='sprint') return;
            if (needsBoard) {
                boardChoices.forEach(function(board) {
                    boards.append($('<button type="button" data-ta-board>').attr('data-ta-board',board.id).text(board.label+' ('+board.id+')')
                        .on('click',function() {boardId=board.id;runSearch();}));
                });
                if (!boardChoices.length) boards.append($('<p class="ta-muted">').text('Доступных Scrum-досок нет.'));
            } else if (boardId) {
                var selected=boardChoices.find(function(b) {return b.id===boardId;});
                boards.append($('<button type="button" data-ta-change-board>').text(selected ? selected.label : boardId)
                    .on('click',function() {boardId=null;userOptions=[];runSearch();}));
            }
        }
        function build(kind) {
            cancelSearch(); body.empty(); control = null; panel = null; query = ''; userOptions = []; localEdit = null;
            relationSearchPending=false;relationSearchError=null;
            if (kind === 'picker') {
                toggle = $('<button type="button" class="ta-picker" data-ta-picker aria-haspopup="listbox" aria-expanded="false">').attr('id', uid).append($('<span>'), icon('ChevronDown'));
                panel = $('<div class="ta-popover" data-ta-popover hidden>');
                boards = $('<div data-ta-boards>');
                chips = $('<div class="ta-chips" data-ta-chips>');
                search = $('<input type="search" data-ta-search autocomplete="off">').attr('aria-label', 'Поиск: ' + current.field.name);
                candidates = $('<div class="ta-candidates" role="listbox">').attr('aria-label', current.field.name);
                panel.append(chips, boards, search, candidates); body.append(toggle, panel); control = toggle;
                toggle.on('click', function() {
                    var open = panel.prop('hidden'); panel.prop('hidden', !open); toggle.attr('aria-expanded', String(open));
                    if (open) {search.trigger('focus'); runSearch();}
                    else close();
                });
                search.on('input', runSearch);
                body.on('keydown.taPicker', function(event) {
                    if (event.key === 'Escape' && !panel.prop('hidden')) {close(true); event.preventDefault();event.stopPropagation();}
                    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                        event.preventDefault(); var buttons = candidates.find('button').toArray(), index = buttons.indexOf(event.target);
                        var target = buttons[(index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length];
                        if (target) target.focus();
                    }
                });
            } else if (kind === 'unsupported') {
                control = $('<p class="ta-muted">'); body.append(control);
            } else {
                control = kind === 'textarea' ? $('<textarea rows="6">') : $('<input>');
                control.attr({id: uid, type: kind === 'number' ? 'number' : kind === 'date' ? 'date' : 'text'});
                if (kind === 'number') control.attr('step', 'any');
                if (kind === 'datetime') control.attr('placeholder', 'YYYY-MM-DDTHH:mm:ss+HH:mm');
                control.on('input', function() {
                    var value = control.val();
                    if (kind === 'number') value = value === '' ? null : Number(value);
                    if (kind === 'labels') value = value.split(',').map(function(v) {return v.trim();}).filter(Boolean);
                    if (kind === 'number' || kind === 'labels') localEdit = JSON.stringify(value);
                    options.onChange(current.field.id, value);
                }); body.append(control);
            }
            label.attr('for', uid);
        }
        function update(value) {
            if (dead) return; var oldId = current.field && current.field.id, oldScope=current.scopeKey, oldKind=current.field && current.field.kind; current = value;
            if (oldId !== current.field.id || oldScope !== current.scopeKey || oldKind !== current.field.kind) {
                cache = Object.create(null); userOptions = []; localEdit = null; cancelSearch();boardId=null;boardChoices=[];needsBoard=false;partial=false;
                relationSearchPending=false;relationSearchError=null;
                query='';if(search) search.val('');
                if(panel) {close();boards.empty();}
            }
            (current.selectedUsers || []).forEach(function(v) {cache[v.name] = v.displayName || v.name;});
            (current.field.allowedValues || []).forEach(function(v) {cache[v.id] = v.label || v.id;});
            var kind = !current.field.supported || !current.field.writable ? 'unsupported' :
                ['option', 'multioption', 'components', 'versions', 'user', 'epic', 'sprint'].indexOf(current.field.kind) !== -1 ? 'picker' : current.field.kind;
            if (mode !== kind) {body.off('.taPicker'); mode = kind; build(kind);}
            label.text(current.field.name + (current.field.required ? ' *' : ''));
            var messages = current.errors || []; errors.text(messages.join(' '));
            control.attr({'aria-describedby': uid + '-errors', 'aria-invalid': String(messages.length > 0)}).prop('disabled', current.disabled === true);
            if (kind === 'picker') renderChoices();
            else if (kind === 'unsupported') {
                var value = current.value == null ? '—' : typeof current.value === 'object' ? JSON.stringify(current.value) : String(current.value);
                control.text('Текущее значение: ' + value + '\nПоле недоступно в редакторе; используйте форму Jira.');
            } else {
                var text = current.value == null ? '' : kind === 'labels' && Array.isArray(current.value) ? current.value.join(', ') : String(current.value);
                // Keep delimiters, decimal/exponent editing and caret on local echoes.
                // A genuinely different controller value replaces the editing buffer.
                if (localEdit === null || localEdit !== JSON.stringify(current.value)) {
                    localEdit = null;
                    if (control.val() !== text) control.val(text);
                }
            }
        }
        function mount(el) {
            host = $(el).addClass('ta-field'); label = $('<label>'); body = $('<div class="ta-field-body">');
            errors = $('<div class="ta-errors" data-ta-errors>').attr('id', uid + '-errors'); host.append(label, body, errors);
            outside = function(event) {
                // Selection may remove the clicked candidate before the event reaches
                // document; its original event path still identifies this picker.
                var path = typeof event.composedPath === 'function' ? event.composedPath() : [];
                if (path.indexOf(host[0]) === -1 && !host[0].contains(event.target)) close();
            };
            escape = function(event) {
                if (event.key === 'Escape' && panel && !panel.prop('hidden')) {close(true); event.preventDefault();}
            };
            document.addEventListener('pointerdown', outside);
            document.addEventListener('click', outside);
            document.addEventListener('keydown', escape);
        }
        function destroy() {
            dead = true; cancelSearch();
            if (outside) {document.removeEventListener('pointerdown', outside); document.removeEventListener('click', outside);}
            if (escape) document.removeEventListener('keydown', escape);
            if (host) host.empty();
        }
        return {mount: mount, update: update, destroy: destroy};
    }
    return {create: create, catalogUnavailable: fields.catalogUnavailable};
});
