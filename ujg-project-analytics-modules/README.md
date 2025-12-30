# Модули ujg-project-analytics

Эта папка содержит модульную версию `ujg-project-analytics.js`, разбитую на отдельные файлы по функциональным блокам.

## Структура модулей

- **config.js** - Конфигурация и константы
- **utils.js** - Утилиты (log, parseDateSafe, formatDuration, etc.)
- **storage.js** - Работа с localStorage
- **workflow.js** - Конфигурация workflow
- **api-tracker.js** - Трекер API запросов
- **progress-modal.js** - Модальное окно прогресса загрузки
- **settings-modal.js** - Модальное окно настроек
- **data-collection.js** - Сбор данных (fetchAllIssues, loadIssueChangelog, etc.)
- **basic-analytics.js** - Базовая аналитика (computeTimeInStatuses, etc.)
- **dev-cycle.js** - Анализ цикла разработки
- **developer-analytics.js** - Аналитика по разработчикам
- **bottlenecks.js** - Детекция узких мест
- **risk-assessment.js** - Оценка рисков
- **team-metrics.js** - Метрики команды
- **velocity.js** - Velocity и throughput
- **rendering.js** - Функции рендеринга UI
- **main.js** - Главный класс MyGadget и инициализация

## Сборка

Для сборки единого файла `ujg-project-analytics.js` из модулей:

```bash
node build-project-analytics.js
```

Скрипт:
1. Читает все модули в правильном порядке
2. Извлекает содержимое из AMD define() обёрток
3. Объединяет в один файл с единой define() обёрткой
4. Сохраняет результат в `ujg-project-analytics.js`

## Порядок модулей

Модули загружаются в порядке зависимостей:
1. config (базовые константы)
2. utils (зависит от config)
3. storage (зависит от config, utils)
4. workflow (зависит от config, utils, storage)
5. ... остальные модули

## Примечания

- Каждый модуль должен быть AMD модулем с define()
- Внутренние модули используют префикс `_ujgPA_` для имен
- Главный модуль остается `_ujgProjectAnalytics`
- После изменений в модулях нужно пересобрать файл
