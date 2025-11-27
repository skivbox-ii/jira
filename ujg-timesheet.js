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
            if (!arr) return res;
            arr.forEach(function(i) { var v = key ? i[key] : i; if (v && !seen[v]) { seen[v] = true; res.push(v); } });
            return res;
        }
    };

    function MyGadget(API) {
        var self = this;
        var state = {
            weekOffset: 0,
            showComments: false,
            groupByUser: true,
            isFullscreen: false,
            periodDays: 7
        };
        var issueCache = {};
        var worklogCache = {};
        var eventsProvider = new EventsProvider(API);
        
        var $content = API.getGadgetContentEl();
        var $cont = $content.find(".ujg-timesheet");
        if ($cont.length === 0) {
            $cont = $('<div class="ujg-timesheet"></div>');
            $content.append($cont);
        }
        
        var $weekLabel, $fsBtn;
        
        function calcRange() {
            var now = new Date();
            var end = new Date(now);
            end.setDate(end.getDate() + 1);
            end.setHours(0, 0, 0, 0);
            end.setDate(end.getDate() + state.weekOffset * 7);
            var start = new Date(end);
            start.setDate(start.getDate() - state.periodDays);
            return { start: start, end: end };
        }
        
        function updateLabel(s, e) {
            var ed = new Date(e);
            ed.setDate(ed.getDate() - 1);
            $weekLabel.text(utils.formatDate(s) + ' - ' + utils.formatDate(ed));
        }
        
        function toggleFs() {
            var $el = $content.closest('.dashboard-item-content, .gadget, .ujg-gadget-wrapper');
            if ($el.length === 0) $el = $content;
            state.isFullscreen = !state.isFullscreen;
            if (state.isFullscreen) {
                $el.data('ujg-style', $el.attr('style') || '');
                $el.addClass('ujg-fullscreen');
                $fsBtn.text('Exit Fullscreen');
            } else {
                $el.removeClass('ujg-fullscreen').attr('style', $el.data('ujg-style'));
                $fsBtn.text('Fullscreen');
            }
            API.resize();
        }
        
        function applyIssueCache(events) {
            events.forEach(function(e) {
                if (e.issueKey && issueCache[e.issueKey]) {
                    var c = issueCache[e.issueKey];
                    e.issueSummary = c.summary;
                    e.inSprint = c.inSprint;
                    e.sprintName = c.sprintName;
                }
            });
        }
        
        function applyWlCache(events) {
            events.forEach(function(e) {
                if (e.issueKey && e.worklogId && worklogCache[e.issueKey]) {
                    e.worklogComment = worklogCache[e.issueKey][e.worklogId] || '';
                }
            });
        }
        
        function enrichIssues(events, cb) {
            if (!events || events.length === 0) { cb(events || []); return; }
            var keys = utils.unique(events, 'issueKey').filter(function(k) { return k && !issueCache[k]; });
            if (keys.length === 0) { applyIssueCache(events); cb(events); return; }
            
            var batches = [], bs = 50;
            for (var i = 0; i < keys.length; i += bs) batches.push(keys.slice(i, i + bs));
            var done = 0;
            
            batches.forEach(function(batch) {
                API.request({
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
                                    var last = sp[sp.length - 1];
                                    if (typeof last === 'object') { inSp = true; spName = last.name || ''; }
                                    else if (typeof last === 'string') { var nm = last.match(/name=([^,\]]+)/); if (nm) spName = nm[1]; inSp = last.indexOf('state=ACTIVE') > -1 || last.indexOf('state=CLOSED') > -1; }
                                } else if (typeof sp === 'object') { inSp = true; spName = sp.name || ''; }
                            }
                            issueCache[iss.key] = { summary: iss.fields.summary, inSprint: inSp, sprintName: spName };
                        });
                        done++;
                        if (done === batches.length) { applyIssueCache(events); cb(events); }
                    },
                    error: function() { done++; if (done === batches.length) { applyIssueCache(events); cb(events); } }
                });
            });
        }
        
        function fetchComments(events, cb) {
            if (!events || events.length === 0) { cb(events || []); return; }
            var keys = utils.unique(events, 'issueKey').filter(function(k) { return k && !worklogCache[k]; });
            if (keys.length === 0) { applyWlCache(events); cb(events); return; }
            
            var done = 0;
            keys.forEach(function(key) {
                API.request({
                    url: '/rest/api/2/issue/' + key + '/worklog',
                    type: 'GET',
                    success: function(r) {
                        worklogCache[key] = {};
                        if (r && r.worklogs) r.worklogs.forEach(function(w) { worklogCache[key][w.id] = w.comment || ''; });
                        done++;
                        if (done === keys.length) { applyWlCache(events); cb(events); }
                    },
                    error: function() { worklogCache[key] = {}; done++; if (done === keys.length) { applyWlCache(events); cb(events); } }
                });
            });
        }
        
        function eventRow(e) {
            var key = e.issueKey || '', sum = e.issueSummary || '', inSp = e.inSprint === true, spName = e.sprintName || '';
            var dt = utils.parseDate(e.started), dtStr = utils.formatDate(dt);
            var spBadge = inSp ? '<span class="ujg-sprint-badge in-sprint" title="' + utils.escapeHtml(spName) + '">In Sprint</span>' : '<span class="ujg-sprint-badge no-sprint">No Sprint</span>';
            
            var html = '<tr><td><a href="/browse/' + key + '" class="ujg-issue-key" target="_blank">' + utils.escapeHtml(key) + '</a></td>';
            html += '<td class="ujg-issue-summary">' + utils.escapeHtml(sum) + '</td>';
            html += '<td>' + spBadge + '</td>';
            html += '<td class="ujg-date-cell">' + dtStr + '</td>';
            html += '<td class="ujg-time-cell">' + utils.formatTime(e.timeSpentSeconds || 0) + '</td>';
            if (state.showComments) html += '<td><div class="ujg-worklog-comment">' + utils.escapeHtml(e.worklogComment || '') + '</div></td>';
            html += '</tr>';
            return html;
        }
        
        function draw(events) {
            $cont.empty();
            if (!events || events.length === 0) {
                $cont.html('<div class="ujg-message ujg-message-info">No data for selected period</div>');
                API.resize();
                return;
            }
            
            var cols = state.groupByUser ? ['User / Issue', 'Summary', 'Sprint', 'Date', 'Time'] : ['Issue', 'Summary', 'Sprint', 'Date', 'Time'];
            if (state.showComments) cols.push('Comment');
            
            var html = '<table class="ujg-extended-table"><thead><tr>';
            cols.forEach(function(c) { html += '<th>' + c + '</th>'; });
            html += '</tr></thead><tbody>';
            
            var total = 0;
            
            if (state.groupByUser) {
                var groups = {};
                events.forEach(function(e) {
                    var uid = e.authorAccountId || e.authorKey || e.authorName || 'unknown';
                    var uname = e.authorDisplayName || e.authorName || uid;
                    if (!groups[uid]) groups[uid] = { name: uname, events: [], time: 0 };
                    groups[uid].events.push(e);
                    groups[uid].time += e.timeSpentSeconds || 0;
                });
                
                Object.keys(groups).forEach(function(uid) {
                    var g = groups[uid];
                    total += g.time;
                    html += '<tr class="ujg-user-group"><td colspan="' + (state.showComments ? 5 : 4) + '"><strong>' + utils.escapeHtml(g.name) + '</strong></td><td class="ujg-time-cell">' + utils.formatTime(g.time) + '</td>';
                    if (state.showComments) html += '<td></td>';
                    html += '</tr>';
                    g.events.forEach(function(e) { html += eventRow(e); });
                });
            } else {
                events.forEach(function(e) { total += e.timeSpentSeconds || 0; html += eventRow(e); });
            }
            
            html += '<tr class="ujg-total-row"><td colspan="' + (state.showComments ? 5 : 4) + '"><strong>TOTAL</strong></td><td class="ujg-time-cell"><strong>' + utils.formatTime(total) + '</strong></td>';
            if (state.showComments) html += '<td></td>';
            html += '</tr></tbody></table>';
            
            $cont.html(html);
            API.resize();
        }
        
        function refresh() {
            var range = calcRange();
            updateLabel(range.start, range.end);
            $cont.html('<div class="ujg-message ujg-message-loading">Loading...</div>');
            
            eventsProvider.getEvents({ start: range.start, end: range.end, allUsers: true }, function(events) {
                enrichIssues(events, function(ev) {
                    if (state.showComments) {
                        fetchComments(ev, function(ev2) { draw(ev2); });
                    } else {
                        draw(ev);
                    }
                });
            });
        }
        
        function initPanel() {
            var $p = $('<div class="ujg-control-panel"></div>');
            var $nav = $('<div class="ujg-week-nav"></div>');
            
            var $prevBtn = $('<button class="aui-button">&#9664; Prev</button>');
            var $todayBtn = $('<button class="aui-button">Today</button>');
            var $nextBtn = $('<button class="aui-button">Next &#9654;</button>');
            $weekLabel = $('<span class="ujg-week-label"></span>');
            
            $prevBtn.on('click', function() { state.weekOffset--; refresh(); });
            $todayBtn.on('click', function() { state.weekOffset = 0; refresh(); });
            $nextBtn.on('click', function() { state.weekOffset++; refresh(); });
            
            $nav.append($prevBtn, $weekLabel, $todayBtn, $nextBtn);
            
            var $grp = $('<label class="ujg-control-checkbox"><input type="checkbox" ' + (state.groupByUser ? 'checked' : '') + '><span>Group by user</span></label>');
            $grp.find('input').on('change', function() { state.groupByUser = $(this).is(':checked'); refresh(); });
            
            var $cmt = $('<label class="ujg-control-checkbox"><input type="checkbox" ' + (state.showComments ? 'checked' : '') + '><span>Show comments</span></label>');
            $cmt.find('input').on('change', function() { state.showComments = $(this).is(':checked'); refresh(); });
            
            $fsBtn = $('<button class="aui-button ujg-fullscreen-btn">Fullscreen</button>');
            $fsBtn.on('click', function() { toggleFs(); });
            
            $p.append($nav, $grp, $cmt, $fsBtn);
            $cont.before($p);
            
            $(document).on('keydown.ujgTs', function(e) { if (e.key === 'Escape' && state.isFullscreen) toggleFs(); });
        }
        
        initPanel();
        refresh();
    }
    
    return MyGadget;
});
