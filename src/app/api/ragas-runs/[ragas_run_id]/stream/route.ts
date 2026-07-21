import type { NextRequest } from "next/server";
import { executeRun } from "@/lib/services/flow";
import { sseResponse } from "@/lib/sse";
import { intParam } from "@/lib/route-utils";
import { errorResponse } from "@/lib/http";

export const dynamic = "force-dynamic";
// Runs can outlast the default; allow the stream to stay open.
export const maxDuration = 300;

export async function GET(req: NextRequest, { params }: { params: { ragas_run_id: string } }) {
  try {
    const id = intParam(params.ragas_run_id, "ragas_run_id");
    return sseResponse((emit) => executeRun(id, emit, req.signal));
  } catch (e) {
    return errorResponse(e);
  }
}
