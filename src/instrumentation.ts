/**
 * Next.js instrumentation hook — runs once when the server process starts.
 * Starts the MR gate scheduler (docs/gate-design.md). Node runtime only: the
 * gate pulls in `oracledb`, which must not reach the Edge bundle.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startGateScheduler } = await import("./lib/gate/scheduler");
    startGateScheduler();
  }
}
