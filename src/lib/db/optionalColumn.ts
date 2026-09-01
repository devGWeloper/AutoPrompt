import type { OracleConnection } from "@/lib/db";
import { logger } from "@/lib/logger";

/**
 * Is an optional column present in this database?
 *
 * TTFT_MS arrives by migration (`sql/migrate_ttft_ms.sql`), and the app runs
 * against databases that have not had it applied yet. Naming the column
 * unconditionally in an INSERT would break every run on those with ORA-00904 —
 * a new measurement is not worth stopping the tests that already work. So the
 * statement is built around what the database actually has, and TTFT is simply
 * not persisted until the migration runs. It is still measured and still shown
 * live either way.
 *
 * Cached per process: the answer only changes when a migration runs, which
 * means a deploy.
 */
const cache = new Map<string, boolean>();

export async function hasColumn(conn: OracleConnection, table: string, column: string): Promise<boolean> {
  const key = `${table}.${column}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  let present = false;
  try {
    const res = await conn.execute(
      `SELECT COUNT(*) AS N FROM user_tab_columns WHERE table_name = :t AND column_name = :c`,
      { t: table, c: column },
    );
    const row = (res.rows ?? [])[0] as { N?: unknown } | undefined;
    present = Number(row?.N ?? 0) > 0;
  } catch (e) {
    // A catalogue read that fails should not take the run with it — assume the
    // column is absent and carry on without it.
    logger.warn("optional column check failed", { table, column, err: String(e) });
    present = false;
  }
  if (!present) logger.info("optional column absent — not written", { table, column });
  cache.set(key, present);
  return present;
}
