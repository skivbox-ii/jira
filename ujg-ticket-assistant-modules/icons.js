// Bounded Lucide 1.8.0 nodes copied from importer icons, ISC; see docs/licenses/lucide.txt.
define('_ujgTA_icons', [], function() {
    'use strict';
    var nodes = {
        ChevronDown: [['path', {d: 'm6 9 6 6 6-6'}]],
        X: [['path', {d: 'M18 6 6 18'}], ['path', {d: 'm6 6 12 12'}]],
        Check: [['path', {d: 'M20 6 9 17l-5-5'}]],
        RefreshCw: [['path', {d: 'M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8'}], ['path', {d: 'M21 3v5h-5'}], ['path', {d: 'M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16'}], ['path', {d: 'M8 16H3v5'}]],
        Square: [['rect', {width: '18', height: '18', x: '3', y: '3', rx: '2'}]],
        ExternalLink: [['path', {d: 'M15 3h6v6'}], ['path', {d: 'M10 14 21 3'}], ['path', {d: 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6'}]],
        WandSparkles: [['path', {d: 'm21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72'}], ['path', {d: 'm14 7 3 3'}], ['path', {d: 'M5 6v4'}], ['path', {d: 'M19 14v4'}], ['path', {d: 'M10 2v2'}], ['path', {d: 'M7 8H3'}], ['path', {d: 'M21 16h-4'}], ['path', {d: 'M11 3H9'}]]
    };
    return function(name) {
        var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        var attrs = {viewBox: '0 0 24 24', width: '16', height: '16', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.7', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false'};
        Object.keys(attrs).forEach(function(key) { svg.setAttribute(key, attrs[key]); });
        (nodes[name] || nodes.Check).forEach(function(item) {
            var el = document.createElementNS('http://www.w3.org/2000/svg', item[0]);
            Object.keys(item[1]).forEach(function(key) { el.setAttribute(key, item[1][key]); }); svg.appendChild(el);
        });
        return svg;
    };
});
