define("_ujgUA_calendarHeatmap", ["jquery", "_ujgUA_config", "_ujgUA_utils"], function($, config, utils) {
    "use strict";

    var WEEKDAYS_RU = utils.WEEKDAYS_RU;
    var MONTHS_RU = utils.MONTHS_RU;

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
                        weekTotal += dayData.totalHours;
                        if (current.getDay() === 6 && dayData.totalHours > 0) hasSatActivity = true;
                        if (current.getDay() === 0 && dayData.totalHours > 0) hasSunActivity = true;
                        for (var w = 0; w < dayData.worklogs.length; w++) {
                            var wl = dayData.worklogs[w];
                            var issue = issueMap[wl.issueKey];
                            var proj = (issue && issue.project) || "OTHER";
                            projectTotals[proj] = (projectTotals[proj] || 0) + wl.timeSpentHours;
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

    function render(dayMap, issueMap, startDate, endDate) {
        var data = buildWeeks(dayMap, issueMap, startDate, endDate);
        var weeks = data.weeks;
        var showSat = data.showSat;
        var showSun = data.showSun;

        var visibleDays = [0, 1, 2, 3, 4];
        if (showSat) visibleDays.push(5);
        if (showSun) visibleDays.push(6);

        var columnTotals = {};
        var vi, wi, dateStr, dayData;
        for (vi = 0; vi < visibleDays.length; vi++) {
            var dayIdx = visibleDays[vi];
            var sum = 0;
            for (wi = 0; wi < weeks.length; wi++) {
                dateStr = weeks[wi].days[dayIdx];
                if (dateStr) {
                    dayData = dayMap[dateStr];
                    if (dayData) sum += dayData.totalHours;
                }
            }
            columnTotals[dayIdx] = Math.round(sum * 10) / 10;
        }

        var selectedDate = null;
        var selectCallback = null;

        var html = '<div class="dashboard-card p-0 overflow-hidden"><div><table class="w-full table-fixed border-collapse text-[11px]"><colgroup>';
        for (vi = 0; vi < visibleDays.length; vi++) {
            html += "<col />";
        }
        html += '<col style="width:60px;min-width:60px;max-width:60px" />';
        html += "</colgroup><thead><tr class=\"bg-muted/40\">";

        for (vi = 0; vi < visibleDays.length; vi++) {
            dayIdx = visibleDays[vi];
            html += '<th class="text-[10px] font-semibold text-muted-foreground px-1 py-0.5 text-left border-r border-border">' +
                '<div class="flex items-center justify-between"><span>' + WEEKDAYS_RU[dayIdx] + "</span>";
            if (columnTotals[dayIdx] > 0) {
                html += '<span class="text-[9px] font-bold text-foreground/70">' + columnTotals[dayIdx] + "ч</span>";
            }
            html += "</div></th>";
        }
        html += '<th class="text-[10px] font-semibold text-muted-foreground px-1 py-0.5 text-right w-[60px]">Σ</th>';
        html += "</tr></thead><tbody>";

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

                dayData = dayMap[dateStr];
                var hours = (dayData && dayData.totalHours) || 0;
                var hoverCls = hours > 0 ? "hover:bg-primary/5" : "hover:bg-muted/20";

                html += '<td class="px-1 py-0.5 border-r border-border cursor-pointer transition-colors ' + hoverCls + '" data-date="' + dateStr + '">';
                html += '<div class="flex items-center justify-between mb-0.5">';

                var dtObj = new Date(dateStr + "T00:00:00");
                var dowIdx = (dtObj.getDay() + 6) % 7;
                var dayLabel = WEEKDAYS_RU[dowIdx] + ", " + dtObj.getDate() + " " + MONTHS_RU[dtObj.getMonth()];
                html += '<span class="text-[9px] font-semibold text-muted-foreground">' + utils.escapeHtml(dayLabel) + "</span>";

                if (hours > 0) {
                    var heatCls = utils.getHeatBg(hours);
                    var textCls = hours >= 5 ? "text-primary-foreground" : "text-foreground";
                    html += '<span class="text-[9px] font-bold px-1 py-0 rounded ' + heatCls + " " + textCls + '">' + hours + "ч</span>";
                }
                html += "</div>";

                if (dayData && dayData.worklogs && dayData.worklogs.length > 0) {
                    html += '<div class="space-y-0.5">';
                    for (var wli = 0; wli < dayData.worklogs.length; wli++) {
                        var wl = dayData.worklogs[wli];
                        var issue = issueMap[wl.issueKey];
                        var summary = (issue && issue.summary) || "";
                        html += '<div class="leading-snug"><div class="flex items-baseline gap-1 flex-wrap">' +
                            '<span class="text-[10px] font-semibold text-primary shrink-0">' + utils.escapeHtml(wl.issueKey) + "</span>" +
                            '<span class="text-[9px] text-muted-foreground break-words">' + utils.escapeHtml(summary) + "</span>" +
                            '<span class="text-[9px] font-bold text-foreground shrink-0">' + wl.timeSpentHours + "ч</span>";
                        if (wl.comment) {
                            html += '<span class="text-[9px] text-muted-foreground/80 break-words whitespace-pre-wrap">— ' + utils.escapeHtml(wl.comment) + "</span>";
                        }
                        html += "</div></div>";
                    }
                    html += "</div>";
                }
                html += "</td>";
            }

            var totalCls = week.weekTotal >= 40 ? "text-success" : week.weekTotal >= 20 ? "text-foreground" : "text-muted-foreground";
            html += '<td class="px-1 py-0.5 text-right align-top">';
            html += '<span class="text-[11px] font-bold block ' + totalCls + '">' + week.weekTotal + "ч</span>";

            var projKeys = Object.keys(week.projectTotals);
            if (projKeys.length > 0) {
                projKeys.sort(function(a, b) { return week.projectTotals[b] - week.projectTotals[a]; });
                html += '<div class="mt-0.5 space-y-0">';
                for (var pi = 0; pi < projKeys.length; pi++) {
                    html += '<div class="text-[9px] text-muted-foreground whitespace-nowrap">' +
                        utils.escapeHtml(projKeys[pi]) + ": " + week.projectTotals[projKeys[pi]] + "ч</div>";
                }
                html += "</div>";
            }
            html += "</td></tr>";
        }

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
            } else {
                updateSelection(date);
                if (selectCallback) selectCallback(date);
            }
        });

        return {
            $el: $el,
            onSelectDate: function(callback) { selectCallback = callback; }
        };
    }

    return { render: render };
});
