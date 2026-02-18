const Database = require("better-sqlite3");
const path = require("path");

class PosterDatabase {
  constructor(dbPath = null) {
    const defaultPath = path.resolve(__dirname, "posters.db");
    this.db = new Database(dbPath || defaultPath);
    this.initializeDatabase();
  }

  initializeDatabase() {
    const createTableSQL = `
      CREATE TABLE IF NOT EXISTS posters (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        year TEXT,
        image_url TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `;
    this.db.exec(createTableSQL);
  }

  insertPoster(id, name, year, imageUrl) {
    const insertSQL = `
      INSERT OR REPLACE INTO posters (id, name, year, image_url)
      VALUES (?, ?, ?, ?)
    `;
    const stmt = this.db.prepare(insertSQL);
    try {
      stmt.run(id, name, year, imageUrl);
      return true;
    } catch (error) {
      console.error(`Error inserting poster ${id}:`, error.message);
      return false;
    }
  }

  getPoster(id) {
    const selectSQL = `SELECT * FROM posters WHERE id = ?`;
    const stmt = this.db.prepare(selectSQL);
    return stmt.get(id);
  }

  getAllPosters() {
    const selectSQL = `SELECT * FROM posters ORDER BY created_at DESC`;
    const stmt = this.db.prepare(selectSQL);
    return stmt.all();
  }

  getCount() {
    const countSQL = `SELECT COUNT(*) as count FROM posters`;
    const stmt = this.db.prepare(countSQL);
    return stmt.get().count;
  }

  close() {
    this.db.close();
  }
}

module.exports = PosterDatabase;
