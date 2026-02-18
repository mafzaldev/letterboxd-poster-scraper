const axios = require("axios");
const cheerio = require("cheerio");
const fs = require("fs");
const path = require("path");
const csv = require("csv-parser");
const PosterDatabase = require("./database");

async function downloadPoster(id, name, year, url, workerId, db) {
  try {
    console.log(`[Worker ${workerId}] Processing: ${name} (${id})`);

    const response = await axios.get(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
      },
      timeout: 10000, // 10 second timeout
    });
    const html = response.data;

    const $ = cheerio.load(html);

    const jsonLdScript = $('script[type="application/ld+json"]');

    if (jsonLdScript.length === 0) {
      console.error(
        `[Worker ${workerId}] Could not find the JSON-LD script on the page for ${id}`,
      );
      return;
    }

    let jsonContent = jsonLdScript.html();
    if (jsonContent.includes("/* <![CDATA[ */")) {
      jsonContent = jsonContent
        .replace("/* <![CDATA[ */", "")
        .replace("/* ]]> */", "");
    }

    let jsonData;
    try {
      jsonData = JSON.parse(jsonContent);
    } catch (e) {
      console.error(
        `[Worker ${workerId}] Failed to parse JSON-LD content for ${id}:`,
        e.message,
      );
      return;
    }

    const imgSrc = jsonData.image;

    if (!imgSrc) {
      console.error(
        `[Worker ${workerId}] JSON-LD found, but no image property for ${id}`,
      );
      return;
    }

    storePosterInfo(id, name, year, imgSrc, db);
  } catch (error) {
    console.error(
      `[Worker ${workerId}] Error occurred for ${id}:`,
      error.message,
    );
  }
}

function storePosterInfo(id, name, year, imageUrl, db) {
  const success = db.insertPoster(id, name, year, imageUrl);
  if (!success) {
    console.error(`Failed to store poster info for ${id}`);
  }
}

async function processCsv() {
  const db = new PosterDatabase();
  const results = [];
  const csvFile = "letterboxd-watchlist.csv";

  if (!fs.existsSync(path.resolve(__dirname, csvFile))) {
    console.error(`CSV file '${csvFile}' not found in the directory.`);
    db.close();
    return;
  }

  const csvFilePath = path.resolve(__dirname, csvFile);
  console.log(`Reading CSV file: ${csvFilePath}`);

  console.time("Total Download Time");

  fs.createReadStream(csvFilePath)
    .pipe(csv())
    .on("data", (data) => results.push(data))
    .on("end", async () => {
      console.log(`Found ${results.length} items in ${csvFile}.`);

      // Filter out already scraped items
      const itemsToScrape = results.filter((row) => {
        const uri = row["Letterboxd URI"];
        if (uri) {
          const id = uri.split("/").filter(p => p).pop();
          return id && !db.posterExists(id);
        }
        return false;
      });

      console.log(`Skipping ${results.length - itemsToScrape.length} already scraped items.`);
      console.log(`Processing ${itemsToScrape.length} new items.`);

      const CONCURRENCY_LIMIT = 10;
      const DELAY_MS = 500; // Reduced from 2000ms to 500ms
      const queue = [...itemsToScrape];
      const activeWorkers = [];
      let processed = 0;

      async function worker(workerId) {
        while (queue.length > 0) {
          const row = queue.shift();
          const name = row["Name"];
          const year = row["Year"];
          const uri = row["Letterboxd URI"];

          if (name && uri) {
            const id = uri.split("/").filter(p => p).pop();
            await downloadPoster(id, name, year, uri, workerId, db);
            processed++;
            console.log(`Progress: ${processed}/${itemsToScrape.length} (${Math.round((processed / itemsToScrape.length) * 100)}%)`);
            await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
          }
        }
      }

      for (let i = 0; i < CONCURRENCY_LIMIT; i++) {
        activeWorkers.push(worker(i + 1));
      }

      await Promise.all(activeWorkers);

      console.timeEnd("Total Download Time");
      console.log(`Stored posters in database. Total records: ${db.getCount()}`);
      db.close();
    });
}

processCsv();
