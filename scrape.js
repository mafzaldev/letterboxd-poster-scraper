const axios = require("axios");
const cheerio = require("cheerio");
const fs = require("fs");
const path = require("path");
const csv = require("csv-parser");
const PosterDatabase = require("./database");

// Configuration - adjust these values based on your needs and target server policies
const CONFIG = {
  CONCURRENCY_LIMIT: 10, // Number of concurrent workers
  DELAY_MS: 500, // Delay between requests in milliseconds (500ms = 0.5s)
  TIMEOUT_MS: 30000, // Request timeout in milliseconds (30s)
};

/**
 * Parse a CSV file and return an array of row objects.
 */
function parseCsv(csvFilePath) {
  return new Promise((resolve, reject) => {
    const results = [];
    fs.createReadStream(csvFilePath)
      .pipe(csv())
      .on("data", (data) => results.push(data))
      .on("end", () => resolve(results))
      .on("error", reject);
  });
}

/**
 * Scrape poster URLs for an array of already-parsed CSV row objects.
 * Each row must have "Name", "Year", and "Letterboxd URI" fields.
 * Returns an array of { id, name, year, imageUrl } objects.
 * Progress is reported via the optional onProgress(current, total) callback.
 */
async function scrapeRows(rows, onProgress) {
  const queue = [...rows];
  const total = queue.length;
  let processed = 0;
  const results = [];

  async function worker() {
    while (queue.length > 0) {
      const row = queue.shift();
      const name = row["Name"];
      const year = row["Year"];
      const uri = row["Letterboxd URI"];
      const id = uri.split("/").filter((p) => p).pop();

      try {
        const response = await axios.get(uri, {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
          },
          timeout: CONFIG.TIMEOUT_MS,
        });

        const $ = cheerio.load(response.data);
        const jsonLdScript = $('script[type="application/ld+json"]');
        if (jsonLdScript.length > 0) {
          let jsonContent = jsonLdScript.html();
          if (jsonContent.includes("/* <![CDATA[ */")) {
            jsonContent = jsonContent
              .replace("/* <![CDATA[ */", "")
              .replace("/* ]]> */", "");
          }
          try {
            const jsonData = JSON.parse(jsonContent);
            if (jsonData.image) {
              results.push({ id, name, year, imageUrl: jsonData.image });
            }
          } catch (parseErr) {
            console.error(`[scrape] Failed to parse JSON-LD for ${id}:`, parseErr.message);
          }
        }
      } catch (reqErr) {
        console.error(`[scrape] Request failed for ${id}:`, reqErr.message);
      }

      processed++;
      if (typeof onProgress === "function") onProgress(processed, total);
      await new Promise((resolve) => setTimeout(resolve, CONFIG.DELAY_MS));
    }
  }

  const workers = [];
  for (let i = 0; i < CONFIG.CONCURRENCY_LIMIT; i++) {
    workers.push(worker());
  }
  await Promise.all(workers);

  return results;
}

/**
 * Scrape poster URLs from a Letterboxd watchlist CSV file.
 * Returns an array of { id, name, year, imageUrl } objects.
 */
async function scrapeFromCsv(csvFilePath, onProgress) {
  const rows = await parseCsv(csvFilePath);
  const validRows = rows.filter((row) => row["Letterboxd URI"] && row["Name"]);
  return scrapeRows(validRows, onProgress);
}

// ── CLI entry-point (node scrape.js) ─────────────────────────────────────────
async function processCsv() {
  const db = new PosterDatabase();
  const csvFile = "letterboxd-watchlist.csv";

  if (!fs.existsSync(path.resolve(__dirname, csvFile))) {
    console.error(`CSV file '${csvFile}' not found in the directory.`);
    db.close();
    return;
  }

  const csvFilePath = path.resolve(__dirname, csvFile);
  console.log(`Reading CSV file: ${csvFilePath}`);
  console.time("Total Download Time");

  const existingIds = new Set(db.getAllPosterIds());
  const allRows = await parseCsv(csvFilePath);
  const newRows = allRows.filter((row) => {
    const uri = row["Letterboxd URI"];
    if (uri) {
      const id = uri.split("/").filter((p) => p).pop();
      return id && !existingIds.has(id);
    }
    return false;
  });

  console.log(`Found ${allRows.length} items in ${csvFile}.`);
  console.log(`Skipping ${allRows.length - newRows.length} already scraped items.`);
  console.log(`Processing ${newRows.length} new items.`);

  const posters = await scrapeRows(newRows, (done, total) => {
    console.log(`Progress: ${done}/${total} (${Math.round((done / total) * 100)}%)`);
  });

  for (const p of posters) {
    db.insertPoster(p.id, p.name, p.year, p.imageUrl);
  }

  console.timeEnd("Total Download Time");
  console.log(`Stored posters in database. Total records: ${db.getCount()}`);
  db.close();
}

if (require.main === module) {
  processCsv();
}

module.exports = { scrapeFromCsv, scrapeRows, parseCsv };
