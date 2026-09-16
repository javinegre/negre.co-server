import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

/**
 * Read-only peek at the per-user Bicing config store.
 *
 * The schema here is owned by apis/bicing-api — see that repo's README and
 * src/v2/config/config.db.ts. This is a deliberate read-only view of another
 * service's storage, not a contract: nothing in this file writes, and the
 * shape is re-derived on every read rather than cached.
 *
 * Writing is deliberately absent. PUT /bicing/api/v2/config keys off
 * req.session.user.id, so it can only ever write the *signed-in* user's row —
 * there is no admin write in that API. Writing here instead would bypass the
 * validation that endpoint enforces (unknown-key rejection, coordinate and
 * zoom ranges, the savedStationIds cap), which is exactly the corruption that
 * validation exists to prevent.
 */

// Same resolution as bicing-api's config.db.ts, which lands on the same file.
const dbPath = (): string =>
  process.env.BICING_DB_PATH || path.join(__dirname, '..', 'data', 'bicing.db');

export interface ConfigEntry {
  userId: string;
  /** Null when no user row matches — a leftover from a deleted account. */
  email: string | null;
  /** Parsed document, or null when the stored JSON will not parse. */
  config: unknown;
  /** Raw text, kept only when parsing failed, so the row can still be inspected. */
  raw: string | null;
  /** Epoch milliseconds, as written by Date.now() in bicing-api. */
  updatedAt: number;
  bytes: number;
}

export interface ConfigStore {
  path: string;
  /** False is ordinary: bicing-api creates the file on first use, not on import. */
  present: boolean;
  error: string | null;
  entries: ConfigEntry[];
}

interface Row {
  user_id: string;
  config: string;
  updated_at: number;
}

/**
 * @param emails user id -> email, for rows to be attributed. Ids with no entry
 *   are reported as orphans rather than dropped: deleting a user leaves their
 *   config row behind, and that is worth being able to see.
 */
export function readConfigStore(emails: Map<string, string>): ConfigStore {
  const file = dbPath();

  if (!fs.existsSync(file)) {
    return { path: file, present: false, error: null, entries: [] };
  }

  let db: Database.Database | null = null;
  try {
    db = new Database(file, { readonly: true, fileMustExist: true });

    const rows = db
      .prepare('SELECT user_id, config, updated_at FROM user_config')
      .all() as Row[];

    const entries = rows.map((row): ConfigEntry => {
      let config: unknown = null;
      let raw: string | null = null;
      try {
        config = JSON.parse(row.config);
      } catch {
        // bicing-api falls back to defaults for an unreadable row rather than
        // locking the user out. Surface it here instead of hiding it — this is
        // the one screen where a corrupt document should be visible.
        raw = row.config;
      }

      return {
        userId: row.user_id,
        email: emails.get(row.user_id) ?? null,
        config,
        raw,
        updatedAt: row.updated_at,
        bytes: Buffer.byteLength(row.config, 'utf8'),
      };
    });

    entries.sort((a, b) => b.updatedAt - a.updatedAt);
    return { path: file, present: true, error: null, entries };
  } catch (err) {
    // A missing table is normal on a database bicing-api has opened but whose
    // config API has never run; anything else is worth showing verbatim.
    return { path: file, present: true, error: (err as Error).message, entries: [] };
  } finally {
    db?.close();
  }
}
