# Agent Notes

- For dashboard user multi-selects, reuse the Timesheet dropdown layout: the button shows the selected count, selected users are pinned as removable chips at the top, and search keeps those chips visible. Exclude selected users from the candidate list below; never show the same person twice in the dropdown.
- For importer tables, the registry is the UI reference, including new report tabs. Follow `docs/import-table-ui-contract.md`: one compact header row, Excel-style filter popovers with search and multi-select, visible sorting, resizable/reorderable columns, and user-scoped persisted preferences. Do not introduce native select controls or a second filter row. Users shown as removable chips must not be duplicated in the candidate list.
