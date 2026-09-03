'use client';

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input, Select, Textarea } from '@/components/ui/Field';
import { cn } from '@/lib/cn';
import { api } from '@/lib/api';
import type { CsvUploadResult, DatasetCategory, TestCase } from '@/lib/types';
import {
  Chevron, EmptyState, ErrBox, errText, folderLabel, oneLine, PencilIcon, TrashIcon, UNFILED,
  useArmed, useDatasetCategories, useFlowDatasets,
} from './shared';

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
  category: string; // TYPE_CD; '' in the form means UNFILED
}

const EMPTY: Fields = { question: '', contexts: '', groundTruth: '', category: '' };

function toFields(p: Parsed, expected: string | null, caseType: string): Fields {
  return {
    question: p.question,
    contexts: p.contexts.join('\n'),
    // parseCase prefers input_data.ground_truth and falls back to EXPECT_CTN.
    groundTruth: p.groundTruth ?? expected ?? '',
    category: caseType === UNFILED ? '' : caseType,
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
  return {
    input_data: JSON.stringify(input),
    expected_output: gt || null,
    case_type: f.category.trim() || UNFILED,
  };
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

const LABEL = 'mb-1 block eyebrow';

// Folder rows sit a step in from their dataset and read one size quieter —
// the tree's shape is the indent, not a box or a connector line.
const FOLDER_ROW =
  'flex w-full items-center gap-2 rounded-sm py-1.5 pl-7 pr-2.5 text-left text-[13px] transition-colors';
const FOLDER_ON = 'bg-surface-3 font-medium text-ink';
const FOLDER_OFF = 'text-muted hover:bg-surface-2 hover:text-ink';
const DEL_FOLDER_TITLE = '폴더 삭제 — 케이스는 폴더 없음 으로 남습니다';

/** A value that is on cases but has no folder: a CSV brought it in. Making a
 * folder of that name adopts those cases, which is why it is listed at all. */
function strayTitle(c: DatasetCategory): string | undefined {
  return c.type_id === null && c.type_cd !== UNFILED ? '폴더로 등록되지 않은 값' : undefined;
}

function FieldsEditor({
  value, onChange, autoFocus, categories,
}: { value: Fields; onChange: (f: Fields) => void; autoFocus?: boolean; categories: string[] }) {
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
      {/* minmax(0,…): a textarea's intrinsic width (its `cols` default) otherwise
          sets the column's minimum and pushes the whole page wider than the viewport. */}
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="min-w-0">
          <label className={LABEL}>Contexts</label>
          <Textarea
            value={value.contexts}
            onChange={(e) => set({ contexts: e.target.value })}
            rows={4}
            placeholder={'Context 1\nContext 2'}
            className="w-full text-sm"
          />
        </div>
        <div className="min-w-0">
          <label className={LABEL}>정답</label>
          <Textarea
            value={value.groundTruth}
            onChange={(e) => set({ groundTruth: e.target.value })}
            rows={4}
            placeholder="기대 답변"
            className="w-full font-mono text-xs"
          />
        </div>
      </div>
      <div>
        <div className="mb-1 flex items-center gap-2">
          <span className="eyebrow">폴더</span>
        </div>
        <Select
          value={value.category}
          onChange={(e) => set({ category: e.target.value })}
          className="h-9 w-48 text-sm"
        >
          <option value="">폴더 없음</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          {/* A category dropped from the registry after cases were filed under it
              stays selectable here, so saving such a case does not silently
              re-file it under whatever option happens to come first. */}
          {value.category !== '' && !categories.includes(value.category) && (
            <option value={value.category}>{value.category} (목록에 없음)</option>
          )}
        </Select>
      </div>
    </div>
  );
}

/** Delete button that asks once, in place — no modal, no accidental cascade. */
function DeleteButton({ label, onConfirm, className }: { label: string; onConfirm: () => void; className?: string }) {
  const [armed, setArmed] = useArmed();
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

/** Quiet icon button for the row actions in the narrow dataset list, where the
 * text buttons had to cover the name to fit. */
function IconBtn({
  title, onClick, danger, children,
}: { title: string; onClick: () => void; danger?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className={cn(
        'inline-flex h-6 w-6 items-center justify-center rounded-sm transition-colors',
        danger ? 'bg-bad-soft text-bad hover:bg-bad-soft2' : 'text-muted hover:bg-surface-3 hover:text-ink',
      )}
    >
      {children}
    </button>
  );
}

/** Same arm-then-confirm contract as DeleteButton, as a single icon: armed turns
 * red and the second click commits. */
function IconDelete({ title, onConfirm }: { title: string; onConfirm: () => void }) {
  const [armed, setArmed] = useArmed();
  return (
    <IconBtn
      title={armed ? '한 번 더 누르면 삭제됩니다' : title}
      danger={armed}
      onClick={() => { if (armed) { setArmed(false); onConfirm(); } else setArmed(true); }}
    >
      <TrashIcon />
    </IconBtn>
  );
}

// ---- panel -----------------------------------------------------------------

export default function DatasetsPanel() {
  const { datasets, reload } = useFlowDatasets();
  const [selDataset, setSelDataset] = useState<number | null>(null);
  // The selected dataset's folders, with case counts. The sidebar renders them
  // and every folder edit replaces the list with what the server returns.
  const { cats, setCats, reload: reloadCats } = useDatasetCategories(selDataset);
  // Which folder the case list is showing. null = the whole dataset.
  const [folder, setFolder] = useState<string | null>(null);
  const [newFolder, setNewFolder] = useState<string | null>(null);
  const [folderEditId, setFolderEditId] = useState<number | null>(null);
  const [folderVal, setFolderVal] = useState('');
  const [cases, setCases] = useState<TestCase[]>([]);
  const [loading, setLoading] = useState(false);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
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
  const cancelFolder = useRef(false);

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
  // Leaving a dataset drops whatever was half-edited in the previous one, and
  // the folder with it — a folder name means nothing in the next dataset.
  useEffect(() => {
    setEditId(null); setAdding(false); setDraft(EMPTY); setQuery(''); setNotice(null);
    setFolder(null); setNewFolder(null); setFolderEditId(null);
  }, [selDataset]);

  // Only registered folders can be filed into. A value that is on cases but has
  // no folder (a CSV import) is visible in the sidebar, but it is not something
  // the case editor should offer as a destination.
  const folders = useMemo(() => cats.filter((c) => c.type_id !== null), [cats]);
  const folderNames = useMemo(() => folders.map((c) => c.type_cd), [folders]);

  // A folder that was just deleted (or emptied and gone) must not leave the list
  // filtered to nothing with no visible reason.
  useEffect(() => {
    if (folder !== null && !cats.some((c) => c.type_cd === folder)) setFolder(null);
  }, [cats, folder]);

  const rows = useMemo(() => {
    const parsed = cases.map((c) => ({ c, p: parseCaseInput(c.input_data) }));
    const q = query.trim().toLowerCase();
    const inFolder = (c: TestCase) => folder === null || (c.case_type || UNFILED) === folder;
    return parsed.filter(({ c, p }) =>
      inFolder(c) && (!q ||
        p.question.toLowerCase().includes(q) ||
        (p.groundTruth ?? c.expected_output ?? '').toLowerCase().includes(q)));
  }, [cases, query, folder]);

  const inFolder = useMemo(
    () => (folder === null ? cases : cases.filter((c) => (c.case_type || UNFILED) === folder)),
    [cases, folder],
  );
  const noGt = inFolder.filter((c) => {
    const p = parseCaseInput(c.input_data);
    return !(p.groundTruth ?? c.expected_output ?? '').trim();
  }).length;

  async function guard(fn: () => Promise<void>) {
    setBusy(true); setError(null);
    try { await fn(); } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  }

  // ---- folders ----

  const addFolder = () => guard(async () => {
    const nm = (newFolder ?? '').trim();
    setNewFolder(null);
    if (selDataset == null || !nm) return;
    setCats(await api.post<DatasetCategory[]>(`/datasets/${selDataset}/case-types`, { type_cd: nm }));
    loadCases();
  });

  const renameFolder = (typeId: number) => guard(async () => {
    const nm = folderVal.trim();
    setFolderEditId(null);
    if (selDataset == null || !nm) return;
    setCats(await api.put<DatasetCategory[]>(`/datasets/${selDataset}/case-types/${typeId}`, { type_cd: nm }));
    // The cases moved with the folder, so their own labels are stale too.
    loadCases();
  });

  const delFolder = (typeId: number) => guard(async () => {
    if (selDataset == null) return;
    setCats(await api.del<DatasetCategory[]>(`/datasets/${selDataset}/case-types/${typeId}`));
    loadCases();
  });

  const createDataset = () => guard(async () => {
    if (!newName.trim()) return;
    const d = await api.post<{ dataset_id: number }>('/flow/datasets', { dataset_nm: newName.trim() });
    setNewName('');
    setCreating(false);
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
    // Cases go in as runs into the same folder, so the folder is the one field
    // that survives the reset.
    setDraft({ ...EMPTY, category: draft.category });
    loadCases();
    reloadCats();
    reload(); // dataset list shows case counts
  });

  const saveCase = (id: number) => guard(async () => {
    if (selDataset == null) return;
    const original = cases.find((c) => c.case_id === id);
    const rest = original ? parseCaseInput(original.input_data).rest : {};
    await api.put(`/datasets/${selDataset}/cases/${id}`, toPayload(edit, rest));
    setEditId(null);
    loadCases();
    reloadCats(); // the case may have been moved to another folder
  });

  const delCase = (id: number) => guard(async () => {
    if (selDataset == null) return;
    await api.del(`/datasets/${selDataset}/cases/${id}`);
    if (editId === id) setEditId(null);
    loadCases();
    reloadCats();
    reload();
  });

  /** Copy a case into the add form — building near-identical cases is the common
   * way these datasets grow, and retyping the whole payload is the slow part. */
  function duplicate(c: TestCase) {
    setDraft(toFields(parseCaseInput(c.input_data), c.expected_output, c.case_type));
    setAdding(true);
    setEditId(null);
  }

  function openEdit(c: TestCase) {
    setEditId((cur) => (cur === c.case_id ? null : c.case_id));
    setEdit(toFields(parseCaseInput(c.input_data), c.expected_output, c.case_type));
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
    reloadCats();
    reload();
  });

  return (
    <div className="space-y-5">
      {error && <ErrBox msg={error} />}

      {/* minmax(0,…) again: with a plain `1fr` the cases column is at least as wide
          as its widest min-content child, which is what made the page scroll sideways. */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[17rem_minmax(0,1fr)]">
        <Card className="min-w-0">
          {/* Creating a dataset belongs to this list, not to a permanent strip
              across the top of the page — it is a rare action on a rare object. */}
          <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
            <h3 className="min-w-0 flex-1 text-sm font-semibold text-ink">
              데이터셋 <span className="font-normal text-muted">({datasets.length})</span>
            </h3>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { setCreating((v) => !v); setNewName(''); }}
            >
              {creating ? '취소' : '+ 새로 만들기'}
            </Button>
          </div>
          <ul className="max-h-[70vh] space-y-0.5 overflow-y-auto p-1.5">
            {creating && (
              <li className="px-0.5 pb-1 pt-0.5">
                <Input
                  autoFocus
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') createDataset();
                    if (e.key === 'Escape') { setCreating(false); setNewName(''); }
                  }}
                  placeholder="이름 입력 후 Enter"
                  className="h-9 w-full text-sm"
                />
              </li>
            )}
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
                <Fragment key={d.dataset_id}>
                  <li className="group relative">
                    <button
                      onClick={() => setSelDataset(d.dataset_id)}
                      className={cn(
                        'flex w-full items-center gap-2 rounded-sm py-2 pl-2 pr-2.5 text-left text-sm transition-colors',
                        on ? 'bg-surface-3 font-medium text-ink' : 'text-ink hover:bg-surface-2',
                      )}
                    >
                      {/* A hairline marker instead of a box per row — the list reads
                          as one list, and only the selected row draws a line. */}
                      <span aria-hidden className={cn('h-4 w-0.5 shrink-0', on ? 'bg-primary' : 'bg-transparent')} />
                      <span className="min-w-0 flex-1 truncate">{d.dataset_nm}</span>
                      <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted group-hover:invisible">
                        {d.case_count ?? '—'}
                      </span>
                    </button>
                    {/* Row actions take the count's place on hover rather than
                        covering the name with an opaque strip. */}
                    <span className="absolute right-1.5 top-1/2 hidden -translate-y-1/2 items-center gap-0.5 group-hover:flex group-focus-within:flex">
                      <IconBtn title="이름 변경" onClick={() => { setRenameId(d.dataset_id); setRenameVal(d.dataset_nm); }}>
                        <PencilIcon />
                      </IconBtn>
                      <IconDelete title="데이터셋 삭제" onConfirm={() => delDataset(d.dataset_id)} />
                    </span>
                  </li>

                  {/* The selected dataset opens into its folders. Only one
                      dataset is ever open, so there is no expand control to hunt
                      for and no way to end up looking at two trees at once. */}
                  {on && (
                    <>
                      <li>
                        <button
                          onClick={() => setFolder(null)}
                          className={cn(FOLDER_ROW, folder === null ? FOLDER_ON : FOLDER_OFF)}
                        >
                          <span className="min-w-0 flex-1 truncate">전체</span>
                          <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-soft">
                            {cases.length}
                          </span>
                        </button>
                      </li>

                      {cats.map((c) =>
                        folderEditId != null && folderEditId === c.type_id ? (
                          <li key={c.type_cd} className="py-1 pl-7 pr-1.5">
                            <Input
                              autoFocus
                              value={folderVal}
                              onChange={(e) => setFolderVal(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Escape') cancelFolder.current = true;
                                if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur();
                              }}
                              onBlur={() => {
                                if (cancelFolder.current) { cancelFolder.current = false; setFolderEditId(null); return; }
                                renameFolder(c.type_id!);
                              }}
                              className="h-8 w-full text-sm"
                            />
                          </li>
                        ) : (
                          <li key={c.type_cd} className="group relative">
                            <button
                              onClick={() => setFolder(c.type_cd)}
                              className={cn(FOLDER_ROW, folder === c.type_cd ? FOLDER_ON : FOLDER_OFF)}
                              title={strayTitle(c)}
                            >
                              <span className="min-w-0 flex-1 truncate">{folderLabel(c.type_cd)}</span>
                              <span
                                className={cn(
                                  'shrink-0 font-mono text-[11px] tabular-nums text-muted-soft',
                                  c.type_id !== null && 'group-hover:invisible',
                                )}
                              >
                                {c.case_count}
                              </span>
                            </button>
                            {c.type_id !== null && (
                              <span className="absolute right-1.5 top-1/2 hidden -translate-y-1/2 items-center gap-0.5 group-hover:flex group-focus-within:flex">
                                <IconBtn
                                  title="폴더 이름 변경"
                                  onClick={() => { setFolderEditId(c.type_id!); setFolderVal(c.type_cd); }}
                                >
                                  <PencilIcon />
                                </IconBtn>
                                <IconDelete title={DEL_FOLDER_TITLE} onConfirm={() => delFolder(c.type_id!)} />
                              </span>
                            )}
                          </li>
                        ),
                      )}

                      <li>
                        {newFolder === null ? (
                          <button
                            type="button"
                            onClick={() => setNewFolder('')}
                            className={cn(FOLDER_ROW, 'text-muted-soft hover:bg-surface-2 hover:text-ink')}
                          >
                            + 폴더
                          </button>
                        ) : (
                          <div className="py-1 pl-7 pr-1.5">
                            <Input
                              autoFocus
                              value={newFolder}
                              onChange={(e) => setNewFolder(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') addFolder();
                                if (e.key === 'Escape') setNewFolder(null);
                              }}
                              onBlur={() => setNewFolder(null)}
                              placeholder="이름 입력 후 Enter"
                              className="h-8 w-full text-sm"
                            />
                          </div>
                        )}
                      </li>
                    </>
                  )}
                </Fragment>
              );
            })}
            {datasets.length === 0 && !creating && (
              <li className="px-1 py-8 text-center text-sm text-muted">
                데이터셋이 없습니다
              </li>
            )}
          </ul>
        </Card>

        <Card className="min-w-0">
          {selected == null ? (
            <EmptyState label="← 데이터셋 선택" />
          ) : (
            <>
              {/* Title and toolbar on separate lines: six controls on one row wrapped
                  unpredictably and read as a pile rather than as a heading. */}
              <div className="border-b border-line px-4 py-3">
                <div className="flex items-baseline gap-2">
                  <h3 className="min-w-0 truncate text-sm font-semibold text-ink">
                    {selected.dataset_nm}
                    {folder !== null && (
                      <span className="font-normal text-muted"> / {folderLabel(folder)}</span>
                    )}
                  </h3>
                  <span className="shrink-0 text-xs text-muted">
                    케이스 {inFolder.length}
                  </span>
                  {noGt > 0 && (
                    <span
                      className="shrink-0 rounded-sm bg-surface-2 px-1.5 py-px text-[11px] text-muted"
                    >
                      정답 없음 {noGt}
                    </span>
                  )}
                </div>
                <div className="mt-2.5 flex flex-wrap items-center gap-2">
                  <Input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="질문 · 정답 검색"
                    className="h-8 w-44 text-xs"
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
                  <span className="ml-auto inline-flex items-center overflow-hidden rounded-sm border border-line bg-surface">
                    <span className="px-2 text-[11px] font-medium text-muted">CSV</span>
                    <button
                      type="button" disabled={busy}
                      onClick={() => fileRef.current?.click()}
                      className="h-8 border-l border-line px-2.5 text-xs text-ink transition-colors hover:bg-surface-3 disabled:opacity-50"
                    >
                      가져오기
                    </button>
                    <button
                      type="button" disabled={cases.length === 0}
                      onClick={() => download(`${selected.dataset_nm}.csv`, toCsv(cases))}
                      className="h-8 border-l border-line px-2.5 text-xs text-ink transition-colors hover:bg-surface-3 disabled:opacity-50"
                    >
                      내려받기
                    </button>
                  </span>
                  <Button
                    variant={adding ? 'secondary' : 'primary'}
                    size="sm"
                    onClick={() => {
                      // Opening the form under an active filter adds to that
                      // category — otherwise the new case is filtered out of the
                      // list the instant it is created.
                      if (!adding && folder !== null && folder !== UNFILED && !draft.category) {
                        setDraft((d) => ({ ...d, category: folder }));
                      }
                      setAdding((v) => !v);
                      setEditId(null);
                    }}
                  >
                    {adding ? '닫기' : '케이스 추가'}
                  </Button>
                </div>
              </div>

              {notice && (
                <div className="flex items-start gap-2 border-b border-line bg-surface-2/50 px-4 py-2.5 text-xs text-muted">
                  <span className="min-w-0 flex-1 break-words">{notice}</span>
                  <button type="button" className="shrink-0 hover:text-ink" onClick={() => setNotice(null)}>닫기</button>
                </div>
              )}

              {adding && (
                <div className="border-b border-line bg-surface-2/40 px-4 py-3.5">
                  <FieldsEditor value={draft} onChange={setDraft} autoFocus categories={folderNames} />
                  <div className="mt-3 flex items-center justify-end gap-2">
                    <Button variant="ghost" size="sm" onClick={() => { setDraft(EMPTY); setAdding(false); }}>취소</Button>
                    <Button variant="secondary" size="sm" disabled={!draft.question.trim() || busy} onClick={addCase}>추가</Button>
                  </div>
                </div>
              )}

              {loading ? (
                <div className="py-12 text-center text-xs text-muted">불러오는 중…</div>
              ) : rows.length === 0 ? (
                <div className="py-12 text-center text-sm text-muted">
                  {cases.length === 0 ? '—' : '검색 결과 없음'}
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
                          <span className={cn('min-w-0 flex-1 text-sm text-ink', open ? 'break-words font-medium' : 'truncate')}>
                            {p.question || <span className="text-muted">(질문 없음)</span>}
                          </span>
                          {!open && (
                            gt
                              ? <span className="mt-0.5 min-w-0 flex-1 truncate text-xs text-muted">{oneLine(gt)}</span>
                              : <span className="mt-0.5 shrink-0 text-[11px] text-muted">정답 없음</span>
                          )}
                          {folder === null && c.case_type !== UNFILED && (
                            <span className="mt-0.5 shrink-0 rounded-sm bg-surface-2 px-1.5 py-px text-[11px] text-muted">
                              {c.case_type}
                            </span>
                          )}
                        </button>
                        {open && (
                          <div className="px-4 pb-3.5 pl-12">
                            <FieldsEditor value={edit} onChange={setEdit} categories={folderNames} />
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
