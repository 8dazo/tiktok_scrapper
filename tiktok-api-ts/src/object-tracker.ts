import Database from "better-sqlite3";
import { mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import {
  ObjectStatus,
  type ObjectInfo,
  type ObjectStatusResult,
  type TrackerStats,
  type ErrorObjectInfo,
} from "./types.js";

export { ObjectStatus };

/**
 * SQLite database that tracks pending/completed/error status per object (video id or username).
 */
export class ObjectTracker {
  private db: Database.Database;
  private dbFile: string;

  constructor(dbFile: string = "progress_tracking/scraping_progress.db") {
    const parent = dirname(dbFile);
    if (!existsSync(parent)) {
      mkdirSync(parent, { recursive: true });
    }
    this.dbFile = dbFile;
    this.db = new Database(dbFile);
    this.db.pragma("foreign_keys = ON");
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = NORMAL");
    this.createTables();
    this.createIndexes();
  }

  private createTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS objects (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        title TEXT,
        type TEXT,
        added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        completed_at TIMESTAMP,
        attempts INTEGER DEFAULT 0,
        last_error TEXT,
        last_attempt TIMESTAMP,
        file_path TEXT,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS metadata (
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    this.db.exec(`
      CREATE TRIGGER IF NOT EXISTS update_timestamp
      AFTER UPDATE ON objects
      BEGIN
        UPDATE objects SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
      END;
    `);
  }

  private createIndexes(): void {
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_status ON objects(status)");
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_added_at ON objects(added_at)");
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_completed_at ON objects(completed_at)");
  }

  addObject(id: string, title: string | null = null, type: string | null = null): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT OR IGNORE INTO objects (id, status, title, type, added_at, attempts)
         VALUES (?, ?, ?, ?, ?, 0)`
      )
      .run(id, ObjectStatus.PENDING, title, type, now);
  }

  addObjects(ids: string[], title: string | null = null, type: string | null = null): void {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(
      `INSERT OR IGNORE INTO objects (id, status, title, type, added_at, attempts)
       VALUES (?, ?, ?, ?, ?, 0)`
    );
    const run = this.db.transaction((items: [string, string, string | null, string | null, string][]) => {
      for (const row of items) {
        stmt.run(...row);
      }
    });
    run(ids.map((id) => [id, ObjectStatus.PENDING, title, type, now] as const).map((r) => [...r]));
  }

  markCompleted(id: string, filePath: string | null = null): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE objects SET status = ?, completed_at = ?, file_path = ? WHERE id = ?`
      )
      .run(ObjectStatus.COMPLETED, now, filePath, id);
  }

  markError(id: string, errorMessage: string): void {
    const row = this.db.prepare("SELECT attempts FROM objects WHERE id = ?").get(id) as { attempts: number } | undefined;
    const attempts = row ? row.attempts + 1 : 1;
    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE objects SET status = ?, attempts = ?, last_error = ?, last_attempt = ? WHERE id = ?`
      )
      .run(ObjectStatus.ERROR, attempts, errorMessage, now, id);
  }

  getPendingObjects(type: string = "all", limit: number = 10 ** 10): Record<string, ObjectInfo> {
    let rows: { id: string; title: string | null; type: string | null }[];
    if (type === "all") {
      rows = this.db
        .prepare(
          `SELECT id, title, type FROM objects WHERE status IN (?, ?) LIMIT ?`
        )
        .all(ObjectStatus.PENDING, ObjectStatus.RETRY, limit) as { id: string; title: string | null; type: string | null }[];
    } else {
      rows = this.db
        .prepare(
          `SELECT id, title, type FROM objects WHERE status IN (?, ?) AND type = ? LIMIT ?`
        )
        .all(ObjectStatus.PENDING, ObjectStatus.RETRY, type, limit) as { id: string; title: string | null; type: string | null }[];
    }
    const out: Record<string, ObjectInfo> = {};
    for (const r of rows) {
      out[r.id] = { title: r.title, type: r.type };
    }
    return out;
  }

  getStats(type: string = "all"): TrackerStats {
    let rows: { status: string; count: number }[];
    if (type === "all") {
      rows = this.db
        .prepare("SELECT status, COUNT(*) as count FROM objects GROUP BY status")
        .all() as { status: string; count: number }[];
    } else {
      rows = this.db
        .prepare("SELECT status, COUNT(*) as count FROM objects WHERE type = ? GROUP BY status")
        .all(type) as { status: string; count: number }[];
    }
    const stats: TrackerStats = { completed: 0, errors: 0, pending: 0, retry: 0 };
    for (const { status, count } of rows) {
      if (status === ObjectStatus.COMPLETED) stats.completed = count;
      else if (status === ObjectStatus.ERROR) stats.errors = count;
      else if (status === ObjectStatus.PENDING) stats.pending = count;
      else if (status === ObjectStatus.RETRY) stats.retry = count;
    }
    return stats;
  }

  getObjectStatus(id: string): ObjectStatusResult | null {
    const row = this.db
      .prepare(
        `SELECT status, title, type, added_at, completed_at, attempts, last_error, last_attempt, file_path
         FROM objects WHERE id = ?`
      )
      .get(id) as {
        status: string;
        title: string | null;
        type: string | null;
        added_at: string | null;
        completed_at: string | null;
        attempts: number;
        last_error: string | null;
        last_attempt: string | null;
        file_path: string | null;
      } | undefined;
    if (!row) return null;
    return {
      status: row.status,
      title: row.title,
      type: row.type,
      added_at: row.added_at,
      completed_at: row.completed_at,
      attempts: row.attempts,
      last_error: row.last_error,
      last_attempt: row.last_attempt,
      file_path: row.file_path,
    };
  }

  getErrorObjects(): Record<string, ErrorObjectInfo> {
    const rows = this.db
      .prepare(
        `SELECT id, title, type, added_at, attempts, last_error, last_attempt, file_path
         FROM objects WHERE status = ? ORDER BY last_attempt DESC`
      )
      .all(ObjectStatus.ERROR) as Array<{
        id: string;
        title: string | null;
        type: string | null;
        added_at: string | null;
        attempts: number;
        last_error: string | null;
        last_attempt: string | null;
        file_path: string | null;
      }>;
    const out: Record<string, ErrorObjectInfo> = {};
    for (const r of rows) {
      out[r.id] = {
        status: ObjectStatus.ERROR,
        title: r.title,
        type: r.type,
        added_at: r.added_at,
        attempts: r.attempts,
        last_error: r.last_error,
        last_attempt: r.last_attempt,
        file_path: r.file_path,
        completed_at: null,
      };
    }
    return out;
  }

  resetErrorsToPending(): number {
    const result = this.db
      .prepare(
        `UPDATE objects SET status = ?, last_error = NULL, last_attempt = NULL WHERE status = ?`
      )
      .run(ObjectStatus.PENDING, ObjectStatus.ERROR);
    return result.changes;
  }

  resetAllToPending(): number {
    const result = this.db.prepare(
      "UPDATE objects SET status = 'pending', last_error = NULL, last_attempt = NULL"
    ).run();
    return result.changes;
  }

  clearAllData(): void {
    this.db.prepare("DELETE FROM objects").run();
    this.db.prepare("DELETE FROM metadata").run();
  }

  close(): void {
    this.db.close();
  }
}
