'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import TopBar from '@/components/ui/TopBar';
import Modal from '@/components/ui/Modal';
import { api, ApiError } from '@/lib/api';
import type {
  AuditLog,
  PromptVersionDetail,
  PromptVersionSummary,
} from '@/types';

type Tab = 'editor' | 'history';

export default function NodePromptsPage() {
  const params = useParams<{ nodeId: string }>();
  const nodeId = Number(params.nodeId);
  const router = useRouter();

  const [versions, setVersions] = useState<PromptVersionSummary[]>([]);
  const [detail, setDetail] = useState<PromptVersionDetail | null>(null);
  const [tab, setTab] = useState<Tab>('editor');
  const [error, setError] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [confirmActivate, setConfirmActivate] = useState<PromptVersionSummary | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(
    async (selectId?: number) => {
      try {
        const rows = await api.get<PromptVersionSummary[]>(`/nodes/${nodeId}/prompts`);
        setVersions(rows);
        const pick = selectId ?? rows.find((r) => r.is_active === 'Y')?.prompt_id ?? rows[0]?.prompt_id;
        if (pick) setDetail(await api.get<PromptVersionDetail>(`/prompts/${pick}`));
        else setDetail(null);
      } catch (e) {
        setError(e instanceof ApiError ? JSON.stringify(e.detail) : String(e));
      }
    },
    [nodeId],
  );

  useEffect(() => {
    reload();
  }, [reload]);

  const nodeNm = versions[0]?.node_nm ?? detail?.node_nm ?? `#${nodeId}`;

  async function selectVersion(id: number) {
    setDetail(await api.get<PromptVersionDetail>(`/prompts/${id}`));
    setTab('editor');
  }

  async function doActivate() {
    if (!confirmActivate) return;
    setBusy(true);
    try {
      await api.put(`/prompts/${confirmActivate.prompt_id}/activate`);
      setConfirmActivate(null);
      await reload(confirmActivate.prompt_id);
    } catch (e) {
      setError(e instanceof ApiError ? JSON.stringify(e.detail) : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-screen flex-col bg-slate-50">
      <TopBar
        title={`노드: ${nodeNm}`}
        right={
          <button
            onClick={() => router.push('/')}
            className="rounded-md border-2 border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-100"
          >
            ← 그래프
          </button>
        }
      />

      {error && (
        <div className="m-4 rounded-md border-2 border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">
          {error}
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* version list */}
        <aside className="w-80 overflow-auto border-r-2 border-slate-200 bg-white p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-extrabold text-slate-700">버전</h2>
            <button
              onClick={() => setShowNew(true)}
              className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-bold text-white hover:bg-blue-700"
            >
              + 새 버전
            </button>
          </div>
          <ul className="space-y-2">
            {versions.map((v) => (
              <li key={v.prompt_id}>
                <button
                  onClick={() => selectVersion(v.prompt_id)}
                  className={
                    'w-full rounded-lg border-2 p-3 text-left transition ' +
                    (detail?.prompt_id === v.prompt_id
                      ? 'border-blue-500 bg-blue-50'
                      : 'border-slate-200 hover:border-slate-400')
                  }
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-sm font-bold">v{v.version_no}</span>
                    {v.is_active === 'Y' && (
                      <span className="rounded bg-emerald-600 px-2 py-0.5 text-xs font-bold text-white">
                        ACTIVE
                      </span>
                    )}
                  </div>
                  {v.change_summary && (
                    <div className="mt-1 truncate text-xs font-medium text-slate-500">
                      {v.change_summary}
                    </div>
                  )}
                </button>
              </li>
            ))}
            {versions.length === 0 && (
              <li className="text-sm text-slate-400">버전이 없습니다. 새 버전을 만드세요.</li>
            )}
          </ul>
        </aside>

        {/* detail */}
        <main className="flex flex-1 flex-col overflow-hidden">
          {detail ? (
            <>
              <div className="flex items-center justify-between border-b-2 border-slate-200 bg-white px-6 py-3">
                <div className="flex items-center gap-2">
                  {(['editor', 'history'] as Tab[]).map((t) => (
                    <button
                      key={t}
                      onClick={() => setTab(t)}
                      className={
                        'rounded-md px-3 py-1.5 text-sm font-bold ' +
                        (tab === t ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-100')
                      }
                    >
                      {t === 'editor' ? '내용' : '변경 이력'}
                    </button>
                  ))}
                </div>
                {detail.is_active !== 'Y' && (
                  <button
                    onClick={() => setConfirmActivate(detail)}
                    className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-700"
                  >
                    이 버전 활성화
                  </button>
                )}
              </div>

              <div className="flex-1 overflow-auto p-6">
                {tab === 'editor' && (
                  <EditorTab detail={detail} onSaved={() => reload(detail.prompt_id)} />
                )}
                {tab === 'history' && <HistoryTab nodeId={nodeId} />}
              </div>
            </>
          ) : (
            <div className="p-8 text-sm text-slate-400">버전을 선택하거나 새로 만드세요.</div>
          )}
        </main>
      </div>

      {showNew && (
        <NewVersionModal
          nodeId={nodeId}
          base={detail}
          onClose={() => setShowNew(false)}
          onCreated={async (id) => {
            setShowNew(false);
            await reload(id);
          }}
        />
      )}

      <Modal
        open={!!confirmActivate}
        title="버전 활성화"
        onClose={() => setConfirmActivate(null)}
        footer={
          <>
            <button
              onClick={() => setConfirmActivate(null)}
              className="rounded-md border-2 border-slate-300 px-4 py-2 text-sm font-bold"
            >
              취소
            </button>
            <button
              onClick={doActivate}
              disabled={busy}
              className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
            >
              활성화
            </button>
          </>
        }
      >
        <p className="text-sm text-slate-700">
          <span className="font-bold">v{confirmActivate?.version_no}</span> 을(를) 활성화합니다.
        </p>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-slate-600">
          <li>운영 테이블 <span className="font-mono">NODE_MAS.PROMPT</span> 에 즉시 반영됩니다.</li>
          <li>전체 플로우 버전이 한 단계 올라갑니다.</li>
        </ul>
      </Modal>
    </div>
  );
}

function EditorTab({
  detail,
  onSaved,
}: {
  detail: PromptVersionDetail;
  onSaved: () => void;
}) {
  const locked = detail.is_active === 'Y';
  const [system, setSystem] = useState(detail.system_prompt ?? '');
  const [user, setUser] = useState(detail.user_prompt ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setSystem(detail.system_prompt ?? '');
    setUser(detail.user_prompt ?? '');
    setErr(null);
  }, [detail.prompt_id, detail.system_prompt, detail.user_prompt]);

  const dirty = system !== (detail.system_prompt ?? '') || user !== (detail.user_prompt ?? '');

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      await api.put(`/prompts/${detail.prompt_id}`, { system_prompt: system, user_prompt: user });
      onSaved();
    } catch (e) {
      setErr(e instanceof ApiError ? JSON.stringify(e.detail) : String(e));
    } finally {
      setBusy(false);
    }
  }

  const boxClass =
    'min-h-[24vh] flex-1 w-full rounded-lg border-2 p-4 font-mono text-sm ' +
    (locked ? 'border-slate-200 bg-slate-50 text-slate-700' : 'border-slate-300 bg-white');

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded bg-slate-200 px-2 py-1 font-bold">모델: {detail.model_nm ?? '-'}</span>
        {detail.change_summary && (
          <span className="rounded bg-slate-100 px-2 py-1">요약: {detail.change_summary}</span>
        )}
        {locked ? (
          <span className="rounded bg-emerald-100 px-2 py-1 font-bold text-emerald-700">
            활성 버전 — 잠금 (편집하려면 새 버전 생성)
          </span>
        ) : (
          <span className="rounded bg-amber-100 px-2 py-1 font-bold text-amber-700">
            비활성 버전 — 편집 가능
          </span>
        )}
      </div>
      {err && <div className="rounded bg-red-50 p-2 text-xs text-red-700">{err}</div>}
      <div className="flex flex-1 flex-col gap-3 overflow-auto">
        <label className="flex flex-1 flex-col">
          <span className="mb-1 text-sm font-bold text-slate-700">
            시스템 프롬프트 <span className="font-normal text-slate-400">(활성화 시 NODE_MAS.PROMPT 로 반영)</span>
          </span>
          <textarea
            value={system}
            readOnly={locked}
            onChange={(e) => setSystem(e.target.value)}
            className={boxClass}
          />
        </label>
        <label className="flex flex-1 flex-col">
          <span className="mb-1 text-sm font-bold text-slate-700">
            유저 프롬프트 <span className="font-normal text-slate-400">(테스트 메시지 템플릿, 변수: {'{{name}}'})</span>
          </span>
          <textarea
            value={user}
            readOnly={locked}
            onChange={(e) => setUser(e.target.value)}
            className={boxClass}
          />
        </label>
      </div>
      {!locked && (
        <div className="flex justify-end">
          <button
            onClick={save}
            disabled={!dirty || busy}
            className="rounded-md bg-blue-600 px-5 py-2 text-sm font-bold text-white disabled:opacity-50"
          >
            {busy ? '저장 중...' : '프롬프트 저장'}
          </button>
        </div>
      )}
    </div>
  );
}

