'use client';

import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import type { RagasRunDetail, RagasRunSummary } from '@/lib/types';
import { CompareSummaryDashboard, SingleRunSummaryDashboard } from './RunSummaryDashboard';
import { CaseCompareTable } from './CompareTable';
import { CaseTable, EmptyState, fmtDt, scoredMetrics, sideLabel } from './shared';

/**
 * The most recent finished run of this kind, shown on the run screen while
 * nothing is running.
 *
 * It stands in for the paragraph that used to explain what a run produces: the
 * answer to "what do I get out of this" is one real result, with its own scores
 * and cases, rather than a description of one. Opening it expands the same
 * tables a live run ends up showing, so the screen never changes shape.
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
  return '엔드포인트';
}

export default function LastRunPreview({ kind }: { kind: Kind }) {
  const [pick, setPick] = useState<ReturnType<typeof pickLatest>>(null);
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState(false);
  const [detailA, setDetailA] = useState<RagasRunDetail | null>(null);
  const [detailB, setDetailB] = useState<RagasRunDetail | null>(null);

  useEffect(() => {
    api
      .get<RagasRunSummary[]>('/ragas-runs')
      .then((runs) => setPick(pickLatest(runs, kind)))
      .catch(() => setPick(null))
      .finally(() => setLoaded(true));
  }, [kind]);

  // Details are fetched only once the card is opened: the list alone carries
  // enough to draw the header, and an unopened preview should cost nothing.
  useEffect(() => {
    if (!open || !pick) return;
    const ids = pick.kind === 'single' ? [pick.run.ragas_run_id] : [pick.a.ragas_run_id, pick.b.ragas_run_id];
    api.get<RagasRunDetail>(`/ragas-runs/${ids[0]}`).then(setDetailA).catch(() => setDetailA(null));
    if (ids[1] != null) api.get<RagasRunDetail>(`/ragas-runs/${ids[1]}`).then(setDetailB).catch(() => setDetailB(null));
  }, [open, pick]);

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

  return (
    <Card tone="muted" className="overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full flex-wrap items-center gap-2 px-4 py-3 text-left transition-colors hover:bg-surface-3"
      >
        <span className="text-muted"><Chevron open={open} /></span>
        <span className="eyebrow">지난 실행</span>
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
        <div className="border-t border-line bg-surface p-4">
          {!detailA || (pick.kind === 'compare' && !detailB) ? (
            <div className="py-6 text-center text-body-sm text-muted-soft">…</div>
          ) : pick.kind === 'compare' && detailB ? (
            <div className="space-y-4">
              <CompareSummaryDashboard detailA={detailA} detailB={detailB} labelA={labelA} labelB={labelB} />
              <div className="overflow-hidden rounded-sm border border-line bg-surface">
                <CaseCompareTable
                  detailA={detailA}
                  detailB={detailB}
                  labelA={labelA}
                  labelB={labelB}
                  defaultAllOpen={false}
                />
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {scoredMetrics(detailA).length > 0 && <SingleRunSummaryDashboard detail={detailA} />}
              <div className="overflow-hidden rounded-sm border border-line bg-surface">
                <CaseTable detail={detailA} defaultAllOpen={false} />
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
