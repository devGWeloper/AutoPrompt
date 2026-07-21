import type { NextRequest } from "next/server";
import { ragasAbRows, serialize } from "@/lib/services/export";
import { errorResponse } from "@/lib/http";
import { intParam } from "@/lib/route-utils";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: { ab_group_id: string } }) {
  try {
    const groupId = intParam(params.ab_group_id, "ab_group_id");
    const fmt = req.nextUrl.searchParams.get("fmt") ?? "csv";
    const rows = await ragasAbRows(groupId);
    const { body, media, ext } = serialize(rows, fmt);
    return new Response(body, {
      headers: {
        "Content-Type": media,
        "Content-Disposition": `attachment; filename="ragas-ab-${groupId}.${ext}"`,
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
