import { readConn, withConn } from "@/lib/db";
import type { OracleConnection, OracleModule } from "@/lib/db";
import { ApiError, conflict, notFound } from "@/lib/http";
import {
  PROMPT_COLS_DETAIL,
  PROMPT_COLS_SUMMARY,
  insertReturningId,
  mapActivePrompt,
  mapPromptDetail,
  mapPromptSummary,
} from "@/lib/db/rows";
import type {
  ActivePrompt,
  NodeCreate,
  PromptVersionCreate,
  PromptVersionDetail,
  PromptVersionSummary,
} from "@/lib/types";

const VERSION_RE = /^(\d+)\.(\d+)\.(\d+)$/;

function bumpPatch(versionNo: string): string {
  const m = VERSION_RE.exec(versionNo);
  if (!m) return `${versionNo}.1`;
  return `${m[1]}.${m[2]}.${Number(m[3]) + 1}`;
}

async function suggestNextVersion(conn: OracleConnection, nodeNm: string): Promise<string> {
  const res = await conn.execute(
    `SELECT VERSION_NO FROM PM_NODE_PROMPT_VER
      WHERE NODE_NM = :nm
      ORDER BY CREATED_DT DESC, PROMPT_ID DESC
      FETCH FIRST 1 ROWS ONLY`,
    { nm: nodeNm },
  );
  const rows = (res.rows ?? []) as Record<string, unknown>[];
  if (rows.length === 0) return "1.0.0";
  return bumpPatch(String(rows[0].VERSION_NO));
}

export async function listVersions(nodeNm: string): Promise<PromptVersionSummary[]> {
  return readConn(async (conn) => {
    const res = await conn.execute(
      `SELECT ${PROMPT_COLS_SUMMARY} FROM PM_NODE_PROMPT_VER
        WHERE NODE_NM = :nm
        ORDER BY CREATED_DT DESC, PROMPT_ID DESC`,
      { nm: nodeNm },
    );
    return ((res.rows ?? []) as Record<string, unknown>[]).map(mapPromptSummary);
  }, []);
}

async function fetchDetail(conn: OracleConnection, promptId: number): Promise<PromptVersionDetail | null> {
  const res = await conn.execute(
    `SELECT ${PROMPT_COLS_DETAIL} FROM PM_NODE_PROMPT_VER WHERE PROMPT_ID = :id`,
    { id: promptId },
  );
  const rows = (res.rows ?? []) as Record<string, unknown>[];
  return rows.length ? mapPromptDetail(rows[0]) : null;
}

export async function getVersion(promptId: number): Promise<PromptVersionDetail> {
  const detail = await readConn((conn) => fetchDetail(conn, promptId), null);
  if (detail === null) throw notFound("prompt version not found");
  return detail;
}

export async function activePromptsForFlow(): Promise<Record<string, ActivePrompt>> {
  return readConn(async (conn) => {
    const res = await conn.execute(
      `SELECT NODE_NM, PROMPT_ID, VERSION_NO, MODEL_NM, SYSTEM_PROMPT, USER_PROMPT
         FROM PM_NODE_PROMPT_VER WHERE IS_ACTIVE = 'Y'`,
    );
    const out: Record<string, ActivePrompt> = {};
    for (const r of (res.rows ?? []) as Record<string, unknown>[]) {
      const ap = mapActivePrompt(r);
      out[ap.node_nm] = ap;
    }
    return out;
  }, {});
}

export async function activePromptForNode(nodeNm: string): Promise<ActivePrompt> {
  const ap = await readConn(async (conn) => {
    const res = await conn.execute(
      `SELECT NODE_NM, PROMPT_ID, VERSION_NO, MODEL_NM, SYSTEM_PROMPT, USER_PROMPT
         FROM PM_NODE_PROMPT_VER WHERE NODE_NM = :nm AND IS_ACTIVE = 'Y'
         FETCH FIRST 1 ROWS ONLY`,
      { nm: nodeNm },
    );
    const rows = (res.rows ?? []) as Record<string, unknown>[];
    return rows.length ? mapActivePrompt(rows[0]) : null;
  }, null);
  if (ap === null) throw notFound("no active prompt for this node");
  return ap;
}

