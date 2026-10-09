import { DatabaseSync } from 'node:sqlite';

export type DeliveryStatus = 'pending' | 'sent' | 'uncertain';
export interface HistoryRow {
  recipient: string;
  day: string;
  status: string;
  timestamp: string;
  code: string | null;
}

export class History {
  private readonly db: DatabaseSync;

  constructor(path: string, timezone: string) {
    this.db = new DatabaseSync(path);
    try {
      this.db.exec(`
        PRAGMA busy_timeout = 5000;
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = FULL;
        CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS deliveries (
          recipient TEXT NOT NULL, day TEXT NOT NULL, message TEXT NOT NULL,
          status TEXT NOT NULL CHECK(status IN ('pending', 'sent', 'uncertain')),
          timestamp TEXT NOT NULL, PRIMARY KEY (recipient, day)
        );
        CREATE TABLE IF NOT EXISTS events (
          id INTEGER PRIMARY KEY, recipient TEXT NOT NULL, day TEXT NOT NULL,
          message TEXT NOT NULL, status TEXT NOT NULL, timestamp TEXT NOT NULL, code TEXT
        );
      `);
      this.db.prepare('INSERT OR IGNORE INTO settings VALUES (?, ?)').run('timezone', timezone);
      const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get('timezone');
      if (row?.value !== timezone) throw new Error('Database timezone differs from configuration');
    } catch (error) {
      this.db.close();
      throw error;
    }
  }

  blocked(recipient: string, day: string): boolean {
    return !!this.db
      .prepare('SELECT 1 FROM deliveries WHERE recipient = ? AND day = ?')
      .get(recipient.toLowerCase(), day);
  }

  // A durable reservation precedes the only irreversible browser action. Pending rows
  // are deliberately never expired: a killed process may already have submitted.
  reserve(recipient: string, day: string, message: string, now: Date): boolean {
    return (
      this.db
        .prepare(`INSERT OR IGNORE INTO deliveries VALUES (?, ?, ?, 'pending', ?)`)
        .run(recipient.toLowerCase(), day, message, now.toISOString()).changes === 1
    );
  }

  finish(
    recipient: string,
    day: string,
    status: Exclude<DeliveryStatus, 'pending'>,
    now: Date,
  ): void {
    const result = this.db
      .prepare(
        `UPDATE deliveries SET status = ?, timestamp = ? WHERE recipient = ? AND day = ? AND status = 'pending'`,
      )
      .run(status, now.toISOString(), recipient.toLowerCase(), day);
    if (result.changes !== 1) throw new Error('Missing pending delivery');
  }

  event(
    recipient: string,
    day: string,
    message: string,
    status: 'dry-run' | 'failed',
    now: Date,
    code: string | null = null,
  ): void {
    this.db
      .prepare(
        'INSERT INTO events (recipient, day, message, status, timestamp, code) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(recipient.toLowerCase(), day, message, status, now.toISOString(), code);
  }

  recent(limit = 50): HistoryRow[] {
    return this.db
      .prepare(
        `
      SELECT recipient, day, status, timestamp, NULL AS code FROM deliveries
      UNION ALL SELECT recipient, day, status, timestamp, code FROM events
      ORDER BY timestamp DESC LIMIT ?
    `,
      )
      .all(limit) as unknown as HistoryRow[];
  }

  close(): void {
    this.db.close();
  }
}
