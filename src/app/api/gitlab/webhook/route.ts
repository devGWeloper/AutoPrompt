import { gateAuthorized } from "@/lib/gate/auth";
import { triggerGate } from "@/lib/gate/tick";
import { ok } from "@/lib/route-utils";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GitLab "Merge request events" webhook. The payload is NOT trusted for
 * anything — it only nudges the gate to run now instead of at the next tick;
 * every decision is made from fresh GitLab API reads. Returns immediately.
 */
export async function POST(req: Request) {
  if (!gateAuthorized(req.headers.get("x-gitlab-token"))) {
    return NextResponse.json({ detail: "forbidden" }, { status: 403 });
  }
  let kind: unknown = null;
  try {
    kind = ((await req.json()) as { object_kind?: unknown } | null)?.object_kind;
  } catch {
    /* an unreadable body is just not a merge_request event */
  }
  if (kind !== "merge_request") return ok({ triggered: false, reason: "ignored event" });
  return ok({ triggered: triggerGate("webhook") });
}
