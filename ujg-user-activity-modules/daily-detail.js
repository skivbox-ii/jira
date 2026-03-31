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
        if (!author) return { name: "", displayName: "" };
        if (typeof author === "string") return { name: "", displayName: author };
        return {
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

        (dayData.allComments || []).forEach(function(cm) {
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

    function authorMatchKey(author) {
        var a = author || {};
        return String(a.name || a.displayName || "").trim() || "__unknown__";
    }

    function groupActionsByUser(actions, selectedUsers) {
        var list = actions || [];
        if (selectedUsers && selectedUsers.length) {
            var allow = {};
            selectedUsers.forEach(function(u) {
                var key = typeof u === "string" ? u : (u.name || u.displayName || u.key || "");
                key = String(key).trim();
                if (key) allow[key] = true;
            });
            list = list.filter(function(a) {
                var dn = (a.author && a.author.displayName) || "";
                var nm = (a.author && a.author.name) || "";
                return allow[dn] || allow[nm];
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

    function create() {
        var $el = $('<div class="dashboard-card overflow-hidden" style="display:none"></div>');

        function renderContent(date, dayData, issueMap) {
            var html = '<div class="p-5">' +
                '<div class="flex items-center justify-between mb-4">' +
                    '<h3 class="text-sm font-semibold text-foreground">\uD83D\uDCC5 ' + utils.escapeHtml(formatFullDate(date)) + "</h3>" +
                    '<button class="ujg-ua-detail-close text-muted-foreground hover:text-foreground transition-colors">' +
                        '<span class="w-4 h-4">' + ICONS.x + "</span>" +
                    "</button>" +
                "</div>" +
                '<div class="space-y-2">';

            var normalized = normalizeDayActions(dayData, issueMap);

            if (normalized.length === 0) {
                html += '<div class="text-sm text-muted-foreground text-center py-4">Нет активности за этот день</div>';
            } else {
                var split = splitTimedAndUntimed(normalized);
                var timedPart = groupActionsByIssue(split.timed);
                html += buildIssueGroupsHtml(timedPart.grouped, timedPart.unlinked);
                if (split.undated.length > 0) {
                    var undatedPart = groupActionsByIssue(split.undated);
                    html += '<div class="ujg-ua-detail-undated mt-3 pt-2 border-t border-dashed border-border">';
                    html += '<div class="text-xs font-semibold text-muted-foreground mb-2">Без точного времени</div>';
                    html += buildIssueGroupsHtml(undatedPart.grouped, undatedPart.unlinked);
                    html += "</div>";
                }
            }

            html += "</div></div>";
            return html;
        }

        function show(date, dayData, issueMap) {
            $el.html(renderContent(date, dayData, issueMap)).slideDown(200);
            $el.find(".ujg-ua-detail-close").on("click", function() { hide(); });
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
        splitTimedAndUntimed: splitTimedAndUntimed
    };
});