async function nodeExists(conn: OracleConnection, nodeNm: string): Promise<boolean> {
  const res = await conn.execute(
    `SELECT PROMPT_ID FROM PM_NODE_PROMPT_VER WHERE NODE_NM = :nm FETCH FIRST 1 ROWS ONLY`,
    { nm: nodeNm },
  );
  return ((res.rows ?? []) as unknown[]).length > 0;
}

/** Insert a new version (audit written in the same transaction). Returns its id. */
async function insertVersion(
  conn: OracleConnection,
  oracle: OracleModule,
  nodeNm: string,
  payload: PromptVersionCreate,
  createdBy: string,
): Promise<number> {
  const versionNo = payload.version_no || (await suggestNextVersion(conn, nodeNm));

  const dup = await conn.execute(
    `SELECT PROMPT_ID FROM PM_NODE_PROMPT_VER WHERE NODE_NM = :nm AND VERSION_NO = :vno`,
    { nm: nodeNm, vno: versionNo },
  );
  if (((dup.rows ?? []) as unknown[]).length > 0) {
    throw conflict(`version ${versionNo} already exists for this node`);
  }

  const newId = await insertReturningId(
    conn,
    oracle,
    `INSERT INTO PM_NODE_PROMPT_VER
       (NODE_NM, VERSION_NO, SYSTEM_PROMPT, USER_PROMPT, MODEL_NM, IS_ACTIVE,
        CHANGE_SUMMARY, CHANGE_REASON, PREV_PROMPT_ID, CREATED_BY)
     VALUES (:node_nm, :version_no, :system_prompt, :user_prompt, :model_nm, 'N',
        :change_summary, :change_reason, :prev_prompt_id, :created_by)
     RETURNING PROMPT_ID INTO :out_id`,
    {
      node_nm: nodeNm,
      version_no: versionNo,
      system_prompt: payload.system_prompt ?? "",
      user_prompt: payload.user_prompt ?? "",
      model_nm: payload.model_nm ?? null,
      change_summary: payload.change_summary,
      change_reason: payload.change_reason,
      prev_prompt_id: payload.prev_prompt_id ?? null,
      created_by: createdBy,
    },
  );

  const { writeAudit } = await import("./audit");
  await writeAudit(conn, {
    targetTable: "PM_NODE_PROMPT_VER",
    targetId: newId,
    action: "CREATE",
    before: null,
    after: {
      prompt_id: newId,
      node_nm: nodeNm,
      version_no: versionNo,
      model_nm: payload.model_nm ?? null,
      change_summary: payload.change_summary,
      change_reason: payload.change_reason,
      system_prompt: payload.system_prompt ?? "",
      user_prompt: payload.user_prompt ?? "",
    },
    createdBy,
  });
  return newId;
}

export async function createNode(payload: NodeCreate, createdBy: string): Promise<PromptVersionDetail> {
  return withConn(async (conn, oracle) => {
    if (await nodeExists(conn, payload.node_nm)) {
      throw conflict("이미 존재하는 노드입니다");
    }
    const id = await insertVersion(conn, oracle, payload.node_nm, payload, createdBy);
    return (await fetchDetail(conn, id))!;
  }, { commit: true });
}

export async function createPrompt(
  nodeNm: string,
  payload: PromptVersionCreate,
  createdBy: string,
): Promise<PromptVersionDetail> {
  return withConn(async (conn, oracle) => {
    const id = await insertVersion(conn, oracle, nodeNm, payload, createdBy);
    return (await fetchDetail(conn, id))!;
  }, { commit: true });
}

