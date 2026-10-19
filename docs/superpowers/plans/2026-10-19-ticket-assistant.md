# Jira Ticket Assistant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Отдельный универсальный гаджет подготавливает один тикет из свободного текста по редактируемым правилам, задаёт уточнения и создаёт его только по явному действию пользователя.

**Architecture:** Изолированные AMD-модули нового `ujg-ticket-assistant`, собственные CSS, bundle и bootstrap. Существующий LLM-клиент используется без изменения транспорта; Jira-адаптер читает реальные create metadata, а чистые валидаторы формируют разрешённый payload. Состояние черновика, предложения LLM и результат записи разделены, чтобы поздние ответы и повторы не портили данные.

**Tech Stack:** JavaScript, AMD, существующий jQuery, Jira REST v2, localStorage, Node `node:test`, существующий AMD test helper, JSDOM и Playwright только для локальных проверок. Без нового runtime-фреймворка и root `package.json`.

**Spec:** `docs/superpowers/specs/2026-10-19-ticket-assistant-design.md`, подтверждена пользователем 19.10.2026. Этот план ожидает ревью; продуктовый код ещё не менялся.

## Global Constraints

- «Существующий `ujg-shared-modules/llm-client.js` используется без нового провайдера и без изменения настроек соединения других гаджетов».
- «Новый собственный bundle, CSS, AMD-имена и bootstrap. Импортёр сохраняется».
- «В первой версии обычная задача одного проекта. Подзадачи, пакетное создание, автоматическое дробление работ и изменение существующих тикетов исключены».
- «Шаблон и тип Jira различаются»; числовые ID не зашиваются, привязка проверяется по текущему проекту.
- «Изменяемые пользователем тексты задают содержание, но не управляют API».
- «LLM не запускается при каждом вводимом символе»; нет молчаливого обрезания входного текста, правил или каталогов.
- «URL из текста не открываются автоматически»; содержимое файлов, cookies, Jira-токены и ключи подключения не входят в промпт.
- «Один явный POST создания на действие»; неизвестный результат не повторяется автоматически и не считается неуспехом.
- «Создание связей отдельным API не входит в первую версию»; ссылка на историю может быть частью описания.
- «Все LLM и write-сценарии тестируются на заглушках»; Citrix только после передачи управления, read-only. Живые генерацию и создание запускает пользователь.
- Личные настройки по пользователю/проекту; JSON-перенос без секретов и черновиков. Нет общей админки и серверной базы профилей.
- AGENTS.md: searchable dropdown, выбранные люди закреплены chips и исключены из кандидатов; не вводить native select и новую схему таблиц.
- Предпочтение: Sol 6.1 Author/Reviewer, medium; перед запуском сверить доступные модели инструментов. Не создавать отдельные пользовательские задачи.

## Review Focus

1. Смена проекта/пользователя и повторные вкладки: ни чужой профиль, ни поздний ответ не попадают в текущий черновик; конфликт сохранения видим. Тесты T1, T3, T5.
2. Меняющиеся или неполные metadata: одинаковые подписи разных ID, удалённая опция, серверный default и неизвестное обязательное поле не превращаются в угадывание payload. Тесты T2, T8.
3. Кириллица, многострочный текст и вредоносный JSON: лимит измеряется в UTF-8; прототипы, HTML и вложенные команды не исполняются и не попадают в API. Тесты T1, T2, T4, T6.
4. Сбой в момент POST, перезагрузка и частично загруженные вложения: ключ и неопределённость сохраняются; повтор не создаёт второй тикет. Тесты T3, T8, T9.
5. Совместное размещение и длинный мобильный редактор: AMD/CSS не конфликтуют с импортёром, прогресс не крадёт фокус/прокрутку, закрытие снимает таймеры/запросы. Тесты T6, T7, T9.

## Порядок И Границы Файлов

Рабочая точка на момент планирования: `8105ede`, ветка `codex/import-registry-details`. Посторонние `.DS_Store` и untracked документы не включать. Перед исполнением перечитать git/process state, применить `using-git-worktrees`; предпочесть подходящую уже прикреплённую рабочую копию. Не создавать изоляцию или запускать авторов на этапе планирования.

| Файлы | Ответственность | Этап |
| --- | --- | --- |
| `ujg-ticket-assistant-modules/profiles.js`, `storage.js` | Профили/шаблоны, перенос и личное хранение | T1 |
| `ujg-ticket-assistant-modules/api.js`, `fields.js`, `validation.js` | Чтение Jira, нормализация схем, типы/кодеки/проверка полей | T2 |
| `ujg-ticket-assistant-modules/draft.js` | Ревизии, ручные правки, вопросы, устойчивое состояние | T3 |
| `ujg-ticket-assistant-modules/ai.js` | Промпт, лимиты, строгий разбор ответов | T4 |
| `ujg-ticket-assistant-modules/controller.js` | Подготовка/проверка, отмена и актуальность | T5 |
| `ujg-ticket-assistant-modules/field-ui.js`, `ui.js`, `main.js` | Поля, редактор и lifecycle гаджета | T6 |
| `ujg-ticket-assistant-modules/settings-ui.js` | Редактор правил и шаблонов, импорт/экспорт | T7 |
| `ujg-ticket-assistant-modules/creator.js` | Preflight, запись, неопределённость, вложения | T8 |
| `build-ticket-assistant.js`, `ujg-ticket-assistant.css` | Собственная сборка и изолированный стиль | T6 |
| `ujg-ticket-assistant.js`, `.runtime.js`, `.bootstrap.js` | Генерируемые файлы, не редактировать вручную | T6–T9 |
| `tests/helpers/ticket-assistant-fixture.js` | Небольшие фабрики тестовых metadata/хранилища/транспорта | T1–T8 |
| `tests/ticket-assistant-*.test.js` | Чистая логика, API и сборка | Соответствующий этап |
| `tests/browser/ticket-assistant-*.test.cjs` | JSDOM-регрессии интерфейса | T6–T8 |
| `tests/browser/ticket-assistant-preview.{html,cjs}`, `ticket-assistant-preview-server.cjs` | Изолированный локальный стенд без внешней сети | T6 |
| `tests/browser/ticket-assistant-acceptance.cjs` | Playwright desktop/mobile, сквозные сценарии | T9 |
| `build-widget-bootstrap-assets.js`, `tests/widget-bootstrap.test.js` | Только регистрация и проверка нового виджета | T6 |
| `README.md`, `tests/browser/README.md`, `docs/ticket-assistant-acceptance-2026-10-19.md` | Установка, запуск, фактические доказательства/ограничения | T9 |

