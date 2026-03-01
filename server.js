const express = require("express");
const multer = require("multer");
const rateLimit = require("express-rate-limit");
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");
const { scrapeRows, parseCsv } = require("./scrape");
const PosterDatabase = require("./database");

const app = express();
const PORT = process.env.PORT || 3000;
const UPLOADS_DIR = path.join(__dirname, "uploads");

if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// Singleton DB – lives for the lifetime of the server process
const db = new PosterDatabase();

// Multer – store uploaded CSV in /uploads with a unique name
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, file, cb) => {
    const unique = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    cb(null, `${unique}-${file.originalname}`);
  },
});

const upload = multer({
  storage,
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === "text/csv" || file.originalname.endsWith(".csv")) {
      cb(null, true);
    } else {
      cb(new Error("Only CSV files are accepted"));
    }
  },
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
});

// Serve the frontend
app.use(express.static(path.join(__dirname, "public")));

// Rate limiter: max 10 scrape requests per IP per 15 minutes
const scrapeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later." },
});

// ── GET /api/watchlists ───────────────────────────────────────────────────────
app.get("/api/watchlists", (_req, res) => {
  const watchlists = db.getAllWatchlists();
  res.json({ watchlists });
});

// ── GET /api/watchlists/:id/posters ──────────────────────────────────────────
app.get("/api/watchlists/:id/posters", (req, res) => {
  const rows = db.getPostersByWatchlistId(req.params.id);
  if (!rows) return res.status(404).json({ error: "Watchlist not found" });
  const posters = rows.map((p) => ({
    id: p.id, name: p.name, year: p.year, imageUrl: p.image_url,
  }));
  res.json({ posters });
});

// ── POST /api/scrape ─────────────────────────────────────────────────────────
// 1. Hash the uploaded CSV to detect duplicates.
// 2. If the hash already exists, return cached data immediately.
// 3. Otherwise scrape only new poster IDs, store in DB, link to a new watchlist.
// Supports SSE-style streaming via ?stream=1 for live progress.
app.post("/api/scrape", scrapeLimiter, upload.single("watchlist"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No CSV file uploaded" });
  }

  const csvPath = req.file.path;
  const originalName = req.file.originalname;
  const useStream = req.query.stream === "1";

  // Helper to send a single SSE "done" payload and close the connection
  function sendDone(payload) {
    if (useStream) {
      res.write(`data: ${JSON.stringify({ type: "done", ...payload })}\n\n`);
      res.end();
    } else {
      res.json(payload);
    }
  }

  try {
    // Compute SHA-256 hash of file content for dedup
    const fileContent = fs.readFileSync(csvPath);
    const fileHash = crypto.createHash("sha256").update(fileContent).digest("hex");

    // Cache hit – return existing watchlist's posters without scraping
    const existing = db.getWatchlistByHash(fileHash);
    if (existing) {
      const posters = db.getPostersByWatchlistId(existing.id).map((p) => ({
        id: p.id, name: p.name, year: p.year, imageUrl: p.image_url,
      }));

      if (useStream) {
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");
        res.flushHeaders();
      }
      sendDone({ watchlistId: existing.id, watchlistName: existing.name, posters, cached: true });
      return;
    }

    // Parse CSV
    const allRows = await parseCsv(csvPath);
    const validRows = allRows.filter((row) => row["Letterboxd URI"] && row["Name"]);

    // Filter to only rows whose poster IDs are not yet in the DB
    const existingIds = new Set(db.getAllPosterIds());
    const newRows = validRows.filter((row) => {
      const id = row["Letterboxd URI"].split("/").filter((p) => p).pop();
      return id && !existingIds.has(id);
    });

    // Create the watchlist record before scraping
    const watchlistId = crypto.randomUUID();
    db.createWatchlist(watchlistId, originalName, fileHash);

    if (useStream) {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.flushHeaders();
    }

    // Scrape only new rows, persisting them into the posters table
    const scraped = await scrapeRows(newRows, (done, total) => {
      if (useStream) {
        res.write(
          `data: ${JSON.stringify({ type: "progress", done, total })}\n\n`
        );
      }
    });

    for (const p of scraped) {
      db.insertPoster(p.id, p.name, p.year, p.imageUrl);
    }

    // Link all poster IDs from this CSV that exist in the DB to the watchlist
    const posterIdsToLink = validRows
      .map((row) => row["Letterboxd URI"].split("/").filter((p) => p).pop())
      .filter((id) => id && db.posterExists(id));
    db.addPostersToWatchlist(watchlistId, posterIdsToLink);

    // Return the full poster set for this watchlist
    const posters = db.getPostersByWatchlistId(watchlistId).map((p) => ({
      id: p.id, name: p.name, year: p.year, imageUrl: p.image_url,
    }));

    sendDone({ watchlistId, watchlistName: originalName, posters });
  } catch (err) {
    console.error("Scrape error:", err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: "Scraping failed: " + err.message });
    }
  } finally {
    // Clean up the uploaded file
    fs.unlink(csvPath, () => {});
  }
});

// Global error handler (catches multer file-filter rejections, etc.)
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  const status = err.status || err.statusCode || 400;
  res.status(status).json({ error: err.message || "Bad request" });
});

app.listen(PORT, () => {
  console.log(`Letterboxd Poster Scraper running at http://localhost:${PORT}`);
});
