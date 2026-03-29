const express = require("express");
const session = require("express-session");
const crypto = require("crypto");
const path = require("path");
const http = require("node:http");
const https = require("node:https");

const app = express();
const PORT = process.env.PORT || 3000;

const WIDGET_FILES = [
  "_ujgCommon.js",
  "ujg-sprint-health.js", "ujg-sprint-health.css",
  "ujg-project-analytics.js", "ujg-project-analytics.css",
  "ujg-daily-diligence.js", "ujg-daily-diligence.css",
  "ujg-timesheet.js", "ujg-timesheet.css",
  "ujg-timesheet.v0.js", "ujg-timesheet.v0.css",
  "ujg-user-activity.js", "ujg-user-activity.css",
];

app.use(
  session({
    secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex"),
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 8 * 60 * 60 * 1000,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    },
  })
);

function requireAuth(req, res, next) {
  if (req.path === "/login") return next();
  
  // Test mode: bypass auth if TEST_MODE env var is set
  if (process.env.TEST_MODE === "true") {
    if (!req.session.jiraUrl) {
      req.session.jiraUrl = "https://jira.elemento.systems";
      req.session.authHeader = "Basic dGVzdDp0ZXN0";
      req.session.username = "testuser";
      req.session.displayName = "Test User";
    }
    return next();
  }
  
  if (!req.session || !req.session.jiraUrl) return res.redirect("/login");
  next();
}

// --- Pre-auth routes ---

app.get("/login", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "login.html"));
});

app.use("/login", express.json());

app.post("/login", async (req, res) => {
  const { jiraUrl, username, password } = req.body;
  if (!jiraUrl || !username || !password) {
    return res.status(400).json({ error: "jiraUrl, username, and password are required" });
  }

  const trimmedUrl = jiraUrl.replace(/\/+$/, "");
  const authHeader = "Basic " + Buffer.from(username + ":" + password).toString("base64");

  try {
    const result = await proxyFetch(trimmedUrl + "/rest/api/2/myself", {
      method: "GET",
      headers: { Authorization: authHeader, Accept: "application/json" },
    });

    if (result.status !== 200) {
      return res.status(401).json({ error: "Неверные данные для входа в Jira" });
    }

    let user;
    try {
      user = JSON.parse(result.body);
    } catch (_err) {
      return res.status(502).json({ error: "Jira вернула некорректный JSON в ответе /myself" });
    }

    req.session.jiraUrl = trimmedUrl;
    req.session.authHeader = authHeader;
    req.session.username = user.name || username;
    req.session.displayName = user.displayName || username;

    res.json({ ok: true });
  } catch (err) {
    res.status(502).json({ error: "Не удалось подключиться к Jira: " + err.message });
  }
});

app.get("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/login"));
});

// Pre-auth static: only login page assets
app.get("/style.css", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "style.css"));
});

// --- Auth wall ---

app.use(requireAuth);

// --- Protected routes ---

app.get("/api/session", (req, res) => {
  res.json({
    username: req.session.username,
    displayName: req.session.displayName,
    jiraUrl: req.session.jiraUrl,
  });
});

function getMockUsers(query, maxResults) {
  const q = String(query || "").toLowerCase();
  const mockUsers = [
    { name: "dtorzok", displayName: "Dima Torzok", emailAddress: "dtorzok@example.com" },
    { name: "testuser", displayName: "Test User", emailAddress: "test@example.com" },
    { name: "admin", displayName: "Admin User", emailAddress: "admin@example.com" },
  ];

  return mockUsers.filter((u) =>
    u.name.toLowerCase().includes(q) ||
    u.displayName.toLowerCase().includes(q)
  ).slice(0, parseInt(maxResults, 10) || 10);
}

// Test mode: mock user lookup APIs
if (process.env.TEST_MODE === "true") {
  app.get("/rest/api/2/user/picker", (req, res) => {
    res.json({ users: getMockUsers(req.query.query, req.query.maxResults) });
  });

  app.get("/rest/api/2/user/search", (req, res) => {
    res.json(getMockUsers(req.query.username, req.query.maxResults));
  });
}

// Proxy: forward raw body to avoid JSON re-serialization
app.all("/rest/*", express.raw({ type: "*/*", limit: "50mb" }), async (req, res) => {
  const { jiraUrl, authHeader } = req.session;
  const targetUrl = jiraUrl + req.originalUrl;

  const headers = {
    Authorization: authHeader,
    Accept: req.headers["accept"] || "application/json",
  };
  if (req.headers["content-type"]) {
    headers["Content-Type"] = req.headers["content-type"];
  }

  const body = req.body && req.body.length ? req.body : undefined;

  try {
    const result = await proxyFetch(targetUrl, { method: req.method, headers, body });
    res.status(result.status);
    const ct = result.headers["content-type"];
    if (ct) res.set("Content-Type", ct);
    res.send(result.body);
  } catch (err) {
    res.status(502).json({ error: "Proxy request failed: " + err.message });
  }
});

// Widget files: serve only whitelisted files from parent jira/ directory
WIDGET_FILES.forEach((f) => {
  app.get("/widgets/" + f, (_req, res) => {
    res.sendFile(path.join(__dirname, "..", f));
  });
});

app.get("/", (_req, res) => res.redirect("/sprint"));

app.get("/sprint", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "sprint.html"));
});

app.get("/analytics", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "analytics.html"));
});

app.get("/daily-diligence", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "daily-diligence.html"));
});

app.get("/timesheet", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "timesheet.html"));
});

app.get("/timesheet-v0", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "timesheet-v0.html"));
});

app.get("/user-activity", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "user-activity.html"));
});

// --- Proxy helper ---

function proxyFetch(url, { method = "GET", headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const transport = parsed.protocol === "https:" ? https : http;

    const opts = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method,
      headers,
      rejectUnauthorized: process.env.JIRA_TLS_VERIFY !== "false" ? undefined : false,
      timeout: 30000,
    };

    const proxyReq = transport.request(opts, (proxyRes) => {
      const chunks = [];
      proxyRes.on("data", (chunk) => chunks.push(chunk));
      proxyRes.on("end", () => {
        resolve({
          status: proxyRes.statusCode,
          headers: proxyRes.headers,
          body: Buffer.concat(chunks).toString("utf8"),
        });
      });
    });

    proxyReq.on("timeout", () => {
      proxyReq.destroy();
      reject(new Error("Request timed out"));
    });
    proxyReq.on("error", reject);

    if (body) proxyReq.write(body);
    proxyReq.end();
  });
}

// --- Start ---

app.listen(PORT, () => {
  console.log("UJG Standalone running at http://localhost:" + PORT);
});
