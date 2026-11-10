import type { GateConfig, GateProjectConfig } from "@/lib/config";
import { fetchWithTimeout } from "@/lib/http";

/** A failed GitLab call. The message carries the HTTP status and a short slice
 * of the body — never the token or the request headers. */
export class GitlabError extends Error {
  status: number | null;
  constructor(message: string, status: number | null) {
    super(message);
    this.name = "GitlabError";
    this.status = status;
  }
}

export interface MrSummary {
  iid: number;
  sha: string;
  source_branch?: string;
  title?: string;
  updated_at?: string;
}

export interface MrDetail extends MrSummary {
  draft?: boolean;
  work_in_progress?: boolean;
  has_conflicts?: boolean;
}

export interface GitlabNote {
  id: number;
  body: string;
  author?: { id?: number };
}

type Query = Record<string, string | number>;

async function call<T>(
  cfg: GateConfig,
  method: "GET" | "POST",
  path: string,
  opts: { query?: Query; body?: unknown } = {},
): Promise<T> {
  const qs = opts.query
    ? "?" + new URLSearchParams(Object.entries(opts.query).map(([k, v]) => [k, String(v)])).toString()
    : "";
  const url = `${cfg.baseUrl}/api/v4${path}${qs}`;
  const label = `${method} ${path}`;
  let res: Response;
  try {
    res = await fetchWithTimeout(
      url,
      {
        method,
        headers: {
          "PRIVATE-TOKEN": cfg.token,
          ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
      },
      cfg.timeoutMs,
    );
  } catch (e) {
    const aborted = e instanceof Error && e.name === "AbortError";
    throw new GitlabError(`${label} — ${aborted ? "timeout" : "network error"}`, null);
  }
  const text = await res.text();
  if (!res.ok) {
    throw new GitlabError(`${label} — HTTP ${res.status} ${text.slice(0, 200)}`, res.status);
  }
  if (!text) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new GitlabError(`${label} — response is not JSON`, res.status);
  }
}

const pid = (p: GateProjectConfig) => encodeURIComponent(p.gitlabProjectId);

/** The bot account behind the token (to recognise its own approvals/comments). */
export function getBotUser(cfg: GateConfig): Promise<{ id: number; username?: string }> {
  return call(cfg, "GET", "/user");
}

export const OPEN_MR_PAGE = 100;

/** Open MRs into the target branch — from any source branch unless the project
 * config pins one. Newest-updated first; one page (OPEN_MR_PAGE). */
export function listOpenMrs(cfg: GateConfig, p: GateProjectConfig): Promise<MrSummary[]> {
  return call(cfg, "GET", `/projects/${pid(p)}/merge_requests`, {
    query: {
      state: "opened",
      target_branch: p.targetBranch,
      ...(p.sourceBranch ? { source_branch: p.sourceBranch } : {}),
      order_by: "updated_at",
      sort: "desc",
      per_page: OPEN_MR_PAGE,
    },
  });
}

export function getMr(cfg: GateConfig, p: GateProjectConfig, iid: number): Promise<MrDetail> {
  return call(cfg, "GET", `/projects/${pid(p)}/merge_requests/${iid}`);
}

export function getCommit(cfg: GateConfig, p: GateProjectConfig, sha: string): Promise<{ committed_date: string }> {
  return call(cfg, "GET", `/projects/${pid(p)}/repository/commits/${encodeURIComponent(sha)}`);
}

export function getApprovals(
  cfg: GateConfig,
  p: GateProjectConfig,
  iid: number,
): Promise<{ approved_by?: { user?: { id?: number } }[] }> {
  return call(cfg, "GET", `/projects/${pid(p)}/merge_requests/${iid}/approvals`);
}

/** Approve. `sha` pins the approval to the head that was evaluated — GitLab
 * refuses (409) when the head has moved on, and the next tick re-evaluates. */
export function approveMr(cfg: GateConfig, p: GateProjectConfig, iid: number, sha: string): Promise<unknown> {
  return call(cfg, "POST", `/projects/${pid(p)}/merge_requests/${iid}/approve`, { body: { sha } });
}

export function listNotes(cfg: GateConfig, p: GateProjectConfig, iid: number): Promise<GitlabNote[]> {
  return call(cfg, "GET", `/projects/${pid(p)}/merge_requests/${iid}/notes`, {
    query: { order_by: "created_at", sort: "desc", per_page: 20 },
  });
}

export function postNote(cfg: GateConfig, p: GateProjectConfig, iid: number, body: string): Promise<unknown> {
  return call(cfg, "POST", `/projects/${pid(p)}/merge_requests/${iid}/notes`, { body: { body } });
}
