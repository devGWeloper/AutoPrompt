'use client';

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input, Select, Textarea } from '@/components/ui/Field';
import { cn } from '@/lib/cn';
import { api } from '@/lib/api';
import type { CaseBulkResult, DatasetCategory, TestCase } from '@/lib/types';
import { downloadBytes, XLSX_MIME } from '@/lib/xlsx';
import CaseImportModal, { casesWorkbook } from './CaseImportModal';
import { EMPTY, parseCaseInput, toFields, toPayload, type Fields } from './caseFields';
import {
  Chevron, EmptyState, ErrBox, errText, folderLabel, oneLine, PencilIcon, TrashIcon, UNFILED,
  useArmed, useDatasetCategories, useFlowDatasets,
} from './shared';

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

/** Row selection checkbox. indeterminate is a DOM property, not an attribute,
 * so it is set through the ref. */
function PickBox({
  checked, indeterminate, onChange, label,
}: { checked: boolean; indeterminate?: boolean; onChange: () => void; label: string }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = !!indeterminate;
  }, [indeterminate]);
  return (
    <input
      ref={ref}
      type="checkbox"
      aria-label={label}
      checked={checked}
      onChange={onChange}
      className="h-3.5 w-3.5 shrink-0 cursor-pointer accent-accent"
    />
  );
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
      {/* 목적은 폴더와 같은 줄에 선다 — 둘 다 케이스가 '무엇인지' 를 말하는 꼬리표라,
          질문·정답 아래 한 단 내려와 나란히 앉는 편이 읽는 순서에 맞는다. */}
      <div className="flex flex-wrap items-end gap-2.5">
        <div className="min-w-0 flex-1">
          <label className={LABEL}>목적</label>
          <Input
            value={value.criteria}
            onChange={(e) => set({ criteria: e.target.value })}
            placeholder="이 케이스로 무엇을 확인하나"
            className="h-9 w-full text-sm"
          />
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
  // 만들 때 적는 목적. 비워 두면 케이스가 들어오는 순간 LLM 이 채운다.
  const [newDesc, setNewDesc] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 결과가 화면에서 사라지는 작업(이동 · 삭제 · 올리기)만 잠깐 알린다. 남겨 두고
  // 닫게 하는 줄은 작업할 때마다 치워야 할 일이 하나 더 생길 뿐이었다.
  const [toast, setToast] = useState<{ text: string; undo?: () => void } | null>(null);
  const [toastHover, setToastHover] = useState(false);
  useEffect(() => {
    if (!toast || toastHover) return;
    const t = setTimeout(() => setToast(null), toast.undo ? 6000 : 3000);
    return () => clearTimeout(t);
  }, [toast, toastHover]);
  // A toast that unmounts under the pointer never fires mouseleave.
  useEffect(() => { if (!toast) setToastHover(false); }, [toast]);

  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<Fields>(EMPTY);
  const [editId, setEditId] = useState<number | null>(null);
  const [edit, setEdit] = useState<Fields>(EMPTY);
  const [renameId, setRenameId] = useState<number | null>(null);
  const [renameVal, setRenameVal] = useState('');
  // 이름과 같은 자리에서 고치는 설명 — '이 데이터셋은 무엇을 시험하나'.
  const [descVal, setDescVal] = useState('');
  const [suggesting, setSuggesting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [importing, setImporting] = useState(false);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  // Escape must not commit the folder rename that the resulting blur would save.
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
    setEditId(null); setAdding(false); setDraft(EMPTY); setQuery(''); setToast(null);
    setFolder(null); setNewFolder(null); setFolderEditId(null); setPicked(new Set());
  }, [selDataset]);
  // A selection made in one folder must not be acted on from another.
  useEffect(() => { setPicked(new Set()); }, [folder]);

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
        (p.groundTruth ?? c.expected_output ?? '').toLowerCase().includes(q) ||
        (c.eval_criteria ?? '').toLowerCase().includes(q)));
  }, [cases, query, folder]);

  /**
   * 전체 보기는 카테고리로 묶어 내려간다 — 왼쪽 폴더 목록과 같은 순서로 묶음을
   * 세우고, 묶음이 바뀌는 자리에 가로 구분선 겸 머리줄을 둔다. 줄마다 태그를
   * 달던 방식은 케이스 수만큼 같은 이름을 반복하면서도 같은 폴더끼리 붙여 놓지는
   * 못했다. 폴더 하나를 고른 화면은 이미 한 묶음이라 머리줄이 서지 않는다.
   *
   * 번호는 묶은 뒤의 자리를 센다 — 화면에 보이는 순서와 어긋나는 번호는 세는
   * 것보다 헷갈리게 한다.
   */
  const groups = useMemo(() => {
    const of = (c: TestCase) => c.case_type || UNFILED;
    const byCat = new Map<string, typeof rows>();
    for (const r of rows) {
      const k = of(r.c);
      const cur = byCat.get(k);
      if (cur) cur.push(r);
      else byCat.set(k, [r]);
    }
    const known = [...folderNames, UNFILED].filter((k) => byCat.has(k));
    // 폴더로 등록되지 않은 이름을 가진 케이스도 제 묶음을 갖는다 (아래 folderHint 참조).
    const rest = [...byCat.keys()].filter((k) => !known.includes(k));
    let n = 0;
    return [...known, ...rest].map((cat) => ({
      cat,
      items: byCat.get(cat)!.map((r) => ({ ...r, n: ++n })),
    }));
  }, [rows, folderNames]);

  const inFolder = useMemo(
    () => (folder === null ? cases : cases.filter((c) => (c.case_type || UNFILED) === folder)),
    [cases, folder],
  );
  const noGt = inFolder.filter((c) => {
    const p = parseCaseInput(c.input_data);
    return !(p.groundTruth ?? c.expected_output ?? '').trim();
  }).length;

  // Actions only ever touch picked rows that are on screen — a search that hides
  // a picked case also takes it out of the delete.
  // 목적이 비어 있는 건수 — 보고 있는 폴더 기준. LLM 으로 채울 거리가 얼마나
  // 남았는지가 곧 버튼에 적히는 수다.
  const noPurpose = inFolder.filter((c) => !(c.eval_criteria ?? '').trim()).length;

  const pickedRows = rows.filter((r) => picked.has(r.c.case_id));
  /** 고른 것 중 실제로 목적이 적혀 있는 건. '목적 지우기' 가 설지 말지를 가른다. */
  const pickedWithPurpose = pickedRows
    .filter((r) => (r.c.eval_criteria ?? '').trim())
    .map((r) => r.c.case_id);
  const allPicked = rows.length > 0 && pickedRows.length === rows.length;
  // Checkboxes stay out of sight until a row is hovered; once anything is picked
  // they all show, since from then on the list is being chosen from.
  const selecting = pickedRows.length > 0;
  const pickReveal = selecting ? '' : 'opacity-0 group-hover/case:opacity-100 focus-within:opacity-100';

  function togglePick(ids: number[], on: boolean) {
    setPicked((cur) => {
      const next = new Set(cur);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }

  function downloadCases(list: TestCase[], suffix: string | null) {
    if (!selected) return;
    downloadBytes(
      `${selected.dataset_nm}${suffix ? `_${suffix}` : ''}.xlsx`,
      // 템플릿과 같은 파일 — 받은 그대로 고쳐서 올리기 표에 붙여 넣는다.
      casesWorkbook(
        list.map((c) => toFields(parseCaseInput(c.input_data), c.expected_output, c.case_type, c.eval_criteria)),
        folderNames,
      ),
      XLSX_MIME,
    );
  }

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
    const d = await api.post<{ dataset_id: number }>('/flow/datasets', {
      dataset_nm: newName.trim(),
      description: newDesc.trim() || null,
    });
    setNewName('');
    setNewDesc('');
    setCreating(false);
    reload();
    setSelDataset(d.dataset_id);
  });

  const saveDataset = (id: number) => guard(async () => {
    const nm = renameVal.trim();
    if (!nm) return;
    setRenameId(null);
    // 빈 칸은 '' 가 아니라 null 로 지운다 — 설명이 없는 상태와 빈 문자열이
    // 목록에서 같아 보여도, 나중에 값이 있는 줄만 세는 쪽에서는 다르다.
    await api.put(`/datasets/${id}`, { dataset_nm: nm, description: descVal.trim() || null });
    reload();
  });

  /** 케이스를 LLM 에 보여 주고 목적 한 줄을 받아 설명칸에 채운다. 저장까지 하지는
   * 않는다 — 받은 문장을 읽고 고칠 기회 없이 덮어쓰면, 손으로 써 둔 설명이 버튼
   * 한 번에 사라진다. 저장은 옆의 저장 버튼이 한다. */
  const suggestPurpose = (id: number) => guard(async () => {
    setSuggesting(true);
    try {
      const r = await api.post<{ purpose: string }>(`/datasets/${id}/purpose`, {});
      setDescVal(r.purpose);
    } finally {
      setSuggesting(false);
    }
  });

  /**
   * 목적이 빈 데이터셋에 케이스가 들어오면 LLM 이 한 줄을 지어 저장한다.
   *
   * 데이터셋을 만드는 시점에는 케이스가 없어 요약할 거리가 없다 — 목적을 비워 둔
   * 채 만들었다면 채울 수 있게 되는 순간이 바로 여기다. 사람이 쓴 목적은 건드리지
   * 않는다: 비어 있을 때만 부른다.
   *
   * 실패는 조용히 넘긴다. 요약이 안 됐다고 방금 끝난 import 까지 실패한 것처럼
   * 보이면, 정작 들어온 케이스를 의심하게 된다. LLM 이 설정되지 않은 환경에서는
   * 400 이 돌아오고, 그 경우도 같은 길로 조용히 끝난다.
   */
  async function autoPurpose(id: number) {
    try {
      const r = await api.post<{ purpose: string }>(`/datasets/${id}/purpose`, {});
      await api.put(`/datasets/${id}`, { description: r.purpose });
      reload();
      // 지어낸 문장을 말없이 앉혀 두지 않는다 — 내가 쓰지 않은 글이 내 데이터셋에
      // 붙었다는 건 알려야 하고, 마음에 안 들면 그 자리에서 물릴 수 있어야 한다.
      setToast({
        text: `목적을 채웠습니다 — ${r.purpose}`,
        undo: async () => {
          await api.put(`/datasets/${id}`, { description: null });
          reload();
          setToast({ text: '목적을 지웠습니다' });
        },
      });
    } catch {
      // 조용히 둔다.
    }
  }

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

  const delPicked = () => guard(async () => {
    if (selDataset == null || pickedRows.length === 0) return;
    const ids = pickedRows.map((r) => r.c.case_id);
    const res = await api.post<{ deleted: number }>(`/datasets/${selDataset}/cases/delete`, { case_ids: ids });
    if (editId != null && ids.includes(editId)) setEditId(null);
    setPicked(new Set());
    setToast({ text: `케이스 ${res.deleted}건을 삭제했습니다` });
    loadCases();
    reloadCats();
    reload();
  });

  const movePicked = (to: string) => guard(async () => {
    if (selDataset == null || pickedRows.length === 0) return;
    const did = selDataset;
    const ids = pickedRows.map((r) => r.c.case_id);
    // Where each case came from, so undo can put every one back — a selection
    // can span several folders.
    const from = new Map<string, number[]>();
    for (const { c } of pickedRows) {
      const t = c.case_type || UNFILED;
      from.set(t, [...(from.get(t) ?? []), c.case_id]);
    }
    const res = await api.post<{ moved: number }>(`/datasets/${did}/cases/move`, { case_ids: ids, case_type: to });
    // An open editor would still show the old folder and save it back.
    if (editId != null && ids.includes(editId)) setEditId(null);
    setPicked(new Set());
    setToast({
      text: `케이스 ${res.moved}건을 ${to === UNFILED ? '폴더 없음으로' : `'${to}' 폴더로`} 옮겼습니다`,
      undo: () => guard(async () => {
        setToast(null);
        for (const [t, group] of from) {
          await api.post(`/datasets/${did}/cases/move`, { case_ids: group, case_type: t, allow_unregistered: true });
        }
        loadCases();
        reloadCats();
        // Undo that just makes the toast vanish reads as "did anything happen?".
        setToast({ text: `케이스 ${ids.length}건을 원래 폴더로 되돌렸습니다` });
      }),
    });
    loadCases();
    reloadCats();
  });

  /** Copy a case into the add form — building near-identical cases is the common
   * way these datasets grow, and retyping the whole payload is the slow part. */
  /**
   * 고른 데이터의 목적을 지운다 — 채운 것이 마음에 들지 않을 때.
   *
   * 토스트의 되돌리기도 이 길을 쓴다. 그쪽은 그 자리를 뜨면 사라지지만, 채운 목적이
   * 어긋난 걸 나중에 알아차리는 일이 더 많아서 목록에서 골라 지우는 길이 따로 있다.
   */
  const clearPurposes = (caseIds: number[], done = '지웠습니다') => guard(async () => {
    if (selDataset == null || caseIds.length === 0) return;
    const ids = new Set(caseIds);
    const res = await api.del<{ cleared: number }>(`/datasets/${selDataset}/cases/purpose`, {
      case_ids: caseIds,
    });
    setCases((prev) => prev.map((c) => (ids.has(c.case_id) ? { ...c, eval_criteria: null } : c)));
    setToast({ text: `목적 ${res.cleared}건을 ${done}` });
  });

  /**
   * 목적이 빈 데이터를 한 줄씩 채운다. 고른 것이 있으면 그중에서만 — 목록 전체를
   * 한 번에 돌리기 전에 몇 건으로 결과를 확인해 보는 길이다.
   *
   * 결과를 기다렸다 한꺼번에 받지 않고 채워지는 대로 그 자리에 앉힌다. 정답지가
   * JSON 인 건은 호출 없이 즉시 지어지고 나머지만 LLM 을 거치는데, 끝을 기다리면
   * 즉시 나온 것까지 같이 묶여 한참 뒤에 나타난다.
   *
   * 이미 적힌 목적은 서버가 건드리지 않으므로, 여러 번 눌러도 사람이 쓴 줄은
   * 그대로다. 되돌리기는 이번에 채워진 것만 도로 비운다.
   */
  const fillPurposes = (caseIds?: number[]) => guard(async () => {
    if (selDataset == null) return;
    const did = selDataset;
    const touched: number[] = [];
    let failed: string | null = null;
    // 이번에 채울 전체 수. 서버가 첫 묶음을 시작할 때 알려 준다.
    let goal = 0;
    setToast({ text: '목적을 채우는 중…' });

    await api.stream<
      | { event: 'WORKING'; done: number; total: number }
      | { event: 'FILLED'; items: { case_id: number; purpose: string }[] }
      | { event: 'DONE'; filled: number; remaining: number }
      | { event: 'FAILED'; message: string }
    >(`/datasets/${did}/cases/purpose/stream`, caseIds ? { case_ids: caseIds } : {}, (e) => {
      if (e.event === 'WORKING') {
        // 묶음 하나가 도는 동안은 목록이 멈춰 있다. 몇 건까지 왔는지라도 움직여야
        // 멈춘 것과 기다리는 것이 구분된다.
        goal = e.total;
        setToast({ text: `목적을 채우는 중… ${e.done}/${e.total}건` });
      } else if (e.event === 'FILLED') {
        const got = new Map(e.items.map((i) => [i.case_id, i.purpose]));
        touched.push(...e.items.map((i) => i.case_id));
        // 도착한 것만 그 자리에서 갈아 끼운다. 목록을 통째로 다시 받아 오면 채워지는
        // 모습 대신 화면이 한 번 깜빡이고, 펼쳐 둔 행도 접힌다.
        setCases((prev) =>
          prev.map((c) => {
            const line = got.get(c.case_id);
            return line ? { ...c, eval_criteria: line } : c;
          }),
        );
        setToast({
          text: `목적을 채우는 중… ${touched.length}${goal ? `/${goal}` : ''}건`,
        });
      } else if (e.event === 'DONE') {
        setToast({
          text:
            `목적 ${e.filled}건을 채웠습니다` +
            (e.remaining > 0 ? ` · ${e.remaining}건 남음 (다시 누르면 이어서)` : ''),
          undo: touched.length ? () => clearPurposes(touched, '되돌렸습니다') : undefined,
        });
      } else {
        failed = e.message;
      }
    });
    // 스트림은 이미 200 으로 열린 뒤라 실패가 프레임으로 온다. 평소의 오류 자리에
    // 보이도록 여기서 다시 던진다.
    if (failed) throw new Error(failed);
  });


  function duplicate(c: TestCase) {
    setDraft(toFields(parseCaseInput(c.input_data), c.expected_output, c.case_type, c.eval_criteria));
    setAdding(true);
    setEditId(null);
  }

  function openEdit(c: TestCase) {
    setEditId((cur) => (cur === c.case_id ? null : c.case_id));
    setEdit(toFields(parseCaseInput(c.input_data), c.expected_output, c.case_type, c.eval_criteria));
  }

  function onImported(res: CaseBulkResult) {
    setToast({
      text:
        `케이스 ${res.created}건을 추가했습니다` +
        (res.folders_created.length
          ? ` · 새 폴더 ${res.folders_created.map((f) => `'${f}'`).join(', ')} 생성`
          : ''),
    });
    loadCases();
    reloadCats();
    reload();
    if (selDataset != null && !(selected?.description ?? '').trim()) autoPurpose(selDataset);
  }

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
              onClick={() => { setCreating((v) => !v); setNewName(''); setNewDesc(''); }}
            >
              {creating ? '취소' : '+ 새로 만들기'}
            </Button>
          </div>
          <ul className="max-h-[70vh] space-y-0.5 overflow-y-auto p-1.5">
            {creating && (
              <li className="px-0.5 pb-1 pt-0.5">
                {/* 수정 상자와 같은 모양 · 같은 순서다 — 만들 때 적는 목적과 나중에
                    고치는 목적은 같은 값이라, 칸이 다르게 생길 이유가 없다. */}
                <div className="rounded-sm border border-line bg-surface-2 p-2">
                  <Input
                    autoFocus
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') createDataset();
                      if (e.key === 'Escape') { setCreating(false); setNewName(''); setNewDesc(''); }
                    }}
                    placeholder="이름"
                    className="h-8 w-full text-sm"
                  />
                  <Textarea
                    value={newDesc}
                    onChange={(e) => setNewDesc(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Escape') { setCreating(false); setNewName(''); setNewDesc(''); } }}
                    rows={2}
                    placeholder="어떤 목적의 테스트인가 — 비워 두면 케이스를 넣을 때 LLM 이 채웁니다"
                    className="mt-1.5 w-full text-xs"
                  />
                  <div className="mt-1.5 flex items-center justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => { setCreating(false); setNewName(''); setNewDesc(''); }}
                    >
                      취소
                    </Button>
                    <Button variant="secondary" size="sm" disabled={busy || !newName.trim()} onClick={createDataset}>
                      만들기
                    </Button>
                  </div>
                </div>
              </li>
            )}
            {datasets.map((d) => {
              const on = selDataset === d.dataset_id;
              if (renameId === d.dataset_id) {
                return (
                  <li key={d.dataset_id} className="px-0.5 py-1">
                    {/* 이름과 목적을 한 자리에서 고친다 — 목적은 이름을 지을 때 같이
                        떠오르는 값이지, 따로 찾아 들어가 적게 되는 값이 아니다.
                        칸이 둘이라 blur 하나로 저장할 수 없어 저장/취소를 둔다. */}
                    <div className="rounded-sm border border-line bg-surface-2 p-2">
                      <Input
                        autoFocus
                        value={renameVal}
                        onChange={(e) => setRenameVal(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') saveDataset(d.dataset_id);
                          if (e.key === 'Escape') setRenameId(null);
                        }}
                        placeholder="이름"
                        className="h-8 w-full text-sm"
                      />
                      <Textarea
                        value={descVal}
                        onChange={(e) => setDescVal(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Escape') setRenameId(null); }}
                        rows={2}
                        placeholder="어떤 목적의 테스트인가"
                        className="mt-1.5 w-full text-xs"
                      />
                      <div className="mt-1.5 flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={busy || suggesting}
                          onClick={() => suggestPurpose(d.dataset_id)}
                          title="케이스를 LLM 에게 보여 주고 목적 한 줄을 받아 위 칸을 채웁니다 — 저장은 따로 눌러야 합니다"
                        >
                          {suggesting ? '요약 중…' : 'LLM 요약'}
                        </Button>
                        <span className="flex-1" />
                        <Button variant="ghost" size="sm" onClick={() => setRenameId(null)}>취소</Button>
                        <Button variant="secondary" size="sm" disabled={busy} onClick={() => saveDataset(d.dataset_id)}>
                          저장
                        </Button>
                      </div>
                    </div>
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
                      <span aria-hidden className={cn('w-0.5 shrink-0 self-stretch', on ? 'bg-primary' : 'bg-transparent')} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{d.dataset_nm}</span>
                        {/* 목적 한 줄. 이름 아래 잔글씨로 붙어서, 목록을 훑는 동안
                            '이게 무슨 데이터셋이었지' 를 열어 확인하지 않게 한다. */}
                        {!!(d.description ?? '').trim() && (
                          <span
                            className="mt-0.5 block truncate text-[11px] font-normal text-muted"
                            title={d.description ?? undefined}
                          >
                            {d.description}
                          </span>
                        )}
                      </span>
                      <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted group-hover:invisible">
                        {d.case_count ?? '—'}
                      </span>
                    </button>
                    {/* Row actions take the count's place on hover rather than
                        covering the name with an opaque strip. */}
                    <span className="absolute right-1.5 top-1/2 hidden -translate-y-1/2 items-center gap-0.5 group-hover:flex group-focus-within:flex">
                      <IconBtn title="이름 · 목적 수정" onClick={() => { setRenameId(d.dataset_id); setRenameVal(d.dataset_nm); setDescVal(d.description ?? ''); }}>
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
                {/* 제목 아래 목적 — 여기서는 자르지 않는다. 목록은 훑는 자리라 한 줄로
                    줄이지만, 열어 둔 데이터셋은 문장을 끝까지 읽을 자리다. */}
                {!!(selected.description ?? '').trim() && (
                  <p className="mt-1 text-[11.5px] leading-snug text-muted">{selected.description}</p>
                )}
                {/* 고르는 동안에는 같은 줄이 선택 도구로 바뀐다 — 목록 위에 막대를
                    끼워 넣으면 첫 체크 순간 목록이 한 줄 밀려 내려간다. */}
                {selecting ? (
                <div className="mt-2.5 flex flex-wrap items-center gap-2">
                  <label className="flex h-8 cursor-pointer items-center gap-2.5 text-xs text-muted">
                    <PickBox
                      label="전체 선택"
                      checked={allPicked}
                      indeterminate={!allPicked}
                      onChange={() => setPicked(allPicked ? new Set() : new Set(rows.map((r) => r.c.case_id)))}
                    />
                    <span><span className="font-semibold tabular-nums text-ink">{pickedRows.length}</span> / {rows.length}건</span>
                  </label>
                  <span className="ml-auto flex flex-wrap items-center gap-1.5">
                    <Select
                      value=""
                      disabled={busy}
                      onChange={(e) => { if (e.target.value) movePicked(e.target.value); }}
                      className="h-8 w-36 text-xs"
                    >
                      <option value="" disabled>폴더 이동</option>
                      {folderNames.map((f) => <option key={f} value={f}>{f}</option>)}
                      <option value={UNFILED}>폴더 없음</option>
                    </Select>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      onClick={() => fillPurposes(pickedRows.map((r) => r.c.case_id))}
                      title="고른 데이터 중 목적이 비어 있는 것만 채웁니다 — 정답지가 JSON 이면 정답지를 보고, 아니면 LLM 이"
                    >
                      목적 채우기
                    </Button>
                    {/* 지울 것이 있을 때만 선다. 목적이 하나도 없는 선택에 이 버튼이
                        서 있으면 누를 때마다 "0건을 지웠습니다" 만 돌아온다. */}
                    {pickedWithPurpose.length > 0 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        onClick={() => clearPurposes(pickedWithPurpose)}
                        title="고른 데이터의 목적을 지웁니다 — 채운 것이 어긋났을 때"
                      >
                        목적 지우기 <span className="font-mono tabular-nums text-muted">{pickedWithPurpose.length}</span>
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => downloadCases(pickedRows.map((r) => r.c), `선택${pickedRows.length}건`)}
                    >
                      내려받기
                    </Button>
                    <DeleteButton label={`${pickedRows.length}건 삭제`} onConfirm={delPicked} />
                    <Button variant="ghost" size="sm" onClick={() => setPicked(new Set())}>해제</Button>
                  </span>
                </div>
                ) : (
                <div className="mt-2.5 flex flex-wrap items-center gap-2">
                  <Input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="질문 · 정답 · 목적 검색"
                    className="h-8 w-44 text-xs"
                  />
                  {/* 채울 것이 남아 있을 때만 선다 — 다 찬 데이터셋에 늘 서 있으면
                      누를 일 없는 버튼이 검색창 옆자리를 계속 차지한다. */}
                  {noPurpose > 0 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      onClick={() => fillPurposes()}
                      title="목적이 비어 있는 데이터를 LLM 이 한 줄씩 채웁니다 — 같은 폴더의 데이터를 함께 보고 서로 다른 지점을 짚습니다"
                    >
                      목적 채우기 <span className="font-mono tabular-nums text-muted">{noPurpose}</span>
                    </Button>
                  )}
                  <span className="ml-auto inline-flex items-center overflow-hidden rounded-sm border border-line bg-surface">
                    <button
                      type="button" disabled={busy}
                      onClick={() => setImporting(true)}
                      className="h-8 px-2.5 text-xs text-ink transition-colors hover:bg-surface-3 disabled:opacity-50"
                    >
                      올리기
                    </button>
                    <button
                      type="button" disabled={inFolder.length === 0}
                      // 폴더를 고른 화면이면 그 폴더만 — 보고 있는 것이 받아진다.
                      onClick={() => downloadCases(inFolder, folder === null ? null : folderLabel(folder))}
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
                )}
              </div>

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
                <>
                <ul className="divide-y divide-line">
                  {groups.map(({ cat, items }) => {
                    const ids = items.map((i) => i.c.case_id);
                    const nPicked = ids.filter((id) => picked.has(id)).length;
                    return (
                    <Fragment key={cat}>
                      {/* 카테고리가 바뀌는 자리의 가로 구분선. 이름을 얹은 까닭은
                          선만으로는 무엇과 무엇이 갈렸는지 말하지 않기 때문이고,
                          폴더를 하나 고른 화면에는 갈릴 것이 없어 서지 않는다. */}
                      {folder === null && (
                        <li className="group/case flex items-center gap-2.5 border-b border-line bg-surface-2 px-4 py-1.5">
                          <span className={cn('flex transition-opacity', pickReveal)}>
                            <PickBox
                              label={`${folderLabel(cat)} 전체 선택`}
                              checked={nPicked === ids.length}
                              indeterminate={nPicked > 0 && nPicked < ids.length}
                              onChange={() => togglePick(ids, nPicked < ids.length)}
                            />
                          </span>
                          <span className="text-[11px] font-semibold text-ink">{folderLabel(cat)}</span>
                          <span className="font-mono text-[10px] tabular-nums text-muted-soft">{items.length}</span>
                        </li>
                      )}
                      {items.map(({ c, p, n }) => {
                        const open = editId === c.case_id;
                        const on = picked.has(c.case_id);
                        const gt = (p.groundTruth ?? c.expected_output ?? '').trim();
                        return (
                          <li key={c.case_id}>
                            <div className={cn('group/case flex items-start transition-colors hover:bg-surface-2/60', on && 'bg-surface-2/70')}>
                              <label className={cn('flex shrink-0 cursor-pointer pb-2.5 pl-4 pr-1 pt-[13px] transition-opacity', pickReveal)}>
                                <PickBox label="선택" checked={on} onChange={() => togglePick([c.case_id], !on)} />
                              </label>
                              {/* 질문과 정답 두 칸은 줄마다 같은 자리에서 시작한다 —
                                  정답 칸은 길이와 상관없이 제 칸 왼쪽 끝에서 시작. */}
                              <button
                                type="button"
                                onClick={() => openEdit(c)}
                                className="grid min-w-0 flex-1 grid-cols-[14px_22px_minmax(0,1fr)_minmax(0,1fr)] items-start gap-x-2.5 py-2.5 pl-2 pr-4 text-left"
                              >
                                <Chevron open={open} className="mt-0.5" />
                                <span className="mt-px font-mono text-[11px] tabular-nums text-muted">{n}</span>
                                <span className={cn('min-w-0 text-sm text-ink', open ? 'break-words font-medium' : 'truncate')}>
                                  {p.question || <span className="text-muted">(질문 없음)</span>}
                                </span>
                                <span className="mt-0.5 min-w-0 truncate text-xs text-muted">
                                  {open ? '' : gt ? oneLine(gt) : <span className="text-muted-soft">정답 없음</span>}
                                </span>
                                {/* 목적은 질문·정답 아래를 가로질러 한 줄로 깔린다. 칸을
                                    하나 더 세우면 이미 잘리고 있는 질문과 정답이 더
                                    좁아지고, 목적은 둘 중 어느 쪽의 부연도 아니다.
                                    왼쪽 세로선이 이 줄을 질문에 딸린 것으로 묶어 준다. */}
                                {!open && !!c.eval_criteria?.trim() && (
                                  <span className="col-start-3 col-span-2 mt-1 min-w-0 truncate border-l-2 border-line-strong pl-2 text-[11px] text-muted">
                                    {oneLine(c.eval_criteria)}
                                  </span>
                                )}
                              </button>
                            </div>
                            {open && (
                              <div className="px-4 pb-3.5 pl-[4.5rem]">
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
                    </Fragment>
                    );
                  })}
                </ul>
                </>
              )}
            </>
          )}
        </Card>
      </div>

      {toast && (
        <div
          role="status"
          onMouseEnter={() => setToastHover(true)}
          onMouseLeave={() => setToastHover(false)}
          className="fixed bottom-[calc(1.5rem+env(safe-area-inset-bottom,0px))] left-1/2 z-40 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-2.5 rounded-md border border-line bg-surface py-2.5 pl-3.5 pr-2 text-sm text-ink shadow-modal"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden className="shrink-0 text-ok">
            <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.4" />
            <path d="M5.25 8.25 7.1 10l3.65-4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="min-w-0 truncate pr-1.5">{toast.text}</span>
          {toast.undo && (
            <button
              type="button"
              disabled={busy}
              onClick={toast.undo}
              className="shrink-0 rounded-sm border-l border-line px-2.5 py-0.5 text-[13px] font-medium text-accent transition-colors hover:text-accent-deep disabled:opacity-50"
            >
              되돌리기
            </button>
          )}
          <button
            type="button"
            aria-label="닫기"
            onClick={() => setToast(null)}
            className="shrink-0 rounded-full p-1 text-muted-soft transition-colors hover:bg-surface-3 hover:text-ink"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {importing && selected && (
        <CaseImportModal
          datasetId={selected.dataset_id}
          datasetName={selected.dataset_nm}
          onClose={() => setImporting(false)}
          onSaved={onImported}
        />
      )}
    </div>
  );
}
