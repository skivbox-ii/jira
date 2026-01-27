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
        
        // Динамический расчёт правого отступа под метки
        // Считаем сколько маркеров будет
        var sScope = series.scope || [];
        var sComp = series.completed || [];
        var markerCount = 0;
        if (series.markers) {
            markerCount = (series.markers.scope ? series.markers.scope.length : 0) +
                         (series.markers.done ? series.markers.done.length : 0);
        }
        
        // Параметры меток
        var LABEL_HEIGHT = 18;
        var LABEL_GAP = 2;
        var LABEL_WIDTH = 180;
        var COL_GAP = 8;
        var plotHeight = height - 40 - 60; // top + bottom
        var labelsPerCol = Math.floor(plotHeight / (LABEL_HEIGHT + LABEL_GAP)) || 1;
        var numCols = Math.min(5, Math.ceil(markerCount / labelsPerCol));
        if (numCols < 1) numCols = 1;
        
        // Правый отступ: колонки × (ширина + отступ) + margin
        var rightPad = Math.max(260, numCols * (LABEL_WIDTH + COL_GAP) + 30);
        
        var pad = { top: 40, right: rightPad, bottom: 60, left: 60 };

        // Clear
        ctx.clearRect(0, 0, width, height);

        // Data Prep (sScope и sComp уже инициализированы выше для расчёта pad)
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

    /**
     * Умное размещение меток для 100+ карточек
     * - Многоколоночная лестничная раскладка
     * - Bezier-линии связи без пересечений
     * - Компактные метки с группировкой
     */
    function drawSmartLabels(ctx, markers, layout) {
        if (!markers || !markers.length) return;
        
        var buildMarkerLabelData = layout && layout.buildMarkerLabelData;
        var pad = layout.pad;
        var plotRight = layout.width - pad.right;
        var plotTop = pad.top;
        var plotBottom = layout.height - pad.bottom;
        var plotHeight = plotBottom - plotTop;
        
        // Параметры компактных меток
        var LABEL_HEIGHT = 18;       // Высота одной метки
        var LABEL_GAP = 2;           // Отступ между метками
        var LABEL_WIDTH = 180;       // Ширина метки
        var COL_GAP = 8;             // Отступ между колонками
        var MARGIN_LEFT = 15;        // Отступ от графика до первой колонки
        
        // Вычисляем сколько меток помещается в одну колонку
        var labelsPerColumn = Math.floor(plotHeight / (LABEL_HEIGHT + LABEL_GAP));
        if (labelsPerColumn < 1) labelsPerColumn = 1;
        
        // Сколько колонок нужно
        var numCols = Math.ceil(markers.length / labelsPerColumn);
        if (numCols < 1) numCols = 1;
        if (numCols > 5) numCols = 5; // Максимум 5 колонок
        
        // Подготовка данных меток
        function fallbackLabelData(marker) {
            return {
                key: marker && marker.key ? String(marker.key) : "",
                summary: marker && marker.summary ? String(marker.summary) : "",
                kind: marker && marker.kind ? String(marker.kind) : "",
                delta: (marker && isFinite(marker.from) && isFinite(marker.to)) 
                    ? (marker.from + "→" + marker.to) : "",
                op: marker && marker.op ? String(marker.op) : ""
            };
        }
        
        // Сортируем маркеры по Y (сверху вниз)
        var sortedMarkers = markers.slice().sort(function(a, b) { return a.y - b.y; });
        
        // Создаём метки с информацией о позиции
        var labels = sortedMarkers.map(function(m, idx) {
            var data = buildMarkerLabelData ? buildMarkerLabelData(m) : fallbackLabelData(m);
            
            // Компактный текст: KEY + короткий summary
            var summary = data.summary || "";
            if (summary.length > 25) summary = summary.substring(0, 22) + "…";
            
            var text = data.key;
            if (summary) text += " " + summary;
            
            // Определяем колонку и позицию в колонке
            var col = Math.floor(idx / labelsPerColumn);
            var row = idx % labelsPerColumn;
            
            // Позиция метки
            var labelX = plotRight + MARGIN_LEFT + col * (LABEL_WIDTH + COL_GAP);
            var labelY = plotTop + row * (LABEL_HEIGHT + LABEL_GAP);
            
            return {
                m: m,
                text: text,
                data: data,
                col: col,
                row: row,
                x: labelX,
                y: labelY,
                w: LABEL_WIDTH,
                h: LABEL_HEIGHT
            };
        });
        
        // Рисуем линии связи (bezier curves)
        // Сначала все линии, потом все метки (чтобы метки были поверх линий)
        ctx.save();
        
        // Линии связи с bezier для красивых изгибов
        labels.forEach(function(l, idx) {
            var startX = l.m.x;
            var startY = l.m.y;
            var endX = l.x;
            var endY = l.y + l.h / 2;
            
            // Промежуточные точки для плавной кривой
            var midX = plotRight + MARGIN_LEFT / 2;
            
            ctx.beginPath();
            ctx.strokeStyle = l.m.color || "#b3bac5";
            ctx.globalAlpha = 0.4;
            ctx.lineWidth = 1;
            
            // Bezier curve: от точки → вправо → к метке
            ctx.moveTo(startX, startY);
            
            // Контрольные точки для плавного изгиба
            var cp1x = startX + (midX - startX) * 0.7;
            var cp1y = startY;
            var cp2x = midX + (endX - midX) * 0.3;
            var cp2y = endY;
            
            ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, endX, endY);
            ctx.stroke();
        });
        
        ctx.globalAlpha = 1.0;
        
        // Рисуем метки (карточки)
        ctx.font = "11px -apple-system, BlinkMacSystemFont, sans-serif";
        ctx.textBaseline = "middle";
        
        labels.forEach(function(l) {
            var x = l.x;
            var y = l.y;
            var w = l.w;
            var h = l.h;
            var r = 3; // border-radius
            
            // Фон карточки с тенью
            ctx.shadowColor = "rgba(0,0,0,0.1)";
            ctx.shadowBlur = 2;
            ctx.shadowOffsetX = 1;
            ctx.shadowOffsetY = 1;
            
            // Rounded rectangle
            ctx.beginPath();
            ctx.moveTo(x + r, y);
            ctx.lineTo(x + w - r, y);
            ctx.quadraticCurveTo(x + w, y, x + w, y + r);
            ctx.lineTo(x + w, y + h - r);
            ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
            ctx.lineTo(x + r, y + h);
            ctx.quadraticCurveTo(x, y + h, x, y + h - r);
            ctx.lineTo(x, y + r);
            ctx.quadraticCurveTo(x, y, x + r, y);
            ctx.closePath();
            
            ctx.fillStyle = "#ffffff";
            ctx.fill();
            
            // Цветная полоска слева (индикатор типа: scope/done)
            ctx.shadowColor = "transparent";
            ctx.fillStyle = l.m.color || "#5e6c84";
            ctx.fillRect(x, y + 2, 3, h - 4);
            
            // Рамка
            ctx.strokeStyle = "#dfe1e6";
            ctx.lineWidth = 1;
            ctx.stroke();
            
            // Текст
            ctx.shadowColor = "transparent";
            
            // KEY (bold)
            var textX = x + 8;
            var textY = y + h / 2;
            
            var keyText = l.data.key || "";
            var summaryText = l.data.summary || "";
            if (summaryText.length > 20) summaryText = summaryText.substring(0, 17) + "…";
            
            // Рисуем key
            ctx.font = "bold 10px -apple-system, sans-serif";
            ctx.fillStyle = "#172b4d";
            ctx.fillText(keyText, textX, textY);
            
            // Рисуем summary рядом
            if (summaryText) {
                var keyWidth = ctx.measureText(keyText).width;
                ctx.font = "10px -apple-system, sans-serif";
                ctx.fillStyle = "#5e6c84";
                
                // Обрезаем summary если не помещается
                var maxSummaryWidth = w - keyWidth - 18;
                var actualSummary = summaryText;
                while (ctx.measureText(actualSummary).width > maxSummaryWidth && actualSummary.length > 3) {
                    actualSummary = actualSummary.substring(0, actualSummary.length - 4) + "…";
                }
                
                ctx.fillText(actualSummary, textX + keyWidth + 5, textY);
            }
        });
        
        ctx.restore();
    }

    return {
        drawBurnupCanvas: drawBurnupCanvas,
        drawSmartLabels: drawSmartLabels
    };
});
