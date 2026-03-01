const express = require("express");
const multer = require("multer");
const rateLimit = require("express-rate-limit");
const path = require("path");
const fs = require("fs");
const { scrapeFromCsv } = require("./scrape");

const app = express();
const PORT = process.env.PORT || 3000;
const UPLOADS_DIR = path.join(__dirname, "uploads");

if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

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

// ── POST /api/scrape ─────────────────────────────────────────────────────────
// Accepts a multipart CSV upload, scrapes poster URLs and returns JSON.
// Supports SSE-style streaming via ?stream=1 so the UI can show live progress.
app.post("/api/scrape", scrapeLimiter, upload.single("watchlist"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No CSV file uploaded" });
  }

  const csvPath = req.file.path;
  const useStream = req.query.stream === "1";

  try {
    if (useStream) {
      // Server-Sent Events for live progress
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.flushHeaders();

      const posters = await scrapeFromCsv(csvPath, (done, total) => {
        res.write(
          `data: ${JSON.stringify({ type: "progress", done, total })}\n\n`
        );
      });

      res.write(`data: ${JSON.stringify({ type: "done", posters })}\n\n`);
      res.end();
    } else {
      const posters = await scrapeFromCsv(csvPath);
      res.json({ posters });
    }
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
