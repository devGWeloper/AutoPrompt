import { getAppEnv, getEmbeddingConfig, getLlmConfig, getRagasEngineMode, resolveRagasEngine } from "@/lib/config";
import { dbConfigured } from "@/lib/db";
import { ok } from "@/lib/route-utils";

export const dynamic = "force-dynamic";

export async function GET() {
  // `ragas` reports what a run started right now would actually use. Config is
  // read from config.yml on the server, so this endpoint is the only way to see
  // it without shell access — hence endpoint/model are echoed back (never keys).
  const llm = getLlmConfig();
  const emb = getEmbeddingConfig();
  return ok({
    status: "ok",
    env: getAppEnv(),
    dbConnected: dbConfigured(),
    ragas: {
      mode: getRagasEngineMode(),
      engine: resolveRagasEngine(),
      llm: { endpoint: llm.endpoint, model: llm.model, apiKeySet: llm.apiKey !== "" },
      embedding: { endpoint: emb.endpoint, model: emb.model, apiKeySet: emb.apiKey !== "" },
    },
  });
}
