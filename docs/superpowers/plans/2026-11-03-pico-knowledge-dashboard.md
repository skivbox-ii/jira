# Pico Knowledge Dashboard Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development, Sol 6.1 Author/Reviewer. Execute task-by-task after user review of this plan.

**Goal:** Отдельный чат в Jira, который отвечает по доступным пользователю материалам Confluence и Jira с проверяемыми источниками.

**Architecture:** Новый AMD-виджет использует существующий Pico runtime и LLM client. Отдельные read-only адаптеры возвращают нормализованные источники; слой evidence проверяет ссылки и полноту. Подключение Confluence выбирается только после проверки разрешённого транспорта.

**Tech Stack:** JavaScript AMD, существующий Pico 1.4.0, ujg-shared-modules/llm-client.js, node:test, CSS, существующая сборка bootstrap/runtime.

**Spec:** [Проект решения и результаты проверки доступа](../specs/2026-11-03-pico-knowledge-dashboard-design.md).

## Global Constraints

- Отдельный виджет; не менять пользовательское поведение импортера и помощника задач.
- Только чтение; существующее LLM-подключение, без новых провайдеров и секретов в браузерном хранилище.
- 20 результатов поиска, 8000 символов фрагмента, явная пагинация и полнота.
- 8 вызовов модели / 12 инструментов / 180 секунд на ход; контекст из настроек, default 32768, резерв 4096.
- Не использовать production вне Citrix. Запрос к LLM в Citrix запускает пользователь.
- Namespace `_ujgKnowledgeAssistant`, внутренние `_ujgKA_*`. Пользовательские multi-select — существующий Timesheet layout.
- Каждый этап: красный тест → реализация → зелёный тест → независимый Sol 6.1 Reviewer → проверка автором → тематический коммит. Публикация только после полной проверки.

## Review Focus

1. HTML login с HTTP 200 вместо JSON — Task 1.
2. Скрытые страницы, похожие названия, недоступный следующий фрагмент — Task 2.
3. Поддельная цитата и инструкции в документе — Task 3.
4. Ответ предыдущего запроса после смены пользователя/области — Task 4.
5. Два Pico-виджета в одном AMD-контексте — Task 5.

## Уточнение подключения, принятое 03.11.2026

Пользователь подтвердил реализацию нового виджета после проверки туннеля. Реальный Python bridge на Linux и SSH forwarding до Windows VDI проверены: GET http://127.0.0.1:8769/health → 200 JSON. Bridge предоставляет только GET /rest/api/user/current, /rest/api/content/search, /rest/api/content/<digits>; OPTIONS; bearer Authorization передаётся конкретному Confluence upstream. CORS разрешает origin Jira. Авторизация Confluence и browser fetch из Jira ещё не приняты.

Виджет размещается в Jira, использует её session API напрямую. Confluence transport: настраиваемый loopback baseUrl, bearer token через getToken() только в памяти вкладки. Токен не попадает в историю, настройки, диагностику, LLM, URL, логи, репозиторий. Истинность Confluence identity подтверждается через user/current, а не /health. Без успешной проверки входа интерфейс явно показывает незавершённое подключение, но локальные этапы разработки продолжаются. Не требовать изменений CORS на Confluence и не считать прежний PowerShell script транспортом нового виджета.

## Task 1: подтвердить транспорт и реализовать контракт чтения

**Files:** create `ujg-knowledge-assistant-modules/transport.js`, `confluence-api.js`, `jira-api.js` в том же каталоге; `tests/knowledge-assistant-api.test.js`; `docs/knowledge-assistant-connection.md`.

**Interfaces:** `createTransport({baseUrl, fetchImpl, mode}) → {getJson(path, query, {signal})}`; mode `session` либо `bridge`. Ответ JSON; ошибки `{code, message, retryAfter}` без токенов. Bridge baseUrl настраивается пользователем, разрешён только HTTP loopback или HTTPS; credentials omit, redirect error, Authorization берётся из getToken() в памяти. Jira session использует credentials same-origin. В обоих режимах разрешён только фиксированный список read API endpoints; getJson не является универсальным прокси. Адаптеры экспортируют `search({text, scopes, cursor, signal}) → {items, nextCursor, warnings}` и `read({id, offset, signal}) → {source, text, total, nextOffset, warnings}`. Source: `{id, kind, title, url, version, updatedAt, fetchedAt}`.

