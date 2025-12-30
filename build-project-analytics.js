#!/usr/bin/env node
/**
 * Скрипт сборки ujg-project-analytics.js из модулей
 * Использование: node build-project-analytics.js
 */

var fs = require('fs');
var path = require('path');

var MODULES_DIR = path.join(__dirname, 'ujg-project-analytics-modules');
var OUTPUT_FILE = path.join(__dirname, 'ujg-project-analytics.js');

// Порядок загрузки модулей (важен для зависимостей)
var MODULE_ORDER = [
    'config.js',
    'utils.js',
    'storage.js',
    'workflow.js',
    'api-tracker.js',
    'progress-modal.js',
    'settings-modal.js',
    'data-collection.js',
    'basic-analytics.js',
    'dev-cycle.js',
    'developer-analytics.js',
    'bottlenecks.js',
    'risk-assessment.js',
    'team-metrics.js',
    'velocity.js',
    'rendering.js',
    'main.js'
];

function readModule(fileName) {
    var filePath = path.join(MODULES_DIR, fileName);
    if (!fs.existsSync(filePath)) {
        console.warn('Warning: Module not found:', fileName);
        return '';
    }
    return fs.readFileSync(filePath, 'utf8');
}

function extractModuleBody(content, moduleName) {
    // Ищем паттерн: define("...", [...], function(...) { ... return {...}; });
    var match = content.match(/define\([^)]+,\s*function\s*\([^)]*\)\s*\{([\s\S]*)\}\s*\)\s*;?\s*$/);
    if (!match) return { body: null, returnValue: null };
    
    var fullBody = match[1];
    // Удаляем "use strict" если есть
    fullBody = fullBody.replace(/^\s*"use strict";\s*/m, '');
    
    // Ищем последний return на верхнем уровне модуля
    // Ищем return, который находится ПОСЛЕ закрывающей скобки функции и пустой строки
    var lines = fullBody.split('\n');
    var returnLineIndex = -1;
    
    // Находим все закрывающие скобки функций на верхнем уровне (4 пробела отступа)
    var functionCloses = [];
    var braceDepth = 0;
    for (var i = 0; i < lines.length; i++) {
        var line = lines[i];
        var openBraces = (line.match(/\{/g) || []).length;
        var closeBraces = (line.match(/\}/g) || []).length;
        braceDepth += (openBraces - closeBraces);
        
        // Закрывающая скобка функции на верхнем уровне (4 пробела)
        if (line.match(/^    \}\s*$/) && braceDepth === 0) {
            // Проверяем, что перед ней есть function
            for (var j = i - 1; j >= Math.max(0, i - 50); j--) {
                if (lines[j].match(/^\s*function\s+[a-zA-Z_$][a-zA-Z0-9_$]*\s*\(/)) {
                    functionCloses.push(i);
                    break;
                }
            }
        }
    }
    
    // Ищем return ПОСЛЕ последней закрывающей скобки функции и пустой строки
    if (functionCloses.length > 0) {
        var lastFunctionClose = functionCloses[functionCloses.length - 1];
        // Ищем пустую строку после закрывающей скобки
        var emptyLineAfter = -1;
        for (var i = lastFunctionClose + 1; i < lines.length; i++) {
            if (lines[i].match(/^\s*$/)) {
                emptyLineAfter = i;
                break;
            }
        }
        
        // Ищем return после пустой строки
        var searchStart = emptyLineAfter >= 0 ? emptyLineAfter + 1 : lastFunctionClose + 1;
        for (var i = searchStart; i < lines.length; i++) {
            var line = lines[i];
            // return с отступом 4 пробела после функции и пустой строки - это return модуля
            if (line.match(/^    return\s+/)) {
                returnLineIndex = i;
                break;
            }
        }
    }
    
    // Если не нашли, используем простой подход - последний return с отступом 4 пробела в последних 3 строках
    if (returnLineIndex === -1) {
        for (var i = lines.length - 1; i >= Math.max(0, lines.length - 3); i--) {
            var line = lines[i];
            if (line.match(/^    return\s+/)) {
                returnLineIndex = i;
                break;
            }
        }
    }
    
    var returnValue = null;
    var body = fullBody;
    
    if (returnLineIndex >= 0) {
        // Извлекаем return value - может быть многострочным
        var returnLines = lines.slice(returnLineIndex);
        var returnText = returnLines.join('\n');
        
        // Ищем return с объектом
        var returnMatch = returnText.match(/return\s+(\{[\s\S]*?\})\s*;\s*$/);
        if (!returnMatch) {
            // Попробуем без точки с запятой
            returnMatch = returnText.match(/return\s+(\{[\s\S]*?\})\s*$/);
        }
        if (!returnMatch) {
            // Попробуем просто return что-то
            returnMatch = returnText.match(/return\s+([^;]+)\s*;\s*$/);
        }
        
        if (returnMatch) {
            returnValue = returnMatch[1];
            // Удаляем все строки начиная с return
            body = lines.slice(0, returnLineIndex).join('\n');
        }
    }
    
    return {
        body: body.trim(),
        returnValue: returnValue
    };
}

