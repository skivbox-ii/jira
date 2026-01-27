// SVG графики (mini/compare)
define("_ujgSH_charts_svg", ["_ujgSH_utils"], function(utils) {
    "use strict";

    function renderMiniJiraStepChart(series) {
        if (!series) return '<div class="ujg-compare-loading">Нет данных</div>';
        var sScope = series.scope || [];
        var sComp = series.completed || [];
        var sGuide = series.guideline || [];
        var sProj = series.projection || [];
        var all = []
            .concat(sScope || [])
            .concat(sComp || [])
            .concat(sGuide || [])
            .concat(sProj || []);
        if (!all.length) return '<div class="ujg-compare-loading">Нет данных</div>';

        var minX = Math.min.apply(null, all.map(function(p) { return p.x; }));
        var maxX = Math.max.apply(null, all.map(function(p) { return p.x; }));
        if (!isFinite(minX) || !isFinite(maxX) || minX === maxX) { minX = 0; maxX = Math.max(all.length - 1, 1); }
        var maxY = Math.max.apply(null, all.map(function(p) { return p.y; })) || 1;

        function niceTicks(maxVal, count) {
            if (maxVal <= 0) return [0, 1];
            var rough = maxVal / Math.max(count, 1);
            var pow10 = Math.pow(10, Math.floor(Math.log10(rough)));
            var step = pow10;
            var err = rough / pow10;
            if (err >= 7.5) step = pow10 * 10;
            else if (err >= 3.5) step = pow10 * 5;
            else if (err >= 1.5) step = pow10 * 2;
            var ticks = [];
            for (var v = 0; v <= maxVal + step * 0.4; v += step) ticks.push(v);
            if (ticks[ticks.length - 1] < maxVal) ticks.push(maxVal);
            return ticks;
        }

        var yTicks = niceTicks(maxY, 5);
        maxY = yTicks[yTicks.length - 1] || 1;

        var VIEW_W = 110, VIEW_H = 80;
        var pad = { top: 8, right: 4, bottom: 10, left: 8 };
        var plotW = VIEW_W - pad.left - pad.right;
        var plotH = VIEW_H - pad.top - pad.bottom;

        function xPos(x) {
            var t = (x - minX) / Math.max((maxX - minX), 1);
            return pad.left + plotW * t;
        }
        function yPos(y) {
            return pad.top + plotH - (plotH * (y / maxY));
        }

        function stepPath(pts) {
            if (!pts || pts.length === 0) return "";
            var sorted = pts.slice().sort(function(a, b) { return a.x - b.x; });
            var d = "M " + xPos(sorted[0].x) + " " + yPos(sorted[0].y);
            for (var i = 1; i < sorted.length; i++) {
                var prev = sorted[i - 1];
                var cur = sorted[i];
                var x = xPos(cur.x);
                d += " L " + x + " " + yPos(prev.y);
                d += " L " + x + " " + yPos(cur.y);
            }
            return d;
        }

        function dots(pts, cls) {
            if (!pts || !pts.length) return "";
            var sorted = pts.slice().sort(function(a, b) { return a.x - b.x; });
            return sorted.map(function(p) {
                return '<circle class="' + cls + '" cx="' + xPos(p.x) + '" cy="' + yPos(p.y) + '" r="1.4"/>';
            }).join("");
        }

        var html = '<div class="ujg-mini-burn ujg-mini-jira">';
        html += '<svg class="ujg-svg ujg-burn-svg" viewBox="0 0 ' + VIEW_W + ' ' + VIEW_H + '" preserveAspectRatio="xMidYMid meet">';

        yTicks.forEach(function(v) {
            var y = yPos(v);
            html += '<line class="ujg-burn-grid" x1="' + pad.left + '" y1="' + y + '" x2="' + (VIEW_W - pad.right) + '" y2="' + y + '"/>';
        });
        html += '<line class="ujg-burn-axis" x1="' + pad.left + '" y1="' + (VIEW_H - pad.bottom) + '" x2="' + (VIEW_W - pad.right) + '" y2="' + (VIEW_H - pad.bottom) + '"/>';
        html += '<line class="ujg-burn-axis" x1="' + pad.left + '" y1="' + pad.top + '" x2="' + pad.left + '" y2="' + (VIEW_H - pad.bottom) + '"/>';

        if (sGuide && sGuide.length) html += '<path class="ujg-jira-guide" d="' + stepPath(sGuide) + '"/>' + dots(sGuide, "ujg-jira-guide-dot");
        if (sProj && sProj.length) html += '<path class="ujg-jira-proj" d="' + stepPath(sProj) + '"/>' + dots(sProj, "ujg-jira-proj-dot");
        if (sScope && sScope.length) html += '<path class="ujg-jira-scope" d="' + stepPath(sScope) + '"/>' + dots(sScope, "ujg-jira-scope-dot");
        if (sComp && sComp.length) html += '<path class="ujg-jira-done" d="' + stepPath(sComp) + '"/>' + dots(sComp, "ujg-jira-done-dot");

        html += '</svg></div>';
        return html;
    }

    function buildJiraScopeSvg(series, opts) {
        opts = opts || {};
        if (!series) return { svg: '<div class="ujg-compare-loading">Нет данных</div>' };
        var VIEW_W = opts.viewW || 882;
        var VIEW_H = opts.viewH || 500;
        var pad = opts.pad || { top: 20, right: 20, bottom: 50, left: 60 };
        var sScopeRaw = series.scope || [];
        var sCompRaw = series.completed || [];
        var sGuideRaw = series.guideline || [];
        var sProjRaw = series.projection || [];
        var all = []
            .concat(sScopeRaw || [])
            .concat(sCompRaw || [])
            .concat(sGuideRaw || [])
            .concat(sProjRaw || []);
        if (!all.length) return { svg: '<div class="ujg-compare-loading">Нет данных</div>' };
        // Ось X строго по границам спринта (не выходим за диапазон)
        var minX = series.startTime != null ? series.startTime : Math.min.apply(null, all.map(function(p) { return p.x; }));
        var maxX = series.endTime != null ? series.endTime : Math.max.apply(null, all.map(function(p) { return p.x; }));
        if (!isFinite(minX) || !isFinite(maxX) || minX === maxX) { minX = 0; maxX = Math.max(all.length - 1, 1); }
        var maxY = Math.max.apply(null, all.map(function(p) { return p.y; })) || 1;
        function niceTicks(maxVal, count) {
            if (maxVal <= 0) return [0, 1];
            var rough = maxVal / Math.max(count, 1);
            var pow10 = Math.pow(10, Math.floor(Math.log10(rough)));
            var step = pow10;
            var err = rough / pow10;
            if (err >= 7.5) step = pow10 * 10;
            else if (err >= 3.5) step = pow10 * 5;
            else if (err >= 1.5) step = pow10 * 2;
            var ticks = [];
            for (var v = 0; v <= maxVal + step * 0.4; v += step) ticks.push(v);
            if (ticks[ticks.length - 1] < maxVal) ticks.push(maxVal);
            return ticks;
        }
        var yTicks = niceTicks(maxY, 6);
        maxY = yTicks[yTicks.length - 1] || 1;
        var plotW = VIEW_W - pad.left - pad.right;
        var plotH = VIEW_H - pad.top - pad.bottom;
        function xPos(x) {
            var t = (x - minX) / Math.max((maxX - minX), 1);
            return pad.left + plotW * t;
        }
        function yPos(y) {
            return pad.top + plotH - (plotH * (y / maxY));
        }
        function yAtOrBefore(pts, x) {
            if (!pts || !pts.length) return 0;
            var sorted = pts.slice().sort(function(a, b) { return a.x - b.x; });
            var val = sorted[0].y;
            for (var i = 0; i < sorted.length; i++) {
                if (sorted[i].x <= x) val = sorted[i].y;
                else break;
            }
            return val;
        }
        function clipToSprint(pts, startTs, endTs, opts) {
            if (!pts || !pts.length) return [];
            opts = opts || {};
            var noPrependStart = !!opts.noPrependStart;
            var sorted = pts.slice().sort(function(a, b) { return a.x - b.x; });
            if (!(isFinite(startTs) && isFinite(endTs)) || endTs <= startTs) return sorted;
            // стартовое значение берём из последней точки <= startTs (может быть "вне спринта")
            var yStart = yAtOrBefore(sorted, startTs);
            var out = noPrependStart ? [] : [{ x: startTs, y: yStart }];
            sorted.forEach(function(p) {
                if (p.x > startTs && p.x <= endTs) out.push({ x: p.x, y: p.y });
            });
            // гарантируем конец в endTs (без выхода за спринт)
            var yEnd = yAtOrBefore(sorted, endTs);
            if (out[out.length - 1].x !== endTs) out.push({ x: endTs, y: yEnd });
            return out;
        }
        function clipToNow(pts, nowTs) {
            if (!pts || !pts.length) return [];
            var sorted = pts.slice().sort(function(a, b) { return a.x - b.x; });
            if (!(nowTs && isFinite(nowTs))) return sorted;
            if (nowTs < sorted[0].x) return [{ x: nowTs, y: sorted[0].y }];
            var out = sorted.filter(function(p) { return p.x <= nowTs; });
            // добавим точку на now, чтобы линия упиралась в Today
            var yNow = yAtOrBefore(sorted, nowTs);
            if (!out.length || out[out.length - 1].x !== nowTs) out.push({ x: nowTs, y: yNow });
            return out;
        }
        function stepPoints(pts) {
            if (!pts || pts.length === 0) return [];
            var sorted = pts.slice().sort(function(a, b) { return a.x - b.x; });
            var out = [{ x: sorted[0].x, y: sorted[0].y }];
            for (var i = 1; i < sorted.length; i++) {
                var prev = sorted[i - 1];
                var cur = sorted[i];
                out.push({ x: cur.x, y: prev.y });
                out.push({ x: cur.x, y: cur.y });
            }
            return out;
        }
        function pathFromPoints(pts) {
            if (!pts || pts.length === 0) return "";
            var d = "M " + xPos(pts[0].x) + " " + yPos(pts[0].y);
            for (var i = 1; i < pts.length; i++) d += " L " + xPos(pts[i].x) + " " + yPos(pts[i].y);
            return d;
        }
        function linePath(pts) {
            if (!pts || pts.length === 0) return "";
            var sorted = pts.slice().sort(function(a, b) { return a.x - b.x; });
            return pathFromPoints(sorted);
        }
        function eventDots(markers, cls, label, opts) {
            markers = markers || [];
            opts = opts || {};
            var excludeX = opts.excludeX;
            var skipFirstIfZero = !!opts.skipFirstIfZero;
            var filtered = markers.slice().sort(function(a, b) { return a.ts - b.ts; });
            if (excludeX != null) filtered = filtered.filter(function(m) { return m.ts !== excludeX; });
            if (skipFirstIfZero && filtered.length && filtered[0].y === 0) filtered = filtered.slice(1);
            return filtered.map(function(m) {
                var tip = "Дата: " + fmtX(m.ts) + "\n" + label + ": " + m.y + "\n" + (m.key || "");
                var summary = m.summary ? ("\n" + m.summary) : "";
                return '<circle class="ujg-jira-mk ' + cls + '" cx="' + xPos(m.ts) + '" cy="' + yPos(m.y) + '" r="4"' +
                    ' data-key="' + utils.escapeHtml(m.key || "") + '"' +
                    ' data-ts="' + m.ts + '"' +
                    ' data-kind="' + utils.escapeHtml(label) + '"' +
                    ' data-from="' + m.from + '"' +
                    ' data-to="' + m.to + '"' +
                    ' data-op="' + utils.escapeHtml(m.op || "") + '"' +
                    ' data-summary="' + utils.escapeHtml(m.summary || "") + '"' +
                    '><title>' + utils.escapeHtml(tip + summary) + '</title></circle>';
            }).join("");
        }
        function dottedProjection(projPts) {
            if (!projPts || projPts.length < 2) return "";
            var p0 = projPts[0], p1 = projPts[projPts.length - 1];
            var y = yPos(p0.y);
            var x0 = xPos(p0.x);
            var x1 = xPos(p1.x);
            var step = 10; // как "точки" в Jira
            var html = "";
            for (var x = x0; x <= x1 + 0.1; x += step) {
                html += '<circle class="ujg-jira-proj-dotline" cx="' + x + '" cy="' + y + '" r="2.1"></circle>';
            }
            return html;
        }
        function fmtX(ts) {
            try {
                var d = new Date(ts);
                var m = d.toLocaleDateString("ru-RU", { month: "short" }).replace(".", "");
                return m + " " + d.getDate();
            } catch (e) { return ""; }
        }
        // Сначала клипуем все серии в границы спринта (X строго внутри спринта)
        var spStart = series.startTime != null ? series.startTime : minX;
        var spEnd = series.endTime != null ? series.endTime : maxX;
        var sScopeBase = clipToSprint(sScopeRaw, spStart, spEnd);
        var sCompBase = clipToSprint(sCompRaw, spStart, spEnd);
        var sGuide = clipToSprint(sGuideRaw, spStart, spEnd);

        // Обрезаем "факт" по линии сегодня (как в Jira): после Today зелёный не рисуем, красный "факт" не рисуем
        var nowInSprint = series.now && series.startTime && series.endTime && series.now >= series.startTime && series.now <= series.endTime;
        var sScope = nowInSprint ? clipToNow(sScopeBase, series.now) : sScopeBase;
        var sComp = nowInSprint ? clipToNow(sCompBase, series.now) : sCompBase;
        // Прогноз должен начинаться строго с линии "Сегодня", без "дотягивания" от старта спринта
        var projStart = nowInSprint ? series.now : spStart;
        var sProj = clipToSprint(sProjRaw, projStart, spEnd, { noPrependStart: true });

        var out = '<svg class="ujg-svg ujg-burn-svg" width="' + VIEW_W + '" height="' + VIEW_H + '" viewBox="0 0 ' + VIEW_W + ' ' + VIEW_H + '" preserveAspectRatio="xMidYMid meet">';

        // Нерабочие дни (серые полосы) как в Jira
        if (series.workRateData && series.workRateData.rates && Array.isArray(series.workRateData.rates)) {
            series.workRateData.rates.forEach(function(r) {
                var rs = Number(r.start), re = Number(r.end), rate = Number(r.rate);
                if (!isFinite(rs) || !isFinite(re) || re <= rs) return;
                if (!isFinite(rate) || rate !== 0) return;
                var x1 = xPos(rs);
                var x2 = xPos(re);
                out += '<rect class="non-working-days" x="' + x1 + '" y="' + pad.top + '" width="' + Math.max(0, x2 - x1) + '" height="' + plotH + '"/>';
            });
        }

        yTicks.forEach(function(v) {
            var y = yPos(v);
            out += '<line class="ujg-burn-grid" x1="' + pad.left + '" y1="' + y + '" x2="' + (VIEW_W - pad.right) + '" y2="' + y + '"/>';
            out += '<text class="ujg-burn-label ujg-burn-y" x="' + (pad.left - 2) + '" y="' + (y + 1.2) + '">' + v + '</text>';
        });
        out += '<line class="ujg-burn-axis" x1="' + pad.left + '" y1="' + (VIEW_H - pad.bottom) + '" x2="' + (VIEW_W - pad.right) + '" y2="' + (VIEW_H - pad.bottom) + '"/>';
        out += '<line class="ujg-burn-axis" x1="' + pad.left + '" y1="' + pad.top + '" x2="' + pad.left + '" y2="' + (VIEW_H - pad.bottom) + '"/>';
        // x ticks как Jira (примерно раз в 2 дня)
        var dayMs = 24 * 3600 * 1000;
        var startDay = utils.startOfDay(new Date(minX)).getTime();
        var endDay = utils.startOfDay(new Date(maxX)).getTime();
        for (var t = startDay; t <= endDay + 1; t += 2 * dayMs) {
            var x = xPos(t);
            out += '<line class="ujg-burn-grid" x1="' + x + '" y1="' + pad.top + '" x2="' + x + '" y2="' + (VIEW_H - pad.bottom) + '"/>';
            out += '<text class="ujg-burn-label ujg-burn-x" x="' + x + '" y="' + (VIEW_H - pad.bottom + 16) + '">' + utils.escapeHtml(fmtX(t)) + '</text>';
        }

        // Линии/маркеры как в Jira:
        // - guideline: только линия, без кружков
        // - projection: рисуем точками (без линии)
        // - scope/work: ступеньки + кружки только когда значение менялось
        if (sGuide && sGuide.length) out += '<path class="ujg-jira-guide" d="' + linePath(sGuide) + '"/>';
        if (sProj && sProj.length) out += dottedProjection(sProj);
        if (sScope && sScope.length) out += '<path class="ujg-jira-scope" d="' + pathFromPoints(stepPoints(sScope)) + '"/>' +
            eventDots((series.markers && series.markers.scope) ? series.markers.scope : [], "ujg-jira-scope-dot", "Объём работ", { excludeX: (nowInSprint ? series.now : null) });
        if (sComp && sComp.length) out += '<path class="ujg-jira-done" d="' + pathFromPoints(stepPoints(sComp)) + '"/>' +
            eventDots((series.markers && series.markers.done) ? series.markers.done : [], "ujg-jira-done-dot", "Завершенная работа", { excludeX: (nowInSprint ? series.now : null), skipFirstIfZero: true });

        // Today line — только если "сегодня" попадает в период спринта
        if (nowInSprint) {
            var tx = xPos(series.now);
            out += '<line class="ujg-burn-today" x1="' + tx + '" y1="' + pad.top + '" x2="' + tx + '" y2="' + (VIEW_H - pad.bottom) + '"/>';
            out += '<text class="ujg-burn-label ujg-burn-x" x="' + tx + '" y="' + (pad.top - 2) + '" fill="#d7a000">Сегодня</text>';
        }

        // Axis labels как в Jira
        out += '<text class="axis-label" text-anchor="middle" transform="translate(' + ((pad.left + (VIEW_W - pad.right)) / 2) + ',' + (VIEW_H - 8) + ') rotate(0,0,0)">ВРЕМЯ</text>';
        out += '<text class="axis-label" text-anchor="middle" transform="translate(16,' + ((pad.top + (VIEW_H - pad.bottom)) / 2) + ') rotate(270,0,0)">КОЛИЧЕСТВО ПРОБЛЕМ</text>';
        out += '</svg>';
        return {
            svg: out,
            layout: {
                viewW: VIEW_W,
                viewH: VIEW_H,
                pad: pad,
                minX: minX,
                maxX: maxX,
                maxY: maxY,
                plotW: plotW,
                plotH: plotH,
                xPos: xPos,
                yPos: yPos
            }
        };
    }

    return {
        renderMiniJiraStepChart: renderMiniJiraStepChart,
        buildJiraScopeSvg: buildJiraScopeSvg
    };
});
