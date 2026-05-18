'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import TopBar from '@/components/ui/TopBar';
import VersionList from '@/components/prompts/VersionList';
import PromptEditor from '@/components/prompts/PromptEditor';
import VariablePanel from '@/components/prompts/VariablePanel';
import DiffViewer from '@/components/prompts/DiffViewer';
import HistoryList from '@/components/prompts/HistoryList';
import Modal from '@/components/ui/Modal';
import { api, ApiError } from '@/lib/api';
import type {
  PromptVersionCreate,
  PromptVersionDetail,
  PromptVersionSummary,
} from '@/types';

type Tab = 'editor' | 'variables' | 'diff' | 'history';

const VAR_RE = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;

export default function PromptsPage() {
  const params = useParams<{ projectId: string; nodeId: string }>();
  const router = useRouter();
  const projectId = Number(params.projectId);
  const nodeId = Number(params.nodeId);
  const admin = true; // auth removed — all actions permitted

  const [versions, setVersions] = useState<PromptVersionSummary[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<PromptVersionDetail | null>(null);
  const [tab, setTab] = useState<Tab>('editor');
  const [draftSystem, setDraftSystem] = useState('');
  const [draftUser, setDraftUser] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [showActivate, setShowActivate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reloadVersions = useCallback(async () => {
    const rows = await api.get<PromptVersionSummary[]>(`/nodes/${nodeId}/prompts`);
    setVersions(rows);
    if (rows.length > 0 && selectedId === null) {
      const active = rows.find((r) => r.is_active === 'Y') || rows[0];
      setSelectedId(active.prompt_id);
    }
  }, [nodeId, selectedId]);

  useEffect(() => {
    reloadVersions();
  }, [reloadVersions]);

  useEffect(() => {
    if (selectedId === null) return;
    api.get<PromptVersionDetail>(`/prompts/${selectedId}`).then((d) => {
      setDetail(d);
      setDraftSystem(d.system_prompt ?? '');
      setDraftUser(d.user_prompt ?? '');
    });
  }, [selectedId]);

  const detectedVars = useMemo(() => {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const text of [draftSystem, draftUser]) {
      for (const m of text.matchAll(VAR_RE)) {
        if (!seen.has(m[1])) {
          seen.add(m[1]);
          out.push(m[1]);
        }
      }
    }
    return out;
  }, [draftSystem, draftUser]);

  async function handleActivate() {
    if (!detail) return;
    setBusy(true);
    setError(null);
    try {
      await api.put(`/prompts/${detail.prompt_id}/activate`);
      await reloadVersions();
      setShowActivate(false);
    } catch (e) {
      setError(e instanceof ApiError ? String(e.detail) : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleRollback() {
    if (!detail?.prev_prompt_id) return;
    setBusy(true);
    setError(null);
    try {
      await api.put(`/prompts/${detail.prev_prompt_id}/activate`);
      await reloadVersions();
      setSelectedId(detail.prev_prompt_id);
    } catch (e) {
      setError(e instanceof ApiError ? String(e.detail) : String(e));
    } finally {
      setBusy(false);
    }
  }

  const currentActive = versions.find((v) => v.is_active === 'Y') ?? null;

  return (
    <div className="flex h-screen flex-col">
      <TopBar
        title={`Node #${nodeId} — Prompts`}
        right={
          <div className="flex gap-2">
            <button
              onClick={() => router.push(`/projects/${projectId}/nodes/${nodeId}/test`)}
              className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50"
            >
              Test
            </button>
            <button
              onClick={() => router.push(`/projects/${projectId}/graph`)}
              className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50"
            >
              Back to graph
            </button>
          </div>
        }
      />
      <div className="flex flex-1 overflow-hidden">
        <aside className="w-72 overflow-y-auto border-r border-slate-200 bg-slate-50 p-3">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Versions</h2>
            <button
              onClick={() => setShowCreate(true)}
              className="rounded bg-slate-900 px-2 py-1 text-xs text-white hover:bg-slate-800"
            >
              + New
            </button>
          </div>
          <VersionList versions={versions} selectedId={selectedId} onSelect={setSelectedId} />
        </aside>
        <section className="flex flex-1 flex-col overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-2">
            <div className="flex gap-2 text-sm">
              {(['editor', 'variables', 'diff', 'history'] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`rounded px-2 py-1 ${
                    tab === t ? 'bg-slate-900 text-white' : 'hover:bg-slate-100'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              {detail && detail.is_active !== 'Y' && admin && (
                <button
                  onClick={() => setShowActivate(true)}
                  className="rounded bg-emerald-600 px-3 py-1 text-xs text-white hover:bg-emerald-700"
                >
                  Activate this version
                </button>
              )}
              {detail && detail.is_active === 'Y' && detail.prev_prompt_id && admin && (
                <button
                  onClick={handleRollback}
                  disabled={busy}
                  className="rounded border border-amber-500 px-3 py-1 text-xs text-amber-600 hover:bg-amber-50 disabled:opacity-50"
                >
                  Rollback to v{versions.find((v) => v.prompt_id === detail.prev_prompt_id)?.version_no || '?'}
                </button>
              )}
            </div>
          </div>
          {error && <div className="bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>}
          <div className="flex-1 overflow-y-auto p-4">
            {detail === null ? (
              <div className="text-sm text-slate-500">Select a version to view.</div>
            ) : tab === 'editor' ? (
              <div className="space-y-3">
                <div className="text-xs text-slate-500">
                  Version <span className="font-mono">{detail.version_no}</span> ·{' '}
                  {detail.is_active === 'Y' ? 'ACTIVE' : 'DRAFT'} · created by {detail.created_by}
                </div>
                <div className="rounded bg-slate-50 p-3 text-xs">
                  <span className="font-semibold text-slate-500">Model</span>{' '}
                  <span className="font-mono">
                    {detail.model_provider} / {detail.model_nm}
                  </span>
                  {detail.temperature !== null && <> · temp {String(detail.temperature)}</>}
                  {detail.max_tokens !== null && <> · max_tokens {detail.max_tokens}</>}
                  {detail.top_p !== null && <> · top_p {String(detail.top_p)}</>}
                  {detail.extra_params && (
                    <> · extra {JSON.stringify(detail.extra_params)}</>
                  )}
                </div>
                <PromptEditor label="System Prompt" value={draftSystem} readOnly />
                <PromptEditor label="User Prompt" value={draftUser} readOnly />
                {detail.change_summary && (
                  <div className="rounded bg-slate-50 p-3 text-sm">
                    <div className="text-xs font-semibold text-slate-500">Change Summary</div>
                    {detail.change_summary}
                    {detail.change_reason && (
                      <>
                        <div className="mt-2 text-xs font-semibold text-slate-500">Reason</div>
                        {detail.change_reason}
                      </>
                    )}
                  </div>
                )}
              </div>
            ) : tab === 'variables' ? (
              <VariablePanel
                promptId={detail.prompt_id}
                detected={detectedVars}
                initial={detail.variables}
                editable={admin}
              />
            ) : tab === 'diff' ? (
              <DiffViewer
                versions={versions}
                defaultV1={currentActive?.prompt_id ?? null}
                defaultV2={detail.prompt_id !== currentActive?.prompt_id ? detail.prompt_id : null}
              />
            ) : (
              <HistoryList nodeId={nodeId} />
            )}
          </div>
        </section>
      </div>

      {showCreate && (
        <NewVersionModal
          nodeId={nodeId}
          baseSystem={draftSystem}
          baseUser={draftUser}
          baseDetail={detail}
          prevPromptId={detail?.prompt_id ?? null}
          adminCanActivate={admin}
          onClose={() => setShowCreate(false)}
          onCreated={async (id, activated) => {
            setShowCreate(false);
            await reloadVersions();
            setSelectedId(id);
            if (activated) setTab('editor');
          }}
        />
      )}
      <Modal
        open={showActivate}
        title="Activate version"
        onClose={() => setShowActivate(false)}
        footer={
          <>
            <button
              onClick={() => setShowActivate(false)}
              className="rounded border border-slate-300 px-3 py-1 text-sm"
            >
              Cancel
            </button>
            <button
              onClick={handleActivate}
              disabled={busy}
              className="rounded bg-emerald-600 px-3 py-1 text-sm text-white disabled:opacity-50"
            >
              {busy ? 'Activating...' : 'Activate'}
            </button>
          </>
        }
      >
        <p className="text-sm">
          Switch active version from{' '}
          <span className="font-mono">v{currentActive?.version_no ?? '-'}</span> to{' '}
          <span className="font-mono">v{detail?.version_no}</span>?
        </p>
      </Modal>
    </div>
  );
}

function NewVersionModal({
  nodeId,
  baseSystem,
  baseUser,
  baseDetail,
  prevPromptId,
  adminCanActivate,
  onClose,
  onCreated,
}: {
  nodeId: number;
  baseSystem: string;
  baseUser: string;
  baseDetail: PromptVersionDetail | null;
  prevPromptId: number | null;
  adminCanActivate: boolean;
  onClose: () => void;
  onCreated: (newId: number, activated: boolean) => void;
}) {
  const [system, setSystem] = useState(baseSystem);
  const [user, setUser] = useState(baseUser);
  const [versionNo, setVersionNo] = useState('');
  const [changeSummary, setChangeSummary] = useState('');
  const [changeReason, setChangeReason] = useState('');
  const [activate, setActivate] = useState(false);
  const [provider, setProvider] = useState(baseDetail?.model_provider ?? 'anthropic');
  const [modelNm, setModelNm] = useState(baseDetail?.model_nm ?? '');
  const [temperature, setTemperature] = useState(
    baseDetail?.temperature != null ? String(baseDetail.temperature) : '',
  );
  const [maxTokens, setMaxTokens] = useState(
    baseDetail?.max_tokens != null ? String(baseDetail.max_tokens) : '',
  );
  const [topP, setTopP] = useState(
    baseDetail?.top_p != null ? String(baseDetail.top_p) : '',
  );
  const [extraParams, setExtraParams] = useState(
    baseDetail?.extra_params ? JSON.stringify(baseDetail.extra_params) : '',
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!changeSummary || !changeReason) {
      setError('Change summary and reason are required.');
      return;
    }
    if (!modelNm) {
      setError('Model name is required.');
      return;
    }
    let parsedExtra: Record<string, unknown> | null = null;
    if (extraParams.trim()) {
      try {
        parsedExtra = JSON.parse(extraParams) as Record<string, unknown>;
      } catch {
        setError('Extra params must be valid JSON.');
        return;
      }
    }
    setBusy(true);
    setError(null);
    try {
      const payload: PromptVersionCreate = {
        system_prompt: system,
        user_prompt: user,
        version_no: versionNo || undefined,
        model_provider: provider,
        model_nm: modelNm,
        temperature: temperature ? Number(temperature) : null,
        max_tokens: maxTokens ? Number(maxTokens) : null,
        top_p: topP ? Number(topP) : null,
        extra_params: parsedExtra,
        change_summary: changeSummary,
        change_reason: changeReason,
        prev_prompt_id: prevPromptId,
        activate_after_save: activate,
      };
      const created = await api.post<PromptVersionDetail>(`/nodes/${nodeId}/prompts`, payload);
      onCreated(created.prompt_id, activate);
    } catch (e) {
      setError(e instanceof ApiError ? String(e.detail) : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      title="New prompt version"
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} className="rounded border border-slate-300 px-3 py-1 text-sm">
            Cancel
          </button>
          <button
            onClick={save}
            disabled={busy}
            className="rounded bg-slate-900 px-3 py-1 text-sm text-white disabled:opacity-50"
          >
            {busy ? 'Saving...' : activate ? 'Save & Activate' : 'Save Draft'}
          </button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        <div className="grid grid-cols-2 gap-2">
          <label>
            <div className="text-xs text-slate-500">Version (optional, auto-bump if blank)</div>
            <input
              value={versionNo}
              onChange={(e) => setVersionNo(e.target.value)}
              placeholder="e.g. 1.0.1"
              className="w-full rounded border border-slate-300 px-2 py-1"
            />
          </label>
          <label className="flex items-center gap-2 pt-5">
            <input
              type="checkbox"
              checked={activate}
              disabled={!adminCanActivate}
              onChange={(e) => setActivate(e.target.checked)}
            />
            <span>Activate after save {adminCanActivate ? '' : '(ADMIN only)'}</span>
          </label>
        </div>
        <div className="rounded border border-slate-200 p-2">
          <div className="mb-1 text-xs font-semibold text-slate-500">Model settings</div>
          <div className="grid grid-cols-2 gap-2">
            <label>
              <div className="text-xs text-slate-500">Provider</div>
              <select
                value={provider}
                onChange={(e) => setProvider(e.target.value)}
                className="w-full rounded border border-slate-300 px-2 py-1"
              >
                <option value="anthropic">anthropic</option>
                <option value="openai">openai</option>
                <option value="google">google</option>
              </select>
            </label>
            <label>
              <div className="text-xs text-slate-500">Model name *</div>
              <input
                value={modelNm}
                onChange={(e) => setModelNm(e.target.value)}
                placeholder="e.g. claude-sonnet-4-6"
                className="w-full rounded border border-slate-300 px-2 py-1"
              />
            </label>
          </div>
          <div className="mt-2 grid grid-cols-3 gap-2">
            <label>
              <div className="text-xs text-slate-500">Temperature</div>
              <input
                type="number"
                step="0.01"
                value={temperature}
                onChange={(e) => setTemperature(e.target.value)}
                className="w-full rounded border border-slate-300 px-2 py-1"
              />
            </label>
            <label>
              <div className="text-xs text-slate-500">Max tokens</div>
              <input
                type="number"
                value={maxTokens}
                onChange={(e) => setMaxTokens(e.target.value)}
                className="w-full rounded border border-slate-300 px-2 py-1"
              />
            </label>
            <label>
              <div className="text-xs text-slate-500">Top P</div>
              <input
                type="number"
                step="0.01"
                value={topP}
                onChange={(e) => setTopP(e.target.value)}
                className="w-full rounded border border-slate-300 px-2 py-1"
              />
            </label>
          </div>
          <label className="mt-2 block">
            <div className="text-xs text-slate-500">Extra params (JSON, optional)</div>
            <textarea
              value={extraParams}
              onChange={(e) => setExtraParams(e.target.value)}
              rows={2}
              placeholder='{"frequency_penalty": 0.1}'
              className="w-full rounded border border-slate-300 px-2 py-1 font-mono"
            />
          </label>
        </div>
        <label>
          <div className="text-xs text-slate-500">Change summary *</div>
          <input
            value={changeSummary}
            onChange={(e) => setChangeSummary(e.target.value)}
            className="w-full rounded border border-slate-300 px-2 py-1"
          />
        </label>
        <label>
          <div className="text-xs text-slate-500">Change reason *</div>
          <textarea
            value={changeReason}
            onChange={(e) => setChangeReason(e.target.value)}
            rows={2}
            className="w-full rounded border border-slate-300 px-2 py-1"
          />
        </label>
        <PromptEditor label="System Prompt" value={system} onChange={setSystem} />
        <PromptEditor label="User Prompt" value={user} onChange={setUser} />
        {error && <div className="text-sm text-red-600">{error}</div>}
      </div>
    </Modal>
  );
}
