define("_ujgUA_repoCalendar", ["jquery", "_ujgUA_config", "_ujgUA_utils"], function($, config, utils) {
    "use strict";

    var WEEKDAYS_RU = utils.WEEKDAYS_RU;
    var MONTHS_RU = utils.MONTHS_RU;
    var MAX_DAY_ITEMS = 2;
    var MAX_WEEK_REPOS = 3;

    function buildWeeks(repoDayMap, startDate, endDate) {
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
            var repoTotals = {};
            var i;

            for (i = 0; i < 7; i++) {
                var current = new Date(d);
                var dateStr;
                var dayData;

                current.setDate(d.getDate() + i);
                dateStr = utils.getDayKey(current);

                if (current >= startDate && current <= endDate) {
                    days.push(dateStr);
                    dayData = repoDayMap[dateStr];
                    if (dayData) {
                        weekTotal += dayData.totalEvents || 0;
                        if (current.getDay() === 6 && dayData.totalEvents > 0) hasSatActivity = true;
                        if (current.getDay() === 0 && dayData.totalEvents > 0) hasSunActivity = true;
                        Object.keys(dayData.countsByRepo || {}).forEach(function(repoName) {
                            repoTotals[repoName] = (repoTotals[repoName] || 0) + (dayData.countsByRepo[repoName] || 0);
                        });
                    }
                } else {
                    days.push(null);
                }
            }

            weeks.push({
                weekLabel: d.getDate() + " " + MONTHS_RU[d.getMonth()],
                days: days,
                weekTotal: weekTotal,
                repoTotals: repoTotals
            });
            d.setDate(d.getDate() + 7);
        }

        return { weeks: weeks, showSat: hasSatActivity, showSun: hasSunActivity };
    }

    function getVisibleDays(showSat, showSun) {
        var visibleDays = [0, 1, 2, 3, 4];
        if (showSat) visibleDays.push(5);
        if (showSun) visibleDays.push(6);
        return visibleDays;
    }

    function getTopRepos(repoTotals) {
        return Object.keys(repoTotals || {}).sort(function(a, b) {
            return repoTotals[b] - repoTotals[a];
        }).slice(0, MAX_WEEK_REPOS);
    }

    function getDayTitle(dateStr) {
        var dt = new Date(dateStr + "T00:00:00");
        var dowIdx = (dt.getDay() + 6) % 7;
        return WEEKDAYS_RU[dowIdx] + ", " + dt.getDate() + " " + MONTHS_RU[dt.getMonth()];
    }

    function getItemText(item) {
        return item.title || item.message || item.hash || item.type || "";
    }

    function getItemTimestamp(item) {
        var ts = item && item.timestamp ? new Date(item.timestamp).getTime() : NaN;
        return isNaN(ts) ? null : ts;
    }

    function getItemInfoScore(item) {
        var score = 0;
        if (item && item.title) score += 3;
        if (item && item.message) score += 2;
        if (item && item.hash) score += 1;
        return score;
    }

    function getSortedDayItems(items) {
        return (items || []).map(function(item, index) {
            return {
                item: item,
                index: index,
                ts: getItemTimestamp(item),
                score: getItemInfoScore(item)
            };
        }).sort(function(a, b) {
            if (a.ts !== null || b.ts !== null) {
                if (a.ts === null) return 1;
                if (b.ts === null) return -1;
                if (a.ts !== b.ts) return b.ts - a.ts;
            }
            if (a.score !== b.score) return b.score - a.score;
            return a.index - b.index;
        }).map(function(entry) {
            return entry.item;
        });
    }

    function renderDayCell(dateStr, dayData) {
        var totalEvents = dayData && dayData.totalEvents || 0;
        var heatCls = utils.getHeatBg(totalEvents);
        var textCls = totalEvents >= 5 ? "text-primary-foreground" : "text-foreground";
        var items = getSortedDayItems(dayData && dayData.items);
        var html = '<td class="px-1 py-0.5 border-r border-border cursor-pointer transition-colors ' +
            (totalEvents > 0 ? "hover:bg-primary/5" : "hover:bg-muted/20") +
            '" data-date="' + dateStr + '">';

        html += '<div class="flex items-center justify-between mb-0.5">';
        html += '<span class="text-[9px] font-semibold text-muted-foreground">' + utils.escapeHtml(getDayTitle(dateStr)) + "</span>";
        if (totalEvents > 0) {
            html += '<span class="text-[9px] font-bold px-1 py-0 rounded ' + heatCls + " " + textCls + '">' + totalEvents + "</span>";
        }
        html += "</div>";

        if (items.length > 0) {
            html += '<div class="space-y-0.5">';
            items.slice(0, MAX_DAY_ITEMS).forEach(function(item) {
                html += '<div class="leading-snug">';
                html += '<div class="text-[10px] font-semibold text-primary break-words">' + utils.escapeHtml(item.repoName || "(unknown)") + "</div>";
                html += '<div class="text-[9px] text-muted-foreground break-words">' + utils.escapeHtml(getItemText(item)) + "</div>";
                html += "</div>";
            });
            if (items.length > MAX_DAY_ITEMS) {
                html += '<div class="text-[9px] font-semibold text-muted-foreground">+' + (items.length - MAX_DAY_ITEMS) + " еще</div>";
            }
            html += "</div>";
        }

        html += "</td>";
        return html;
    }

    function render(repoDayMap, startDate, endDate) {
        var data = buildWeeks(repoDayMap || {}, startDate, endDate);
        var weeks = data.weeks;
        var visibleDays = getVisibleDays(data.showSat, data.showSun);
        var selectedDate = null;
        var selectCallback = null;
        var html = '<div class="dashboard-card p-0 overflow-hidden"><div><table class="w-full table-fixed border-collapse text-[11px]"><colgroup>';
        var vi;

        for (vi = 0; vi < visibleDays.length; vi++) {
            html += "<col />";
        }
        html += '<col style="width:84px;min-width:84px;max-width:84px" />';
        html += '</colgroup><thead><tr class="bg-muted/40">';

        for (vi = 0; vi < visibleDays.length; vi++) {
            var dayIdx = visibleDays[vi];
            html += '<th class="text-[10px] font-semibold text-muted-foreground px-1 py-0.5 text-left border-r border-border">' +
                WEEKDAYS_RU[dayIdx] + "</th>";
        }
        html += '<th class="text-[10px] font-semibold text-muted-foreground px-1 py-0.5 text-right">Σ</th>';
        html += "</tr></thead><tbody>";

        weeks.forEach(function(week) {
            html += '<tr class="border-t border-border hover:bg-surface-hover/50 align-top">';
            visibleDays.forEach(function(dayIdx) {
                var dateStr = week.days[dayIdx];
                if (!dateStr) {
                    html += '<td class="px-1 py-0.5 border-r border-border bg-muted/10"></td>';
                    return;
                }
                html += renderDayCell(dateStr, repoDayMap[dateStr]);
            });

            html += '<td class="px-1 py-0.5 text-right align-top overflow-hidden">';
            html += '<span class="text-[11px] font-bold block">' + week.weekTotal + "</span>";

            getTopRepos(week.repoTotals).forEach(function(repoName) {
                html += '<div class="text-[9px] text-muted-foreground break-all leading-tight text-left">' +
                    utils.escapeHtml(repoName) + ": " + week.repoTotals[repoName] + "</div>";
            });
            html += "</td></tr>";
        });

        html += "</tbody></table></div></div>";

        var $el = $(html);

        function updateSelection(newDate) {
            $el.find("td[data-date]").removeClass("ring-2 ring-inset ring-primary bg-primary/5");
            if (newDate) {
                $el.find('td[data-date="' + newDate + '"]').addClass("ring-2 ring-inset ring-primary bg-primary/5");
            }
            selectedDate = newDate;
        }

        $el.on("click", "td[data-date]", function() {
            var date = $(this).attr("data-date");
            if (date === selectedDate) {
                updateSelection(null);
                if (selectCallback) selectCallback(null);
                return;
            }
            updateSelection(date);
            if (selectCallback) selectCallback(date);
        });

        return {
            $el: $el,
            onSelectDate: function(callback) {
                selectCallback = callback;
            }
        };
    }

    return {
        render: render
    };
});
