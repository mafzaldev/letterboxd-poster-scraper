const PosterDatabase = require("./database");
const fs = require("fs");
const path = require("path");

// Test database file path
const testDbPath = path.resolve(__dirname, "test_posters.db");

// Clean up any existing test database
if (fs.existsSync(testDbPath)) {
  fs.unlinkSync(testDbPath);
}

console.log("Starting database tests...");

// Initialize database
const db = new PosterDatabase(testDbPath);
console.log("✓ Database initialized");

// Test 1: Insert posters
db.insertPoster("test-movie-1", "The Matrix", "1999", "https://example.com/matrix.jpg");
db.insertPoster("test-movie-2", "Inception", "2010", "https://example.com/inception.jpg");
console.log("✓ Inserted 2 posters");

// Test 2: Test getCount method
const count = db.getCount();
if (count === 2) {
  console.log("✓ getCount() returned correct count:", count);
} else {
  console.error("✗ Expected count 2, got:", count);
  process.exit(1);
}

// Test 3: Get a specific poster
const poster = db.getPoster("test-movie-1");
if (poster && poster.name === "The Matrix") {
  console.log("✓ Retrieved poster successfully");
} else {
  console.error("✗ Failed to retrieve poster");
  process.exit(1);
}

// Test 4: Get all posters
const allPosters = db.getAllPosters();
if (allPosters.length === 2) {
  console.log("✓ getAllPosters() returned correct number:", allPosters.length);
} else {
  console.error("✗ Expected 2 posters, got:", allPosters.length);
  process.exit(1);
}

// Close database
db.close();
console.log("✓ Database closed");

// Clean up test database
fs.unlinkSync(testDbPath);
console.log("✓ Test database cleaned up");

console.log("\n✅ All tests passed!");
