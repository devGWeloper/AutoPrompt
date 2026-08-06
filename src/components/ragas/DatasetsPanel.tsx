'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input, Textarea } from '@/components/ui/Field';
import { cn } from '@/lib/cn';
import { api } from '@/lib/api';
import type { CsvUploadResult, TestCase } from '@/lib/types';
import { Chevron, ErrBox, errText, oneLine, useFlowDatasets } from './shared';

// A case's payload is the JSON in INPUT_CTN. The editor exposes the three fields
// the evaluation actually reads (see services/ragas.ts parseCase) and carries any
// other keys through untouched, so editing a case here never drops data that was
// imported from CSV or written by hand.
interface Parsed {
  question: string;
  contexts: string[];
  groundTruth: string | null;
  rest: Record<string, unknown>;
}

function parseCaseInput(raw: string): Parsed {
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    if (!o || typeof o !== 'object' || Array.isArray(o)) throw new Error('not an object');
    const { question, contexts, ground_truth: gt, ...rest } = o;
    const ctx = Array.isArray(contexts) ? contexts.map(String) : contexts ? [String(contexts)] : [];
    return {
      question: question == null ? '' : String(question),
      contexts: ctx,
      groundTruth: gt == null ? null : String(gt),
      rest,
    };
  } catch {
    // Not JSON — treat the whole string as the question so it stays editable.
    return { question: raw, contexts: [], groundTruth: null, rest: {} };
  }
}

/** Editable form state for one case. */
interface Fields {
  question: string;
  contexts: string; // one per line
  groundTruth: string;
}

const EMPTY: Fields = { question: '', contexts: '', groundTruth: '' };

function toFields(p: Parsed, expected: string | null): Fields {
  return {
    question: p.question,
    contexts: p.contexts.join('\n'),
    // parseCase prefers input_data.ground_truth and falls back to EXPECT_CTN.
    groundTruth: p.groundTruth ?? expected ?? '',
  };
}

function toPayload(f: Fields, rest: Record<string, unknown> = {}) {
  const contexts = f.contexts.split('\n').map((s) => s.trim()).filter(Boolean);
  const gt = f.groundTruth.trim();
  const input: Record<string, unknown> = { ...rest, question: f.question.trim() };
  if (contexts.length) input.contexts = contexts;
  else delete input.contexts;
  if (gt) input.ground_truth = gt;
  else delete input.ground_truth;
  // Both columns are written: EXPECT_CTN is what an unparseable input_data falls
  // back to, and it is the column the CSV round-trip carries.
  return { input_data: JSON.stringify(input), expected_output: gt || null };
}

// ---- CSV round-trip --------------------------------------------------------

// Same columns importCsv accepts, so a downloaded file can be edited in Excel
// and uploaded straight back.
const CSV_HEADER = ['input_json', 'expected_output', 'eval_criteria', 'case_type'];

function toCsv(cases: TestCase[]): string {
  const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const lines = [CSV_HEADER.join(',')];
  for (const c of cases) {
    lines.push([c.input_data, c.expected_output ?? '', c.eval_criteria ?? '', c.case_type].map(esc).join(','));
  }
  return lines.join('\r\n');
}

function download(filename: string, text: string) {
  // BOM so Excel opens UTF-8 Korean correctly.
  const url = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ---- small pieces ----------------------------------------------------------

const LABEL = 'mb-1 block text-[11px] font-semibold uppercase tracking-[0.05em] text-muted';
const HINT = 'font-normal normal-case tracking-normal text-muted';

function FieldsEditor({
  value, onChange, autoFocus,
}: { value: Fields; onChange: (f: Fields) => void; autoFocus?: boolean }) {
  const set = (patch: Partial<Fields>) => onChange({ ...value, ...patch });
  return (
    <div className="space-y-2.5">
      <div>
        <label className={LABEL}>질문 <span className="text-bad">*</span></label>
        <Textarea
          autoFocus={autoFocus}
          value={value.question}
          onChange={(e) => set({ question: e.target.value })}
          rows={2}
          placeholder="평가할 질문"
          className="w-full text-sm"
        />
      </div>
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        <div>
          <label className={LABEL}>Contexts <span className={HINT}>(선택 · 한 줄에 하나)</span></label>
          <Textarea
            value={value.contexts}
            onChange={(e) => set({ contexts: e.target.value })}
            rows={4}
            placeholder={'Context 1\nContext 2'}
            className="w-full text-sm"
          />
        </div>
        <div>
          <label className={LABEL}>정답 <span className={HINT}>(선택 · 정답 일치/정확도 지표에 사용)</span></label>
          <Textarea
            value={value.groundTruth}
            onChange={(e) => set({ groundTruth: e.target.value })}
            rows={4}
            placeholder={'기대하는 답변. JSON 도 그대로 붙여넣으면 됩니다.'}
            className="w-full font-mono text-xs"
          />
        </div>
      </div>
    </div>
  );
}

/** Delete button that asks once, in place — no modal, no accidental cascade. */
function DeleteButton({ label, onConfirm, className }: { label: string; onConfirm: () => void; className?: string }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);
  if (!armed) {
    return (
      <Button variant="ghost" size="sm" className={className} onClick={() => setArmed(true)}>{label}</Button>
    );
  }
  return (
    <span className="inline-flex shrink-0 items-center gap-1">
      <Button variant="danger" size="sm" onClick={() => { setArmed(false); onConfirm(); }}>확인</Button>
      <Button variant="ghost" size="sm" onClick={() => setArmed(false)}>취소</Button>
    </span>
  );
}

