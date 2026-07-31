# Timesheet: strict month boundaries

## Problem

The calendar currently groups dates by ISO-style weeks and inserts a monthly summary only after the last complete rendered week containing that month. When a week crosses a month boundary, the first days of the new month appear above the previous month's summary.

## Design

- A rendered calendar row must contain dates from one month only.
- A week crossing a month boundary is split into two partial rows.
- Empty cells preserve each date's weekday position. For example, July 1 on Wednesday remains in the Wednesday column.
- The weekly summary in each partial row is calculated only from dates rendered in that row.
- The monthly summary is rendered immediately after the last partial row of that month.
- Monthly totals continue to use all loaded dates belonging to that month.
- Detail transitions follow the same partial-row date range and remain available for right-click worklog creation.

## Example

For June 29 through July 3, 2026:

1. Render June 29-30 in Monday-Tuesday columns and leave the remaining weekday cells empty.
2. Render the June monthly summary.
3. Render July 1-3 in Wednesday-Friday columns and leave Monday-Tuesday empty.

## Verification

- Add a unit test for a week crossing June and July.
- Verify that no rendered row contains dates from different months.
- Verify partial-week summaries and transition date ranges.
- Run the complete test suite and rebuild widget runtime/bootstrap assets.
