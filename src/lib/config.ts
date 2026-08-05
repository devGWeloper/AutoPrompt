import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import { logger } from "./logger";

export type AppEnv = "dev" | "prd";

/** Oracle connection settings for the PM-owned DB (PM_* tables). */
export interface DbConfig {
  user: string;
  password: string;
  connectString: string;
}

/** Request format an endpoint speaks: the plain chat body ({message, …}) or the
 * gaia gateway body ({query, gaia_*, request_url, …}). */
export type AgentProtocol = "chat" | "gaia";

/** External chat / super-agent integration (flow-level RAGAS answer generation). */
export interface AgentConfig {
  /** "external" routes answer generation to the real chat endpoint; "stub" returns a placeholder. */
  runMode: "external" | "stub";
  /** Shared default endpoint; used when the per-side URL is empty. */
  baseUrl: string;
  /** Compare side A endpoint (falls back to baseUrl). */
  baseUrlA: string;
  /** Compare side B endpoint — the two versions currently live behind
   * different URLs, so B is configured separately (falls back to baseUrl). */
  baseUrlB: string;
  /** Shared default request format; used when the per-side value is empty. */
  protocol: AgentProtocol;
  /** Per-side request format ("" → use `protocol`). The A/B endpoints may speak
   * different protocols while the two versions live behind different URLs. */
  protocolA: AgentProtocol | "";
  protocolB: AgentProtocol | "";
  /** Shared default auth key; used when the per-side key is empty. */
  authKey: string;
  /** Per-side auth key — the A/B endpoints are different services and may each
   * want their own credential (falls back to authKey). */
  authKeyA: string;
  authKeyB: string;
  userId: string;
  authHeader: string;
  userHeader: string;
}

/** OpenAI-compatible endpoint (base URL + key + model). Used for the RAGAS
 * judge LLM and, separately, the embedding model. `endpoint` empty → not set. */
export interface OpenAiCompatConfig {
  endpoint: string;
  apiKey: string;
  model: string;
}

export type RagasEngineMode = "auto" | "fallback" | "ragas";

interface AppConfig {
  appEnv: AppEnv;
  /** null when the DB block is incomplete (treated as "not connected"). */
  db: DbConfig | null;
  agent: AgentConfig;
  /** RAGAS judge LLM (OpenAI-compatible). endpoint empty → LLM scoring disabled. */
  llm: OpenAiCompatConfig;
  /** Embedding model (OpenAI-compatible). Needed for answer_relevancy / semantic
   * part of answer_correctness. endpoint empty → those degrade to null/lexical. */
  embedding: OpenAiCompatConfig;
  /** auto (LLM engine when llm configured, else fallback) | fallback | ragas. */
  ragasEngine: RagasEngineMode;
  sourceFile: string | null;
}

interface RawConfig {
  db?: Partial<DbConfig>;
  agent?: Partial<Omit<AgentConfig, "runMode" | "protocol" | "protocolA" | "protocolB">> & {
    runMode?: string;
    protocol?: string;
    protocolA?: string;
    protocolB?: string;
  };
  llm?: Partial<OpenAiCompatConfig>;
  embedding?: Partial<OpenAiCompatConfig>;
  ragasEngine?: string;
}

const DEV_FILE = "config.dev.yml";
const PRD_FILE = "config.yml";

let cached: AppConfig | null = null;

function readYaml(file: string): RawConfig | null {
  try {
    const raw = fs.readFileSync(file, "utf8");
    const parsed = yaml.load(raw);
    return (parsed && typeof parsed === "object" ? parsed : {}) as RawConfig;
  } catch (e) {
    logger.error("config read failed", { file, err: String(e) });
    return null;
  }
}

function normalizeDb(raw: RawConfig | null): DbConfig | null {
  const v = raw?.db;
  if (!v) return null;
  const user = (v.user ?? "").trim();
  const password = (v.password ?? "").trim();
  const connectString = (v.connectString ?? "").trim();
  if (!user || !password || !connectString) return null;
  return { user, password, connectString };
}

/** "gaia" (and the older jsonrpc/rpc/a2a spellings) → gaia; empty → `fallback`
 * (so a blank per-side value defers to the shared setting); else → chat. */
function normalizeProtocol<T extends AgentProtocol | "">(v: unknown, fallback: T): AgentProtocol | T {
  const m = String(v ?? "").trim().toLowerCase();
  if (!m) return fallback;
  return m === "gaia" || m === "jsonrpc" || m === "rpc" || m === "a2a" ? "gaia" : "chat";
}

