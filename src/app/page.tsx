'use client';

import { useState } from 'react';
import TopBar from '@/components/ui/TopBar';
import { Tabs } from '@/components/ui/Tabs';
import SingleRunPanel from '@/components/ragas/SingleRunPanel';
import ComparePanel from '@/components/ragas/ComparePanel';
import DatasetsPanel from '@/components/ragas/DatasetsPanel';
import RecordsPanel from '@/components/ragas/RecordsPanel';

type Tab = 'single' | 'compare' | 'datasets' | 'records';
const TABS: { id: Tab; label: string; desc: string; group?: string }[] = [
  { id: 'single', label: 'Single run', desc: '데이터셋 또는 단일 메시지(Manual)를 실행합니다 — 프롬프트 버전을 교체하거나 As-is(현재 상태 그대로)로 실행할 수 있고, RAGAS 채점은 켜고 끌 수 있습니다.' },
  { id: 'compare', label: 'Compare', desc: '같은 노드의 두 프롬프트 버전을 하나의 데이터셋으로 평가해 지표를 비교합니다.' },
  { id: 'datasets', label: 'Datasets', desc: '평가에 사용할 질문 · 컨텍스트 · 정답(ground truth) 케이스를 관리합니다.', group: 'secondary' },
  { id: 'records', label: 'Records', desc: '지난 평가 실행 기록을 조회하고 CSV로 내보냅니다.', group: 'secondary' },
];

export default function RagasHomePage() {
  const [tab, setTab] = useState<Tab>('single');
  const current = TABS.find((t) => t.id === tab)!;
  return (
    <div className="flex h-full flex-col">
      <TopBar />
      <div className="px-6 pt-5">
        <Tabs items={TABS} value={tab} onChange={setTab} />
      </div>
      <div className="flex-1 overflow-auto px-6 py-6">
        <header className="mb-5">
          <h1 className="text-lg font-semibold tracking-tight text-ink">{current.label}</h1>
          <p className="mt-1 text-sm text-muted">{current.desc}</p>
        </header>
        {tab === 'single' && <SingleRunPanel />}
        {tab === 'compare' && <ComparePanel />}
        {tab === 'datasets' && <DatasetsPanel />}
        {tab === 'records' && <RecordsPanel />}
      </div>
    </div>
  );
}
