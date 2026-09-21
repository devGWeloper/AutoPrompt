'use client';

import { useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react';
import { Button } from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import type { CaseBulkResult } from '@/lib/types';
import { downloadBytes, readXlsx, writeXlsx, XLSX_MIME } from '@/lib/xlsx';
import { EMPTY, parseCaseInput, toPayload, type Fields } from './caseFields';
import { DatasetSelect, DownloadIcon, ErrBox, errText, UNFILED, useDatasetCategories, useFlowDatasets } from './shared';

type Key = keyof Fields;

/**
 * The template, the paste grid and CSV all use these columns in this order.
 * `names` are other headers recognised on a pasted or opened header row — the
 * old CSV column names are among them, so an exported file still goes back in.
 */
const COLS: { key: Key; label: string; names: string[]; width: string; xlsxWidth: number }[] = [
  { key: 'question', label: '질문', names: ['question', 'input_json', 'input', 'message'], width: 'w-[30%]', xlsxWidth: 50 },
  { key: 'contexts', label: 'Contexts', names: ['context'], width: 'w-[18%]', xlsxWidth: 40 },
  { key: 'groundTruth', label: '정답', names: ['ground_truth', 'expected_output', '기대답변'], width: 'w-[26%]', xlsxWidth: 50 },
  { key: 'criteria', label: '목적', names: ['eval_criteria', 'criteria', '평가기준', '기준'], width: 'w-[14%]', xlsxWidth: 34 },
  { key: 'category', label: '폴더', names: ['folder', 'case_type', 'category', '카테고리'], width: 'w-[12%]', xlsxWidth: 18 },
];

const MIN_ROWS = 10;
const MAX_ROWS = 2000;
/** How far down the template's folder dropdown reaches. */
const TEMPLATE_ROWS = 1000;
const LIST_ID = 'case-import-folders';

const norm = (s: string) => s.trim().toLowerCase().replace(/[\s*()]/g, '');

function keyOf(header: string): Key | null {
  const h = norm(header);
  if (!h) return null;
  return COLS.find((c) => norm(c.label) === h || c.names.some((n) => norm(n) === h))?.key ?? null;
}

/** Column keys when the first row is a header row, otherwise null. */
function headerKeys(cells: string[] | undefined): (Key | null)[] | null {
  if (!cells) return null;
  const keys = cells.map(keyOf);
  return keys.some(Boolean) ? keys : null;
}

/** RFC-4180-style split with a chosen separator. Excel's clipboard is the same
 * shape with tabs: a cell holding a line break or quote comes wrapped in quotes. */
function parseDelimited(text: string, sep: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let fresh = true; // at the start of a cell, where an opening quote is legal
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch !== '"') field += ch;
      else if (text[i + 1] === '"') { field += '"'; i++; }
      else quoted = false;
    } else if (ch === '"' && fresh) {
      quoted = true;
      fresh = false;
    } else if (ch === sep) {
      row.push(field); field = ''; fresh = true;
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row);
      row = []; field = ''; fresh = true;
    } else {
      field += ch;
      fresh = false;
    }
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const isBlank = (f: Fields) => COLS.every((c) => !f[c.key].trim());

/** Drop trailing blank rows, then pad so there is always room to type below. */
function normalize(rows: Fields[]): Fields[] {
  let n = rows.length;
  while (n && isBlank(rows[n - 1])) n--;
  const out = rows.slice(0, n);
  const want = Math.max(MIN_ROWS, n + 1);
  while (out.length < want) out.push({ ...EMPTY });
  return out;
}

function clean(key: Key, v: string): string {
  const s = v.replace(/\r\n?/g, '\n');
  if (key !== 'category') return s;
  const t = s.trim();
  return t.toUpperCase() === UNFILED || t === '폴더 없음' ? '' : t;
}

/** A question cell holding a whole INPUT_CTN payload (an old CSV's input_json)
 * is unpacked into its columns rather than saved as a question made of JSON. */
function expand(f: Fields): Fields {
  if (!f.question.trim().startsWith('{')) return f;
  const p = parseCaseInput(f.question);
  if (!p.question) return f;
  return {
    ...f,
    question: p.question,
    contexts: f.contexts || p.contexts.join('\n'),
    groundTruth: f.groundTruth || (p.groundTruth ?? ''),
  };
}

/**
 * The one workbook shape for cases: the empty template and a dataset's download
 * are the same file, so whatever is downloaded can be edited and pasted back.
 */
export function casesWorkbook(rows: Fields[], folders: string[]): Uint8Array {
  const catCol = COLS.findIndex((x) => x.key === 'category');
  return writeXlsx([
    {
      name: '케이스',
      rows: [COLS.map((x) => x.label), ...rows.map((f) => COLS.map((x) => f[x.key]))],
      widths: COLS.map((x) => x.xlsxWidth),
      header: true,
      list: folders.length
        ? { col: catCol, sheet: '폴더', count: folders.length, toRow: rows.length + TEMPLATE_ROWS }
        : undefined,
    },
    ...(folders.length ? [{ name: '폴더', rows: folders.map((f) => [f]), widths: [24] }] : []),
  ]);
}

