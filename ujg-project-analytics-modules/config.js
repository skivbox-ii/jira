// Конфигурация и константы
define("_ujgPA_config", [], function() {
    "use strict";
    
    return {
        CONFIG: {
            version: "0.1.0",
            maxPeriodDays: 365,
            debug: true
        },
        
        STORAGE_KEY: "ujg_pa_settings",
        WORKFLOW_STORAGE_KEY: "ujg_pa_workflow_default",
        
        STATUS_CATEGORIES: {
            queue: { name: "Очередь", description: "Задачи, ожидающие начала работы" },
            work: { name: "В работе", description: "Активная разработка" },
            review: { name: "Ревью", description: "Code Review / проверка" },
            testing: { name: "Тестирование", description: "QA / тестирование" },
            waiting: { name: "Ожидание", description: "Blocked / On Hold" },
            done: { name: "Завершено", description: "Задачи, помеченные как Done" }
        },
        
        DEFAULT_THRESHOLDS: {
            ageRisk: 30,
            noProgressRisk: 7,
            longReviewRisk: 5,
            longTestingRisk: 3,
            prIterationsRisk: 3,
            wipLimit: 5,
            sprintChangesRisk: 2,
            assigneeChangesRisk: 3
        },
        
        DEFAULT_RISK_WEIGHTS: {
            age: 30,
            sprintChanges: 20,
            assigneeChanges: 15,
            noProgress: 25,
            reopens: 20,
            longReview: 15,
            longTesting: 15,
            prIterations: 20
        },
        
        DEFAULT_CUSTOM_FIELDS: {
            storyPoints: "",
            epicLink: "",
            sprint: ""
        }
    };
});
