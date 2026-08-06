import type { OracleConnection } from "@/lib/db";

/** Serialize a before/after value to a JSON string (or pass strings through). */
function toJson(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

export interface AuditArgs {
  targetTable: string;
  targetId: number;
  action: string;
  before: unknown;
  after: unknown;
  createdBy: string;
}

/**
 * Insert one audit-log row. Takes an open connection so the write joins the
 * caller's transaction (audit + the change it records commit together).
 */
export async function writeAudit(conn: OracleConnection, args: AuditArgs): Promise<void> {
  await conn.execute(
    `INSERT INTO PTX_AUDIT_HIS (TARGET_TABLE_NM, TARGET_ID, ACTION_CD, BEFORE_CTN, AFTER_CTN, USER_ID)
     VALUES (:t, :tid, :act, :bef, :af, :cby)`,
    {
      t: args.targetTable,
      tid: args.targetId,
      act: args.action,
      bef: toJson(args.before),
      af: toJson(args.after),
      cby: args.createdBy,
    },
  );
}
