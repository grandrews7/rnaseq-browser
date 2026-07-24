import express from "express";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * Production server for Cloud Run.
 *
 * Does two jobs:
 *   1. Serves the static Vite build from ../dist
 *   2. Proxies POST /api/screen-graphql to the SCREEN GraphQL service,
 *      adding the API key server-side so it never reaches the browser.
 *
 * In development, Vite's own proxy does job 2 and this file is unused.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();

const PORT = process.env.PORT || 8080; // Cloud Run injects PORT
const SCREEN_API_KEY = process.env.SCREEN_API_KEY;
const UPSTREAM = "https://screen.api.wenglab.org/graphql";

if (!SCREEN_API_KEY) {
  console.warn("SCREEN_API_KEY is not set — the gene track will fail.");
}

/**
 * Crude per-IP rate limit.
 *
 * This endpoint is an open relay for our API key: anyone who finds the URL
 * can query SCREEN as us. This won't stop a determined abuser (it's in-memory,
 * so it resets on restart and is per-instance, not global) but it does stop a
 * crawler or a runaway loop from burning through the key's quota.
 */
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 120;
const hits = new Map();

function rateLimit(req, res, next) {
  const ip = req.ip ?? "unknown";
  const now = Date.now();
  const entry = hits.get(ip);

  if (!entry || now > entry.resetAt) {
    hits.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return next();
  }
  if (entry.count >= MAX_PER_WINDOW) {
    return res.status(429).json({ error: "Too many requests, slow down." });
  }
  entry.count += 1;
  next();
}

// Keep the map from growing without bound.
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of hits) if (now > entry.resetAt) hits.delete(ip);
}, WINDOW_MS).unref();

app.set("trust proxy", true); // Cloud Run sits behind a proxy; needed for req.ip
app.use(express.json({ limit: "64kb" }));

app.get("/healthz", (_req, res) => res.status(200).send("ok"));

app.post("/api/screen-graphql", rateLimit, async (req, res) => {
  if (!SCREEN_API_KEY) {
    return res.status(500).json({ error: "Server is missing SCREEN_API_KEY." });
  }

  try {
    const upstream = await fetch(UPSTREAM, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${SCREEN_API_KEY}`,
      },
      body: JSON.stringify(req.body),
      signal: AbortSignal.timeout(20_000),
    });

    const text = await upstream.text();
    res.status(upstream.status).type("application/json").send(text);
  } catch (error) {
    console.error("GraphQL proxy failed:", error);
    res.status(502).json({ error: "Upstream request failed." });
  }
});

// Static build. index.html is revalidated so deploys take effect immediately;
// hashed assets can be cached hard.
const dist = join(__dirname, "..", "dist");
app.use(
  express.static(dist, {
    setHeaders: (res, path) => {
      if (path.endsWith("index.html")) res.setHeader("Cache-Control", "no-cache");
      else res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    },
  }),
);

// Single-page app fallback.
app.get(/.*/, (_req, res) => res.sendFile(join(dist, "index.html")));

app.listen(PORT, () => console.log(`Listening on ${PORT}`));
