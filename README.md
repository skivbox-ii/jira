# jira

Набор скриптов/виджетов для Jira (Sprint Health, Timesheet, Project Analytics, User Activity, Daily Diligence) и вспомогательных утилит.

## Структура проекта

```text
.
├── _ujgCommon.js
├── build-daily-diligence.js
├── build-project-analytics.js
├── build-sprint-health.js
├── build-user-activity.js
├── canvas-print-v2.js
├── demo-v2.html
├── docs/
│   └── plans/
├── jira_attach_latest_assets.py
├── standalone/
│   └── public/
│       └── daily-diligence.html
├── tests/
│   ├── helpers/
│   ├── daily-diligence-api-bitbucket.test.js
│   ├── daily-diligence-api-confluence.test.js
│   ├── daily-diligence-api-jira.test.js
│   ├── daily-diligence-data-processor.test.js
│   ├── daily-diligence-main.test.js
│   ├── daily-diligence-rendering.test.js
│   ├── daily-diligence-team-manager.test.js
│   ├── daily-diligence-utils.test.js
│   ├── standalone-daily-diligence.test.js
│   ├── standalone-server-login.test.js
│   ├── standalone-timesheet-v0.test.js
│   └── timesheet-logic.test.js
├── ujg-daily-diligence-modules/
├── ujg-daily-diligence.css
├── ujg-daily-diligence.js
├── ujg-project-analytics-modules/
├── ujg-project-analytics-spec.md
├── ujg-project-analytics.css
├── ujg-project-analytics.js
├── ujg-sprint-health-modules/
├── ujg-sprint-health-spec.md
├── ujg-sprint-health.css
├── ujg-sprint-health.deprecated.js
├── ujg-sprint-health.js
├── ujg-timesheet.css
├── ujg-timesheet.js
├── ujg-timesheet.v0.css
├── ujg-timesheet.v0.js
├── ujg-user-activity-modules/
├── ujg-user-activity.css
├── ujg-user-activity.js
└── vba/
```

`tests/timesheet-logic.test.js` содержит минимальные unit-тесты на чистую логику Timesheet через `node --test`, без внешних зависимостей. Точечные тесты Daily Diligence: `daily-diligence-api-jira.test.js`, `daily-diligence-api-bitbucket.test.js`, `daily-diligence-api-confluence.test.js`, `daily-diligence-data-processor.test.js`, `daily-diligence-main.test.js`, `daily-diligence-rendering.test.js`, `daily-diligence-team-manager.test.js`, `daily-diligence-utils.test.js`. Standalone smoke-тесты: `standalone-daily-diligence.test.js`, `standalone-server-login.test.js`, `standalone-timesheet-v0.test.js`.

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