Не менять модули импортёра и общий LLM-клиент. Если обнаружится необходимое изменение общего контракта, остановить этот участок, описать причину и пересмотреть план вместо скрытого расширения работ.

## Общие Контракты

Типы ниже описывают plain JS objects, не вводят TypeScript или новый framework.

- `Settings = {schemaVersion:1, revision:number, activeProfileId:string, profiles:Profile[]}`; `Profile = {id,name,instructions,allowAssignee:boolean,templates:Template[]}`; `Template = {id,name,whenToUse,instructions,issueTypeId:string|null}`. DEVOPS по умолчанию `allowAssignee:false`, универсальный профиль также не выбирает человека сам. Разрешить ручной выбор можно явно в настройках.
- `Meta = {projectKey,projectId,issueTypes:IssueType[],signature}`; `IssueType = {id,name,subtask,fields:FieldSpec[]}`. `FieldSpec` содержит `id,name,kind,required,supported,writable,hasDefaultValue,defaultValue,allowedValues,optionsComplete,autoCompleteUrl`. Только schema-поля определяют кодек, не подпись.
- Значения `Draft.fields` хранятся в нормализованной форме: строки/числа, `{id}` для опций, `{name}` для Jira Server user, массивы этих значений. Подписи берутся из metadata/результатов явного выбора, не используются как ID. JSON `null` обозначает очищенное значение, не разрешение отправить неизвестное поле.
- `Draft = {schemaVersion:1,id,projectKey,issueTypeId,templateId,source,fields,protectedFields,pendingFields,questions,warnings,evidence,sourceRevision,settingsRevision,draftRevision,metaSignature,checked,creation,attachments}`. `checked` равен `null` либо точному снимку `{sourceRevision,settingsRevision,draftRevision,metaSignature}`.
- `creation = {status:'idle'|'preflight'|'submitting'|'created'|'rejected'|'unknown',attemptId,issueKey,error}`. Сериализованное `submitting` после reload становится `unknown`; уже известный ключ не теряется при смене проекта. Новая задача начинается только явным действием.
- `Question = {id,text,reason,required:boolean}`; `Evidence = {fieldId,kind:'source'|'suggestion',quote:string}`. Исходная цитата должна буквально присутствовать в текущем `source`; предложения не объявляются фактами.
- `Validation = {ok:boolean,fieldErrors:Record<string,string[]>,warnings:string[],unsupportedRequired:string[]}`. Неподдерживаемое обязательное поле блокирует создание, если нет подтверждённого применимого server default.
- `WorkflowState = {draft,settings,meta,projects,stage,startedAt,error,validation,routeCandidates}`. Этапы: `idle|metadata|routing|preparing|checking|stopped|error`; запись имеет отдельное состояние `creation`. `init()` получает identity и создаёт store до чтения личных данных, повторный init со сменой identity полностью разрывает прежнюю область.
- `RequestOptions = {signal?:AbortSignal}`. Jira-адаптер возвращает Promise; отмена чтения вызывает jqXHR.abort. LLM получает abort через обёртку fetch, а не через изменение shared client. После передачи POST отмена интерфейса не доказывает отмену записи.

## Исполнение И Проверки

Каждый T1–T8 проходит RED → GREEN → независимое ревью → ограниченный коммит. До GREEN тест должен падать по ожидаемому отсутствию/поведению функции, не из-за среды. Общий прогон выполняется в T9, не повторяется без изменения кода. Команды ниже запускаются из корня согласованной рабочей копии.

Чистые тесты используют `node:test`, `node:assert/strict`, `tests/helpers/load-amd-module.js`. Для JSDOM/Playwright использовать существующую среду из `tests/browser/README.md`: сначала проверить доступные зависимости, не устанавливать их повторно в репозиторий. В приведённых командах предполагается `NODE_PATH=/tmp/ujg-import-registry-test/node_modules`; при другой фактической среде зафиксировать найденный путь в отчёте. До общего прогона предпочесть уже проверенный Node 24.19.0, если он доступен; не менять системную версию.

### T1: Редактируемые Профили И Личное Хранение

**Files:** создать `ujg-ticket-assistant-modules/profiles.js`, `storage.js`, `tests/ticket-assistant-profiles.test.js`, `tests/ticket-assistant-storage.test.js`, `tests/helpers/ticket-assistant-fixture.js`.

