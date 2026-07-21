import type { NextRequest } from "next/server";
import { listAuditLogs } from "@/lib/services/auditLogs";
import { errorResponse } from "@/lib/http";
import { ok } from "@/lib/route-utils";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const page = Math.max(1, Number(sp.get("page") ?? 1) || 1);
    const size = Math.min(200, Math.max(1, Number(sp.get("size") ?? 20) || 20));
    return ok(
      await listAuditLogs({
        targetTable: sp.get("target_table"),
        user: sp.get("user"),
        action: sp.get("action"),
        dateFrom: sp.get("date_from"),
        dateTo: sp.get("date_to"),
        page,
        size,
      }),
    );
  } catch (e) {
    return errorResponse(e);
  }
}
