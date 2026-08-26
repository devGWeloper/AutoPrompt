'use client';

import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import type { RagasRunDetail, RagasRunSummary } from '@/lib/types';
import { CompareSummaryDashboard, SingleRunSummaryDashboard } from './RunSummaryDashboard';
import { CaseCompareTable } from './CompareTable';
import { CaseTable, EmptyState, fmtDt, runTargetLabel, scoredMetrics, sideLabel } from './shared';

/**
 * The most recent finished run of this kind, on the run screen while nothing is
 * running.
 *
 * It is drawn in exactly the shape a run leaves behind when it finishes —
 * dashboard, then a Results Detail card with the same header and the same case
 * table — and it opens already expanded. Coming back to the screen therefore
 * looks like the run that was just made is still sitting there, which is what it
 * is: labelling it '지난 실행' and folding it away made the screen feel emptied
 * between runs. The timestamp in the header is what says when it ran.
 */

type Kind = 'single' | 'compare';

/** The newest finished group of the requested kind. A/B pairs are matched by
 * AB_GROUP_ID; a pair with a missing half is not a comparison and is skipped. */
function pickLatest(runs: RagasRunSummary[], kind: Kind):
  | { kind: 'single'; run: RagasRunSummary }
  | { kind: 'compare'; a: RagasRunSummary; b: RagasRunSummary }
  | null {
  const done = runs.filter((r) => r.status === 'DONE' || r.status === 'CANCELLED');
  if (kind === 'single') {
    const hit = done.find((r) => r.ab_group_id == null);
    return hit ? { kind: 'single', run: hit } : null;
  }
  for (const r of done) {
    if (r.ab_group_id == null) continue;
    const members = runs
      .filter((x) => x.ab_group_id === r.ab_group_id)
      .sort((x, y) => x.ragas_run_id - y.ragas_run_id);
    if (members.length === 2) return { kind: 'compare', a: members[0], b: members[1] };
  }
  return null;
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={cn('transition-transform', open && 'rotate-90')}
    >
      <path d="M6 4l4 4-4 4" />
    </svg>
  );
}

/** What the run was aimed at, in the same words the run header uses. */
function targetLabel(r: RagasRunSummary): string {
  if (r.node_nm) return `${r.node_nm} · ${r.version_no ? `v${r.version_no}` : '—'}`;
  return runTargetLabel(r);
}

export default function LastRunPreview({ kind }: { kind: Kind }) {
  const [pick, setPick] = useState<ReturnType<typeof pickLatest>>(null);
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState(true);
  const [detailA, setDetailA] = useState<RagasRunDetail | null>(null);
  const [detailB, setDetailB] = useState<RagasRunDetail | null>(null);

  useEffect(() => {
    api
      .get<RagasRunSummary[]>('/ragas-runs')
      .then((runs) => setPick(pickLatest(runs, kind)))
      .catch(() => setPick(null))
      .finally(() => setLoaded(true));
  }, [kind]);

  // Fetched as soon as there is a run to fetch: the card is open from the start,
  // so waiting for a click would show an empty body under an open header.
  useEffect(() => {
    if (!pick) return;
    const ids = pick.kind === 'single' ? [pick.run.ragas_run_id] : [pick.a.ragas_run_id, pick.b.ragas_run_id];
    api.get<RagasRunDetail>(`/ragas-runs/${ids[0]}`).then(setDetailA).catch(() => setDetailA(null));
    if (ids[1] != null) api.get<RagasRunDetail>(`/ragas-runs/${ids[1]}`).then(setDetailB).catch(() => setDetailB(null));
  }, [pick]);

  if (!loaded) return null;
  // Nothing has ever run — the sample is the run the user is about to make.
  if (!pick) {
    return (
      <Card tone="muted">
        <EmptyState label={kind === 'single' ? 'Run evaluation' : 'Run comparison'} />
      </Card>
    );
  }

  const head = pick.kind === 'single' ? pick.run : pick.a;
  const labelA = pick.kind === 'compare' ? pick.a.version_no ?? '' : '';
  const labelB = pick.kind === 'compare' ? pick.b.version_no ?? '' : '';
  const paired = pick.kind === 'compare' && detailB !== null;
  const ready = detailA !== null && (pick.kind === 'single' || paired);

  return (
    <div className="space-y-4">
      {open && ready && detailA && (
        paired && detailB ? (
          <CompareSummaryDashboard detailA={detailA} detailB={detailB} labelA={labelA} labelB={labelB} />
        ) : (
          scoredMetrics(detailA).length > 0 && <SingleRunSummaryDashboard detail={detailA} />
        )
      )}
      <Card className="overflow-hidden">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className={cn(
            'flex w-full flex-wrap items-center gap-2 px-4 py-3 text-left text-xs text-muted transition-colors hover:bg-surface-2',
            open && 'border-b border-line',
          )}
        >
          <span className="text-muted"><Chevron open={open} /></span>
          <h3 className="mr-1 text-sm font-semibold text-ink">Results Detail</h3>
          <Badge tone={head.status === 'DONE' ? 'ok' : 'neutral'} dot>{head.status}</Badge>
          <span className="truncate text-body-sm text-ink">
            {pick.kind === 'compare'
              ? `${sideLabel(labelA)} vs ${sideLabel(labelB)}`
              : head.is_manual
              ? head.first_question ?? '—'
              : targetLabel(head)}
          </span>
          {head.dataset_nm && !head.is_manual && (
            <span className="truncate font-mono text-caption-mono text-muted">{head.dataset_nm}</span>
          )}
          <span className="ml-auto shrink-0 font-mono text-caption-mono text-muted-soft" title={head.created_dt}>
            {fmtDt(head.created_dt)}
          </span>
        </button>

        {open && (
          <div className="p-4">
            {!ready || !detailA ? (
              <div className="py-6 text-center text-body-sm text-muted-soft">…</div>
            ) : (
              <div className="overflow-hidden rounded-sm border border-line bg-surface">
                {paired && detailB ? (
                  <CaseCompareTable
                    detailA={detailA}
                    detailB={detailB}
                    labelA={labelA}
                    labelB={labelB}
                    defaultAllOpen={false}
                  />
                ) : (
                  <CaseTable detail={detailA} defaultAllOpen={false} />
                )}
              </div>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
