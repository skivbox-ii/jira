# Daily Activity Corrections

User-approved reference: existing registry table. No new visual direction is needed.

1. Reuse the registry-style header popovers, multiple filters, sorting and persistent column layout in activity UI; replace status pills with a matrix and add event drilldowns to counts.
2. Add tested Russian event/status formatting shared by UI and HTML export. Suppress redundant worklog bookkeeping, format seconds, and retain unknown values without guessing.
3. Opening Dynamics selects Jira and loads the current scope once. Preserve Excel rows and avoid duplicate or stale requests across source/project/epic changes.
4. Handle Jira Server search timestamps that omit milliseconds without accepting changes in a later second. Keep contradictory histories incomplete.
5. Run focused and full tests, review integration, visually verify the entire selected day locally and through Citrix, then release only importer assets. Never modify Jira tickets.
