'use client';

import { useEffect, useState } from 'react';
import { cn } from '@/lib/cn';
import { SHELL } from '@/lib/layout';
import { readActiveRun } from '@/lib/activeRun';
import TopBar from '@/components/ui/TopBar';
import { Tabs } from '@/components/ui/Tabs';
import SingleRunPanel from '@/components/ragas/SingleRunPanel';
import ComparePanel from '@/components/ragas/ComparePanel';
import DatasetsPanel from '@/components/ragas/DatasetsPanel';
import RecordsPanel from '@/components/ragas/RecordsPanel';

type Tab = 'single' | 'compare' | 'datasets' | 'records';
const TABS: { id: Tab; label: string; desc: string; group?: string }[] = [
  { id: 'single', label: 'Single', desc: '대상(프롬프트 버전 또는 엔드포인트)을 하나 정해 데이터셋이나 직접 입력한 메시지로 실행합니다. 채점은 켜고 끌 수 있습니다.' },
  { id: 'compare', label: 'Compare', desc: '같은 데이터셋을 두 대상(프롬프트 버전 A·B 또는 엔드포인트 A·B)에 각각 실행해 지표를 비교합니다.' },
  { id: 'datasets', label: 'Datasets', desc: '평가에 사용할 질문 · 컨텍스트 · 정답(ground truth) 케이스를 관리합니다.', group: 'secondary' },
  { id: 'records', label: 'Records', desc: '지난 평가 실행 기록을 조회하고 CSV로 내보냅니다.', group: 'secondary' },
];

// Run tabs are hidden rather than unmounted when you leave them. Unmounting drops
// the live results and the run/stream handles with them, and a dropped SSE stream
// aborts the request — which the server reads as a cancel. The read-only tabs
// still remount, so they reload their lists on every visit.
export default function RagasHomePage() {
  const [tab, setTab] = useState<Tab>('single');
  // Mount a kept tab only once it has been opened, so the first paint stays cheap.
  const [opened, setOpened] = useState<Set<Tab>>(() => new Set<Tab>(['single']));
  const openTab = (t: Tab) => {
    setTab(t);
    setOpened((cur) => (cur.has(t) ? cur : new Set(cur).add(t)));
  };
  // Land on Compare when this tab was streaming a comparison before a refresh —
  // otherwise the panel would not mount, and nothing would reattach to the pair.
  // In an effect (not the initial state) so server and client render the same tab.
  useEffect(() => {
    if (readActiveRun('compare')) openTab('compare');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const current = TABS.find((t) => t.id === tab)!;
  return (
    <div className="flex h-full flex-col">
      <TopBar />
      <div className={cn(SHELL, 'px-6 pt-5')}>
        <Tabs items={TABS} value={tab} onChange={openTab} />
      </div>
      <div className="flex-1 overflow-auto">
        <div className={cn(SHELL, 'px-6 py-6')}>
          <header className="mb-5">
            <h1 className="text-lg font-semibold tracking-tight text-ink">{current.label}</h1>
            <p className="mt-1 text-sm text-muted">{current.desc}</p>
          </header>
          {opened.has('single') && (
            <div className={cn(tab !== 'single' && 'hidden')}><SingleRunPanel /></div>
          )}
          {opened.has('compare') && (
            <div className={cn(tab !== 'compare' && 'hidden')}><ComparePanel /></div>
          )}
          {tab === 'datasets' && <DatasetsPanel />}
          {tab === 'records' && <RecordsPanel />}
        </div>
      </div>
    </div>
  );
}
