define("_ujgTimesheet", ["jquery", "_ujgTimeEventsProvider", "_ujgTimeTableDrawer"], function($, EventsProvider, tableDrawer) {
    
    var utils = {
        parseDate: function(v) {
            if (!v) return null;
            if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
            if (typeof v === 'number') { var d = new Date(v); return isNaN(d.getTime()) ? null : d; }
            if (typeof v === 'string') {
                var d = new Date(v);
                if (!isNaN(d.getTime())) return d;
                var m = v.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{3})([+-])(\d{2})(\d{2})$/);
                if (m) { d = new Date(m[1]+'-'+m[2]+'-'+m[3]+'T'+m[4]+':'+m[5]+':'+m[6]+'.'+m[7]+m[8]+m[9]+':'+m[10]); if (!isNaN(d.getTime())) return d; }
            }
            return null;
        },
        formatDate: function(d, loc) {
            if (!d || !(d instanceof Date) || isNaN(d.getTime())) return '';
            try { return d.toLocaleDateString(loc || 'ru-RU', {day:'numeric',month:'short',year:'numeric'}); }
            catch(e) { return d.getDate()+'.'+(d.getMonth()+1)+'.'+d.getFullYear(); }
        },
        formatTime: function(s) {
            if (!s || s <= 0) return '0m';
            var h = Math.floor(s/3600), m = Math.floor((s%3600)/60);
            if (h > 0 && m > 0) return h+'h '+m+'m';
            return h > 0 ? h+'h' : m+'m';
        },
        escapeHtml: function(t) { if (!t) return ''; var d = document.createElement('div'); d.textContent = String(t); return d.innerHTML; },
        unique: function(arr, key) {
            var seen = {}, res = [];
            arr.forEach(function(i) { var v = key ? i[key] : i; if (v && !seen[v]) { seen[v] = true; res.push(v); } });
            return res;
        }
    };

    var MyGadget = function(API) {
        var self = this;
        this.API = API;
        this.weekOffset = 0;
        this.showComments = false;
        this.groupByUser = true;
        this.isFullscreen = false;
        this.periodDays = 7;
        this.selectedUser = ''; // '' = все пользователи
        this.allUsers = []; // список всех пользователей
        this.eventsProvider = new EventsProvider(API);
        this.issueCache = {};
        this.worklogCache = {};
        
        this.$content = API.getGadgetContentEl();
        this.$cont = this.$content.find(".ujg-timesheet");
        if (this.$cont.length === 0) {
            this.$cont = $('<div class="ujg-timesheet"></div>');
            this.$content.append(this.$cont);
        }
        
        this._initPanel();
        this._refresh();
    };

    MyGadget.prototype = {
        _initPanel: function() {
            var self = this;
            var $p = $('<div class="ujg-control-panel"></div>');
            var $nav = $('<div class="ujg-week-nav"></div>');
            
            this.$prevBtn = $('<button class="aui-button">&#9664; Prev</button>');
            this.$todayBtn = $('<button class="aui-button">Today</button>');
            this.$nextBtn = $('<button class="aui-button">Next &#9654;</button>');
            this.$weekLabel = $('<span class="ujg-week-label"></span>');
            
            this.$prevBtn.on('click', function() { self.weekOffset--; self._refresh(); });
            this.$todayBtn.on('click', function() { self.weekOffset = 0; self._refresh(); });
            this.$nextBtn.on('click', function() { self.weekOffset++; self._refresh(); });
            
            $nav.append(this.$prevBtn, this.$weekLabel, this.$todayBtn, this.$nextBtn);
            
            // Фильтр по пользователю
            var $userFilter = $('<div class="ujg-user-filter"><label>Пользователь: </label></div>');
            this.$userSelect = $('<select class="ujg-user-select"><option value="">Все пользователи</option></select>');
            this.$userSelect.on('change', function() { 
                self.selectedUser = $(this).val(); 
                self._redraw(); 
            });
            $userFilter.append(this.$userSelect);
            
            var $grp = $('<label class="ujg-control-checkbox"><input type="checkbox" '+(this.groupByUser?'checked':'')+'><span>Group by user</span></label>');
            $grp.find('input').on('change', function() { self.groupByUser = $(this).is(':checked'); self._redraw(); });
            
            var $cmt = $('<label class="ujg-control-checkbox"><input type="checkbox" '+(this.showComments?'checked':'')+'><span>Show comments</span></label>');
            $cmt.find('input').on('change', function() { self.showComments = $(this).is(':checked'); self._refresh(); });
            
            this.$fsBtn = $('<button class="aui-button ujg-fullscreen-btn">Fullscreen</button>');
            this.$fsBtn.on('click', function() { self._toggleFs(); });
            
            $p.append($nav, $userFilter, $grp, $cmt, this.$fsBtn);
            this.$cont.before($p);
            
            $(document).on('keydown.ujgTs', function(e) { if (e.key === 'Escape' && self.isFullscreen) self._toggleFs(); });
        },
        
        _toggleFs: function() {
            var $el = this.$content.closest('.dashboard-item-content, .gadget, .ujg-gadget-wrapper');
            if ($el.length === 0) $el = this.$content;
            this.isFullscreen = !this.isFullscreen;
            if (this.isFullscreen) {
                $el.data('ujg-style', $el.attr('style') || '');
                $el.addClass('ujg-fullscreen');
                this.$fsBtn.text('Exit Fullscreen');
            } else {
                $el.removeClass('ujg-fullscreen').attr('style', $el.data('ujg-style'));
                this.$fsBtn.text('Fullscreen');
            }
            this.API.resize();
        },
        
        _calcRange: function() {
            var now = new Date(), end = new Date(now);
            end.setDate(end.getDate() + 1); end.setHours(0,0,0,0);
            end.setDate(end.getDate() + this.weekOffset * 7);
            var start = new Date(end); start.setDate(start.getDate() - this.periodDays);
            return {start: start, end: end};
        },
        
        _updateLabel: function(s, e) {
            var ed = new Date(e); ed.setDate(ed.getDate() - 1);
            this.$weekLabel.text(utils.formatDate(s) + ' - ' + utils.formatDate(ed));
        },
        
        _refresh: function() {
            var self = this, range = this._calcRange();
            this._updateLabel(range.start, range.end);
            this.$cont.html('<div class="ujg-message ujg-message-loading">Loading...</div>');
            
            this.eventsProvider.getEvents({start: range.start, end: range.end, allUsers: true}, function(events) {
                self._enrichIssues(events, function(ev) {
                    self._cachedEvents = ev; // Кэшируем события для фильтрации
                    self._updateUserList(ev);
                    if (self.showComments) {
                        self._fetchComments(ev, function(ev2) { 
                            self._cachedEvents = ev2;
                            self._draw(ev2); 
                        });
                    } else {
                        self._draw(ev);
                    }
                });
            });
        },
        
        _updateUserList: function(events) {
            var self = this;
            var users = {};
            events.forEach(function(e) {
                var uid = e.authorAccountId || e.authorKey || e.authorName || 'unknown';
                var uname = e.authorDisplayName || e.authorName || uid;
                if (!users[uid]) users[uid] = uname;
            });
            
            this.allUsers = Object.keys(users).map(function(uid) {
                return {id: uid, name: users[uid]};
            }).sort(function(a, b) {
                return a.name.localeCompare(b.name);
            });
            
            // Обновляем select
            var currentVal = this.$userSelect.val();
            this.$userSelect.empty();
            this.$userSelect.append('<option value="">Все пользователи (' + this.allUsers.length + ')</option>');
            this.allUsers.forEach(function(u) {
                self.$userSelect.append('<option value="'+utils.escapeHtml(u.id)+'">'+utils.escapeHtml(u.name)+'</option>');
            });
            
            // Восстанавливаем выбор, если пользователь еще есть в списке
            if (currentVal && this.allUsers.some(function(u) { return u.id === currentVal; })) {
                this.$userSelect.val(currentVal);
            } else {
                this.selectedUser = '';
                this.$userSelect.val('');
            }
        },
        
        _redraw: function() {
            // Перерисовка без перезагрузки данных
            if (this._cachedEvents) {
                this._draw(this._cachedEvents);
            }
        },
        
        _enrichIssues: function(events, cb) {
            var self = this;
            if (!events || events.length === 0) { cb(events || []); return; }
            var keys = utils.unique(events, 'issueKey').filter(function(k) { return k && !self.issueCache[k]; });
            if (keys.length === 0) { self._applyCache(events); cb(events); return; }
            
            var batches = [], bs = 50;
            for (var i = 0; i < keys.length; i += bs) batches.push(keys.slice(i, i + bs));
            var done = 0;
            
            batches.forEach(function(batch) {
                self.API.request({
                    url: '/rest/api/2/search',
                    type: 'POST',
                    contentType: 'application/json',
                    data: JSON.stringify({jql: 'key in (' + batch.join(',') + ')', fields: ['summary','sprint','customfield_10020'], maxResults: batch.length}),
                    success: function(r) {
                        if (r && r.issues) r.issues.forEach(function(iss) {
                            var sp = iss.fields.sprint || iss.fields.customfield_10020;
                            var inSp = false, spName = '';
                            if (sp) {
                                if (Array.isArray(sp) && sp.length > 0) {
                                    var last = sp[sp.length-1];
                                    if (typeof last === 'object') { inSp = true; spName = last.name || ''; }
                                    else if (typeof last === 'string') { var nm = last.match(/name=([^,\]]+)/); if (nm) spName = nm[1]; inSp = last.indexOf('state=ACTIVE') > -1 || last.indexOf('state=CLOSED') > -1; }
                                } else if (typeof sp === 'object') { inSp = true; spName = sp.name || ''; }
                            }
                            self.issueCache[iss.key] = {summary: iss.fields.summary, inSprint: inSp, sprintName: spName};
                        });
                        if (++done === batches.length) { self._applyCache(events); cb(events); }
                    },
                    error: function() { if (++done === batches.length) { self._applyCache(events); cb(events); } }
                });
            });
        },
        
        _applyCache: function(events) {
            var self = this;
            events.forEach(function(e) {
                if (e.issueKey && self.issueCache[e.issueKey]) {
                    var c = self.issueCache[e.issueKey];
                    e.issueSummary = c.summary;
                    e.inSprint = c.inSprint;
                    e.sprintName = c.sprintName;
                }
            });
        },
        
        _fetchComments: function(events, cb) {
            var self = this;
            if (!events || events.length === 0) { cb(events || []); return; }
            var keys = utils.unique(events, 'issueKey').filter(function(k) { return k && !self.worklogCache[k]; });
            if (keys.length === 0) { self._applyWlCache(events); cb(events); return; }
            
            var done = 0;
            keys.forEach(function(key) {
                self.API.request({
                    url: '/rest/api/2/issue/' + key + '/worklog',
                    type: 'GET',
                    success: function(r) {
                        self.worklogCache[key] = {};
                        if (r && r.worklogs) r.worklogs.forEach(function(w) { self.worklogCache[key][w.id] = w.comment || ''; });
                        if (++done === keys.length) { self._applyWlCache(events); cb(events); }
                    },
                    error: function() { self.worklogCache[key] = {}; if (++done === keys.length) { self._applyWlCache(events); cb(events); } }
                });
            });
        },
        
        _applyWlCache: function(events) {
            var self = this;
            events.forEach(function(e) {
                if (e.issueKey && e.worklogId && self.worklogCache[e.issueKey]) {
                    e.worklogComment = self.worklogCache[e.issueKey][e.worklogId] || '';
                }
            });
        },
        
        _draw: function(events) {
            var self = this;
            this.$cont.empty();
            if (!events || events.length === 0) {
                this.$cont.html('<div class="ujg-message ujg-message-info">Нет данных за выбранный период</div>');
                this.API.resize();
                return;
            }
            
            // Фильтрация по выбранному пользователю
            var filteredEvents = events;
            if (this.selectedUser) {
                filteredEvents = events.filter(function(e) {
                    var uid = e.authorAccountId || e.authorKey || e.authorName || 'unknown';
                    return uid === self.selectedUser;
                });
            }
            
            if (filteredEvents.length === 0) {
                this.$cont.html('<div class="ujg-message ujg-message-info">Нет данных для выбранного пользователя</div>');
                this.API.resize();
                return;
            }
            
            var cols = this.groupByUser ? ['User / Issue','Summary','Sprint','Date','Time'] : ['Issue','Summary','Sprint','Date','Time'];
            if (this.showComments) cols.push('Comment');
            
            var html = '<table class="ujg-extended-table"><thead><tr>';
            cols.forEach(function(c) { html += '<th>' + c + '</th>'; });
            html += '</tr></thead><tbody>';
            
            var total = 0;
            
            if (this.groupByUser) {
                var groups = {};
                filteredEvents.forEach(function(e) {
                    var uid = e.authorAccountId || e.authorKey || e.authorName || 'unknown';
                    var uname = e.authorDisplayName || e.authorName || uid;
                    if (!groups[uid]) groups[uid] = {name: uname, events: [], time: 0};
                    groups[uid].events.push(e);
                    groups[uid].time += e.timeSpentSeconds || 0;
                });
                
                Object.keys(groups).forEach(function(uid) {
                    var g = groups[uid];
                    total += g.time;
                    html += '<tr class="ujg-user-group"><td colspan="'+(self.showComments?5:4)+'"><strong>' + utils.escapeHtml(g.name) + '</strong></td><td class="ujg-time-cell">' + utils.formatTime(g.time) + '</td>';
                    if (self.showComments) html += '<td></td>';
                    html += '</tr>';
                    g.events.forEach(function(e) { html += self._eventRow(e); });
                });
            } else {
                filteredEvents.forEach(function(e) { total += e.timeSpentSeconds || 0; html += self._eventRow(e); });
            }
            
            html += '<tr class="ujg-total-row"><td colspan="'+(this.showComments?5:4)+'"><strong>ИТОГО</strong></td><td class="ujg-time-cell"><strong>' + utils.formatTime(total) + '</strong></td>';
            if (this.showComments) html += '<td></td>';
            html += '</tr></tbody></table>';
            
            this.$cont.html(html);
            this.API.resize();
        },
        
        _eventRow: function(e) {
            var key = e.issueKey || '', sum = e.issueSummary || '', inSp = e.inSprint === true, spName = e.sprintName || '';
            var dt = utils.parseDate(e.started), dtStr = utils.formatDate(dt);
            var spBadge = inSp ? '<span class="ujg-sprint-badge in-sprint" title="'+utils.escapeHtml(spName)+'">In Sprint</span>' : '<span class="ujg-sprint-badge no-sprint">No Sprint</span>';
            
            var html = '<tr><td><a href="/browse/'+key+'" class="ujg-issue-key" target="_blank">'+utils.escapeHtml(key)+'</a></td>';
            html += '<td class="ujg-issue-summary">'+utils.escapeHtml(sum)+'</td>';
            html += '<td>'+spBadge+'</td>';
            html += '<td class="ujg-date-cell">'+dtStr+'</td>';
            html += '<td class="ujg-time-cell">'+utils.formatTime(e.timeSpentSeconds||0)+'</td>';
            if (this.showComments) html += '<td><div class="ujg-worklog-comment">'+utils.escapeHtml(e.worklogComment||'')+'</div></td>';
            html += '</tr>';
            return html;
        }
    };
    
    return MyGadget;
});

