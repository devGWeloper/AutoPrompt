import type { NextRequest } from "next/server";
import { streamRun } from "@/lib/services/flow";
import { sseResponse } from "@/lib/sse";
import { intParam } from "@/lib/route-utils";
import { errorResponse } from "@/lib/http";

export const dynamic = "force-dynamic";
// Runs can outlast the default; allow the stream to stay open. This is a whole
// run, not one call: N cases each allowed `agent.timeoutSec` (300s), so it
// cannot be derived from that number and must simply be far above it. Inert
// under `next start` (deploy.sh), which enforces no such limit — it matters
// only if this ever runs somewhere that reads it.
export const maxDuration = 3600;

export async function GET(req: NextRequest, { params }: { params: { ragas_run_id: string } }) {
  try {
    const id = intParam(params.ragas_run_id, "ragas_run_id");
    // Which endpoint this run calls, in order of precedence: `endpoint_id` names
    // a row of the settings registry (which carries the headers too, so no
    // credential travels in this query string), `base_url` is the legacy typed
    // URL, and `side` falls back to the configured A/B endpoint. Passed per
    // stream so nothing extra has to be persisted on the run.
    const q = req.nextUrl.searchParams;
    const rawSide = q.get("side");
    const side = rawSide === "a" || rawSide === "b" ? rawSide : null;
    const rawEndpoint = q.get("endpoint_id");
    // Number(null) is 0, so the presence check has to come first — otherwise
    // every stream would claim to have picked endpoint 0.
    const endpointId =
      rawEndpoint && Number.isInteger(Number(rawEndpoint)) ? Number(rawEndpoint) : null;
    // The run itself is owned by the run registry, not by this connection:
    // reconnecting (after a refresh) attaches and replays, it does not re-run.
    return sseResponse((emit) => streamRun(id, emit, req.signal, { endpointId, baseUrl: q.get("base_url"), side }));
  } catch (e) {
    return errorResponse(e);
  }
}
