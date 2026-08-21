import {
  getAgentConfig,
  getAppEnv,
  getEmbeddingConfig,
  getLlmConfig,
  getRagasEngineMode,
  resolveRagasEngine,
} from "@/lib/config";
import { dbConfigured } from "@/lib/db";
import { ok } from "@/lib/route-utils";

export const dynamic = "force-dynamic";

export async function GET() {
  // `ragas` reports what a run started right now would actually use. Config is
  // read from config.yml on the server, so this endpoint is the only way to see
  // it without shell access — hence endpoint/model are echoed back (never keys).
  const llm = getLlmConfig();
  const emb = getEmbeddingConfig();
  const agent = getAgentConfig();
  return ok({
    status: "ok",
    env: getAppEnv(),
    dbConnected: dbConfigured(),
    // What a call falls back to when the run form leaves a box empty. The
    // employee number is not a credential; the headers are, and they are not here.
    agent: {
      runMode: agent.runMode,
      userId: agent.userId,
      timeoutSec: Math.round(agent.timeoutMs / 1000),
    },
    ragas: {
      mode: getRagasEngineMode(),
      engine: resolveRagasEngine(),
      llm: { endpoint: llm.endpoint, model: llm.model, apiKeySet: llm.apiKey !== "" },
      embedding: { endpoint: emb.endpoint, model: emb.model, apiKeySet: emb.apiKey !== "" },
    },
  });
}
