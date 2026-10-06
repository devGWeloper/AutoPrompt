'use client';

import { useEffect, useState } from 'react';
import AppShell from '@/components/ui/AppShell';
import PageHeader from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { SHELL } from '@/lib/layout';
import type { RagasRunDetail } from '@/lib/types';
import {
  CartBrowse,
  CartRail,
  CartRailFolded,
  useCart,
  useRecentRuns,
} from '@/components/ragas/RunCart';
import { CaseTable, errText, folderLabel, PendingHint, useEndpoints, useFlowDatasets } from '@/components/ragas/shared';
import { SingleRunSummaryDashboard } from '@/components/ragas/RunSummaryDashboard';

/**
 * 프로토타입 (O안) — 담아서 한 번에, 바구니와 기록은 왼쪽 레일.
 *
 * 임시 페이지다. `/proto/cart` 로만 열리고 사이드바에는 없다. 단일 실행 패널의
 * 'O · 바구니' 스킨과 같은 조각(`RunCart`)을 쓰지만, 이쪽은 실행을 붙이지 않고
 * 배치만 본다 — 실제로 돌려 보려면 단일 실행 화면에서 토글하면 된다.
 */

/** 오른쪽 본문의 '결과' 모드. 기록에서 고른 실행을 그 실행이 끝났을 때와 같은
 * 모양으로 — 대시보드 + 케이스 표 — 보여 준다. */
function ResultPane({ runId, title, onBack }: { runId: number; title: string; onBack: () => void }) {
  const [detail, setDetail] = useState<RagasRunDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setDetail(null);
    setError(null);
    api
      .get<RagasRunDetail>(`/ragas-runs/${runId}`)
      .then((d) => { if (alive) setDetail(d); })
      .catch((e) => { if (alive) setError(errText(e)); });
    return () => { alive = false; };
  }, [runId]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2.5 border-b border-line px-3.5 py-2.5">
        <Button variant="ghost" size="sm" onClick={onBack} className="shrink-0">← 데이터 고르기</Button>
        <span className="min-w-0 flex-1 truncate text-body-sm font-semibold text-ink">
          {title}{detail ? ` · ${detail.results.length}건` : ''}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3.5">
        {error && <p className="text-sm text-bad">{error}</p>}
        {!detail && !error && <PendingHint label="결과 읽는 중…" />}
        {detail && (
          <>
            <SingleRunSummaryDashboard detail={detail} />
            <CaseTable detail={detail} bordered />
          </>
        )}
      </div>
    </div>
  );
}

export default function ProtoCartPage() {
  const { datasets } = useFlowDatasets();
  const endpoints = useEndpoints();
  const cart = useCart();
  const { runs } = useRecentRuns();
  const [openRunId, setOpenRunId] = useState<number | null>(null);
  const [railOpen, setRailOpen] = useState(true);

  const openRun = runs.find((r) => r.ragas_run_id === openRunId);
  const openRunTitle = openRun
    ? `${openRun.dataset_nm ?? '직접 입력'}${openRun.case_type ? ` · ${folderLabel(openRun.case_type)}` : ''}`
    : `실행 ${openRunId}`;

  return (
    <AppShell section="single">
      <div className={cn(SHELL, 'flex h-full min-h-0 flex-col px-8 py-7')}>
        <PageHeader
          title="담아서 한 번에 (프로토타입)"
          right={<span className="text-caption text-muted">O안 · 배치만 — 실행은 단일 실행 화면의 토글에서</span>}
        />

        <div className="flex min-h-0 flex-1 gap-4">
          {railOpen ? (
            <div className="w-[360px] shrink-0 overflow-hidden rounded-md border border-line bg-surface shadow-card">
              <CartRail
                cart={cart}
                runs={runs}
                openRunId={openRunId}
                onOpenRun={setOpenRunId}
                onCollapse={() => setRailOpen(false)}
                conditionText={`${endpoints[0]?.endpoint_nm ?? 'API 미등록'} · Default · Action Test`}
              />
            </div>
          ) : (
            <CartRailFolded cases={cart.cases} onOpen={() => setRailOpen(true)} />
          )}

          <div className="min-w-0 flex-1 overflow-hidden rounded-md border border-line bg-surface shadow-card">
            {openRunId == null ? (
              <CartBrowse datasets={datasets} cart={cart} className="h-full" />
            ) : (
              <ResultPane runId={openRunId} title={openRunTitle} onBack={() => setOpenRunId(null)} />
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
