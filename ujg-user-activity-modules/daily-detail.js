define("_ujgUA_dailyDetail", ["jquery", "_ujgUA_config", "_ujgUA_utils"], function($, config, utils) {
    "use strict";

    var MONTHS_FULL_RU = utils.MONTHS_FULL_RU;
    var ICONS = config.ICONS;
    var REPO_LABELS = config.REPO_ACTIVITY_LABELS || {};

    function formatFullDate(dateStr) {
        var d = new Date(dateStr + "T00:00:00");
        return d.getDate() + " " + MONTHS_FULL_RU[d.getMonth()] + " " + d.getFullYear();
    }

    function surname(displayName) {
        if (!displayName) return "";
        return String(displayName).split(" ")[0];
    }

    function byTimestamp(a, b) {
        var ta = String(a.timestamp || "");
        var tb = String(b.timestamp || "");
        if (ta < tb) return -1;
        if (ta > tb) return 1;
        return 0;
    }

    function normalizeAuthor(author) {
        if (!author) return { key: "", name: "", displayName: "" };
        if (typeof author === "string") return { key: "", name: "", displayName: author };
        return {
            key: author.key || "",
            name: author.name || author.key || "",
            displayName: author.displayName || author.name || author.key || ""
        };
    }

    function timestampFor(entry) {
        if (entry.timestamp) return entry.timestamp;
        if (entry.started) return entry.started;
        if (entry.created) return entry.created;
        if (entry.date) return entry.date + "T00:00:00";
        return "";
    }

    function pickWorklogs(dayData) {
        if (!dayData) return [];
        if (dayData.allWorklogs !== undefined && dayData.allWorklogs !== null) {
            return dayData.allWorklogs || [];
        }
        return dayData.worklogs || [];
    }

    function pickChanges(dayData) {
        if (!dayData) return [];
        if (dayData.allChanges !== undefined && dayData.allChanges !== null) {
            return dayData.allChanges || [];
        }
        return dayData.changes || [];
    }

    function pickComments(dayData) {
        if (!dayData) return [];
        if (dayData.allComments !== undefined && dayData.allComments !== null) {
            return dayData.allComments || [];
        }
        return dayData.comments || [];
    }

    function metaFromIssue(issueKey, issueMap, repoItem) {
        var issue = issueKey && issueMap && issueMap[issueKey];
        return {
            issueSummary: (issue && issue.summary) || (repoItem && repoItem.issueSummary) || "",
            issueStatus: (issue && issue.status) || (repoItem && repoItem.issueStatus) || ""
        };
    }

    function normalizeDayActions(dayData, issueMap) {
        issueMap = issueMap || {};
        var actions = [];
        if (!dayData) return actions;

        pickWorklogs(dayData).forEach(function(wl) {
            var m = metaFromIssue(wl.issueKey, issueMap, null);
            actions.push({
                issueKey: wl.issueKey,
                issueSummary: m.issueSummary,
                issueStatus: m.issueStatus,
                timestamp: timestampFor(wl),
                author: normalizeAuthor(wl.author),
                type: "worklog",
                timeSpentHours: wl.timeSpentHours,
                comment: wl.comment || ""
            });
        });

        pickChanges(dayData).forEach(function(ch) {
            if (ch.field !== "status") return;
            var m = metaFromIssue(ch.issueKey, issueMap, null);
            actions.push({
                issueKey: ch.issueKey,
                issueSummary: m.issueSummary,
                issueStatus: m.issueStatus,
                timestamp: timestampFor(ch),
                author: normalizeAuthor(ch.author),
                type: "change",
                fromString: ch.fromString || "",
                toString: ch.toString || ""
            });
        });

        pickComments(dayData).forEach(function(cm) {
            var m = metaFromIssue(cm.issueKey, issueMap, null);
            actions.push({
                issueKey: cm.issueKey,
                issueSummary: m.issueSummary,
                issueStatus: m.issueStatus,
                timestamp: timestampFor(cm),
                author: normalizeAuthor(cm.author),
                type: "comment",
                body: cm.body || ""
            });
        });

        (dayData.repoItems || []).forEach(function(r) {
            var repoAuthor = { name: "", displayName: "" };
            if (r.author) {
                repoAuthor = normalizeAuthor(r.author);
            } else if (r.authorName) {
                repoAuthor = { name: "", displayName: r.authorName };
            }
            var ik = r.issueKey || null;
            var m = metaFromIssue(ik, issueMap, r);
            actions.push({
                issueKey: ik,
                issueSummary: m.issueSummary,
                issueStatus: m.issueStatus,
                timestamp: r.timestamp || r.authorTimestamp || "",
                author: repoAuthor,
                type: "repo",
                repoType: r.type || "commit",
                message: r.message || r.title || r.name || ""
            });
        });

        return actions;
    }

    function splitTimedAndUntimed(actions) {
        var timed = [];
        var undated = [];
        (actions || []).forEach(function(a) {
            if (String(a.timestamp || "").trim()) timed.push(a);
            else undated.push(a);
        });
        return { timed: timed, undated: undated };
    }

    function groupActionsByIssue(actions) {
        var grouped = {};
        var unlinked = [];
        (actions || []).forEach(function(act) {
            var ik = act.issueKey;
            if (ik == null || ik === "") {
                unlinked.push(act);
            } else {
                if (!grouped[ik]) grouped[ik] = [];
                grouped[ik].push(act);
            }
        });
        return { grouped: grouped, unlinked: unlinked };
    }

    function normalizedToken(value) {
        return String(value || "").trim().toLowerCase();
    }

    function collectUserTokens(user) {
        var source = typeof user === "string" ? { key: user, name: user, displayName: user } : (user || {});
        var tokens = [];

        [source.key, source.name, source.displayName].forEach(function(value) {
            var token = normalizedToken(value);
            if (token && tokens.indexOf(token) === -1) tokens.push(token);
        });

        return tokens;
    }

    function authorMatchKey(author) {
        var a = author || {};
        return String(a.name || a.key || a.displayName || "").trim() || "__unknown__";
    }

    function authorIdentity(author) {
        var a = normalizeAuthor(author);
        return {
            key: normalizedToken(a.key),
            name: normalizedToken(a.name),
            displayName: normalizedToken(a.displayName)
        };
    }

    function authorIdentitySignature(author) {
        var id = authorIdentity(author);
        return [id.key, id.name, id.displayName].join("\0");
    }

    function groupActionsByUser(actions, selectedUsers) {
        var list = actions || [];
        if (selectedUsers && selectedUsers.length) {
            var allow = {};
            selectedUsers.forEach(function(u) {
                collectUserTokens(u).forEach(function(token) {
                    allow[token] = true;
                });
            });
            list = list.filter(function(a) {
                var tokens = collectUserTokens(a.author);
                for (var i = 0; i < tokens.length; i++) {
                    if (allow[tokens[i]]) return true;
                }
                return false;
            });
        }
        var byUser = {};
        list.forEach(function(a) {
            var k = authorMatchKey(a.author);
            if (!byUser[k]) byUser[k] = [];
            byUser[k].push(a);
        });
        return byUser;
    }

    function minGroupTimestamp(arr) {
        var best = "";
        for (var i = 0; i < arr.length; i++) {
            var t = String(arr[i].timestamp || "");
            if (!best || (t && t < best)) best = t;
        }
        return best;
    }

    function renderActionHtml(action) {
        var time = utils.formatTime(action.timestamp);
        var authEsc = utils.escapeHtml(surname(action.author && action.author.displayName));
        var html = '<div class="ujg-ua-detail-action">';
        html += '<span class="ujg-ua-time">' + utils.escapeHtml(time) + '</span> ';
        html += '<span class="ujg-ua-author">' + authEsc + "</span> — ";

        switch (action.type) {
            case "worklog": {
                var h = Math.round((action.timeSpentHours || 0) * 10) / 10;
                html += "Worklog " + h + "ч";
                var c = action.comment && String(action.comment).trim();
                if (c) {
                    html += '<div class="ujg-ua-detail-comment">"' + utils.escapeHtml(utils.truncate(c, 200)) + '"</div>';
                }
                break;
            }
            case "change":
                html += '<span class="text-warning">' + utils.escapeHtml(action.fromString || "") + "</span>";
                html += " → ";
                html += '<span class="text-success">' + utils.escapeHtml(action.toString || "") + "</span>";
                break;
            case "comment":
                html += "Комментарий";
                var b = action.body && String(action.body).trim();
                if (b) {
                    html += '<div class="ujg-ua-detail-comment">"' + utils.escapeHtml(utils.truncate(b, 200)) + '"</div>';
                }
                break;
            case "repo": {
                var rt = String(action.repoType || "commit").toLowerCase();
                var typeLabel = REPO_LABELS[rt] || rt;
                html += utils.escapeHtml(typeLabel);
                var st = action.issueStatus && String(action.issueStatus).trim();
                if (st) {
                    html += ' <span class="ujg-ua-inline-status">' + utils.escapeHtml(st) + "</span>";
                }
                var msg = action.message && String(action.message).trim();
                if (msg) {
                    html += '<div class="ujg-ua-detail-comment">"' + utils.escapeHtml(utils.truncate(msg, 200)) + '"</div>';
                }
                break;
            }
            default:
                break;
        }

        html += "</div>";
        return html;
    }

    function buildIssueGroupsHtml(grouped, unlinked) {
        var html = "";
        var keys = Object.keys(grouped);
        var ki;
        for (ki = 0; ki < keys.length; ki++) {
            grouped[keys[ki]].sort(byTimestamp);
        }
        unlinked.sort(byTimestamp);

        keys.sort(function(a, b) {
            var cmp = minGroupTimestamp(grouped[a]).localeCompare(minGroupTimestamp(grouped[b]));
            if (cmp !== 0) return cmp;
            return a.localeCompare(b);
        });

        for (ki = 0; ki < keys.length; ki++) {
            var key = keys[ki];
            var entry = grouped[key];
            var summary = (entry[0] && entry[0].issueSummary) || "";

            html += '<div class="ujg-ua-detail-issue">';
            html += '<div class="ujg-ua-detail-issue-header flex items-start gap-2">';
            html += utils.renderIssueLink(key, key, 'class="font-mono text-xs font-semibold text-primary shrink-0 ujg-ua-issue-key"');
            html += '<span class="text-foreground font-medium min-w-0 ujg-ua-detail-issue-summary">' + utils.escapeHtml(summary) + "</span>";
            html += "</div>";
            for (var gi = 0; gi < entry.length; gi++) {
                html += renderActionHtml(entry[gi]);
            }
            html += "</div>";
        }

        if (unlinked.length > 0) {
            html += '<div class="ujg-ua-detail-unlinked">';
            html += '<div class="ujg-ua-detail-issue-header">Без привязки к задаче</div>';
            for (var ui = 0; ui < unlinked.length; ui++) {
                html += renderActionHtml(unlinked[ui]);
            }
            html += "</div>";
        }
        return html;
    }

    function filterActionsBySelectedUsers(actions, selectedUsers, selectedColumns) {
        if (!selectedUsers || !selectedUsers.length) return actions || [];
        selectedColumns = selectedColumns || buildSelectedColumns(selectedUsers);
        return (actions || []).filter(function(a) {
            return findTimelineCandidateColumnIds(a.author, selectedColumns).length > 0;
        });
    }

    function buildSelectedColumns(selectedUsers) {
        return (selectedUsers || []).map(function(user, index) {
            var normalized = normalizeAuthor(user);
            return {
                id: "sel-" + index,
                user: normalized,
                identity: authorIdentity(normalized),
                tokens: collectUserTokens(normalized)
            };
        });
    }

    function buildDerivedColumns(actions) {
        var seen = {};
        var columns = [];
        (actions || []).forEach(function(action) {
            var normalized = normalizeAuthor(action.author);
            var sig = authorIdentitySignature(normalized);
            if (seen[sig]) return;
            seen[sig] = true;
            columns.push({
                id: "act-" + columns.length,
                user: normalized,
                identity: authorIdentity(normalized),
                tokens: collectUserTokens(normalized)
            });
        });
        return columns;
    }

    function matchColumnIdsByField(columns, field, value) {
        var token = normalizedToken(value);
        if (!token) return [];
        var ids = [];
        (columns || []).forEach(function(column) {
            if (column.identity[field] === token) ids.push(column.id);
        });
        return ids;
    }

    function matchColumnIdsByTokens(columns, author) {
        var tokens = collectUserTokens(author);
        if (!tokens.length) return [];
        var ids = [];
        (columns || []).forEach(function(column) {
            for (var i = 0; i < tokens.length; i++) {
                if (column.tokens.indexOf(tokens[i]) !== -1) {
                    ids.push(column.id);
                    return;
                }
            }
        });
        return ids;
    }

    function findTimelineCandidateColumnIds(author, columns) {
        var normalized = normalizeAuthor(author);
        var ids = matchColumnIdsByField(columns, "key", normalized.key);
        if (ids.length) return ids;
        ids = matchColumnIdsByField(columns, "name", normalized.name);
        if (ids.length) return ids;
        ids = matchColumnIdsByField(columns, "displayName", normalized.displayName);
        if (ids.length) return ids;
        return matchColumnIdsByTokens(columns, normalized);
    }

    function findTimelineColumnId(author, columns) {
        var ids = findTimelineCandidateColumnIds(author, columns);
        return ids.length === 1 ? ids[0] : "";
    }

    var TEAM_TIMELINE_HEIGHT_PX = 400;

    function buildTimelineModel(actions, selectedUsers, dateStr) {
        selectedUsers = selectedUsers || [];
        var selectedColumns = selectedUsers.length ? buildSelectedColumns(selectedUsers) : [];
        var filtered = filterActionsBySelectedUsers(actions, selectedUsers, selectedColumns);
        var split = splitTimedAndUntimed(filtered);
        var timed = split.timed.slice().sort(byTimestamp);

        var columnDefs = selectedColumns.length ? selectedColumns : buildDerivedColumns(timed);
        var users = [];
        var columns = {};
        columnDefs.forEach(function(column) {
            users.push(Object.assign({ id: column.id }, column.user));
            columns[column.id] = { user: column.user, items: [] };
        });
        var unmatched = [];

        timed.forEach(function(a) {
            var columnId = findTimelineColumnId(a.author, columnDefs);
            if (!columnId) {
                if (selectedColumns.length) unmatched.push(a);
                return;
            }
            columns[columnId].items.push(a);
        });

        var minMs = Infinity;
        var maxMs = -Infinity;
        timed.forEach(function(a) {
            var ms = Date.parse(String(a.timestamp || ""));
            if (!isNaN(ms)) {
                if (ms < minMs) minMs = ms;
                if (ms > maxMs) maxMs = ms;
            }
        });

        if (minMs === Infinity) {
            var ds = dateStr || "2000-01-01";
            minMs = Date.parse(ds + "T09:00:00Z");
            maxMs = minMs + 3600000;
            if (isNaN(minMs)) {
                minMs = Date.now();
                maxMs = minMs + 3600000;
            }
        }

        var MIN_RANGE_MS = 60 * 60 * 1000;
        if (maxMs - minMs < MIN_RANGE_MS) {
            var mid = (minMs + maxMs) / 2;
            minMs = mid - MIN_RANGE_MS / 2;
            maxMs = mid + MIN_RANGE_MS / 2;
        }

        var rangeStartMs = minMs;
        var rangeEndMs = maxMs;
        var span = rangeEndMs - rangeStartMs || 1;

        var markers = [];
        var step = 3600000;
        var t = Math.floor(rangeStartMs / step) * step;
        var guard = 0;
        while (t <= rangeEndMs + step && guard < 48) {
            if (t >= rangeStartMs - 1) {
                markers.push({ ms: t, ratio: (t - rangeStartMs) / span });
            }
            t += step;
            guard += 1;
        }

        return {
            users: users,
            columns: columns,
            markers: markers,
            rangeStartMs: rangeStartMs,
            rangeEndMs: rangeEndMs,
            undated: split.undated,
            unmatched: unmatched
        };
    }

    function renderTeamTimeline(model) {
        var h = TEAM_TIMELINE_HEIGHT_PX;
        var span = model.rangeEndMs - model.rangeStartMs || 1;

        var markersHtml = "";
        model.markers.forEach(function(mk) {
            var topPx = Math.round(mk.ratio * h);
            markersHtml += '<div class="ujg-ua-detail-time-marker" style="top:' + topPx + 'px"></div>';
        });

        var colsHtml = "";
        model.users.forEach(function(user) {
            var col = model.columns[user.id];
            var label = utils.escapeHtml(surname(user.displayName || user.name || user.id));
            colsHtml += '<div class="ujg-ua-detail-user-col">';
            colsHtml += '<div class="ujg-ua-detail-user-col-label text-xs font-semibold text-muted-foreground">' + label + "</div>";
            colsHtml += '<div class="ujg-ua-detail-user-col-track" style="height:' + h + 'px">';
            col.items.forEach(function(a) {
                var ms = Date.parse(String(a.timestamp || ""));
                if (isNaN(ms)) return;
                var ratio = (ms - model.rangeStartMs) / span;
                var topPx = Math.round(ratio * h);
                colsHtml += '<div class="ujg-ua-detail-timeline-card" style="top:' + topPx + 'px">';
                colsHtml += renderActionHtml(a);
                colsHtml += "</div>";
            });
            colsHtml += "</div></div>";
        });

        var t0 = new Date(model.rangeStartMs).toISOString();
        var t1 = new Date(model.rangeEndMs).toISOString();
        var html = '<div class="ujg-ua-detail-timeline mt-2">';
        html += '<div class="ujg-ua-detail-timeline-scale text-[10px] text-muted-foreground mb-1">' +
            utils.escapeHtml(utils.formatTime(t0)) + " — " + utils.escapeHtml(utils.formatTime(t1)) + "</div>";
        html += '<div class="ujg-ua-detail-timeline-grid relative" style="min-height:' + h + 'px">';
        html += '<div class="ujg-ua-detail-time-markers pointer-events-none">' + markersHtml + "</div>";
        html += '<div class="ujg-ua-detail-user-cols flex gap-2 min-w-0">' + colsHtml + "</div>";
        html += "</div></div>";
        return html;
    }

    function create() {
        var $el = $('<div class="dashboard-card overflow-hidden" style="display:none"></div>');
        var currentMode = "issue";
        var lastArgs = null;

        function renderModeToggle(mode) {
            var issueAct = mode === "issue" ? " ujg-ua-detail-mode-active" : "";
            var teamAct = mode === "team" ? " ujg-ua-detail-mode-active" : "";
            return (
                '<div class="ujg-ua-detail-mode-toggle flex rounded-md border border-border overflow-hidden text-xs shrink-0">' +
                '<button type="button" class="ujg-ua-detail-mode-btn ujg-ua-detail-mode-issue' + issueAct + '" data-ua-detail-mode="issue">По задачам</button>' +
                '<button type="button" class="ujg-ua-detail-mode-btn ujg-ua-detail-mode-team' + teamAct + '" data-ua-detail-mode="team">По команде</button>' +
                "</div>"
            );
        }

        function renderInner(date, dayData, issueMap, selectedUsers, mode) {
            var html = '<div class="p-5">' +
                '<div class="flex items-center justify-between gap-2 mb-4 flex-wrap">' +
                '<h3 class="text-sm font-semibold text-foreground">\uD83D\uDCC5 ' + utils.escapeHtml(formatFullDate(date)) + "</h3>" +
                '<div class="flex items-center gap-2">' +
                renderModeToggle(mode) +
                '<button class="ujg-ua-detail-close text-muted-foreground hover:text-foreground transition-colors">' +
                '<span class="w-4 h-4">' + ICONS.x + "</span>" +
                "</button></div></div>" +
                '<div class="space-y-2">';

            var normalized = normalizeDayActions(dayData, issueMap);

            if (normalized.length === 0) {
                html += '<div class="text-sm text-muted-foreground text-center py-4">Нет активности за этот день</div>';
            } else if (mode === "team") {
                var model = buildTimelineModel(normalized, selectedUsers, date);
                html += renderTeamTimeline(model);
                if (model.unmatched.length > 0) {
                    var unmatchedPart = groupActionsByIssue(model.unmatched);
                    html += '<div class="ujg-ua-detail-unmatched mt-3 pt-2 border-t border-dashed border-border">';
                    html += '<div class="text-xs font-semibold text-muted-foreground mb-2">Не удалось сопоставить с выбранным пользователем</div>';
                    html += buildIssueGroupsHtml(unmatchedPart.grouped, unmatchedPart.unlinked);
                    html += "</div>";
                }
                if (model.undated.length > 0) {
                    var undTeam = groupActionsByIssue(model.undated);
                    html += '<div class="ujg-ua-detail-undated mt-3 pt-2 border-t border-dashed border-border">';
                    html += '<div class="text-xs font-semibold text-muted-foreground mb-2">Без точного времени</div>';
                    html += buildIssueGroupsHtml(undTeam.grouped, undTeam.unlinked);
                    html += "</div>";
                }
            } else {
                var split = splitTimedAndUntimed(normalized);
                var timedPart = groupActionsByIssue(split.timed);
                html += buildIssueGroupsHtml(timedPart.grouped, timedPart.unlinked);
                if (split.undated.length > 0) {
                    var undIss = groupActionsByIssue(split.undated);
                    html += '<div class="ujg-ua-detail-undated mt-3 pt-2 border-t border-dashed border-border">';
                    html += '<div class="text-xs font-semibold text-muted-foreground mb-2">Без точного времени</div>';
                    html += buildIssueGroupsHtml(undIss.grouped, undIss.unlinked);
                    html += "</div>";
                }
            }

            html += "</div></div>";
            return html;
        }

        function bindChrome() {
            $el.find(".ujg-ua-detail-close").on("click", function() { hide(); });
            $el.find(".ujg-ua-detail-mode-issue").on("click", function() {
                currentMode = "issue";
                if (lastArgs) {
                    $el.html(renderInner(lastArgs.date, lastArgs.dayData, lastArgs.issueMap, lastArgs.selectedUsers, currentMode));
                    bindChrome();
                }
            });
            $el.find(".ujg-ua-detail-mode-team").on("click", function() {
                currentMode = "team";
                if (lastArgs) {
                    $el.html(renderInner(lastArgs.date, lastArgs.dayData, lastArgs.issueMap, lastArgs.selectedUsers, currentMode));
                    bindChrome();
                }
            });
        }

        function show(date, dayData, issueMap, selectedUsers) {
            lastArgs = {
                date: date,
                dayData: dayData,
                issueMap: issueMap,
                selectedUsers: selectedUsers || []
            };
            $el.html(renderInner(date, dayData, issueMap, lastArgs.selectedUsers, currentMode)).slideDown(200);
            bindChrome();
        }

        function hide() {
            $el.slideUp(200);
        }

        return { $el: $el, show: show, hide: hide };
    }

    return {
        create: create,
        normalizeDayActions: normalizeDayActions,
        groupActionsByIssue: groupActionsByIssue,
        groupActionsByUser: groupActionsByUser,
        splitTimedAndUntimed: splitTimedAndUntimed,
        buildTimelineModel: buildTimelineModel,
        renderTeamTimeline: renderTeamTimeline
    };
});
