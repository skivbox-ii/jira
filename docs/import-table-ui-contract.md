# Import Table UI Contract

The importer registry is the canonical table pattern. New views, including daily activity, must use the same interaction and visual language.

## Header and Filters

- One compact header row. The title, sort indicator, and funnel icon share that row.
- A funnel opens a viewport-constrained popover, never a native select or a permanent second row.
- Include ascending/descending sorting, search, multiple checkboxes, select/clear, apply, and reset.
- Search changes the candidate list, not selections already made. Selected chips, where used, appear once and are excluded from candidates.
- Role, change-category and other non-person filters keep a stable checkbox list: toggling a value must not move the other values into chips or recreate the focused checkbox. Provide a per-value "only this value" command for quick narrowing.
- Removing a selected-person chip must keep the popup open, preserve the other selections and remain a draft until Apply. Test native bubbling clicks on both the label and the cross icon, not just synthetic change events.
- Long value lists get a wider viewport-constrained popup with a scrollable list; search and Apply remain accessible. Searching and select-all operate only on matching candidates without clearing selections outside the search.
- Show active filters and sort direction in the header. Escape and outside click close the popover without applying unfinished edits.
- Keep filters on hidden columns visible and editable above the table. Resetting filters must not reset column layout or sorting. Selected values absent from a new dataset remain visible and removable, never silently discarded.
- Use keyboard-accessible controls and labels; do not rely on hover alone.
- The shared Excel/Jira team filter lives in the existing toolbar. QA includes tasks in Testing/In Testing regardless of role or terminal metadata, OR QA-role tasks in any status, OR tasks assigned to configured QA members. This applies to original stories and children; use stable member identifiers, never display names. Identify QA through configured roles, not the team display name. Other teams match configured roles or member identifiers. Selected teams are OR alternatives; column and explicit completion filters still intersect on the same task. Keep parent context, independent disclosure, saved selection and global reset. Use stable searchable checkbox rows with a per-team only-this action; absent saved team IDs remain visible and removable.
- In the registry status filter, keep completion scopes independent: "Исключить готовые" excludes only completed child tasks; "Исключить готовые истории" excludes the entire group of a completed original story. The first option alone must keep completed stories, including those with no remaining visible children. Both options are drafts until Apply and clear together when the status filter is reset.
- Count popovers support keyboard entry and Escape returns focus to the count. Consecutive keyboard resize steps retain focus; cancelled pointer gestures cannot reorder columns later.

## Columns and Persistence

- Drag a header title to reorder columns; drag the boundary to resize.
- Provide column visibility and reset controls. Keep at least one column visible. Resetting columns preserves applied filters and sorting.
- Persist order, visibility, widths, sorting, and applied filters under a view-specific, user-scoped localStorage key. Never overwrite registry preferences from a report.
- Excel and Jira share the same registry filters. Preserve them through source/data changes, report navigation and reload, including missing selected values and empty results. Show the reset-all-filters icon in the top toolbar whenever filters are active, even with an empty source.
- Excel and Jira have independent user-scoped column visibility, order and widths. Seed both profiles from the prior shared layout before either is edited; preserve other existing preferences. Keep filters and sorting shared. Reset columns only for the active mode, including after switching through empty/loading data.
- Keep separate "Срок Excel" and "Срок Jira" columns, both selectable in either mode. Excel defaults to the mapped workbook date; Jira defaults to each issue's actual Due date, without inheriting the original Story's date into children or substituting Excel data. Show valid dates before today's Moscow date in red bold text; today's date is not overdue until the next Moscow day. Missing/invalid dates are not guessed or marked overdue. This date highlighting does not redefine completion or activity totals.
- Put per-remark disclosure and tracking buttons below the remark ID; do not reserve a separate disclosure column. Retain accessible controls when ID is hidden, without introducing a new dedicated column.
- Contextual parents stay selectable for expand/collapse when a child matches. Manually expanding one remark temporarily reveals all of that remark's linked tasks, including filtered-out children, without revealing other excluded remarks. Every filter Apply/OK (even an unchanged draft) or reset clears temporary disclosure exceptions. They are not persisted. Sorting, resizing and tracking changes do not clear them. Bulk header/toolbar disclosure keeps filtering in force across pages.
- Track remarks with an empty/filled star. Persist tracking per user and project, shared across Excel/Jira, with durable identity rather than row position. Reload, reimport, sorting and absent rows must not lose tracking or transfer it to an unrelated remark. The ID filter includes All / Only tracked / Without tracked; confirm the draft before persisting and intersecting it with other filters. Cancellation does not apply it. Resetting filters clears the tracking mode, not the tracked list.
- Constrain widths and validate stored values. Storage failures must not break the table.
- The explicit fit-widths command uses compact utility columns, a wide fixed remark, and only the task summary as a flexible column. Persist fitting independently for Excel/Jira without changing existing layouts before the command. Manual summary resizing exits fit mode; other manual widths stay fixed while summary absorbs remaining space. Hidden summary does not absorb space. Container resizing must not redraw the table or discard a filter draft. Column visibility is a draft until OK; cancelling or fitting widths must not apply unconfirmed visibility.
- Wrap task titles and remarks fully, without line clamps or ellipses, including collapsed groups and remarks not yet created in Jira. Horizontal overflow belongs inside the table region, not the page.

