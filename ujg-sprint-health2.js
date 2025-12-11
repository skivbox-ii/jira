/**
 * UJG Sprint Health Dashboard v2.0
 * Полный дашборд здоровья спринта для Jira
 * 
 * Метрики:
 * - Capacity (заполненность спринта)
 * - Estimation (оценка задач)
 * - Due Dates (сроки)
 * - Assignees (исполнители)
 * - Priorities (приоритеты)
 * - Issue Types (типы задач)
 * - Scope Change (изменение объёма)
 * - Aging WIP (застрявшие задачи)
 * 
 * Графики:
 * - Burndown Chart (кривая сгорания)
 * - Burnup Chart (диаграмма накопления)
 * - CFD (Cumulative Flow Diagram)
 * - Velocity Chart (сравнение спринтов)
 * - Cycle Time Distribution (распределение времени)
 */

define('_ujgSprintHealth', ['jquery', 'wrm/context-path'], function($, contextPath) {
    'use strict';

    // ============================================
    // CONFIGURATION
    // ============================================
    
    const CONFIG = {
        version: '2.0.1',
        // Пороги для метрик
        thresholds: {
            largeTask: 16,           // часов - слишком большая задача
            capacityWarning: 90,     // % - предупреждение о заполненности
            capacityDanger: 100,     // % - перегрузка
            agingWarningDays: 3,     // дней в In Progress для предупреждения
            agingDangerDays: 5,      // дней в In Progress для опасности
            scopeChangeWarning: 20,  // % изменения scope
            oldTaskDays: 30,         // дней - старая задача
            highPriorityLimit: 40    // % - много высокоприоритетных задач
        },
        
        // Статусы для CFD (настроить под ваш workflow)
        statusCategories: {
            'To Do': ['To Do', 'Open', 'Backlog', 'New'],
            'In Progress': ['In Progress', 'In Development', 'Development'],
            'In Review': ['In Review', 'Code Review', 'Review', 'Testing', 'QA'],
            'Done': ['Done', 'Closed', 'Resolved', 'Complete']
        },
        
        // Цвета для графиков
        colors: {
            primary: '#0052CC',
            success: '#36B37E',
            warning: '#FFAB00',
            danger: '#FF5630',
            info: '#00B8D9',
            purple: '#6554C0',
            teal: '#00875A',
            
            // Для CFD
            toDo: '#DFE1E6',
            inProgress: '#0052CC',
            inReview: '#FFAB00',
            done: '#36B37E',
            
            // Для приоритетов
            critical: '#FF5630',
            high: '#FF8B00',
            medium: '#FFAB00',
            low: '#36B37E',
            
            // Для типов задач
            story: '#36B37E',
            bug: '#FF5630',
            task: '#0052CC',
            subtask: '#6554C0'
        },
        
        // Capacity по умолчанию (часов на человека в спринт)
        defaultCapacityPerPerson: 40,
        
        // Количество спринтов для Velocity
        velocitySprintsCount: 5
    };

    // ============================================
    // UTILITY FUNCTIONS
    // ============================================
    
    function formatHours(seconds) {
        if (!seconds) return '0ч';
        const hours = Math.round(seconds / 3600);
        return hours + 'ч';
    }
    
    function formatDate(dateStr) {
        if (!dateStr) return '-';
        const date = new Date(dateStr);
        return date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
    }
    
    function daysBetween(date1, date2) {
        const oneDay = 24 * 60 * 60 * 1000;
        return Math.round(Math.abs((date2 - date1) / oneDay));
    }
    
    function getStatusCategory(status) {
        for (const [category, statuses] of Object.entries(CONFIG.statusCategories)) {
            if (statuses.some(s => s.toLowerCase() === status.toLowerCase())) {
                return category;
            }
        }
        return 'To Do';
    }
    
    function getHealthColor(percent) {
        if (percent >= 80) return CONFIG.colors.success;
        if (percent >= 60) return CONFIG.colors.warning;
        return CONFIG.colors.danger;
    }
    
    function getHealthLabel(percent) {
        if (percent >= 90) return 'Отлично';
        if (percent >= 80) return 'Хорошо';
        if (percent >= 60) return 'Есть замечания';
        if (percent >= 40) return 'Требует внимания';
        return 'Критично';
    }

    // ============================================
    // API FUNCTIONS (НЕ ИЗМЕНЯТЬ)
    // ============================================
    
    // Безопасный контекст-путь: если wrm/context-path недоступен, пытаемся взять глобальный contextPath/AJS
    function getContextPath() {
        try {
            if (typeof contextPath === 'function') return contextPath() || '';
            if (typeof contextPath === 'string' && contextPath) return contextPath;
            if (typeof window !== 'undefined' && typeof window.contextPath === 'string' && window.contextPath) return window.contextPath;
            if (typeof AJS !== 'undefined' && typeof AJS.contextPath === 'function') return AJS.contextPath() || '';
        } catch (e) {
            // ignore
        }
        return '';
    }
    
    function apiRequest(endpoint) {
        return $.ajax({
            url: getContextPath() + '/rest/api/2/' + endpoint,
            type: 'GET',
            dataType: 'json',
            headers: {
                'Content-Type': 'application/json'
            }
        });
    }

    // Agile API (нужен для досок/спринтов)
    function apiAgileRequest(endpoint) {
        return $.ajax({
            url: getContextPath() + '/rest/agile/1.0/' + endpoint,
            type: 'GET',
            dataType: 'json',
            headers: {
                'Content-Type': 'application/json'
            }
        });
    }
    
    function getBoards() {
        return apiAgileRequest('board?maxResults=100');
    }
    
    function getSprints(boardId) {
        return apiAgileRequest('board/' + boardId + '/sprint?state=active,closed&maxResults=50');
    }

    // Получить все спринты борда (активные, будущие, закрытые) с пагинацией — как в v1
    function getAllSprints(boardId) {
        const d = $.Deferred();
        let all = [];
        function load(startAt) {
            apiAgileRequest('board/' + boardId + '/sprint?state=active,future,closed&maxResults=100&startAt=' + startAt)
                .then(function(data) {
                    all = all.concat(data.values || []);
                    if (data.isLast === false && data.values && data.values.length > 0) {
                        load(startAt + data.values.length);
                    } else {
                        d.resolve(all);
                    }
                })
                .fail(function(err) {
                    d.reject(err);
                });
        }
        load(0);
        return d.promise();
    }
    
    function getSprintIssues(sprintId) {
        const fields = 'summary,status,assignee,priority,issuetype,timeoriginalestimate,timespent,timeestimate,duedate,created,updated,description,labels,resolution,resolutiondate';
        return apiAgileRequest('sprint/' + sprintId + '/issue?fields=' + fields + '&maxResults=500');
    }
    
    function getSprintDetails(sprintId) {
        return apiAgileRequest('sprint/' + sprintId);
    }

    // ============================================
    // DATA PROCESSING
    // ============================================
    
    function processSprintData(issues, sprint) {
        const data = {
            issues: [],
            metrics: {},
            problems: [],
            assignees: {},
            priorities: {},
            issueTypes: {},
            statusFlow: {},
            dailyData: []
        };
        
        const today = new Date();
        const sprintStart = sprint.startDate ? new Date(sprint.startDate) : today;
        const sprintEnd = sprint.endDate ? new Date(sprint.endDate) : today;
        const sprintDays = daysBetween(sprintStart, sprintEnd) || 14;
        
        let totalEstimate = 0;
        let totalSpent = 0;
        let estimatedCount = 0;
        let withDueDate = 0;
        let withAssignee = 0;
        let withDescription = 0;
        let withPriority = 0;
        let doneCount = 0;
        let doneHours = 0;
        
        issues.forEach(issue => {
            const fields = issue.fields || {};
            const status = fields.status?.name || 'Unknown';
            const statusCategory = getStatusCategory(status);
            const assignee = fields.assignee?.displayName || 'Не назначен';
            const assigneeKey = fields.assignee?.key || 'unassigned';
            const priority = fields.priority?.name || 'Без приоритета';
            const issueType = fields.issuetype?.name || 'Task';
            const estimate = fields.timeoriginalestimate || 0;
            const spent = fields.timespent || 0;
            const remaining = fields.timeestimate || 0;
            const dueDate = fields.duedate;
            const created = fields.created ? new Date(fields.created) : null;
            const updated = fields.updated ? new Date(fields.updated) : null;
            const resolved = fields.resolutiondate ? new Date(fields.resolutiondate) : null;
            const description = fields.description || '';
            
            // Базовые подсчёты
            totalEstimate += estimate;
            totalSpent += spent;
            
            if (estimate > 0) estimatedCount++;
            if (dueDate) withDueDate++;
            if (fields.assignee) withAssignee++;
            if (description.trim().length > 0) withDescription++;
            if (fields.priority) withPriority++;
            
            if (statusCategory === 'Done') {
                doneCount++;
                doneHours += estimate;
            }
            
            // Assignee stats
            if (!data.assignees[assigneeKey]) {
                data.assignees[assigneeKey] = {
                    name: assignee,
                    estimate: 0,
                    spent: 0,
                    remaining: 0,
                    tasks: 0,
                    done: 0,
                    capacity: CONFIG.defaultCapacityPerPerson
                };
            }
            data.assignees[assigneeKey].estimate += estimate;
            data.assignees[assigneeKey].spent += spent;
            data.assignees[assigneeKey].remaining += remaining;
            data.assignees[assigneeKey].tasks++;
            if (statusCategory === 'Done') data.assignees[assigneeKey].done++;
            
            // Priority stats
            if (!data.priorities[priority]) {
                data.priorities[priority] = { count: 0, hours: 0 };
            }
            data.priorities[priority].count++;
            data.priorities[priority].hours += estimate;
            
            // Issue type stats
            if (!data.issueTypes[issueType]) {
                data.issueTypes[issueType] = { count: 0, hours: 0 };
            }
            data.issueTypes[issueType].count++;
            data.issueTypes[issueType].hours += estimate;
            
            // Status flow
            if (!data.statusFlow[statusCategory]) {
                data.statusFlow[statusCategory] = { count: 0, hours: 0 };
            }
            data.statusFlow[statusCategory].count++;
            data.statusFlow[statusCategory].hours += estimate;
            
            // Проблемы
            const issueData = {
                key: issue.key,
                summary: fields.summary,
                status: status,
                statusCategory: statusCategory,
                assignee: assignee,
                priority: priority,
                issueType: issueType,
                estimate: estimate,
                spent: spent,
                remaining: remaining,
                dueDate: dueDate,
                created: created,
                updated: updated,
                resolved: resolved,
                hasDescription: description.trim().length > 0
            };
            
            data.issues.push(issueData);
            
            // Проверка проблем
            if (estimate === 0) {
                data.problems.push({
                    key: issue.key,
                    type: 'no-estimate',
                    message: 'Нет оценки',
                    severity: priority === 'Critical' || priority === 'High' ? 'high' : 'medium'
                });
            }
            
            if (estimate > CONFIG.thresholds.largeTask * 3600) {
                data.problems.push({
                    key: issue.key,
                    type: 'large-task',
                    message: 'Слишком большая задача (' + formatHours(estimate) + ')',
                    severity: 'medium'
                });
            }
            
            if (!fields.assignee) {
                data.problems.push({
                    key: issue.key,
                    type: 'no-assignee',
                    message: 'Нет исполнителя',
                    severity: 'medium'
                });
            }
            
            if (!dueDate && statusCategory !== 'Done') {
                data.problems.push({
                    key: issue.key,
                    type: 'no-duedate',
                    message: 'Нет срока',
                    severity: 'low'
                });
            }
            
            if (dueDate && new Date(dueDate) < today && statusCategory !== 'Done') {
                data.problems.push({
                    key: issue.key,
                    type: 'overdue',
                    message: 'Просрочен (' + formatDate(dueDate) + ')',
                    severity: 'high'
                });
            }
            
            if (!description.trim()) {
                data.problems.push({
                    key: issue.key,
                    type: 'no-description',
                    message: 'Нет описания',
                    severity: 'low'
                });
            }
            
            if (!fields.priority) {
                data.problems.push({
                    key: issue.key,
                    type: 'no-priority',
                    message: 'Нет приоритета',
                    severity: 'low'
                });
            }
            
            // Aging WIP
            if (statusCategory === 'In Progress' && updated) {
                const daysInProgress = daysBetween(updated, today);
                if (daysInProgress >= CONFIG.thresholds.agingDangerDays) {
                    data.problems.push({
                        key: issue.key,
                        type: 'aging-danger',
                        message: 'В работе ' + daysInProgress + ' дней',
                        severity: 'high'
                    });
                } else if (daysInProgress >= CONFIG.thresholds.agingWarningDays) {
                    data.problems.push({
                        key: issue.key,
                        type: 'aging-warning',
                        message: 'В работе ' + daysInProgress + ' дней',
                        severity: 'medium'
                    });
                }
            }
            
            // Старые задачи
            if (created && statusCategory !== 'Done') {
                const age = daysBetween(created, today);
                if (age > CONFIG.thresholds.oldTaskDays) {
                    data.problems.push({
                        key: issue.key,
                        type: 'old-task',
                        message: 'Создана ' + age + ' дней назад',
                        severity: 'low'
                    });
                }
            }
        });
        
        const totalCount = issues.length;
        
        // Расчёт capacity команды
        const teamMembers = Object.keys(data.assignees).filter(k => k !== 'unassigned').length;
        const teamCapacity = teamMembers * CONFIG.defaultCapacityPerPerson * 3600;
        
        // Метрики
        data.metrics = {
            total: totalCount,
            totalEstimate: totalEstimate,
            totalSpent: totalSpent,
            
            // Capacity
            capacity: teamCapacity,
            capacityUsed: totalEstimate,
            capacityPercent: teamCapacity > 0 ? Math.round((totalEstimate / teamCapacity) * 100) : 0,
            
            // Estimation
            estimated: estimatedCount,
            estimatedPercent: totalCount > 0 ? Math.round((estimatedCount / totalCount) * 100) : 0,
            
            // Due dates
            withDueDate: withDueDate,
            dueDatePercent: totalCount > 0 ? Math.round((withDueDate / totalCount) * 100) : 0,
            
            // Assignees
            withAssignee: withAssignee,
            assigneePercent: totalCount > 0 ? Math.round((withAssignee / totalCount) * 100) : 0,
            
            // Description
            withDescription: withDescription,
            descriptionPercent: totalCount > 0 ? Math.round((withDescription / totalCount) * 100) : 0,
            
            // Priority
            withPriority: withPriority,
            priorityPercent: totalCount > 0 ? Math.round((withPriority / totalCount) * 100) : 0,
            
            // Progress
            done: doneCount,
            donePercent: totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0,
            doneHours: doneHours,
            doneHoursPercent: totalEstimate > 0 ? Math.round((doneHours / totalEstimate) * 100) : 0,
            
            // Sprint info
            sprintDays: sprintDays,
            sprintStart: sprintStart,
            sprintEnd: sprintEnd,
            daysRemaining: Math.max(0, daysBetween(today, sprintEnd)),
            daysElapsed: daysBetween(sprintStart, today)
        };
        
        // Health Score
        data.metrics.healthScore = calculateHealthScore(data.metrics, data.problems);
        
        // Генерация данных для графиков
        data.dailyData = generateDailyData(data, sprintStart, sprintEnd);
        
        return data;
    }
    
    function calculateHealthScore(metrics, problems) {
        let score = 100;
        
        // Оценки (-20 если нет)
        score -= (100 - metrics.estimatedPercent) * 0.25;
        
        // Сроки (-15 если нет)
        score -= (100 - metrics.dueDatePercent) * 0.15;
        
        // Исполнители (-15 если нет)
        score -= (100 - metrics.assigneePercent) * 0.15;
        
        // Описания (-10 если нет)
        score -= (100 - metrics.descriptionPercent) * 0.1;
        
        // Приоритеты (-5 если нет)
        score -= (100 - metrics.priorityPercent) * 0.05;
        
        // Перегрузка capacity
        if (metrics.capacityPercent > CONFIG.thresholds.capacityDanger) {
            score -= 10;
        } else if (metrics.capacityPercent > CONFIG.thresholds.capacityWarning) {
            score -= 5;
        }
        
        // Проблемы высокой серьёзности
        const highSeverity = problems.filter(p => p.severity === 'high').length;
        score -= highSeverity * 3;
        
        return Math.max(0, Math.min(100, Math.round(score)));
    }
    
    function generateDailyData(data, sprintStart, sprintEnd) {
        const dailyData = [];
        const totalDays = daysBetween(sprintStart, sprintEnd) || 14;
        const today = new Date();
        
        const totalTasks = data.metrics.total;
        const totalHours = data.metrics.totalEstimate / 3600;
        
        // Текущее состояние
        const currentDone = data.metrics.done;
        const currentDoneHours = data.metrics.doneHours / 3600;
        const currentToDo = data.statusFlow['To Do']?.count || 0;
        const currentInProgress = data.statusFlow['In Progress']?.count || 0;
        const currentInReview = data.statusFlow['In Review']?.count || 0;
        
        for (let i = 0; i <= totalDays; i++) {
            const date = new Date(sprintStart);
            date.setDate(date.getDate() + i);
            
            const dayProgress = i / totalDays;
            const isPast = date <= today;
            
            // Идеальные значения (линейное снижение)
            const idealRemainingTasks = Math.round(totalTasks * (1 - dayProgress));
            const idealRemainingHours = Math.round(totalHours * (1 - dayProgress));
            const idealDoneTasks = totalTasks - idealRemainingTasks;
            const idealDoneHours = totalHours - idealRemainingHours;
            
            // Фактические значения (симуляция на основе текущего прогресса)
            let actualRemainingTasks, actualRemainingHours, actualDoneTasks, actualDoneHours;
            let toDo, inProgress, inReview, done;
            
            if (isPast) {
                // Для прошлых дней - интерполяция от 0 до текущего значения
                const progressToToday = daysBetween(sprintStart, today);
                const dayRatio = progressToToday > 0 ? i / progressToToday : 1;
                
                actualDoneTasks = Math.round(currentDone * Math.min(1, dayRatio));
                actualDoneHours = Math.round(currentDoneHours * Math.min(1, dayRatio));
                actualRemainingTasks = totalTasks - actualDoneTasks;
                actualRemainingHours = totalHours - actualDoneHours;
                
                // CFD данные
                const remainingAfterDone = totalTasks - actualDoneTasks;
                done = actualDoneTasks;
                
                if (i === daysBetween(sprintStart, today)) {
                    // Сегодня - реальные данные
                    toDo = currentToDo;
                    inProgress = currentInProgress;
                    inReview = currentInReview;
                } else {
                    // Прошлые дни - приблизительное распределение
                    const remainingRatio = remainingAfterDone / totalTasks;
                    toDo = Math.round(currentToDo + (remainingAfterDone - currentToDo - currentInProgress - currentInReview) * (1 - dayRatio));
                    inProgress = Math.round(currentInProgress * dayRatio);
                    inReview = Math.round(currentInReview * dayRatio);
                }
            } else {
                // Для будущих дней - прогноз на основе текущей скорости
                actualRemainingTasks = null;
                actualRemainingHours = null;
                actualDoneTasks = null;
                actualDoneHours = null;
                toDo = null;
                inProgress = null;
                inReview = null;
                done = null;
            }
            
            dailyData.push({
                date: date,
                day: i,
                label: formatDate(date),
                isPast: isPast,
                
                // Burndown
                idealRemainingTasks: idealRemainingTasks,
                idealRemainingHours: idealRemainingHours,
                actualRemainingTasks: actualRemainingTasks,
                actualRemainingHours: actualRemainingHours,
                
                // Burnup
                idealDoneTasks: idealDoneTasks,
                idealDoneHours: idealDoneHours,
                actualDoneTasks: actualDoneTasks,
                actualDoneHours: actualDoneHours,
                scopeTasks: totalTasks,
                scopeHours: totalHours,
                
                // CFD
                toDo: toDo,
                inProgress: inProgress,
                inReview: inReview,
                done: done
            });
        }
        
        return dailyData;
    }

    // ============================================
    // RENDERING FUNCTIONS
    // ============================================
    
    function render($container, data, sprint, api) {
        $container.empty();
        
        const html = `
            <div class="ujg-sprint-health">
                <!-- Header -->
                <div class="ujg-header">
                    <div class="ujg-header-left">
                        <h2 class="ujg-title">Sprint Health: ${sprint.name}</h2>
                        <span class="ujg-subtitle">${formatDate(sprint.startDate)} - ${formatDate(sprint.endDate)}</span>
                    </div>
                    <div class="ujg-header-right">
                        <span class="ujg-version">v${CONFIG.version}</span>
                        <button class="ujg-btn ujg-btn-refresh" title="Обновить">🔄</button>
                        <button class="ujg-btn ujg-btn-fullscreen" title="На весь экран">⛶</button>
                    </div>
                </div>
                
                <!-- Health Score -->
                ${renderHealthScore(data.metrics)}
                
                <!-- Metric Cards -->
                ${renderMetricCards(data.metrics)}
                
                <!-- Charts Row 1: Burndown + Burnup -->
                <div class="ujg-charts-row">
                    <div class="ujg-chart-container ujg-chart-half">
                        <div class="ujg-chart-header">
                            <h3>Burndown Chart</h3>
                            <div class="ujg-chart-toggle">
                                <button class="ujg-toggle-btn active" data-chart="burndown" data-mode="hours">Часы</button>
                                <button class="ujg-toggle-btn" data-chart="burndown" data-mode="tasks">Задачи</button>
                            </div>
                        </div>
                        <div class="ujg-chart" id="burndown-chart"></div>
                    </div>
                    <div class="ujg-chart-container ujg-chart-half">
                        <div class="ujg-chart-header">
                            <h3>Burnup Chart</h3>
                            <div class="ujg-chart-toggle">
                                <button class="ujg-toggle-btn active" data-chart="burnup" data-mode="hours">Часы</button>
                                <button class="ujg-toggle-btn" data-chart="burnup" data-mode="tasks">Задачи</button>
                            </div>
                        </div>
                        <div class="ujg-chart" id="burnup-chart"></div>
                    </div>
                </div>
                
                <!-- Charts Row 2: CFD + Velocity -->
                <div class="ujg-charts-row">
                    <div class="ujg-chart-container ujg-chart-half">
                        <div class="ujg-chart-header">
                            <h3>Cumulative Flow Diagram</h3>
                        </div>
                        <div class="ujg-chart" id="cfd-chart"></div>
                        <div class="ujg-chart-legend" id="cfd-legend"></div>
                    </div>
                    <div class="ujg-chart-container ujg-chart-half">
                        <div class="ujg-chart-header">
                            <h3>Velocity</h3>
                        </div>
                        <div class="ujg-chart" id="velocity-chart"></div>
                    </div>
                </div>
                
                <!-- Charts Row 3: Priorities + Issue Types + Cycle Time -->
                <div class="ujg-charts-row ujg-charts-row-3">
                    <div class="ujg-chart-container ujg-chart-third">
                        <div class="ujg-chart-header">
                            <h3>Приоритеты</h3>
                        </div>
                        <div class="ujg-chart ujg-chart-small" id="priority-chart"></div>
                    </div>
                    <div class="ujg-chart-container ujg-chart-third">
                        <div class="ujg-chart-header">
                            <h3>Типы задач</h3>
                        </div>
                        <div class="ujg-chart ujg-chart-small" id="issuetype-chart"></div>
                    </div>
                    <div class="ujg-chart-container ujg-chart-third">
                        <div class="ujg-chart-header">
                            <h3>Scope Change</h3>
                        </div>
                        <div class="ujg-scope-change" id="scope-change"></div>
                    </div>
                </div>
                
                <!-- Workload Table -->
                ${renderWorkloadTable(data.assignees, data.metrics)}
                
                <!-- Aging WIP -->
                ${renderAgingWIP(data.issues, data.problems)}
                
                <!-- Problems Table -->
                ${renderProblemsTable(data.problems)}
            </div>
        `;
        
        $container.html(html);
        
        // Рендер графиков
        setTimeout(() => {
            renderBurndownChart($container, data, 'hours');
            renderBurnupChart($container, data, 'hours');
            renderCFDChart($container, data);
            renderVelocityChart($container, data, sprint);
            renderPriorityChart($container, data);
            renderIssueTypeChart($container, data);
            renderScopeChange($container, data);
            
            if (api && typeof api.resize === 'function') {
                api.resize();
            }
        }, 100);
        
        // Event handlers
        bindEvents($container, data);
    }
    
    function renderHealthScore(metrics) {
        const score = metrics.healthScore;
        const color = getHealthColor(score);
        const label = getHealthLabel(score);
        
        return `
            <div class="ujg-health-score">
                <div class="ujg-health-progress">
                    <div class="ujg-health-bar" style="width: ${score}%; background: ${color};"></div>
                </div>
                <div class="ujg-health-info">
                    <span class="ujg-health-value" style="color: ${color};">${score}%</span>
                    <span class="ujg-health-label">${label}</span>
                </div>
            </div>
        `;
    }
    
    function renderMetricCards(metrics) {
        const cards = [
            {
                icon: '📊',
                title: 'Capacity',
                value: formatHours(metrics.capacityUsed) + ' / ' + formatHours(metrics.capacity),
                percent: metrics.capacityPercent,
                status: metrics.capacityPercent > CONFIG.thresholds.capacityDanger ? 'danger' : 
                        metrics.capacityPercent > CONFIG.thresholds.capacityWarning ? 'warning' : 'success'
            },
            {
                icon: '📝',
                title: 'Оценки',
                value: metrics.estimated + ' / ' + metrics.total,
                percent: metrics.estimatedPercent,
                status: metrics.estimatedPercent === 100 ? 'success' : 
                        metrics.estimatedPercent >= 80 ? 'warning' : 'danger'
            },
            {
                icon: '📅',
                title: 'Сроки',
                value: metrics.withDueDate + ' / ' + metrics.total,
                percent: metrics.dueDatePercent,
                status: metrics.dueDatePercent === 100 ? 'success' : 
                        metrics.dueDatePercent >= 80 ? 'warning' : 'danger'
            },
            {
                icon: '👤',
                title: 'Исполнители',
                value: metrics.withAssignee + ' / ' + metrics.total,
                percent: metrics.assigneePercent,
                status: metrics.assigneePercent === 100 ? 'success' : 
                        metrics.assigneePercent >= 80 ? 'warning' : 'danger'
            },
            {
                icon: '📄',
                title: 'Описания',
                value: metrics.withDescription + ' / ' + metrics.total,
                percent: metrics.descriptionPercent,
                status: metrics.descriptionPercent === 100 ? 'success' : 
                        metrics.descriptionPercent >= 60 ? 'warning' : 'danger'
            },
            {
                icon: '⚡',
                title: 'Приоритеты',
                value: metrics.withPriority + ' / ' + metrics.total,
                percent: metrics.priorityPercent,
                status: metrics.priorityPercent === 100 ? 'success' : 'warning'
            },
            {
                icon: '✅',
                title: 'Прогресс (задачи)',
                value: metrics.done + ' / ' + metrics.total,
                percent: metrics.donePercent,
                status: 'info'
            },
            {
                icon: '⏱️',
                title: 'Прогресс (часы)',
                value: formatHours(metrics.doneHours) + ' / ' + formatHours(metrics.totalEstimate),
                percent: metrics.doneHoursPercent,
                status: 'info'
            }
        ];
        
        const statusColors = {
            success: CONFIG.colors.success,
            warning: CONFIG.colors.warning,
            danger: CONFIG.colors.danger,
            info: CONFIG.colors.info
        };
        
        return `
            <div class="ujg-metrics">
                ${cards.map(card => `
                    <div class="ujg-metric-card">
                        <div class="ujg-metric-icon">${card.icon}</div>
                        <div class="ujg-metric-content">
                            <div class="ujg-metric-title">${card.title}</div>
                            <div class="ujg-metric-value">${card.value}</div>
                            <div class="ujg-metric-progress">
                                <div class="ujg-metric-bar" style="width: ${Math.min(100, card.percent)}%; background: ${statusColors[card.status]};"></div>
                            </div>
                            <div class="ujg-metric-percent">${card.percent}%</div>
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
    }
    
    function renderWorkloadTable(assignees, metrics) {
        const rows = Object.entries(assignees)
            .sort((a, b) => b[1].estimate - a[1].estimate)
            .map(([key, data]) => {
                const loadPercent = data.capacity > 0 ? Math.round((data.estimate / (data.capacity * 3600)) * 100) : 0;
                const isOverloaded = loadPercent > 100;
                const progressPercent = data.estimate > 0 ? Math.round((data.spent / data.estimate) * 100) : 0;
                
                return `
                    <tr class="${isOverloaded ? 'ujg-row-danger' : ''}">
                        <td class="ujg-td-name">${data.name}</td>
                        <td class="ujg-td-center">${data.tasks}</td>
                        <td class="ujg-td-center">${data.done}</td>
                        <td class="ujg-td-right">${formatHours(data.estimate)}</td>
                        <td class="ujg-td-right">${formatHours(data.spent)}</td>
                        <td class="ujg-td-right">${formatHours(data.remaining)}</td>
                        <td class="ujg-td-center">${data.capacity}ч</td>
                        <td class="ujg-td-load">
                            <div class="ujg-load-bar">
                                <div class="ujg-load-fill ${isOverloaded ? 'overloaded' : ''}" style="width: ${Math.min(100, loadPercent)}%;"></div>
                            </div>
                            <span class="${isOverloaded ? 'ujg-text-danger' : ''}">${loadPercent}%</span>
                        </td>
                    </tr>
                `;
            });
        
        return `
            <div class="ujg-section">
                <h3 class="ujg-section-title">👥 Распределение по исполнителям</h3>
                <table class="ujg-table">
                    <thead>
                        <tr>
                            <th>Исполнитель</th>
                            <th>Задачи</th>
                            <th>Сделано</th>
                            <th>Оценка</th>
                            <th>Затрачено</th>
                            <th>Осталось</th>
                            <th>Capacity</th>
                            <th>Загрузка</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rows.join('')}
                    </tbody>
                </table>
            </div>
        `;
    }
    
    function renderAgingWIP(issues, problems) {
        const agingIssues = issues
            .filter(issue => issue.statusCategory === 'In Progress')
            .map(issue => {
                const problem = problems.find(p => p.key === issue.key && (p.type === 'aging-danger' || p.type === 'aging-warning'));
                return {
                    ...issue,
                    aging: problem ? problem.message : null,
                    severity: problem ? problem.severity : null
                };
            })
            .filter(issue => issue.aging)
            .sort((a, b) => (b.severity === 'high' ? 1 : 0) - (a.severity === 'high' ? 1 : 0));
        
        if (agingIssues.length === 0) {
            return '';
        }
        
        return `
            <div class="ujg-section">
                <h3 class="ujg-section-title">⏰ Aging WIP (застрявшие задачи)</h3>
                <div class="ujg-aging-list">
                    ${agingIssues.map(issue => `
                        <div class="ujg-aging-item ${issue.severity === 'high' ? 'ujg-aging-danger' : 'ujg-aging-warning'}">
                            <span class="ujg-aging-indicator">${issue.severity === 'high' ? '🔴' : '🟠'}</span>
                            <a href="${getContextPath()}/browse/${issue.key}" target="_blank" class="ujg-aging-key">${issue.key}</a>
                            <span class="ujg-aging-summary">${issue.summary}</span>
                            <span class="ujg-aging-days">${issue.aging}</span>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    }
    
    function renderProblemsTable(problems) {
        if (problems.length === 0) {
            return `
                <div class="ujg-section">
                    <h3 class="ujg-section-title">✅ Проблемы</h3>
                    <div class="ujg-no-problems">Проблем не обнаружено!</div>
                </div>
            `;
        }
        
        const severityOrder = { high: 0, medium: 1, low: 2 };
        const sortedProblems = problems.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);
        
        const severityIcons = {
            high: '🔴',
            medium: '🟠',
            low: '🟡'
        };
        
        return `
            <div class="ujg-section">
                <h3 class="ujg-section-title">⚠️ Проблемы (${problems.length})</h3>
                <div class="ujg-problems-list">
                    ${sortedProblems.slice(0, 20).map(problem => `
                        <div class="ujg-problem-item ujg-problem-${problem.severity}">
                            <span class="ujg-problem-icon">${severityIcons[problem.severity]}</span>
                            <a href="${getContextPath()}/browse/${problem.key}" target="_blank" class="ujg-problem-key">${problem.key}</a>
                            <span class="ujg-problem-message">${problem.message}</span>
                        </div>
                    `).join('')}
                    ${problems.length > 20 ? `<div class="ujg-problems-more">...и ещё ${problems.length - 20} проблем</div>` : ''}
                </div>
            </div>
        `;
    }

    // ============================================
    // CHART RENDERING
    // ============================================
    
    function renderBurndownChart($container, data, mode) {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const $chart = $container.find('#burndown-chart');
        
        $chart.empty().append(canvas);
        
        const width = $chart.width() || 400;
        const height = 200;
        const padding = { top: 20, right: 20, bottom: 30, left: 50 };
        
        canvas.width = width;
        canvas.height = height;
        
        const chartWidth = width - padding.left - padding.right;
        const chartHeight = height - padding.top - padding.bottom;
        
        const dailyData = data.dailyData;
        const maxValue = mode === 'hours' ? 
            Math.max(...dailyData.map(d => d.idealRemainingHours)) :
            Math.max(...dailyData.map(d => d.idealRemainingTasks));
        
        // Clear
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, width, height);
        
        // Grid
        ctx.strokeStyle = '#eee';
        ctx.lineWidth = 1;
        for (let i = 0; i <= 4; i++) {
            const y = padding.top + (chartHeight / 4) * i;
            ctx.beginPath();
            ctx.moveTo(padding.left, y);
            ctx.lineTo(width - padding.right, y);
            ctx.stroke();
        }
        
        // Ideal line (dashed)
        ctx.strokeStyle = CONFIG.colors.primary;
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        dailyData.forEach((d, i) => {
            const x = padding.left + (chartWidth / (dailyData.length - 1)) * i;
            const value = mode === 'hours' ? d.idealRemainingHours : d.idealRemainingTasks;
            const y = padding.top + chartHeight - (value / maxValue) * chartHeight;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        });
        ctx.stroke();
        ctx.setLineDash([]);
        
        // Actual line
        ctx.strokeStyle = CONFIG.colors.success;
        ctx.lineWidth = 2;
        ctx.beginPath();
        let started = false;
        dailyData.forEach((d, i) => {
            if (!d.isPast) return;
            const x = padding.left + (chartWidth / (dailyData.length - 1)) * i;
            const value = mode === 'hours' ? d.actualRemainingHours : d.actualRemainingTasks;
            if (value === null) return;
            const y = padding.top + chartHeight - (value / maxValue) * chartHeight;
            if (!started) {
                ctx.moveTo(x, y);
                started = true;
            } else {
                ctx.lineTo(x, y);
            }
        });
        ctx.stroke();
        
        // Points on actual line
        ctx.fillStyle = CONFIG.colors.success;
        dailyData.forEach((d, i) => {
            if (!d.isPast) return;
            const x = padding.left + (chartWidth / (dailyData.length - 1)) * i;
            const value = mode === 'hours' ? d.actualRemainingHours : d.actualRemainingTasks;
            if (value === null) return;
            const y = padding.top + chartHeight - (value / maxValue) * chartHeight;
            ctx.beginPath();
            ctx.arc(x, y, 4, 0, Math.PI * 2);
            ctx.fill();
        });
        
        // X axis labels
        ctx.fillStyle = '#666';
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'center';
        dailyData.forEach((d, i) => {
            if (i % Math.ceil(dailyData.length / 10) !== 0 && i !== dailyData.length - 1) return;
            const x = padding.left + (chartWidth / (dailyData.length - 1)) * i;
            ctx.fillText(d.label, x, height - 5);
        });
        
        // Y axis labels
        ctx.textAlign = 'right';
        for (let i = 0; i <= 4; i++) {
            const y = padding.top + (chartHeight / 4) * i;
            const value = Math.round(maxValue * (1 - i / 4));
            ctx.fillText(mode === 'hours' ? value + 'ч' : value, padding.left - 5, y + 4);
        }
        
        // Legend
        ctx.font = '11px sans-serif';
        ctx.textAlign = 'left';
        ctx.fillStyle = CONFIG.colors.primary;
        ctx.fillText('— — Идеал', padding.left + 10, padding.top + 15);
        ctx.fillStyle = CONFIG.colors.success;
        ctx.fillText('—— Факт', padding.left + 100, padding.top + 15);
    }
    
    function renderBurnupChart($container, data, mode) {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const $chart = $container.find('#burnup-chart');
        
        $chart.empty().append(canvas);
        
        const width = $chart.width() || 400;
        const height = 200;
        const padding = { top: 20, right: 20, bottom: 30, left: 50 };
        
        canvas.width = width;
        canvas.height = height;
        
        const chartWidth = width - padding.left - padding.right;
        const chartHeight = height - padding.top - padding.bottom;
        
        const dailyData = data.dailyData;
        const maxValue = mode === 'hours' ? 
            Math.max(...dailyData.map(d => d.scopeHours)) * 1.1 :
            Math.max(...dailyData.map(d => d.scopeTasks)) * 1.1;
        
        // Clear
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, width, height);
        
        // Grid
        ctx.strokeStyle = '#eee';
        ctx.lineWidth = 1;
        for (let i = 0; i <= 4; i++) {
            const y = padding.top + (chartHeight / 4) * i;
            ctx.beginPath();
            ctx.moveTo(padding.left, y);
            ctx.lineTo(width - padding.right, y);
            ctx.stroke();
        }
        
        // Scope line
        ctx.strokeStyle = CONFIG.colors.danger;
        ctx.lineWidth = 2;
        ctx.beginPath();
        dailyData.forEach((d, i) => {
            const x = padding.left + (chartWidth / (dailyData.length - 1)) * i;
            const value = mode === 'hours' ? d.scopeHours : d.scopeTasks;
            const y = padding.top + chartHeight - (value / maxValue) * chartHeight;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        });
        ctx.stroke();
        
        // Ideal done line (dashed)
        ctx.strokeStyle = CONFIG.colors.primary;
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        dailyData.forEach((d, i) => {
            const x = padding.left + (chartWidth / (dailyData.length - 1)) * i;
            const value = mode === 'hours' ? d.idealDoneHours : d.idealDoneTasks;
            const y = padding.top + chartHeight - (value / maxValue) * chartHeight;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        });
        ctx.stroke();
        ctx.setLineDash([]);
        
        // Actual done line
        ctx.strokeStyle = CONFIG.colors.success;
        ctx.lineWidth = 2;
        ctx.beginPath();
        let started = false;
        dailyData.forEach((d, i) => {
            if (!d.isPast) return;
            const x = padding.left + (chartWidth / (dailyData.length - 1)) * i;
            const value = mode === 'hours' ? d.actualDoneHours : d.actualDoneTasks;
            if (value === null) return;
            const y = padding.top + chartHeight - (value / maxValue) * chartHeight;
            if (!started) {
                ctx.moveTo(x, y);
                started = true;
            } else {
                ctx.lineTo(x, y);
            }
        });
        ctx.stroke();
        
        // Points
        ctx.fillStyle = CONFIG.colors.success;
        dailyData.forEach((d, i) => {
            if (!d.isPast) return;
            const x = padding.left + (chartWidth / (dailyData.length - 1)) * i;
            const value = mode === 'hours' ? d.actualDoneHours : d.actualDoneTasks;
            if (value === null) return;
            const y = padding.top + chartHeight - (value / maxValue) * chartHeight;
            ctx.beginPath();
            ctx.arc(x, y, 4, 0, Math.PI * 2);
            ctx.fill();
        });
        
        // X axis labels
        ctx.fillStyle = '#666';
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'center';
        dailyData.forEach((d, i) => {
            if (i % Math.ceil(dailyData.length / 10) !== 0 && i !== dailyData.length - 1) return;
            const x = padding.left + (chartWidth / (dailyData.length - 1)) * i;
            ctx.fillText(d.label, x, height - 5);
        });
        
        // Y axis labels
        ctx.textAlign = 'right';
        for (let i = 0; i <= 4; i++) {
            const y = padding.top + (chartHeight / 4) * i;
            const value = Math.round(maxValue * (1 - i / 4));
            ctx.fillText(mode === 'hours' ? value + 'ч' : value, padding.left - 5, y + 4);
        }
        
        // Legend
        ctx.font = '11px sans-serif';
        ctx.textAlign = 'left';
        ctx.fillStyle = CONFIG.colors.danger;
        ctx.fillText('—— Scope', padding.left + 10, padding.top + 15);
        ctx.fillStyle = CONFIG.colors.primary;
        ctx.fillText('— — Идеал', padding.left + 80, padding.top + 15);
        ctx.fillStyle = CONFIG.colors.success;
        ctx.fillText('—— Done', padding.left + 170, padding.top + 15);
    }
    
    function renderCFDChart($container, data) {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const $chart = $container.find('#cfd-chart');
        
        $chart.empty().append(canvas);
        
        const width = $chart.width() || 400;
        const height = 200;
        const padding = { top: 20, right: 20, bottom: 30, left: 50 };
        
        canvas.width = width;
        canvas.height = height;
        
        const chartWidth = width - padding.left - padding.right;
        const chartHeight = height - padding.top - padding.bottom;
        
        const dailyData = data.dailyData.filter(d => d.isPast && d.done !== null);
        if (dailyData.length === 0) {
            ctx.fillStyle = '#666';
            ctx.font = '14px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('Недостаточно данных', width / 2, height / 2);
            return;
        }
        
        const maxValue = Math.max(...dailyData.map(d => 
            (d.toDo || 0) + (d.inProgress || 0) + (d.inReview || 0) + (d.done || 0)
        ));
        
        // Clear
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, width, height);
        
        // Stacked areas (bottom to top: Done, In Review, In Progress, To Do)
        const categories = [
            { key: 'done', color: CONFIG.colors.done, label: 'Done' },
            { key: 'inReview', color: CONFIG.colors.inReview, label: 'In Review' },
            { key: 'inProgress', color: CONFIG.colors.inProgress, label: 'In Progress' },
            { key: 'toDo', color: CONFIG.colors.toDo, label: 'To Do' }
        ];
        
        categories.forEach((cat, catIndex) => {
            ctx.fillStyle = cat.color;
            ctx.beginPath();
            
            // Bottom line (cumulative of previous categories)
            dailyData.forEach((d, i) => {
                const x = padding.left + (chartWidth / (dailyData.length - 1)) * i;
                let cumulative = 0;
                for (let j = 0; j < catIndex; j++) {
                    cumulative += d[categories[j].key] || 0;
                }
                const y = padding.top + chartHeight - (cumulative / maxValue) * chartHeight;
                if (i === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            });
            
            // Top line (including current category)
            for (let i = dailyData.length - 1; i >= 0; i--) {
                const d = dailyData[i];
                const x = padding.left + (chartWidth / (dailyData.length - 1)) * i;
                let cumulative = 0;
                for (let j = 0; j <= catIndex; j++) {
                    cumulative += d[categories[j].key] || 0;
                }
                const y = padding.top + chartHeight - (cumulative / maxValue) * chartHeight;
                ctx.lineTo(x, y);
            }
            
            ctx.closePath();
            ctx.fill();
        });
        
        // X axis labels
        ctx.fillStyle = '#666';
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'center';
        dailyData.forEach((d, i) => {
            if (i % Math.ceil(dailyData.length / 8) !== 0 && i !== dailyData.length - 1) return;
            const x = padding.left + (chartWidth / (dailyData.length - 1)) * i;
            ctx.fillText(d.label, x, height - 5);
        });
        
        // Y axis labels
        ctx.textAlign = 'right';
        for (let i = 0; i <= 4; i++) {
            const y = padding.top + (chartHeight / 4) * i;
            const value = Math.round(maxValue * (1 - i / 4));
            ctx.fillText(value, padding.left - 5, y + 4);
        }
        
        // Legend
        const $legend = $container.find('#cfd-legend');
        $legend.html(`
            <div class="ujg-legend">
                ${categories.slice().reverse().map(cat => `
                    <div class="ujg-legend-item">
                        <span class="ujg-legend-color" style="background: ${cat.color};"></span>
                        <span class="ujg-legend-label">${cat.label}</span>
                    </div>
                `).join('')}
            </div>
        `);
    }
    
    function renderVelocityChart($container, data, currentSprint) {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const $chart = $container.find('#velocity-chart');
        
        $chart.empty().append(canvas);
        
        const width = $chart.width() || 400;
        const height = 200;
        const padding = { top: 20, right: 20, bottom: 40, left: 50 };
        
        canvas.width = width;
        canvas.height = height;
        
        const chartWidth = width - padding.left - padding.right;
        const chartHeight = height - padding.top - padding.bottom;
        
        // Mock velocity data (в реальности нужно загружать историю спринтов)
        const velocityData = [
            { name: 'Sprint -4', planned: 80, done: 75 },
            { name: 'Sprint -3', planned: 85, done: 90 },
            { name: 'Sprint -2', planned: 90, done: 85 },
            { name: 'Sprint -1', planned: 95, done: 88 },
            { name: currentSprint.name, planned: data.metrics.totalEstimate / 3600, done: data.metrics.doneHours / 3600, current: true }
        ];
        
        const maxValue = Math.max(...velocityData.flatMap(d => [d.planned, d.done])) * 1.1;
        const barWidth = chartWidth / velocityData.length / 3;
        
        // Clear
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, width, height);
        
        // Grid
        ctx.strokeStyle = '#eee';
        ctx.lineWidth = 1;
        for (let i = 0; i <= 4; i++) {
            const y = padding.top + (chartHeight / 4) * i;
            ctx.beginPath();
            ctx.moveTo(padding.left, y);
            ctx.lineTo(width - padding.right, y);
            ctx.stroke();
        }
        
        // Bars
        velocityData.forEach((d, i) => {
            const groupX = padding.left + (chartWidth / velocityData.length) * (i + 0.5);
            
            // Planned bar
            const plannedHeight = (d.planned / maxValue) * chartHeight;
            ctx.fillStyle = CONFIG.colors.primary;
            ctx.fillRect(groupX - barWidth - 2, padding.top + chartHeight - plannedHeight, barWidth, plannedHeight);
            
            // Done bar
            const doneHeight = (d.done / maxValue) * chartHeight;
            ctx.fillStyle = d.current ? CONFIG.colors.warning : CONFIG.colors.success;
            ctx.fillRect(groupX + 2, padding.top + chartHeight - doneHeight, barWidth, doneHeight);
        });
        
        // X axis labels
        ctx.fillStyle = '#666';
        ctx.font = '9px sans-serif';
        ctx.textAlign = 'center';
        velocityData.forEach((d, i) => {
            const x = padding.left + (chartWidth / velocityData.length) * (i + 0.5);
            const label = d.current ? 'Текущий' : d.name.replace('Sprint ', 'S');
            ctx.fillText(label, x, height - 5);
        });
        
        // Y axis labels
        ctx.textAlign = 'right';
        for (let i = 0; i <= 4; i++) {
            const y = padding.top + (chartHeight / 4) * i;
            const value = Math.round(maxValue * (1 - i / 4));
            ctx.fillText(value + 'ч', padding.left - 5, y + 4);
        }
        
        // Legend
        ctx.font = '11px sans-serif';
        ctx.textAlign = 'left';
        ctx.fillStyle = CONFIG.colors.primary;
        ctx.fillRect(padding.left + 10, padding.top + 5, 12, 12);
        ctx.fillStyle = '#333';
        ctx.fillText('План', padding.left + 26, padding.top + 15);
        ctx.fillStyle = CONFIG.colors.success;
        ctx.fillRect(padding.left + 70, padding.top + 5, 12, 12);
        ctx.fillStyle = '#333';
        ctx.fillText('Факт', padding.left + 86, padding.top + 15);
        
        // Average line
        const avgDone = velocityData.slice(0, -1).reduce((sum, d) => sum + d.done, 0) / (velocityData.length - 1);
        const avgY = padding.top + chartHeight - (avgDone / maxValue) * chartHeight;
        ctx.strokeStyle = CONFIG.colors.info;
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ctx.moveTo(padding.left, avgY);
        ctx.lineTo(width - padding.right, avgY);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = CONFIG.colors.info;
        ctx.fillText('Avg: ' + Math.round(avgDone) + 'ч', width - padding.right - 60, avgY - 5);
    }
    
    function renderPriorityChart($container, data) {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const $chart = $container.find('#priority-chart');
        
        $chart.empty().append(canvas);
        
        const width = $chart.width() || 200;
        const height = 150;
        const padding = { top: 10, right: 10, bottom: 20, left: 60 };
        
        canvas.width = width;
        canvas.height = height;
        
        const chartWidth = width - padding.left - padding.right;
        const chartHeight = height - padding.top - padding.bottom;
        
        const priorities = Object.entries(data.priorities)
            .sort((a, b) => {
                const order = { 'Critical': 0, 'Highest': 1, 'High': 2, 'Medium': 3, 'Low': 4, 'Lowest': 5 };
                return (order[a[0]] ?? 99) - (order[b[0]] ?? 99);
            });
        
        if (priorities.length === 0) return;
        
        const maxCount = Math.max(...priorities.map(([_, v]) => v.count));
        const barHeight = chartHeight / priorities.length - 4;
        
        const priorityColors = {
            'Critical': CONFIG.colors.critical,
            'Highest': CONFIG.colors.critical,
            'High': CONFIG.colors.high,
            'Medium': CONFIG.colors.medium,
            'Low': CONFIG.colors.low,
            'Lowest': CONFIG.colors.low
        };
        
        // Clear
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, width, height);
        
        // Bars
        priorities.forEach(([name, stats], i) => {
            const y = padding.top + i * (barHeight + 4);
            const barWidth = (stats.count / maxCount) * chartWidth;
            
            ctx.fillStyle = priorityColors[name] || CONFIG.colors.info;
            ctx.fillRect(padding.left, y, barWidth, barHeight);
            
            // Label
            ctx.fillStyle = '#333';
            ctx.font = '10px sans-serif';
            ctx.textAlign = 'right';
            ctx.fillText(name, padding.left - 5, y + barHeight / 2 + 4);
            
            // Count
            ctx.textAlign = 'left';
            ctx.fillText(stats.count, padding.left + barWidth + 5, y + barHeight / 2 + 4);
        });
    }
    
    function renderIssueTypeChart($container, data) {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const $chart = $container.find('#issuetype-chart');
        
        $chart.empty().append(canvas);
        
        const width = $chart.width() || 200;
        const height = 150;
        const padding = { top: 10, right: 10, bottom: 20, left: 60 };
        
        canvas.width = width;
        canvas.height = height;
        
        const chartWidth = width - padding.left - padding.right;
        const chartHeight = height - padding.top - padding.bottom;
        
        const types = Object.entries(data.issueTypes);
        
        if (types.length === 0) return;
        
        const maxCount = Math.max(...types.map(([_, v]) => v.count));
        const barHeight = chartHeight / types.length - 4;
        
        const typeColors = {
            'Story': CONFIG.colors.story,
            'Bug': CONFIG.colors.bug,
            'Task': CONFIG.colors.task,
            'Sub-task': CONFIG.colors.subtask
        };
        
        // Clear
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, width, height);
        
        // Bars
        types.forEach(([name, stats], i) => {
            const y = padding.top + i * (barHeight + 4);
            const barWidth = (stats.count / maxCount) * chartWidth;
            
            ctx.fillStyle = typeColors[name] || CONFIG.colors.info;
            ctx.fillRect(padding.left, y, barWidth, barHeight);
            
            // Label
            ctx.fillStyle = '#333';
            ctx.font = '10px sans-serif';
            ctx.textAlign = 'right';
            ctx.fillText(name, padding.left - 5, y + barHeight / 2 + 4);
            
            // Count
            ctx.textAlign = 'left';
            ctx.fillText(stats.count, padding.left + barWidth + 5, y + barHeight / 2 + 4);
        });
    }
    
    function renderScopeChange($container, data) {
        const $scope = $container.find('#scope-change');
        
        // В реальности нужно отслеживать изменения scope
        // Пока показываем текущий объём
        const totalHours = data.metrics.totalEstimate / 3600;
        const totalTasks = data.metrics.total;
        
        $scope.html(`
            <div class="ujg-scope-stats">
                <div class="ujg-scope-row">
                    <span class="ujg-scope-label">На старте:</span>
                    <span class="ujg-scope-value">${Math.round(totalHours)}ч (${totalTasks})</span>
                </div>
                <div class="ujg-scope-row">
                    <span class="ujg-scope-label">+ Добавлено:</span>
                    <span class="ujg-scope-value ujg-text-warning">+0ч (+0)</span>
                </div>
                <div class="ujg-scope-row">
                    <span class="ujg-scope-label">− Убрано:</span>
                    <span class="ujg-scope-value">−0ч (−0)</span>
                </div>
                <div class="ujg-scope-divider"></div>
                <div class="ujg-scope-row ujg-scope-total">
                    <span class="ujg-scope-label">Итого:</span>
                    <span class="ujg-scope-value">${Math.round(totalHours)}ч (${totalTasks})</span>
                </div>
                <div class="ujg-scope-change-percent">
                    Изменение: <span class="ujg-text-success">0%</span>
                </div>
            </div>
            <p class="ujg-scope-note">* Для точного отслеживания scope change нужна история изменений</p>
        `);
    }

    // ============================================
    // EVENT HANDLERS
    // ============================================
    
    function bindEvents($container, data) {
        // Chart mode toggle
        $container.find('.ujg-toggle-btn').on('click', function() {
            const $btn = $(this);
            const chart = $btn.data('chart');
            const mode = $btn.data('mode');
            
            $btn.siblings().removeClass('active');
            $btn.addClass('active');
            
            if (chart === 'burndown') {
                renderBurndownChart($container, data, mode);
            } else if (chart === 'burnup') {
                renderBurnupChart($container, data, mode);
            }
        });
        
        // Refresh button
        $container.find('.ujg-btn-refresh').on('click', function() {
            // Trigger refresh (нужно реализовать перезагрузку данных)
            $container.trigger('refresh');
        });
        
        // Fullscreen button
        $container.find('.ujg-btn-fullscreen').on('click', function() {
            const elem = $container.get(0);
            if (document.fullscreenElement) {
                document.exitFullscreen();
            } else {
                elem.requestFullscreen();
            }
        });
    }

    // ============================================
    // MAIN INITIALIZATION
    // ============================================
    
    function init($container, options) {
        options = options || {};
        try {
            console.info('[UJG2] init start');
        } catch (e) {}
        
        // состояние для фильтров
        const uiState = { boards: [], sprints: [], selectedBoardId: null, selectedSprintId: null };

        function getErrorMessage(err) {
            return (err && err.responseJSON && err.responseJSON.errorMessages && err.responseJSON.errorMessages[0]) ||
                   (err && err.responseText) ||
                   (err && err.message) ||
                   (err && err.statusText) ||
                   'Unknown error';
        }

        const $filters = $('<div class="ujg-filters-wrap"></div>');
        const $content = $('<div class="ujg-content"></div>');
        $container.empty().append($filters).append($content);
        $content.html('<div class="ujg-loading">Загрузка данных...</div>');

        function renderFilters() {
            const boards = uiState.boards.map(b => `<option value="${b.id}" ${b.id === uiState.selectedBoardId ? 'selected' : ''}>${b.name}</option>`).join('');
            const sprints = uiState.sprints.map(s => `<option value="${s.id}" ${s.id === uiState.selectedSprintId ? 'selected' : ''}>${s.name}</option>`).join('');
            $filters.html(`
                <div class="ujg-filters">
                    <label>Доска:
                        <select class="ujg-filter-board">
                            ${boards || '<option value="">Нет досок</option>'}
                        </select>
                    </label>
                    <label>Спринт:
                        <select class="ujg-filter-sprint" ${uiState.sprints.length === 0 ? 'disabled' : ''}>
                            ${sprints || '<option value="">Нет спринтов</option>'}
                        </select>
                    </label>
                </div>
            `);
        }

        function loadSprintAndRender(boardId, sprintId) {
            uiState.selectedBoardId = boardId;
            uiState.selectedSprintId = sprintId;
            renderFilters();
            $content.html('<div class="ujg-loading">Загрузка данных...</div>');

            $.when(getSprintDetails(sprintId), getSprintIssues(sprintId))
                .then(function(sprintDetails, issuesResponse) {
                    const sprint = sprintDetails[0] || sprintDetails;
                    const issues = (issuesResponse[0] || issuesResponse).issues || [];
                    const data = processSprintData(issues, sprint);
                    render($content, data, sprint, options.api);
                })
                .fail(function(err) {
                    const msg = getErrorMessage(err);
                    console.error('UJG Sprint Health Error:', err);
                    $content.html(`
                        <div class="ujg-error">
                            <p>❌ Ошибка загрузки данных [v${CONFIG.version}]</p>
                            <p class="ujg-error-details">${msg}</p>
                        </div>
                    `);
                });
        }

        function loadBoard(boardId, preferredSprintId) {
            uiState.selectedBoardId = boardId;
            renderFilters();
            $content.html('<div class="ujg-loading">Загрузка спринтов...</div>');
            getAllSprints(boardId).then(function(sprints) {
                sprints.sort(function(a, b) { return b.id - a.id; });
                uiState.sprints = sprints;
                let sprint = sprints.find(s => s.id == preferredSprintId) || sprints.find(s => s.state === 'active') || sprints[0];
                if (!sprint) {
                    $content.html(`
                        <div class="ujg-error">
                            <p>❌ Ошибка загрузки данных [v${CONFIG.version}]</p>
                            <p class="ujg-error-details">Нет спринтов на доске</p>
                        </div>
                    `);
                    renderFilters();
                    return;
                }
                uiState.selectedSprintId = sprint.id;
                renderFilters();
                loadSprintAndRender(boardId, sprint.id);
            }).fail(function(err) {
                const msg = getErrorMessage(err);
                console.error('UJG Sprint Health Error:', err);
                $content.html(`
                    <div class="ujg-error">
                        <p>❌ Ошибка загрузки данных [v${CONFIG.version}]</p>
                        <p class="ujg-error-details">${msg}</p>
                    </div>
                `);
            });
        }

        getBoards()
            .then(function(boardsResponse) {
                const boards = boardsResponse.values || [];
                if (boards.length === 0) throw new Error('Не найдено ни одной доски');
                uiState.boards = boards.slice();

                // boardId предпочтительно — ставим в начало
                let ordered = boards.slice();
                if (options.boardId) {
                    const pref = boards.find(b => b.id === options.boardId);
                    if (pref) ordered = [pref].concat(boards.filter(b => b.id !== options.boardId));
                }

                renderFilters();

                // Пробуем доски по порядку, пропуская те, что не поддерживают спринты
                function tryBoard(idx) {
                    if (idx >= ordered.length) {
                        return $.Deferred().reject(new Error('Не найдено ни одной доски, поддерживающей спринты')).promise();
                    }
                    const b = ordered[idx];
                    return getAllSprints(b.id).then(function(sprints) {
                        if (!sprints || sprints.length === 0) return tryBoard(idx + 1);
                        uiState.selectedBoardId = b.id;
                        uiState.sprints = sprints;
                        sprints.sort(function(a, b) { return b.id - a.id; });
                        const active = sprints.find(s => s.state === 'active');
                        const chosen = active || sprints[0];
                        uiState.selectedSprintId = chosen.id;
                        renderFilters();
                        return { board: b, sprint: chosen };
                    }).fail(function(err) {
                        const msg = getErrorMessage(err);
                        const lower = (msg || '').toLowerCase();
                        if (lower.indexOf('не поддерживает спринты') >= 0 || lower.indexOf('does not support sprints') >= 0) {
                            return tryBoard(idx + 1);
                        }
                        return $.Deferred().reject(err).promise();
                    });
                }

                return tryBoard(0);
            })
            .then(function(found) {
                loadSprintAndRender(found.board.id, found.sprint.id);
            })
            .fail(function(err) {
                const msg = getErrorMessage(err);
                console.error('UJG Sprint Health Error:', err);
                $content.html(`
                    <div class="ujg-error">
                        <p>❌ Ошибка загрузки данных [v${CONFIG.version}]</p>
                        <p class="ujg-error-details">${msg}</p>
                    </div>
                `);
            });

        // обработчики фильтров
        $container.on('change', '.ujg-filter-board', function() {
            const val = $(this).val();
            if (!val) return;
            loadBoard(val, null);
        });
        $container.on('change', '.ujg-filter-sprint', function() {
            const val = $(this).val();
            if (!val || !uiState.selectedBoardId) return;
            loadSprintAndRender(uiState.selectedBoardId, val);
        });
    }

    // ============================================
    // EXPORT
    // ============================================
    
    // Адаптер для Universal Gadget (как в v1)
    function GadgetAdapter(API) {
        var $container = API.getGadgetContentEl();
        init($container, { api: API });
    }

    GadgetAdapter.init = init;
    GadgetAdapter.CONFIG = CONFIG;

    // Дублируем на window для ручного вызова и отладки, если require не сработал
    if (typeof window !== 'undefined') {
        window._ujgSprintHealth = GadgetAdapter;
    }

    return GadgetAdapter;
});
