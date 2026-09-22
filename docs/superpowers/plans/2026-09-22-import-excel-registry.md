# Excel Import Registry Implementation Plan

**Goal:** Implement the approved compact registry mockup, publish it, and verify the existing production dashboard without creating or modifying tickets.

**Design:** Approved in the conversation: a single compact context toolbar and a hierarchical table with Excel-style filters in column headers. Source ID, source owner, issue type/role, status, status age, assignee and actions remain distinct. New, failed and partially created remarks retain their existing creation safeguards. All ticket mutations remain user-operated.

**Architecture:** Keep the AMD/jQuery gadget and existing dialogs. Add a pure registry model and a grid renderer; retain import, mappings, AI review and export callbacks. Enrich existing manual synchronization only, with no automatic requests added. No new runtime dependencies.

## Work

- [x] Registry model: flatten parent/child data, source IDs, honest unknown values, per-column filtering and stable group sorting. Test child-only matches, combined filters, empty selections, natural ID order and missing dates.
- [x] Grid: header dropdown search/checklists, apply/cancel/reset/sort, selected-user chips, expansion, pagination, column chooser and accessible keyboard dismissal. Compact toolbar, counters in a popover, original create/AI callbacks by source index.
- [x] Data: retain rich issue metadata during explicit synchronization; compute status age only from trustworthy history. Prefix new issue summaries with actual source ID, never the Excel row number. Worker owns main.js/creator.js/api.js and data tests.
- [x] Local validation: importer and bootstrap tests; actual browser interactions against offline fixtures with all Jira requests blocked; desktop and narrow viewport screenshots.
- [ ] Release: inspect diff, commit only scoped files, publish to main, generate importer bootstrap pinned to the code commit, verify CDN assets.
- [ ] Production: use the existing open dashboard, update its asset version, reload if needed, select the first Excel file, inspect grid and exercise local filters. Never click Create, AI correction or Jira synchronization during this check.

## Review Focus

- A child matching filters must not disappear with its parent, and unrelated siblings must not pretend to match.
- A partial create already has a Jira key and must never offer duplicate creation.
- Empty Jira statuses and assignees must stay distinguishable from source Excel statuses and owners.
- Filter interaction must preserve selection across search, re-renders and new workbook loads without index drift.
- Missing or truncated changelog must not manufacture a time-in-status from last update.

## Authorization And Progress

The user approved the final mockup, implementation, publishing and production reload/file selection. No additional design approval is pending. Existing read-only ticket constraint persists. Production navigation may execute the gadget's existing bootstrap and initialization, but no direct ticket API calls will be made by the agent.

Initial tracked worktree clean at 4d97fb8. Three unrelated untracked docs were present and are excluded.

Verified locally: 631 repository tests, 7 DOM interaction tests, and a real Chrome run with a 71-row workbook. Table starts at 98px on desktop; 1920px, 2400px and 390px screenshots inspected. No browser errors, external requests or issue mutations. Review regressions cover native chip removal, independent faceted filters, shared source-ID extraction, missing metadata, workflow category colors and preserved scroll position.

Production control uses only the testing-citrix-prod WindowSim stack. At the local verification checkpoint, its target lookup could not find any Citrix/XView window. Publication and production verification are separate checkpoints; a successful push does not mean the dashboard has loaded it.