## Status Changes and Loading

- Status editing is issue-specific for both original stories and linked tasks. Offer only current-user transitions returned by Jira, with destination and available metadata hints. Selecting an option does not write; require explicit Apply. Transitions with additional fields go to the Jira card. Do not invent field values or update the status field directly.
- Revalidate a selected transition before execution, prevent duplicate submissions, and refresh actual issue data after success. Do not show an optimistic terminal status as fact. Failed readback retries only reads; an uncertain write outcome must not trigger an automatic repeat. Stale background reads or scope changes must not overwrite a confirmed fresh snapshot.
- Loading has visible request stages, actual pages/batches or issue keys, counts, states, elapsed time and errors, with Stop, Restart and read-retry controls. Never manufacture a page count or assume the server returned the requested page size. Cancellation invalidates late results and stops further scheduling; a partial registry must not replace the previous complete snapshot.
- Present loading as a compact flat stage bar above the table, with actual stage counts, elapsed time and icon controls. Show a percentage only with a known denominator; unknown work stays indeterminate without an invented ETA. Request rows and snapshot metadata belong in keyboard-accessible Details, collapsed on each new run. Do not show a permanent wall of zero counters or disabled actions.
- Completely hide the bar and its spacing after successful completion or idle; later date changes, filtering and rendering must not resurrect it. Error and cancelled states stay visible with an explicit retry/restart action. Retain earlier failure evidence during retry without adding its rows to current-run totals.
- Keep the previous snapshot intact and its actual age available in Details during update, failure and retry. Progress and timer updates must preserve table filters, drafts, focus and scroll. Long request lists remain inspectable without making timer ticks rebuild the whole table or announce every elapsed second. Only an explicit history refresh may reveal the bar by scrolling; background progress, dates and completion must not move the page.

## Daily Activity

- Opening Dynamics selects Jira and loads the current project/epic if not already loaded; keep the imported Excel state intact for returning to the registry.
- Status transitions and team transfers use compact from/to matrix tables. Nonzero counts reveal the underlying events on hover, keyboard focus, or click.
- Event details include Moscow time, task key/title, author, and before/after values; show people, not technical identifiers.
- Translate known statuses and change fields into plain Russian. Format durations as hours/minutes, not seconds. Suppress duplicate WorklogId bookkeeping when the same history already describes changed work time.
- The Change filter selects categories of changed data (status, assignee, description, work logged, estimate, etc.), never individual before/after descriptions. Keep full descriptions in journal rows and use the same category selection for export. Classify by event kind and field identity, not by parsing display text; unknown fields share an explicit Other fields category. Migrate obsolete description-based selections once without resetting other filters or column preferences.
- Preserve exact event data internally. Unknown fields remain explicitly labelled; never invent work or a transition from missing values.
- HTML export uses the same human-readable descriptions and filtered/sorted journal as the screen.
- Hide the duplicate remark ID column by default: the group heading retains the ID and Jira link. Allow explicit opt-in and preserve it after reload; migrate old layouts without losing filters, widths, order or the last visible column.
- Group headings distinguish the current original-story status from selected-day outcomes, show the linked task count, and use short factual highlights. Do not infer full remark completion from one completed child, or count no-op status changes as completed work. Journal filtering must not silently change the whole-day group summary.

## Acceptance

Test multi-selection, search retention, sorting, resizing, reordering, visibility, reload persistence, independent users/views, export, and escaping. Visually verify desktop and narrow layouts. Production verification remains read-only through the Citrix skill.