**Interfaces:**
- `profiles.createDefaults() -> Settings`: независимые копии универсального и DEVOPS-профиля с тремя шаблонами из спецификации.
- `profiles.validateSettings(input) -> {ok,errors,value:Settings|null}`, `exportSettings(settings) -> string`, `parseSettingsImport(text) -> {ok,errors,preview,value}`. Явный allowlist, версия 1, уникальные ID, запрет `__proto__/constructor/prototype` во всём дереве.
- `storage.createStore({storage,origin,userKey,onWarning}) -> {load(projectKey),save(projectKey,value,expectedRevision),clearDraft(projectKey,expectedRevision)}`. `load` возвращает `{revision,settings,draft}`; `save` возвращает `{ok,revision,reason}`. Ключ: `ujg-ticket-assistant:v1:` + URL-encoded origin/userKey/projectKey.
- Test helper: `memoryStorage()` с Web Storage интерфейсом; `loadUnit(name,deps,globals)` использует существующий AMD helper. Неизвестный пользователь работает в памяти, не пишет anonymous-ключ.

- [ ] **1. Написать failing tests** для личной области, конфликта ревизии, редактирования/дублирования шаблона, чистого JSON-экспорта и отказа повреждённого импорта. Минимальные assertions:

```js
test('defaults are independent and have three editable templates', () => {
  const a = profiles.createDefaults(), b = profiles.createDefaults();
  assert.equal(a.profiles[0].templates.length, 3);
  a.profiles[0].instructions = 'Мои правила';
  assert.notEqual(b.profiles[0].instructions, a.profiles[0].instructions);
});
test('unknown import version and prototype keys are rejected', () => {
  assert.equal(profiles.parseSettingsImport('{"schemaVersion":2}').ok, false);
  assert.equal(profiles.parseSettingsImport('{"__proto__":{"admin":true}}').ok, false);
});
```

  В storage-тестах: Alice/DO не читается Bob/DO и Alice/APP; stale `expectedRevision` даёт `reason:'conflict'` без перезаписи; quota/security exception сохраняет память и вызывает `onWarning`. Экспорт объекта с лишними `apiKey/source/draft/attachments` не содержит этих ключей.
- [ ] **2. RED:** `node --test tests/ticket-assistant-profiles.test.js tests/ticket-assistant-storage.test.js`; ожидается FAIL отсутствующих новых модулей/экспортов.
- [ ] **3. Реализовать interfaces** с JSON-парсером и явным копированием разрешённых полей. Сохранение возвращает конфликт, UI решит его в T7; `storage` event обнаруживает внешнее изменение, но не перезаписывает открытый ввод. Проверка ревизий localStorage не объявляется атомарной межвкладочной блокировкой. Записать полные стартовые тексты из спецификации, включая допустимое отсутствие story-связи и исключение для полевых логов. Черновики/файлы не входят в экспорт профиля.
- [ ] **4. GREEN:** та же команда; PASS всех новых тестов. Проверить, что shared LLM config не читается/не меняется этим модулем.
- [ ] **5. Review/commit:** свежий Reviewer проверяет границы хранения/импорта; после исправлений коммит только перечисленных файлов: `feat(ticket-assistant): add personal profiles and storage`.

### T2: Реальные Поля Jira И Валидируемый Payload

**Files:** создать `ujg-ticket-assistant-modules/api.js`, `fields.js`, `validation.js`, `tests/ticket-assistant-api.test.js`, `tests/ticket-assistant-validation.test.js`; расширить `tests/helpers/ticket-assistant-fixture.js` фабрикой `metadataFixture(projectKey='DO')` с типами Task/Bug/Deployment и вторым проектом APP с другими ID.

**Interfaces:**
- `api.createApi({ajax,baseUrl})`: `getProjects(options)`, `getCurrentUser(options)`, `getCreateMeta(projectKey,issueTypeId,options)`, `getComponents(projectKey,options)`, `getVersions(projectKey,options)`, `searchUsers(query,options)`, `getAttachmentMeta(options)`. Все Promise; ошибки `{kind,status,fieldErrors,message}` без raw headers/body/секретов.
- `fields.normalizeMeta(raw,projectKey,catalogs) -> Meta`, `fields.getField(meta,typeId,fieldId) -> FieldSpec|null`; справочники используют реальные ID и полноту, не подписи. `fields.resolveOption(field,input) -> {ok,value,error}` требует однозначности.
- `validation.validateFields(meta,typeId,values,{allowAssignee,explicitUserFields}) -> Validation`; `validation.buildCreatePayload(meta,typeId,values,policy) -> {fields}` либо ошибка валидации. Проект и тип берутся из выбранного scope, не из LLM JSON.

- [ ] **1. Написать failing tests** нормализации и кодеков всех согласованных типов, обязательных/default полей, чужих ID, неизвестных custom-полей, forbidden keys и 401/403/404/429. Примеры:

```js
test('foreign component and arbitrary API fields cannot reach payload', () => {
  const meta = metadataFixture();
  assert.equal(validation.validateFields(meta, '10', {summary:'Починить', components:[{id:'APP-9'}]}, policy).ok, false);
  assert.throws(() => validation.buildCreatePayload(meta, '10', {summary:'Починить', transition:{id:'31'}}, policy));
});
test('invalid calendar date is not normalized into another day', () => {
  assert.equal(validation.validateFields(metadataFixture(), '10', {summary:'Задача', duedate:'2026-02-31'}, policy).ok, false);
});
```

  `policy={allowAssignee:false,explicitUserFields:[]}` в setup. Дополнительно: одинаковые label при разных ID требуют выбора; `hasDefaultValue` без подтверждения применимости не даёт выдуманного значения; выбор из неполного каталога требует подтверждения из Jira; пустой массив не удовлетворяет required; `0` допустим для number. Обязательное неизвестное поле выдаёт его ID/имя, не silently omitted.
