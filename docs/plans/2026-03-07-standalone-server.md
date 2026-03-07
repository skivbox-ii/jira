# Standalone Server Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Create a standalone Express server that serves existing UJG Jira widgets (Sprint Health, Project Analytics, Timesheet) outside of Jira, proxying REST API requests to Jira Server/DC with user credentials.

**Architecture:** Express server with in-memory sessions. Login page accepts Jira URL + credentials, validates via `/rest/api/2/myself`. All `/rest/*` requests are proxied to Jira with Basic Auth from session. Widget pages load existing JS/CSS files unchanged via `express.static`, initializing widgets with a minimal API adapter.

**Tech Stack:** Node.js, Express, express-session, jQuery (CDN), RequireJS (CDN)

---

### Task 1: Project scaffold

**Files:**
- Create: `jira/standalone/package.json`

**Step 1: Create package.json**

```json
{
  "name": "ujg-standalone",
  "version": "1.0.0",
  "private": true,
  "description": "Standalone server for UJG Jira widgets",
  "main": "server.js",
  "scripts": {
    "start": "node server.js"
  }
}
```

**Step 2: Install dependencies**

Run: `cd jira/standalone && npm install express express-session`
Expected: `node_modules/` created, `package.json` updated with dependencies

**Step 3: Commit**

```bash
git add jira/standalone/package.json jira/standalone/package-lock.json
git commit -m "feat(standalone): init project with express dependencies"
```

---

### Task 2: Express server with session and auth middleware

**Files:**
- Create: `jira/standalone/server.js`

**Step 1: Create server.js with core structure**

```javascript
const express = require("express");
const session = require("express-session");
const path = require("path");
const { request: httpsRequest } = require("https");
const { request: httpRequest } = require("http");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
    secret: process.env.SESSION_SECRET || "ujg-standalone-secret-" + Date.now(),
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 8 * 60 * 60 * 1000 }
}));

function requireAuth(req, res, next) {
    if (req.session && req.session.jiraUrl) return next();
    if (req.path === "/login" || req.path === "/login.html") return next();
    res.redirect("/login");
}

app.use(requireAuth);

// --- Login routes ---

app.get("/login", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "login.html"));
});

app.post("/login", async (req, res) => {
    const { jiraUrl, username, password } = req.body;
    if (!jiraUrl || !username || !password) {
        return res.status(400).json({ error: "All fields required" });
    }

    const cleanUrl = jiraUrl.replace(/\/+$/, "");
    const authHeader = "Basic " + Buffer.from(username + ":" + password).toString("base64");

    try {
        const result = await proxyFetch(cleanUrl + "/rest/api/2/myself", {
            method: "GET",
            headers: { "Authorization": authHeader, "Accept": "application/json" }
        });
        if (result.status === 200) {
            req.session.jiraUrl = cleanUrl;
            req.session.authHeader = authHeader;
            req.session.username = username;
            const userData = JSON.parse(result.body);
            req.session.displayName = userData.displayName || username;
            res.json({ ok: true });
        } else {
            res.status(401).json({ error: "Invalid Jira credentials (HTTP " + result.status + ")" });
        }
    } catch (e) {
        res.status(502).json({ error: "Cannot connect to Jira: " + e.message });
    }
});

app.get("/logout", (req, res) => {
    req.session.destroy(() => res.redirect("/login"));
});

// --- Jira proxy ---

app.all("/rest/*", async (req, res) => {
    const targetUrl = req.session.jiraUrl + req.originalUrl;
    const headers = {
        "Authorization": req.session.authHeader,
        "Accept": "application/json"
    };
    if (req.headers["content-type"]) {
        headers["Content-Type"] = req.headers["content-type"];
    }

    try {
        const result = await proxyFetch(targetUrl, {
            method: req.method,
            headers: headers,
            body: ["POST", "PUT", "PATCH"].includes(req.method) ? JSON.stringify(req.body) : undefined
        });
        res.status(result.status);
        if (result.headers["content-type"]) {
            res.set("Content-Type", result.headers["content-type"]);
        }
        res.send(result.body);
    } catch (e) {
        res.status(502).json({ error: "Proxy error: " + e.message });
    }
});

// --- Static files ---

app.use("/widgets", express.static(path.join(__dirname, "..")));

app.use(express.static(path.join(__dirname, "public")));

// --- Widget page routes ---

app.get("/", (req, res) => res.redirect("/sprint"));

["sprint", "analytics", "timesheet"].forEach(name => {
    app.get("/" + name, (req, res) => {
        res.sendFile(path.join(__dirname, "public", name + ".html"));
    });
});

// --- Session info endpoint (for UI) ---

app.get("/api/session", (req, res) => {
    res.json({
        username: req.session.username,
        displayName: req.session.displayName,
        jiraUrl: req.session.jiraUrl
    });
});

// --- Proxy helper ---

function proxyFetch(url, options) {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const transport = parsed.protocol === "https:" ? httpsRequest : httpRequest;
        const reqOptions = {
            hostname: parsed.hostname,
            port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
            path: parsed.pathname + parsed.search,
            method: options.method || "GET",
            headers: options.headers || {},
            rejectUnauthorized: false
        };

        const proxyReq = transport(reqOptions, (proxyRes) => {
            const chunks = [];
            proxyRes.on("data", chunk => chunks.push(chunk));
            proxyRes.on("end", () => {
                resolve({
                    status: proxyRes.statusCode,
                    headers: proxyRes.headers,
                    body: Buffer.concat(chunks).toString("utf-8")
                });
            });
        });

        proxyReq.on("error", reject);
        if (options.body) proxyReq.write(options.body);
        proxyReq.end();
    });
}

// --- Start ---

app.listen(PORT, () => {
    console.log("UJG Standalone running at http://localhost:" + PORT);
});
```

