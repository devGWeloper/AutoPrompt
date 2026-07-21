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

/** External chat / super-agent integration (flow-level RAGAS answer generation). */
export interface AgentConfig {
  /** "external" routes answer generation to the real chat endpoint; "stub" returns a placeholder. */
  runMode: "external" | "stub";
  baseUrl: string;
  authKey: string;
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
  agent?: Partial<AgentConfig> & { runMode?: string };
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

function normalizeAgent(raw: RawConfig | null): AgentConfig {
  const a = raw?.agent ?? {};
  const runMode = (a.runMode ?? "").trim().toLowerCase() === "external" ? "external" : "stub";
  return {
    runMode,
    baseUrl: (a.baseUrl ?? "").trim(),
    authKey: (a.authKey ?? "").trim(),
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
