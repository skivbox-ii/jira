# Dashboard version display — design

## Контекст

Сейчас общий bootstrap уже знает активный `releaseRef` дашборда, умеет читать и обновлять его через `ujg.dashboardReleaseRef`, а в тулбаре показывает только короткий hash. Пользователю нужно видеть более читаемую подпись вида `Dashboard v<hash> • <дата время коммита>` и иметь её не в одном месте, а в двух:

- в общей bootstrap-плашке над гаджетом;
- в самом теле гаджета как отдельную компактную строку над runtime-контентом.

Важно не дублировать логику по всем runtime-виджетам: версия относится к общему dashboard `releaseRef`, а не к отдельному runtime bundle.

## Цели

- Показывать активный `releaseRef` в человекочитаемом виде.
- Дополнительно показывать дату и время коммита для этого `releaseRef`.
- Держать один источник истины: текущий `releaseRef`, реально использованный bootstrap для загрузки ассетов.
- Реализовать оба места вывода без правок каждого widget runtime по отдельности.
- Деградировать до показа только hash, если commit metadata недоступна.

## Не-цели

- Не менять формат dashboard property `ujg.dashboardReleaseRef`.
- Не переносить эту логику в каждый `*.runtime.js`.
- Не блокировать загрузку гаджета, если GitHub API commit metadata недоступен.
- Не делать отдельные настройки формата даты на уровне Jira.

## Архитектура (итоговая)

### 1. Источник истины

Bootstrap продолжает определять активный `releaseRef` через уже существующий flow:

- dashboard property `ujg.dashboardReleaseRef`;
- при отсутствии значения: GitHub `commits/main`;
- при недоступности Jira/GitHub: build-time fallback `releaseRef`.

Именно этот активный ref считается версией, которую надо показывать в UI.

### 2. Источник commit metadata

Для уже выбранного `releaseRef` bootstrap дополнительно делает запрос к GitHub API:

- `GET https://api.github.com/repos/skivbox-ii/jira/commits/<releaseRef>`

Из ответа используется:

- `sha` для нормализованного hash;
- `commit.committer.date` как timestamp коммита.

Дата форматируется в браузере в локальной timezone пользователя в компактный вид `YYYY-MM-DD HH:mm`.

### 3. Кэш на странице

В `window.__UJG_BOOTSTRAP__` добавляется отдельный кэш commit metadata:

- `releaseMetaByRef[ref] = { sha, committedAt, formatted }`
- `releaseMetaPromiseByRef[ref]`

Это нужно, чтобы:

- не дёргать GitHub API повторно для каждого гаджета на одном дашборде;
- быстро переиспользовать уже загруженную метку при remount toolbar;
- синхронно обновлять обе точки вывода для одного и того же ref.

### 4. Две точки вывода

Обе точки делает сам bootstrap:

1. **Toolbar**  
   Существующая строка версии в `.ujg-bootstrap-toolbar` меняется с короткого hash на полную подпись:
   `Dashboard v<shortSha> • <formattedCommitTime>`

2. **Version strip в теле гаджета**  
   Сразу под toolbar bootstrap монтирует отдельный стабильный элемент, например `.ujg-bootstrap-version-strip`, который показывает ту же подпись в компактном виде.

Такой подход даёт `both`, но не требует править `ujg-story-browser`, `ujg-timesheet`, `ujg-user-activity` и другие runtime-файлы.

## Формат отображения

### Базовый формат

- `Dashboard v2d1d9ed • 2026-03-29 18:42`

### Fallback при отсутствии commit metadata

- `Dashboard v2d1d9ed`

### Нормализация hash

- В UI используется сокращённый hash.
- Полный `releaseRef` остаётся внутренним значением для URL и кэша.

## Поток данных

1. Bootstrap разрешает активный `releaseRef`.
2. По этому ref строятся asset URL, как и сейчас.
3. Параллельно или сразу после разрешения ref bootstrap запрашивает commit metadata для этого ref.
4. Когда metadata готова:
   - обновляется `.ujg-bootstrap-version` в toolbar;
   - обновляется `.ujg-bootstrap-version-strip` в теле гаджета.
5. Если metadata не загрузилась:
   - UI остаётся с `Dashboard v<hash>`;
   - runtime-гаджет всё равно продолжает нормально работать.

## Поведение при «Обновить версию»

После успешного refresh-flow:

1. сохраняется новый `releaseRef` в dashboard property;
2. локальный UI обновляется на новый hash;
3. commit metadata для нового ref при необходимости запрашивается;
4. выполняется `location.reload()`.

Из-за полного reload не нужно поддерживать сложный in-place lifecycle для старого и нового набора ассетов.

## Ошибки и деградация

- Ошибка GitHub API commit metadata не должна ломать gadget bootstrap.
- Если commit metadata недоступна, отображается только `Dashboard v<hash>`.
- Если remount toolbar/version strip происходит после очистки shared root runtime-ом, bootstrap должен уметь восстановить оба элемента из кэша.

## Тестовая стратегия

Нужны тесты в `tests/widget-bootstrap.test.js` на:

- загрузку commit metadata по активному `releaseRef`;
- отображение строки `Dashboard v<hash> • <date time>`;
- fallback до `Dashboard v<hash>` при ошибке metadata-запроса;
- рендер обеих точек вывода;
- восстановление toolbar/version strip после runtime remount;
- обновление отображения после refresh-flow.

## Затрагиваемые файлы

- `build-widget-bootstrap-assets.js`
- `tests/widget-bootstrap.test.js`
- generated `ujg-*.bootstrap.js`

## Связанные документы

- Базовый `releaseRef` flow: `docs/plans/2026-03-29-dashboard-release-ref-design.md`
- План реализации: `docs/plans/2026-03-29-dashboard-version-display.md`