**Step 2: Verify server starts**

Run: `cd jira/standalone && node server.js &`
Expected: "UJG Standalone running at http://localhost:3000"
Then kill the process.

**Step 3: Commit**

```bash
git add jira/standalone/server.js
git commit -m "feat(standalone): express server with auth, proxy, and static routing"
```

---

### Task 3: Login page

**Files:**
- Create: `jira/standalone/public/login.html`

**Step 1: Create login.html**

Minimal HTML form with three fields (Jira URL, Username, Password), a submit button, and an error message area. On submit, POST to `/login` via fetch; on success redirect to `/`; on error show the message. Inline styles or link to `style.css`. Remember last used Jira URL from `localStorage`.

Key behavior:
- Form fields: `jiraUrl` (text, placeholder "https://jira.company.com"), `username` (text), `password` (password)
- Submit via `fetch("/login", { method: "POST", ... })`
- On success (`{ok: true}`) → `window.location = "/"`
- On error → show error message from response
- Save `jiraUrl` to `localStorage` on successful login, pre-fill on load

**Step 2: Verify login page loads**

Run: `cd jira/standalone && node server.js &`
Then: `curl -s http://localhost:3000/login | head -5`
Expected: HTML with login form
Kill process.

**Step 3: Commit**

```bash
git add jira/standalone/public/login.html
git commit -m "feat(standalone): login page with jira credentials form"
```

---

### Task 4: Shared styles and navigation

**Files:**
- Create: `jira/standalone/public/style.css`

**Step 1: Create style.css**

Common styles for all pages:
- Navigation bar (top): links to `/sprint`, `/analytics`, `/timesheet`, and a logout button on the right. Active link highlighted.
- Widget container: full width, padding
- Login form: centered card
- Responsive, clean look. Use system fonts.

**Step 2: Commit**

```bash
git add jira/standalone/public/style.css
git commit -m "feat(standalone): shared styles with navigation"
```

---

### Task 5: Sprint Health widget page

**Files:**
- Create: `jira/standalone/public/sprint.html`

**Step 1: Create sprint.html**

HTML page that:
1. Links `style.css`
2. Links `/widgets/ujg-sprint-health.css`
3. Includes navigation header (Sprint Health active)
4. Has `<div id="widget-container">` with inner div matching what `API.getGadgetContentEl()` returns
5. Loads jQuery from CDN: `https://cdnjs.cloudflare.com/ajax/libs/jquery/3.7.1/jquery.min.js`
6. Loads RequireJS from CDN: `https://cdnjs.cloudflare.com/ajax/libs/require.js/2.3.7/require.min.js`
7. RequireJS config maps `_ujgCommon` to `/widgets/_ujgCommon`, `_ujgSprintHealth` to `/widgets/ujg-sprint-health`
8. Initializes the widget:

```javascript
require(["_ujgSprintHealth"], function(Gadget) {
    var API = {
        getGadgetContentEl: function() { return $("#widget-container"); },
        resize: function() {}
    };
    new Gadget(API);
});
```

**Step 2: Verify page structure**

Run server, open `/sprint` in browser or curl, verify HTML contains the script tags and widget container.

**Step 3: Commit**

```bash
git add jira/standalone/public/sprint.html
git commit -m "feat(standalone): sprint health widget page"
```

---

### Task 6: Project Analytics widget page

**Files:**
- Create: `jira/standalone/public/analytics.html`

**Step 1: Create analytics.html**

Same structure as sprint.html but:
- Links `/widgets/ujg-project-analytics.css`
- Navigation: "Project Analytics" active
- RequireJS maps `_ujgProjectAnalytics` to `/widgets/ujg-project-analytics`
- Initializes with `require(["_ujgProjectAnalytics"], ...)`

**Step 2: Commit**

```bash
git add jira/standalone/public/analytics.html
git commit -m "feat(standalone): project analytics widget page"
```

---

### Task 7: Timesheet widget page

**Files:**
- Create: `jira/standalone/public/timesheet.html`

**Step 1: Create timesheet.html**

Same structure but:
- Links `/widgets/ujg-timesheet.css`
- Navigation: "Timesheet" active
- RequireJS maps `_ujgTimesheet` to `/widgets/ujg-timesheet`
- Initializes with `require(["_ujgTimesheet"], ...)`

**Step 2: Commit**

```bash
git add jira/standalone/public/timesheet.html
git commit -m "feat(standalone): timesheet widget page"
```

---

### Task 8: Integration test and README

**Files:**
- Create: `jira/standalone/README.md`

**Step 1: Manual integration test**

1. `cd jira/standalone && npm start`
2. Open `http://localhost:3000` → should redirect to `/login`
3. Enter Jira credentials → should redirect to `/sprint`
4. Navigation links work between all three widgets
5. Widget loads data from Jira (verify network tab shows proxied requests)
6. Logout returns to login page

**Step 2: Create README.md**

```markdown
# UJG Standalone Server

Standalone server for viewing UJG Jira widgets outside of Jira.

## Quick Start

    cd jira/standalone
    npm install
    npm start

Open http://localhost:3000, enter your Jira Server/DC credentials.

## Environment Variables

- `PORT` — server port (default: 3000)
- `SESSION_SECRET` — session secret (auto-generated if not set)

## Widgets

- `/sprint` — Sprint Health
- `/analytics` — Project Analytics
- `/timesheet` — Timesheet
```

**Step 3: Commit**

```bash
git add jira/standalone/README.md
git commit -m "docs(standalone): add README with setup instructions"
```
