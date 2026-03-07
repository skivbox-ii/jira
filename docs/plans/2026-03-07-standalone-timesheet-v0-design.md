# Standalone Timesheet v0 Route

## Goal

Add a separate standalone page at `/timesheet-v0` that loads the clean `v0` Timesheet assets while keeping `/timesheet` pointed at the current Timesheet implementation.

## Decisions

- Keep `/timesheet` unchanged and mapped to current `ujg-timesheet.js` and `ujg-timesheet.css`
- Add `/timesheet-v0` as a separate route
- Add `Timesheet v0` as a separate navbar item on standalone pages
- Serve `ujg-timesheet.v0.js` and `ujg-timesheet.v0.css` through the existing widget whitelist

## Changes

### Server

Update `standalone/server.js`:

- add `ujg-timesheet.v0.js`
- add `ujg-timesheet.v0.css`
- add route `/timesheet-v0` returning `standalone/public/timesheet-v0.html`

### HTML

Create `standalone/public/timesheet-v0.html` based on `timesheet.html`, but load:

- `/widgets/ujg-timesheet.v0.css`
- `/widgets/ujg-timesheet.v0.js`

### Navigation

Add `Timesheet v0` link to standalone navbar pages so users can switch between:

- `/timesheet`
- `/timesheet-v0`

## Verification

- syntax-check `standalone/server.js`
- ensure `timesheet-v0.html` references `v0` assets
- check no lint errors in changed files
