# User Activity Repo Activity — Design

## Контекст

Текущий `user-activity` показывает только Jira-активность пользователя:
- worklogs
- status transitions
- issue summary

При этом в проекте уже есть готовая работа с Jira Dev Status API в `project analytics`, где загружаются:
- repositories
- pull requests
- branches
- commits
- review-related metadata

Нужно расширить `user-activity`, чтобы он показывал полную активность пользователя по репозиториям за выбранный период, в том же визуальном стиле, что и текущий интерфейс.

## Цель

Добавить в `user-activity` два новых блока:

1. `Repo Activity Calendar`
2. `Repository Activity Log`

Оба блока должны выглядеть и ощущаться как нативная часть текущего `user-activity`:
- календарь в том же стиле, что и текущий activity calendar
- таблица в том же стиле, что и текущий log действий

## Принципы

- Не смешивать Jira-активность и repo-активность в один календарь.
- Сохранять максимум repo-данных, которые Jira Dev Status отдаёт.
- Не терять редкие или нестандартные события: использовать fallback event types.
- В календаре показывать сжатое представление.
- В таблице показывать полный поток repo-событий с фильтрами.
- Не ломать текущие Jira-блоки.

## Источник данных

Источник: Jira Dev Status API.

Для каждой issue в текущем наборе `user-activity` нужно догружать:
- `repository`
- `pullrequest`

Ответы объединяются по тому же принципу, что уже реализован в `jira/ujg-project-analytics-modules/data-collection.js`.

Читать нужно:
- `detail.repositories`
- `detail.pullRequests`
- `repo.commits`
- `repo.branches`
- `branch.commits`
- `repo.pullRequests`

## Новая модель данных

Нужно добавить отдельную нормализованную структуру `repoActivity`.

### `repoActivity.items`

Плоский массив repo-событий.

Общий формат события:
- `type`
- `date`
- `timestamp`
- `repoName`
- `repoUrl`
- `branchName`
- `issueKey`
- `author`
- `title`
- `message`
- `status`
- `reviewers`
- `hash`
- `raw`

### `repoActivity.dayMap`

Агрегация по дням:
- `date`
- `items`
- `totalEvents`
- `countsByType`
- `countsByRepo`

### `repoActivity.repoMap`

Агрегация по репозиториям:
- `repoName`
- `repoUrl`
- `totalEvents`
- `branches`
- `issues`
- `countsByType`

### `repoActivity.stats`

Базовые метрики:
- `totalEvents`
- `totalCommits`
- `totalPullRequests`
- `totalBranchesTouched`
- `totalRepositories`
- `activeRepoDays`

## Типы repo-событий

Нужно поддержать:
- `commit`
- `pull_request_opened`
- `pull_request_merged`
- `pull_request_declined`
- `pull_request_reviewed`
- `pull_request_needs_work`
- `branch_update`
- `branch_commit`
- `repository_update`
- `unknown_dev_event`

## Правила извлечения

### Commit

Создаётся событие, если commit timestamp попадает в период.

Дата:
- `authorTimestamp`
- fallback: `commitTimestamp`
- fallback: `date`

### Pull Request

PR считается активностью периода, если любая из дат попадает в выбранный интервал:
- `created`
- `updated`
- `merged`

События:
- открытие PR
- merge PR
- decline/reject PR
- review
- needs work

### Branch

Если branch имеет commits в периоде, они создают commit-like activity.

Если есть branch metadata, но нет полноценного commit event, создаётся `branch_update`.

### Repository

Если Jira возвращает repo-level detail без commit/PR, но с распознаваемой активностью, создаётся `repository_update`.

### Unknown

Если структура данных не попала в известный шаблон, создаётся `unknown_dev_event`, чтобы не потерять активность.

## Привязка к пользователю

Нужен единый helper `matchesSelectedUser()`.

Сравнение по:
- `displayName`
- `name`
- `key`
- `accountId`
- lowercase normalization

Repo-события включаются только если они принадлежат выбранному пользователю.

## Layout

Новый порядок блоков:

1. `SummaryCards`
2. текущий `Jira Activity Calendar`
3. новый `Repo Activity Calendar`
4. `DailyDetail`
5. `ProjectBreakdown`
6. `IssueList`
7. текущий `Activity Log`
8. новый `Repository Activity Log`

## Repo Activity Calendar

Визуально повторяет текущий `calendar-heatmap.js`:
- тот же wrapper
- те же weekday headers
- тот же summary column `Σ`
- те же hover/selected states
- та же плотность текста

Содержимое ячейки:
- дата
- badge с количеством repo-событий
- список top repo events за день
- если событий больше лимита: `+N еще`

Intensity:
- зависит от числа repo-событий за день
- а не от часов

Summary column:
- total events за неделю
- top repositories за неделю
- при необходимости counts by type

## Repository Activity Log

Визуально повторяет текущий `activity-log.js`, но с repo-колонками.

Колонки:
- `Дата`
- `Время`
- `Репозиторий`
- `Ветка`
- `Задача`
- `Тип`
- `Описание`
- `Статус/Hash`
- `expand`

Фильтры:
- repository
- branch
- issue
- type
- text search

Expand row:
- полный message
- PR metadata
- reviewers
- raw details

## Взаимодействия

- Выбор даты в `Repo Activity Calendar` фильтрует `Repository Activity Log`.
- Выбор даты в текущем Jira-календаре продолжает открывать `DailyDetail`.
- Jira и repo calendars работают независимо.

## Error Handling

Если repo dev-status не загрузился:
- Jira-блоки продолжают работать
- repo calendar и repo log показывают локальный error/empty state
- ошибка не валит весь dashboard

Если repo data частично пустые:
- показывается всё, что удалось загрузить
- это не считается fatal error

## Модули

Новые модули:
- `jira/ujg-user-activity-modules/repo-api.js`
- `jira/ujg-user-activity-modules/repo-data-processor.js`
- `jira/ujg-user-activity-modules/repo-calendar.js`
- `jira/ujg-user-activity-modules/repo-log.js`

Изменяемые модули:
- `jira/ujg-user-activity-modules/config.js`
- `jira/ujg-user-activity-modules/rendering.js`
- `jira/ujg-user-activity-modules/main.js`
- `jira/build-user-activity.js`

## Testing

Нужно покрыть минимум 4 сценария:

1. только commits
2. commits + PR
3. PR на detail-level без repositories
4. пустой или errored dev-status

Отдельно проверить руками:
- день с большим количеством repo-событий
- несколько репозиториев в одной неделе
- PR с review + merge
- branch commits
- mixed Jira activity + repo activity на одном диапазоне

## Решение

Рекомендованное решение:
- не смешивать Jira и repo data в единый календарь
- добавить отдельный repo calendar
- добавить отдельный repo log
- хранить максимум repo activity в нормализованном виде
- визуально наследовать текущий `user-activity`

