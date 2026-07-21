import type { NextRequest } from "next/server";
import { executeAbGroup } from "@/lib/services/flow";
import { sseResponse } from "@/lib/sse";
import { intParam } from "@/lib/route-utils";
import { errorResponse } from "@/lib/http";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest, { params }: { params: { ab_group_id: string } }) {
  try {
    const groupId = intParam(params.ab_group_id, "ab_group_id");
    return sseResponse((emit) => executeAbGroup(groupId, emit, req.signal));
  } catch (e) {
    return errorResponse(e);
  }
}
