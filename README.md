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
├── ujg-sprint-health-modules/
├── ujg-sprint-health-spec.md
├── ujg-sprint-health.css
├── ujg-sprint-health.deprecated.js
├── ujg-sprint-health.js
├── ujg-timesheet.css
├── ujg-timesheet.js
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

