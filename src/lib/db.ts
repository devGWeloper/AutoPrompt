import { getDbConfig } from "./config";
import { logger } from "./logger";

// oracledb is a native optional driver. It is loaded lazily so the app can boot
// (and read-only pages can render "not connected") even where the driver or the
// DB is unavailable — matching the reference/stub nature of this checkout.
type OracleModule = typeof import("oracledb");
type OracleConnection = Awaited<ReturnType<OracleModule["getConnection"]>>;

let oracleCached: OracleModule | null = null;

/** Raised when a write is attempted with no DB configured (config.yml db block empty). */
export class DbNotConfiguredError extends Error {
  constructor() {
    super("DB가 설정되지 않았습니다 (config.yml/config.dev.yml 의 db 접속 정보를 채우세요)");
    this.name = "DbNotConfiguredError";
  }
}

async function getOracle(): Promise<OracleModule | null> {
  if (oracleCached) return oracleCached;
  try {
    const imported = await import("oracledb");
    // A dynamic ESM import wraps CommonJS as a read-only namespace (getter-only);
    // the real oracledb object is the default export — mutate/settings go there.
    const mod = ((imported as { default?: OracleModule }).default ?? imported) as unknown as OracleModule;
    // CLOB columns come back as plain strings (no Lob streaming needed).
    mod.fetchAsString = [mod.CLOB];
    mod.autoCommit = false;
    // Rows come back as { COLUMN_NAME: value } objects (uppercase keys).
    mod.outFormat = mod.OUT_FORMAT_OBJECT;
    oracleCached = mod;
    logger.info("oracledb driver loaded");
    return mod;
  } catch (e) {
    logger.error("oracledb driver load failed", { err: String(e) });
    return null;
  }
}

/** True when a complete DB block is configured. */
export function dbConfigured(): boolean {
  return getDbConfig() !== null;
}

/** The oracledb module (for BIND_OUT / NUMBER constants in callers). Null if unavailable. */
export async function oracle(): Promise<OracleModule | null> {
  return getOracle();
}

/**
 * Acquire a connection, run ``fn``, commit if it succeeds, and always close.
 * Throws :class:`DbNotConfiguredError` when no DB is configured and the driver
 * is unavailable — writes surface a clear error instead of silently no-op'ing.
 *
 * Read paths that should degrade to empty results when the DB is absent should
 * guard with :func:`dbConfigured` before calling this.
 */
export async function withConn<T>(
  fn: (conn: OracleConnection, oracle: OracleModule) => Promise<T>,
  opts: { commit?: boolean } = {},
): Promise<T> {
  const cfg = getDbConfig();
  const mod = await getOracle();
  if (!cfg || !mod) throw new DbNotConfiguredError();

  const t0 = Date.now();
  let conn: OracleConnection | undefined;
  try {
    conn = await mod.getConnection(cfg);
    const out = await fn(conn, mod);
    if (opts.commit) await conn.commit();
    return out;
  } catch (e) {
    if (conn && opts.commit) {
      try {
        await conn.rollback();
      } catch {
        /* ignore */
      }
    }
    logger.error("db op failed", { ms: Date.now() - t0, err: String(e) });
    throw e;
  } finally {
    if (conn) {
      try {
        await conn.close();
      } catch {
        /* ignore */
      }
    }
  }
}

/** Read helper: returns ``fallback`` when the DB is not configured, else runs ``fn``. */
export async function readConn<T>(
  fn: (conn: OracleConnection, oracle: OracleModule) => Promise<T>,
  fallback: T,
): Promise<T> {
  if (!dbConfigured()) return fallback;
  try {
    return await withConn(fn);
  } catch (e) {
    if (e instanceof DbNotConfiguredError) return fallback;
    throw e;
  }
}

export type { OracleConnection, OracleModule };
