const axios = require("axios");
const cheerio = require("cheerio");
const fs = require("fs");
const path = require("path");
const csv = require("csv-parser");

function sanitizeFilename(name) {
  return name.replace(/[^a-z0-9\s-]/gi, "").trim();
}

async function downloadPoster(url, filename) {
  try {
    const downloadsDir = path.resolve(__dirname, "downloads");
    if (!fs.existsSync(downloadsDir)) {
      fs.mkdirSync(downloadsDir);
    }

    const imagePath = path.resolve(downloadsDir, filename);
    if (fs.existsSync(imagePath)) {
      console.log(`File ${filename} already exists. Skipping.`);
      return;
    }

    console.log(`Processing: ${filename} (${url})`);

    const response = await axios.get(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
      },
    });
    const html = response.data;

    const $ = cheerio.load(html);

    const jsonLdScript = $('script[type="application/ld+json"]');

    if (jsonLdScript.length === 0) {
      console.error(`Could not find the JSON-LD script on the page for ${url}`);
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
      console.error(`Failed to parse JSON-LD content for ${url}:`, e.message);
      return;
    }

    const imgSrc = jsonData.image;

    if (!imgSrc) {
      console.error(`JSON-LD found, but no image property for ${url}`);
      return;
    }

    const writer = fs.createWriteStream(imagePath);
    const imageResponse = await axios({
      url: imgSrc,
      method: "GET",
      responseType: "stream",
    });

    imageResponse.data.pipe(writer);

    return new Promise((resolve, reject) => {
      writer.on("finish", () => {
        console.log(`Image successfully downloaded to ${imagePath}`);
        resolve();
      });
      writer.on("error", reject);
    });
  } catch (error) {
    console.error(`Error occurred for ${url}:`, error.message);
  }
}

async function processCsv() {
  const results = [];
  const csvFile = "letterboxd-watchlist.csv";

  if (!fs.existsSync(path.resolve(__dirname, csvFile))) {
    console.error(`CSV file '${csvFile}' not found in the directory.`);
    return;
  }

  const csvFilePath = path.resolve(__dirname, csvFile);
  console.log(`Reading CSV file: ${csvFilePath}`);

  console.time("Total Download Time");

  fs.createReadStream(csvFilePath)
    .pipe(csv())
    .on("data", (data) => results.push(data))
    .on("end", async () => {
      console.log(`Found ${results.length} items in CSV.`);

      const CONCURRENCY_LIMIT = 5;
      const queue = [...results];
      const activeWorkers = [];
      let completed = 0;

      async function worker(id) {
        while (queue.length > 0) {
          const row = queue.shift();
          const name = row["Name"];
          const year = row["Year"];
          const uri = row["Letterboxd URI"];

          if (name && uri) {
            const safeName = sanitizeFilename(`${name}-${year}`);
            const filename = `${safeName}.jpg`;
            console.log(`[Worker ${id}] Processing: ${filename}`);
            await downloadPoster(uri, filename);
            // Add a small delay to be polite
            await new Promise((resolve) => setTimeout(resolve, 1000));
          }
          completed++;
          console.log(
            `[Worker ${id}] Remaining: ${results.length - completed}`
          );
        }
      }

      for (let i = 0; i < CONCURRENCY_LIMIT; i++) {
        activeWorkers.push(worker(i + 1));
      }

      await Promise.all(activeWorkers);

      console.log("All downloads completed.");
      console.timeEnd("Total Download Time");
    });
}

processCsv();
