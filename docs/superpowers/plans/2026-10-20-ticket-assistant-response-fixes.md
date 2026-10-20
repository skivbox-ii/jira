# Ticket Assistant Response Fixes

## Specification

User approved fixing both observed preparation failures, duplicate
warnings, and unclear errors; use Sol 6.1 Author/Reviewer, test, commit,
push, then personally complete one explicitly marked test issue in
Citrix. Starting revision: 60f7129.

## Global Constraints

- Preserve explicit field scope, selected issue type/template, metadata
  validation, user edits, evidence integrity and creation guards.
- Never infer an option ID from a label or accept an unknown catalog ID.
  A lossless conversion of a literal ID into its canonical representation
  may be accepted only with all existing authorization/catalog checks.
- Do not silently discard malformed fields to present a complete draft.
- Errors must identify the actionable reason without exposing raw model
  content, credentials, transport payloads or unsanitized field paths.
- No additional provider, automatic live retries, silent truncation or
  weakening of JSON/prototype/secret protections.
- Test fixtures are synthetic. Only the parent operates Citrix using the
  testing-citrix-prod skill. Production writes are limited to the one
  user-authorized test issue; do not bypass the dashboard flow.
- Preserve unrelated work and the pending production acceptance report.
- Manual edits use apply_patch. Author and independent Reviewer are
  gpt-6.1-sol with medium reasoning.

## Task 1: Diagnose And Fix

First failure: observed live response encoded components as string IDs
instead of objects with id. The entire draft was rejected. An offline
fixture confirmed the shape mismatch.

Second failure: preparation still failed after explicitly excluding
components and fixVersions from generation. Parent must inspect its
response before author implements its root-cause fix.

Investigation outcome: that historical response was not retained. Two
bounded retries on the old production version succeeded, so its cause
remains unknown. Do not invent a root-cause fix; add safe diagnostics,
test the excluded-catalog contract locally, and exercise it after release.

Warning duplication: ui.js concatenates draft warnings and validation
warnings after draft.markChecked copies validation warnings to draft.

Write failing regression tests, make narrowly scoped corrections, add
safe actionable diagnostics, and run covering tests. Update generated
assistant assets using the existing build.

## Task 2: Review And Verify

Independent Sol 6.1 review of specification compliance and code quality.
Parent inspects final changes, runs full unit/browser regression, build
checks and personal desktop/mobile UI checks with stubbed AI/Jira.

## Task 3: Publish And Accept

Commit/push through the existing main/bootstrap-pinning workflow. Verify
CDN assets. In Citrix reload, prepare the clearly marked synthetic bug,
answer questions/select required catalog fields, check, create exactly
once, and verify the issue link/result. On ambiguous creation outcome,
do not retry automatically. Update acceptance evidence honestly.
