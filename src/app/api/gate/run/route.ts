import { gateAuthorized } from "@/lib/gate/auth";
import { runGateTick } from "@/lib/gate/tick";
import { errorResponse } from "@/lib/http";
import { ok } from "@/lib/route-utils";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Operator-triggered gate run. Waits for the tick and returns its summary. */
export async function POST(req: Request) {
  if (!gateAuthorized(req.headers.get("x-gate-secret"))) {
    return NextResponse.json({ detail: "forbidden" }, { status: 403 });
  }
  try {
    return ok(await runGateTick("manual"));
  } catch (e) {
    return errorResponse(e);
  }
}
