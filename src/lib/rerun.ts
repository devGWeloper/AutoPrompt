'use client';

import { api } from '@/lib/api';
import { saveActiveRun, type ActiveSingleRun } from '@/lib/activeRun';
import type { Endpoint, RagasRunDetail } from '@/lib/types';

/** Fired when a Single run was started outside the Single tab (the records
 * drawer). The page switches tabs; a mounted Single panel attaches to it, and
 * one that is not mounted yet resumes it from the saved active run. */
export const SINGLE_ATTACH_EVENT = 'ptx:single-attach';

/** 불일치 cases a re-test would cover — only those still tied to a case. */
export function mismatchCount(d: RagasRunDetail): number {
  return d.results.filter((r) => r.exact_match === 0 && r.case_id != null).length;
}

/**
 * Create the re-test run and record it as this tab's active Single run. The
 * endpoint is resolved first, from the registry entry the source run named, so
 * a run that cannot be sent the same way is refused before any row is written.
 */
export async function startMismatchRerun(d: RagasRunDetail, endpoints: Endpoint[]): Promise<ActiveSingleRun> {
  const ep =
    endpoints.find((e) => !!d.endpoint_nm && e.endpoint_nm === d.endpoint_nm) ??
    endpoints.find((e) => !!d.endpoint_url && e.endpoint_url === d.endpoint_url);
  if (!ep) {
    throw new Error(
      `이 실행이 부른 API${d.endpoint_nm ? ` '${d.endpoint_nm}'` : ''}를 설정에서 찾을 수 없어 같은 조건으로 다시 돌릴 수 없습니다`,
    );
  }
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
