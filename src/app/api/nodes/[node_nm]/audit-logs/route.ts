import type { NextRequest } from "next/server";
import { nodeAuditLogs } from "@/lib/services/auditLogs";
import { errorResponse } from "@/lib/http";
import { ok } from "@/lib/route-utils";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: { node_nm: string } }) {
  try {
    const limit = Math.min(500, Math.max(1, Number(req.nextUrl.searchParams.get("limit") ?? 50) || 50));
    return ok(await nodeAuditLogs(decodeURIComponent(params.node_nm), limit));
  } catch (e) {
    return errorResponse(e);
  }
}