- [ ] **2. RED:** `node --test tests/ticket-assistant-api.test.js tests/ticket-assistant-validation.test.js`.
- [ ] **3. Реализовать чтение и pure validation.** Повторить существующие паттерны `api.js` импортёра для `/project`, `/issue/createmeta`, components и `/user/picker`; current user `/myself`, versions `/project/{key}/versions`, attachment limits `/attachment/meta`. Base URL только текущей Jira с context path. Учитывать страницы, если ответ paginated; неполнота/ошибка видима. Не использовать `autoCompleteUrl` произвольного origin и не считать user picker доказательством assign permission.

  Кодеки: string/textarea → string; number → finite number; date → реальная `YYYY-MM-DD`; datetime → валидная дата с явным offset; single/multi option, components, versions → `{id}`/массив; labels → string[]; user → `{name}` только после явного выбора. Схему неизвестного plugin-поля не угадывать по названию. Ограничение summary 255 символов либо меньшее подтверждённое metadata; сервер остаётся окончательным валидатором.
- [ ] **4. GREEN:** та же команда; проверка abort, context path, allowlist payload, отсутствия POST в read-методах. Фикстуры синтетические, без запросов к прод/Jira.
- [ ] **5. Review/commit:** `feat(ticket-assistant): validate Jira metadata and create fields`.

### T3: Черновик, Ревизии И Защита Ручных Правок

**Files:** создать `ujg-ticket-assistant-modules/draft.js`, `tests/ticket-assistant-draft.test.js`; дополнить storage-тесты сериализации.

**Interfaces:** `draft.createDraft({projectKey}) -> Draft`; чистые функции возвращают новый Draft: `setSource(d,text)`, `setSelection(d,{issueTypeId,templateId,settingsRevision,metaSignature})`, `editField(d,id,value)`, `appendAnswers(d,answersById)`, `applyProposal(d,proposal,requestSnapshot)`, `acceptField(d,id)`, `markChecked(d,validation,questions,snapshot)`. `snapshot(d)` возвращает scope/revisions, `isCurrent(d,snapshot)` сравнивает их. `serialize(d)`/`restore(json)` не сохраняют File/Blob/секреты.

- [ ] **1. Написать failing tests** late-response, ручных правок, видимых ответов, сброса checked, reload и различия created/unknown:

```js
test('late proposal cannot replace manual edits', () => {
  let d = draft.createDraft({projectKey:'DO'});
  const snap = draft.snapshot(d);
  d = draft.editField(d, 'summary', 'Моя тема');
  d = draft.applyProposal(d, {fields:{summary:'Тема модели'}}, snap);
  assert.equal(d.fields.summary, 'Моя тема');
  assert.equal(d.checked, null);
});
test('reload cannot turn an interrupted POST into a retryable idle', () => {
  const d = draft.createDraft({projectKey:'DO'});
  d.creation = {status:'submitting',attemptId:'attempt-1',issueKey:null,error:null};
  assert.equal(draft.restore(draft.serialize(d)).creation.status, 'unknown');
});
```

  Также актуальное предложение после ручной правки попадает в `pendingFields`, не заменяет protected value; `acceptField` требует отдельного действия. Ответы добавляются читаемым блоком в source и не дублируются при повторном сохранении. При редактировании исходного блока ответы не остаются в скрытом контексте. Созданный ключ сохраняется; файлы восстановлены только как descriptors с `needsReselect:true`.
- [ ] **2. RED:** `node --test tests/ticket-assistant-draft.test.js tests/ticket-assistant-storage.test.js`.
- [ ] **3. Реализовать interfaces.** Все изменения, влияющие на содержание/политику/metadata, обнуляют checked. Обновление metadata с тем же семантическим signature не инвалидирует черновик. Сериализация хранит только whitelisted state; File-объекты остаются в памяти runtime. После reload checked снимается до свежей metadata/проверки.
- [ ] **4. GREEN:** та же команда; тесты должны различать «ответ старого запроса игнорирован» и «актуальная замена ручного поля требует принятия».
- [ ] **5. Review/commit:** `feat(ticket-assistant): preserve versioned drafts and manual edits`.

### T4: LLM-контракт Без Потери Контекста

**Files:** создать `ujg-ticket-assistant-modules/ai.js`, `tests/ticket-assistant-ai.test.js`; существующий shared client не изменять.

**Interfaces:** `ai.createClient({llmClient,fetchImpl,readConfig}) -> {route(input,options),prepare(input,options),check(input,options)}`. Input содержит source, выбранный профиль/шаблон, Meta, Draft/snapshot, только требуемую allowlisted схему. Возврат строго JSON:
- route: `{schemaVersion:1,kind:'route',issueTypeId,templateId,candidates:[{issueTypeId,templateId,reason}],questions}`; неоднозначность без самовольного выбора;
- prepare: `{schemaVersion:1,kind:'draft',issueTypeId,templateId,fields,questions,warnings,evidence}`;
- check: `{schemaVersion:1,kind:'check',questions,warnings,evidence}` без замены fields.

Экспорты для тестов: `buildRequest(kind,input) -> {systemPrompt,userPrompt,allowProtocolFallback:false}`, `parseResponse(kind,text,input) -> result`. Поля/references проверяются по Meta/шаблонам из input; raw payload никогда не становится POST Jira.

- [ ] **1. Написать failing tests** трёх контрактов, ошибочного JSON/версии/чужого типа, инъекций, missing config, пустого ответа, лимитов и отмены. Обязательная проверка с кириллицей:

```js
test('oversize UTF-8 input is rejected before shared client truncation', async () => {
  let calls = 0;
  const client = ai.createClient({llmClient:{...shared,requestText(){calls++;}}, fetchImpl, readConfig});
  await assert.rejects(client.prepare({...input,source:'я'.repeat(42001)}, {}), /лимит/i);
  assert.equal(calls, 0);
});
```

  В setup shared загружается AMD helper, input содержит metadataFixture/profile; fetchImpl и readConfig только stubs. Добавить точные boundary-тесты `MAX_BASE_PROMPT_BYTES=6000`, `MAX_USER_PROMPT_BYTES=42000` для окончательных промптов; неподтверждённая source quote отвергается. Утверждение модели «всё заполнено» не обходит validation. Ключи/куки/содержимое вложений отсутствуют в запросе и ошибках.
- [ ] **2. RED:** `node --test tests/ticket-assistant-ai.test.js tests/shared-llm-client.test.js`.
- [ ] **3. Реализовать adapter.** Использовать `readStoredConfig`, `requestText`, UTF-8 helpers общего клиента; editable инструкции передавать в request, не сохранять поверх shared `basePrompt`. Проверять длины до `sanitizePrompt/buildRequestBody`. При избыточном каталоге возвращать требование явного выбора поля, не отрезать значения. Закрепить selected IDs и исключить полный каталог из промпта только с видимым объяснением области контекста.

  Для abort передать обёртку `fetchImpl(url,{...options,signal})`; stale response всё равно проверяет T5. Не менять протокол под названием «системный промпт»; запретить fallback новым действием/провайдером. UI-ошибки безопасные, без raw LLM-тела/URL с секретами. Нельзя выполнять инструменты/команды из JSON.
- [ ] **4. GREEN:** та же команда; 0 живых LLM-вызовов, shared tests без изменения ожиданий.
- [ ] **5. Review/commit:** `feat(ticket-assistant): add constrained LLM preparation contracts`.

### T5: Сценарий Подготовки И Уточнений

**Files:** создать `ujg-ticket-assistant-modules/controller.js`, `tests/ticket-assistant-controller.test.js`.

**Interfaces:** `controller.create({api,ai,createStore,onChange,now}) -> {init(),selectProject(key),selectTemplate(id),selectIssueType(id),updateSource(text),updateField(id,value),answer(answersById),acceptField(id),applySettings(settings),prepare(),check(),cancel(),getState(),destroy()}`. `createStore(userKey)` возвращает T1 store, привязанный к identity текущего `api.getCurrentUser`; для недоступной identity принимает `null` и создаёт memory-only store. `getState -> WorkflowState`; методы async возвращают Promise. Потребляет T1–T4; не создаёт тикеты. `applySettings` сохраняет профиль, увеличивает revision и снимает checked; конфликт store сохраняет текущий ввод и сообщается через state.error.

- [ ] **1. Написать failing tests** последовательности route→metadata→prepare и ручного выбора без route, обязательных уточнений, отмены/повтора и переключения scope. Тесты фиксируют:

```js
test('project change makes late AI response inert', async () => {
  // setup: выбранные type/template, непустой source; deferred ai.prepare для DO, API содержит APP.
  await c.selectProject('DO');
  const run = c.prepare();
  await c.selectProject('APP');
  resolveOldProposal();
  await run;
  assert.equal(c.getState().draft.projectKey, 'APP');
  assert.equal(c.getState().draft.fields.summary, undefined);
});
```

  Setup функции находятся внутри тестового файла и используют `metadataFixture` и deferred Promise. Проверить отсутствие вызовов при вводе; ambiguous route не запускает prepare; только выбранный вручную type/template не меняется моделью. Повторная проверка вызывает `check`, не `prepare`, и не заменяет fields; необязательные warnings не блокируют.
- [ ] **2. RED:** `node --test tests/ticket-assistant-controller.test.js`.
- [ ] **3. Реализовать interfaces.** Один active run с AbortController и snapshot; изменение source/selection/settings и destroy инвалидирует run. При проектном переключении сохранить прежний черновик в его scope и восстановить новый. Загрузка/таймер публикуют фактическую стадию, без процентов. Ошибка оставляет source/fields и явное повторное действие. Проверка current user при init до постоянного storage; нет пользователя → память с предупреждением.
- [ ] **4. GREEN:** та же команда. Тест double-prepare даёт один active pipeline; cancellation не применяет даже ответ транспорта, проигнорировавшего abort. Смена identity не читает хранилище предыдущего пользователя.
- [ ] **5. Review/commit:** `feat(ticket-assistant): coordinate preparation and clarification workflow`.

### T6: Рабочий Редактор И Изолированная Сборка

**Files:** создать `field-ui.js`, `ui.js`, `main.js` в `ujg-ticket-assistant-modules/`, `ujg-ticket-assistant.css`, `build-ticket-assistant.js`, `tests/ticket-assistant-build.test.js`, `tests/browser/ticket-assistant-editor.test.cjs`, `tests/browser/ticket-assistant-preview.html`, `tests/browser/ticket-assistant-preview.cjs`, `tests/browser/ticket-assistant-preview-server.cjs`; изменить `build-widget-bootstrap-assets.js`, `tests/widget-bootstrap.test.js`. Получить собственные `.js/.runtime.js/.bootstrap.js` генерацией.