- [ ] Реализовать настраиваемый Python bridge transport из уточнения выше и Jira session transport. Описать endpoint/auth в connection.md. Локальные тесты на заглушках; реальную проверку JSON/identity/доступа в Citrix выполняет контроллер. Без неё не объявлять production transport ready.
- [ ] Написать тесты `rejectsLoginHtml200`, `rejectsForeignOriginAndWriteMethods`, `escapesSearchAndEnforcesScopes`, `maps401403429`, `abortsRequest`. Assert: HTML не возвращается как данные; нет POST/PUT/DELETE; запрос не расширяет scopes.
- [ ] Запустить `node --test tests/knowledge-assistant-api.test.js`, убедиться в ожидаемом FAIL.
- [ ] Реализовать контракт и адаптеры на fetchImpl. Не переносить write API помощника задач. Неподтверждённый bridge mode возвращает понятное «Подключение не настроено».
- [ ] Повторить команду, ожидать PASS; провести review и коммит этапа.

## Task 2: нормализация источников и инструменты

**Files:** create `ujg-knowledge-assistant-modules/evidence.js`, `tools.js`; `tests/knowledge-assistant-evidence.test.js`, `tests/knowledge-assistant-tools.test.js`.

**Interfaces:** `createEvidenceStore({identityKey}) → {put(readResult), get(sourceId), clear()}`. `createTools({confluence, jira, evidence, getScopes})` создаёт четыре инструмента спецификации с валидируемыми схемами. Search result: `{id,title,url,excerpt}`; read result использует Task 1. Evidence хранит прочитанные диапазоны и предупреждения, не только идентификатор страницы.

- [ ] Тесты: 21 результат требует nextCursor; 8001 символ требует nextOffset; таблица сохраняет заголовки/ячейки; неизвестный макрос даёт warning; 403 следующей части оставляет источник неполным; одноимённые страницы имеют разные sourceId.
- [ ] Run `node --test tests/knowledge-assistant-{evidence,tools}.test.js`, ожидаемый FAIL.
- [ ] Реализовать разбор поддерживаемого HTML в текст без исполнения разметки, chunking без молчаливой обрезки, проверку scopes на каждом read, защиту от повторяющегося курсора.
- [ ] Повторить тесты до PASS, review, коммит этапа.

## Task 3: Pico и ответы с доказательствами

**Files:** create `ujg-knowledge-assistant-modules/skills.js`, `chat.js`; `tests/knowledge-assistant-chat.test.js`. Reference existing `ujg-ticket-assistant-chat/README.md`, `ujg-shared-modules/llm-client.js`.

**Interfaces:** `createKnowledgeChat({requestText, tools, evidence, getContext, onEvent}) → {prompt, abort, getMessages, dispose}` поверх vendor createSession. `getContext()` возвращает identity/scopes и выбранный skill. `validateCitations(answer, evidence)` разрешает только прочитанные диапазоны и возвращает `{answer, warnings}`; неподтверждённые утверждения не помечаются подтверждёнными.

- [ ] Заглушечные тесты: DevOps search→read→answer; выдуманный sourceId; цитата по одному поисковому сниппету; документ с просьбой раскрыть секрет; конфликт двух версий; предел 12 tools; прерванный ход; исчерпанный контекст.
- [ ] Run `node --test tests/knowledge-assistant-chat.test.js`, ожидаемый FAIL.
- [ ] Подключить Pico через существующий requestText; системный контракт отделить от редактируемого skill и текстов источников. Сжатие старых ходов не превращает историческую ссылку в свежепрочитанный источник.
- [ ] Повторить тесты до PASS, review, коммит этапа. Живую LLM не вызывать.

## Task 4: компактный чат и настройки

**Files:** create `ujg-knowledge-assistant-modules/storage.js`, `ui.js`, `main.js`; `ujg-knowledge-assistant.css`; `tests/knowledge-assistant-ui.test.js`, `tests/knowledge-assistant-storage.test.js`; `standalone/knowledge-assistant-preview.html`.

**Interfaces:** `mount(root, {chat, connection, identity, storage}) → {dispose}`; storage namespace `ujg.knowledgeAssistant.v1:<origin>:<user>`, хранит настройки/диалог, но не токены или корпус страниц. Main связывает зависимости Tasks 1–3. Epoch запроса меняется при смене пользователя/scopes и dispose.

