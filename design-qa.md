# LOAD-01: Smart Loading Bar

## Target and Evidence

- User selected ImageGen option 2 on 12.10.2026.
- Source: `/Users/skivbox/.codex/generated_images/01a0ca03-7a79-7951-95e1-482724334015/exec-8bfceff1-623c-43a6-9086-567775bb79e6.png` (1586x992 pixels).
- Implementation: `http://127.0.0.1:4317/?performance&usability`.
- Final desktop evidence: `/tmp/import-loading-bar-20261012/release/history-mid-run-1440.png` (1440x900 CSS/pixels, deviceScaleFactor 1).
- Final mobile evidence: `/tmp/import-loading-bar-20261012/release/history-mid-run-390.png` (390x500 CSS/pixels, deviceScaleFactor 1).
- Focused evidence: `/tmp/import-loading-bar-20261012/release/status-bar-1440.png` (loading component only).
- The source and final desktop, mobile and expanded-details captures were opened together in one comparison input. Compare the loading band only: the existing registry/Dynamics, mock Jira chrome and synthetic fixture panel are not redesign targets.
- The source is a concept at a different width, not a measured CSS spec. The implementation deliberately uses the importer's existing 12/14px typography and an approximately 84px desktop band. No density resampling or pixel-exact comparison is claimed.

## Iteration 1

- [P2, resolved] The selected concept exposes the number of running requests beside progress. The final strip now shows the actual positive current-run count; previous runs and terminal work do not inflate it.
- Date-change cancellation was confirmed as existing behavior when a historical snapshot is already complete. The acceptance test checks cancellation explicitly and starts a separate real completion run; no pipeline behavior was changed to make the panel disappear.

## Final Iteration

- [P2, resolved] Personal IAB testing found the native `::details-content` wrapper putting expanded details beside the rail. The scoped CSS rule makes that wrapper layout-transparent. Rechecked personally at 1440 and 390: details span the full band below its controls. A browser geometry assertion and focused CSS/disclosure regression cover it.
- A final outer render after local date navigation discarded the new filter draft. The rendered-scope marker now follows the actual draw. Personal IAB completion retained the open search text `АСУ` and focus; unit and browser checks also retain selection and scroll without applying the draft.
- No open P0/P1/P2 visual findings remain in this scope. No P3 follow-up is required for handoff.

## Fidelity Surfaces

- Fonts: existing importer family and compact optical sizes; tabular timer, restrained stage weight, no viewport-scaled type or negative tracking. Smaller than the concept by design to match the real table.
- Layout: flat full-width band, stage rail at left, thin meter below, separated timer/icon controls and Details at right. No nested or floating cards. Mobile wraps into clear rows; expanded details occupy a full-width row with bounded scrolling. Measured viewport overflow checks pass.
- Colors: white background, blue active/progress, green completion, muted pending and red error. Existing importer tokens remain in use.
- Assets: standard existing/Lucide icons only. The generated table and mock chrome are reference context, not runtime bitmap assets; no illustrative assets need replacing.
- Copy: real stages and actual completed/total counts plus active-request count. The concept's completed registry stages are not fabricated in a separate history run. Unknown totals remain indeterminate, with no invented ETA.

## Verified States

- `tests/browser/import-loading-acceptance.cjs` passed at 1440x900 and 390x500 with 1000 tasks and 900/1000/1100 daily events, zero Jira writes, zero LLM calls and zero page errors.
- Collapsed defaults, keyboard disclosure, full-width details, all 1000 request rows, ticking timers without replacing nodes, Stop/Restart/Retry and retained error evidence pass.
- Success hides the entire panel with no leftover spacing or reveal-scroll. Errors and stops stay visible. Filter drafts/focus, late-reply protection, comment pagination and prior snapshots are preserved.
- Reduced-motion animation is disabled in the actual browser; no page overflow at either viewport. Personal IAB repeats cover loading, completion, disclosure, stop and mobile layout. Viewport override restored after verification.
- Screenshots: `release/history-details-1440.png`, `release/history-stopped-390.png`, `release/history-error.png`, `release/history-error-recovery.png`, `release/history-final-draft-1440.png` under the evidence directory above.
- This is local UI acceptance, not Citrix acceptance. The user retains production control.

final result: passed


# REG-10: Epic picker reference correction — 27.10.2026

## Target and evidence

- Approved target: `/Users/skivbox/Desktop/Снимок экрана 2026-10-27 в 17.33.54.png`.
- Rejected previous layout: `/Users/skivbox/Desktop/Снимок экрана 2026-10-27 в 17.25.44.png`.
- Implementation: `http://127.0.0.1:4318/?empty&usability&progressive&multiEpics&epicCatalog=long`.
- Final personal evidence: `/tmp/import-epic-filter-reference-20261027/personal-popup.png` and `personal-desktop.png`.
- Browser evidence: `reference-390x500.png`, `all-selected-390x500.png` and `final-390x844.png` in the same directory.
- Target and final personal/mobile captures were opened together in one comparison input. The supplied crop has unknown browser zoom/device scale and a roughly508px-wide popup; the existing registry implementation is282CSSpx. Comparison normalizes by popup structure and established CSS dimensions, not an invented exact source DPR. No bitmap resampling/pixel-exact claim.

## Findings and final comparison

- [P2, resolved] The previous custom checklist differed from the approved registry filter: no pinned chips or select-all row and wrong footer placement. Shared filter classes now provide commands/search/chips/count/list/right-aligned footer,282CSSpx width.
- [P2, resolved] Long names aligned the checkbox with their middle. Candidate-only flex-start and1px offset now align the first line; select-all stays centered. Final browser geometry proves the first-line offset at all three viewports.
- [P2, resolved] Growing selected chips could move the footer below a short viewport. Placement now reclamps on draft/search changes; at390×500 the footer remains within481px. Independent chip/list scrolling keeps controls visible.
- Fonts and colors: existing importer12px text,11px selected chips, blue chip/primary-button and neutral borders. No new fonts, assets, framework, arbitrary restyling or generated bitmap UI.
- Layout: target command order and compact density preserved; long epic labels wrap rather than hide their identity. First screenshot contains shorter person names, so row heights intentionally vary with actual text. Search keeps selected chips, without duplicates below.
- Assets: existing ArrowDownAZ, ArrowUpAZ, FunnelX, X icons. Copy: same commands, search, select-all and OK/Cancel; empty-set meaning explicitly preserved. Sorting tooltip identifies the epic-choice list only.
- Verified1440×900/390×844/390×500; native keyboard selection/removal/focus, all21 selected, empty results, last rows, apply/cancel and persistence. Personal IAB desktop/short-mobile checks agree with browser screenshots. No open P0/P1/P2 findings; no P3 follow-up required.
- Production CSS cause remains unproven; this is local acceptance. Citrix remains with the user and was not accessed.

final result: passed
