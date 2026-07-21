import type { NextRequest } from "next/server";
import { ragasRunRows, serialize } from "@/lib/services/export";
import { errorResponse } from "@/lib/http";
import { intParam } from "@/lib/route-utils";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: { ragas_run_id: string } }) {
  try {
    const id = intParam(params.ragas_run_id, "ragas_run_id");
    const fmt = req.nextUrl.searchParams.get("fmt") ?? "csv";
    const rows = await ragasRunRows(id);
    const { body, media, ext } = serialize(rows, fmt);
    return new Response(body, {
      headers: {
        "Content-Type": media,
        "Content-Disposition": `attachment; filename="ragas-run-${id}.${ext}"`,
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
