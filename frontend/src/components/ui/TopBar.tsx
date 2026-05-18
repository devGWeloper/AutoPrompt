'use client';

import { useRouter } from 'next/navigation';

export default function TopBar({ title, right }: { title: string; right?: React.ReactNode }) {
  const router = useRouter();

  return (
    <header className="flex h-14 items-center justify-between border-b border-slate-200 bg-white px-4">
      <div className="flex items-center gap-3">
        <button
          onClick={() => router.push('/projects')}
          className="text-sm font-semibold text-slate-900 hover:underline"
        >
          Prompt Mgmt
        </button>
        <span className="text-slate-300">/</span>
        <span className="text-sm font-medium text-slate-700">{title}</span>
      </div>
      <div className="flex items-center gap-3">{right}</div>
    </header>
  );
}
