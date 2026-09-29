# QA Queue Union Correction

**Goal:** Implement the user's 29.09 instruction to test and deploy the updated QA filter immediately.
**Architecture:** Preserve the existing shared Excel/Jira filter. In `teams.queueTeamIds`, use `isQa && qaStatus || roleMatch || memberMatch`. Match configured member IDs/aliases, not display names. Apply the same function to parent and child rows; keep ordinary filters intersecting on the same row. No changes to `currentWork` or Jira data.
**Tech Stack:** AMD JavaScript, node:test/jsdom, local Playwright, read-only Citrix.

## Approved Scope

- Exact normalized Testing/In Testing/Тестирование/На тестировании matches QA regardless of role, assignee, or stale terminal metadata.
- Any configured QA-role task matches, including completed, cancelled, and unknown statuses.
- Any task assigned to a configured QA member matches, including an original Story and a non-QA child.
- Team identity stays based on configured role QA; renamed teams keep the rule. Other teams retain role/member union.
- OR never duplicates rows or exposes unmatched siblings. Explicit completion/status/assignee filters still intersect; do not reset user filters silently.

## Execution

- [x] Update `tests/excel-story-importer-teams.test.js`, run it against unchanged code and record failing cases.
- [x] Remove terminal/open gating and early QA return in `ujg-excel-story-importer-modules/teams.js`; run focused unit tests.
- [x] Update `tests/browser/excel-story-importer-grid.test.cjs` and `tests/browser/import-team-queue-acceptance.cjs` for all three branches, parent/member identities, explicit completion filters and persistence. Keep browser requests local only.
- [x] Rebuild with `node build-excel-story-importer.js`, run focused and full tests, independently review with gpt-6-sol/medium. Preserve stable identities on newly created children; reviewed separately with a red/green regression test.
- [x] Personally run/view desktop 1440 and mobile 390 local acceptance, including filtering, collapse/expand, source/reload and last rows.
- [ ] Update table contract and backlog, publish only scoped importer changes using existing main/CDN process. Attempt Citrix read-only only with available/uncontested control; do not claim blocked acceptance passed.
