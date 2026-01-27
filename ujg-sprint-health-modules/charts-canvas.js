// Canvas графики (fullscreen)
define("_ujgSH_charts_canvas", ["_ujgSH_utils"], function(utils) {
    "use strict";

    function drawBurnupCanvas(canvas, series, opts) {
        if (!canvas || !series) return;
        opts = opts || {};
        var ctx = canvas.getContext("2d");
        var dpr = window.devicePixelRatio || 1;
        var rect = canvas.getBoundingClientRect();

        // Adjust for HighDPI
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
        ctx.scale(dpr, dpr);

        var width = rect.width;
        var height = rect.height;
        var pad = { top: 40, right: 260, bottom: 60, left: 60 };

        // Clear
        ctx.clearRect(0, 0, width, height);

        // Data Prep
        var sScope = series.scope || [];
        var sComp = series.completed || [];
        var sGuide = series.guideline || [];
        var sProj = series.projection || [];
        var all = [].concat(sScope, sComp, sGuide, sProj);

        if (!all.length) {
            ctx.font = "14px -apple-system, sans-serif";
            ctx.fillStyle = "#6b778c";
            ctx.textAlign = "center";
            ctx.fillText("Нет данных", width / 2, height / 2);
            return;
        }

        var minX = series.startTime != null ? series.startTime : Math.min.apply(null, all.map(function(p) { return p.x; }));
        var maxX = series.endTime != null ? series.endTime : Math.max.apply(null, all.map(function(p) { return p.x; }));
        if (!isFinite(minX) || !isFinite(maxX) || minX === maxX) { minX = 0; maxX = Math.max(all.length - 1, 1); }
        var maxY = Math.max.apply(null, all.map(function(p) { return p.y; })) || 1;

        // Ticks
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
        var yTicks = niceTicks(maxY, 8);
        maxY = yTicks[yTicks.length - 1] || 1;

        var plotW = width - pad.left - pad.right;
        var plotH = height - pad.top - pad.bottom;

        function xPos(x) {
            var t = (x - minX) / Math.max((maxX - minX), 1);
            return pad.left + plotW * t;
        }
        function yPos(y) {
            return pad.top + plotH - (plotH * (y / maxY));
        }

        // Draw Non-working days
        if (series.workRateData && series.workRateData.rates && Array.isArray(series.workRateData.rates)) {
            ctx.fillStyle = "rgba(9, 30, 66, 0.04)";
            series.workRateData.rates.forEach(function(r) {
                var rs = Number(r.start), re = Number(r.end), rate = Number(r.rate);
                if (!isFinite(rs) || !isFinite(re) || re <= rs) return;
                if (!isFinite(rate) || rate !== 0) return;
                var x1 = xPos(rs);
                var x2 = xPos(re);
                ctx.fillRect(x1, pad.top, Math.max(0, x2 - x1), plotH);
            });
        }

        // Grid & Axes
        ctx.beginPath();
        ctx.strokeStyle = "#e6eaf0";
        ctx.lineWidth = 1;
        // Y Grid
        ctx.textAlign = "right";
        ctx.textBaseline = "middle";
        ctx.fillStyle = "#5e6c84";
        ctx.font = "11px -apple-system, sans-serif";
        yTicks.forEach(function(v) {
            var y = Math.round(yPos(v)) + 0.5;
            ctx.moveTo(pad.left, y);
            ctx.lineTo(width - pad.right, y);
            ctx.fillText(v, pad.left - 8, y);
        });
        // X Grid
        var dayMs = 24 * 3600 * 1000;
        var startDay = utils.startOfDay(new Date(minX)).getTime();
        var endDay = utils.startOfDay(new Date(maxX)).getTime();
        ctx.textAlign = "center";
        ctx.textBaseline = "top";

        var xTickStep = Math.ceil((endDay - startDay) / dayMs / 12) * dayMs; 
        for (var t = startDay; t <= endDay + dayMs; t += xTickStep) {
            if (t > maxX) break;
            var x = Math.round(xPos(t)) + 0.5;
            ctx.moveTo(x, pad.top);
            ctx.lineTo(x, height - pad.bottom);
            try {
                var d = new Date(t);
                var txt = d.toLocaleDateString("ru-RU", { month: "short", day: "numeric" }).replace(".", "");
                ctx.fillText(txt, x, height - pad.bottom + 8);
            } catch(e){}
        }
        ctx.stroke();

        // Axes
        ctx.beginPath();
        ctx.strokeStyle = "#d0d4da";
        ctx.lineWidth = 1;
        ctx.moveTo(pad.left, pad.top);
        ctx.lineTo(pad.left, height - pad.bottom);
        ctx.lineTo(width - pad.right, height - pad.bottom);
        ctx.stroke();

        // Helper: Clip
        ctx.save();
        ctx.beginPath();
        ctx.rect(pad.left, pad.top, plotW, plotH);
        ctx.clip();

        // Helper: Draw Line
        function drawLine(pts, color, lineWidth, dash) {
            if (!pts || !pts.length) return;
            ctx.beginPath();
            ctx.strokeStyle = color;
            ctx.lineWidth = lineWidth;
            if (dash) ctx.setLineDash(dash);
            else ctx.setLineDash([]);

            var sorted = pts.slice().sort(function(a,b){ return a.x - b.x; });
            ctx.moveTo(xPos(sorted[0].x), yPos(sorted[0].y));
            for (var i=1; i<sorted.length; i++) {
                ctx.lineTo(xPos(sorted[i].x), yPos(sorted[i].y));
            }
            ctx.stroke();
            ctx.setLineDash([]);
        }

        // Helper: Draw Step Line
        function drawStepLine(pts, color, lineWidth) {
            if (!pts || !pts.length) return;
            ctx.beginPath();
            ctx.strokeStyle = color;
            ctx.lineWidth = lineWidth;
            var sorted = pts.slice().sort(function(a,b){ return a.x - b.x; });
            var curX = xPos(sorted[0].x);
            var curY = yPos(sorted[0].y);
            ctx.moveTo(curX, curY);

            for (var i=1; i<sorted.length; i++) {
                var nextX = xPos(sorted[i].x);
                var nextY = yPos(sorted[i].y);
                ctx.lineTo(nextX, curY);
                ctx.lineTo(nextX, nextY);
                curX = nextX;
                curY = nextY;
            }
            ctx.stroke();
        }

        // Guideline
        drawLine(sGuide, "#b3bac5", 2);

        // Projection
        if (sProj && sProj.length) {
            drawLine(sProj, "#ff8b00", 2, [5, 3]);
            // Proj Dots
            ctx.fillStyle = "#fff";
            ctx.strokeStyle = "#ff8b00";
            ctx.lineWidth = 1.5;
            sProj.forEach(function(p) {
                ctx.beginPath();
                ctx.arc(xPos(p.x), yPos(p.y), 3, 0, Math.PI*2);
                ctx.fill();
                ctx.stroke();
            });
        }

        // Scope & Done (clipped to now if needed)
        var nowInSprint = series.now && series.now >= minX && series.now <= maxX;

        // Draw Scope
        drawStepLine(sScope, "#de350b", 2.5);

        // Draw Done
        drawStepLine(sComp, "#36b37e", 2.5);

        ctx.restore(); // End clip

        // Markers & Labels
        var markers = [];
        function collectMarkers(list, kind, color) {
            if (!list) return;
            list.forEach(function(m) {
                if (nowInSprint && m.ts > series.now) return; 
                markers.push({
                    x: xPos(m.ts),
                    y: yPos(m.y),
                    ts: m.ts,
                    val: m.y,
                    key: m.key,
                    summary: m.summary,
                    from: m.from,
                    to: m.to,
                    op: m.op,
                    kind: kind,
                    color: color
                });
            });
        }
        collectMarkers(series.markers && series.markers.scope, "Объём работ", "#de350b");
        collectMarkers(series.markers && series.markers.done, "Завершенная работа", "#36b37e");

        // Draw Marker Dots
        markers.forEach(function(m) {
            ctx.beginPath();
            ctx.fillStyle = "#fff";
            ctx.strokeStyle = m.color;
            ctx.lineWidth = 2;
            ctx.arc(m.x, m.y, 4, 0, Math.PI*2);
            ctx.fill();
            ctx.stroke();
        });

        // Smart Labels
        drawSmartLabels(ctx, markers, {
            width: width,
            height: height,
            pad: pad,
            buildMarkerLabelData: opts.buildMarkerLabelData
        });
    }

    function drawSmartLabels(ctx, markers, layout) {
        var buildMarkerLabelData = layout && layout.buildMarkerLabelData;

        function fallbackLabelData(marker) {
            return {
                key: marker && marker.key ? String(marker.key) : "",
                summary: marker && marker.summary ? String(marker.summary) : "",
                kind: marker && marker.kind ? String(marker.kind) : "",
                delta: (marker && isFinite(marker.from) && isFinite(marker.to)) ? (marker.from + " → " + marker.to) : "",
                est: "",
                op: marker && marker.op ? String(marker.op) : ""
            };
        }

        // Sort by Y to process top-down (or by importance)
        markers.sort(function(a,b) { return a.y - b.y; });

        var labels = markers.map(function(m) {
            var data = buildMarkerLabelData ? buildMarkerLabelData(m) : fallbackLabelData(m);
            var lines = [
                data.key,
                data.summary,
                (data.kind && data.delta) ? (data.kind + ": " + data.delta) : "",
                data.est ? ("Оценка: " + data.est) : "",
                data.op
            ].filter(Boolean);

            return {
                m: m,
                lines: lines,
                h: Math.max(20, lines.length * 14 + 10),
                w: 160,
                x: layout.width - layout.pad.right + 20, // Right lane
                y: m.y // Initial Y
            };
        });

        // Collision Avoidance (Simple greedy)
        // Adjust Y positions to avoid overlap
        var gap = 4;
        var minY = layout.pad.top;
        var maxY = layout.height - layout.pad.bottom;

        // Multiple passes to relax positions
        for (var iter=0; iter<5; iter++) {
            // Sort by current Y
            labels.sort(function(a,b){ return a.y - b.y; });

            for (var i=0; i<labels.length-1; i++) {
                var curr = labels[i];
                var next = labels[i+1];
                var bottom = curr.y + curr.h/2;
                var top = next.y - next.h/2;

                if (bottom + gap > top) {
                    var overlap = (bottom + gap) - top;
                    // Move apart
                    curr.y -= overlap / 2;
                    next.y += overlap / 2;
                }
            }

            // Clamp
            labels.forEach(function(l) {
                var half = l.h/2;
                if (l.y - half < minY) l.y = minY + half;
                if (l.y + half > maxY) l.y = maxY - half;
            });
        }

        // Draw
        ctx.font = "10px -apple-system, sans-serif";
        ctx.textBaseline = "top";

        labels.forEach(function(l) {
            var half = l.h/2;
            var left = l.x;
            var top = l.y - half;

            // Connector line
            ctx.beginPath();
            ctx.strokeStyle = "#b3bac5";
            ctx.lineWidth = 1;
            ctx.setLineDash([2, 2]);
            ctx.moveTo(l.m.x + 6, l.m.y); // from dot
            ctx.lineTo(left - 10, l.m.y); // horizontal
            ctx.lineTo(left - 5, l.y);    // to label
            ctx.stroke();
            ctx.setLineDash([]);

            // Bubble background
            ctx.fillStyle = "#fff";
            ctx.strokeStyle = "#dfe1e6";
            ctx.lineWidth = 1;
            // Round rect
            var r = 4;
            ctx.beginPath();
            ctx.moveTo(left + r, top);
            ctx.lineTo(left + l.w - r, top);
            ctx.quadraticCurveTo(left + l.w, top, left + l.w, top + r);
            ctx.lineTo(left + l.w, top + l.h - r);
            ctx.quadraticCurveTo(left + l.w, top + l.h, left + l.w - r, top + l.h);
            ctx.lineTo(left + r, top + l.h);
            ctx.quadraticCurveTo(left, top + l.h, left, top + l.h - r);
            ctx.lineTo(left, top + r);
            ctx.quadraticCurveTo(left, top, left + r, top);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();

            // Text
            var curY = top + 6;
            var padX = left + 8;
            l.lines.forEach(function(line, idx) {
                if (idx === 0) { // Key
                    ctx.fillStyle = "#172b4d";
                    ctx.font = "bold 10px -apple-system, sans-serif";
                } else if (idx === 1) { // Summary
                    ctx.fillStyle = "#5e6c84";
                    ctx.font = "10px -apple-system, sans-serif";
                } else if (line.indexOf(":") > 0) { // Delta / Est
                     ctx.fillStyle = "#172b4d";
                     ctx.font = "10px -apple-system, sans-serif";
                     // Simple bolding of value part is hard in canvas, just draw normal
                } else { // Op
                    ctx.fillStyle = "#172b4d";
                    ctx.font = "italic 10px -apple-system, sans-serif";
                }
                ctx.fillText(line, padX, curY);
                curY += 14;
            });
        });
    }

    return {
        drawBurnupCanvas: drawBurnupCanvas,
        drawSmartLabels: drawSmartLabels
    };
});
