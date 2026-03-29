# Dashboard `releaseRef` rollout — implementation plan

## Цель

Зафиксировать в коде и эксплуатации **итоговую** модель:

- стабильный URL `*.bootstrap.js` в конфиге Jira (`@main`);
- общий для дашборда `releaseRef` в **Dashboard Entity Property** под ключом `ujg.dashboardReleaseRef`;
- автоматическая инициализация property с SHA `main` с GitHub при первом отсутствии значения;
- кнопка **«Обновить версию»**: записать последний SHA с `main`, затем **перезагрузить страницу**;
- следующие загрузки дашборда используют закреплённый в property SHA для всех связанных ассетов.

## Не входит в этот план (сознательно отклонено)

- **In-page AMD hot-swap** без перезагрузки: не целевой путь; см. обоснование в `2026-03-29-dashboard-release-ref-design.md`.
- Замена глобального подхода на отдельный ref **на гаджет** (out of scope: один ref на дашборд для согласованности).

## Этапы

### 1. Общий слой в сгенерированных bootstrap

- Реализованы чтение/запись `ujg.dashboardReleaseRef` (REST и/или `api.getDashboardProperty` / `api.setDashboardProperty` при наличии).
- `dashboardId` определяется из URL и `AJS.params`.
- Кэш на странице хранится в `window.__UJG_BOOTSTRAP__.runtimeReleaseRef`, `runtimeReleaseRefPromise`, `refreshPromise`.
- Функция разрешения ref работает по схеме: property → при отсутствии GitHub `commits/main` → сохранить property (best-effort) → при ошибках вшитый `releaseRef` из генератора.
- URL строятся как `assetBaseUrl + "@" + encodeURIComponent(ref) + "/" + fileName`.

### 2. Загрузка ассетов и runtime

- Публичное AMD-имя гаджета остаётся прежним.
- После разрешения ref bootstrap грузит common, CSS и runtime через `loadScriptOnce` / `loadStyleOnce`, затем делает `require(runtimeAmd)`.

### 3. UI обновления версии

- Тулбар с кнопкой «Обновить версию» и короткой меткой ref монтируется самим bootstrap.
- Обработчик сравнивает текущий и GitHub SHA; при изменении делает `PUT` property и затем `location.reload()`.

### 4. Генератор

- `build-widget-bootstrap-assets.js` продолжает подставлять build-time `releaseRef` как **fallback** в каждый `*.bootstrap.js`.
- Все шесть generated `*.bootstrap.js` используют один и тот же property key `ujg.dashboardReleaseRef`, одинаковую схему fallback и одинаковый refresh-flow с reload.
- После изменения шаблона генератора обязательна пересборка `node build-widget-bootstrap-assets.js`; sync-проверка в `tests/widget-bootstrap.test.js` должна оставаться зелёной.

### 5. Тесты и регрессия

- `tests/widget-bootstrap.test.js` расширен и покрывает сценарии property, GitHub, refresh, early-click и single-flight refresh.
- Ручная проверка на Jira: первый визит, повторный визит, обновление версии, права на property.

## Критерии готовности

- На чистом дашборде без property после открытия появляется property с SHA (при успешных GitHub + Jira write).
- Повторная загрузка дашборда не дергает GitHub, если property уже задан (кроме сценария refresh).
- «Обновить версию» после нового коммита в `main` обновляет property и после reload гаджеты грузят новые ассеты.
- При недоступности GitHub/Jira виджет деградирует на вшитый ref без полного отказа страницы (в пределах оговорённой логики ошибок).

## Документация

- Пользовательская и операционная сводка: корневой `README.md`.
- Дизайн: `docs/plans/2026-03-29-dashboard-release-ref-design.md`.

## Ссылки на предыдущую итерацию

Исторический план bootstrap с акцентом на **только** вшитый release ref: `docs/plans/2026-03-29-widget-bootstrap.md`. Текущий документ **заменяет** для эксплуатации идею единственного build-time pin как единственного источника истины; источник истины для дашборда — **entity property** + опционально GitHub при инициализации/refresh.
