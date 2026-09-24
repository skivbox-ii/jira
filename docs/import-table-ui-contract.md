# Import Table UI Contract

The importer registry is the canonical table pattern. New views, including daily activity, must use the same interaction and visual language.

## Header and Filters

- One compact header row. The title, sort indicator, and funnel icon share that row.
- A funnel opens a viewport-constrained popover, never a native select or a permanent second row.
- Include ascending/descending sorting, search, multiple checkboxes, select/clear, apply, and reset.
- Search changes the candidate list, not selections already made. Selected chips, where used, appear once and are excluded from candidates.
- Show active filters and sort direction in the header. Escape and outside click close the popover without applying unfinished edits.
- Keep filters on hidden columns visible and editable above the table. Resetting filters must not reset column layout or sorting. Selected values absent from a new dataset remain visible and removable, never silently discarded.
- Use keyboard-accessible controls and labels; do not rely on hover alone.
- Count popovers support keyboard entry and Escape returns focus to the count. Consecutive keyboard resize steps retain focus; cancelled pointer gestures cannot reorder columns later.

## Columns and Persistence

- Drag a header title to reorder columns; drag the boundary to resize.
- Provide column visibility and reset controls. Keep at least one column visible. Resetting columns preserves applied filters and sorting.
- Persist order, visibility, widths, sorting, and applied filters under a view-specific, user-scoped localStorage key. Never overwrite registry preferences from a report.
- Constrain widths and validate stored values. Storage failures must not break the table.
- Wrap task titles and remarks. Horizontal overflow belongs inside the table region, not the page.

## Daily Activity

- Opening Dynamics selects Jira and loads the current project/epic if not already loaded; keep the imported Excel state intact for returning to the registry.
- Status transitions and team transfers use compact from/to matrix tables. Nonzero counts reveal the underlying events on hover, keyboard focus, or click.
- Event details include Moscow time, task key/title, author, and before/after values; show people, not technical identifiers.
- Translate known statuses and change fields into plain Russian. Format durations as hours/minutes, not seconds. Suppress duplicate WorklogId bookkeeping when the same history already describes changed work time.
- Preserve exact event data internally. Unknown fields remain explicitly labelled; never invent work or a transition from missing values.
- HTML export uses the same human-readable descriptions and filtered/sorted journal as the screen.

## Acceptance

Test multi-selection, search retention, sorting, resizing, reordering, visibility, reload persistence, independent users/views, export, and escaping. Visually verify desktop and narrow layouts. Production verification remains read-only through the Citrix skill.
