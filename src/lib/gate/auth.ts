import { timingSafeEqual } from "crypto";
import { getGateConfig } from "@/lib/config";

/**
 * Shared-secret check for the two gate endpoints. The app has no auth of its
 * own, so these are closed unless the gate is enabled AND `gate.secret` is set.
 */
export function gateAuthorized(provided: string | null): boolean {
  const cfg = getGateConfig();
  if (!cfg.enabled || !cfg.secret || !provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(cfg.secret);
  return a.length === b.length && timingSafeEqual(a, b);
}
