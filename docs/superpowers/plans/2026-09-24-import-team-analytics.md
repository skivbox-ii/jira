# Import Team Analytics and Table Refinements

**Goal:** Remove duplicate selected users, make team colors meaningful, show reliable remark statistics and allow local team changes from a selected person.

**Architecture:** Existing AMD modules remain in place. Teams exposes stable identity and role matching. A pure statistics module aggregates original imported rows, independent of pagination and table filters. Rendering adds a compact expandable analytical panel; grid adds a local context menu. No new Jira writes or LLM calls.

**Counting Contract:** Every remark has one overall outcome: not created, incomplete data, ready (parent and every linked child done), open work, or cancelled/closed without acceptance. Directions and team tables count unique remarks per row and may overlap; task counts deduplicate Jira keys. Team ownership uses stable user membership first, then role aliases when no team membership is known; no fuzzy name matching. All loaded remarks are included, not just the current page. Missing status and failed links never imply readiness.

**UI Contract:** Selected users shown as removable chips are excluded from the candidate list. User avatars carry team color; roles carry the role team's color. Ambiguous multi-team membership stays visible in a title, with no false single-team inference. Empty current-work summaries are omitted. Task subjects wrap fully. Right-click and Shift+F10 on a known Jira user open a local team assignment menu; choosing a team moves membership, not a Jira ticket. Existing team defaults and user/project storage scope are retained.

## Work

- [ ] Worker: grid and team-picker changes, context menu and DOM regressions.
- [ ] Parent: pure team matching/assignment and statistics with fixtures for overlapping phases, duplicates, missing data and cancellations.
- [ ] Parent: local assignment handler, identity plumbing, analytics panel, full subject wrapping and styles.
- [ ] Review requested behavior and regressions; run complete suite and verify local desktop/mobile UI.
- [ ] Rebuild and publish importer assets using existing release flow. Citrix verification only via dedicated skill; never change live issues or reset live LLM credentials.
