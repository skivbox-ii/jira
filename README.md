# jira

Набор скриптов/виджетов для Jira (Sprint Health, Timesheet, Timesheet v0, Project Analytics, User Activity, Daily Diligence, Story Browser) и вспомогательных утилит.

## Структура проекта

```text
.
├── _ujgCommon.js
├── build-daily-diligence.js
├── build-project-analytics.js
├── build-sprint-health.js
├── build-story-browser.js
├── build-user-activity.js
├── build-widget-bootstrap-assets.js
├── canvas-print-v2.js
├── demo-v2.html
├── docs/
│   └── plans/
│       ├── 2026-03-06-timesheet-developer-view-design.md
│       ├── 2026-03-06-timesheet-developer-view.md
│       ├── 2026-03-07-standalone-server-design.md
│       ├── 2026-03-07-standalone-server.md
│       ├── 2026-03-07-standalone-timesheet-v0-design.md
│       ├── 2026-03-07-standalone-timesheet-v0.md
│       ├── 2026-03-07-timesheet-report-design.md
│       ├── 2026-03-07-timesheet-report.md
│       ├── 2026-03-07-timesheet-summary-column-design.md
│       ├── 2026-03-09-user-activity-repo-activity-design.md
│       ├── 2026-03-09-user-activity-repo-activity.md
│       ├── 2026-03-10-story-browser-epic-hierarchy-design.md
│       ├── 2026-03-10-story-browser-epic-hierarchy.md
│       ├── 2026-03-29-dashboard-release-ref-design.md
│       ├── 2026-03-29-dashboard-release-ref.md
│       ├── 2026-03-29-dashboard-version-display-design.md
│       ├── 2026-03-29-dashboard-version-display.md
│       ├── 2026-03-29-widget-bootstrap-design.md
│       ├── 2026-03-29-widget-bootstrap.md
│       ├── 2026-03-30-story-browser-literal-port-design.md
│       ├── 2026-03-30-story-browser-literal-port.md
│       ├── 2026-03-31-day-sequential-pipeline-design.md
│       ├── 2026-03-31-day-sequential-pipeline.md
│       ├── 2026-03-31-multi-user-activity-dashboard-design.md
│       ├── 2026-03-31-multi-user-activity-dashboard.md
│       ├── 2026-03-31-user-activity-day-detail-views-design.md
│       ├── 2026-03-31-user-activity-day-detail-views.md
│       ├── 2026-04-01-user-activity-hard-open-diagnostics-design.md
│       ├── 2026-04-01-user-activity-hard-open-diagnostics.md
│       ├── 2026-04-01-shared-team-picker-redesign-design.md
│       ├── 2026-04-01-shared-team-picker-redesign.md
│       ├── 2026-04-01-user-activity-render-time-user-filter-design.md
│       ├── 2026-04-01-user-activity-render-time-user-filter.md
│       ├── 2026-04-01-user-activity-worklog-lag-design.md
│       └── 2026-04-01-user-activity-worklog-lag.md
├── jira_attach_latest_assets.py
├── standalone/
│   └── public/
│       ├── analytics.html
│       ├── daily-diligence.html
│       ├── login.html
│       ├── sprint.html
│       ├── stories.html
│       ├── timesheet-v0.html
│       ├── timesheet.html
│       └── user-activity.html
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
│   ├── standalone-story-browser.test.js
│   ├── standalone-timesheet-v0.test.js
│   ├── story-browser-api-data.test.js
│   ├── story-browser-build.test.js
│   ├── story-browser-core.test.js
│   ├── story-browser-css.test.js
│   ├── story-browser-main.test.js
│   ├── story-browser-rendering.test.js
│   ├── timesheet-logic.test.js
│   ├── user-activity-repo.test.js
│   └── widget-bootstrap.test.js
├── ujg-daily-diligence-modules/
├── ujg-shared-modules/
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
├── ujg-story-browser-modules/
├── ujg-story-browser.bootstrap.js
├── ujg-story-browser.css
├── ujg-story-browser.js
├── ujg-story-browser.runtime.js
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

`tests/timesheet-logic.test.js` содержит минимальные unit-тесты на чистую логику Timesheet через `node --test`, без внешних зависимостей. Точечные тесты Daily Diligence: `daily-diligence-api-jira.test.js`, `daily-diligence-api-bitbucket.test.js`, `daily-diligence-api-confluence.test.js`, `daily-diligence-data-processor.test.js`, `daily-diligence-main.test.js`, `daily-diligence-rendering.test.js`, `daily-diligence-team-manager.test.js`, `daily-diligence-utils.test.js`. Story Browser покрыт наборами `story-browser-build.test.js`, `story-browser-core.test.js`, `story-browser-api-data.test.js`, `story-browser-main.test.js`, `story-browser-rendering.test.js`, `story-browser-css.test.js`. Репозиторный слой User Activity покрыт `user-activity-repo.test.js`. Standalone smoke-тесты: `standalone-daily-diligence.test.js`, `standalone-server-login.test.js`, `standalone-story-browser.test.js`, `standalone-timesheet-v0.test.js`. Генератор и поведение stable bootstrap: `widget-bootstrap.test.js` (`node --test tests/widget-bootstrap.test.js`).

Документация по bootstrap и версионированию на дашборде:

- актуальная модель **dashboard `releaseRef`**: `docs/plans/2026-03-29-dashboard-release-ref-design.md`, `docs/plans/2026-03-29-dashboard-release-ref.md`;
- дизайн и план отображения `Dashboard v<hash> • <commit date time>` в bootstrap UI: `docs/plans/2026-03-29-dashboard-version-display-design.md`, `docs/plans/2026-03-29-dashboard-version-display.md`;
- исторический дизайн/план только про bootstrap/runtime без property: `docs/plans/2026-03-29-widget-bootstrap-design.md`, `docs/plans/2026-03-29-widget-bootstrap.md`;
- актуальный дизайн и план по Story Browser epic-first иерархии: `docs/plans/2026-03-10-story-browser-epic-hierarchy-design.md`, `docs/plans/2026-03-10-story-browser-epic-hierarchy.md`;
- актуальный дизайн и план по shared team picker с UX как у выбора пользователей: `docs/plans/2026-04-01-shared-team-picker-redesign-design.md`, `docs/plans/2026-04-01-shared-team-picker-redesign.md`;
- актуальный дизайн и план по render-time user filter для User Activity: `docs/plans/2026-04-01-user-activity-render-time-user-filter-design.md`, `docs/plans/2026-04-01-user-activity-render-time-user-filter.md`;
- актуальный дизайн и план по отставанию внесения worklog в User Activity: `docs/plans/2026-04-01-user-activity-worklog-lag-design.md`, `docs/plans/2026-04-01-user-activity-worklog-lag.md`.

## Стабильные URL гаджетов и версия на дашборде (`releaseRef`)

### Что настраивается в Jira один раз

Рекомендуемый формат настройки гаджета в Jira: **один постоянный URL** на `*.bootstrap.js` с веткой `@main` на jsDelivr, **пустой** список CSS (стили подгружает bootstrap вместе с runtime), **без изменений** поле AMD module (то же публичное имя, что и у legacy bundle). Этот URL не нужно менять при каждом релизе виджета.

### Откуда берётся версия ассетов (не из «ручного SHA в гаджете»)

Версия набора файлов (`_ujgCommon.js`, CSS, `*.runtime.js`) задаётся **общим для всего дашборда** значением в **Jira Dashboard Entity Properties**:

- ключ: `ujg.dashboardReleaseRef` (строка — SHA коммита в репозитории ассетов, обычно полный SHA с GitHub `main`).

**Первый заход** на дашборд, если свойства ещё нет: bootstrap запрашивает актуальный коммит `main` через GitHub API (`/repos/.../commits/main`), при необходимости **сохраняет** полученный SHA в property дашборда и в этой же сессии грузит ассеты с этого ref. Если сохранить не удалось (права, сеть), для текущей загрузки всё равно используется полученный SHA; при полной недоступности Jira/GitHub используется **запасной** ref, вшитый в `*.bootstrap.js` при сборке (`node build-widget-bootstrap-assets.js`).

**Следующие загрузки** страницы дашборда: bootstrap читает `ujg.dashboardReleaseRef` и подгружает все ассеты с закреплённого SHA — набор остаётся согласованным.

### Обновление до последней версии с `main`

В теле гаджета отображается кнопка **«Обновить версию»**. По нажатию:

1. запрашивается свежий SHA с GitHub `main`;
2. если он отличается от текущего закреплённого, новый SHA **записывается** в `ujg.dashboardReleaseRef`;
3. выполняется **чистая перезагрузка страницы** (`location.reload`), чтобы все гаджеты и общий кэш загрузчиков вошли в состояние, согласованное с новым ref.

Если SHA совпадает с уже закреплённым, перезагрузки нет — обновляется только отображаемая метка версии.

Подробнее: обработка ошибок, REST-пути и почему выбран reload вместо hot-swap AMD в странице — в `docs/plans/2026-03-29-dashboard-release-ref-design.md`.

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

### Story Browser

`JavaScript URLs`

```text
https://cdn.jsdelivr.net/gh/skivbox-ii/jira@main/ujg-story-browser.bootstrap.js
```

`CSS URLs`

```text

