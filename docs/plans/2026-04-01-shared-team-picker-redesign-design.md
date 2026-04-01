# Shared Team Picker Redesign Design

## Goal

Привести фильтр команд в шапке `User Activity` к тому же UX-паттерну, что и picker выбранных пользователей: понятный trigger, chips выбранных элементов, reset и аккуратная panel-вёрстка.

## Current State

- `ujg-shared-modules/team-picker.js` использует старый UI: обычная кнопка-trigger и список `checkbox`/`radio` внутри popup.
- `ujg-user-activity-modules/multi-user-picker.js` уже использует более удобный паттерн с trigger, chips и actions.
- `team-picker` — shared-модуль, он используется и в `Daily Diligence`, поэтому редизайн должен сохранить текущую бизнес-логику и совместимость API.

## Chosen Approach

Переделать только UI-shell `team-picker`, не меняя его публичный контракт:

- сохранить `create(options)` и методы `getSelectedTeamIds()`, `setSelectedTeamIds()`, `openPanel()`, `closePanel()`, `destroy()`;
- сохранить текущую логику `single`/`multi`, `selectedTeamIds`, `onChange`, custom `getTeamLabel`;
- добавить внутри panel блок выбранных команд chips-ами;
- оставить список команд на `checkbox`/`radio`, но оформить его тем же визуальным паттерном, что и picker пользователей;
- trigger должен показывать:
  - `0 команд` при пустом выборе;
  - название команды при одной выбранной;
  - `N выбрано` при нескольких выбранных.

## UX Contract

### Trigger

- кнопка остаётся компактной для шапки;
- текст должен быть читаемым и не прыгать по высоте;
- при нескольких командах показываем счётчик, а не длинную строку имён.

### Panel

- сверху блок chips выбранных команд;
- рядом/ниже `Сбросить`;
- ниже список всех команд с `checkbox` или `radio` в зависимости от mode;
- удаление chip должно снимать выбранную команду и синхронно обновлять список.

## Styling Strategy

- не завязываться на `ujg-ua-*`-классы как на единственный источник стилей;
- добавить собственные `ujg-st-team-picker-*` классы в shared component markup;
- использовать уже существующие контейнеры и текущую модель открытия/закрытия panel;
- сохранить старые тестовые/интеграционные селекторы (`.ujg-st-team-picker-trigger`, `.ujg-st-team-picker-cb`, `.ujg-st-team-picker-radio`, `.ujg-st-team-picker-reset`) чтобы не ломать потребителей без необходимости.

## Files

- Modify: `ujg-shared-modules/team-picker.js`
- Modify: `tests/daily-diligence-team-manager.test.js`
- Modify: `tests/user-activity-repo.test.js`
- Modify: `README.md`

## Risks

- shared picker используется в `Daily Diligence`, поэтому нельзя менять его event contract;
- нужно не потерять закрытие popup по клику вне компонента;
- trigger text и chips должны обновляться одинаково как после ручного выбора, так и после `setSelectedTeamIds(...)`.

## Verification

- unit-тесты shared `team-picker` на chips/trigger/reset/remove;
- интеграционный тест `User Activity`, что header продолжает встраивать picker и показывает новый UX;
- полные regression tests для `user-activity` и `daily-diligence`, которые уже используют shared picker.
