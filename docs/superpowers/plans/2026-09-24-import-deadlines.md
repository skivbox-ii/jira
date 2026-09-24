# Import Deadlines Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement task-by-task.

**Goal:** Срок из журнала в группах «Динамики» и сводка всей подтверждённой просрочки.

**Architecture:** Чистое извлечение срока отдельно от расчёта состояния группы. Существующие сводки и таблица используют один рассчитанный объект deadline; Excel и сохранённая таблица Jira не требуют новых API-запросов.

**Tech Stack:** AMD JavaScript, jQuery, существующий SheetJS, node:test/jsdom, локальный браузер и Citrix skill.

**Spec:** `docs/superpowers/specs/2026-09-24-import-deadlines-design.md`.

## Global Constraints

- Jira только read-only, без изменений тикетов, статусов, связей, назначений.
- Срок включителен до конца дня МСК; по уточнению пользователя сравниваем с сегодняшним днём, независимо от выбранной даты отчёта и часового пояса браузера. Источник по умолчанию: Excel `Срок`.
- Текущий срок журнала не выдаётся за историю переноса сроков.
- Пользователь просит саморевью без вопросов; работаем в существующем checkout `codex/import-registry-details`, сохраняя посторонние документы.
- Не выполнять живые LLM-запросы. Публиковать только после тестов и ревью, затем проверять UI через Citrix skill.

## Review Focus

- Строка без событий дня всё равно попадает в просрочку: Task 2/3.
- Полночь, исторический день, возврат и закрытая история с открытой QA: Task 2.
- Дата фактического завершения, неоднозначные форматы, Excel-эпоха, дубли ключа и конфликтующие сроки: Task 1/2.
- Неполная история, несуществовавшая задача, неизвестные статусы не дают ложного точного нуля: Task 2/3.
- Большие темы, безопасные ссылки, 6 показателей и сводка на 390px: Task 3/4.

## Task 1: Источник срока и маппинг

Files: `deadlines.js` (new module), config/parser/main/rendering (только маппинг), тесты deadlines/parser/mapping/enrichment.

Interface: `resolve(row, {columnMap,journalRows}) -> {date,raw,source,field,problem}` по spec; `state.deadlineJournalRows` содержит текущие Excel-строки в памяти.

- [x] Red: строгие даты, custom mapping, Jira imported table, источник Excel по точному ключу, конфликты и отсутствие подстановки из свободного текста.

```js
assert.equal(deadlines.resolve({sourceColumns:{'Срок исполнения':'25.09.2026'}}).date,'2026-09-25');
assert.equal(deadlines.resolve({sourceColumns:{'Срок исполнения':'31.02.2026'}}).problem,'invalid');
```

- [x] Реализовать чистый модуль и маппинг через существующие настройки. Сохранять дату без новых вызовов Jira и без вмешательства в создание задач.
- [x] Green: `node --test tests/excel-story-importer-deadlines.test.js tests/excel-story-importer-parser.test.js tests/excel-story-importer-mapping-store.test.js`.

## Task 2: Расчёт и экспорт

Files: activity.js, activity-ai.js, build-excel-story-importer.js; domain/AI tests и AMD wiring helpers.

- [x] Red: просроченное замечание без событий, сегодня/завтра, готово/отменено, незавершённый ребёнок, возврат, выбранный прошлый день, дубли и unknown coverage.

```js
assert.equal(result.events.length,0);
assert.equal(result.groups[0].deadline.state,'overdue');
assert.equal(result.metrics.overdue,1);
assert.equal(result.groups[0].deadline.daysOverdue,1);
```

- [x] Реализовать контракт групп и deadlineCoverage. Сводка не зависит от фильтров журнала. Сроки не меняют существующие метрики.
- [x] Добавить срок/просрочку в HTML и инструкцию LLM о текущем сроке журнала; не обрезать замечания без событий из экспортной сводки.
- [x] Green: domain, AI и экспортные тесты.

## Task 3: Заголовки и управленческая сводка

Files: activity-ui.js, activity-management-ui.js, CSS; соответствующие browser tests.

- [x] Red: шестой показатель, заголовок со сроком, жёлтые today/tomorrow, красный overdue, нейтральный completed, hover/click и независимость от фильтров.
- [x] Добавить срок последним элементом группового заголовка; deadlineCoverage в компактную строку под итогами.
- [x] Расширить существующие preview/full report для overdue: сначала максимальная просрочка, все строки, deadline/owner/pendingTasks с ключами и ролями, никаких новых мутационных действий.
- [x] Green: browser tests. Ранее реализованные даты готовности и переходы должны остаться без изменений.

## Task 4: Приёмка и публикация

Files: preview-bootstrap/startup tests, итоговые JS/runtime, backlog и журнал приёмки.

- [x] Дополнить локальную фикстуру сроками и сценарием без событий; даты вычислять от дня фикстуры.
- [x] Собрать только importer и его runtime. Полный существующий suite, diff --check.
- [x] Независимое ревью готового diff и устранение подтверждённых замечаний.
- [x] Скриншоты 1440x1000/390x844: заголовки, 6 итогов, overdue hover/full, прокрутка.
- [x] Публикация, сравнение CDN по SHA, read-only Citrix-проверка реальных сроков. Если в Jira нет источника срока, проверить честное отсутствие данных и загрузку журнала через UI, не выдумывать даты.
- [x] Обновить backlog с доказательствами; не отмечать production acceptance без скриншота.

## Саморевью плана

Все пункты spec распределены. Task 1 даёт источник и настройки, Task 2 единый расчёт, Task 3 только представляет рассчитанные поля. Общие файлы разделены по владельцам: rendering трогает только Task 1; activity/core и сборки только контроллер; activity UI и CSS только UI-исполнитель. Форматы контрактов одинаковы. Нестабильные внешние API не добавляются. Риск отсутствия срока в старом Jira-описании отражён в покрытии, не спрятан.