export async function updateVersionPrompt(
  promptId: number,
  args: {
    system_prompt: string;
    user_prompt: string;
    model_nm?: string | null;
    change_summary?: string | null;
    change_reason?: string | null;
  },
  actor: string,
): Promise<PromptVersionDetail> {
  return withConn(async (conn) => {
    const before = await fetchDetail(conn, promptId);
    if (before === null) throw notFound("prompt version not found");

    await conn.execute(
      `UPDATE PM_NODE_PROMPT_VER
          SET SYSTEM_PROMPT = :sp, USER_PROMPT = :up, MODEL_NM = :model,
              CHANGE_SUMMARY = COALESCE(:cs, CHANGE_SUMMARY),
              CHANGE_REASON  = COALESCE(:cr, CHANGE_REASON),
              UPDATED_DT = SYSTIMESTAMP
        WHERE PROMPT_ID = :id`,
      {
        sp: args.system_prompt ?? "",
        up: args.user_prompt ?? "",
        modelnm: args.model_nm ?? null,
        cs: args.change_summary || null,
        cr: args.change_reason || null,
        id: promptId,
      },
    );

    const { writeAudit } = await import("./audit");
    await writeAudit(conn, {
      targetTable: "PM_NODE_PROMPT_VER",
      targetId: promptId,
      action: "UPDATE",
      before: {
        system_prompt: before.system_prompt,
        user_prompt: before.user_prompt,
        model_nm: before.model_nm,
      },
      after: {
        system_prompt: args.system_prompt,
        user_prompt: args.user_prompt,
        model_nm: args.model_nm ?? null,
      },
      createdBy: actor,
    });
    return (await fetchDetail(conn, promptId))!;
  }, { commit: true });
}

export async function deleteVersion(promptId: number, actor: string): Promise<void> {
  await withConn(async (conn) => {
    const before = await fetchDetail(conn, promptId);
    if (before === null) throw notFound("prompt version not found");

    // Clear FK references so the delete doesn't violate integrity.
    await conn.execute(
      `UPDATE PM_NODE_PROMPT_VER SET PREV_PROMPT_ID = NULL WHERE PREV_PROMPT_ID = :id`,
      { id: promptId },
    );
    await conn.execute(`UPDATE PM_RAGAS_RUN SET PROMPT_ID = NULL WHERE PROMPT_ID = :id`, { id: promptId });
    await conn.execute(`DELETE FROM PM_NODE_PROMPT_VER WHERE PROMPT_ID = :id`, { id: promptId });

    const { writeAudit } = await import("./audit");
    await writeAudit(conn, {
      targetTable: "PM_NODE_PROMPT_VER",
      targetId: promptId,
      action: "DELETE",
      before: {
        node_nm: before.node_nm,
        version_no: before.version_no,
        model_nm: before.model_nm,
        change_summary: before.change_summary,
        change_reason: before.change_reason,
        system_prompt: before.system_prompt,
        user_prompt: before.user_prompt,
      },
      after: null,
      createdBy: actor,
    });
  }, { commit: true });
}

export async function deleteNode(nodeNm: string, actor: string): Promise<number> {
  return withConn(async (conn) => {
    const res = await conn.execute(
      `SELECT PROMPT_ID, VERSION_NO FROM PM_NODE_PROMPT_VER WHERE NODE_NM = :nm
        ORDER BY CREATED_DT DESC, PROMPT_ID DESC`,
      { nm: nodeNm },
    );
    const rows = (res.rows ?? []) as Record<string, unknown>[];
    if (rows.length === 0) throw notFound("node not found");
    const ids = rows.map((r) => Number(r.PROMPT_ID));

    // Clear FK references, then delete every version of the node.
    await conn.execute(`UPDATE PM_RAGAS_RUN SET PROMPT_ID = NULL WHERE PROMPT_ID IN (SELECT PROMPT_ID FROM PM_NODE_PROMPT_VER WHERE NODE_NM = :nm)`, { nm: nodeNm });
    await conn.execute(`UPDATE PM_NODE_PROMPT_VER SET PREV_PROMPT_ID = NULL WHERE PREV_PROMPT_ID IN (SELECT PROMPT_ID FROM PM_NODE_PROMPT_VER WHERE NODE_NM = :nm)`, { nm: nodeNm });
    await conn.execute(`DELETE FROM PM_NODE_PROMPT_VER WHERE NODE_NM = :nm`, { nm: nodeNm });

    const { writeAudit } = await import("./audit");
    await writeAudit(conn, {
      targetTable: "PM_NODE_PROMPT_VER",
      targetId: ids[0],
      action: "DELETE",
      before: {
        node_nm: nodeNm,
        deleted_version_count: ids.length,
        version_nos: rows.map((r) => String(r.VERSION_NO)),
      },
      after: null,
      createdBy: actor,
    });
    return ids.length;
  }, { commit: true });
}

export { ApiError };
