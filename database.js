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
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS posters (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        year TEXT,
        image_url TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS watchlists (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        file_hash TEXT UNIQUE NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS watchlist_posters (
        watchlist_id TEXT NOT NULL,
        poster_id TEXT NOT NULL,
        PRIMARY KEY (watchlist_id, poster_id),
        FOREIGN KEY (watchlist_id) REFERENCES watchlists(id),
        FOREIGN KEY (poster_id) REFERENCES posters(id)
      );
    `);
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

    this.insertWatchlistStmt = this.db.prepare(
      `INSERT INTO watchlists (id, name, file_hash) VALUES (?, ?, ?)`
    );
    this.getWatchlistByHashStmt = this.db.prepare(
      `SELECT * FROM watchlists WHERE file_hash = ?`
    );
    this.getAllWatchlistsStmt = this.db.prepare(`
      SELECT w.id, w.name, w.created_at, COUNT(wp.poster_id) AS movie_count
      FROM watchlists w
      LEFT JOIN watchlist_posters wp ON w.id = wp.watchlist_id
      GROUP BY w.id
      ORDER BY w.created_at DESC
    `);
    this.insertWatchlistPosterStmt = this.db.prepare(
      `INSERT OR IGNORE INTO watchlist_posters (watchlist_id, poster_id) VALUES (?, ?)`
    );
    this.getPostersByWatchlistStmt = this.db.prepare(`
      SELECT p.id, p.name, p.year, p.image_url
      FROM posters p
      JOIN watchlist_posters wp ON p.id = wp.poster_id
      WHERE wp.watchlist_id = ?
      ORDER BY p.name ASC
    `);
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
    const stmt = this.db.prepare(`SELECT id FROM posters`);
    return stmt.all().map(row => row.id);
  }

  // ── Watchlist methods ──────────────────────────────────────────────────────

  createWatchlist(id, name, fileHash) {
    try {
      this.insertWatchlistStmt.run(id, name, fileHash);
      return true;
    } catch (error) {
      console.error(`Error creating watchlist:`, error.message);
      return false;
    }
  }

  getWatchlistByHash(fileHash) {
    return this.getWatchlistByHashStmt.get(fileHash);
  }

  getAllWatchlists() {
    return this.getAllWatchlistsStmt.all();
  }

  addPostersToWatchlist(watchlistId, posterIds) {
    const insert = this.db.transaction((ids) => {
      for (const posterId of ids) {
        this.insertWatchlistPosterStmt.run(watchlistId, posterId);
      }
    });
    try {
      insert(posterIds);
      return true;
    } catch (error) {
      console.error(`Error linking posters to watchlist:`, error.message);
      return false;
    }
  }

  getPostersByWatchlistId(watchlistId) {
    return this.getPostersByWatchlistStmt.all(watchlistId);
  }

  close() {
    this.db.close();
  }
}

module.exports = PosterDatabase;
