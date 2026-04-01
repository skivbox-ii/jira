# Shared Team Picker Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Обновить shared `team-picker` до UX уровня picker выбранных пользователей, сохранив его текущее API и поведение в `User Activity` и `Daily Diligence`.

**Architecture:** Меняем только UI-shell `ujg-shared-modules/team-picker.js`: trigger, panel, chips выбранных команд и layout списка. Бизнес-логика выбора, `single/multi` режимы, `onChange`, URL/team-sync и API потребителей остаются без изменений.

**Tech Stack:** AMD modules, jQuery, `node --test`, shared UI module used by `User Activity` and `Daily Diligence`.

---

### Task 1: Shared Picker RED Tests

**Files:**
- Modify: `tests/daily-diligence-team-manager.test.js`
- Modify: `tests/user-activity-repo.test.js`

**Step 1: Write the failing test**

Добавить тесты, которые требуют:

- chips выбранных команд внутри panel;
- удаление команды через chip remove button;
- trigger text `N выбрано` для multi-select;
- `User Activity` header по-прежнему встраивает shared team picker и рендерит новый shell.

**Step 2: Run test to verify it fails**

Run: `node --test tests/daily-diligence-team-manager.test.js tests/user-activity-repo.test.js`

Expected: FAIL на отсутствующих chips/new shell assertions.

**Step 3: Write minimal implementation**

Только после RED:

- обновить markup `team-picker.js`;
- не менять business logic выбора ids.

**Step 4: Run test to verify it passes**

Run: `node --test tests/daily-diligence-team-manager.test.js tests/user-activity-repo.test.js`

Expected: PASS для новых тестов.

### Task 2: Shared Picker UI Implementation

**Files:**
- Modify: `ujg-shared-modules/team-picker.js`

**Step 1: Keep public API stable**

Сохранить:

- `create(options)`
- `getSelectedTeamIds()`
- `setSelectedTeamIds(ids, options)`
- `openPanel()`
- `closePanel()`
- `destroy()`

**Step 2: Add new panel structure**

Добавить:

- trigger c понятным текстом;
- panel c actions;
- контейнер выбранных команд chips-ами;
- remove button у каждого chip;
- список rows ниже chips.

**Step 3: Keep selectors for compatibility**

Сохранить используемые селекторы:

- `.ujg-st-team-picker-trigger`
- `.ujg-st-team-picker-panel`
- `.ujg-st-team-picker-reset`
- `.ujg-st-team-picker-cb`
- `.ujg-st-team-picker-radio`
- `.ujg-st-team-picker-row`

**Step 4: Re-run focused tests**

Run: `node --test tests/daily-diligence-team-manager.test.js tests/user-activity-repo.test.js`

Expected: PASS.

### Task 3: Docs Sync

**Files:**
- Create: `docs/plans/2026-04-01-shared-team-picker-redesign-design.md`
- Create: `docs/plans/2026-04-01-shared-team-picker-redesign.md`
- Modify: `README.md`

**Step 1: Update project tree**

Добавить новые plan files в дерево `docs/plans` в `README.md`.

**Step 2: Update plans list**

Добавить короткую ссылку на новый design/plan в блок с актуальными документами.

### Task 4: Final Verification

**Files:**
- Modify: `ujg-user-activity.js`
- Modify: `ujg-user-activity.runtime.js`
- Modify: `ujg-daily-diligence.js`
- Modify: `ujg-daily-diligence.runtime.js`

**Step 1: Rebuild generated bundles**

Run:

- `node build-user-activity.js`
- `node build-daily-diligence.js`
- `node build-widget-bootstrap-assets.js`

**Step 2: Run regression suite**

Run:

- `node --test tests/daily-diligence-team-manager.test.js`
- `node --test tests/daily-diligence-rendering.test.js`
- `node --test tests/user-activity-repo.test.js`

Expected: PASS.

**Step 3: Read lints**

Check diagnostics for:

- `ujg-shared-modules/team-picker.js`
- `tests/daily-diligence-team-manager.test.js`
- `tests/user-activity-repo.test.js`
- `README.md`

**Step 4: Commit only if explicitly requested**

Git rule for this repo: не создавать commit, пока пользователь явно не попросит.
