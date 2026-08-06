import type { NextRequest } from "next/server";
import { streamRun } from "@/lib/services/flow";
import { sseResponse } from "@/lib/sse";
import { intParam } from "@/lib/route-utils";
import { errorResponse } from "@/lib/http";

export const dynamic = "force-dynamic";
// Runs can outlast the default; allow the stream to stay open.
export const maxDuration = 300;

export async function GET(req: NextRequest, { params }: { params: { ragas_run_id: string } }) {
  try {
    const id = intParam(params.ragas_run_id, "ragas_run_id");
    // Which endpoint this run calls: `side` picks the configured A/B endpoint,
    // `base_url` overrides it with a URL typed into the UI. Passed per stream so
    // nothing extra has to be persisted on the run.
    const q = req.nextUrl.searchParams;
    const rawSide = q.get("side");
    const side = rawSide === "a" || rawSide === "b" ? rawSide : null;
    // The run itself is owned by the run registry, not by this connection:
    // reconnecting (after a refresh) attaches and replays, it does not re-run.
    return sseResponse((emit) => streamRun(id, emit, req.signal, { baseUrl: q.get("base_url"), side }));
  } catch (e) {
    return errorResponse(e);
  }
}
