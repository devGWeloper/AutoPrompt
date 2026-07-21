import { readConn } from "@/lib/db";
import { AUDIT_COLS, mapAudit } from "@/lib/db/rows";
import type { AuditLog, AuditLogPage } from "@/lib/types";

export interface AuditFilter {
  targetTable?: string | null;
  user?: string | null;
  action?: string | null;
  dateFrom?: string | null;
  dateTo?: string | null;
  page: number;
  size: number;
}

/** Trim an ISO datetime to seconds for TO_TIMESTAMP('YYYY-MM-DD"T"HH24:MI:SS'). */
function isoSeconds(v: string): string {
  return v.slice(0, 19);
}

export async function listAuditLogs(f: AuditFilter): Promise<AuditLogPage> {
  return readConn(
    async (conn) => {
      const where: string[] = [];
      const binds: Record<string, unknown> = {};
      if (f.targetTable) {
        where.push("TARGET_TABLE = :tt");
        binds.tt = f.targetTable;
      }
      if (f.user) {
        where.push("CREATED_BY = :usr");
        binds.usr = f.user;
      }
      if (f.action) {
        where.push("ACTION = :act");
        binds.act = f.action;
      }
      if (f.dateFrom) {
        where.push(`CREATED_DT >= TO_TIMESTAMP(:df, 'YYYY-MM-DD"T"HH24:MI:SS')`);
        binds.df = isoSeconds(f.dateFrom);
      }
      if (f.dateTo) {
        where.push(`CREATED_DT <= TO_TIMESTAMP(:dt, 'YYYY-MM-DD"T"HH24:MI:SS')`);
        binds.dt = isoSeconds(f.dateTo);
      }
      const whereSql = where.length ? ` WHERE ${where.join(" AND ")}` : "";

      const totalRes = await conn.execute(`SELECT COUNT(*) AS N FROM PM_AUDIT_LOG${whereSql}`, binds);
      const total = Number(((totalRes.rows ?? []) as Record<string, unknown>[])[0]?.N ?? 0);

      const offset = (f.page - 1) * f.size;
      const pageRes = await conn.execute(
        `SELECT ${AUDIT_COLS} FROM PM_AUDIT_LOG${whereSql}
          ORDER BY CREATED_DT DESC
          OFFSET :pgoff ROWS FETCH NEXT :pgsz ROWS ONLY`,
        { ...binds, pgoff: offset, pgsz: f.size },
      );
      const items = ((pageRes.rows ?? []) as Record<string, unknown>[]).map(mapAudit);
      return { total, page: f.page, size: f.size, items };
    },
    { total: 0, page: f.page, size: f.size, items: [] as AuditLog[] },
  );
}

export async function nodeAuditLogs(nodeNm: string, limit: number): Promise<AuditLog[]> {
  return readConn(async (conn) => {
    const idsRes = await conn.execute(`SELECT PROMPT_ID FROM PM_NODE_PROMPT_VER WHERE NODE_NM = :nm`, { nm: nodeNm });
    const ids = ((idsRes.rows ?? []) as Record<string, unknown>[]).map((r) => Number(r.PROMPT_ID));
    if (ids.length === 0) return [];
    const binds: Record<string, unknown> = { lim: limit };
    const names = ids.map((id, i) => {
      binds[`i${i}`] = id;
      return `:i${i}`;
    });
    const res = await conn.execute(
      `SELECT ${AUDIT_COLS} FROM PM_AUDIT_LOG
        WHERE TARGET_TABLE = 'PM_NODE_PROMPT_VER' AND TARGET_ID IN (${names.join(", ")})
        ORDER BY CREATED_DT DESC
        FETCH FIRST :lim ROWS ONLY`,
      binds,
    );
    return ((res.rows ?? []) as Record<string, unknown>[]).map(mapAudit);
  }, []);
}
