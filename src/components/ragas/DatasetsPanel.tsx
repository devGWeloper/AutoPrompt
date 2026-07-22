'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input, Textarea } from '@/components/ui/Field';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/Table';
import { api } from '@/lib/api';
import type { TestCase } from '@/lib/types';
import { ErrBox, errText, useFlowDatasets } from './shared';

/** Parse a case's input_data JSON into the friendly fields for display. Falls
 * back to showing the raw string as the question if it isn't valid JSON. */
function parseCaseInput(raw: string): { question: string; contexts: string[]; groundTruth: string | null } {
  try {
    const o = JSON.parse(raw) as { question?: string; contexts?: string[] | string; ground_truth?: string };
    const ctx = Array.isArray(o.contexts) ? o.contexts : o.contexts ? [String(o.contexts)] : [];
    return { question: o.question ?? '', contexts: ctx.map(String), groundTruth: o.ground_truth ?? null };
  } catch {
    return { question: raw, contexts: [], groundTruth: null };
  }
}

export default function DatasetsPanel() {
  const { datasets, reload } = useFlowDatasets();
  const [selDataset, setSelDataset] = useState<number | null>(null);
  const [cases, setCases] = useState<TestCase[]>([]);
  const [newName, setNewName] = useState('');
  const [caseQuestion, setCaseQuestion] = useState('');
  const [caseContexts, setCaseContexts] = useState('');
  const [caseGroundTruth, setCaseGroundTruth] = useState('');
  const [error, setError] = useState<string | null>(null);

  const loadCases = useCallback(() => {
    if (selDataset == null) return setCases([]);
    api.get<TestCase[]>(`/datasets/${selDataset}/cases`).then(setCases).catch(() => setCases([]));
  }, [selDataset]);
  useEffect(loadCases, [loadCases]);

  async function createDataset() {
    if (!newName.trim()) return;
    try { await api.post('/flow/datasets', { dataset_nm: newName }); setNewName(''); reload(); }
    catch (e) { setError(errText(e)); }
  }
  async function addCase() {
    if (selDataset == null || !caseQuestion.trim()) return;
    // Build the input_data JSON from the friendly fields. Contexts: one per line.
    // ground_truth is optional (only the gt-based metrics need it).
    const contexts = caseContexts.split('\n').map((s) => s.trim()).filter(Boolean);
    const input: Record<string, unknown> = { question: caseQuestion.trim() };
    if (contexts.length) input.contexts = contexts;
    const gt = caseGroundTruth.trim();
    if (gt) input.ground_truth = gt;
    try {
      await api.post(`/datasets/${selDataset}/cases`, {
        input_data: JSON.stringify(input),
        expected_output: gt || null,
      });
      setCaseQuestion(''); setCaseContexts(''); setCaseGroundTruth('');
      loadCases();
    } catch (e) { setError(errText(e)); }
  }
  async function delDataset(id: number) { await api.del(`/datasets/${id}`); if (selDataset === id) setSelDataset(null); reload(); }
  async function delCase(id: number) { if (selDataset == null) return; await api.del(`/datasets/${selDataset}/cases/${id}`); loadCases(); }

  return (
    <div className="space-y-5">
      <Card tone="muted" className="p-4">
        <div className="flex flex-wrap items-center gap-3">
          <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="New dataset name" className="w-64" />
          <Button variant="secondary" disabled={!newName.trim()} onClick={createDataset}>Create dataset</Button>
        </div>
      </Card>
      {error && <ErrBox msg={error} />}
      <div className="grid grid-cols-[18rem_1fr] gap-5">
        <Card>
          <div className="border-b border-line px-4 py-3">
            <h3 className="text-sm font-semibold text-ink">Datasets <span className="font-normal text-muted">({datasets.length})</span></h3>
          </div>
          <ul className="max-h-[70vh] space-y-1.5 overflow-y-auto p-3">
            {datasets.map((d) => (
              <li key={d.dataset_id} className="flex items-center gap-2">
                <button
                  onClick={() => setSelDataset(d.dataset_id)}
                  className={
                    'flex-1 rounded-sm border px-3 py-2 text-left text-sm transition-colors ' +
                    (selDataset === d.dataset_id ? 'border-accent/40 bg-accent-soft/60 font-medium text-ink' : 'border-line text-ink hover:bg-surface-2')
                  }
                >
                  {d.dataset_nm}
                </button>
                <Button variant="danger" size="sm" onClick={() => delDataset(d.dataset_id)}>Delete</Button>
              </li>
            ))}
            {datasets.length === 0 && <li className="px-1 py-2 text-sm text-muted">No datasets</li>}
          </ul>
        </Card>
        <Card>
          {selDataset == null ? (
            <div className="py-12 text-center text-sm text-muted">데이터셋을 선택하세요.</div>
          ) : (
            <>
              <div className="border-b border-line px-4 py-3">
                <h3 className="text-sm font-semibold text-ink">Cases <span className="font-normal text-muted">({cases.length})</span></h3>
              </div>
              <div className="p-4">
              <div className="mb-4 space-y-2">
                <div>
                  <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.05em] text-muted">Question <span className="text-bad">*</span></label>
                  <Input value={caseQuestion} onChange={(e) => setCaseQuestion(e.target.value)} placeholder="Question to evaluate" className="w-full text-sm" />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.05em] text-muted">Contexts <span className="font-normal normal-case tracking-normal">(optional · one per line)</span></label>
                  <Textarea value={caseContexts} onChange={(e) => setCaseContexts(e.target.value)} rows={3} placeholder={'Context 1\nContext 2'} className="w-full text-sm" />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.05em] text-muted">Ground truth <span className="font-normal normal-case tracking-normal">(optional · used only by accuracy metrics)</span></label>
                  <Input value={caseGroundTruth} onChange={(e) => setCaseGroundTruth(e.target.value)} placeholder="Expected answer (ground truth)" className="w-full text-sm" />
                </div>
                <div className="flex justify-end">
                  <Button variant="secondary" size="sm" disabled={!caseQuestion.trim()} onClick={addCase}>Add case</Button>
                </div>
              </div>
              <div>
                <Table>
                  <THead><TR><TH className="w-2/5">Question</TH><TH className="w-2/5">Contexts</TH><TH>Ground truth</TH><TH /></TR></THead>
                  <TBody>
                    {cases.map((c) => {
                      const p = parseCaseInput(c.input_data);
                      return (
                        <TR key={c.case_id}>
                          <TD className="align-top"><div className="max-h-28 overflow-y-auto whitespace-pre-wrap break-words text-xs">{p.question || '—'}</div></TD>
                          <TD className="align-top">
                            {p.contexts.length ? (
                              <ol className="max-h-28 list-decimal space-y-1 overflow-y-auto pl-4 text-xs text-muted">
                                {p.contexts.map((ctx, i) => (
                                  <li key={i} className="whitespace-pre-wrap break-words">{ctx}</li>
                                ))}
                              </ol>
                            ) : (
                              <span className="text-xs text-muted">—</span>
                            )}
                          </TD>
                          <TD className="align-top"><div className="max-h-28 overflow-y-auto whitespace-pre-wrap break-words text-xs">{p.groundTruth ?? '—'}</div></TD>
                          <TD className="text-right align-top"><Button variant="danger" size="sm" onClick={() => delCase(c.case_id)}>Delete</Button></TD>
                        </TR>
                      );
                    })}
                    {cases.length === 0 && <TR><TD colSpan={4} className="py-6 text-center text-muted">No cases</TD></TR>}
                  </TBody>
                </Table>
              </div>
              </div>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