**Interfaces:**
- `fieldUi.create({$,onChange,onSearch}) -> {mount(el),update({field,value,errors,selectedUsers}),destroy()}`; стабильные keyed DOM-поля, explicit user action.
- `ui.create({$,controller}) -> {mount(el),update(state),openSettings(),destroy()}`. T7 подключит settings view без перезаписи редактора. Create до T8 недоступен, а не фиктивно успешен.
- `main` экспортирует `TicketAssistantGadget(API)` по образцу StoryBrowser: использует `API.getGadgetContentEl()`, собственный `.ujg-ticket-assistant`, idempotent lifecycle/cleanup. Конструктор собирает реальные зависимости; offline preview передаёт stubs, не вводит test-only query-поведение в продукт.
- AMD: `_ujgTA_profiles/storage/api/fields/validation/draft/ai/controller/fieldUi/ui/main`; public `_ujgTicketAssistant`, runtime `_ujgTicketAssistantRuntime`; shared client в runtime только `_ujgTA_llmClient` через existing `embeddedAmdRenames`.
- `build-ticket-assistant.js` экспортирует `{build}`, `build.MODULE_ORDER`; runtime/bootstrap через `buildAssets({widgets:['ujg-ticket-assistant'],releaseRef})`. Shared source включается только одним способом, без двойного define.

  Конкретно: исходный main зависит от `_ujgShared_llmClient`, исходный bundle не содержит его копию. Только `WIDGET_SPECS['ujg-ticket-assistant'].embeddedJsFiles` включает `ujg-shared-modules/llm-client.js`; `embeddedAmdRenames` переименовывает определение и зависимость в `_ujgTA_llmClient`. `sharedJsFiles` для нового виджета пуст: никакого второго внешнего подключения общего AMD. Preview загружает runtime, tests исходных модулей инъецируют shared stub.

- [ ] **1. Написать failing UI/build tests:** поля из Meta, source/questions/draft видны; mandatory ошибки связаны с полем; protected proposals принимаются отдельно; escaped HTML не создаёт DOM; progress tick не заменяет textarea. В JSDOM:

```js
test('progress preserves input identity and caret', () => {
  const input = root.querySelector('[data-ta-source]');
  input.focus(); input.setSelectionRange(2, 5);
  ui.update({...state,stage:'preparing',startedAt:1000});
  assert.equal(root.querySelector('[data-ta-source]'), input);
  assert.equal(document.activeElement, input);
  assert.equal(input.selectionStart, 2);
});
```

  Setup использует JSDOM, jquery и реальный ui. Build-тест проверяет ровно один shared define в runtime, совпадение модулей MODULE_ORDER, missing-module failure; общий bootstrap тест проверяет новый widget без изменения старых release URLs.
- [ ] **2. RED:** `node --test tests/ticket-assistant-build.test.js tests/widget-bootstrap.test.js tests/browser/ticket-assistant-editor.test.cjs` с существующим NODE_PATH.
- [ ] **3. Реализовать editor/fields и сборку.** Desktop две рабочие области, mobile последовательный поток; обычные 14–16px тексты, компактные заголовки, без hero и карточек в карточках. Нейтральный фон, синий action, amber предупреждение, красная ошибка, зелёный результат. CSS только под `.ujg-ticket-assistant`, letter-spacing 0, без масштабирования шрифта от viewport. Иконки из существующей системы проекта с accessible names/tooltips, реальные доступные issue-type иконки только из разрешённых URL.

  Dropdown: поиск, клавиатура/Escape, pinned removable selected chips без дублей. Отдельно field errors и LLM questions. «Подготовить», «Проверить», «Принять изменение» явные; «Остановить» только для чтения/LLM. Компактная строка стадии с временем: успех скрывает progress; ошибка/остановка остаются с повтором. Таймер не озвучивается каждую секунду.

  При обязательном неподдерживаемом поле показать его имя, причину блокировки и «Открыть форму Jira» (`baseUrl + '/secure/CreateIssue!default.jspa'` с URL-encoded `pid`/`issuetype` выбранного scope). Тема/описание доступны для копирования по отдельным действиям; не писать их в clipboard автоматически. При недоступном Clipboard API оставить доступный выделяемый текст. Отдельный DOM-тест проверяет fallback без POST и сохранность черновика.

  Preview server слушает только `127.0.0.1`, по умолчанию 4320, занято → свободный порт и фактический URL. Экспортирует `startPreview({port:0}) -> {url,close}` для tests, CLI тоже работает. CSP запрещает внешние connect; отдаёт локальные jquery/AMD и fixture transport. Без прокси к прод, без обхода Citrix и без подключения standalone server с Jira credentials.
- [ ] **4. GREEN и личный промежуточный smoke:** та же test-команда; `node build-ticket-assistant.js`; `node tests/browser/ticket-assistant-preview-server.cjs`. Открыть фактический URL, ввести текст, подготовить/отменить stub, проверить 1440 и 390 px. Не останавливать старый 4317; свой сервер очистить после теста либо оставить как явно переданный пользователю preview.
- [ ] **5. Review/commit:** `feat(ticket-assistant): add isolated editor and preview` только новый widget/build registration/tests. Не запускать CLI общей сборки, переписывающий все bootstrap-файлы.

### T7: Настройки Промпта И Шаблонов В Интерфейсе

**Files:** создать `ujg-ticket-assistant-modules/settings-ui.js`, `tests/browser/ticket-assistant-settings.test.cjs`; изменить `ui.js`, `controller.js`, CSS, MODULE_ORDER; обновить тесты T1/T5 только для новых UI-сценариев, не ослабляя проверки.

**Interfaces:** `settingsUi.create({$,onApply,onClose}) -> {open({settings,meta}),close(),destroy()}`. Local editable copy, применение через `controller.applySettings(settings)`; `onApply` возвращает результат сохранения. Маппинг типов проверяется по текущему Meta; новый AMD `_ujgTA_settingsUi` перед ui/main.

- [ ] **1. Написать failing tests** открытия/отмены/сохранения, четвёртого шаблона, duplicate/delete, reset defaults, mapping invalidation, JSON preview/application и storage conflict. Пример assertions:

```js
test('editing instructions is local until Apply and never replaces source', async () => {
  const source = c.getState().draft.source;
  // заполнить textarea правил через DOM, затем Cancel.
  assert.equal(c.getState().settings.revision, oldRevision);
  // повторить ввод и нажать Apply.
  assert.ok(c.getState().settings.revision > oldRevision);
  assert.equal(c.getState().draft.source, source);
  assert.equal(c.getState().draft.checked, null);
});
```

  В фактическом тесте действия выполнить DOM events, без прямой подмены state. Import profile другого проекта с отсутствующим type сохраняет текст, требует mapping и не включает Create. Импорт не перезаписывает текущие настройки до Apply. Conflict оставляет несохранённую копию и явный выбор загрузить сохранённую версию либо заново применить свою, без тихого overwrite.
- [ ] **2. RED:** `node --test tests/browser/ticket-assistant-settings.test.cjs`.
- [ ] **3. Реализовать settings UI** с общим промптом, списком шаблонов и отдельным текстом каждого; имя/whenToUse/type binding, явный allowAssignee. Удаление активного шаблона не удаляет source/fields, требует нового выбора. Reset подтверждается и касается только правил. Экспорт использует T1 whitelist. Escape/закрытие возвращают фокус на кнопку настроек; при несохранённых изменениях запросить discard, не терять их при случайном закрытии.
- [ ] **4. GREEN и личный UI:** та же команда плюс T1/T5; сохранить, reload, перенести профиль между DO/APP на заглушках, проверить длинный текст/scroll/keyboard на 1440×900 и 390×844.
- [ ] **5. Review/commit:** `feat(ticket-assistant): add editable prompt and template settings`.

### T8: Явное Создание И Независимые Вложения

**Files:** создать `ujg-ticket-assistant-modules/creator.js`, `tests/ticket-assistant-creator.test.js`, `tests/browser/ticket-assistant-create.test.cjs`; изменить api/controller/ui/main/draft и build order нового виджета; `_ujgTA_creator` включить до controller/main.

**Interfaces:**
- API дополнить `createIssue(payload,options) -> Promise<{key,id}>`, `uploadAttachment(issueKey,file,options) -> Promise<{id,filename}>`, `getIssueAttachments(issueKey,options)` для read-only сверки неопределённой загрузки. Ошибка POST сообщает `outcome:'rejected'|'unknown'`: timeout/network/недостоверный success body не доказывает отсутствие записи.
- `creator.create({api,store,now}) -> {submit({draft,settings,files},onUpdate),retryAttachment({draft,file},onUpdate),reconcileUnknown({draft,resolution,issueKey}),destroy()}`; `resolution:'found'|'confirmed-not-created'`, только явное подтверждение пользователя после сверки Jira. Creator получает store, уже созданный controller.init; сохраняет результат в scope исходного draft.id до вызова `onUpdate`. Callback обновляет текущий экран только при совпадении scope; не выполняет второе конкурирующее сохранение.
- Controller добавляет `submit()`, `retryAttachment(fileId)`, `reconcileUnknown(resolution,issueKey)`, `newDraft()`, `selectFiles(files)`, `removeFile(fileId)`. File-объекты не включаются в getState/LLM/storage; descriptors содержат id/name/size/type/status/needsReselect.

- [ ] **1. Написать failing tests** metadata recheck, checked revision, double-click, server field error, ambiguous POST, reload guard, stale project response и attachment partial success. Минимальный критический сценарий:

```js
test('lost create response cannot lead to a second POST', async () => {
  // fixture: valid checked draft; API create throws outcome:unknown after one call.
  await creator.submit({draft:checkedDraft,settings,files:[]}, capture);
  assert.equal(latest.creation.status, 'unknown');
  await creator.submit({draft:latest,settings,files:[]}, capture);
  assert.equal(postCalls.length, 1);
});
```

  Setup в файле теста использует T1–T3 fixtures, `capture` фиксирует latest. Тест частичных вложений: POST issue ровно 1, успешный file A не повторяется после ошибки B, известный ключ виден; неопределённый upload B требует сверки, а не retry. После reload состояние submitting → unknown. После ручной правки во время preflight нет POST. Изменившийся обязательный field/удалённая component опция возвращают на проверку.
- [ ] **2. RED:** `node --test tests/ticket-assistant-creator.test.js tests/browser/ticket-assistant-create.test.cjs`.
- [ ] **3. Реализовать запись.** Перед POST перечитать Meta и используемые каталоги, сравнить семантическую signature и проверить snapshot/поля/required questions. Payload строит только T2. Lock по draft.id/attemptId до отправки; сохранить submitting до сети, конфликт сохранения блокирует отправку. Если durable-сохранение недоступно, явно предупредить, сохранить in-memory guard и не обещать восстановление после reload. Известный ключ сохранить до upload, ссылка только `${baseUrl}/browse/${encodedKey}`. `newDraft` и очистка недоступны при submitting/unknown до разрешения результата; при created нужен явный переход к новой задаче. Controller не допускает редактирование отправляемого draft, смена проекта лишь меняет отображаемый scope, а не получателя результата записи.

  POST `/issue`, затем multipart `/issue/{key}/attachments` с `X-Atlassian-Token: no-check`, browser boundary, без вручную заданного multipart Content-Type. Проверить разрешение/лимит `/attachment/meta`, результаты по каждому файлу. Недоступная проверка ограничений не удаляет файлы: предложить явное создание без вложений либо повтор чтения. Server error не теряет исходник; definite rejection позволяет исправить и заново проверить. Unknown требует ручной сверки. Отмена во время записи не показывает ложный «отменено», а сохраняет результат/неопределённость.
