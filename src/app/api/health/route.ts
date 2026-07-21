import { getAppEnv } from "@/lib/config";
import { ok } from "@/lib/route-utils";

export const dynamic = "force-dynamic";

export async function GET() {
  return ok({ status: "ok", env: getAppEnv() });
}
