# jira

Набор скриптов/виджетов для Jira (Sprint Health, Timesheet, Project Analytics) и вспомогательных утилит.

## Структура проекта

```text
.
├── _ujgCommon.js
├── build-project-analytics.js
├── build-sprint-health.js
├── canvas-print-v2.js
├── demo-v2.html
├── docs/
│   └── plans/
├── jira_attach_latest_assets.py
├── tests/
│   ├── helpers/
│   └── timesheet-logic.test.js
├── ujg-project-analytics-modules/
├── ujg-project-analytics-spec.md
├── ujg-project-analytics.css
├── ujg-project-analytics.js
├── ujg-user-activity-modules/
│   ├── api.js
│   ├── config.js
│   ├── utils.js
│   ├── user-picker.js
│   ├── date-range-picker.js
│   ├── summary-cards.js
│   ├── project-breakdown.js
│   ├── issue-list.js
│   ├── progress-loader.js
│   └── activity-log.js
├── ujg-sprint-health-modules/
├── ujg-sprint-health-spec.md
├── ujg-sprint-health.css
├── ujg-sprint-health.deprecated.js
├── ujg-sprint-health.js
├── ujg-timesheet.css
├── ujg-timesheet.js
├── build-user-activity.js         # сборка ujg-user-activity.js из модулей
├── ujg-user-activity-modules/
│   ├── config.js          # _ujgUA_config — константы, иконки, цвета
│   ├── utils.js           # _ujgUA_utils — утилиты форматирования, дат, HTML
│   ├── api.js             # _ujgUA_api — Jira REST API (search, worklogs, changelog)
│   ├── data-processor.js  # _ujgUA_dataProcessor — обработка сырых данных
│   ├── user-picker.js     # _ujgUA_userPicker — выбор пользователя
│   ├── calendar-heatmap.js # _ujgUA_calendarHeatmap — тепловая карта по неделям
│   ├── daily-detail.js    # _ujgUA_dailyDetail — детали активности за день
│   ├── rendering.js       # _ujgUA_rendering — оркестратор UI
│   └── main.js            # _ujgUA_main — точка входа гаджета
└── vba/
```

`tests/timesheet-logic.test.js` содержит минимальные unit-тесты на чистую логику Timesheet через `node --test`, без внешних зависимостей.

## Утилита: загрузка последних ассетов в Jira attachment

Сценарий для обхода блокировок CDN/CSP: скачать последние файлы из GitHub (без авторизации и без git) и прикрепить к Jira-задаче как attachments (нужны права **Attach files** в проекте).

### Пример запуска

Через env (чтобы не светить токен в истории shell):

```bash
export JIRA_BASE_URL="https://company.atlassian.net"
export JIRA_ISSUE_KEY="SDKU-123"
export JIRA_USER="email@example.com"
export JIRA_API_TOKEN="xxxxxxxx"
python3 jira_attach_latest_assets.py
```

Только проверить скачивание с GitHub:

```bash
python3 jira_attach_latest_assets.py --dry-run
```

