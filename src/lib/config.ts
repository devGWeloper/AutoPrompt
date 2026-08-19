import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import { logger } from "./logger";

export type AppEnv = "dev" | "prd";

/** Oracle connection settings for the PTX-owned DB (PTX_* tables). */
export interface DbConfig {
  user: string;
  password: string;
  connectString: string;
}

/** One request header the endpoint wants. A slot with a blank `name` is unused
 * and is skipped, so empty slots can sit in the config as placeholders. */
export interface AgentHeader {
  name: string;
  value: string;
}

/** One endpoint the flow can call. A and B are configured independently —
 * different URL, different header names AND values. There is no shared fallback
 * between them; A is simply the default. */
export interface AgentSideConfig {
  url: string;
  /** Sent as-is. `Content-Type: application/json` is added by the caller and is
   * not listed here. */
  headers: AgentHeader[];
}

/** External chat / super-agent integration (flow-level RAGAS answer generation). */
export interface AgentConfig {
  /** "external" routes answer generation to the real chat endpoint; "stub" returns a placeholder. */
  runMode: "external" | "stub";
  /** Caller's employee number. Goes out in the BODY (`user_id` and
   * `CUBE_USER_ID`), not as a header — headers are per-side and explicit. */
  userId: string;
  /** How long one endpoint call may take before it is aborted. From
   * `agent.timeoutSec` (default 90s) — a flow that fans out to several nodes is
   * slow, so this is generous on purpose. */
  timeoutMs: number;
  /** Side A. Also the default: a run that names no side calls A. */
  a: AgentSideConfig;
  /** Side B — the comparison target. */
  b: AgentSideConfig;
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

interface RawSide {
  url?: string;
  headers?: { name?: string; value?: string }[];
}

interface RawConfig {
  db?: Partial<DbConfig>;
  agent?: {
    runMode?: string;
    userId?: string;
    timeoutSec?: number;
    a?: RawSide;
    b?: RawSide;
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

function normalizeSide(v: RawSide | undefined): AgentSideConfig {
  const headers: AgentHeader[] = [];
  for (const h of Array.isArray(v?.headers) ? v!.headers : []) {
    const name = String(h?.name ?? "").trim();
    // An empty slot is a placeholder waiting to be filled in, not a header.
    if (!name) continue;
    headers.push({ name, value: String(h?.value ?? "").trim() });
  }
  return { url: (v?.url ?? "").trim().replace(/\/+$/, ""), headers };
}

const DEFAULT_TIMEOUT_SEC = 90;

/** Seconds → ms. A missing, non-numeric or non-positive value falls back to the
 * default rather than producing a call that aborts instantly. */
function normalizeTimeout(v: unknown): number {
  const sec = Number(v);
  return Number.isFinite(sec) && sec > 0 ? Math.round(sec * 1000) : DEFAULT_TIMEOUT_SEC * 1000;
}

function normalizeAgent(raw: RawConfig | null): AgentConfig {
  const a = raw?.agent ?? {};
  return {
    runMode: (a.runMode ?? "").trim().toLowerCase() === "external" ? "external" : "stub",
    userId: (a.userId ?? "pm-test").trim() || "pm-test",
    timeoutMs: normalizeTimeout(a.timeoutSec),
    a: normalizeSide(a.a),
    b: normalizeSide(a.b),
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
    agentTimeoutSec: cached.agent.timeoutMs / 1000,
    agentUrlA: cached.agent.a.url,
    agentUrlB: cached.agent.b.url,
    // Names only — the values are credentials and must not reach the log.
    agentHeadersA: cached.agent.a.headers.map((h) => h.name),
    agentHeadersB: cached.agent.b.headers.map((h) => h.name),
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

/** The endpoint a run talks to. Anything that does not name a side gets A —
 * A *is* the default, so there is no separate shared URL to fall back to. */
export function getFlowSide(side?: "a" | "b" | null): AgentSideConfig {
  const a = loadConfig().agent;
  return side === "b" ? a.b : a.a;
}

/** That side's URL. '' when it is not configured. */
export function getFlowBaseUrl(side?: "a" | "b" | null): string {
  return getFlowSide(side).url;
}

/** That side's configured headers (Content-Type not included). */
export function getFlowHeaders(side?: "a" | "b" | null): AgentHeader[] {
  return getFlowSide(side).headers;
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
