'use client';

import { api } from '@/lib/api';
import { saveActiveRun, type ActiveCompareRun, type ActiveSingleRun } from '@/lib/activeRun';
import type { Endpoint, RagasRunDetail } from '@/lib/types';

/**
 * Fired when a re-test run has been created and saved as the tab's active run.
 * The page switches to that tab; a mounted run panel attaches to the run, and
 * one that is not mounted yet resumes it from the saved active run on mount.
 */
export const SINGLE_ATTACH_EVENT = 'ptx:single-attach';
export const COMPARE_ATTACH_EVENT = 'ptx:compare-attach';

function mismatchIds(d: RagasRunDetail | null | undefined): number[] {
  return (d?.results ?? []).filter((r) => r.exact_match === 0 && r.case_id != null).map((r) => r.case_id!);
}

/** 불일치 cases a re-test would cover. With two runs, either side's — the same
 * set the server picks for an A/B re-test. */
export function mismatchCount(a: RagasRunDetail, b?: RagasRunDetail | null): number {
  return new Set([...mismatchIds(a), ...mismatchIds(b)]).size;
}

/** The registry entry a run called, so the re-test goes out the same way. Checked
 * before anything is created: a run that cannot be sent the same way is refused
 * without leaving a PENDING row behind. */
function endpointOf(d: RagasRunDetail, endpoints: Endpoint[]): Endpoint {
  const ep =
    endpoints.find((e) => !!d.endpoint_nm && e.endpoint_nm === d.endpoint_nm) ??
    endpoints.find((e) => !!d.endpoint_url && e.endpoint_url === d.endpoint_url);
  if (!ep) {
    throw new Error(
      `이 실행이 부른 API${d.endpoint_nm ? ` '${d.endpoint_nm}'` : ''}를 설정에서 찾을 수 없어 같은 조건으로 다시 돌릴 수 없습니다`,
    );
  }
  return ep;
}

export async function startMismatchRerun(d: RagasRunDetail, endpoints: Endpoint[]): Promise<ActiveSingleRun> {
  const ep = endpointOf(d, endpoints);
  const r = await api.post<{ ragas_run_id: number }>(`/ragas-runs/${d.ragas_run_id}/rerun`, {});
  const active: ActiveSingleRun = {
    runId: r.ragas_run_id,
    endpointId: ep.endpoint_id,
    baseUrl: null,
    scoreOn: d.metrics !== '[]',
    nodeNm: d.node_nm ?? '',
    verLabel: `#${d.ragas_run_id} 불일치 재테스트`,
  };
  saveActiveRun('single', active);
  return active;
}

export async function startAbMismatchRerun(
  a: RagasRunDetail,
  b: RagasRunDetail,
  endpoints: Endpoint[],
): Promise<ActiveCompareRun> {
  if (a.ab_group_id == null) throw new Error('Compare 실행이 아닙니다');
  const epA = endpointOf(a, endpoints);
  const epB = endpointOf(b, endpoints);
  const r = await api.post<{ ragas_run_a_id: number; ragas_run_b_id: number }>(
    `/ragas-runs/ab/${a.ab_group_id}/rerun`,
    {},
  );
  const active: ActiveCompareRun = {
    runIdA: r.ragas_run_a_id,
    runIdB: r.ragas_run_b_id,
    // Two different APIs is an endpoint comparison; one API is shared by both.
    side: epA.endpoint_id !== epB.endpoint_id,
    endpointA: epA.endpoint_id,
    endpointB: epB.endpoint_id,
    urlA: null,
    urlB: null,
    labelA: a.version_no ?? '',
    labelB: b.version_no ?? '',
    scoreOn: a.metrics !== '[]',
  };
  saveActiveRun('compare', active);
  return active;
}
