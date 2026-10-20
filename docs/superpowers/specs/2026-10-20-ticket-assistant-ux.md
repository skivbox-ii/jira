# Ticket Assistant: Guided Editing

Approved by the user on 20 October 2026 following the local UX audit.
Baseline: 7a005ea. Implement with gpt-6.1-sol Author/Reviewer, test,
personally verify the UI, then commit and push through the existing release flow.

## User Experience

- One compact header: project, template, Jira type and icon controls for
  settings, AI connection, token details and fullscreen. Reuse existing
  dashboard dropdowns/icons; retain selection chips without duplicates.
- A compact source/assistant area beside a wider ticket editor. Mobile
  must remain usable without overlapping controls or page-width overflow.
- Summary first, description second, environment and required fields next.
  Empty optional fields belong in an expandable Additional group. Filled,
  pending, required and invalid fields must remain visible. Unknown fields
  get an actionable explanation, never a fake editable control.
- One visible assistant response area for changes, warnings and questions,
  with navigation to the corresponding field. No duplicate warnings.
- Field-level AI assistance for supported writable non-user fields: generate
  or improve using the source, template, current draft and target field.
  Text fields additionally support shortening. Estimates must not be invented.
  AI proposals always require explicit Apply, including initially empty
  target fields; reject leaves the current value intact. Manual values in
  other fields never change. Stale responses/proposals cannot overwrite edits.
- Existing whole-ticket Prepare remains available, retaining its protected
  manual-field behavior. Check remains validation, not silent mutation.
- Components/versions must resolve only to actual allowed catalog entries;
  show meaningful labels and evidence/reasons. Ambiguity requires user choice.
- Epic and Sprint get metadata-driven selectors using trusted Jira endpoints,
  not arbitrary autoCompleteUrl or hardcoded custom field IDs. Only values
  permitted by the selected project/type/screen can be sent. Sprint discovery
  is board-scoped; show board choice where necessary. Story Points use the
  actual numeric schema, with explicit human input rather than guessed effort.
- Token breakdown moves into an accessible popover. Over-budget errors stay
  visible with access to settings. Fullscreen/Escape preserve the draft and
  restore layout. Primary actions remain easy to reach.

## Safety And Compatibility

- Existing shared LLM provider/configuration only; no live LLM or production
  Jira calls for automated tests. No new production issue in this scope.
- Preserve storage scoping, creation/unknown-outcome locks, explicit scope,
  metadata validation, evidence integrity and stop/stale-response guards.
- No silent prompt truncation, hidden incomplete catalogs or invented IDs.
- Source and persisted settings remain compatible. Do not rewrite other
  dashboards or expose secrets/private production fixtures.
- Use existing AMD/jQuery/lucide/build architecture; no new UI framework.
- This release is locally verified and published, not automatically accepted
  in Citrix. Production acceptance needs fresh personal evidence later.