// ---- panel -----------------------------------------------------------------

export default function DatasetsPanel() {
  const { datasets, reload } = useFlowDatasets();
  const [selDataset, setSelDataset] = useState<number | null>(null);
  const [cases, setCases] = useState<TestCase[]>([]);
  const [loading, setLoading] = useState(false);
  const [newName, setNewName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<Fields>(EMPTY);
  const [editId, setEditId] = useState<number | null>(null);
  const [edit, setEdit] = useState<Fields>(EMPTY);
  const [renameId, setRenameId] = useState<number | null>(null);
  const [renameVal, setRenameVal] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  // Escape must not commit the rename that the resulting blur would otherwise save.
  const cancelRename = useRef(false);

  const selected = datasets.find((d) => d.dataset_id === selDataset) ?? null;

  const loadCases = useCallback(() => {
    if (selDataset == null) { setCases([]); return; }
    setLoading(true);
    api.get<TestCase[]>(`/datasets/${selDataset}/cases`)
      .then(setCases)
      .catch(() => setCases([]))
      .finally(() => setLoading(false));
  }, [selDataset]);
  useEffect(loadCases, [loadCases]);
  // Leaving a dataset drops whatever was half-edited in the previous one.
  useEffect(() => { setEditId(null); setAdding(false); setDraft(EMPTY); setQuery(''); setNotice(null); }, [selDataset]);

  const rows = useMemo(() => {
    const parsed = cases.map((c) => ({ c, p: parseCaseInput(c.input_data) }));
    const q = query.trim().toLowerCase();
    if (!q) return parsed;
    return parsed.filter(({ c, p }) =>
      p.question.toLowerCase().includes(q) ||
      (p.groundTruth ?? c.expected_output ?? '').toLowerCase().includes(q));
  }, [cases, query]);

  const noGt = cases.filter((c) => {
    const p = parseCaseInput(c.input_data);
    return !(p.groundTruth ?? c.expected_output ?? '').trim();
  }).length;

  async function guard(fn: () => Promise<void>) {
    setBusy(true); setError(null);
    try { await fn(); } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  }

  const createDataset = () => guard(async () => {
    if (!newName.trim()) return;
    const d = await api.post<{ dataset_id: number }>('/flow/datasets', { dataset_nm: newName.trim() });
    setNewName('');
    reload();
    setSelDataset(d.dataset_id);
  });

  const renameDataset = (id: number) => guard(async () => {
    const nm = renameVal.trim();
    setRenameId(null);
    if (!nm) return;
    await api.put(`/datasets/${id}`, { dataset_nm: nm });
    reload();
  });

  const delDataset = (id: number) => guard(async () => {
    await api.del(`/datasets/${id}`);
    if (selDataset === id) setSelDataset(null);
    reload();
  });

  const addCase = () => guard(async () => {
    if (selDataset == null || !draft.question.trim()) return;
    await api.post(`/datasets/${selDataset}/cases`, toPayload(draft));
    setDraft(EMPTY);
    loadCases();
    reload(); // dataset list shows case counts
  });

  const saveCase = (id: number) => guard(async () => {
    if (selDataset == null) return;
    const original = cases.find((c) => c.case_id === id);
    const rest = original ? parseCaseInput(original.input_data).rest : {};
    await api.put(`/datasets/${selDataset}/cases/${id}`, toPayload(edit, rest));
    setEditId(null);
    loadCases();
  });

  const delCase = (id: number) => guard(async () => {
    if (selDataset == null) return;
    await api.del(`/datasets/${selDataset}/cases/${id}`);
    if (editId === id) setEditId(null);
    loadCases();
    reload();
  });

  /** Copy a case into the add form — building near-identical cases is the common
   * way these datasets grow, and retyping the whole payload is the slow part. */
  function duplicate(c: TestCase) {
    setDraft(toFields(parseCaseInput(c.input_data), c.expected_output));
    setAdding(true);
    setEditId(null);
  }

  function openEdit(c: TestCase) {
    setEditId((cur) => (cur === c.case_id ? null : c.case_id));
    setEdit(toFields(parseCaseInput(c.input_data), c.expected_output));
  }

  const importCsv = (file: File) => guard(async () => {
    if (selDataset == null) return;
    const form = new FormData();
    form.append('file', file);
    const res = await api.upload<CsvUploadResult>(`/datasets/${selDataset}/upload`, form);
    setNotice(
      `CSV 가져오기 — ${res.created}건 추가` +
      (res.skipped ? `, ${res.skipped}건 건너뜀` : '') +
      (res.errors.length ? ` · ${res.errors.slice(0, 3).join(' / ')}` : ''),
    );
    loadCases();
    reload();
  });

  return (
    <div className="space-y-5">
      <Card tone="muted" className="p-4">
        <div className="flex flex-wrap items-center gap-3">
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') createDataset(); }}
            placeholder="새 데이터셋 이름"
            className="w-64"
          />
          <Button variant="secondary" disabled={!newName.trim() || busy} onClick={createDataset}>데이터셋 만들기</Button>
        </div>
      </Card>

      {error && <ErrBox msg={error} />}

      <div className="grid grid-cols-[19rem_1fr] gap-5">
        <Card>
          <div className="border-b border-line px-4 py-3">
            <h3 className="text-sm font-semibold text-ink">
              데이터셋 <span className="font-normal text-muted">({datasets.length})</span>
            </h3>
          </div>
          <ul className="max-h-[70vh] space-y-1 overflow-y-auto p-2.5">
            {datasets.map((d) => {
              const on = selDataset === d.dataset_id;
              if (renameId === d.dataset_id) {
                return (
                  <li key={d.dataset_id} className="px-0.5 py-1">
                    <Input
                      autoFocus
                      value={renameVal}
                      onChange={(e) => setRenameVal(e.target.value)}
                      onKeyDown={(e) => {
                        // Both keys leave the field; onBlur is the single commit point.
                        if (e.key === 'Escape') cancelRename.current = true;
                        if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur();
                      }}
                      onBlur={() => {
                        if (cancelRename.current) { cancelRename.current = false; setRenameId(null); return; }
                        renameDataset(d.dataset_id);
                      }}
                      className="h-9 w-full text-sm"
                    />
                  </li>
                );
              }
              return (
                <li key={d.dataset_id} className="group relative">
                  <button
                    onClick={() => setSelDataset(d.dataset_id)}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-sm border px-3 py-2 text-left text-sm transition-colors',
                      on ? 'border-accent/40 bg-accent-soft/60 font-medium text-ink' : 'border-line text-ink hover:bg-surface-2',
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate">{d.dataset_nm}</span>
                    <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted">{d.case_count ?? '—'}</span>
                  </button>
                  {/* Row actions stay out of the way until the row is touched. */}
                  <span className="absolute right-1.5 top-1/2 hidden -translate-y-1/2 items-center gap-0.5 rounded-sm bg-surface/95 pl-1 group-hover:flex group-focus-within:flex">
                    <Button
                      variant="ghost" size="sm"
                      onClick={() => { setRenameId(d.dataset_id); setRenameVal(d.dataset_nm); }}
                    >
                      이름
                    </Button>
                    <DeleteButton label="삭제" onConfirm={() => delDataset(d.dataset_id)} />
                  </span>
                </li>
              );
            })}
            {datasets.length === 0 && (
              <li className="px-1 py-6 text-center text-sm text-muted">데이터셋이 없습니다</li>
            )}
          </ul>
        </Card>

        <Card>
          {selected == null ? (
            <div className="py-16 text-center text-sm text-muted">왼쪽에서 데이터셋을 선택하세요.</div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
                <h3 className="mr-1 min-w-0 truncate text-sm font-semibold text-ink">{selected.dataset_nm}</h3>
                <span className="shrink-0 text-xs text-muted">케이스 {cases.length}</span>
                {noGt > 0 && (
                  <span
                    className="shrink-0 rounded-sm border border-line px-1.5 py-px text-[11px] text-muted"
                    title="정답이 없는 케이스는 정답 일치로 채점되지 않습니다"
                  >
                    정답 없음 {noGt}
                  </span>
                )}
                <div className="ml-auto flex shrink-0 items-center gap-2">
                  <Input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="질문 · 정답 검색"
                    className="h-8 w-48 text-xs"
                  />
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".csv,text/csv"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      e.target.value = ''; // re-selecting the same file must fire again
                      if (f) importCsv(f);
                    }}
                  />
                  <Button variant="ghost" size="sm" disabled={busy} onClick={() => fileRef.current?.click()}>
                    CSV 가져오기
                  </Button>
                  <Button
                    variant="ghost" size="sm"
                    disabled={cases.length === 0}
                    onClick={() => download(`${selected.dataset_nm}.csv`, toCsv(cases))}
                  >
                    CSV 내려받기
                  </Button>
                  <Button
                    variant={adding ? 'secondary' : 'primary'}
                    size="sm"
                    onClick={() => { setAdding((v) => !v); setEditId(null); }}
                  >
                    {adding ? '닫기' : '케이스 추가'}
                  </Button>
                </div>
              </div>

              {notice && (
                <div className="flex items-start gap-2 border-b border-line bg-surface-2/50 px-4 py-2.5 text-xs text-muted">
                  <span className="min-w-0 flex-1">{notice}</span>
                  <button type="button" className="shrink-0 hover:text-ink" onClick={() => setNotice(null)}>닫기</button>
                </div>
              )}

              {adding && (
                <div className="border-b border-line bg-surface-2/40 px-4 py-3.5">
                  <FieldsEditor value={draft} onChange={setDraft} autoFocus />
                  <div className="mt-3 flex items-center justify-end gap-2">
                    <span className="mr-auto text-[11px] text-muted">
                      CSV 로 여러 건을 한 번에 넣을 수도 있습니다 — 내려받은 파일을 고쳐서 그대로 올리면 됩니다.
                    </span>
                    <Button variant="ghost" size="sm" onClick={() => { setDraft(EMPTY); setAdding(false); }}>취소</Button>
                    <Button variant="secondary" size="sm" disabled={!draft.question.trim() || busy} onClick={addCase}>추가</Button>
                  </div>
                </div>
              )}

              {loading ? (
                <div className="py-12 text-center text-xs text-muted">불러오는 중…</div>
              ) : rows.length === 0 ? (
                <div className="py-12 text-center text-sm text-muted">
                  {cases.length === 0 ? '케이스가 없습니다 — 케이스 추가 또는 CSV 가져오기로 시작하세요.' : '검색 결과가 없습니다.'}
                </div>
              ) : (
                <ul className="divide-y divide-line">
                  {rows.map(({ c, p }, i) => {
                    const open = editId === c.case_id;
                    const gt = (p.groundTruth ?? c.expected_output ?? '').trim();
                    return (
                      <li key={c.case_id}>
                        <button
                          type="button"
                          onClick={() => openEdit(c)}
                          className="flex w-full items-start gap-2 px-4 py-2.5 text-left transition-colors hover:bg-surface-2/60"
                        >
                          <Chevron open={open} className="mt-0.5" />
                          <span className="mt-px w-6 shrink-0 font-mono text-[11px] tabular-nums text-muted">{i + 1}</span>
                          <span className={cn('min-w-0 flex-1 text-sm text-ink', open ? 'font-medium' : 'truncate')}>
                            {p.question || <span className="text-muted">(질문 없음)</span>}
                          </span>
                          {!open && (
                            gt
                              ? <span className="mt-0.5 min-w-0 flex-1 truncate text-xs text-muted">{oneLine(gt)}</span>
                              : <span className="mt-0.5 shrink-0 text-[11px] text-muted">정답 없음</span>
                          )}
                        </button>
                        {open && (
                          <div className="px-4 pb-3.5 pl-12">
                            <FieldsEditor value={edit} onChange={setEdit} />
                            <div className="mt-3 flex items-center gap-2">
                              <Button variant="ghost" size="sm" onClick={() => duplicate(c)}>복제</Button>
                              <DeleteButton label="삭제" onConfirm={() => delCase(c.case_id)} />
                              <span className="ml-auto flex items-center gap-2">
                                <Button variant="ghost" size="sm" onClick={() => setEditId(null)}>취소</Button>
                                <Button variant="secondary" size="sm" disabled={!edit.question.trim() || busy} onClick={() => saveCase(c.case_id)}>
                                  저장
                                </Button>
                              </span>
                            </div>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
