# Timesheet Summary Column — Design v2

## Контекст

Предыдущая версия (отдельная панель отчёта справа) не подходит. Нужна интеграция аналитики прямо в календарь: дополнительная колонка "Σ" в конце каждой недели + итоговая строка за месяц.

## Что убираем

- Галочку "Отчёт" и `renderReportPanel()` — заменяем встроенной колонкой
- CSS-класс `ujg-report-wrapper`, `ujg-report-panel` и связанные стили
- `state.showReport`, `state.reportSort`, `state.reportSortAsc`

## Что добавляем

### 1. Колонка "Σ" в календарной сетке

Grid меняется с `repeat(5, 1fr)` / `repeat(7, 1fr)` на `repeat(5, 1fr) 220px` / `repeat(7, 1fr) 220px`.

Ячейка summary для каждой строки-недели:

```
┌─────────────────────────┐
│ 38h / 40h  ✓            │  часы / норма (8ч * рабочих дней недели)
│                         │  зелёный если >= нормы, красный если дефицит
│ PROJ-A  24h             │  разбивка по проектам (из ключа задачи)
│ PROJ-B  14h             │
│                         │
│ Story ×3  Task ×5       │  разбивка по типам задач
│ Bug ×1                  │
│                         │
│ [если "Подробно":]      │  статусные переходы (из changelog)
│ T-1: → Review → Done    │
│ T-3: Created            │
└─────────────────────────┘
```

### 2. Месячная сводка

Полноширинная строка после последней недели каждого месяца (если диапазон пересекает границу месяцев — несколько сводок):

```
═══ Март 2026 ═══════════════════════════════════════════
 168h / 176h (95.5% утилизация)
 Проекты: PROJ-A 112h (67%) │ PROJ-B 56h (33%)
 Типы: Story ×12, Task ×18, Bug ×4
 Задач: 34  │  Дней с записями: 21/22
═════════════════════════════════════════════════════════
```

### 3. Галочка "Подробно"

- В панели управления, рядом с "По разработчикам" и "Комментарии"
- Что делает:
  1. Добавляет `issuetype` в fields запроса API (бесплатно, ещё одно поле)
  2. После загрузки всех дней — дозапрашивает changelog для каждого уникального тикета
  3. В ячейках Summary появляются статусные переходы
- Без "Подробно": часы + проекты + типы задач (issuetype всегда запрашиваем)
- С "Подробно": + статусные переходы за неделю

### 4. Режим "По разработчикам"

Когда включён — каждый календарь для одного пользователя, в Summary нет имён (и так понятно кто). Когда выключен и выбрано несколько пользователей — в Summary есть разбивка по пользователям.

## Данные

### Что уже есть
- `state.calendarData[dayKey]` — массив issues с worklogs за день
- `state.users` — маппинг userId → displayName
- Каждый issue имеет: `key`, `summary`, `status`, `seconds`, `worklogs[]`, `authors{}`

### Что добавляем в API-запрос
- Поле `issuetype` в `fields` параметре `loadDayData()` в `_ujgCommon.js`
- Сохраняем `item.issueType` (name типа задачи) в calendarData

### Что дозапрашиваем (режим "Подробно")
- `GET /rest/api/2/issue/{key}?expand=changelog&fields=summary` для каждого уникального тикета
- Из changelog берём transitions (status changes) за выбранный период
- Сохраняем в `state.changelogData[issueKey]` = массив transitions

## Вычисление Summary за неделю

Функция `computeWeekSummary(weekDays, userId, calendarData)`:

1. Для каждого дня недели: суммирует секунды, собирает уникальные ключи задач
2. Группирует по проектам (ключ до дефиса: `PROJ-123` → `PROJ`)
3. Группирует по типам задач (из `item.issueType`)
4. Считает рабочие дни и ожидание (workDays * 8h)
5. Если есть changelogData — собирает transitions за эту неделю

Возвращает:
```javascript
{
    totalSeconds, expectedSeconds, deficit,
    projects: { "PROJ-A": seconds, "PROJ-B": seconds },
    issueTypes: { "Story": count, "Task": count, "Bug": count },
    transitions: [{ key: "T-1", changes: ["In Progress → Review", "Review → Done"] }],
    taskCount, daysWorked, workDays
}
```

## Вычисление месячной сводки

Функция `computeMonthSummary(monthDays, userId, calendarData)`:

Та же логика что и для недели, но по всем дням месяца. Дополнительно:
- Процент утилизации = totalSeconds / expectedSeconds * 100
- Процент каждого проекта от общего

## Рендер

### renderSingleCalendar — модификация

1. Grid: добавляем колонку summary (последняя колонка, фиксированная ширина)
2. В заголовке: ячейка "Σ"
3. Для каждой строки-недели: после 5 (или 7) ячеек-дней добавляем ячейку summary
4. После последней недели каждого месяца: полноширинная строка-сводка

### CSS

- `.ujg-calendar-header`, `.ujg-calendar-week`: grid-template-columns добавляет `220px`
- `.ujg-summary-cell`: стили ячейки summary (background чуть другой, компактный текст)
- `.ujg-month-summary`: стили месячной сводки
- Адаптив: на мобильных summary-колонка переходит под неделю

## Файлы

- Modify: `jira/_ujgCommon.js` — добавить `issuetype` в fields
- Modify: `jira/ujg-timesheet.js` — убрать старый report panel, добавить summary column + month summary + "Подробно"
- Modify: `jira/ujg-timesheet.css` — убрать старые стили report panel, добавить стили summary column
