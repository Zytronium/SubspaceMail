import Database from "@tauri-apps/plugin-sql";

let db: Database | null = null;

/**
 * Simple mutex for serializing concurrent transactions.
 */
let txMutex: Promise<void> = Promise.resolve();

/**
 * Execute a callback within a SQLite transaction (BEGIN/COMMIT/ROLLBACK).
 * Serialises concurrent calls via a mutex so transactions never overlap.
 */
export async function withTransaction<T>(cb: () => Promise<T>): Promise<T> {
  const previous = txMutex;
  let resolveMutex: () => void;
  txMutex = new Promise((resolve) => {
    resolveMutex = resolve;
  });
  await previous;
  try {
    const db = await getDb();
    await db.execute("BEGIN TRANSACTION");
    const result = await cb();
    await db.execute("COMMIT");
    return result;
  } catch (err) {
    try {
      const db = await getDb();
      await db.execute("ROLLBACK");
    } catch {
      // SQLite may have already auto-rolled back; ignore
    }
    throw err;
  } finally {
    resolveMutex!();
  }
}

export async function getDb(): Promise<Database> {
  if (!db) {
    db = await Database.load("sqlite:subspacemail.db");
  }
  return db;
}

/**
 * Build a dynamic SQL UPDATE statement from a set of field updates.
 * Returns null if no fields to update.
 */
export function buildDynamicUpdate(
  table: string,
  idColumn: string,
  id: unknown,
  fields: [string, unknown][],
): { sql: string; params: unknown[] } | null {
  if (fields.length === 0) return null;

  const sets: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  for (const [column, value] of fields) {
    sets.push(`${column} = $${idx++}`);
    params.push(value);
  }

  params.push(id);
  return {
    sql: `UPDATE ${table} SET ${sets.join(", ")} WHERE ${idColumn} = $${idx}`,
    params,
  };
}


/**
 * Execute a SELECT query and return the first result or null.
 */
export async function selectFirstBy<T>(
  query: string,
  params: unknown[] = [],
): Promise<T | null> {
  const db = await getDb();
  const rows = await db.select<T[]>(query, params);
  return rows[0] ?? null;
}

/**
 * Execute a COUNT(*) query and return whether any rows exist.
 */
export async function existsBy(
  query: string,
  params: unknown[] = [],
): Promise<boolean> {
  const db = await getDb();
  const rows = await db.select<{ count: number }[]>(query, params);
  return (rows[0]?.count ?? 0) > 0;
}

/**
 * Convert a boolean to SQLite integer (0 or 1).
 */
export function boolToInt(value: boolean | undefined | null): number {
  return value ? 1 : 0;
}
