# jira

Набор скриптов/виджетов для Jira (Sprint Health, Timesheet, Timesheet v0, Project Analytics, User Activity, Daily Diligence) и вспомогательных утилит.

## Структура проекта

```text
.
├── _ujgCommon.js
├── build-daily-diligence.js
├── build-project-analytics.js
├── build-sprint-health.js
├── build-user-activity.js
├── build-widget-bootstrap-assets.js
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
│   ├── timesheet-logic.test.js
│   └── widget-bootstrap.test.js
├── ujg-daily-diligence-modules/
├── ujg-daily-diligence.bootstrap.js
├── ujg-daily-diligence.css
├── ujg-daily-diligence.js
├── ujg-daily-diligence.runtime.js
├── ujg-project-analytics-modules/
├── ujg-project-analytics-spec.md
├── ujg-project-analytics.bootstrap.js
├── ujg-project-analytics.css
├── ujg-project-analytics.js
├── ujg-project-analytics.runtime.js
├── ujg-sprint-health-modules/
├── ujg-sprint-health-spec.md
├── ujg-sprint-health.bootstrap.js
├── ujg-sprint-health.css
├── ujg-sprint-health.deprecated.js
├── ujg-sprint-health.js
├── ujg-sprint-health.runtime.js
├── ujg-timesheet.bootstrap.js
├── ujg-timesheet.css
├── ujg-timesheet.js
├── ujg-timesheet.runtime.js
├── ujg-timesheet.v0.bootstrap.js
├── ujg-timesheet.v0.css
├── ujg-timesheet.v0.js
├── ujg-timesheet.v0.runtime.js
├── ujg-user-activity-modules/
├── ujg-user-activity.bootstrap.js
├── ujg-user-activity.css
├── ujg-user-activity.js
├── ujg-user-activity.runtime.js
└── vba/
```

`tests/timesheet-logic.test.js` содержит минимальные unit-тесты на чистую логику Timesheet через `node --test`, без внешних зависимостей. Точечные тесты Daily Diligence: `daily-diligence-api-jira.test.js`, `daily-diligence-api-bitbucket.test.js`, `daily-diligence-api-confluence.test.js`, `daily-diligence-data-processor.test.js`, `daily-diligence-main.test.js`, `daily-diligence-rendering.test.js`, `daily-diligence-team-manager.test.js`, `daily-diligence-utils.test.js`. Standalone smoke-тесты: `standalone-daily-diligence.test.js`, `standalone-server-login.test.js`, `standalone-timesheet-v0.test.js`. Генератор и поведение stable bootstrap: `widget-bootstrap.test.js` (`node --test tests/widget-bootstrap.test.js`). Дизайн и план: `docs/plans/2026-03-29-widget-bootstrap-design.md`, `docs/plans/2026-03-29-widget-bootstrap.md`.

## Стабильные URL гаджетов (bootstrap)

Рекомендуемый формат настройки гаджета в Jira: один URL на `*.bootstrap.js` с веткой `@main` на jsDelivr, **пустой** список CSS (стили подгружает bootstrap вместе с runtime), **без изменений** поле AMD module (то же публичное имя, что и у legacy bundle).

Базовый префикс CDN (при необходимости замените org/repo):

`https://cdn.jsdelivr.net/gh/skivbox-ii/jira@main/`

### Daily Diligence

`JavaScript URLs`

```text
https://cdn.jsdelivr.net/gh/skivbox-ii/jira@main/ujg-daily-diligence.bootstrap.js
```

`CSS URLs`

```text

```

`AMD module`

```text
_ujgDailyDiligence
```

### Timesheet

`JavaScript URLs`

```text
https://cdn.jsdelivr.net/gh/skivbox-ii/jira@main/ujg-timesheet.bootstrap.js
```

`CSS URLs`

```text

```

`AMD module`

```text
_ujgTimesheet
```

### User Activity

`JavaScript URLs`

```text
https://cdn.jsdelivr.net/gh/skivbox-ii/jira@main/ujg-user-activity.bootstrap.js
```

`CSS URLs`

```text

```

`AMD module`

```text
_ujgUserActivity
```

Пересобрать committed `*.bootstrap.js` / `*.runtime.js` из текущих bundle: `node build-widget-bootstrap-assets.js`.

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

