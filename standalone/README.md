# UJG Standalone Server

Standalone server for viewing UJG Jira widgets outside of Jira.

## Quick Start

```bash
cd jira/standalone
npm install
npm start
```

Open http://localhost:3000, enter your Jira Server/DC credentials.

## Environment Variables

- `PORT` — server port (default: 3000)
- `SESSION_SECRET` — session secret (auto-generated if not set)

## Widgets

- `/sprint` — Sprint Health
- `/analytics` — Project Analytics
- `/timesheet` — Timesheet

## How It Works

The server proxies all `/rest/*` requests to Jira with Basic Auth from the user's session. Widget JS/CSS files are served from the parent `jira/` directory unchanged — the same code runs in both Jira and standalone modes.
