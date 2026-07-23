import { getAppEnv } from "@/lib/config";
import { dbConfigured } from "@/lib/db";
import { ok } from "@/lib/route-utils";

export const dynamic = "force-dynamic";

export async function GET() {
  return ok({
    status: "ok",
    env: getAppEnv(),
    dbConnected: dbConfigured(),
  });
}
