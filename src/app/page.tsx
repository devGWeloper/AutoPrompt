'use client';

import { useEffect, useState } from 'react';
import { cn } from '@/lib/cn';
import { SHELL } from '@/lib/layout';
import { readActiveRun } from '@/lib/activeRun';
import AppShell, { RUN_SECTIONS, SECTION_META, type SectionId } from '@/components/ui/AppShell';
import PageHeader from '@/components/ui/PageHeader';
import SingleRunPanel from '@/components/ragas/SingleRunPanel';
import ComparePanel from '@/components/ragas/ComparePanel';
import DatasetsPanel from '@/components/ragas/DatasetsPanel';
import RecordsPanel from '@/components/ragas/RecordsPanel';

type Tab = 'single' | 'compare' | 'datasets' | 'records';

// Run sections are hidden rather than unmounted when you leave them. Unmounting
// drops the live results and the run/stream handles with them, and a dropped SSE
// stream aborts the request — which the server reads as a cancel. The read-only
// sections still remount, so they reload their lists on every visit.
export default function RagasHomePage() {
  const [tab, setTab] = useState<Tab>('single');
  // Mount a kept section only once it has been opened, so the first paint stays cheap.
  const [opened, setOpened] = useState<Set<Tab>>(() => new Set<Tab>(['single']));
  const openTab = (t: Tab) => {
    setTab(t);
    setOpened((cur) => (cur.has(t) ? cur : new Set(cur).add(t)));
  };

  useEffect(() => {
    // Arriving from another route (`/?section=…`) opens that section; a tab that
    // was streaming a comparison before a refresh wins over it, since otherwise
    // the panel would not mount and nothing would reattach to the pair.
    const wanted = new URLSearchParams(window.location.search).get('section');
    if (wanted && (RUN_SECTIONS as string[]).includes(wanted)) openTab(wanted as Tab);
    if (readActiveRun('compare')) openTab('compare');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <AppShell section={tab} onSelect={(id: SectionId) => openTab(id as Tab)}>
      <div className={cn(SHELL, 'px-8 py-7')}>
        <PageHeader title={SECTION_META[tab].label} />
        {opened.has('single') && <div className={cn(tab !== 'single' && 'hidden')}><SingleRunPanel /></div>}
        {opened.has('compare') && <div className={cn(tab !== 'compare' && 'hidden')}><ComparePanel /></div>}
        {tab === 'datasets' && <DatasetsPanel />}
        {tab === 'records' && <RecordsPanel />}
      </div>
    </AppShell>
  );
}
