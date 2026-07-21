import { deleteNode } from "@/lib/services/prompts";
import { errorResponse } from "@/lib/http";
import { noContent } from "@/lib/route-utils";
import { SYSTEM_USER } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function DELETE(_req: Request, { params }: { params: { node_nm: string } }) {
  try {
    await deleteNode(decodeURIComponent(params.node_nm), SYSTEM_USER);
    return noContent();
  } catch (e) {
    return errorResponse(e);
  }
}
