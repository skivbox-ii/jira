define("_ujgUA_unifiedCalendar", ["jquery", "_ujgUA_config", "_ujgUA_utils"], function($, config, utils) {
    "use strict";

    var WEEKDAYS_RU = utils.WEEKDAYS_RU;
    var MONTHS_RU = utils.MONTHS_RU;
    var CONFIG = config.CONFIG;
    var REPO_LABELS = config.REPO_ACTIVITY_LABELS || {};

    function buildWeeks(dayMap, issueMap, startDate, endDate) {
        var weeks = [];
        var hasSatActivity = false;
        var hasSunActivity = false;

        var d = new Date(startDate);
        var dow = d.getDay();
        var mondayOffset = dow === 0 ? -6 : 1 - dow;
        d.setDate(d.getDate() + mondayOffset);

        while (d <= endDate) {
            var days = [];
            var weekTotal = 0;
            var projectTotals = {};

            for (var i = 0; i < 7; i++) {
                var current = new Date(d);
                current.setDate(d.getDate() + i);
                var dateStr = utils.getDayKey(current);

                if (current >= startDate && current <= endDate) {
                    days.push(dateStr);
                    var dayData = dayMap[dateStr];
                    if (dayData) {
                        weekTotal += dayData.totalHours || 0;
                        if (current.getDay() === 6 && dayData.totalHours > 0) hasSatActivity = true;
                        if (current.getDay() === 0 && dayData.totalHours > 0) hasSunActivity = true;
                        var wls = dayData.allWorklogs || [];
                        for (var w = 0; w < wls.length; w++) {
                            var wl = wls[w];
                            var issue = issueMap[wl.issueKey];
                            var proj = (issue && issue.project) || "OTHER";
                            projectTotals[proj] = (projectTotals[proj] || 0) + (wl.timeSpentHours || 0);
                        }
                    }
                } else {
                    days.push(null);
                }
            }

            var monday = new Date(d);
            var weekLabel = monday.getDate() + " " + MONTHS_RU[monday.getMonth()];

            var pk;
            for (pk in projectTotals) {
                if (projectTotals.hasOwnProperty(pk)) {
                    projectTotals[pk] = Math.round(projectTotals[pk] * 10) / 10;
                }
            }

            weeks.push({
                weekLabel: weekLabel,
                days: days,
                weekTotal: Math.round(weekTotal * 10) / 10,
                projectTotals: projectTotals
            });
            d.setDate(d.getDate() + 7);
        }

        return { weeks: weeks, showSat: hasSatActivity, showSun: hasSunActivity };
    }

    function getDayTitle(dateStr) {
        var dt = new Date(dateStr + "T00:00:00");
        var dowIdx = (dt.getDay() + 6) % 7;
        return WEEKDAYS_RU[dowIdx] + ", " + dt.getDate() + " " + MONTHS_RU[dt.getMonth()];
    }

    function surname(displayName) {
        if (!displayName) return "";
        return String(displayName).split(" ")[0];
    }

    function repoItemAuthorDisplayName(item) {
        if (item.authorName) return String(item.authorName);
        var a = item.author;
        if (!a) return "";
        if (typeof a === "string") return a;
        return String((a.displayName || a.name || a.key || ""));
    }

    function repoIssueMeta(issueKey, issueMap, item) {
        var issue = issueKey && issueMap && issueMap[issueKey];
        return {
            issueSummary: (issue && issue.summary) || (item && item.issueSummary) || "",
            issueStatus: (issue && issue.status) || (item && item.issueStatus) || ""
        };
    }

    function renderIssueInlineRef(issueKey, issueSummary, issueStatus, summaryClass) {
        return utils.renderIssueRef(issueKey, issueSummary, issueStatus, {
            keyClass: "text-[10px] font-semibold text-primary",
            summaryClass: summaryClass || "text-[9px] font-medium text-foreground/90"
        });
    }

    function renderRepoObjectLink(item) {
        var type = String(item && item.type || "").toLowerCase();
        var hash = item && item.hash ? utils.shortHash(item.hash, 10) : "";
        if ((type === "commit" || type === "branch_commit") && item && item.commitUrl && hash) {
            return utils.renderExternalLink(item.commitUrl, hash, {
                class: "text-[10px] font-semibold text-primary ujg-ua-commit-link",
                title: item.hash
            });
        }
        if (type.indexOf("pull_request_") === 0 && item && item.pullRequestUrl && item.pullRequestId) {
            return utils.renderExternalLink(item.pullRequestUrl, "#" + item.pullRequestId, {
                class: "text-[10px] font-semibold text-primary ujg-ua-commit-link",
                title: "Открыть pull request"
            });
        }
        return "";
    }

    function renderUserChips(dayData, selectedUsers, dateStr) {
        if (!selectedUsers || selectedUsers.length === 0) return "";
        var todayKey = utils.getDayKey(new Date());
        var isWeekend = utils.isWeekendDay(dateStr);
        var isFuture = dateStr > todayKey;
        var allZero = true;
        var html = '<div class="ujg-ua-day-chips">';

        for (var i = 0; i < selectedUsers.length; i++) {
            var user = selectedUsers[i];
            var userData = dayData && dayData.users && dayData.users[user.name];
            var hours = (userData && userData.totalHours) || 0;
            if (hours > 0) allZero = false;
            var isRed = !isWeekend && !isFuture && hours === 0;
            var cls = isRed ? "ujg-ua-chip-red" : "ujg-ua-chip-normal";
            html += '<span class="ujg-ua-user-day-chip ' + cls + '">';
            html += utils.escapeHtml(surname(user.displayName));
            html += ' <b>' + (Math.round(hours * 10) / 10) + 'ч</b>';
            html += '</span>';
        }
        html += '</div>';
        return { html: html, allZero: allZero && !isWeekend && !isFuture };
    }

    function renderJiraBlock(dayData, issueMap) {
        issueMap = issueMap || {};
        var items = [];

        (dayData.allWorklogs || []).forEach(function(w) {
            var worklogMeta = repoIssueMeta(w.issueKey, issueMap, null);
            items.push({
                ts: w.timestamp || "",
                html: '<div class="ujg-ua-jira-line">' +
                    '<span class="ujg-ua-time">' + utils.formatTime(w.timestamp) + '</span> ' +
                    '<span class="ujg-ua-author">' + utils.escapeHtml(surname(w.author && w.author.displayName)) + '</span> ' +
                    renderIssueInlineRef(w.issueKey, worklogMeta.issueSummary, worklogMeta.issueStatus) + " " +
                    '<span class="text-[9px] font-bold">' + (Math.round((w.timeSpentHours || 0) * 10) / 10) + 'ч</span>' +
                    (w.comment ? ' <span class="text-[9px] text-muted-foreground/80">— ' + utils.escapeHtml(utils.truncate(w.comment, 60)) + '</span>' : '') +
                    '</div>'
            });
        });

        (dayData.allChanges || []).forEach(function(c) {
            if (c.field !== "status") return;
            var changeMeta = repoIssueMeta(c.issueKey, issueMap, null);
            items.push({
                ts: c.timestamp || "",
                html: '<div class="ujg-ua-jira-line">' +
                    '<span class="ujg-ua-time">' + utils.formatTime(c.timestamp) + '</span> ' +
                    '<span class="ujg-ua-author">' + utils.escapeHtml(surname(c.author && c.author.displayName)) + '</span> ' +
                    renderIssueInlineRef(c.issueKey, changeMeta.issueSummary, changeMeta.issueStatus) + " " +
                    '<span class="text-[9px]">→ ' + utils.escapeHtml(c.toString || "") + '</span>' +
                    '</div>'
            });
        });

        (dayData.allComments || []).forEach(function(c) {
            var commentMeta = repoIssueMeta(c.issueKey, issueMap, null);
            items.push({
                ts: c.timestamp || "",
                html: '<div class="ujg-ua-jira-line">' +
                    '<span class="ujg-ua-time">' + utils.formatTime(c.timestamp) + '</span> ' +
                    '<span class="ujg-ua-author">' + utils.escapeHtml(surname(c.author && c.author.displayName)) + '</span> ' +
                    renderIssueInlineRef(c.issueKey, commentMeta.issueSummary, commentMeta.issueStatus) + " " +
                    '<span class="text-[9px]">Комментарий</span>' +
                    (c.body ? ' <span class="text-[9px] text-muted-foreground/80">— ' + utils.escapeHtml(utils.truncate(c.body, 60)) + '</span>' : '') +
                    '</div>'
            });
        });

        items.sort(function(a, b) { return (a.ts || "").localeCompare(b.ts || ""); });

        var html = '<div class="ujg-ua-jira-block">';
        for (var i = 0; i < items.length; i++) {
            html += items[i].html;
        }
        html += '</div>';
        return html;
    }

    function renderRepoBlock(dayData, issueMap) {
        issueMap = issueMap || {};
        var items = (dayData.repoItems || []).slice();
        items.sort(function(a, b) {
            return ((a.timestamp || "").localeCompare(b.timestamp || ""));
        });

        var html = '<div class="ujg-ua-repo-block">';
        for (var i = 0; i < items.length; i++) {
            var item = items[i];
            var time = utils.formatTime(item.timestamp);
            var icon = "";
            var type = item.type || "commit";
            if (type === "commit") icon = "🟢";
            else if (type === "pullrequest" || type === "pr") icon = "🔵";
            else if (type === "branch") icon = "🟡";
            else icon = "●";
            var rt = String(type || "commit").toLowerCase();
            var typeLabel = REPO_LABELS[rt] || REPO_LABELS[type] || type;

            var meta = repoIssueMeta(item.issueKey, issueMap, item);
            var authorDisp = repoItemAuthorDisplayName(item);
            var objectLink = renderRepoObjectLink(item);
            var parts = ['<span class="ujg-ua-time">' + time + "</span>", icon,
                '<span class="text-[9px] text-muted-foreground">' + utils.escapeHtml(typeLabel) + "</span>"];
            if (objectLink) {
                parts.push(objectLink);
            }
            if (authorDisp) {
                parts.push('<span class="ujg-ua-author">' + utils.escapeHtml(surname(authorDisp)) + "</span>");
            }
            if (item.issueKey || meta.issueSummary) {
                parts.push(renderIssueInlineRef(
                    item.issueKey,
                    meta.issueSummary,
                    meta.issueStatus,
                    "ujg-ua-repo-summary text-[9px] font-medium text-foreground/90"
                ));
            }
            if (meta.issueStatus) {
                parts.push('<span class="ujg-ua-inline-status">' + utils.escapeHtml(meta.issueStatus) + "</span>");
            }
            var repoMsg = item.message || item.title || item.name || "";
            parts.push('<span class="text-[9px] text-muted-foreground ujg-ua-repo-msg whitespace-normal break-words min-w-0">' +
                utils.escapeHtml(repoMsg) + "</span>");
            html += '<div class="ujg-ua-repo-line">' + parts.join(" ") + "</div>";
        }
        html += '</div>';
        return html;
    }

    function alignRowBorders($table) {
        $table.find("tbody tr").each(function() {
            var $cells = $(this).find("td[data-date]");
            if ($cells.length === 0) return;
            var maxH = 0;
            $cells.each(function() {
                var $jb = $(this).find(".ujg-ua-jira-block");
                if ($jb.length > 0) {
                    var h = $jb.outerHeight();
                    if (h > maxH) maxH = h;
                }
            });
            if (maxH > 0) {
                $cells.each(function() {
                    $(this).find(".ujg-ua-jira-block").css("min-height", maxH + "px");
                });
            }
        });
    }

    function buildVisibleDays(showSat, showSun) {
        var visibleDays = [0, 1, 2, 3, 4];
        if (showSat) visibleDays.push(5);
        if (showSun) visibleDays.push(6);
        return visibleDays;
    }

    function buildCalendarInnerHtml(dayMap, issueMap, selectedUsers, startDate, endDate) {
        var data = buildWeeks(dayMap, issueMap, startDate, endDate);
        var weeks = data.weeks;
        var visibleDays = buildVisibleDays(data.showSat, data.showSun);

        var columnTotals = {};
        var vi, wi, dateStr, dayData, dayIdx;
        for (vi = 0; vi < visibleDays.length; vi++) {
            dayIdx = visibleDays[vi];
            var sum = 0;
            for (wi = 0; wi < weeks.length; wi++) {
                dateStr = weeks[wi].days[dayIdx];
                if (dateStr) {
                    dayData = dayMap[dateStr];
                    if (dayData) sum += (dayData.totalHours || 0);
                }
            }
            columnTotals[dayIdx] = Math.round(sum * 10) / 10;
        }

        var html = '<div><table class="w-full table-fixed border-collapse text-[11px]"><colgroup>';
        for (vi = 0; vi < visibleDays.length; vi++) {
            html += "<col />";
        }
        html += '<col style="width:70px;min-width:70px;max-width:70px" />';
        html += '</colgroup><thead><tr class="bg-muted/40">';

        for (vi = 0; vi < visibleDays.length; vi++) {
            dayIdx = visibleDays[vi];
            html += '<th class="text-[10px] font-semibold text-muted-foreground px-1 py-0.5 text-left border-r border-border">';
            html += '<div class="flex items-center justify-between"><span>' + WEEKDAYS_RU[dayIdx] + '</span>';
            if (columnTotals[dayIdx] > 0) {
                html += '<span class="text-[9px] font-bold text-foreground/70">' + columnTotals[dayIdx] + 'ч</span>';
            }
            html += '</div></th>';
        }
        html += '<th class="text-[10px] font-semibold text-muted-foreground px-1 py-0.5 text-right w-[70px]">Σ</th>';
        html += '</tr></thead><tbody>';

        for (wi = 0; wi < weeks.length; wi++) {
            var week = weeks[wi];
            html += '<tr class="border-t border-border hover:bg-surface-hover/50 align-top">';

            for (vi = 0; vi < visibleDays.length; vi++) {
                dayIdx = visibleDays[vi];
                dateStr = week.days[dayIdx];

                if (!dateStr) {
                    html += '<td class="px-1 py-0.5 border-r border-border bg-muted/10"></td>';
                    continue;
                }

                dayData = dayMap[dateStr] || {};
                var hours = dayData.totalHours || 0;
                var hoverCls = hours > 0 ? "hover:bg-primary/5" : "hover:bg-muted/20";

                var chipsResult = renderUserChips(dayData, selectedUsers, dateStr);
                var redBorderCls = chipsResult.allZero && selectedUsers && selectedUsers.length > 0 ? " ujg-ua-day-cell-red-border" : "";

                html += '<td class="ujg-ua-day-cell px-1 py-0.5 border-r border-border cursor-pointer transition-colors ' + hoverCls + redBorderCls + '" data-date="' + dateStr + '">';

                html += '<div class="flex items-center justify-between mb-0.5">';
                html += '<span class="text-[9px] font-semibold text-muted-foreground">' + utils.escapeHtml(getDayTitle(dateStr)) + '</span>';
                if (hours > 0) {
                    var heatCls = utils.getHeatBg(hours);
                    var textCls = hours >= 5 ? "text-primary-foreground" : "text-foreground";
                    html += '<span class="text-[9px] font-bold px-1 py-0 rounded ' + heatCls + ' ' + textCls + '">' + (Math.round(hours * 10) / 10) + 'ч</span>';
                }
                html += '</div>';

                html += chipsResult.html;
                html += renderJiraBlock(dayData, issueMap);
                html += renderRepoBlock(dayData, issueMap);

                html += '</td>';
            }

            var totalCls = week.weekTotal >= 40 ? "text-success" : week.weekTotal >= 20 ? "text-foreground" : "text-muted-foreground";
            html += '<td class="px-1 py-0.5 text-right align-top">';
            html += '<span class="text-[11px] font-bold block ' + totalCls + '">' + week.weekTotal + 'ч</span>';

            var projKeys = Object.keys(week.projectTotals);
            if (projKeys.length > 0) {
                projKeys.sort(function(a, b) { return week.projectTotals[b] - week.projectTotals[a]; });
                html += '<div class="mt-0.5 space-y-0">';
                for (var pi = 0; pi < projKeys.length; pi++) {
                    html += '<div class="text-[9px] text-muted-foreground whitespace-nowrap">' +
                        utils.escapeHtml(projKeys[pi]) + ': ' + week.projectTotals[projKeys[pi]] + 'ч</div>';
                }
                html += '</div>';
            }
            html += '</td></tr>';
        }

        html += '</tbody></table></div>';
        return html;
    }

    function render(dayMap, issueMap, selectedUsers, startDate, endDate) {
        var currentDayMap = dayMap || {};
        var currentIssueMap = issueMap || {};
        var selectedUsersRef = selectedUsers || [];
        var selectedDate = null;
        var selectCallback = null;
        var $el = $('<div class="dashboard-card p-0 overflow-hidden"></div>');

        function updateSelection(newDate) {
            $el.find("td[data-date]").removeClass("ring-2 ring-inset ring-primary bg-primary/5");
            if (newDate) {
                $el.find('td[data-date="' + newDate + '"]').addClass("ring-2 ring-inset ring-primary bg-primary/5");
            }
            selectedDate = newDate;
        }

        function repaint() {
            $el.html(buildCalendarInnerHtml(currentDayMap, currentIssueMap, selectedUsersRef, startDate, endDate));
            if (selectedDate) updateSelection(selectedDate);
            requestAnimationFrame(function() {
                alignRowBorders($el.find("table"));
            });
        }

        function updateDayCell(dateStr, dayData, nextIssueMap) {
            if (dateStr) currentDayMap[dateStr] = dayData || {};
            if (nextIssueMap) currentIssueMap = nextIssueMap;
            repaint();
        }

        repaint();

        $el.on("click", "td[data-date]", function() {
            var date = $(this).attr("data-date");
            if (date === selectedDate) {
                updateSelection(null);
                if (selectCallback) selectCallback(null);
            } else {
                updateSelection(date);
                if (selectCallback) selectCallback(date);
            }
        });

        return {
            $el: $el,
            onSelectDate: function(callback) { selectCallback = callback; },
            updateDayCell: updateDayCell
        };
    }

    return { render: render };
});