const CELL =
  'block h-8 w-full bg-transparent px-2 py-1.5 leading-5 text-ink placeholder:text-muted-soft ' +
  'focus:bg-surface focus:outline focus:outline-2 focus:-outline-offset-2 focus:outline-accent';

/**
 * Add many cases at once: paste straight from Excel into a sheet-like grid,
 * check it, save. Opened from a dataset (target fixed) or from a run record
 * (rows pre-filled, target chosen here).
 */
export default function CaseImportModal({
  datasetId, datasetName, initialRows, title = '케이스 올리기', onClose, onSaved,
}: {
  datasetId?: number;
  datasetName?: string;
  initialRows?: Fields[];
  title?: string;
  onClose: () => void;
  onSaved: (res: CaseBulkResult, target: { id: number; name: string }) => void;
}) {
  const fixed = datasetId != null;
  const { datasets } = useFlowDatasets();
  const [target, setTarget] = useState<number | null>(datasetId ?? null);
  const { cats } = useDatasetCategories(target);
  const folders = cats.filter((c) => c.type_id !== null).map((c) => c.type_cd);
  const [rows, setRows] = useState<Fields[]>(() => normalize((initialRows ?? []).map(expand)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const filled = rows.filter((f) => !isBlank(f));
  const missing = filled.filter((f) => !f.question.trim()).length;
  const newFolders = Array.from(new Set(filled.map((f) => f.category.trim()).filter((c) => c && !folders.includes(c))));
  const targetName = fixed ? datasetName ?? '' : datasets.find((d) => d.dataset_id === target)?.dataset_nm ?? '';

  function setCell(r: number, key: Key, v: string) {
    setRows((cur) => {
      const next = cur.slice();
      next[r] = { ...next[r], [key]: v };
      return normalize(next);
    });
  }

  function fill(grid: string[][], keys: (Key | null)[], r0: number) {
    setRows((cur) => {
      const next = cur.slice();
      grid.slice(0, MAX_ROWS).forEach((cells, i) => {
        const at = r0 + i;
        while (next.length <= at) next.push({ ...EMPTY });
        const row = { ...next[at] };
        cells.forEach((v, j) => {
          const k = keys[j];
          if (k) row[k] = clean(k, v);
        });
        next[at] = expand(row);
      });
      return normalize(next.slice(0, MAX_ROWS));
    });
  }

  function onPaste(e: ClipboardEvent<HTMLElement>, r: number, c: number) {
    const body = e.clipboardData.getData('text/plain').replace(/[\r\n]+$/, '');
    // One plain value is an ordinary paste into this cell.
    if (!/[\t\r\n]/.test(body)) return;
    e.preventDefault();
    const grid = parseDelimited(body, '\t');
    const header = headerKeys(grid[0]);
    if (header) fill(grid.slice(1), header, r);
    else fill(grid, COLS.slice(c).map((x) => x.key), r);
  }

  function focusCell(r: number, c: number) {
    requestAnimationFrame(() => {
      gridRef.current?.querySelector<HTMLElement>(`[data-cell="${r}-${c}"]`)?.focus();
    });
  }

  // Enter moves down like a sheet; Alt/Shift+Enter breaks the line inside a cell.
  function onKey(e: KeyboardEvent<HTMLTextAreaElement | HTMLInputElement>, r: number, c: number) {
    if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
    e.preventDefault();
    const el = e.currentTarget;
    if ((e.altKey || e.shiftKey) && el instanceof HTMLTextAreaElement) {
      const s = el.selectionStart;
      setCell(r, COLS[c].key, `${el.value.slice(0, s)}\n${el.value.slice(el.selectionEnd)}`);
      requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = s + 1; });
      return;
    }
    focusCell(r + 1, c);
  }

  async function openFile(file: File) {
    setError(null);
    let raw: string[][];
    try {
      raw = /\.xlsx$/i.test(file.name)
        ? await readXlsx(await file.arrayBuffer())
        : parseDelimited((await file.text()).replace(/^﻿/, ''), ',');
    } catch (e) {
      setError(errText(e));
      return;
    }
    const grid = raw.filter((row) => row.some((v) => v.trim()));
    if (!grid.length) return;
    const header = headerKeys(grid[0]);
    let n = rows.length;
    while (n && isBlank(rows[n - 1])) n--;
    fill(header ? grid.slice(1) : grid, header ?? COLS.map((x) => x.key), n);
  }

  function downloadTemplate() {
    downloadBytes(`${targetName || '데이터셋'}_템플릿.xlsx`, casesWorkbook([], folders), XLSX_MIME);
  }

  async function save() {
    if (target == null) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<CaseBulkResult>(`/datasets/${target}/cases/bulk`, {
        cases: filled.map((f) => toPayload(f)),
      });
      onSaved(res, { id: target, name: targetName });
      onClose();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      title={title}
      onClose={onClose}
      width="w-[1100px]"
      footer={
        <>
          <span className="mr-auto flex items-center gap-3 self-center text-xs text-muted">
            <span><span className="font-semibold tabular-nums text-ink">{filled.length}</span>건</span>
            {newFolders.length > 0 && <span title={newFolders.join(', ')}>새 폴더 {newFolders.length}</span>}
            {missing > 0 && <span className="text-bad">질문 없음 {missing}</span>}
          </span>
          <Button variant="ghost" size="sm" onClick={onClose}>취소</Button>
          <Button
            size="sm"
            disabled={busy || target == null || filled.length === 0 || missing > 0}
            onClick={save}
          >
            {busy ? '저장 중…' : '저장'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {error && <ErrBox msg={error} />}
        <div className="flex flex-wrap items-center gap-2">
          {fixed
            ? <span className="text-sm font-medium text-ink">{datasetName}</span>
            : <DatasetSelect datasets={datasets} value={target} onChange={setTarget} />}
          <span className="ml-auto flex items-center gap-1.5">
            <Button variant="ghost" size="sm" disabled={filled.length === 0} onClick={() => setRows(normalize([]))}>
              비우기
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = ''; // re-selecting the same file must fire again
                if (f) openFile(f);
              }}
            />
            <Button variant="ghost" size="sm" onClick={() => fileRef.current?.click()}>파일 열기</Button>
            <Button variant="secondary" size="sm" onClick={downloadTemplate}>
              <DownloadIcon /> 엑셀 템플릿
            </Button>
          </span>
        </div>

        <datalist id={LIST_ID}>
          {folders.map((f) => <option key={f} value={f} />)}
        </datalist>

        <div ref={gridRef} className="max-h-[55vh] overflow-auto rounded-sm border border-line">
          <table className="w-full min-w-[760px] table-fixed border-collapse text-[13px]">
            <colgroup>
              <col className="w-10" />
              {COLS.map((x) => <col key={x.key} className={x.width} />)}
              <col className="w-8" />
            </colgroup>
            <thead>
              <tr>
                <th className="sticky top-0 z-[2] border-b border-r border-line bg-surface-2" />
                {COLS.map((x) => (
                  <th
                    key={x.key}
                    className="sticky top-0 z-[2] border-b border-r border-line bg-surface-2 px-2 py-1.5 text-left text-[11px] font-semibold text-muted"
                  >
                    {x.label}
                    {x.key === 'question' && <span className="text-bad"> *</span>}
                  </th>
                ))}
                <th className="sticky top-0 z-[2] border-b border-line bg-surface-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((f, r) => {
                const blank = isBlank(f);
                return (
                  <tr key={r} className="group">
                    <td
                      className={cn(
                        'border-b border-r border-line bg-surface-2/60 text-center align-top font-mono text-[11px] leading-8 tabular-nums',
                        !blank && !f.question.trim() ? 'text-bad' : 'text-muted-soft',
                      )}
                    >
                      {r + 1}
                    </td>
                    {COLS.map((x, c) => {
                      const v = f[x.key];
                      if (x.key === 'category') {
                        const isNew = !!v.trim() && !folders.includes(v.trim());
                        return (
                          <td key={x.key} className="relative border-b border-r border-line p-0 align-top">
                            <input
                              data-cell={`${r}-${c}`}
                              list={LIST_ID}
                              value={v}
                              spellCheck={false}
                              onChange={(e) => setCell(r, x.key, e.target.value)}
                              onPaste={(e) => onPaste(e, r, c)}
                              onKeyDown={(e) => onKey(e, r, c)}
                              className={cn(CELL, isNew && 'pr-12')}
                            />
                            {isNew && (
                              <span className="pointer-events-none absolute right-1.5 top-2 rounded-sm bg-surface-3 px-1 text-[10px] text-muted">
                                새 폴더
                              </span>
                            )}
                          </td>
                        );
                      }
                      const lines = v ? v.split('\n').length : 0;
                      return (
                        <td key={x.key} className="relative border-b border-r border-line p-0 align-top">
                          <textarea
                            data-cell={`${r}-${c}`}
                            rows={1}
                            value={v}
                            spellCheck={false}
                            title={lines > 1 ? v : undefined}
                            onChange={(e) => setCell(r, x.key, e.target.value)}
                            onPaste={(e) => onPaste(e, r, c)}
                            onKeyDown={(e) => onKey(e, r, c)}
                            className={cn(CELL, 'resize-none overflow-hidden whitespace-pre', lines > 1 && 'pr-10')}
                          />
                          {lines > 1 && (
                            <span className="pointer-events-none absolute right-1.5 top-2 rounded-sm bg-surface-3 px-1 font-mono text-[10px] text-muted">
                              {lines}줄
                            </span>
                          )}
                        </td>
                      );
                    })}
                    <td className="border-b border-line p-0 text-center align-top">
                      {!blank && (
                        <button
                          type="button"
                          title="행 삭제"
                          aria-label="행 삭제"
                          onClick={() => setRows((cur) => normalize(cur.filter((_, i) => i !== r)))}
                          className="invisible h-8 w-full text-muted-soft transition-colors hover:text-bad group-hover:visible"
                        >
                          ×
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </Modal>
  );
}
