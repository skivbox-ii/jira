# Daily remark activity implementation

Approved: daily report mockup and execution, 2026-09-24. Production ticket writes remain prohibited.

## Scope and semantics

- Add Registry / Activity tabs without replacing the Excel / Jira source selector.
- Report a selected calendar day in Europe/Moscow (UTC+03:00), half-open interval.
- Retain normalized Jira changelog with author, timestamp, status and assignee transitions; show other changed fields in the journal as metadata changes, not proof of work.
- Deduplicate issues and events globally. Group the journal under current parent remarks; shared events can occur in multiple groups but metrics count them once.
- Count newly created Jira parent stories separately from child creation and Excel imports. Completion/reopening require complete, consistent history for the parent and all current linked children. Historical scope is explicitly the currently linked tasks, not historical link membership.
- Show coverage and unknown totals clearly. No fabricated zero for unavailable balances; cancelled is not done. Team transfers use stable assignee identifiers and current local team mapping.
- Export a standalone, escaped HTML snapshot with date, source scope, coverage and current team mapping. No live scripts or credentials.
- Jira Server 8.20 uses the documented `GET issue?expand=changelog` read. If the server still returns a partial changelog, the report remains explicitly incomplete; no unsupported Cloud pagination endpoint is assumed. Reference: https://docs.atlassian.com/software/jira/docs/api/REST/8.20.0/#api/2/issue-getIssue.

## Modules and contracts

`activity.js` AMD `_ujgESI_activity` depends on `_ujgESI_teams`:

- `capture(issue)` returns a serializable history snapshot, retained as `details.activity` on parent and child details.
- `day(date)` returns `{date,start,end}` in milliseconds, validates YYYY-MM-DD; `today(now)` uses Moscow.
- `summarize(rows, teams, {date, now, scopeWarning})` returns report described below.
- `exportHtml(report, context)` creates an escaped standalone snapshot. UI supplies filtered report and context `{projectKey,epicKey}`.

Report contract:

```
{date, start, end, generatedAt, timezone:'МСК',
 coverage:{complete,total,incomplete,uncreated, warnings:[], isComplete},
 metrics:{changed,newRemarks,completed,reopened,events},
 balance:{startOpen,endOpen}, // null when not fully reconstructable
 transitions:[{from,to,count}],
 transfers:[{from,to,count}],
 groups:[{id,remarkId,key,summary,events:[event]}],
 events:[event], teams:[normalizedTeam]}
event = {id,at,kind:'status'|'assignee'|'created'|'field',field,
 issueKey,summary,role,from,to,author,assignee,fromAssignee,toAssignee,
 fromTeam,toTeam,color,roleColor}
person = {label,identifiers:[],color}
```

Metric null means unknown; valid observed partial event counts remain usable, explicitly under incomplete coverage. `completed` and `reopened` are unique remarks with at least one evidenced all-tasks transition in the day. Balances are endpoints, not arithmetic on intermediate events. UI filters affect journal only; daily totals are labeled independently.

`activity-ui.js` AMD `_ujgESI_activityUi` depends on jquery, activity, icons:
- `create()` returns `{render($parent,state,services)}`; retains selected date, filters, sorting and collapsed groups within that instance.
- state includes rows, teams, projectKey, epicKey, registryWarning, activityLoading, activityError.
- services optionally `onLoadActivityHistory` read-only refresh for incomplete snapshots. UI exports via activity.exportHtml.
- Rendering integrates one activity UI instance and a separate active tab without affecting existing registry state.

## Work sequence

1. Pure domain tests first: day boundaries, authors, partial/malformed histories, deduplication, creation, per-remark all-ready and reopen, team moves, escaped export.
2. Implement normalization and aggregation in activity.js.
3. UI worker implements activity-ui.js, scoped CSS and browser tests from this contract and approved image. Parent owns rendering/main/api integration and preview data.
4. Retain capture in issueDetails/children; add read-only full issue-history enrichment with bounded concurrency and stale-scope protection. Integrate tabs and module build ordering.
5. Add deterministic preview histories and integration tests. Run focused tests, full widget suite, build and browser desktop/mobile checks.
6. Independent review, fix findings, rebuild. Publish only task files and verify CDN assets. Verify via Citrix skill only, without ticket writes.

## Acceptance

- Existing import, tree, mappings, teams, layout and fullscreen still operate.
- Daily report exposes time, parent ID, child role/key, before/after and actual change author.
- Missing history and absent assignee memberships are visible, not guessed.
- Switching report/date/filter never creates or changes tickets.
- Export remains safe with untrusted Jira text.
