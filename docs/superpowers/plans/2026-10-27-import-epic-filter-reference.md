# Epic Filter Reference Correction

> **For agentic workers:** Use superpowers:subagent-driven-development; one bounded author task and independent review. User explicitly supplied the approved visual target and authorized the correction; no new design approval is needed.

**Goal:** Make the Epic picker follow the registry person-filter visual pattern shown in the user's first screenshot.
**Architecture:** Reuse existing filter classes/icons and draft callbacks in rendering; preserve canonical epic scope, transport and storage. Selected epics become removable chips, not repeated candidate rows.
**Tech Stack:** Existing AMD/jQuery/CSS; Node/JSDOM26.1 and local mocked browser.
**Spec:** First screenshot `/Users/skivbox/Desktop/Снимок экрана 2026-10-27 в 17.33.54.png`; current incorrect layout shown in `17.25.44.png`.

## Global Constraints

- Existing branch/base428b766, preserve unrelated files. Sol6.1 medium Author/Reviewer. No new user tasks or production access. Publication already authorized.
- Target registry filter styling: compact ~282 CSS px popup, sort/reset commands above search, removable selected chips, select-all/count, scrollable candidates, separated right-aligned OK/Cancel footer.
- Sort commands sort the epic catalog locally (not registry rows); titles explain this scope. Reset clears the draft; OK still required. Empty draft means all project stories and must remain explicit.
- All selected chips remain visible during search; exclude selected keys from candidates, even when all selected. Unknown saved keys remain removable. Global selected/total count; select-all affects all matching catalog keys including already selected, preserving nonmatching selections; checked/indeterminate represent matching keys.
- Preserve deferred Apply, cancel/Escape/outside, saved user/project set, late-result guards, scalar creation target and 50/25 loading. No query/cache changes.
- Preserve existing icons/fonts/tokens. No new assets/framework/architecture. CSS protects checkbox/text row against surrounding form defaults; do not attribute exact production cause without evidence.

## Review Focus

- Removing a chip while searching restores candidate only when it matches; no duplicate or stale checkbox.
- All/partial/none selection; empty results; saved key not in catalog; sort while draft open.
- Native click/keyboard labels toggle once, focus remains useful after a selected row moves to chips, search caret/scroll survive.
- Many long labels/chips: desktop1440, narrow390, short390x500; search/footer remain reachable.
- Host styles and search hide/show must not stack checkbox above label or produce sideways overflow.

### Task1: Picker implementation and focused regressions (Author)

Files: rendering.js, importer CSS, tests/excel-story-importer-epic-picker.test.js, directly affected source tests only if required. Do not touch controller browser acceptance/fixtures, generated bundles or docs.
- [x] Reproduce old missing chips/select-all and inspect existing grid filter implementation; add RED tests.
- [x] Implement the reference layout and draft semantics without scope changes.
- [x] Test label click, chip removal, search/selectall/indeterminate/reset/cancel/sort/missing-key and scoped CSS; report evidence. No build/commit/push.

### Task2: Browser acceptance, review, publication (Controller)

Files: existing multi-epic browser acceptance/fixture/server as needed, generated JS/runtime, docs/backlog/contract and design-qa.md.
- [x] Extend fixture to realistic catalog with long names, at least21epics. Preserve original3 partitions for union regression.
- [x] Browser RED on old UI, then verify chips/no-duplicates/search/all/count/sort/reset/OK/cancel and popup geometry1440/390/390x500; retain union/persistence/late-scope regression.
- [x] Personally inspect local interface and compare target/implementation screenshots together; record QA.
- [x] Independent Sol6.1 review, focused/full tests, build, release/CDN match; leave Citrix acceptance pending.
