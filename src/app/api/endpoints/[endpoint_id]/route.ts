import { deleteEndpoint, updateEndpoint } from "@/lib/services/endpoints";
import { badRequest, errorResponse } from "@/lib/http";
import { jsonBody, ok } from "@/lib/route-utils";
import { SYSTEM_USER, type EndpointInput } from "@/lib/types";

export const dynamic = "force-dynamic";

function endpointId(raw: string): number {
  const id = Number(raw);
  if (!Number.isInteger(id)) throw badRequest("잘못된 API id입니다");
  return id;
}

export async function PUT(req: Request, { params }: { params: { endpoint_id: string } }) {
  try {
    const body = await jsonBody<EndpointInput>(req);
    return ok(await updateEndpoint(endpointId(params.endpoint_id), body, SYSTEM_USER));
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(_req: Request, { params }: { params: { endpoint_id: string } }) {
  try {
    return ok(await deleteEndpoint(endpointId(params.endpoint_id), SYSTEM_USER));
  } catch (e) {
    return errorResponse(e);
  }
}