```

`AMD module`

```text
_ujgStoryBrowser
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

### Sprint Health

`JavaScript URLs`

```text
https://cdn.jsdelivr.net/gh/skivbox-ii/jira@main/ujg-sprint-health.bootstrap.js
```

`CSS URLs`

```text

```

`AMD module`

```text
_ujgSprintHealth
```

### Project Analytics

`JavaScript URLs`

```text
https://cdn.jsdelivr.net/gh/skivbox-ii/jira@main/ujg-project-analytics.bootstrap.js
```

`CSS URLs`

```text

```

`AMD module`

```text
_ujgProjectAnalytics
```

### Timesheet v0

`JavaScript URLs`

```text
https://cdn.jsdelivr.net/gh/skivbox-ii/jira@main/ujg-timesheet.v0.bootstrap.js
```

`CSS URLs`

```text

```

`AMD module`

```text
_ujgTimesheet
```

Пересобрать committed `*.bootstrap.js` / `*.runtime.js` из текущих bundle: `node build-widget-bootstrap-assets.js` (обновляет вшитый fallback `releaseRef` в bootstrap; **операционная** версия на дашборде по-прежнему хранится в `ujg.dashboardReleaseRef`).

Если при нажатии **«Обновить версию»** запись property не удалась, страница не должна перезагружаться: виджет остаётся на текущем закреплённом ref до успешной записи.

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

