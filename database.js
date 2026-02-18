const Database = require("better-sqlite3");
const path = require("path");

class PosterDatabase {
  constructor(dbPath = null) {
    const defaultPath = path.resolve(__dirname, "posters.db");
    this.db = new Database(dbPath || defaultPath);
    this.initializeDatabase();
    this.prepareStatements();
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

  prepareStatements() {
    this.insertStmt = this.db.prepare(`
      INSERT OR REPLACE INTO posters (id, name, year, image_url)
      VALUES (?, ?, ?, ?)
    `);
    this.getStmt = this.db.prepare(`SELECT * FROM posters WHERE id = ?`);
    this.getAllStmt = this.db.prepare(`SELECT * FROM posters ORDER BY created_at DESC`);
    this.countStmt = this.db.prepare(`SELECT COUNT(*) as count FROM posters`);
    this.existsStmt = this.db.prepare(`SELECT 1 FROM posters WHERE id = ? LIMIT 1`);
  }

  insertPoster(id, name, year, imageUrl) {
    try {
      this.insertStmt.run(id, name, year, imageUrl);
      return true;
    } catch (error) {
      console.error(`Error inserting poster ${id}:`, error.message);
      return false;
    }
  }

  posterExists(id) {
    return this.existsStmt.get(id) !== undefined;
  }

  batchInsert(posters) {
    const insert = this.db.transaction((items) => {
      for (const poster of items) {
        this.insertStmt.run(poster.id, poster.name, poster.year, poster.imageUrl);
      }
    });
    
    try {
      insert(posters);
      return true;
    } catch (error) {
      console.error(`Error in batch insert:`, error.message);
      return false;
    }
  }

  getPoster(id) {
    return this.getStmt.get(id);
  }

  getAllPosters() {
    return this.getAllStmt.all();
  }

  getCount() {
    return this.countStmt.get().count;
  }

  getAllPosterIds() {
    const selectSQL = `SELECT id FROM posters`;
    const stmt = this.db.prepare(selectSQL);
    return stmt.all().map(row => row.id);
  }

  close() {
    this.db.close();
  }
}

module.exports = PosterDatabase;
