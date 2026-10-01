import { deleteLlmServer, updateLlmServer } from "@/lib/services/llmServers";
import { badRequest, errorResponse } from "@/lib/http";
import { jsonBody, ok } from "@/lib/route-utils";
import { SYSTEM_USER, type LlmServerInput } from "@/lib/types";

export const dynamic = "force-dynamic";

function serverId(raw: string): number {
  const id = Number(raw);
  if (!Number.isInteger(id)) throw badRequest("잘못된 서버 id 입니다");
  return id;
}

export async function PUT(req: Request, { params }: { params: { server_id: string } }) {
  try {
    const body = await jsonBody<LlmServerInput>(req);
    return ok(await updateLlmServer(serverId(params.server_id), body, SYSTEM_USER));
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(_req: Request, { params }: { params: { server_id: string } }) {
  try {
    return ok(await deleteLlmServer(serverId(params.server_id), SYSTEM_USER));
  } catch (e) {
    return errorResponse(e);
  }
}