- [ ] Тесты: поздний ответ не появляется после смены scopes; история другого пользователя недоступна; persisted sources отмечены историческими; Markdown не исполняет script/javascript URLs; кнопка stop отменяет запрос; ошибки авторизации содержат действие для восстановления.
- [ ] Run `node --test tests/knowledge-assistant-{ui,storage}.test.js`, ожидаемый FAIL.
- [ ] Реализовать компактную шапку, чат, карточки источников, раскрытие прочитанных фрагментов, редактирование skill через «Применить», настройки подключения и явный статус полноты. Исторические источники перечитывать перед новым ответом.
- [ ] Повторить тесты до PASS. Лично пройти заглушечный DevOps-сценарий в 1440/390 px, длинный ответ, ошибки, stop/retry; сохранить скриншоты. Review и коммит этапа.

## Task 5: сборка, публикация и реальная приёмка

**Files:** create `build-knowledge-assistant.js`; generated `ujg-knowledge-assistant.js`, `.runtime.js`, `.bootstrap.js`; modify `build-widget-bootstrap-assets.js`, `README.md`; create `tests/knowledge-assistant-build.test.js`, `docs/knowledge-assistant-acceptance.md`.

**Interfaces:** public AMD `_ujgKnowledgeAssistant`. Новый builder встраивает проверенный Pico с именем `_ujgKA_picoRuntime`, не меняя vendor-файл и AMD-регистрацию помощника задач. Bootstrap использует существующий механизм pinned commit.

- [ ] Написать тесты отдельной сборки, отсутствия секретов/внутренних hardcoded hostnames в runtime, двух независимых виджетов в одном AMD-контексте, dispose одного без поломки второго.
- [ ] Run `node --test tests/knowledge-assistant-build.test.js`, ожидаемый FAIL.
- [ ] Реализовать builder и bootstrap spec; собрать через `node build-knowledge-assistant.js`, затем существующий bootstrap build-процесс согласно актуальному README.
- [ ] Run `node --test tests/*.test.js`, ожидать PASS; лично проверить совместное размещение обоих виджетов, затем независимое итоговое review.
- [ ] Закоммитить проверенные артефакты; публикация после разрешения пользователя, проверить pinned CDN байты. Записать точные настройки установки нового дашборда.
- [ ] В Citrix выполнить доступ к реальным источникам, затем пользователь запускает вопрос DevOps. Сверить ответ и ссылки с исходными страницами. Записать реальные результаты/ограничения; не заменять эту приёмку локальными тестами.

## Текущий следующий шаг

Реализовать этапы 1–5 по уточнённому подключению. Реальная приёмка Confluence ждёт пользовательского ввода PAT в интерфейсе; LLM-запуск оставлен пользователю. Не путать сервер /health с готовым виджетом или подтверждённым доступом к данным.

## Ход реализации 03.11.2026

- Task 1 завершён локально: e67ff94 / 49e6448, 38/38 тестов, повторное Sol 6.1 ревью без открытых замечаний. Авторизация защищена от устаревших ответов.
- Task 2 завершён локально: e4a2841 / a1fa9b2, 62/62 теста вместе с API, повторное Sol 6.1 ревью без открытых замечаний. Пустые ячейки сохраняются, неподдерживаемые объединения явно неполны.
- Task 3 завершён локально: d31b968, 26 целевых и 87 смежных проверок; Sol 6.1 review без замечаний.
- Task 4 завершён локально: b4e475d / c65531f / 6f8b282, 23 целевых и 1657 root unit-проверок; личный Chrome 1440/390, повторное review без открытых замечаний. Полная история сохраняется раздельно по проверенной личности; известные PAT маскируются и после замены, числовые ID и код не меняются.
- Task 5 локальная сборка завершена: 489d90d, scoped review без замечаний, 5/5 build + 203/203 интеграции; полный регресс контроллера 2292/2292. Bootstrap перепривязан к полному SHA 66c7e83f6f743383dc0ad1a90b576152cc86eab9, 49/49 build/bootstrap после перепривязки. Итоговое review/публикация в работе; Citrix-приёмка открыта.
- Итоговое review и один пакет интеграционных исправлений завершены: 66c7e83, principal-проверки до записи вопроса и на асинхронных границах, сохранение memory-only истории при Apply, точный текст пересекающихся диапазонов. Scoped re-review без открытых замечаний; повторный полный регресс 2292/2292, личный Chrome 1440/390 и три исправленных сценария пройдены. Тестовый помощник сборки больше не записывает общий bundle (4f33740); параллельные build/bootstrap 49/49. Публикация и Citrix-приёмка пока не объявлены завершёнными.