const ACTION_META: Record<string, { label: string; cls: string }> = {
  CREATE: { label: '생성', cls: 'bg-blue-600' },
  UPDATE: { label: '수정', cls: 'bg-amber-600' },
  ACTIVATE: { label: '활성화', cls: 'bg-emerald-600' },
  FLOW_VERSION: { label: '플로우 버전', cls: 'bg-indigo-600' },
  DELETE: { label: '삭제', cls: 'bg-red-600' },
};

function parseJson(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const str = (v: unknown): string => (v == null ? '' : String(v));

/** Fields that hold long prompt text — rendered as before→after <pre> blocks. */
const TEXT_FIELDS = ['system_prompt', 'user_prompt'];
const FIELD_LABEL: Record<string, string> = {
  system_prompt: '시스템 프롬프트',
  user_prompt: '유저 프롬프트',
  version_no: '버전',
  change_summary: '변경 요약',
  change_reason: '변경 사유',
  active_version_no: '활성 버전',
  flow_version_no: '플로우 버전',
  summary: '요약',
};

function AuditDetail({ log }: { log: AuditLog }) {
  const before = parseJson(log.before_value);
  const after = parseJson(log.after_value);
  const keys = Array.from(
    new Set([...(before ? Object.keys(before) : []), ...(after ? Object.keys(after) : [])]),
  ).filter((k) => !['prompt_id', 'node_mas_id', 'node_nm', 'active_prompt_id'].includes(k));

  if (!keys.length) {
    // Unstructured payload — fall back to raw JSON so nothing is hidden.
    if (!log.before_value && !log.after_value) return null;
    return (
      <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-slate-50 p-2 text-xs text-slate-600">
        {log.after_value ?? log.before_value}
      </pre>
    );
  }

  return (
    <dl className="mt-2 space-y-2">
      {keys.map((k) => {
        const b = str(before?.[k]);
        const a = str(after?.[k]);
        if (!b && !a) return null;
        const label = FIELD_LABEL[k] ?? k;
        if (TEXT_FIELDS.includes(k)) {
          const changed = b !== a;
          return (
            <div key={k}>
              <dt className="text-xs font-bold text-slate-600">{label}</dt>
              <dd className="mt-0.5 grid gap-1">
                {changed && b && (
                  <pre className="max-h-28 overflow-auto whitespace-pre-wrap rounded border border-red-200 bg-red-50 p-2 text-xs text-red-800">
                    − {b}
                  </pre>
                )}
                <pre className="max-h-28 overflow-auto whitespace-pre-wrap rounded border border-emerald-200 bg-emerald-50 p-2 text-xs text-emerald-900">
                  {changed && b ? '+ ' : ''}{a || '(빈 값)'}
                </pre>
              </dd>
            </div>
          );
        }
        return (
          <div key={k} className="flex gap-2 text-xs">
            <dt className="font-bold text-slate-600">{label}:</dt>
            <dd className="text-slate-800">{b && a && b !== a ? `${b} → ${a}` : a || b}</dd>
          </div>
        );
      })}
    </dl>
  );
}

function HistoryTab({ nodeId }: { nodeId: number }) {
  const [logs, setLogs] = useState<AuditLog[] | null>(null);
  useEffect(() => {
    api.get<AuditLog[]>(`/nodes/${nodeId}/audit-logs?limit=100`).then(setLogs).catch(() => setLogs([]));
  }, [nodeId]);
  if (logs === null) return <div className="text-sm text-slate-400">불러오는 중...</div>;
  if (!logs.length) return <div className="text-sm text-slate-400">변경 이력이 없습니다.</div>;
  return (
    <ul className="space-y-3">
      {logs.map((l) => {
        const meta = ACTION_META[l.action] ?? { label: l.action, cls: 'bg-slate-900' };
        return (
          <li key={l.log_id} className="rounded-lg border-2 border-slate-200 bg-white p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded px-2 py-0.5 text-xs font-bold text-white ${meta.cls}`}>
                {meta.label}
              </span>
              <span className="text-xs font-bold text-slate-700">{l.created_by}</span>
              <span className="font-mono text-xs text-slate-400">{l.target_table}#{l.target_id}</span>
              <span className="ml-auto text-xs text-slate-400">{l.created_dt}</span>
            </div>
            <AuditDetail log={l} />
          </li>
        );
      })}
    </ul>
  );
}

function NewVersionModal({
  nodeId,
  base,
  onClose,
  onCreated,
}: {
  nodeId: number;
  base: PromptVersionDetail | null;
  onClose: () => void;
  onCreated: (promptId: number) => void;
}) {
  const [system, setSystem] = useState(base?.system_prompt ?? '');
  const [user, setUser] = useState(base?.user_prompt ?? '');
  const [summary, setSummary] = useState('');
  const [reason, setReason] = useState('');
  const [activate, setActivate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const valid = useMemo(
    () => (system.trim() || user.trim()) && summary.trim() && reason.trim(),
    [system, user, summary, reason],
  );

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      const created = await api.post<PromptVersionDetail>(`/nodes/${nodeId}/prompts`, {
        system_prompt: system,
        user_prompt: user,
        change_summary: summary,
        change_reason: reason,
        activate_after_save: activate,
      });
      onCreated(created.prompt_id);
    } catch (e) {
      setErr(e instanceof ApiError ? JSON.stringify(e.detail) : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      title="새 프롬프트 버전"
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} className="rounded-md border-2 border-slate-300 px-4 py-2 text-sm font-bold">
            취소
          </button>
          <button
            onClick={save}
            disabled={!valid || busy}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
          >
            저장
          </button>
        </>
      }
    >
      {err && <div className="mb-3 rounded bg-red-50 p-2 text-xs text-red-700">{err}</div>}
      <label className="mb-3 block">
        <span className="text-sm font-bold text-slate-700">
          시스템 프롬프트 <span className="font-normal text-slate-400">(활성화 시 NODE_MAS.PROMPT 로 반영)</span>
        </span>
        <textarea
          value={system}
          onChange={(e) => setSystem(e.target.value)}
          rows={7}
          className="mt-1 w-full rounded-md border-2 border-slate-300 p-3 font-mono text-sm"
        />
      </label>
      <label className="mb-3 block">
        <span className="text-sm font-bold text-slate-700">
          유저 프롬프트 <span className="font-normal text-slate-400">(테스트 메시지 템플릿, 변수: {'{{name}}'})</span>
        </span>
        <textarea
          value={user}
          onChange={(e) => setUser(e.target.value)}
          rows={6}
          className="mt-1 w-full rounded-md border-2 border-slate-300 p-3 font-mono text-sm"
        />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="text-sm font-bold text-slate-700">변경 요약 *</span>
          <input
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            className="mt-1 w-full rounded-md border-2 border-slate-300 p-2 text-sm"
          />
        </label>
        <label className="block">
          <span className="text-sm font-bold text-slate-700">변경 사유 *</span>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="mt-1 w-full rounded-md border-2 border-slate-300 p-2 text-sm"
          />
        </label>
      </div>
      <label className="mt-3 flex items-center gap-2 text-sm font-bold text-slate-700">
        <input type="checkbox" checked={activate} onChange={(e) => setActivate(e.target.checked)} />
        저장 후 즉시 활성화 (NODE_MAS 반영 + 플로우 버전 ↑)
      </label>
    </Modal>
  );
}
