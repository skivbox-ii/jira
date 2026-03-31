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

    function byTimestampDesc(a, b) {
        return byTimestamp(b, a);
    }

    function normalizeAuthor(author) {
        if (!author) return { key: "", name: "", displayName: "", accountId: "", userName: "" };
        if (typeof author === "string") {
            return { key: "", name: "", displayName: author, accountId: "", userName: "" };
        }
        var nested = author.user && typeof author.user === "object" ? author.user : null;
        return {
            key: author.key || (nested && nested.key) || "",
            name: author.name || (nested && nested.name) || author.key || (nested && nested.key) || "",
            displayName: author.displayName || (nested && nested.displayName) || author.name ||
                (nested && nested.name) || author.key || "",
            accountId: author.accountId || (nested && nested.accountId) || "",
            userName: author.userName || (nested && nested.userName) || ""
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

    function renderActionIssueRef(action, keyClass, summaryClass) {
        if (!action || (!action.issueKey && !action.issueSummary)) return "";
        return utils.renderIssueRef(action.issueKey, action.issueSummary, action.issueStatus, {
            keyClass: keyClass || "font-mono text-xs font-semibold text-primary shrink-0",
            summaryClass: summaryClass || "text-foreground font-medium min-w-0"
        });
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
                repoName: r.repoName || "",
                repoUrl: r.repoUrl || "",
                branchName: r.branchName || "",
                message: r.message || r.title || r.name || "",
                title: r.title || "",
                status: r.status || "",
                hash: r.hash || "",
                commitUrl: r.commitUrl || "",
                pullRequestId: r.pullRequestId || "",
                pullRequestUrl: r.pullRequestUrl || "",
                pullRequestAuthor: r.pullRequestAuthor || "",
                reviewers: (r.reviewers || []).slice(),
                reviewerDetails: (r.reviewerDetails || []).slice(),
                raw: r.raw || null
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

        function push(value) {
            var token = normalizedToken(value);
            if (token && tokens.indexOf(token) === -1) tokens.push(token);
        }

        push(source.key);
        push(source.name);
        push(source.displayName);
        push(source.accountId);
        push(source.userName);
        if (source.user) {
            push(source.user.key);
            push(source.user.name);
            push(source.user.displayName);
            push(source.user.accountId);
            push(source.user.userName);
        }

        return tokens;
    }

    function authorMatchKey(author) {
        var a = author || {};
        return String(a.accountId || a.name || a.key || a.displayName || "").trim() || "__unknown__";
    }

    function authorIdentity(author) {
        var a = normalizeAuthor(author);
        return {
            key: normalizedToken(a.key),
            name: normalizedToken(a.name),
            displayName: normalizedToken(a.displayName),
            accountId: normalizedToken(a.accountId),
            userName: normalizedToken(a.userName)
        };
    }

    function authorIdentitySignature(author) {
        var id = authorIdentity(author);
        return [id.key, id.name, id.displayName, id.accountId, id.userName].join("\0");
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
        var issueRef = renderActionIssueRef(
            action,
            "font-mono text-xs font-semibold text-primary shrink-0",
            "text-foreground font-medium min-w-0"
        );
        var html = '<div class="ujg-ua-detail-action">';
        html += '<span class="ujg-ua-time">' + utils.escapeHtml(time) + '</span> ';
        html += '<span class="ujg-ua-author">' + authEsc + "</span>";
        if (issueRef) html += " " + issueRef;
        html += " — ";

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
                html += "Статус ";
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
                var objectLink = renderRepoObjectLink(action);
                html += utils.escapeHtml(typeLabel);
                if (objectLink) {
                    html += " " + objectLink;
                }
                var st = action.issueStatus && String(action.issueStatus).trim();
                if (st) {
                    html += ' <span class="ujg-ua-inline-status">' + utils.escapeHtml(st) + "</span>";
                }
                var msg = action.message && String(action.message).trim();
                if (msg) {
                    html += '<div class="ujg-ua-detail-comment whitespace-normal break-words">"' + utils.escapeHtml(msg) + '"</div>';
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
            var status = (entry[0] && entry[0].issueStatus) || "";

            html += '<div class="ujg-ua-detail-issue">';
            html += '<div class="ujg-ua-detail-issue-header flex items-start gap-2">';
            html += renderActionIssueRef({
                issueKey: key,
                issueSummary: summary,
                issueStatus: status
            }, "font-mono text-xs font-semibold text-primary shrink-0", "text-foreground font-medium min-w-0 ujg-ua-detail-issue-summary");
            if (status) {
                html += '<span class="ujg-ua-inline-status shrink-0">' + utils.escapeHtml(status) + "</span>";
            }
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

    function authorDisplayName(author) {
        var normalized = normalizeAuthor(author);
        return normalized.displayName || normalized.name || normalized.key || "";
    }

    function isCommitRepoType(repoType) {
        var type = String(repoType || "").toLowerCase();
        return type === "commit" || type === "branch_commit";
    }

    function isPullRequestRepoType(repoType) {
        return String(repoType || "").toLowerCase().indexOf("pull_request_") === 0;
    }

    function renderRepoObjectLink(action) {
        if (!action) return "";
        if (isCommitRepoType(action.repoType) && action.commitUrl && action.hash) {
            return utils.renderExternalLink(action.commitUrl, utils.shortHash(action.hash, 10), {
                class: "font-mono text-primary font-semibold ujg-ua-commit-link",
                title: action.hash
            });
        }
        if (isPullRequestRepoType(action.repoType) && action.pullRequestUrl && action.pullRequestId) {
            return utils.renderExternalLink(action.pullRequestUrl, "#" + action.pullRequestId, {
                class: "font-mono text-primary font-semibold ujg-ua-commit-link",
                title: "Открыть pull request"
            });
        }
        return "";
    }

    function renderRepoIssueCell(action) {
        if (!action || (!action.issueKey && !action.issueSummary)) {
            return '<span class="text-muted-foreground">-</span>';
        }
        var html = utils.renderIssueRef(action.issueKey, action.issueSummary, action.issueStatus, {
            keyClass: "font-mono text-primary text-[11px]",
            summaryClass: "block text-[10px] text-foreground/80 ujg-ua-detail-issue-summary"
        });
        if (action.issueStatus) {
            html += '<div><span class="ujg-ua-inline-status">' + utils.escapeHtml(action.issueStatus) + "</span></div>";
        }
        return html;
    }

    function renderRepoPlaceCell(action) {
        var repoName = utils.escapeHtml(action && action.repoName || "-");
        var branchName = utils.escapeHtml(action && action.branchName || "");
        var html = '<div class="font-semibold text-foreground">' + repoName + "</div>";
        if (branchName) {
            html += '<div class="text-[10px] text-muted-foreground font-mono">' + branchName + "</div>";
        }
        return html;
    }

    function renderReviewerSummary(action) {
        var reviewerDetails = action && action.reviewerDetails || [];
        if (reviewerDetails.length) {
            return reviewerDetails.map(function(item) {
                return item.status
                    ? item.name + " (" + item.status + ")"
                    : item.name;
            }).join(", ");
        }
        return (action && action.reviewers || []).join(", ");
    }

    function renderRepoSection(title, headHtml, bodyHtml) {
        return '<div class="ujg-ua-detail-repo-section mt-3">' +
            '<div class="ujg-ua-detail-repo-title">' + utils.escapeHtml(title) + "</div>" +
            '<div class="ujg-ua-detail-repo-table-wrap"><table class="ujg-ua-detail-repo-table">' +
            "<thead><tr>" + headHtml + "</tr></thead>" +
            "<tbody>" + bodyHtml + "</tbody></table></div></div>";
    }

    function renderCommitRows(actions) {
        return actions.map(function(action) {
            var author = authorDisplayName(action.author) || "-";
            var objectLink = renderRepoObjectLink(action);
            return "<tr>" +
                '<td class="font-mono text-muted-foreground whitespace-nowrap">' + utils.escapeHtml(utils.formatTime(action.timestamp)) + "</td>" +
                '<td><span class="ujg-ua-author">' + utils.escapeHtml(author) + "</span></td>" +
                '<td class="font-mono">' + (objectLink || utils.escapeHtml(utils.shortHash(action.hash, 10) || "-")) + "</td>" +
                "<td>" + renderRepoPlaceCell(action) + "</td>" +
                "<td>" + renderRepoIssueCell(action) + "</td>" +
                '<td class="whitespace-normal break-words">' + utils.escapeHtml(action.message || action.title || "-") + "</td>" +
                "</tr>";
        }).join("");
    }

    function renderPullRequestRows(actions) {
        return actions.map(function(action) {
            var objectLink = renderRepoObjectLink(action);
            var prAuthor = action.pullRequestAuthor || authorDisplayName(action.author) || "-";
            var actor = authorDisplayName(action.author) || "-";
            var reviewers = renderReviewerSummary(action) || "-";
            var typeLabel = REPO_LABELS[String(action.repoType || "").toLowerCase()] || action.repoType || "";
            return "<tr>" +
                '<td class="font-mono text-muted-foreground whitespace-nowrap">' + utils.escapeHtml(utils.formatTime(action.timestamp)) + "</td>" +
                '<td><span class="ujg-ua-inline-status">' + utils.escapeHtml(typeLabel) + "</span></td>" +
                '<td class="font-mono">' + (objectLink || utils.escapeHtml(action.pullRequestId ? "#" + action.pullRequestId : "-")) + "</td>" +
                '<td class="whitespace-normal break-words">' + utils.escapeHtml(action.title || action.message || "-") + "</td>" +
                '<td>' + utils.escapeHtml(action.status || "-") + "</td>" +
                '<td><span class="ujg-ua-author">' + utils.escapeHtml(prAuthor) + "</span></td>" +
                '<td><span class="ujg-ua-author">' + utils.escapeHtml(actor) + "</span></td>" +
                '<td class="whitespace-normal break-words">' + utils.escapeHtml(reviewers) + "</td>" +
                "<td>" + renderRepoPlaceCell(action) + "</td>" +
                "<td>" + renderRepoIssueCell(action) + "</td>" +
                "</tr>";
        }).join("");
    }

    function renderOtherRepoRows(actions) {
        return actions.map(function(action) {
            var typeLabel = REPO_LABELS[String(action.repoType || "").toLowerCase()] || action.repoType || "";
            return "<tr>" +
                '<td class="font-mono text-muted-foreground whitespace-nowrap">' + utils.escapeHtml(utils.formatTime(action.timestamp)) + "</td>" +
                '<td><span class="ujg-ua-inline-status">' + utils.escapeHtml(typeLabel) + "</span></td>" +
                '<td><span class="ujg-ua-author">' + utils.escapeHtml(authorDisplayName(action.author) || "-") + "</span></td>" +
                "<td>" + renderRepoPlaceCell(action) + "</td>" +
                "<td>" + renderRepoIssueCell(action) + "</td>" +
                '<td class="whitespace-normal break-words">' + utils.escapeHtml(action.message || action.title || "-") + "</td>" +
                "</tr>";
        }).join("");
    }

    function renderRepoDaySections(actions) {
        var repoActions = (actions || []).slice().sort(byTimestampDesc);
        if (!repoActions.length) return "";
        var commits = repoActions.filter(function(action) {
            return isCommitRepoType(action.repoType);
        });
        var pullRequests = repoActions.filter(function(action) {
            return isPullRequestRepoType(action.repoType);
        });
        var other = repoActions.filter(function(action) {
            return !isCommitRepoType(action.repoType) && !isPullRequestRepoType(action.repoType);
        });
        var html = '<div class="ujg-ua-detail-repo-day mt-4 pt-3 border-t border-border">' +
            '<div class="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Bitbucket за день</div>';

        if (commits.length) {
            html += renderRepoSection(
                "Коммиты",
                "<th>Время</th><th>Автор</th><th>Commit</th><th>Репозиторий</th><th>Задача</th><th>Сообщение</th>",
                renderCommitRows(commits)
            );
        }
        if (pullRequests.length) {
            html += renderRepoSection(
                "Pull requests",
                "<th>Время</th><th>Событие</th><th>PR</th><th>Заголовок</th><th>Статус</th><th>Автор PR</th><th>Кто сделал</th><th>Проверяющие</th><th>Репозиторий</th><th>Задача</th>",
                renderPullRequestRows(pullRequests)
            );
        }
        if (other.length) {
            html += renderRepoSection(
                "Прочая repo-активность",
                "<th>Время</th><th>Тип</th><th>Кто</th><th>Репозиторий</th><th>Задача</th><th>Описание</th>",
                renderOtherRepoRows(other)
            );
        }

        html += "</div>";
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
        ids = matchColumnIdsByField(columns, "accountId", normalized.accountId);
        if (ids.length) return ids;
        ids = matchColumnIdsByField(columns, "userName", normalized.userName);
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
    var TIMELINE_STACK_NEAR_MS = 90 * 1000;
    var TIMELINE_STACK_STEP_PX = 10;
    var TIMELINE_CARD_EST_HEIGHT_PX = 64;

    function timelineMaxStackOffsetPx(items) {
        var sorted = (items || []).slice().sort(byTimestamp);
        var anchorMs = NaN;
        var stackInCluster = 0;
        var maxOffset = 0;
        sorted.forEach(function(a) {
            var ms = Date.parse(String(a.timestamp || ""));
            if (isNaN(ms)) return;
            if (isNaN(anchorMs) || ms - anchorMs > TIMELINE_STACK_NEAR_MS) {
                anchorMs = ms;
                stackInCluster = 0;
            } else {
                stackInCluster += 1;
                maxOffset = Math.max(maxOffset, stackInCluster * TIMELINE_STACK_STEP_PX);
            }
        });
        return maxOffset;
    }

    function layoutTimelineCardTops(items, h, rangeStartMs, span) {
        var sorted = (items || []).slice().sort(byTimestamp);
        var anchorMs = NaN;
        var stackInCluster = 0;
        var rows = [];
        sorted.forEach(function(a) {
            var ms = Date.parse(String(a.timestamp || ""));
            if (isNaN(ms)) {
                rows.push({ action: a, topPx: null });
                return;
            }
            if (isNaN(anchorMs) || ms - anchorMs > TIMELINE_STACK_NEAR_MS) {
                anchorMs = ms;
                stackInCluster = 0;
            } else {
                stackInCluster += 1;
            }
            var ratio = (ms - rangeStartMs) / span;
            var baseTop = Math.round(ratio * h);
            rows.push({ action: a, topPx: baseTop + stackInCluster * TIMELINE_STACK_STEP_PX });
        });
        return rows;
    }

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
        var maxStackOffsetPx = 0;

        model.users.forEach(function(user) {
            var col = model.columns[user.id];
            maxStackOffsetPx = Math.max(maxStackOffsetPx, timelineMaxStackOffsetPx(col.items));
        });

        var baseHeight = h + maxStackOffsetPx;
        var trackH = h + maxStackOffsetPx * 2 + TIMELINE_CARD_EST_HEIGHT_PX;

        var markersHtml = "";
        model.markers.forEach(function(mk) {
            var topPx = Math.round(mk.ratio * baseHeight);
            markersHtml += '<div class="ujg-ua-detail-time-marker" style="top:' + topPx + 'px"></div>';
        });

        var colLayouts = model.users.map(function(user) {
            var col = model.columns[user.id];
            return {
                user: user,
                rows: layoutTimelineCardTops(col.items, baseHeight, model.rangeStartMs, span)
            };
        });
        colLayouts.forEach(function(layout) {
            layout.rows.forEach(function(row) {
                if (row.topPx != null) {
                    trackH = Math.max(trackH, row.topPx + TIMELINE_CARD_EST_HEIGHT_PX + 4);
                }
            });
        });

        var colsHtml = "";
        colLayouts.forEach(function(layout) {
            var user = layout.user;
            var label = utils.escapeHtml(surname(user.displayName || user.name || user.id));
            colsHtml += '<div class="ujg-ua-detail-user-col">';
            colsHtml += '<div class="ujg-ua-detail-user-col-label text-xs font-semibold text-muted-foreground">' + label + "</div>";
            colsHtml += '<div class="ujg-ua-detail-user-col-track" style="height:' + trackH + 'px">';
            layout.rows.forEach(function(row) {
                if (row.topPx == null) return;
                colsHtml += '<div class="ujg-ua-detail-timeline-card" style="top:' + row.topPx + 'px">';
                colsHtml += renderActionHtml(row.action);
                colsHtml += "</div>";
            });
            colsHtml += "</div></div>";
        });

        var t0 = new Date(model.rangeStartMs).toISOString();
        var t1 = new Date(model.rangeEndMs).toISOString();
        var html = '<div class="ujg-ua-detail-timeline mt-2">';
        html += '<div class="ujg-ua-detail-timeline-scale text-[10px] text-muted-foreground mb-1">' +
            utils.escapeHtml(utils.formatTime(t0)) + " — " + utils.escapeHtml(utils.formatTime(t1)) + "</div>";
        html += '<div class="ujg-ua-detail-timeline-grid relative" style="min-height:' + trackH + 'px">';
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
            var jiraActions = normalized.filter(function(action) {
                return action.type !== "repo";
            });
            var repoActions = normalized.filter(function(action) {
                return action.type === "repo";
            });

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
                var timelineRepoActions = filterActionsBySelectedUsers(repoActions, selectedUsers);
                if (timelineRepoActions.length > 0) {
                    html += renderRepoDaySections(timelineRepoActions);
                }
            } else {
                if (jiraActions.length > 0) {
                    var split = splitTimedAndUntimed(jiraActions);
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
                if (repoActions.length > 0) {
                    html += renderRepoDaySections(repoActions);
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
        renderTeamTimeline: renderTeamTimeline,
        layoutTimelineCardTops: layoutTimelineCardTops
    };
});