function normalizeAgent(raw: RawConfig | null): AgentConfig {
  const a = raw?.agent ?? {};
  const runMode = (a.runMode ?? "").trim().toLowerCase() === "external" ? "external" : "stub";
  return {
    runMode,
    baseUrl: (a.baseUrl ?? "").trim(),
    baseUrlA: (a.baseUrlA ?? "").trim(),
    baseUrlB: (a.baseUrlB ?? "").trim(),
    protocol: normalizeProtocol(a.protocol, "chat"),
    protocolA: normalizeProtocol(a.protocolA, ""),
    protocolB: normalizeProtocol(a.protocolB, ""),
    authKey: (a.authKey ?? "").trim(),
    authKeyA: (a.authKeyA ?? "").trim(),
    authKeyB: (a.authKeyB ?? "").trim(),
    userId: (a.userId ?? "pm-test").trim() || "pm-test",
    authHeader: (a.authHeader ?? "auth-key").trim() || "auth-key",
    userHeader: (a.userHeader ?? "user-id").trim() || "user-id",
  };
}

function normalizeOpenAi(raw: Partial<OpenAiCompatConfig> | undefined): OpenAiCompatConfig {
  return {
    endpoint: (raw?.endpoint ?? "").trim().replace(/\/+$/, ""),
    apiKey: (raw?.apiKey ?? "").trim(),
    model: (raw?.model ?? "").trim(),
  };
}

function normalizeRagasEngine(v: string | undefined): RagasEngineMode {
  const m = (v ?? "").trim().toLowerCase();
  return m === "fallback" || m === "ragas" ? m : "auto";
}

export function loadConfig(): AppConfig {
  if (cached) return cached;
  const root = process.cwd();
  const devPath = path.join(root, DEV_FILE);
  const prdPath = path.join(root, PRD_FILE);

  let appEnv: AppEnv;
  let sourceFile: string | null;
  let raw: RawConfig | null;

  if (fs.existsSync(devPath)) {
    appEnv = "dev";
    sourceFile = devPath;
    raw = readYaml(devPath);
  } else if (fs.existsSync(prdPath)) {
    appEnv = "prd";
    sourceFile = prdPath;
    raw = readYaml(prdPath);
  } else {
    appEnv = "dev";
    sourceFile = null;
    raw = null;
    logger.warn("no config file found", { tried: [devPath, prdPath] });
  }

  cached = {
    appEnv,
    db: normalizeDb(raw),
    agent: normalizeAgent(raw),
    llm: normalizeOpenAi(raw?.llm),
    embedding: normalizeOpenAi(raw?.embedding),
    ragasEngine: normalizeRagasEngine(raw?.ragasEngine),
    sourceFile,
  };
  logger.info("config loaded", {
    appEnv: cached.appEnv,
    sourceFile: cached.sourceFile,
    dbConfigured: cached.db !== null,
    runMode: cached.agent.runMode,
    agentBaseUrlA: cached.agent.baseUrlA || cached.agent.baseUrl,
    agentBaseUrlB: cached.agent.baseUrlB || cached.agent.baseUrl,
    agentProtocolA: cached.agent.protocolA || cached.agent.protocol,
    agentProtocolB: cached.agent.protocolB || cached.agent.protocol,
    ragasEngine: cached.ragasEngine,
    llmConfigured: cached.llm.endpoint !== "",
    embeddingConfigured: cached.embedding.endpoint !== "",
  });
  return cached;
}

export function getAppEnv(): AppEnv {
  return loadConfig().appEnv;
}

export function getDbConfig(): DbConfig | null {
  return loadConfig().db;
}

export function getAgentConfig(): AgentConfig {
  return loadConfig().agent;
}

/** Which chat endpoint a run should call: the A/B side URL when configured,
 * otherwise the shared default. '' when nothing is configured. */
export function getFlowBaseUrl(side?: "a" | "b" | null): string {
  const a = loadConfig().agent;
  const perSide = side === "b" ? a.baseUrlB : side === "a" ? a.baseUrlA : "";
  return perSide || a.baseUrl;
}

/** Which request format that side's endpoint speaks (per-side, else shared). */
export function getFlowProtocol(side?: "a" | "b" | null): AgentProtocol {
  const a = loadConfig().agent;
  const perSide = side === "b" ? a.protocolB : side === "a" ? a.protocolA : "";
  return perSide || a.protocol;
}

/** Auth key for that side's endpoint (per-side, else shared). '' when unset. */
export function getFlowAuthKey(side?: "a" | "b" | null): string {
  const a = loadConfig().agent;
  const perSide = side === "b" ? a.authKeyB : side === "a" ? a.authKeyA : "";
  return perSide || a.authKey;
}

export function getLlmConfig(): OpenAiCompatConfig {
  return loadConfig().llm;
}

export function getEmbeddingConfig(): OpenAiCompatConfig {
  return loadConfig().embedding;
}

export function getRagasEngineMode(): RagasEngineMode {
  return loadConfig().ragasEngine;
}

/**
 * Resolve which scorer to use, mirroring the old backend get_scorer():
 * - "fallback" → always the lexical fallback
 * - "auto"/"ragas" → the LLM engine when an LLM endpoint is configured, else fallback
 */
export function resolveRagasEngine(): "RAGAS" | "FALLBACK" {
  const c = loadConfig();
  if (c.ragasEngine === "fallback") return "FALLBACK";
  return c.llm.endpoint !== "" ? "RAGAS" : "FALLBACK";
}
