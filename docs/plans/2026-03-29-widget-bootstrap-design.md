# Stable Bootstrap URLs for UJG Widgets — Design

## Контекст

Сейчас виджеты подключаются в Jira Dashboard через `jsDelivr` URL, зафиксированные на конкретный commit SHA:

- `_ujgCommon.js`
- widget JS bundle
- widget CSS

После каждого обновления нужно вручную менять SHA в настройке гаджета. Это неудобно и плохо масштабируется, особенно когда виджетов несколько.

Наивная замена SHA на `@main` решает только часть проблемы: URL становится стабильным, но `_ujgCommon.js`, widget JS и CSS могут обновляться в CDN не одновременно. В результате пользователь временно получает рассинхрон ассетов одной логической версии.

## Цель

Сделать так, чтобы:

1. В Jira настройка гаджета менялась один раз.
2. После этого URL больше не нужно было редактировать руками.
3. Каждый запуск виджета загружал согласованный набор ассетов одной версии.
4. Уже существующие конфигурации на прямых `ujg-*.js` URL не ломались.

## Область

Решение нужно сразу для всех виджетов:

- `Sprint Health`
- `Project Analytics`
- `Timesheet`
- `Timesheet v0`
- `User Activity`
- `Daily Diligence`

## Рекомендованное решение

Добавить для каждого виджета **стабильный bootstrap entrypoint**, который публикуется по URL на `@main` и сам догружает нужные ассеты по **вшитому immutable release ref**.

Идея:

- Jira gadget config указывает только на `*.bootstrap.js`
- bootstrap экспортирует публичный AMD module, который Jira уже ждёт
- bootstrap догружает `_ujgCommon.js`, widget CSS и widget runtime JS одной и той же release-версии
- после загрузки bootstrap создаёт реальный gadget instance

Это убирает ручную замену SHA в Jira config и при этом не смешивает разные версии CSS/JS.

## Почему не просто `@main`

`jsDelivr` кэширует URL независимо. Если использовать:

- `...@main/_ujgCommon.js`
- `...@main/ujg-daily-diligence.js`
- `...@main/ujg-daily-diligence.css`

то в короткое окно после релиза можно получить:

- новый JS + старый CSS
- новый widget bundle + старый `_ujgCommon.js`
- старый bootstrap state в браузере

Bootstrap со встроенным release ref решает именно эту проблему согласованности.

## Архитектура

### 1. Публичные legacy bundles остаются как есть

Существующие файлы сохраняются без слома обратной совместимости:

- `ujg-sprint-health.js`
- `ujg-project-analytics.js`
- `ujg-timesheet.js`
- `ujg-timesheet.v0.js`
- `ujg-user-activity.js`
- `ujg-daily-diligence.js`

Они продолжают работать для уже настроенных гаджетов.

### 2. Добавляются runtime bundles

Для bootstrap-пути вводятся новые файлы:

- `ujg-sprint-health.runtime.js`
- `ujg-project-analytics.runtime.js`
- `ujg-timesheet.runtime.js`
- `ujg-timesheet.v0.runtime.js`
- `ujg-user-activity.runtime.js`
- `ujg-daily-diligence.runtime.js`

Эти файлы экспортируют **внутренние runtime AMD modules**, не конфликтующие с публичными именами Jira gadgets.

Пример:

- public AMD: `_ujgDailyDiligence`
- runtime AMD: `_ujgDailyDiligenceRuntime`

Для модульных виджетов runtime-файл можно генерировать из уже собранного bundle. Для `Timesheet` и `Timesheet v0`, где публичный модуль задан прямо в файле, нужен такой же трансформирующий runtime-вывод с переименованием AMD name.

### 3. Добавляются bootstrap entrypoints

Для каждого виджета появляется стабильный файл:

- `ujg-sprint-health.bootstrap.js`
- `ujg-project-analytics.bootstrap.js`
- `ujg-timesheet.bootstrap.js`
- `ujg-timesheet.v0.bootstrap.js`
- `ujg-user-activity.bootstrap.js`
- `ujg-daily-diligence.bootstrap.js`

Каждый bootstrap:

1. Определяет публичный AMD module Jira gadget-а.
2. На первом запуске загружает:
   - `_ujgCommon.js`
   - widget CSS
   - widget runtime JS
3. Делает это по URL, зафиксированным на один `releaseRef`.
4. После загрузки вызывает runtime gadget constructor с тем же `API`.

### 4. Источник версии