function build() {
    console.log('Building ujg-project-analytics.js from modules...');
    
    var header = [
        '// Auto-generated file - DO NOT EDIT MANUALLY',
        '// Generated by build-project-analytics.js',
        '// To modify, edit files in ujg-project-analytics-modules/ and rebuild',
        '',
        'define("_ujgProjectAnalytics", ["jquery", "_ujgCommon"], function($, Common) {',
        '    "use strict";',
        '    ',
        '    if (typeof $ === "undefined" || !$) {',
        '        console.error("[UJG-ProjectAnalytics] jQuery is not loaded!");',
        '        return function() { console.error("jQuery required"); };',
        '    }',
        '    ',
        '    if (!Common || !Common.utils) {',
        '        console.error("[UJG-ProjectAnalytics] _ujgCommon is not loaded!");',
        '        return function() { console.error("_ujgCommon required"); };',
        '    }',
        '    ',
        '    var utils = Common.utils;',
        '    var baseUrl = Common.baseUrl || "";',
        ''
    ].join('\n');
    
    var footer = [
        '',
        '    return MyGadget;',
        '});'
    ].join('\n');
    
    var modulesContent = [];
    var moduleVars = {
        'config.js': 'config',
        'utils.js': 'utils',
        'storage.js': 'storage',
        'workflow.js': 'workflow',
        'api-tracker.js': 'apiTracker',
        'progress-modal.js': 'progressModal',
        'settings-modal.js': 'settingsModal',
        'data-collection.js': 'dataCollection',
        'basic-analytics.js': 'basicAnalytics',
        'dev-cycle.js': 'devCycle',
        'developer-analytics.js': 'developerAnalytics',
        'bottlenecks.js': 'bottlenecks',
        'risk-assessment.js': 'riskAssessment',
        'team-metrics.js': 'teamMetrics',
        'velocity.js': 'velocity',
        'rendering.js': 'rendering',
        'main.js': null // main.js не создает переменную, он возвращает MyGadget
    };
    
    // Читаем все модули в правильном порядке
    MODULE_ORDER.forEach(function(fileName) {
        var content = readModule(fileName);
        if (content) {
            var extracted = extractModuleBody(content, fileName);
            if (extracted.body !== null) {
                modulesContent.push('    // === Module: ' + fileName + ' ===');
                
                // Удаляем дублирующиеся объявления переменных, которые уже есть в header
                var cleanedBody = extracted.body;
                cleanedBody = cleanedBody.replace(/^\s*var\s+utils\s*=\s*Common\.utils\s*;\s*$/gm, '');
                cleanedBody = cleanedBody.replace(/^\s*var\s+baseUrl\s*=\s*Common\.baseUrl\s*\|\|\s*""\s*;\s*$/gm, '');
                
                // Убеждаемся, что первая строка имеет правильный отступ (4 пробела)
                var lines = cleanedBody.split('\n');
                if (lines.length > 0 && lines[0].trim() && !lines[0].match(/^\s{4}/)) {
                    // Если первая строка не имеет отступа 4 пробела, добавляем его
                    lines[0] = '    ' + lines[0].trimLeft();
                    cleanedBody = lines.join('\n');
                }
                
                // Удаляем return из функций, которые находятся перед return модуля
                // Но сохраняем return внутри функций - они нужны для работы
                // Ищем последний return с отступом 4 пробела (return модуля)
                var lines = cleanedBody.split('\n');
                var moduleReturnIndex = -1;
                
                // Находим return модуля (с отступом 4 пробела в последних строках)
                for (var i = lines.length - 1; i >= Math.max(0, lines.length - 10); i--) {
                    var line = lines[i];
                    if (line.match(/^    return\s+/)) {
                        moduleReturnIndex = i;
                        break;
                    }
                }
                
                // Если нашли return модуля, удаляем все return с большим отступом после последней функции
                if (moduleReturnIndex >= 0) {
                    var cleanedLines = [];
                    var lastFunctionEnd = -1;
                    var braceDepth = 0;
                    
                    // Находим последнюю закрывающую скобку функции на верхнем уровне
                    for (var i = 0; i < moduleReturnIndex; i++) {
                        var line = lines[i];
                        var openBraces = (line.match(/\{/g) || []).length;
                        var closeBraces = (line.match(/\}/g) || []).length;
                        braceDepth += (openBraces - closeBraces);
                        
                        if (line.match(/^    \}\s*$/) && braceDepth === 0) {
                            lastFunctionEnd = i;
                        }
                    }
                    
                    // Удаляем return из функции createDataCollector, если он находится перед return модуля
                    for (var i = 0; i < lines.length; i++) {
                        var line = lines[i];
                        var indent = line.match(/^(\s*)/)[1].length;
                        
                        // Если это return с отступом 8 пробелов и он находится после последней функции, но перед return модуля
                        if (line.match(/^        return\s+/) && i > lastFunctionEnd && i < moduleReturnIndex) {
                            // Пропускаем этот return и следующие строки до закрывающей скобки объекта
                            var returnStart = i;
                            var foundClose = false;
                            for (var j = i + 1; j < moduleReturnIndex; j++) {
                                if (lines[j].match(/^        \}\s*;\s*$/)) {
                                    i = j;
                                    foundClose = true;
                                    break;
                                }
                            }
                            if (foundClose) continue;
                        }
                        
                        cleanedLines.push(line);
                    }
                    
                    cleanedBody = cleanedLines.join('\n');
                }
                
                // Если модуль возвращает значение, создаем переменную
                if (extracted.returnValue && moduleVars[fileName]) {
                    var varName = moduleVars[fileName];
                    modulesContent.push(cleanedBody);
                    modulesContent.push('    var ' + varName + ' = ' + extracted.returnValue + ';');
                } else if (fileName === 'main.js') {
                    // main.js возвращает MyGadget напрямую
                    // Удаляем return MyGadget из body, так как он будет в footer
                    cleanedBody = cleanedBody.replace(/\s*return\s+MyGadget\s*;\s*$/m, '');
                    modulesContent.push(cleanedBody);
                    // Не добавляем return здесь, он будет в footer
                } else {
                    // Модуль без return или без переменной
                    modulesContent.push(cleanedBody);
                }
                
                modulesContent.push('');
            } else {
                // Если не AMD модуль, просто добавляем содержимое
                modulesContent.push('    // === Module: ' + fileName + ' ===');
                modulesContent.push(content.trim());
                modulesContent.push('');
            }
        }
    });
    
    var fullContent = header + modulesContent.join('\n') + footer;
    
    // Записываем результат
    fs.writeFileSync(OUTPUT_FILE, fullContent, 'utf8');
    
    console.log('✓ Built successfully:', OUTPUT_FILE);
    console.log('  Total size:', (fullContent.length / 1024).toFixed(2), 'KB');
    console.log('  Modules processed:', MODULE_ORDER.filter(function(f) {
        return fs.existsSync(path.join(MODULES_DIR, f));
    }).length);
}

// Запускаем сборку
if (require.main === module) {
    build();
}

module.exports = { build: build };
