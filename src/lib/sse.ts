import type { Emit } from "@/lib/services/flow";
import type { RunEvent } from "@/lib/types";
import { logger } from "./logger";

/**
 * Build a Server-Sent Events response that drives ``run`` (the RAGAS execution
 * loop), forwarding each emitted event as an SSE ``data:`` frame. Replaces the
 * old WebSocket streaming — the whole run happens inside this stream.
 */
export function sseResponse(run: (emit: Emit) => Promise<void>): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const emit = (event: RunEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          closed = true; // client disconnected
        }
      };
      try {
        await run(emit);
      } catch (e) {
        logger.error("sse run failed", { err: String(e) });
      } finally {
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