- [ ] **4. GREEN:** test-команда T8 плюс T2/T3/T5; все POST только к stub. Лично пройти full create, отказ, lost response и file retry в локальном preview; убедиться, что ни одно действие агента не пишет в Jira.
- [ ] **5. Review/commit:** `feat(ticket-assistant): create confirmed tickets with safe attachment recovery`.

### T9: Сквозная Приёмка И Release Candidate

**Files:** создать `tests/browser/ticket-assistant-acceptance.cjs`, `docs/ticket-assistant-acceptance-2026-10-19.md`; обновить README, browser README, конечные generated assets нового widget. По найденным дефектам ограниченные fixes и tests в соответствующих модулях T1–T8.

**Interfaces:** acceptance запускает собственный `startPreview({port:0})`, Chromium через установленный browser, по завершении закрывает server/context в finally. Artifacts вне git: `/tmp/ticket-assistant-20261019/`. Перед финалом отдельный preview можно оставить на свободном порту и передать точный URL пользователю.

- [ ] **1. Добавить сквозные tests** всех трёх шаблонов и четвёртого пользовательского; вопросы/дополнение/ручные правки; два проекта/пользователя; JSON-перенос; обязательное unsupported поле; error/retry/cancel; created/unknown/attachments; reload. Проверить импортёр и новый widget рядом в одном AMD registry, без duplicate define и CSS-leak. Сеть test context разрешена только для origin preview; любой внешний запрос проваливает проверку, не просто исчезает в логах.

```js
assert.equal(externalRequests.length, 0);
assert.equal(pageErrors.length, 0);
assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
assert.equal(fixture.issuePostCount(uncertainDraftId), 1);
```

  Acceptance хранит эти счётчики из своего fixture-server, не из прод. Viewports 1440×900 и 390×844, клавиатура, длинные правила/вопросы, последний field, reduced motion, сохранение caret/scroll во время таймера. Скриншоты inspect лично; один passing test без просмотра не считается визуальной приёмкой.
- [ ] **2. Выполнить собственную сборку и профильные тесты:** `node build-ticket-assistant.js`; `node --test tests/ticket-assistant-*.test.js tests/browser/ticket-assistant-*.test.cjs tests/shared-llm-client.test.js tests/widget-bootstrap.test.js`; `node tests/browser/ticket-assistant-acceptance.cjs`. Ожидается exit 0, 0 failed, 0 skipped новых acceptance-сценариев.
- [ ] **3. Выполнить полный offline regression:** `node --test --test-concurrency=2 --test-reporter=tap tests/*.test.js tests/browser/*.test.cjs`; лог сохранить вне git. Не считать исторические 1751 тест доказательством этой версии. Проверить generated drift и `git diff --check`; изменённые чужие generated assets не коммитить и не откатывать без выяснения источника.
- [ ] **4. Финальное независимое ревью** всего диапазона реализации: spec coverage, write gates, stale data, восстановление, приватность, совместимость bootstrap/shared LLM. Исправить подтверждённые дефекты, повторить затронутые tests. Лично пройти preview заново после fixes.
- [ ] **5. Зафиксировать фактическую приёмку** в отчёте: коммиты, изменённые файлы, версии test environment, точные commands/counts, screenshot paths, ограничения. В README добавить собственные asset URLs/AMD/корневой CSS и local preview command; разделить «реализовано локально», «опубликовано» и «принято в Citrix». Коммит `test(ticket-assistant): verify workflow and document release candidate`.
- [ ] **6. Подготовить публикацию, не подменяя её приёмкой.** Список release-файлов только нового виджета и необходимой build registration. Публикация отдельным явным согласованным действием по существующему commit-pinned процессу; не менять общий dashboard releaseRef/устанавливать гаджет в прод автоматически. После публикации сравнить JS/runtime/CSS с CDN побайтово. Citrix только после новой передачи управления и свежего экрана: read-only metadata/форма, без запуска LLM/создания. Если экран занят, приёмка остаётся открытой, управление не перехватывать.

## Соответствие Спецификации

| Требование | Реализация / доказательство |
| --- | --- |
| Универсальные проекты, отдельный гаджет, без регрессии импортёра | T2, T6, T9 |
| Три шаблона и редактируемые общие/частные инструкции | T1, T4, T7 |
| Личное хранение, экспорт/импорт, отсутствие admin-требования | T1, T3, T7 |
| Auto-routing с подтверждением неоднозначности, ручной выбор | T2, T4, T5 |
| Вопросы, ответы в исходнике, защищённые ручные правки | T3–T6 |
| Реальные поля/allowed values/defaults, unsupported fallback | T2, T6, T8 |
| UTF-8 лимиты, отсутствие silent truncation/выдуманных фактов | T4, T5 |
| Точное checked состояние, late responses, отмена | T3, T5, T8 |
| Явное создание, неизвестный результат, повтор вложений | T3, T8, T9 |
| Desktop/mobile, accessibility, компактный progress | T6, T7, T9 |
| Только существующий LLM, безопасный вывод, отсутствие секретов | T1, T4, T6, T9 |
| Review, offline tests, собственная сборка, отдельная Citrix-приёмка | Каждый task review + T9 |

## Передача В Исполнение

После ревью плана пользователем: последовательная реализация по T1–T9 с Sol 6.1 Author/Reviewer medium и личной проверкой основным агентом. Не запускать конкурирующих авторов для общих файлов; каждый следующий этап получает точные interfaces предыдущего и его проверенный commit. Если нужный subagent/model недоступен, сообщить до замены метода. Этот документ не означает, что код, тесты, публикация или Citrix-приёмка уже выполнены.