В bootstrap при генерации вшивается `releaseRef`, например короткий SHA текущего `HEAD`.

Пример логики:

- build-time value: `ed616c5`
- bootstrap URL в Jira: `https://cdn.jsdelivr.net/gh/skivbox-ii/jira@main/ujg-daily-diligence.bootstrap.js`
- runtime URLs, которые bootstrap строит сам:
  - `https://cdn.jsdelivr.net/gh/skivbox-ii/jira@ed616c5/_ujgCommon.js`
  - `https://cdn.jsdelivr.net/gh/skivbox-ii/jira@ed616c5/ujg-daily-diligence.runtime.js`
  - `https://cdn.jsdelivr.net/gh/skivbox-ii/jira@ed616c5/ujg-daily-diligence.css`

Так Jira config остаётся стабильным, а загружаемый набор файлов всегда консистентен.

## Генерация файлов

Рекомендованный путь: один новый генератор, который читает уже существующие widget bundles и выпускает две производные группы файлов:

1. `*.runtime.js`
2. `*.bootstrap.js`

То есть не нужно ломать или переписывать текущие build-скрипты виджетов. Новый генератор просто работает поверх уже собранных артефактов.

## Runtime behavior

Bootstrap должен:

- не дублировать `<script>` и `<link>` при повторной инициализации
- переиспользовать уже начатую загрузку, если на странице два одинаковых gadget instance
- явно ждать завершения загрузки runtime JS перед `require(runtimeModule)`
- отдавать понятную ошибку в консоль, если любой ассет не загрузился

Для этого используется общий глобальный cache, например:

- `window.__UJG_BOOTSTRAP__.scriptPromises`
- `window.__UJG_BOOTSTRAP__.stylePromises`

## Настройка Jira после перехода

После rollout конфигурация становится простой.

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

То есть CSS больше не задаётся отдельно в Jira config: его догружает bootstrap той же версии.

## Таблица соответствия

| Widget | Stable JS URL | Public AMD | Runtime file | Runtime AMD |
|---|---|---|---|---|
| Sprint Health | `ujg-sprint-health.bootstrap.js` | `_ujgSprintHealth` | `ujg-sprint-health.runtime.js` | `_ujgSprintHealthRuntime` |
| Project Analytics | `ujg-project-analytics.bootstrap.js` | `_ujgProjectAnalytics` | `ujg-project-analytics.runtime.js` | `_ujgProjectAnalyticsRuntime` |
| Timesheet | `ujg-timesheet.bootstrap.js` | `_ujgTimesheet` | `ujg-timesheet.runtime.js` | `_ujgTimesheetRuntime` |
| Timesheet v0 | `ujg-timesheet.v0.bootstrap.js` | `_ujgTimesheet` | `ujg-timesheet.v0.runtime.js` | `_ujgTimesheetV0Runtime` |
| User Activity | `ujg-user-activity.bootstrap.js` | `_ujgUserActivity` | `ujg-user-activity.runtime.js` | `_ujgUserActivityRuntime` |
| Daily Diligence | `ujg-daily-diligence.bootstrap.js` | `_ujgDailyDiligence` | `ujg-daily-diligence.runtime.js` | `_ujgDailyDiligenceRuntime` |

## Обратная совместимость

Это решение не требует мигрировать все гаджеты сразу.

Можно:

- оставить старые direct configs как есть
- для новых или пересобираемых gadget configs использовать bootstrap URLs
- переводить виджеты по одному

## Ограничения

- Bootstrap URL на `@main` всё ещё зависит от обновления CDN alias и browser cache. То есть новая версия может появиться не мгновенно.
- Но даже при этой задержке bootstrap всегда тянет **согласованный** набор файлов одной release-версии.
- Если позже понадобится ускорить rollout, можно отдельно добавить purge/manual refresh процесс, не меняя саму архитектуру bootstrap.

## Тестирование

Нужно покрыть:

1. Генерацию runtime-модулей с правильным AMD name.
2. Генерацию bootstrap-файлов с правильным `releaseRef`.
3. Дедупликацию script/style загрузок.
4. Корректный запуск runtime gadget после завершения загрузки.
5. Особые случаи `Timesheet` и `Timesheet v0`.

## Итог

Решение с `*.bootstrap.js` + `*.runtime.js` даёт:

- один стабильный URL в Jira config
- отсутствие ручной замены SHA
- согласованную версию `_ujgCommon.js`, CSS и widget JS
- обратную совместимость со старыми конфигурациями
- единый паттерн сразу для всех UJG-виджетов
