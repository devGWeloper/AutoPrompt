'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import TopBar from '@/components/ui/TopBar';
import { api } from '@/lib/api';
import type { Project } from '@/types';

export default function ProjectsPage() {
  const router = useRouter();
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<Project[]>('/projects')
      .then(setProjects)
      .catch((e) => setError(String(e)));
  }, []);

  return (
    <div className="min-h-screen">
      <TopBar title="Projects" />
      <main className="mx-auto max-w-4xl p-6">
        <h1 className="mb-4 text-lg font-semibold">Projects</h1>
        {error && <div className="mb-4 rounded bg-red-50 p-3 text-sm text-red-700">{error}</div>}
        {projects === null ? (
          <div className="text-sm text-slate-500">Loading...</div>
        ) : projects.length === 0 ? (
          <div className="text-sm text-slate-500">No projects yet.</div>
        ) : (
          <ul className="space-y-2">
            {projects.map((p) => (
              <li
                key={p.project_id}
                onClick={() => router.push(`/projects/${p.project_id}/graph`)}
                className="cursor-pointer rounded border border-slate-200 bg-white p-4 hover:border-slate-400"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium">{p.project_nm}</div>
                    <div className="text-xs text-slate-500">{p.description || '-'}</div>
                  </div>
                  <span className="rounded bg-slate-100 px-2 py-0.5 text-xs">{p.status}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
